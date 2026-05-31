import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuditLog } from './share-audit.ts';

describe('createAuditLog', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'share-audit-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes one JSON line per append', () => {
    const log = createAuditLog({ dir, sessionId: 'sess-1' });
    log.append({
      ts: 1,
      peerId: 'p1',
      displayName: 'Ada',
      type: 'rpc',
      verdict: 'accept',
    });
    log.append({
      ts: 2,
      peerId: 'p1',
      displayName: 'Ada',
      type: 'rpc',
      verdict: 'reject',
      reason: 'rate-limited',
    });

    const raw = readFileSync(join(dir, 'sess-1.jsonl'), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      ts: 1,
      peerId: 'p1',
      displayName: 'Ada',
      type: 'rpc',
      verdict: 'accept',
    });
    expect(JSON.parse(lines[1] ?? '')).toEqual({
      ts: 2,
      peerId: 'p1',
      displayName: 'Ada',
      type: 'rpc',
      verdict: 'reject',
      reason: 'rate-limited',
    });
  });

  it('creates the directory recursively if it does not yet exist', () => {
    const nested = join(dir, 'a', 'b', 'c');
    expect(existsSync(nested)).toBe(false);
    const log = createAuditLog({ dir: nested, sessionId: 'sess-2' });
    log.append({
      ts: 1,
      peerId: 'p1',
      displayName: 'Ada',
      type: 'presence',
      verdict: 'accept',
    });
    expect(existsSync(join(nested, 'sess-2.jsonl'))).toBe(true);
  });

  it('entries round-trip through JSON.parse', () => {
    const entry = {
      ts: 1700000000000,
      peerId: 'peer-42',
      displayName: 'Ada Lovelace',
      type: 'sse' as const,
      verdict: 'accept' as const,
    };
    const log = createAuditLog({ dir, sessionId: 'sess-3' });
    log.append(entry);

    const raw = readFileSync(join(dir, 'sess-3.jsonl'), 'utf8');
    const parsed = JSON.parse(raw.trimEnd());
    expect(parsed).toEqual(entry);
  });

  it('uses an injected appender when provided', () => {
    const calls: Array<{ filePath: string; line: string }> = [];
    const log = createAuditLog({
      dir,
      sessionId: 'sess-4',
      appendFn: (filePath, line) => {
        calls.push({ filePath, line });
      },
      mkdirFn: () => {},
    });
    log.append({
      ts: 1,
      peerId: 'p1',
      displayName: 'Ada',
      type: 'rpc',
      verdict: 'accept',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.filePath.endsWith('sess-4.jsonl')).toBe(true);
    expect(calls[0]?.line.endsWith('\n')).toBe(true);
  });
});
