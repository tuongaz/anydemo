import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { seeflowHome } from './paths.ts';

export interface FlowEntry {
  id: string;
  slug: string;
  name: string;
  repoPath: string;
  architecturePath: string;
  lastModified: number;
  valid: boolean;
}

export interface RegisterInput {
  name: string;
  repoPath: string;
  architecturePath: string;
  valid?: boolean;
  lastModified?: number;
}

export interface Registry {
  list(): FlowEntry[];
  getById(id: string): FlowEntry | undefined;
  getBySlug(slug: string): FlowEntry | undefined;
  getByRepoPath(repoPath: string): FlowEntry | undefined;
  getByRepoPathAndArchitecturePath(repoPath: string, architecturePath: string): FlowEntry | undefined;
  upsert(input: RegisterInput): FlowEntry;
  remove(id: string): boolean;
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

export function createRegistry(options: { path?: string } = {}): Registry {
  const path = options.path ?? defaultRegistryPath();
  const entries = new Map<string, FlowEntry>();

  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (Array.isArray(parsed)) {
        for (const e of parsed) {
          if (
            e &&
            typeof e.id === 'string' &&
            typeof e.slug === 'string' &&
            typeof e.repoPath === 'string'
          ) {
            if (typeof e.architecturePath !== 'string') {
              console.warn(
                `[registry] ignoring legacy entry ${e.id} (${e.slug}) — pre-split format, please re-register`,
              );
              continue;
            }
            entries.set(e.id, e as FlowEntry);
          }
        }
      }
    } catch (err) {
      console.error(`[registry] failed to load ${path}, starting empty:`, err);
    }
  }

  const persist = () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify([...entries.values()], null, 2));
  };

  const findByRepoPath = (repoPath: string): FlowEntry | undefined => {
    for (const e of entries.values()) {
      if (e.repoPath === repoPath) return e;
    }
    return undefined;
  };

  const findByRepoPathAndArchitecturePath = (repoPath: string, architecturePath: string): FlowEntry | undefined => {
    for (const e of entries.values()) {
      if (e.repoPath === repoPath && e.architecturePath === architecturePath) return e;
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
    list: () => [...entries.values()],
    getById: (id) => entries.get(id),
    getBySlug: (slug) => [...entries.values()].find((e) => e.slug === slug),
    getByRepoPath: findByRepoPath,
    getByRepoPathAndArchitecturePath: findByRepoPathAndArchitecturePath,
    upsert(input) {
      const lastModified = input.lastModified ?? Date.now();
      const valid = input.valid ?? true;
      const existing = findByRepoPathAndArchitecturePath(input.repoPath, input.architecturePath);
      if (existing) {
        const updated: FlowEntry = {
          ...existing,
          name: input.name,
          architecturePath: input.architecturePath,
          lastModified,
          valid,
        };
        entries.set(existing.id, updated);
        persist();
        return updated;
      }
      const id = crypto.randomUUID();
      const slug = uniqueSlug(slugify(input.name));
      const entry: FlowEntry = {
        id,
        slug,
        name: input.name,
        repoPath: input.repoPath,
        architecturePath: input.architecturePath,
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
  };
}
