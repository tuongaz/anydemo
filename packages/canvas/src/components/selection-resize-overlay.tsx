import { ViewportPortal, useReactFlow } from '@xyflow/react';
import { Group as GroupIcon, Ungroup as UngroupIcon } from 'lucide-react';
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from 'react';
import { type Rect, type ScalableNode, scaleNodesWithinRect } from '../lib/scale-nodes.ts';
import { Button } from '../ui/button.tsx';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip.tsx';

/**
 * US-007 + canvas grouping M2: multi-select / group bounding-box overlay.
 *
 * Renders a padded dashed bounding rect around the union of the selection with
 * **4 corner handles** (req #2 asks for corners only; the 4 edge handles v1 had
 * are dropped). It shows for two situations (design §12.5):
 *  - a transient multi-selection of 2+ loose nodes, OR
 *  - exactly one selected `group` (the caller passes the group's MEMBERS plus
 *    the group box as `selectedNodes` so the rect hugs the right geometry).
 *
 * M3 wires functional proportional resize on top of the M2 chrome. The pointer
 * handlers freeze a baseline (`startRect` + `startNodes`) at pointer-down, drive
 * a local `previewRect` during the drag (visual only — no real-node mutation),
 * and on pointer-up dispatch ONE batched `onMultiResize` computed from the
 * FROZEN pair via `scaleNodesWithinRect` (end-only commit, design §6.3). The
 * frozen baseline is the non-negotiable guard against the v1 order-of-magnitude
 * bug (design §6.1 / L0.1): the scale must read `startNodes`, never the live
 * (optimistically-overridden) `selectedNodes`.
 */

/**
 * Minimum shape every node passed to the overlay must satisfy.
 *
 * `width`/`height` are the CALLER-RESOLVED dimensions (design §12.1): the host
 * resolves each via `getInternalNode(id)?.measured ?? data.width/height ??
 * fallback` so auto-sized html/component nodes (which lack `data.width/height`)
 * still contribute to the union rect. `data.width/height` remain as a fallback
 * for callers/tests that pass raw data. `type` lets the overlay/host reason
 * about a group selection (design §12.5).
 */
export interface OverlayInputNode {
  id: string;
  position: { x: number; y: number };
  /** Caller-resolved width (measured ?? data ?? fallback). Preferred over data.width. */
  width?: number;
  /** Caller-resolved height (measured ?? data ?? fallback). Preferred over data.height. */
  height?: number;
  /** Node type — present so gating can recognise a single selected group. */
  type?: string;
  data: { width?: number; height?: number };
}

/** Per-node update emitted at resize-stop. */
export interface MultiResizeUpdate {
  id: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
}

/**
 * Padding (flow units) between the selection's union rect and the dashed
 * overlay rect. Bumped 8 → 12 for canvas grouping M2 (req #1, "a bit extra
 * padding"). Pinned by a test so the value can't drift silently.
 */
export const SELECTION_OVERLAY_PADDING = 12;

/** Eight resize anchor names. Cursor + offset maps are keyed by these. */
type AnchorPos = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/**
 * Canvas grouping M2 renders **corners only** (req #2). The 4 edge anchors
 * ('n'/'e'/'s'/'w') from v1 are intentionally dropped.
 */
export const CORNER_ANCHORS: readonly AnchorPos[] = ['nw', 'ne', 'se', 'sw'];

/**
 * Resolve a node's effective size, preferring the caller-resolved top-level
 * `width`/`height` (measured ?? data ?? fallback per design §12.1) and falling
 * back to `data.width`/`data.height` for callers/tests that only set `data`.
 */
function resolveNodeSize(n: OverlayInputNode): { w: number | undefined; h: number | undefined } {
  return {
    w: n.width ?? n.data.width,
    h: n.height ?? n.data.height,
  };
}

/**
 * Union bounding rect (flow space) covering all input nodes. Resolves each
 * node's size via {@link resolveNodeSize} — the caller-resolved measured dims
 * take precedence so auto-sized html/component nodes (which lack
 * `data.width/height`) still contribute to the rect (design §12.1). Returns
 * null when no node has a measurable size — there's no rect to draw.
 */
