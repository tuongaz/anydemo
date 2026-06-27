import { describe, expect, it } from 'bun:test';
import type { NodeProps } from '@xyflow/react';
import * as React from 'react';
import { LineNode, type LineNodeType } from './line-node.tsx';

// Same dispatcher shim as freehand-node.test.tsx — Bun runs without a DOM, so we
// call the memo'd component's inner impl as a plain function and walk the
// returned element tree.
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
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
    useCallback: <T,>(fn: T) => fn,
    useMemo: <T,>(fn: () => T) => fn(),
    useEffect: () => {},
    useRef: <T,>(initial: T) => ({ current: initial }),
  };
  try {
    return fn();
  } finally {
    internals.ReactCurrentDispatcher.current = prev;
  }
}

type ReactElementLike = { type: unknown; props: Record<string, unknown> & { children?: unknown } };

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

function callLineNode(data: Record<string, unknown>, overrides: Partial<NodeProps> = {}): unknown {
  const props = {
    id: 'l1',
    type: 'line',
    data,
    selected: false,
    isConnectable: false,
    ...overrides,
  } as unknown as NodeProps<LineNodeType>;
  const impl = (LineNode as unknown as { type: (p: NodeProps<LineNodeType>) => unknown }).type;
  return renderWithHooks(() => impl(props));
}

const DIAGONAL = {
  points: [
    [0, 0],
    [1, 1],
  ],
  width: 100,
  height: 50,
};

describe('LineNode', () => {
  it('renders an <svg role="img"> with a viewBox sized to the node box', () => {
    const tree = callLineNode(DIAGONAL);
    const svgs = findAll(tree, (el) => el.type === 'svg');
    expect(svgs.length).toBe(1);
    expect(svgs[0]?.props.viewBox).toBe('0 0 100 50');
    expect(svgs[0]?.props.preserveAspectRatio).toBe('none');
  });

  it('renders a transparent hit line + a visible stroke line at denormalized coords', () => {
    const tree = callLineNode(DIAGONAL);
    const lines = findAll(tree, (el) => el.type === 'line');
    expect(lines.length).toBe(2);
    // Both lines share the same endpoints; the visible one carries the color.
    for (const l of lines) {
      expect(l.props.x1).toBe(0);
      expect(l.props.y1).toBe(0);
      expect(l.props.x2).toBe(100);
      expect(l.props.y2).toBe(50);
    }
    const visible = lines.find((l) => l.props.stroke !== 'transparent');
    expect(visible).toBeDefined();
    expect(visible?.props.strokeWidth).toBe(2);
  });

  it('applies a dash array for a dashed line', () => {
    const tree = callLineNode({ ...DIAGONAL, borderStyle: 'dashed' });
    const lines = findAll(tree, (el) => el.type === 'line');
    const visible = lines.find((l) => l.props.stroke !== 'transparent');
    expect(visible?.props.strokeDasharray).toBe('6 4');
  });

  it('honours an explicit borderSize as the stroke width', () => {
    const tree = callLineNode({ ...DIAGONAL, borderSize: 5 });
    const lines = findAll(tree, (el) => el.type === 'line');
    const visible = lines.find((l) => l.props.stroke !== 'transparent');
    expect(visible?.props.strokeWidth).toBe(5);
  });

  it('uses data.name as the aria-label when set', () => {
    const tree = callLineNode({ ...DIAGONAL, name: 'Divider' });
    const svgs = findAll(tree, (el) => el.type === 'svg');
    expect(svgs[0]?.props['aria-label']).toBe('Divider');
  });
});
