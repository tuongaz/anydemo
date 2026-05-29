import { describe, expect, it } from 'bun:test';
import { Header, type HeaderProps } from '@/components/header';
import * as React from 'react';

// Hook-shim render so we can call Header as a function and walk the returned
// tree directly (no DOM). Mirrors flow-switcher.test.tsx / project-switcher.test.tsx.
// The shim swallows useEffect and freezes useState at its initial value (no
// override slots needed here — Header only state is owned by `useTheme()`
// internally, which we don't exercise).

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

// __APP_VERSION__ is provided by Vite's define plugin in production; the test
// run never goes through Vite so we stub it on globalThis before importing
// Header is evaluated. Header reads __APP_VERSION__ inside its body, which
// runs lazily under renderWithHooks — so installing the global before the
// first render call is sufficient.
(globalThis as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = '0.0.0-test';

function renderHeader(props: Partial<HeaderProps> = {}): unknown {
  const merged: HeaderProps = {
    projects: [],
    ...props,
  };
  return renderWithHooks(() => (Header as unknown as (p: HeaderProps) => unknown)(merged));
}

describe('Header', () => {
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
