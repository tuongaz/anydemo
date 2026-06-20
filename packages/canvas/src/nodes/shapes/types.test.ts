import { describe, expect, it } from 'bun:test';
import { paddedViewBox } from './types.ts';

describe('paddedViewBox', () => {
  it('insets the viewBox by the stroke-derived margin on all sides', () => {
    // margin = strokeWidth (so half-stroke + miter clears the edge)
    expect(paddedViewBox(100, 60, 2)).toBe('-2 -2 104 64');
  });

  it('uses DEFAULT_STROKE_WIDTH-scaled margin when strokeWidth is large', () => {
    expect(paddedViewBox(200, 100, 6)).toBe('-6 -6 212 112');
  });

  it('pads small dimensions the same way as large ones', () => {
    // positive case for a small shape: the margin is still the full stroke width
    expect(paddedViewBox(10, 10, 2)).toBe('-2 -2 14 14');
  });
});
