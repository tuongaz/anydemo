import { describe, expect, it } from 'bun:test';
import type { NodeProps } from '@xyflow/react';
import * as React from 'react';
import { Icon } from '../ui/icon.tsx';
import { StateNode } from './state-node.tsx';

// Hook-shim renderer — same shape as play-node.test.tsx / icon-node.test.tsx.
// StateNode uses useState + useResizeGesture (which itself uses useState +
// useRef + useCallback + useEffect), so the shim covers all five.
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: () => void;
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

function callStateNode(data: Record<string, unknown>, overrides: Partial<NodeProps> = {}): unknown {
  const props = {
    id: 's1',
    type: 'stateNode',
    data: {
      name: 'State',
      kind: 'service',
      ...data,
    },
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
  } as unknown as NodeProps;
  const impl = (StateNode as unknown as { type: (p: NodeProps) => unknown }).type;
  return renderWithHooks(() => impl(props));
}

function findHeader(tree: unknown): ReactElementLike {
  const header = findElement(
    tree,
    (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'node-header',
  );
  if (!header) throw new Error('node-header not found');
  return header;
}

function findHeaderIcon(tree: unknown): ReactElementLike | null {
  const header = findHeader(tree);
  return findElement(header, (el) => el.type === Icon);
}

describe('StateNode header icon (US-006)', () => {
  it('renders an Icon in the header when data.icon is set', () => {
    const tree = callStateNode({ icon: 'server' });
    const icon = findHeaderIcon(tree);
    if (!icon) throw new Error('expected Icon in node-header');
    expect((icon.props as { name?: string }).name).toBe('server');
    expect((icon.props as { size?: number }).size).toBe(16);
    expect((icon.props as { className?: string }).className).toBe('shrink-0');
  });

  it('does not render an Icon in the header when data.icon is undefined', () => {
    const tree = callStateNode({});
    expect(findHeaderIcon(tree)).toBeNull();
  });
});
