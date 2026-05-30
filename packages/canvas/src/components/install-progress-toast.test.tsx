import { describe, expect, it, mock } from 'bun:test';
import * as React from 'react';
import type { InstallEvent } from '../adapter/types.ts';
import { InstallProgressToast, type InstallProgressToastProps } from './install-progress-toast.tsx';

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

function getLabelText(tree: unknown): string {
  const label = findElement(
    tree,
    (el) =>
      (el.props as { 'data-testid'?: string })['data-testid'] === 'install-progress-toast-label',
  );
  if (!label) throw new Error('label not found');
  const children = label.props.children;
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.filter((c) => typeof c === 'string').join('');
  return String(children);
}

function callToast(overrides: Partial<InstallProgressToastProps>): unknown {
  const props: InstallProgressToastProps = {
    vendor: 'aws',
    event: null,
    ...overrides,
  };
  return renderWithHooks(() =>
    (InstallProgressToast as unknown as (p: InstallProgressToastProps) => unknown)(props),
  );
}

describe('InstallProgressToast', () => {
  it('renders a "Starting…" line when event is null', () => {
    const tree = callToast({ event: null });
    expect(getLabelText(tree)).toContain('Starting');
    const root = findElement(
      tree,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'install-progress-toast',
    );
    expect((root?.props as { 'data-variant'?: string })['data-variant']).toBe('progress');
  });

  it('shows MB downloaded for download-progress events', () => {
    // 5.5 MB = 5.5 * 1024 * 1024 bytes
    const event: InstallEvent = {
      type: 'download-progress',
      vendor: 'aws',
      receivedBytes: Math.round(5.5 * 1024 * 1024),
    };
    const tree = callToast({ event });
    const text = getLabelText(tree);
    expect(text).toContain('Downloading');
    expect(text).toContain('5.5 MB');
  });

  it('renders extracting + indexing labels for those event types', () => {
    expect(getLabelText(callToast({ event: { type: 'extracting', vendor: 'aws' } }))).toContain(
      'Extracting',
    );
    expect(
      getLabelText(callToast({ event: { type: 'indexing', vendor: 'aws', iconCount: 42 } })),
    ).toContain('Indexing 42 icons');
  });

  it('switches to the done variant on a done event and shows the icon count', () => {
    const event: InstallEvent = {
      type: 'done',
      vendor: 'aws',
      version: '2026-05-31',
      iconCount: 10,
    };
    const tree = callToast({ event });
    expect(getLabelText(tree)).toContain('Installed 10');
    const root = findElement(
      tree,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'install-progress-toast',
    );
    expect((root?.props as { 'data-variant'?: string })['data-variant']).toBe('done');
    // No retry button in done state.
    const retry = findElement(
      tree,
      (el) =>
        (el.props as { 'data-testid'?: string })['data-testid'] === 'install-progress-toast-retry',
    );
    expect(retry).toBeNull();
  });

  it('switches to the error variant on an error event and shows Retry when onRetry is provided', () => {
    const onRetry = mock(() => {});
    const event: InstallEvent = {
      type: 'error',
      vendor: 'aws',
      message: 'fetch failed: 503',
    };
    const tree = callToast({ event, onRetry });
    expect(getLabelText(tree)).toContain('fetch failed: 503');
    const root = findElement(
      tree,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'install-progress-toast',
    );
    expect((root?.props as { 'data-variant'?: string })['data-variant']).toBe('error');
    const retry = findElement(
      tree,
      (el) =>
        (el.props as { 'data-testid'?: string })['data-testid'] === 'install-progress-toast-retry',
    );
    if (!retry) throw new Error('retry not found');
    (retry.props.onClick as () => void)();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('Close button fires onClose', () => {
    const onClose = mock(() => {});
    const tree = callToast({ event: null, onClose });
    const close = findElement(
      tree,
      (el) =>
        (el.props as { 'data-testid'?: string })['data-testid'] === 'install-progress-toast-close',
    );
    if (!close) throw new Error('close button not found');
    (close.props.onClick as () => void)();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides the Retry button on the error variant when onRetry is not provided', () => {
    const tree = callToast({
      event: { type: 'error', vendor: 'aws', message: 'oops' },
    });
    const retry = findElement(
      tree,
      (el) =>
        (el.props as { 'data-testid'?: string })['data-testid'] === 'install-progress-toast-retry',
    );
    expect(retry).toBeNull();
  });
});
