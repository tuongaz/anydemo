import { describe, expect, it } from 'bun:test';
import { type Connection, Controls, type Node, ReactFlow } from '@xyflow/react';
import * as React from 'react';
import type { CanvasAdapter, CanvasRuntime } from '../adapter/types.ts';
import { COLOR_TOKENS, NODE_DEFAULT_BG_WHITE } from '../lib/color-tokens.ts';
import { CloudShape } from '../nodes/shapes/cloud.tsx';
import { DatabaseShape } from '../nodes/shapes/database.tsx';
import { QueueShape } from '../nodes/shapes/queue.tsx';
import { ServerShape } from '../nodes/shapes/server.tsx';
import { UserShape } from '../nodes/shapes/user.tsx';
import type { Connector, FlowNode } from '../types.ts';
import { CanvasToolbar, HTML_BLOCK_DND_TYPE } from './canvas-toolbar.tsx';
import { DetailPanel } from './detail-panel.tsx';
import {
  type ClipboardShortcutEventLike,
  FIT_VIEW_OPTIONS,
  SeeflowCanvas,
  type SeeflowCanvasHandle,
  type SeeflowCanvasProps,
  classifyHandleDropFailure,
  classifyReconnectBodyDrop,
  computeUnmovedLockPin,
  eventTargetIsOtherNode,
  handleClipboardShortcut,
  resolveAutoFitView,
  resolveFlags,
} from './seeflow-canvas.tsx';
import { type MultiResizeUpdate, SelectionResizeOverlay } from './selection-resize-overlay.tsx';
import { ShareMenu } from './share-menu.tsx';
import { StyleStrip } from './style-strip.tsx';

// Bun runs apps/web tests without a DOM. The hook-shim pattern (also used by
// icon-node.test.tsx / icon-picker-popover.test.tsx) replaces React's internal
// dispatcher with synchronous stubs so we can call SeeflowCanvas as a function
// and walk the returned React element tree. Sub-components — ReactFlow,
// Background, Controls, StoreApiBridge, CanvasToolbar etc. — are captured as
// `{ type, props }` placeholders without executing their render bodies, so
// xyflow's zustand-provider requirement never trips.
/**
 * Captured useEffect call. `cb` is the effect body, `deps` mirrors the second
 * argument (undefined = "every render"). The US-009 tests fire `cb()` manually
 * to simulate React's mount-run + dep-change re-run behavior under the shim.
 */
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

/**
 * `useStateOverrides`, when provided, replaces the Nth useState call's initial
 * value with the corresponding entry from the array (undefined = passthrough).
 * `refSink`, when provided, receives each useRef in declaration order so the
 * test can mutate ref.current to drive handlers that read from refs.
 * `effectSink`, when provided, captures each useEffect's `{ cb, deps }` in
 * declaration order so a test can fire individual effects manually (US-009 —
 * simulating React's mount + dep-change re-run semantics under the shim).
 */
