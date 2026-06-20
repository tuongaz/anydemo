import { describe, expect, test } from 'bun:test';
import { FREEHAND_STROKE_OPTIONS, strokeOutlineToPath } from './freehand-stroke.ts';

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
