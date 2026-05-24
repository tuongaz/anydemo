import { describe, expect, it, mock } from 'bun:test';
import type { CSSProperties } from 'react';
import * as React from 'react';
import { IconPickerPopover } from '../../components/icon-picker-popover.tsx';
import { InlineEdit } from '../../components/inline-edit.tsx';
import { colorTokenStyle } from '../../lib/color-tokens.ts';
import { Icon } from '../../ui/icon.tsx';
import { NodeHeader, type NodeHeaderProps } from './node-header.tsx';

// Hook-shim renderer pattern from image-node.test.tsx, with useStateOverrides
// support borrowed from rectangle-node.test.tsx so individual tests can pin
// `editing` or `iconPickerOpen` to true. useState declaration order in
// NodeHeader: 0 = editing, 1 = iconPickerOpen.
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

function findByTestId(tree: unknown, testId: string): ReactElementLike | null {
  return findElement(
    tree,
    (el) => (el.props as { 'data-testid'?: string })['data-testid'] === testId,
  );
}

function callNodeHeader(
  props: Partial<NodeHeaderProps> = {},
  useStateOverrides?: ReadonlyArray<unknown>,
): unknown {
  const full: NodeHeaderProps = {
    nodeId: 'n1',
    name: 'Hello',
    ...props,
  };
  return renderWithHooks(() => NodeHeader(full), useStateOverrides);
}

describe('NodeHeader — static render', () => {
  it('emits the default node-header / node-title testids', () => {
    const tree = callNodeHeader();
    expect(findByTestId(tree, 'node-header')).not.toBeNull();
    expect(findByTestId(tree, 'node-title')).not.toBeNull();
  });

  it('accepts custom testId / titleTestId for per-host naming', () => {
    const tree = callNodeHeader({
      testId: 'component-node-header',
      titleTestId: 'component-node-title',
    });
    expect(findByTestId(tree, 'component-node-header')).not.toBeNull();
    expect(findByTestId(tree, 'component-node-title')).not.toBeNull();
    expect(findByTestId(tree, 'node-header')).toBeNull();
  });

  it('renders the name as the title text when read-only', () => {
    const tree = callNodeHeader({ name: 'Counter card' });
    const title = findByTestId(tree, 'node-title');
    expect((title?.props as { children?: unknown })?.children).toBe('Counter card');
  });

  it('omits the icon when icon is null or undefined', () => {
    const treeNull = callNodeHeader({ icon: null });
    expect(findAll(treeNull, (el) => el.type === Icon)).toHaveLength(0);
    const treeUndef = callNodeHeader({});
    expect(findAll(treeUndef, (el) => el.type === Icon)).toHaveLength(0);
  });

  it('renders a 16px Icon when icon is set (and not editable)', () => {
    const tree = callNodeHeader({ icon: 'sparkles' });
    const icons = findAll(tree, (el) => el.type === Icon);
    expect(icons).toHaveLength(1);
    const iconProps = icons[0]?.props as { name?: string; size?: number };
    expect(iconProps.name).toBe('sparkles');
    expect(iconProps.size).toBe(16);
  });

  it('applies italic placeholder classes on the title when name is empty', () => {
    const tree = callNodeHeader({ name: '' });
    const title = findByTestId(tree, 'node-title');
    const className = (title?.props as { className?: string })?.className ?? '';
    expect(className).toContain('sf:italic');
    expect(className).toContain('sf:text-muted-foreground/40');
  });
});

describe('NodeHeader — trailing slot', () => {
  it('renders the trailing node as the last child of the header bar', () => {
    const marker = { type: 'span', props: { 'data-testid': 'trailing-marker', children: 'x' } };
    // biome-ignore lint/suspicious/noExplicitAny: minimal ReactElement-shaped literal for test
    const tree = callNodeHeader({ trailing: marker as any });
    expect(findByTestId(tree, 'trailing-marker')).not.toBeNull();
  });

  it('renders nothing in the trailing position when trailing is undefined', () => {
    const tree = callNodeHeader();
    // The header bar has icon (here: none) + title + trailing. With no icon and
    // no trailing, the only meaningful child is the title.
    expect(findByTestId(tree, 'trailing-marker')).toBeNull();
  });
});

