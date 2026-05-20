import { createHash } from 'node:crypto';
import { type FSWatcher, existsSync, readFileSync, watch } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { EventBus } from './events.ts';
import { resolveFileRefs } from './file-ref.ts';
import { mergeFlowAndStyle } from './merge.ts';
import type { Registry } from './registry.ts';
import { type Flow, FlowSchema, type ResolvedFlow, StyleSchema } from './schema.ts';

const DEFAULT_DEBOUNCE_MS = 100;

/** Max recent self-write hashes retained per flow for own-echo suppression. */
const WRITTEN_HASH_RING_SIZE = 4;

const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

/**
 * Canonical "what's on disk for this flow" string used for own-write
 * dedupe. Combines flow.json and style.json bytes so a self-write that
 * touches either file is recognized; a NUL separator keeps the boundary
 * unambiguous. `styleContent` is `''` when style.json doesn't exist.
 */
const combinedContent = (flowContent: string, styleContent: string): string =>
  `${flowContent}\0${styleContent}`;

export interface FlowSnapshot {
  /** Last successfully parsed flow, if we ever saw one. */
  flow: ResolvedFlow | null;
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
   * Record a snapshot that the server just wrote and broadcast flow:reload
   * directly from it. Stores the file-content hash so the upcoming fs-watcher
   * echo for this same write is suppressed (see startWatch's debounce
   * callback). `flowContent` / `styleContent` are the exact bytes written —
   * pass `''` for style when style.json was deleted or doesn't exist.
   */
  notifyWritten(
    flowId: string,
    snap: FlowSnapshot,
    flowContent: string,
    styleContent: string,
  ): void;
  /**
   * Relative paths (under `<project>/.seeflow/`) currently being watched
   * because they're referenced by a node's `data.path` (imageNode). htmlNode
   * content rides on the file:// resolver via `data.html`, not this list.
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
   * (imageNode `path`). Each directory watcher dispatches to
   * specific basenames in its `files` map.
   */
  fileWatchers: Map<string, FileWatchEntry>;
}

const resolveFilePath = (repoPath: string, flowPath: string): string =>
  isAbsolute(flowPath) ? flowPath : join(repoPath, flowPath);

// `file://` refs in flow.json resolve against `<project>/.seeflow/` per the
// skill spec — not against the flow file's own directory. Walk up from the
// flow's parent looking for an ancestor named `.seeflow`. Fallback to the
// flow's parent for flows registered outside the `.seeflow/` convention.
const computeSeeflowRoot = (flowPath: string): string => {
  const flowDir = dirname(flowPath);
  let current = flowDir;
  while (true) {
    if (basename(current) === '.seeflow') return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return flowDir;
};

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
 * Walk raw flow JSON (pre-schema-parse) collecting referenced file paths:
 * `nodes[].data.path` (imageNode). htmlNode content now flows through the
 * `file://nodes/<id>/view.html` ref handled by the file-ref resolver, so it
 * does NOT need a separate fs.watch entry here. Operates on the raw JSON so
 * the watcher works before those fields are formally validated.
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
    const d = data as { path?: unknown };
    if (typeof d.path !== 'string') continue;
    if (!isCleanRelativePath(d.path)) continue;
    out.add(d.path);
  }
  return [...out];
};

/**
 * Read flow.json + optional style.json, resolve file:// refs in the flow,
 * validate both, and merge into a ResolvedFlow. Shared by the watcher and
 * by sync read fallbacks (getFlowImpl) so they produce identical results.
 */
export interface ReadMergedFlowResult {
  flow: ResolvedFlow | null;
  valid: boolean;
  error: string | null;
  /** Sorted relative paths under `<seeflowRoot>` resolved via file://. */
  fileRefs: string[];
  /** Flow file paths referenced via imageNode.path. */
  staticRefs: string[];
}

