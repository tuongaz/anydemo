import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as React from 'react';
import {
  CORNER_ANCHORS,
  type OverlayInputNode,
  SELECTION_OVERLAY_PADDING,
  SelectionResizeOverlay,
  computeNewRectFromAnchorDrag,
  computeSelectionResizeUpdates,
  computeUnionRect,
  scheduleRaf,
  selectionEligibleForOverlay,
} from './selection-resize-overlay.tsx';

const node = (
  id: string,
  x: number,
  y: number,
  width?: number,
  height?: number,
): OverlayInputNode => ({
  id,
  position: { x, y },
  data: { width, height },
});

/** Node whose size lives on the CALLER-RESOLVED top-level fields (e.g. an
 * auto-sized html/component member resolved from `measured`), with no
 * `data.width/height` — design §12.1. */
const resolvedNode = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  type?: string,
): OverlayInputNode => ({
  id,
  position: { x, y },
  width,
  height,
  type,
  data: {},
});

describe('computeUnionRect', () => {
  it('returns null when no node has measurable size', () => {
    expect(computeUnionRect([node('a', 10, 10), node('b', 50, 50)])).toBeNull();
  });

  it('returns the union of a single sized node', () => {
    expect(computeUnionRect([node('a', 10, 20, 50, 30)])).toEqual({
      x: 10,
      y: 20,
      width: 50,
      height: 30,
    });
  });

  it('returns the union of multiple sized nodes', () => {
    // a at (10, 10) 30×30 → spans (10..40, 10..40)
    // b at (50, 60) 20×40 → spans (50..70, 60..100)
    expect(computeUnionRect([node('a', 10, 10, 30, 30), node('b', 50, 60, 20, 40)])).toEqual({
      x: 10,
      y: 10,
      width: 60,
      height: 90,
    });
  });

  it('skips nodes without width/height', () => {
    // The unsized node is ignored entirely; the sized node defines the rect.
    expect(computeUnionRect([node('a', 0, 0), node('b', 50, 50, 10, 10)])).toEqual({
      x: 50,
      y: 50,
      width: 10,
      height: 10,
    });
  });

  it('encloses an auto-sized member via caller-resolved top-level dims (§12.1)', () => {
    // `a` is a normal sized node; `b` is auto-sized (no data.width/height) but
    // the host resolved its measured footprint onto the top-level width/height.
    // The union MUST include `b`, not silently drop it like data-only resolution
    // would.
    expect(
      computeUnionRect([node('a', 10, 10, 30, 30), resolvedNode('b', 50, 60, 20, 40)]),
    ).toEqual({
      x: 10,
      y: 10,
      width: 60,
      height: 90,
    });
  });

  it('prefers the resolved top-level size over data.width/height when both set', () => {
    const n: OverlayInputNode = {
      id: 'a',
      position: { x: 0, y: 0 },
      width: 100,
      height: 100,
      data: { width: 10, height: 10 },
    };
    expect(computeUnionRect([n])).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});

describe('selectionEligibleForOverlay', () => {
  it('loose selection: false for 0 or 1 node, true for 2+', () => {
    expect(selectionEligibleForOverlay([])).toBe(false);
    expect(selectionEligibleForOverlay([node('a', 0, 0, 10, 10)])).toBe(false);
    expect(selectionEligibleForOverlay([node('a', 0, 0, 10, 10), node('b', 50, 50, 10, 10)])).toBe(
      true,
    );
  });

  it('group selection: true for a single group (≥1 node), false for empty (§12.5)', () => {
    // A single selected group passes `isGroupSelection`; even one member node
    // (members + group box) draws chrome — a 1-member group still gets a rect.
    expect(selectionEligibleForOverlay([node('a', 0, 0, 10, 10)], true)).toBe(true);
    expect(
      selectionEligibleForOverlay([node('a', 0, 0, 10, 10), node('g', 0, 0, 50, 50)], true),
    ).toBe(true);
    expect(selectionEligibleForOverlay([], true)).toBe(false);
  });
});

describe('SELECTION_OVERLAY_PADDING + CORNER_ANCHORS', () => {
  it('pins the padding at 12 (req #1, "a bit extra padding")', () => {
    expect(SELECTION_OVERLAY_PADDING).toBe(12);
  });

  it('renders corners only — exactly nw/ne/se/sw, no edge anchors', () => {
    expect([...CORNER_ANCHORS].sort()).toEqual(['ne', 'nw', 'se', 'sw']);
    expect(CORNER_ANCHORS).not.toContain('n');
    expect(CORNER_ANCHORS).not.toContain('e');
    expect(CORNER_ANCHORS).not.toContain('s');
    expect(CORNER_ANCHORS).not.toContain('w');
  });
});

describe('computeNewRectFromAnchorDrag', () => {
  const oldRect = { x: 0, y: 0, width: 100, height: 100 };

  it('SE drag — both right edge and bottom edge follow the cursor', () => {
    expect(computeNewRectFromAnchorDrag(oldRect, 'se', 50, 50, false)).toEqual({
      x: 0,
      y: 0,
      width: 150,
      height: 150,
    });
  });

  it('NW drag — top edge and left edge follow the cursor; SE corner stays', () => {
    expect(computeNewRectFromAnchorDrag(oldRect, 'nw', -20, -10, false)).toEqual({
      x: -20,
      y: -10,
      width: 120,
      height: 110,
    });
  });

  it('E edge drag — only the right edge moves', () => {
    expect(computeNewRectFromAnchorDrag(oldRect, 'e', 30, 999, false)).toEqual({
      x: 0,
      y: 0,
      width: 130,
      height: 100,
    });
  });

  it('aspect-ratio lock uses the smaller scale axis', () => {
    // sx = 1.5 (150/100), sy = 2.0 (200/100); lock → both scale to 1.5
    const out = computeNewRectFromAnchorDrag(oldRect, 'se', 50, 100, true);
    expect(out).toEqual({ x: 0, y: 0, width: 150, height: 150 });
  });

  it('aspect-ratio lock anchors the opposite corner when dragging NW', () => {
    // sx = 1.5 (150/100), sy = 2.0 (200/100); lock → both 1.5; SE corner
    // stays anchored at (100,100); NW shifts so the rect is 150×150 ending
    // at (100,100) — i.e. starts at (-50, -50).
    const out = computeNewRectFromAnchorDrag(oldRect, 'nw', -50, -100, true);
    expect(out).toEqual({ x: -50, y: -50, width: 150, height: 150 });
  });

  it('clamps degenerate (collapsed) rects to a 1px floor on each axis', () => {
    // SE drag inward past the opposing edge: width should clamp to 1, not
    // flip to negative (the scale factor would invert otherwise).
    const out = computeNewRectFromAnchorDrag(oldRect, 'se', -200, -200, false);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
  });
});

describe('computeSelectionResizeUpdates', () => {
  it('returns position + size for each scaled node', () => {
    const updates = computeSelectionResizeUpdates(
      [node('a', 10, 10, 20, 20), node('b', 50, 50, 20, 20)],
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 200, height: 200 },
    );
    expect(updates).toEqual([
      { id: 'a', position: { x: 20, y: 20 }, width: 40, height: 40 },
      { id: 'b', position: { x: 100, y: 100 }, width: 40, height: 40 },
    ]);
  });

  it('passes lockAspectRatio through to scaleNodesWithinRect', () => {
    // sx = 2 (200/100), sy = 4 (400/100); lock → 2 for both axes; the b node
    // at (50, 50) scales to (100, 100), and its 20×20 size becomes 40×40
    // — NOT 80×80 (which is what a free 4× scale on y would produce).
    const updates = computeSelectionResizeUpdates(
      [node('b', 50, 50, 20, 20)],
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 200, height: 400 },
      { lockAspectRatio: true },
    );
    expect(updates[0]?.width).toBe(40);
    expect(updates[0]?.height).toBe(40);
  });

  it('emits position-only updates when source nodes have no width/height', () => {
    const updates = computeSelectionResizeUpdates(
      [node('a', 10, 10), node('b', 50, 50)],
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 200, height: 200 },
    );
    expect(updates).toEqual([
      { id: 'a', position: { x: 20, y: 20 } },
      { id: 'b', position: { x: 100, y: 100 } },
    ]);
  });
});

