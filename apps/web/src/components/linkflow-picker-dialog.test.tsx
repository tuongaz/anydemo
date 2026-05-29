import { describe, expect, it } from 'bun:test';
import {
  LinkflowPickerDialog,
  type LinkflowPickerDialogProps,
} from '@/components/linkflow-picker-dialog';
import type { FlowSummary } from '@/lib/api';
import * as React from 'react';

// US-003 dialog: hook-shim renderer pattern mirrors flow-create-dialog.test.tsx.
// useState DECLARATION ORDER (slot indices):
//   0: query        (string)
//   1: selectedSlug (string | null)
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: () => void;
};

type SetterCall = { slot: number; value: unknown };

function renderWithHooks<T>(
  fn: () => T,
  stateOverrides: readonly unknown[] = [],
  setterCalls: SetterCall[] = [],
): T {
  const internals = (
    React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: Hooks | null };
      };
    }
  ).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const prev = internals.ReactCurrentDispatcher.current;
  let useStateCall = 0;
  internals.ReactCurrentDispatcher.current = {
    useState: <S,>(initial: S | (() => S)) => {
      const idx = useStateCall++;
      const seeded =
        idx < stateOverrides.length && stateOverrides[idx] !== undefined
          ? (stateOverrides[idx] as S)
          : typeof initial === 'function'
            ? (initial as () => S)()
            : initial;
      const setter = (next: S | ((prev: S) => S)) => {
        const resolved = typeof next === 'function' ? (next as (p: S) => S)(seeded) : (next as S);
        setterCalls.push({ slot: idx, value: resolved });
      };
      return [seeded, setter];
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

function findAll(
  tree: unknown,
  predicate: (el: ReactElementLike) => boolean,
  acc: ReactElementLike[] = [],
): ReactElementLike[] {
  if (Array.isArray(tree)) {
    for (const child of tree) findAll(child, predicate, acc);
    return acc;
  }
  if (!isElement(tree)) return acc;
  if (predicate(tree)) acc.push(tree);
  const children = tree.props.children;
  if (children === undefined || children === null) return acc;
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) findAll(child, predicate, acc);
  return acc;
}

function findByTestId(tree: unknown, id: string): ReactElementLike | null {
  const matches = findAll(
    tree,
    (el) => (el.props as { 'data-testid'?: string })['data-testid'] === id,
  );
  return matches[0] ?? null;
}

function findRows(tree: unknown): ReactElementLike[] {
  return findAll(tree, (el) => {
    const tid = (el.props as { 'data-testid'?: string })['data-testid'];
    return typeof tid === 'string' && tid.startsWith('linkflow-picker-row-');
  });
}

const DEMOS: readonly FlowSummary[] = [
  {
    id: 'a1',
    slug: 'order-pipeline/retry',
    name: 'Retry Lane',
    repoPath: '/tmp/order-pipeline',
    lastModified: 0,
    valid: true,
  },
  {
    id: 'a2',
    slug: 'order-pipeline/edge-cases',
    name: 'Edge Cases',
    repoPath: '/tmp/order-pipeline',
    lastModified: 0,
    valid: true,
  },
  {
    id: 'b1',
    slug: 'inventory/restock',
    name: 'Restock Loop',
    repoPath: '/tmp/inventory',
    lastModified: 0,
    valid: true,
  },
];

function renderDialog(
  props: Partial<LinkflowPickerDialogProps> = {},
  stateOverrides: readonly unknown[] = [],
  setterCalls: SetterCall[] = [],
): unknown {
  const merged: LinkflowPickerDialogProps = {
    open: true,
    onOpenChange: () => {},
    mode: 'link',
    demos: DEMOS,
    onCommit: () => {},
    ...props,
  };
  return renderWithHooks(
    () => (LinkflowPickerDialog as unknown as (p: LinkflowPickerDialogProps) => unknown)(merged),
    stateOverrides,
    setterCalls,
  );
}

describe('LinkflowPickerDialog', () => {
  it('renders the "Link to a flow" title in link mode', () => {
    const tree = renderDialog({ mode: 'link' });
    const title = findByTestId(tree, 'linkflow-picker-title');
    if (!title) throw new Error('title missing');
    expect(title.props.children).toBe('Link to a flow');
  });

  it('renders the "Change linked flow" title in edit mode', () => {
    const tree = renderDialog({
      mode: 'edit',
      initialTarget: { project: 'order-pipeline', flow: 'retry' },
    });
    const title = findByTestId(tree, 'linkflow-picker-title');
    if (!title) throw new Error('title missing');
    expect(title.props.children).toBe('Change linked flow');
  });

  it('renders every demo row when query is empty', () => {
    const tree = renderDialog();
    const rows = findRows(tree);
    expect(rows.length).toBe(DEMOS.length);
  });

  it('filters the list to substring matches on project or flow name (case-insensitive)', () => {
    // Seed slot 0 (query) = 'restock' — should only show the inventory/restock row.
    const tree = renderDialog({}, ['restock']);
    const rows = findRows(tree);
    expect(rows.length).toBe(1);
    expect((rows[0]?.props as { 'data-testid': string })['data-testid']).toBe(
      'linkflow-picker-row-inventory/restock',
    );

    // Project-side match.
    const tree2 = renderDialog({}, ['ORDER']);
    const rows2 = findRows(tree2);
    expect(rows2.length).toBe(2);
  });

  it('pre-selects initialTarget in edit mode', () => {
    const tree = renderDialog({
      mode: 'edit',
      initialTarget: { project: 'inventory', flow: 'restock' },
    });
    const row = findByTestId(tree, 'linkflow-picker-row-inventory/restock');
    if (!row) throw new Error('row missing');
    expect((row.props as { 'data-selected': string })['data-selected']).toBe('true');
    // Commit button enabled when something is selected.
    const commit = findByTestId(tree, 'linkflow-picker-commit');
    if (!commit) throw new Error('commit btn missing');
    expect((commit.props as { disabled?: boolean }).disabled).toBe(false);
  });

  it('keeps the Link button disabled when no row is selected (link mode default)', () => {
    const tree = renderDialog({ mode: 'link' });
    const commit = findByTestId(tree, 'linkflow-picker-commit');
    if (!commit) throw new Error('commit btn missing');
    expect((commit.props as { disabled?: boolean }).disabled).toBe(true);
  });

  it('renders a "Currently viewing" badge on the current-slug row but keeps it selectable', () => {
    const tree = renderDialog({ currentSlug: 'order-pipeline/retry' });
    const badge = findByTestId(tree, 'linkflow-picker-current-badge-order-pipeline/retry');
    expect(badge).not.toBeNull();
    // Row still rendered as a clickable button.
    const row = findByTestId(tree, 'linkflow-picker-row-order-pipeline/retry');
    if (!row) throw new Error('row missing');
    expect((row.props as { onClick?: unknown }).onClick).toBeTypeOf('function');
  });

  it('ArrowDown picks the first row when nothing is selected', () => {
    const setterCalls: SetterCall[] = [];
    const tree = renderDialog({}, [], setterCalls);
    const input = findByTestId(tree, 'linkflow-picker-search');
    if (!input) throw new Error('input missing');
    const onKeyDown = (
      input.props as {
        onKeyDown?: (e: { key: string; preventDefault(): void }) => void;
      }
    ).onKeyDown;
    if (!onKeyDown) throw new Error('onKeyDown missing');

    setterCalls.length = 0;
    onKeyDown({ key: 'ArrowDown', preventDefault: () => {} });

    // Slot 1 = selectedSlug. Expect first row's slug.
    const selCalls = setterCalls.filter((c) => c.slot === 1);
    expect(selCalls.length).toBe(1);
    expect(selCalls[0]?.value).toBe(DEMOS[0]?.slug);
  });

  it('ArrowDown advances within the filtered list, wrapping at the end', () => {
    const setterCalls: SetterCall[] = [];
    // Seed: query empty, selectedSlug = the LAST row → ArrowDown should wrap to index 0.
    const last = DEMOS[DEMOS.length - 1]?.slug;
    const tree = renderDialog({}, ['', last], setterCalls);
    const input = findByTestId(tree, 'linkflow-picker-search');
    if (!input) throw new Error('input missing');
    const onKeyDown = (
      input.props as {
        onKeyDown?: (e: { key: string; preventDefault(): void }) => void;
      }
    ).onKeyDown;
    if (!onKeyDown) throw new Error('onKeyDown missing');

    setterCalls.length = 0;
    onKeyDown({ key: 'ArrowDown', preventDefault: () => {} });

    const selCalls = setterCalls.filter((c) => c.slot === 1);
    expect(selCalls.length).toBe(1);
    expect(selCalls[0]?.value).toBe(DEMOS[0]?.slug);
  });

  it('ArrowUp picks the last row when nothing is selected', () => {
    const setterCalls: SetterCall[] = [];
    const tree = renderDialog({}, [], setterCalls);
    const input = findByTestId(tree, 'linkflow-picker-search');
    if (!input) throw new Error('input missing');
    const onKeyDown = (
      input.props as {
        onKeyDown?: (e: { key: string; preventDefault(): void }) => void;
      }
    ).onKeyDown;
    if (!onKeyDown) throw new Error('onKeyDown missing');

    setterCalls.length = 0;
    onKeyDown({ key: 'ArrowUp', preventDefault: () => {} });

    const selCalls = setterCalls.filter((c) => c.slot === 1);
    expect(selCalls.length).toBe(1);
    expect(selCalls[0]?.value).toBe(DEMOS[DEMOS.length - 1]?.slug);
  });

  it('Enter commits the selected target and closes the dialog', () => {
    let committed: unknown = null;
    let openChange: unknown = null;
    const tree = renderDialog(
      {
        onCommit: (t) => {
          committed = t;
        },
        onOpenChange: (next) => {
          openChange = next;
        },
      },
      ['', 'order-pipeline/edge-cases'],
    );
    const input = findByTestId(tree, 'linkflow-picker-search');
    if (!input) throw new Error('input missing');
    const onKeyDown = (
      input.props as {
        onKeyDown?: (e: { key: string; preventDefault(): void }) => void;
      }
    ).onKeyDown;
    if (!onKeyDown) throw new Error('onKeyDown missing');

    onKeyDown({ key: 'Enter', preventDefault: () => {} });

    expect(committed).toEqual({ project: 'order-pipeline', flow: 'edge-cases' });
    expect(openChange).toBe(false);
  });

  it('Enter is a no-op when no row is selected', () => {
    let committed: unknown = null;
    let openChange: unknown = null;
    const tree = renderDialog({
      onCommit: (t) => {
        committed = t;
      },
      onOpenChange: (next) => {
        openChange = next;
      },
    });
    const input = findByTestId(tree, 'linkflow-picker-search');
    if (!input) throw new Error('input missing');
    const onKeyDown = (
      input.props as {
        onKeyDown?: (e: { key: string; preventDefault(): void }) => void;
      }
    ).onKeyDown;
    if (!onKeyDown) throw new Error('onKeyDown missing');

    onKeyDown({ key: 'Enter', preventDefault: () => {} });

    expect(committed).toBeNull();
    expect(openChange).toBeNull();
  });

  it('Escape closes the dialog without committing', () => {
    let committed: unknown = null;
    let openChange: unknown = null;
    const tree = renderDialog(
      {
        onCommit: (t) => {
          committed = t;
        },
        onOpenChange: (next) => {
          openChange = next;
        },
      },
      ['', 'order-pipeline/retry'],
    );
    const input = findByTestId(tree, 'linkflow-picker-search');
    if (!input) throw new Error('input missing');
    const onKeyDown = (
      input.props as {
        onKeyDown?: (e: { key: string; preventDefault(): void }) => void;
      }
    ).onKeyDown;
    if (!onKeyDown) throw new Error('onKeyDown missing');

    onKeyDown({ key: 'Escape', preventDefault: () => {} });

    expect(committed).toBeNull();
    expect(openChange).toBe(false);
  });

  it('binds aria-activedescendant on the search input to the selected row id', () => {
    const tree = renderDialog({}, ['', 'order-pipeline/retry']);
    const input = findByTestId(tree, 'linkflow-picker-search');
    if (!input) throw new Error('input missing');
    const ad = (input.props as { 'aria-activedescendant'?: string })['aria-activedescendant'];
    expect(ad).toBe('linkflow-picker-row-order-pipeline__retry');
  });

  it('omits aria-activedescendant when nothing is selected', () => {
    const tree = renderDialog({ mode: 'link' });
    const input = findByTestId(tree, 'linkflow-picker-search');
    if (!input) throw new Error('input missing');
    const ad = (input.props as { 'aria-activedescendant'?: string })['aria-activedescendant'];
    expect(ad).toBeUndefined();
  });

  it('clicking a row updates the selection (and does not commit)', () => {
    const setterCalls: SetterCall[] = [];
    let committed: unknown = null;
    const tree = renderDialog(
      {
        onCommit: (t) => {
          committed = t;
        },
      },
      [],
      setterCalls,
    );
    const row = findByTestId(tree, 'linkflow-picker-row-inventory/restock');
    if (!row) throw new Error('row missing');
    const onClick = (row.props as { onClick?: () => void }).onClick;
    if (!onClick) throw new Error('onClick missing');

    setterCalls.length = 0;
    onClick();

    const selCalls = setterCalls.filter((c) => c.slot === 1);
    expect(selCalls.length).toBe(1);
    expect(selCalls[0]?.value).toBe('inventory/restock');
    expect(committed).toBeNull();
  });
});
