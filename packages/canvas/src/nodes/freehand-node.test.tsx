import { describe, expect, it } from 'bun:test';
import type { NodeProps } from '@xyflow/react';
import * as React from 'react';
import { FreehandNode, type FreehandNodeType } from './freehand-node.tsx';

// Mirrors icon-node.test.tsx: Bun runs these without a DOM, so we shim React's
// internal dispatcher and call the node component as a plain function. Each hook
// returns a synchronous initial value; useEffect is a no-op so the dynamic
// import never fires — the component renders its synchronous first paint (the
// <polyline> fallback) which is exactly what we assert here.
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useEffect: () => void;
  useRef: <T>(initial: T) => { current: T };
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
  internals.ReactCurrentDispatcher.current = {
    useState: <S,>(initial: S | (() => S)) => {
      const value = typeof initial === 'function' ? (initial as () => S)() : initial;
      return [value, () => {}];
    },
    useEffect: () => {},
    useRef: <T,>(initial: T) => ({ current: initial }),
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
  predicate: (type: unknown) => boolean,
): ReactElementLike | null {
  if (!isElement(tree)) return null;
  if (predicate(tree.type)) return tree;
  const children = tree.props.children;
  if (children === undefined || children === null) return null;
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

function callFreehandNode(data: Record<string, unknown>): unknown {
  const props = {
    id: 'n1',
    type: 'freehand',
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
  } as unknown as NodeProps<FreehandNodeType>;
  return renderWithHooks(() => FreehandNode(props));
}

describe('FreehandNode', () => {
  it('renders an <svg role="img"> with a viewBox sized to the node box', () => {
    const tree = callFreehandNode({
      points: [
        [0, 0, 0.5],
        [1, 1, 0.5],
      ],
      width: 120,
      height: 80,
    });
    if (!isElement(tree)) throw new Error('FreehandNode did not return a React element');
    expect(tree.type).toBe('svg');
    expect(tree.props.role).toBe('img');
    expect(tree.props.viewBox).toBe('0 0 120 80');
  });

  it('uses data.name as the aria-label when set', () => {
    const tree = callFreehandNode({
      points: [
        [0, 0, 0.5],
        [1, 1, 0.5],
      ],
      width: 100,
      height: 100,
      name: 'Signature',
    });
    if (!isElement(tree)) throw new Error('FreehandNode did not return a React element');
    expect(tree.props['aria-label']).toBe('Signature');
  });

  it('falls back to "Freehand drawing" when data.name is absent', () => {
    const tree = callFreehandNode({
      points: [
        [0, 0, 0.5],
        [1, 1, 0.5],
      ],
      width: 100,
      height: 100,
    });
    if (!isElement(tree)) throw new Error('FreehandNode did not return a React element');
    expect(tree.props['aria-label']).toBe('Freehand drawing');
  });

  it('renders a <polyline> fallback through the denormalized points before getStroke resolves', () => {
    // useEffect is a no-op in the shim, so getStroke never resolves and the
    // synchronous fallback is what paints on first render.
    const tree = callFreehandNode({
      points: [
        [0, 0, 0.5],
        [1, 0.5, 0.5],
      ],
      width: 200,
      height: 100,
    });
    const polyline = findElement(tree, (type) => type === 'polyline');
    if (!polyline) throw new Error('expected a <polyline> fallback');
    // Points denormalized to local px: (0,0) and (200,50).
    expect(polyline.props.points).toBe('0,0 200,50');
  });
});
