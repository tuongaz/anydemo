import type { OnResize, OnResizeEnd, OnResizeStart, ResizeParams } from '@xyflow/react';
import { useCallback, useEffect, useRef, useState } from 'react';

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
   * End-only callback. Fires once at mouse release with the FINAL dims and the
   * ORIGINAL dims captured at resize-start. Use this for batched mutations
   * that shouldn't run on every tick (e.g. group child scaling, where the
   * per-tick path produced exponential expand/shrink as feedback from the
   * optimistic override mutated the next tick's baseline). Fires AFTER the
   * end-fired `onResize` call below.
   */
  onResizeFinal?: (dims: ResizeParams, start: ResizeParams) => void;
  setResizing?: (on: boolean) => void;
}) {
  const { onResize, onResizeFinal, setResizing } = args;
  const [isResizing, setIsResizing] = useState(false);
  const startRef = useRef<ResizeParams | null>(null);

  // Mirror the user-provided callbacks into refs so the OnResize* handlers
  // returned below can stay reference-stable. xyflow's internal effect
  // depends on these references — see the top-of-file note for why a fresh
  // reference per render breaks the gesture mid-drag.
  const onResizeRef = useRef(onResize);
  const onResizeFinalRef = useRef(onResizeFinal);
  const setResizingRef = useRef(setResizing);
  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);
  useEffect(() => {
    onResizeFinalRef.current = onResizeFinal;
  }, [onResizeFinal]);
  useEffect(() => {
    setResizingRef.current = setResizing;
  }, [setResizing]);

  const onResizeStart = useCallback<OnResizeStart>((_e, params) => {
    setIsResizing(true);
    setResizingRef.current?.(true);
    startRef.current = params
      ? { x: params.x, y: params.y, width: params.width, height: params.height }
      : null;
  }, []);

  // US-016: per-tick handler — fires `onResize` on every xyflow tick so the
  // canvas (and any group children / multi-select overlay) updates live.
  const onResizeEvent = useCallback<OnResize>((_e, params) => {
    onResizeRef.current?.({
      x: params.x,
      y: params.y,
      width: params.width,
      height: params.height,
    });
  }, []);

  const onResizeEnd = useCallback<OnResizeEnd>((_e, params) => {
    setIsResizing(false);
    setResizingRef.current?.(false);
    const start = startRef.current;
    startRef.current = null;
    // No movement → treat as click, don't persist. Size equality is the
    // primary signal; corner handles can nudge x/y a sub-pixel without a
    // real resize, so we gate on width+height equality only.
    if (start && start.width === params.width && start.height === params.height) {
      return;
    }
    // US-016: per-tick handler already dispatched the final dims during the
    // gesture. The end-fired call is redundant when ticks have run, but kept
    // for back-compat with tests + the unlikely "no per-tick, only end"
    // path. Same-dims dispatch is idempotent under the coalesced-undo +
    // overrides design — no visual double-update.
    onResizeRef.current?.({
      x: params.x,
      y: params.y,
      width: params.width,
      height: params.height,
    });
    // End-only callback for batched mutations that must wait for the final
    // dims (e.g. scaling a group's children against the start rect). Skipped
    // when `start` is missing — without a baseline rect there's nothing to
    // batch-scale against.
    if (start) {
      onResizeFinalRef.current?.(
        {
          x: params.x,
          y: params.y,
          width: params.width,
          height: params.height,
        },
        start,
      );
    }
  }, []);

  return { isResizing, onResizeStart, onResizeEvent, onResizeEnd };
}
