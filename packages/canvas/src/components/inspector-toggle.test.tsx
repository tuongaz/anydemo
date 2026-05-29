import { describe, expect, it, mock } from 'bun:test';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import * as React from 'react';
import { TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx';
import { InspectorToggle, type InspectorToggleProps } from './inspector-toggle.tsx';

// Bun runs canvas tests without a DOM. Mirror the dispatcher-shim pattern used
// by share-menu.test.tsx / icon-picker-popover.test.tsx: install a synchronous
// React hook dispatcher, call the component as a function, then walk the
// returned JSX tree. Sub-components are captured as `{ type, props }` placeholders
// without executing — assertions stay at the structural level.
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: () => void;
  useContext: () => unknown;
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
    useContext: () => null,
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

function renderInspectorToggle(props: InspectorToggleProps): unknown {
  return renderWithHooks(() =>
    (InspectorToggle as unknown as (p: InspectorToggleProps) => unknown)(props),
  );
}

// The Button is wrapped in TooltipTrigger asChild — pull the rendered button by
// its data-testid so tests don't have to care about the wrapper stack.
function findButton(tree: unknown): ReactElementLike | null {
  return findElement(tree, (el) => {
    const props = el.props as { 'data-testid'?: unknown };
    return props['data-testid'] === 'inspector-toggle';
  });
}

describe('InspectorToggle', () => {
  it('renders PanelRightOpen icon when open=false', () => {
    const tree = renderInspectorToggle({ open: false, onToggle: () => {} });
    const icon = findElement(tree, (el) => el.type === (PanelRightOpen as unknown));
    expect(icon).not.toBeNull();
    const closedIcon = findElement(tree, (el) => el.type === (PanelRightClose as unknown));
    expect(closedIcon).toBeNull();
  });

  it('renders PanelRightClose icon when open=true', () => {
    const tree = renderInspectorToggle({ open: true, onToggle: () => {} });
    const icon = findElement(tree, (el) => el.type === (PanelRightClose as unknown));
    expect(icon).not.toBeNull();
    const openIcon = findElement(tree, (el) => el.type === (PanelRightOpen as unknown));
    expect(openIcon).toBeNull();
  });

  it('invokes onToggle exactly once per click', () => {
    const onToggle = mock(() => {});
    const tree = renderInspectorToggle({ open: false, onToggle });
    const button = findButton(tree);
    expect(button).not.toBeNull();
    const handler = button?.props.onClick as (() => void) | undefined;
    expect(typeof handler).toBe('function');
    handler?.();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('reflects open=false via aria-pressed', () => {
    const tree = renderInspectorToggle({ open: false, onToggle: () => {} });
    const button = findButton(tree);
    expect(button?.props['aria-pressed']).toBe(false);
  });

  it('reflects open=true via aria-pressed', () => {
    const tree = renderInspectorToggle({ open: true, onToggle: () => {} });
    const button = findButton(tree);
    expect(button?.props['aria-pressed']).toBe(true);
  });

  it('uses the "Open inspector" tooltip + aria-label when closed', () => {
    const tree = renderInspectorToggle({ open: false, onToggle: () => {} });
    const tooltipContent = findElement(tree, (el) => el.type === (TooltipContent as unknown));
    expect(tooltipContent?.props.children).toBe('Open inspector');
    const button = findButton(tree);
    expect(button?.props['aria-label']).toBe('Open inspector');
  });

  it('uses the "Hide inspector" tooltip + aria-label when open', () => {
    const tree = renderInspectorToggle({ open: true, onToggle: () => {} });
    const tooltipContent = findElement(tree, (el) => el.type === (TooltipContent as unknown));
    expect(tooltipContent?.props.children).toBe('Hide inspector');
    const button = findButton(tree);
    expect(button?.props['aria-label']).toBe('Hide inspector');
  });

  it('mounts the button as a TooltipTrigger child (asChild pattern)', () => {
    const tree = renderInspectorToggle({ open: false, onToggle: () => {} });
    const trigger = findElement(tree, (el) => el.type === (TooltipTrigger as unknown));
    expect(trigger).not.toBeNull();
    expect(trigger?.props.asChild).toBe(true);
  });
});
