import { describe, expect, it, mock } from 'bun:test';
import * as React from 'react';
import type { Connector, FlowNode } from '../types.ts';
import { type NodeStylePatch, StyleStrip, type StyleStripProps } from './style-strip.tsx';

// Same dispatcher-shim trick used by icon-node.test.tsx and
// icon-picker-popover.test.tsx — apps/web tests run without a DOM, so we
// can't mount the real Radix Popover/Tooltip tree. Calling StyleStrip as a
// function under the shim returns the first render with sub-components
// (SwatchButton, PopoverButton, etc.) captured as `{ type, props }`
// placeholders. We walk that tree to find the icon-color SwatchButton and
// invoke its `onSelect` to assert the apply wiring.
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

function findAll(
  tree: unknown,
  predicate: (el: ReactElementLike) => boolean,
  acc: ReactElementLike[] = [],
): ReactElementLike[] {
  if (!isElement(tree)) return acc;
  if (predicate(tree)) acc.push(tree);
  const children = tree.props.children;
  if (children === undefined || children === null) return acc;
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) findAll(child, predicate, acc);
  return acc;
}

// The strip's SwatchButton / PopoverButton sub-components receive the test id
// via a `testId` prop (which they then render as `data-testid` on the inner
// <button>). Under the dispatcher shim sub-component bodies don't execute, so
// the wrapping element only carries the `testId` prop — match that, not
// `data-testid`. Fall back to `data-testid` for any plain DOM nodes the strip
// renders directly (e.g. the outer canvas-style-strip wrapper).
function testIdEquals(id: string) {
  return (el: ReactElementLike) => {
    const p = el.props as { testId?: string; 'data-testid'?: string };
    return p.testId === id || p['data-testid'] === id;
  };
}

function callStrip(overrides: Partial<StyleStripProps> = {}): unknown {
  const props: StyleStripProps = {
    nodes: [],
    connectors: [],
    onStyleNode: () => {},
    onStyleConnector: () => {},
    ...overrides,
  };
  return renderWithHooks(() => (StyleStrip as unknown as (p: StyleStripProps) => unknown)(props));
}

function iconFixture(id: string, color?: string): FlowNode {
  return {
    id,
    type: 'icon',
    position: { x: 0, y: 0 },
    data: { icon: 'shopping-cart', ...(color ? { color } : {}) },
  } as FlowNode;
}

function rectangleFixture(id: string): FlowNode {
  return {
    id,
    type: 'rectangle',
    position: { x: 0, y: 0 },
    data: { name: 's' },
  } as FlowNode;
}

