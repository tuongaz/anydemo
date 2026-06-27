import { describe, expect, test } from 'bun:test';
import { getStroke } from 'perfect-freehand';
import { FREEHAND_STROKE_OPTIONS, strokeOutlineToPath } from './freehand-stroke.ts';

// The horizontal reach (max X) of a perfect-freehand outline for the given input.
function outlineMaxX(points: number[][]): number {
  const outline = getStroke(points, FREEHAND_STROKE_OPTIONS);
  return outline.reduce(
    (max, [x]) => Math.max(max, x ?? Number.NEGATIVE_INFINITY),
    Number.NEGATIVE_INFINITY,
  );
}

describe('strokeOutlineToPath', () => {
  test('returns empty string for no points', () => {
    expect(strokeOutlineToPath([])).toBe('');
  });
  test('builds a closed SVG path from an outline polygon', () => {
    const d = strokeOutlineToPath([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(d.startsWith('M')).toBe(true);
    expect(d.trim().endsWith('Z')).toBe(true);
  });
});

test('FREEHAND_STROKE_OPTIONS exposes a base size', () => {
  expect(typeof FREEHAND_STROKE_OPTIONS.size).toBe('number');
});

describe('committed stroke reaches the release point', () => {
  // Regression: a committed freehand stroke is a COMPLETE stroke, so its ink
  // must extend all the way to the final input point. Without `last: true`,
  // perfect-freehand's streamline low-pass filter lags the endpoint (treating
  // the stroke as still in progress) — worst for the Shift-straight gesture,
  // which commits exactly two points: the rendered line stops well short of the
  // release point ("the straight line is shorter than where I released").
  test('a 2-point Shift-straight stroke reaches its endpoint, not the streamlined midpoint', () => {
    // Input spans x: 0..100. The outline must reach ~100 (plus the round cap),
    // not the streamline-lagged ~84 that an in-progress stroke would produce.
    const maxX = outlineMaxX([
      [0, 0, 0.5],
      [100, 0, 0.5],
    ]);
    expect(maxX).toBeGreaterThanOrEqual(98);
  });

  test('a sparse (fast-movement) stroke still reaches its endpoint', () => {
    // A quick flick samples few points; the streamline lag is most pronounced
    // here. The committed ink must still reach the final point (x ≈ 100).
    const maxX = outlineMaxX([
      [0, 0, 0.5],
      [40, 20, 0.5],
      [100, 10, 0.5],
    ]);
    expect(maxX).toBeGreaterThanOrEqual(98);
  });
});