export function readMergedFlow(flowPath: string): ReadMergedFlowResult {
  const empty: ReadMergedFlowResult = {
    flow: null,
    valid: false,
    error: null,
    fileRefs: [],
    staticRefs: [],
  };
  if (!existsSync(flowPath)) {
    return { ...empty, error: `Flow file not found: ${flowPath}` };
  }

  const flowDir = dirname(flowPath);
  const seeflowRoot = computeSeeflowRoot(flowPath);
  const stylePath = join(flowDir, 'style.json');

  let rawFlow: unknown;
  try {
    rawFlow = JSON.parse(readFileSync(flowPath, 'utf8'));
  } catch (err) {
    return {
      ...empty,
      error: `Invalid JSON in flow.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const { resolved, refs } = resolveFileRefs(rawFlow, seeflowRoot);
  const staticRefs = collectReferencedPaths(rawFlow);

  const flowParse = FlowSchema.safeParse(resolved);
  if (!flowParse.success) {
    const message = flowParse.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    return {
      ...empty,
      error: `Flow schema validation failed: ${message}`,
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

  const flow = mergeFlowAndStyle(flowParse.data as Flow, styleParse.data);
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
  /**
   * Ring buffer of recent self-write content hashes per flow. The fs watcher
   * computes the same hash on its debounced callback and short-circuits when
   * it matches — that's how a server-initiated PATCH avoids re-broadcasting
   * itself on top of the direct notifyWritten broadcast.
   */
  const writtenHashes = new Map<string, string[]>();

  const rememberWrittenHash = (flowId: string, hash: string): void => {
    const ring = writtenHashes.get(flowId);
    if (!ring) {
      writtenHashes.set(flowId, [hash]);
      return;
    }
    ring.push(hash);
    if (ring.length > WRITTEN_HASH_RING_SIZE) ring.shift();
  };

  const isOwnWriteEcho = (flowId: string, hash: string): boolean =>
    writtenHashes.get(flowId)?.includes(hash) ?? false;

  /**
   * Read flow.json + style.json bytes at this moment so the fs callback can
   * compute the same combined hash that notifyWritten recorded. Missing
   * style.json maps to empty string — matches notifyWritten's contract.
   */
  const readCombinedFromDisk = (flowPath: string): string | null => {
    let flowContent: string;
    try {
      flowContent = readFileSync(flowPath, 'utf8');
    } catch {
      return null;
    }
    const stylePath = join(dirname(flowPath), 'style.json');
    const styleContent = existsSync(stylePath) ? readFileSync(stylePath, 'utf8') : '';
    return combinedContent(flowContent, styleContent);
  };

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
    const filePath = resolveFilePath(entry.repoPath, entry.flowPath);

    const previous = snapshots.get(flowId) ?? null;
    const parsedAt = Date.now();
    const result = readMergedFlow(filePath);

    const next: FlowSnapshot = result.valid
      ? { flow: result.flow, valid: true, error: null, filePath, parsedAt }
      : { flow: previous?.flow ?? null, valid: false, error: result.error, filePath, parsedAt };

    snapshots.set(flowId, next);

    // Reconcile the referenced-file watch set: imageNode.path from
    // flow + any file:// targets that resolved cleanly. Schema errors
    // shouldn't drop the watch set — the user is mid-edit and the referenced
    // files are still valid targets, so this reconciles whenever the JSON
    // parsed (even if schema validation failed).
    const handle = handles.get(flowId);
    if (handle) {
      const allRefs = [...result.fileRefs, ...result.staticRefs];
      reconcileFileWatchers(flowId, handle, computeSeeflowRoot(filePath), allRefs);
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

    const filePath = resolveFilePath(entry.repoPath, entry.flowPath);
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
        // React to flow.json, style.json, or rename-on-save events
        // (some platforms emit those with no filename).
        if (changed && changed !== base && changed !== 'style.json') return;
        const handle = handles.get(flowId);
        if (!handle) return;
        if (handle.debounceTimer) clearTimeout(handle.debounceTimer);
        handle.debounceTimer = setTimeout(() => {
          handle.debounceTimer = null;
          // Own-write dedupe: if the on-disk bytes match what the server just
          // wrote (recent hash in the ring), this is our own echo — drop it.
          // notifyWritten already broadcast and seeded the snapshot.
          const combined = readCombinedFromDisk(filePath);
          if (combined !== null && isOwnWriteEcho(flowId, sha256Hex(combined))) return;
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
      writtenHashes.clear();
    },
    reparse,
    notifyWritten(flowId, snap, flowContent, styleContent) {
      snapshots.set(flowId, snap);
      rememberWrittenHash(flowId, sha256Hex(combinedContent(flowContent, styleContent)));
      broadcastReload(flowId, snap);
    },
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
