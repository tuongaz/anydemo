import { describe, expect, it, mock } from 'bun:test';
import { Handle, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import * as React from 'react';

const { ComponentNode, COMPONENT_DEFAULT_SIZE } = await import('./component-node.tsx');
const { ComponentRuntime } = await import('./component-runtime.tsx');
const { NodeHeader } = await import('./lib/node-header.tsx');
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

function getBodyStyle(tree: unknown): Record<string, unknown> {
  const body = findElement(tree, (el) => {
    const p = el.props as { 'data-testid'?: string };
    return p['data-testid'] === 'component-node-body';
  });
  if (!body) throw new Error('component-node-body missing');
  return ((body.props as { style?: CSSProperties }).style ?? {}) as Record<string, unknown>;
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

  it('mounts ComponentRuntime with the spec from data', () => {
    const tree = callComponentNode();
    const runtime = findRuntime(tree);
    expect(runtime).not.toBeNull();
    const props = runtime?.props as { spec?: ComponentSpec };
    expect(props.spec).toBe(TRIVIAL_SPEC);
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
    expect((style as { boxShadow?: string }).boxShadow).toBeUndefined();
  });

  it('paints var(--node-shadow-N) on the chrome wrapper when data.shadow is set', () => {
    const style = getChromeStyle(callComponentNode({ shadow: 3 }));
    expect((style as { boxShadow?: string }).boxShadow).toBe('var(--node-shadow-3)');
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

  it('defaults to auto-size: outer style has no width/height and chrome is inline-block', () => {
    const tree = callComponentNode();
    const outer = getContainerStyle(tree);
    expect(outer.width).toBeUndefined();
    expect(outer.height).toBeUndefined();
    const chrome = findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'component-node-chrome';
    });
    const chromeClass = ((chrome?.props as { className?: string }).className ?? '').split(/\s+/);
    expect(chromeClass).toContain('sf:inline-block');
  });

  it('mounts the measuring body with the 800×600 cap when auto-sizing', () => {
    const tree = callComponentNode();
    const body = findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'component-node-body';
    });
    expect(body).not.toBeNull();
    const bodyClass = ((body?.props as { className?: string }).className ?? '').split(/\s+/);
    expect(bodyClass).toContain('sf:inline-block');
    const style = (body?.props as { style?: CSSProperties }).style ?? {};
    expect(style.maxWidth).toBe(800);
    expect(style.maxHeight).toBe(600);
    expect(style.overflow).toBe('auto');
  });

  it('uses width/height from data when autoSize: false', () => {
    const style = getContainerStyle(
      callComponentNode({ autoSize: false, width: 480, height: 360 }),
    );
    expect(style.width).toBe(480);
    expect(style.height).toBe(360);
  });

  it('falls back to COMPONENT_DEFAULT_SIZE when autoSize: false and width/height absent', () => {
    const style = getContainerStyle(callComponentNode({ autoSize: false }));
    expect(style.width).toBe(COMPONENT_DEFAULT_SIZE.width);
    expect(style.height).toBe(COMPONENT_DEFAULT_SIZE.height);
  });

  it('leaves the scrollable body unthemed so the OS draws its native overlay scrollbar', () => {
    // Auto-size branch (inline-block measuring container).
    const autoBody = findElement(callComponentNode(), (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'component-node-body';
    });
    const autoClass = ((autoBody?.props as { className?: string }).className ?? '').split(/\s+/);
    expect(autoClass).not.toContain('seeflow-themed-scrollbar');

    // User-sized branch (flex-1 fill).
    const userBody = findElement(
      callComponentNode({ autoSize: false, width: 480, height: 320 }),
      (el) => {
        const p = el.props as { 'data-testid'?: string };
        return p['data-testid'] === 'component-node-body';
      },
    );
    const userClass = ((userBody?.props as { className?: string }).className ?? '').split(/\s+/);
    expect(userClass).not.toContain('seeflow-themed-scrollbar');
  });
});

