import { describe, expect, it, mock } from 'bun:test';
import { Loader2, RefreshCw } from 'lucide-react';
import * as React from 'react';
import { Button } from '../ui/button.tsx';
import { RestartDemoButton } from './restart-demo-button.tsx';

type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: () => void;
};

function renderWithHooks<T>(fn: () => T, overrides: Partial<Hooks> = {}): T {
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
    ...overrides,
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

function callRestartDemoButton(
  props: { onRestartDemo: () => Promise<unknown> },
  overrides: Partial<Hooks> = {},
): unknown {
  return renderWithHooks(
    () => (RestartDemoButton as unknown as (p: typeof props) => unknown)(props),
    overrides,
  );
}

describe('RestartDemoButton', () => {
  it('renders a refresh icon button with the expected a11y attributes', () => {
    const onRestartDemo = mock(async () => undefined);
    const tree = callRestartDemoButton({ onRestartDemo });
    const button = findElement(tree, (el) => el.type === Button);
    if (!button) throw new Error('Button element not found');
    expect(button.props['data-testid']).toBe('header-restart-demo');
    expect(button.props['aria-label']).toBe('Restart demo');
    expect(button.props.title).toBe('Restart demo');
    expect(button.props.variant).toBe('ghost');
    expect(button.props.disabled).toBe(false);
    const refresh = findElement(tree, (el) => el.type === RefreshCw);
    const spinner = findElement(tree, (el) => el.type === Loader2);
    expect(refresh).not.toBeNull();
    expect(spinner).toBeNull();
  });

  it('calls onRestartDemo when the button is clicked', () => {
    const onRestartDemo = mock(async () => undefined);
    const tree = callRestartDemoButton({ onRestartDemo });
    const button = findElement(tree, (el) => el.type === Button);
    if (!button) throw new Error('Button element not found');
    const onClick = button.props.onClick as () => void;
    onClick();
    expect(onRestartDemo).toHaveBeenCalledTimes(1);
  });

  it('shows the spinner and disables the button while pending', () => {
    const onRestartDemo = mock(async () => undefined);
    const tree = callRestartDemoButton(
      { onRestartDemo },
      {
        useState: <S,>(initial: S | (() => S)) => {
          const value = typeof initial === 'function' ? (initial as () => S)() : initial;
          return [(value as unknown) === false ? (true as unknown as S) : value, () => {}];
        },
      },
    );
    const button = findElement(tree, (el) => el.type === Button);
    if (!button) throw new Error('Button element not found');
    expect(button.props.disabled).toBe(true);
    const spinner = findElement(tree, (el) => el.type === Loader2);
    const refresh = findElement(tree, (el) => el.type === RefreshCw);
    expect(spinner).not.toBeNull();
    expect(refresh).toBeNull();
  });
});
