/**
 * Per-session JSONL audit log for inbound share frames.
 *
 * One file per session at `${opts.dir}/${opts.sessionId}.jsonl`. Each accepted
 * or rejected envelope writes one JSON.stringify(entry) + '\n' line via
 * `fs.appendFileSync` (or an injected appender for tests). The directory is
 * created with mkdirSync recursive on first write.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Envelope } from './share-envelope.ts';

export type AuditVerdict = 'accept' | 'reject';

/**
 * Per-frame audit entry written by the WS message dispatcher. Coexists with
 * `RpcAuditEntry`, `FileUploadAuditEntry`, and `AuditEntry` (the US-078 shape)
 * on the same JSONL file; readers should treat each line as the union.
 */
export interface FrameAuditEntry {
  ts: number;
  peerId: string;
  displayName: string;
  type: Envelope['type'];
  verdict: AuditVerdict;
  reason?: string;
}

export interface AuditLog {
  append(entry: FrameAuditEntry): void;
  close(): Promise<void>;
}

export interface AuditLogOpts {
  dir: string;
  sessionId: string;
  // Injected for tests so we don't need a tmp dir. Default uses fs.appendFileSync.
  appendFn?: (filePath: string, line: string) => void;
  // Injected for tests so we don't need to mkdir on disk. Default uses fs.mkdirSync.
  mkdirFn?: (dir: string) => void;
}

const defaultAppend = (filePath: string, line: string): void => {
  appendFileSync(filePath, line);
};

const defaultMkdir = (dir: string): void => {
  mkdirSync(dir, { recursive: true });
};

/**
 * RPC-specific audit entry shape. Used by US-038's `handleRpcFrame` after a
 * dispatch attempt — written via `appendShareAudit` to the same per-session
 * JSONL file `createAuditLog` writes to, so the two entry shapes coexist as a
 * union on disk (callers reading the file should treat each line as
 * `AuditEntry | RpcAuditEntry`).
 */
export interface RpcAuditEntry {
  ts: number;
  peerId: string;
  op: string;
  flowId: string;
  ok: boolean;
  reason?: string;
  // Mirrors the `attributedTo` field on the outgoing `node-patched` broadcast
  // so the audit trail records the same originator label peers will see. For
  // peer-originated rpcs this is `{ peerId, displayName }` from the share
  // controller's peer map; for host-local edits it is
  // `{ peerId: 'host', displayName: hostDisplayName }`.
  attributedTo?: { peerId: string; displayName: string };
}

export interface AppendShareAuditOpts {
  // Override the default `~/.seeflow/share-history` root. Tests inject a
  // tmpdir so they never touch the user's real audit dir.
  dir?: string;
  appendFn?: (filePath: string, line: string) => void;
  mkdirFn?: (dir: string) => void;
}

const isSafeSessionId = (sessionId: string): boolean => {
  if (sessionId.length === 0) return false;
  if (sessionId === '.' || sessionId === '..') return false;
  if (sessionId.includes('/') || sessionId.includes('\\')) return false;
  if (sessionId.includes('\0')) return false;
  return true;
};

/**
 * File-upload audit entry. Mirrors the design doc shape:
 * `{ peerId, op:'file-upload', nodeId, filename, size, sha256, ts, accept }`.
 * Coexists with `RpcAuditEntry` + `AuditEntry` on the same JSONL file; readers
 * should treat each line as the union.
 */
export interface FileUploadAuditEntry {
  ts: number;
  peerId: string;
  op: 'file-upload';
  nodeId: string;
  filename: string;
  size: number;
  sha256: string;
  accept: boolean;
  reason?: string;
}

/**
 * Append one JSON line to `<dir>/<sessionId>.jsonl`. The directory is created
 * recursively on first write. Rejects sessionIds that contain path separators,
 * NUL bytes, or `..` traversal attempts so a tampered peer can't drop frames
 * outside the audit root.
 */
export function appendShareAudit(
  sessionId: string,
  entry: RpcAuditEntry | FileUploadAuditEntry,
  opts: AppendShareAuditOpts = {},
): void {
  if (!isSafeSessionId(sessionId)) {
    throw new Error(`invalid sessionId: ${JSON.stringify(sessionId)}`);
  }
  const dir = opts.dir ?? join(homedir(), '.seeflow', 'share-history');
  const appendFn = opts.appendFn ?? defaultAppend;
  const mkdirFn = opts.mkdirFn ?? defaultMkdir;
  mkdirFn(dir);
  const filePath = join(dir, `${sessionId}.jsonl`);
  appendFn(filePath, `${JSON.stringify(entry)}\n`);
}

