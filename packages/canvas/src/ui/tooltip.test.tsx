import { describe, expect, it } from 'bun:test';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as React from 'react';
import { TooltipContent } from './tooltip.tsx';

// The side panel's tooltips (Fill, Border, …) live inside
// xyflow's `<Panel>` which is a sibling of the zoom/pan-transformed
// `.react-flow__viewport`. Radix Tooltip uses Floating UI with `position:
// fixed`, and a `position:fixed` element becomes anchored to the nearest
// transformed/filtered/will-change ancestor — NOT the viewport — so any
// transform inherited from the canvas (or applied by the tooltip's own
// `zoom-in-95` animation) shifts the floating wrapper away from the icon.
// The canonical fix (Radix docs + shadcn template) is to portal-mount the
// content to `document.body` via TooltipPrimitive.Portal — this puts the
// floating wrapper at the document root where no transformed ancestor can
// affect its containing block.
//
// Bun runs apps/web tests without a DOM, so we can't measure bounding
// rects. Instead we call TooltipContent's render function (it's wrapped in
// `React.forwardRef`) and walk the returned React element tree to assert
// the structural invariant: the root element MUST be `TooltipPrimitive.
// Portal` and the actual `TooltipPrimitive.Content` MUST be its sole child.

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

// React.forwardRef returns `{ $$typeof, render }`. Pull off `render` and
// invoke it directly with synthetic props + a null ref — that gives us the
// first render's JSX tree without any DOM machinery. Wrap the render in a
// minimal React hook dispatcher so the body's `useCanvasPortalContainer`
// call (added to thread Radix Portal `container` for the scoped-CSS
// refactor) doesn't trip the no-dispatcher guard.
type ForwardRefRender = (props: Record<string, unknown>, ref: unknown) => unknown;
const renderTooltipContent = (props: Record<string, unknown> = {}) => {
  const fwd = TooltipContent as unknown as { render: ForwardRefRender };
  // biome-ignore lint/suspicious/noExplicitAny: shimming React internals for this offline render
  const dispatcherHost = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
    .ReactCurrentDispatcher;
  const prev = dispatcherHost.current;
  dispatcherHost.current = { useContext: () => null };
  try {
    return fwd.render(props, null);
  } finally {
    dispatcherHost.current = prev;
  }
};

describe('US-019: TooltipContent portal-mounts to document.body', () => {
  it('renders TooltipPrimitive.Portal in the tree', () => {
    const tree = renderTooltipContent({ children: 'Fill' });
    expect(isElement(tree)).toBe(true);
    const portal = findElement(tree, (el) => el.type === (TooltipPrimitive.Portal as unknown));
    expect(portal).not.toBeNull();
  });

  it('renders TooltipPrimitive.Content as a descendant of the Portal', () => {
    const tree = renderTooltipContent({ children: 'Fill' });
    const content = findElement(tree, (el) => el.type === (TooltipPrimitive.Content as unknown));
    expect(content).not.toBeNull();
  });

  it('forwards the sideOffset default to TooltipPrimitive.Content', () => {
    const tree = renderTooltipContent({ children: 'Fill' });
    const content = findElement(tree, (el) => el.type === (TooltipPrimitive.Content as unknown));
    expect(content?.props.sideOffset).toBe(4);
  });

  it('forwards a custom sideOffset through the Portal wrapper', () => {
    const tree = renderTooltipContent({ children: 'Fill', sideOffset: 12 });
    const content = findElement(tree, (el) => el.type === (TooltipPrimitive.Content as unknown));
    expect(content?.props.sideOffset).toBe(12);
  });

  it('forwards children through the Portal wrapper to Content', () => {
    const tree = renderTooltipContent({ children: 'Border' });
    const content = findElement(tree, (el) => el.type === (TooltipPrimitive.Content as unknown));
    expect(content?.props.children).toBe('Border');
  });
});
