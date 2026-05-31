/**
 * Host-side files-manifest builder. Walks the currently registered project's
 * per-node folders once on session start and emits one `files-manifest` frame
 * per joining peer so the peer's canvas can prime cache keys and render
 * placeholder sizing BEFORE any `file-request` fires.
 *
 * Manifest is metadata only — no file contents on the wire. Each entry carries
 * the file's size + a sha256 prefix (16 hex chars) so the peer can detect a
 * cache miss without round-tripping the body. The full 64-hex sha is preserved
 * inside file-request / file-redirect payloads (US-060) where integrity matters;
 * here we use a prefix to keep the manifest small.
 *
 * Walk depth is capped at 2 (files directly under `<flowDir>/nodes/<nodeId>/`
 * plus one level of subdirectory) so a peer that drops a folder of nested
 * assets doesn't explode the manifest. Total entries are capped at 5000 —
 * if exceeded the manifest is truncated with a warn; join is never blocked.
 *
 * Incremental updates: after the initial build, `recordFileWritten` / `recordNodeRemoved`
 * keep the in-memory map in sync with `file-upload` node-patched broadcasts +
 * `removeNodeDir` calls, so a peer that joins mid-session sees the same
 * post-upload state every other peer has converged on.
 */

import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { dirname, join, sep as pathSep } from 'node:path';
import type { Registry } from './registry.ts';
import type { FilesManifestEntry, FilesManifestPayload } from './share-envelope.ts';

export const MAX_MANIFEST_ENTRIES = 5000;
const ETAG_PREFIX_LEN = 16;

interface InternalEntry {
  nodeId: string;
  relPath: string;
  size: number;
  etag: string;
}

export interface FilesManifestDeps {
  registry: Registry;
  // Test seams — defaults to node:fs/promises.
  readdir?: (p: string) => Promise<Dirent[]>;
  readFile?: (p: string) => Promise<Buffer>;
  stat?: (p: string) => Promise<{ size: number }>;
}

export interface FilesManifestBuilder {
  /** Walk every registered flow's nodes/ subtree and populate the in-memory map.
   *  Safe to call repeatedly — replaces the existing state. */
  init(): Promise<void>;
  /** Snapshot of the current manifest, capped at MAX_MANIFEST_ENTRIES. */
  build(): FilesManifestPayload;
  /** Record (or replace) a single file entry. Called by share.ts when a
   *  `file-upload` `node-patched` broadcast fires. */
  recordFileWritten(input: {
    absPath: string;
    nodeId: string;
    relPath: string;
    size: number;
    etag: string;
  }): void;
  /** Compute size + etag from raw bytes then `recordFileWritten`. Convenience
   *  for callers that already hold the post-write buffer. */
  recordFileWrittenFromBytes(input: {
    absPath: string;
    nodeId: string;
    relPath: string;
    bytes: Uint8Array;
  }): void;
  /** Drop every entry whose `absPath` lives under the given node directory. */
  recordNodeRemoved(nodeDirAbsPath: string): void;
  /** Test/debug visibility into the underlying map. */
  size(): number;
}

const NODE_ID_RE = /^node-[A-Za-z0-9]{10}$/;

const defaultReaddir = (p: string): Promise<Dirent[]> =>
  fsPromises.readdir(p, { withFileTypes: true });
const defaultReadFile = (p: string): Promise<Buffer> => fsPromises.readFile(p) as Promise<Buffer>;
const defaultStat = async (p: string): Promise<{ size: number }> => {
  const s = await fsPromises.stat(p);
  return { size: s.size };
};

const etagFromBytes = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex').slice(0, ETAG_PREFIX_LEN);

const flowDirOf = (flowPath: string): string => {
  const d = dirname(flowPath);
  return d === '.' ? '' : d;
};

const flowBaseAbs = (repoPath: string, flowPath: string): string => {
  const fd = flowDirOf(flowPath);
  return fd === '' ? repoPath : join(repoPath, fd);
};

