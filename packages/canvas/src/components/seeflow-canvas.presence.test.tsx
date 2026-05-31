import { describe, expect, it } from 'bun:test';
import { ReactFlow, ViewportPortal } from '@xyflow/react';
import * as React from 'react';
import type { CanvasAdapter, CanvasRuntime } from '../adapter/types.ts';
import type { Connector, FlowNode } from '../types.ts';
import {
  SeeflowCanvas,
  type SeeflowCanvasHandle,
  type SeeflowCanvasProps,
} from './seeflow-canvas.tsx';

// US-048 — `presenceLayer` slot + `onCursorMove` callback wiring.
//
// Reuses the hook-shim pattern (see seeflow-canvas.test.tsx) so we can walk
// the React element tree returned by `SeeflowCanvas.render` and call the
// pointer handler directly without a real DOM. Kept in a separate file
// because (a) the existing 3,800-line test file is already at slot-bookkeeping
// limits and (b) it lets the AC-named file `seeflow-canvas.presence.test.tsx`
// run in isolation via `bun test packages/canvas/src/components/seeflow-canvas.presence.test.tsx`.

type CapturedEffect = { cb: () => void; deps?: readonly unknown[] };

type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: (cb: () => void, deps?: readonly unknown[]) => void;
  useImperativeHandle: <T>(
    ref: React.ForwardedRef<T>,
    init: () => T,
    deps?: readonly unknown[],
  ) => void;
};

