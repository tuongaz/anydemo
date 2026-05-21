import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from './atomic-write.ts';
import { seeflowHome } from './paths.ts';
import { shortId } from './short-id.ts';

export interface FlowEntry {
  id: string;
  slug: string;
  name: string;
  description?: string;
  repoPath: string;
  flowPath: string;
  lastModified: number;
  valid: boolean;
}

export interface RegisterInput {
  name: string;
  description?: string;
  repoPath: string;
  flowPath: string;
  valid?: boolean;
  lastModified?: number;
}

export interface Registry {
  /** Resolved path of the registry file on disk. */
  readonly path: string;
  list(): FlowEntry[];
  getById(id: string): FlowEntry | undefined;
  getBySlug(slug: string): FlowEntry | undefined;
  getByRepoPath(repoPath: string): FlowEntry | undefined;
  getByRepoPathAndFlowPath(repoPath: string, flowPath: string): FlowEntry | undefined;
  upsert(input: RegisterInput): FlowEntry;
  remove(id: string): boolean;
  /** Subscribe to external changes detected via reload(). Returns unsubscribe. */
  onChange(fn: () => void): () => void;
  /** Drop the in-memory cache and re-read from disk. Fires onChange listeners. */
  reload(): void;
  /** True when `contents` matches a hash this registry recently persisted. */
  isOwnWrite(contents: string): boolean;
}

export function defaultRegistryPath(): string {
  return join(seeflowHome(), 'registry.json');
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'demo';
}

const OWN_WRITE_RING_SIZE = 4;

export function createRegistry(options: { path?: string } = {}): Registry {
  const path = options.path ?? defaultRegistryPath();
  const entries = new Map<string, FlowEntry>();
  const writtenHashes: string[] = [];
  const listeners = new Set<() => void>();

  const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

  const rememberWrite = (contents: string) => {
    writtenHashes.push(sha256(contents));
    if (writtenHashes.length > OWN_WRITE_RING_SIZE) writtenHashes.shift();
  };

  // Mtime of the last on-disk state we observed (load or persist). Used by
  // refreshIfStale() to detect external writes (notably the in-process CLI
  // mutating registry.json while the studio is running) without waiting for
  // the debounced fs.watch callback.
  let lastSeenMtimeMs = 0;

  const statMtimeMs = (): number | null => {
    try {
      return statSync(path).mtimeMs;
    } catch {
      return null;
    }
  };

  const loadFromDisk = () => {
    entries.clear();
    if (!existsSync(path)) {
      lastSeenMtimeMs = 0;
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (!Array.isArray(parsed)) {
        lastSeenMtimeMs = statMtimeMs() ?? 0;
        return;
      }
      for (const e of parsed) {
        if (
          e &&
          typeof e.id === 'string' &&
          typeof e.slug === 'string' &&
          typeof e.repoPath === 'string'
        ) {
          if (typeof e.flowPath !== 'string') {
            console.warn(
              `[registry] ignoring legacy entry ${e.id} (${e.slug}) — pre-split format, please re-register`,
            );
            continue;
          }
          const entry = e as FlowEntry;
          if (entry.description !== undefined && typeof entry.description !== 'string') {
            entry.description = undefined;
          }
          entries.set(entry.id, entry);
        }
      }
      lastSeenMtimeMs = statMtimeMs() ?? 0;
    } catch (err) {
      console.error(`[registry] failed to load ${path}, starting empty:`, err);
      lastSeenMtimeMs = statMtimeMs() ?? 0;
    }
  };

  loadFromDisk();

  // Cheap stat-and-reload guard for read paths. When another process (the
  // in-process CLI) has written registry.json since our last load, the
  // debounced fs.watch reload can lag the next HTTP read; this closes that
  // gap with one stat() per request.
  const refreshIfStale = () => {
    const mtime = statMtimeMs();
    if (mtime === null) {
      if (lastSeenMtimeMs !== 0) loadFromDisk();
      return;
    }
    if (mtime !== lastSeenMtimeMs) loadFromDisk();
  };

  const persist = () => {
    mkdirSync(dirname(path), { recursive: true });
    const contents = JSON.stringify([...entries.values()], null, 2);
    rememberWrite(contents);
    writeFileAtomic(path, contents);
    lastSeenMtimeMs = statMtimeMs() ?? lastSeenMtimeMs;
  };

  const findByRepoPath = (repoPath: string): FlowEntry | undefined => {
    for (const e of entries.values()) {
      if (e.repoPath === repoPath) return e;
    }
    return undefined;
  };

  const findByRepoPathAndFlowPath = (repoPath: string, flowPath: string): FlowEntry | undefined => {
    for (const e of entries.values()) {
      if (e.repoPath === repoPath && e.flowPath === flowPath) return e;
    }
    return undefined;
  };

  const uniqueSlug = (base: string): string => {
    const taken = new Set([...entries.values()].map((e) => e.slug));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  };

  return {
    path,
    list: () => {
      refreshIfStale();
      return [...entries.values()];
    },
    getById: (id) => {
      refreshIfStale();
      return entries.get(id);
    },
    getBySlug: (slug) => {
      refreshIfStale();
      return [...entries.values()].find((e) => e.slug === slug);
    },
    getByRepoPath: (repoPath) => {
      refreshIfStale();
      return findByRepoPath(repoPath);
    },
    getByRepoPathAndFlowPath: (repoPath, flowPath) => {
      refreshIfStale();
      return findByRepoPathAndFlowPath(repoPath, flowPath);
    },
    upsert(input) {
      const lastModified = input.lastModified ?? Date.now();
      const valid = input.valid ?? true;
      const existing = findByRepoPathAndFlowPath(input.repoPath, input.flowPath);
      if (existing) {
        // input.description reflects the current flow.json on every call —
        // when an author removes the description, we drop it from the entry
        // too (JSON.stringify skips undefined values on persist).
        const updated: FlowEntry = {
          ...existing,
          name: input.name,
          description: input.description,
          flowPath: input.flowPath,
          lastModified,
          valid,
        };
        entries.set(existing.id, updated);
        persist();
        return updated;
      }
      const id = shortId();
      const slug = uniqueSlug(slugify(input.name));
      const entry: FlowEntry = {
        id,
        slug,
        name: input.name,
        description: input.description,
        repoPath: input.repoPath,
        flowPath: input.flowPath,
        lastModified,
        valid,
      };
      entries.set(id, entry);
      persist();
      return entry;
    },
    remove(id) {
      const removed = entries.delete(id);
      if (removed) persist();
      return removed;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    reload() {
      loadFromDisk();
      for (const fn of listeners) {
        try {
          fn();
        } catch (err) {
          console.error('[registry] onChange listener threw:', err);
        }
      }
    },
    isOwnWrite(contents) {
      return writtenHashes.includes(sha256(contents));
    },
  };
}
