import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as React from 'react';
import {
  CORNER_ANCHORS,
  type FrozenNode,
  MARQUEE_Z_INDEX,
  type MultiResizeUpdate,
  OVERLAY_CHROME_Z_INDEX,
  type OverlayInputNode,
  SELECTION_OVERLAY_PADDING,
  SelectionResizeOverlay,
  computeFrozenResizeUpdates,
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

// ---------------------------------------------------------------------------
// M3 end-only commit (design §6.3). `computeFrozenResizeUpdates` is the exact
// function the overlay's pointer-up handler calls, fed the FROZEN `startNodes`
// captured at pointer-down. These tests pin the corner math, the Shift
// aspect-lock, and the zero-movement no-op.
// ---------------------------------------------------------------------------
const frozen = (id: string, x: number, y: number, width?: number, height?: number): FrozenNode => ({
  id,
  position: { x, y },
  width,
  height,
});

describe('computeFrozenResizeUpdates (M3 frozen-baseline commit)', () => {
  // Two nodes inside a 0,0→100,100 union rect.
  const startNodes: FrozenNode[] = [frozen('a', 0, 0, 20, 20), frozen('b', 80, 80, 20, 20)];
  const startRect = { x: 0, y: 0, width: 100, height: 100 };

  it('SE corner drag scales sizes + spacing from the frozen pair (2x)', () => {
    // newRect after dragging SE by (+100,+100): 0,0→200,200 → sx = sy = 2.
    const updates = computeFrozenResizeUpdates(startNodes, startRect, {
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    });
    expect(updates).toEqual([
      { id: 'a', position: { x: 0, y: 0 }, width: 40, height: 40 },
      { id: 'b', position: { x: 160, y: 160 }, width: 40, height: 40 },
    ]);
  });

  it('NW corner drag keeps the SE corner anchored and shifts positions', () => {
    // Drag NW outward: rect becomes -100,-100→100,100 (200×200, sx=sy=2), SE
    // corner stays at (100,100). Node `b` (was at 80,80) maps to
    // -100 + (80-0)*2 = 60.
    const updates = computeFrozenResizeUpdates(startNodes, startRect, {
      x: -100,
      y: -100,
      width: 200,
      height: 200,
    });
    expect(updates[0]).toEqual({ id: 'a', position: { x: -100, y: -100 }, width: 40, height: 40 });
    expect(updates[1]).toEqual({ id: 'b', position: { x: 60, y: 60 }, width: 40, height: 40 });
  });

  it('Shift aspect-lock uses min(sx, sy) so sizes stay uniform', () => {
    // newRect 200 wide (sx=2) but 400 tall (sy=4); lock → uniform 2x.
    const updates = computeFrozenResizeUpdates(
      startNodes,
      startRect,
      { x: 0, y: 0, width: 200, height: 400 },
      { lockAspectRatio: true },
    );
    expect(updates[0]?.width).toBe(40);
    expect(updates[0]?.height).toBe(40);
    expect(updates[1]?.width).toBe(40);
    expect(updates[1]?.height).toBe(40);
  });

  it('repositions freehand-style nodes (no width/height) without scaling them (§12.6)', () => {
    // A freehand stroke carries geometry in data.points, not width/height — so
    // the frozen snapshot has undefined dims. It must reposition (so it stays
    // with the group) but NOT gain a width/height (the helper leaves them
    // undefined and never touches data). Documented as intentional.
    const withStroke: FrozenNode[] = [
      frozen('shape', 0, 0, 20, 20),
      frozen('stroke', 50, 50), // freehand: no dims
    ];
    const updates = computeFrozenResizeUpdates(withStroke, startRect, {
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    });
    const stroke = updates.find((u) => u.id === 'stroke');
    expect(stroke?.position).toEqual({ x: 100, y: 100 }); // 50 * 2 — repositioned
    expect(stroke?.width).toBeUndefined(); // NOT scaled
    expect(stroke?.height).toBeUndefined();
  });
});

// ===========================================================================
// THE TRIPWIRE (design §6.4) — the most important test in the grouping feature.
//
// The v1 "order of magnitude" bug fed the LIVE, optimistically-overridden node
// set back into the scale each tick (`nodesAtTick = selectedNodes`), against a
// frozen rect → `w·sx·sx·…` compounding → ×10 blowup. M3's contract: the commit
// reads the FROZEN `startNodes`, so N ticks collapse to a single `start → final`
// scale with NO compounding.
//
// This test models BOTH paths from the same tick sequence and proves they
// DIVERGE by an order of magnitude:
//   - SAFE (what the handler does): always scale the FROZEN startNodes.
//   - BUGGY (the v1 regression): scale the PREVIOUS tick's output (the echo).
// If a future refactor reintroduces the live set at the commit site, the
// committed result would match the BUGGY path — and this test's safe-path
// assertions (exact 2x, and "not blown up") would fail.
// ===========================================================================
describe('TRIPWIRE: frozen baseline does NOT compound (design §6.4, L0.1)', () => {
  it('N ticks scaling the frozen set == one start→final scale (no runaway)', () => {
    const startNodes: FrozenNode[] = [frozen('a', 0, 0, 10, 10), frozen('b', 90, 90, 10, 10)];
    const startRect = { x: 0, y: 0, width: 100, height: 100 };
    // A fast outward SE drag sampled at 10 ticks: widths 110,120,…,200 — each
    // computed from the FROZEN rect (that's how computeNewRectFromAnchorDrag
    // works: it always reads dragState.oldRect). Final tick = 200 → 2x.
    const tickRects = Array.from({ length: 10 }, (_, i) => {
      const size = 110 + i * 10; // 110..200
      return { x: 0, y: 0, width: size, height: size };
    });
    const finalRect = tickRects[tickRects.length - 1];
    if (!finalRect) throw new Error('no final rect');

    // SAFE path — exactly what onHandlePointerUp does: scale the frozen set to
    // the final rect. (Even if we recomputed every tick, each would read the
    // frozen startNodes, so only the last matters: end-only commit.)
    const safe = computeFrozenResizeUpdates(startNodes, startRect, finalRect);
    // 2x: a stays 10→20 at origin; b 10→20, position 90→180.
    expect(safe).toEqual([
      { id: 'a', position: { x: 0, y: 0 }, width: 20, height: 20 },
      { id: 'b', position: { x: 180, y: 180 }, width: 20, height: 20 },
    ]);

    // BUGGY path — the v1 echo: each tick scales the PREVIOUS tick's OUTPUT
    // (mimicking `nodesAtTick = selectedNodes` after the optimistic override
    // has been written back). The baseline node set is replaced every tick.
    let liveNodes: FrozenNode[] = startNodes;
    for (const rect of tickRects) {
      const out = computeFrozenResizeUpdates(liveNodes, startRect, rect);
      liveNodes = out.map((u) => ({
        id: u.id,
        position: u.position,
        width: u.width,
        height: u.height,
      }));
    }
    const buggyA = liveNodes.find((n) => n.id === 'a');
    if (!buggyA?.width) throw new Error('buggy path lost width');

    // The compounded width is the PRODUCT of every per-tick scale:
    //   10 * (110/100) * (120/100) * … * (200/100)
    const product = tickRects.reduce((acc, r) => acc * (r.width / 100), 1);
    const expectedBuggyWidth = 10 * product;
    expect(buggyA.width).toBeCloseTo(expectedBuggyWidth, 5);

    // The DISCRIMINATOR: the buggy path blows up by well over an order of
    // magnitude vs the safe 2x (20). If the commit ever reads the live set,
    // the committed width would be ~this buggy value, not 20.
    const safeA = safe.find((u) => u.id === 'a');
    if (!safeA?.width) throw new Error('safe path lost width');
    expect(buggyA.width).toBeGreaterThan(safeA.width * 10);
    // And the safe path is emphatically NOT the runaway value.
    expect(safeA.width).toBe(20);
    expect(safeA.width).toBeLessThan(expectedBuggyWidth / 10);
  });

  it('5 repeated full gestures from the same frozen baseline stay stable (no drift)', () => {
    // UAT step 5: repeat the drag 5× rapidly. Each gesture re-freezes from the
    // SAME pre-drag baseline (the overlay re-snapshots startNodes on every
    // pointer-down), so the committed result is identical every time — there is
    // no accumulation across gestures.
    const startNodes: FrozenNode[] = [frozen('a', 0, 0, 10, 10), frozen('b', 90, 90, 10, 10)];
    const startRect = { x: 0, y: 0, width: 100, height: 100 };
    const finalRect = { x: 0, y: 0, width: 150, height: 150 }; // 1.5x
    let last: MultiResizeUpdate[] | null = null;
    for (let i = 0; i < 5; i++) {
      const out = computeFrozenResizeUpdates(startNodes, startRect, finalRect);
      if (last) expect(out).toEqual(last);
      last = out;
    }
    expect(last?.[0]?.width).toBe(15);
    expect(last?.[1]?.width).toBe(15);
  });

  // M5: group resize is served by the SAME overlay path — for a single selected
  // group, `selectionOverlayNodes` resolves to the members + the group box and
  // the corner drag calls the same `computeFrozenResizeUpdates(startNodes, …)`.
  // So the group-members path inherits the no-compounding guarantee, but pin it
  // explicitly with a realistic group geometry (box g1 + members a, b) so a
  // future regression on the group branch is caught here too (design §6.4, the
  // M5 "extend the tripwire to the group path" deliverable).
  it('GROUP path: members + box scale once from the frozen set (no runaway on a fast drag)', () => {
    // grouping-demo geometry: group box encloses node-a (120,120,160×80) and
    // node-b (380,120,160×80). The box (computeGroupBox, symmetric 12px padding,
    // no title band) sits at (108,108) and is 444 wide × 104 tall. The frozen set
    // the overlay scales = members + box.
    const startNodes: FrozenNode[] = [
      frozen('node-a', 120, 120, 160, 80),
      frozen('node-b', 380, 120, 160, 80),
      frozen('grp-1', 108, 108, 444, 104), // the group box itself
    ];
    const startRect = { x: 108, y: 108, width: 444, height: 104 };
    // Fast SE outward drag sampled at 8 ticks, each computed from the FROZEN
    // rect; final tick doubles each dimension (888 × 208 → sx = sy = 2).
    const tickRects = Array.from({ length: 8 }, (_, i) => ({
      x: 108,
      y: 108,
      width: 444 + (i + 1) * (444 / 8),
      height: 104 + (i + 1) * (104 / 8),
    }));
    const finalRect = tickRects[tickRects.length - 1];
    if (!finalRect) throw new Error('no final rect');

    // SAFE (the overlay's commit): scale the frozen members+box to the final
    // rect → clean 2x. Members keep their relative spacing; the box doubles.
    const safe = computeFrozenResizeUpdates(startNodes, startRect, finalRect);
    const safeA = safe.find((u) => u.id === 'node-a');
    const safeBox = safe.find((u) => u.id === 'grp-1');
    expect(safeA?.width).toBeCloseTo(320, 5); // 160 * 2
    expect(safeBox?.width).toBeCloseTo(888, 5); // 444 * 2
    // node-b keeps its spacing from node-a: start gap 260 → 520 at 2x.
    const safeB = safe.find((u) => u.id === 'node-b');
    if (!safeA || !safeB) throw new Error('missing scaled members');
    expect(safeB.position.x - safeA.position.x).toBeCloseTo(520, 5);

    // BUGGY (the v1 echo on the group branch): feed the previous tick's output
    // back each tick → compounding.
    let liveNodes: FrozenNode[] = startNodes;
    for (const rect of tickRects) {
      const out = computeFrozenResizeUpdates(liveNodes, startRect, rect);
      liveNodes = out.map((u) => ({
        id: u.id,
        position: u.position,
        width: u.width,
        height: u.height,
      }));
    }
    const buggyA = liveNodes.find((n) => n.id === 'node-a');
    if (!buggyA?.width || !safeA.width) throw new Error('lost width');
    // The group branch blows up by well over an order of magnitude when fed the
    // live echo — exactly the runaway the frozen baseline prevents.
    expect(buggyA.width).toBeGreaterThan(safeA.width * 10);
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
    // The container is a pure positioning box: NO z-index of its own (z-auto, so
    // it establishes no stacking context) — that's what lets the marquee drop
    // below a selected group while the handles stay above it.
    expect(style.zIndex).toBeUndefined();
    // Padded rect: union (0,0)→(300,300) expanded by 12 on each side.
    expect(style.left).toBe(0 - SELECTION_OVERLAY_PADDING);
    expect(style.top).toBe(0 - SELECTION_OVERLAY_PADDING);
    expect(style.width).toBe(300 + SELECTION_OVERLAY_PADDING * 2);
    expect(style.height).toBe(300 + SELECTION_OVERLAY_PADDING * 2);
  });

  it('draws the dashed marquee as a low-z child so a selected group’s circles paint on top', () => {
    const tree = renderWithHooks(() => SelectionResizeOverlay({ selectedNodes: twoLoose }));
    const marquee = findAll(tree, (el) => testId(el) === 'selection-overlay-marquee')[0];
    if (!marquee) throw new Error('selection-overlay-marquee not found');
    const style = (marquee.props.style ?? {}) as React.CSSProperties;
    // Purely visual — never steals clicks.
    expect(style.pointerEvents).toBe('none');
    // Below a selected group (GROUP_NODE_Z_INDEX = -1) so the group's connection
    // handles (trapped in the group's -1 context) render on top of the marquee.
    expect(Number(style.zIndex)).toBe(MARQUEE_Z_INDEX);
    expect(MARQUEE_Z_INDEX).toBeLessThan(-1);
    // The dashed border lives here now, not on the container.
    expect(String(style.border)).toContain('dashed');
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
      // Above every node + the marquee so the handle is always grabbable.
      expect(Number(style.zIndex)).toBe(OVERLAY_CHROME_Z_INDEX);
      expect(OVERLAY_CHROME_Z_INDEX).toBeGreaterThanOrEqual(1500);
      expect(h.props['aria-label']).toBe('Resize selection');
    }
  });

  it('M3: each corner handle wires the pointer gesture (down/move/up/cancel)', () => {
    // The M2 chrome was inert (handlers existed but never dispatched). M3 keeps
    // the same four wired handlers AND makes pointer-up dispatch. We can't drive
    // the full gesture here without re-implementing xyflow's store + viewport
    // contract (which the design warns against re-fighting, L0.4) — the live
    // gesture + no-runaway is proven by the pure `computeFrozenResizeUpdates`
    // tripwire above and the orchestrator's browser test. Here we assert the
    // gesture is WIRED: each handle exposes the four pointer callbacks as
    // functions, so a pointer-down can start the drag and pointer-up can commit.
    const tree = renderWithHooks(() => SelectionResizeOverlay({ selectedNodes: twoLoose }));
    const handles = findAll(tree, (el) => /^selection-overlay-handle-/.test(testId(el) ?? ''));
    expect(handles).toHaveLength(4);
    for (const h of handles) {
      expect(typeof h.props.onPointerDown).toBe('function');
      expect(typeof h.props.onPointerMove).toBe('function');
      expect(typeof h.props.onPointerUp).toBe('function');
      expect(typeof h.props.onPointerCancel).toBe('function');
    }
  });

  it('icon slot is present but inert when no onGroupAction is wired', () => {
    const tree = renderWithHooks(() => SelectionResizeOverlay({ selectedNodes: twoLoose }));
    const slot = findAll(tree, (el) => testId(el) === 'selection-overlay-icon-slot');
    expect(slot).toHaveLength(1);
    // No action wired → inert slot, and no button mounted.
    const style = (slot[0]?.props.style ?? {}) as React.CSSProperties;
    expect(style.pointerEvents).toBe('none');
    const btn = findAll(tree, (el) => testId(el) === 'selection-overlay-group-action');
    expect(btn).toHaveLength(0);
  });

  it('M4: renders the ＋ Create group button (data-action=create, aria-label) for a loose selection', () => {
    const tree = renderWithHooks(() =>
      SelectionResizeOverlay({ selectedNodes: twoLoose, onGroupAction: () => {} }),
    );
    const slot = findAll(tree, (el) => testId(el) === 'selection-overlay-icon-slot');
    // Slot becomes interactive when an action is wired.
    expect((slot[0]?.props.style as React.CSSProperties).pointerEvents).toBe('auto');
    const btn = findAll(tree, (el) => testId(el) === 'selection-overlay-group-action')[0];
    if (!btn) throw new Error('group-action button not found');
    expect(btn.props['data-action']).toBe('create');
    expect(btn.props['aria-label']).toBe('Create group');
    expect(typeof btn.props.onClick).toBe('function');
  });

  it('M4: the icon/label TOGGLES ＋↔⊟ to Ungroup for a single group selection', () => {
    const tree = renderWithHooks(() =>
      SelectionResizeOverlay({
        selectedNodes: [node('member', 0, 0, 80, 60), node('g1', 0, 0, 120, 100)],
        isGroupSelection: true,
        onGroupAction: () => {},
      }),
    );
    const btn = findAll(tree, (el) => testId(el) === 'selection-overlay-group-action')[0];
    if (!btn) throw new Error('group-action button not found');
    expect(btn.props['data-action']).toBe('ungroup');
    expect(btn.props['aria-label']).toBe('Ungroup');
  });

  it('M4: clicking the button invokes onGroupAction once', () => {
    let calls = 0;
    const tree = renderWithHooks(() =>
      SelectionResizeOverlay({
        selectedNodes: twoLoose,
        onGroupAction: () => {
          calls += 1;
        },
      }),
    );
    const btn = findAll(tree, (el) => testId(el) === 'selection-overlay-group-action')[0];
    const onClick = btn?.props.onClick as ((e: unknown) => void) | undefined;
    if (!onClick) throw new Error('onClick missing');
    onClick({ stopPropagation: () => {} });
    expect(calls).toBe(1);
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
