import { describe, expect, it } from 'bun:test';
import { snapSegmentToStraight } from './snap-segment.ts';

const A = { x: 0, y: 0 };

describe('snapSegmentToStraight', () => {
  it('snaps a near-horizontal segment to exactly horizontal', () => {
    expect(snapSegmentToStraight(A, { x: 100, y: 3 }, 8)).toEqual({ x: 100, y: 0 });
  });

  it('snaps a near-vertical segment to exactly vertical', () => {
    expect(snapSegmentToStraight(A, { x: 3, y: 100 }, 8)).toEqual({ x: 0, y: 100 });
  });

  it('leaves a clear diagonal untouched', () => {
    expect(snapSegmentToStraight(A, { x: 100, y: 100 }, 8)).toEqual({ x: 100, y: 100 });
  });

  it('does not snap when the cross-delta exceeds the threshold', () => {
    expect(snapSegmentToStraight(A, { x: 100, y: 20 }, 8)).toEqual({ x: 100, y: 20 });
  });

  it('scales with the (already converted) threshold', () => {
    // Same geometry, tighter threshold → no snap.
    expect(snapSegmentToStraight(A, { x: 100, y: 6 }, 4)).toEqual({ x: 100, y: 6 });
    // Looser threshold → snaps.
    expect(snapSegmentToStraight(A, { x: 100, y: 6 }, 8)).toEqual({ x: 100, y: 0 });
  });

  it('snaps relative to the fixed endpoint, not the origin', () => {
    const fixed = { x: 50, y: 50 };
    expect(snapSegmentToStraight(fixed, { x: 200, y: 53 }, 8)).toEqual({ x: 200, y: 50 });
  });
});
