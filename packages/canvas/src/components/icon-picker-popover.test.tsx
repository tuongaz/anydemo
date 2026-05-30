import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ChangeEvent } from 'react';
import * as React from 'react';
import { ICON_NAMES_BY_VENDOR, applyPackSummaries } from '../lib/icon-registry.ts';
import { IconPickerBody, type IconPickerBodyProps, filterIcons } from './icon-picker-popover.tsx';

// Same dispatcher-shim trick used by icon-node.test.tsx — apps/web tests run
// without a DOM, so we can't mount the real component tree. Instead we shim
// React's internal hook dispatcher and call IconPickerBody as a function. The
// returned tree is the first render with sub-components captured as placeholders
// (their bodies never execute), which is fine because IconPickerBody renders
// every <input>, tab <button>, and tile <button> inline.
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: () => void;
  useContext: <T>(ctx: { _currentValue?: T }) => T;
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
    useContext: <T,>(ctx: { _currentValue?: T }) => ctx._currentValue as T,
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

// Walk children, treating nested arrays (from chained `{map(...)}{cond ? ... : null}`
// expressions) as transparent so the recursion can still reach buttons inside them.
function walkChildren(value: unknown, visit: (el: ReactElementLike) => boolean): boolean {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (walkChildren(item, visit)) return true;
    }
    return false;
  }
  if (!isElement(value)) return false;
  if (visit(value)) return true;
  const children = value.props.children;
  if (children === undefined || children === null) return false;
  return walkChildren(children, visit);
}

function findElement(
  tree: unknown,
  predicate: (el: ReactElementLike) => boolean,
): ReactElementLike | null {
  let match: ReactElementLike | null = null;
  walkChildren(tree, (el) => {
    if (predicate(el)) {
      match = el;
      return true;
    }
    return false;
  });
  return match;
}

function findAll(
  tree: unknown,
  predicate: (el: ReactElementLike) => boolean,
  acc: ReactElementLike[] = [],
): ReactElementLike[] {
  walkChildren(tree, (el) => {
    if (predicate(el)) acc.push(el);
    return false;
  });
  return acc;
}

