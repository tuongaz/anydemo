import { describe, expect, it } from 'bun:test';
import {
  type XY,
  boxFromEndpoints,
  denormalizePoints,
  normalizePointsToBox,
} from './line-geometry.ts';

describe('boxFromEndpoints', () => {
  it('returns the tight bounding box for a diagonal', () => {
    const box = boxFromEndpoints({ x: 10, y: 20 }, { x: 110, y: 80 }, 1);
    expect(box).toEqual({ x: 10, y: 20, width: 100, height: 60 });
  });

  it('handles a reversed diagonal (b above-left of a)', () => {
    const box = boxFromEndpoints({ x: 110, y: 80 }, { x: 10, y: 20 }, 1);
    expect(box).toEqual({ x: 10, y: 20, width: 100, height: 60 });
  });

  it('pads a horizontal line to the min height, centered', () => {
    const box = boxFromEndpoints({ x: 0, y: 50 }, { x: 100, y: 50 }, 2);
    expect(box).toEqual({ x: 0, y: 49, width: 100, height: 2 });
  });

  it('pads a vertical line to the min width, centered', () => {
    const box = boxFromEndpoints({ x: 50, y: 0 }, { x: 50, y: 100 }, 2);
    expect(box).toEqual({ x: 49, y: 0, width: 2, height: 100 });
  });
});

describe('normalizePointsToBox', () => {
  it('maps endpoints to 0..1 corners of the box', () => {
    const box = { x: 10, y: 20, width: 100, height: 60 };
    const pts = normalizePointsToBox({ x: 10, y: 20 }, { x: 110, y: 80 }, box);
    expect(pts).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('centers a horizontal line on the cross axis (both y = 0.5)', () => {
    const box = boxFromEndpoints({ x: 0, y: 50 }, { x: 100, y: 50 }, 2);
    const pts = normalizePointsToBox({ x: 0, y: 50 }, { x: 100, y: 50 }, box);
    expect(pts[0]).toEqual([0, 0.5]);
    expect(pts[1]).toEqual([1, 0.5]);
  });
});

describe('denormalizePoints', () => {
  it('round-trips with normalize back to the original endpoints', () => {
    const a: XY = { x: 10, y: 20 };
    const b: XY = { x: 110, y: 80 };
    const box = boxFromEndpoints(a, b, 1);
    const norm = normalizePointsToBox(a, b, box);
    const px = denormalizePoints(norm, box.width, box.height);
    expect(px[0][0] + box.x).toBeCloseTo(a.x);
    expect(px[0][1] + box.y).toBeCloseTo(a.y);
    expect(px[1][0] + box.x).toBeCloseTo(b.x);
    expect(px[1][1] + box.y).toBeCloseTo(b.y);
  });
});
