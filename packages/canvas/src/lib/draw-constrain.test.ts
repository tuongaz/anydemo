import { describe, expect, it } from 'bun:test';
import {
  DRAW_FLICK_SPEED,
  DRAW_SETTLE_MS,
  type DrawSample,
  EQUILATERAL_ASPECT,
  PERFECT_SHAPE_ASPECT,
  perfectDragBox,
  perfectShapeAspect,
  settleDrawRelease,
} from './draw-constrain.ts';

describe('perfectShapeAspect', () => {
  it('locks triangle + hexagon to the equilateral/regular height:width ratio (√3/2)', () => {
    expect(perfectShapeAspect('triangle')).toBeCloseTo(Math.sqrt(3) / 2, 10);
    expect(perfectShapeAspect('hexagon')).toBeCloseTo(Math.sqrt(3) / 2, 10);
    expect(EQUILATERAL_ASPECT).toBeCloseTo(0.8660254, 6);
    // The two map keys are the only special-cased shapes.
    expect(Object.keys(PERFECT_SHAPE_ASPECT).sort()).toEqual(['hexagon', 'triangle']);
  });

  it('keeps the square (1:1) box for rect, circle, diamond and every other shape', () => {
    for (const shape of [
      'rectangle',
      'ellipse',
      'diamond',
      'sticky',
      'document',
      'cloud',
    ] as const) {
      expect(perfectShapeAspect(shape)).toBe(1);
    }
  });

  it('returns 1 for linkflow, icons (null) and undefined so they constrain to a square', () => {
    expect(perfectShapeAspect('linkflow')).toBe(1);
    expect(perfectShapeAspect(null)).toBe(1);
    expect(perfectShapeAspect(undefined)).toBe(1);
  });
});

describe('perfectDragBox', () => {
  it('for ratio 1 squares the box to side = max(|dx|, |dy|) (the legacy square behaviour)', () => {
    // Wider-than-tall drag → square grows to the width.
    expect(perfectDragBox({ x: 0, y: 0 }, { x: 200, y: 120 }, 1)).toEqual({ x: 200, y: 200 });
    // Taller-than-wide drag → square grows to the height.
    expect(perfectDragBox({ x: 0, y: 0 }, { x: 80, y: 220 }, 1)).toEqual({ x: 220, y: 220 });
  });

  it('preserves drag direction for ratio 1 (all four quadrants)', () => {
    // down-left: dx=-60, dy=-40 → side 60, both corners move toward origin.
    expect(perfectDragBox({ x: 100, y: 100 }, { x: 40, y: 60 }, 1)).toEqual({ x: 40, y: 40 });
    // up-right: dx=+60, dy=-60 → x grows, y shrinks.
    expect(perfectDragBox({ x: 100, y: 100 }, { x: 160, y: 40 }, 1)).toEqual({ x: 160, y: 40 });
    // down-left dominant-y: dx=-60, dy=+60 → side 60.
    expect(perfectDragBox({ x: 100, y: 100 }, { x: 40, y: 160 }, 1)).toEqual({ x: 40, y: 160 });
  });

  it('builds the smallest box of the target aspect that still contains the raw drag', () => {
    const ratio = EQUILATERAL_ASPECT; // height = 0.866 * width
    // Wide drag dominates width: width stays |dx|, height = ratio*width.
    const wide = perfectDragBox({ x: 0, y: 0 }, { x: 300, y: 50 }, ratio);
    expect(wide.x).toBe(300);
    expect(wide.y).toBeCloseTo(300 * ratio, 10); // 259.8…
    // The committed box must still contain the raw drag extent on both axes.
    expect(Math.abs(wide.x - 0)).toBeGreaterThanOrEqual(300);
    expect(Math.abs(wide.y - 0)).toBeGreaterThanOrEqual(50);

    // Tall drag dominates height: width expands so height == |dy|.
    const tall = perfectDragBox({ x: 0, y: 0 }, { x: 50, y: 300 }, ratio);
    expect(tall.y).toBe(300);
    expect(tall.x).toBeCloseTo(300 / ratio, 10); // 346.4…
    expect(Math.abs(tall.x - 0)).toBeGreaterThanOrEqual(50);
    expect(Math.abs(tall.y - 0)).toBeGreaterThanOrEqual(300);
  });

  it('keeps the exact target aspect ratio regardless of the raw drag aspect', () => {
    const ratio = EQUILATERAL_ASPECT;
    for (const cur of [
      { x: 10, y: 400 },
      { x: 400, y: 10 },
      { x: 250, y: 250 },
      { x: -180, y: -90 },
    ]) {
      const end = perfectDragBox({ x: 0, y: 0 }, cur, ratio);
      const w = Math.abs(end.x);
      const h = Math.abs(end.y);
      expect(h / w).toBeCloseTo(ratio, 10);
    }
  });

  it('preserves drag direction for a non-square ratio', () => {
    const ratio = EQUILATERAL_ASPECT;
    const end = perfectDragBox({ x: 500, y: 500 }, { x: 300, y: 380 }, ratio);
    // dx < 0 and dy < 0 → both corners move toward the origin.
    expect(end.x).toBeLessThan(500);
    expect(end.y).toBeLessThan(500);
  });
});

