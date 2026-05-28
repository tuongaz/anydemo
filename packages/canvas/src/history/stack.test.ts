import { describe, expect, it } from 'bun:test';
import {
  applyClear,
  applyDropRedoBranch,
  applyDropTop,
  applyPush,
  applyRedo,
  applyStaleClear,
  applyUndo,
} from './stack.ts';
import {
  COALESCE_WINDOW_MS,
  type HistoryEntry,
  type HistoryState,
  MAX_HISTORY,
  STALE_MUTATION_WINDOW_MS,
} from './types.ts';

const noop = async () => {};

const entry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  do: noop,
  undo: noop,
  capturedAt: 0,
  ...overrides,
});

const initial: HistoryState = { stack: [], cursor: 0 };

describe('constants', () => {
  it('MAX_HISTORY = 500', () => {
    expect(MAX_HISTORY).toBe(500);
  });

  it('COALESCE_WINDOW_MS = 500', () => {
    expect(COALESCE_WINDOW_MS).toBe(500);
  });

  it('STALE_MUTATION_WINDOW_MS = 2000', () => {
    expect(STALE_MUTATION_WINDOW_MS).toBe(2000);
  });
});

describe('applyPush', () => {
  it('grows the stack and advances the cursor', () => {
    const next = applyPush(initial, entry(), { now: 1 });
    expect(next.stack.length).toBe(1);
    expect(next.cursor).toBe(1);
    expect(next.stack[0]?.capturedAt).toBe(1);
  });

  it('truncates the redo branch before appending', () => {
    let s = applyPush(initial, entry(), { now: 1 });
    s = applyPush(s, entry(), { now: 2 });
    expect(s.stack.length).toBe(2);
    expect(s.cursor).toBe(2);

    const undone = applyUndo(s);
    s = undone.state;
    expect(s.cursor).toBe(1);

    s = applyPush(s, entry({ capturedAt: 3 }), { now: 3 });
    // Redo branch was dropped, then the new entry appended.
    expect(s.stack.length).toBe(2);
    expect(s.cursor).toBe(2);
    expect(s.stack[1]?.capturedAt).toBe(3);
  });

  it('drops the oldest entry when capacity is exceeded', () => {
    let s = initial;
    for (let i = 0; i < 5; i++) {
      s = applyPush(s, entry({ capturedAt: i }), { now: i, max: 3 });
    }
    expect(s.stack.length).toBe(3);
    expect(s.cursor).toBe(3);
    expect(s.stack[0]?.capturedAt).toBe(2);
    expect(s.stack[2]?.capturedAt).toBe(4);
  });

  it('respects MAX_HISTORY when no max override is provided', () => {
    let s = initial;
    for (let i = 0; i < MAX_HISTORY + 10; i++) {
      s = applyPush(s, entry({ capturedAt: i }), { now: i });
    }
    expect(s.stack.length).toBe(MAX_HISTORY);
    expect(s.cursor).toBe(MAX_HISTORY);
    // The first 10 entries (capturedAt 0..9) should have been dropped.
    expect(s.stack[0]?.capturedAt).toBe(10);
    expect(s.stack[MAX_HISTORY - 1]?.capturedAt).toBe(MAX_HISTORY + 9);
  });

  it('coalesces within the window: replaces top do, keeps OLDEST undo, cursor unchanged', () => {
    const undoA = async () => {};
    const doA = async () => {};
    const doB = async () => {};

    const s1 = applyPush(
      initial,
      entry({ do: doA, undo: undoA, coalesceKey: 'k', capturedAt: 1 }),
      { now: 1 },
    );
    expect(s1.stack[0]?.do).toBe(doA);
    expect(s1.stack[0]?.undo).toBe(undoA);

    const s2 = applyPush(
      s1,
      entry({ do: doB, undo: async () => {}, coalesceKey: 'k', capturedAt: 101 }),
      { now: 101 },
    );

    expect(s2.stack.length).toBe(1);
    expect(s2.cursor).toBe(1);
    expect(s2.stack[0]?.do).toBe(doB);
    expect(s2.stack[0]?.undo).toBe(undoA);
    expect(s2.stack[0]?.capturedAt).toBe(101);
  });

  it('merges beforeFields field-by-field on coalesce (oldest-per-field wins)', () => {
    // Two coalesced pushes with disjoint beforeFields → both fields survive.
    const e1 = entry({ coalesceKey: 'k', beforeFields: { a: 1 } });
    const e2 = entry({ coalesceKey: 'k', beforeFields: { b: 2 } });
    let s = applyPush(initial, e1, { now: 100 });
    s = applyPush(s, e2, { now: 200 });
    expect(s.stack.length).toBe(1);
    expect(s.stack[0]?.beforeFields).toEqual({ a: 1, b: 2 });
  });

  it('merges beforeFields oldest-per-field across three coalesced pushes', () => {
    // Overlapping fields: oldest value per field wins. Field `a` is set in
    // pushes 1 and 3; the value from push 1 must survive. Field `b` only in
    // push 2. Field `c` only in push 3.
    const e1 = entry({ coalesceKey: 'k', beforeFields: { a: 'oldest-a' } });
    const e2 = entry({ coalesceKey: 'k', beforeFields: { b: 'oldest-b' } });
    const e3 = entry({
      coalesceKey: 'k',
      beforeFields: { a: 'newest-a', c: 'oldest-c' },
    });
    let s = applyPush(initial, e1, { now: 100 });
    s = applyPush(s, e2, { now: 200 });
    s = applyPush(s, e3, { now: 300 });
    expect(s.stack.length).toBe(1);
    expect(s.stack[0]?.beforeFields).toEqual({
      a: 'oldest-a',
      b: 'oldest-b',
      c: 'oldest-c',
    });
  });

  it('leaves beforeFields undefined when neither entry carries one (host-reducer parity)', () => {
    const s1 = applyPush(initial, entry({ coalesceKey: 'k' }), { now: 1 });
    const s2 = applyPush(s1, entry({ coalesceKey: 'k' }), { now: 100 });
    expect(s2.stack.length).toBe(1);
    expect(s2.stack[0]?.beforeFields).toBeUndefined();
  });

  it('does NOT coalesce after the window expires', () => {
    const s1 = applyPush(initial, entry({ coalesceKey: 'k' }), { now: 0 });
    const s2 = applyPush(s1, entry({ coalesceKey: 'k' }), { now: COALESCE_WINDOW_MS + 1 });
    expect(s2.stack.length).toBe(2);
    expect(s2.cursor).toBe(2);
  });

  it('does NOT coalesce when the keys differ', () => {
    const s1 = applyPush(initial, entry({ coalesceKey: 'a' }), { now: 0 });
    const s2 = applyPush(s1, entry({ coalesceKey: 'b' }), { now: 100 });
    expect(s2.stack.length).toBe(2);
    expect(s2.cursor).toBe(2);
  });

  it('does NOT coalesce when the incoming entry has no key', () => {
    const s1 = applyPush(initial, entry({ coalesceKey: 'a' }), { now: 0 });
    const s2 = applyPush(s1, entry(), { now: 100 });
    expect(s2.stack.length).toBe(2);
  });

  it('does NOT coalesce when the top entry has no key (even if incoming has one)', () => {
    const s1 = applyPush(initial, entry(), { now: 0 });
    const s2 = applyPush(s1, entry({ coalesceKey: 'a' }), { now: 100 });
    expect(s2.stack.length).toBe(2);
  });
});

