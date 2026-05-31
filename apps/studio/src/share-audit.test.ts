import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RpcAuditEntry, appendShareAudit, createAuditLog } from './share-audit.ts';

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

describe('appendShareAudit', () => {
  let dir: string;
  const sample: RpcAuditEntry = {
    ts: 1700000000000,
    peerId: 'peer-1',
    op: 'moveNode',
    flowId: 'flow-a',
    ok: true,
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'share-audit-rpc-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the file if missing', () => {
    const filePath = join(dir, 'sess-1.jsonl');
    expect(existsSync(filePath)).toBe(false);
    appendShareAudit('sess-1', sample, { dir });
    expect(existsSync(filePath)).toBe(true);
  });

  it('appends one JSON line per call', () => {
    appendShareAudit('sess-2', sample, { dir });
    appendShareAudit(
      'sess-2',
      { ...sample, ts: sample.ts + 1, ok: false, reason: 'notFound' },
      { dir },
    );
    const raw = readFileSync(join(dir, 'sess-2.jsonl'), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '')).toEqual(sample);
    expect(JSON.parse(lines[1] ?? '')).toEqual({
      ts: sample.ts + 1,
      peerId: 'peer-1',
      op: 'moveNode',
      flowId: 'flow-a',
      ok: false,
      reason: 'notFound',
    });
  });

  it('each line round-trips through JSON.parse', () => {
    appendShareAudit('sess-3', sample, { dir });
    const raw = readFileSync(join(dir, 'sess-3.jsonl'), 'utf8');
    expect(JSON.parse(raw.trimEnd())).toEqual(sample);
  });

  it('creates the audit directory recursively if missing', () => {
    const nested = join(dir, 'a', 'b', 'c');
    expect(existsSync(nested)).toBe(false);
    appendShareAudit('sess-4', sample, { dir: nested });
    expect(existsSync(join(nested, 'sess-4.jsonl'))).toBe(true);
  });

  it('uses injected appender and mkdir when provided', () => {
    const calls: Array<{ filePath: string; line: string }> = [];
    appendShareAudit('sess-5', sample, {
      dir,
      appendFn: (filePath, line) => calls.push({ filePath, line }),
      mkdirFn: () => {},
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.filePath.endsWith('sess-5.jsonl')).toBe(true);
    expect(calls[0]?.line.endsWith('\n')).toBe(true);
  });

  it('rejects sessionId with parent-dir traversal', () => {
    expect(() => appendShareAudit('../../etc/passwd', sample, { dir })).toThrow(
      /invalid sessionId/,
    );
  });

  it('rejects sessionId with embedded path separators', () => {
    expect(() => appendShareAudit('sub/leaf', sample, { dir })).toThrow(/invalid sessionId/);
    expect(() => appendShareAudit('sub\\leaf', sample, { dir })).toThrow(/invalid sessionId/);
  });

  it('rejects empty, ".", and ".." sessionIds', () => {
    expect(() => appendShareAudit('', sample, { dir })).toThrow(/invalid sessionId/);
    expect(() => appendShareAudit('.', sample, { dir })).toThrow(/invalid sessionId/);
    expect(() => appendShareAudit('..', sample, { dir })).toThrow(/invalid sessionId/);
  });
});
