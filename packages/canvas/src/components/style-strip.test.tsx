import { describe, expect, it, mock } from 'bun:test';
import * as React from 'react';
import { GROUP_DEFAULT_BORDER_COLOR } from '../nodes/group-node.tsx';
import type { Connector, FlowNode } from '../types.ts';
import {
  type NodeStylePatch,
  SliderControl,
  StyleStrip,
  type StyleStripProps,
} from './style-strip.tsx';

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

// Canvas grouping: a group's only stylable surface is its border, so a pure
// group selection collapses to the dedicated border editor (color + width).
function groupFixture(
  id: string,
  data: {
    backgroundColor?: string;
    borderColor?: string;
    borderSize?: number;
    cornerRadius?: number;
    shadow?: number;
    fontSize?: number;
  } = {},
): FlowNode {
  return {
    id,
    type: 'group',
    position: { x: 0, y: 0 },
    data: { childIds: ['a', 'b'], name: 'My Group', ...data },
  } as FlowNode;
}

function freehandFixture(
  id: string,
  opts: { color?: string; strokeWidth?: number } = {},
): FlowNode {
  return {
    id,
    type: 'freehand',
    position: { x: 0, y: 0 },
    data: {
      points: [
        [0, 0, 0.5],
        [1, 1, 0.5],
      ],
      ...(opts.color ? { color: opts.color } : {}),
      ...(opts.strokeWidth !== undefined ? { strokeWidth: opts.strokeWidth } : {}),
    },
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
    // strip — no color picker, no border style/size, no font size, no corner
    // radius or shadow.
    expect(findElement(tree, testIdEquals('style-strip-color'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-border-style'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-border-size'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-font-size'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-corner-radius'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-shadow'))).toBeNull();
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
    expect(findElement(tree, testIdEquals('style-strip-color'))).not.toBeNull();
  });

  it('does NOT render the icon-color swatch in a mixed (icon + geometric) selection', () => {
    const tree = callStrip({ nodes: [iconFixture('n1', 'blue'), rectangleFixture('s1')] });
    expect(findElement(tree, testIdEquals('style-strip-icon-color'))).toBeNull();
    // Shared controls drive the non-icon nodes; border-color swatch is visible.
    expect(findElement(tree, testIdEquals('style-strip-color'))).not.toBeNull();
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

describe('StyleStrip — freehand color picker (Task 9)', () => {
  it('renders the color swatch when a type:"freehand" node is selected', () => {
    const tree = callStrip({ nodes: [freehandFixture('f1', { color: 'blue' })] });
    const swatch = findElement(tree, testIdEquals('style-strip-icon-color'));
    expect(swatch).not.toBeNull();
    expect((swatch?.props as { activeToken?: string }).activeToken).toBe('blue');

    // Same collapsed ink strip as icon — none of the shared geometric controls.
    expect(findElement(tree, testIdEquals('style-strip-color'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-border-style'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-font-size'))).toBeNull();
  });

  it('clicking a swatch token dispatches onStyleNode with { color }', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({ nodes: [freehandFixture('f1')], onStyleNode });
    const swatch = findElement(tree, testIdEquals('style-strip-icon-color'));
    if (!swatch) throw new Error('freehand color swatch missing');
    const onSelect = (swatch.props as { onSelect: (token: string) => void }).onSelect;
    onSelect('green');
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('f1', { color: 'green' });
  });

  it("active token falls back to 'default' when data.color is unset", () => {
    const tree = callStrip({ nodes: [freehandFixture('f1')] });
    const swatch = findElement(tree, testIdEquals('style-strip-icon-color'));
    expect((swatch?.props as { activeToken?: string }).activeToken).toBe('default');
  });

  it('does NOT render the Change-icon button for a freehand selection', () => {
    const tree = callStrip({
      nodes: [freehandFixture('f1')],
      onRequestIconReplace: () => {},
    });
    // Color swatch is shared, but the change-icon affordance stays icon-only.
    expect(findElement(tree, testIdEquals('style-strip-icon-color'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-change-icon'))).toBeNull();
  });

  it('shares the collapsed ink strip across a mixed icon + freehand selection', () => {
    const tree = callStrip({ nodes: [iconFixture('n1'), freehandFixture('f1')] });
    const swatches = findAll(tree, testIdEquals('style-strip-icon-color'));
    expect(swatches.length).toBe(1);
  });
});

describe('StyleStrip — freehand stroke-width slider (Task 4)', () => {
  function findWidthSlider(tree: unknown): ReactElementLike {
    const section = findElement(tree, testIdEquals('style-strip-freehand-width'));
    if (!section) throw new Error('freehand-width section missing');
    const slider = findElement(section, (el) => {
      const p = el.props as { testId?: string };
      return p.testId === 'style-tab-freehand-width-slider';
    });
    if (!slider) throw new Error('freehand-width slider missing');
    return slider;
  }

  it('shows a stroke-width slider for a pure-freehand selection and keeps the color swatch but hides change-icon', () => {
    const tree = callStrip({
      nodes: [freehandFixture('f1', { strokeWidth: 1 })],
      onRequestIconReplace: () => {},
    });
    expect(findElement(tree, testIdEquals('style-strip-freehand-width'))).not.toBeNull();
    // The color swatch stays for the ink strip…
    expect(findElement(tree, testIdEquals('style-strip-icon-color'))).not.toBeNull();
    // …but the Change-icon button does not appear for freehand-only.
    expect(findElement(tree, testIdEquals('style-strip-change-icon'))).toBeNull();
  });

  it('does NOT show the stroke-width slider for a pure-icon selection', () => {
    const tree = callStrip({ nodes: [iconFixture('n1')] });
    expect(findElement(tree, testIdEquals('style-strip-freehand-width'))).toBeNull();
  });

  it('uses the 0.5–4 range with 0.5 step', () => {
    const tree = callStrip({ nodes: [freehandFixture('f1', { strokeWidth: 1 })] });
    const slider = findWidthSlider(tree);
    const p = slider.props as { min: number; max: number; step: number };
    expect(p.min).toBe(0.5);
    expect(p.max).toBe(4);
    expect(p.step).toBe(0.5);
  });

  it('seeds the slider from data.strokeWidth', () => {
    const tree = callStrip({ nodes: [freehandFixture('f1', { strokeWidth: 2.5 })] });
    const slider = findWidthSlider(tree);
    expect((slider.props as { value?: number }).value).toBe(2.5);
  });

  it('commits strokeWidth via onStyleNode when the slider commits', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({ nodes: [freehandFixture('f1', { strokeWidth: 1 })], onStyleNode });
    const slider = findWidthSlider(tree);
    (slider.props as { onCommit: (n: number) => void }).onCommit(2);
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('f1', { strokeWidth: 2 });
  });

  it('previews strokeWidth via onStyleNodePreview during the drag', () => {
    const onStyleNodePreview = mock(() => {});
    const tree = callStrip({
      nodes: [freehandFixture('f1', { strokeWidth: 1 })],
      onStyleNode: () => {},
      onStyleNodePreview,
    });
    const slider = findWidthSlider(tree);
    (slider.props as { onPreview?: (n: number) => void }).onPreview?.(3);
    expect(onStyleNodePreview).toHaveBeenCalledTimes(1);
    expect(onStyleNodePreview).toHaveBeenCalledWith('f1', { strokeWidth: 3 });
  });

  it('marks the slider indeterminate when two freehand nodes have differing widths', () => {
    const tree = callStrip({
      nodes: [freehandFixture('f1', { strokeWidth: 1 }), freehandFixture('f2', { strokeWidth: 3 })],
    });
    const slider = findWidthSlider(tree);
    expect((slider.props as { indeterminate?: boolean }).indeterminate).toBe(true);
  });

  it('is not indeterminate when two freehand nodes share the same width', () => {
    const tree = callStrip({
      nodes: [freehandFixture('f1', { strokeWidth: 2 }), freehandFixture('f2', { strokeWidth: 2 })],
    });
    const slider = findWidthSlider(tree);
    expect((slider.props as { indeterminate?: boolean }).indeterminate).toBe(false);
  });

  it('is not indeterminate for a single freehand selection', () => {
    const tree = callStrip({ nodes: [freehandFixture('f1', { strokeWidth: 1 })] });
    const slider = findWidthSlider(tree);
    expect((slider.props as { indeterminate?: boolean }).indeterminate).toBe(false);
  });

  it('only fans out to freehand nodes in a mixed icon + freehand selection', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({
      nodes: [iconFixture('n1'), freehandFixture('f1'), freehandFixture('f2')],
      onStyleNode,
    });
    const slider = findWidthSlider(tree);
    (slider.props as { onCommit: (n: number) => void }).onCommit(1.5);
    expect(onStyleNode).toHaveBeenCalledTimes(2);
    expect(onStyleNode).toHaveBeenNthCalledWith(1, 'f1', { strokeWidth: 1.5 });
    expect(onStyleNode).toHaveBeenNthCalledWith(2, 'f2', { strokeWidth: 1.5 });
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
    expect(findElement(tree, testIdEquals('style-strip-image-border-color-button'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-image-border-color'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-image-border-style'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-image-border-width'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-image-corner-radius'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-image-shadow'))).not.toBeNull();
    // Geometric-only controls must NOT leak into the image branch.
    expect(findElement(tree, testIdEquals('style-strip-color'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-border-size'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-font-size'))).toBeNull();
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
    (swatch.props as { onSelect: (t: string) => void }).onSelect('violet');
    expect(onStyleNode).toHaveBeenCalledTimes(2);
    expect(onStyleNode).toHaveBeenNthCalledWith(1, 'i1', { borderColor: 'violet' });
    expect(onStyleNode).toHaveBeenNthCalledWith(2, 'i2', { borderColor: 'violet' });
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

  it('the border-width slider commits + previews onStyleNode/onStyleNodePreview with 0–8 range', () => {
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
    expect(props.min).toBe(0);
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
    expect(findElement(tree, testIdEquals('style-strip-color'))).not.toBeNull();
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

// Border color, Fill, Corners, and Shadow each get a dedicated icon popover
// in the style strip so users can land on any of them with a single click.
describe('StyleStrip — corners + shadow popovers', () => {
  function rectangleWith(id: string, data: Record<string, unknown>): FlowNode {
    return {
      id,
      type: 'rectangle',
      position: { x: 0, y: 0 },
      data,
    } as FlowNode;
  }

  function findSlider(tree: unknown, testId: string): ReactElementLike {
    const section = findElement(tree, testIdEquals(testId));
    if (!section) throw new Error(`section ${testId} missing`);
    const slider = findElement(section, (el) => {
      const p = el.props as { testId?: string };
      return (
        p.testId === 'style-tab-corner-radius-slider' || p.testId === 'style-tab-shadow-slider'
      );
    });
    if (!slider) throw new Error(`slider inside ${testId} missing`);
    return slider;
  }

  it('renders dedicated Corners + Shadow popover buttons when a node is selected', () => {
    const tree = callStrip({ nodes: [rectangleFixture('s1')] });
    expect(findElement(tree, testIdEquals('style-strip-corner-radius-button'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-shadow-button'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-corner-radius'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-shadow'))).not.toBeNull();
  });

  it('Shadow slider commits onStyleNode with { shadow: N }', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({ nodes: [rectangleFixture('s1')], onStyleNode });
    const slider = findSlider(tree, 'style-strip-shadow');
    (slider.props as { onCommit: (n: number) => void }).onCommit(3);
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('s1', { shadow: 3 });
  });

  it('Shadow slider previews onStyleNodePreview during the drag', () => {
    const onStyleNodePreview = mock(() => {});
    const tree = callStrip({
      nodes: [rectangleFixture('s1')],
      onStyleNode: () => {},
      onStyleNodePreview,
    });
    const slider = findSlider(tree, 'style-strip-shadow');
    (slider.props as { onPreview?: (n: number) => void }).onPreview?.(4);
    expect(onStyleNodePreview).toHaveBeenCalledWith('s1', { shadow: 4 });
  });

  it('Corners slider commits onStyleNode with { cornerRadius: N }', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({ nodes: [rectangleFixture('s1')], onStyleNode });
    const slider = findSlider(tree, 'style-strip-corner-radius');
    (slider.props as { onCommit: (n: number) => void }).onCommit(20);
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('s1', { cornerRadius: 20 });
  });

  it('Shadow fans the picked value out across multi-node selections', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({
      nodes: [rectangleFixture('a'), rectangleFixture('b')],
      onStyleNode,
    });
    const slider = findSlider(tree, 'style-strip-shadow');
    (slider.props as { onCommit: (n: number) => void }).onCommit(2);
    expect(onStyleNode).toHaveBeenCalledTimes(2);
    expect(onStyleNode).toHaveBeenNthCalledWith(1, 'a', { shadow: 2 });
    expect(onStyleNode).toHaveBeenNthCalledWith(2, 'b', { shadow: 2 });
  });

  it('Shadow shows the indeterminate placeholder when mixed values exist', () => {
    const tree = callStrip({
      nodes: [rectangleWith('a', { shadow: 1 }), rectangleWith('b', { shadow: 4 })],
    });
    const slider = findSlider(tree, 'style-strip-shadow');
    expect((slider.props as { indeterminate?: boolean }).indeterminate).toBe(true);
  });

  it('Shadow slider uses the 0–5 range', () => {
    const tree = callStrip({ nodes: [rectangleFixture('s1')] });
    const slider = findSlider(tree, 'style-strip-shadow');
    const p = slider.props as { min: number; max: number };
    expect(p.min).toBe(0);
    expect(p.max).toBe(5);
  });

  it('does NOT render the corners/shadow buttons for a pure-connector selection', () => {
    const cn: Connector = { id: 'c1', source: 'a', target: 'b' } as Connector;
    const tree = callStrip({ nodes: [], connectors: [cn] });
    // Border-color button still renders (for connector color) but corners +
    // shadow are gated on hasNodes.
    expect(findElement(tree, testIdEquals('style-strip-color-button'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-corner-radius-button'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-shadow-button'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-corner-radius'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-shadow'))).toBeNull();
  });

  it('Image Shadow popover commits shadow via onStyleNode with { shadow: N }', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({ nodes: [imageFixture('i1')], onStyleNode });
    const section = findElement(tree, testIdEquals('style-strip-image-shadow'));
    if (!section) throw new Error('image-shadow section missing');
    const slider = findElement(section, (el) => {
      const p = el.props as { testId?: string };
      return p.testId === 'style-tab-image-shadow-slider';
    });
    if (!slider) throw new Error('image-shadow slider missing');
    (slider.props as { onCommit: (n: number) => void }).onCommit(2);
    expect(onStyleNode).toHaveBeenCalledWith('i1', { shadow: 2 });
  });
});

// The unified Color popover replaces the separate Border-color / Fill /
// Text-color affordances. A single pick writes BOTH `borderColor` and
// `backgroundColor` atomically per undo entry — multi-node selections
// route through the batched `onStyleNodes` API so the apply commits as
// one undo-stack entry, single-node selections still use `onStyleNode`.
describe('StyleStrip — unified Color picker', () => {
  function findColorGrid(tree: unknown): ReactElementLike {
    const grid = findElement(tree, testIdEquals('style-strip-color'));
    if (!grid) throw new Error('style-strip-color grid missing');
    return grid;
  }

  it('reads the active token from data.backgroundColor (the dominant visual)', () => {
    const rect: FlowNode = {
      id: 'r1',
      type: 'rectangle',
      position: { x: 0, y: 0 },
      data: { name: 's', backgroundColor: 'amber', borderColor: 'blue' },
    } as FlowNode;
    const tree = callStrip({ nodes: [rect] });
    const grid = findColorGrid(tree);
    expect((grid.props as { activeToken?: string }).activeToken).toBe('amber');
  });

  it('falls back to data.borderColor on text shapes (chromeless — borderColor IS the label color)', () => {
    const textNode: FlowNode = {
      id: 't1',
      type: 'text',
      position: { x: 0, y: 0 },
      data: { borderColor: 'green' },
    } as FlowNode;
    const tree = callStrip({ nodes: [textNode] });
    const grid = findColorGrid(tree);
    expect((grid.props as { activeToken?: string }).activeToken).toBe('green');
  });

  it('writes both borderColor and backgroundColor in a single per-node call for single selection', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({ nodes: [rectangleFixture('r1')], onStyleNode });
    const grid = findColorGrid(tree);
    (grid.props as { onSelect: (t: string) => void }).onSelect('teal');
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('r1', {
      borderColor: 'teal',
      backgroundColor: 'teal',
    });
  });

  it('writes both fields in ONE onStyleNodes batch for multi-node selection (single undo entry)', () => {
    const onStyleNodes = mock(() => {});
    const onStyleNode = mock(() => {});
    const tree = callStrip({
      nodes: [rectangleFixture('a'), rectangleFixture('b')],
      onStyleNode,
      onStyleNodes,
    });
    const grid = findColorGrid(tree);
    (grid.props as { onSelect: (t: string) => void }).onSelect('blue');
    expect(onStyleNodes).toHaveBeenCalledTimes(1);
    expect(onStyleNodes).toHaveBeenCalledWith(['a', 'b'], {
      borderColor: 'blue',
      backgroundColor: 'blue',
    });
    expect(onStyleNode).not.toHaveBeenCalled();
  });

  it('also fans the picked color out to connector color on mixed selections', () => {
    const onStyleNode = mock(() => {});
    const onStyleConnector = mock(() => {});
    const cn: Connector = { id: 'c1', source: 'a', target: 'b' } as Connector;
    const tree = callStrip({
      nodes: [rectangleFixture('r1')],
      connectors: [cn],
      onStyleNode,
      onStyleConnector,
    });
    const grid = findColorGrid(tree);
    (grid.props as { onSelect: (t: string) => void }).onSelect('pink');
    expect(onStyleNode).toHaveBeenCalledWith('r1', {
      borderColor: 'pink',
      backgroundColor: 'pink',
    });
    expect(onStyleConnector).toHaveBeenCalledWith('c1', { color: 'pink' });
  });

  it('uses connector.color as the active token for a pure-connector selection', () => {
    const cn: Connector = { id: 'c1', source: 'a', target: 'b', color: 'red' } as Connector;
    const tree = callStrip({ nodes: [], connectors: [cn] });
    const grid = findColorGrid(tree);
    expect((grid.props as { activeToken?: string }).activeToken).toBe('red');
  });
});

// Align is the third section of the Text popover (next to Size).
// Lets the user pick left / center / right for a node's text; persists via
// the textAlign field on NodeStylePatch. Toggle defaults to 'center' when
// the selected node has no explicit textAlign set yet.
describe('StyleStrip — text alignment toggle', () => {
  function textFixture(id: string, data: Record<string, unknown> = {}): FlowNode {
    return {
      id,
      type: 'text',
      position: { x: 0, y: 0 },
      data,
    } as FlowNode;
  }

  function findAlignToggle(tree: unknown): ReactElementLike {
    const section = findElement(tree, testIdEquals('style-strip-text-align'));
    if (!section) throw new Error('text-align section missing');
    const toggle = findElement(section, (el) => {
      const p = el.props as { ariaLabel?: string };
      return p.ariaLabel === 'Text alignment';
    });
    if (!toggle) throw new Error('text-align toggle missing');
    return toggle;
  }

  it('renders the Align section in the Text popover for a node selection', () => {
    const tree = callStrip({ nodes: [textFixture('t1')] });
    expect(findElement(tree, testIdEquals('style-strip-text-align'))).not.toBeNull();
  });

  it("defaults to 'center' when data.textAlign is unset", () => {
    const tree = callStrip({ nodes: [textFixture('t1')] });
    const toggle = findAlignToggle(tree);
    expect((toggle.props as { value?: string }).value).toBe('center');
  });

  it('reflects an explicit data.textAlign as the active value', () => {
    const tree = callStrip({ nodes: [textFixture('t1', { textAlign: 'right' })] });
    const toggle = findAlignToggle(tree);
    expect((toggle.props as { value?: string }).value).toBe('right');
  });

  it("picking 'left' dispatches onStyleNode with { textAlign: 'left' }", () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({ nodes: [textFixture('t1')], onStyleNode });
    const toggle = findAlignToggle(tree);
    (toggle.props as { onChange: (v: 'left' | 'center' | 'right') => void }).onChange('left');
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('t1', { textAlign: 'left' });
  });

  it('fans the pick out via onStyleNodes when a multi-node selection has the batch API', () => {
    const onStyleNodes = mock(() => {});
    const onStyleNode = mock(() => {});
    const tree = callStrip({
      nodes: [textFixture('t1'), textFixture('t2', { textAlign: 'left' })],
      onStyleNode,
      onStyleNodes,
    });
    const toggle = findAlignToggle(tree);
    (toggle.props as { onChange: (v: 'left' | 'center' | 'right') => void }).onChange('center');
    expect(onStyleNodes).toHaveBeenCalledTimes(1);
    expect(onStyleNodes).toHaveBeenCalledWith(['t1', 't2'], { textAlign: 'center' });
    expect(onStyleNode).not.toHaveBeenCalled();
  });

  it('does NOT render the Align section for a pure-connector selection (no node to align)', () => {
    const cn: Connector = { id: 'c1', source: 'a', target: 'b' } as Connector;
    const tree = callStrip({ nodes: [], connectors: [cn] });
    expect(findElement(tree, testIdEquals('style-strip-text-align'))).toBeNull();
  });
});

// The connector controls live in a single "Connector" popover
// (style-strip-border): Style, Width, Path, Direction, and Head shape are all
// sections inside it — no standalone Path / Direction / Head-shape buttons.
describe('StyleStrip — connector path merge + head shape', () => {
  const conn = (over: Partial<Connector> = {}): Connector =>
    ({ id: 'c1', source: 'a', target: 'b', ...over }) as Connector;

  function findPathToggle(tree: unknown): ReactElementLike {
    const section = findElement(tree, testIdEquals('style-strip-path'));
    if (!section) throw new Error('path section missing');
    const toggle = findElement(section, (el) => {
      const p = el.props as { ariaLabel?: string };
      return p.ariaLabel === 'Connector path';
    });
    if (!toggle) throw new Error('path toggle missing');
    return toggle;
  }

  function findHeadToggle(tree: unknown): ReactElementLike {
    const section = findElement(tree, testIdEquals('style-strip-head-shape'));
    if (!section) throw new Error('head-shape section missing');
    const toggle = findElement(section, (el) => {
      const p = el.props as { ariaLabel?: string };
      return p.ariaLabel === 'Connector head shape';
    });
    if (!toggle) throw new Error('head-shape toggle missing');
    return toggle;
  }

  function findTailToggle(tree: unknown): ReactElementLike {
    const section = findElement(tree, testIdEquals('style-strip-tail-shape'));
    if (!section) throw new Error('tail-shape section missing');
    const toggle = findElement(section, (el) => {
      const p = el.props as { ariaLabel?: string };
      return p.ariaLabel === 'Connector tail shape';
    });
    if (!toggle) throw new Error('tail-shape toggle missing');
    return toggle;
  }

  it('no longer renders a standalone Connector-path popover button', () => {
    const tree = callStrip({ nodes: [], connectors: [conn()] });
    // The Path section moved INSIDE the Connector popover; there is no
    // top-level path button anymore. The Connector popover (style-strip-border)
    // is the sole owner.
    expect(findElement(tree, testIdEquals('style-strip-border'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-path'))).not.toBeNull();
  });

  it('renders the Path section inside the Connector popover and reflects the active value', () => {
    const tree = callStrip({ nodes: [], connectors: [conn({ path: 'step' })] });
    const border = findElement(tree, testIdEquals('style-strip-border'));
    if (!border) throw new Error('connector popover missing');
    // The path section is a descendant of the Connector popover, not a sibling.
    expect(findElement(border, testIdEquals('style-strip-path'))).not.toBeNull();
    expect((findPathToggle(tree).props as { value?: string }).value).toBe('step');
  });

  it('renders Direction and Head shape as sections inside the Connector popover', () => {
    const tree = callStrip({ nodes: [], connectors: [conn()] });
    const border = findElement(tree, testIdEquals('style-strip-border'));
    if (!border) throw new Error('connector popover missing');
    // Both fold into the single Connector popover — no standalone buttons.
    expect(findElement(border, testIdEquals('style-strip-direction-section'))).not.toBeNull();
    expect(findElement(border, testIdEquals('style-strip-head-shape'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-direction'))).toBeNull();
  });

  it('does NOT render the Path section for a node selection', () => {
    const tree = callStrip({ nodes: [rectangleFixture('r1')] });
    expect(findElement(tree, testIdEquals('style-strip-path'))).toBeNull();
  });

  it('picking a path fans out to every selected connector via onStyleConnector', () => {
    const onStyleConnector = mock(() => {});
    const tree = callStrip({
      nodes: [],
      connectors: [conn({ id: 'c1' }), conn({ id: 'c2' })],
      onStyleConnector,
    });
    (findPathToggle(tree).props as { onChange: (p: 'curve' | 'step') => void }).onChange('step');
    expect(onStyleConnector).toHaveBeenCalledWith('c1', { path: 'step' });
    expect(onStyleConnector).toHaveBeenCalledWith('c2', { path: 'step' });
  });

  it("defaults the head-shape toggle to 'arrow' when unset", () => {
    const tree = callStrip({ nodes: [], connectors: [conn()] });
    expect((findHeadToggle(tree).props as { value?: string }).value).toBe('arrow');
  });

  it('reflects an explicit headShape as the active value', () => {
    const tree = callStrip({ nodes: [], connectors: [conn({ headShape: 'many' })] });
    expect((findHeadToggle(tree).props as { value?: string }).value).toBe('many');
  });

  it('picking a head shape fans out to every selected connector', () => {
    const onStyleConnector = mock(() => {});
    const tree = callStrip({
      nodes: [],
      connectors: [conn({ id: 'c1' }), conn({ id: 'c2' })],
      onStyleConnector,
    });
    (
      findHeadToggle(tree).props as {
        onChange: (s: 'arrow' | 'one' | 'many' | 'optional-many' | 'diamond' | 'circle') => void;
      }
    ).onChange('many');
    expect(onStyleConnector).toHaveBeenCalledWith('c1', { headShape: 'many' });
    expect(onStyleConnector).toHaveBeenCalledWith('c2', { headShape: 'many' });
  });

  it('disables the head-shape section when direction is none', () => {
    const tree = callStrip({ nodes: [], connectors: [conn({ direction: 'none' })] });
    const section = findElement(tree, testIdEquals('style-strip-head-shape'));
    if (!section) throw new Error('head-shape section missing');
    const disabledWrap = findElement(
      section,
      (el) => (el.props as { 'aria-disabled'?: boolean })['aria-disabled'] === true,
    );
    expect(disabledWrap).not.toBeNull();
  });

  it("defaults the tail-shape toggle to the head shape ('arrow' when unset)", () => {
    const tree = callStrip({ nodes: [], connectors: [conn({ headShape: 'diamond' })] });
    // Tail mirrors the head when it has no explicit shape of its own.
    expect((findTailToggle(tree).props as { value?: string }).value).toBe('diamond');
  });

  it('reflects an explicit tailShape as the active value', () => {
    const tree = callStrip({ nodes: [], connectors: [conn({ tailShape: 'one' })] });
    expect((findTailToggle(tree).props as { value?: string }).value).toBe('one');
  });

  it('picking a tail shape fans out to every selected connector', () => {
    const onStyleConnector = mock(() => {});
    const tree = callStrip({
      nodes: [],
      connectors: [conn({ id: 'c1' }), conn({ id: 'c2' })],
      onStyleConnector,
    });
    (
      findTailToggle(tree).props as {
        onChange: (s: 'arrow' | 'one' | 'many' | 'optional-many' | 'diamond' | 'circle') => void;
      }
    ).onChange('one');
    expect(onStyleConnector).toHaveBeenCalledWith('c1', { tailShape: 'one' });
    expect(onStyleConnector).toHaveBeenCalledWith('c2', { tailShape: 'one' });
  });

  it('enables the tail-shape section for backward/both and disables it otherwise', () => {
    const disabledFor = (direction: 'forward' | 'backward' | 'both' | 'none') => {
      const tree = callStrip({ nodes: [], connectors: [conn({ direction })] });
      const section = findElement(tree, testIdEquals('style-strip-tail-shape'));
      if (!section) throw new Error('tail-shape section missing');
      return (
        findElement(
          section,
          (el) => (el.props as { 'aria-disabled'?: boolean })['aria-disabled'] === true,
        ) !== null
      );
    };
    // Tail only carries a glyph when the direction points back at the source.
    expect(disabledFor('backward')).toBe(false);
    expect(disabledFor('both')).toBe(false);
    expect(disabledFor('forward')).toBe(true);
    expect(disabledFor('none')).toBe(true);
  });
});

// Task 2: one font-size control drives BOTH node text and connector labels, so
// a mixed (node + connector) selection updates everything at once.
describe('StyleStrip — unified font size (nodes + connectors)', () => {
  const conn = (over: Partial<Connector> = {}): Connector =>
    ({ id: 'c1', source: 'a', target: 'b', ...over }) as Connector;

  function findFontSizeSlider(tree: unknown): ReactElementLike {
    const slider = findElement(tree, testIdEquals('style-tab-font-size-slider'));
    if (!slider) throw new Error('font-size slider missing');
    return slider;
  }

  it('font size commit on a mixed selection updates nodes and connectors', () => {
    const onStyleNode = mock(() => {});
    const onStyleConnector = mock(() => {});
    const tree = callStrip({
      nodes: [rectangleFixture('n1')],
      connectors: [conn({ id: 'c1' })],
      onStyleNode,
      onStyleConnector,
    });
    const slider = findFontSizeSlider(tree);
    (slider.props as { onCommit: (n: number) => void }).onCommit(40);
    expect(onStyleNode).toHaveBeenCalledWith('n1', { fontSize: 40 });
    expect(onStyleConnector).toHaveBeenCalledWith('c1', { fontSize: 40 });
  });

  it('font size preview on a mixed selection previews nodes and connectors', () => {
    const onStyleNodePreview = mock(() => {});
    const onStyleConnectorPreview = mock(() => {});
    const tree = callStrip({
      nodes: [rectangleFixture('n1')],
      connectors: [conn({ id: 'c1' })],
      onStyleNode: () => {},
      onStyleConnector: () => {},
      onStyleNodePreview,
      onStyleConnectorPreview,
    });
    const slider = findFontSizeSlider(tree);
    (slider.props as { onPreview?: (n: number) => void }).onPreview?.(40);
    expect(onStyleNodePreview).toHaveBeenCalledWith('n1', { fontSize: 40 });
    expect(onStyleConnectorPreview).toHaveBeenCalledWith('c1', { fontSize: 40 });
  });

  it('the font-size slider spans 8–64 and is editable up to 200', () => {
    const tree = callStrip({ nodes: [rectangleFixture('n1')], connectors: [conn()] });
    const slider = findFontSizeSlider(tree);
    const p = slider.props as { min: number; max: number; editable?: boolean; inputMax?: number };
    expect(p.min).toBe(8);
    expect(p.max).toBe(64);
    expect(p.editable).toBe(true);
    expect(p.inputMax).toBe(200);
  });

  it('a node+connector mix with differing default sizes reads indeterminate', () => {
    // node default 22, connector default 11 → genuine mix.
    const tree = callStrip({ nodes: [rectangleFixture('n1')], connectors: [conn()] });
    const slider = findFontSizeSlider(tree);
    expect((slider.props as { indeterminate?: boolean }).indeterminate).toBe(true);
  });
});

// Canvas grouping: a SELECTED group is a chrome-less container whose only
// stylable surface is its BORDER. A pure group selection collapses the strip to
// a focused border editor (color + width) — NOT the full Color/Corners/Shadow/
// Border/Text branch, and NOT the ink/image collapses.
describe('StyleStrip — group border editor', () => {
  it('collapses to the group border editor (color + width only)', () => {
    const tree = callStrip({ nodes: [groupFixture('grp-1')] });
    expect(findElement(tree, testIdEquals('style-strip-group-border-color'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-group-border-width'))).not.toBeNull();
    // NOT the full default branch (no fill / corners / shadow / text on a group).
    expect(findElement(tree, testIdEquals('style-strip-color'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-corner-radius'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-shadow'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-text'))).toBeNull();
    // NOT collapsed into the ink / image branches either.
    expect(findElement(tree, testIdEquals('style-strip-icon-color'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-image-border-color-button'))).toBeNull();
  });

  it('offers a "no color" option in the border-color swatch (allowNone)', () => {
    const tree = callStrip({ nodes: [groupFixture('grp-1')] });
    const sw = findElement(tree, testIdEquals('style-strip-group-border-color'));
    expect((sw?.props as { allowNone?: boolean }).allowNone).toBe(true);
  });

  it("border-color 'none' pick applies { borderColor: 'none' } to the group", () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({ nodes: [groupFixture('grp-1')], onStyleNode });
    const sw = findElement(tree, testIdEquals('style-strip-group-border-color'));
    if (!sw) throw new Error('group border-color swatch missing');
    (sw.props as { onSelect: (t: string) => void }).onSelect('none');
    expect(onStyleNode).toHaveBeenCalledWith('grp-1', { borderColor: 'none' });
  });

  it('seeds the border-color trigger from data.borderColor', () => {
    const tree = callStrip({ nodes: [groupFixture('grp-1', { borderColor: 'teal' })] });
    const sw = findElement(tree, testIdEquals('style-strip-group-border-color'));
    expect((sw?.props as { activeToken?: string }).activeToken).toBe('teal');
  });

  it('defaults the border-color trigger to gray when unset', () => {
    const tree = callStrip({ nodes: [groupFixture('grp-1')] });
    const sw = findElement(tree, testIdEquals('style-strip-group-border-color'));
    expect((sw?.props as { activeToken?: string }).activeToken).toBe(GROUP_DEFAULT_BORDER_COLOR);
  });

  it('border-color pick applies { borderColor } to the group via onStyleNode', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({ nodes: [groupFixture('grp-1')], onStyleNode });
    const sw = findElement(tree, testIdEquals('style-strip-group-border-color'));
    if (!sw) throw new Error('group border-color swatch missing');
    (sw.props as { onSelect: (t: string) => void }).onSelect('red');
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('grp-1', { borderColor: 'red' });
  });

  it('border-width slider commits { borderSize } to the group via onStyleNode', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({ nodes: [groupFixture('grp-1')], onStyleNode });
    const section = findElement(tree, testIdEquals('style-strip-group-border-width'));
    if (!section) throw new Error('group border-width control missing');
    const slider = findElement(section, (el) => {
      const p = el.props as { testId?: string };
      return p.testId === 'style-tab-group-border-width-slider';
    });
    if (!slider) throw new Error('group border-width slider missing');
    (slider.props as { onCommit: (n: number) => void }).onCommit(4);
    expect(onStyleNode).toHaveBeenCalledWith('grp-1', { borderSize: 4 });
  });

  it('a group + a loose rectangle falls to the shared branch (NOT the group editor)', () => {
    // A mixed selection is not a pure group, so the strip shows the default
    // branch for the loose node(s); the group-only border editor does not appear.
    // (In the live canvas the host filters the group out of mixed selections.)
    const tree = callStrip({ nodes: [groupFixture('grp-1'), rectangleFixture('s1')] });
    expect(findElement(tree, testIdEquals('style-strip-group-border-color'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-strip-color'))).not.toBeNull();
  });
});

// Task 3: SliderControl's editable number input. The input accepts values above
// the slider max (up to inputMax) and clamps to [min, inputMax].
describe('SliderControl — editable number input', () => {
  function renderSlider(props: {
    value: number | undefined;
    min: number;
    max: number;
    editable?: boolean;
    inputMax?: number;
    onPreview?: (n: number) => void;
    onCommit: (n: number) => void;
  }): unknown {
    return renderWithHooks(() =>
      (SliderControl as unknown as (p: Record<string, unknown>) => unknown)({
        defaultValue: props.value ?? props.min,
        suffix: 'px',
        testId: 'style-tab-font-size-slider',
        ...props,
      }),
    );
  }

  function findInput(tree: unknown): ReactElementLike {
    const input = findElement(tree, testIdEquals('style-tab-font-size-slider-input'));
    if (!input) throw new Error('font-size input missing');
    return input;
  }

  it('renders an editable number input when editable is set', () => {
    const tree = renderSlider({
      value: 22,
      min: 8,
      max: 64,
      editable: true,
      inputMax: 200,
      onCommit: () => {},
    });
    const input = findInput(tree);
    expect((input.props as { type?: string }).type).toBe('number');
  });

  it('does NOT render the input when editable is unset (keeps the span readout)', () => {
    const tree = renderSlider({ value: 22, min: 8, max: 64, onCommit: () => {} });
    expect(findElement(tree, testIdEquals('style-tab-font-size-slider-input'))).toBeNull();
    expect(findElement(tree, testIdEquals('style-tab-font-size-slider-value'))).not.toBeNull();
  });

  it('input commits a value above the slider max (clamped to inputMax)', () => {
    const onCommit = mock(() => {});
    const tree = renderSlider({
      value: 22,
      min: 8,
      max: 64,
      editable: true,
      inputMax: 200,
      onCommit,
    });
    const input = findInput(tree);
    const props = input.props as {
      onChange: (e: { target: { value: string } }) => void;
      onBlur: () => void;
    };
    props.onChange({ target: { value: '120' } });
    props.onBlur();
    expect(onCommit).toHaveBeenCalledWith(120);
  });

  it('input clamps above inputMax', () => {
    const onCommit = mock(() => {});
    const tree = renderSlider({
      value: 22,
      min: 8,
      max: 64,
      editable: true,
      inputMax: 200,
      onCommit,
    });
    const input = findInput(tree);
    const props = input.props as {
      onChange: (e: { target: { value: string } }) => void;
      onBlur: () => void;
    };
    props.onChange({ target: { value: '999' } });
    props.onBlur();
    expect(onCommit).toHaveBeenCalledWith(200);
  });

  it('input clamps below min', () => {
    const onCommit = mock(() => {});
    const tree = renderSlider({
      value: 22,
      min: 8,
      max: 64,
      editable: true,
      inputMax: 200,
      onCommit,
    });
    const input = findInput(tree);
    const props = input.props as {
      onChange: (e: { target: { value: string } }) => void;
      onBlur: () => void;
    };
    props.onChange({ target: { value: '3' } });
    props.onBlur();
    expect(onCommit).toHaveBeenCalledWith(8);
  });

  it('slider thumb pins at max even when the typed value exceeds it', () => {
    const tree = renderSlider({
      value: 22,
      min: 8,
      max: 64,
      editable: true,
      inputMax: 200,
      onCommit: () => {},
    });
    const input = findInput(tree);
    (input.props as { onChange: (e: { target: { value: string } }) => void }).onChange({
      target: { value: '120' },
    });
    const slider = findElement(tree, testIdEquals('style-tab-font-size-slider'));
    if (!slider) throw new Error('slider missing');
    // value array is clamped to max so the thumb never overshoots 64.
    expect((slider.props as { value: number[] }).value[0]).toBeLessThanOrEqual(64);
  });

  it('input previews on type', () => {
    const onPreview = mock(() => {});
    const tree = renderSlider({
      value: 22,
      min: 8,
      max: 64,
      editable: true,
      inputMax: 200,
      onPreview,
      onCommit: () => {},
    });
    const input = findInput(tree);
    (input.props as { onChange: (e: { target: { value: string } }) => void }).onChange({
      target: { value: '40' },
    });
    expect(onPreview).toHaveBeenCalledWith(40);
  });

  it('Enter commits the clamped value', () => {
    const onCommit = mock(() => {});
    const tree = renderSlider({
      value: 22,
      min: 8,
      max: 64,
      editable: true,
      inputMax: 200,
      onCommit,
    });
    const input = findInput(tree);
    const props = input.props as {
      onChange: (e: { target: { value: string } }) => void;
      onKeyDown: (e: { key: string; target: { blur(): void } }) => void;
    };
    props.onChange({ target: { value: '999' } });
    props.onKeyDown({ key: 'Enter', target: { blur() {} } });
    expect(onCommit).toHaveBeenCalledWith(200);
  });

  it('clearing the input mid-edit neither commits nor previews', () => {
    const onCommit = mock(() => {});
    const onPreview = mock(() => {});
    const tree = renderSlider({
      value: 22,
      min: 8,
      max: 64,
      editable: true,
      inputMax: 200,
      onPreview,
      onCommit,
    });
    const input = findInput(tree);
    (input.props as { onChange: (e: { target: { value: string } }) => void }).onChange({
      target: { value: '' },
    });
    // Empty is an in-progress edit: no clamp-to-min, no preview, no commit.
    expect(onPreview).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('StyleStrip — font-family picker (fonts)', () => {
  // The picker is a dropdown: selecting a font fires the radio group's
  // onValueChange (not a per-button onClick). Find the group by its handler
  // inside the font-family section, then drive it like a real selection.
  function findFontRadioGroup(tree: unknown): ReactElementLike {
    const section = findElement(tree as ReactElementLike, testIdEquals('style-strip-font-family'));
    const group = findElement(
      section ?? (tree as ReactElementLike),
      (el) => typeof (el.props as { onValueChange?: unknown }).onValueChange === 'function',
    );
    if (!group) throw new Error('font-family radio group missing');
    return group;
  }

  it('selecting a font option dispatches onStyleNode with { fontFamily }', () => {
    const onStyleNode = mock(() => {});
    const tree = callStrip({ nodes: [rectangleFixture('n1')], onStyleNode });
    // The option still carries a stable test id (rendered in its own font).
    expect(findElement(tree, testIdEquals('style-tab-font-family-serif'))).not.toBeNull();
    const group = findFontRadioGroup(tree);
    (group.props as { onValueChange: (v: string) => void }).onValueChange('serif');
    expect(onStyleNode).toHaveBeenCalledTimes(1);
    expect(onStyleNode).toHaveBeenCalledWith('n1', { fontFamily: 'serif' });
  });

  it('multi-node selection commits a single batched onStyleNodes call', () => {
    const onStyleNodes = mock(() => {});
    const onStyleNode = mock(() => {});
    const tree = callStrip({
      nodes: [rectangleFixture('n1'), rectangleFixture('n2')],
      onStyleNode,
      onStyleNodes,
    });
    const group = findFontRadioGroup(tree);
    (group.props as { onValueChange: (v: string) => void }).onValueChange('mono');
    expect(onStyleNodes).toHaveBeenCalledTimes(1);
    expect(onStyleNodes).toHaveBeenCalledWith(['n1', 'n2'], { fontFamily: 'mono' });
  });

  it('connector-label selection dispatches onStyleConnector with { fontFamily }', () => {
    const onStyleConnector = mock(() => {});
    const cn: Connector = { id: 'c1', source: 'a', target: 'b' } as Connector;
    const tree = callStrip({ nodes: [], connectors: [cn], onStyleConnector });
    const group = findFontRadioGroup(tree);
    (group.props as { onValueChange: (v: string) => void }).onValueChange('handwritten');
    expect(onStyleConnector).toHaveBeenCalledTimes(1);
    expect(onStyleConnector).toHaveBeenCalledWith('c1', { fontFamily: 'handwritten' });
  });

  it('binds the radio group value to the active token', () => {
    const tree = callStrip({
      nodes: [{ ...rectangleFixture('n1'), data: { name: 's', fontFamily: 'mono' } } as FlowNode],
    });
    const group = findFontRadioGroup(tree);
    expect((group.props as { value?: string }).value).toBe('mono');
  });

  it('shows the trigger label in the active font, "Mixed" when the selection is mixed', () => {
    const mixed = callStrip({
      nodes: [
        { ...rectangleFixture('n1'), data: { name: 'a', fontFamily: 'mono' } } as FlowNode,
        { ...rectangleFixture('n2'), data: { name: 'b', fontFamily: 'serif' } } as FlowNode,
      ],
    });
    const trigger = findElement(mixed, testIdEquals('style-tab-font-family-trigger'));
    expect(trigger).not.toBeNull();
    const group = findFontRadioGroup(mixed);
    // Mixed selection => no bound value (nothing checked in the menu).
    expect((group.props as { value?: string }).value).toBe('');
  });
});