function renderWithHooks<T>(
  fn: () => T,
  options: {
    refSink?: { current: unknown }[];
    effectSink?: CapturedEffect[];
  } = {},
): T {
  const { refSink, effectSink } = options;
  const internals = (
    React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: Hooks | null };
      };
    }
  ).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const prev = internals.ReactCurrentDispatcher.current;
  internals.ReactCurrentDispatcher.current = {
    useState: <S,>(initial: S | (() => S)) => {
      const value = typeof initial === 'function' ? (initial as () => S)() : initial;
      return [value, () => {}];
    },
    useCallback: <T,>(fn: T) => fn,
    useMemo: <T,>(fn: () => T) => fn(),
    useRef: <T,>(initial: T) => {
      const ref = { current: initial };
      refSink?.push(ref as { current: unknown });
      return ref;
    },
    useEffect: (cb: () => void, deps?: readonly unknown[]) => {
      effectSink?.push({ cb, deps });
    },
    useImperativeHandle: <T,>(
      ref: React.ForwardedRef<T>,
      init: () => T,
      _deps?: readonly unknown[],
    ) => {
      if (ref === null) return;
      if (typeof ref === 'function') {
        ref(init());
        return;
      }
      (ref as { current: T | null }).current = init();
    },
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

function findElement(
  tree: unknown,
  predicate: (el: ReactElementLike) => boolean,
): ReactElementLike | null {
  if (!isElement(tree)) return null;
  if (predicate(tree)) return tree;
  const children = tree.props.children;
  if (children === undefined || children === null) return null;
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

function findAncestor(
  tree: unknown,
  needle: ReactElementLike,
  predicate: (el: ReactElementLike) => boolean,
): boolean {
  // Returns true if `needle` is a descendant of an element matching `predicate`.
  if (!isElement(tree)) return false;
  if (predicate(tree)) {
    if (findElement(tree, (el) => el === needle)) return true;
  }
  const children = tree.props.children;
  if (children === undefined || children === null) return false;
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) {
    if (findAncestor(child, needle, predicate)) return true;
  }
  return false;
}

const noopAdapter: CanvasAdapter = new Proxy({} as CanvasAdapter, {
  get(_t, key) {
    return () => {
      throw new Error(`adapter.${String(key)} should not be invoked in unit tests`);
    };
  },
});

type LegacyOverrides = Partial<SeeflowCanvasProps> & {
  nodeOverrides?: Record<string, Partial<FlowNode>>;
  connectorOverrides?: Record<string, Partial<Connector>>;
};

function callSeeflowCanvas(
  overrides: LegacyOverrides = {},
  hookOptions: {
    refSink?: { current: unknown }[];
    effectSink?: CapturedEffect[];
    ref?: React.ForwardedRef<SeeflowCanvasHandle>;
  } = {},
): unknown {
  const { nodeOverrides, connectorOverrides, runtime, ...rest } = overrides;
  const builtRuntime: CanvasRuntime | undefined =
    runtime ??
    (nodeOverrides || connectorOverrides
      ? { pendingOverrides: { nodes: nodeOverrides, connectors: connectorOverrides } }
      : undefined);
  const props = {
    mode: 'edit',
    adapter: noopAdapter,
    nodes: [],
    connectors: [],
    selectedNodeIds: [],
    selectedConnectorIds: [],
    canvasMode: { kind: 'select' },
    onCanvasModeChange: () => {},
    ...rest,
    runtime: builtRuntime,
  } as unknown as SeeflowCanvasProps;
  const renderFn = (
    SeeflowCanvas as unknown as {
      render: (p: SeeflowCanvasProps, r: React.ForwardedRef<SeeflowCanvasHandle>) => unknown;
    }
  ).render;
  return renderWithHooks(() => renderFn(props, hookOptions.ref ?? null), hookOptions);
}

// rfInstanceRef is the THIRD useRef in SeeflowCanvas (slot 2): flagsRef (0),
// wrapperRef (1), rfInstanceRef (2). Mirrors the constant in the main test
// file — duplicated here to keep this presence test self-contained.
const RF_INSTANCE_REF_SLOT = 2;

describe('SeeflowCanvas — US-048 presence layer + cursor callback', () => {
  it('renders the presenceLayer slot inside the React Flow viewport', () => {
    // `presenceLayer` is a ReactNode passed through directly. The canvas wraps
    // it in <ViewportPortal> so the layer transforms with pan/zoom — but the
    // hook-shim render pipeline doesn't execute <ReactFlow>'s body, so we just
    // confirm the layer node is in the returned tree AND that its enclosing
    // <ViewportPortal> sits inside the <ReactFlow> element (i.e. would be
    // mounted inside the viewport at runtime).
    const tree = callSeeflowCanvas({
      presenceLayer: <div data-testid="layer" />,
    });
    const layer = findElement(
      tree,
      (el) => isElement(el) && (el.props as { 'data-testid'?: unknown })['data-testid'] === 'layer',
    );
    expect(layer).not.toBeNull();
    if (!layer) return;
    const wrappedInPortal = findAncestor(tree, layer, (el) => el.type === ViewportPortal);
    expect(wrappedInPortal).toBe(true);
    const mountedInReactFlow = findAncestor(tree, layer, (el) => el.type === ReactFlow);
    expect(mountedInReactFlow).toBe(true);
  });

  it('skips the ViewportPortal entirely when presenceLayer is undefined', () => {
    // The legacy path (no presence) must add zero React-tree weight — no
    // ViewportPortal node, no pointer-events-none wrapper. This guards
    // against accidentally always mounting the portal.
    const tree = callSeeflowCanvas();
    const portal = findElement(tree, (el) => el.type === ViewportPortal);
    expect(portal).toBeNull();
  });

  it('does not invoke onCursorMove when the callback is absent', () => {
    // Regression net for the "zero extra work" promise: with no onCursorMove
    // prop the wrapper's onPointerMove must not touch rfInstanceRef or
    // attempt any flow-coord conversion.
    const refs: { current: unknown }[] = [];
    let rfInstanceRead = false;
    const tree = callSeeflowCanvas({}, { refSink: refs });
    const rfRef = refs[RF_INSTANCE_REF_SLOT];
    if (!rfRef) throw new Error('rfInstance ref slot not captured');
    // Trap any read of `.current` so we can assert the handler never asks.
    let backing: unknown = null;
    Object.defineProperty(rfRef, 'current', {
      get() {
        rfInstanceRead = true;
        return backing;
      },
      set(v) {
        backing = v;
      },
    });
    const wrapper = findElement(
      tree,
      (el) =>
        isElement(el) &&
        (el.props as { 'data-testid'?: unknown })['data-testid'] === 'seeflow-canvas',
    );
    if (!wrapper) throw new Error('wrapper div not found');
    const onPointerMove = wrapper.props.onPointerMove as (e: unknown) => void;
    onPointerMove({ clientX: 100, clientY: 200, pointerId: 1 });
    expect(rfInstanceRead).toBe(false);
  });

  it('invokes onCursorMove with finite flow coords + viewport from rfInstance', () => {
    // The handler must:
    //   - call rfInstance.screenToFlowPosition(clientX/Y) for the coords,
    //   - call rfInstance.getViewport() for the viewport,
    //   - pass `flowId` = flowSlug ?? null in the coords object.
    const refs: { current: unknown }[] = [];
    const captured: Array<{
      coords: { x: number; y: number; flowId: string | null };
      viewport: { x: number; y: number; zoom: number };
    }> = [];
    const onCursorMove = (
      coords: { x: number; y: number; flowId: string | null },
      viewport: { x: number; y: number; zoom: number },
    ) => {
      captured.push({ coords, viewport });
    };

    const tree = callSeeflowCanvas({ onCursorMove, flowSlug: 'my-flow' }, { refSink: refs });
    const rfRef = refs[RF_INSTANCE_REF_SLOT];
    if (!rfRef) throw new Error('rfInstance ref slot not captured');
    rfRef.current = {
      // Identity stub: flow coords mirror client coords so the assertions
      // can pin exact numbers without tracking xyflow's matrix math.
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      getViewport: () => ({ x: -50, y: -25, zoom: 1.5 }),
    };

    const wrapper = findElement(
      tree,
      (el) =>
        isElement(el) &&
        (el.props as { 'data-testid'?: unknown })['data-testid'] === 'seeflow-canvas',
    );
    if (!wrapper) throw new Error('wrapper div not found');
    const onPointerMove = wrapper.props.onPointerMove as (e: unknown) => void;
    onPointerMove({ clientX: 300, clientY: 200, pointerId: 1 });

    expect(captured.length).toBe(1);
    const first = captured[0];
    if (!first) throw new Error('onCursorMove was not called');
    expect(first.coords.x).toBe(300);
    expect(first.coords.y).toBe(200);
    expect(Number.isFinite(first.coords.x)).toBe(true);
    expect(Number.isFinite(first.coords.y)).toBe(true);
    expect(first.coords.flowId).toBe('my-flow');
    expect(first.viewport).toEqual({ x: -50, y: -25, zoom: 1.5 });
  });

  it('passes flowId=null in onCursorMove when flowSlug is omitted', () => {
    // Hosts that mount the canvas without a flow slug (e.g. landing surface
    // before a flow is loaded) should still get a well-formed payload — the
    // `flowId` field is part of the contract.
    const refs: { current: unknown }[] = [];
    const captured: Array<{ coords: { flowId: string | null } }> = [];
    const onCursorMove = (coords: { x: number; y: number; flowId: string | null }) => {
      captured.push({ coords });
    };

    const tree = callSeeflowCanvas({ onCursorMove }, { refSink: refs });
    const rfRef = refs[RF_INSTANCE_REF_SLOT];
    if (!rfRef) throw new Error('rfInstance ref slot not captured');
    rfRef.current = {
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    };

    const wrapper = findElement(
      tree,
      (el) =>
        isElement(el) &&
        (el.props as { 'data-testid'?: unknown })['data-testid'] === 'seeflow-canvas',
    );
    if (!wrapper) throw new Error('wrapper div not found');
    (wrapper.props.onPointerMove as (e: unknown) => void)({
      clientX: 10,
      clientY: 20,
      pointerId: 1,
    });
    expect(captured.length).toBe(1);
    expect(captured[0]?.coords.flowId).toBeNull();
  });
});
