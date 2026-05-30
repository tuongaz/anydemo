import { describe, expect, it } from 'bun:test';
import { Handle, type NodeProps } from '@xyflow/react';
import { AlertTriangle, Link2, Pencil } from 'lucide-react';
import * as React from 'react';
import { LinkflowNode } from './linkflow-node.tsx';

// Hook-shim render pattern documented in image-node.test.tsx and
// icon-node.test.tsx — bun runs the canvas tests without a real ReactFlow
// mount, so we call the memoized impl directly and walk the returned tree.
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

function findAll(tree: unknown, predicate: (el: ReactElementLike) => boolean): ReactElementLike[] {
  const out: ReactElementLike[] = [];
  const visit = (node: unknown) => {
    if (!isElement(node)) return;
    if (predicate(node)) out.push(node);
    const children = node.props.children;
    if (children === undefined || children === null) return;
    const arr = Array.isArray(children) ? children : [children];
    for (const c of arr) visit(c);
  };
  visit(tree);
  return out;
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

function callLinkflowNode(
  data: Record<string, unknown> = {},
  overrides: Partial<NodeProps> = {},
): unknown {
  const props = {
    id: 'lf-1',
    type: 'linkflow',
    data,
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
  const impl = (LinkflowNode as unknown as { type: (p: NodeProps) => unknown }).type;
  return renderWithHooks(() => impl(props));
}

function getRoot(tree: unknown): ReactElementLike {
  const el = findElement(tree, (n) => {
    const p = n.props as { 'data-testid'?: string };
    return p['data-testid'] === 'linkflow-node';
  });
  if (!el) throw new Error('linkflow-node root missing');
  return el;
}

describe('LinkflowNode unlinked state (US-002)', () => {
  it("renders dashed border + 'Link to a flow' button with Link2 icon when target is unset", () => {
    const tree = callLinkflowNode();
    const root = getRoot(tree);
    expect((root.props as { 'data-linkflow-state'?: string })['data-linkflow-state']).toBe(
      'unlinked',
    );
    const button = findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'linkflow-link-button';
    });
    expect(button).not.toBeNull();
    // The button must contain the Link2 lucide icon.
    const icons = findAll(tree, (el) => el.type === Link2);
    expect(icons.length).toBeGreaterThan(0);
  });

  it('treats target=undefined as unlinked even when _resolvedTarget is supplied (defensive)', () => {
    const tree = callLinkflowNode({
      _resolvedTarget: { projectName: 'Stale', flowName: 'Stale' },
    });
    expect((getRoot(tree).props as { 'data-linkflow-state'?: string })['data-linkflow-state']).toBe(
      'unlinked',
    );
  });

  it('button click fires onOpenPicker with mode="link"', () => {
    const seen: { mode: string | null } = { mode: null };
    const tree = callLinkflowNode({
      onOpenPicker: (mode: string) => {
        seen.mode = mode;
      },
    });
    const button = findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'linkflow-link-button';
    });
    if (!button) throw new Error('expected link button');
    const onClick = (button.props as { onClick?: (e: { stopPropagation: () => void }) => void })
      .onClick;
    onClick?.({ stopPropagation: () => {} });
    expect(seen.mode).toBe('link');
  });

  it('click handlers are no-op safe when onOpenPicker is absent', () => {
    // US-002 AC: 'Click handlers are no-op placeholders at this story'.
    const tree = callLinkflowNode();
    const button = findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'linkflow-link-button';
    });
    if (!button) throw new Error('expected link button');
    const onClick = (button.props as { onClick?: (e: { stopPropagation: () => void }) => void })
      .onClick;
    // Should not throw.
    expect(() => onClick?.({ stopPropagation: () => {} })).not.toThrow();
  });
});

