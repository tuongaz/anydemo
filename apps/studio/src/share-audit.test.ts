import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type RpcAuditEntry,
  appendShareAudit,
  createAuditLog,
  createAuditLogger,
} from './share-audit.ts';

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

describe('createAuditLogger', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'share-audit-logger-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('append writes one JSON line per call with ts auto-stamped', async () => {
    const log = createAuditLogger('sess-a', dir);
    const before = Date.now();
    await log.append({ peerId: 'p1', displayName: 'Ada', kind: 'rpc-accept', op: 'moveNode' });
    await log.append({
      peerId: 'p1',
      displayName: 'Ada',
      kind: 'rpc-reject',
      op: 'moveNode',
      reason: 'rate-limited',
    });
    const after = Date.now();
    await log.close();

    const raw = readFileSync(join(dir, 'sess-a.jsonl'), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    const parsed0 = JSON.parse(lines[0] ?? '');
    const parsed1 = JSON.parse(lines[1] ?? '');
    expect(parsed0.kind).toBe('rpc-accept');
    expect(parsed1.kind).toBe('rpc-reject');
    expect(parsed1.reason).toBe('rate-limited');
    expect(parsed0.ts).toBeGreaterThanOrEqual(before);
    expect(parsed0.ts).toBeLessThanOrEqual(after);
  });

  it('creates the audit directory recursively on first append', async () => {
    const nested = join(dir, 'a', 'b', 'c');
    expect(existsSync(nested)).toBe(false);
    const log = createAuditLogger('sess-b', nested);
    await log.append({ peerId: null, displayName: null, kind: 'host-start' });
    await log.close();
    expect(existsSync(join(nested, 'sess-b.jsonl'))).toBe(true);
  });

  it('list returns empty + nextCursor:null when file is missing', async () => {
    const log = createAuditLogger('sess-missing', dir);
    const result = await log.list();
    expect(result).toEqual({ entries: [], nextCursor: null });
  });

  it('list paginates 1000 appends by byte offset', async () => {
    const log = createAuditLogger('sess-page', dir);
    for (let i = 0; i < 1000; i++) {
      await log.append({
        peerId: `p${i}`,
        displayName: `Peer ${i}`,
        kind: 'rpc-accept',
        op: 'moveNode',
        details: { i },
      });
    }
    await log.close();

    const collected: number[] = [];
    let cursor: number | null = 0;
    let pages = 0;
    while (cursor !== null) {
      const page: { entries: Array<{ details?: { i?: number } }>; nextCursor: number | null } =
        await log.list({ limit: 200, cursor });
      pages++;
      for (const entry of page.entries) {
        const i = entry.details?.i;
        if (typeof i === 'number') collected.push(i);
      }
      cursor = page.nextCursor;
      if (pages > 10) break;
    }
    expect(collected).toHaveLength(1000);
    expect(collected[0]).toBe(0);
    expect(collected[999]).toBe(999);
    expect(pages).toBe(5);
  });

  it('list defaults limit to 200', async () => {
    const log = createAuditLogger('sess-limit', dir);
    for (let i = 0; i < 250; i++) {
      await log.append({ peerId: null, displayName: null, kind: 'host-start' });
    }
    await log.close();
    const first = await log.list();
    expect(first.entries).toHaveLength(200);
    expect(first.nextCursor).not.toBeNull();
  });

  it('concurrent appends from 10 parallel promises preserve all entries', async () => {
    const log = createAuditLogger('sess-concur', dir);
    const tasks: Array<Promise<void>> = [];
    for (let i = 0; i < 10; i++) {
      tasks.push(
        (async () => {
          for (let j = 0; j < 20; j++) {
            await log.append({
              peerId: `p${i}`,
              displayName: `Peer ${i}`,
              kind: 'rpc-accept',
              op: 'moveNode',
              details: { worker: i, n: j },
            });
          }
        })(),
      );
    }
    await Promise.all(tasks);
    await log.close();

    const raw = readFileSync(join(dir, 'sess-concur.jsonl'), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    expect(lines).toHaveLength(200);
    // Every line must be valid JSON with no partial-line corruption.
    const counts = new Map<string, number>();
    for (const line of lines) {
      const parsed = JSON.parse(line);
      const key = `${parsed.details.worker}:${parsed.details.n}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(200);
    for (const c of counts.values()) expect(c).toBe(1);
  });

  it('rejects unsafe sessionIds', () => {
    expect(() => createAuditLogger('../etc', dir)).toThrow(/invalid sessionId/);
    expect(() => createAuditLogger('sub/leaf', dir)).toThrow(/invalid sessionId/);
    expect(() => createAuditLogger('', dir)).toThrow(/invalid sessionId/);
  });
});
