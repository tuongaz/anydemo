import { describe, expect, it } from 'bun:test';
import {
  COALESCE_WINDOW_MS,
  MAX_HISTORY,
  STALE_MUTATION_WINDOW_MS,
  type UndoEntry,
  type UndoStackState,
  applyClear,
  applyDropTop,
  applyPush,
  applyRedo,
  applyStaleClear,
  applyUndo,
} from '@/hooks/use-undo-stack';

const noop = async () => {};

const entry = (overrides: Partial<UndoEntry> = {}): UndoEntry => ({
  do: noop,
  undo: noop,
  capturedAt: 0,
  ...overrides,
});

const initial: UndoStackState = { stack: [], cursor: 0 };

describe('constants', () => {
  it('MAX_HISTORY = 500', () => {
    expect(MAX_HISTORY).toBe(500);
  });

  it('COALESCE_WINDOW_MS = 500', () => {
    expect(COALESCE_WINDOW_MS).toBe(500);
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

  it('coalesces within the window: replaces top do, keeps original undo, cursor unchanged', () => {
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

  it('does NOT coalesce after the window expires (pushes a new entry instead)', () => {
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

  it('preserves the OLDEST undo when coalescing (merged-snapshot semantics)', () => {
    // Two coalesced pushes with the same key should merge `do` to the latest but
    // keep `undo` from the first push so the gesture reverts to the pre-burst
    // state.
    const undos: string[] = [];
    const e1 = entry({
      coalesceKey: 'k',
      undo: async () => {
        undos.push('first-undo');
      },
      do: async () => {},
    });
    const e2 = entry({
      coalesceKey: 'k',
      undo: async () => {
        undos.push('second-undo');
      },
      do: async () => {},
    });
    let s = applyPush(initial, e1, { now: 100 });
    s = applyPush(s, e2, { now: 200 }); // within COALESCE_WINDOW_MS
    expect(s.stack.length).toBe(1);
    expect(s.cursor).toBe(1);
    // The kept undo MUST be the first one (pre-burst state).
    return s.stack[0]!.undo().then(() => {
      expect(undos).toEqual(['first-undo']);
    });
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
  it('reverts an optimistic push: removes the top entry and decrements cursor', () => {
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

// US-013: a "group action" (multi-node move, multi-node style, multi-node
// delete, multi-node paste) must produce EXACTLY ONE entry on the undo stack.
// The batch shape is a single `pushUndo` call whose `do`/`undo` fan out across
// every target — so the contract reduces to "one applyPush call, one stack
// entry", regardless of how many targets the entry touches at run time.
describe('group action — single undo entry contract (US-013)', () => {
  it('one batched push for N targets produces stack.length === 1, cursor === 1', () => {
    const targets = [
      { id: 'n-a', prev: { x: 0, y: 0 }, next: { x: 100, y: 100 } },
      { id: 'n-b', prev: { x: 50, y: 50 }, next: { x: 150, y: 150 } },
      { id: 'n-c', prev: { x: 200, y: 0 }, next: { x: 300, y: 100 } },
    ];
    const doCallsRef: { count: number } = { count: 0 };
    const undoCallsRef: { count: number } = { count: 0 };
    const batchEntry: UndoEntry = {
      do: async () => {
        // Real consumer fan-outs N PATCHes; the test counts the calls so the
        // batch's undo does N reverts — not 1.
        await Promise.allSettled(targets.map(async () => doCallsRef.count++));
      },
      undo: async () => {
        await Promise.allSettled(targets.map(async () => undoCallsRef.count++));
      },
      capturedAt: 0,
    };

    const s1 = applyPush(initial, batchEntry, { now: 1 });
    expect(s1.stack.length).toBe(1);
    expect(s1.cursor).toBe(1);

    // Compare against the legacy per-target behavior: N pushes → N entries.
    let legacy = initial;
    for (const t of targets) {
      legacy = applyPush(legacy, entry({ capturedAt: t.prev.x }), { now: t.prev.x + 1 });
    }
    expect(legacy.stack.length).toBe(targets.length);
    expect(legacy.cursor).toBe(targets.length);
  });

  it('a single undo of a batch entry is enough to revert every target (one-step revert)', async () => {
    const reverts: string[] = [];
    const targets = ['n-a', 'n-b', 'n-c'];
    const batchEntry: UndoEntry = {
      do: async () => {},
      undo: async () => {
        await Promise.allSettled(
          targets.map(async (id) => {
            reverts.push(id);
          }),
        );
      },
      capturedAt: 0,
    };

    const pushed = applyPush(initial, batchEntry, { now: 1 });
    const popped = applyUndo(pushed);
    expect(popped.entry).toBeDefined();
    // The caller runs the popped entry's undo() — that's where the fan-out
    // happens. After ONE undo call, every target is reverted.
    if (popped.entry) await popped.entry.undo();
    expect(reverts.sort()).toEqual([...targets].sort());
    // Cursor moved by exactly one step.
    expect(popped.state.cursor).toBe(0);
    expect(popped.state.stack.length).toBe(1);
  });

  it('redo of a batch entry replays every target (one-step replay)', async () => {
    const replays: string[] = [];
    const targets = ['n-a', 'n-b'];
    const batchEntry: UndoEntry = {
      do: async () => {
        await Promise.allSettled(
          targets.map(async (id) => {
            replays.push(id);
          }),
        );
      },
      undo: async () => {},
      capturedAt: 0,
    };

    const pushed = applyPush(initial, batchEntry, { now: 1 });
    const undone = applyUndo(pushed).state;
    const r = applyRedo(undone);
    expect(r.entry).toBeDefined();
    if (r.entry) await r.entry.do();
    expect(replays.sort()).toEqual([...targets].sort());
    expect(r.state.cursor).toBe(1);
  });

  it('single-target operations remain a single entry (no regression)', () => {
    const single = applyPush(initial, entry({ capturedAt: 1 }), { now: 1 });
    expect(single.stack.length).toBe(1);
    expect(single.cursor).toBe(1);
  });
});

describe('applyStaleClear', () => {
  it('STALE_MUTATION_WINDOW_MS = 2000', () => {
    expect(STALE_MUTATION_WINDOW_MS).toBe(2000);
  });

  it('clears the stack when the gap exceeds the window (push then >2000ms later → cleared)', () => {
    // Simulate a UI mutation at t=1000 that pushed an entry, followed by an
    // external file change observed at t=4000 (gap = 3000ms > window).
    const pushed = applyPush(initial, entry({ capturedAt: 1000 }), { now: 1000 });
    expect(pushed.stack.length).toBe(1);
    const next = applyStaleClear(pushed, /* lastMutationAt */ 1000, /* now */ 4000);
    expect(next.stack).toEqual([]);
    expect(next.cursor).toBe(0);
  });

  it('survives when checked immediately (push then check at same instant → unchanged)', () => {
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
