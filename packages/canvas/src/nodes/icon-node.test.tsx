import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import * as React from 'react';
import { InlineEdit } from '../components/inline-edit.tsx';
import { ICON_REGISTRY } from '../lib/icon-registry.ts';
import { ICON_FALLBACK_NAME, IconNode } from './icon-node.tsx';
import { LockBadge } from './lock-badge.tsx';
import { ResizeControls } from './resize-controls.tsx';

// Bun runs apps/web tests without a DOM, and React Flow's `<Handle>` reads
// from a zustand provider that only exists inside a real ReactFlow mount —
// so `renderToStaticMarkup(<IconNode />)` blows up before reaching the
// glyph. Instead we shim React's internal dispatcher and call IconNode as
// a function: every hook IconNode uses (useState today) returns a synchronous
// initial value, the returned React element tree is the first render, and
// we walk it to find the elements under test. Handle/ResizeControls etc. are
// captured as `{ type, props }` placeholders without executing their render
// bodies, so their zustand dependencies never trip.
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: () => void;
};

/**
 * `useStateOverrides`, when provided, replaces the Nth useState call's initial
 * value with the corresponding entry from the array (undefined = passthrough).
 * The setter remains a no-op — tests that need to observe a post-setter render
 * call the renderer again with the desired override instead.
 */
