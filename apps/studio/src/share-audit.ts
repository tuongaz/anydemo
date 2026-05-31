/**
 * Per-session JSONL audit log for inbound share frames.
 *
 * One file per session at `${opts.dir}/${opts.sessionId}.jsonl`. Each accepted
 * or rejected envelope writes one JSON.stringify(entry) + '\n' line via
 * `fs.appendFileSync` (or an injected appender for tests). The directory is
 * created with mkdirSync recursive on first write.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Envelope } from './share-envelope.ts';

export type AuditVerdict = 'accept' | 'reject';

export interface AuditEntry {
  ts: number;
  peerId: string;
  displayName: string;
  type: Envelope['type'];
  verdict: AuditVerdict;
  reason?: string;
}

export interface AuditLog {
  append(entry: AuditEntry): void;
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
 * Append one JSON line to `<dir>/<sessionId>.jsonl`. The directory is created
 * recursively on first write. Rejects sessionIds that contain path separators,
 * NUL bytes, or `..` traversal attempts so a tampered peer can't drop frames
 * outside the audit root.
 */
export function appendShareAudit(
  sessionId: string,
  entry: RpcAuditEntry,
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
