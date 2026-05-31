/**
 * Per-session JSONL audit log for inbound share frames.
 *
 * One file per session at `${opts.dir}/${opts.sessionId}.jsonl`. Each accepted
 * or rejected envelope writes one JSON.stringify(entry) + '\n' line via
 * `fs.appendFileSync` (or an injected appender for tests). The directory is
 * created with mkdirSync recursive on first write.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
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
