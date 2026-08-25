import { describe, expect, it, mock } from 'bun:test';
import * as React from 'react';
import { ShareMenu, type ShareMenuProps } from './share-menu.tsx';

// Hook-shim pattern, same as icon-picker-popover.test.tsx: Bun runs canvas
// tests without a DOM, so we install a synchronous React dispatcher, call
// ShareMenu as a function, and walk the returned JSX tree. Sub-components are
// captured as `{ type, props }` placeholders without executing — we assert
// structural invariants (menu items present/absent) rather than DOM.
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

function renderShareMenu(props: Partial<ShareMenuProps> = {}): unknown {
  return renderWithHooks(() => (ShareMenu as unknown as (p: ShareMenuProps) => unknown)(props));
}

const testIdEquals = (id: string) => (el: ReactElementLike) =>
  (el.props as { 'data-testid'?: string })['data-testid'] === id;

describe('ShareMenu (US-013)', () => {
  it('renders null when no callbacks are provided', () => {
    const tree = renderShareMenu();
    expect(tree).toBeNull();
  });

  it('renders the trigger when only onDownloadPng is wired', () => {
    const tree = renderShareMenu({ onDownloadPng: () => {} });
    const trigger = findElement(tree, testIdEquals('share-menu-trigger'));
    expect(trigger).not.toBeNull();
    const ariaLabel = (trigger as ReactElementLike).props['aria-label'];
    expect(ariaLabel).toBe('Download');
  });

  it('renders both download items when both callbacks are set', () => {
    const tree = renderShareMenu({
      onDownloadPdf: () => {},
      onDownloadPng: () => {},
    });
    expect(findElement(tree, testIdEquals('share-menu-pdf'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('share-menu-png'))).not.toBeNull();
  });

  it('hides the PDF item when only onDownloadPng is wired', () => {
    const tree = renderShareMenu({ onDownloadPng: () => {} });
    expect(findElement(tree, testIdEquals('share-menu-pdf'))).toBeNull();
    expect(findElement(tree, testIdEquals('share-menu-png'))).not.toBeNull();
  });

  it('selecting the PDF item invokes onDownloadPdf', () => {
    const onDownloadPdf = mock(() => Promise.resolve());
    const tree = renderShareMenu({ onDownloadPdf });
    const pdfItem = findElement(tree, testIdEquals('share-menu-pdf'));
    if (!pdfItem) throw new Error('PDF item missing');
    const onSelect = pdfItem.props.onSelect as (e: Event) => void;
    onSelect({ preventDefault: () => {} } as unknown as Event);
    expect(onDownloadPdf).toHaveBeenCalledTimes(1);
  });

  it('selecting the PNG item invokes onDownloadPng', () => {
    const onDownloadPng = mock(() => Promise.resolve());
    const tree = renderShareMenu({ onDownloadPng });
    const pngItem = findElement(tree, testIdEquals('share-menu-png'));
    if (!pngItem) throw new Error('PNG item missing');
    const onSelect = pngItem.props.onSelect as (e: Event) => void;
    onSelect({ preventDefault: () => {} } as unknown as Event);
    expect(onDownloadPng).toHaveBeenCalledTimes(1);
  });
});
