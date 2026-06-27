/**
 * Straight-snap for a two-point segment (the decorative line). Given a FIXED
 * endpoint `a` and a MOVING endpoint `b`, snap `b` to share `a`'s x (a perfectly
 * vertical segment) or y (perfectly horizontal) when the cross-axis delta is
 * within `threshold` — mirroring the connector's `snapPinToStraight`, but for a
 * free segment rather than a perimeter pin. `threshold` is in the SAME units as
 * the points (callers pass `STRAIGHT_SNAP_PX / zoom` to convert the screen-px
 * threshold to flow units). The nearer axis wins when both are within range.
 */
export interface SegmentPoint {
  x: number;
  y: number;
}

export function snapSegmentToStraight(
  a: SegmentPoint,
  b: SegmentPoint,
  threshold: number,
): SegmentPoint {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  // Horizontal snap when the vertical delta is small (and no larger than the
  // horizontal delta, so a near-45° segment doesn't flip-flop).
  if (dy <= threshold && dy <= dx) return { x: b.x, y: a.y };
  // Vertical snap when the horizontal delta is the smaller one within range.
  if (dx <= threshold && dx < dy) return { x: a.x, y: b.y };
  return b;
}