describe('LinkflowNode linked-healthy state (US-002)', () => {
  it('renders flow name + project name from resolved target', () => {
    const tree = callLinkflowNode({
      target: { project: 'demo', flow: 'orders' },
      _resolvedTarget: { projectName: 'Demo Project', flowName: 'Orders Flow' },
    });
    const root = getRoot(tree);
    expect((root.props as { 'data-linkflow-state'?: string })['data-linkflow-state']).toBe(
      'linked-healthy',
    );
    const flowName = findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'linkflow-flow-name';
    });
    const projectName = findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'linkflow-project-name';
    });
    expect(flowName?.props.children).toBe('Orders Flow');
    expect(projectName?.props.children).toBe('Demo Project');
  });

  it('body button has no-op safe onClick when onFollow is absent (US-002 placeholder)', () => {
    const tree = callLinkflowNode({
      target: { project: 'demo', flow: 'orders' },
      _resolvedTarget: { projectName: 'Demo', flowName: 'Orders' },
    });
    const body = findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'linkflow-follow-button';
    });
    if (!body) throw new Error('expected follow button');
    const onClick = (body.props as { onClick?: (e: { stopPropagation: () => void }) => void })
      .onClick;
    expect(() => onClick?.({ stopPropagation: () => {} })).not.toThrow();
  });

  it('renders a Pencil edit button that fires onOpenPicker("edit")', () => {
    const seen: { mode: string | null } = { mode: null };
    const tree = callLinkflowNode({
      target: { project: 'demo', flow: 'orders' },
      _resolvedTarget: { projectName: 'Demo', flowName: 'Orders' },
      onOpenPicker: (mode: string) => {
        seen.mode = mode;
      },
    });
    const pencils = findAll(tree, (el) => el.type === Pencil);
    expect(pencils.length).toBeGreaterThan(0);
    const editBtn = findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'linkflow-edit-button';
    });
    if (!editBtn) throw new Error('expected edit button');
    const onClick = (editBtn.props as { onClick?: (e: { stopPropagation: () => void }) => void })
      .onClick;
    onClick?.({ stopPropagation: () => {} });
    expect(seen.mode).toBe('edit');
  });
});

describe('LinkflowNode broken state (US-002)', () => {
  it('renders amber + AlertTriangle when target is set but _resolvedTarget is null', () => {
    const tree = callLinkflowNode({
      target: { project: 'demo', flow: 'missing' },
      _resolvedTarget: null,
    });
    const root = getRoot(tree);
    expect((root.props as { 'data-linkflow-state'?: string })['data-linkflow-state']).toBe(
      'broken',
    );
    const triangles = findAll(tree, (el) => el.type === AlertTriangle);
    expect(triangles.length).toBeGreaterThan(0);
  });

  it('renders broken when target is set but _resolvedTarget is undefined', () => {
    const tree = callLinkflowNode({
      target: { project: 'demo', flow: 'missing' },
    });
    expect((getRoot(tree).props as { 'data-linkflow-state'?: string })['data-linkflow-state']).toBe(
      'broken',
    );
  });

  it('shows the last-known "project · flow" slug pair in the muted label', () => {
    const tree = callLinkflowNode({
      target: { project: 'archived-proj', flow: 'gone-flow' },
      _resolvedTarget: null,
    });
    const label = findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'linkflow-broken-label';
    });
    expect(label?.props.children).toBe('archived-proj · gone-flow');
  });

  it('body click fires onOpenPicker("edit")', () => {
    const seen: { mode: string | null } = { mode: null };
    const tree = callLinkflowNode({
      target: { project: 'demo', flow: 'missing' },
      _resolvedTarget: null,
      onOpenPicker: (mode: string) => {
        seen.mode = mode;
      },
    });
    const root = getRoot(tree);
    const onClick = (root.props as { onClick?: (e: { stopPropagation: () => void }) => void })
      .onClick;
    onClick?.({ stopPropagation: () => {} });
    expect(seen.mode).toBe('edit');
  });
});

describe('LinkflowNode connect handles', () => {
  it('renders four Handle elements regardless of state', () => {
    for (const data of [
      {},
      {
        target: { project: 'demo', flow: 'orders' },
        _resolvedTarget: { projectName: 'Demo', flowName: 'Orders' },
      },
      {
        target: { project: 'demo', flow: 'missing' },
        _resolvedTarget: null,
      },
    ]) {
      const tree = callLinkflowNode(data);
      const handles = findAll(tree, (el) => el.type === Handle);
      expect(handles).toHaveLength(4);
    }
  });
});

