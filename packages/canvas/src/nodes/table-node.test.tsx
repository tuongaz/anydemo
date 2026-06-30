import { describe, expect, it } from 'bun:test';
import type { NodeProps } from '@xyflow/react';
import * as React from 'react';
import type { TablePatch } from './table-node.tsx';
import { TableNode, type TableNodeType } from './table-node.tsx';

// No-DOM dispatcher shim (same approach as line-node.test.tsx): call the memo'd
// component's inner impl as a plain function and walk the returned element tree.
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
    value !== null && typeof value === 'object' && 'type' in value && 'props' in (value as object)
  );
}

function findAll(tree: unknown, predicate: (el: ReactElementLike) => boolean): ReactElementLike[] {
  const out: ReactElementLike[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const c of node) visit(c);
      return;
    }
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

const byTestId = (tree: unknown, testId: string): ReactElementLike[] =>
  findAll(tree, (el) => el.props['data-testid'] === testId);

const baseData = () => ({
  columns: [
    { id: 'c1', width: 140 },
    { id: 'c2', width: 140 },
  ],
  rows: [
    { id: 'r1', height: 40 },
    { id: 'r2', height: 40 },
  ],
  cells: { 'r1:c1': 'Name', 'r1:c2': 'Age' },
  headerRow: true,
});

function callTableNode(data: Record<string, unknown>, overrides: Partial<NodeProps> = {}): unknown {
  const props = {
    id: 't1',
    type: 'table',
    data,
    selected: false,
    isConnectable: false,
    ...overrides,
  } as unknown as NodeProps<TableNodeType>;
  const impl = (TableNode as unknown as { type: (p: NodeProps<TableNodeType>) => unknown }).type;
  return renderWithHooks(() => impl(props));
}

const noop = () => {};

describe('TableNode', () => {
  it('renders one cell per row × column with the cell text', () => {
    const tree = callTableNode({ ...baseData(), onTableDataChange: noop });
    const cells = byTestId(tree, 'table-cell');
    expect(cells).toHaveLength(4);
    const texts = cells.map((c) => c.props['data-cell']);
    expect(texts).toEqual(['r1:c1', 'r1:c2', 'r2:c1', 'r2:c2']);
  });

  it('renders fully static in view mode (no add/resize affordances)', () => {
    const tree = callTableNode(baseData()); // no onTableDataChange
    expect(byTestId(tree, 'table-cell')).toHaveLength(4);
    expect(byTestId(tree, 'table-add-column')).toHaveLength(0);
    expect(byTestId(tree, 'table-col-resize')).toHaveLength(0);
  });

  it('add-column rail commits an appended column', () => {
    const calls: TablePatch[] = [];
    const tree = callTableNode({
      ...baseData(),
      onTableDataChange: (_id: string, patch: TablePatch) => calls.push(patch),
    });
    const addBtn = byTestId(tree, 'table-add-column')[0];
    expect(addBtn).toBeDefined();
    (addBtn?.props.onClick as (e: { stopPropagation: () => void }) => void)({
      stopPropagation: noop,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.columns).toHaveLength(3);
  });

  it('delete-column control (shown when selected) prunes the column + its cells', () => {
    const calls: TablePatch[] = [];
    const tree = callTableNode(
      { ...baseData(), onTableDataChange: (_id: string, patch: TablePatch) => calls.push(patch) },
      { selected: true },
    );
    const delBtns = byTestId(tree, 'table-delete-column');
    expect(delBtns.length).toBe(2); // one per column (both deletable; 2 > 1)
    const firstCol = delBtns.find((b) => b.props['data-col'] === 'c1');
    (firstCol?.props.onClick as (e: { stopPropagation: () => void }) => void)({
      stopPropagation: noop,
    });
    expect(calls[0]?.columns.map((c) => c.id)).toEqual(['c2']);
    expect('r1:c1' in (calls[0]?.cells ?? {})).toBe(false);
  });

  it('omits the delete-column control when a single column remains', () => {
    const oneCol = {
      columns: [{ id: 'c1', width: 140 }],
      rows: [{ id: 'r1', height: 40 }],
      cells: {},
      onTableDataChange: noop,
    };
    const tree = callTableNode(oneCol, { selected: true });
    expect(byTestId(tree, 'table-delete-column')).toHaveLength(0);
  });
});
