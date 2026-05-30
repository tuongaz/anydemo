import { describe, expect, it } from 'bun:test';
import type { FlowStackEntry } from '@/hooks/use-navigate-flow';
import { FlowStackList } from '@/pages/flow-stack-pane';
import * as React from 'react';

// FlowStackList is purely presentational — no hooks. Call it as a function
// and walk the returned React tree directly. Mirrors the lightweight subset
// of the hook-shim pattern in flow-switcher.test.tsx (no renderWithHooks
// shim needed here because there are no useState calls to seed).

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

function findWrappers(tree: unknown): ReactElementLike[] {
  return findAll(tree, (el) => el.type === 'div' && 'data-flow-stack-entry' in (el.props ?? {}));
}

const STACK: FlowStackEntry[] = [
  { project: 'orders', flow: 'pipeline', slug: 'orders/pipeline' },
  { project: 'orders', flow: 'edge-cases', slug: 'orders/edge-cases' },
];

const TRIPLE_STACK_WITH_REPEAT: FlowStackEntry[] = [
  { project: 'orders', flow: 'pipeline', slug: 'orders/pipeline' },
  { project: 'orders', flow: 'edge-cases', slug: 'orders/edge-cases' },
  { project: 'orders', flow: 'pipeline', slug: 'orders/pipeline' },
];

const renderEntry = (entry: FlowStackEntry, isTop: boolean): React.ReactNode =>
  React.createElement('section', {
    'data-testid': `entry-${entry.slug}`,
    'data-top': String(isTop),
  });

describe('FlowStackList', () => {
  it('renders one wrapper div per stack entry', () => {
    const tree = FlowStackList({ stack: STACK, renderEntry });
    const wrappers = findWrappers(tree);
    expect(wrappers).toHaveLength(2);
    expect(wrappers[0]?.props['data-flow-stack-entry']).toBe('orders/pipeline');
    expect(wrappers[1]?.props['data-flow-stack-entry']).toBe('orders/edge-cases');
  });

  it('renders empty fragment for an empty stack', () => {
    const tree = FlowStackList({ stack: [], renderEntry });
    expect(findWrappers(tree)).toHaveLength(0);
  });

  it('hides every entry except the top with display:none', () => {
    const tree = FlowStackList({ stack: STACK, renderEntry });
    const wrappers = findWrappers(tree);
    const styles = wrappers.map((w) => (w.props.style as React.CSSProperties).display);
    expect(styles).toEqual(['none', 'block']);
  });

  it('marks only the top wrapper with data-flow-stack-top=true', () => {
    const tree = FlowStackList({ stack: STACK, renderEntry });
    const wrappers = findWrappers(tree);
    expect(wrappers[0]?.props['data-flow-stack-top']).toBe('false');
    expect(wrappers[1]?.props['data-flow-stack-top']).toBe('true');
  });

  it('passes isTop=true only to the top entry renderEntry callback', () => {
    const calls: Array<{ slug: string; isTop: boolean }> = [];
    const capturing = (entry: FlowStackEntry, isTop: boolean): React.ReactNode => {
      calls.push({ slug: entry.slug, isTop });
      return null;
    };
    FlowStackList({ stack: STACK, renderEntry: capturing });
    expect(calls).toEqual([
      { slug: 'orders/pipeline', isTop: false },
      { slug: 'orders/edge-cases', isTop: true },
    ]);
  });

  it('mounts both entries when the stack has two flows so hidden state stays alive', () => {
    // The smoke: a two-entry stack must produce two React subtrees, both
    // mounted. CSS display:none on the bottom one keeps its React state +
    // viewport + (when wired by FlowStackPane) SSE connections alive while
    // the top entry is shown.
    const tree = FlowStackList({ stack: STACK, renderEntry });
    const mounted = findAll(
      tree,
      (el) => el.type === 'section' && typeof el.props['data-testid'] === 'string',
    );
    expect(mounted).toHaveLength(2);
    const ids = mounted.map((el) => el.props['data-testid']);
    expect(ids).toEqual(['entry-orders/pipeline', 'entry-orders/edge-cases']);
  });

  it('gives duplicate-slug entries independent keys so A→B→A gets a fresh mount', () => {
    // React's reconciler keys diverge per-position when slugs repeat. The
    // wrapper key is `entry.slug` (per the AC), so a triple-stack with a
    // repeated head slug renders three wrappers — the duplicate will mount
    // a fresh subtree because React will see the new key in a new
    // position. The data-flow-stack-entry attribute mirrors the key so the
    // test can assert the order without reaching into React internals.
    const tree = FlowStackList({ stack: TRIPLE_STACK_WITH_REPEAT, renderEntry });
    const wrappers = findWrappers(tree);
    expect(wrappers.map((w) => w.props['data-flow-stack-entry'])).toEqual([
      'orders/pipeline',
      'orders/edge-cases',
      'orders/pipeline',
    ]);
    const styles = wrappers.map((w) => (w.props.style as React.CSSProperties).display);
    expect(styles).toEqual(['none', 'none', 'block']);
  });

  it('treats a single-entry stack as the top entry with display:block', () => {
    const tree = FlowStackList({ stack: STACK.slice(0, 1), renderEntry });
    const wrappers = findWrappers(tree);
    expect(wrappers).toHaveLength(1);
    expect((wrappers[0]?.props.style as React.CSSProperties).display).toBe('block');
    expect(wrappers[0]?.props['data-flow-stack-top']).toBe('true');
  });
});