export function createAuditLog(opts: AuditLogOpts): AuditLog {
  const appendFn = opts.appendFn ?? defaultAppend;
  const mkdirFn = opts.mkdirFn ?? defaultMkdir;
  const filePath = join(opts.dir, `${opts.sessionId}.jsonl`);
  let dirReady = false;

  return {
    append(entry) {
      if (!dirReady) {
        mkdirFn(opts.dir);
        dirReady = true;
      }
      appendFn(filePath, `${JSON.stringify(entry)}\n`);
    },
    async close() {
      // No buffered writes — appendFileSync is synchronous. Hook here for any
      // future flush logic.
    },
  };
}

/**
 * Phase-8 audit shape covering RPCs, kicks, rotations, the kill-switch, plus
 * host start/stop and peer join/leave. Coexists on disk with `FrameAuditEntry`,
 * `RpcAuditEntry`, and `FileUploadAuditEntry` — readers should tolerate the
 * union per-line.
 */
export type AuditKind =
  | 'rpc-accept'
  | 'rpc-reject'
  | 'kick'
  | 'rotate'
  | 'kill-switch'
  | 'host-start'
  | 'host-stop'
  | 'peer-join'
  | 'peer-leave';

export interface AuditEntry {
  ts: number;
  peerId: string | null;
  displayName: string | null;
  kind: AuditKind;
  op?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface AuditLogger {
  append(entry: Omit<AuditEntry, 'ts'>): Promise<void>;
  list(opts?: {
    limit?: number;
    cursor?: number;
  }): Promise<{ entries: AuditEntry[]; nextCursor: number | null }>;
  close(): Promise<void>;
}

const auditLockChains = new Map<string, Promise<void>>();

const defaultRoot = (): string => join(homedir(), '.seeflow', 'share-history');

/**
 * Build a per-session audit logger backed by `${root}/${sessionId}.jsonl`.
 * `append` serializes inside-process per file so 10+ concurrent callers can't
 * interleave partial lines; the kernel-level O_APPEND on `fs.appendFile` keeps
 * cross-process writes safe up to PIPE_BUF. `list` paginates by byte offset so
 * callers can resume from `nextCursor` without re-parsing what they've seen.
 */
export function createAuditLogger(sessionId: string, root?: string): AuditLogger {
  if (!isSafeSessionId(sessionId)) {
    throw new Error(`invalid sessionId: ${JSON.stringify(sessionId)}`);
  }
  const dir = root ?? defaultRoot();
  const filePath = join(dir, `${sessionId}.jsonl`);
  let dirReady = false;

  const ensureDir = async (): Promise<void> => {
    if (dirReady) return;
    await mkdir(dir, { recursive: true });
    dirReady = true;
  };

  const append = async (entry: Omit<AuditEntry, 'ts'>): Promise<void> => {
    await ensureDir();
    const full: AuditEntry = { ...entry, ts: Date.now() };
    const line = `${JSON.stringify(full)}\n`;
    const prev = auditLockChains.get(filePath) ?? Promise.resolve();
    const task = prev.then(() => appendFile(filePath, line));
    auditLockChains.set(
      filePath,
      task.then(
        () => undefined,
        () => undefined,
      ),
    );
    await task;
  };

  const list = async (
    opts: { limit?: number; cursor?: number } = {},
  ): Promise<{ entries: AuditEntry[]; nextCursor: number | null }> => {
    const limit = opts.limit ?? 200;
    const cursor = opts.cursor ?? 0;
    let buf: Buffer;
    try {
      buf = await readFile(filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { entries: [], nextCursor: null };
      throw err;
    }
    const entries: AuditEntry[] = [];
    let offset = cursor < 0 ? 0 : cursor;
    while (offset < buf.length && entries.length < limit) {
      const nl = buf.indexOf(0x0a, offset);
      if (nl === -1) break;
      const line = buf.subarray(offset, nl).toString('utf8');
      offset = nl + 1;
      if (line.length === 0) continue;
      try {
        entries.push(JSON.parse(line) as AuditEntry);
      } catch {
        // Skip corrupted line; advance past it so list() stays monotonic.
      }
    }
    const nextCursor = offset >= buf.length ? null : offset;
    return { entries, nextCursor };
  };

  const close = async (): Promise<void> => {
    const chain = auditLockChains.get(filePath);
    if (chain) await chain;
  };

  return { append, list, close };
}
