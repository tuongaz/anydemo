import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Node } from '@xyflow/react';
import * as React from 'react';
import type { GuideLine } from './geometry.ts';
import {
  type AlignmentModifierEvent,
  type NodeChangeLike,
  type UseAlignmentGuidesApi,
  type UseAlignmentGuidesParams,
  useAlignmentGuides,
} from './use-alignment-guides.ts';

// ---------------------------------------------------------------------------
// Deterministic requestAnimationFrame queue. The hook batches guide commits via
// RAF; tests drive paints explicitly with flushRaf() so "10 calls → 1 commit"
// is observable without real timers.
// ---------------------------------------------------------------------------
type RafEntry = { id: number; cb: FrameRequestCallback };
let rafQueue: RafEntry[] = [];
let rafSeq = 0;
let savedRaf: typeof globalThis.requestAnimationFrame;
let savedCaf: typeof globalThis.cancelAnimationFrame;

function flushRaf(): void {
  const due = rafQueue;
  rafQueue = [];
  for (const entry of due) entry.cb(0);
}

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
// Hook-shim: render the hook by swapping React's internal dispatcher with
// synchronous stubs (same pattern as seeflow-canvas.test.tsx). `setterCalls`
// captures every setState invocation so we can count guide commits.
// ---------------------------------------------------------------------------
type SetterCall = { slot: number; next: unknown };

function renderHook(params: UseAlignmentGuidesParams): {
  api: UseAlignmentGuidesApi;
  setterCalls: SetterCall[];
} {
  const internals = (
    React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: unknown };
      };
    }
  ).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const prev = internals.ReactCurrentDispatcher.current;
  const setterCalls: SetterCall[] = [];
  let stateIndex = 0;
  internals.ReactCurrentDispatcher.current = {
    useState: <S>(initial: S | (() => S)) => {
      const idx = stateIndex++;
      const value = typeof initial === 'function' ? (initial as () => S)() : initial;
      const setter = (next: S | ((prev: S) => S)) => {
        setterCalls.push({ slot: idx, next });
      };
      return [value, setter];
    },
    useCallback: <T>(fn: T) => fn,
    useMemo: <T>(fn: () => T) => fn(),
    useRef: <T>(initial: T) => ({ current: initial }),
    useEffect: () => {},
  };
  try {
    const api = useAlignmentGuides(params);
    return { api, setterCalls };
  } finally {
    internals.ReactCurrentDispatcher.current = prev;
  }
}

function node(id: string, x: number, y: number, w: number, h: number): Node {
  return {
    id,
    position: { x, y },
    data: {},
    width: w,
    height: h,
  } as unknown as Node;
}

function makeParams(nodes: Node[], overrides: Partial<UseAlignmentGuidesParams> = {}) {
  const rfNodesRef = { current: nodes };
  return {
    rfNodesRef,
    params: {
      enabled: true,
      thresholdPx: 6,
      viewport: { x: 0, y: 0, zoom: 1 },
      rfNodesRef,
      ...overrides,
    } satisfies UseAlignmentGuidesParams,
  };
}

const noMods: AlignmentModifierEvent = {};

function posChange(id: string, x: number, y: number): NodeChangeLike {
  return { type: 'position', id, position: { x, y }, dragging: true };
}

/** The terminal drag-stop change xyflow emits with `dragging: false`. */
function posChangeStop(id: string, x: number, y: number): NodeChangeLike {
  return { type: 'position', id, position: { x, y }, dragging: false };
}

function lastGuides(setterCalls: SetterCall[]): GuideLine[] {
  const last = setterCalls.at(-1);
  return (last?.next ?? []) as GuideLine[];
}