describe('ComponentNode component font scaling', () => {
  const SCALE_VAR = '--sf-component-font-scale';

  it('defaults each component to 30% larger text (scale 1.3) when fontSize is unset', () => {
    const style = getBodyStyle(callComponentNode());
    expect(style[SCALE_VAR]).toBe(1.3);
  });

  it('scales the components off the node font-size control (default 22 → 30% bigger)', () => {
    // 44 / 22 * 1.3 = 2.6
    expect(getBodyStyle(callComponentNode({ fontSize: 44 }))[SCALE_VAR]).toBe(2.6);
    // 11 / 22 * 1.3 = 0.65
    expect(getBodyStyle(callComponentNode({ fontSize: 11 }))[SCALE_VAR]).toBe(0.65);
  });

  it('treats fontSize at the control default (22) as the same 30% baseline as unset', () => {
    expect(getBodyStyle(callComponentNode({ fontSize: 22 }))[SCALE_VAR]).toBe(1.3);
  });

  it('drives the Tailwind text tokens off the scale var so every sf:text-* class scales', () => {
    const style = getBodyStyle(callComponentNode());
    expect(style['--sf-text-xs']).toBe('calc(0.75rem * var(--sf-component-font-scale))');
    expect(style['--sf-text-sm']).toBe('calc(0.875rem * var(--sf-component-font-scale))');
    expect(style['--sf-text-base']).toBe('calc(1rem * var(--sf-component-font-scale))');
    expect(style['--sf-text-2xl']).toBe('calc(1.5rem * var(--sf-component-font-scale))');
  });

  it('keeps the auto-size measuring caps alongside the font vars', () => {
    const style = getBodyStyle(callComponentNode());
    expect(style.maxWidth).toBe(800);
    expect(style.maxHeight).toBe(600);
    expect(style.overflow).toBe('auto');
  });

  it('applies the font vars to the user-sized body too', () => {
    const style = getBodyStyle(callComponentNode({ autoSize: false, width: 480, height: 320 }));
    expect(style[SCALE_VAR]).toBe(1.3);
  });
});

describe('ComponentNode fit-to-content button', () => {
  const userSizedData = { autoSize: false, width: 480, height: 320 };

  function findFitButton(tree: unknown) {
    return findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'component-node-fit-to-content';
    });
  }

  it('is hidden when not selected', () => {
    const tree = callComponentNode({ ...userSizedData, onFitToContent: () => {} });
    expect(findFitButton(tree)).toBeNull();
  });

  it('is hidden when autoSize is true (default)', () => {
    const tree = callComponentNode({ onFitToContent: () => {} }, {
      selected: true,
    } as Partial<NodeProps>);
    expect(findFitButton(tree)).toBeNull();
  });

  it('is hidden when onFitToContent is not wired', () => {
    const tree = callComponentNode(userSizedData, { selected: true } as Partial<NodeProps>);
    expect(findFitButton(tree)).toBeNull();
  });

  it('is visible when selected + user-sized + callback wired', () => {
    const tree = callComponentNode({ ...userSizedData, onFitToContent: () => {} }, {
      selected: true,
    } as Partial<NodeProps>);
    expect(findFitButton(tree)).not.toBeNull();
  });

  it('click calls data.onFitToContent with the node id', () => {
    const onFit = mock(() => {});
    const tree = callComponentNode({ ...userSizedData, onFitToContent: onFit }, {
      selected: true,
    } as Partial<NodeProps>);
    const btn = findFitButton(tree);
    expect(btn).not.toBeNull();
    (btn?.props as { onClick?: (e: { stopPropagation: () => void }) => void }).onClick?.({
      stopPropagation: () => {},
    });
    expect(onFit).toHaveBeenCalledTimes(1);
    expect(onFit).toHaveBeenCalledWith('c1');
  });
});

