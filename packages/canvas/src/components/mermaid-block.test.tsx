import { describe, expect, it } from 'bun:test';
import * as React from 'react';

const { MermaidBlock } = await import('./mermaid-block.tsx');

// Same dispatcher-shim pattern as detail-panel.test.tsx — call the component
// as a function with a faked React dispatcher so we can inspect the first
// render's tree without a DOM. useEffect / useState / useRef are stubbed.
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

describe('MermaidBlock', () => {
  it('renders a container div with the mermaid testid and theme attribute', () => {
    const tree = renderWithHooks(() => MermaidBlock({ code: 'graph LR\nA-->B' }));
    expect(isElement(tree)).toBe(true);
    if (!isElement(tree)) return;
    expect(tree.type).toBe('div');
    expect(tree.props['data-testid']).toBe('detail-panel-mermaid');
    // Theme defaults to "light" when no .dark ancestor is present (the test
    // env has no document classList by default).
    expect(tree.props['data-mermaid-theme']).toBe('light');
    expect(tree.props.role).toBe('img');
    expect(tree.props['aria-label']).toBe('Mermaid diagram');
  });

  it('falls back to a <pre><code> with the original source when mermaid import errors', () => {
    // useStateOverrides indices: 0 = errorMessage, 1 = isDark. Force an
    // error to render the fallback branch.
    const tree = renderWithHooks(
      () => MermaidBlock({ code: 'graph LR\nA-->B' }),
      ['Cannot find module mermaid'],
    );
    expect(isElement(tree)).toBe(true);
    if (!isElement(tree)) return;
    expect(tree.type).toBe('pre');
    expect(tree.props['data-testid']).toBe('detail-panel-mermaid-fallback');
    expect(tree.props['data-mermaid-error']).toBe('true');
    // The original code survives in the <code> child so the user still sees
    // their source text (and we don't lose data on render failure).
    const code = tree.props.children as ReactElementLike;
    expect(isElement(code)).toBe(true);
    expect(code.type).toBe('code');
    expect(code.props.children).toBe('graph LR\nA-->B');
  });
});
