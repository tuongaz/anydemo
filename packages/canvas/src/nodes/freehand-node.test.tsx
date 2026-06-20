import { describe, expect, it } from 'bun:test';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import * as React from 'react';
import { FreehandNode, type FreehandNodeType } from './freehand-node.tsx';
import { ResizeControls } from './resize-controls.tsx';

// Mirrors icon-node.test.tsx: Bun runs these without a DOM, so we shim React's
// internal dispatcher and call the node component as a plain function. Each hook
// returns a synchronous initial value; useEffect is a no-op so the dynamic
// import never fires — the component renders its synchronous first paint (the
// <polyline> fallback) which is exactly what we assert here. The dispatcher also
// stubs useCallback/useMemo/useContext so the resize-gesture + connect chrome
// (mirroring icon-node) drive without a real ReactFlow mount.
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useEffect: () => void;
  useRef: <T>(initial: T) => { current: T };
  useContext: <T>(ctx: unknown) => T;
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
    useEffect: () => {},
    useRef: <T,>(initial: T) => ({ current: initial }),
    useContext: <T,>() => ({ studioBaseUrl: '' }) as T,
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

function callFreehandNode(
  data: Record<string, unknown>,
  overrides: Partial<NodeProps> = {},
): unknown {
  const props = {
    id: 'n1',
    type: 'freehand',
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
  } as unknown as NodeProps<FreehandNodeType>;
  // FreehandNode is `memo(FreehandNodeImpl, …)`, which produces a memo
  // descriptor object rather than a callable function. The inner impl is at
  // `.type` per React's memo internal shape — call it directly so the hook
  // shim drives the rendered tree (mirrors icon-node.test.tsx).
  const impl = (FreehandNode as unknown as { type: (p: NodeProps<FreehandNodeType>) => unknown })
    .type;
  return renderWithHooks(() => impl(props));
}

function findSvg(tree: unknown): ReactElementLike {
  const svg = findElement(tree, (type) => type === 'svg');
  if (!svg) throw new Error('expected an <svg> in the FreehandNode tree');
  return svg;
}

