import { describe, expect, it } from 'bun:test';
import * as React from 'react';
import {
  type AttributionToastItem,
  AttributionToastStack,
  type AttributionToastStackProps,
} from './attribution-toast.tsx';

// Hook-shim: we want a no-op dispatcher for render-shape assertions, AND we
// want to capture the single useEffect the component installs so we can run
// it manually with a stubbed setTimeout. Captured callbacks live on the shim
// instance per-call so tests can introspect them.

type CapturedEffect = { fn: () => undefined | (() => void); cleanup?: () => void };

type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: (fn: () => undefined | (() => void)) => void;
  useContext: <T>(ctx: { _currentValue?: T }) => T;
};

function renderWithHooks<T>(fn: () => T, captures: CapturedEffect[] = []): T {
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
    useEffect: (effectFn: () => undefined | (() => void)) => {
      captures.push({ fn: effectFn });
    },
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

function flatten(node: unknown, out: ReactElementLike[] = []): ReactElementLike[] {
  if (Array.isArray(node)) {
    for (const item of node) flatten(item, out);
    return out;
  }
  if (isElement(node)) {
    out.push(node);
    if (node.props.children !== undefined) flatten(node.props.children, out);
  }
  return out;
}

function findAll(root: unknown, predicate: (el: ReactElementLike) => boolean): ReactElementLike[] {
  return flatten(root).filter(predicate);
}

function callStack(
  props: AttributionToastStackProps,
  captures: CapturedEffect[] = [],
): ReactElementLike {
  return renderWithHooks(
    () => (AttributionToastStack as unknown as (p: AttributionToastStackProps) => unknown)(props),
    captures,
  ) as ReactElementLike;
}

function item(id: string, overrides: Partial<AttributionToastItem> = {}): AttributionToastItem {
  return {
    id,
    color: '#ff8800',
    displayName: 'Alice',
    verb: 'moved',
    nodeLabel: 'Login',
    createdAt: 0,
    ...overrides,
  };
}

describe('AttributionToastStack', () => {
  it('caps the visible stack at 3 items by default and renders the most recent', () => {
    const tree = callStack({
      items: [
        item('a', { displayName: 'A' }),
        item('b', { displayName: 'B' }),
        item('c', { displayName: 'C' }),
        item('d', { displayName: 'D' }),
        item('e', { displayName: 'E' }),
      ],
      onExpire: () => {},
    });
    const toasts = findAll(tree, (el) => typeof el.props['data-toast-id'] === 'string');
    expect(toasts.length).toBe(3);
    const ids = toasts.map((t) => t.props['data-toast-id']);
    expect(ids).toEqual(['c', 'd', 'e']);
  });

  it('honors a custom maxVisible cap', () => {
    const tree = callStack({
      items: [item('a'), item('b'), item('c'), item('d')],
      onExpire: () => {},
      maxVisible: 2,
    });
    const toasts = findAll(tree, (el) => typeof el.props['data-toast-id'] === 'string');
    expect(toasts.length).toBe(2);
    expect(toasts.map((t) => t.props['data-toast-id'])).toEqual(['c', 'd']);
  });

  it('renders displayName, verb, and nodeLabel for each visible item', () => {
    const tree = callStack({
      items: [item('a', { displayName: 'Alice', verb: 'moved', nodeLabel: 'Node X' })],
      onExpire: () => {},
    });
    const spans = findAll(tree, (el) => el.type === 'span');
    const texts = spans.map((s) => s.props.children).filter((c) => typeof c === 'string');
    expect(texts).toContain('Alice');
    expect(texts).toContain('moved');
    expect(texts).toContain('Node X');
  });

  it('applies a 3px left border in the peer color', () => {
    const tree = callStack({
      items: [item('a', { color: '#22cc88' })],
      onExpire: () => {},
    });
    const toast = findAll(tree, (el) => el.props['data-toast-id'] === 'a')[0];
    if (!toast) throw new Error('expected one toast');
    const style = toast.props.style as Record<string, unknown>;
    expect(style.borderLeft).toBe('3px solid #22cc88');
    expect(style.background).toBe('#18181b');
    expect(style.fontFamily).toContain('JetBrains Mono');
    expect(style.fontSize).toBe(12);
  });

  it('schedules a per-item timeout that calls onExpire with the item id (~2500ms)', () => {
    const expired: string[] = [];
    const scheduled: Array<{ ms: number; cb: () => void }> = [];
    const setTimeoutFn = (cb: () => void, ms: number) => {
      scheduled.push({ ms, cb });
      return scheduled.length - 1;
    };
    const clearTimeoutFn = () => {};
    const captures: CapturedEffect[] = [];
    callStack(
      {
        items: [item('a', { createdAt: 0 }), item('b', { createdAt: 0 })],
        onExpire: (id) => expired.push(id),
        nowFn: () => 0,
        setTimeoutFn,
        clearTimeoutFn,
      },
      captures,
    );
    // Run the captured effect — this is what useEffect would do post-paint.
    expect(captures.length).toBe(1);
    const eff = captures[0];
    if (!eff) throw new Error('expected captured effect');
    eff.fn();
    expect(scheduled.length).toBe(2);
    expect(scheduled[0]?.ms).toBe(2500);
    expect(scheduled[1]?.ms).toBe(2500);
    // Fire timers manually — onExpire should be called with each item id.
    scheduled[0]?.cb();
    scheduled[1]?.cb();
    expect(expired).toEqual(['a', 'b']);
  });

  it('uses createdAt to compute remaining lifetime (clamped at zero)', () => {
    const scheduled: Array<{ ms: number }> = [];
    const setTimeoutFn = (_cb: () => void, ms: number) => {
      scheduled.push({ ms });
      return scheduled.length - 1;
    };
    const captures: CapturedEffect[] = [];
    callStack(
      {
        items: [
          item('fresh', { createdAt: 1000 }), // 0ms elapsed → 2500
          item('mid', { createdAt: 500 }), // 500ms elapsed → 2000
          item('expired', { createdAt: -10_000 }), // way over → clamp to 0
        ],
        onExpire: () => {},
        nowFn: () => 1000,
        setTimeoutFn,
        clearTimeoutFn: () => {},
      },
      captures,
    );
    const eff = captures[0];
    if (!eff) throw new Error('expected captured effect');
    eff.fn();
    expect(scheduled.map((s) => s.ms)).toEqual([2500, 2000, 0]);
  });

  it('clears all scheduled handles on effect cleanup', () => {
    const cleared: unknown[] = [];
    const captures: CapturedEffect[] = [];
    let nextHandle = 1;
    const setTimeoutFn = () => nextHandle++;
    const clearTimeoutFn = (h: unknown) => cleared.push(h);
    callStack(
      {
        items: [item('a'), item('b'), item('c')],
        onExpire: () => {},
        nowFn: () => 0,
        setTimeoutFn,
        clearTimeoutFn,
      },
      captures,
    );
    const eff = captures[0];
    if (!eff) throw new Error('expected captured effect');
    const cleanup = eff.fn();
    if (typeof cleanup !== 'function') throw new Error('expected cleanup function');
    cleanup();
    expect(cleared).toEqual([1, 2, 3]);
  });
});