describe('settleDrawRelease', () => {
  const at = (x: number, y: number, t: number): DrawSample => ({ x, y, t });

  it('returns the release point for a deliberate (slow) drag', () => {
    const samples = [at(0, 0, 0), at(50, 30, 40), at(100, 60, 90), at(140, 84, 140)];
    expect(settleDrawRelease(samples)).toEqual({ x: 140, y: 84 });
  });

  it('discards a fast end-of-gesture flick and commits the last deliberate position', () => {
    // Deliberate up to (200,120) by t=200, then a fast flick out to (600,400)
    // over the final ~30ms (≈ well above the flick speed).
    const samples = [
      at(0, 0, 0),
      at(100, 60, 100),
      at(200, 120, 200),
      at(420, 300, 215),
      at(600, 400, 230),
    ];
    expect(settleDrawRelease(samples)).toEqual({ x: 200, y: 120 });
  });

  it('treats zero / negative dt samples as non-flick (never over-trims)', () => {
    // All timestamps identical (e.g. a test harness using a coarse clock):
    // dt = 0 everywhere → we cannot prove a flick, so keep the release point.
    const samples = [at(0, 0, 5), at(200, 150, 5), at(200, 150, 5)];
    expect(settleDrawRelease(samples)).toEqual({ x: 200, y: 150 });
  });

  it('only trims within the settle window — a sustained fast drag keeps its bulk', () => {
    // A long, uniformly fast drag (speed ~4px/ms) for 500ms. We must NOT
    // collapse it toward the start; at most the final DRAW_SETTLE_MS is trimmed.
    const samples: DrawSample[] = [];
    for (let t = 0; t <= 500; t += 20) {
      samples.push(at(t * 4, t * 4, t));
    }
    const settled = settleDrawRelease(samples);
    const release = samples.at(-1);
    if (!release) throw new Error('expected a release sample');
    // Distance trimmed from the release is bounded by speed * settle window.
    const trimmed = Math.hypot(release.x - settled.x, release.y - settled.y);
    const maxTrim = Math.hypot(4, 4) * (DRAW_SETTLE_MS + 20); // +1 sample slack
    expect(trimmed).toBeLessThanOrEqual(maxTrim);
    // And it is nowhere near the origin — the drag's extent survives.
    expect(settled.x).toBeGreaterThan(release.x / 2);
  });

  it('handles the empty and single-sample edge cases', () => {
    expect(settleDrawRelease([])).toEqual({ x: 0, y: 0 });
    expect(settleDrawRelease([at(7, 9, 3)])).toEqual({ x: 7, y: 9 });
  });

  it('exposes sane default tuning constants', () => {
    expect(DRAW_FLICK_SPEED).toBeGreaterThan(0);
    expect(DRAW_SETTLE_MS).toBeGreaterThan(0);
  });
});
