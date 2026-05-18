import { describe, expect, it, mock } from 'bun:test';
import type { ChangeEvent } from 'react';
import * as React from 'react';
import { IconPickerBody, type IconPickerBodyProps, filterIcons } from './icon-picker-popover.tsx';

// Same dispatcher-shim trick used by icon-node.test.tsx — apps/web tests run
// without a DOM, so we can't mount the real component tree. Instead we shim
// React's internal hook dispatcher and call IconPickerBody as a function. The
// returned tree is the first render with sub-components captured as placeholders
// (their bodies never execute), which is fine because IconPickerBody renders
// every <input> and tile <button> inline.
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

function findAll(
  tree: unknown,
  predicate: (el: ReactElementLike) => boolean,
  acc: ReactElementLike[] = [],
): ReactElementLike[] {
  if (!isElement(tree)) return acc;
  if (predicate(tree)) acc.push(tree);
  const children = tree.props.children;
  if (children === undefined || children === null) return acc;
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) findAll(child, predicate, acc);
  return acc;
}

function callBody(overrides: Partial<IconPickerBodyProps> = {}): unknown {
  const props: IconPickerBodyProps = {
    query: '',
    onQueryChange: () => {},
    recents: [],
    onPick: () => {},
    ...overrides,
  };
  return renderWithHooks(() =>
    (IconPickerBody as unknown as (p: IconPickerBodyProps) => unknown)(props),
  );
}

function testIdEquals(id: string) {
  return (el: ReactElementLike) => (el.props as { 'data-testid'?: string })['data-testid'] === id;
}

describe('filterIcons', () => {
  it('returns all names (a copy) when the query is empty or whitespace', () => {
    const names = ['shopping-cart', 'apple', 'a-arrow-down'];
    const all = filterIcons(names, '');
    expect(all).toEqual(names);
    // Returns a copy, not the same reference, so callers can mutate safely.
    expect(all).not.toBe(names);
    expect(filterIcons(names, '   ')).toEqual(names);
  });

  it('filters by case-insensitive substring match', () => {
    const names = ['shopping-cart', 'apple', 'shop', 'circle-help'];
    expect(filterIcons(names, 'SHOP')).toEqual(['shopping-cart', 'shop']);
    expect(filterIcons(names, 'help')).toEqual(['circle-help']);
    expect(filterIcons(names, 'xyz')).toEqual([]);
  });
});

describe('IconPickerBody', () => {
  it('typing into the search input forwards the new value via onQueryChange', () => {
    const onQueryChange = mock(() => {});
    const tree = callBody({ onQueryChange });
    const input = findElement(tree, testIdEquals('icon-picker-search'));
    if (!input) throw new Error('search input not found');
    const onChange = input.props.onChange as (e: ChangeEvent<HTMLInputElement>) => void;
    onChange({ target: { value: 'shopping' } } as unknown as ChangeEvent<HTMLInputElement>);
    expect(onQueryChange).toHaveBeenCalledTimes(1);
    expect(onQueryChange).toHaveBeenCalledWith('shopping');
  });

  it('renders only matching icons in the all-icons grid when the query is non-empty', () => {
    // 'shopping' is specific enough that the visible window contains a tile
    // whose data-icon-name we can assert on. Hand-rolled virtualization with
    // scrollTop=0 (the test's initial state) renders the first ~80 entries of
    // the filtered list — well within range for a narrow filter.
    const tree = callBody({ query: 'shopping' });
    const tiles = findAll(tree, (el) => el.type === 'button');
    expect(tiles.length).toBeGreaterThan(0);
    // Every visible tile must include the substring case-insensitively.
    for (const tile of tiles) {
      const name = (tile.props as { 'data-icon-name'?: string })['data-icon-name'];
      expect(typeof name).toBe('string');
      expect((name as string).toLowerCase()).toContain('shopping');
    }
  });

  it('clicking a tile calls onPick with the kebab name', () => {
    const onPick = mock(() => {});
    // Pick a query narrow enough to know exactly which tiles render.
    const tree = callBody({ query: 'shopping-cart', onPick });
    const tile = findElement(
      tree,
      (el) =>
        el.type === 'button' &&
        (el.props as { 'data-icon-name'?: string })['data-icon-name'] === 'shopping-cart',
    );
    if (!tile) throw new Error('shopping-cart tile not found');
    const onClick = tile.props.onClick as () => void;
    onClick();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('shopping-cart');
  });

  it('hides the Recent section when the search query is non-empty', () => {
    const tree = callBody({ query: 'x', recents: ['shopping-cart', 'apple'] });
    const recents = findElement(tree, testIdEquals('icon-picker-recents'));
    expect(recents).toBeNull();
  });

  it('hides the Recent section when getRecents() is empty', () => {
    const tree = callBody({ query: '', recents: [] });
    const recents = findElement(tree, testIdEquals('icon-picker-recents'));
    expect(recents).toBeNull();
  });

  it('renders the Recent section with one tile per recent name when query is empty', () => {
    const tree = callBody({ query: '', recents: ['shopping-cart', 'apple'] });
    const recents = findElement(tree, testIdEquals('icon-picker-recents'));
    expect(recents).not.toBeNull();
    const recentTiles = findAll(recents, (el) => el.type === 'button');
    const names = recentTiles.map(
      (t) => (t.props as { 'data-icon-name'?: string })['data-icon-name'],
    );
    expect(names).toEqual(['shopping-cart', 'apple']);
  });

  it('shows an empty-state message when no icons match the query', () => {
    const tree = callBody({ query: 'definitely-not-a-real-icon-name-xyz' });
    const empty = findElement(tree, testIdEquals('icon-picker-empty'));
    expect(empty).not.toBeNull();
    const allList = findElement(tree, testIdEquals('icon-picker-all'));
    expect(allList).toBeNull();
  });
});
