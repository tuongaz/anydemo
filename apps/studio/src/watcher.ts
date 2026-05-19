import { type FSWatcher, existsSync, readFileSync, watch } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { EventBus } from './events.ts';
import { resolveFileRefs } from './file-ref.ts';
import { mergeArchitectureAndStyle } from './merge.ts';
import type { Registry } from './registry.ts';
import { type Architecture, ArchitectureSchema, type Flow, StyleSchema } from './schema.ts';

const DEFAULT_DEBOUNCE_MS = 100;

export interface FlowSnapshot {
  /** Last successfully parsed flow, if we ever saw one. */
  flow: Flow | null;
  /** Result of the most recent parse attempt. */
  valid: boolean;
  /** Human-readable error from the most recent parse, when `valid: false`. */
  error: string | null;
  /** Absolute path on disk this snapshot was read from. */
  filePath: string;
  /** Server timestamp of the most recent parse attempt. */
  parsedAt: number;
}

export interface WatcherDeps {
  registry: Registry;
  events: EventBus;
  /** Override for tests. */
  debounceMs?: number;
}

export interface FlowWatcher {
  /** Read the current snapshot for a demo, or null if unknown. */
  snapshot(flowId: string): FlowSnapshot | null;
  /** Begin watching the file backing the given demo id. Idempotent. */
  watch(flowId: string): void;
  /** Stop watching a single demo. */
  unwatch(flowId: string): void;
  /** Start watchers for every entry currently in the registry. */
  watchAll(): void;
  /** Stop everything (used in tests + on shutdown). */
  closeAll(): void;
  /** Force a reparse synchronously. Useful for tests + initial load. */
  reparse(flowId: string): FlowSnapshot | null;
  /**
   * Relative paths (under `<project>/.seeflow/`) currently being watched
   * because they're referenced by a node's `data.htmlPath` or `data.path`.
   * Sorted for stable assertion order. Used by tests.
   */
  referencedPaths(flowId: string): string[];
}

interface FileWatchEntry {
  fsWatcher: FSWatcher;
  /** basename → relative path (rooted at `<project>/.seeflow/`) */
  files: Map<string, string>;
  /** basename → pending debounce timer for the next broadcast */
  timers: Map<string, ReturnType<typeof setTimeout>>;
}

interface WatchHandle {
  fsWatcher: FSWatcher;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  filePath: string;
  /**
   * Per-directory file watchers for files referenced by node data
   * (`htmlPath`, imageNode `path`). Each directory watcher dispatches to
   * specific basenames in its `files` map.
   */
  fileWatchers: Map<string, FileWatchEntry>;
}

const resolveFilePath = (repoPath: string, architecturePath: string): string =>
  isAbsolute(architecturePath) ? architecturePath : join(repoPath, architecturePath);

const isCleanRelativePath = (p: string): boolean => {
  if (!p) return false;
  // Reject data URLs early — the pre-launch hard-cut (US-004) replaces
  // imageNode.data.image with data.path, but defensively skip any lingering
  // base64 payloads so we don't try to fs.watch a 5MB string.
  if (p.startsWith('data:')) return false;
  if (isAbsolute(p) || p.startsWith('/') || p.startsWith('\\')) return false;
  const segments = p.split(/[\\/]/);
  if (segments.some((s) => s === '..')) return false;
  return true;
};

/**
 * Walk raw architecture JSON (pre-schema-parse) collecting referenced file
 * paths: `nodes[].data.htmlPath` (htmlNode) and `nodes[].data.path`
 * (imageNode). Operates on the raw JSON so the watcher works before those
 * fields are formally validated.
 */
const collectReferencedPaths = (raw: unknown): string[] => {
  if (!raw || typeof raw !== 'object') return [];
  const nodes = (raw as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];
  const out = new Set<string>();
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const data = (node as { data?: unknown }).data;
    if (!data || typeof data !== 'object') continue;
    const d = data as { htmlPath?: unknown; path?: unknown };
    for (const candidate of [d.htmlPath, d.path]) {
      if (typeof candidate !== 'string') continue;
      if (!isCleanRelativePath(candidate)) continue;
      out.add(candidate);
    }
  }
  return [...out];
};

/**
 * Read architecture.json + optional style.json, resolve file:// refs in the
 * architecture, validate both, and merge into a Flow. Shared by the watcher
 * and by sync read fallbacks (getFlowImpl) so they produce identical results.
 */
export interface ReadMergedFlowResult {
  flow: Flow | null;
  valid: boolean;
  error: string | null;
  /** Sorted relative paths under `<seeflowRoot>` resolved via file://. */
  fileRefs: string[];
  /** Architecture file paths referenced via htmlPath / imageNode.path. */
  staticRefs: string[];
}