export function createFilesManifestBuilder(deps: FilesManifestDeps): FilesManifestBuilder {
  const readdir = deps.readdir ?? defaultReaddir;
  const readFile = deps.readFile ?? defaultReadFile;
  const stat = deps.stat ?? defaultStat;

  // absPath -> entry. absPath chosen as the key because (a) it's the only
  // identifier that uniquely names a file across flows and (b) it lets
  // `recordNodeRemoved(nodeDirAbsPath)` drop everything under a single prefix
  // without a secondary index.
  const entries = new Map<string, InternalEntry>();

  const walkNodeDir = async (flowBase: string, nodeId: string): Promise<void> => {
    const nodeDir = join(flowBase, 'nodes', nodeId);
    let level1: Dirent[];
    try {
      level1 = await readdir(nodeDir);
    } catch {
      return;
    }
    for (const d of level1) {
      if (d.isSymbolicLink()) continue;
      if (d.isFile()) {
        await ingestFile(nodeDir, nodeId, d.name, [d.name]);
        continue;
      }
      if (!d.isDirectory()) continue;
      // Depth 2: one level of subdirectory. Files inside are included; nested
      // directories below this are NOT descended into.
      const subDir = join(nodeDir, d.name);
      let level2: Dirent[];
      try {
        level2 = await readdir(subDir);
      } catch {
        continue;
      }
      for (const inner of level2) {
        if (inner.isSymbolicLink()) continue;
        if (!inner.isFile()) continue;
        await ingestFile(subDir, nodeId, inner.name, [d.name, inner.name]);
      }
    }
  };

  const ingestFile = async (
    fileDir: string,
    nodeId: string,
    fileName: string,
    relSegments: string[],
  ): Promise<void> => {
    const absPath = join(fileDir, fileName);
    // Per-file relPath is relative to the flow folder. Always forward-slash
    // separated so the wire payload is platform-neutral.
    const relPath = `nodes/${nodeId}/${relSegments.join('/')}`;
    let size = 0;
    let etag = '';
    try {
      const st = await stat(absPath);
      size = st.size;
    } catch {
      return;
    }
    try {
      const bytes = await readFile(absPath);
      etag = etagFromBytes(bytes);
    } catch {
      return;
    }
    entries.set(absPath, { nodeId, relPath, size, etag });
  };

  return {
    async init() {
      entries.clear();
      for (const entry of deps.registry.list()) {
        const flowBase = flowBaseAbs(entry.repoPath, entry.flowPath);
        const nodesRoot = join(flowBase, 'nodes');
        let nodeDirs: Dirent[];
        try {
          nodeDirs = await readdir(nodesRoot);
        } catch {
          continue;
        }
        for (const d of nodeDirs) {
          if (d.isSymbolicLink()) continue;
          if (!d.isDirectory()) continue;
          if (!NODE_ID_RE.test(d.name)) continue;
          await walkNodeDir(flowBase, d.name);
        }
      }
    },
    build() {
      const all = [...entries.values()].map(
        ({ nodeId, relPath, size, etag }): FilesManifestEntry => ({
          nodeId,
          relPath,
          size,
          etag,
        }),
      );
      if (all.length > MAX_MANIFEST_ENTRIES) {
        console.warn(
          `[share] files-manifest truncated: ${all.length} entries exceeds cap ${MAX_MANIFEST_ENTRIES}`,
        );
        return { entries: all.slice(0, MAX_MANIFEST_ENTRIES) };
      }
      return { entries: all };
    },
    recordFileWritten({ absPath, nodeId, relPath, size, etag }) {
      entries.set(absPath, { nodeId, relPath, size, etag });
    },
    recordFileWrittenFromBytes({ absPath, nodeId, relPath, bytes }) {
      entries.set(absPath, {
        nodeId,
        relPath,
        size: bytes.byteLength,
        etag: etagFromBytes(bytes),
      });
    },
    recordNodeRemoved(nodeDirAbsPath) {
      // Match either the directory itself or anything strictly under it. A
      // bare prefix check would falsely match a sibling directory whose name
      // starts with `nodeDirAbsPath` (e.g. `/a/node-x` vs `/a/node-xx-data`).
      const prefix = nodeDirAbsPath.endsWith(pathSep) ? nodeDirAbsPath : nodeDirAbsPath + pathSep;
      for (const key of entries.keys()) {
        if (key === nodeDirAbsPath || key.startsWith(prefix)) entries.delete(key);
      }
    },
    size() {
      return entries.size;
    },
  };
}
