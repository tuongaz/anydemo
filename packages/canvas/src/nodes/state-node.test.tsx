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

// The header's icon trigger is mounted as the `anchor` prop of an
// IconPickerPopover (function-typed element in the tree). The popover itself
// is never rendered by the hook-shim, so `findElement` won't see the button
// via child traversal — it lives off the popover's `anchor` prop instead.
function findHeaderPopover(tree: unknown): ReactElementLike | null {
  const header = findHeader(tree);
  return findElement(
    header,
    (el) =>
      typeof el.type === 'function' &&
      typeof (el.props as { onPick?: unknown }).onPick === 'function',
  );
}

describe('StateNode editable header icon', () => {
  it('wraps the icon in a popover trigger button when selected + onIconChange wired', () => {
    const tree = callStateNode({ icon: 'server', onIconChange: () => {} }, { selected: true });
    const popover = findHeaderPopover(tree);
    expect(popover).not.toBeNull();
    const anchor = (popover?.props as { anchor?: unknown }).anchor;
    if (!isElement(anchor)) throw new Error('expected popover anchor element');
    expect(anchor.props['data-testid']).toBe('state-node-icon-trigger');
    expect(anchor.type).toBe('button');
    const icon = findElement(anchor, (el) => el.type === Icon);
    expect(icon).not.toBeNull();
    expect((icon?.props as { name?: string }).name).toBe('server');
  });

  it('falls back to a static Icon when the node is not selected', () => {
    const tree = callStateNode({ icon: 'server', onIconChange: () => {} });
    expect(findHeaderPopover(tree)).toBeNull();
    // Icon still renders, just without the popover wrapper.
    expect(findHeaderIcon(tree)).not.toBeNull();
  });

  it('forwards picked names (and null) through onIconChange', () => {
    const calls: Array<[string, string | null]> = [];
    const tree = callStateNode(
      { icon: 'server', onIconChange: (id: string, icon: string | null) => calls.push([id, icon]) },
      { selected: true },
    );
    const popover = findHeaderPopover(tree);
    expect(popover).not.toBeNull();
    const onPick = (popover?.props as { onPick: (name: string | null) => void }).onPick;
    onPick('database');
    onPick(null);
    expect(calls).toEqual([
      ['s1', 'database'],
      ['s1', null],
    ]);
  });
});

describe('StateNode status pill (status uplift)', () => {
  it('renders no visible pill when there is no status or statusReport', () => {
    const tree = callStateNode({});
    // StatusIconPill is a function component invoked with visualStatus='idle';
    // it returns null. Either no PillElement appears in the tree, or it does
    // but its rendered output is null. The assertion that matters: no element
    // with a visual-status attribute survives.
    const visualEl = findElement(
      tree,
      (el) => (el.props as { 'data-visual-status'?: string })['data-visual-status'] !== undefined,
    );
    expect(visualEl).toBeNull();
  });

  it('renders the active pill when status is running', () => {
    const tree = callStateNode({ status: 'running' });
    const pill = findElement(
      tree,
      (el) =>
        typeof el.type === 'function' &&
        (el.props as { visualStatus?: string }).visualStatus === 'active',
    );
    expect(pill).not.toBeNull();
  });

  it('renders the success pill when statusReport.state is ok', () => {
    const tree = callStateNode({ statusReport: { state: 'ok', summary: 'All good', ts: 1 } });
    const pill = findElement(
      tree,
      (el) =>
        typeof el.type === 'function' &&
        (el.props as { visualStatus?: string }).visualStatus === 'success',
    );
    expect(pill).not.toBeNull();
  });

  it('renders the error pill when statusReport.state is error', () => {
    const tree = callStateNode({ statusReport: { state: 'error', summary: 'Down', ts: 1 } });
    const pill = findElement(
      tree,
      (el) =>
        typeof el.type === 'function' &&
        (el.props as { visualStatus?: string }).visualStatus === 'error',
    );
    expect(pill).not.toBeNull();
  });
});
