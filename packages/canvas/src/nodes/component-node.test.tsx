import { describe, expect, it } from 'bun:test';
import { Handle, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import * as React from 'react';

const { ComponentNode, COMPONENT_DEFAULT_SIZE } = await import('./component-node.tsx');
const { ComponentRuntime } = await import('./component-runtime.tsx');
const { Icon } = await import('../ui/icon.tsx');
const { COLOR_TOKENS } = await import('../lib/color-tokens.ts');

import type { ComponentSpec } from '../types.ts';

// Hook-shim renderer pattern documented in image-node.test.tsx /
// html-node.test.tsx. Bun's test runtime has no DOM and xyflow's <Handle>
// reads from a zustand store, so we walk the JSX tree directly.
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

const TRIVIAL_SPEC: ComponentSpec = {
  root: 'root',
  elements: {
    root: { type: 'Card', children: ['t'] },
    t: { type: 'Text', props: { text: 'hi' } },
  },
};

function callComponentNode(
  data: Record<string, unknown> = {},
  overrides: Partial<NodeProps> = {},
): unknown {
  const props = {
    id: 'c1',
    type: 'component',
    data: { spec: TRIVIAL_SPEC, ...data },
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
  const impl = (ComponentNode as unknown as { type: (p: NodeProps) => unknown }).type;
  return renderWithHooks(() => impl(props));
}

function getContainerStyle(tree: unknown): CSSProperties {
  const container = findElement(tree, (el) => {
    const p = el.props as { 'data-testid'?: string };
    return p['data-testid'] === 'component-node';
  });
  if (!container) throw new Error('component-node container missing');
  return (container.props as { style?: CSSProperties }).style ?? {};
}

function getChromeStyle(tree: unknown): CSSProperties {
  const chrome = findElement(tree, (el) => {
    const p = el.props as { 'data-testid'?: string };
    return p['data-testid'] === 'component-node-chrome';
  });
  if (!chrome) throw new Error('component-node-chrome wrapper missing');
  return (chrome.props as { style?: CSSProperties }).style ?? {};
}

function findRuntime(tree: unknown): ReactElementLike | null {
  return findElement(tree, (el) => el.type === ComponentRuntime);
}

describe('ComponentNode container', () => {
  it('renders with data-node-type="component"', () => {
    const tree = callComponentNode();
    const root = findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'component-node';
    });
    expect(root).not.toBeNull();
    const attr = (root?.props as { 'data-node-type'?: string })['data-node-type'];
    expect(attr).toBe('component');
  });

  it('mounts ComponentRuntime with the spec, nodeId, flowId and apiBaseUrl from data', () => {
    const tree = callComponentNode({ flowId: 'demo-42', apiBaseUrl: '/custom' });
    const runtime = findRuntime(tree);
    expect(runtime).not.toBeNull();
    const props = runtime?.props as {
      spec?: ComponentSpec;
      nodeId?: string;
      flowId?: string;
      apiBaseUrl?: string;
    };
    expect(props.spec).toBe(TRIVIAL_SPEC);
    expect(props.nodeId).toBe('c1');
    expect(props.flowId).toBe('demo-42');
    expect(props.apiBaseUrl).toBe('/custom');
  });
});

describe('ComponentNode handles', () => {
  it('renders all four <Handle> elements when isConnectable is true', () => {
    const tree = callComponentNode();
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
  });

  it('still renders four handles when selected (opacity toggle, not gated render)', () => {
    const tree = callComponentNode({}, { selected: true } as Partial<NodeProps>);
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
  });
});

describe('ComponentNode wrapper style', () => {
  it('omits color tokens from chrome style when fields are unset', () => {
    const style = getChromeStyle(callComponentNode());
    expect(style.backgroundColor).toBeUndefined();
    expect(style.borderColor).toBeUndefined();
    expect(style.borderWidth).toBeUndefined();
    expect(style.borderStyle).toBeUndefined();
    expect(style.borderRadius).toBeUndefined();
  });

  it('applies border + background tokens to the chrome wrapper when fields are set', () => {
    const style = getChromeStyle(
      callComponentNode({
        backgroundColor: 'blue',
        borderColor: 'amber',
        borderSize: 2,
        borderStyle: 'dashed',
        cornerRadius: 8,
      }),
    );
    expect(style.backgroundColor).toBe(COLOR_TOKENS.blue.background);
    expect(style.borderColor).toBe(COLOR_TOKENS.amber.border);
    expect(style.borderWidth).toBe(2);
    expect(style.borderStyle).toBe('dashed');
    expect(style.borderRadius).toBe(8);
  });

  it('falls back to COMPONENT_DEFAULT_SIZE when user-sized and width/height are absent', () => {
    const style = getContainerStyle(callComponentNode());
    expect(style.width).toBe(COMPONENT_DEFAULT_SIZE.width);
    expect(style.height).toBe(COMPONENT_DEFAULT_SIZE.height);
  });

  it('uses width/height from data when set', () => {
    const style = getContainerStyle(callComponentNode({ width: 480, height: 360 }));
    expect(style.width).toBe(480);
    expect(style.height).toBe(360);
  });
});

describe('ComponentNode label', () => {
  it('renders a label element below the content when data.name is set', () => {
    const tree = callComponentNode({ name: 'Counter card' });
    const label = findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'component-node-label';
    });
    expect(label).not.toBeNull();
    expect((label?.props as { children?: unknown }).children).toBe('Counter card');
  });

  it('omits the label element when data.name is absent', () => {
    const tree = callComponentNode();
    const label = findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'component-node-label';
    });
    expect(label).toBeNull();
  });

  it('renders an Icon inline with the caption when data.icon is set', () => {
    const tree = callComponentNode({ name: 'Counter card', icon: 'sparkles' });
    const label = findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'component-node-label';
    });
    if (!label) throw new Error('expected component-node-label');
    const icon = findElement(label, (el) => el.type === Icon);
    if (!icon) throw new Error('expected Icon in component-node-label');
    expect((icon.props as { name?: string }).name).toBe('sparkles');
    expect((icon.props as { size?: number }).size).toBe(12);
  });
});
