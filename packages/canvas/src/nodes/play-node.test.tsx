import { describe, expect, it } from 'bun:test';
import type { NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import * as React from 'react';
import { COLOR_TOKENS, NODE_DEFAULT_BG_WHITE } from '../lib/color-tokens.ts';
import { Button } from '../ui/button.tsx';
import { Icon } from '../ui/icon.tsx';
import { PlayNode } from './play-node.tsx';

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
  // Direct hit (legacy shape — Button rendered inline by PlayNodeImpl).
  let el = findElement(
    tree,
    (el) =>
      el.type === Button &&
      (el.props as { 'data-testid'?: string })['data-testid'] === 'play-button',
  );
  if (el) return el;
  // New shape: PlayNodeImpl renders a <PlayButton> wrapper. Find that
  // wrapper element by its prop shape, call its function to render the
  // Button subtree, then search inside.
  const wrapper = findElement(
    tree,
    (e) =>
      typeof e.type === 'function' &&
      'visualStatus' in (e.props as Record<string, unknown>) &&
      'buttonLabel' in (e.props as Record<string, unknown>),
  );
  if (wrapper) {
    const rendered = renderWithHooks(() =>
      (wrapper.type as (p: unknown) => unknown)(wrapper.props),
    );
    el = findElement(
      rendered,
      (e) =>
        e.type === Button &&
        (e.props as { 'data-testid'?: string })['data-testid'] === 'play-button',
    );
    if (el) return el;
  }
  throw new Error('play-button not found');
}

