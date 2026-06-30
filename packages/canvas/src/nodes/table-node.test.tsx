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

const classTokens = (el: ReactElementLike): string[] =>
  typeof el.props.className === 'string' ? el.props.className.split(/\s+/) : [];

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

  it('centers cell content (flex centering, not top-left)', () => {
    const tree = callTableNode({ ...baseData(), onTableDataChange: noop });
    const cell = byTestId(tree, 'table-cell')[0];
    expect(cell).toBeDefined();
    const tokens = classTokens(cell as ReactElementLike);
    expect(tokens).toContain('sf:flex');
    expect(tokens).toContain('sf:items-center');
    expect(tokens).toContain('sf:justify-center');
  });

  it('renders fully static in view mode (no add/resize affordances)', () => {
    const tree = callTableNode(baseData()); // no onTableDataChange
    expect(byTestId(tree, 'table-cell')).toHaveLength(4);
    expect(byTestId(tree, 'table-add-column')).toHaveLength(0);
    expect(byTestId(tree, 'table-col-resize')).toHaveLength(0);
    expect(byTestId(tree, 'table-resize')).toHaveLength(0);
  });

  it('marks column/row dividers with the plain React Flow `nodrag` class', () => {
    const tree = callTableNode({ ...baseData(), onTableDataChange: noop });
    const colDivider = byTestId(tree, 'table-col-resize')[0];
    expect(colDivider).toBeDefined();
    // Plain `nodrag` token — NOT the Tailwind-prefixed `sf:nodrag`, which React
    // Flow does not recognise (the whole-node drag would otherwise win).
    expect(classTokens(colDivider as ReactElementLike)).toContain('nodrag');
  });

  it('renders only internal column/row dividers (n-1), not one on the outer edge', () => {
    const tree = callTableNode({ ...baseData(), onTableDataChange: noop });
    // 2 columns → 1 internal divider; 2 rows → 1 internal divider.
    expect(byTestId(tree, 'table-col-resize')).toHaveLength(1);
    expect(byTestId(tree, 'table-col-resize')[0]?.props['data-col']).toBe('c1');
    expect(byTestId(tree, 'table-row-resize')).toHaveLength(1);
    expect(byTestId(tree, 'table-row-resize')[0]?.props['data-row']).toBe('r1');
  });

  it('exposes whole-table resize handles when selected (origin-preserving set)', () => {
    const tree = callTableNode({ ...baseData(), onTableDataChange: noop }, { selected: true });
    const handles = byTestId(tree, 'table-resize');
    const positions = handles.map((h) => h.props['data-position']).sort();
    expect(positions).toEqual(['bottom', 'bottom-right', 'right']);
  });

  it('add-column rail commits an appended column', () => {
    const calls: TablePatch[] = [];
    const tree = callTableNode(
      {
        ...baseData(),
        onTableDataChange: (_id: string, patch: TablePatch) => calls.push(patch),
      },
      { selected: true },
    );
    const addBtn = byTestId(tree, 'table-add-column')[0];
    expect(addBtn).toBeDefined();
    (addBtn?.props.onClick as (e: { stopPropagation: () => void }) => void)({
      stopPropagation: noop,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.columns).toHaveLength(3);
  });

  it('add-row rail commits an appended row', () => {
    const calls: TablePatch[] = [];
    const tree = callTableNode(
      {
        ...baseData(),
        onTableDataChange: (_id: string, patch: TablePatch) => calls.push(patch),
      },
      { selected: true },
    );
    const addBtn = byTestId(tree, 'table-add-row')[0];
    expect(addBtn).toBeDefined();
    (addBtn?.props.onClick as (e: { stopPropagation: () => void }) => void)({
      stopPropagation: noop,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.rows).toHaveLength(3);
  });

  it('delete-column control prunes the column + its cells', () => {
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

  it('offers a + on all four sides (prepend + append, both axes)', () => {
    const tree = callTableNode({ ...baseData(), onTableDataChange: noop }, { selected: true });
    for (const testId of [
      'table-add-column', // right / append
      'table-add-column-before', // left / prepend
      'table-add-row', // bottom / append
      'table-add-row-before', // top / prepend
    ]) {
      expect(byTestId(tree, testId)).toHaveLength(1);
    }
  });

  it('prepend-column adds a column at index 0', () => {
    const calls: TablePatch[] = [];
    const tree = callTableNode(
      { ...baseData(), onTableDataChange: (_id: string, patch: TablePatch) => calls.push(patch) },
      { selected: true },
    );
    const before = byTestId(tree, 'table-add-column-before')[0];
    (before?.props.onClick as (e: { stopPropagation: () => void }) => void)({
      stopPropagation: noop,
    });
    const ids = calls[0]?.columns.map((c) => c.id) ?? [];
    expect(ids).toHaveLength(3);
    expect(ids.slice(1)).toEqual(['c1', 'c2']); // the new column landed at index 0
  });

  it('prepend-row adds a row at index 0', () => {
    const calls: TablePatch[] = [];
    const tree = callTableNode(
      { ...baseData(), onTableDataChange: (_id: string, patch: TablePatch) => calls.push(patch) },
      { selected: true },
    );
    const before = byTestId(tree, 'table-add-row-before')[0];
    (before?.props.onClick as (e: { stopPropagation: () => void }) => void)({
      stopPropagation: noop,
    });
    expect(calls[0]?.rows.map((r) => r.id).slice(1)).toEqual(['r1', 'r2']);
  });

  it('absolutely positions every add/remove control (so left/top apply)', () => {
    const tree = callTableNode({ ...baseData(), onTableDataChange: noop }, { selected: true });
    for (const testId of [
      'table-add-column',
      'table-add-column-before',
      'table-add-row',
      'table-add-row-before',
      'table-delete-column',
      'table-delete-row',
      'table-toggle-header',
    ]) {
      const els = byTestId(tree, testId);
      expect(els.length).toBeGreaterThan(0);
      for (const el of els) {
        // Without sf:absolute the inline left/top are ignored and the buttons
        // collapse into normal flow (the stacked-× bug).
        expect(classTokens(el)).toContain('sf:absolute');
      }
    }
  });

  it('delete-row control prunes the row + its cells', () => {
    const calls: TablePatch[] = [];
    const tree = callTableNode(
      { ...baseData(), onTableDataChange: (_id: string, patch: TablePatch) => calls.push(patch) },
      { selected: true },
    );
    const delBtns = byTestId(tree, 'table-delete-row');
    expect(delBtns.length).toBe(2);
    const firstRow = delBtns.find((b) => b.props['data-row'] === 'r1');
    (firstRow?.props.onClick as (e: { stopPropagation: () => void }) => void)({
      stopPropagation: noop,
    });
    expect(calls[0]?.rows.map((r) => r.id)).toEqual(['r2']);
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

  it('shows the add/remove chrome only while the node is selected', () => {
    const unselected = callTableNode(
      { ...baseData(), onTableDataChange: noop },
      { selected: false },
    );
    expect(byTestId(unselected, 'table-add-column')).toHaveLength(0);
    expect(byTestId(unselected, 'table-add-row')).toHaveLength(0);
    expect(byTestId(unselected, 'table-delete-column')).toHaveLength(0);
    expect(byTestId(unselected, 'table-toggle-header')).toHaveLength(0);
    // Dividers remain available in edit mode (resize the boundary, no chrome).
    expect(byTestId(unselected, 'table-col-resize')).toHaveLength(1);

    const selected = callTableNode({ ...baseData(), onTableDataChange: noop }, { selected: true });
    expect(byTestId(selected, 'table-add-column')).toHaveLength(1);
    expect(byTestId(selected, 'table-toggle-header')).toHaveLength(1);
  });

  it('header toggle reflects state and flips it on click', () => {
    const calls: TablePatch[] = [];
    const tree = callTableNode(
      { ...baseData(), onTableDataChange: (_id: string, patch: TablePatch) => calls.push(patch) },
      { selected: true },
    );
    const toggle = byTestId(tree, 'table-toggle-header')[0];
    expect(toggle?.props['data-active']).toBe('true'); // baseData has headerRow: true
    (toggle?.props.onClick as (e: { stopPropagation: () => void }) => void)({
      stopPropagation: noop,
    });
    expect(calls[0]?.headerRow).toBe(false);
  });

  it('renders the first row bold + filled when headerRow is on', () => {
    const tree = callTableNode({ ...baseData(), onTableDataChange: noop });
    const firstCell = byTestId(tree, 'table-cell').find((c) => c.props['data-cell'] === 'r1:c1');
    const tokens = classTokens(firstCell as ReactElementLike);
    expect(tokens).toContain('sf:font-bold');
    expect(tokens).toContain('sf:bg-muted');
  });
});
