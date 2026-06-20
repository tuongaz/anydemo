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

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}