describe('ComponentNode zoom (fullscreen) button', () => {
  const userSizedData = { autoSize: false, width: 480, height: 320 };

  function findZoomButton(tree: unknown) {
    return findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'component-node-zoom';
    });
  }

  // The Dialog wrapper is the element carrying both `open` (boolean) and
  // `onOpenChange` (function) — independent of the ui/dialog import.
  function findZoomDialog(tree: unknown) {
    return findElement(tree, (el) => {
      const p = el.props as { open?: unknown; onOpenChange?: unknown };
      return typeof p.open === 'boolean' && typeof p.onOpenChange === 'function';
    });
  }

  it('is hidden when data.enableFullscreen is unset', () => {
    expect(findZoomButton(callComponentNode())).toBeNull();
  });

  it('is hidden when data.enableFullscreen is false', () => {
    expect(findZoomButton(callComponentNode({ enableFullscreen: false }))).toBeNull();
  });

  it('is visible when data.enableFullscreen is true, regardless of selection/autoSize', () => {
    const tree = callComponentNode({ enableFullscreen: true });
    const btn = findZoomButton(tree);
    expect(btn).not.toBeNull();
    const p = btn?.props as { 'aria-label'?: string; title?: string };
    expect(p['aria-label']).toBe('View fullscreen');
    expect(p.title).toBe('View fullscreen');
  });

  it('takes the top-right corner (right:4) when the Fit button is absent', () => {
    const tree = callComponentNode({ enableFullscreen: true });
    const style = (findZoomButton(tree)?.props as { style?: CSSProperties }).style ?? {};
    expect(style.right).toBe(4);
  });

  it('offsets left of the Fit button (right:28) when both are visible', () => {
    const tree = callComponentNode(
      { ...userSizedData, enableFullscreen: true, onFitToContent: () => {} },
      { selected: true } as Partial<NodeProps>,
    );
    const style = (findZoomButton(tree)?.props as { style?: CSSProperties }).style ?? {};
    expect(style.right).toBe(28);
  });

  it('opens the modal: onClick stops propagation (and the Dialog defaults closed)', () => {
    const tree = callComponentNode({ enableFullscreen: true });
    const dialog = findZoomDialog(tree);
    expect(dialog).not.toBeNull();
    // The hook-shim useState returns its initial value → the modal is closed.
    expect((dialog?.props as { open?: boolean }).open).toBe(false);
    const stop = mock(() => {});
    (
      findZoomButton(tree)?.props as { onClick?: (e: { stopPropagation: () => void }) => void }
    ).onClick?.({ stopPropagation: stop });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('renders the live runtime inside the modal body with the same spec', () => {
    const tree = callComponentNode({
      enableFullscreen: true,
    });
    const body = findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'component-node-zoom-body';
    });
    expect(body).not.toBeNull();
    const runtime = findElement(body, (el) => el.type === ComponentRuntime);
    expect(runtime).not.toBeNull();
    const rp = runtime?.props as { spec?: ComponentSpec };
    expect(rp.spec).toBe(TRIVIAL_SPEC);
  });
});

// Header now lives in the shared `<NodeHeader>` component (see
// `./lib/node-header.tsx`). The hook-shim walker can't see inside its render
// body, so these tests assert the ComponentNode → NodeHeader contract:
// NodeHeader is mounted inside the chrome with the right testids and props.
// NodeHeader's own rendering is covered by `./lib/node-header.test.tsx`.
function findNodeHeader(tree: unknown): ReactElementLike | null {
  return findElement(tree, (el) => el.type === NodeHeader);
}

describe('ComponentNode header', () => {
  it('mounts NodeHeader inside the chrome with the component-node testid props', () => {
    const tree = callComponentNode({ name: 'Counter card' });
    const header = findNodeHeader(tree);
    expect(header).not.toBeNull();
    const headerProps = header?.props as {
      testId?: string;
      titleTestId?: string;
    };
    expect(headerProps.testId).toBe('component-node-header');
    expect(headerProps.titleTestId).toBe('component-node-title');
    const chrome = findElement(tree, (el) => {
      const p = el.props as { 'data-testid'?: string };
      return p['data-testid'] === 'component-node-chrome';
    });
    if (!chrome) throw new Error('expected chrome wrapper');
    expect(findElement(chrome, (el) => el.type === NodeHeader)).not.toBeNull();
  });

  it('forwards the name to NodeHeader as the title source', () => {
    const tree = callComponentNode({ name: 'Counter card' });
    const header = findNodeHeader(tree);
    expect((header?.props as { name?: string })?.name).toBe('Counter card');
  });

  it('omits NodeHeader when data.name is absent', () => {
    const tree = callComponentNode();
    expect(findNodeHeader(tree)).toBeNull();
  });

  it('omits NodeHeader when data.name is the empty string', () => {
    const tree = callComponentNode({ name: '' });
    expect(findNodeHeader(tree)).toBeNull();
  });

  it('omits NodeHeader when only data.icon is set (icon does not surface a standalone header)', () => {
    const tree = callComponentNode({ icon: 'sparkles' });
    expect(findNodeHeader(tree)).toBeNull();
  });

  it('forwards icon + selected + edit callbacks to NodeHeader', () => {
    const onName = () => {};
    const onIcon = () => {};
    const tree = callComponentNode(
      {
        name: 'Counter card',
        icon: 'sparkles',
        onNameChange: onName,
        onIconChange: onIcon,
      },
      { selected: true } as Partial<NodeProps>,
    );
    const header = findNodeHeader(tree);
    const props = header?.props as {
      icon?: string | null;
      selected?: boolean;
      onNameChange?: unknown;
      onIconChange?: unknown;
    };
    expect(props.icon).toBe('sparkles');
    expect(props.selected).toBe(true);
    expect(props.onNameChange).toBe(onName);
    expect(props.onIconChange).toBe(onIcon);
  });
});