// US-016: rAF-throttle helper. The overlay calls this on every pointermove
// during a multi-select resize so the live dispatch caps at ~60fps even when
// xyflow's pointer stream is faster. Each new schedule cancels the prior one
// so only the LATEST tick's callback fires per frame (no backed-up queue).
describe('scheduleRaf (US-016 live dispatch throttle)', () => {
  type RafFrame = { id: number; fn: FrameRequestCallback };
  let pending: RafFrame[];
  let nextId: number;
  let originalRaf: typeof globalThis.requestAnimationFrame;
  let originalCancel: typeof globalThis.cancelAnimationFrame;

  beforeEach(() => {
    pending = [];
    nextId = 0;
    originalRaf = globalThis.requestAnimationFrame;
    originalCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((fn: FrameRequestCallback) => {
      nextId += 1;
      pending.push({ id: nextId, fn });
      return nextId;
    }) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => {
      pending = pending.filter((p) => p.id !== id);
    }) as typeof globalThis.cancelAnimationFrame;
  });
  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  });
  function flushRaf() {
    const snapshot = pending.slice();
    pending = [];
    for (const frame of snapshot) frame.fn(performance.now());
  }

  it('schedules a single callback on first call', () => {
    const ref = { current: null as number | null };
    const fn = mock(() => {});
    scheduleRaf(ref, fn);
    expect(ref.current).not.toBeNull();
    expect(fn).not.toHaveBeenCalled();
    flushRaf();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(ref.current).toBeNull();
  });

  it('coalesces multiple rapid schedules into ONE callback per frame', () => {
    // Mimics what a fast pointermove stream does — many calls in the same
    // frame, only the LAST callback runs (the others are cancelled).
    const ref = { current: null as number | null };
    const first = mock(() => {});
    const second = mock(() => {});
    const third = mock(() => {});
    scheduleRaf(ref, first);
    scheduleRaf(ref, second);
    scheduleRaf(ref, third);
    flushRaf();
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(third).toHaveBeenCalledTimes(1);
  });

  it('clears the ref after the scheduled frame runs (allows re-scheduling next frame)', () => {
    const ref = { current: null as number | null };
    scheduleRaf(ref, () => {});
    flushRaf();
    expect(ref.current).toBeNull();
    // Second schedule should work without a prior cancel; a new id lands in
    // the ref so the next frame's flushRaf catches it.
    const second = mock(() => {});
    scheduleRaf(ref, second);
    expect(ref.current).not.toBeNull();
    flushRaf();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Component render (canvas grouping M2). Bun runs without a DOM, so we shim
// React's dispatcher and call SelectionResizeOverlay as a plain function —
// same approach as group-node.test.tsx. This component additionally calls
// `useReactFlow()`, which internally reads xyflow's StoreContext + BatchContext
// and zustand's `useSyncExternalStore`. We feed all three a self-contained stub
// (no module mocking — that would leak across the full-suite run) sufficient for
// the hook chain to resolve without throwing. The overlay only invokes
// `screenToFlowPosition` inside pointer handlers, never during render, so the
// stub just needs to keep the render path alive.
// ---------------------------------------------------------------------------
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useRef: <T>(initial: T) => { current: T };
  useContext: <T>(ctx: unknown) => T;
  useMemo: <T>(fn: () => T) => T;
  useCallback: <T>(fn: T) => T;
  useEffect: () => void;
  useSyncExternalStore: <T>(subscribe: unknown, getSnapshot: () => T) => T;
  useDebugValue: () => void;
};

function renderWithHooks<T>(fn: () => T): T {
  const internals = (
    React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: Hooks | null };
      };
    }
  ).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const prev = internals.ReactCurrentDispatcher.current;
  // Minimal zustand-store-API + React-Flow-state stub. `getInternalNode` reads
  // `nodeLookup`; `selector$k` reads `panZoom`; `useStoreApi` reads
  // getState/setState/subscribe; batch reads nodeQueue/edgeQueue.
  const storeState = {
    panZoom: {},
    nodeLookup: new Map(),
    domNode: null,
    transform: [0, 0, 1] as [number, number, number],
  };
  const storeStub = {
    getState: () => storeState,
    setState: () => {},
    subscribe: () => () => {},
    nodeQueue: [],
    edgeQueue: [],
  };
  internals.ReactCurrentDispatcher.current = {
    useState: <S,>(initial: S | (() => S)) => {
      const value = typeof initial === 'function' ? (initial as () => S)() : initial;
      return [value, () => {}];
    },
    useRef: <T,>(initial: T) => ({ current: initial }),
    // Every xyflow context (StoreContext, BatchContext) resolves to the same
    // merged stub — the hooks only need their respective members present.
    useContext: <T,>() => storeStub as T,
    useMemo: <T,>(f: () => T) => f(),
    useCallback: <T,>(f: T) => f,
    useEffect: () => {},
    // zustand's useStoreWithEqualityFn → useSyncExternalStore(subscribe,
    // () => selector(getState())). Just run the snapshot to get the value.
    useSyncExternalStore: <V,>(_subscribe: unknown, getSnapshot: () => V) => getSnapshot(),
    useDebugValue: () => {},
  };
  try {
    return fn();
  } finally {
    internals.ReactCurrentDispatcher.current = prev;
  }
}