describe('PlayNode play button (US-021 hover affordance)', () => {
  it('emerald hover/focus-visible classes are present on the play button', () => {
    const tree = callPlayNode({ playAction: { kind: 'http' }, onPlay: () => {} });
    const button = findPlayButton(tree);
    const className = String((button.props as { className?: string }).className ?? '');
    expect(className).toContain('sf:hover:bg-primary');
    expect(className).toContain('sf:hover:text-primary-foreground');
    expect(className).toContain('sf:focus-visible:bg-primary');
    expect(className).toContain('sf:focus-visible:text-primary-foreground');
  });

  it('keeps the circular shape + size classes alongside the new hover styles', () => {
    const tree = callPlayNode({ playAction: { kind: 'http' }, onPlay: () => {} });
    const button = findPlayButton(tree);
    const className = String((button.props as { className?: string }).className ?? '');
    // The hover styling must NOT have replaced the circle chrome.
    expect(className).toContain('sf:h-8');
    expect(className).toContain('sf:w-8');
    expect(className).toContain('sf:rounded-full');
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
    expect(className).toContain('sf:border-rose-500');
    // Emerald hover still applies — user is going to retry; the green
    // affordance should still color-code the click target.
    expect(className).toContain('sf:hover:bg-primary');
    expect(className).toContain('sf:hover:text-primary-foreground');
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

function findHeader(tree: unknown): ReactElementLike {
  const header = findElement(
    tree,
    (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'node-header',
  );
  if (!header) throw new Error('node-header not found');
  return header;
}

function findHeaderIcon(tree: unknown): ReactElementLike | null {
  const header = findHeader(tree);
  return findElement(header, (el) => el.type === Icon);
}

describe('PlayNode header icon (US-005)', () => {
  it('renders an Icon in the header when data.icon is set', () => {
    const tree = callPlayNode({ icon: 'database' });
    const icon = findHeaderIcon(tree);
    if (!icon) throw new Error('expected Icon in node-header');
    expect((icon.props as { name?: string }).name).toBe('database');
    expect((icon.props as { size?: number }).size).toBe(16);
    expect((icon.props as { className?: string }).className).toBe('shrink-0');
  });

  it('does not render an Icon in the header when data.icon is undefined', () => {
    const tree = callPlayNode({});
    expect(findHeaderIcon(tree)).toBeNull();
  });
});

// Like StateNode, the on-node icon trigger sits in the `anchor` prop of an
// unrendered IconPickerPopover, not as a child of the header subtree.
function findHeaderPopover(tree: unknown): ReactElementLike | null {
  const header = findHeader(tree);
  return findElement(
    header,
    (el) =>
      typeof el.type === 'function' &&
      typeof (el.props as { onPick?: unknown }).onPick === 'function',
  );
}

describe('PlayNode editable header icon', () => {
  it('wraps the icon in a popover trigger button when selected + onIconChange wired', () => {
    const tree = callPlayNode({ icon: 'database', onIconChange: () => {} }, { selected: true });
    const popover = findHeaderPopover(tree);
    expect(popover).not.toBeNull();
    const anchor = (popover?.props as { anchor?: unknown }).anchor;
    if (!isElement(anchor)) throw new Error('expected popover anchor element');
    expect(anchor.props['data-testid']).toBe('play-node-icon-trigger');
    expect(anchor.type).toBe('button');
    const icon = findElement(anchor, (el) => el.type === Icon);
    expect(icon).not.toBeNull();
    expect((icon?.props as { name?: string }).name).toBe('database');
  });

  it('falls back to a static Icon when the node is not selected', () => {
    const tree = callPlayNode({ icon: 'database', onIconChange: () => {} });
    expect(findHeaderPopover(tree)).toBeNull();
    expect(findHeaderIcon(tree)).not.toBeNull();
  });

  it('forwards picked names (and null) through onIconChange', () => {
    const calls: Array<[string, string | null]> = [];
    const tree = callPlayNode(
      {
        icon: 'database',
        onIconChange: (id: string, icon: string | null) => calls.push([id, icon]),
      },
      { selected: true },
    );
    const popover = findHeaderPopover(tree);
    expect(popover).not.toBeNull();
    const onPick = (popover?.props as { onPick: (name: string | null) => void }).onPick;
    onPick('server');
    onPick(null);
    expect(calls).toEqual([
      ['p1', 'server'],
      ['p1', null],
    ]);
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

describe('PlayNode play button visual-status states (status uplift)', () => {
  it('idle: data-visual-status="idle" and Play icon, no ring overlay', () => {
    const tree = callPlayNode({ playAction: { kind: 'http' }, onPlay: () => {} });
    const button = findPlayButton(tree);
    expect((button.props as { 'data-visual-status'?: string })['data-visual-status']).toBe('idle');
    // Ring overlay only renders for 'active'. Search button subtree.
    const ring = findElement(
      button,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'play-button-ring',
    );
    expect(ring).toBeNull();
  });

  it('active: data-visual-status="active" and ring overlay present', () => {
    const tree = callPlayNode({
      playAction: { kind: 'http' },
      onPlay: () => {},
      status: 'running',
    });
    const button = findPlayButton(tree);
    expect((button.props as { 'data-visual-status'?: string })['data-visual-status']).toBe(
      'active',
    );
    const ring = findElement(
      button,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'play-button-ring',
    );
    expect(ring).not.toBeNull();
  });

  it('success: data-visual-status="success" with Check icon', () => {
    const tree = callPlayNode({
      playAction: { kind: 'http' },
      onPlay: () => {},
      status: 'done',
    });
    const button = findPlayButton(tree);
    expect((button.props as { 'data-visual-status'?: string })['data-visual-status']).toBe(
      'success',
    );
  });

  it('error: data-visual-status="error" — keeps existing rose-border class', () => {
    const tree = callPlayNode({
      playAction: { kind: 'http' },
      onPlay: () => {},
      status: 'error',
      errorMessage: 'boom',
    });
    const button = findPlayButton(tree);
    expect((button.props as { 'data-visual-status'?: string })['data-visual-status']).toBe('error');
    const className = String((button.props as { className?: string }).className ?? '');
    expect(className).toContain('sf:border-rose-500');
  });

  it('statusReport "pending" alone (no run status) reads as active', () => {
    const tree = callPlayNode({
      playAction: { kind: 'http' },
      onPlay: () => {},
      statusReport: { state: 'pending', ts: 1 },
    });
    const button = findPlayButton(tree);
    expect((button.props as { 'data-visual-status'?: string })['data-visual-status']).toBe(
      'active',
    );
  });
});
