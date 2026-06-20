// Centralized perfect-freehand options + outline→SVG-path conversion. Mirrors
// the FIT_VIEW_OPTIONS pattern of keeping tunables in one module-level const.
export const FREEHAND_STROKE_OPTIONS = {
  size: 8,
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: true,
};

// Convert perfect-freehand's outline polygon (array of [x, y]) into a closed
// SVG path string. Uses quadratic segments through midpoints for smoothness.
export function strokeOutlineToPath(outline: number[][]): string {
  const len = outline.length;
  if (len === 0) return '';
  const first = outline[0];
  if (!first) return '';
  const d: (string | number)[] = ['M', first[0] ?? 0, first[1] ?? 0, 'Q'];
  for (let i = 0; i < len; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % len];
    if (!a || !b) continue;
    const ax = a[0] ?? 0;
    const ay = a[1] ?? 0;
    const bx = b[0] ?? 0;
    const by = b[1] ?? 0;
    d.push(ax, ay, (ax + bx) / 2, (ay + by) / 2);
  }
  d.push('Z');
  return d.join(' ');
}
