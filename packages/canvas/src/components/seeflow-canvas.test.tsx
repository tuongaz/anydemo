import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { type Connection, Controls, MiniMap, type Node, ReactFlow } from '@xyflow/react';
import * as React from 'react';
import type { CanvasAdapter, CanvasRuntime } from '../adapter/types.ts';
import { COLOR_TOKENS, NODE_DEFAULT_BG_WHITE } from '../lib/color-tokens.ts';
import { CloudShape } from '../nodes/shapes/cloud.tsx';
import { DatabaseShape } from '../nodes/shapes/database.tsx';
import { QueueShape } from '../nodes/shapes/queue.tsx';
import { ServerShape } from '../nodes/shapes/server.tsx';
import { UserShape } from '../nodes/shapes/user.tsx';
import type { ComponentSpec, Connector, FlowNode } from '../types.ts';
import { CanvasToolbar, HTML_BLOCK_DND_TYPE } from './canvas-toolbar.tsx';
import { DetailPanel } from './detail-panel.tsx';
import { InspectorToggle } from './inspector-toggle.tsx';
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
  pickNearestSnapTarget,
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
/**
 * `setterSink`, when provided, captures every `setState(next)` call as
 * `{ slot, next }` where `slot` is the useState DECLARATION index (matching
 * `useStateOverrides[slot]`). `next` is recorded verbatim — for updater-form
 * setters (e.g. `setX(v => !v)`), `next` is the callback function rather than
 * the resolved value. Used to assert state-update intent without a real React
 * renderer (the shim's setter is otherwise a no-op).
 */
type CapturedSetterCall = { slot: number; next: unknown };
function renderWithHooks<T>(
  fn: () => T,
  options: {
    useStateOverrides?: ReadonlyArray<unknown>;
    refSink?: { current: unknown }[];
    effectSink?: CapturedEffect[];
    setterSink?: CapturedSetterCall[];
  } = {},
): T {
  const { useStateOverrides, refSink, effectSink, setterSink } = options;
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
      const setter = (next: S | ((prev: S) => S)) => {
        setterSink?.push({ slot: idx, next });
      };
      const override = useStateOverrides?.[idx];
      if (override !== undefined) return [override as S, setter];
      const value = typeof initial === 'function' ? (initial as () => S)() : initial;
      return [value, setter];
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
    setterSink?: CapturedSetterCall[];
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
  } as unknown as SeeflowCanvasProps;
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
    type: 'rectangle',
    position: { x: 0, y: 0 },
    data: { name: id },
  };
}