export function computeUnionRect(nodes: readonly OverlayInputNode[]): Rect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let saw = false;
  for (const n of nodes) {
    const { w, h } = resolveNodeSize(n);
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

/**
 * The overlay renders when there is something resize-able to chrome (design
 * §12.5):
 *  - a transient multi-selection of **2+ loose nodes**, OR
 *  - a single selected **group** (`isGroupSelection`), where `selected` is the
 *    group's members + the group box, so a one-member group still gets chrome.
 *
 * `isGroupSelection` is threaded from the host (which knows the real selection
 * and node types) because `OverlayInputNode` is intentionally minimal.
 */
export function selectionEligibleForOverlay(
  selected: readonly OverlayInputNode[],
  isGroupSelection = false,
): boolean {
  if (isGroupSelection) return selected.length >= 1;
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
 * needs to PATCH.
 */
export function computeSelectionResizeUpdates(
  nodes: readonly OverlayInputNode[],
  oldRect: Rect,
  newRect: Rect,
  options?: { lockAspectRatio?: boolean },
): MultiResizeUpdate[] {
  const scalable: ScalableNode[] = nodes.map((n) => {
    const { w, h } = resolveNodeSize(n);
    return {
      id: n.id,
      position: { x: n.position.x, y: n.position.y },
      width: w,
      height: h,
    };
  });
  const scaled = scaleNodesWithinRect(scalable, oldRect, newRect, options);
  const updates: MultiResizeUpdate[] = [];
  for (const out of scaled) {
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

/**
 * Visual square size (screen px) of each corner handle. The inline style
 * inverse-scales this by `--rf-zoom` (see `resize-controls.tsx`) so the box
 * reads the same on-screen size at every zoom level.
 */
const HANDLE_BOX_PX = 10;

/**
 * Frozen snapshot of one node at pointer-down. M2 doesn't read it (the gesture
 * is inert) but M3's proportional resize needs the FULL node set frozen, not
 * just `startRect` — freezing only the rect lets the optimistic-override echo
 * compound the scale (design §6.1, L0.1). Capturing it now means M3 drops in
 * `scaleNodesWithinRect(startNodes, startRect, newRect)` without restructuring.
 */
export interface FrozenNode {
  id: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
}

/**
 * M3 end-only commit (design §6.3): scale the FROZEN `startNodes` from
 * `startRect` → `newRect` and return the per-node PATCH fields.
 *
 * THIS IS THE NON-COMPOUNDING PATH. `startNodes` is the deep copy captured at
 * pointer-down (design §6.2); the caller MUST pass that frozen set, NEVER the
 * live `selectedNodes` (which carries the optimistic-override echo). Feeding the
 * live set back each tick is exactly the v1 "order of magnitude" bug
 * (`w·sx·sx·…`, design §6.1 / L0.1) — see the no-compounding tripwire test.
 *
 * A `FrozenNode` is structurally a `ScalableNode`, so the pure
 * `scaleNodesWithinRect` helper (untouched, design §6 rule 6) does the math.
 * Nodes without width/height (e.g. freehand strokes — geometry lives in
 * `data.points`, design §12.6) reposition but do NOT internally scale: the
 * helper leaves their size undefined and `data` is never part of the update.
 */
export function computeFrozenResizeUpdates(
  startNodes: readonly FrozenNode[],
  startRect: Rect,
  newRect: Rect,
  options?: { lockAspectRatio?: boolean },
): MultiResizeUpdate[] {
  const scaled = scaleNodesWithinRect(startNodes, startRect, newRect, options);
  const updates: MultiResizeUpdate[] = [];
  for (const out of scaled) {
    const u: MultiResizeUpdate = { id: out.id, position: out.position };
    if (out.width !== undefined) u.width = out.width;
    if (out.height !== undefined) u.height = out.height;
    updates.push(u);
  }
  return updates;
}

export interface SelectionResizeOverlayProps {
  /**
   * Selected nodes the overlay chromes. The host (seeflow-canvas) resolves dims
   * (§12.1) and, for a single group, passes the group's MEMBERS + the group box
   * (§12.5). The overlay decides presence via `selectionEligibleForOverlay`, so
   * callers wire this unconditionally.
   */
  selectedNodes: readonly OverlayInputNode[];
  /**
   * True when the selection is exactly one group (host-determined). Switches
   * gating to "≥1 node" (a group with members) and is the seam M4 uses to flip
   * the top-right icon from ＋ (create) to ⊟ (ungroup).
   */
  isGroupSelection?: boolean;
  /**
   * Atomic batch dispatch at resize-stop (M3). Called ONCE on pointer-up with
   * the per-node position+size updates computed from the FROZEN baseline
   * (`startNodes` + `startRect`, design §6.3) — end-only commit, so the host
   * batches it as a single undo entry. Locked/absent sizes pass through
   * unchanged (the pure helper leaves them undefined). When absent the chrome
   * still renders for visual feedback but the gesture dispatches nothing.
   */
  onMultiResize?: (updates: MultiResizeUpdate[]) => void;
  /**
   * M4: fired when the user clicks the top-right ＋/⊟ icon. The host (which knows
   * the real selection) binds this to `onCreateGroup(selectedNodeIds)` for a
   * loose multi-selection or `onUngroup(groupId)` for a single group — the
   * overlay stays agnostic about ids and only toggles the icon/label by
   * `isGroupSelection`. When absent the icon is not rendered (no affordance for
   * read-only callers).
   */
  onGroupAction?: () => void;
  /** Padding around the union rect in flow units. Defaults to {@link SELECTION_OVERLAY_PADDING} (12). */
  paddingPx?: number;
}

/**
 * Display shortcut for the create / ungroup action, shown in the icon's tooltip.
 * Mirrors the seeflow-canvas context-menu's inline ⌘/Ctrl detection (the
 * keyboard-shortcuts `formatShortcut` is overkill for two fixed chords here).
 */
const GROUP_IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
export const CREATE_GROUP_SHORTCUT = GROUP_IS_MAC ? '⌘G' : 'Ctrl+G';
export const UNGROUP_SHORTCUT = GROUP_IS_MAC ? '⌘⇧G' : 'Ctrl+Shift+G';

interface DragState {
  anchor: AnchorPos;
  /** Frozen union rect at pointer-down. */
  oldRect: Rect;
  /** Frozen per-node geometry at pointer-down (design §6.2 — M3 scales from this). */
  startNodes: FrozenNode[];
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

/** Inverse-zoom expression so a screen-px value reads constant across zoom. */
function invZoom(px: number): string {
  return `calc(${px}px / var(--rf-zoom, 1))`;
}

/**
 * Canvas grouping M2/M3: padded dashed selection rect + 4 corner handles that
 * proportionally resize the selection.
 *
 * Returns null (no chrome) unless {@link selectionEligibleForOverlay} passes:
 * 2+ loose nodes, OR one selected group (`isGroupSelection`). Rendered inside a
 * `ViewportPortal` so it tracks pan/zoom with the rest of the canvas.
 *
 * M3 resize contract (design §6): pointer-down freezes the baseline (`oldRect`
 * + `startNodes`, a deep copy); pointer-move drives a LOCAL `previewRect` only
 * (no real-node mutation); pointer-up dispatches ONE `onMultiResize` computed
 * from the FROZEN pair (end-only commit → one undo entry). The scale reads
 * `startNodes`, NEVER the live `selectedNodes` — that is the guard against the
 * v1 order-of-magnitude bug (L0.1).
 */
export function SelectionResizeOverlay({
  selectedNodes,
  isGroupSelection = false,
  onMultiResize,
  onGroupAction,
  paddingPx = SELECTION_OVERLAY_PADDING,
}: SelectionResizeOverlayProps) {
  const reactFlow = useReactFlow();
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [previewRect, setPreviewRect] = useState<Rect | null>(null);
  // Track the in-flight modifier state so a Shift release mid-drag flips
  // back to free-resize without waiting for the next pointer-move event.
  const shiftHeldRef = useRef(false);

  if (!selectionEligibleForOverlay(selectedNodes, isGroupSelection)) return null;
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
    // Freeze BOTH the union rect AND the per-node geometry (design §6.2). M2
    // doesn't read `startNodes`, but M3's scale must read the frozen set, never
    // the live (optimistically-overridden) `selectedNodes` — that's the L0.1
    // compounding trap. Capturing it here keeps M3 a drop-in.
    const startNodes: FrozenNode[] = selectedNodes.map((n) => {
      const { w, h } = resolveNodeSize(n);
      return {
        id: n.id,
        position: { x: n.position.x, y: n.position.y },
        width: w,
        height: h,
      };
    });
    setDragState({
      anchor,
      oldRect: unionRect,
      startNodes,
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
    // END-ONLY commit (design §6.3): update the LOCAL preview rect only — do NOT
    // dispatch `onMultiResize` or mutate real nodes per tick. The real commit
    // fires once from the frozen baseline in onHandlePointerUp. Keeping the drag
    // preview-only is also what makes compounding structurally impossible: no
    // optimistic override is written mid-gesture, so there is no echo to scale.
    setPreviewRect(newRect);
  };

  const onHandlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState) return;
    if (event.pointerId !== dragState.pointerId) return;
    // M3 END-ONLY COMMIT (design §6.3). Recompute the final rect from the FROZEN
    // start rect + the cursor delta, then dispatch ONE batched `onMultiResize`
    // computed from the FROZEN `startNodes` — never the live `selectedNodes`.
    // Reading the frozen pair is the entire fix for the v1 order-of-magnitude
    // bug (design §6.1 / L0.1): the live set carries the optimistic-override
    // echo, so scaling it would compound (`w·sx·sx·…`). See the no-compounding
    // tripwire test.
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
    // Snapshot the frozen pair before we clear `dragState` below.
    const startRect = dragState.oldRect;
    const startNodes = dragState.startNodes;
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
      newRect.x === startRect.x &&
      newRect.y === startRect.y &&
      newRect.width === startRect.width &&
      newRect.height === startRect.height
    ) {
      // Zero-movement drag (e.g. a click on a handle without dragging) → no-op
      // so we don't pollute the undo log with an identity resize.
      return;
    }
    // NOTE: `startNodes` (the frozen deep copy), NOT `selectedNodes`. A future
    // refactor MUST keep this — reintroducing the live set here is the exact
    // regression the tripwire test guards against.
    const updates = computeFrozenResizeUpdates(startNodes, startRect, newRect, {
      lockAspectRatio: event.shiftKey,
    });
    if (updates.length > 0) onMultiResize(updates);
  };

  const onHandlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    setDragState(null);
    setPreviewRect(null);
    shiftHeldRef.current = false;
  };

  // The rect div lives in FLOW space (ViewportPortal applies the viewport
  // transform), so its position/size are flow units. Handles + icon must read a
  // CONSTANT on-screen size, so their box dims / border / offset are
  // inverse-scaled by `--rf-zoom` (the same compensation resize-controls.tsx
  // uses) — set on `.seeflow-canvas-root` by seeflow-canvas's viewport effect.
  const rectStyle: CSSProperties = {
    position: 'absolute',
    left: paddedRect.x,
    top: paddedRect.y,
    width: paddedRect.width,
    height: paddedRect.height,
    border: `${invZoom(1)} dashed hsl(var(--primary) / 0.6)`,
    // The rect must NEVER steal node clicks — only the handles + (future) icon
    // are interactive (design §12.8, mirrors `.react-flow__nodesselection-rect`
    // neutralization). xyflow's selection-drag underneath still moves the group.
    pointerEvents: 'none',
    // Above nodes (max node z is the selected 1000) + above a selected group's
    // negative z; NOT a node so the group's -1 doesn't apply (L1.1).
    zIndex: 1500,
    boxSizing: 'border-box',
  };

  return (
    <ViewportPortal>
      <div data-testid="selection-overlay" style={rectStyle}>
        {CORNER_ANCHORS.map((anchor) => {
          const offset = ANCHOR_OFFSET[anchor];
          const handleStyle: CSSProperties = {
            position: 'absolute',
            left: offset.left,
            top: offset.top,
            width: invZoom(HANDLE_BOX_PX),
            height: invZoom(HANDLE_BOX_PX),
            transform: 'translate(-50%, -50%)',
            background: 'hsl(var(--background))',
            border: `${invZoom(1)} solid hsl(var(--primary) / 0.6)`,
            borderRadius: invZoom(2),
            cursor: ANCHOR_CURSOR[anchor],
            // Only the handles are interactive — the parent rect is neutralized.
            pointerEvents: 'auto',
            touchAction: 'none',
          };
          return (
            <div
              key={anchor}
              data-testid={`selection-overlay-handle-${anchor}`}
              data-anchor={anchor}
              role="button"
              // Pointer-driven only; keyboard-driven resize is out of scope this
              // feature (design §12.11). tabIndex={-1} keeps the handle out of the
              // tab sequence while still satisfying the focusable-interactive rule.
              tabIndex={-1}
              aria-label="Resize selection"
              style={handleStyle}
              onPointerDown={onHandlePointerDown(anchor)}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              onPointerCancel={onHandlePointerCancel}
            />
          );
        })}
        {/* Top-right icon (req #3) anchored just outside the rect's NE corner.
            32×32 zoom-compensated ghost button: ＋ "Create group" for a loose
            multi-selection, ⊟ "Ungroup" for a single selected group. The slot
            stays present (constant testid) for layout/test stability; the button
            mounts only when the host wired `onGroupAction`. */}
        <div
          data-testid="selection-overlay-icon-slot"
          style={{
            position: 'absolute',
            left: '100%',
            top: 0,
            width: invZoom(32),
            height: invZoom(32),
            transform: `translate(${invZoom(4)}, calc(-100% - ${invZoom(4)}))`,
            // Only interactive when an action is wired; the rect itself stays
            // non-interactive so it never steals node clicks (design §12.8).
            pointerEvents: onGroupAction ? 'auto' : 'none',
          }}
        >
          {/* ＋ create / ⊟ ungroup button — INLINED (not a sub-component) so the
              `data-testid` lands directly in the overlay's element tree (the
              dispatcher-shim test walks JSX without executing child components).
              A 32×32 ghost Button + Tooltip mirroring `inspector-toggle.tsx`,
              filling the zoom-compensated slot (h-/w-full) so it reads a
              constant on-screen size. The aria-label toggles ＋↔⊟ with
              `isGroupSelection`; the glyph is `aria-hidden` (design §12.11);
              `data-action` reflects the mode for browser tests. */}
          {onGroupAction ? (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-testid="selection-overlay-group-action"
                    data-action={isGroupSelection ? 'ungroup' : 'create'}
                    aria-label={isGroupSelection ? 'Ungroup' : 'Create group'}
                    onClick={(e) => {
                      // Don't let the click bubble into the pane (which would
                      // clear the selection before the host reads it).
                      e.stopPropagation();
                      onGroupAction();
                    }}
                    onPointerDown={(e) => {
                      // Keep the press off the pane/handles so it can't start a
                      // marquee or a resize gesture.
                      e.stopPropagation();
                    }}
                    className="sf:h-full sf:w-full sf:border sf:border-border sf:bg-background sf:shadow-sm"
                  >
                    {isGroupSelection ? (
                      <UngroupIcon className="sf:h-4 sf:w-4" aria-hidden="true" />
                    ) : (
                      <GroupIcon className="sf:h-4 sf:w-4" aria-hidden="true" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isGroupSelection
                    ? `Ungroup (${UNGROUP_SHORTCUT})`
                    : `Create group (${CREATE_GROUP_SHORTCUT})`}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>
      </div>
    </ViewportPortal>
  );
}
