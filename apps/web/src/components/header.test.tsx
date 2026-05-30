import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Header, type HeaderProps } from '@/components/header';
import type { ProjectSummary } from '@/lib/api';
import { ShareMenu } from '@seeflow/canvas';
import * as React from 'react';

// Header calls `useTheme()`; stub it so the hook-shim renderer doesn't have to
// run the real implementation (which would touch localStorage and matchMedia).
// NOTE: we deliberately do NOT mock `@/hooks/use-navigate-flow`. Header
// imports `reset` only for the logo button's onClick — never fires during a
// hook-shim render walk — and bun's `mock.module(...)` leaks across test
// files in the same process. Mocking it here would null out `reset` for the
// real use-navigate-flow.test.ts running later in the suite.
mock.module('@/hooks/use-theme', () => ({
  useTheme: () => ({ theme: 'light', setTheme: () => {} }),
}));

beforeEach(() => {
  (globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ = '0.0.0-test';
});

afterEach(() => {
  (globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ = undefined;
});

// Hook-shim render so we can call Header as a function and walk the returned
// tree directly (no DOM). Mirrors flow-switcher.test.tsx / project-switcher.test.tsx.
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

function findByTestId(tree: unknown, id: string): ReactElementLike | null {
  const matches = findAll(
    tree,
    (el) => (el.props as { 'data-testid'?: string })['data-testid'] === id,
  );
  return matches[0] ?? null;
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
  describe('share menu', () => {
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

  describe('back button (US-007)', () => {
    it('does not render the back button when previousFlowName is undefined', () => {
      const tree = renderHeader();
      expect(findByTestId(tree, 'flow-back-button')).toBeNull();
    });

    it('renders the back button when previousFlowName is set', () => {
      const tree = renderHeader({ previousFlowName: 'Checkout', onBack: () => {} });
      const back = findByTestId(tree, 'flow-back-button');
      expect(back).not.toBeNull();
    });

    it('uses aria-label "Back to previous flow" on the button', () => {
      const tree = renderHeader({ previousFlowName: 'Checkout', onBack: () => {} });
      const back = findByTestId(tree, 'flow-back-button');
      if (!back) throw new Error('back button missing');
      expect(back.props['aria-label']).toBe('Back to previous flow');
    });

    it('renders the tooltip copy as "Back to <previousFlowName>"', () => {
      const tree = renderHeader({ previousFlowName: 'Checkout', onBack: () => {} });
      // TooltipContent appears as a JSX element; its children are
      // ['Back to ', 'Checkout'] (string + interpolated name). Find any
      // node whose children include the literal "Back to " prefix.
      const tooltips = findAll(tree, (el) => {
        const children = el.props.children;
        const arr = Array.isArray(children) ? children : [children];
        return arr.some((c) => c === 'Back to ');
      });
      expect(tooltips.length).toBe(1);
      const tooltip = tooltips[0];
      if (!tooltip) throw new Error('tooltip missing');
      const arr = Array.isArray(tooltip.props.children)
        ? tooltip.props.children
        : [tooltip.props.children];
      expect(arr).toContain('Checkout');
    });

    it('binds the onBack callback to the back button onClick', () => {
      let clicked = 0;
      const onBack = (): void => {
        clicked += 1;
      };
      const tree = renderHeader({ previousFlowName: 'Checkout', onBack });
      const back = findByTestId(tree, 'flow-back-button');
      if (!back) throw new Error('back button missing');
      const onClick = back.props.onClick as (() => void) | undefined;
      if (!onClick) throw new Error('onClick missing');
      onClick();
      expect(clicked).toBe(1);
    });

    it('back button sits inside a flex container with gap-2 to the logo', () => {
      const tree = renderHeader({ previousFlowName: 'Checkout', onBack: () => {} });
      // The back button + logo share a wrapper div carrying `gap-2`.
      const wrappers = findAll(tree, (el) => {
        const className = (el.props as { className?: string }).className ?? '';
        return (
          typeof className === 'string' && className.includes('gap-2') && className.includes('flex')
        );
      });
      // The matching wrapper must contain our back-button as a descendant.
      const matched = wrappers.find((w) => findByTestId(w, 'flow-back-button') !== null);
      expect(matched).not.toBeUndefined();
    });
  });
});
