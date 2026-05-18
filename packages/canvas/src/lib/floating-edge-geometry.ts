/**
 * Floating-edge geometry — given a source rectangle and the center of the
 * other endpoint's node, compute where a straight ray from the source center
 * to the other center crosses the source rectangle's perimeter, and which
 * side of the rectangle that crossing lies on.
 *
 * Used by `editable-edge.tsx` (US-025) to render an edge endpoint that
 * floats against the line-through-centers — the endpoint slides along the
 * node's perimeter in real time as either node moves, eliminating the
 * wrap-around artifacts the old facing-handle picker produced.
 */

export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface FloatingRect {
  /** Top-left x of the node's bounding box. */
  x: number;
  /** Top-left y of the node's bounding box. */
  y: number;
  /** Width of the node's bounding box. */
  w: number;
  /** Height of the node's bounding box. */
  h: number;
}

export interface XY {
  x: number;
  y: number;
}

/** A coordinate + side, ready to feed React Flow's path helpers. */
export interface Endpoint {
  x: number;
  y: number;
  side: Side;
}

/**
 * Compute the perimeter intersection of the line from `rect`'s center toward
 * `otherCenter`, plus the side of the rectangle that contains the
 * intersection.
 *
 * Math: scale (dx, dy) by `min(halfW/|dx|, halfH/|dy|)` and add to the source
 * center. Side is decided by `|dx|*halfH` vs `|dy|*halfW`: when the
 * horizontal magnitude dominates the rectangle's aspect, the ray exits
 * left/right; otherwise top/bottom. A 45° tie (the two products equal) goes
 * to the x-axis so the result is deterministic and the side flips with the
 * sign of dx.
 *
 * Degenerate cases:
 * - same center (dx === 0 && dy === 0) → returns the rect's center with
 *   `side: 'right'` so callers never see NaN/Infinity.
 * - dx === 0 (purely vertical) → halfW/|dx| is Infinity, so the min picks
 *   halfH/|dy|; the intersection lies on top or bottom.
 * - dy === 0 (purely horizontal) → mirror of the above.
 */
export const getNodeIntersection = (rect: FloatingRect, otherCenter: XY): Endpoint => {
  const halfW = rect.w / 2;
  const halfH = rect.h / 2;
  const cx = rect.x + halfW;
  const cy = rect.y + halfH;
  const dx = otherCenter.x - cx;
  const dy = otherCenter.y - cy;

  if (dx === 0 && dy === 0) {
    return { x: cx, y: cy, side: 'right' };
  }

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const tx = absDx === 0 ? Number.POSITIVE_INFINITY : halfW / absDx;
  const ty = absDy === 0 ? Number.POSITIVE_INFINITY : halfH / absDy;
  const t = Math.min(tx, ty);

  const x = cx + dx * t;
  const y = cy + dy * t;

  // Side: compare horizontal vs vertical contribution, scaled by the
  // rectangle's aspect. >= sends 45° ties to the x-axis.
  const side: Side =
    absDx * halfH >= absDy * halfW ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top';

  return { x, y, side };
};

/**
 * US-006: a pinned perimeter position. `t` is parameterized along `side`,
 * clamped to [0, 1]. Mirrors `EdgePinSchema` (apps/studio/src/schema.ts) and
 * `EdgePin` (apps/web/src/lib/api.ts).
 */
export interface Pin {
  side: Side;
  t: number;
}

/**
 * Per-endpoint resolution input: the node's bounding box plus the
 * `autoPicked` flag and (optionally) an explicit `pin` for that side. `null`
 * means the live node geometry isn't available yet (e.g. the node hasn't
 * been measured) — the caller should hand back the React-Flow-supplied
 * fallback in that case.
 */
export interface EndpointInput {
  box: FloatingRect;
  autoPicked: boolean | undefined;
  /**
   * US-006: when set, the endpoint is computed from `(side, t)` against
   * `box` and overrides both floating and `autoPicked === false`. Survives
   * node translation and resize because the position is parameterized.
   */
  pin?: Pin;
  /** React-Flow-supplied coords/side, used when the endpoint is pinned. */
  fallback: Endpoint;
}

/**
 * US-007: project a cursor point onto the nearest side of a node's bbox and
 * return the corresponding `(side, t)` pin. Used by the pin-drag UI: as the
 * user drags an endpoint dot, the cursor is mapped to the closest perimeter
 * point each frame so the endpoint clamps along the perimeter without
 * detaching off-node.
 *
 * Algorithm: clamp the cursor into the rect to get `(relX, relY)` in
 * `[0, w] × [0, h]`, then the four side-distances (`relX`, `w - relX`,
 * `relY`, `h - relY`) tell us which side the projection lies on. Tie-break
 * order is left → right → top → bottom so corner ties are deterministic.
 *
 * Edge cases: a zero-width rect collapses left/right to t=0 (avoids
 * NaN from division by zero); a zero-height rect collapses top/bottom the
 * same way. A degenerate 0×0 rect returns `{ side: 'left', t: 0 }`.
 *
 * Pure — used by both the live drag preview and the persistence path.
 */