describe('applyUndo', () => {
  it('decrements cursor and returns the popped entry (without removing it)', () => {
    const s1 = applyPush(initial, entry({ capturedAt: 1 }), { now: 1 });
    const r = applyUndo(s1);
    expect(r.entry?.capturedAt).toBe(1);
    expect(r.state.cursor).toBe(0);
    expect(r.state.stack.length).toBe(1);
  });

  it('returns { state, entry: undefined } when cursor is 0', () => {
    const r = applyUndo(initial);
    expect(r.entry).toBeUndefined();
    expect(r.state).toBe(initial);
  });
});

describe('applyRedo', () => {
  it('increments cursor and returns the entry being replayed', () => {
    let s = applyPush(initial, entry({ capturedAt: 1 }), { now: 1 });
    s = applyUndo(s).state;
    const r = applyRedo(s);
    expect(r.entry?.capturedAt).toBe(1);
    expect(r.state.cursor).toBe(1);
  });

  it('returns { state, entry: undefined } when cursor is at the top of the stack', () => {
    const s1 = applyPush(initial, entry(), { now: 1 });
    const r = applyRedo(s1);
    expect(r.entry).toBeUndefined();
    expect(r.state).toBe(s1);
  });

  it('replays the original do after undo (round-trip cursor matches)', () => {
    const s1 = applyPush(initial, entry({ capturedAt: 1 }), { now: 1 });
    const s2 = applyUndo(s1).state;
    const s3 = applyRedo(s2).state;
    expect(s3.cursor).toBe(1);
    expect(s3.stack.length).toBe(1);
  });
});

describe('applyClear', () => {
  it('returns an empty state with cursor 0', () => {
    const next = applyClear();
    expect(next.stack).toEqual([]);
    expect(next.cursor).toBe(0);
  });
});

