import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { OnResize, OnResizeEnd, OnResizeStart, ResizeParams } from '@xyflow/react';
import type { Node } from '@xyflow/react';
import * as React from 'react';
import {
  type UseAlignmentGuidesParams,
  useAlignmentGuides,
} from '../alignment/use-alignment-guides.ts';
import { useResizeGesture } from './use-resize-gesture.ts';

// ---------------------------------------------------------------------------
// Deterministic requestAnimationFrame queue. The alignment hook batches its
// guide commits via RAF; the resize-snap path here only reads the synchronous
// snappedRect, but applyResizeSnap still schedules a commit so we stub RAF to
// keep it deterministic (and to pick up the hook's `globalThis.*` override).
// ---------------------------------------------------------------------------
type RafEntry = { id: number; cb: FrameRequestCallback };
let rafQueue: RafEntry[] = [];
let rafSeq = 0;
let savedRaf: typeof globalThis.requestAnimationFrame;
let savedCaf: typeof globalThis.cancelAnimationFrame;

beforeEach(() => {
  savedRaf = globalThis.requestAnimationFrame;
  savedCaf = globalThis.cancelAnimationFrame;
  rafQueue = [];
  rafSeq = 0;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    const id = ++rafSeq;
    rafQueue.push({ id, cb });
    return id;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    rafQueue = rafQueue.filter((e) => e.id !== id);
  }) as typeof globalThis.cancelAnimationFrame;
});

afterEach(() => {
  globalThis.requestAnimationFrame = savedRaf;
  globalThis.cancelAnimationFrame = savedCaf;
});

// ---------------------------------------------------------------------------
// Hook-shim: render a hook by swapping React's internal dispatcher with
// synchronous stubs (same pattern as use-alignment-guides.test.ts +
// seeflow-canvas.test.tsx). useRef initial values are captured at render, so
// the returned useCallback handlers — which close over those refs — remain
// callable AFTER the dispatcher is restored. The noop useEffect is fine: a
// single render initialises every ref via its useRef initial value.
// ---------------------------------------------------------------------------
function renderHook<T>(run: () => T): T {
  const internals = (
    React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: unknown };
      };
    }
  ).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const prev = internals.ReactCurrentDispatcher.current;
  internals.ReactCurrentDispatcher.current = {
    useState: <S>(initial: S | (() => S)) => {
      const value = typeof initial === 'function' ? (initial as () => S)() : initial;
      return [value, () => {}];
    },
    useCallback: <F>(fn: F) => fn,
    useMemo: <V>(fn: () => V) => fn(),
    useRef: <V>(initial: V) => ({ current: initial }),
    useEffect: () => {},
  };
  try {
    return run();
  } finally {
    internals.ReactCurrentDispatcher.current = prev;
  }
}

function node(id: string, x: number, y: number, w: number, h: number): Node {
  return { id, position: { x, y }, data: {}, width: w, height: h } as unknown as Node;
}

/** Fake xyflow resize drag event carrying the modifier keys under sourceEvent. */
function resizeEvent(
  mods: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } = {},
): unknown {
  return { sourceEvent: mods };
}

type ResizeHandlers = {
  onResizeStart: OnResizeStart;
  onResizeEvent: OnResize;
  onResizeEnd: OnResizeEnd;
};

/**
 * Build a real alignment hook over the given nodes, then a resize gesture
 * wired to it. Returns the gesture handlers plus a sink of every onResize /
 * onResizeEnd dispatch so assertions read the dims that would drive the node.
 */
