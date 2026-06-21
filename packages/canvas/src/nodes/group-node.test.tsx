import { describe, expect, it } from 'bun:test';
import { Handle, type NodeProps } from '@xyflow/react';
import * as React from 'react';
import { GROUP_NODE_Z_INDEX, GroupNode, type GroupNodeType } from './group-node.tsx';
import { NodeHeader } from './lib/node-header.tsx';
import { ResizeControls } from './resize-controls.tsx';

// Mirrors freehand-node.test.tsx / icon-node.test.tsx: Bun runs without a DOM,
// so we shim React's internal dispatcher and call the component as a plain
// function. Each hook returns a synchronous value; useContext returns the
// canvas-studio shape NodeHeader reads.
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useEffect: () => void;
  useRef: <T>(initial: T) => { current: T };
  useContext: <T>(ctx: unknown) => T;
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
    useContext: <T,>() => ({ studioBaseUrl: '' }) as T,
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

function callGroupNode(
  data: Record<string, unknown>,
  overrides: Partial<NodeProps> = {},
): ReactElementLike {
  const props = {
    id: 'g1',
    type: 'group',
    data,
    selected: false,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    zIndex: GROUP_NODE_Z_INDEX,
    dragging: false,
    deletable: true,
    draggable: true,
    selectable: true,
    ...overrides,
  } as unknown as NodeProps<GroupNodeType>;
  // GroupNode is `memo(GroupNodeImpl, …)`, whose inner impl is at `.type`.
  const impl = (GroupNode as unknown as { type: (p: NodeProps<GroupNodeType>) => unknown }).type;
  const tree = renderWithHooks(() => impl(props));
  if (!isElement(tree)) throw new Error('GroupNode did not return a React element');
  return tree;
}

describe('GroupNode', () => {
  it('renders a container div with data-node-type="group"', () => {
    const tree = callGroupNode({ childIds: [], width: 320, height: 220 });
    expect(tree.props['data-node-type']).toBe('group');
    expect(tree.props['data-testid']).toBe('group-node');
  });

  it('paints background + border from the color tokens and the persisted corner radius', () => {
    const tree = callGroupNode({
      childIds: ['a'],
      width: 300,
      height: 200,
      backgroundColor: 'slate',
      borderColor: 'blue',
      borderSize: 2,
      cornerRadius: 16,
    });
    const style = (tree.props.style ?? {}) as React.CSSProperties;
    // slate/blue resolve to non-empty inline colors (not the white default).
    expect(typeof style.backgroundColor).toBe('string');
    expect(style.backgroundColor).not.toBe('hsl(var(--card))');
    expect(typeof style.borderColor).toBe('string');
    expect(style.borderWidth).toBe(2);
    expect(style.borderRadius).toBe(16);
  });

  it('fills the wrapper (h-full/w-full) and omits fixed px when sized', () => {
    const tree = callGroupNode({ childIds: [], width: 400, height: 300 });
    const style = (tree.props.style ?? {}) as { width?: number; height?: number };
    expect(style.width).toBeUndefined();
    expect(style.height).toBeUndefined();
    const className = String(tree.props.className ?? '');
    expect(className).toContain('h-full');
    expect(className).toContain('w-full');
  });

  it('falls back to the default box size when unsized', () => {
    const tree = callGroupNode({ childIds: [] });
    const style = (tree.props.style ?? {}) as { width?: number; height?: number };
    expect(style.width).toBe(320);
    expect(style.height).toBe(220);
    const className = String(tree.props.className ?? '');
    expect(className).not.toContain('h-full');
  });

  it('renders the title via NodeHeader using data.name', () => {
    const tree = callGroupNode({ childIds: [], name: 'My group', width: 300, height: 200 });
    const header = findElement(tree, (type) => type === NodeHeader);
    if (!header) throw new Error('NodeHeader not found in GroupNode tree');
    expect(header.props.name).toBe('My group');
  });

  it('exposes an accessible name from the title (aria-label)', () => {
    const titled = callGroupNode({ childIds: [], name: 'Payments', width: 300, height: 200 });
    expect(titled.props['aria-label']).toBe('Payments');

    const untitled = callGroupNode({ childIds: [], width: 300, height: 200 });
    expect(untitled.props['aria-label']).toBe('Group');
  });

  it('MUST NOT mount ResizeControls (design §12.3 — resize is served by the overlay)', () => {
    const tree = callGroupNode({ childIds: [], width: 300, height: 200 }, {
      selected: true,
    } as Partial<NodeProps>);
    const controls = findElement(tree, (type) => type === ResizeControls);
    expect(controls).toBeNull();
  });

  it('renders four connection handles with ids t/l/r/b', () => {
    const tree = callGroupNode({ childIds: [], width: 300, height: 200 });
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
    const ids = new Set(handles.map((h) => String((h.props as { id?: string }).id)));
    expect(ids).toEqual(new Set(['t', 'l', 'r', 'b']));
  });

  it('exports a NEGATIVE zIndex so the group paints behind members and edges', () => {
    // Edges sit at zIndex 0 and other nodes leave zIndex undefined (→ 0); the
    // group must be strictly below both, hence negative. This is the z-order
    // contract M5/M9 build on (design §9.6).
    expect(GROUP_NODE_Z_INDEX).toBeLessThan(0);
  });
});