export function readMergedFlow(archPath: string): ReadMergedFlowResult {
  const empty: ReadMergedFlowResult = {
    flow: null,
    valid: false,
    error: null,
    fileRefs: [],
    staticRefs: [],
  };
  if (!existsSync(archPath)) {
    return { ...empty, error: `Architecture file not found: ${archPath}` };
  }

  const seeflowRoot = dirname(archPath);
  const stylePath = join(seeflowRoot, 'style.json');

  let rawArch: unknown;
  try {
    rawArch = JSON.parse(readFileSync(archPath, 'utf8'));
  } catch (err) {
    return {
      ...empty,
      error: `Invalid JSON in architecture.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const { resolved, refs } = resolveFileRefs(rawArch, seeflowRoot);
  const staticRefs = collectReferencedPaths(rawArch);

  const archParse = ArchitectureSchema.safeParse(resolved);
  if (!archParse.success) {
    const message = archParse.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    return {
      ...empty,
      error: `Architecture schema validation failed: ${message}`,
      fileRefs: refs,
      staticRefs,
    };
  }

  let rawStyle: unknown = {};
  if (existsSync(stylePath)) {
    try {
      rawStyle = JSON.parse(readFileSync(stylePath, 'utf8'));
    } catch (err) {
      return {
        ...empty,
        error: `Invalid JSON in style.json: ${err instanceof Error ? err.message : String(err)}`,
        fileRefs: refs,
        staticRefs,
      };
    }
  }

  const styleParse = StyleSchema.safeParse(rawStyle);
  if (!styleParse.success) {
    const message = styleParse.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    return {
      ...empty,
      error: `Style schema validation failed: ${message}`,
      fileRefs: refs,
      staticRefs,
    };
  }

  const flow = mergeArchitectureAndStyle(archParse.data as Architecture, styleParse.data);
  return { flow, valid: true, error: null, fileRefs: refs, staticRefs };
}

const closeFileWatchers = (handle: WatchHandle): void => {
  for (const entry of handle.fileWatchers.values()) {
    entry.fsWatcher.close();
    for (const t of entry.timers.values()) clearTimeout(t);
  }
  handle.fileWatchers.clear();
};

export function createWatcher(deps: WatcherDeps): FlowWatcher {
  const { registry, events } = deps;
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const handles = new Map<string, WatchHandle>();
  const snapshots = new Map<string, FlowSnapshot>();

  // Reconcile the file-watch set for `flowId` against the desired referenced
  // paths. Closes watchers for dirs that disappeared, updates the basename
  // map for dirs that survived, opens new fs.watch handles for new dirs.
  const reconcileFileWatchers = (
    flowId: string,
    handle: WatchHandle,
    seeflowRoot: string,
    refs: string[],
  ): void => {
    const desired = new Map<string, Map<string, string>>();
    for (const relPath of refs) {
      const abs = join(seeflowRoot, relPath);
      const dir = dirname(abs);
      const base = basename(abs);
      let dirMap = desired.get(dir);
      if (!dirMap) {
        dirMap = new Map();
        desired.set(dir, dirMap);
      }
      dirMap.set(base, relPath);
    }

    // Close watchers for directories no longer referenced.
    for (const [dir, entry] of handle.fileWatchers) {
      if (!desired.has(dir)) {
        entry.fsWatcher.close();
        for (const t of entry.timers.values()) clearTimeout(t);
        handle.fileWatchers.delete(dir);
      }
    }

    // Add or update watchers for desired directories.
    for (const [dir, files] of desired) {
      const existing = handle.fileWatchers.get(dir);
      if (existing) {
        existing.files = files;
        // Drop pending timers for basenames no longer in scope.
        for (const base of [...existing.timers.keys()]) {
          if (!files.has(base)) {
            const t = existing.timers.get(base);
            if (t) clearTimeout(t);
            existing.timers.delete(base);
          }
        }
        continue;
      }

      if (!existsSync(dir)) {
        // Directory hasn't been created on disk yet (e.g. blocks/ before any
        // htmlNode is dropped). Skip silently — next reparse will retry.
        continue;
      }

      let fsWatcher: FSWatcher;
      try {
        fsWatcher = watch(dir, { persistent: true }, (_event, changed) => {
          if (!changed) return;
          const cur = handle.fileWatchers.get(dir);
          if (!cur) return;
          const rel = cur.files.get(changed);
          if (!rel) return;
          const existingTimer = cur.timers.get(changed);
          if (existingTimer) clearTimeout(existingTimer);
          const timer = setTimeout(() => {
            cur.timers.delete(changed);
            events.broadcast({
              type: 'file:changed',
              flowId,
              payload: { path: rel },
            });
          }, debounceMs);
          cur.timers.set(changed, timer);
        });
      } catch (err) {
        console.error(`[watcher] failed to watch ${dir} for demo ${flowId}:`, err);
        continue;
      }

      handle.fileWatchers.set(dir, {
        fsWatcher,
        files,
        timers: new Map(),
      });
    }
  };

  const reparse = (flowId: string): FlowSnapshot | null => {
    const entry = registry.getById(flowId);
    if (!entry) return null;
    const filePath = resolveFilePath(entry.repoPath, entry.architecturePath);

    const previous = snapshots.get(flowId) ?? null;
    const parsedAt = Date.now();
    const result = readMergedFlow(filePath);

    const next: FlowSnapshot = result.valid
      ? { flow: result.flow, valid: true, error: null, filePath, parsedAt }
      : { flow: previous?.flow ?? null, valid: false, error: result.error, filePath, parsedAt };

    snapshots.set(flowId, next);

    // Reconcile the referenced-file watch set: htmlPath/imageNode.path from
    // architecture + any file:// targets that resolved cleanly. Schema errors
    // shouldn't drop the watch set — the user is mid-edit and the referenced
    // files are still valid targets, so this reconciles whenever the JSON
    // parsed (even if schema validation failed).
    const handle = handles.get(flowId);
    if (handle) {
      const allRefs = [...result.fileRefs, ...result.staticRefs];
      reconcileFileWatchers(flowId, handle, dirname(filePath), allRefs);
    }

    return next;
  };

  const broadcastReload = (flowId: string, snap: FlowSnapshot) => {
    events.broadcast({
      type: 'flow:reload',
      flowId,
      payload: snap.valid ? { valid: true, flow: snap.flow } : { valid: false, error: snap.error },
    });
  };

  const startWatch = (flowId: string) => {
    const existing = handles.get(flowId);
    if (existing) {
      existing.fsWatcher.close();
      if (existing.debounceTimer) clearTimeout(existing.debounceTimer);
      closeFileWatchers(existing);
      handles.delete(flowId);
    }

    const entry = registry.getById(flowId);
    if (!entry) return;

    const filePath = resolveFilePath(entry.repoPath, entry.architecturePath);
    const dir = dirname(filePath);
    const base = basename(filePath);

    if (!existsSync(dir)) {
      // Directory missing — record an invalid snapshot but don't try to watch.
      const snap = reparse(flowId);
      if (snap) broadcastReload(flowId, snap);
      return;
    }

    let fsWatcher: FSWatcher;
    try {
      fsWatcher = watch(dir, { persistent: true }, (_event, changed) => {
        // React to architecture.json, style.json, or rename-on-save events
        // (some platforms emit those with no filename).
        if (changed && changed !== base && changed !== 'style.json') return;
        const handle = handles.get(flowId);
        if (!handle) return;
        if (handle.debounceTimer) clearTimeout(handle.debounceTimer);
        handle.debounceTimer = setTimeout(() => {
          handle.debounceTimer = null;
          const snap = reparse(flowId);
          if (snap) broadcastReload(flowId, snap);
        }, debounceMs);
      });
    } catch (err) {
      console.error(`[watcher] failed to watch ${dir} for flow ${flowId}:`, err);
      const snap = reparse(flowId);
      if (snap) broadcastReload(flowId, snap);
      return;
    }

    handles.set(flowId, {
      fsWatcher,
      debounceTimer: null,
      filePath,
      fileWatchers: new Map(),
    });

    // Seed the snapshot from disk so callers can serve GET /api/flows/:id
    // without having to wait for the first fs event. Also seeds the
    // referenced-file watch set via reconcileFileWatchers().
    reparse(flowId);
  };

  return {
    snapshot(flowId) {
      return snapshots.get(flowId) ?? null;
    },
    watch(flowId) {
      startWatch(flowId);
    },
    unwatch(flowId) {
      const h = handles.get(flowId);
      if (!h) return;
      h.fsWatcher.close();
      if (h.debounceTimer) clearTimeout(h.debounceTimer);
      closeFileWatchers(h);
      handles.delete(flowId);
      snapshots.delete(flowId);
    },
    watchAll() {
      for (const entry of registry.list()) startWatch(entry.id);
    },
    closeAll() {
      for (const [, h] of handles) {
        h.fsWatcher.close();
        if (h.debounceTimer) clearTimeout(h.debounceTimer);
        closeFileWatchers(h);
      }
      handles.clear();
      snapshots.clear();
    },
    reparse,
    referencedPaths(flowId) {
      const h = handles.get(flowId);
      if (!h) return [];
      const paths: string[] = [];
      for (const entry of h.fileWatchers.values()) {
        for (const rel of entry.files.values()) paths.push(rel);
      }
      return paths.sort();
    },
  };
}
