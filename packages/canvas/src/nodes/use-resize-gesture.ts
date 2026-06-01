import type { OnResize, OnResizeEnd, OnResizeStart, ResizeParams } from '@xyflow/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GuideLine, Rect, ResizeEdges } from '../alignment/geometry.ts';

/**
 * The resize subset of `useAlignmentGuides`'s API (see
 * `src/alignment/use-alignment-guides.ts`). `useResizeGesture` accepts this
 * (structurally) so it can snap the moving edge(s) of a resize gesture to
 * neighbouring nodes and surface the live guide lines — without importing the
 * hook directly (the canvas injects a stable delegating object through
 * `data.resizeAlignment`). Modes/flags decide whether it's present.
 */
export interface ResizeAlignmentHooks {
  beginResize(nodeId: string, activeEdges: ResizeEdges): void;
  applyResizeSnap(
    rawRect: Rect,
    event: { metaKey?: boolean; ctrlKey?: boolean },
  ): { snappedRect: Rect; guides: GuideLine[] };
  endResize(): void;
}

/** xyflow's resize handlers carry the underlying DOM event under `sourceEvent`. */
function modifierFrom(event: unknown): { metaKey?: boolean; ctrlKey?: boolean } {
  const source = (event as { sourceEvent?: { metaKey?: boolean; ctrlKey?: boolean } } | undefined)
    ?.sourceEvent;
  return { metaKey: source?.metaKey, ctrlKey: source?.ctrlKey };
}

/**
 * Derive which edges of the rect are moving by comparing the current resize
 * dims against the rect captured at gesture start. A right-handle drag keeps
 * the origin x fixed and only the right edge (x+width) moves; a left-handle
 * drag moves the origin x while the right edge stays put; corners move two
 * edges. This is robust regardless of grow/shrink direction and needs no
 * handle-position threading (all 8 controls share one gesture handler).
 */
function deriveActiveEdges(
  start: ResizeParams,
  next: { x: number; y: number; width: number; height: number },
): ResizeEdges {
  return {
    left: next.x !== start.x,
    right: next.x + next.width !== start.x + start.width,
    top: next.y !== start.y,
    bottom: next.y + next.height !== start.y + start.height,
  };
}

function hasActiveEdge(edges: ResizeEdges): boolean {
  return !!(edges.left || edges.right || edges.top || edges.bottom);
}

/**
 * Wraps a NodeResizeControl gesture so a click on a resize handle (mousedown
 * + mouseup with no movement) is a no-op. React Flow fires onResizeStart AND
 * onResizeEnd unconditionally — without this guard, a click would call
 * data.onResize with the current measured dims, promoting a previously
 * unsized node to a sized one and visibly expanding it.
 *
 * US-016: also exposes an `onResize` (per-tick) handler that fires the user's
 * `onResize` callback on every xyflow resize tick — so child nodes / overlay
 * payloads update LIVE during the drag, not just on release. The same
 * callback is invoked at `onResizeEnd` (back-compat: existing tests + the
 * click-guard branch still flow through there). The end-fired call carries
 * the SAME dims as the last per-tick call, so demo-view's optimistic
 * overrides + the coalesced undo key make the redundant dispatch a no-op
 * visually (one undo entry per gesture; PATCHes are idempotent on the
 * server).
 *
 * The returned callbacks are STABLE across renders (refs back the user-
 * provided callbacks). This is critical: xyflow's `NodeResizeControl` has an
 * effect that calls `resizer.update({ onResize, onResizeStart, onResizeEnd })`
 * whenever any of those props change, and `update()` resets the d3-drag
 * `startValues` to zeros. If our wrapper passed a fresh function reference
 * every render (which happened during a live drag because each tick's
 * setState re-rendered the canvas), `startValues` got wiped mid-gesture and
 * the next pointer-move computed `newWidth = startValues.width(=0) - distX`
 * — i.e. a wildly wrong absolute size keyed off cursor position alone. The
 * visible symptom was the resized node exponentially expanding/shrinking as
 * the mouse moved.
 */
