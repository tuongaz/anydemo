import { describe, expect, it, mock } from 'bun:test';
import * as React from 'react';
import type { PackSummary } from '../adapter/types.ts';
import { BrowsePacksPanel, type BrowsePacksPanelProps } from './browse-packs-panel.tsx';

// Dispatcher-shim render — same pattern as icon-picker-popover.test.tsx.
// BrowsePacksPanel is stateless so the shim only needs to provide the basic
// hooks (none are actually called, but we keep the same harness for
// consistency with peer test files).
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

function testIdEquals(id: string) {
  return (el: ReactElementLike) => (el.props as { 'data-testid'?: string })['data-testid'] === id;
}

function callPanel(overrides: Partial<BrowsePacksPanelProps> = {}): unknown {
  const props: BrowsePacksPanelProps = {
    packs: [],
    onInstall: () => {},
    onRemove: () => {},
    ...overrides,
  };
  return renderWithHooks(() =>
    (BrowsePacksPanel as unknown as (p: BrowsePacksPanelProps) => unknown)(props),
  );
}

describe('BrowsePacksPanel', () => {
  it('renders a row for each vendor (aws/gcp/azure) even when packs is empty', () => {
    const tree = callPanel({ packs: [] });
    for (const vendor of ['aws', 'gcp', 'azure']) {
      const row = findElement(tree, testIdEquals(`browse-packs-row-${vendor}`));
      expect(row).not.toBeNull();
      expect((row?.props as { 'data-installed'?: string })['data-installed']).toBe('false');
    }
  });

  it('shows an Install button for uninstalled vendors and fires onInstall on click', () => {
    const onInstall = mock(() => {});
    const tree = callPanel({ packs: [], onInstall });
    const btn = findElement(tree, testIdEquals('browse-packs-install-aws'));
    if (!btn) throw new Error('aws install button not found');
    (btn.props.onClick as () => void)();
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onInstall).toHaveBeenCalledWith('aws');
  });

  it('shows Installed badge + Remove button for installed packs; onRemove fires with the vendor', () => {
    const packs: PackSummary[] = [
      {
        vendor: 'aws',
        installed: true,
        version: '2026-05-31',
        iconCount: 12,
        sizeBytes: 0,
        iconNames: ['lambda', 's3'],
      },
      { vendor: 'gcp', installed: false },
      { vendor: 'azure', installed: false },
    ];
    const onRemove = mock(() => {});
    const tree = callPanel({ packs, onRemove });
    // Installed marker present
    expect(findElement(tree, testIdEquals('browse-packs-installed-aws'))).not.toBeNull();
    // Install button NOT rendered for installed pack
    expect(findElement(tree, testIdEquals('browse-packs-install-aws'))).toBeNull();
    // Row marked installed
    const row = findElement(tree, testIdEquals('browse-packs-row-aws'));
    expect((row?.props as { 'data-installed'?: string })['data-installed']).toBe('true');
    // Remove fires
    const remove = findElement(tree, testIdEquals('browse-packs-remove-aws'));
    if (!remove) throw new Error('aws remove button not found');
    (remove.props.onClick as () => void)();
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('aws');
  });

  it('disables both buttons for the busyVendor', () => {
    const packs: PackSummary[] = [
      {
        vendor: 'aws',
        installed: true,
        version: '2026-05-31',
        iconCount: 12,
        sizeBytes: 0,
        iconNames: ['lambda'],
      },
      { vendor: 'gcp', installed: false },
      { vendor: 'azure', installed: false },
    ];
    const tree = callPanel({ packs, busyVendor: 'aws' });
    const remove = findElement(tree, testIdEquals('browse-packs-remove-aws'));
    expect((remove?.props as { disabled?: boolean }).disabled).toBe(true);

    const tree2 = callPanel({ packs: [], busyVendor: 'gcp' });
    const install = findElement(tree2, testIdEquals('browse-packs-install-gcp'));
    expect((install?.props as { disabled?: boolean }).disabled).toBe(true);
    // Sibling vendors are NOT disabled.
    const installAws = findElement(tree2, testIdEquals('browse-packs-install-aws'));
    expect((installAws?.props as { disabled?: boolean }).disabled).toBe(false);
  });
});
