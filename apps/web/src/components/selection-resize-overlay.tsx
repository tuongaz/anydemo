import { type Rect, type ScalableNode, scaleNodesWithinRect } from '@seeflow/canvas';
import { ViewportPortal, useReactFlow } from '@xyflow/react';
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from 'react';

/**
 * US-007: multi-select bounding-box resize overlay.
 *
 * Rendered when 2+ nodes are selected. Draws a dashed bounding rect around
 * the union of the selection with 8 resize handles (4 corners + 4 edges);
 * dragging a handle scales every selected node — and its size — via the
 * shared `scaleNodesWithinRect` helper (US-002). Shift held during the drag
 * locks the aspect ratio.
 *
 * Locked nodes within the selection pass through unchanged (handled inside
 * the helper, not here). The whole batch dispatches via `onMultiResize` as a
 * single update array so the parent commits one undo entry — Cmd+Z reverts
 * every scaled node together.
 */

/** Minimum shape every node passed to the overlay must satisfy. */
export interface OverlayInputNode {
  id: string;
  position: { x: number; y: number };
  data: { width?: number; height?: number; locked?: boolean };
}

/** Per-node update emitted at resize-stop. */
export interface MultiResizeUpdate {
  id: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
}

export const SELECTION_OVERLAY_PADDING = 8;

/** Eight resize anchors. Diagonal-corner names match the cursor wiring. */
type AnchorPos = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const ALL_ANCHORS: AnchorPos[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * Union bounding rect (flow space) covering all input nodes. Reads each
 * node's position + data.width/height (the canonical persisted size — the
 * top-level React Flow `node.width/height` is only present mid-resize and
 * we resolve sizes from the demo data instead). Returns null when no node
 * has a measurable size — there's no rect to draw and no scale to apply.
 */
export function computeUnionRect(nodes: readonly OverlayInputNode[]): Rect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let saw = false;
  for (const n of nodes) {
    const w = n.data.width;
    const h = n.data.height;
    if (w === undefined || h === undefined) continue;
    saw = true;
    if (n.position.x < minX) minX = n.position.x;
    if (n.position.y < minY) minY = n.position.y;
    if (n.position.x + w > maxX) maxX = n.position.x + w;
    if (n.position.y + h > maxY) maxY = n.position.y + h;
  }
  if (!saw) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The overlay renders when ≥ 2 nodes are selected. */
export function selectionEligibleForOverlay(selected: readonly OverlayInputNode[]): boolean {
  return selected.length >= 2;
}

/**
 * Compute the post-drag rect when the cursor moves by `(dx, dy)` (flow space)
 * while dragging the named anchor. The opposite corner / edge of the rect
 * stays fixed; non-anchored axes are unaffected. When `lockAspectRatio` is
 * true the rect's aspect matches `oldRect` — the scale factor is the smaller
 * of the two axes so the bounding rect never overflows the dragged corner.
 */
export function computeNewRectFromAnchorDrag(
  oldRect: Rect,
  anchor: AnchorPos,
  dx: number,
  dy: number,
  lockAspectRatio: boolean,
): Rect {
  const left = oldRect.x;
  const right = oldRect.x + oldRect.width;
  const top = oldRect.y;
  const bottom = oldRect.y + oldRect.height;
  let newLeft = left;
  let newRight = right;
  let newTop = top;
  let newBottom = bottom;
  // East / west: drag moves the matching side. Same for north / south.
  if (anchor === 'nw' || anchor === 'w' || anchor === 'sw') newLeft = left + dx;
  if (anchor === 'ne' || anchor === 'e' || anchor === 'se') newRight = right + dx;
  if (anchor === 'nw' || anchor === 'n' || anchor === 'ne') newTop = top + dy;
  if (anchor === 'sw' || anchor === 's' || anchor === 'se') newBottom = bottom + dy;
  // Clamp degenerate rects to a 1×1 floor so the scale factor stays finite.
  if (newRight - newLeft < 1) {
    if (anchor === 'nw' || anchor === 'w' || anchor === 'sw') newLeft = newRight - 1;
    else newRight = newLeft + 1;
  }
  if (newBottom - newTop < 1) {
    if (anchor === 'nw' || anchor === 'n' || anchor === 'ne') newTop = newBottom - 1;
    else newBottom = newTop + 1;
  }
  if (lockAspectRatio && oldRect.width > 0 && oldRect.height > 0) {
    const sx = (newRight - newLeft) / oldRect.width;
    const sy = (newBottom - newTop) / oldRect.height;
    const scale = Math.min(sx, sy);
    const w = oldRect.width * scale;
    const h = oldRect.height * scale;
    // Anchor the OPPOSITE corner of the dragged corner — that's the user's
    // mental model for shift-drag (corner I'm holding follows the cursor,
    // everything else snaps to the locked ratio).
    const anchorX = anchor.includes('w') ? newRight : newLeft;
    const anchorY = anchor.includes('n') ? newBottom : newTop;
    if (anchor.includes('w')) {
      newLeft = anchorX - w;
      newRight = anchorX;
    } else {
      newRight = anchorX + w;
      newLeft = anchorX;
    }
    if (anchor.includes('n')) {
      newTop = anchorY - h;
      newBottom = anchorY;
    } else {
      newBottom = anchorY + h;
      newTop = anchorY;
    }
  }
  return {
    x: newLeft,
    y: newTop,
    width: newRight - newLeft,
    height: newBottom - newTop,
  };
}

