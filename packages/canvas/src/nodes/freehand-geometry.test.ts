import { describe, expect, test } from 'bun:test';
import {
  MIN_STROKE_EXTENT,
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
  test('snaps a near-horizontal segment to exactly horizontal', () => {
    const [x, y] = snapToStraightLine([0, 0, 0.5], [100, 8, 0.5]);
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(0);
  });

  test('snaps a near-vertical segment to exactly vertical', () => {
    const [x, y] = snapToStraightLine([0, 0, 0.5], [6, 100, 0.5]);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(100);
  });

  test('snaps a ~45deg segment onto the diagonal (equal x/y)', () => {
    const [x, y] = snapToStraightLine([0, 0, 0.5], [100, 90, 0.5]);
    expect(x).toBeCloseTo(y, 5);
    expect(x).toBeGreaterThan(0);
  });

  test('preserves the projected length along the snapped ray', () => {
    // pure horizontal input: projected length == dx
    const [x] = snapToStraightLine([10, 10, 0.5], [110, 10, 0.5]);
    expect(x).toBeCloseTo(110);
  });

  test('returns the start point for a zero-length segment', () => {
    const [x, y] = snapToStraightLine([5, 5, 0.5], [5, 5, 0.5]);
    expect(x).toBeCloseTo(5);
    expect(y).toBeCloseTo(5);
  });

  test('snaps a near-horizontal segment in the negative direction', () => {
    // Locks the atan2 wrap: a leftward drag must stay leftward, not flip to +x.
    const [x, y] = snapToStraightLine([0, 0, 0.5], [-100, 5, 0.5]);
    expect(x).toBeCloseTo(-100);
    expect(y).toBeCloseTo(0);
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
