import { describe, expect, it } from 'bun:test';
import { FlowSwitcher, type FlowSwitcherProps } from '@/components/flow-switcher';
import * as React from 'react';

// apps/web tests run without a DOM. Shim React's internal hook dispatcher so we
// can call FlowSwitcher as a function and walk the returned tree directly.
// Same pattern used by command-palette.test.tsx.
//
// `stateOverrides` lets a test seed useState calls in source order — the
// switcher has one (`open`). Override slot 0 to `true` to render the popover
// content inline; undefined keeps the component's own initial value.
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: () => void;
};

function renderWithHooks<T>(fn: () => T, stateOverrides: readonly unknown[] = []): T {
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
      if (idx < stateOverrides.length && stateOverrides[idx] !== undefined) {
        return [stateOverrides[idx] as S, () => {}];
      }
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

function findAllByTestIdPrefix(tree: unknown, prefix: string): ReactElementLike[] {
  return findAll(tree, (el) => {
    const id = (el.props as { 'data-testid'?: string })['data-testid'];
    return typeof id === 'string' && id.startsWith(prefix);
  });
}

const FLOWS: FlowSwitcherProps['flows'] = [
  { flowSlug: 'main', name: 'Main', isDefault: true },
  { flowSlug: 'retry', name: 'Retry', icon: '↩', isDefault: false },
  { flowSlug: 'cleanup', name: 'Cleanup', isDefault: false },
];

function renderSwitcher(props: Partial<FlowSwitcherProps> = {}, open = true): unknown {
  const merged: FlowSwitcherProps = {
    project: 'order-pipeline',
    activeFlow: 'main',
    flows: FLOWS,
    ...props,
  };
  // useState order in FlowSwitcher: [open]. Pass `true` to surface the
  // popover content in the rendered tree.
  return renderWithHooks(
    () => (FlowSwitcher as unknown as (p: FlowSwitcherProps) => unknown)(merged),
    [open],
  );
}

describe('FlowSwitcher', () => {
  it('renders the trigger labelled with the current flow name', () => {
    const tree = renderSwitcher({}, false);
    const trigger = findByTestId(tree, 'flow-switcher-trigger');
    if (!trigger) throw new Error('trigger missing');
    // The Button wraps a <span>{current.name}</span> — find it among descendants.
    const labels = findAll(trigger, (el) => {
      const children = el.props.children;
      return typeof children === 'string' && children === 'Main';
    });
    expect(labels.length).toBe(1);
  });

  it('renders one row per flow when the popover is open', () => {
    const tree = renderSwitcher();
    for (const flow of FLOWS) {
      const row = findByTestId(tree, `flow-switcher-row-${flow.flowSlug}`);
      if (!row) throw new Error(`row missing for ${flow.flowSlug}`);
      expect(row).not.toBeNull();
    }
    const rows = findAllByTestIdPrefix(tree, 'flow-switcher-row-');
    expect(rows.length).toBe(FLOWS.length);
  });

  it('marks the active row with aria-current="true" and data-active="true"', () => {
    const tree = renderSwitcher({ activeFlow: 'retry' });
    const activeRow = findByTestId(tree, 'flow-switcher-row-retry');
    if (!activeRow) throw new Error('active row missing');
    expect(activeRow.props['aria-current']).toBe('true');
    expect((activeRow.props as { 'data-active'?: string })['data-active']).toBe('true');

    const inactiveRow = findByTestId(tree, 'flow-switcher-row-main');
    if (!inactiveRow) throw new Error('inactive row missing');
    expect(inactiveRow.props['aria-current']).toBeUndefined();
    expect((inactiveRow.props as { 'data-active'?: string })['data-active']).toBeUndefined();
  });

  it('renders the popover content with the documented test id', () => {
    const tree = renderSwitcher();
    const popover = findByTestId(tree, 'flow-switcher-popover');
    expect(popover).not.toBeNull();
  });

  it('renders the "+ New flow" footer button with data-testid="flow-switcher-create"', () => {
    const tree = renderSwitcher();
    const create = findByTestId(tree, 'flow-switcher-create');
    if (!create) throw new Error('create row missing');
    expect(create).not.toBeNull();
    // The label "New flow" should appear inside the row.
    const labels = findAll(create, (el) => {
      const children = el.props.children;
      return typeof children === 'string' && children === 'New flow';
    });
    expect(labels.length).toBe(1);
  });

  it('renders per-row rename + delete buttons with prefixed test ids', () => {
    const tree = renderSwitcher();
    for (const flow of FLOWS) {
      const rename = findByTestId(tree, `flow-switcher-rename-${flow.flowSlug}`);
      const remove = findByTestId(tree, `flow-switcher-delete-${flow.flowSlug}`);
      if (!rename) throw new Error(`rename missing for ${flow.flowSlug}`);
      if (!remove) throw new Error(`delete missing for ${flow.flowSlug}`);
      expect(rename.props['aria-label']).toBe(`Rename ${flow.name}`);
      expect(remove.props['aria-label']).toBe(`Delete ${flow.name}`);
    }
  });

  it('marks the default flow with a "default" badge', () => {
    const tree = renderSwitcher();
    const defaultBadges = findAll(tree, (el) => {
      const children = el.props.children;
      return typeof children === 'string' && children === 'default';
    });
    // FLOWS has exactly one default entry (main).
    expect(defaultBadges.length).toBe(1);
  });

  it('renders the empty-state message when flows is empty', () => {
    const tree = renderSwitcher({ flows: [] });
    const rows = findAllByTestIdPrefix(tree, 'flow-switcher-row-');
    expect(rows.length).toBe(0);
    // The "+ New flow" footer should still render even with no flows.
    const create = findByTestId(tree, 'flow-switcher-create');
    expect(create).not.toBeNull();
  });

  it('trigger has aria-expanded reflecting the popover open state', () => {
    const openTree = renderSwitcher({}, true);
    const openTrigger = findByTestId(openTree, 'flow-switcher-trigger');
    if (!openTrigger) throw new Error('open trigger missing');
    expect(openTrigger.props['aria-expanded']).toBe(true);

    const closedTree = renderSwitcher({}, false);
    const closedTrigger = findByTestId(closedTree, 'flow-switcher-trigger');
    if (!closedTrigger) throw new Error('closed trigger missing');
    expect(closedTrigger.props['aria-expanded']).toBe(false);
  });

  it('trigger falls back to activeFlow slug when no matching entry is in flows', () => {
    const tree = renderSwitcher({ activeFlow: 'orphan' }, false);
    const trigger = findByTestId(tree, 'flow-switcher-trigger');
    if (!trigger) throw new Error('trigger missing');
    const labels = findAll(trigger, (el) => {
      const children = el.props.children;
      return typeof children === 'string' && children === 'orphan';
    });
    expect(labels.length).toBe(1);
  });
});