describe('NodeHeader — name editing', () => {
  it('omits onDoubleClick when onNameChange is not wired', () => {
    const tree = callNodeHeader();
    const header = findByTestId(tree, 'node-header');
    expect((header?.props as { onDoubleClick?: unknown }).onDoubleClick).toBeUndefined();
  });

  it('renders an InlineEdit (not the static button) when editing override is true', () => {
    const onName = mock(() => {});
    const tree = callNodeHeader({ onNameChange: onName, name: 'Original' }, [true]);
    const edits = findAll(tree, (el) => el.type === InlineEdit);
    expect(edits).toHaveLength(1);
    const editProps = edits[0]?.props as {
      initialValue?: string;
      field?: string;
      commitMode?: string;
      placeholder?: string;
    };
    expect(editProps.initialValue).toBe('Original');
    expect(editProps.field).toBe('node-name');
    expect(editProps.commitMode).toBe('blur-only');
    expect(editProps.placeholder).toBe('Name');
  });

  it('InlineEdit onCommit forwards (nodeId, value) to onNameChange', () => {
    const onName = mock(() => {});
    const tree = callNodeHeader({ nodeId: 'r7', onNameChange: onName }, [true]);
    const edit = findAll(tree, (el) => el.type === InlineEdit)[0];
    const onCommit = (edit?.props as { onCommit?: (v: string) => void }).onCommit;
    onCommit?.('Renamed');
    expect(onName).toHaveBeenCalledTimes(1);
    expect(onName).toHaveBeenCalledWith('r7', 'Renamed');
  });

  it('wires onDoubleClick when onNameChange is provided', () => {
    const tree = callNodeHeader({ onNameChange: () => {} });
    const header = findByTestId(tree, 'node-header');
    expect(typeof (header?.props as { onDoubleClick?: unknown }).onDoubleClick).toBe('function');
  });
});

describe('NodeHeader — icon picker', () => {
  const baseEditable = {
    icon: 'sparkles',
    selected: true,
    onIconChange: () => {},
  };

  it('renders an IconPickerPopover when selected + icon + onIconChange are all set', () => {
    const tree = callNodeHeader(baseEditable);
    const pickers = findAll(tree, (el) => el.type === IconPickerPopover);
    expect(pickers).toHaveLength(1);
  });

  it('renders a plain Icon (no picker) when not selected', () => {
    const tree = callNodeHeader({ ...baseEditable, selected: false });
    expect(findAll(tree, (el) => el.type === IconPickerPopover)).toHaveLength(0);
    expect(findAll(tree, (el) => el.type === Icon)).toHaveLength(1);
  });

  it('renders a plain Icon (no picker) when onIconChange is undefined', () => {
    const tree = callNodeHeader({ icon: 'sparkles', selected: true });
    expect(findAll(tree, (el) => el.type === IconPickerPopover)).toHaveLength(0);
    expect(findAll(tree, (el) => el.type === Icon)).toHaveLength(1);
  });

  it('renders nothing when icon is falsy (no picker even if onIconChange + selected)', () => {
    const tree = callNodeHeader({ ...baseEditable, icon: null });
    expect(findAll(tree, (el) => el.type === IconPickerPopover)).toHaveLength(0);
    expect(findAll(tree, (el) => el.type === Icon)).toHaveLength(0);
  });

  it('icon-trigger button stops onClick / onMouseDown / onDoubleClick propagation', () => {
    const tree = callNodeHeader(baseEditable);
    const picker = findAll(tree, (el) => el.type === IconPickerPopover)[0];
    const anchor = (picker?.props as { anchor?: ReactElementLike }).anchor;
    if (!anchor) throw new Error('expected picker anchor');
    const triggerProps = anchor.props as {
      onClick?: (e: { stopPropagation: () => void }) => void;
      onMouseDown?: (e: { stopPropagation: () => void }) => void;
      onDoubleClick?: (e: { stopPropagation: () => void }) => void;
    };
    let stops = 0;
    const fakeEvent = {
      stopPropagation: () => {
        stops++;
      },
    };
    triggerProps.onClick?.(fakeEvent);
    triggerProps.onMouseDown?.(fakeEvent);
    triggerProps.onDoubleClick?.(fakeEvent);
    expect(stops).toBe(3);
  });

  it('onPick forwards (nodeId, picked) to onIconChange (including null for clear)', () => {
    const onIcon = mock(() => {});
    const tree = callNodeHeader({ ...baseEditable, nodeId: 'r9', onIconChange: onIcon });
    const picker = findAll(tree, (el) => el.type === IconPickerPopover)[0];
    const onPick = (picker?.props as { onPick?: (n: string | null) => void }).onPick;
    onPick?.('star');
    onPick?.(null);
    expect(onIcon).toHaveBeenCalledTimes(2);
    expect(onIcon).toHaveBeenNthCalledWith(1, 'r9', 'star');
    expect(onIcon).toHaveBeenNthCalledWith(2, 'r9', null);
  });
});

describe('NodeHeader — title styling', () => {
  it('applies fontSize as an inline style on the title', () => {
    const tree = callNodeHeader({ fontSize: 24 });
    const title = findByTestId(tree, 'node-title');
    const style = (title?.props as { style?: CSSProperties }).style ?? {};
    expect(style.fontSize).toBe('24px');
  });

  it('applies textColor token via colorTokenStyle on the title', () => {
    const tree = callNodeHeader({ textColor: 'blue' });
    const title = findByTestId(tree, 'node-title');
    const style = (title?.props as { style?: CSSProperties }).style ?? {};
    const expected = colorTokenStyle('blue', 'text');
    expect(style.color).toBe(expected.color);
  });

  it('emits no fontSize key when fontSize is undefined', () => {
    const tree = callNodeHeader();
    const title = findByTestId(tree, 'node-title');
    const style = (title?.props as { style?: CSSProperties }).style ?? {};
    expect(style.fontSize).toBeUndefined();
  });
});