export function useResizeGesture(args: {
  onResize?: (dims: ResizeParams) => void;
  /**
   * End-only callback. Fires once at mouse release with the FINAL dims, when
   * actual movement happened (zero-movement click is guarded out). Use this
   * for persistence (backend PATCH + undo push) so a single drag produces one
   * round-trip instead of one per tick. Fires AFTER the back-compat end-fired
   * `onResize` call below, BEFORE `onResizeFinal`.
   */
  onResizeEnd?: (dims: ResizeParams) => void;
  /**
   * End-only callback. Fires once at mouse release with the FINAL dims and the
   * ORIGINAL dims captured at resize-start. Use this for batched mutations
   * that shouldn't run on every tick (e.g. group child scaling, where the
   * per-tick path produced exponential expand/shrink as feedback from the
   * optimistic override mutated the next tick's baseline). Fires AFTER the
   * end-fired `onResize` call below.
   */
  onResizeFinal?: (dims: ResizeParams, start: ResizeParams) => void;
  setResizing?: (on: boolean) => void;
  /**
   * US-005: the id of the node this gesture resizes. Required for alignment
   * snapping (the alignment hook keys its reference snapshot off it). Omit to
   * disable alignment for this gesture.
   */
  nodeId?: string;
  /**
   * US-005: alignment-guide integration. When present (alignment guides
   * enabled), the gesture snaps the moving edge(s) to neighbouring nodes and
   * surfaces live guide lines. The snapped dims flow through `onResize` /
   * `onResizeEnd` so the persisted footprint matches the on-screen guide.
   */
  alignment?: ResizeAlignmentHooks;
}) {
  // Destructure with rename so the input `onResizeEnd` doesn't collide with
  // the returned xyflow `OnResizeEnd` handler below.
  const {
    onResize,
    onResizeEnd: userOnResizeEnd,
    onResizeFinal,
    setResizing,
    nodeId,
    alignment,
  } = args;
  const [isResizing, setIsResizing] = useState(false);
  const startRef = useRef<ResizeParams | null>(null);
  // US-005: whether alignment.beginResize has fired this gesture. The first
  // moved tick (where active edges become derivable) flips it; cleared on end.
  const resizeBegunRef = useRef(false);

  // Mirror the user-provided callbacks into refs so the OnResize* handlers
  // returned below can stay reference-stable. xyflow's internal effect
  // depends on these references — see the top-of-file note for why a fresh
  // reference per render breaks the gesture mid-drag.
  const onResizeRef = useRef(onResize);
  const userOnResizeEndRef = useRef(userOnResizeEnd);
  const onResizeFinalRef = useRef(onResizeFinal);
  const setResizingRef = useRef(setResizing);
  // US-005: mirror the alignment integration + nodeId so the returned handlers
  // stay reference-stable (xyflow's NodeResizeControl resets its drag baseline
  // when handler identity changes — see the top-of-file note).
  const alignmentRef = useRef(alignment);
  const nodeIdRef = useRef(nodeId);
  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);
  useEffect(() => {
    userOnResizeEndRef.current = userOnResizeEnd;
  }, [userOnResizeEnd]);
  useEffect(() => {
    onResizeFinalRef.current = onResizeFinal;
  }, [onResizeFinal]);
  useEffect(() => {
    setResizingRef.current = setResizing;
  }, [setResizing]);
  useEffect(() => {
    alignmentRef.current = alignment;
  }, [alignment]);
  useEffect(() => {
    nodeIdRef.current = nodeId;
  }, [nodeId]);

  const onResizeStart = useCallback<OnResizeStart>((_e, params) => {
    setIsResizing(true);
    setResizingRef.current?.(true);
    resizeBegunRef.current = false;
    startRef.current = params
      ? { x: params.x, y: params.y, width: params.width, height: params.height }
      : null;
  }, []);

  // US-016: per-tick handler — fires `onResize` on every xyflow tick so the
  // canvas (and any group children / multi-select overlay) updates live.
  // US-005: when alignment is wired, snap the moving edge(s) of the rect first
  // and dispatch the snapped dims; the alignment hook also commits the live
  // guide lines to its own state (rendered by the overlay mounted in US-004).
  const onResizeEvent = useCallback<OnResize>((event, params) => {
    let dims = { x: params.x, y: params.y, width: params.width, height: params.height };
    const align = alignmentRef.current;
    const id = nodeIdRef.current;
    const start = startRef.current;
    if (align && id && start) {
      // Derive moving edges from start vs current once movement begins, then
      // freeze the gesture's reference snapshot via beginResize.
      if (!resizeBegunRef.current) {
        const edges = deriveActiveEdges(start, params);
        if (hasActiveEdge(edges)) {
          align.beginResize(id, edges);
          resizeBegunRef.current = true;
        }
      }
      if (resizeBegunRef.current) {
        const { snappedRect } = align.applyResizeSnap(
          { id, x: params.x, y: params.y, w: params.width, h: params.height },
          modifierFrom(event),
        );
        dims = {
          x: snappedRect.x,
          y: snappedRect.y,
          width: snappedRect.w,
          height: snappedRect.h,
        };
      }
    }
    onResizeRef.current?.(dims);
  }, []);

  const onResizeEnd = useCallback<OnResizeEnd>((event, params) => {
    setIsResizing(false);
    setResizingRef.current?.(false);
    const start = startRef.current;
    startRef.current = null;
    const begun = resizeBegunRef.current;
    resizeBegunRef.current = false;
    const align = alignmentRef.current;
    const id = nodeIdRef.current;
    // No movement → treat as click, don't persist. Size equality is the
    // primary signal; corner handles can nudge x/y a sub-pixel without a
    // real resize, so we gate on width+height equality only. Equality is
    // checked against the RAW params (the actual gesture movement), not the
    // snapped dims. Drop any in-flight alignment state on the click path too.
    if (start && start.width === params.width && start.height === params.height) {
      if (begun) align?.endResize();
      return;
    }
    // US-005: snap the final dims so the persisted footprint matches the live
    // guide. applyResizeSnap MUST run before endResize (which clears the
    // resize refs + cancels the pending guide commit).
    let dims = { x: params.x, y: params.y, width: params.width, height: params.height };
    if (align && id && begun) {
      const { snappedRect } = align.applyResizeSnap(
        { id, x: params.x, y: params.y, w: params.width, h: params.height },
        modifierFrom(event),
      );
      dims = {
        x: snappedRect.x,
        y: snappedRect.y,
        width: snappedRect.w,
        height: snappedRect.h,
      };
    }
    align?.endResize();
    // US-016: per-tick handler already dispatched the final dims during the
    // gesture. The end-fired call is redundant when ticks have run, but kept
    // for back-compat with tests + the unlikely "no per-tick, only end"
    // path. Same-dims dispatch is idempotent under the coalesced-undo +
    // overrides design — no visual double-update.
    onResizeRef.current?.(dims);
    // End-only callback for persistence (backend PATCH + undo). Fires once
    // per real-movement gesture so one drag = one round-trip instead of one
    // per tick. Guarded by the same zero-movement check above — a click on
    // the handle without movement does not persist.
    userOnResizeEndRef.current?.(dims);
    // End-only callback for batched mutations that must wait for the final
    // dims (e.g. scaling a group's children against the start rect). Skipped
    // when `start` is missing — without a baseline rect there's nothing to
    // batch-scale against.
    if (start) {
      onResizeFinalRef.current?.(dims, start);
    }
  }, []);

  return { isResizing, onResizeStart, onResizeEvent, onResizeEnd };
}