describe('useAlignmentGuides', () => {
  describe('RAF batching', () => {
    it('coalesces 10 intercept calls within one frame into a single state commit', () => {
      const { params } = makeParams([node('A', 0, 0, 100, 100), node('B', 300, 0, 100, 100)]);
      const { api, setterCalls } = renderHook(params);
      api.beginGesture(['B']);

      // 10 drag frames, all before a paint. Each lands B's left edge 2px from A.
      for (let i = 0; i < 10; i++) {
        api.interceptChanges([posChange('B', 2, 0)], noMods);
      }
      // No paint yet → no commit.
      expect(setterCalls.length).toBe(0);

      flushRaf();
      // Exactly one commit for the whole frame's worth of intercepts.
      expect(setterCalls.length).toBe(1);
      expect(lastGuides(setterCalls).length).toBeGreaterThan(0);
    });

    it('does not re-commit when the guide set is structurally unchanged across frames', () => {
      const { params } = makeParams([node('A', 0, 0, 100, 100), node('B', 300, 0, 100, 100)]);
      const { api, setterCalls } = renderHook(params);
      api.beginGesture(['B']);

      api.interceptChanges([posChange('B', 2, 0)], noMods);
      flushRaf();
      expect(setterCalls.length).toBe(1);

      // Same alignment next frame → identical guide key → no second commit.
      api.interceptChanges([posChange('B', 2, 0)], noMods);
      flushRaf();
      expect(setterCalls.length).toBe(1);
    });
  });

  describe('snap interception', () => {
    it('rewrites the dragged position to the aligned coordinate', () => {
      const { params } = makeParams([node('A', 0, 0, 100, 100), node('B', 300, 0, 100, 100)]);
      const { api } = renderHook(params);
      api.beginGesture(['B']);

      // B dragged so its left edge sits 2px right of A's left edge (within 6).
      const out = api.interceptChanges([posChange('B', 2, 0)], noMods);
      const change = out[0] as NodeChangeLike;
      // Snaps B's left edge to x=0 (aligned with A).
      expect(change.position?.x).toBe(0);
    });

    it('snaps the terminal drag-stop change so the committed position matches the live snap', () => {
      // Regression: on mouse release xyflow emits a final position change with
      // `dragging: false` carrying its raw (unsnapped) internal position. If the
      // hook only rewrites `dragging: true` frames, the committed position is the
      // raw one and the node visibly jumps 1-2px from where it snapped. The
      // snapshot is still active on this frame (endGesture runs afterwards), so
      // the terminal change must receive the same snap offset.
      const { params } = makeParams([node('A', 0, 0, 100, 100), node('B', 300, 0, 100, 100)]);
      const { api } = renderHook(params);
      api.beginGesture(['B']);

      // Last live drag frame snaps B's left edge from x=2 to x=0.
      const live = api.interceptChanges([posChange('B', 2, 0)], noMods);
      expect((live[0] as NodeChangeLike).position?.x).toBe(0);

      // Terminal frame at the same raw position must commit the snapped x=0.
      const stop = api.interceptChanges([posChangeStop('B', 2, 0)], noMods);
      expect((stop[0] as NodeChangeLike).position?.x).toBe(0);
    });

    it('passes changes through untouched when disabled', () => {
      const { params } = makeParams([node('A', 0, 0, 100, 100), node('B', 300, 0, 100, 100)], {
        enabled: false,
      });
      const { api, setterCalls } = renderHook(params);
      api.beginGesture(['B']);
      const changes = [posChange('B', 2, 0)];
      const out = api.interceptChanges(changes, noMods);
      expect(out).toBe(changes);
      flushRaf();
      expect(setterCalls.length).toBe(0);
    });
  });

  describe('modifier-key suppress', () => {
    it('returns the raw delta and clears guides on the next tick', () => {
      const { params } = makeParams([node('A', 0, 0, 100, 100), node('B', 300, 0, 100, 100)]);
      const { api, setterCalls } = renderHook(params);
      api.beginGesture(['B']);

      // First, a normal frame commits a non-empty guide set.
      api.interceptChanges([posChange('B', 2, 0)], noMods);
      flushRaf();
      expect(setterCalls.length).toBe(1);
      expect(lastGuides(setterCalls).length).toBeGreaterThan(0);

      // Now hold Cmd: raw changes returned (no snap), guides cleared next tick.
      const changes = [posChange('B', 2, 0)];
      const out = api.interceptChanges(changes, { metaKey: true });
      expect(out).toBe(changes);
      expect((out[0] as NodeChangeLike).position?.x).toBe(2); // unchanged

      flushRaf();
      expect(setterCalls.length).toBe(2);
      expect(lastGuides(setterCalls)).toEqual([]);
    });

    it('honors ctrlKey the same as metaKey', () => {
      const { params } = makeParams([node('A', 0, 0, 100, 100), node('B', 300, 0, 100, 100)]);
      const { api } = renderHook(params);
      api.beginGesture(['B']);
      const changes = [posChange('B', 2, 0)];
      const out = api.interceptChanges(changes, { ctrlKey: true });
      expect(out).toBe(changes);
    });
  });

  describe('gesture lifecycle', () => {
    it('produces guides on drag and clears them + drops the snapshot on end', () => {
      const { params } = makeParams([node('A', 0, 0, 100, 100), node('B', 300, 0, 100, 100)]);
      const { api, setterCalls } = renderHook(params);

      api.beginGesture(['B']);
      api.interceptChanges([posChange('B', 2, 0)], noMods);
      flushRaf();
      expect(lastGuides(setterCalls).length).toBeGreaterThan(0);

      api.endGesture();
      // endGesture commits an empty guide set synchronously.
      expect(lastGuides(setterCalls)).toEqual([]);

      // Snapshot dropped: a subsequent intercept can't snap (returns raw).
      const changes = [posChange('B', 2, 0)];
      const out = api.interceptChanges(changes, noMods);
      expect(out).toBe(changes);
    });
  });

  describe('resize lifecycle', () => {
    it('snaps the active right edge and leaves the left edge fixed', () => {
      // A is the node being resized; B is the reference to its right.
      const { params } = makeParams([node('A', 0, 0, 158, 100), node('B', 160, 0, 100, 100)]);
      const { api, setterCalls } = renderHook(params);

      api.beginResize('A', { right: true });
      // Right edge currently at 158; B's left edge is 160 (2px away, within 6).
      const { snappedRect, guides } = api.applyResizeSnap(
        { id: 'A', x: 0, y: 0, w: 158, h: 100 },
        noMods,
      );
      // Right edge snaps to 160 → width 160; origin x untouched.
      expect(snappedRect.x).toBe(0);
      expect(snappedRect.w).toBe(160);
      expect(guides.length).toBeGreaterThan(0);

      flushRaf();
      expect(setterCalls.length).toBe(1);

      api.endResize();
      expect(lastGuides(setterCalls)).toEqual([]);
    });

    it('suppresses resize snap under the modifier key', () => {
      const { params } = makeParams([node('A', 0, 0, 158, 100), node('B', 160, 0, 100, 100)]);
      const { api } = renderHook(params);
      api.beginResize('A', { right: true });
      const raw = { id: 'A', x: 0, y: 0, w: 158, h: 100 };
      const { snappedRect, guides } = api.applyResizeSnap(raw, { ctrlKey: true });
      expect(snappedRect).toBe(raw);
      expect(guides).toEqual([]);
    });
  });
});
