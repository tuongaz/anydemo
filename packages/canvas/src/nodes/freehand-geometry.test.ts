import { describe, expect, test } from 'bun:test';
import {
  MIN_STROKE_EXTENT,
  type Point,
  boundingBox,
  denormalizePoints,
  isAccidentalStroke,
  normalizePoints,
  simplifyRDP,
  snapToStraightLine,
} from './freehand-geometry.ts';

describe('boundingBox', () => {
  test('computes min/max with padding 0', () => {
    expect(
      boundingBox([
        [0, 0, 0.5],
        [10, 4, 0.5],
      ]),
    ).toEqual({ x: 0, y: 0, width: 10, height: 4 });
  });
  test('never returns zero width/height (degenerate line)', () => {
    const b = boundingBox([
      [5, 5, 0.5],
      [5, 9, 0.5],
    ]);
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);
  });
  test('returns a safe non-finite-free box for empty input', () => {
    expect(boundingBox([])).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});

describe('normalize/denormalize round-trip', () => {
  test('round-trips within epsilon', () => {
    const pts = [
      [2, 3, 0.4],
      [8, 11, 0.9],
    ] as [number, number, number][];
    const box = boundingBox(pts);
    const norm = normalizePoints(pts, box);
    for (const v of norm.flat()) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
    const back = denormalizePoints(norm, box);
    for (const [i, p] of back.entries()) {
      const original = pts[i];
      if (!original) throw new Error(`missing original point at ${i}`);
      expect(p[0]).toBeCloseTo(original[0], 5);
      expect(p[1]).toBeCloseTo(original[1], 5);
      expect(p[2]).toBeCloseTo(original[2], 5);
    }
  });
});

describe('simplifyRDP', () => {
  test('drops collinear midpoints', () => {
    const line = [
      [0, 0, 0.5],
      [1, 1, 0.5],
      [2, 2, 0.5],
      [3, 3, 0.5],
    ] as [number, number, number][];
    expect(simplifyRDP(line, 0.01).length).toBe(2);
  });
  test('keeps endpoints', () => {
    const pts = [
      [0, 0, 0.5],
      [5, 9, 0.5],
    ] as [number, number, number][];
    expect(simplifyRDP(pts, 0.01)).toEqual(pts);
  });
  test('preserves pressure on a surviving spike midpoint', () => {
    const spike = [
      [0, 0, 0.1],
      [5, 10, 0.95],
      [10, 0, 0.1],
    ] as [number, number, number][];
    const simplified = simplifyRDP(spike, 0.01);
    expect(simplified).toHaveLength(3);
    const mid = simplified[1];
    if (!mid) throw new Error('expected the spike midpoint to survive');
    expect(mid[2]).toBe(0.95);
  });
  test('handles a closed loop (a==b) without throwing and keeps endpoints', () => {
    const loop = [
      [0, 0, 0.5],
      [5, 5, 0.5],
      [0, 0, 0.5],
    ] as [number, number, number][];
    let simplified: [number, number, number][] = [];
    expect(() => {
      simplified = simplifyRDP(loop, 0.01);
    }).not.toThrow();
    expect(simplified[0]).toEqual([0, 0, 0.5]);
    expect(simplified[simplified.length - 1]).toEqual([0, 0, 0.5]);
  });
});

describe('snapToStraightLine', () => {
  test('snaps a near-horizontal segment to exactly horizontal, ending UNDER the cursor', () => {
    const [x, y] = snapToStraightLine([0, 0, 0.5], [100, 8, 0.5]);
    // The endpoint lands at the cursor's X (the dominant axis) and a level Y —
    // the line ends directly under the release point, not past it.
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(0);
  });

  test('snaps a near-vertical segment to exactly vertical, ending BESIDE the cursor', () => {
    const [x, y] = snapToStraightLine([0, 0, 0.5], [6, 100, 0.5]);
    // Dominant axis is Y → endpoint Y matches the cursor exactly, X levels off.
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(100);
  });

  test('snaps a ~45deg segment onto the diagonal (equal x/y), reaching the dominant axis', () => {
    // dx=100 dominates dy=90 → the line reaches the cursor's X exactly, at 45°.
    const [x, y] = snapToStraightLine([0, 0, 0.5], [100, 90, 0.5]);
    expect(x).toBeCloseTo(100);
    expect(x).toBeCloseTo(y, 5);
    expect(x).toBeGreaterThan(0);
  });

  test('a diagonal reaches the cursor exactly on the dominant axis', () => {
    // The straightened line ends AT the release point along its dominant axis
    // (here X, since |dx| > |dy|), so it never feels short of the cursor.
    const start: Point = [10, 10, 0.5];
    const end: Point = [110, 70, 0.5];
    const [x, y] = snapToStraightLine(start, end);
    expect(x).toBeCloseTo(end[0]); // dominant axis lands on the cursor
    // Still a true 45° segment: |Δx| === |Δy|.
    expect(Math.abs(x - start[0])).toBeCloseTo(Math.abs(y - start[1]));
  });

  test('returns the start point for a zero-length segment', () => {
    const [x, y] = snapToStraightLine([5, 5, 0.5], [5, 5, 0.5]);
    expect(x).toBeCloseTo(5);
    expect(y).toBeCloseTo(5);
  });

  test('carries the pressure from the end sample', () => {
    const snapped = snapToStraightLine([0, 0, 0.2], [100, 4, 0.9]);
    expect(snapped[2]).toBeCloseTo(0.9);
  });

  test('snaps a near-horizontal segment in the negative direction', () => {
    // A leftward drag must stay leftward, ending under the cursor's X.
    const [x, y] = snapToStraightLine([0, 0, 0.5], [-100, 5, 0.5]);
    expect(y).toBeCloseTo(0);
    expect(x).toBeCloseTo(-100);
    expect(x).toBeLessThan(0);
  });
});

describe('isAccidentalStroke', () => {
  test('true when extent below MIN_STROKE_EXTENT on both axes', () => {
    expect(isAccidentalStroke({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
  });
  test('false for an intentional drag', () => {
    expect(isAccidentalStroke({ x: 0, y: 0, width: MIN_STROKE_EXTENT + 1, height: 50 })).toBe(
      false,
    );
  });
});
