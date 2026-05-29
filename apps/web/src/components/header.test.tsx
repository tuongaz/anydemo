import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Header, type HeaderProps } from '@/components/header';
import type { ProjectSummary } from '@/lib/api';
import { ShareMenu } from '@seeflow/canvas';
import * as React from 'react';

// Header calls `useTheme()`; stub it so the hook-shim renderer doesn't have to
// run the real implementation (which would touch localStorage and matchMedia).
mock.module('@/hooks/use-theme', () => ({
  useTheme: () => ({ theme: 'light', setTheme: () => {} }),
}));

// Header invokes `navigate('/')` only from the logo's onClick — never during
// render — so the mock just stops the module from pulling window APIs.
mock.module('@/lib/router', () => ({
  navigate: (): void => {},
}));

beforeEach(() => {
  (globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ = '0.0.0-test';
});

afterEach(() => {
  (globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ = undefined;
});

// Same hook-shim approach as project-switcher.test.tsx / command-palette.test.tsx.
// Header has zero direct `useState` calls (its only hook is `useTheme`, mocked
// above), so no `stateOverrides` are needed.
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

function findShareMenu(tree: unknown): ReactElementLike | null {
  const matches = findAll(tree, (el) => el.type === ShareMenu);
  return matches[0] ?? null;
}

const PROJECTS: ProjectSummary[] = [
  {
    projectSlug: 'order-pipeline',
    name: 'Order Pipeline',
    defaultFlow: 'main',
    flowCount: 1,
  },
];

function renderHeader(props: Partial<HeaderProps> = {}): unknown {
  const merged: HeaderProps = {
    projects: PROJECTS,
    currentProjectSlug: 'order-pipeline',
    ...props,
  };
  return renderWithHooks(() => (Header as unknown as (p: HeaderProps) => unknown)(merged));
}

describe('Header', () => {
  it('omits the Share trigger when no `share` prop is provided', () => {
    const tree = renderHeader();
    expect(findShareMenu(tree)).toBeNull();
  });

  it('renders ShareMenu between ProjectSwitcher and Settings when `share` is provided', () => {
    const onDownloadPdf = () => {};
    const onDownloadPng = () => {};
    const onExportToCloud = () => {};
    const tree = renderHeader({ share: { onDownloadPdf, onDownloadPng, onExportToCloud } });

    const share = findShareMenu(tree);
    if (!share) throw new Error('expected ShareMenu in the tree when share prop is provided');

    expect(share.props.mode).toBe('edit');
    expect(share.props.enableEmbed).toBe(false);
    expect(share.props.onDownloadPdf).toBe(onDownloadPdf);
    expect(share.props.onDownloadPng).toBe(onDownloadPng);
    expect(share.props.onExportToCloud).toBe(onExportToCloud);
  });
});