type ReactElementLike = {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
};

function isElement(value: unknown): value is ReactElementLike {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    'props' in (value as { props?: unknown })
  );
}

function findAll(tree: unknown, predicate: (el: ReactElementLike) => boolean): ReactElementLike[] {
  const out: ReactElementLike[] = [];
  const visit = (node: unknown) => {
    // Flatten arrays (e.g. `.map()` output nested as a child) so handles inside
    // the rect's children array are still visited.
    if (Array.isArray(node)) {
      for (const c of node) visit(c);
      return;
    }
    if (!isElement(node)) return;
    if (predicate(node)) out.push(node);
    const children = node.props.children;
    if (children === undefined || children === null) return;
    visit(children);
  };
  visit(tree);
  return out;
}

const testId = (el: ReactElementLike): string | undefined =>
  (el.props as { 'data-testid'?: string })['data-testid'];

describe('SelectionResizeOverlay render (M2 chrome)', () => {
  const twoLoose: OverlayInputNode[] = [node('a', 0, 0, 100, 100), node('b', 200, 200, 100, 100)];

  it('returns null when the selection is ineligible (1 loose node)', () => {
    const tree = renderWithHooks(() =>
      SelectionResizeOverlay({ selectedNodes: [node('a', 0, 0, 100, 100)] }),
    );
    expect(tree).toBeNull();
  });

  it('returns null when no node has a measurable size', () => {
    const tree = renderWithHooks(() =>
      SelectionResizeOverlay({ selectedNodes: [node('a', 0, 0), node('b', 10, 10)] }),
    );
    expect(tree).toBeNull();
  });

  it('renders the overlay rect for 2+ loose nodes with pointer-events:none', () => {
    const tree = renderWithHooks(() => SelectionResizeOverlay({ selectedNodes: twoLoose }));
    const rect = findAll(tree, (el) => testId(el) === 'selection-overlay')[0];
    if (!rect) throw new Error('selection-overlay rect not found');
    const style = (rect.props.style ?? {}) as React.CSSProperties;
    expect(style.pointerEvents).toBe('none');
    expect(style.position).toBe('absolute');
    // zIndex sits above nodes/edges (and above a selected group's negative z).
    expect(Number(style.zIndex)).toBeGreaterThanOrEqual(1500);
    // Padded rect: union (0,0)→(300,300) expanded by 12 on each side.
    expect(style.left).toBe(0 - SELECTION_OVERLAY_PADDING);
    expect(style.top).toBe(0 - SELECTION_OVERLAY_PADDING);
    expect(style.width).toBe(300 + SELECTION_OVERLAY_PADDING * 2);
    expect(style.height).toBe(300 + SELECTION_OVERLAY_PADDING * 2);
  });

  it('renders exactly 4 corner handles (nw/ne/se/sw), each interactive with a cursor + aria-label', () => {
    const tree = renderWithHooks(() => SelectionResizeOverlay({ selectedNodes: twoLoose }));
    const handles = findAll(tree, (el) => /^selection-overlay-handle-/.test(testId(el) ?? ''));
    expect(handles).toHaveLength(4);
    const ids = new Set(handles.map((h) => testId(h)));
    expect(ids).toEqual(
      new Set([
        'selection-overlay-handle-nw',
        'selection-overlay-handle-ne',
        'selection-overlay-handle-se',
        'selection-overlay-handle-sw',
      ]),
    );
    for (const h of handles) {
      const style = (h.props.style ?? {}) as React.CSSProperties;
      expect(style.pointerEvents).toBe('auto');
      expect(typeof style.cursor).toBe('string');
      expect((style.cursor ?? '').length).toBeGreaterThan(0);
      // Zoom-compensated size: a calc() reading --rf-zoom (constant screen px).
      expect(String(style.width)).toContain('--rf-zoom');
      expect(h.props['aria-label']).toBe('Resize selection');
    }
  });

  it('renders the empty top-right icon slot placeholder (M4 fills it)', () => {
    const tree = renderWithHooks(() => SelectionResizeOverlay({ selectedNodes: twoLoose }));
    const slot = findAll(tree, (el) => testId(el) === 'selection-overlay-icon-slot');
    expect(slot).toHaveLength(1);
    // No behavior yet — it must be inert (decorative placeholder).
    const style = (slot[0]?.props.style ?? {}) as React.CSSProperties;
    expect(style.pointerEvents).toBe('none');
    expect(slot[0]?.props['aria-hidden']).toBe('true');
  });

  it('renders chrome for a SINGLE group selection (members + box, ≥1 node) via isGroupSelection', () => {
    // Host passes the group MEMBERS + the group box; one member + the box is
    // enough to draw — a 1-member group still gets chrome (§12.5).
    const tree = renderWithHooks(() =>
      SelectionResizeOverlay({
        selectedNodes: [node('member', 0, 0, 80, 60), node('g1', 0, 0, 120, 100)],
        isGroupSelection: true,
      }),
    );
    const rect = findAll(tree, (el) => testId(el) === 'selection-overlay');
    expect(rect).toHaveLength(1);
    const handles = findAll(tree, (el) => /^selection-overlay-handle-/.test(testId(el) ?? ''));
    expect(handles).toHaveLength(4);
  });
});
