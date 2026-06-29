import { describe, expect, it } from 'bun:test';
import type { NodeProps } from '@xyflow/react';
import * as React from 'react';
import {
  GeometricNode,
  type GeometricNodeFlowNode,
  isIllustrativeShape,
} from './geometric-node.tsx';

// React-internal-dispatcher shim — same pattern as icon-node.test.tsx +
// rectangle-node.test.tsx. Lets us render GeometricNode in a non-React-Flow
// host without tripping `<Handle>`'s zustand dependency.
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: () => void;
};

function renderWithHooks<T>(fn: () => T, useStateOverrides?: ReadonlyArray<unknown>): T {
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
    useRef: <T,>(initial: T) => ({ current: initial }),
    useEffect: () => {},
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
    if (!isElement(node)) return;
    if (predicate(node)) out.push(node);
    const children = node.props.children;
    if (children === undefined || children === null) return;
    const arr = Array.isArray(children) ? children : [children];
    for (const c of arr) visit(c);
  };
  visit(tree);
  return out;
}

// Biome's noNonNullAssertion bans `!`, but every consumer below first
// asserts `toHaveLength(1)` and would crash anyway on an empty match. This
// helper turns the empty case into a readable throw instead.
function unwrap<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

// The shim doesn't execute component bodies, so JSX inside a function
// component (like `<ResizeControls />`) is invisible to findAll. Locate the
// component element itself by its function `.name`, the same pattern
// rectangle-node.test.tsx uses.
function findByComponentName(tree: unknown, name: string): ReactElementLike[] {
  return findAll(tree, (el) => {
    const t = el.type as { name?: string } | { type?: { name?: string } } | unknown;
    if (typeof t === 'function' && (t as { name?: string }).name === name) return true;
    if (
      typeof t === 'object' &&
      t !== null &&
      typeof (t as { type?: unknown }).type === 'function' &&
      (t as { type: { name?: string } }).type.name === name
    ) {
      return true;
    }
    return false;
  });
}

function callGeometric(
  type:
    | 'rectangle'
    | 'ellipse'
    | 'sticky'
    | 'text'
    | 'database'
    | 'server'
    | 'user'
    | 'queue'
    | 'cloud'
    | 'diamond'
    | 'hexagon',
  data: Record<string, unknown>,
  overrides: Partial<NodeProps<GeometricNodeFlowNode>> = {},
): unknown {
  const props = {
    id: 'n1',
    type,
    data,
    selected: false,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    zIndex: 0,
    dragging: false,
    deletable: true,
    draggable: true,
    selectable: true,
    ...overrides,
  } as unknown as NodeProps<GeometricNodeFlowNode>;
  const impl = (
    GeometricNode as unknown as { type: (p: NodeProps<GeometricNodeFlowNode>) => unknown }
  ).type;
  return renderWithHooks(() => impl(props));
}

// isIllustrativeShape gates which geometric tags render via an inline SVG
// (database / server / queue / cloud / user / diamond / hexagon) versus the
// box/border chrome (rectangle / ellipse / sticky / text).
describe('isIllustrativeShape predicate', () => {
  it('isIllustrativeShape returns true for the 7 illustrative tags', () => {
    expect(isIllustrativeShape('database')).toBe(true);
    expect(isIllustrativeShape('server')).toBe(true);
    expect(isIllustrativeShape('queue')).toBe(true);
    expect(isIllustrativeShape('cloud')).toBe(true);
    expect(isIllustrativeShape('user')).toBe(true);
    expect(isIllustrativeShape('diamond')).toBe(true);
    expect(isIllustrativeShape('hexagon')).toBe(true);
  });

  it('isIllustrativeShape returns false for rectangle / ellipse / sticky / text', () => {
    expect(isIllustrativeShape('rectangle')).toBe(false);
    expect(isIllustrativeShape('ellipse')).toBe(false);
    expect(isIllustrativeShape('sticky')).toBe(false);
    expect(isIllustrativeShape('text')).toBe(false);
  });
});

// GeometricNode emits a `data-node-type` matching the variant tag.
describe('GeometricNode data-node-type', () => {
  it('emits data-node-type matching the variant (e.g. database)', () => {
    const tree = callGeometric('database', { name: 'db' });
    const matches = findAll(
      tree,
      (el) => (el.props as { 'data-node-type'?: string })['data-node-type'] === 'database',
    );
    expect(matches).toHaveLength(1);
  });
});

// The illustrative SVG renderer fills the full node box.
describe('GeometricNode illustrative SVG sizing', () => {
  // The SVG renderer is the only element in the tree that receives both a
  // numeric `width` AND a numeric `height` prop, so this matches it
  // regardless of which illustrative shape is mounted.
  const findRenderers = (tree: unknown) =>
    findAll(
      tree,
      (el) =>
        typeof (el.props as { height?: unknown }).height === 'number' &&
        typeof (el.props as { width?: unknown }).width === 'number',
    );

  it('database renders a single full-height SVG', () => {
    const tree = callGeometric('database', { name: 'db', width: 120, height: 140 });
    const renderers = findRenderers(tree);
    expect(renderers).toHaveLength(1);
    const first = unwrap(renderers[0], 'expected one renderer');
    expect((first.props as { height: number }).height).toBe(140);
  });
});

// ResizeControls always receives the default minHeight floor.
describe('GeometricNode resize min-height', () => {
  const findResizeControls = (tree: unknown) => findByComponentName(tree, 'ResizeControls');

  const firstMinHeight = (tree: unknown): number => {
    const ctrls = findResizeControls(tree);
    expect(ctrls).toHaveLength(1);
    const first = unwrap(ctrls[0], 'expected one ResizeControls');
    return (first.props as { minHeight: number }).minHeight;
  };

  it('database passes default minHeight 40 to ResizeControls', () => {
    const tree = callGeometric('database', { name: 'db', onResize: () => {} });
    expect(firstMinHeight(tree)).toBe(40);
  });
});

// Theme-aware elevation. Sticky carries a baseline shadow (the old
// `sf:shadow-md`); other shapes default to no shadow. `data.shadow` swaps
// either default for `var(--node-shadow-N)`.
describe('GeometricNode shadow elevation', () => {
  function getRootStyle(tree: unknown): Record<string, string | undefined> {
    const root = findAll(
      tree,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'geometric-node',
    )[0];
    if (!root) throw new Error('geometric-node root missing');
    return ((root.props as { style?: Record<string, string> }).style ?? {}) as Record<
      string,
      string
    >;
  }

  it('sticky keeps its baseline boxShadow when data.shadow is unset', () => {
    const style = getRootStyle(callGeometric('sticky', { description: 'hi' }));
    expect(style.boxShadow).toBeDefined();
    expect(style.boxShadow).not.toBe('var(--node-shadow-3)');
  });

  it('sticky paints var(--node-shadow-N) when data.shadow is set', () => {
    const style = getRootStyle(callGeometric('sticky', { description: 'hi', shadow: 4 }));
    expect(style.boxShadow).toBe('var(--node-shadow-4)');
  });

  it('rectangle (no baseline at this layer) paints var(--node-shadow-N) when shadow is set', () => {
    const style = getRootStyle(callGeometric('rectangle', { name: 'r', shadow: 2 }));
    expect(style.boxShadow).toBe('var(--node-shadow-2)');
  });

  it('rectangle (no baseline at this layer) omits boxShadow when shadow is unset', () => {
    const style = getRootStyle(callGeometric('rectangle', { name: 'r' }));
    expect(style.boxShadow).toBeUndefined();
  });
});
