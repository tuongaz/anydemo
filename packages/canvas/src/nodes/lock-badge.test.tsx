import { describe, expect, it } from 'bun:test';
import { LockBadge } from './lock-badge.tsx';

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

describe('LockBadge', () => {
  // US-018: the badge MUST NOT carry `pointer-events-none`. Because it's
  // positioned at `-top-2 -right-2` (8px outside the xyflow node wrapper's
  // geometry), pointer-events:none caused hit-testing to skip the badge and
  // fall through to the React Flow pane underneath — making right-click on a
  // locked node fire onPaneContextMenu (the Paste menu) instead of
  // onNodeContextMenu. With pointer-events at the browser default (auto), the
  // badge IS the hit target and contextmenu/click events bubble through the
  // DOM to the wrapper, where xyflow's onContextMenu handler correctly fires
  // onNodeContextMenu.
  it('does not set pointer-events:none on the rendered span (US-018)', () => {
    const tree = LockBadge({});
    if (!isElement(tree)) throw new Error('LockBadge did not return an element');
    const className = tree.props.className as string;
    expect(className).toContain('absolute');
    expect(className).not.toContain('pointer-events-none');
  });

  it('still carries the offset positioning that places it outside the node wrapper', () => {
    // Positioning invariant from the original US-019 design — kept so the
    // badge sits clearly above-right of the node corner without overlapping
    // the top-middle connection handle. The US-018 fix is the pointer-events
    // change; positioning is unchanged.
    const tree = LockBadge({});
    if (!isElement(tree)) throw new Error('LockBadge did not return an element');
    const className = tree.props.className as string;
    expect(className).toContain('-top-2');
    expect(className).toContain('-right-2');
  });

  it('merges caller className over the base class list', () => {
    const tree = LockBadge({ className: 'custom-extra' });
    if (!isElement(tree)) throw new Error('LockBadge did not return an element');
    const className = tree.props.className as string;
    expect(className).toContain('custom-extra');
  });

  it('renders an aria-hidden span (decorative — events bubble to parent)', () => {
    const tree = LockBadge({});
    if (!isElement(tree)) throw new Error('LockBadge did not return an element');
    expect(tree.type).toBe('span');
    expect(tree.props['aria-hidden']).toBe('true');
  });

  it('carries the stable test-id so node renderers can assert its presence', () => {
    const tree = LockBadge({});
    if (!isElement(tree)) throw new Error('LockBadge did not return an element');
    expect(tree.props['data-testid']).toBe('node-lock-badge');
  });
});