// Tile <button>s carry a data-icon-name; tab <button>s carry data-testid
// `icon-picker-tab-<vendor>` and no data-icon-name. Use this predicate to
// isolate tile buttons in tree walks.
function isTileButton(el: ReactElementLike): boolean {
  if (el.type !== 'button') return false;
  return typeof (el.props as { 'data-icon-name'?: unknown })['data-icon-name'] === 'string';
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
    const tiles = findAll(tree, isTileButton);
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

  it('routes vendor-prefixed recent ids through renderVendorTile so logos still render', () => {
    // Pre-fix the recents map called renderTile (lucide-only) for every id, so
    // an iconify-logo recent like `iconify:logos:aws` would resolve to
    // ICON_REGISTRY[that string] === undefined and the tile would render blank.
    const tree = callBody({
      query: '',
      recents: ['shopping-cart', 'iconify:logos:aws', 'aws:lambda'],
    });
    const recents = findElement(tree, testIdEquals('icon-picker-recents'));
    expect(recents).not.toBeNull();
    const recentTiles = findAll(recents, (el) => el.type === 'button');
    const names = recentTiles.map(
      (t) => (t.props as { 'data-icon-name'?: string })['data-icon-name'],
    );
    expect(names).toEqual(['shopping-cart', 'iconify:logos:aws', 'aws:lambda']);
  });

  it('shows an empty-state message when no icons match the query', () => {
    const tree = callBody({ query: 'definitely-not-a-real-icon-name-xyz' });
    const empty = findElement(tree, testIdEquals('icon-picker-empty'));
    expect(empty).not.toBeNull();
    const allList = findElement(tree, testIdEquals('icon-picker-all'));
    expect(allList).toBeNull();
  });

  it('renders the No-icon tile when the query is empty', () => {
    const tree = callBody({ query: '' });
    const tile = findElement(tree, testIdEquals('icon-picker-tile-none'));
    expect(tile).not.toBeNull();
  });

  it('hides the No-icon tile when the user is searching', () => {
    const tree = callBody({ query: 'shopping' });
    const tile = findElement(tree, testIdEquals('icon-picker-tile-none'));
    expect(tile).toBeNull();
  });

  it('clicking the No-icon tile calls onPick with null', () => {
    const onPick = mock((_value: string | null) => {});
    const tree = callBody({ query: '', onPick });
    const tile = findElement(tree, testIdEquals('icon-picker-tile-none'));
    if (!tile) throw new Error('No-icon tile not found');
    const onClick = tile.props.onClick as () => void;
    onClick();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it('hides the No-icon tile when clearable=false (insert-icon-node mode)', () => {
    const tree = callBody({ query: '', clearable: false });
    const tile = findElement(tree, testIdEquals('icon-picker-tile-none'));
    expect(tile).toBeNull();
  });
});

describe('IconPickerBody tabs (US-016)', () => {
  // ICON_NAMES_BY_VENDOR is module-level mutable state — icon-registry.test.ts
  // populates it as part of its own assertions and does not clean up, so the
  // popover suite starts with whatever the prior test file left behind. Reset
  // to a known empty state before each tab test so visibility assertions hold
  // regardless of cross-file run order.
  beforeEach(() => {
    applyPackSummaries([
      { vendor: 'aws', installed: false },
      { vendor: 'gcp', installed: false },
      { vendor: 'azure', installed: false },
    ]);
  });

  it('renders only Bundled + Logos tabs by default (pack vendors hidden until installed)', () => {
    const tree = callBody();
    const tabs = findElement(tree, testIdEquals('icon-picker-tabs'));
    expect(tabs).not.toBeNull();
    for (const vendor of ['lucide', 'iconify']) {
      const tab = findElement(tree, testIdEquals(`icon-picker-tab-${vendor}`));
      expect(tab).not.toBeNull();
    }
    for (const vendor of ['aws', 'gcp', 'azure']) {
      const tab = findElement(tree, testIdEquals(`icon-picker-tab-${vendor}`));
      expect(tab).toBeNull();
    }
  });

  it('default active tab is `lucide` (bundled)', () => {
    const tree = callBody();
    const tab = findElement(tree, testIdEquals('icon-picker-tab-lucide'));
    if (!tab) throw new Error('lucide tab not found');
    expect((tab.props as { 'data-active'?: string })['data-active']).toBe('true');
  });

  it('clicking a tab calls onActiveTabChange with the new vendor id', () => {
    const onActiveTabChange = mock(() => {});
    const tree = callBody({ onActiveTabChange });
    const tab = findElement(tree, testIdEquals('icon-picker-tab-iconify'));
    if (!tab) throw new Error('iconify tab not found');
    const onClick = tab.props.onClick as () => void;
    onClick();
    expect(onActiveTabChange).toHaveBeenCalledTimes(1);
    expect(onActiveTabChange).toHaveBeenCalledWith('iconify');
  });

  it('vendor pack tabs appear in the bar after install', () => {
    applyPackSummaries([
      {
        vendor: 'aws',
        installed: true,
        version: '2026-05-31',
        iconCount: 1,
        sizeBytes: 0,
        iconNames: ['lambda'],
      },
      { vendor: 'gcp', installed: false },
      { vendor: 'azure', installed: false },
    ]);
    try {
      const tree = callBody();
      const aws = findElement(tree, testIdEquals('icon-picker-tab-aws'));
      expect(aws).not.toBeNull();
      const gcp = findElement(tree, testIdEquals('icon-picker-tab-gcp'));
      expect(gcp).toBeNull();
      const azure = findElement(tree, testIdEquals('icon-picker-tab-azure'));
      expect(azure).toBeNull();
    } finally {
      applyPackSummaries([
        { vendor: 'aws', installed: false },
        { vendor: 'gcp', installed: false },
        { vendor: 'azure', installed: false },
      ]);
    }
  });

  it('switching tabs re-filters the grid by vendor pack', () => {
    // Install a fake AWS pack so the AWS tab has icons to render.
    applyPackSummaries([
      {
        vendor: 'aws',
        installed: true,
        version: '2026-05-31',
        iconCount: 2,
        sizeBytes: 0,
        iconNames: ['lambda', 's3'],
      },
      { vendor: 'gcp', installed: false },
      { vendor: 'azure', installed: false },
    ]);
    try {
      // Use a narrow query so the visible virtualization window is bounded
      // and we can assert deterministically on which names appear.
      const lucideTree = callBody({ activeTab: 'lucide', query: 'shopping' });
      const lucideTiles = findAll(lucideTree, isTileButton);
      const lucideNames = lucideTiles.map(
        (t) => (t.props as { 'data-icon-name'?: string })['data-icon-name'],
      );
      expect(lucideNames).toContain('shopping-cart');
      // Lucide tab never surfaces vendor-prefixed ids.
      expect(lucideNames.some((n) => typeof n === 'string' && n?.startsWith('aws:'))).toBe(false);

      const awsTree = callBody({ activeTab: 'aws' });
      const awsTiles = findAll(awsTree, isTileButton);
      const awsNames = awsTiles.map(
        (t) => (t.props as { 'data-icon-name'?: string })['data-icon-name'],
      );
      expect(awsNames).toEqual(['aws:lambda', 'aws:s3']);
    } finally {
      // Reset so other tests don't see the stub pack.
      applyPackSummaries([
        { vendor: 'aws', installed: false },
        { vendor: 'gcp', installed: false },
        { vendor: 'azure', installed: false },
      ]);
    }
  });

  it('iconify tab surfaces the seeded `iconify:` ids', () => {
    const tree = callBody({ activeTab: 'iconify' });
    const tiles = findAll(tree, isTileButton);
    const names = tiles.map(
      (t) => (t.props as { 'data-icon-name'?: string })['data-icon-name'] as string,
    );
    expect(names).toContain('iconify:logos:aws');
    expect(names).toContain('iconify:logos:google-cloud');
    expect(names).toContain('iconify:logos:microsoft-azure');
  });

  it('clicking a vendor tile calls onPick with the full vendor:name id', () => {
    applyPackSummaries([
      {
        vendor: 'aws',
        installed: true,
        version: '2026-05-31',
        iconCount: 1,
        sizeBytes: 0,
        iconNames: ['lambda'],
      },
      { vendor: 'gcp', installed: false },
      { vendor: 'azure', installed: false },
    ]);
    try {
      const onPick = mock(() => {});
      const tree = callBody({ activeTab: 'aws', onPick });
      const tile = findElement(
        tree,
        (el) =>
          el.type === 'button' &&
          (el.props as { 'data-icon-name'?: string })['data-icon-name'] === 'aws:lambda',
      );
      if (!tile) throw new Error('aws:lambda tile not found');
      (tile.props.onClick as () => void)();
      expect(onPick).toHaveBeenCalledWith('aws:lambda');
    } finally {
      applyPackSummaries([
        { vendor: 'aws', installed: false },
        { vendor: 'gcp', installed: false },
        { vendor: 'azure', installed: false },
      ]);
    }
  });

  it('defensively shows the install prompt when activeTab points to an uninstalled pack vendor', () => {
    // Edge case: pack was active when removed mid-session. The tab itself is
    // filtered out of the bar, but the body still falls back to the prompt so
    // the user can re-install it without confusion.
    expect(ICON_NAMES_BY_VENDOR.gcp.length).toBe(0);
    const onBrowsePacks = mock(() => {});

    const treeGcp = callBody({ activeTab: 'gcp', onBrowsePacks });
    const prompt = findElement(treeGcp, testIdEquals('icon-picker-install-prompt'));
    expect(prompt).not.toBeNull();
    const cta = findElement(treeGcp, testIdEquals('icon-picker-install-cta-gcp'));
    if (!cta) throw new Error('Browse packs CTA not found');
    (cta.props.onClick as () => void)();
    expect(onBrowsePacks).toHaveBeenCalledTimes(1);
    expect(findElement(treeGcp, testIdEquals('icon-picker-all'))).toBeNull();
  });

  it('hides the Recent section on vendor tabs even when query is empty', () => {
    const tree = callBody({ activeTab: 'aws', recents: ['shopping-cart'] });
    const recents = findElement(tree, testIdEquals('icon-picker-recents'));
    expect(recents).toBeNull();
  });

  it('renders the + Browse-packs button at the end of the tab bar when showBrowseTab is true', () => {
    const onBrowsePacks = mock(() => {});
    const tree = callBody({ showBrowseTab: true, onBrowsePacks });
    const browse = findElement(tree, testIdEquals('icon-picker-tab-browse'));
    expect(browse).not.toBeNull();
    (browse?.props.onClick as () => void)();
    expect(onBrowsePacks).toHaveBeenCalledTimes(1);
  });

  it('hides the + Browse-packs button when showBrowseTab is false (default)', () => {
    const tree = callBody({ onBrowsePacks: () => {} });
    const browse = findElement(tree, testIdEquals('icon-picker-tab-browse'));
    expect(browse).toBeNull();
  });

  it('hides the + Browse-packs button when onBrowsePacks is missing even if showBrowseTab is true', () => {
    const tree = callBody({ showBrowseTab: true });
    const browse = findElement(tree, testIdEquals('icon-picker-tab-browse'));
    expect(browse).toBeNull();
  });
});