describe('StyleStrip — icon color picker (US-014)', () => {
  it('renders only the icon-color swatch when a type:"icon" node is selected', () => {
    const tree = callStrip({ nodes: [iconFixture('n1', 'blue')] });
    const iconSwatch = findElement(tree, testIdEquals('style-strip-icon-color'));
    expect(iconSwatch).not.toBeNull();
    expect((iconSwatch?.props as { activeToken?: string }).activeToken).toBe('blue');
    expect((iconSwatch?.props as { previewKind?: string }).previewKind).toBe('edge');

    // None of the shared / geometric controls should appear in the icon-only
    // strip — no fill, no border style/size, no font size, no corner radius.
    expect(findElement(tree, testIdEquals('style-strip-border-color'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-fill'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-border-style'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-border-size'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-font-size'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-corner-radius'))).toBeNull();
  });

  it('clicking a swatch token dispatches onStyleNode with { color }', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({ nodes: [iconFixture('n1')], onStyleNode });
    const iconSwatch = findElement(tree, testIdEquals('style-strip-icon-color'));
    if (!iconSwatch) throw new Error('icon-color swatch missing');
    const onSelect = (iconSwatch.props as { onSelect: (token: string) => void }).onSelect;
    onSelect('green');
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('n1', { color: 'green' });
  });

  it('fans out the picked color to every selected icon node', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({
      nodes: [iconFixture('n1', 'blue'), iconFixture('n2')],
      onStyleNode,
    });
    const iconSwatch = findElement(tree, testIdEquals('style-strip-icon-color'));
    if (!iconSwatch) throw new Error('icon-color swatch missing');
    const onSelect = (iconSwatch.props as { onSelect: (token: string) => void }).onSelect;
    onSelect('red');
    expect(onStyleNode).toHaveBeenCalledTimes(2);
    expect(onStyleNode).toHaveBeenNthCalledWith(1, 'n1', { color: 'red' });
    expect(onStyleNode).toHaveBeenNthCalledWith(2, 'n2', { color: 'red' });
  });

  it("active token falls back to 'default' when data.color is unset", () => {
    const tree = callStrip({ nodes: [iconFixture('n1')] });
    const iconSwatch = findElement(tree, testIdEquals('style-strip-icon-color'));
    expect((iconSwatch?.props as { activeToken?: string }).activeToken).toBe('default');
  });

  it('does NOT render the icon-color swatch when no node is selected', () => {
    const tree = callStrip({ nodes: [], connectors: [] });
    // Empty selection → strip returns null. Tree is null/false, so any
    // findElement returns null.
    expect(findElement(tree, testIdEquals('style-strip-icon-color'))).toBeNull();
  });

  it('does NOT render the icon-color swatch when a non-icon node is selected', () => {
    const tree = callStrip({ nodes: [rectangleFixture('s1')] });
    expect(findElement(tree, testIdEquals('style-strip-icon-color'))).toBeNull();
    // The existing geometric strip should still be present.
    expect(findElement(tree, testIdEquals('style-strip-border-color'))).not.toBeNull();
  });

  it('does NOT render the icon-color swatch in a mixed (icon + geometric) selection', () => {
    const tree = callStrip({ nodes: [iconFixture('n1', 'blue'), rectangleFixture('s1')] });
    expect(findElement(tree, testIdEquals('style-strip-icon-color'))).toBeNull();
    // Shared controls drive the non-icon nodes; border-color swatch is visible.
    expect(findElement(tree, testIdEquals('style-strip-border-color'))).not.toBeNull();
  });

  it('the patch shape uses `color` (not borderColor/backgroundColor) — type-level check', () => {
    // Compile-time guard: the icon patch must be a NodeStylePatch with a
    // `color` field. If the field is removed from the interface this test
    // fails to compile.
    const patch: NodeStylePatch = { color: 'amber' };
    expect(patch.color).toBe('amber');
  });

  it('handles multiple sibling icon nodes without leaking other controls', () => {
    const tree = callStrip({
      nodes: [iconFixture('a'), iconFixture('b'), iconFixture('c')],
    });
    const swatches = findAll(tree, testIdEquals('style-strip-icon-color'));
    expect(swatches.length).toBe(1);
  });

  it('hides the icon-color swatch when an icon node + connector are selected together', () => {
    // pureIconType requires no connectors; the shared/connector strip takes
    // over for mixed selections so the icon-only branch stays narrow.
    const cn: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
    } as Connector;
    const tree = callStrip({ nodes: [iconFixture('n1')], connectors: [cn] });
    expect(findElement(tree, testIdEquals('style-strip-icon-color'))).toBeNull();
  });
});