describe('FreehandNode', () => {
  it('renders an <svg role="img"> with a viewBox sized to the node box', () => {
    const tree = callFreehandNode({
      points: [
        [0, 0, 0.5],
        [1, 1, 0.5],
      ],
      width: 120,
      height: 80,
    });
    const svg = findSvg(tree);
    expect(svg.props.role).toBe('img');
    expect(svg.props.viewBox).toBe('0 0 120 80');
  });

  it('uses data.name as the aria-label when set', () => {
    const tree = callFreehandNode({
      points: [
        [0, 0, 0.5],
        [1, 1, 0.5],
      ],
      width: 100,
      height: 100,
      name: 'Signature',
    });
    expect(findSvg(tree).props['aria-label']).toBe('Signature');
  });

  it('falls back to "Freehand drawing" when data.name is absent', () => {
    const tree = callFreehandNode({
      points: [
        [0, 0, 0.5],
        [1, 1, 0.5],
      ],
      width: 100,
      height: 100,
    });
    expect(findSvg(tree).props['aria-label']).toBe('Freehand drawing');
  });

  it('renders a <polyline> fallback through the denormalized points before getStroke resolves', () => {
    // useEffect is a no-op in the shim, so getStroke never resolves and the
    // synchronous fallback is what paints on first render.
    const tree = callFreehandNode({
      points: [
        [0, 0, 0.5],
        [1, 0.5, 0.5],
      ],
      width: 200,
      height: 100,
    });
    const polyline = findElement(tree, (type) => type === 'polyline');
    if (!polyline) throw new Error('expected a <polyline> fallback');
    // Points denormalized to local px: (0,0) and (200,50).
    expect(polyline.props.points).toBe('0,0 200,50');
  });

  it('renders resize controls (visible) when selected and onResize is wired', () => {
    const tree = callFreehandNode(
      {
        points: [
          [0, 0, 0.5],
          [1, 1, 0.5],
        ],
        width: 100,
        height: 100,
        onResize: () => {},
      },
      { selected: true } as Partial<NodeProps>,
    );
    const controls = findElement(tree, (type) => type === ResizeControls);
    if (!controls) throw new Error('ResizeControls not found in FreehandNode tree');
    expect(controls.props.visible).toBe(true);
  });

  it('does not show resize controls when unselected', () => {
    const tree = callFreehandNode({
      points: [
        [0, 0, 0.5],
        [1, 1, 0.5],
      ],
      width: 100,
      height: 100,
      onResize: () => {},
    });
    const controls = findElement(tree, (type) => type === ResizeControls);
    if (!controls) throw new Error('ResizeControls not found in FreehandNode tree');
    expect(controls.props.visible).toBe(false);
  });

  it('does not show resize controls when onResize is absent even if selected', () => {
    const tree = callFreehandNode(
      {
        points: [
          [0, 0, 0.5],
          [1, 1, 0.5],
        ],
        width: 100,
        height: 100,
      },
      { selected: true } as Partial<NodeProps>,
    );
    const controls = findElement(tree, (type) => type === ResizeControls);
    if (!controls) throw new Error('ResizeControls not found in FreehandNode tree');
    expect(controls.props.visible).toBe(false);
  });

  it('renders four connection handles with ids t/l/r/b', () => {
    const tree = callFreehandNode({
      points: [
        [0, 0, 0.5],
        [1, 1, 0.5],
      ],
      width: 100,
      height: 100,
    });
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
    const byId = new Map<string, ReactElementLike>();
    for (const h of handles) {
      byId.set(String((h.props as { id?: string }).id), h);
    }
    expect(new Set(byId.keys())).toEqual(new Set(['t', 'l', 'r', 'b']));
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

  it('handles are opacity-0 until selected', () => {
    const unselected = callFreehandNode({
      points: [
        [0, 0, 0.5],
        [1, 1, 0.5],
      ],
      width: 100,
      height: 100,
    });
    for (const h of findAll(unselected, (el) => el.type === Handle)) {
      const cls = String((h.props as { className?: string }).className ?? '');
      expect(cls).toContain('opacity-0');
      expect(cls).not.toContain('opacity-100');
    }

    const selected = callFreehandNode(
      {
        points: [
          [0, 0, 0.5],
          [1, 1, 0.5],
        ],
        width: 100,
        height: 100,
      },
      { selected: true } as Partial<NodeProps>,
    );
    for (const h of findAll(selected, (el) => el.type === Handle)) {
      const cls = String((h.props as { className?: string }).className ?? '');
      expect(cls).toContain('opacity-100');
    }
  });

  it('wrapper omits fixed width/height inline style when sized (live-resize: h-full/w-full tracks the drag)', () => {
    // A sized node (persisted data.width/height) must let xyflow drive the
    // wrapper size during a resize drag — a hardcoded inline width/height would
    // override the h-full/w-full classes and pin the ink to its pre-drag size
    // (updating only on resize-stop).
    const tree = callFreehandNode({
      points: [
        [0, 0, 0.5],
        [1, 1, 0.5],
      ],
      width: 120,
      height: 60,
    });
    if (!isElement(tree)) throw new Error('FreehandNode did not return a React element');
    const style = (tree.props.style ?? {}) as { width?: number; height?: number };
    expect(style.width).toBeUndefined();
    expect(style.height).toBeUndefined();
    const className = String(tree.props.className ?? '');
    expect(className).toContain('h-full');
    expect(className).toContain('w-full');
  });

  it('wrapper sets fixed default width/height when unsized (no persisted dims)', () => {
    // Without persisted dims the wrapper would be zero-height, so it falls back
    // to the fixed default px and does NOT take h-full/w-full.
    const tree = callFreehandNode({
      points: [
        [0, 0, 0.5],
        [1, 1, 0.5],
      ],
    });
    if (!isElement(tree)) throw new Error('FreehandNode did not return a React element');
    const style = (tree.props.style ?? {}) as { width?: number; height?: number };
    expect(style.width).toBe(100);
    expect(style.height).toBe(100);
    const className = String(tree.props.className ?? '');
    expect(className).not.toContain('h-full');
    expect(className).not.toContain('w-full');
  });

  it('fills the wrapper with a non-preserving viewBox so resize stretches the ink', () => {
    const tree = callFreehandNode({
      points: [
        [0, 0, 0.5],
        [1, 1, 0.5],
      ],
      width: 120,
      height: 60,
    });
    const svg = findSvg(tree);
    expect(svg.props.viewBox).toBe('0 0 120 60');
    expect(svg.props.preserveAspectRatio).toBe('none');
    expect(svg.props.width).toBe('100%');
    expect(svg.props.height).toBe('100%');
  });
});