function renderWithHooks<T>(
  fn: () => T,
  options: {
    useStateOverrides?: ReadonlyArray<unknown>;
    refSink?: { current: unknown }[];
    effectSink?: CapturedEffect[];
  } = {},
): T {
  const { useStateOverrides, refSink, effectSink } = options;
  const internals = (
    React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: Hooks | null };
      };
    }
  ).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const prev = internals.ReactCurrentDispatcher.current;
  let useStateIndex = 0;
  internals.ReactCurrentDispatcher.current = {
    useState: <S,>(initial: S | (() => S)) => {
      const idx = useStateIndex++;
      const override = useStateOverrides?.[idx];
      if (override !== undefined) return [override as S, () => {}];
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
      // Imperative handle install — populate the ref synchronously so tests can
      // assert ref.current after the render call returns.
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

// US-025: every SeeflowCanvasProps now requires an adapter. Inside these
// hook-shim tests no method is ever called, so a throwing stub catches any
// accidental mutation paths the test bodies introduce later.
const noopAdapter: CanvasAdapter = new Proxy({} as CanvasAdapter, {
  get(_t, key) {
    return () => {
      throw new Error(`adapter.${String(key)} should not be invoked in unit tests`);
    };
  },
});

// US-026: legacy convenience for tests written before the per-stream props
// were merged into a single `runtime` prop. Tests can keep passing
// `nodeOverrides` / `connectorOverrides` directly; the wrapper lifts them into
// `runtime.pendingOverrides` so the assertions reach the same code paths.
type LegacyOverrides = Partial<SeeflowCanvasProps> & {
  nodeOverrides?: Record<string, Partial<FlowNode>>;
  connectorOverrides?: Record<string, Partial<Connector>>;
};

function callSeeflowCanvas(
  overrides: LegacyOverrides = {},
  hookOptions: {
    useStateOverrides?: ReadonlyArray<unknown>;
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
  const props: SeeflowCanvasProps = {
    // US-027: tests default to mode='edit' so the legacy assertions (every
    // chrome render + handler reachable) continue to hold. Per-test overrides
    // can flip to mode='view' to assert the view-mode gating.
    mode: 'edit',
    adapter: noopAdapter,
    nodes: [],
    connectors: [],
    selectedNodeIds: [],
    selectedConnectorIds: [],
    // Canvas mode (Select/Hand/Draw) is lifted to demo-view; tests pass
    // `canvasMode` directly. Defaults keep the canvas in Select-mode so legacy
    // tests see the same behavior they did when drawShape was internal state.
    canvasMode: { kind: 'select' },
    onCanvasModeChange: () => {},
    ...rest,
    runtime: builtRuntime,
  };
  // US-014: SeeflowCanvas is now a forwardRef component, so we invoke `.render`
  // directly under the hook shim. The optional `ref` flows through so a test
  // can assert the imperative handle population.
  const renderFn = (
    SeeflowCanvas as unknown as {
      render: (p: SeeflowCanvasProps, r: React.ForwardedRef<SeeflowCanvasHandle>) => unknown;
    }
  ).render;
  return renderWithHooks(() => renderFn(props, hookOptions.ref ?? null), hookOptions);
}

function makeShapeNode(id: string): FlowNode {
  return {
    id,
    type: 'shapeNode',
    position: { x: 0, y: 0 },
    data: { name: id, shape: 'rectangle' },
  };
}

function makeTextNode(id: string): FlowNode {
  return {
    id,
    type: 'shapeNode',
    position: { x: 0, y: 0 },
    data: { name: id, shape: 'text' },
  };
}

function makeConnection(source: string, target: string): Connection {
  return { source, target, sourceHandle: null, targetHandle: null };
}

describe('SeeflowCanvas', () => {
  it('wires selectNodesOnDrag={false} on the ReactFlow root', () => {
    // US-018: dragging an unselected node moves it without auto-selecting
    // (and therefore without opening the detail panel). React Flow defaults
    // this to true; the explicit false on the JSX is the only switch.
    const tree = callSeeflowCanvas();
    const rf = findElement(tree, (el) => el.type === ReactFlow);
    if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
    expect(rf.props.selectNodesOnDrag).toBe(false);
  });

  it('wires nodeClickDistance > 0 so jitter during click still selects', () => {
    // Regression: xyflow defaults nodeClickDistance to 0, which combined with
    // selectNodesOnDrag={false} makes ANY sub-pixel pointer jitter between
    // mousedown and mouseup register as a drag (no selection) instead of a
    // click. Symptom: clicking a node often does nothing on the first try.
    // The explicit positive value gives the user click-tolerance.
    const tree = callSeeflowCanvas();
    const rf = findElement(tree, (el) => el.type === ReactFlow);
    if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
    expect(rf.props.nodeClickDistance).toBeGreaterThan(0);
  });

  describe('US-025: only the selected node may originate a new connection', () => {
    it('unselected nodes receive connectable: false on the rfNode payload', () => {
      // Per xyflow's NodeWrapper:
      //   isConnectable = !!(node.connectable || (nodesConnectable && typeof node.connectable === 'undefined'))
      // Setting node.connectable=false makes the unselected node's handles
      // ignore connection-start gestures regardless of the global
      // nodesConnectable, so onConnectStart never fires from those handles.
      const tree = callSeeflowCanvas({
        nodes: [makeShapeNode('a'), makeShapeNode('b')],
        selectedNodeIds: [],
        onCreateConnector: () => {},
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      const rfNodes = rf.props.nodes as Node[];
      const a = rfNodes.find((n) => n.id === 'a');
      const b = rfNodes.find((n) => n.id === 'b');
      expect(a?.connectable).toBe(false);
      expect(b?.connectable).toBe(false);
    });

    it('selected node has connectable left undefined so the global nodesConnectable gate still applies', () => {
      // Leaving node.connectable undefined defers to the ReactFlow root's
      // nodesConnectable, which we wire to !!onCreateConnector && !drawShape.
      // This keeps read-only and draw-mode gating consistent on the selected
      // node without redundantly recomputing it per node.
      const tree = callSeeflowCanvas({
        nodes: [makeShapeNode('a'), makeShapeNode('b')],
        selectedNodeIds: ['a'],
        onCreateConnector: () => {},
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      const rfNodes = rf.props.nodes as Node[];
      const a = rfNodes.find((n) => n.id === 'a');
      const b = rfNodes.find((n) => n.id === 'b');
      expect(a?.connectable).toBeUndefined();
      expect(b?.connectable).toBe(false);
    });

    it('connecting BETWEEN two unselected nodes is impossible (both gated false)', () => {
      // Confirms the PRD's "Connecting BETWEEN two unselected nodes is now
      // impossible" — both sides of the canvas are gated off until one is
      // explicitly selected by the user.
      const tree = callSeeflowCanvas({
        nodes: [makeShapeNode('a'), makeShapeNode('b'), makeShapeNode('c')],
        selectedNodeIds: ['c'],
        onCreateConnector: () => {},
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      const rfNodes = rf.props.nodes as Node[];
      expect(rfNodes.find((n) => n.id === 'a')?.connectable).toBe(false);
      expect(rfNodes.find((n) => n.id === 'b')?.connectable).toBe(false);
      expect(rfNodes.find((n) => n.id === 'c')?.connectable).toBeUndefined();
    });
  });

  describe('US-004: isValidConnection rejects text-shape endpoints', () => {
    // The callback is wired on the ReactFlow root; xyflow calls it during
    // a connection-drag gesture (and again when validating an edge into the
    // store). Returning false makes xyflow paint the candidate handle red
    // and skip onConnect. We assert the prop is wired and exercise the
    // callback directly with synthetic Connections.
    function getValidator(nodes: FlowNode[]): (c: Connection) => boolean {
      const tree = callSeeflowCanvas({ nodes, selectedNodeIds: [], onCreateConnector: () => {} });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      const validator = rf.props.isValidConnection as ((c: Connection) => boolean) | undefined;
      if (typeof validator !== 'function') {
        throw new Error('isValidConnection not wired on ReactFlow root');
      }
      return validator;
    }

    it('wires isValidConnection on the ReactFlow root', () => {
      const tree = callSeeflowCanvas();
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      expect(typeof rf.props.isValidConnection).toBe('function');
    });

    it('rejects a connection whose source is a text-shape node', () => {
      const validator = getValidator([makeTextNode('t1'), makeShapeNode('s1')]);
      expect(validator(makeConnection('t1', 's1'))).toBe(false);
    });

    it('rejects a connection whose target is a text-shape node', () => {
      const validator = getValidator([makeShapeNode('s1'), makeTextNode('t1')]);
      expect(validator(makeConnection('s1', 't1'))).toBe(false);
    });

    it('rejects a connection where both endpoints are text-shape nodes', () => {
      const validator = getValidator([makeTextNode('t1'), makeTextNode('t2')]);
      expect(validator(makeConnection('t1', 't2'))).toBe(false);
    });

    it('accepts a connection between two non-text shape nodes', () => {
      // Regression net for the existing valid-connection scenario: two
      // rectangles must remain wirable. Without this, the broader
      // "no false-negatives" promise of US-004 isn't pinned.
      const validator = getValidator([makeShapeNode('a'), makeShapeNode('b')]);
      expect(validator(makeConnection('a', 'b'))).toBe(true);
    });

    it('accepts a connection between two non-text shape nodes (second coverage)', () => {
      // The validator's text-shape predicate gates on `type === 'shapeNode'
      // && data.shape === 'text'` — non-text shapes must pass through.
      const validator = getValidator([makeShapeNode('s1'), makeShapeNode('s2')]);
      expect(validator(makeConnection('s1', 's2'))).toBe(true);
    });

    it('accepts a connection when an endpoint id is missing from the nodes prop', () => {
      // Defensive: if the connection refers to an unknown node id, the
      // validator must not throw and must default to "valid" (xyflow's
      // existing pipeline will reject the connection elsewhere if needed).
      const validator = getValidator([makeShapeNode('a')]);
      expect(validator(makeConnection('a', 'missing'))).toBe(true);
      expect(validator(makeConnection('missing', 'a'))).toBe(true);
    });
  });

  describe('US-023: connector drop on a freshly-created node lands every time', () => {
    // The bug: after creating a node via the toolbar drag-create flow, the
    // new node is unselected → its handles render with `connectable: false`
    // (US-025). xyflow's drop-validation then sets connectionState.isValid
    // === false for the freshly-created handle (the handle's `connectable`
    // class is missing), and the previous gate flashed red + bailed without
    // falling through to the body-drop fallback. Result: edge never lands
    // on the new node when the cursor releases near one of its handles.
    //
    // The fix has two layers — each independently tested:
    //  1. isValidConnection reads from rfNodesRef (post-merge xyflow node
    //     list including optimistic overrides), so a freshly-created text
    //     node is STILL rejected per US-004.
    //  2. The body-drop fallback ALWAYS runs when xyflow refuses a handle
    //     drop (`classifyHandleDropFailure` returns 'fall-through' for any
    //     `isValid === false`), and re-runs isValidConnection so US-004
    //     still holds on the fall-through path.

    function makeShapeNodeOverride(id: string): Partial<FlowNode> {
      return {
        id,
        type: 'shapeNode',
        position: { x: 100, y: 100 },
        data: { shape: 'rectangle', width: 120, height: 80 },
      };
    }

    function makeTextNodeOverride(id: string): Partial<FlowNode> {
      return {
        id,
        type: 'shapeNode',
        position: { x: 100, y: 100 },
        data: { shape: 'text', width: 120, height: 80 },
      };
    }

    function getValidatorWithOverrides(
      nodes: FlowNode[],
      nodeOverrides: Record<string, Partial<FlowNode>>,
      selectedNodeIds: readonly string[] = [],
    ): (c: Connection) => boolean {
      const tree = callSeeflowCanvas({
        nodes,
        nodeOverrides,
        selectedNodeIds,
        onCreateConnector: () => {},
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      const validator = rf.props.isValidConnection as ((c: Connection) => boolean) | undefined;
      if (typeof validator !== 'function') {
        throw new Error('isValidConnection not wired on ReactFlow root');
      }
      return validator;
    }

    it('isValidConnection accepts an edge to a freshly-created node (override-only)', () => {
      // Repro the failing scenario: an existing node + a freshly-created
      // node living in nodeOverrides (not yet echoed back into the `nodes`
      // prop from the server). Pre-fix the validator read from the `nodes`
      // prop and would happily fall through to "valid" for unknown ids —
      // but that meant the broader fix (refining the red-flash gate) had to
      // be the load-bearing piece. Pin the validator-side invariant too so
      // a future refactor can't silently regress to "fresh nodes are
      // invisible to the validator".
      const validator = getValidatorWithOverrides([makeShapeNode('existing')], {
        fresh: makeShapeNodeOverride('fresh'),
      });
      expect(validator(makeConnection('existing', 'fresh'))).toBe(true);
      expect(validator(makeConnection('fresh', 'existing'))).toBe(true);
    });

    it('isValidConnection rejects an edge to a freshly-created TEXT node', () => {
      // US-004 regression: even though the text node lives in
      // nodeOverrides (not yet in `nodes`), the validator must still reject
      // — otherwise a fresh text node would be wirable via the body-drop
      // fallback path until the SSE echo arrives.
      const validator = getValidatorWithOverrides([makeShapeNode('existing')], {
        'fresh-text': makeTextNodeOverride('fresh-text'),
      });
      expect(validator(makeConnection('existing', 'fresh-text'))).toBe(false);
      expect(validator(makeConnection('fresh-text', 'existing'))).toBe(false);
    });

    it('isValidConnection accepts an edge between any two non-text shape nodes', () => {
      // The validator does not gate on node relationship — any two shape nodes
      // that are not text can be connected.
      const child: FlowNode = makeShapeNode('child');
      const top = makeShapeNode('top');
      const tree = callSeeflowCanvas({
        nodes: [child, top],
        selectedNodeIds: [],
        onCreateConnector: () => {},
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      const validator = rf.props.isValidConnection as (c: Connection) => boolean;
      expect(validator(makeConnection('top', 'child'))).toBe(true);
      expect(validator(makeConnection('child', 'top'))).toBe(true);
    });

    describe('classifyHandleDropFailure (pure gate predicate)', () => {
      // User rule: "must allow to connect the outlet to any location on the
      // border." Dropping a reconnect/connect drag anywhere on a node's
      // border — including on a wrong-type handle dead-center — must fall
      // through to the body-drop fallback, which pins the perimeter at the
      // cursor. The red "wrong handle" flash from US-022 is removed entirely:
      // the only two outcomes are now "fall through to body-drop" or "no
      // flash, no fall-through" (toHandle was never hit / drop is valid).
      it('returns "no-flash-no-fall-through" when toHandle is null', () => {
        expect(classifyHandleDropFailure(null, false, [])).toBe('no-flash-no-fall-through');
      });

      it('returns "no-flash-no-fall-through" when isValid is true', () => {
        expect(classifyHandleDropFailure({ nodeId: 'a' }, true, [{ id: 'a' }])).toBe(
          'no-flash-no-fall-through',
        );
      });

      it('returns "no-flash-no-fall-through" when isValid is null (still in-progress)', () => {
        expect(classifyHandleDropFailure({ nodeId: 'a' }, null, [{ id: 'a' }])).toBe(
          'no-flash-no-fall-through',
        );
      });

      it('returns "fall-through" when the handle is fully connectable but isValid is false', () => {
        // Type-direction mismatch case (e.g. dragging a target endpoint onto
        // a source-type handle at the center of a node's border). Pre-fix
        // this returned 'flash' and the gesture aborted; post-fix we fall
        // through to the body-drop fallback so the endpoint pins to the
        // perimeter at the cursor.
        expect(classifyHandleDropFailure({ nodeId: 'a' }, false, [{ id: 'a' }])).toBe(
          'fall-through',
        );
        expect(
          classifyHandleDropFailure({ nodeId: 'a' }, false, [{ id: 'a', connectable: true }]),
        ).toBe('fall-through');
      });

      it('returns "fall-through" when the target node has connectable: false', () => {
        // Freshly-created (unselected) node case: handles render with
        // `connectable: false`, xyflow refuses the handle drop, body-drop
        // fallback still lands the connector on the node.
        expect(
          classifyHandleDropFailure({ nodeId: 'fresh' }, false, [
            { id: 'fresh', connectable: false },
          ]),
        ).toBe('fall-through');
      });

      it('returns "fall-through" when the target node is missing from the node list', () => {
        // Defensive: an unknown nodeId means we can't even verify the
        // node's connectable state, but the body-drop fallback re-runs
        // isValidConnection and hit-tests the DOM directly so it's the
        // right place to handle the gesture.
        expect(classifyHandleDropFailure({ nodeId: 'phantom' }, false, [])).toBe('fall-through');
      });
    });

    describe('classifyReconnectBodyDrop (pure pin/reconnect dispatch)', () => {
      // User rule: cursor over a node → use the closest perimeter point on
      // that node; cursor outside any node + drop → no-op. This dispatch
      // gate is the single point that decides which arm fires.
      it('drops on EMPTY SPACE (no node under cursor) → "no-op"', () => {
        // User explicitly requested: "When move the cursor outside of a
        // node, and drop, it won't do anything." The gesture is abandoned;
        // the edge restores.
        expect(classifyReconnectBodyDrop('source', 'a', 'b', null)).toBe('no-op');
        expect(classifyReconnectBodyDrop('target', 'a', 'b', null)).toBe('no-op');
      });

      it('drops on the OTHER endpoint node → "self-loop" (bail; would create A↔A)', () => {
        expect(classifyReconnectBodyDrop('source', 'a', 'b', 'b')).toBe('self-loop');
        expect(classifyReconnectBodyDrop('target', 'a', 'b', 'a')).toBe('self-loop');
      });

      it('drops on the moving endpoint OWN node → "pin-own"', () => {
        // Source endpoint moved back onto its own node — caller projects
        // the cursor onto a's perimeter and commits a pin via onPinEndpoint.
        expect(classifyReconnectBodyDrop('source', 'a', 'b', 'a')).toBe('pin-own');
        // Target endpoint moved back onto its own node — symmetric path.
        expect(classifyReconnectBodyDrop('target', 'a', 'b', 'b')).toBe('pin-own');
      });

      it('drops on a THIRD node → "reconnect-and-pin"', () => {
        // Cross-node drag: source endpoint moved from a to c. Caller
        // projects the cursor onto c's perimeter and dispatches a single
        // onReconnectConnector patch with the new source AND the pin.
        expect(classifyReconnectBodyDrop('source', 'a', 'b', 'c')).toBe('reconnect-and-pin');
        expect(classifyReconnectBodyDrop('target', 'a', 'b', 'c')).toBe('reconnect-and-pin');
      });
    });

    describe('computeUnmovedLockPin (un-moved endpoint freeze)', () => {
      // User rule: "When moving outlet and drop to another location, NEVER
      // move the other outlet." When the moved side jumps to a new node,
      // the un-moved floating endpoint would shift along its perimeter
      // because the line-through-centers swung. This helper produces a pin
      // that pins the un-moved endpoint at its CURRENT visible position so
      // it doesn't move post-reconnect.
      //
      // Geometry: source node A at (0, 0, 100, 60), target node B at
      // (300, 0, 100, 60). Both floating. A center = (50, 30),
      // B center = (350, 30). Line-through-centers exits A at right side
      // y=30 → A endpoint at (100, 30); enters B at left side y=30 →
      // B endpoint at (300, 30). B's left side spans (300, 0) to (300, 60),
      // so t = 30/60 = 0.5.
      const nodes = {
        a: {
          internals: { positionAbsolute: { x: 0, y: 0 } },
          measured: { width: 100, height: 60 },
        },
        b: {
          internals: { positionAbsolute: { x: 300, y: 0 } },
          measured: { width: 100, height: 60 },
        },
      };
      const get = (id: string) => nodes[id as keyof typeof nodes];

      it('returns undefined when the un-moved side already has a pin', () => {
        // Moving source; target already pinned. Nothing to lock — target's
        // pin already keeps it in place across any source change.
        expect(
          computeUnmovedLockPin('source', 'a', 'b', { targetPin: { side: 'top', t: 0.25 } }, get),
        ).toBeUndefined();
      });

      it('returns undefined when the un-moved side is handle-pinned (autoPicked: false)', () => {
        // autoPicked === false → endpoint uses React Flow's handle
        // position, which doesn't drift with line-through-centers.
        expect(
          computeUnmovedLockPin('source', 'a', 'b', { targetHandleAutoPicked: false }, get),
        ).toBeUndefined();
      });

      it('returns the current floating intersection pin when the target is floating', () => {
        // Source moves; target is floating (no pin, no autoPicked). The
        // helper captures B's current floating intersection (left side,
        // t=0.5) so a downstream reconnect to a new source doesn't shift
        // B's endpoint.
        expect(computeUnmovedLockPin('source', 'a', 'b', {}, get)).toEqual({
          side: 'left',
          t: 0.5,
        });
      });

      it('returns the source pin when the moving side is the target', () => {
        // Symmetric: target moves; source A floats. A's current floating
        // intersection is right side at y=30 → t = 30/60 = 0.5.
        expect(computeUnmovedLockPin('target', 'a', 'b', {}, get)).toEqual({
          side: 'right',
          t: 0.5,
        });
      });

      it('returns undefined when either node lookup fails', () => {
        const partial = (id: string) => (id === 'a' ? nodes.a : null);
        expect(computeUnmovedLockPin('source', 'a', 'b', {}, partial)).toBeUndefined();
      });

      it('returns undefined when either node has zero measured dimensions', () => {
        const unmeasured = (id: string) =>
          id === 'a'
            ? nodes.a
            : {
                internals: { positionAbsolute: { x: 300, y: 0 } },
                measured: {},
              };
        expect(computeUnmovedLockPin('source', 'a', 'b', {}, unmeasured)).toBeUndefined();
      });

      it('treats edgeData=undefined as fully floating (no locks)', () => {
        // Defensive: a connector built before US-021 has no autoPicked
        // flags and no pins. The helper should still treat both sides as
        // floating and produce a lock pin for the un-moved side.
        expect(computeUnmovedLockPin('source', 'a', 'b', undefined, get)).toEqual({
          side: 'left',
          t: 0.5,
        });
      });
    });

    it('fresh node (override-only) is rendered with connectable: false (the bug trigger)', () => {
      // This pins the upstream condition that makes the
      // `classifyHandleDropFailure === 'fall-through'` branch fire in
      // practice: a freshly-created node is unselected, so the buildNode
      // path stamps `connectable: false` on its rfNode payload. Without
      // this, the AC's failing repro wouldn't reproduce at all.
      const tree = callSeeflowCanvas({
        nodes: [makeShapeNode('existing')],
        nodeOverrides: { fresh: makeShapeNodeOverride('fresh') },
        selectedNodeIds: ['existing'],
        onCreateConnector: () => {},
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      const rfNodes = rf.props.nodes as Node[];
      const fresh = rfNodes.find((n) => n.id === 'fresh');
      expect(fresh).toBeDefined();
      expect(fresh?.connectable).toBe(false);
    });
  });

  describe('US-016: drag-to-create new shape gesture', () => {
    // The ReactFlow draw-mode props end up identical to the pre-marquee
    // (pre-US-010) values when `drawShape` is set: selectionOnDrag=false,
    // panOnDrag=false, nodesDraggable=false, elementsSelectable=false. These
    // four props together leave the empty pane inert for xyflow's own pointer
    // listeners so our wrapper-level pointerdown→move→up handlers own the
    // gesture. If any of these regresses, the gesture stops landing in our
    // handlers and drag-to-create silently breaks.
    it('disables xyflow gesture handling on the empty pane when in draw mode', () => {
      // Draw mode is driven via the `canvasMode` prop (state lives in
      // demo-view), so the test patches the prop directly.
      const tree = callSeeflowCanvas({ canvasMode: { kind: 'draw', shape: 'rectangle' } });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      expect(rf.props.selectionOnDrag).toBe(false);
      expect(rf.props.panOnDrag).toBe(false);
      expect(rf.props.nodesDraggable).toBe(false);
      expect(rf.props.elementsSelectable).toBe(false);
    });

    // Hand mode locks node interaction the same way Draw does, but promotes
    // left-click to pan ([0,1,2]) so the user can grab anywhere on the pane.
    // The four selection/draggable flags must flip false (so node clicks don't
    // sneak through), and the wrapper exposes `data-canvas-mode="hand"` for
    // the cursor CSS in src/styles/index.css.
    it('locks node interaction and promotes left-drag to pan when in Hand mode', () => {
      const tree = callSeeflowCanvas({ canvasMode: { kind: 'hand' } });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      expect(rf.props.nodesDraggable).toBe(false);
      expect(rf.props.nodesConnectable).toBe(false);
      expect(rf.props.elementsSelectable).toBe(false);
      expect(rf.props.selectionOnDrag).toBe(false);
      expect(rf.props.panOnDrag).toEqual([0, 1, 2]);
    });

    it('exposes data-canvas-mode on the wrapper for cursor CSS', () => {
      const tree = callSeeflowCanvas({ canvasMode: { kind: 'hand' } });
      const wrapper = findElement(tree, (el) => el.props['data-testid'] === 'seeflow-canvas');
      expect(wrapper?.props['data-canvas-mode']).toBe('hand');

      const tree2 = callSeeflowCanvas({ canvasMode: { kind: 'select' } });
      const wrapper2 = findElement(tree2, (el) => el.props['data-testid'] === 'seeflow-canvas');
      expect(wrapper2?.props['data-canvas-mode']).toBe('select');

      const tree3 = callSeeflowCanvas({ canvasMode: { kind: 'draw', shape: 'rectangle' } });
      const wrapper3 = findElement(tree3, (el) => el.props['data-testid'] === 'seeflow-canvas');
      expect(wrapper3?.props['data-canvas-mode']).toBe('draw');
    });

    // Index-coupled ref capture so the test can pre-set drawShapeRef /
    // rfInstanceRef and observe drawing/start/current refs after the gesture.
    // Indices correspond to useRef() call order in demo-canvas.tsx — if a new
    // useRef is added above any of these, the indices shift and this test
    // fails loudly with a clear "ref index drifted" assertion below.
    const REF = {
      // US-027 added flagsRef (slot 0) so every existing ref shifted by +1.
      flags: 0,
      wrapper: 1,
      rfInstance: 2,
      // US-008 added didMountFitRef (slot 3, immediately after rfInstanceRef).
      // US-009 added three more auto-fit refs in slots 4-6 (pendingFitRef,
      // signalEffectMountedRef, resolvedAutoFitViewRef), so every ref below
      // drifted down by three more. Update this map alongside any future
      // useRef addition above drawShape.
      pendingFit: 4,
      signalEffectMounted: 5,
      resolvedAutoFitView: 6,
      drawShape: 16,
      drawStart: 17,
      drawCurrent: 18,
      drawing: 19,
    } as const;

    // Bracket access on a sparse array returns `T | undefined`; this asserts
    // the index is in-bounds (the test's drift-detection check above already
    // verified that) and narrows for the assertions below.
    const refAt = (refs: { current: unknown }[], i: number): { current: unknown } => {
      const r = refs[i];
      if (!r) throw new Error(`ref index ${i} out of bounds (length=${refs.length})`);
      return r;
    };

    it('pointerdown → move → up on the pane commits via onCreateShapeNode with the dragged size', () => {
      const refs: { current: unknown }[] = [];
      const captured: Array<{
        shape: string;
        pos: { x: number; y: number };
        size: { width: number; height: number };
      }> = [];
      const onCreateShapeNode = (
        shape: string,
        pos: { x: number; y: number },
        size: { width: number; height: number },
      ) => {
        captured.push({ shape, pos, size });
      };
      const tree = callSeeflowCanvas(
        { onCreateShapeNode, canvasMode: { kind: 'draw', shape: 'rectangle' } },
        {
          // US-003: drawShape state lives in demo-view now, so we pass
          // `activeShape` via props. The gesture handler reads
          // `drawShapeRef` (a separate ref slot we mutate below) since the
          // handler doesn't depend on the state value directly.
          refSink: refs,
        },
      );

      // Sanity-check ref indices haven't drifted. The drawShape ref typing
      // accepts string|null so it starts as null; we identify it by the
      // useRef call order. A drift here means the gesture handlers in
      // production would read the WRONG ref and the test would either pass
      // spuriously or fail in a confusing way.
      expect(refs.length).toBeGreaterThanOrEqual(REF.drawing + 1);
      expect(refAt(refs, REF.drawShape).current).toBeNull();
      expect(refAt(refs, REF.drawStart).current).toBeNull();
      expect(refAt(refs, REF.drawCurrent).current).toBeNull();
      expect(refAt(refs, REF.drawing).current).toBe(false);
      expect(refAt(refs, REF.rfInstance).current).toBeNull();

      // Pre-populate the refs the handlers depend on: drawShape must be the
      // user-selected shape (the production code's useEffect sets this from
      // the drawShape state, but the hook-shim no-ops useEffect), and
      // rfInstance must expose screenToFlowPosition so onPointerUp can
      // convert client → flow coords on commit. Identity mapping keeps the
      // assertion math obvious.
      refAt(refs, REF.drawShape).current = 'rectangle';
      refAt(refs, REF.rfInstance).current = {
        screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      };

      // Walk the tree to the wrapper div (the same element that carries the
      // onPointerDown / onPointerMove / onPointerUp props in the JSX).
      // `data-testid="seeflow-canvas"` is the wrapper's testid.
      const wrapper = findElement(
        tree,
        (el) =>
          isElement(el) &&
          (el.props as { 'data-testid'?: unknown })['data-testid'] === 'seeflow-canvas',
      );
      if (!wrapper) throw new Error('wrapper div not found in SeeflowCanvas tree');

      const onPointerDown = wrapper.props.onPointerDown as (e: unknown) => void;
      const onPointerMove = wrapper.props.onPointerMove as (e: unknown) => void;
      const onPointerUp = wrapper.props.onPointerUp as (e: unknown) => void;
      expect(typeof onPointerDown).toBe('function');
      expect(typeof onPointerMove).toBe('function');
      expect(typeof onPointerUp).toBe('function');

      // Synthetic pointer events. `target.classList.contains('react-flow__pane')`
      // gates the handler — give the fake target a real DOMTokenList-ish
      // contains method. `currentTarget` provides setPointerCapture /
      // releasePointerCapture stubs (the production code try/catch-wraps both
      // since synthetic events throw on the real DOM methods).
      const paneTarget = {
        classList: { contains: (c: string) => c === 'react-flow__pane' },
      };
      const noop = () => {};
      const makeEvent = (clientX: number, clientY: number) => ({
        target: paneTarget,
        currentTarget: { setPointerCapture: noop, releasePointerCapture: noop },
        clientX,
        clientY,
        pointerId: 1,
        button: 0,
        isPrimary: true,
        preventDefault: noop,
        stopPropagation: noop,
      });

      onPointerDown(makeEvent(300, 200));
      // After down: drawing flips true, start + current populated.
      expect(refAt(refs, REF.drawing).current).toBe(true);
      expect(refAt(refs, REF.drawStart).current).toEqual({ x: 300, y: 200 });
      expect(refAt(refs, REF.drawCurrent).current).toEqual({ x: 300, y: 200 });

      onPointerMove(makeEvent(500, 350));
      // After move: current advances, start stays.
      expect(refAt(refs, REF.drawCurrent).current).toEqual({ x: 500, y: 350 });
      expect(refAt(refs, REF.drawStart).current).toEqual({ x: 300, y: 200 });

      onPointerUp(makeEvent(500, 350));
      // After up: drawing flips back to false, exitDrawMode clears refs.
      expect(refAt(refs, REF.drawing).current).toBe(false);

      // The crucial assertion: onCreateShapeNode fired with the right shape,
      // the flowPosition of the drag's min corner, and a size matching the
      // drag's flow-space bbox (the screenToFlowPosition stub is identity, so
      // flow = screen for this test).
      expect(captured.length).toBe(1);
      const commit = captured[0];
      if (!commit) throw new Error('onCreateShapeNode was not called');
      expect(commit.shape).toBe('rectangle');
      expect(commit.pos).toEqual({ x: 300, y: 200 });
      expect(commit.size).toEqual({ width: 200, height: 150 });
    });

    it('single-click (no drag past MIN_DRAW_SIZE=40px) commits a default-sized shape', () => {
      const refs: { current: unknown }[] = [];
      const captured: Array<{
        shape: string;
        pos: { x: number; y: number };
        size: { width: number; height: number };
      }> = [];
      const tree = callSeeflowCanvas(
        {
          canvasMode: { kind: 'draw', shape: 'ellipse' },
          onCreateShapeNode: (shape, pos, size) => {
            captured.push({
              shape: shape as string,
              pos: pos as { x: number; y: number },
              size: size as { width: number; height: number },
            });
          },
        },
        {
          refSink: refs,
        },
      );
      refAt(refs, REF.drawShape).current = 'ellipse';
      refAt(refs, REF.rfInstance).current = {
        screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      };

      const wrapper = findElement(
        tree,
        (el) =>
          isElement(el) &&
          (el.props as { 'data-testid'?: unknown })['data-testid'] === 'seeflow-canvas',
      );
      if (!wrapper) throw new Error('wrapper div not found');

      const paneTarget = {
        classList: { contains: (c: string) => c === 'react-flow__pane' },
      };
      const noop = () => {};
      const at = (x: number, y: number) => ({
        target: paneTarget,
        currentTarget: { setPointerCapture: noop, releasePointerCapture: noop },
        clientX: x,
        clientY: y,
        pointerId: 1,
        button: 0,
        isPrimary: true,
        preventDefault: noop,
        stopPropagation: noop,
      });

      // Same position for down and up — zero-pixel drag → falls back to the
      // shape's default size (ellipse: 200 × 120).
      (wrapper.props.onPointerDown as (e: unknown) => void)(at(400, 300));
      (wrapper.props.onPointerUp as (e: unknown) => void)(at(400, 300));

      expect(captured.length).toBe(1);
      const commit = captured[0];
      if (!commit) throw new Error('onCreateShapeNode was not called');
      expect(commit.shape).toBe('ellipse');
      expect(commit.pos).toEqual({ x: 400, y: 300 });
      expect(commit.size).toEqual({ width: 200, height: 120 });
    });

    it('pointerdown without drawShape set is a no-op (gesture only runs in draw mode)', () => {
      const refs: { current: unknown }[] = [];
      const captured: unknown[] = [];
      const tree = callSeeflowCanvas(
        { onCreateShapeNode: (...args: unknown[]) => captured.push(args) },
        { refSink: refs },
      );
      // drawShape state defaults to null and drawShapeRef.current stays null
      // (no useEffect to copy state → ref under the hook shim, matching the
      // production handler's read).
      const wrapper = findElement(
        tree,
        (el) =>
          isElement(el) &&
          (el.props as { 'data-testid'?: unknown })['data-testid'] === 'seeflow-canvas',
      );
      if (!wrapper) throw new Error('wrapper div not found');
      const paneTarget = {
        classList: { contains: (c: string) => c === 'react-flow__pane' },
      };
      const noop = () => {};
      const evt = {
        target: paneTarget,
        currentTarget: { setPointerCapture: noop, releasePointerCapture: noop },
        clientX: 100,
        clientY: 100,
        pointerId: 1,
        button: 0,
        isPrimary: true,
        preventDefault: noop,
        stopPropagation: noop,
      };
      (wrapper.props.onPointerDown as (e: unknown) => void)(evt);
      // drawing ref stays false because the handler early-returns when
      // drawShapeRef.current is null.
      expect(refAt(refs, REF.drawing).current).toBe(false);
      (wrapper.props.onPointerUp as (e: unknown) => void)(evt);
      expect(captured.length).toBe(0);
    });
  });

  describe('US-010: database drag-create ghost renders DatabaseShape', () => {
    // The drag-create ghost (`canvas-draw-ghost`) must render <DatabaseShape>
    // INSIDE the ghost wrapper when activeShape='database' so the user sees
    // the cylinder preview during the drag — matching the committed node's
    // illustrative-shape visuals. The wrapper itself stays chrome-less
    // (shapeChromeStyle('database') already returns {} per US-009 / AC #4).
    //
    // useState slot order (activeGroupId removed, US-003 lifted drawShape out of demo-canvas):
    //   slot 2 = drawStart   slot 3 = drawCurrent
    // ghostRect is computed from drawStart + drawCurrent so both must be set
    // for the ghost JSX branch to render. activeShape comes in via props.

    it('renders <DatabaseShape> inside the ghost when activeShape="database"', () => {
      const overrides: unknown[] = [];
      overrides[2] = { x: 100, y: 100 };
      overrides[3] = { x: 300, y: 240 };
      const tree = callSeeflowCanvas(
        { canvasMode: { kind: 'draw', shape: 'database' } },
        { useStateOverrides: overrides },
      );
      const ghost = findElement(
        tree,
        (el) =>
          isElement(el) &&
          (el.props as { 'data-testid'?: unknown })['data-testid'] === 'canvas-draw-ghost',
      );
      if (!ghost) throw new Error('canvas-draw-ghost not found in tree');
      expect((ghost.props as { 'data-ghost-shape'?: unknown })['data-ghost-shape']).toBe(
        'database',
      );
      // DatabaseShape is rendered directly inside the ghost wrapper — find it
      // among ghost.props.children.
      const dbShape = findElement(ghost, (el) => el.type === DatabaseShape);
      expect(dbShape).not.toBeNull();
    });

    it('passes width/height from ghostRect to DatabaseShape so the preview scales with the drag', () => {
      const overrides: unknown[] = [];
      overrides[2] = { x: 100, y: 100 };
      // 200 wide, 140 tall (matches database SHAPE_DEFAULT_SIZE for an at-
      // template ghost — the cylinder reads proportional).
      overrides[3] = { x: 300, y: 240 };
      const tree = callSeeflowCanvas(
        { canvasMode: { kind: 'draw', shape: 'database' } },
        { useStateOverrides: overrides },
      );
      const ghost = findElement(
        tree,
        (el) =>
          isElement(el) &&
          (el.props as { 'data-testid'?: unknown })['data-testid'] === 'canvas-draw-ghost',
      );
      if (!ghost) throw new Error('canvas-draw-ghost not found in tree');
      const dbShape = findElement(ghost, (el) => el.type === DatabaseShape);
      if (!dbShape) throw new Error('DatabaseShape not found inside ghost');
      const props = dbShape.props as {
        width?: number;
        height?: number;
        borderColor?: string;
        backgroundColor?: string;
      };
      // wrapperRef is null under the hook-shim, so ghostRect's offset falls
      // back to {0, 0} and width/height come straight from |drawCurrent - drawStart|.
      expect(props.width).toBe(200);
      expect(props.height).toBe(140);
      // Defaults mirror what the committed node resolves to via
      // resolveIllustrativeColors with empty data: theme-aware border via the
      // shadcn --border CSS var and the US-021 dark card surface fallback.
      expect(props.borderColor).toBe(COLOR_TOKENS.default.border);
      expect(props.backgroundColor).toBe(NODE_DEFAULT_BG_WHITE);
    });

    it('does NOT render DatabaseShape in the ghost for non-database shapes', () => {
      const overrides: unknown[] = [];
      overrides[2] = { x: 100, y: 100 };
      overrides[3] = { x: 300, y: 240 };
      const tree = callSeeflowCanvas(
        { canvasMode: { kind: 'draw', shape: 'rectangle' } },
        { useStateOverrides: overrides },
      );
      const ghost = findElement(
        tree,
        (el) =>
          isElement(el) &&
          (el.props as { 'data-testid'?: unknown })['data-testid'] === 'canvas-draw-ghost',
      );
      if (!ghost) throw new Error('canvas-draw-ghost not found in tree');
      const dbShape = findElement(ghost, (el) => el.type === DatabaseShape);
      // Rectangle ghost uses the wrapper chrome (shapeChromeClass / Style) —
      // the DatabaseShape SVG must NOT appear when the user is drawing a
      // non-database shape.
      expect(dbShape).toBeNull();
    });
  });

  // US-022: server's drag-create ghost mirrors the database flow — the ghost
  // wrapper hosts a <ServerShape> directly so the rack chassis preview matches
  // the committed node byte-for-byte. The ghost-dispatch is registry-driven
  // (see `ILLUSTRATIVE_SHAPE_RENDERERS`), so this test guards the contract for
  // every future illustrative shape that lands in that map.
  describe('US-022: server drag-create ghost renders ServerShape', () => {
    it('renders <ServerShape> inside the ghost when activeShape="server"', () => {
      const overrides: unknown[] = [];
      overrides[2] = { x: 100, y: 100 };
      overrides[3] = { x: 300, y: 240 };
      const tree = callSeeflowCanvas(
        { canvasMode: { kind: 'draw', shape: 'server' } },
        { useStateOverrides: overrides },
      );
      const ghost = findElement(
        tree,
        (el) =>
          isElement(el) &&
          (el.props as { 'data-testid'?: unknown })['data-testid'] === 'canvas-draw-ghost',
      );
      if (!ghost) throw new Error('canvas-draw-ghost not found in tree');
      expect((ghost.props as { 'data-ghost-shape'?: unknown })['data-ghost-shape']).toBe('server');
      const serverShape = findElement(ghost, (el) => el.type === ServerShape);
      expect(serverShape).not.toBeNull();
    });

    it('passes width/height from ghostRect to ServerShape so the preview scales with the drag', () => {
      const overrides: unknown[] = [];
      overrides[2] = { x: 100, y: 100 };
      overrides[3] = { x: 300, y: 240 };
      const tree = callSeeflowCanvas(
        { canvasMode: { kind: 'draw', shape: 'server' } },
        { useStateOverrides: overrides },
      );
      const ghost = findElement(
        tree,
        (el) =>
          isElement(el) &&
          (el.props as { 'data-testid'?: unknown })['data-testid'] === 'canvas-draw-ghost',
      );
      if (!ghost) throw new Error('canvas-draw-ghost not found in tree');
      const serverShape = findElement(ghost, (el) => el.type === ServerShape);
      if (!serverShape) throw new Error('ServerShape not found inside ghost');
      const props = serverShape.props as {
        width?: number;
        height?: number;
        borderColor?: string;
        backgroundColor?: string;
      };
      expect(props.width).toBe(200);
      expect(props.height).toBe(140);
      expect(props.borderColor).toBe(COLOR_TOKENS.default.border);
      expect(props.backgroundColor).toBe(NODE_DEFAULT_BG_WHITE);
    });

    it('does NOT render ServerShape in the ghost for non-server shapes', () => {
      const overrides: unknown[] = [];
      overrides[2] = { x: 100, y: 100 };
      overrides[3] = { x: 300, y: 240 };
      const tree = callSeeflowCanvas(
        { canvasMode: { kind: 'draw', shape: 'database' } },
        { useStateOverrides: overrides },
      );
      const ghost = findElement(
        tree,
        (el) =>
          isElement(el) &&
          (el.props as { 'data-testid'?: unknown })['data-testid'] === 'canvas-draw-ghost',
      );
      if (!ghost) throw new Error('canvas-draw-ghost not found in tree');
      const serverShape = findElement(ghost, (el) => el.type === ServerShape);
      expect(serverShape).toBeNull();
    });
  });

  // US-023: same registry-driven ghost-dispatch as Server; parallel coverage.
  describe('US-023: user drag-create ghost renders UserShape', () => {
    it('renders <UserShape> inside the ghost when activeShape="user"', () => {
      const overrides: unknown[] = [];
      overrides[2] = { x: 100, y: 100 };
      overrides[3] = { x: 300, y: 240 };
      const tree = callSeeflowCanvas(
        { canvasMode: { kind: 'draw', shape: 'user' } },
        { useStateOverrides: overrides },
      );
      const ghost = findElement(
        tree,
        (el) =>
          isElement(el) &&
          (el.props as { 'data-testid'?: unknown })['data-testid'] === 'canvas-draw-ghost',
      );
      if (!ghost) throw new Error('canvas-draw-ghost not found in tree');
      expect((ghost.props as { 'data-ghost-shape'?: unknown })['data-ghost-shape']).toBe('user');
      const userShape = findElement(ghost, (el) => el.type === UserShape);
      expect(userShape).not.toBeNull();
    });

    it('does NOT render UserShape in the ghost for non-user shapes', () => {
      const overrides: unknown[] = [];
      overrides[2] = { x: 100, y: 100 };
      overrides[3] = { x: 300, y: 240 };
      const tree = callSeeflowCanvas(
        { canvasMode: { kind: 'draw', shape: 'server' } },
        { useStateOverrides: overrides },
      );
      const ghost = findElement(
        tree,
        (el) =>
          isElement(el) &&
          (el.props as { 'data-testid'?: unknown })['data-testid'] === 'canvas-draw-ghost',
      );
      if (!ghost) throw new Error('canvas-draw-ghost not found in tree');
      const userShape = findElement(ghost, (el) => el.type === UserShape);
      expect(userShape).toBeNull();
    });
  });

  // US-024: queue ghost-dispatch parallels server/user — same registry hook.
  describe('US-024: queue drag-create ghost renders QueueShape', () => {
    it('renders <QueueShape> inside the ghost when activeShape="queue"', () => {
      const overrides: unknown[] = [];
      overrides[2] = { x: 100, y: 100 };
      overrides[3] = { x: 300, y: 240 };
      const tree = callSeeflowCanvas(
        { canvasMode: { kind: 'draw', shape: 'queue' } },
        { useStateOverrides: overrides },
      );
      const ghost = findElement(
        tree,
        (el) =>
          isElement(el) &&
          (el.props as { 'data-testid'?: unknown })['data-testid'] === 'canvas-draw-ghost',
      );
      if (!ghost) throw new Error('canvas-draw-ghost not found in tree');
      expect((ghost.props as { 'data-ghost-shape'?: unknown })['data-ghost-shape']).toBe('queue');
      const queueShape = findElement(ghost, (el) => el.type === QueueShape);
      expect(queueShape).not.toBeNull();
    });

    it('does NOT render QueueShape in the ghost for non-queue shapes', () => {
      const overrides: unknown[] = [];
      overrides[2] = { x: 100, y: 100 };
      overrides[3] = { x: 300, y: 240 };
      const tree = callSeeflowCanvas(
        { canvasMode: { kind: 'draw', shape: 'user' } },
        { useStateOverrides: overrides },
      );
      const ghost = findElement(
        tree,
        (el) =>
          isElement(el) &&
          (el.props as { 'data-testid'?: unknown })['data-testid'] === 'canvas-draw-ghost',
      );
      if (!ghost) throw new Error('canvas-draw-ghost not found in tree');
      const queueShape = findElement(ghost, (el) => el.type === QueueShape);
      expect(queueShape).toBeNull();
    });
  });

  // US-025: cloud ghost-dispatch parallels every other illustrative shape.
  describe('US-025: cloud drag-create ghost renders CloudShape', () => {
    it('renders <CloudShape> inside the ghost when activeShape="cloud"', () => {
      const overrides: unknown[] = [];
      overrides[2] = { x: 100, y: 100 };
      overrides[3] = { x: 300, y: 240 };
      const tree = callSeeflowCanvas(
        { canvasMode: { kind: 'draw', shape: 'cloud' } },
        { useStateOverrides: overrides },
      );
      const ghost = findElement(
        tree,
        (el) =>
          isElement(el) &&
          (el.props as { 'data-testid'?: unknown })['data-testid'] === 'canvas-draw-ghost',
      );
      if (!ghost) throw new Error('canvas-draw-ghost not found in tree');
      expect((ghost.props as { 'data-ghost-shape'?: unknown })['data-ghost-shape']).toBe('cloud');
      const cloudShape = findElement(ghost, (el) => el.type === CloudShape);
      expect(cloudShape).not.toBeNull();
    });

    it('does NOT render CloudShape in the ghost for non-cloud shapes', () => {
      const overrides: unknown[] = [];
      overrides[2] = { x: 100, y: 100 };
      overrides[3] = { x: 300, y: 240 };
      const tree = callSeeflowCanvas(
        { canvasMode: { kind: 'draw', shape: 'queue' } },
        { useStateOverrides: overrides },
      );
      const ghost = findElement(
        tree,
        (el) =>
          isElement(el) &&
          (el.props as { 'data-testid'?: unknown })['data-testid'] === 'canvas-draw-ghost',
      );
      if (!ghost) throw new Error('canvas-draw-ghost not found in tree');
      const cloudShape = findElement(ghost, (el) => el.type === CloudShape);
      expect(cloudShape).toBeNull();
    });
  });

  describe('selected connectors render LAST', () => {
    it('selected connectors render LAST so their EdgeUpdateAnchor wins hit-testing over overlapping siblings', () => {
      // Every edge sits at zIndex 0 (under nodes), so when two unselected
      // edges overlap, DOM order decides which one catches a click on its
      // path. The selected edge's outlet drag is driven by the
      // EdgeUpdateAnchor circles inside its SVG; if a sibling edge's path
      // crossed the selected endpoint and rendered LATER, the click would
      // hit that sibling instead of the anchor and the user couldn't grab
      // the outlet. rfEdges must therefore push selected edges to the end
      // of the array so xyflow's EdgeRenderer outputs them last in DOM.
      const tree = callSeeflowCanvas({
        nodes: [makeShapeNode('a'), makeShapeNode('b')],
        connectors: [
          { id: 'e1', source: 'a', target: 'b', kind: 'default' },
          { id: 'e2', source: 'a', target: 'b', kind: 'default' },
          { id: 'e3', source: 'a', target: 'b', kind: 'default' },
        ],
        selectedConnectorIds: ['e2'],
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      const rfEdges = rf.props.edges as Array<{ id: string }>;
      // e2 (selected) MUST sit at the END of the array — that's what makes
      // its SVG render last and win hit-testing among same-zIndex edges.
      expect(rfEdges[rfEdges.length - 1]?.id).toBe('e2');
      // The remaining server order is preserved among the unselected set so
      // an arbitrary user-driven reorder doesn't shuffle non-selected edges.
      const unselectedIds = rfEdges.slice(0, -1).map((e) => e.id);
      expect(unselectedIds).toEqual(['e1', 'e3']);
    });
  });

  describe('US-007: multi-select bounding-box resize overlay', () => {
    // The overlay component itself decides presence via
    // `selectionEligibleForOverlay`; here we test the canvas-side wiring —
    // that the right `selectedNodes` payload reaches the overlay (with
    // optimistic overrides applied and parent-id preserved) and that
    // `onMultiResize` is forwarded through. The pointer-driven scaling is
    // exercised in selection-resize-overlay.test.tsx via the pure helpers.
    function makeSizedShape(
      id: string,
      pos: { x: number; y: number },
      dims: { width: number; height: number },
    ): FlowNode {
      return {
        id,
        type: 'shapeNode',
        position: pos,
        data: { name: id, shape: 'rectangle', width: dims.width, height: dims.height },
      };
    }

    function findOverlay(props: LegacyOverrides): {
      tree: unknown;
      overlay: ReturnType<typeof findElement>;
    } {
      const tree = callSeeflowCanvas(props);
      const overlay = findElement(tree, (el) => el.type === SelectionResizeOverlay);
      return { tree, overlay };
    }

    it('renders the overlay element with the selected nodes payload when ≥ 2 are selected', () => {
      const { overlay } = findOverlay({
        nodes: [
          makeSizedShape('a', { x: 0, y: 0 }, { width: 50, height: 50 }),
          makeSizedShape('b', { x: 100, y: 100 }, { width: 50, height: 50 }),
        ],
        selectedNodeIds: ['a', 'b'],
        onMultiResize: () => {},
      });
      if (!overlay) throw new Error('SelectionResizeOverlay not in SeeflowCanvas tree');
      const selected = overlay.props.selectedNodes as ReadonlyArray<{
        id: string;
        position: { x: number; y: number };
        data: { width?: number; height?: number };
      }>;
      expect(selected.map((n) => n.id)).toEqual(['a', 'b']);
      expect(selected[0]?.data.width).toBe(50);
      expect(selected[1]?.position).toEqual({ x: 100, y: 100 });
    });

    it('passes an empty selectedNodes array when fewer than 2 nodes are selected', () => {
      const { overlay } = findOverlay({
        nodes: [makeSizedShape('a', { x: 0, y: 0 }, { width: 50, height: 50 })],
        selectedNodeIds: ['a'],
      });
      if (!overlay) throw new Error('SelectionResizeOverlay not in SeeflowCanvas tree');
      const selected = overlay.props.selectedNodes as ReadonlyArray<unknown>;
      expect(selected).toEqual([]);
    });

    it('forwards the onMultiResize prop unchanged so resize-stop dispatches to the parent', () => {
      const dispatched: MultiResizeUpdate[][] = [];
      const onMultiResize = (updates: MultiResizeUpdate[]) => {
        dispatched.push(updates);
      };
      const { overlay } = findOverlay({
        nodes: [
          makeSizedShape('a', { x: 0, y: 0 }, { width: 50, height: 50 }),
          makeSizedShape('b', { x: 100, y: 100 }, { width: 50, height: 50 }),
        ],
        selectedNodeIds: ['a', 'b'],
        onMultiResize,
      });
      if (!overlay) throw new Error('SelectionResizeOverlay not in SeeflowCanvas tree');
      const wired = overlay.props.onMultiResize as ((u: MultiResizeUpdate[]) => void) | undefined;
      expect(typeof wired).toBe('function');
      wired?.([{ id: 'a', position: { x: 5, y: 5 } }]);
      expect(dispatched).toEqual([[{ id: 'a', position: { x: 5, y: 5 } }]]);
    });

    it('applies optimistic position + data overrides to the overlay payload', () => {
      // The canvas merges overrides over the server snapshot before handing
      // the array to the overlay — a mid-flight PATCH on node A's position
      // should pin the rect to the optimistic value, not snap back to the
      // server one while waiting for the SSE echo.
      const { overlay } = findOverlay({
        nodes: [
          makeSizedShape('a', { x: 0, y: 0 }, { width: 50, height: 50 }),
          makeSizedShape('b', { x: 100, y: 100 }, { width: 50, height: 50 }),
        ],
        selectedNodeIds: ['a', 'b'],
        nodeOverrides: {
          a: {
            position: { x: 25, y: 30 },
            data: { width: 70, height: 70 },
          } as Partial<FlowNode>,
        },
      });
      if (!overlay) throw new Error('SelectionResizeOverlay not in SeeflowCanvas tree');
      const selected = overlay.props.selectedNodes as ReadonlyArray<{
        id: string;
        position: { x: number; y: number };
        data: { width?: number; height?: number };
      }>;
      const a = selected.find((n) => n.id === 'a');
      expect(a?.position).toEqual({ x: 25, y: 30 });
      expect(a?.data).toEqual({ width: 70, height: 70 });
    });
  });

  // US-022: Cmd/Ctrl + C / Cmd/Ctrl + V shortcut wiring exercised via the
  // exported `handleClipboardShortcut` helper (mirrors the US-017 pattern).
  // The actual listener in SeeflowCanvas is a thin useEffect that forwards into
  // this helper; the hook-shim test runner doesn't run useEffect, but the
  // logic under test is the same.
  describe('US-022: Cmd/Ctrl + C / V copy & paste via handleClipboardShortcut', () => {
    const makeEvent = (
      overrides: Partial<ClipboardShortcutEventLike> = {},
    ): ClipboardShortcutEventLike & { prevented: boolean } => {
      const ev = {
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        key: 'c',
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
        ...overrides,
      } as ClipboardShortcutEventLike & { prevented: boolean };
      return ev;
    };

    it('copies the current selection on Cmd+C with at least one node selected', () => {
      // (a) Cmd+C with a selected node calls onCopySelection with the live
      // selectedNodeIds and preventDefaults the event so the browser doesn't
      // also try to copy the page text.
      const event = makeEvent({ metaKey: true, key: 'c' });
      const copyCalls: string[][] = [];
      const pasteCalls: number[] = [];
      const handled = handleClipboardShortcut({
        event,
        selectedNodeIds: ['n-1'],
        hasClipboard: false,
        activeElement: null,
        onCopySelection: (ids) => copyCalls.push(ids),
        onPasteSelection: () => pasteCalls.push(1),
      });
      expect(handled).toBe(true);
      expect(event.prevented).toBe(true);
      expect(copyCalls).toEqual([['n-1']]);
      expect(pasteCalls).toEqual([]);
    });

    it('copies multi-select on Cmd+C and forwards all selected ids', () => {
      // (b-source) 3 selected nodes → onCopySelection sees all three.
      const event = makeEvent({ metaKey: true, key: 'c' });
      const copyCalls: string[][] = [];
      handleClipboardShortcut({
        event,
        selectedNodeIds: ['n-1', 'n-2', 'n-3'],
        hasClipboard: false,
        activeElement: null,
        onCopySelection: (ids) => copyCalls.push(ids),
      });
      expect(copyCalls).toEqual([['n-1', 'n-2', 'n-3']]);
    });

    it('also fires on Ctrl+C (Windows/Linux variant)', () => {
      const event = makeEvent({ ctrlKey: true, key: 'c' });
      const copyCalls: string[][] = [];
      handleClipboardShortcut({
        event,
        selectedNodeIds: ['n-1'],
        hasClipboard: false,
        activeElement: null,
        onCopySelection: (ids) => copyCalls.push(ids),
      });
      expect(copyCalls).toEqual([['n-1']]);
    });

    it('pastes on Cmd+V when the clipboard is populated', () => {
      // (a-paste, b-paste) Cmd+V with hasClipboard=true calls onPasteSelection.
      const event = makeEvent({ metaKey: true, key: 'v' });
      const pasteCalls: number[] = [];
      const handled = handleClipboardShortcut({
        event,
        selectedNodeIds: [],
        hasClipboard: true,
        activeElement: null,
        onPasteSelection: () => pasteCalls.push(1),
      });
      expect(handled).toBe(true);
      expect(event.prevented).toBe(true);
      expect(pasteCalls).toEqual([1]);
    });

    it('also fires on Ctrl+V (Windows/Linux variant)', () => {
      const event = makeEvent({ ctrlKey: true, key: 'v' });
      const pasteCalls: number[] = [];
      handleClipboardShortcut({
        event,
        selectedNodeIds: [],
        hasClipboard: true,
        activeElement: null,
        onPasteSelection: () => pasteCalls.push(1),
      });
      expect(pasteCalls).toEqual([1]);
    });

    it('no-ops on Cmd+C when the selection is empty (no preventDefault, no callback)', () => {
      // Lets the browser's native Cmd+C path through (in case the user has
      // text selected somewhere else on the page).
      const event = makeEvent({ metaKey: true, key: 'c' });
      const copyCalls: string[][] = [];
      const handled = handleClipboardShortcut({
        event,
        selectedNodeIds: [],
        hasClipboard: false,
        activeElement: null,
        onCopySelection: (ids) => copyCalls.push(ids),
      });
      expect(handled).toBe(false);
      expect(event.prevented).toBe(false);
      expect(copyCalls).toEqual([]);
    });

    it('no-ops on Cmd+V when the clipboard is empty', () => {
      const event = makeEvent({ metaKey: true, key: 'v' });
      const pasteCalls: number[] = [];
      const handled = handleClipboardShortcut({
        event,
        selectedNodeIds: [],
        hasClipboard: false,
        activeElement: null,
        onPasteSelection: () => pasteCalls.push(1),
      });
      expect(handled).toBe(false);
      expect(event.prevented).toBe(false);
      expect(pasteCalls).toEqual([]);
    });

    it('no-ops on Cmd+C when focus is in an editable element (InlineEdit / input / textarea)', () => {
      // (c) Skip when an input is focused so the browser's native text copy
      // keeps working inside form controls / InlineEdit.
      const event = makeEvent({ metaKey: true, key: 'c' });
      const copyCalls: string[][] = [];
      const fakeInput = { tagName: 'INPUT' } as unknown as Element;
      const handled = handleClipboardShortcut({
        event,
        selectedNodeIds: ['n-1'],
        hasClipboard: false,
        activeElement: fakeInput,
        onCopySelection: (ids) => copyCalls.push(ids),
      });
      expect(handled).toBe(false);
      expect(event.prevented).toBe(false);
      expect(copyCalls).toEqual([]);
    });

    it('no-ops on Cmd+V when focus is in an editable element', () => {
      // Same skip applies for paste so the browser's native text paste works
      // inside textareas / contentEditable surfaces.
      const event = makeEvent({ metaKey: true, key: 'v' });
      const pasteCalls: number[] = [];
      const fakeTextarea = { tagName: 'TEXTAREA' } as unknown as Element;
      const handled = handleClipboardShortcut({
        event,
        selectedNodeIds: [],
        hasClipboard: true,
        activeElement: fakeTextarea,
        onPasteSelection: () => pasteCalls.push(1),
      });
      expect(handled).toBe(false);
      expect(event.prevented).toBe(false);
      expect(pasteCalls).toEqual([]);
    });

    it("no-ops on Shift+Cmd+C (devtools chord shouldn't copy)", () => {
      const event = makeEvent({ metaKey: true, shiftKey: true, key: 'c' });
      const copyCalls: string[][] = [];
      const handled = handleClipboardShortcut({
        event,
        selectedNodeIds: ['n-1'],
        hasClipboard: false,
        activeElement: null,
        onCopySelection: (ids) => copyCalls.push(ids),
      });
      expect(handled).toBe(false);
      expect(event.prevented).toBe(false);
      expect(copyCalls).toEqual([]);
    });

    it('no-ops on Cmd+Alt+V (avoid shadowing browser devtools chords)', () => {
      const event = makeEvent({ metaKey: true, altKey: true, key: 'v' });
      const pasteCalls: number[] = [];
      const handled = handleClipboardShortcut({
        event,
        selectedNodeIds: [],
        hasClipboard: true,
        activeElement: null,
        onPasteSelection: () => pasteCalls.push(1),
      });
      expect(handled).toBe(false);
      expect(event.prevented).toBe(false);
      expect(pasteCalls).toEqual([]);
    });

    it("no-ops on bare C / V (no modifiers — that's the user typing)", () => {
      const bare = makeEvent({ key: 'c' });
      const copyCalls: string[][] = [];
      const handled = handleClipboardShortcut({
        event: bare,
        selectedNodeIds: ['n-1'],
        hasClipboard: true,
        activeElement: null,
        onCopySelection: (ids) => copyCalls.push(ids),
      });
      expect(handled).toBe(false);
      expect(bare.prevented).toBe(false);
      expect(copyCalls).toEqual([]);
    });

    it('no-ops for unrelated chords (Cmd+B, Cmd+S, etc.)', () => {
      const event = makeEvent({ metaKey: true, key: 'b' });
      const handled = handleClipboardShortcut({
        event,
        selectedNodeIds: ['n-1'],
        hasClipboard: true,
        activeElement: null,
        onCopySelection: () => {},
        onPasteSelection: () => {},
      });
      expect(handled).toBe(false);
      expect(event.prevented).toBe(false);
    });

    it('returns false without invoking when onCopySelection is missing for Cmd+C', () => {
      // Defensive: parent might pass undefined onCopySelection (e.g. flowId
      // not yet resolved). Handler must NOT throw and must NOT preventDefault.
      const event = makeEvent({ metaKey: true, key: 'c' });
      const handled = handleClipboardShortcut({
        event,
        selectedNodeIds: ['n-1'],
        hasClipboard: false,
        activeElement: null,
        // onCopySelection intentionally omitted
      });
      expect(handled).toBe(false);
      expect(event.prevented).toBe(false);
    });

    it('returns false without invoking when onPasteSelection is missing for Cmd+V', () => {
      const event = makeEvent({ metaKey: true, key: 'v' });
      const handled = handleClipboardShortcut({
        event,
        selectedNodeIds: [],
        hasClipboard: true,
        activeElement: null,
        // onPasteSelection intentionally omitted
      });
      expect(handled).toBe(false);
      expect(event.prevented).toBe(false);
    });

    it('accepts uppercase key (e.g. Shift was held; some layouts always uppercase)', () => {
      // The handler matches case-insensitively so Cmd+Shift+C is rejected by
      // the shift gate (not by the key), and a layout that always uppercases
      // the letter when Cmd is held still works. Drive with shift=false + key=C
      // to exercise the case-folding path.
      const event = makeEvent({ metaKey: true, key: 'C' });
      const copyCalls: string[][] = [];
      handleClipboardShortcut({
        event,
        selectedNodeIds: ['n-1'],
        hasClipboard: false,
        activeElement: null,
        onCopySelection: (ids) => copyCalls.push(ids),
      });
      expect(copyCalls).toEqual([['n-1']]);
    });
  });

  describe('US-020: bottom-left Controls cluster (Fit View + Auto Align)', () => {
    // The cluster lives inside xyflow's <Controls> Panel. The hook-shim
    // renderer captures the ControlButton children as `{ type, props }`
    // placeholders without executing their bodies — perfect for asserting
    // on data-testid, aria-label, disabled, and onClick wiring.
    const findByTestId = (tree: unknown, id: string) =>
      findElement(tree, (el) => (el.props as { 'data-testid'?: unknown })['data-testid'] === id);

    it('hides the built-in xyflow Fit View (showFitView=false) and Interactive toggle', () => {
      // We render our own Fit View ControlButton with a Lucide icon and the
      // documented fitView options (padding 0.15, duration 300). The built-in
      // one would have a different icon + default options, so it must stay
      // suppressed.
      const tree = callSeeflowCanvas();
      const controlsRoot = findElement(tree, (el) =>
        Boolean((el.props as { showFitView?: unknown }).showFitView !== undefined),
      );
      expect(controlsRoot).not.toBeNull();
      expect(controlsRoot?.props.showFitView).toBe(false);
      expect(controlsRoot?.props.showInteractive).toBe(false);
    });

    it('renders the Fit View ControlButton with Lucide-styled tooltip', () => {
      const tree = callSeeflowCanvas({ nodes: [makeShapeNode('a')] });
      const btn = findByTestId(tree, 'controls-fit-view');
      expect(btn).not.toBeNull();
      expect(btn?.props['aria-label']).toBe('Fit view');
      expect(btn?.props.title).toBe('Fit view');
    });

    it('renders the Auto Align (Tidy) ControlButton with the documented tooltip', () => {
      const tree = callSeeflowCanvas({ onTidy: () => {} });
      const btn = findByTestId(tree, 'controls-tidy');
      expect(btn).not.toBeNull();
      expect(btn?.props['aria-label']).toBe('Tidy layout (⌘⇧L)');
      expect(btn?.props.title).toBe('Tidy layout (⌘⇧L)');
    });

    it('Fit View button is disabled when there are no nodes on the canvas', () => {
      const tree = callSeeflowCanvas({ nodes: [] });
      const btn = findByTestId(tree, 'controls-fit-view');
      expect(btn).not.toBeNull();
      expect(btn?.props.disabled).toBe(true);
    });

    it('Fit View button is enabled when at least one node is on the canvas', () => {
      const tree = callSeeflowCanvas({ nodes: [makeShapeNode('a')] });
      const btn = findByTestId(tree, 'controls-fit-view');
      expect(btn).not.toBeNull();
      expect(btn?.props.disabled).toBe(false);
    });

    it('Auto Align is disabled when no onTidy prop is wired', () => {
      const tree = callSeeflowCanvas({ nodes: [makeShapeNode('a')] });
      const btn = findByTestId(tree, 'controls-tidy');
      expect(btn).not.toBeNull();
      expect(btn?.props.disabled).toBe(true);
    });

    it('Auto Align is enabled when an onTidy callback is wired', () => {
      const tree = callSeeflowCanvas({ nodes: [makeShapeNode('a')], onTidy: () => {} });
      const btn = findByTestId(tree, 'controls-tidy');
      expect(btn).not.toBeNull();
      expect(btn?.props.disabled).toBe(false);
    });

    it('view mode without an adapter: Auto Align is disabled (no local fallback engine)', () => {
      // Tidy now delegates to the adapter's computeLayout (which routes to
      // the studio's /api/layout endpoint). Bundling elkjs into the canvas
      // would balloon the package; view-mode embedders without an adapter
      // get a disabled button instead of a local-only fallback.
      const tree = callSeeflowCanvas({
        mode: 'view',
        adapter: undefined,
        nodes: [makeShapeNode('a'), makeShapeNode('b')],
      });
      const btn = findByTestId(tree, 'controls-tidy');
      expect(btn).not.toBeNull();
      expect(btn?.props.disabled).toBe(true);
    });

    it('clicking Auto Align fires the onTidy prop', () => {
      let tidyCalls = 0;
      const tree = callSeeflowCanvas({
        nodes: [makeShapeNode('a')],
        onTidy: () => {
          tidyCalls += 1;
        },
      });
      const btn = findByTestId(tree, 'controls-tidy');
      if (!btn) throw new Error('Auto Align button not found');
      const onClick = btn.props.onClick as (() => void) | undefined;
      if (typeof onClick !== 'function') throw new Error('onClick not wired');
      onClick();
      expect(tidyCalls).toBe(1);
    });

    it('clicking Fit View calls fitView with padding 0.15, duration 300, includeHiddenNodes: false', () => {
      // The ControlButton closes over rfInstanceRef.current via the
      // demo-canvas useCallback. We patch the ref directly via refSink to
      // capture the fitView args without needing a real ReactFlowInstance.
      const refSink: { current: unknown }[] = [];
      const fitViewCalls: unknown[] = [];
      const tree = callSeeflowCanvas({ nodes: [makeShapeNode('a')] }, { refSink });
      // rfInstanceRef is the THIRD useRef in SeeflowCanvas (slot 2):
      //   slot 0 = flagsRef (US-027)
      //   slot 1 = wrapperRef
      //   slot 2 = rfInstanceRef
      // Inject a fake ReactFlowInstance with a fitView spy. If the ref slot
      // ordering changes in the future the test will fail loudly because
      // fitViewCalls stays empty.
      const stubInstance = {
        fitView: (opts: unknown) => {
          fitViewCalls.push(opts);
        },
      };
      const rfRef = refSink[2];
      if (!rfRef) throw new Error('rfInstanceRef slot not captured');
      rfRef.current = stubInstance;

      const btn = findByTestId(tree, 'controls-fit-view');
      if (!btn) throw new Error('Fit View button not found');
      const onClick = btn.props.onClick as (() => void) | undefined;
      if (typeof onClick !== 'function') throw new Error('onClick not wired');
      onClick();

      expect(fitViewCalls.length).toBe(1);
      expect(fitViewCalls[0]).toEqual({
        padding: 0.15,
        duration: 300,
        includeHiddenNodes: false,
      });
    });

    it('clicking Fit View is a no-op when rfInstanceRef has no instance attached', () => {
      // Defensive: if the canvas mounts and the user clicks Fit View before
      // onInit fires, the click must not throw. fitView simply doesn't run.
      const tree = callSeeflowCanvas({ nodes: [makeShapeNode('a')] });
      const btn = findByTestId(tree, 'controls-fit-view');
      if (!btn) throw new Error('Fit View button not found');
      const onClick = btn.props.onClick as (() => void) | undefined;
      if (typeof onClick !== 'function') throw new Error('onClick not wired');
      expect(() => onClick()).not.toThrow();
    });

    it('renders Fit View BEFORE Auto Align inside the Controls children (documented order)', () => {
      // PRD AC: "presence of zoom-in, zoom-out, Fit View, Auto Align buttons
      // in that order". Zoom-in/zoom-out are owned by xyflow's <Controls>
      // (showZoom default true). We assert the post-zoom order on OUR
      // ControlButton children: Fit View, then Auto Align.
      const tree = callSeeflowCanvas({ nodes: [makeShapeNode('a')], onTidy: () => {} });
      const controlsRoot = findElement(tree, (el) =>
        Boolean((el.props as { showFitView?: unknown }).showFitView !== undefined),
      );
      if (!controlsRoot) throw new Error('Controls element not found');
      const rawChildren = controlsRoot.props.children;
      const childrenArr = Array.isArray(rawChildren) ? rawChildren : [rawChildren];
      const testIds: string[] = [];
      for (const child of childrenArr) {
        if (
          child !== null &&
          typeof child === 'object' &&
          'props' in (child as { props?: unknown })
        ) {
          const id = (child as { props: { 'data-testid'?: unknown } }).props['data-testid'];
          if (typeof id === 'string') testIds.push(id);
        }
      }
      const fitIdx = testIds.indexOf('controls-fit-view');
      const tidyIdx = testIds.indexOf('controls-tidy');
      expect(fitIdx).toBeGreaterThanOrEqual(0);
      expect(tidyIdx).toBeGreaterThanOrEqual(0);
      expect(fitIdx).toBeLessThan(tidyIdx);
    });
  });

  describe('US-008: OS image drop wiring', () => {
    function findCanvasWrapper(tree: unknown): ReactElementLike | null {
      return findElement(tree, (el) => {
        const p = el.props as { 'data-testid'?: string };
        return p['data-testid'] === 'seeflow-canvas';
      });
    }

    /** Synthesize the minimum of a React DragEvent the handler reads. */
    function dragEvent(args: {
      files?: File[];
      types?: string[];
      clientX?: number;
      clientY?: number;
    }): {
      preventDefault: () => void;
      dataTransfer: DataTransfer;
      clientX: number;
      clientY: number;
      defaultPrevented: boolean;
    } {
      const files = args.files ?? [];
      let defaultPrevented = false;
      let dropEffectSet = '';
      const dt = {
        files: { length: files.length, item: (i: number) => files[i] ?? null },
        types: args.types ?? (files.length > 0 ? ['Files'] : []),
        set dropEffect(v: string) {
          dropEffectSet = v;
        },
        get dropEffect() {
          return dropEffectSet;
        },
      } as unknown as DataTransfer;
      return {
        preventDefault: () => {
          defaultPrevented = true;
        },
        dataTransfer: dt,
        clientX: args.clientX ?? 100,
        clientY: args.clientY ?? 200,
        get defaultPrevented() {
          return defaultPrevented;
        },
      };
    }

    const stubFile = (name = 'pic.png', type = 'image/png'): File =>
      new File([new Uint8Array([0])], name, { type });

    it('wires onDragOver + onDrop on the wrapper when onCreateImageFromFile is set', () => {
      const tree = callSeeflowCanvas({ onCreateImageFromFile: () => {} });
      const wrapper = findCanvasWrapper(tree);
      if (!wrapper) throw new Error('canvas wrapper not found');
      expect(typeof (wrapper.props as { onDragOver?: unknown }).onDragOver).toBe('function');
      expect(typeof (wrapper.props as { onDrop?: unknown }).onDrop).toBe('function');
    });

    it('onDragOver preventDefault()s when the OS hints at file drag', () => {
      const tree = callSeeflowCanvas({ onCreateImageFromFile: () => {} });
      const wrapper = findCanvasWrapper(tree);
      if (!wrapper) throw new Error('canvas wrapper not found');
      const onDragOver = (wrapper.props as { onDragOver?: (e: unknown) => void }).onDragOver;
      if (typeof onDragOver !== 'function') throw new Error('onDragOver not wired');
      const e = dragEvent({ files: [stubFile()] });
      onDragOver(e);
      expect(e.defaultPrevented).toBe(true);
    });

    it('onDragOver does NOT preventDefault when the drag is not a file payload', () => {
      const tree = callSeeflowCanvas({ onCreateImageFromFile: () => {} });
      const wrapper = findCanvasWrapper(tree);
      if (!wrapper) throw new Error('canvas wrapper not found');
      const onDragOver = (wrapper.props as { onDragOver?: (e: unknown) => void }).onDragOver;
      if (typeof onDragOver !== 'function') throw new Error('onDragOver not wired');
      // text drag (no 'Files' in types) — must not opt-in as drop target,
      // otherwise we'd hijack toolbar / connection-line drags.
      const e = dragEvent({ files: [], types: ['text/plain'] });
      onDragOver(e);
      expect(e.defaultPrevented).toBe(false);
    });

    it('onDragOver is a no-op when onCreateImageFromFile is NOT wired', () => {
      const tree = callSeeflowCanvas({});
      const wrapper = findCanvasWrapper(tree);
      if (!wrapper) throw new Error('canvas wrapper not found');
      const onDragOver = (wrapper.props as { onDragOver?: (e: unknown) => void }).onDragOver;
      if (typeof onDragOver !== 'function') throw new Error('onDragOver not wired');
      // Even with files, the handler must early-return when no image-create
      // callback is wired (otherwise we'd block native file-drop affordances
      // on a read-only canvas).
      const e = dragEvent({ files: [stubFile()] });
      onDragOver(e);
      expect(e.defaultPrevented).toBe(false);
    });

    it('onDrop preventDefault()s and does not throw when no rfInstance is attached', () => {
      // Drop before onRfInit ever fired: handleCanvasFileDrop short-circuits
      // on rfInstance===null, but preventDefault still runs (we want to
      // suppress the browser's default 'open this image in a new tab' even
      // when we can't honor the drop).
      const dispatched: unknown[] = [];
      const tree = callSeeflowCanvas({
        onCreateImageFromFile: (a) => dispatched.push(a),
      });
      const wrapper = findCanvasWrapper(tree);
      if (!wrapper) throw new Error('canvas wrapper not found');
      const onDrop = (wrapper.props as { onDrop?: (e: unknown) => void }).onDrop;
      if (typeof onDrop !== 'function') throw new Error('onDrop not wired');
      const e = dragEvent({ files: [stubFile()] });
      expect(() => onDrop(e)).not.toThrow();
      expect(e.defaultPrevented).toBe(true);
      // rfInstance is null in the hook-shim render → no dispatch.
      expect(dispatched).toHaveLength(0);
    });

    it("threads onRetryImageUpload into each node's runtime data as data.onRetryUpload", () => {
      const onRetryImageUpload = (_id: string) => {};
      const tree = callSeeflowCanvas({
        nodes: [makeShapeNode('a')],
        onRetryImageUpload,
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found');
      const rfNodes = rf.props.nodes as Node[];
      expect(rfNodes).toHaveLength(1);
      const data = rfNodes[0]?.data as { onRetryUpload?: (id: string) => void };
      expect(data.onRetryUpload).toBe(onRetryImageUpload);
    });
  });

  describe('US-017: HTML block drop wiring', () => {
    function findCanvasWrapper(tree: unknown): ReactElementLike | null {
      return findElement(tree, (el) => {
        const p = el.props as { 'data-testid'?: string };
        return p['data-testid'] === 'seeflow-canvas';
      });
    }

    /**
     * Synthesize a React DragEvent that carries the HTML block dataTransfer
     * marker. Mirrors `dragEvent` in the US-008 suite — the only difference is
     * that `types` defaults to the HTML_BLOCK_DND_TYPE marker (no Files in the
     * payload), so this fixture exercises the htmlNode branch alone.
     */
    function htmlBlockDragEvent(args: {
      types?: string[];
      clientX?: number;
      clientY?: number;
    }): {
      preventDefault: () => void;
      dataTransfer: DataTransfer;
      clientX: number;
      clientY: number;
      defaultPrevented: boolean;
    } {
      let defaultPrevented = false;
      let dropEffectSet = '';
      const dt = {
        files: { length: 0, item: () => null },
        types: args.types ?? [HTML_BLOCK_DND_TYPE],
        set dropEffect(v: string) {
          dropEffectSet = v;
        },
        get dropEffect() {
          return dropEffectSet;
        },
      } as unknown as DataTransfer;
      return {
        preventDefault: () => {
          defaultPrevented = true;
        },
        dataTransfer: dt,
        clientX: args.clientX ?? 100,
        clientY: args.clientY ?? 200,
        get defaultPrevented() {
          return defaultPrevented;
        },
      };
    }

    it('does NOT forward an htmlBlockEnabled prop to CanvasToolbar (toolbar tile removed)', () => {
      const tree = callSeeflowCanvas({
        onCreateShapeNode: () => {},
        onCreateHtmlNode: () => {},
      });
      const toolbar = findElement(tree, (el) => el.type === CanvasToolbar);
      if (!toolbar) throw new Error('CanvasToolbar element not found');
      expect('htmlBlockEnabled' in (toolbar.props as Record<string, unknown>)).toBe(false);
    });

    it('onDragOver preventDefault()s when the HTML block marker is present and handler is wired', () => {
      const tree = callSeeflowCanvas({ onCreateHtmlNode: () => {} });
      const wrapper = findCanvasWrapper(tree);
      if (!wrapper) throw new Error('canvas wrapper not found');
      const onDragOver = (wrapper.props as { onDragOver?: (e: unknown) => void }).onDragOver;
      if (typeof onDragOver !== 'function') throw new Error('onDragOver not wired');
      const e = htmlBlockDragEvent({});
      onDragOver(e);
      expect(e.defaultPrevented).toBe(true);
    });

    it('onDragOver is a no-op when the HTML block marker is present but handler is NOT wired', () => {
      // Wiring `onCreateImageFromFile` keeps the wrapper handlers attached,
      // but the html-block branch must self-gate on `onCreateHtmlNode` so a
      // read-only-for-blocks canvas doesn't accept a stray html block tile.
      const tree = callSeeflowCanvas({ onCreateImageFromFile: () => {} });
      const wrapper = findCanvasWrapper(tree);
      if (!wrapper) throw new Error('canvas wrapper not found');
      const onDragOver = (wrapper.props as { onDragOver?: (e: unknown) => void }).onDragOver;
      if (typeof onDragOver !== 'function') throw new Error('onDragOver not wired');
      const e = htmlBlockDragEvent({});
      onDragOver(e);
      expect(e.defaultPrevented).toBe(false);
    });

    it('onDrop preventDefault()s on the HTML block marker even when no rfInstance is attached', () => {
      // Drop before onRfInit ever fired: the html-block branch short-circuits
      // on rfInstance===null but preventDefault still runs (we want to
      // suppress browser default behaviour for the synthetic drop, even when
      // we can't honor the position).
      const dispatched: Array<{ position: { x: number; y: number } }> = [];
      const tree = callSeeflowCanvas({
        onCreateHtmlNode: (a) => dispatched.push(a),
      });
      const wrapper = findCanvasWrapper(tree);
      if (!wrapper) throw new Error('canvas wrapper not found');
      const onDrop = (wrapper.props as { onDrop?: (e: unknown) => void }).onDrop;
      if (typeof onDrop !== 'function') throw new Error('onDrop not wired');
      const e = htmlBlockDragEvent({});
      expect(() => onDrop(e)).not.toThrow();
      expect(e.defaultPrevented).toBe(true);
      // rfInstance is null in the hook-shim render → no dispatch fires.
      expect(dispatched).toHaveLength(0);
    });

    it('onDrop does not dispatch the html branch when the handler is NOT wired', () => {
      // With onCreateHtmlNode unwired, a marker-bearing, file-less drop must
      // NOT dispatch onCreateImageFromFile (no Files in the payload —
      // handleCanvasFileDrop short-circuits). The image branch may still
      // preventDefault (it always does when wired), but the htmlNode-create
      // path stays inert.
      const imgDispatched: unknown[] = [];
      const tree = callSeeflowCanvas({
        onCreateImageFromFile: (a) => imgDispatched.push(a),
      });
      const wrapper = findCanvasWrapper(tree);
      if (!wrapper) throw new Error('canvas wrapper not found');
      const onDrop = (wrapper.props as { onDrop?: (e: unknown) => void }).onDrop;
      if (typeof onDrop !== 'function') throw new Error('onDrop not wired');
      const e = htmlBlockDragEvent({});
      expect(() => onDrop(e)).not.toThrow();
      // No Files in the payload → handleCanvasFileDrop short-circuits before
      // dispatching onCreateImageFromFile.
      expect(imgDispatched).toHaveLength(0);
    });

    it('onDrop is a complete no-op when neither image nor htmlNode handlers are wired', () => {
      // Read-only canvas: drop fires but no preventDefault, no dispatch — the
      // browser's native default still runs.
      const tree = callSeeflowCanvas({});
      const wrapper = findCanvasWrapper(tree);
      if (!wrapper) throw new Error('canvas wrapper not found');
      const onDrop = (wrapper.props as { onDrop?: (e: unknown) => void }).onDrop;
      if (typeof onDrop !== 'function') throw new Error('onDrop not wired');
      const e = htmlBlockDragEvent({});
      expect(() => onDrop(e)).not.toThrow();
      expect(e.defaultPrevented).toBe(false);
    });
  });

  describe("US-027: mode='view' gates editing and chrome", () => {
    // Sanity contract on the discriminated union — view mode swaps the
    // mutation surface off without requiring an adapter. The hook-shim tests
    // exercise the post-render React-element tree (no live DOM); each gate
    // is verified by inspecting the ReactFlow root's resolved props.
    it('ReactFlow root has nodesConnectable=false even when onCreateConnector is wired in view mode', () => {
      const tree = callSeeflowCanvas({
        mode: 'view',
        adapter: undefined,
        nodes: [makeShapeNode('a'), makeShapeNode('b')],
        selectedNodeIds: ['a'],
        onCreateConnector: () => {
          throw new Error('view-mode onCreateConnector must not be invoked');
        },
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      expect(rf.props.nodesConnectable).toBe(false);
    });

    it('view mode renders a modes-only toolbar (Select + Hand, no shape tiles)', () => {
      // View mode embedders get the Select/Hand navigation tools so users can
      // toggle between marquee-select and pan-everywhere modes the same way
      // they'd expect in Miro/Figma. The toolbar still renders, but
      // showShapeTools=false hides the shape tiles + icon picker (asserted via
      // the toolbar prop since the child render isn't expanded in this shim).
      const tree = callSeeflowCanvas({ mode: 'view', adapter: undefined });
      const toolbar = findElement(tree, (el) => el.type === CanvasToolbar);
      expect(toolbar).not.toBeNull();
      expect(toolbar?.props.showShapeTools).toBe(false);
      expect(toolbar?.props.mode).toEqual({ kind: 'select' });
    });

    it('mini mode renders no toolbar at all', () => {
      const tree = callSeeflowCanvas({ mode: 'mini', adapter: undefined });
      const toolbar = findElement(tree, (el) => el.type === CanvasToolbar);
      expect(toolbar).toBeNull();
    });

    it('ReactFlow root disables deleteKeyCode in view mode', () => {
      // xyflow has no global `edgesDeletable` flag; the only path to delete
      // is the delete-key chord. Setting it null leaves the user with no
      // delete pathway in view mode (the context menu is already gated above).
      const tree = callSeeflowCanvas({ mode: 'view', adapter: undefined });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      expect(rf.props.deleteKeyCode).toBeNull();
    });

    it('ReactFlow root wires deleteKeyCode in edit mode', () => {
      const tree = callSeeflowCanvas({});
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      expect(rf.props.deleteKeyCode).toEqual(['Backspace', 'Delete']);
    });

    it('ReactFlow root suppresses onConnect in view mode', () => {
      // The discriminated union allows callers to pass onCreateConnector even
      // in view mode (typed as Partial<…>); the wiring still drops it.
      const tree = callSeeflowCanvas({
        mode: 'view',
        adapter: undefined,
        onCreateConnector: () => {},
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      expect(rf.props.onConnect).toBeUndefined();
    });

    it('ReactFlow root suppresses onNodeContextMenu / onPaneContextMenu in view mode', () => {
      const tree = callSeeflowCanvas({
        mode: 'view',
        adapter: undefined,
        onDeleteNode: () => {},
        onPasteAt: () => {},
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      expect(rf.props.onNodeContextMenu).toBeUndefined();
      expect(rf.props.onPaneContextMenu).toBeUndefined();
    });

    it('CanvasToolbar in view mode shows only Select + Hand, even when onCreateShapeNode is wired', () => {
      // The Select + Hand navigation tools always render in view mode (the
      // toolbar is no longer hidden outright). The shape-creation affordances
      // stay hidden regardless of whether the host wires onCreateShapeNode —
      // view mode is read-only, so draw-to-create has no useful endpoint.
      const tree = callSeeflowCanvas({
        mode: 'view',
        adapter: undefined,
        onCreateShapeNode: () => {},
      });
      const toolbar = findElement(tree, (el) => el.type === CanvasToolbar);
      expect(toolbar).not.toBeNull();
      expect(toolbar?.props.showShapeTools).toBe(false);
    });

    it('StyleStrip is hidden in view mode even when style handlers are wired', () => {
      const tree = callSeeflowCanvas({
        mode: 'view',
        adapter: undefined,
        onStyleNode: () => {},
        onStyleConnector: () => {},
      });
      const strip = findElement(tree, (el) => el.type === StyleStrip);
      expect(strip).toBeNull();
    });

    it('SelectionResizeOverlay is suppressed in view mode', () => {
      const tree = callSeeflowCanvas({ mode: 'view', adapter: undefined });
      const overlay = findElement(tree, (el) => el.type === SelectionResizeOverlay);
      expect(overlay).toBeNull();
    });

    it('connector edge.data.onLabelChange is undefined in view mode (label is read-only)', () => {
      // Connector label inline-edit gates on the data callback being wired;
      // dropping it in view mode flips the EditableEdge to read-only.
      const tree = callSeeflowCanvas({
        mode: 'view',
        adapter: undefined,
        connectors: [
          {
            id: 'c1',
            source: 'a',
            target: 'b',
            sourceHandleAutoPicked: true,
            targetHandleAutoPicked: true,
            kind: 'default',
          } as Connector,
        ],
        nodes: [makeShapeNode('a'), makeShapeNode('b')],
        onConnectorLabelChange: () => {
          throw new Error('view-mode onConnectorLabelChange must not be invoked');
        },
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      const edges = rf.props.edges as Array<{ id?: string; data?: { onLabelChange?: unknown } }>;
      const c1 = edges.find((e) => e.id === 'c1');
      expect(c1?.data?.onLabelChange).toBeUndefined();
    });

    it('node.data.onNameChange and onDescriptionChange are undefined in view mode', () => {
      // Inline name/description edits gate on the data callbacks being wired
      // (the shape-node uses `onNameChange === undefined` as the read-only
      // signal that suppresses the dblclick-to-edit path).
      const tree = callSeeflowCanvas({
        mode: 'view',
        adapter: undefined,
        nodes: [makeShapeNode('a')],
        onNodeNameChange: () => {
          throw new Error('view-mode onNodeNameChange must not be invoked');
        },
        onNodeDescriptionChange: () => {
          throw new Error('view-mode onNodeDescriptionChange must not be invoked');
        },
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      const rfNodes = rf.props.nodes as Node[];
      const a = rfNodes.find((n) => n.id === 'a');
      expect((a?.data as { onNameChange?: unknown }).onNameChange).toBeUndefined();
      expect((a?.data as { onDescriptionChange?: unknown }).onDescriptionChange).toBeUndefined();
    });
  });

  describe("mode='mini' renders a static, chrome-free thumbnail", () => {
    // Mini-mode contract: every chrome affordance suppressed (no Controls,
    // toolbar, style-strip, detail panel, resize overlay) AND every input
    // path inert on the ReactFlow root (nodesDraggable / elementsSelectable
    // / selectionOnDrag / zoom / pan all false). Auto-fit-view defaults on
    // so the flow self-frames inside whatever box the consumer hands us.

    it('suppresses the bottom-left Controls cluster', () => {
      const tree = callSeeflowCanvas({
        mode: 'mini',
        adapter: undefined,
        nodes: [makeShapeNode('a')],
      });
      const controls = findElement(tree, (el) => el.type === Controls);
      expect(controls).toBeNull();
    });

    it('suppresses toolbar, style-strip, and resize overlay even when handlers are wired', () => {
      const tree = callSeeflowCanvas({
        mode: 'mini',
        adapter: undefined,
        onCreateShapeNode: () => {},
        onStyleNode: () => {},
        onStyleConnector: () => {},
      });
      expect(findElement(tree, (el) => el.type === CanvasToolbar)).toBeNull();
      expect(findElement(tree, (el) => el.type === StyleStrip)).toBeNull();
      expect(findElement(tree, (el) => el.type === SelectionResizeOverlay)).toBeNull();
    });

    it('suppresses the DetailPanel sidebar', () => {
      const tree = callSeeflowCanvas({
        mode: 'mini',
        adapter: undefined,
        nodes: [makeShapeNode('a')],
        selectedNodeIds: ['a'],
      });
      expect(findElement(tree, (el) => el.type === DetailPanel)).toBeNull();
    });

    it('makes every ReactFlow input path inert', () => {
      const tree = callSeeflowCanvas({
        mode: 'mini',
        adapter: undefined,
        nodes: [makeShapeNode('a'), makeShapeNode('b')],
        // Wiring these MUST NOT re-enable interactivity in mini mode — the
        // flag system gates ahead of the per-handler wiring.
        onNodePositionChange: () => {
          throw new Error('mini-mode onNodePositionChange must not be invoked');
        },
        onCreateConnector: () => {
          throw new Error('mini-mode onCreateConnector must not be invoked');
        },
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      expect(rf.props.nodesDraggable).toBe(false);
      expect(rf.props.nodesConnectable).toBe(false);
      expect(rf.props.elementsSelectable).toBe(false);
      expect(rf.props.selectionOnDrag).toBe(false);
      expect(rf.props.zoomOnScroll).toBe(false);
      expect(rf.props.zoomOnPinch).toBe(false);
      expect(rf.props.panOnDrag).toBe(false);
      expect(rf.props.deleteKeyCode).toBeNull();
    });

    it('lets a consumer flip individual flags back on (e.g. showStatusBadges)', () => {
      // The flag system still composes — mini is the floor, not a wall.
      const tree = callSeeflowCanvas({
        mode: 'mini',
        adapter: undefined,
        showStatusBadges: true,
        showControls: true,
      });
      const controls = findElement(tree, (el) => el.type === Controls);
      // Controls reappear once the override flips showControls back on.
      expect(controls).not.toBeNull();
    });
  });

  describe('US-007: built-in DetailPanel sidebar', () => {
    // Selection-driven sidebar: SeeflowCanvas internalizes <DetailPanel> and
    // derives its target from selectedNodeIds[0] / selectedConnectorIds[0].
    // The hook-shim tree captures <DetailPanel ...> as a placeholder element
    // (its body isn't executed) so we can assert its forwarded props directly.

    function findDetailPanel(tree: unknown) {
      return findElement(tree, (el) => el.type === DetailPanel);
    }

    it('renders a DetailPanel sibling inside the canvas wrapper by default', () => {
      const tree = callSeeflowCanvas({ nodes: [makeShapeNode('a')] });
      const panel = findDetailPanel(tree);
      expect(panel).not.toBeNull();
    });

    it('passes the first selected node into DetailPanel.node', () => {
      const a = makeShapeNode('a');
      const b = makeShapeNode('b');
      const tree = callSeeflowCanvas({ nodes: [a, b], selectedNodeIds: ['a'] });
      const panel = findDetailPanel(tree);
      expect(panel).not.toBeNull();
      expect((panel?.props as { node?: FlowNode }).node).toBe(a);
      expect((panel?.props as { connector?: Connector | null }).connector).toBeNull();
    });

    it('passes the first selected connector into DetailPanel.connector', () => {
      const conn: Connector = {
        id: 'c1',
        source: 'a',
        target: 'b',
        sourceHandleAutoPicked: true,
        targetHandleAutoPicked: true,
        kind: 'default',
      } as Connector;
      const tree = callSeeflowCanvas({
        nodes: [makeShapeNode('a'), makeShapeNode('b')],
        connectors: [conn],
        selectedConnectorIds: ['c1'],
      });
      const panel = findDetailPanel(tree);
      expect(panel).not.toBeNull();
      expect((panel?.props as { connector?: Connector }).connector).toBe(conn);
      expect((panel?.props as { node?: FlowNode | null }).node).toBeNull();
    });

    it('panel.node and panel.connector are null when nothing is selected', () => {
      const tree = callSeeflowCanvas({ nodes: [makeShapeNode('a')] });
      const panel = findDetailPanel(tree);
      expect((panel?.props as { node?: FlowNode | null }).node).toBeNull();
      expect((panel?.props as { connector?: Connector | null }).connector).toBeNull();
    });

    it('forwards adapter, statusReport, flowId, and field-edit callbacks', () => {
      const onNameChange = () => {};
      const onDescriptionChange = () => {};
      const onDetailChange = () => {};
      const statusReport = { state: 'ok' as const, summary: 's', ts: 7 };
      const tree = callSeeflowCanvas({
        projectId: 'proj-123',
        nodes: [makeShapeNode('a')],
        selectedNodeIds: ['a'],
        statusReport,
        onNameChange,
        onDescriptionChange,
        onDetailChange,
      });
      const panel = findDetailPanel(tree);
      expect(panel).not.toBeNull();
      const props = panel?.props as {
        adapter?: CanvasAdapter | null;
        flowId?: string | null;
        statusReport?: typeof statusReport;
        onNameChange?: typeof onNameChange;
        onDescriptionChange?: typeof onDescriptionChange;
        onDetailChange?: typeof onDetailChange;
      };
      expect(props.adapter).toBe(noopAdapter);
      expect(props.flowId).toBe('proj-123');
      expect(props.statusReport).toBe(statusReport);
      expect(props.onNameChange).toBe(onNameChange);
      expect(props.onDescriptionChange).toBe(onDescriptionChange);
      expect(props.onDetailChange).toBe(onDetailChange);
    });

    it('disableSidebar={true} suppresses the DetailPanel entirely', () => {
      const tree = callSeeflowCanvas({
        nodes: [makeShapeNode('a')],
        selectedNodeIds: ['a'],
        disableSidebar: true,
      });
      expect(findDetailPanel(tree)).toBeNull();
    });

    it("mode='view' suppresses the DetailPanel via flags.showDetailPanel=false", () => {
      const tree = callSeeflowCanvas({
        mode: 'view',
        adapter: undefined,
        nodes: [makeShapeNode('a')],
        selectedNodeIds: ['a'],
      });
      expect(findDetailPanel(tree)).toBeNull();
    });

    it('showDetailPanel={true} override surfaces the panel even in view mode', () => {
      // The CanvasFeatureOverrides escape hatch — a view-mode embedder that
      // still wants the built-in sidebar can lift the gate without flipping
      // the mode (would also opt back into adapter-driven mutations).
      const tree = callSeeflowCanvas({
        mode: 'view',
        adapter: undefined,
        nodes: [makeShapeNode('a')],
        selectedNodeIds: ['a'],
        showDetailPanel: true,
      });
      expect(findDetailPanel(tree)).not.toBeNull();
    });

    it('onClose clears the selection via onSelectionChange([], [])', () => {
      // The Sheet's X button / Radix-driven dismissal routes through onClose;
      // because the panel is selection-driven, closing it means clearing both
      // selection arrays so the next render's panel.node/connector go null.
      const calls: Array<[string[], string[]]> = [];
      const tree = callSeeflowCanvas({
        nodes: [makeShapeNode('a')],
        selectedNodeIds: ['a'],
        onSelectionChange: (nodeIds, connectorIds) => {
          calls.push([nodeIds, connectorIds]);
        },
      });
      const panel = findDetailPanel(tree);
      const onClose = (panel?.props as { onClose?: () => void }).onClose;
      expect(typeof onClose).toBe('function');
      onClose?.();
      expect(calls).toEqual([[[], []]]);
    });
  });

  describe('US-008: autoFitView mount-fit', () => {
    // The mount-fit lives in <ReactFlow>'s onInit handler (the late-nodes
    // useEffect path is the SAME guard re-tried on prop change — both
    // serialize through `didMountFitRef`). The hook-shim renderer captures
    // <ReactFlow> as a placeholder element, so we extract its onInit prop
    // and invoke it with a stub instance to observe the fitView call.

    function captureFitView(props: Partial<LegacyOverrides>): {
      tree: unknown;
      fitViewCalls: unknown[];
    } {
      const fitViewCalls: unknown[] = [];
      const refSink: { current: unknown }[] = [];
      const tree = callSeeflowCanvas(props, { refSink });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found');
      const onInit = (rf.props as { onInit?: (i: unknown) => void }).onInit;
      if (typeof onInit !== 'function') throw new Error('onInit not wired');
      const stubInstance = {
        fitView: (opts: unknown) => {
          fitViewCalls.push(opts);
        },
        getZoom: () => 1,
      };
      onInit(stubInstance);
      // Verify the stub landed in rfInstanceRef so the manual Fit View button
      // path (and the late-nodes useEffect, when invoked in production)
      // would see the same instance the test just exercised.
      expect(refSink[2]?.current).toBe(stubInstance);
      return { tree, fitViewCalls };
    }

    it('autoFitView default (undefined) → onInit does NOT call fitView on mount', () => {
      const { fitViewCalls } = captureFitView({ nodes: [makeShapeNode('a')] });
      expect(fitViewCalls.length).toBe(0);
    });

    it('autoFitView=true with nodes → onInit calls fitView exactly once with FIT_VIEW_OPTIONS', () => {
      const { fitViewCalls } = captureFitView({
        nodes: [makeShapeNode('a')],
        autoFitView: true,
      });
      expect(fitViewCalls.length).toBe(1);
      expect(fitViewCalls[0]).toBe(FIT_VIEW_OPTIONS);
      // Defensive: the options object itself must match the documented shape
      // (padding 0.15, duration 300, includeHiddenNodes false) so a future
      // refactor that swaps the constant for an inline literal still satisfies
      // the contract.
      expect(fitViewCalls[0]).toEqual({
        padding: 0.15,
        duration: 300,
        includeHiddenNodes: false,
      });
    });

    it('autoFitView=true with nodes.length=0 → onInit does NOT call fitView', () => {
      const { fitViewCalls } = captureFitView({ nodes: [], autoFitView: true });
      expect(fitViewCalls.length).toBe(0);
    });

    it('autoFitView={{ onMount: false }} → onInit does NOT call fitView', () => {
      const { fitViewCalls } = captureFitView({
        nodes: [makeShapeNode('a')],
        autoFitView: { onMount: false },
      });
      expect(fitViewCalls.length).toBe(0);
    });

    it('autoFitView={{ onMount: true }} (explicit object form) → onInit calls fitView once', () => {
      const { fitViewCalls } = captureFitView({
        nodes: [makeShapeNode('a')],
        autoFitView: { onMount: true },
      });
      expect(fitViewCalls.length).toBe(1);
      expect(fitViewCalls[0]).toBe(FIT_VIEW_OPTIONS);
    });

    it('autoFitView=false → onInit does NOT call fitView (mirror of default)', () => {
      const { fitViewCalls } = captureFitView({
        nodes: [makeShapeNode('a')],
        autoFitView: false,
      });
      expect(fitViewCalls.length).toBe(0);
    });
  });

  describe('US-009: autoFitViewSignal external-change fit', () => {
    // The signal-watching effect is wired with deps `[autoFitViewSignal]` and
    // skipped on its first run via `signalEffectMountedRef`. The hook-shim
    // captures useEffect callbacks in `effectSink`, so we fire the signal
    // effect twice: the first call simulates React's mount run (skip), the
    // second call simulates React re-running it after the host bumps the
    // signal. `resizingRef` / `draggingRef` are driven through the production
    // setResizing / onNodeDragStop wires so the interaction-guard path uses
    // the same closures the runtime uses.
    type EffectEntry = { cb: () => void; deps?: readonly unknown[] };
    type StubInstance = { fitView: (opts: unknown) => void; getZoom: () => number };

    function setup(props: Partial<LegacyOverrides>): {
      tree: unknown;
      effects: EffectEntry[];
      refs: { current: unknown }[];
      stub: StubInstance;
      fitViewCalls: unknown[];
      signalEffect: EffectEntry;
    } {
      const fitViewCalls: unknown[] = [];
      const refs: { current: unknown }[] = [];
      const effects: EffectEntry[] = [];
      const tree = callSeeflowCanvas(props, { refSink: refs, effectSink: effects });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found');
      const stub: StubInstance = {
        fitView: (opts: unknown) => {
          fitViewCalls.push(opts);
        },
        getZoom: () => 1,
      };
      const onInit = (rf.props as { onInit?: (i: unknown) => void }).onInit;
      if (typeof onInit !== 'function') throw new Error('onInit not wired');
      onInit(stub);
      // The signal effect is the one whose deps array has exactly one entry
      // matching the `autoFitViewSignal` prop value. Identifying it by deps
      // shape keeps the test robust against unrelated effects being added
      // above or below it in declaration order.
      const target = props.autoFitViewSignal;
      const signalEffect = effects.find(
        (e) => Array.isArray(e.deps) && e.deps.length === 1 && e.deps[0] === target,
      );
      if (!signalEffect) {
        throw new Error(
          `signal-watching effect (deps: [${String(target)}]) not found in captured effects`,
        );
      }
      return { tree, effects, refs, stub, fitViewCalls, signalEffect };
    }

    it('autoFitView=true, signal bump → exactly one fitView with FIT_VIEW_OPTIONS', () => {
      const { fitViewCalls, signalEffect } = setup({
        nodes: [makeShapeNode('a')],
        autoFitView: true,
        autoFitViewSignal: 0,
      });
      // onInit already fired the mount-fit (autoFitView=true + nodes>0).
      expect(fitViewCalls.length).toBe(1);
      fitViewCalls.length = 0;
      // First effect run = mount tick → signalEffectMountedRef flips, skip.
      signalEffect.cb();
      expect(fitViewCalls.length).toBe(0);
      // Second effect run = simulated re-run after host bumped the signal.
      signalEffect.cb();
      expect(fitViewCalls.length).toBe(1);
      expect(fitViewCalls[0]).toBe(FIT_VIEW_OPTIONS);
    });

    it('signal bump while resizing → defer; clearing isResizing flushes exactly one fitView', () => {
      const { fitViewCalls, signalEffect, tree } = setup({
        nodes: [makeShapeNode('a')],
        autoFitView: true,
        autoFitViewSignal: 0,
      });
      fitViewCalls.length = 0; // discard mount-fit
      // Drive isResizing through the production setResizing closure attached
      // to the rfNode's data — same channel NodeResizer uses at runtime.
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found');
      const rfNode = (rf.props as { nodes: Node[] }).nodes[0];
      if (!rfNode) throw new Error('rfNode not built');
      const setResizing = (rfNode.data as { setResizing?: (on: boolean) => void }).setResizing;
      if (typeof setResizing !== 'function')
        throw new Error('setResizing missing from rfNode.data');
      setResizing(true);
      // Mount run + bump run while interaction in flight → defer, no fit.
      signalEffect.cb();
      signalEffect.cb();
      expect(fitViewCalls.length).toBe(0);
      // Clearing isResizing triggers flushPendingFit → exactly one fitView.
      setResizing(false);
      expect(fitViewCalls.length).toBe(1);
      expect(fitViewCalls[0]).toBe(FIT_VIEW_OPTIONS);
      // The flush is idempotent — a redundant setResizing(false) does nothing.
      setResizing(false);
      expect(fitViewCalls.length).toBe(1);
    });

    it('signal bump while dragging → defer; onNodeDragStop flushes exactly one fitView', () => {
      const { fitViewCalls, signalEffect, tree } = setup({
        nodes: [makeShapeNode('a')],
        autoFitView: true,
        autoFitViewSignal: 0,
      });
      fitViewCalls.length = 0; // discard mount-fit
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found');
      const onNodeDragStart = (rf.props as { onNodeDragStart?: () => void }).onNodeDragStart;
      const onNodeDragStop = (
        rf.props as {
          onNodeDragStop?: (e: unknown, n: Node, dragged: Node[]) => void;
        }
      ).onNodeDragStop;
      if (typeof onNodeDragStart !== 'function') throw new Error('onNodeDragStart not wired');
      if (typeof onNodeDragStop !== 'function') throw new Error('onNodeDragStop not wired');
      onNodeDragStart();
      signalEffect.cb(); // mount tick → skip
      signalEffect.cb(); // bump while dragging → defer
      expect(fitViewCalls.length).toBe(0);
      // Drag stops with the dragged-node list. The committedDraggedNodes call
      // path requires a node with a real position; reuse the existing rfNode.
      const rfNode = (rf.props as { nodes: Node[] }).nodes[0];
      if (!rfNode) throw new Error('rfNode not built');
      onNodeDragStop(null, rfNode, [rfNode]);
      expect(fitViewCalls.length).toBe(1);
      expect(fitViewCalls[0]).toBe(FIT_VIEW_OPTIONS);
    });

    it('autoFitView={{ onExternalNodeChange: false }} → signal bump does NOT fit', () => {
      const { fitViewCalls, signalEffect } = setup({
        nodes: [makeShapeNode('a')],
        autoFitView: { onMount: false, onExternalNodeChange: false },
        autoFitViewSignal: 0,
      });
      // Mount run skips; bump run reads onExternalNodeChange=false → skip.
      signalEffect.cb();
      signalEffect.cb();
      expect(fitViewCalls.length).toBe(0);
    });

    it('autoFitView default (undefined) → signal bump does NOT fit', () => {
      // Symmetric to the AC's view-mode default; the signal is inert until
      // the host opts in via autoFitView.
      const { fitViewCalls, signalEffect } = setup({
        nodes: [makeShapeNode('a')],
        autoFitViewSignal: 0,
      });
      signalEffect.cb();
      signalEffect.cb();
      expect(fitViewCalls.length).toBe(0);
    });
  });
});

describe('US-008: resolveAutoFitView helper', () => {
  // Pure helper test — covers the union (undefined | boolean | object). The
  // mount + signal-driven fit effects inside SeeflowCanvas consume the
  // resolved pair of booleans, so pinning resolveAutoFitView pins the whole
  // auto-fit contract end-to-end.
  it('undefined → both triggers off', () => {
    expect(resolveAutoFitView(undefined)).toEqual({
      onMount: false,
      onExternalNodeChange: false,
    });
  });

  it('false → both triggers off', () => {
    expect(resolveAutoFitView(false)).toEqual({
      onMount: false,
      onExternalNodeChange: false,
    });
  });

  it('true → both triggers on (the documented shorthand)', () => {
    expect(resolveAutoFitView(true)).toEqual({
      onMount: true,
      onExternalNodeChange: true,
    });
  });

  it('empty object {} → both triggers default to true', () => {
    // Same semantics as `true`. The object form exists for granular opt-out.
    expect(resolveAutoFitView({})).toEqual({
      onMount: true,
      onExternalNodeChange: true,
    });
  });

  it('{ onMount: false } → only the mount trigger flips off', () => {
    expect(resolveAutoFitView({ onMount: false })).toEqual({
      onMount: false,
      onExternalNodeChange: true,
    });
  });

  it('{ onExternalNodeChange: false } → only the signal trigger flips off', () => {
    expect(resolveAutoFitView({ onExternalNodeChange: false })).toEqual({
      onMount: true,
      onExternalNodeChange: false,
    });
  });

  it('explicit { onMount: true, onExternalNodeChange: true } → both on', () => {
    expect(resolveAutoFitView({ onMount: true, onExternalNodeChange: true })).toEqual({
      onMount: true,
      onExternalNodeChange: true,
    });
  });
});

describe('US-027: resolveFlags helper', () => {
  // Pure helper test — covers the mode preset + the override layer. Behavior
  // gates inside <SeeflowCanvas> consume the resolved flag set, so pinning
  // resolveFlags pins the gating contract end-to-end.
  it("returns the edit preset when no overrides are passed (mode='edit')", () => {
    expect(resolveFlags({ mode: 'edit' })).toEqual({
      showToolbar: true,
      showStyleStrip: true,
      showDetailPanel: true,
      showStatusBadges: true,
      showResizeHandles: true,
      showControls: true,
      showShareMenu: true,
      showRestart: true,
      enableKeyboard: true,
      enableContextMenu: true,
      enableDragDrop: true,
      enableImageDrop: true,
      enableZoom: true,
      enablePan: true,
      enableSelection: true,
      enableNodeMove: true,
      // Embed defaults OFF in every mode — it's a SeeFlow-studio-specific
      // affordance, so embedders of @seeflow/canvas opt in explicitly.
      enableEmbed: false,
    });
  });

  it("returns the view preset when no overrides are passed (mode='view')", () => {
    // The view preset hides chrome + disables every editing path, but keeps
    // pan/zoom (so the canvas is navigable), status badges (so SSE-driven
    // monitoring still surfaces), selection + local-state node drag, and
    // the bottom-left Controls cluster (zoom-in/out/fit/tidy navigation aids).
    expect(resolveFlags({ mode: 'view' })).toEqual({
      // View mode renders a slimmed-down toolbar (Select + Hand only) so the
      // outer flag stays on; SeeflowCanvas hides shape tiles via its
      // showShapeTools={isEditMode} pass-through.
      showToolbar: true,
      showStyleStrip: false,
      showDetailPanel: false,
      showStatusBadges: true,
      showResizeHandles: false,
      showControls: true,
      showShareMenu: true,
      showRestart: false,
      enableKeyboard: false,
      enableContextMenu: false,
      enableDragDrop: false,
      enableImageDrop: false,
      enableZoom: true,
      enablePan: true,
      enableSelection: true,
      enableNodeMove: true,
      enableEmbed: false,
    });
  });

  it("returns the mini preset when no overrides are passed (mode='mini')", () => {
    // The mini preset turns every chrome affordance off (incl. the Controls
    // cluster) AND every input path inert (no pan/zoom, no selection, no
    // node drag, no keyboard, no context menu). Status badges default off
    // so thumbnails read visually neutral; consumers flip them on via
    // override if they want a live-state preview.
    expect(resolveFlags({ mode: 'mini' })).toEqual({
      showToolbar: false,
      showStyleStrip: false,
      showDetailPanel: false,
      showStatusBadges: false,
      showResizeHandles: false,
      showControls: false,
      showShareMenu: false,
      showRestart: false,
      enableKeyboard: false,
      enableContextMenu: false,
      enableDragDrop: false,
      enableImageDrop: false,
      enableZoom: false,
      enablePan: false,
      enableSelection: false,
      enableNodeMove: false,
      enableEmbed: false,
    });
  });

  it('lets a mini-mode consumer flip individual flags back on', () => {
    // A thumbnail that wants live-state badges + pan-to-explore is still
    // expressible via overrides; the mini preset is just the default floor.
    const resolved = resolveFlags({
      mode: 'mini',
      showStatusBadges: true,
      enablePan: true,
    });
    expect(resolved.showStatusBadges).toBe(true);
    expect(resolved.enablePan).toBe(true);
    // Other mini defaults stay off.
    expect(resolved.showControls).toBe(false);
    expect(resolved.enableSelection).toBe(false);
    expect(resolved.enableNodeMove).toBe(false);
  });

  it('lets a per-feature override turn an edit-mode flag off', () => {
    // Edit mode + hide the toolbar (e.g. a presentation slice that wants
    // every editing keyboard shortcut + persistence on, but no on-canvas
    // shape picker chrome).
    const resolved = resolveFlags({ mode: 'edit', showToolbar: false });
    expect(resolved.showToolbar).toBe(false);
    // Other defaults stay edit-on.
    expect(resolved.showStyleStrip).toBe(true);
    expect(resolved.enableContextMenu).toBe(true);
  });

  it('lets a per-feature override turn a view-mode flag on', () => {
    // View mode + opt-in to status badges (already on by default) and
    // opt-in to keyboard shortcuts (off by default) — e.g. a kiosk where
    // panning + zoom + ESC clear should still work.
    const resolved = resolveFlags({
      mode: 'view',
      enableKeyboard: true,
      showStatusBadges: true,
    });
    expect(resolved.enableKeyboard).toBe(true);
    expect(resolved.showStatusBadges).toBe(true);
    // Other view defaults stay view-off (the toolbar is now visible in view
    // mode, but only as the Select + Hand navigation pair — see the
    // showShapeTools gate in SeeflowCanvas).
    expect(resolved.showStyleStrip).toBe(false);
    expect(resolved.enableContextMenu).toBe(false);
  });

  it('treats undefined override as "use preset" (does not coerce to false)', () => {
    // Regression net: a future refactor must not accidentally drop the `??`
    // and use `||` or `Boolean(input.flag)` — those would treat undefined as
    // false in edit mode, regressing the toolbar away.
    const resolved = resolveFlags({ mode: 'edit', showToolbar: undefined });
    expect(resolved.showToolbar).toBe(true);
  });

  it('respects explicit false even in edit mode (override wins over preset)', () => {
    expect(resolveFlags({ mode: 'edit', enablePan: false }).enablePan).toBe(false);
  });

  it('respects explicit true even in view mode (override wins over preset)', () => {
    expect(resolveFlags({ mode: 'view', showToolbar: true }).showToolbar).toBe(true);
  });

  it('lets an edit-mode consumer opt in to the ShareMenu Embed item via enableEmbed', () => {
    // Embed is off by default in every mode; the studio (and other hosts that
    // want the iframe-snippet surface) flip it on explicitly. Without the
    // override the flag stays false so most embedders never surface Embed.
    expect(resolveFlags({ mode: 'edit' }).enableEmbed).toBe(false);
    expect(resolveFlags({ mode: 'edit', enableEmbed: true }).enableEmbed).toBe(true);
    // Override is honored regardless of mode (the menu's mode+projectId gate
    // is what stops a view-mode embed surface from rendering at the end).
    expect(resolveFlags({ mode: 'view', enableEmbed: true }).enableEmbed).toBe(true);
    expect(resolveFlags({ mode: 'mini', enableEmbed: true }).enableEmbed).toBe(true);
  });
});

describe('US-014: imperative handle + ShareMenu wiring', () => {
  // Locate the top-right Panel + the ShareMenu inside it. The Panel is a
  // structural marker; `position="top-right"` is what distinguishes the
  // share Panel from the existing top-left toolbar/style Panel.
  function findShareMenu(tree: unknown): ReactElementLike | null {
    return findElement(tree, (el) => el.type === (ShareMenu as unknown));
  }

  it('exposes exportPdf, exportPng, openEmbedDialog, capturePreview on the ref handle after mount', () => {
    const handle: { current: SeeflowCanvasHandle | null } = { current: null };
    callSeeflowCanvas({}, { ref: handle });
    expect(handle.current).not.toBeNull();
    expect(typeof handle.current?.exportPdf).toBe('function');
    expect(typeof handle.current?.exportPng).toBe('function');
    expect(typeof handle.current?.openEmbedDialog).toBe('function');
    expect(typeof handle.current?.capturePreview).toBe('function');
  });

  it('renders the ShareMenu in edit mode by default', () => {
    const tree = callSeeflowCanvas({ mode: 'edit', adapter: noopAdapter });
    const menu = findShareMenu(tree);
    expect(menu).not.toBeNull();
    // mode is forwarded as 'edit' (not mapped to view) so Embed + Export to
    // seeflow.dev remain reachable inside the menu's own gating.
    expect(menu?.props.mode).toBe('edit');
  });

  it('renders the ShareMenu in view mode by default', () => {
    const tree = callSeeflowCanvas({ mode: 'view' });
    const menu = findShareMenu(tree);
    expect(menu).not.toBeNull();
    expect(menu?.props.mode).toBe('view');
  });

  it("does NOT render the ShareMenu when mode === 'mini'", () => {
    const tree = callSeeflowCanvas({ mode: 'mini' });
    expect(findShareMenu(tree)).toBeNull();
  });

  it('does NOT render the ShareMenu when showShareMenu is explicitly false', () => {
    const tree = callSeeflowCanvas({ mode: 'edit', adapter: noopAdapter, showShareMenu: false });
    expect(findShareMenu(tree)).toBeNull();
  });

  it('threads projectId + onExportToCloud + the exportApi callbacks into ShareMenu', () => {
    const onExportToCloud = () => {};
    const tree = callSeeflowCanvas({
      mode: 'edit',
      adapter: noopAdapter,
      projectId: 'demo-42',
      onExportToCloud,
    });
    const menu = findShareMenu(tree);
    expect(menu).not.toBeNull();
    expect(menu?.props.projectId).toBe('demo-42');
    expect(menu?.props.onExportToCloud).toBe(onExportToCloud);
    expect(typeof menu?.props.onDownloadPdf).toBe('function');
    expect(typeof menu?.props.onDownloadPng).toBe('function');
    // The controlled embed-dialog state lift exposes both prongs.
    expect(typeof menu?.props.onEmbedOpenChange).toBe('function');
    expect(menu?.props.embedOpen).toBe(false);
  });
});