describe('StyleStrip — Change-icon button (US-022)', () => {
  it('renders the Change-icon button when a single icon node is selected and the callback is wired', () => {
    const tree = callStrip({
      nodes: [iconFixture('n1')],
      onRequestIconReplace: () => {},
    });
    const btn = findElement(tree, testIdEquals('style-strip-change-icon'));
    expect(btn).not.toBeNull();
  });

  it('clicking the Change-icon button calls onRequestIconReplace with the node id', () => {
    const onRequestIconReplace = mock((_id: string) => {});
    const tree = callStrip({
      nodes: [iconFixture('n-42')],
      onRequestIconReplace,
    });
    const btn = findElement(tree, testIdEquals('style-strip-change-icon'));
    if (!btn) throw new Error('change-icon button missing');
    const onClick = btn.props.onClick as () => void;
    onClick();
    expect(onRequestIconReplace).toHaveBeenCalledTimes(1);
    expect(onRequestIconReplace).toHaveBeenCalledWith('n-42');
  });

  it('hides the Change-icon button when onRequestIconReplace is undefined', () => {
    const tree = callStrip({ nodes: [iconFixture('n1')] });
    expect(findElement(tree, testIdEquals('style-strip-change-icon'))).toBeNull();
    // The color swatch is still present — only the change button hides.
    expect(findElement(tree, testIdEquals('style-strip-icon-color'))).not.toBeNull();
  });

  it('hides the Change-icon button on a multi-icon-node selection (ambiguous target)', () => {
    const tree = callStrip({
      nodes: [iconFixture('a'), iconFixture('b')],
      onRequestIconReplace: () => {},
    });
    expect(findElement(tree, testIdEquals('style-strip-change-icon'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-icon-color'))).not.toBeNull();
  });

  it('hides the Change-icon button on a non-icon selection', () => {
    const tree = callStrip({
      nodes: [rectangleFixture('s1')],
      onRequestIconReplace: () => {},
    });
    expect(findElement(tree, testIdEquals('style-strip-change-icon'))).toBeNull();
  });
});

// US-014: image border editor. Image borders use `borderWidth` (1–8)
// color picker, border style toggle, border width 1–8) but writes through
// onStyleNode for any selected image node. Multi-image fan-out follows the
// pureIconType pattern; mixed selections (image + geometric) fall through to
// the shared geometric strip.
// US-004: image nodes reference a relative `path` (resolved at render time
// against the project file endpoint) instead of an inline base64 data URL.
const SAMPLE_PATH = 'assets/pixel.png';

function imageFixture(
  id: string,
  opts: {
    borderColor?: string;
    borderWidth?: number;
    borderStyle?: 'solid' | 'dashed' | 'dotted';
    cornerRadius?: number;
  } = {},
): FlowNode {
  return {
    id,
    type: 'image',
    position: { x: 0, y: 0 },
    data: {
      path: SAMPLE_PATH,
      ...(opts.borderColor ? { borderColor: opts.borderColor } : {}),
      ...(opts.borderWidth !== undefined ? { borderWidth: opts.borderWidth } : {}),
      ...(opts.borderStyle ? { borderStyle: opts.borderStyle } : {}),
      ...(opts.cornerRadius !== undefined ? { cornerRadius: opts.cornerRadius } : {}),
    },
  } as FlowNode;
}

describe('StyleStrip — image border editor (US-014)', () => {
  it('renders the image border controls when a single type:"image" node is selected', () => {
    const tree = callStrip({
      nodes: [imageFixture('i1', { borderColor: 'blue', borderWidth: 3 })],
    });
    expect(findElement(tree, testIdEquals('style-strip-image-border-color'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-image-border-style'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-image-border-width'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-image-corner-radius'))).not.toBeNull();
    // Geometric-only controls must NOT leak into the image branch.
    expect(findElement(tree, testIdEquals('style-strip-border-color'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-border-size'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-font-size'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-fill'))).toBeNull();
    // Group-only controls must not leak either.
    expect(findElement(tree, testIdEquals('style-strip-group-border-color'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-group-border-width'))).toBeNull();
    // Icon-only controls must not leak either.
    expect(findElement(tree, testIdEquals('style-strip-icon-color'))).toBeNull();
  });

  it('seeds the active border-color token from data.borderColor', () => {
    const tree = callStrip({ nodes: [imageFixture('i1', { borderColor: 'amber' })] });
    const swatch = findElement(tree, testIdEquals('style-strip-image-border-color'));
    expect((swatch?.props as { activeToken?: string }).activeToken).toBe('amber');
  });

  it("falls back to 'default' border-color when data.borderColor is unset", () => {
    const tree = callStrip({ nodes: [imageFixture('i1')] });
    const swatch = findElement(tree, testIdEquals('style-strip-image-border-color'));
    expect((swatch?.props as { activeToken?: string }).activeToken).toBe('default');
  });

  it('clicking a border-color swatch dispatches onStyleNode with { borderColor }', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({ nodes: [imageFixture('i1')], onStyleNode });
    const swatch = findElement(tree, testIdEquals('style-strip-image-border-color'));
    if (!swatch) throw new Error('image border-color swatch missing');
    (swatch.props as { onSelect: (t: string) => void }).onSelect('green');
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('i1', { borderColor: 'green' });
  });

  it('fans out the border-color pick to every selected image node (multi-select)', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({
      nodes: [imageFixture('i1'), imageFixture('i2', { borderColor: 'red' })],
      onStyleNode,
    });
    const swatch = findElement(tree, testIdEquals('style-strip-image-border-color'));
    if (!swatch) throw new Error('image border-color swatch missing');
    (swatch.props as { onSelect: (t: string) => void }).onSelect('purple');
    expect(onStyleNode).toHaveBeenCalledTimes(2);
    expect(onStyleNode).toHaveBeenNthCalledWith(1, 'i1', { borderColor: 'purple' });
    expect(onStyleNode).toHaveBeenNthCalledWith(2, 'i2', { borderColor: 'purple' });
  });

  it('the border-style toggle dispatches onStyleNode with { borderStyle }', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({
      nodes: [imageFixture('i1', { borderStyle: 'solid' })],
      onStyleNode,
    });
    const popover = findElement(tree, testIdEquals('style-strip-image-border-style'));
    if (!popover) throw new Error('image border-style popover missing');
    const toggle = findElement(popover, (el) => {
      const p = el.props as { ariaLabel?: string };
      return p.ariaLabel === 'Border style';
    });
    if (!toggle) throw new Error('image border-style toggle missing');
    (toggle.props as { onChange: (s: 'solid' | 'dashed' | 'dotted') => void }).onChange('dashed');
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('i1', { borderStyle: 'dashed' });
  });

  it('the border-width slider commits + previews onStyleNode/onStyleNodePreview with 1–8 range', () => {
    const onStyleNode = mock(() => {});
    const onStyleNodePreview = mock(() => {});
    const tree = callStrip({
      nodes: [imageFixture('i1', { borderWidth: 2 })],
      onStyleNode,
      onStyleNodePreview,
    });
    const popover = findElement(tree, testIdEquals('style-strip-image-border-width'));
    if (!popover) throw new Error('image border-width popover missing');
    const slider = findElement(popover, (el) => {
      const p = el.props as { testId?: string };
      return p.testId === 'style-tab-image-border-width-slider';
    });
    if (!slider) throw new Error('image border-width slider missing');
    const props = slider.props as {
      onCommit: (n: number) => void;
      onPreview?: (n: number) => void;
      min: number;
      max: number;
    };
    expect(props.min).toBe(1);
    expect(props.max).toBe(8);
    props.onPreview?.(4);
    props.onCommit(6);
    expect(onStyleNodePreview).toHaveBeenCalledTimes(1);
    expect(onStyleNodePreview).toHaveBeenCalledWith('i1', { borderWidth: 4 });
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('i1', { borderWidth: 6 });
  });

  it('does NOT render the image branch in a mixed (image + geometric) selection', () => {
    const tree = callStrip({ nodes: [imageFixture('i1'), rectangleFixture('s1')] });
    expect(findElement(tree, testIdEquals('style-strip-image-border-color'))).toBeNull();
    // Mixed selection falls through to the shared geometric strip.
    expect(findElement(tree, testIdEquals('style-strip-border-color'))).not.toBeNull();
  });

  it('does NOT render the image branch when a connector is also selected', () => {
    const cn: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
    } as Connector;
    const tree = callStrip({ nodes: [imageFixture('i1')], connectors: [cn] });
    expect(findElement(tree, testIdEquals('style-strip-image-border-color'))).toBeNull();
  });
});
