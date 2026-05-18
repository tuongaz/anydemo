import { describe, expect, it } from 'bun:test';
import { StatusBadge, type StatusBadgeProps } from '@/components/nodes/status-badge';

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

// Invoke the function-component directly to get its rendered element tree —
// avoids React Flow / DOM. Same pattern as the rest of the node tests.
function renderStatusBadge(props: StatusBadgeProps): ReactElementLike {
  const out = (StatusBadge as unknown as (p: StatusBadgeProps) => unknown)(props);
  if (!isElement(out)) throw new Error('expected element from StatusBadge');
  return out;
}

describe('StatusBadge', () => {
  it('renders the summary text when provided', () => {
    const tree = renderStatusBadge({ state: 'ok', summary: 'all good' });
    const span = findElement(tree, (n) => {
      if (n.type !== 'span') return false;
      const className = String((n.props as { className?: string }).className ?? '');
      return className.includes('truncate');
    });
    if (!span) throw new Error('expected summary span');
    expect(span.props.children).toBe('all good');
    // The title attr provides full-text on hover when the summary is ellipsized.
    expect((span.props as { title?: string }).title).toBe('all good');
  });

  it('omits the summary span entirely when summary is absent', () => {
    const tree = renderStatusBadge({ state: 'pending' });
    const span = findElement(tree, (n) => {
      if (n.type !== 'span') return false;
      const className = String((n.props as { className?: string }).className ?? '');
      return className.includes('truncate');
    });
    expect(span).toBeNull();
  });

  it('applies the right Tailwind dot color per state', () => {
    const cases = [
      { state: 'ok' as const, expected: 'bg-emerald-400' },
      { state: 'warn' as const, expected: 'bg-amber-400' },
      { state: 'error' as const, expected: 'bg-rose-400' },
      { state: 'pending' as const, expected: 'bg-slate-400' },
    ];
    for (const { state, expected } of cases) {
      const tree = renderStatusBadge({ state });
      const dot = findElement(tree, (n) => {
        if (n.type !== 'span') return false;
        const className = String((n.props as { className?: string }).className ?? '');
        return className.includes('rounded-full') && className.includes('h-2');
      });
      if (!dot) throw new Error(`expected dot for state=${state}`);
      const dotClassName = String((dot.props as { className?: string }).className ?? '');
      expect(dotClassName).toContain(expected);
    }
  });

  it('forwards data-testid to the wrapper', () => {
    const tree = renderStatusBadge({ state: 'ok', 'data-testid': 'my-badge' });
    expect((tree.props as { 'data-testid'?: string })['data-testid']).toBe('my-badge');
    expect((tree.props as { 'data-state'?: string })['data-state']).toBe('ok');
  });
});