export const projectCursorToPerimeter = (rect: FloatingRect, cursor: XY): Pin => {
  const relX = Math.max(0, Math.min(rect.w, cursor.x - rect.x));
  const relY = Math.max(0, Math.min(rect.h, cursor.y - rect.y));
  const dLeft = relX;
  const dRight = rect.w - relX;
  const dTop = relY;
  const dBottom = rect.h - relY;
  const min = Math.min(dLeft, dRight, dTop, dBottom);
  const tVertical = rect.h === 0 ? 0 : relY / rect.h;
  const tHorizontal = rect.w === 0 ? 0 : relX / rect.w;
  if (min === dLeft) return { side: 'left', t: tVertical };
  if (min === dRight) return { side: 'right', t: tVertical };
  if (min === dTop) return { side: 'top', t: tHorizontal };
  return { side: 'bottom', t: tHorizontal };
};

/**
 * Compute a perimeter point from a pin against a node's bbox. `t` is
 * clamped into [0, 1] so out-of-range values (e.g. from a future schema
 * widening) never produce off-perimeter coordinates.
 *
 * Top/bottom sides: `t` goes left → right.
 * Left/right sides: `t` goes top → bottom.
 *
 * Pure — depends only on the rect's current geometry. The same `(side, t)`
 * against a translated or resized rect produces a coordinate that tracks
 * the rect, which is the whole point of pinning.
 */
export const endpointFromPin = (rect: FloatingRect, pin: Pin): Endpoint => {
  const t = Math.min(1, Math.max(0, pin.t));
  let x: number;
  let y: number;
  switch (pin.side) {
    case 'top':
      x = rect.x + t * rect.w;
      y = rect.y;
      break;
    case 'bottom':
      x = rect.x + t * rect.w;
      y = rect.y + rect.h;
      break;
    case 'left':
      x = rect.x;
      y = rect.y + t * rect.h;
      break;
    case 'right':
      x = rect.x + rect.w;
      y = rect.y + t * rect.h;
      break;
  }
  return { x, y, side: pin.side };
};

/**
 * Convert a perimeter `Endpoint` back into a `Pin` against the same rect.
 * Pure inverse of `endpointFromPin` (round-trips when the endpoint actually
 * lies on the rect's perimeter, and clamps gracefully otherwise).
 *
 * Used to "freeze" a currently-floating endpoint at its visible position
 * before a reconnect on the other side: capture the floating intersection
 * via `getNodeIntersection`, convert via this helper, then persist as a pin
 * so the un-moved endpoint doesn't slide when the moved side changes the
 * line-through-centers.
 *
 * Edge case: a zero-width rect collapses t→0 on top/bottom (no horizontal
 * range to parameterize); a zero-height rect collapses t→0 on left/right.
 */
export const endpointToPin = (rect: FloatingRect, endpoint: Endpoint): Pin => {
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
  switch (endpoint.side) {
    case 'top':
    case 'bottom':
      return {
        side: endpoint.side,
        t: rect.w === 0 ? 0 : clamp01((endpoint.x - rect.x) / rect.w),
      };
    case 'left':
    case 'right':
      return {
        side: endpoint.side,
        t: rect.h === 0 ? 0 : clamp01((endpoint.y - rect.y) / rect.h),
      };
  }
};

/**
 * Resolve a single edge endpoint. Precedence (highest first):
 *
 * 1. `pin` set (US-006) → compute from `(side, t)` against the node's bbox.
 *    The endpoint parameterizes with the node so it survives moves/resizes.
 * 2. `autoPicked === false` (US-025, user-pinned by an explicit handle drop)
 *    → return the React-Flow-supplied fallback unchanged so a pinned handle
 *    stays put even if it points the "wrong" way after the other node moves.
 * 3. Otherwise (floating; the default for new connectors): compute the
 *    perimeter intersection of the line through the two node centers via
 *    `getNodeIntersection`. Endpoint slides along the node's perimeter as
 *    either node moves.
 *
 * Pure function — extracted from `editable-edge.tsx` so the branch can be
 * unit-tested without mounting the component.
 */
export const resolveEdgeEndpoints = (
  source: EndpointInput | null,
  target: EndpointInput | null,
): { source: Endpoint; target: Endpoint } => {
  const sourceFallback = source?.fallback ?? { x: 0, y: 0, side: 'right' as Side };
  const targetFallback = target?.fallback ?? { x: 0, y: 0, side: 'left' as Side };
  if (!source || !target) {
    return { source: sourceFallback, target: targetFallback };
  }
  const sCenter = { x: source.box.x + source.box.w / 2, y: source.box.y + source.box.h / 2 };
  const tCenter = { x: target.box.x + target.box.w / 2, y: target.box.y + target.box.h / 2 };
  const resolvedSource = source.pin
    ? endpointFromPin(source.box, source.pin)
    : source.autoPicked === false
      ? source.fallback
      : getNodeIntersection(source.box, tCenter);
  const resolvedTarget = target.pin
    ? endpointFromPin(target.box, target.pin)
    : target.autoPicked === false
      ? target.fallback
      : getNodeIntersection(target.box, sCenter);
  return { source: resolvedSource, target: resolvedTarget };
};