function setup(nodes: Node[], alignmentEnabled = true) {
  const rfNodesRef = { current: nodes };
  const params: UseAlignmentGuidesParams = {
    enabled: alignmentEnabled,
    thresholdPx: 6,
    viewport: { x: 0, y: 0, zoom: 1 },
    rfNodesRef,
  };
  const alignment = renderHook(() => useAlignmentGuides(params));

  const resizeDispatches: ResizeParams[] = [];
  const resizeEndDispatches: ResizeParams[] = [];
  const handlers = renderHook(() =>
    useResizeGesture({
      onResize: (dims) => resizeDispatches.push(dims),
      onResizeEnd: (dims) => resizeEndDispatches.push(dims),
      nodeId: 'A',
      alignment: alignmentEnabled ? alignment : undefined,
    }),
  ) as unknown as ResizeHandlers;

  return { handlers, resizeDispatches, resizeEndDispatches };
}

// A is the node being resized (right edge at 158); B sits to its right with a
// left edge at 160 — 2px away, inside the 6px threshold.
const scene = () => [node('A', 0, 0, 150, 100), node('B', 160, 0, 100, 100)];

describe('useResizeGesture — alignment integration', () => {
  it('snaps the active right edge to a neighbour and leaves the left edge fixed', () => {
    const { handlers, resizeDispatches } = setup(scene());

    // Start at the original rect, then drag the right handle to width 158
    // (origin x stays 0 → only the right edge moves; right edge now 2px from B).
    handlers.onResizeStart(resizeEvent() as never, {
      x: 0,
      y: 0,
      width: 150,
      height: 100,
    });
    handlers.onResizeEvent(
      resizeEvent() as never,
      {
        x: 0,
        y: 0,
        width: 158,
        height: 100,
        direction: [1, 0],
      } as never,
    );

    expect(resizeDispatches.length).toBe(1);
    const dims = resizeDispatches[0];
    if (!dims) throw new Error('expected a resize dispatch');
    // Right edge snapped to B's left (160) → width 160; origin untouched.
    expect(dims.x).toBe(0);
    expect(dims.width).toBe(160);
    expect(dims.y).toBe(0);
    expect(dims.height).toBe(100);
  });

  it('persists the snapped dims on resize end (so release matches the live guide)', () => {
    const { handlers, resizeEndDispatches } = setup(scene());

    handlers.onResizeStart(resizeEvent() as never, { x: 0, y: 0, width: 150, height: 100 });
    handlers.onResizeEvent(
      resizeEvent() as never,
      {
        x: 0,
        y: 0,
        width: 158,
        height: 100,
        direction: [1, 0],
      } as never,
    );
    handlers.onResizeEnd(resizeEvent() as never, { x: 0, y: 0, width: 158, height: 100 });

    expect(resizeEndDispatches.length).toBe(1);
    const dims = resizeEndDispatches[0];
    if (!dims) throw new Error('expected a resize-end dispatch');
    expect(dims.width).toBe(160);
    expect(dims.x).toBe(0);
  });

  it('suppresses the snap while the modifier key is held (raw dims pass through)', () => {
    const { handlers, resizeDispatches } = setup(scene());

    handlers.onResizeStart(resizeEvent() as never, { x: 0, y: 0, width: 150, height: 100 });
    // Cmd/Ctrl held → applyResizeSnap returns the raw rect; no snap.
    handlers.onResizeEvent(
      resizeEvent({ metaKey: true }) as never,
      {
        x: 0,
        y: 0,
        width: 158,
        height: 100,
        direction: [1, 0],
      } as never,
    );

    expect(resizeDispatches.length).toBe(1);
    const dims = resizeDispatches[0];
    if (!dims) throw new Error('expected a resize dispatch');
    expect(dims.width).toBe(158); // unchanged — no snap
  });

  it('leaves dims untouched when no alignment integration is wired', () => {
    const { handlers, resizeDispatches } = setup(scene(), false);

    handlers.onResizeStart(resizeEvent() as never, { x: 0, y: 0, width: 150, height: 100 });
    handlers.onResizeEvent(
      resizeEvent() as never,
      {
        x: 0,
        y: 0,
        width: 158,
        height: 100,
        direction: [1, 0],
      } as never,
    );

    expect(resizeDispatches.length).toBe(1);
    const dims = resizeDispatches[0];
    if (!dims) throw new Error('expected a resize dispatch');
    expect(dims.width).toBe(158); // raw — alignment off
  });

  it('does not snap a zero-movement click (no persistence)', () => {
    const { handlers, resizeDispatches, resizeEndDispatches } = setup(scene());

    handlers.onResizeStart(resizeEvent() as never, { x: 0, y: 0, width: 150, height: 100 });
    // No move → onResizeEnd with identical dims is treated as a click.
    handlers.onResizeEnd(resizeEvent() as never, { x: 0, y: 0, width: 150, height: 100 });

    expect(resizeDispatches.length).toBe(0);
    expect(resizeEndDispatches.length).toBe(0);
  });
});

