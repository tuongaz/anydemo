import type { DrawableNodeType, GeometricNodeType } from '../types.ts';

/**
 * Shift-to-constrain geometry for the toolbar draw-create gesture.
 *
 * Holding Shift while drag-creating a shape locks the bounding box to the
 * shape's "perfect" form. For a rectangle / ellipse / diamond that's a 1:1
 * square box (perfect square / circle / rhombus). For a triangle and a hexagon
 * the perfect form is the EQUILATERAL triangle / REGULAR (flat-top) hexagon,
 * which only render correctly at a non-square aspect ratio — see below.
 */

/**
 * height ÷ width for an equilateral triangle and a regular flat-top hexagon.
 *
 * Both illustrative shapes are drawn as a single `<polygon>` filling the
 * bounding box (`preserveAspectRatio="none"`):
 *   - triangle (`shapes/triangle.tsx`): apex `(w/2, 0)`, base `(0, h)`–`(w, h)`.
 *     Equilateral ⇔ base length `w` equals the slanted side
 *     `√((w/2)² + h²)` ⇒ `h = w·√3/2`.
 *   - hexagon (`shapes/hexagon.tsx`): vertices at `(w/4,0) (3w/4,0) (w,h/2)
 *     (3w/4,h) (w/4,h) (0,h/2)`. Regular ⇔ the top edge `w/2` equals the
 *     slanted edge `√((w/4)² + (h/2)²)` ⇒ `h = w·√3/2`.
 *
 * So both want the same `height/width = √3/2 ≈ 0.866`.
 */
export const EQUILATERAL_ASPECT = Math.sqrt(3) / 2;

/**
 * Per-shape "perfect" bounding-box aspect ratio (height ÷ width) applied when
 * Shift is held. Shapes absent from the map constrain to a 1:1 square box, which
 * is the perfect form for rect / circle / diamond and a sensible default for the
 * illustrative shapes that have no canonical regular proportion.
 */
export const PERFECT_SHAPE_ASPECT: Partial<Record<GeometricNodeType, number>> = {
  triangle: EQUILATERAL_ASPECT,
  hexagon: EQUILATERAL_ASPECT,
};

/**
 * Resolve the perfect height:width ratio for a drawable shape. `linkflow`,
 * icons (passed as `null`) and any shape without a special ratio fall back to
 * `1` (a square box).
 */
export function perfectShapeAspect(shape: DrawableNodeType | null | undefined): number {
  if (shape == null || shape === 'linkflow') return 1;
  return PERFECT_SHAPE_ASPECT[shape] ?? 1;
}

/**
 * Constrain a drag-create box to a target aspect ratio (`ratio = height/width`)
 * while preserving the drag direction: anchor at `start`, extend toward
 * `current`. The box is the SMALLEST one of the target aspect that still
 * contains the raw drag extent on both axes —
 *   `width  = max(|dx|, |dy| / ratio)`,
 *   `height = ratio · width`
 * — so it never shrinks below what the user dragged. For `ratio = 1` this is
 * exactly the legacy "square the box to `side = max(|dx|, |dy|)`" behaviour.
 *
 * Operates in whatever coordinate space the caller passes (screen px at the
 * draw call sites) so the ghost preview and the committed node match.
 */
export function perfectDragBox(
  start: { x: number; y: number },
  current: { x: number; y: number },
  ratio: number,
): { x: number; y: number } {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const width = Math.max(Math.abs(dx), Math.abs(dy) / ratio);
  const height = width * ratio;
  return {
    x: start.x + (dx < 0 ? -width : width),
    y: start.y + (dy < 0 ? -height : height),
  };
}

/** A timestamped pointer sample (`client` px, `t` = event time in ms). */
export interface DrawSample {
  x: number;
  y: number;
  t: number;
}

/**
 * Client px per millisecond above which a pointer segment counts as a "flick".
 * An ordinary deliberate drag decelerates as it approaches the target size and
 * stays well under this; a fast release flick (the user yanking the pointer
 * toward / off the canvas edge as they let go) trips it. ≈ 48 px in one 16 ms
 * frame.
 */
export const DRAW_FLICK_SPEED = 3;

/**
 * Only the final `DRAW_SETTLE_MS` of motion may be discarded as a release
 * flick, so a long sustained fast drag keeps (almost) its full extent rather
 * than collapsing toward the start. This is the "leave some time after the
 * mouse leaves" grace window.
 */
export const DRAW_SETTLE_MS = 90;

/**
 * Choose the pointer position to commit a drag-created shape from the gesture's
 * trailing samples (chronological; the last element is the release point).
 *
 * If the pointer was flicked — moving faster than `flickSpeed` — during the
 * final `settleMs` before release, that trailing burst is an accidental
 * end-of-gesture yank whose overshoot must NOT become the committed corner
 * (it would enlarge / distort the shape). We rewind past the flick to the last
 * position the pointer was moving deliberately and commit THAT. A drag that
 * decelerates into the release (the normal case) is returned unchanged, and a
 * segment we cannot time (`dt ≤ 0`) is treated as deliberate so we never
 * over-trim.
 */
export function settleDrawRelease(
  samples: readonly DrawSample[],
  flickSpeed = DRAW_FLICK_SPEED,
  settleMs = DRAW_SETTLE_MS,
): { x: number; y: number } {
  const n = samples.length;
  if (n === 0) return { x: 0, y: 0 };
  const last = samples[n - 1];
  if (!last) return { x: 0, y: 0 };
  if (n === 1) return { x: last.x, y: last.y };

  let i = n - 1;
  while (i > 0) {
    const a = samples[i - 1];
    const b = samples[i];
    if (!a || !b) break;
    const dt = b.t - a.t;
    // Can't prove a flick without a positive time delta → stop (keep current).
    if (dt <= 0) break;
    // Don't reach back past the settle window.
    if (last.t - a.t > settleMs) break;
    const speed = Math.hypot(b.x - a.x, b.y - a.y) / dt;
    if (speed <= flickSpeed) break; // deliberate placement → commit here
    i -= 1; // discard this flick segment and keep rewinding
  }
  const chosen = samples[i];
  return chosen ? { x: chosen.x, y: chosen.y } : { x: last.x, y: last.y };
}
