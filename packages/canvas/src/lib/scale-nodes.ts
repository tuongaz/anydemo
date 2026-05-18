/**
 * US-002: pure helper that scales N nodes' positions and sizes from an
 * old-rect → new-rect transformation. Used by both the multi-select bounding
 * overlay (US-007) and the inactive-group resize path (US-006) so a single
 * geometry implementation backs every "scale a group of nodes" gesture.
 *
 * The helper is intentionally O(n) and side-effect-free: callers pass the
 * filtered selection (group children, or marquee'd loose nodes), get back a
 * fresh array, and feed it into a single `setNodes` so React Flow batches the
 * mutation into one undo entry.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScalableNode {
  id: string;
  position: { x: number; y: number };
  /** Optional rendered width; passes through unchanged when absent. */
  width?: number;
  /** Optional rendered height; passes through unchanged when absent. */
  height?: number;
  /**
   * Optional discriminator + payload — only `data.locked` is read here. The
   * helper preserves every other field via spread so callers can keep using
   * their concrete node type (e.g. React Flow's `Node<DemoNodeData>`).
   */
  data?: { locked?: boolean };
}

export interface ScaleNodesOptions {
  /**
   * When true, both axes use a single uniform scale = `Math.min(sx, sy)`. This
   * choice keeps the scaled content within the new-rect's smaller dimension —
   * never overflowing — which matches what users expect when shift-dragging a
   * corner of the multi-select overlay. The gesture caller is responsible for
   * snapping the new rect's dragged corner so the visible drag tracks the
   * cursor; here we just guarantee uniform scaling.
   */
  lockAspectRatio?: boolean;
}

/**
 * Scale `nodes` from `oldRect` into `newRect`.
 *
 * Per-axis scale: `sx = newRect.width / oldRect.width`, `sy = newRect.height /
 * oldRect.height`. Each node's position and (when present) width/height scale
 * relative to `oldRect`'s top-left origin:
 *
 *   x' = newRect.x + (x - oldRect.x) * sx
 *   y' = newRect.y + (y - oldRect.y) * sy
 *   w' = w * sx
 *   h' = h * sy
 *
 * Nodes with `data.locked === true` pass through unchanged so a single locked
 * child cannot be moved or resized by a group/multi-select scale. A zero-size
 * `oldRect` (either axis) returns the input nodes unchanged — there is no
 * meaningful "scale from a degenerate rect" so we avoid division by zero.
 */
export function scaleNodesWithinRect<T extends ScalableNode>(
  nodes: readonly T[],
  oldRect: Rect,
  newRect: Rect,
  options?: ScaleNodesOptions,
): T[] {
  if (oldRect.width === 0 || oldRect.height === 0) {
    return nodes.map((n) => ({ ...n }));
  }

  let sx = newRect.width / oldRect.width;
  let sy = newRect.height / oldRect.height;
  if (options?.lockAspectRatio) {
    const uniform = Math.min(sx, sy);
    sx = uniform;
    sy = uniform;
  }

  return nodes.map((n) => {
    if (n.data?.locked === true) return { ...n };
    const x = newRect.x + (n.position.x - oldRect.x) * sx;
    const y = newRect.y + (n.position.y - oldRect.y) * sy;
    const next: T = {
      ...n,
      position: { x, y },
    };
    if (n.width !== undefined) next.width = n.width * sx;
    if (n.height !== undefined) next.height = n.height * sy;
    return next;
  });
}