describe('applyDropTop', () => {
  it('removes the entry just above the cursor and decrements it', () => {
    const s1 = applyPush(initial, entry({ capturedAt: 1 }), { now: 1 });
    const s2 = applyPush(s1, entry({ capturedAt: 2 }), { now: 2 });
    const next = applyDropTop(s2);
    expect(next.stack.length).toBe(1);
    expect(next.cursor).toBe(1);
    expect(next.stack[0]?.capturedAt).toBe(1);
  });

  it('returns the same reference when cursor is 0', () => {
    const next = applyDropTop(initial);
    expect(next).toBe(initial);
  });
});

describe('applyDropRedoBranch', () => {
  it('returns the same reference when there is no redo branch', () => {
    const s1 = applyPush(initial, entry({ capturedAt: 1 }), { now: 1 });
    const s2 = applyPush(s1, entry({ capturedAt: 2 }), { now: 2 });
    expect(s2.cursor).toBe(s2.stack.length);
    const out = applyDropRedoBranch(s2);
    expect(out).toBe(s2);
  });

  it('truncates the stack to cursor length while leaving the cursor untouched', () => {
    let s = applyPush(initial, entry({ capturedAt: 1 }), { now: 1 });
    s = applyPush(s, entry({ capturedAt: 2 }), { now: 2 });
    s = applyPush(s, entry({ capturedAt: 3 }), { now: 3 });
    // Undo twice → cursor 1, stack length still 3 (redo branch present).
    s = applyUndo(s).state;
    s = applyUndo(s).state;
    expect(s.cursor).toBe(1);
    expect(s.stack.length).toBe(3);

    const out = applyDropRedoBranch(s);
    expect(out.stack.length).toBe(1);
    expect(out.cursor).toBe(1);
    expect(out.stack[0]?.capturedAt).toBe(1);
  });

  it('returns the same reference for an empty state', () => {
    const out = applyDropRedoBranch(initial);
    expect(out).toBe(initial);
  });

  it('after undo + drop, a fresh push lands at cursor position (end-to-end contract)', () => {
    let s = applyPush(initial, entry({ capturedAt: 1 }), { now: 1 });
    s = applyPush(s, entry({ capturedAt: 2 }), { now: 2 });
    s = applyPush(s, entry({ capturedAt: 3 }), { now: 3 });
    // Undo twice → cursor 1, stack still has 3 entries.
    s = applyUndo(s).state;
    s = applyUndo(s).state;
    expect(s.cursor).toBe(1);
    expect(s.stack.length).toBe(3);

    // Synchronously drop the redo branch — mirrors what the wrapper does.
    s = applyDropRedoBranch(s);
    expect(s.cursor).toBe(1);
    expect(s.stack.length).toBe(1);

    // A subsequent push lands at cursor 2, with no leftover redo entries.
    s = applyPush(s, entry({ capturedAt: 99 }), { now: 99 });
    expect(s.cursor).toBe(2);
    expect(s.stack.length).toBe(2);
    expect(s.stack[1]?.capturedAt).toBe(99);
  });
});

describe('applyStaleClear', () => {
  it('clears when the gap exceeds the window (gap > window → cleared)', () => {
    const pushed = applyPush(initial, entry({ capturedAt: 1000 }), { now: 1000 });
    expect(pushed.stack.length).toBe(1);
    const next = applyStaleClear(pushed, /* lastMutationAt */ 1000, /* now */ 4000);
    expect(next.stack).toEqual([]);
    expect(next.cursor).toBe(0);
  });

  it('survives when checked immediately (gap === 0)', () => {
    const pushed = applyPush(initial, entry({ capturedAt: 1000 }), { now: 1000 });
    const next = applyStaleClear(pushed, /* lastMutationAt */ 1000, /* now */ 1000);
    expect(next).toBe(pushed);
  });

  it('survives at the exact boundary (gap === window → not stale)', () => {
    const pushed = applyPush(initial, entry({ capturedAt: 1000 }), { now: 1000 });
    const next = applyStaleClear(
      pushed,
      /* lastMutationAt */ 1000,
      /* now */ 1000 + STALE_MUTATION_WINDOW_MS,
    );
    expect(next).toBe(pushed);
  });

  it('clears one millisecond past the boundary', () => {
    const pushed = applyPush(initial, entry({ capturedAt: 1000 }), { now: 1000 });
    const next = applyStaleClear(
      pushed,
      /* lastMutationAt */ 1000,
      /* now */ 1000 + STALE_MUTATION_WINDOW_MS + 1,
    );
    expect(next.stack).toEqual([]);
    expect(next.cursor).toBe(0);
  });

  it('respects a custom windowMs override', () => {
    const pushed = applyPush(initial, entry({ capturedAt: 0 }), { now: 0 });
    // 100ms gap with a 50ms window → stale.
    const stale = applyStaleClear(pushed, 0, 100, 50);
    expect(stale.stack).toEqual([]);
    // 100ms gap with a 200ms window → fresh.
    const fresh = applyStaleClear(pushed, 0, 100, 200);
    expect(fresh).toBe(pushed);
  });
});