// Shared-ref hook-shim that runs `useEffect` synchronously. The default
// renderWithHooks above stubs useEffect as a no-op (every other linkflow
// rendering test only exercises the render path), so the auto-open useEffect
// can't fire. The shim below persists refs across render calls so a second
// render reuses the same `firedRef`, exercising the "does NOT re-fire"
// invariant the toolbar drag-create flow depends on.
type EffectShim = {
  hooks: Hooks;
  reset: () => void;
};
function makeEffectShim(): EffectShim {
  const refs: { current: unknown }[] = [];
  let refIdx = 0;
  const hooks: Hooks = {
    useState: <S,>(initial: S | (() => S)) => {
      const value = typeof initial === 'function' ? (initial as () => S)() : initial;
      return [value, () => {}];
    },
    useCallback: <T,>(fn: T) => fn,
    useMemo: <T,>(fn: () => T) => fn(),
    useRef: <T,>(initial: T) => {
      if (refIdx < refs.length) {
        const slot = refs[refIdx++] as { current: T };
        return slot;
      }
      const r = { current: initial };
      refs.push(r);
      refIdx++;
      return r as { current: T };
    },
    useEffect: ((fn: () => void) => {
      fn();
    }) as Hooks['useEffect'],
  };
  return {
    hooks,
    reset: () => {
      refIdx = 0;
    },
  };
}

function renderLinkflowWithEffects(
  data: Record<string, unknown>,
  shim: EffectShim = makeEffectShim(),
): { tree: unknown; shim: EffectShim } {
  shim.reset();
  const props = {
    id: 'lf-1',
    type: 'linkflow',
    data,
    selected: false,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    zIndex: 0,
    dragging: false,
    deletable: true,
    draggable: true,
    selectable: true,
  } as unknown as NodeProps;
  const internals = (
    React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: Hooks | null };
      };
    }
  ).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const prev = internals.ReactCurrentDispatcher.current;
  internals.ReactCurrentDispatcher.current = shim.hooks;
  try {
    const impl = (LinkflowNode as unknown as { type: (p: NodeProps) => unknown }).type;
    const tree = impl(props);
    return { tree, shim };
  } finally {
    internals.ReactCurrentDispatcher.current = prev;
  }
}

describe('LinkflowNode auto-open picker on mount (toolbar drag-create)', () => {
  it("fires onOpenPicker('link') exactly once when _autoOpenPickerOnMount is set", () => {
    const calls: string[] = [];
    renderLinkflowWithEffects({
      _autoOpenPickerOnMount: true,
      onOpenPicker: (mode: string) => calls.push(mode),
    });
    expect(calls).toEqual(['link']);
  });

  it('does NOT fire when _autoOpenPickerOnMount is absent', () => {
    const calls: string[] = [];
    renderLinkflowWithEffects({
      onOpenPicker: (mode: string) => calls.push(mode),
    });
    expect(calls).toEqual([]);
  });

  it('does NOT fire while onOpenPicker is missing, then fires once the callback wires in', () => {
    const calls: string[] = [];
    const shim = makeEffectShim();
    // First render: flag is set but the host has not threaded onOpenPicker
    // yet (linkflowDecoratedNodes loads in a useMemo on the same tick — this
    // models the transitional render before the decoration lands).
    renderLinkflowWithEffects({ _autoOpenPickerOnMount: true }, shim);
    expect(calls).toEqual([]);
    // Second render with the same ref slots — callback now present, effect
    // re-evaluates its deps (data.onOpenPicker changed from undefined → fn)
    // and fires the picker exactly once.
    renderLinkflowWithEffects(
      {
        _autoOpenPickerOnMount: true,
        onOpenPicker: (mode: string) => calls.push(mode),
      },
      shim,
    );
    expect(calls).toEqual(['link']);
  });

  it('does NOT re-fire on a re-render after the initial mount fire', () => {
    const calls: string[] = [];
    const shim = makeEffectShim();
    const data = {
      _autoOpenPickerOnMount: true,
      onOpenPicker: (mode: string) => calls.push(mode),
    };
    renderLinkflowWithEffects(data, shim);
    expect(calls).toEqual(['link']);
    // Same shim → same firedRef. Second render with identical inputs must
    // bail out before re-firing the picker. The flag may still be set on
    // disk-shape data (it's a runtime-only flag, but the renderer doesn't
    // know that) and `onOpenPicker` may still be wired — the guard is in
    // `firedRef`, not in the data.
    renderLinkflowWithEffects(data, shim);
    expect(calls).toEqual(['link']);
  });
});