function renderWithHooks<T>(fn: () => T, useStateOverrides?: ReadonlyArray<unknown>): T {
  const internals = (
    React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: Hooks | null };
      };
    }
  ).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const prev = internals.ReactCurrentDispatcher.current;
  let useStateIndex = 0;
  internals.ReactCurrentDispatcher.current = {
    useState: <S,>(initial: S | (() => S)) => {
      const idx = useStateIndex++;
      const override = useStateOverrides?.[idx];
      if (override !== undefined) return [override as S, () => {}];
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
  predicate: (type: unknown) => boolean,
): ReactElementLike | null {
  if (!isElement(tree)) return null;
  if (predicate(tree.type)) return tree;
  const children = tree.props.children;
  if (children === undefined || children === null) return null;
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
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

function callIconNode(
  data: Record<string, unknown>,
  overrides: Partial<NodeProps> = {},
  useStateOverrides?: ReadonlyArray<unknown>,
): unknown {
  const props = {
    id: 'n1',
    type: 'iconNode',
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
  // US-010: IconNode is now `memo(IconNodeImpl, …)`, which produces a memo
  // descriptor object rather than a callable function. The inner impl is at
  // `.type` per React's memo internal shape — call it directly so the hook
  // shim still drives the rendered tree.
  const impl = (IconNode as unknown as { type: (p: NodeProps) => unknown }).type;
  return renderWithHooks(() => impl(props), useStateOverrides);
}

describe('IconNode', () => {
  beforeEach(() => {
    mock.restore();
  });

  it('renders the correct Lucide component for a known name', () => {
    const tree = callIconNode({ icon: 'shopping-cart' });
    const lucide = findElement(tree, (type) => type === ICON_REGISTRY['shopping-cart']);
    expect(lucide).not.toBeNull();
  });

  it('renders no caption element when data.name is absent or empty (US-002)', () => {
    const hasLabel = (tree: unknown) =>
      findAll(
        tree,
        (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'icon-node-label',
      );
    expect(hasLabel(callIconNode({ icon: 'shopping-cart' }))).toHaveLength(0);
    expect(hasLabel(callIconNode({ icon: 'shopping-cart', name: '' }))).toHaveLength(0);
  });

  it('renders the caption text below the icon when data.name is set (US-002)', () => {
    const tree = callIconNode({ icon: 'shopping-cart', name: 'Cart' });
    const labels = findAll(
      tree,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'icon-node-label',
    );
    expect(labels).toHaveLength(1);
    const caption = labels[0];
    if (!caption) throw new Error('caption not found');
    expect(caption.props.children).toBe('Cart');
    // Centered, truncating, absolutely positioned below the icon — the
    // classes encode the bounding-box-preserving layout, so pin them here
    // to catch a future refactor that drops absolute positioning and
    // accidentally enlarges the React Flow node measurement.
    const className = String(caption.props.className ?? '');
    expect(className).toContain('absolute');
    expect(className).toContain('top-full');
    expect(className).toContain('truncate');
    expect(className).toContain('text-center');
    expect(className).toContain('text-xs');
  });

  it('falls back to help-circle on an unknown name and warns once', () => {
    const warnSpy = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warnSpy as unknown as typeof console.warn;
    try {
      const tree = callIconNode({ icon: 'definitely-not-a-real-icon' });
      // The fallback component is identity-equal to ICON_REGISTRY['help-circle'].
      const fallback = ICON_REGISTRY[ICON_FALLBACK_NAME];
      expect(fallback).toBeDefined();
      const lucide = findElement(tree, (type) => type === fallback);
      expect(lucide).not.toBeNull();
      // The original (unknown) icon name must NOT be in the registry.
      expect(ICON_REGISTRY['definitely-not-a-real-icon']).toBeUndefined();
      // Warn-once: a second render with the same unknown name must not warn again.
      callIconNode({ icon: 'definitely-not-a-real-icon' });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('data.color overrides default (currentColor)', () => {
    const lucideType = ICON_REGISTRY['shopping-cart'];

    const defaultTree = callIconNode({ icon: 'shopping-cart' });
    const defaultLucide = findElement(defaultTree, (type) => type === lucideType);
    expect(defaultLucide?.props.color).toBe('currentColor');

    const coloredTree = callIconNode({ icon: 'shopping-cart', color: 'blue' });
    const coloredLucide = findElement(coloredTree, (type) => type === lucideType);
    // 'blue' token resolves to the saturated edge HSL — color-tokens.ts:24.
    expect(coloredLucide?.props.color).toBe('hsl(217, 91%, 60%)');
  });

  it('ResizeControls fires data.onResize on resize end with width/height/x/y', () => {
    const onResize = mock(() => {});
    const setResizing = mock(() => {});
    const tree = callIconNode({ icon: 'shopping-cart', onResize, setResizing }, {
      selected: true,
    } as Partial<NodeProps>);
    const controls = findElement(tree, (type) => type === ResizeControls);
    if (!controls) throw new Error('ResizeControls not found in IconNode tree');
    const props = controls.props as {
      visible: boolean;
      onResizeStart: () => void;
      onResizeEnd: (
        e: unknown,
        params: { width: number; height: number; x: number; y: number },
      ) => void;
    };
    expect(props.visible).toBe(true);

    props.onResizeStart();
    expect(setResizing).toHaveBeenCalledWith(true);

    props.onResizeEnd(undefined, { width: 100, height: 80, x: 10, y: 20 });
    expect(setResizing).toHaveBeenCalledWith(false);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith('n1', { width: 100, height: 80, x: 10, y: 20 });
  });

  it('does NOT call data.onResize when start and end dimensions are identical (US-021 click without drag)', () => {
    // React Flow fires onResizeStart + onResizeEnd unconditionally — even
    // for a mousedown+mouseup with no movement. Without the click-vs-drag
    // guard, the node visibly expands on a stray click of the handle.
    const onResize = mock(() => {});
    const setResizing = mock(() => {});
    const tree = callIconNode({ icon: 'shopping-cart', onResize, setResizing }, {
      selected: true,
    } as Partial<NodeProps>);
    const controls = findElement(tree, (type) => type === ResizeControls);
    if (!controls) throw new Error('ResizeControls not found in IconNode tree');
    const props = controls.props as {
      onResizeStart: (
        e: unknown,
        params: { x: number; y: number; width: number; height: number },
      ) => void;
      onResizeEnd: (
        e: unknown,
        params: { x: number; y: number; width: number; height: number },
      ) => void;
    };
    const start = { x: 10, y: 20, width: 100, height: 80 };
    props.onResizeStart(undefined, start);
    props.onResizeEnd(undefined, start);
    expect(onResize).not.toHaveBeenCalled();
    // The resizing flag still flips back so the visual state cleans up —
    // only the persistence call is skipped.
    expect(setResizing).toHaveBeenCalledWith(true);
    expect(setResizing).toHaveBeenCalledWith(false);
  });

  it('keeps explicit fallback dims when isResizing flips true with data.width/height undefined (regression: precreated-node click-shrink)', () => {
    // Before the fix, `sized` flipped true when `isResizing` flipped true even
    // if `data.width`/`data.height` were undefined — which stripped the inline
    // width/height and added `w-full h-full` on an outer wrapper that had no
    // explicit dims (the React Flow node had no `node.width` because
    // `data.width` was undef). Result: the inner collapsed to intrinsic text
    // width on mousedown of the resize handle, visibly shrinking before any
    // drag tick. The user-reported symptom was "click on the resize icon →
    // the node suddenly shrinks even if I don't move to resize yet", only
    // happening on freshly created / precreated nodes that hadn't been
    // resized yet.
    //
    // Fix: `sized` no longer depends on `isResizing` — only on whether the
    // node has persisted dims in data. The first per-tick `onResize` of an
    // actual drag sets `data.width` and the wrapper-driven sizing kicks in
    // naturally on the next render.
    const tree = callIconNode(
      { icon: 'shopping-cart', onResize: () => {} },
      { selected: true } as Partial<NodeProps>,
      [true], // useState index 0 is `isResizing` (set by useResizeGesture).
    );
    if (!isElement(tree)) throw new Error('IconNode did not return a React element');
    const style = tree.props.style as { width?: number; height?: number };
    expect(style.width).toBe(48);
    expect(style.height).toBe(48);
    const className = tree.props.className as string;
    expect(className).not.toContain('w-full');
    expect(className).not.toContain('h-full');
  });

  it('calls data.onResize with new dims when width changes (US-021 paired test)', () => {
    const onResize = mock(() => {});
    const setResizing = mock(() => {});
    const tree = callIconNode({ icon: 'shopping-cart', onResize, setResizing }, {
      selected: true,
    } as Partial<NodeProps>);
    const controls = findElement(tree, (type) => type === ResizeControls);
    if (!controls) throw new Error('ResizeControls not found in IconNode tree');
    const props = controls.props as {
      onResizeStart: (
        e: unknown,
        params: { x: number; y: number; width: number; height: number },
      ) => void;
      onResizeEnd: (
        e: unknown,
        params: { x: number; y: number; width: number; height: number },
      ) => void;
    };
    const start = { x: 10, y: 20, width: 100, height: 80 };
    const end = { x: 10, y: 20, width: 200, height: 120 };
    props.onResizeStart(undefined, start);
    props.onResizeEnd(undefined, end);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith('n1', { width: 200, height: 120, x: 10, y: 20 });
  });

  it('dblclick enters inline label-edit mode when onNameChange is wired (US-004)', () => {
    // US-004: dblclick now enters inline label-edit mode (replacing the
    // US-016 picker-on-dblclick binding; the picker is now reachable via
    // the US-003 right-click menu item).
    const onNameChange = mock(() => {});
    const tree = callIconNode({ icon: 'shopping-cart', onNameChange });
    if (!isElement(tree)) throw new Error('IconNode did not return a React element');
    const onDoubleClick = tree.props.onDoubleClick as
      | ((e: { stopPropagation: () => void }) => void)
      | undefined;
    expect(onDoubleClick).toBeDefined();

    // The handler stops propagation so React Flow's pane dblclick (which
    // creates a new shape in some regions) doesn't also fire. A wrapping
    // listener wouldn't fire if stopPropagation is called on the event.
    const stopPropagation = mock(() => {});
    onDoubleClick?.({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    // The handler does NOT call onNameChange directly — it flips local
    // editing state, then the InlineEdit commits on Enter/blur.
    expect(onNameChange).not.toHaveBeenCalled();
  });

  it('renders an InlineEdit positioned below the icon when editing (US-004)', () => {
    // Force isEditing=true via the useState override so the editing branch
    // renders. The InlineEdit wires the prior label as `initialValue`,
    // forwards commits to `data.onNameChange(id, ...)`, and clears the
    // editing flag via `onExit`.
    const onNameChange = mock(() => {});
    const tree = callIconNode(
      { icon: 'shopping-cart', name: 'Cart', onNameChange },
      { id: 'icon-99' } as Partial<NodeProps>,
      // index 0 = useResizeGesture's `isResizing` (passthrough); index 1 =
      // the icon-node's own `isEditing` flag (force true to render the editor).
      [undefined, true],
    );
    const editors = findAll(tree, (el) => el.type === InlineEdit);
    expect(editors).toHaveLength(1);
    const editor = editors[0];
    if (!editor) throw new Error('InlineEdit not rendered');
    const editorProps = editor.props as {
      initialValue: string;
      field: string;
      onCommit: (v: string) => void;
      onExit: () => void;
      placeholder?: string;
    };
    expect(editorProps.initialValue).toBe('Cart');
    expect(editorProps.field).toBe('icon-node-label');
    expect(editorProps.placeholder).toBe('Label');
    editorProps.onCommit('Basket');
    expect(onNameChange).toHaveBeenCalledTimes(1);
    expect(onNameChange).toHaveBeenCalledWith('icon-99', 'Basket');

    // Saving an empty string clears the label (US-002 hides the caption when
    // data.name is empty); the icon-node simply forwards the value.
    editorProps.onCommit('');
    expect(onNameChange).toHaveBeenLastCalledWith('icon-99', '');

    // The read-mode caption is replaced by the editor while editing — no
    // duplicate label rendered.
    const readCaptions = findAll(
      tree,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'icon-node-label',
    );
    expect(readCaptions).toHaveLength(0);

    // Editor is wrapped in an absolutely-positioned strip below the icon so
    // the node's bounding box (read by React Flow) is unchanged in edit mode.
    const strips = findAll(tree, (el) => {
      if (el.type !== 'div') return false;
      const cls = String((el.props as { className?: string }).className ?? '');
      return cls.includes('absolute') && cls.includes('top-full');
    });
    expect(strips.length).toBeGreaterThanOrEqual(1);
  });

  it('empty label + editing: InlineEdit initialValue is empty (US-004)', () => {
    const onNameChange = mock(() => {});
    const tree = callIconNode({ icon: 'shopping-cart', onNameChange }, undefined, [
      undefined,
      true,
    ]);
    const editors = findAll(tree, (el) => el.type === InlineEdit);
    expect(editors).toHaveLength(1);
    const editorProps = editors[0]?.props as { initialValue: string };
    expect(editorProps.initialValue).toBe('');
  });

  it('renders 4 connection handles wired for source/target hit-testing (US-023)', () => {
    // US-023 regression fence: xyflow's `getHandleBounds(type, ...)` queries
    // `nodeElement.querySelectorAll('.source')` and `'.target'` to compute the
    // bounds it later uses for `getClosestHandle` snap. The Handle component
    // adds those classes based on `type='source'|'target'`. If a refactor
    // accidentally swaps the roles (e.g. all 4 to target) OR drops a handle,
    // xyflow can no longer find an iconNode endpoint within connectionRadius
    // and the connection silently fails to land — exactly the user-reported
    // bug. This test pins the 4-handle layout at the iconNode level so the
    // connection path stays exercisable from xyflow's side.
    const tree = callIconNode({ icon: 'shopping-cart' });
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
    const byId = new Map<string, ReactElementLike>();
    for (const h of handles) {
      byId.set(String((h.props as { id?: string }).id), h);
    }
    // top + left = target (incoming); right + bottom = source (outgoing).
    expect(byId.get('t')?.props.type).toBe('target');
    expect(byId.get('t')?.props.position).toBe(Position.Top);
    expect(byId.get('l')?.props.type).toBe('target');
    expect(byId.get('l')?.props.position).toBe(Position.Left);
    expect(byId.get('r')?.props.type).toBe('source');
    expect(byId.get('r')?.props.position).toBe(Position.Right);
    expect(byId.get('b')?.props.type).toBe('source');
    expect(byId.get('b')?.props.position).toBe(Position.Bottom);
  });

  it('renders LockBadge and disables ResizeControls when data.locked is true (US-019)', () => {
    // Unlocked baseline: ResizeControls visible (when selected) and no badge.
    const unlocked = callIconNode({ icon: 'shopping-cart', onResize: () => {} }, {
      selected: true,
    } as Partial<NodeProps>);
    expect(findAll(unlocked, (el) => el.type === LockBadge)).toHaveLength(0);
    const unlockedControls = findElement(unlocked, (type) => type === ResizeControls);
    expect((unlockedControls?.props as { visible: boolean }).visible).toBe(true);

    // Locked: badge renders and ResizeControls switch to invisible/hidden.
    const locked = callIconNode({ icon: 'shopping-cart', onResize: () => {}, locked: true }, {
      selected: true,
    } as Partial<NodeProps>);
    expect(findAll(locked, (el) => el.type === LockBadge)).toHaveLength(1);
    const lockedControls = findElement(locked, (type) => type === ResizeControls);
    expect((lockedControls?.props as { visible: boolean }).visible).toBe(false);
  });

  it('does NOT render LockBadge when data.locked is absent or false (US-019)', () => {
    expect(
      findAll(callIconNode({ icon: 'shopping-cart' }), (el) => el.type === LockBadge),
    ).toHaveLength(0);
    expect(
      findAll(
        callIconNode({ icon: 'shopping-cart', locked: false }),
        (el) => el.type === LockBadge,
      ),
    ).toHaveLength(0);
  });

  it('dblclick is a no-op (and does NOT stop propagation) when onNameChange is absent (US-004)', () => {
    // Read-only / no-demo contexts don't wire the callback; the wrapper
    // should still render with an onDoubleClick handler, but the handler
    // bails before stopPropagation so a wrapping listener (e.g. the canvas
    // dblclick-to-create-shape handler) still gets to run.
    const tree = callIconNode({ icon: 'shopping-cart' });
    if (!isElement(tree)) throw new Error('IconNode did not return a React element');
    const onDoubleClick = tree.props.onDoubleClick as
      | ((e: { stopPropagation: () => void }) => void)
      | undefined;
    expect(onDoubleClick).toBeDefined();

    const stopPropagation = mock(() => {});
    onDoubleClick?.({ stopPropagation });
    expect(stopPropagation).not.toHaveBeenCalled();
  });
});