/**
 * Pure resize-stop computation: scale `nodes` from `oldRect` → `newRect`
 * (via the shared helper) and return just the per-node fields the parent
 * needs to PATCH. Locked nodes are filtered out — the helper already passes
 * them through unchanged, so we drop them from the dispatched update set to
 * avoid no-op PATCHes and keep the parent's undo entry compact.
 */
export function computeSelectionResizeUpdates(
  nodes: readonly OverlayInputNode[],
  oldRect: Rect,
  newRect: Rect,
  options?: { lockAspectRatio?: boolean },
): MultiResizeUpdate[] {
  const scalable: ScalableNode[] = nodes.map((n) => ({
    id: n.id,
    position: { x: n.position.x, y: n.position.y },
    width: n.data.width,
    height: n.data.height,
    data: { locked: n.data.locked },
  }));
  const scaled = scaleNodesWithinRect(scalable, oldRect, newRect, options);
  const updates: MultiResizeUpdate[] = [];
  for (let i = 0; i < scaled.length; i++) {
    const src = nodes[i];
    const out = scaled[i];
    if (!src || !out) continue;
    if (src.data.locked === true) continue;
    const u: MultiResizeUpdate = { id: out.id, position: out.position };
    if (out.width !== undefined) u.width = out.width;
    if (out.height !== undefined) u.height = out.height;
    updates.push(u);
  }
  return updates;
}

const ANCHOR_CURSOR: Record<AnchorPos, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

/**
 * Pixel offset (within the padded overlay rect) for each anchor. Anchors
 * sit 0% / 50% / 100% along each axis; the wrapping div's `translate(-50%,
 * -50%)` centers each handle on that point.
 */
const ANCHOR_OFFSET: Record<AnchorPos, { left: string; top: string }> = {
  nw: { left: '0%', top: '0%' },
  n: { left: '50%', top: '0%' },
  ne: { left: '100%', top: '0%' },
  e: { left: '100%', top: '50%' },
  se: { left: '100%', top: '100%' },
  s: { left: '50%', top: '100%' },
  sw: { left: '0%', top: '100%' },
  w: { left: '0%', top: '50%' },
};

const HANDLE_BOX_PX = 10;

export interface SelectionResizeOverlayProps {
  /**
   * Selected nodes the overlay scales. The parent (DemoCanvas) is responsible
   * for filtering: pass the live multi-selection in. The overlay decides
   * presence via `selectionEligibleForOverlay`, so callers can wire this
   * unconditionally.
   */
  selectedNodes: readonly OverlayInputNode[];
  /**
   * Atomic batch dispatch at resize-stop. The canvas hands the array to the
   * parent (demo-view), which fans out PATCHes + pushes one undo entry so
   * Cmd+Z reverts the whole scale. Locked nodes are filtered out before
   * dispatch (no-op PATCHes would just churn the undo log).
   */
  onMultiResize?: (updates: MultiResizeUpdate[]) => void;
  /** Padding around the union rect in flow units. Defaults to 8 per the AC. */
  paddingPx?: number;
}

interface DragState {
  anchor: AnchorPos;
  oldRect: Rect;
  startCursor: { x: number; y: number };
  pointerId: number;
}

/**
 * US-016: schedule a per-tick dispatch on the next animation frame, replacing
 * any previously scheduled one for the same gesture. Caps live multi-resize
 * updates at the browser's repaint cadence (~60fps) so a fast drag doesn't
 * spam the parent with more updates per second than it can repaint.
 *
 * The fn argument captures the latest pre-rAF state (closure over current
 * dragState + selectedNodes + newRect); it always represents the freshest
 * scheduled dispatch, not a stale one.
 *
 * Exported for testing — call sites should use it via the overlay's own
 * pointer-move handler.
 */
export function scheduleRaf(rafRef: { current: number | null }, fn: () => void): void {
  if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  rafRef.current = requestAnimationFrame(() => {
    rafRef.current = null;
    fn();
  });
}

/**
 * Render-side test seam: when `selectionEligibleForOverlay` returns false the
 * component returns null so the parent canvas can wire the overlay
 * unconditionally and not worry about the gating logic.
 */
