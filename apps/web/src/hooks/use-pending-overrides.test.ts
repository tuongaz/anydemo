import { describe, expect, it } from 'bun:test';
import {
  type OverrideMap,
  applyDropOverride,
  applyPruneAgainst,
  applySetOverride,
} from '@/hooks/use-pending-overrides';

interface Node {
  id: string;
  position: { x: number; y: number };
  label: string;
}

const node = (id: string, x: number, y: number, label: string): Node => ({
  id,
  position: { x, y },
  label,
});

describe('applySetOverride', () => {
  it('inserts a new override entry when none exists', () => {
    const next = applySetOverride<Node>({}, 'a', { position: { x: 1, y: 2 } });
    expect(next).toEqual({ a: { position: { x: 1, y: 2 } } });
  });

  it('shallow-merges partials so multi-field overrides accumulate', () => {
    const prev: OverrideMap<Node> = { a: { position: { x: 1, y: 2 } } };
    const next = applySetOverride<Node>(prev, 'a', { label: 'hi' });
    expect(next.a).toEqual({ position: { x: 1, y: 2 }, label: 'hi' });
  });

  it('replaces a field on conflicting set (last write wins)', () => {
    const prev: OverrideMap<Node> = { a: { label: 'old' } };
    const next = applySetOverride<Node>(prev, 'a', { label: 'new' });
    expect(next.a).toEqual({ label: 'new' });
  });

  it('returns a new object reference (does not mutate prev)', () => {
    const prev: OverrideMap<Node> = { a: { label: 'x' } };
    const next = applySetOverride<Node>(prev, 'a', { label: 'y' });
    expect(next).not.toBe(prev);
    expect(prev.a?.label).toBe('x');
  });
});

describe('applyDropOverride', () => {
  it('removes the entry for the given id', () => {
    const prev: OverrideMap<Node> = { a: { label: 'x' }, b: { label: 'y' } };
    const next = applyDropOverride<Node>(prev, 'a');
    expect(next).toEqual({ b: { label: 'y' } });
  });

  it('returns the same reference when the id is absent (no spurious renders)', () => {
    const prev: OverrideMap<Node> = { b: { label: 'y' } };
    const next = applyDropOverride<Node>(prev, 'a');
    expect(next).toBe(prev);
  });
});

describe('applyPruneAgainst', () => {
  it('drops a single-field override when the server value matches', () => {
    const prev: OverrideMap<Node> = { a: { position: { x: 5, y: 6 } } };
    const next = applyPruneAgainst<Node>(prev, [node('a', 5, 6, 'hi')]);
    expect(next).toEqual({});
  });

  it('keeps the override when the server value still differs', () => {
    const prev: OverrideMap<Node> = { a: { position: { x: 5, y: 6 } } };
    const next = applyPruneAgainst<Node>(prev, [node('a', 1, 2, 'hi')]);
    expect(next).toEqual(prev);
  });

  it('prunes per-field — drops matched keys but keeps unmatched ones', () => {
    const prev: OverrideMap<Node> = {
      a: { position: { x: 5, y: 6 }, label: 'optimistic' },
    };
    // server caught up on position only.
    const next = applyPruneAgainst<Node>(prev, [node('a', 5, 6, 'old-label')]);
    expect(next).toEqual({ a: { label: 'optimistic' } });
  });

  it('drops the entry entirely when every key matches', () => {
    const prev: OverrideMap<Node> = {
      a: { position: { x: 5, y: 6 }, label: 'caught-up' },
    };
    const next = applyPruneAgainst<Node>(prev, [node('a', 5, 6, 'caught-up')]);
    expect(next).toEqual({});
  });

  it('leaves overrides for missing entities alone (not in snapshot)', () => {
    const prev: OverrideMap<Node> = { ghost: { label: 'still here' } };
    const next = applyPruneAgainst<Node>(prev, [node('a', 1, 2, 'a')]);
    expect(next).toBe(prev);
  });

  it('returns the same reference when nothing changes (referential stability)', () => {
    const prev: OverrideMap<Node> = { a: { label: 'optimistic' } };
    const next = applyPruneAgainst<Node>(prev, [node('a', 1, 2, 'old-label')]);
    expect(next).toBe(prev);
  });

  it('reconciles multiple ids in one pass', () => {
    const prev: OverrideMap<Node> = {
      a: { position: { x: 5, y: 6 } },
      b: { label: 'still-pending' },
    };
    const next = applyPruneAgainst<Node>(prev, [
      node('a', 5, 6, 'a'),
      node('b', 0, 0, 'old-label'),
    ]);
    expect(next).toEqual({ b: { label: 'still-pending' } });
  });

  it('handles deeply-equal nested objects via JSON deep-equal', () => {
    const prev: OverrideMap<Node> = { a: { position: { x: 5, y: 6 } } };
    const next = applyPruneAgainst<Node>(prev, [node('a', 5, 6, 'a')]);
    expect(next).toEqual({});
  });

  // Regression: a nested `data` override is a PARTIAL bag overlaid on the
  // server's FULL `data`. Comparing them wholesale never matches, so the
  // override used to leak forever and mask later server changes (e.g. an
  // undo's revert). It must reconcile `data` key-by-key.
  it('prunes a nested data override key-by-key against the full server data', () => {
    interface DataNode {
      id: string;
      data: Record<string, unknown>;
    }
    const prev: OverrideMap<DataNode> = {
      a: { data: { borderColor: 'red', backgroundColor: 'red' } },
    };
    // Server caught up on BOTH style keys; its `data` carries extra keys we
    // must ignore. The whole override should drop.
    const serverCaughtUp: DataNode = {
      id: 'a',
      data: { name: 'X', borderColor: 'red', backgroundColor: 'red', fontSize: 14 },
    };
    expect(applyPruneAgainst<DataNode>(prev, [serverCaughtUp])).toEqual({});

    // Server caught up on borderColor only — keep just the still-divergent key.
    const serverPartial: DataNode = {
      id: 'a',
      data: { name: 'X', borderColor: 'red', backgroundColor: 'green', fontSize: 14 },
    };
    expect(applyPruneAgainst<DataNode>(prev, [serverPartial])).toEqual({
      a: { data: { backgroundColor: 'red' } },
    });
  });
});

describe('set + drop on error (revert path)', () => {
  it('after setOverride then dropOverride, the override is gone', () => {
    let state: OverrideMap<Node> = {};
    state = applySetOverride<Node>(state, 'a', { position: { x: 7, y: 8 } });
    expect(state.a?.position).toEqual({ x: 7, y: 8 });
    state = applyDropOverride<Node>(state, 'a');
    expect(state.a).toBeUndefined();
  });
});
