import { describe, expect, it } from 'bun:test';
import { type NodeStatuses, applyNodeStatus } from '@/hooks/use-node-statuses';

const empty: NodeStatuses = {};

describe('applyNodeStatus', () => {
  it('writes the entry for a valid node:status event', () => {
    const next = applyNodeStatus(empty, {
      type: 'node:status',
      nodeId: 'n1',
      state: 'ok',
      summary: 's',
      detail: 'd',
      data: { a: 1 },
      ts: 123,
    });
    expect(next.n1).toEqual({
      state: 'ok',
      summary: 's',
      detail: 'd',
      data: { a: 1 },
      ts: 123,
    });
  });

  it('falls back to Date.now() when the event has no ts', () => {
    const before = Date.now();
    const next = applyNodeStatus(empty, { type: 'node:status', nodeId: 'n1', state: 'pending' });
    const after = Date.now();
    const entry = next.n1;
    if (!entry) throw new Error('expected entry for n1');
    expect(entry.ts).toBeGreaterThanOrEqual(before);
    expect(entry.ts).toBeLessThanOrEqual(after);
  });

  it('later event for the same nodeId overwrites the earlier entry', () => {
    const first = applyNodeStatus(empty, {
      type: 'node:status',
      nodeId: 'n1',
      state: 'pending',
      summary: 'p',
      ts: 1,
    });
    const second = applyNodeStatus(first, {
      type: 'node:status',
      nodeId: 'n1',
      state: 'ok',
      summary: 'o',
      ts: 2,
    });
    expect(second.n1).toEqual({
      state: 'ok',
      summary: 'o',
      detail: undefined,
      data: undefined,
      ts: 2,
    });
  });

  it('keeps separate entries per nodeId', () => {
    const s1 = applyNodeStatus(empty, {
      type: 'node:status',
      nodeId: 'a',
      state: 'ok',
      ts: 1,
    });
    const s2 = applyNodeStatus(s1, {
      type: 'node:status',
      nodeId: 'b',
      state: 'error',
      ts: 2,
    });
    expect(Object.keys(s2).sort()).toEqual(['a', 'b']);
    expect(s2.a?.state).toBe('ok');
    expect(s2.b?.state).toBe('error');
  });

  it('returns the same reference for non-node:status events', () => {
    const prev: NodeStatuses = { n1: { state: 'ok', ts: 1 } };
    expect(applyNodeStatus(prev, { type: 'node:running', nodeId: 'n1' })).toBe(prev);
    expect(applyNodeStatus(prev, { type: 'node:done', nodeId: 'n1' })).toBe(prev);
    expect(applyNodeStatus(prev, { type: 'flow:reload' })).toBe(prev);
  });

  it('ignores events with missing nodeId or invalid state', () => {
    expect(applyNodeStatus(empty, { type: 'node:status', state: 'ok' })).toBe(empty);
    expect(applyNodeStatus(empty, { type: 'node:status', nodeId: 'n1', state: 'invalid' })).toBe(
      empty,
    );
    expect(applyNodeStatus(empty, { type: 'node:status', nodeId: 'n1' })).toBe(empty);
    expect(applyNodeStatus(empty, { type: 'node:status', nodeId: 42, state: 'ok' })).toBe(empty);
  });

  it('drops non-object data fields (arrays, strings, numbers)', () => {
    const next = applyNodeStatus(empty, {
      type: 'node:status',
      nodeId: 'n1',
      state: 'ok',
      data: [1, 2, 3],
      ts: 1,
    });
    expect(next.n1?.data).toBeUndefined();

    const next2 = applyNodeStatus(empty, {
      type: 'node:status',
      nodeId: 'n1',
      state: 'ok',
      data: 'not-an-object',
      ts: 1,
    });
    expect(next2.n1?.data).toBeUndefined();
  });

  it('accepts all four valid states (ok / warn / error / pending)', () => {
    for (const state of ['ok', 'warn', 'error', 'pending'] as const) {
      const next = applyNodeStatus(empty, {
        type: 'node:status',
        nodeId: 'n1',
        state,
        ts: 1,
      });
      expect(next.n1?.state).toBe(state);
    }
  });
});