export function SelectionResizeOverlay({
  selectedNodes,
  onMultiResize,
  paddingPx = SELECTION_OVERLAY_PADDING,
}: SelectionResizeOverlayProps) {
  const reactFlow = useReactFlow();
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [previewRect, setPreviewRect] = useState<Rect | null>(null);
  // Track the in-flight modifier state so a Shift release mid-drag flips
  // back to free-resize without waiting for the next pointer-move event.
  const shiftHeldRef = useRef(false);
  // US-016: pending per-tick dispatch handle; cancelled on every new move.
  const liveDispatchRafRef = useRef<number | null>(null);

  if (!selectionEligibleForOverlay(selectedNodes)) return null;
  const unionRect = computeUnionRect(selectedNodes);
  if (!unionRect) return null;

  const liveRect = previewRect ?? unionRect;
  const paddedRect: Rect = {
    x: liveRect.x - paddingPx,
    y: liveRect.y - paddingPx,
    width: liveRect.width + paddingPx * 2,
    height: liveRect.height + paddingPx * 2,
  };

  const onHandlePointerDown = (anchor: AnchorPos) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const flowStart = reactFlow.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });
    shiftHeldRef.current = event.shiftKey;
    setDragState({
      anchor,
      oldRect: unionRect,
      startCursor: flowStart,
      pointerId: event.pointerId,
    });
    setPreviewRect(unionRect);
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
  };

  const onHandlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState) return;
    if (event.pointerId !== dragState.pointerId) return;
    shiftHeldRef.current = event.shiftKey;
    const flowCursor = reactFlow.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });
    const dx = flowCursor.x - dragState.startCursor.x;
    const dy = flowCursor.y - dragState.startCursor.y;
    const newRect = computeNewRectFromAnchorDrag(
      dragState.oldRect,
      dragState.anchor,
      dx,
      dy,
      event.shiftKey,
    );
    setPreviewRect(newRect);
    // US-016: per-tick live dispatch. Children scale continuously as the user
    // drags, not only at pointer-up. rAF-throttled so we cap at ~60fps even
    // on a fast trackpad emitting hundreds of pointermove events/sec. Demo-
    // view's `onMultiResize` coalesces every tick into one undo entry via the
    // shared coalesceKey, so this loop produces exactly ONE Cmd+Z reversion.
    if (onMultiResize) {
      const lockAspect = event.shiftKey;
      const oldRectAtStart = dragState.oldRect;
      const nodesAtTick = selectedNodes;
      scheduleRaf(liveDispatchRafRef, () => {
        const updates = computeSelectionResizeUpdates(nodesAtTick, oldRectAtStart, newRect, {
          lockAspectRatio: lockAspect,
        });
        if (updates.length > 0) onMultiResize(updates);
      });
    }
  };

  const onHandlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState) return;
    if (event.pointerId !== dragState.pointerId) return;
    const flowCursor = reactFlow.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });
    const dx = flowCursor.x - dragState.startCursor.x;
    const dy = flowCursor.y - dragState.startCursor.y;
    const newRect = computeNewRectFromAnchorDrag(
      dragState.oldRect,
      dragState.anchor,
      dx,
      dy,
      event.shiftKey,
    );
    // US-016: cancel any pending per-tick rAF so the final dispatch below is
    // the last word — otherwise a coalesced rAF could fire after pointer-up
    // with a stale rect.
    if (liveDispatchRafRef.current !== null) {
      cancelAnimationFrame(liveDispatchRafRef.current);
      liveDispatchRafRef.current = null;
    }
    setDragState(null);
    setPreviewRect(null);
    shiftHeldRef.current = false;
    try {
      (event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId);
    } catch {
      // releasePointerCapture throws when the element no longer has capture
      // (e.g. unmounted between move + up). The cleanup is best-effort.
    }
    if (!onMultiResize) return;
    if (
      newRect.x === dragState.oldRect.x &&
      newRect.y === dragState.oldRect.y &&
      newRect.width === dragState.oldRect.width &&
      newRect.height === dragState.oldRect.height
    ) {
      // Zero-movement drag → no-op (don't pollute the undo log).
      return;
    }
    const updates = computeSelectionResizeUpdates(selectedNodes, dragState.oldRect, newRect, {
      lockAspectRatio: event.shiftKey,
    });
    if (updates.length > 0) onMultiResize(updates);
  };

  const onHandlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    if (liveDispatchRafRef.current !== null) {
      cancelAnimationFrame(liveDispatchRafRef.current);
      liveDispatchRafRef.current = null;
    }
    setDragState(null);
    setPreviewRect(null);
    shiftHeldRef.current = false;
  };

  // Visual chrome (dashed bounding rect + 8 corner/edge resize handles) was
  // removed — marquee selection no longer paints any wrapper around the union
  // of selected nodes. The component still mounts so its prop wiring (and the
  // exported pure helpers below) remain available; the rendered output is
  // empty.
  void paddedRect;
  void onHandlePointerDown;
  void onHandlePointerMove;
  void onHandlePointerUp;
  void onHandlePointerCancel;
  return null;
}
