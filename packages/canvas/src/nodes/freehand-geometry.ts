// Pure geometry for freehand ink strokes. A Point is [x, y, pressure].
export type Point = [number, number, number];
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Strokes below this screen-px extent on BOTH axes are treated as an
// accidental click, not an intentional drawing. Mirrors MIN_DRAW_SIZE.
export const MIN_STROKE_EXTENT = 4;

// Floor for a box dimension so a perfectly straight/vertical stroke still has a
// non-zero box to normalize against (avoids divide-by-zero).
const MIN_BOX_DIM = 1;

export function boundingBox(points: Point[]): Box {
  if (points.length === 0) return { x: 0, y: 0, width: MIN_BOX_DIM, height: MIN_BOX_DIM };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, MIN_BOX_DIM),
    height: Math.max(maxY - minY, MIN_BOX_DIM),
  };
}

export function normalizePoints(points: Point[], box: Box): Point[] {
  return points.map(([x, y, p]) => [(x - box.x) / box.width, (y - box.y) / box.height, p]);
}

export function denormalizePoints(points: Point[], box: Box): Point[] {
  return points.map(([nx, ny, p]) => [box.x + nx * box.width, box.y + ny * box.height, p]);
}

export function isAccidentalStroke(box: Box): boolean {
  return box.width < MIN_STROKE_EXTENT && box.height < MIN_STROKE_EXTENT;
}

// Ramer–Douglas–Peucker simplification on the x/y plane; pressure is carried
// from the surviving samples. `epsilon` is in the same units as the points.
export function simplifyRDP(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice();
  // biome-ignore lint/style/noNonNullAssertion: length >= 3 guarantees index 0 exists
  const first = points[0]!;
  // biome-ignore lint/style/noNonNullAssertion: length >= 3 guarantees the last index exists
  const last = points[points.length - 1]!;
  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    // biome-ignore lint/style/noNonNullAssertion: i is within bounds of the loop
    const d = perpendicularDistance(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist <= epsilon) return [first, last];
  const left = simplifyRDP(points.slice(0, index + 1), epsilon);
  const right = simplifyRDP(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

// tan(22.5°) — the half-angle of each 45° snap sector. A drag whose minor-axis
// magnitude is within this fraction of its major axis snaps to that major axis;
// anything steeper snaps to the diagonal.
const TAN_22_5 = Math.tan(Math.PI / 8);

/**
 * Snap the segment start→end to the nearest of 8 directions (every 45°:
 * horizontal, vertical, and the four diagonals) while keeping the endpoint AT
 * the release point along the line's dominant axis:
 *
 *   - horizontal → `[end.x, start.y]` (X tracks the cursor, Y levels off)
 *   - vertical   → `[start.x, end.y]` (Y tracks the cursor, X levels off)
 *   - diagonal   → a true 45° segment whose dominant axis reaches the cursor
 *
 * This is what makes a Shift-straightened stroke END UNDER the release point
 * rather than overshooting it (full-length rotation) or stopping short of it
 * (perpendicular projection). Used by the pen tool's Shift-to-straighten
 * gesture. Pressure is carried from `end`. A zero-length segment returns
 * `start` unchanged.
 */
export function snapToStraightLine(start: Point, end: Point): Point {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx === 0 && ady === 0) return [start[0], start[1], end[2]];
  // Horizontal sector: the minor (Y) axis is within tan(22.5°) of the major.
  if (ady <= adx * TAN_22_5) return [end[0], start[1], end[2]];
  // Vertical sector: the minor (X) axis is within tan(22.5°) of the major.
  if (adx <= ady * TAN_22_5) return [start[0], end[1], end[2]];
  // Diagonal sector: a 45° ray whose dominant axis lands on the cursor.
  const m = Math.max(adx, ady);
  return [start[0] + Math.sign(dx) * m, start[1] + Math.sign(dy) * m, end[2]];
}

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}
