import { describe, expect, it } from 'bun:test';
import { PlayNode } from '@/components/nodes/play-node';
import { Button } from '@/components/ui/button';
import { COLOR_TOKENS, NODE_DEFAULT_BG_WHITE } from '@/lib/color-tokens';
import type { NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import * as React from 'react';

// Mirrors the hook-shim pattern from icon-node.test.tsx — no DOM, no React
// Flow store; we walk the returned element tree to find the play button and
// assert on its className. Documented in detail in icon-node.test.tsx.
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

function callPlayNode(data: Record<string, unknown>, overrides: Partial<NodeProps> = {}): unknown {
  const props = {
    id: 'p1',
    type: 'playNode',
    data: {
      name: 'Run',
      kind: 'http',
      ...data,
    },
    selected: false,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    zIndex: 0,
    dragging: false,
    deletable: true,
    draggable: true,
    selectable: true,
    ...overrides,
  } as unknown as NodeProps;
  const impl = (PlayNode as unknown as { type: (p: NodeProps) => unknown }).type;
  return renderWithHooks(() => impl(props));
}

function findPlayButton(tree: unknown): ReactElementLike {
  const el = findElement(
    tree,
    (el) =>
      el.type === Button &&
      (el.props as { 'data-testid'?: string })['data-testid'] === 'play-button',
  );
  if (!el) throw new Error('play-button not found');
  return el;
}

describe('PlayNode play button (US-021 hover affordance)', () => {
  it('emerald hover/focus-visible classes are present on the play button', () => {
    const tree = callPlayNode({ playAction: { kind: 'http' }, onPlay: () => {} });
    const button = findPlayButton(tree);
    const className = String((button.props as { className?: string }).className ?? '');
    expect(className).toContain('hover:bg-primary');
    expect(className).toContain('hover:text-primary-foreground');
    expect(className).toContain('focus-visible:bg-primary');
    expect(className).toContain('focus-visible:text-primary-foreground');
  });

  it('keeps the circular shape + size classes alongside the new hover styles', () => {
    const tree = callPlayNode({ playAction: { kind: 'http' }, onPlay: () => {} });
    const button = findPlayButton(tree);
    const className = String((button.props as { className?: string }).className ?? '');
    // The hover styling must NOT have replaced the circle chrome.
    expect(className).toContain('h-8');
    expect(className).toContain('w-8');
    expect(className).toContain('rounded-full');
  });

  it('error state keeps both the rose border AND the emerald hover classes', () => {
    const tree = callPlayNode({
      playAction: { kind: 'http' },
      onPlay: () => {},
      status: 'error',
      errorMessage: 'boom',
    });
    const button = findPlayButton(tree);
    const className = String((button.props as { className?: string }).className ?? '');
    // Rose border for the error indication.
    expect(className).toContain('border-rose-500');
    // Emerald hover still applies — user is going to retry; the green
    // affordance should still color-code the click target.
    expect(className).toContain('hover:bg-primary');
    expect(className).toContain('hover:text-primary-foreground');
  });

  it('disabled state (no action wired) — the Button base class blocks pointer events, hover styles are inert', () => {
    // Without an action OR onPlay handler the button receives `disabled={true}`;
    // the base Button class chain has `disabled:pointer-events-none`, so the
    // hover styles never fire even though the className still contains them.
    // This test asserts the disabled prop reaches the Button, which is what
    // makes the disabled rule work — not the absence of hover classes.
    const tree = callPlayNode({});
    const button = findPlayButton(tree);
    const disabled = (button.props as { disabled?: boolean }).disabled;
    expect(disabled).toBe(true);
  });

  it('running state — the button is disabled while running so hover styles are inert', () => {
    const tree = callPlayNode({
      playAction: { kind: 'http' },
      onPlay: () => {},
      status: 'running',
    });
    const button = findPlayButton(tree);
    const disabled = (button.props as { disabled?: boolean }).disabled;
    expect(disabled).toBe(true);
  });
});

// US-021 (text-and-group-resize): default background fallback for the
// play-node container. Unset `data.backgroundColor` → NODE_DEFAULT_BG_WHITE
// (hsl(var(--card)) dark surface). Field stays unset on disk.
function findPlayContainer(tree: unknown): ReactElementLike {
  const container = findElement(tree, (el) => {
    const p = el.props as { 'data-testid'?: string };
    return p['data-testid'] === 'play-node';
  });
  if (!container) throw new Error('play-node container not found');
  return container;
}

// US-007: per-node status badge below the header. Renders only when
// data.statusReport is present; absent → the badge row is not in the tree at
// all (no layout shift vs. legacy renders).
function findStatusBadgeRow(tree: unknown): ReactElementLike | null {
  return findElement(
    tree,
    (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'play-node-status-badge',
  );
}

function findStatusBadge(tree: unknown): ReactElementLike | null {
  return findElement(
    tree,
    (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'status-badge',
  );
}

function findDot(tree: unknown): ReactElementLike | null {
  return findElement(tree, (el) => {
    if (el.type !== 'span') return false;
    const className = String((el.props as { className?: string }).className ?? '');
    return className.includes('rounded-full') && className.includes('h-2');
  });
}

describe('PlayNode status badge (US-007)', () => {
  it('renders no badge row when statusReport is absent', () => {
    const tree = callPlayNode({ playAction: { kind: 'script' }, onPlay: () => {} });
    expect(findStatusBadgeRow(tree)).toBeNull();
  });

  it('renders the badge with the summary and the correct dot color per state', () => {
    const cases = [
      { state: 'ok' as const, dotClass: 'bg-emerald-400' },
      { state: 'warn' as const, dotClass: 'bg-amber-400' },
      { state: 'error' as const, dotClass: 'bg-rose-400' },
      { state: 'pending' as const, dotClass: 'bg-slate-400' },
    ];
    for (const { state, dotClass } of cases) {
      const tree = callPlayNode({
        playAction: { kind: 'script' },
        onPlay: () => {},
        statusReport: { state, summary: 'hello', ts: 1 },
      });
      const row = findStatusBadgeRow(tree);
      if (!row) throw new Error(`expected badge row for state=${state}`);
      const badge = findStatusBadge(row);
      if (!badge) throw new Error(`expected status-badge inside row for state=${state}`);
      // The badge element here is React.createElement(StatusBadge, { state,
      // summary, 'data-testid': 'status-badge' }) — `state` is a prop on the
      // unrendered StatusBadge component, not yet a data-state on a span.
      expect((badge.props as { state?: string }).state).toBe(state);
      expect((badge.props as { summary?: string }).summary).toBe('hello');
      // Sanity: render StatusBadge once to confirm the dotClass it picks for
      // this state — same shape as the dedicated status-badge tests, just in
      // line so the play-node coverage exercises the same color contract.
      const StatusBadge = badge.type as (p: {
        state: string;
        summary?: string;
        'data-testid'?: string;
      }) => unknown;
      const rendered = StatusBadge(badge.props as { state: string; summary?: string });
      const dot = findDot(rendered);
      if (!dot) throw new Error(`expected dot span for state=${state}`);
      const dotClassName = String((dot.props as { className?: string }).className ?? '');
      expect(dotClassName).toContain(dotClass);
    }
  });
});

describe('PlayNode default background fill (US-021 default node background)', () => {
  it('renders NODE_DEFAULT_BG_WHITE when backgroundColor is unset', () => {
    const tree = callPlayNode({});
    const container = findPlayContainer(tree);
    const style = (container.props as { style?: CSSProperties }).style ?? {};
    expect(style.backgroundColor).toBe(NODE_DEFAULT_BG_WHITE);
  });

  it('uses the explicit token when backgroundColor is set', () => {
    const tree = callPlayNode({ backgroundColor: 'blue' });
    const container = findPlayContainer(tree);
    const style = (container.props as { style?: CSSProperties }).style ?? {};
    expect(style.backgroundColor).toBe(COLOR_TOKENS.blue.background);
  });

  it('explicit "default" token resolves to theme --card (opt-back-into-theme)', () => {
    const tree = callPlayNode({ backgroundColor: 'default' });
    const container = findPlayContainer(tree);
    const style = (container.props as { style?: CSSProperties }).style ?? {};
    expect(style.backgroundColor).toBe(COLOR_TOKENS.default.background);
  });
});
