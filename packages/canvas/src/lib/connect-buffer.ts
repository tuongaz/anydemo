/**
 * Per-node near-miss buffer (screen px) for connect / reconnect body drops.
 * Bigger nodes catch a connection from a little farther — their bulk reads as
 * "close" from farther away — while tiny nodes keep the base so they don't
 * over-grab a drop meant for empty space. The result is capped below xyflow's
 * `connectionRadius` (32) so a direct handle-snap stays the wider affordance and
 * the magnetism never reaches across a gap a user meant to leave open.
 */
export const CONNECT_BUFFER_BASE_PX = 15;
export const CONNECT_BUFFER_MAX_PX = 28;
export const CONNECT_BUFFER_FRACTION = 0.25;

export function connectBufferPx(
  rect: { width: number; height: number },
  basePx: number = CONNECT_BUFFER_BASE_PX,
): number {
  const fromSize = CONNECT_BUFFER_FRACTION * Math.min(rect.width, rect.height);
  return Math.min(CONNECT_BUFFER_MAX_PX, Math.max(basePx, fromSize));
}