describe('useResizeGesture — Shift aspect-lock', () => {
  // Start 200×100 (ratio 2:1). A bottom-right corner drag that grows width more
  // than height should lock height to width/ratio, anchored at the top-left.
  it('locks the aspect ratio on a corner drag, anchoring the opposite corner', () => {
    const { handlers, resizeDispatches } = setup(scene());
    handlers.onResizeStart(resizeEvent() as never, { x: 0, y: 0, width: 200, height: 100 });
    // Drag bottom-right to 260×150 raw; Shift held. Height scale (1.5) beats
    // width scale (1.3), so height drives: width = 150*2 = 300. Both moving
    // edges are right+bottom → anchored at the top-left (0,0).
    handlers.onResizeEvent(
      resizeEvent({ shiftKey: true }) as never,
      { x: 0, y: 0, width: 260, height: 150, direction: [1, 1] } as never,
    );
    expect(resizeDispatches.length).toBe(1);
    const dims = resizeDispatches[0];
    if (!dims) throw new Error('expected a resize dispatch');
    expect(dims.x).toBe(0);
    expect(dims.y).toBe(0);
    expect(dims.width).toBeCloseTo(300, 6);
    expect(dims.height).toBeCloseTo(150, 6);
    expect(dims.width / dims.height).toBeCloseTo(2, 6);
  });

  it('keeps the bottom-right fixed on a top-left handle drag', () => {
    const { handlers, resizeDispatches } = setup(scene());
    handlers.onResizeStart(resizeEvent() as never, { x: 0, y: 0, width: 200, height: 100 });
    // Top-left handle: origin moves to (40,40), shrinking to 160×60. Active
    // edges left+top → anchor bottom-right (200,100). Shift keeps ratio 2:1.
    handlers.onResizeEvent(
      resizeEvent({ shiftKey: true }) as never,
      { x: 40, y: 40, width: 160, height: 60, direction: [-1, -1] } as never,
    );
    const dims = resizeDispatches[0];
    if (!dims) throw new Error('expected a resize dispatch');
    expect(dims.width / dims.height).toBeCloseTo(2, 6);
    // Anchored bottom-right: x+width === 200, y+height === 100.
    expect(dims.x + dims.width).toBeCloseTo(200, 6);
    expect(dims.y + dims.height).toBeCloseTo(100, 6);
  });

  it('aspect-lock wins over alignment snap when Shift is held', () => {
    // Right edge drag to 158 would normally snap to B's left (160). With Shift,
    // the snap is bypassed and the ratio is locked instead.
    const { handlers, resizeDispatches } = setup(scene());
    handlers.onResizeStart(resizeEvent() as never, { x: 0, y: 0, width: 150, height: 100 });
    handlers.onResizeEvent(
      resizeEvent({ shiftKey: true }) as never,
      { x: 0, y: 0, width: 158, height: 100, direction: [1, 0] } as never,
    );
    const dims = resizeDispatches[0];
    if (!dims) throw new Error('expected a resize dispatch');
    expect(dims.width).not.toBe(160); // not snapped to neighbour
    expect(dims.width / dims.height).toBeCloseTo(150 / 100, 6);
  });
});
