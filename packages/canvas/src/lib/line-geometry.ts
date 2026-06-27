/**
 * Pure geometry for the decorative `line` node. A line is stored as a node with
 * a bounding box (`position` + `width`/`height`) plus two endpoints in
 * `data.points`, normalized to that box (0..1). These helpers convert between
 * absolute flow coordinates (draw / endpoint-drag gestures) and the normalized
 * storage form, and back to pixel coordinates for the renderer.
 */

export interface XY {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LinePoints = [[number, number], [number, number]];

/** Smallest box dimension so a perfectly horizontal/vertical line never has a
 * zero-area bounding box (which xyflow renders + hit-tests poorly). */
export const LINE_MIN_BOX = 2;

/** Default length (flow units) for a line created by a click/tap with no drag. */
export const LINE_DEFAULT_LENGTH = 160;

/**
 * Bounding box of two endpoints, padded to `minSize` on any axis where the two
 * points coincide so the box stays non-degenerate. Padding is symmetric, so the
 * endpoints land centered on the padded axis (a horizontal line sits at the
 * vertical middle of its thin box).
 */
export function boxFromEndpoints(a: XY, b: XY, minSize: number): Box {
  let x = Math.min(a.x, b.x);
  let y = Math.min(a.y, b.y);
  let width = Math.abs(a.x - b.x);
  let height = Math.abs(a.y - b.y);
  if (width < minSize) {
    x -= (minSize - width) / 2;
    width = minSize;
  }
  if (height < minSize) {
    y -= (minSize - height) / 2;
    height = minSize;
  }
  return { x, y, width, height };
}

/** Convert two absolute endpoints to box-normalized [0..1] coordinates. */
export function normalizePointsToBox(a: XY, b: XY, box: Box): LinePoints {
  const norm = (p: XY): [number, number] => [
    box.width === 0 ? 0 : (p.x - box.x) / box.width,
    box.height === 0 ? 0 : (p.y - box.y) / box.height,
  ];
  return [norm(a), norm(b)];
}

/** Convert normalized [0..1] endpoints to pixel coordinates within a box of the
 * given width/height (origin-relative — add the box position for absolute). */
export function denormalizePoints(points: LinePoints, width: number, height: number): LinePoints {
  return [
    [points[0][0] * width, points[0][1] * height],
    [points[1][0] * width, points[1][1] * height],
  ];
}