function makeTextNode(id: string): FlowNode {
  return {
    id,
    type: 'text',
    position: { x: 0, y: 0 },
    data: { name: id },
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
      // The validator's text-shape predicate gates on `type === 'text'` —
      // non-text shapes must pass through.
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
        type: 'rectangle',
        position: { x: 100, y: 100 },
        data: { width: 120, height: 80 },
      };
    }

    function makeTextNodeOverride(id: string): Partial<FlowNode> {
      return {
        id,
        type: 'text',
        position: { x: 100, y: 100 },
        data: { width: 120, height: 80 },
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

    // Canvas grouping M8 (step 3 — preview parity for group endpoints). The
    // connection-line PREVIEW scans every node for the nearest bbox to the
    // cursor; the COMMIT body-drop hit-tests `elementsFromPoint` (z-order). A
    // member node sits ABOVE its containing group (member z=0, group z=-1), and
    // the group's bbox CONTAINS the member's. When the cursor is inside both,
    // both have bbox distance 0 — so the preview must break the tie the SAME way
    // the commit does: pick the innermost (smallest-area) node = the member, not
    // the enclosing group. Otherwise the preview snaps to the group border while
    // the commit lands on the member ("preview must mirror commit" memory).
    describe('pickNearestSnapTarget (group/member preview tie-break, M8)', () => {
      // grp-1: 600×400 group box at (1000, 1000). node-a: a 160×60 member fully
      // inside it at (1100, 1100). node-c: a loose node far away at (3000, 3000).
      const group = {
        id: 'grp-1',
        internals: { positionAbsolute: { x: 1000, y: 1000 } },
        measured: { width: 600, height: 400 },
      };
      const member = {
        id: 'node-a',
        internals: { positionAbsolute: { x: 1100, y: 1100 } },
        measured: { width: 160, height: 60 },
      };
      const far = {
        id: 'node-c',
        internals: { positionAbsolute: { x: 3000, y: 3000 } },
        measured: { width: 100, height: 60 },
      };

      it('cursor inside a member (and its group) picks the MEMBER (smallest area wins the tie)', () => {
        // Cursor at the member center — distance 0 to BOTH the member and the
        // enclosing group. The innermost (member) must win, mirroring the
        // commit-side elementsFromPoint z-order pick.
        const best = pickNearestSnapTarget([group, member], { x: 1180, y: 1130 }, 15, null);
        expect(best?.id).toBe('node-a');
      });

      it('is order-independent (group authored AFTER the member still loses the tie)', () => {
        // The old `dist <= best` last-wins rule made the result depend on
        // iteration order. Area tie-break is deterministic regardless of order.
        const best = pickNearestSnapTarget([member, group], { x: 1180, y: 1130 }, 15, null);
        expect(best?.id).toBe('node-a');
      });

      it('cursor over the group padding band (not over any member) picks the GROUP', () => {
        // Inside the group box but OUTSIDE the member → only the group has
        // distance 0, so it wins outright. This is the "connect to the group as
        // a whole" path (design §3 #4).
        const best = pickNearestSnapTarget([group, member], { x: 1050, y: 1380 }, 15, null);
        expect(best?.id).toBe('grp-1');
      });

      it('honors the exclude id (never snaps to the fixed/source node)', () => {
        // With the member excluded, the next-nearest inside the cursor is the
        // group. Mirrors the preview excluding the drag-origin node.
        const best = pickNearestSnapTarget([group, member], { x: 1180, y: 1130 }, 15, 'node-a');
        expect(best?.id).toBe('grp-1');
      });

      it('returns null when no node is within the buffer', () => {
        // Cursor far from every node bbox (> buffer) → no snap target, so the
        // preview floats free (and the commit no-ops on an empty-space drop).
        expect(
          pickNearestSnapTarget([group, member, far], { x: 9000, y: 9000 }, 15, null),
        ).toBeNull();
      });

      it('snaps to a node within the buffer when the cursor is just outside its bbox', () => {
        // 10px to the left of the loose node (buffer 15) → still snaps to it.
        const best = pickNearestSnapTarget([far], { x: 2990, y: 3030 }, 15, null);
        expect(best?.id).toBe('node-c');
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
      // editingConnectorIdRef (connector inline-edit session, survives the
      // SSE-echo edge remount) was added immediately after editHandlesRef —
      // above drawShape — so every ref below drifted down by +1.
      drawShape: 17,
      // drawIconRef sits between drawShapeRef and drawStartRef (mirrors the
      // draw-icon canvasMode variant for the icon-equivalent of the shape
      // drag-create flow), shifting every ref below by +1.
      drawIcon: 18,
      drawStart: 19,
      drawCurrent: 20,
      drawing: 21,
      // Task 7 (freehand pen): penPointsRef / penDrawingRef / penModeRef are
      // appended immediately after drawingRef, so they land in fresh slots
      // 22-24 and shift nothing above. Keep them last here too.
      penPoints: 22,
      penDrawing: 23,
      penMode: 24,
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

    // Drives the gesture handlers with a shape + Shift held and asserts the
    // committed bounding box has the shape's PERFECT aspect ratio. Identity
    // screenToFlowPosition keeps the math obvious.
    const driveShiftDraw = (
      shape: string,
      from: { x: number; y: number },
      to: { x: number; y: number },
    ): { width: number; height: number } => {
      const refs: { current: unknown }[] = [];
      let size: { width: number; height: number } | null = null;
      const tree = callSeeflowCanvas(
        {
          canvasMode: { kind: 'draw', shape: shape as 'rectangle' },
          onCreateShapeNode: (_s, _p, sz) => {
            size = sz as { width: number; height: number };
          },
        },
        { refSink: refs },
      );
      refAt(refs, REF.drawShape).current = shape;
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
      const paneTarget = { classList: { contains: (c: string) => c === 'react-flow__pane' } };
      const noop = () => {};
      // shiftKey held throughout so the gesture aspect-locks.
      const ev = (clientX: number, clientY: number) => ({
        target: paneTarget,
        currentTarget: { setPointerCapture: noop, releasePointerCapture: noop },
        clientX,
        clientY,
        pointerId: 1,
        button: 0,
        isPrimary: true,
        shiftKey: true,
        preventDefault: noop,
        stopPropagation: noop,
      });
      (wrapper.props.onPointerDown as (e: unknown) => void)(ev(from.x, from.y));
      (wrapper.props.onPointerMove as (e: unknown) => void)(ev(to.x, to.y));
      (wrapper.props.onPointerUp as (e: unknown) => void)(ev(to.x, to.y));
      if (!size) throw new Error('onCreateShapeNode was not called');
      return size;
    };

    it('Shift locks rectangle to a perfect square (1:1)', () => {
      // Drag 240×80; Shift should square it to 240×240.
      const size = driveShiftDraw('rectangle', { x: 100, y: 100 }, { x: 340, y: 180 });
      expect(size).toEqual({ width: 240, height: 240 });
    });

    it('Shift locks ellipse to a perfect circle (1:1)', () => {
      const size = driveShiftDraw('ellipse', { x: 100, y: 100 }, { x: 160, y: 300 });
      // Tall drag → square grows to the height (200).
      expect(size).toEqual({ width: 200, height: 200 });
    });

    it('Shift locks triangle to the equilateral aspect (height = width·√3/2)', () => {
      const size = driveShiftDraw('triangle', { x: 100, y: 100 }, { x: 340, y: 100 });
      expect(size.width).toBe(240);
      expect(size.height).toBeCloseTo(240 * (Math.sqrt(3) / 2), 6);
      expect(size.height / size.width).toBeCloseTo(Math.sqrt(3) / 2, 10);
    });

    it('Shift locks hexagon to the regular flat-top aspect (height = width·√3/2)', () => {
      const size = driveShiftDraw('hexagon', { x: 100, y: 100 }, { x: 340, y: 100 });
      expect(size.width).toBe(240);
      expect(size.height / size.width).toBeCloseTo(Math.sqrt(3) / 2, 10);
    });

    it('discards a fast release flick so the shape commits at the last deliberate position', () => {
      const refs: { current: unknown }[] = [];
      let captured: {
        pos: { x: number; y: number };
        size: { width: number; height: number };
      } | null = null;
      const tree = callSeeflowCanvas(
        {
          canvasMode: { kind: 'draw', shape: 'rectangle' },
          onCreateShapeNode: (_s, pos, size) => {
            captured = {
              pos: pos as { x: number; y: number },
              size: size as { width: number; height: number },
            };
          },
        },
        { refSink: refs },
      );
      refAt(refs, REF.drawShape).current = 'rectangle';
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
      const paneTarget = { classList: { contains: (c: string) => c === 'react-flow__pane' } };
      const noop = () => {};
      // timeStamp drives the settle clock: a deliberate move to (300,300) at
      // t=100, then the pointer is yanked to (900,900) by release at t=116
      // (≈53 px/ms ≫ the flick threshold). The flick must be discarded.
      const ev = (clientX: number, clientY: number, timeStamp: number) => ({
        target: paneTarget,
        currentTarget: { setPointerCapture: noop, releasePointerCapture: noop },
        clientX,
        clientY,
        timeStamp,
        pointerId: 1,
        button: 0,
        isPrimary: true,
        preventDefault: noop,
        stopPropagation: noop,
      });
      (wrapper.props.onPointerDown as (e: unknown) => void)(ev(100, 100, 0));
      (wrapper.props.onPointerMove as (e: unknown) => void)(ev(300, 300, 100));
      (wrapper.props.onPointerUp as (e: unknown) => void)(ev(900, 900, 116));
      if (!captured) throw new Error('onCreateShapeNode was not called');
      const commit = captured as {
        pos: { x: number; y: number };
        size: { width: number; height: number };
      };
      // Committed at the deliberate (300,300), NOT the (900,900) release flick.
      expect(commit.pos).toEqual({ x: 100, y: 100 });
      expect(commit.size).toEqual({ width: 200, height: 200 });
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

    it('linkflow drag commits via onCreateLinkflowNode with min-clamped dims (160x80 floor)', () => {
      const refs: { current: unknown }[] = [];
      const captured: Array<{
        pos: { x: number; y: number };
        size: { width: number; height: number };
      }> = [];
      const tree = callSeeflowCanvas(
        {
          canvasMode: { kind: 'draw', shape: 'linkflow' },
          onCreateLinkflowNode: (pos, size) => {
            captured.push({
              pos: pos as { x: number; y: number },
              size: size as { width: number; height: number },
            });
          },
        },
        { refSink: refs },
      );
      refAt(refs, REF.drawShape).current = 'linkflow';
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

      const paneTarget = { classList: { contains: (c: string) => c === 'react-flow__pane' } };
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

      // A 50×30 drag is above LINKFLOW_NEAR_ZERO_DRAG=4 but below
      // LINKFLOW_MIN_SIZE.height=96 — width should pass through (50 is below
      // the floor too so it clamps to 160), and height clamps to 96.
      (wrapper.props.onPointerDown as (e: unknown) => void)(at(100, 100));
      (wrapper.props.onPointerMove as (e: unknown) => void)(at(150, 130));
      (wrapper.props.onPointerUp as (e: unknown) => void)(at(150, 130));

      expect(captured.length).toBe(1);
      const commit = captured[0];
      if (!commit) throw new Error('onCreateLinkflowNode was not called');
      expect(commit.pos).toEqual({ x: 100, y: 100 });
      expect(commit.size).toEqual({ width: 160, height: 96 });
    });

    it('linkflow drag larger than floor honors the drag rectangle', () => {
      const refs: { current: unknown }[] = [];
      const captured: Array<{
        pos: { x: number; y: number };
        size: { width: number; height: number };
      }> = [];
      const tree = callSeeflowCanvas(
        {
          canvasMode: { kind: 'draw', shape: 'linkflow' },
          onCreateLinkflowNode: (pos, size) => {
            captured.push({
              pos: pos as { x: number; y: number },
              size: size as { width: number; height: number },
            });
          },
        },
        { refSink: refs },
      );
      refAt(refs, REF.drawShape).current = 'linkflow';
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
      const paneTarget = { classList: { contains: (c: string) => c === 'react-flow__pane' } };
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

      // 300×200 drag — both dims above the floor, ship as-is.
      (wrapper.props.onPointerDown as (e: unknown) => void)(at(50, 50));
      (wrapper.props.onPointerMove as (e: unknown) => void)(at(350, 250));
      (wrapper.props.onPointerUp as (e: unknown) => void)(at(350, 250));

      expect(captured.length).toBe(1);
      const commit = captured[0];
      if (!commit) throw new Error('onCreateLinkflowNode was not called');
      expect(commit.pos).toEqual({ x: 50, y: 50 });
      expect(commit.size).toEqual({ width: 300, height: 200 });
    });

    it('linkflow tap (near-zero drag) falls back to LINKFLOW_DEFAULT_SIZE 240x132', () => {
      const refs: { current: unknown }[] = [];
      const captured: Array<{
        pos: { x: number; y: number };
        size: { width: number; height: number };
      }> = [];
      const tree = callSeeflowCanvas(
        {
          canvasMode: { kind: 'draw', shape: 'linkflow' },
          onCreateLinkflowNode: (pos, size) => {
            captured.push({
              pos: pos as { x: number; y: number },
              size: size as { width: number; height: number },
            });
          },
        },
        { refSink: refs },
      );
      refAt(refs, REF.drawShape).current = 'linkflow';
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
      const paneTarget = { classList: { contains: (c: string) => c === 'react-flow__pane' } };
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

      // Identical down + up → 0×0 drag → near-zero branch → default size.
      (wrapper.props.onPointerDown as (e: unknown) => void)(at(200, 150));
      (wrapper.props.onPointerUp as (e: unknown) => void)(at(200, 150));

      expect(captured.length).toBe(1);
      const commit = captured[0];
      if (!commit) throw new Error('onCreateLinkflowNode was not called');
      expect(commit.pos).toEqual({ x: 200, y: 150 });
      expect(commit.size).toEqual({ width: 240, height: 132 });
    });

    it('pen mode: pointerdown → move → up commits via onCreateFreehandNode with normalized points + box', () => {
      const refs: { current: unknown }[] = [];
      const captured: Array<{
        pos: { x: number; y: number };
        size: { width: number; height: number };
        points: [number, number, number][];
      }> = [];
      const tree = callSeeflowCanvas(
        {
          canvasMode: { kind: 'pen' },
          onCreateFreehandNode: (pos, size, points) => {
            captured.push({
              pos: pos as { x: number; y: number },
              size: size as { width: number; height: number },
              points: points as [number, number, number][],
            });
          },
        },
        { refSink: refs },
      );
      // penModeRef mirrors the pen canvasMode via useEffect, but the hook shim
      // no-ops useEffect — so prime it directly (mirrors how the shape tests
      // prime drawShapeRef). rfInstance must expose screenToFlowPosition;
      // identity mapping keeps flow == screen for the box math.
      refAt(refs, REF.penMode).current = true;
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

      const paneTarget = { classList: { contains: (c: string) => c === 'react-flow__pane' } };
      const noop = () => {};
      const at = (x: number, y: number) => ({
        target: paneTarget,
        currentTarget: { setPointerCapture: noop, releasePointerCapture: noop },
        clientX: x,
        clientY: y,
        pointerId: 1,
        pressure: 0.5,
        button: 0,
        isPrimary: true,
        preventDefault: noop,
        stopPropagation: noop,
      });

      (wrapper.props.onPointerDown as (e: unknown) => void)(at(100, 100));
      // After down: penDrawing flips true, first sample recorded.
      expect(refAt(refs, REF.penDrawing).current).toBe(true);
      expect((refAt(refs, REF.penPoints).current as unknown[]).length).toBe(1);

      (wrapper.props.onPointerMove as (e: unknown) => void)(at(200, 150));
      (wrapper.props.onPointerMove as (e: unknown) => void)(at(300, 400));
      expect((refAt(refs, REF.penPoints).current as unknown[]).length).toBe(3);

      (wrapper.props.onPointerUp as (e: unknown) => void)(at(300, 400));
      // After up: penDrawing flips false; the path ref is cleared for the next
      // stroke; pen stays armed (no exitDrawMode → penMode ref unchanged).
      expect(refAt(refs, REF.penDrawing).current).toBe(false);
      expect((refAt(refs, REF.penPoints).current as unknown[]).length).toBe(0);
      expect(refAt(refs, REF.penMode).current).toBe(true);

      expect(captured.length).toBe(1);
      const commit = captured[0];
      if (!commit) throw new Error('onCreateFreehandNode was not called');
      // box over (100,100)..(300,400): top-left (100,100), 200×300.
      expect(commit.pos).toEqual({ x: 100, y: 100 });
      expect(commit.size).toEqual({ width: 200, height: 300 });
      // Normalized to the box: first sample is the top-left corner (0,0); the
      // last is the bottom-right (1,1). RDP keeps the endpoints. Pressure rides
      // through unchanged.
      expect(commit.points.length).toBeGreaterThanOrEqual(2);
      const firstPt = commit.points[0];
      const lastPt = commit.points[commit.points.length - 1];
      if (!firstPt || !lastPt) throw new Error('normalized points missing');
      expect(firstPt[0]).toBeCloseTo(0, 5);
      expect(firstPt[1]).toBeCloseTo(0, 5);
      expect(lastPt[0]).toBeCloseTo(1, 5);
      expect(lastPt[1]).toBeCloseTo(1, 5);
      for (const p of commit.points) {
        expect(p[0]).toBeGreaterThanOrEqual(0);
        expect(p[0]).toBeLessThanOrEqual(1);
        expect(p[1]).toBeGreaterThanOrEqual(0);
        expect(p[1]).toBeLessThanOrEqual(1);
        expect(p[2]).toBeCloseTo(0.5, 5);
      }
    });

    it('pen mode: a tap (single point, no move) does not commit and stays armed', () => {
      const refs: { current: unknown }[] = [];
      const captured: unknown[] = [];
      const tree = callSeeflowCanvas(
        {
          canvasMode: { kind: 'pen' },
          onCreateFreehandNode: (...args: unknown[]) => captured.push(args),
        },
        { refSink: refs },
      );
      refAt(refs, REF.penMode).current = true;
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

      const paneTarget = { classList: { contains: (c: string) => c === 'react-flow__pane' } };
      const noop = () => {};
      const evt = {
        target: paneTarget,
        currentTarget: { setPointerCapture: noop, releasePointerCapture: noop },
        clientX: 100,
        clientY: 100,
        pointerId: 1,
        pressure: 0.5,
        button: 0,
        isPrimary: true,
        preventDefault: noop,
        stopPropagation: noop,
      };

      (wrapper.props.onPointerDown as (e: unknown) => void)(evt);
      (wrapper.props.onPointerUp as (e: unknown) => void)(evt);
      // < 2 raw points → no commit; pen stays armed (penMode ref untouched).
      expect(captured.length).toBe(0);
      expect(refAt(refs, REF.penDrawing).current).toBe(false);
      expect(refAt(refs, REF.penMode).current).toBe(true);
    });

    it('pen mode does not trigger the shape-create path', () => {
      const refs: { current: unknown }[] = [];
      const shapeCaptured: unknown[] = [];
      const tree = callSeeflowCanvas(
        {
          canvasMode: { kind: 'pen' },
          onCreateShapeNode: (...args: unknown[]) => shapeCaptured.push(args),
        },
        { refSink: refs },
      );
      refAt(refs, REF.penMode).current = true;
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

      const paneTarget = { classList: { contains: (c: string) => c === 'react-flow__pane' } };
      const noop = () => {};
      const at = (x: number, y: number) => ({
        target: paneTarget,
        currentTarget: { setPointerCapture: noop, releasePointerCapture: noop },
        clientX: x,
        clientY: y,
        pointerId: 1,
        pressure: 0.5,
        button: 0,
        isPrimary: true,
        preventDefault: noop,
        stopPropagation: noop,
      });

      (wrapper.props.onPointerDown as (e: unknown) => void)(at(50, 50));
      (wrapper.props.onPointerMove as (e: unknown) => void)(at(200, 200));
      (wrapper.props.onPointerUp as (e: unknown) => void)(at(200, 200));
      // The pen branch handles the gesture entirely; the shape-draw ref stays
      // null so onCreateShapeNode is never invoked.
      expect(shapeCaptured.length).toBe(0);
      expect(refAt(refs, REF.drawing).current).toBe(false);
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

  // Ghost preview honours the last-used node-style bucket — see
  // `docs/plans/2026-05-23-ghost-preview-last-used-style-design.md`. The
  // commit path overlays `getLastUsedStyle().node` via `buildNewShapeData`;
  // the ghost reads the same bucket directly at render time so the preview
  // shown during drag matches what gets committed on pointer-up.
  describe('ghost preview honours last-used node-style', () => {
    const STORAGE_KEY = 'seeflow:last-used-style:v1';
    const memStore = new Map<string, string>();
    const mockLocalStorage = {
      getItem: (k: string): string | null => memStore.get(k) ?? null,
      setItem: (k: string, v: string): void => {
        memStore.set(k, v);
      },
      removeItem: (k: string): void => {
        memStore.delete(k);
      },
    };
    const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

    beforeEach(() => {
      memStore.clear();
      (globalThis as { localStorage?: typeof mockLocalStorage }).localStorage = mockLocalStorage;
    });

    afterEach(() => {
      (globalThis as { localStorage?: unknown }).localStorage = originalLocalStorage;
    });

    function seedNodeLastUsed(node: Record<string, unknown>): void {
      memStore.set(STORAGE_KEY, JSON.stringify({ node, connector: {} }));
    }

    function getGhost(shape: string): ReactElementLike {
      const overrides: unknown[] = [];
      overrides[2] = { x: 100, y: 100 };
      overrides[3] = { x: 300, y: 240 };
      const tree = callSeeflowCanvas(
        // biome-ignore lint/suspicious/noExplicitAny: shape is narrowed at the call site
        { canvasMode: { kind: 'draw', shape: shape as any } },
        { useStateOverrides: overrides },
      );
      const ghost = findElement(
        tree,
        (el) =>
          isElement(el) &&
          (el.props as { 'data-testid'?: unknown })['data-testid'] === 'canvas-draw-ghost',
      );
      if (!ghost) throw new Error('canvas-draw-ghost not found in tree');
      return ghost;
    }

    it('rectangle ghost wrapper picks up borderColor / backgroundColor / borderSize / cornerRadius from last-used', () => {
      seedNodeLastUsed({
        borderColor: 'amber',
        backgroundColor: 'slate',
        borderSize: 4,
        cornerRadius: 12,
      });
      const ghost = getGhost('rectangle');
      const style = ghost.props.style as Record<string, unknown>;
      expect(style.borderColor).toBe(COLOR_TOKENS.amber.border);
      expect(style.backgroundColor).toBe(COLOR_TOKENS.slate.background);
      expect(style.borderWidth).toBe(4);
      expect(style.borderRadius).toBe(12);
    });

    it('ellipse ghost wrapper picks up borderColor / backgroundColor / borderSize from last-used (no cornerRadius — not applicable to ellipse)', () => {
      seedNodeLastUsed({
        borderColor: 'red',
        backgroundColor: 'blue',
        borderSize: 2,
        cornerRadius: 99, // dropped — ellipse renders no corner radius
      });
      const ghost = getGhost('ellipse');
      const style = ghost.props.style as Record<string, unknown>;
      expect(style.borderColor).toBe(COLOR_TOKENS.red.border);
      expect(style.backgroundColor).toBe(COLOR_TOKENS.blue.background);
      expect(style.borderWidth).toBe(2);
      expect(style.borderRadius).toBeUndefined();
    });

    it('illustrative (cloud) ghost SVG picks up borderColor / backgroundColor / borderSize / borderStyle from last-used', () => {
      seedNodeLastUsed({
        borderColor: 'violet',
        backgroundColor: 'amber',
        borderSize: 3,
        borderStyle: 'dashed',
      });
      const ghost = getGhost('cloud');
      const cloudShape = findElement(ghost, (el) => el.type === CloudShape);
      if (!cloudShape) throw new Error('CloudShape not found inside ghost');
      const props = cloudShape.props as Record<string, unknown>;
      expect(props.borderColor).toBe(COLOR_TOKENS.violet.border);
      expect(props.backgroundColor).toBe(COLOR_TOKENS.amber.background);
      expect(props.borderSize).toBe(3);
      expect(props.borderStyle).toBe('dashed');
    });

    it('empty last-used bucket reproduces the factory-default ghost (no regression)', () => {
      // No seedNodeLastUsed call — bucket is empty.
      const ghost = getGhost('rectangle');
      const style = ghost.props.style as Record<string, unknown>;
      expect(style.borderColor).toBe(COLOR_TOKENS.default.border);
      expect(style.backgroundColor).toBe(NODE_DEFAULT_BG_WHITE);
      expect(style.borderWidth).toBeUndefined();
      expect(style.borderRadius).toBeUndefined();
    });

    it('text ghost ignores last-used (text has no chrome — only the dashed outline)', () => {
      seedNodeLastUsed({
        borderColor: 'amber',
        backgroundColor: 'slate',
        borderSize: 4,
      });
      const ghost = getGhost('text');
      const style = ghost.props.style as Record<string, unknown>;
      // shapeChromeStyle('text', ...) returns {} regardless of data, so the
      // ghost wrapper exposes no border/background of its own — the dashed
      // outline is contributed by the className branch only.
      expect(style.borderColor).toBeUndefined();
      expect(style.backgroundColor).toBeUndefined();
      expect(style.borderWidth).toBeUndefined();
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
          { id: 'e1', source: 'a', target: 'b' },
          { id: 'e2', source: 'a', target: 'b' },
          { id: 'e3', source: 'a', target: 'b' },
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

  describe('US-007 + grouping M2/M3: multi-select / group overlay wiring', () => {
    // The overlay component itself decides presence via
    // `selectionEligibleForOverlay`; here we test the canvas-side wiring —
    // that the right `selectedNodes` payload reaches the overlay (with
    // optimistic overrides applied), `isGroupSelection` is threaded for
    // gating/icon state, and (M3) `onMultiResize` is forwarded so the corner
    // handles commit a proportional resize. The pointer-driven scaling itself
    // is exercised in selection-resize-overlay.test.tsx via the pure helpers.
    function makeSizedShape(
      id: string,
      pos: { x: number; y: number },
      dims: { width: number; height: number },
    ): FlowNode {
      return {
        id,
        type: 'rectangle',
        position: pos,
        data: { name: id, width: dims.width, height: dims.height },
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

    it('M3: forwards onMultiResize so a corner drag commits a proportional resize', () => {
      // M3 wires the host's batched resize handler through to the overlay. The
      // overlay calls it ONCE on pointer-up from the frozen baseline (design
      // §6.3); here we just assert the wiring — the same function reference the
      // host supplied reaches the overlay's `onMultiResize` prop.
      const onMultiResize = (_updates: MultiResizeUpdate[]) => {};
      const { overlay } = findOverlay({
        nodes: [
          makeSizedShape('a', { x: 0, y: 0 }, { width: 50, height: 50 }),
          makeSizedShape('b', { x: 100, y: 100 }, { width: 50, height: 50 }),
        ],
        selectedNodeIds: ['a', 'b'],
        onMultiResize,
      });
      if (!overlay) throw new Error('SelectionResizeOverlay not in SeeflowCanvas tree');
      expect(overlay.props.onMultiResize).toBe(onMultiResize);
    });

    it('threads isGroupSelection=false for a loose multi-selection', () => {
      const { overlay } = findOverlay({
        nodes: [
          makeSizedShape('a', { x: 0, y: 0 }, { width: 50, height: 50 }),
          makeSizedShape('b', { x: 100, y: 100 }, { width: 50, height: 50 }),
        ],
        selectedNodeIds: ['a', 'b'],
      });
      if (!overlay) throw new Error('SelectionResizeOverlay not in SeeflowCanvas tree');
      expect(overlay.props.isGroupSelection).toBe(false);
    });

    it('single group selection: threads isGroupSelection=true with members + group box, dims resolved (§12.1/§12.5)', () => {
      const group: FlowNode = {
        id: 'g1',
        type: 'group',
        position: { x: 0, y: 0 },
        data: { name: 'G', width: 400, height: 300, childIds: ['a', 'b'] },
      };
      const { overlay } = findOverlay({
        nodes: [
          group,
          makeSizedShape('a', { x: 10, y: 10 }, { width: 50, height: 50 }),
          makeSizedShape('b', { x: 100, y: 100 }, { width: 50, height: 50 }),
        ],
        selectedNodeIds: ['g1'],
      });
      if (!overlay) throw new Error('SelectionResizeOverlay not in SeeflowCanvas tree');
      expect(overlay.props.isGroupSelection).toBe(true);
      const selected = overlay.props.selectedNodes as ReadonlyArray<{
        id: string;
        type?: string;
        width?: number;
        height?: number;
      }>;
      // Members (a, b) + the group box (g1) flow through so the rect hugs the
      // members and M5 can scale them from this set.
      expect(selected.map((n) => n.id).sort()).toEqual(['a', 'b', 'g1']);
      const groupEntry = selected.find((n) => n.id === 'g1');
      expect(groupEntry?.type).toBe('group');
      // Resolved top-level dims are present (§12.1) — not just data.width.
      expect(groupEntry?.width).toBe(400);
      const memberA = selected.find((n) => n.id === 'a');
      expect(memberA?.width).toBe(50);
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

  describe('grouping M4: create/ungroup wiring (overlay icon, context menu, keyboard)', () => {
    function makeSizedShape(
      id: string,
      pos: { x: number; y: number },
      dims: { width: number; height: number },
    ): FlowNode {
      return {
        id,
        type: 'rectangle',
        position: pos,
        data: { name: id, width: dims.width, height: dims.height },
      };
    }
    const twoLoose: FlowNode[] = [
      makeSizedShape('a', { x: 0, y: 0 }, { width: 50, height: 50 }),
      makeSizedShape('b', { x: 100, y: 100 }, { width: 50, height: 50 }),
    ];
    const groupNode: FlowNode = {
      id: 'g1',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { name: 'G', width: 400, height: 300, childIds: ['a', 'b'] },
    };
    function overlayFor(props: LegacyOverrides) {
      const tree = callSeeflowCanvas(props);
      return findElement(tree, (el) => el.type === SelectionResizeOverlay);
    }

    it('binds onGroupAction to onCreateGroup(selectedIds) for a 2+ loose selection', () => {
      const createCalls: string[][] = [];
      const overlay = overlayFor({
        nodes: twoLoose,
        selectedNodeIds: ['a', 'b'],
        onCreateGroup: (ids) => {
          createCalls.push(ids);
        },
      });
      if (!overlay) throw new Error('overlay not found');
      const action = overlay.props.onGroupAction as (() => void) | undefined;
      expect(typeof action).toBe('function');
      action?.();
      expect(createCalls).toEqual([['a', 'b']]);
    });

    it('binds onGroupAction to onUngroup(groupId) for a single group selection', () => {
      const ungroupCalls: string[] = [];
      const overlay = overlayFor({
        nodes: [groupNode, ...twoLoose],
        selectedNodeIds: ['g1'],
        onUngroup: (id) => {
          ungroupCalls.push(id);
        },
      });
      if (!overlay) throw new Error('overlay not found');
      expect(overlay.props.isGroupSelection).toBe(true);
      const action = overlay.props.onGroupAction as (() => void) | undefined;
      action?.();
      expect(ungroupCalls).toEqual(['g1']);
    });

    it('onGroupAction is undefined when the matching host callback is absent', () => {
      // Loose 2-selection but no onCreateGroup wired → no dead affordance.
      const overlay = overlayFor({ nodes: twoLoose, selectedNodeIds: ['a', 'b'] });
      if (!overlay) throw new Error('overlay not found');
      expect(overlay.props.onGroupAction).toBeUndefined();
    });

    it('context menu shows the "Group" item for a 2+ loose selection when onCreateGroup is wired', () => {
      const tree = callSeeflowCanvas({
        nodes: twoLoose,
        selectedNodeIds: ['a', 'b'],
        onCreateGroup: () => {},
      });
      const item = findElement(
        tree,
        (el) =>
          (el.props as { 'data-testid'?: string })['data-testid'] === 'node-context-menu-group',
      );
      expect(item).not.toBeNull();
    });

    it('context menu hides "Group" for a single selection (planGroupShortcutAction → none)', () => {
      const tree = callSeeflowCanvas({
        nodes: twoLoose,
        selectedNodeIds: ['a'],
        onCreateGroup: () => {},
      });
      const item = findElement(
        tree,
        (el) =>
          (el.props as { 'data-testid'?: string })['data-testid'] === 'node-context-menu-group',
      );
      expect(item).toBeNull();
    });

    it('context menu shows "Ungroup" when a group node was right-clicked (contextNodeType=group)', () => {
      // useStateOverrides slots: 4=contextMenuPos, 5=contextOnNode, 6=contextNodeType.
      const tree = callSeeflowCanvas(
        {
          nodes: [groupNode, ...twoLoose],
          selectedNodeIds: ['g1'],
          onUngroup: () => {},
        },
        {
          useStateOverrides: [
            undefined, // 0 connecting
            undefined, // 1 dropPopover
            undefined, // 2 drawStart
            undefined, // 3 drawCurrent
            { x: 10, y: 10 }, // 4 contextMenuPos
            true, // 5 contextOnNode
            'group', // 6 contextNodeType
          ],
        },
      );
      const item = findElement(
        tree,
        (el) =>
          (el.props as { 'data-testid'?: string })['data-testid'] === 'node-context-menu-ungroup',
      );
      expect(item).not.toBeNull();
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

  describe('US-014: component-node flowId + apiBaseUrl injection', () => {
    const COMPONENT_SPEC: ComponentSpec = {
      root: 'root',
      elements: {
        root: { type: 'Card', children: ['t'] },
        t: { type: 'Text', props: { text: 'hi' } },
      },
    };

    function makeComponentNode(id: string): FlowNode {
      return {
        id,
        type: 'component',
        position: { x: 0, y: 0 },
        data: { spec: COMPONENT_SPEC },
      };
    }

    function findRfNode(tree: unknown, id: string): Node | undefined {
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found');
      return (rf.props.nodes as Node[]).find((n) => n.id === id);
    }

    it('injects data.projectSlug === projectId and data.flowSlug === flowSlug for component nodes', () => {
      const tree = callSeeflowCanvas({
        projectId: 'demo-42',
        flowSlug: 'main',
        nodes: [makeComponentNode('c1')],
      });
      const data = findRfNode(tree, 'c1')?.data as {
        projectSlug?: string;
        flowSlug?: string;
      };
      expect(data.projectSlug).toBe('demo-42');
      expect(data.flowSlug).toBe('main');
    });

    it("defaults data.apiBaseUrl to '/api' when the prop is omitted", () => {
      const tree = callSeeflowCanvas({
        projectId: 'demo-42',
        nodes: [makeComponentNode('c1')],
      });
      const data = findRfNode(tree, 'c1')?.data as { apiBaseUrl?: string };
      expect(data.apiBaseUrl).toBe('/api');
    });

    it('threads the apiBaseUrl prop override into component node data', () => {
      const tree = callSeeflowCanvas({
        projectId: 'demo-42',
        apiBaseUrl: 'https://embedder.example/api',
        nodes: [makeComponentNode('c1')],
      });
      const data = findRfNode(tree, 'c1')?.data as { apiBaseUrl?: string };
      expect(data.apiBaseUrl).toBe('https://embedder.example/api');
    });

    it('omits projectSlug + flowSlug + apiBaseUrl on non-component nodes (gated by type)', () => {
      const tree = callSeeflowCanvas({
        projectId: 'demo-42',
        flowSlug: 'main',
        apiBaseUrl: '/custom',
        nodes: [makeShapeNode('a')],
      });
      const data = findRfNode(tree, 'a')?.data as {
        projectSlug?: string;
        flowSlug?: string;
        apiBaseUrl?: string;
      };
      expect(data.projectSlug).toBeUndefined();
      expect(data.flowSlug).toBeUndefined();
      expect(data.apiBaseUrl).toBeUndefined();
    });

    it('sets data.enableFullscreen = true for component nodes in edit + view modes', () => {
      for (const mode of ['edit', 'view'] as const) {
        const tree = callSeeflowCanvas({ mode, nodes: [makeComponentNode('c1')] });
        const data = findRfNode(tree, 'c1')?.data as { enableFullscreen?: boolean };
        expect(data.enableFullscreen).toBe(true);
      }
    });

    it('sets data.enableFullscreen = false for component nodes in mini mode', () => {
      const tree = callSeeflowCanvas({ mode: 'mini', nodes: [makeComponentNode('c1')] });
      const data = findRfNode(tree, 'c1')?.data as { enableFullscreen?: boolean };
      expect(data.enableFullscreen).toBe(false);
    });

    it('omits enableFullscreen on non-component nodes (gated by type)', () => {
      const tree = callSeeflowCanvas({ nodes: [makeShapeNode('a')] });
      const data = findRfNode(tree, 'a')?.data as { enableFullscreen?: boolean };
      expect(data.enableFullscreen).toBeUndefined();
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
     * payload), so this fixture exercises the type:'html' branch alone.
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
      // preventDefault (it always does when wired), but the type:'html'-create
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

    it('onDrop is a complete no-op when neither image nor type:html handlers are wired', () => {
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

    it('node.data.onIconChange is defined for linkflow nodes in edit mode (and undefined for text)', () => {
      // The linkflow node renders a NodeHeader with an editable icon, so the
      // canvas must thread onIconChange into its runtime data — same gate as
      // rectangle/component. type:'text' has no header icon affordance, so it
      // stays undefined.
      const tree = callSeeflowCanvas({
        nodes: [
          {
            id: 'lf',
            type: 'linkflow',
            position: { x: 0, y: 0 },
            data: { name: 'lf' },
          } as unknown as FlowNode,
          makeTextNode('t'),
        ],
        onIconChange: () => {},
      });
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      const rfNodes = rf.props.nodes as Node[];
      const lf = rfNodes.find((n) => n.id === 'lf');
      const t = rfNodes.find((n) => n.id === 't');
      expect((lf?.data as { onIconChange?: unknown }).onIconChange).toBeDefined();
      expect((t?.data as { onIconChange?: unknown }).onIconChange).toBeUndefined();
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
    // Sidebar visibility is decoupled from selection: SeeflowCanvas internalizes
    // <DetailPanel> but mounts it ONLY when the new `sidebarOpen` state is true
    // (driven by the top-right InspectorToggle). When mounted, its target is
    // the sole selected node; multi-select / connector-only / empty selection
    // resolve to a null node so the panel renders its empty-state placeholder.
    // The hook-shim tree captures <DetailPanel ...> as a placeholder element
    // (its body isn't executed) so we can assert its forwarded props directly.
    //
    // The new sidebar-open state lives at useStateOverrides[13] (slot 14 per
    // packages/canvas/CLAUDE.md). Tests below force it to `true` to exercise
    // the mounted-panel path.
    const sidebarOpenOverrides: unknown[] = [];
    sidebarOpenOverrides[13] = true;

    function findDetailPanel(tree: unknown) {
      return findElement(tree, (el) => el.type === DetailPanel);
    }

    it('DetailPanel mounts with open=false by default so Radix can play the exit animation', () => {
      // The panel is kept in the tree while `sidebarEnabled` is true; the
      // Radix Sheet's `open` prop (driven by sidebarOpen) toggles
      // data-state and triggers the slide-in / slide-out animation. If we
      // unmounted on close instead, Radix would never get to run
      // `data-[state=closed]:animate-out` before the DOM disappears.
      const tree = callSeeflowCanvas({ nodes: [makeShapeNode('a')] });
      const panel = findDetailPanel(tree);
      expect(panel).not.toBeNull();
      expect((panel?.props as { open?: boolean }).open).toBe(false);
    });

    it('passes the sole selected node into DetailPanel.node when the sidebar is open', () => {
      const a = makeShapeNode('a');
      const b = makeShapeNode('b');
      const tree = callSeeflowCanvas(
        { nodes: [a, b], selectedNodeIds: ['a'] },
        { useStateOverrides: sidebarOpenOverrides },
      );
      const panel = findDetailPanel(tree);
      expect(panel).not.toBeNull();
      expect((panel?.props as { node?: FlowNode }).node).toBe(a);
      expect((panel?.props as { connector?: Connector | null }).connector).toBeNull();
    });

    it('passes null when multiple nodes are selected', () => {
      const a = makeShapeNode('a');
      const b = makeShapeNode('b');
      const tree = callSeeflowCanvas(
        { nodes: [a, b], selectedNodeIds: ['a', 'b'] },
        { useStateOverrides: sidebarOpenOverrides },
      );
      const panel = findDetailPanel(tree);
      expect((panel?.props as { node?: FlowNode | null }).node).toBeNull();
      expect((panel?.props as { connector?: Connector | null }).connector).toBeNull();
    });

    it('passes null when a node and a connector are both selected', () => {
      const conn: Connector = {
        id: 'c1',
        source: 'a',
        target: 'b',
        sourceHandleAutoPicked: true,
        targetHandleAutoPicked: true,
      } as Connector;
      const tree = callSeeflowCanvas(
        {
          nodes: [makeShapeNode('a'), makeShapeNode('b')],
          connectors: [conn],
          selectedNodeIds: ['a'],
          selectedConnectorIds: ['c1'],
        },
        { useStateOverrides: sidebarOpenOverrides },
      );
      const panel = findDetailPanel(tree);
      expect((panel?.props as { node?: FlowNode | null }).node).toBeNull();
      expect((panel?.props as { connector?: Connector | null }).connector).toBeNull();
    });

    it('never forwards a connector — DetailPanel.connector is always null even when one is selected', () => {
      // Connectors no longer feed the DetailPanel — selecting one and opening
      // the sidebar surfaces the empty state, never a connector inspector.
      const conn: Connector = {
        id: 'c1',
        source: 'a',
        target: 'b',
        sourceHandleAutoPicked: true,
        targetHandleAutoPicked: true,
      } as Connector;
      const tree = callSeeflowCanvas(
        {
          nodes: [makeShapeNode('a'), makeShapeNode('b')],
          connectors: [conn],
          selectedConnectorIds: ['c1'],
        },
        { useStateOverrides: sidebarOpenOverrides },
      );
      const panel = findDetailPanel(tree);
      expect(panel).not.toBeNull();
      expect((panel?.props as { connector?: Connector | null }).connector).toBeNull();
      expect((panel?.props as { node?: FlowNode | null }).node).toBeNull();
    });

    it('panel.node and panel.connector are null when nothing is selected', () => {
      const tree = callSeeflowCanvas(
        { nodes: [makeShapeNode('a')] },
        { useStateOverrides: sidebarOpenOverrides },
      );
      const panel = findDetailPanel(tree);
      expect((panel?.props as { node?: FlowNode | null }).node).toBeNull();
      expect((panel?.props as { connector?: Connector | null }).connector).toBeNull();
    });

    it('forwards adapter, statusReport, flowId, and field-edit callbacks', () => {
      const onNameChange = () => {};
      const onDescriptionChange = () => {};
      const onDetailChange = () => {};
      const statusReport = { state: 'ok' as const, summary: 's', ts: 7 };
      const tree = callSeeflowCanvas(
        {
          projectId: 'proj-123',
          nodes: [makeShapeNode('a')],
          selectedNodeIds: ['a'],
          statusReport,
          onNameChange,
          onDescriptionChange,
          onDetailChange,
        },
        { useStateOverrides: sidebarOpenOverrides },
      );
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
      const tree = callSeeflowCanvas(
        {
          nodes: [makeShapeNode('a')],
          selectedNodeIds: ['a'],
          disableSidebar: true,
        },
        { useStateOverrides: sidebarOpenOverrides },
      );
      expect(findDetailPanel(tree)).toBeNull();
    });

    it("mode='view' suppresses the DetailPanel via flags.showDetailPanel=false", () => {
      const tree = callSeeflowCanvas(
        {
          mode: 'view',
          adapter: undefined,
          nodes: [makeShapeNode('a')],
          selectedNodeIds: ['a'],
        },
        { useStateOverrides: sidebarOpenOverrides },
      );
      expect(findDetailPanel(tree)).toBeNull();
    });

    it('showDetailPanel={true} override surfaces the panel even in view mode', () => {
      // The CanvasFeatureOverrides escape hatch — a view-mode embedder that
      // still wants the built-in sidebar can lift the gate without flipping
      // the mode (would also opt back into adapter-driven mutations).
      const tree = callSeeflowCanvas(
        {
          mode: 'view',
          adapter: undefined,
          nodes: [makeShapeNode('a')],
          selectedNodeIds: ['a'],
          showDetailPanel: true,
        },
        { useStateOverrides: sidebarOpenOverrides },
      );
      expect(findDetailPanel(tree)).not.toBeNull();
    });

    it('onClose clears the selection via onSelectionChange([], [])', () => {
      // The Sheet's X button / Radix-driven dismissal still routes through
      // onClose; the unmount path (toggle off) is exercised separately below.
      const calls: Array<[string[], string[]]> = [];
      const tree = callSeeflowCanvas(
        {
          nodes: [makeShapeNode('a')],
          selectedNodeIds: ['a'],
          onSelectionChange: (nodeIds, connectorIds) => {
            calls.push([nodeIds, connectorIds]);
          },
        },
        { useStateOverrides: sidebarOpenOverrides },
      );
      const panel = findDetailPanel(tree);
      const onClose = (panel?.props as { onClose?: () => void }).onClose;
      expect(typeof onClose).toBe('function');
      onClose?.();
      expect(calls).toEqual([[[], []]]);
    });
  });

  describe('US-decouple-sidebar: InspectorToggle + sidebar-open gating', () => {
    // The new top-right toggle owns the sidebar's mount state, decoupling it
    // from selection. Node clicks DON'T open the panel; the toggle does; the
    // empty-pane handler closes it; connector selection never opens it on its
    // own. The InspectorToggle lives in the same flex row as ShareMenu, to its
    // LEFT, and is gated on the same `flags.showDetailPanel && !disableSidebar`
    // pair that gates the panel itself.
    const sidebarOpenOverrides: unknown[] = [];
    sidebarOpenOverrides[13] = true;

    function findDetailPanel(tree: unknown) {
      return findElement(tree, (el) => el.type === DetailPanel);
    }
    function findInspectorToggle(tree: unknown) {
      return findElement(tree, (el) => el.type === InspectorToggle);
    }
    it('selecting a node leaves DetailPanel.open=false by default', () => {
      // The PRD's headline behavior: clicking (=selecting) a node does NOT
      // open the sidebar — the user must explicitly hit the toggle. The
      // panel stays mounted with open=false so its slide-out animation can
      // run when the user later closes it.
      const tree = callSeeflowCanvas({
        nodes: [makeShapeNode('a')],
        selectedNodeIds: ['a'],
      });
      const panel = findDetailPanel(tree);
      expect(panel).not.toBeNull();
      expect((panel?.props as { open?: boolean }).open).toBe(false);
    });

    it('clicking the inspector toggle drives DetailPanel.open=true with the selected node', () => {
      // With the toggle "open" (sidebarOpen=true via the slot-13 override) and a
      // node selected, DetailPanel receives open=true so the Sheet slides in,
      // and `node` is the selected one.
      const a = makeShapeNode('a');
      const tree = callSeeflowCanvas(
        { nodes: [a], selectedNodeIds: ['a'] },
        { useStateOverrides: sidebarOpenOverrides },
      );
      const panel = findDetailPanel(tree);
      expect(panel).not.toBeNull();
      expect((panel?.props as { open?: boolean }).open).toBe(true);
      expect((panel?.props as { node?: FlowNode | null }).node).toBe(a);
    });

    it('clicking onPaneClick leaves the sidebar open (no setSidebarOpen call)', () => {
      // The empty-pane click handler forwards to the host `onPaneClick` but
      // must NOT touch sidebarOpen — once the user opens the inspector via
      // the toggle, clicking around the empty canvas must not yank the panel
      // away. Closing the panel is only allowed via the toggle button or the
      // panel's own close affordance.
      let paneClicks = 0;
      const setterCalls: CapturedSetterCall[] = [];
      const tree = callSeeflowCanvas(
        {
          nodes: [makeShapeNode('a')],
          selectedNodeIds: ['a'],
          onPaneClick: () => {
            paneClicks++;
          },
        },
        { useStateOverrides: sidebarOpenOverrides, setterSink: setterCalls },
      );
      const rf = findElement(tree, (el) => el.type === ReactFlow);
      if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
      const handler = rf.props.onPaneClick as ((e: unknown) => void) | undefined;
      expect(typeof handler).toBe('function');
      // Drain any setter calls fired during render itself (effects don't run
      // in the shim) so the handler-driven assertion below is clean.
      setterCalls.length = 0;
      handler?.({} as unknown);
      expect(paneClicks).toBe(1);
      // The handler MUST NOT call setSidebarOpen on slot 13.
      const slot13Calls = setterCalls.filter((c) => c.slot === 13);
      expect(slot13Calls).toEqual([]);
    });

    it('connector-only selection leaves DetailPanel.open=false', () => {
      // Selecting a connector does NOT open the sidebar (toggle is the sole
      // open path). The PRD's "Connectors never trigger the sidebar" rule.
      const conn: Connector = {
        id: 'c1',
        source: 'a',
        target: 'b',
        sourceHandleAutoPicked: true,
        targetHandleAutoPicked: true,
      } as Connector;
      const tree = callSeeflowCanvas({
        nodes: [makeShapeNode('a'), makeShapeNode('b')],
        connectors: [conn],
        selectedConnectorIds: ['c1'],
      });
      const panel = findDetailPanel(tree);
      expect(panel).not.toBeNull();
      expect((panel?.props as { open?: boolean }).open).toBe(false);
    });

    it('mounts the InspectorToggle in the top-right chrome row in edit mode', () => {
      const tree = callSeeflowCanvas({ nodes: [makeShapeNode('a')] });
      const toggle = findInspectorToggle(tree);
      expect(toggle).not.toBeNull();
      // The mounted toggle is passed a boolean `open` and a function `onToggle`.
      const props = toggle?.props as { open?: unknown; onToggle?: unknown };
      expect(typeof props.open).toBe('boolean');
      expect(typeof props.onToggle).toBe('function');
    });

    it('disableSidebar={true} hides the InspectorToggle (same gate as panel)', () => {
      const tree = callSeeflowCanvas({
        nodes: [makeShapeNode('a')],
        disableSidebar: true,
      });
      expect(findInspectorToggle(tree)).toBeNull();
    });

    it("mode='view' hides the InspectorToggle (flags.showDetailPanel=false)", () => {
      const tree = callSeeflowCanvas({
        mode: 'view',
        adapter: undefined,
        nodes: [makeShapeNode('a')],
      });
      expect(findInspectorToggle(tree)).toBeNull();
    });

    it('InspectorToggle is mounted only while sidebar is closed', () => {
      // Closed by default — toggle mounts so the user can open the panel.
      const closedTree = callSeeflowCanvas({ nodes: [makeShapeNode('a')] });
      const closedToggle = findInspectorToggle(closedTree);
      expect((closedToggle?.props as { open?: boolean }).open).toBe(false);
      // Pinned open via slot-13 — the in-sidebar close button owns the close
      // affordance, so the top-right toggle unmounts to avoid a duplicate icon.
      const openTree = callSeeflowCanvas(
        { nodes: [makeShapeNode('a')] },
        { useStateOverrides: sidebarOpenOverrides },
      );
      expect(findInspectorToggle(openTree)).toBeNull();
    });

    it('InspectorToggle sits to the LEFT of ShareMenu in the shared flex row', () => {
      // The top-right Panel hosts a `<div class="sf:flex sf:items-center sf:gap-1">`
      // with [topRightSlot, InspectorToggle, ShareMenu] in that order. We
      // verify InspectorToggle's index is below ShareMenu's in that flat list.
      const tree = callSeeflowCanvas({ nodes: [makeShapeNode('a')] });
      // Find the row's children array — the parent div that contains both.
      const row = findElement(tree, (el) => {
        if (!isElement(el)) return false;
        const className = (el.props as { className?: unknown }).className;
        return typeof className === 'string' && className.includes('sf:flex sf:items-center');
      });
      if (!row) throw new Error('top-right flex row not found in SeeflowCanvas tree');
      const children = Array.isArray(row.props.children)
        ? (row.props.children as ReactElementLike[])
        : ([row.props.children].filter(Boolean) as ReactElementLike[]);
      const toggleIdx = children.findIndex((c) => isElement(c) && c.type === InspectorToggle);
      const shareIdx = children.findIndex((c) => isElement(c) && c.type === ShareMenu);
      expect(toggleIdx).toBeGreaterThanOrEqual(0);
      expect(shareIdx).toBeGreaterThanOrEqual(0);
      expect(toggleIdx).toBeLessThan(shareIdx);
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
      showMiniMap: true,
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
      // US-004: alignment guides default ON in edit mode.
      enableAlignmentGuides: true,
      // No preset for the snap threshold — passes through undefined.
      alignmentSnapThreshold: undefined,
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
      showMiniMap: true,
      enableKeyboard: false,
      enableContextMenu: false,
      enableDragDrop: false,
      enableImageDrop: false,
      enableZoom: true,
      enablePan: true,
      enableSelection: true,
      enableNodeMove: true,
      enableEmbed: false,
      // US-004: view mode is read-only — alignment guides off.
      enableAlignmentGuides: false,
      alignmentSnapThreshold: undefined,
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
      // Mini IS the thumbnail — the high-level outline is suppressed so the
      // canvas doesn't nest a minimap inside itself.
      showMiniMap: false,
      enableKeyboard: false,
      enableContextMenu: false,
      enableDragDrop: false,
      enableImageDrop: false,
      enableZoom: false,
      enablePan: false,
      enableSelection: false,
      enableNodeMove: false,
      enableEmbed: false,
      // US-004: mini thumbnails are static — alignment guides off.
      enableAlignmentGuides: false,
      alignmentSnapThreshold: undefined,
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

  it('defaults showMiniMap ON for edit + view, OFF for mini, and accepts overrides', () => {
    // The high-level outline box is a navigation aid for full / read-only
    // canvases. Mini mode IS the thumbnail, so the default is OFF there to
    // avoid nesting a minimap inside another minimap.
    expect(resolveFlags({ mode: 'edit' }).showMiniMap).toBe(true);
    expect(resolveFlags({ mode: 'view' }).showMiniMap).toBe(true);
    expect(resolveFlags({ mode: 'mini' }).showMiniMap).toBe(false);
    // Overrides compose on top of the mode preset in either direction.
    expect(resolveFlags({ mode: 'edit', showMiniMap: false }).showMiniMap).toBe(false);
    expect(resolveFlags({ mode: 'view', showMiniMap: false }).showMiniMap).toBe(false);
    expect(resolveFlags({ mode: 'mini', showMiniMap: true }).showMiniMap).toBe(true);
  });
});

describe('US-014: imperative handle + ShareMenu wiring', () => {
  // Locate the top-right Panel + the ShareMenu inside it. The Panel is a
  // structural marker; `position="top-right"` is what distinguishes the
  // share Panel from the existing top-left toolbar/style Panel.
  function findShareMenu(tree: unknown): ReactElementLike | null {
    return findElement(tree, (el) => el.type === (ShareMenu as unknown));
  }

  it('exposes exportPdf, exportPng, openEmbedDialog, capturePreview, pasteImageFromClipboard on the ref handle after mount', () => {
    const handle: { current: SeeflowCanvasHandle | null } = { current: null };
    callSeeflowCanvas({}, { ref: handle });
    expect(handle.current).not.toBeNull();
    expect(typeof handle.current?.exportPdf).toBe('function');
    expect(typeof handle.current?.exportPng).toBe('function');
    expect(typeof handle.current?.openEmbedDialog).toBe('function');
    expect(typeof handle.current?.capturePreview).toBe('function');
    expect(typeof handle.current?.pasteImageFromClipboard).toBe('function');
    // No-op path: jsdom has no real rfInstance/wrapper, so calling it without
    // a DataTransfer-backed image must not throw.
    expect(() => handle.current?.pasteImageFromClipboard({} as DataTransfer)).not.toThrow();
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

  it('renders the MiniMap in edit and view modes, suppresses it in mini', () => {
    // The MiniMap is React Flow's outline / high-level box. It's a navigation
    // aid for full / read-only canvases; mini mode IS the thumbnail so we
    // gate it off there. Override `showMiniMap` flips this in either
    // direction.
    const editTree = callSeeflowCanvas({ mode: 'edit', adapter: noopAdapter });
    expect(findElement(editTree, (el) => el.type === MiniMap)).not.toBeNull();

    const viewTree = callSeeflowCanvas({ mode: 'view' });
    expect(findElement(viewTree, (el) => el.type === MiniMap)).not.toBeNull();

    const miniTree = callSeeflowCanvas({ mode: 'mini' });
    expect(findElement(miniTree, (el) => el.type === MiniMap)).toBeNull();

    // Mini consumer can opt back in, and edit consumer can opt out.
    const miniOverride = callSeeflowCanvas({ mode: 'mini', showMiniMap: true });
    expect(findElement(miniOverride, (el) => el.type === MiniMap)).not.toBeNull();

    const editOverride = callSeeflowCanvas({
      mode: 'edit',
      adapter: noopAdapter,
      showMiniMap: false,
    });
    expect(findElement(editOverride, (el) => el.type === MiniMap)).toBeNull();
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

  it('forwards onShareWithMembers into ShareMenu in view mode', () => {
    const onShareWithMembers = () => {};
    const tree = callSeeflowCanvas({
      mode: 'view',
      onShareWithMembers,
    });
    const menu = findShareMenu(tree);
    expect(menu).not.toBeNull();
    expect(menu?.props.onShareWithMembers).toBe(onShareWithMembers);
  });
});

describe('US-004: flat node types — fixture coverage across the 12-tag set', () => {
  // AC: "cover at least rectangle (with playAction + statusAction), one
  // other geometric tag, image, html, and icon". Each fixture below renders
  // through SeeflowCanvas and asserts the React Flow node payload carries the
  // expected `type` discriminator. This guards the nodeTypes routing —
  // rectangle → RectangleNode; the 8 other geometric tags → GeometricNode;
  // image/html/icon → their dedicated renderers — against silent regressions.
  function getRfNodes(
    nodes: FlowNode[],
  ): Array<{ id: string; type: string | undefined; data: Record<string, unknown> }> {
    const tree = callSeeflowCanvas({ nodes });
    const rf = findElement(tree, (el) => el.type === ReactFlow);
    if (!rf) throw new Error('ReactFlow element not found');
    return rf.props.nodes as Array<{
      id: string;
      type: string | undefined;
      data: Record<string, unknown>;
    }>;
  }

  it('renders a rectangle node carrying both playAction and statusAction capabilities', () => {
    // Capabilities are independent optional fields on data — the canvas only
    // threads them into the renderer payload (which decides whether to draw
    // the play button / status pill). Asserting both pass through unchanged
    // pins the new "capability is a field" contract end-to-end.
    const node: FlowNode = {
      id: 'r1',
      type: 'rectangle',
      position: { x: 0, y: 0 },
      data: {
        name: 'API call',
        playAction: {
          kind: 'script',
          interpreter: 'bash',
          scriptPath: 'scripts/play.sh',
        },
        statusAction: {
          kind: 'script',
          interpreter: 'bash',
          scriptPath: 'scripts/status.sh',
        },
      },
    };
    const rfNodes = getRfNodes([node]);
    expect(rfNodes).toHaveLength(1);
    expect(rfNodes[0]?.type).toBe('rectangle');
    expect(rfNodes[0]?.data.playAction).toEqual({
      kind: 'script',
      interpreter: 'bash',
      scriptPath: 'scripts/play.sh',
    });
    expect(rfNodes[0]?.data.statusAction).toEqual({
      kind: 'script',
      interpreter: 'bash',
      scriptPath: 'scripts/status.sh',
    });
  });

  it('renders a database (non-rectangle geometric) node with the discriminator preserved', () => {
    const node: FlowNode = {
      id: 'db1',
      type: 'database',
      position: { x: 10, y: 20 },
      data: { name: 'users' },
    };
    const rfNodes = getRfNodes([node]);
    expect(rfNodes[0]?.type).toBe('database');
  });

  it('renders a type:image node with path/alt threaded into the runtime data', () => {
    const node: FlowNode = {
      id: 'img1',
      type: 'image',
      position: { x: 0, y: 0 },
      data: { path: 'images/diagram.png', alt: 'flow diagram' },
    };
    const rfNodes = getRfNodes([node]);
    expect(rfNodes[0]?.type).toBe('image');
    expect(rfNodes[0]?.data.path).toBe('images/diagram.png');
    expect(rfNodes[0]?.data.alt).toBe('flow diagram');
  });

  it('renders a type:html node with html content threaded into the runtime data', () => {
    const node: FlowNode = {
      id: 'h1',
      type: 'html',
      position: { x: 0, y: 0 },
      data: { html: '<div>hello</div>' },
    };
    const rfNodes = getRfNodes([node]);
    expect(rfNodes[0]?.type).toBe('html');
    expect(rfNodes[0]?.data.html).toBe('<div>hello</div>');
  });

  it('renders a type:icon node with the icon name threaded into the runtime data', () => {
    const node: FlowNode = {
      id: 'i1',
      type: 'icon',
      position: { x: 0, y: 0 },
      data: { icon: 'server' },
    };
    const rfNodes = getRfNodes([node]);
    expect(rfNodes[0]?.type).toBe('icon');
    expect(rfNodes[0]?.data.icon).toBe('server');
  });
});

describe('US-004: alignment guides drag wiring', () => {
  // The alignment hook batches guide commits through requestAnimationFrame,
  // which bun does not provide. interceptChanges schedules that commit BEFORE
  // it rewrites the change, so the call would throw without a RAF stub. We
  // stub a no-op queue (the snap math runs synchronously and doesn't depend on
  // a flush — only the guide-state commit does, which this test doesn't assert).
  let savedRaf: typeof globalThis.requestAnimationFrame;
  let savedCaf: typeof globalThis.cancelAnimationFrame;
  beforeEach(() => {
    savedRaf = globalThis.requestAnimationFrame;
    savedCaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((_cb: FrameRequestCallback) =>
      1) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame;
  });
  afterEach(() => {
    globalThis.requestAnimationFrame = savedRaf;
    globalThis.cancelAnimationFrame = savedCaf;
  });

  it('snaps a dragged node into edge alignment within the threshold and commits the snapped position', () => {
    // Two nodes at the same x (left edges aligned at 0). 'a' is the static
    // reference; 'b' is dragged to x=4 — 4 world px from 'a''s left edge, well
    // within the 6px threshold (zoom falls back to 1 with no rfInstance). The
    // edge-pass picks the closest X anchor (centers win the tie) and snaps the
    // dragged node back to x=0; the snapped position is what onNodesChange
    // commits into the local rfNodes state (slot 8).
    const refNode: FlowNode = {
      id: 'a',
      type: 'rectangle',
      position: { x: 0, y: 0 },
      data: { name: 'a', width: 80, height: 40 },
    };
    const draggedNode: FlowNode = {
      id: 'b',
      type: 'rectangle',
      position: { x: 0, y: 100 },
      data: { name: 'b', width: 80, height: 40 },
    };
    const setterSink: CapturedSetterCall[] = [];
    const tree = callSeeflowCanvas(
      {
        mode: 'edit',
        nodes: [refNode, draggedNode],
        selectedNodeIds: [],
        onNodePositionChange: () => {},
      },
      { setterSink },
    );
    const rf = findElement(tree, (el) => el.type === ReactFlow);
    if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
    const onNodeDragStart = rf.props.onNodeDragStart as (
      e: { metaKey?: boolean; ctrlKey?: boolean },
      node: Node,
      nodes: Node[],
    ) => void;
    const onNodesChange = rf.props.onNodesChange as (changes: unknown[]) => void;

    // Begin the gesture so the hook freezes its reference snapshot of 'a'.
    const draggedRf = { id: 'b', position: { x: 0, y: 100 } } as unknown as Node;
    onNodeDragStart({ metaKey: false, ctrlKey: false }, draggedRf, [draggedRf]);

    // One drag frame landing 4px off alignment.
    onNodesChange([{ type: 'position', id: 'b', position: { x: 4, y: 100 }, dragging: true }]);

    const commit = setterSink.filter((s) => s.slot === 8).at(-1);
    if (!commit) throw new Error('expected an rfNodes commit (slot 8) after the drag frame');
    const committed = commit.next as Node[];
    const moved = committed.find((n) => n.id === 'b');
    if (!moved) throw new Error('dragged node missing from committed rfNodes');
    expect(moved.position.x).toBe(0);
    // The Y axis had no aligned neighbor, so it stays put.
    expect(moved.position.y).toBe(100);
  });

  it('Cmd/Ctrl held during the drag suppresses the snap (raw position forwarded)', () => {
    const refNode: FlowNode = {
      id: 'a',
      type: 'rectangle',
      position: { x: 0, y: 0 },
      data: { name: 'a', width: 80, height: 40 },
    };
    const draggedNode: FlowNode = {
      id: 'b',
      type: 'rectangle',
      position: { x: 0, y: 100 },
      data: { name: 'b', width: 80, height: 40 },
    };
    const setterSink: CapturedSetterCall[] = [];
    const tree = callSeeflowCanvas(
      { mode: 'edit', nodes: [refNode, draggedNode], selectedNodeIds: [] },
      { setterSink },
    );
    const rf = findElement(tree, (el) => el.type === ReactFlow);
    if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
    const onNodeDragStart = rf.props.onNodeDragStart as (
      e: { metaKey?: boolean; ctrlKey?: boolean },
      node: Node,
      nodes: Node[],
    ) => void;
    const onNodesChange = rf.props.onNodesChange as (changes: unknown[]) => void;

    // Begin the gesture with the modifier held — interceptChanges must forward
    // the raw position untouched.
    const draggedRf = { id: 'b', position: { x: 0, y: 100 } } as unknown as Node;
    onNodeDragStart({ metaKey: true, ctrlKey: false }, draggedRf, [draggedRf]);
    onNodesChange([{ type: 'position', id: 'b', position: { x: 4, y: 100 }, dragging: true }]);

    const commit = setterSink.filter((s) => s.slot === 8).at(-1);
    if (!commit) throw new Error('expected an rfNodes commit (slot 8) after the drag frame');
    const committed = commit.next as Node[];
    const moved = committed.find((n) => n.id === 'b');
    if (!moved) throw new Error('dragged node missing from committed rfNodes');
    // No snap — the raw 4px offset stands.
    expect(moved.position.x).toBe(4);
  });

  it('commits the SNAPPED position on drag stop, not the raw xyflow dragItem position', () => {
    // Regression: the rendered node snaps to the guide during the drag, but
    // xyflow's onNodeDragStop payload carries the *raw* (unsnapped)
    // `dragItem.position` — see @xyflow/system `getEventHandlerParams`, which
    // spreads the store node then overrides `position: dragItem.position`.
    // commitDraggedNodes must persist what was rendered (the snapped rfNodes
    // position); otherwise the adapter echo yanks the node back off the guide
    // by the snap delta (~1px when dropped near-aligned) the instant the mouse
    // is released.
    const refNode: FlowNode = {
      id: 'a',
      type: 'rectangle',
      position: { x: 0, y: 0 },
      data: { name: 'a', width: 80, height: 40 },
    };
    const draggedNode: FlowNode = {
      id: 'b',
      type: 'rectangle',
      position: { x: 0, y: 100 },
      data: { name: 'b', width: 80, height: 40 },
    };
    const positionCommits: Array<{ id: string; position: { x: number; y: number } }> = [];
    const tree = callSeeflowCanvas({
      mode: 'edit',
      nodes: [refNode, draggedNode],
      selectedNodeIds: [],
      onNodePositionChange: (id, position) => positionCommits.push({ id, position }),
    });
    const rf = findElement(tree, (el) => el.type === ReactFlow);
    if (!rf) throw new Error('ReactFlow element not found in SeeflowCanvas tree');
    const onNodeDragStart = rf.props.onNodeDragStart as (
      e: { metaKey?: boolean; ctrlKey?: boolean },
      node: Node,
      nodes: Node[],
    ) => void;
    const onNodesChange = rf.props.onNodesChange as (changes: unknown[]) => void;
    const onNodeDragStop = rf.props.onNodeDragStop as (
      e: unknown,
      node: Node,
      nodes: Node[],
    ) => void;

    const draggedRf = { id: 'b', position: { x: 0, y: 100 } } as unknown as Node;
    onNodeDragStart({ metaKey: false, ctrlKey: false }, draggedRf, [draggedRf]);
    // Terminal frame: xyflow emits the raw position with dragging:false; the
    // hook snaps rfNodes back to x=0 (4px is within the 6px threshold).
    onNodesChange([{ type: 'position', id: 'b', position: { x: 4, y: 100 }, dragging: false }]);
    // xyflow's drag-stop payload carries the RAW position (x=4), not the snap.
    const rawStopNode = { id: 'b', position: { x: 4, y: 100 } } as unknown as Node;
    onNodeDragStop(null, rawStopNode, [rawStopNode]);

    const committedB = positionCommits.filter((c) => c.id === 'b').at(-1);
    if (!committedB) throw new Error('expected onNodePositionChange to fire for the dragged node');
    expect(committedB.position.x).toBe(0);
    expect(committedB.position.y).toBe(100);
  });
});

// ===========================================================================
// Canvas grouping M5 — group MOVE (children fan-out). Drives the full drag
// gesture through the dispatcher-shim the same way the alignment drag-commit
// test above does (onNodeDragStart → onNodesChange moves the group → onNodeDrag
// per-frame → onNodeDragStop commits). The pure fan-out math is covered in
// group-ops.test.ts (computeGroupMoveUpdates); here we assert the canvas WIRES
// it: members track the group LIVE during the drag, and drag-stop fans out ONE
// merged onNodePositionsChange (group + every member, equal deltas) with dedupe.
// ===========================================================================
describe('grouping M5: group move fans out to members (§9.1, §12.2)', () => {
  // The alignment hook (default-on in edit mode) batches guide commits through
  // requestAnimationFrame, which bun doesn't provide; onNodesChange runs the
  // alignment intercept first, so we stub a no-op rAF (same as the US-004 block).
  let savedRaf: typeof globalThis.requestAnimationFrame;
  let savedCaf: typeof globalThis.cancelAnimationFrame;
  beforeEach(() => {
    savedRaf = globalThis.requestAnimationFrame;
    savedCaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((_cb: FrameRequestCallback) =>
      1) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame;
  });
  afterEach(() => {
    globalThis.requestAnimationFrame = savedRaf;
    globalThis.cancelAnimationFrame = savedCaf;
  });

  const makeGroup = (id: string, childIds: string[], pos: { x: number; y: number }): FlowNode => ({
    id,
    type: 'group',
    position: pos,
    data: { name: 'G', width: 444, height: 132, childIds },
  });
  const makeMember = (id: string, pos: { x: number; y: number }): FlowNode => ({
    id,
    type: 'rectangle',
    position: pos,
    data: { name: id, width: 160, height: 80 },
  });

  // grouping-demo geometry: grp-1 box at (108,80); members node-a (120,120),
  // node-b (380,120). Disambiguates equal x/y so a wrong delta is visible.
  const grp = () => makeGroup('grp-1', ['node-a', 'node-b'], { x: 108, y: 80 });
  const nodeA = () => makeMember('node-a', { x: 120, y: 120 });
  const nodeB = () => makeMember('node-b', { x: 380, y: 120 });

  // The rendered node list lives in the `rfNodes` useState slot. Per the
  // canvas CLAUDE.md useState order it is slot 8 (connecting, dropPopover,
  // drawStart, drawCurrent, contextMenuPos, contextOnNode, contextNodeType,
  // contextEndpoint, rfNodes, …). The shim's setState is a no-op, so
  // `<ReactFlow>.props.nodes` is frozen at the initial render — to observe LIVE
  // movement we read the LATEST `setRfNodes(next)` value from the setterSink.
  const RF_NODES_SLOT = 8;
  type DragHandlers = {
    onNodeDragStart: (e: unknown, node: Node, nodes: Node[]) => void;
    onNodeDrag: (e: { metaKey?: boolean; ctrlKey?: boolean }) => void;
    onNodesChange: (changes: unknown[]) => void;
    onNodeDragStop: (e: unknown, node: Node, nodes: Node[]) => void;
    /** Latest rendered node list = the most recent setRfNodes(next) value. */
    latestRfNodes: () => Node[];
  };
  const wireGroupDrag = (props: Record<string, unknown>): DragHandlers => {
    // Disable alignment guides so the committed/live geometry is the pure group
    // delta (alignment snap is an orthogonal feature; its interaction with group
    // move is covered by leaving it ON in the orchestrator browser test). With
    // guides on, the group's position change would be snapped mid-drag and skew
    // the asserted delta by the snap offset.
    const setterSink: CapturedSetterCall[] = [];
    const tree = callSeeflowCanvas(
      { mode: 'edit', enableAlignmentGuides: false, ...props },
      { setterSink },
    );
    const rf = findElement(tree, (el) => el.type === ReactFlow);
    if (!rf) throw new Error('ReactFlow element not found');
    const initialNodes = rf.props.nodes as Node[];
    return {
      onNodeDragStart: rf.props.onNodeDragStart as DragHandlers['onNodeDragStart'],
      onNodeDrag: rf.props.onNodeDrag as DragHandlers['onNodeDrag'],
      onNodesChange: rf.props.onNodesChange as DragHandlers['onNodesChange'],
      onNodeDragStop: rf.props.onNodeDragStop as DragHandlers['onNodeDragStop'],
      latestRfNodes: () => {
        const calls = setterSink.filter((c) => c.slot === RF_NODES_SLOT);
        const last = calls.at(-1);
        // Each setRfNodes call passes the next array directly (no updater fn).
        return (last ? (last.next as Node[]) : initialNodes) ?? initialNodes;
      },
    };
  };

  it('LIVE: dragging the group repositions members in the rendered list by the group delta', () => {
    const h = wireGroupDrag({
      nodes: [grp(), nodeA(), nodeB()],
      selectedNodeIds: ['grp-1'],
    });
    const groupRf = { id: 'grp-1', position: { x: 108, y: 80 } } as unknown as Node;
    h.onNodeDragStart(null, groupRf, [groupRf]);
    // xyflow moves the group node by (+50,-30) → (158,50). The per-frame
    // position change flows through onNodesChange (updates rfNodesRef).
    h.onNodesChange([
      { type: 'position', id: 'grp-1', position: { x: 158, y: 50 }, dragging: true },
    ]);
    // onNodeDrag fires per frame → liveGroupDrag fans the delta to members.
    h.onNodeDrag({ metaKey: false, ctrlKey: false });
    const rendered = h.latestRfNodes();
    const a = rendered.find((n) => n.id === 'node-a');
    const b = rendered.find((n) => n.id === 'node-b');
    // Members moved by the SAME (+50,-30) delta against their frozen start.
    expect(a?.position).toEqual({ x: 170, y: 90 });
    expect(b?.position).toEqual({ x: 430, y: 90 });
  });

  it('LIVE is additive from the start snapshot: a second frame at a new pos does NOT compound', () => {
    const h = wireGroupDrag({
      nodes: [grp(), nodeA(), nodeB()],
      selectedNodeIds: ['grp-1'],
    });
    const groupRf = { id: 'grp-1', position: { x: 108, y: 80 } } as unknown as Node;
    h.onNodeDragStart(null, groupRf, [groupRf]);
    // Frame 1: group at (158,80) → delta (+50,0).
    h.onNodesChange([
      { type: 'position', id: 'grp-1', position: { x: 158, y: 80 }, dragging: true },
    ]);
    h.onNodeDrag({});
    // Frame 2: group at (208,80) → delta (+100,0) from START, NOT +50 from the
    // previous frame. If the impl read the previous frame, node-a would land at
    // 120+50+100 = 270; additive-from-start gives 120+100 = 220.
    h.onNodesChange([
      { type: 'position', id: 'grp-1', position: { x: 208, y: 80 }, dragging: true },
    ]);
    h.onNodeDrag({});
    const a = h.latestRfNodes().find((n) => n.id === 'node-a');
    expect(a?.position).toEqual({ x: 220, y: 120 });
  });

  it('COMMIT: drag-stop fans ONE onNodePositionsChange with group + every member (equal deltas)', () => {
    const batches: Array<Array<{ id: string; position: { x: number; y: number } }>> = [];
    const h = wireGroupDrag({
      nodes: [grp(), nodeA(), nodeB()],
      selectedNodeIds: ['grp-1'],
      onNodePositionsChange: (u: Array<{ id: string; position: { x: number; y: number } }>) =>
        batches.push(u),
    });
    const groupRf = { id: 'grp-1', position: { x: 108, y: 80 } } as unknown as Node;
    h.onNodeDragStart(null, groupRf, [groupRf]);
    h.onNodesChange([
      { type: 'position', id: 'grp-1', position: { x: 158, y: 50 }, dragging: false },
    ]);
    // drag-stop: xyflow passes the (raw) group node; the commit reads rfNodesRef.
    const stopNode = { id: 'grp-1', position: { x: 158, y: 50 } } as unknown as Node;
    h.onNodeDragStop(null, stopNode, [stopNode]);
    expect(batches).toHaveLength(1);
    const batch = batches[0];
    if (!batch) throw new Error('no batch committed');
    const byId = Object.fromEntries(batch.map((u) => [u.id, u.position]));
    // Group + both members, all translated by (+50,-30) from their starts.
    expect(byId['grp-1']).toEqual({ x: 158, y: 50 });
    expect(byId['node-a']).toEqual({ x: 170, y: 90 });
    expect(byId['node-b']).toEqual({ x: 430, y: 90 });
    expect(batch).toHaveLength(3);
  });

  it('DEDUPE: a member also independently selected is committed exactly once', () => {
    const batches: Array<Array<{ id: string; position: { x: number; y: number } }>> = [];
    const h = wireGroupDrag({
      nodes: [grp(), nodeA(), nodeB()],
      // grp-1 AND node-a both selected → both are in xyflow's dragged set.
      selectedNodeIds: ['grp-1', 'node-a'],
      onNodePositionsChange: (u: Array<{ id: string; position: { x: number; y: number } }>) =>
        batches.push(u),
    });
    const groupRf = { id: 'grp-1', position: { x: 108, y: 80 } } as unknown as Node;
    const aRf = { id: 'node-a', position: { x: 120, y: 120 } } as unknown as Node;
    // Both selected nodes drag together.
    h.onNodeDragStart(null, groupRf, [groupRf, aRf]);
    h.onNodesChange([
      { type: 'position', id: 'grp-1', position: { x: 118, y: 90 }, dragging: false },
      { type: 'position', id: 'node-a', position: { x: 130, y: 130 }, dragging: false },
    ]);
    h.onNodeDragStop(null, groupRf, [groupRf, aRf]);
    expect(batches).toHaveLength(1);
    const batch = batches[0];
    if (!batch) throw new Error('no batch committed');
    const aEntries = batch.filter((u) => u.id === 'node-a');
    // node-a appears ONCE (via the direct drag path, not also via the fan-out).
    expect(aEntries).toHaveLength(1);
    // node-b (a member NOT independently selected) is fanned out by the group
    // delta (+10,+10): 380,120 → 390,130.
    const b = batch.find((u) => u.id === 'node-b');
    expect(b?.position).toEqual({ x: 390, y: 130 });
    // Exactly grp-1, node-a, node-b — no duplicate.
    expect(batch.map((u) => u.id).sort()).toEqual(['grp-1', 'node-a', 'node-b']);
  });

  it('ordinary (non-group) drag is unaffected: no group snapshot, single-node path', () => {
    const single: Array<{ id: string; position: { x: number; y: number } }> = [];
    const h = wireGroupDrag({
      nodes: [makeMember('m1', { x: 0, y: 0 })],
      selectedNodeIds: [],
      onNodePositionChange: (id: string, position: { x: number; y: number }) =>
        single.push({ id, position }),
    });
    const rfN = { id: 'm1', position: { x: 0, y: 0 } } as unknown as Node;
    h.onNodeDragStart(null, rfN, [rfN]);
    h.onNodesChange([{ type: 'position', id: 'm1', position: { x: 5, y: 5 }, dragging: false }]);
    h.onNodeDragStop(null, rfN, [rfN]);
    // Single non-group node → the per-id onNodePositionChange path (unchanged).
    expect(single).toEqual([{ id: 'm1', position: { x: 5, y: 5 } }]);
  });
});

// ---------------------------------------------------------------------------
// Canvas grouping M6 — double-click ENTER / one documented EXIT set + the
// isolation render overlay (design §5.3). `activeGroupId` is the 15th useState
// → setterSink slot 14 (per packages/canvas/CLAUDE.md). The live pointer/keydown
// gesture itself is covered by the orchestrator browser test; here we assert the
// WIRING + the state transitions via the dispatcher-shim.
// ---------------------------------------------------------------------------
describe('grouping M6: enter / exit isolation (§5.3)', () => {
  const ACTIVE_GROUP_SLOT = 14;
  const makeGroup = (id: string, childIds: string[]): FlowNode => ({
    id,
    type: 'group',
    position: { x: 108, y: 80 },
    data: { name: 'G', width: 444, height: 132, childIds },
  });
  const makeMember = (id: string, x: number): FlowNode => ({
    id,
    type: 'rectangle',
    position: { x, y: 120 },
    data: { name: id, width: 160, height: 80 },
  });
  // grouping-demo geometry: grp-1 box at (108,80); members node-a (120,120),
  // node-b (340,120); a loose 'outsider' that is NOT a member.
  const grp = () => makeGroup('grp-1', ['node-a', 'node-b']);
  const nodeA = () => makeMember('node-a', 120);
  const nodeB = () => makeMember('node-b', 340);
  const outsider = (): FlowNode => ({
    id: 'outsider',
    type: 'rectangle',
    position: { x: 700, y: 120 },
    data: { name: 'outsider', width: 120, height: 60 },
  });

  function reactFlowOf(props: Record<string, unknown>, setterSink: CapturedSetterCall[]) {
    const tree = callSeeflowCanvas({ mode: 'edit', ...props }, { setterSink });
    const rf = findElement(tree, (el) => el.type === ReactFlow);
    if (!rf) throw new Error('ReactFlow element not found');
    return rf;
  }
  const lastActiveSetter = (sink: CapturedSetterCall[]) =>
    sink.filter((c) => c.slot === ACTIVE_GROUP_SLOT).at(-1);

  // ---- ENTER ----
  it('onNodeDoubleClick is wired on the ReactFlow root (NOT wired before M6)', () => {
    const sink: CapturedSetterCall[] = [];
    const rf = reactFlowOf({ nodes: [grp(), nodeA(), nodeB()], selectedNodeIds: [] }, sink);
    expect(typeof rf.props.onNodeDoubleClick).toBe('function');
  });

  it('double-clicking a GROUP enters isolation: setActiveGroupId(group.id)', () => {
    const sink: CapturedSetterCall[] = [];
    const rf = reactFlowOf({ nodes: [grp(), nodeA(), nodeB()], selectedNodeIds: ['grp-1'] }, sink);
    const onNodeDoubleClick = rf.props.onNodeDoubleClick as (e: unknown, n: Node) => void;
    onNodeDoubleClick({}, { id: 'grp-1', type: 'group' } as unknown as Node);
    expect(lastActiveSetter(sink)?.next).toBe('grp-1');
  });

  it('double-clicking a NON-group node does NOT enter isolation', () => {
    const sink: CapturedSetterCall[] = [];
    const rf = reactFlowOf({ nodes: [grp(), nodeA(), nodeB()], selectedNodeIds: [] }, sink);
    const onNodeDoubleClick = rf.props.onNodeDoubleClick as (e: unknown, n: Node) => void;
    onNodeDoubleClick({}, { id: 'node-a', type: 'rectangle' } as unknown as Node);
    expect(lastActiveSetter(sink)).toBeUndefined();
  });

  it('M9 §9.9: double-clicking a group in VIEW mode does NOT enter isolation (edit-only)', () => {
    // Enter isolation is an edit-only affordance (it makes members editable).
    // In view mode `flags.showResizeHandles` is false, so the gate blocks it even
    // though selection/pan stay on. The group still renders read-only.
    const sink: CapturedSetterCall[] = [];
    const tree = callSeeflowCanvas(
      { mode: 'view', nodes: [grp(), nodeA(), nodeB()], selectedNodeIds: ['grp-1'] },
      { setterSink: sink },
    );
    const rf = findElement(tree, (el) => el.type === ReactFlow);
    if (!rf) throw new Error('ReactFlow element not found');
    const onNodeDoubleClick = rf.props.onNodeDoubleClick as (e: unknown, n: Node) => void;
    onNodeDoubleClick({}, { id: 'grp-1', type: 'group' } as unknown as Node);
    expect(lastActiveSetter(sink)).toBeUndefined();
  });

  // ---- EXIT path (b): empty pane ----
  it('EXIT (pane): clicking the empty pane while entered clears activeGroupId', () => {
    const sink: CapturedSetterCall[] = [];
    const overrides: unknown[] = [];
    overrides[ACTIVE_GROUP_SLOT] = 'grp-1'; // entered
    const tree = callSeeflowCanvas(
      { mode: 'edit', nodes: [grp(), nodeA(), nodeB()], selectedNodeIds: [] },
      { setterSink: sink, useStateOverrides: overrides },
    );
    const rf = findElement(tree, (el) => el.type === ReactFlow);
    if (!rf) throw new Error('ReactFlow element not found');
    const onPaneClick = rf.props.onPaneClick as (e: unknown) => void;
    onPaneClick({});
    expect(lastActiveSetter(sink)?.next).toBeNull();
  });

  it('EXIT (pane): clicking the empty pane when NOT entered is a no-op for activeGroupId', () => {
    const sink: CapturedSetterCall[] = [];
    const rf = reactFlowOf({ nodes: [grp(), nodeA(), nodeB()], selectedNodeIds: [] }, sink);
    const onPaneClick = rf.props.onPaneClick as (e: unknown) => void;
    onPaneClick({});
    expect(lastActiveSetter(sink)).toBeUndefined();
  });

  // ---- EXIT path (c): click a non-member ----
  it('EXIT (non-member): clicking a node OUTSIDE the active group clears activeGroupId', () => {
    const sink: CapturedSetterCall[] = [];
    const overrides: unknown[] = [];
    overrides[ACTIVE_GROUP_SLOT] = 'grp-1';
    const tree = callSeeflowCanvas(
      { mode: 'edit', nodes: [grp(), nodeA(), nodeB(), outsider()], selectedNodeIds: [] },
      { setterSink: sink, useStateOverrides: overrides },
    );
    const rf = findElement(tree, (el) => el.type === ReactFlow);
    if (!rf) throw new Error('ReactFlow element not found');
    const onNodeClick = rf.props.onNodeClick as (e: unknown, n: Node) => void;
    onNodeClick({}, { id: 'outsider', type: 'rectangle' } as unknown as Node);
    expect(lastActiveSetter(sink)?.next).toBeNull();
  });

  it('STAYS (member): clicking a MEMBER of the active group does NOT exit', () => {
    const sink: CapturedSetterCall[] = [];
    const overrides: unknown[] = [];
    overrides[ACTIVE_GROUP_SLOT] = 'grp-1';
    const tree = callSeeflowCanvas(
      { mode: 'edit', nodes: [grp(), nodeA(), nodeB()], selectedNodeIds: [] },
      { setterSink: sink, useStateOverrides: overrides },
    );
    const rf = findElement(tree, (el) => el.type === ReactFlow);
    if (!rf) throw new Error('ReactFlow element not found');
    const onNodeClick = rf.props.onNodeClick as (e: unknown, n: Node) => void;
    onNodeClick({}, { id: 'node-a', type: 'rectangle' } as unknown as Node);
    expect(lastActiveSetter(sink)).toBeUndefined();
  });

  it('STAYS (own chrome): clicking the active group itself does NOT exit', () => {
    const sink: CapturedSetterCall[] = [];
    const overrides: unknown[] = [];
    overrides[ACTIVE_GROUP_SLOT] = 'grp-1';
    const tree = callSeeflowCanvas(
      { mode: 'edit', nodes: [grp(), nodeA(), nodeB()], selectedNodeIds: ['grp-1'] },
      { setterSink: sink, useStateOverrides: overrides },
    );
    const rf = findElement(tree, (el) => el.type === ReactFlow);
    if (!rf) throw new Error('ReactFlow element not found');
    const onNodeClick = rf.props.onNodeClick as (e: unknown, n: Node) => void;
    onNodeClick({}, { id: 'grp-1', type: 'group' } as unknown as Node);
    // The group is "not a member" of itself, but clicking it while entered must
    // NOT exit (the title-bar affordance owns that). So no clear is emitted.
    expect(lastActiveSetter(sink)).toBeUndefined();
  });

  // ---- EXIT path (a): Esc ranked BEFORE selection-clear ----
  it('EXIT (Esc): first Escape clears activeGroupId (ranked before selection-clear)', () => {
    // The ESC chain registers a window-level keydown listener inside a useEffect.
    // This shim env has no DOM `window`, so stub one that captures the registered
    // handler; then drive the captured handler with a synthetic Escape event.
    // This keeps the test deterministic (no global dispatch fan-out) while still
    // exercising the REAL handler body (the §5.3 exit ranking).
    const captured: Array<(e: { key: string; preventDefault: () => void }) => void> = [];
    const fakeWindow = {
      addEventListener: (type: string, fn: unknown) => {
        if (type === 'keydown') captured.push(fn as (typeof captured)[number]);
      },
      removeEventListener: () => {},
    };
    const savedWindow = (globalThis as { window?: unknown }).window;
    const savedDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { window?: unknown }).window = fakeWindow;
    // The ESC chain reads `document.activeElement` (isEditableTarget guard).
    // Stub a document with no focused editable element so the chain proceeds.
    (globalThis as { document?: unknown }).document = { activeElement: null };
    try {
      const sink: CapturedSetterCall[] = [];
      const effects: CapturedEffect[] = [];
      const overrides: unknown[] = [];
      overrides[ACTIVE_GROUP_SLOT] = 'grp-1';
      callSeeflowCanvas(
        { mode: 'edit', nodes: [grp(), nodeA(), nodeB()], selectedNodeIds: ['node-a'] },
        { setterSink: sink, useStateOverrides: overrides, effectSink: effects },
      );
      // Register every keydown listener (the ESC chain among them). The effect
      // bodies only call addEventListener (now stubbed) / set refs.
      for (const e of effects) e.cb();
      let prevented = false;
      const escEvent = {
        key: 'Escape',
        preventDefault: () => {
          prevented = true;
        },
      };
      for (const fn of captured) fn(escEvent);
      // The isolation step ran (slot 14 → null) and preventDefault()'d — it
      // short-circuits BEFORE the selection-clear (a SECOND Esc would clear
      // selection; that ranking is the browser test's job to confirm).
      expect(lastActiveSetter(sink)?.next).toBeNull();
      expect(prevented).toBe(true);
    } finally {
      (globalThis as { window?: unknown }).window = savedWindow;
      (globalThis as { document?: unknown }).document = savedDocument;
    }
  });

  // ---- The isolation render overlay (displayNodes) ----
  it('OVERLAY: the entered group renders data.active=true and draggable=false', () => {
    const overrides: unknown[] = [];
    overrides[ACTIVE_GROUP_SLOT] = 'grp-1';
    const tree = callSeeflowCanvas(
      { mode: 'edit', nodes: [grp(), nodeA(), nodeB()], selectedNodeIds: [] },
      { useStateOverrides: overrides },
    );
    const rf = findElement(tree, (el) => el.type === ReactFlow);
    if (!rf) throw new Error('ReactFlow element not found');
    const rendered = rf.props.nodes as Node[];
    const g = rendered.find((n) => n.id === 'grp-1');
    expect((g?.data as { active?: boolean }).active).toBe(true);
    expect(g?.draggable).toBe(false);
    // Members are untouched: still draggable, no active flag.
    const a = rendered.find((n) => n.id === 'node-a');
    expect(a?.draggable).toBeUndefined();
    expect((a?.data as { active?: boolean }).active).toBeUndefined();
  });

  it('OVERLAY: with NO group entered every node renders unchanged (no active / no draggable flip)', () => {
    const tree = callSeeflowCanvas({
      mode: 'edit',
      nodes: [grp(), nodeA(), nodeB()],
      selectedNodeIds: [],
    });
    const rf = findElement(tree, (el) => el.type === ReactFlow);
    if (!rf) throw new Error('ReactFlow element not found');
    const rendered = rf.props.nodes as Node[];
    const g = rendered.find((n) => n.id === 'grp-1');
    // Not entered → no active flag, group keeps default draggability (undefined).
    expect((g?.data as { active?: boolean }).active).toBeUndefined();
    expect(g?.draggable).toBeUndefined();
  });

  // ---- EXIT path (d): the vanished-group cleanup effect ----
  it('EXIT (vanished): the cleanup effect clears activeGroupId when its group is gone', () => {
    const sink: CapturedSetterCall[] = [];
    const effects: CapturedEffect[] = [];
    const overrides: unknown[] = [];
    overrides[ACTIVE_GROUP_SLOT] = 'grp-1';
    // The group is NOT in `nodes` (ungrouped / deleted / flow swapped).
    callSeeflowCanvas(
      { mode: 'edit', nodes: [nodeA(), nodeB()], selectedNodeIds: [] },
      { setterSink: sink, useStateOverrides: overrides, effectSink: effects },
    );
    // Find the cleanup effect by its deps shape: [activeGroupId, nodes].
    const cleanup = effects.find(
      (e) => Array.isArray(e.deps) && e.deps.length === 2 && e.deps[0] === 'grp-1',
    );
    if (!cleanup)
      throw new Error('vanished-group cleanup effect (deps [activeGroupId, nodes]) not found');
    cleanup.cb();
    expect(lastActiveSetter(sink)?.next).toBeNull();
  });

  it('NO-EXIT (still present): the cleanup effect leaves activeGroupId when its group exists', () => {
    const sink: CapturedSetterCall[] = [];
    const effects: CapturedEffect[] = [];
    const overrides: unknown[] = [];
    overrides[ACTIVE_GROUP_SLOT] = 'grp-1';
    callSeeflowCanvas(
      { mode: 'edit', nodes: [grp(), nodeA(), nodeB()], selectedNodeIds: [] },
      { setterSink: sink, useStateOverrides: overrides, effectSink: effects },
    );
    const cleanup = effects.find(
      (e) => Array.isArray(e.deps) && e.deps.length === 2 && e.deps[0] === 'grp-1',
    );
    if (!cleanup) throw new Error('vanished-group cleanup effect not found');
    cleanup.cb();
    // Group still a `type:'group'` in nodes → no clear.
    expect(lastActiveSetter(sink)).toBeUndefined();
  });
});
