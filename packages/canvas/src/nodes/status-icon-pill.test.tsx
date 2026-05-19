import { describe, expect, it } from 'bun:test';
import { AlertTriangle, Check, Radar } from 'lucide-react';
import { StatusIconPill } from './status-icon-pill.tsx';

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

describe('StatusIconPill', () => {
  it('renders nothing for idle', () => {
    const result = StatusIconPill({ visualStatus: 'idle' });
    expect(result).toBeNull();
  });

  it('renders the Radar icon and amber tone for active', () => {
    const result = StatusIconPill({ visualStatus: 'active', summary: 'Checking' });
    expect(result).not.toBeNull();
    const icon = findElement(result, (el) => el.type === Radar);
    expect(icon).not.toBeNull();
    const wrapper = isElement(result) ? result : null;
    expect((wrapper?.props as { 'data-visual-status'?: string })['data-visual-status']).toBe(
      'active',
    );
    expect((wrapper?.props as { title?: string }).title).toBe('Checking');
  });

  it('renders the Check icon for success', () => {
    const result = StatusIconPill({ visualStatus: 'success' });
    const icon = findElement(result, (el) => el.type === Check);
    expect(icon).not.toBeNull();
    const wrapper = isElement(result) ? result : null;
    expect((wrapper?.props as { 'data-visual-status'?: string })['data-visual-status']).toBe(
      'success',
    );
  });

  it('renders the AlertTriangle icon for error', () => {
    const result = StatusIconPill({ visualStatus: 'error', summary: 'Down' });
    const icon = findElement(result, (el) => el.type === AlertTriangle);
    expect(icon).not.toBeNull();
    const wrapper = isElement(result) ? result : null;
    expect((wrapper?.props as { 'data-visual-status'?: string })['data-visual-status']).toBe(
      'error',
    );
  });

  it('forwards data-testid', () => {
    const result = StatusIconPill({ visualStatus: 'success', 'data-testid': 'pill-x' });
    const wrapper = isElement(result) ? result : null;
    expect((wrapper?.props as { 'data-testid'?: string })['data-testid']).toBe('pill-x');
  });
});
