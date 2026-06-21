import { describe, expect, it } from 'bun:test';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import * as React from 'react';
import { GROUP_NODE_Z_INDEX, GroupNode, type GroupNodeType } from './group-node.tsx';
import { ResizeControls } from './resize-controls.tsx';

// Mirrors freehand-node.test.tsx / icon-node.test.tsx: Bun runs without a DOM,
// so we shim React's internal dispatcher and call the component as a plain
// function. The simplified GroupNode uses no hooks, but the shim is kept so the
// harness stays identical to the sibling node tests.
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

function callGroupNode(
  data: Record<string, unknown>,
  overrides: Partial<NodeProps> = {},
): ReactElementLike {
  const props = {
    id: 'g1',
    type: 'group',
    data,
    selected: false,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    zIndex: GROUP_NODE_Z_INDEX,
    dragging: false,
    deletable: true,
    draggable: true,
    selectable: true,
    ...overrides,
  } as unknown as NodeProps<GroupNodeType>;
  // GroupNode is `memo(GroupNodeImpl, …)`, whose inner impl is at `.type`.
  const impl = (GroupNode as unknown as { type: (p: NodeProps<GroupNodeType>) => unknown }).type;
  const tree = renderWithHooks(() => impl(props));
  if (!isElement(tree)) throw new Error('GroupNode did not return a React element');
  return tree;
}

describe('GroupNode', () => {
  it('renders a container div with data-node-type="group"', () => {
    const tree = callGroupNode({ childIds: [], width: 320, height: 220 });
    expect(tree.props['data-node-type']).toBe('group');
    expect(tree.props['data-testid']).toBe('group-node');
  });

  it('is CHROME-LESS: paints no background, no border, no corner radius', () => {
    // A group is a transparent hit-area + connector anchor. It MUST NOT derive
    // any fill/border from the (now-ignored) color tokens — even when the data
    // carries legacy visual fields, the renderer leaves them off so the only
    // selection treatment is the overlay marquee.
    const tree = callGroupNode({
      childIds: ['a'],
      width: 300,
      height: 200,
      backgroundColor: 'slate',
      borderColor: 'blue',
      borderSize: 2,
      cornerRadius: 16,
    });
    const style = (tree.props.style ?? {}) as React.CSSProperties;
    expect(style.backgroundColor).toBeUndefined();
    expect(style.borderColor).toBeUndefined();
    expect(style.borderWidth).toBeUndefined();
    expect(style.borderStyle).toBeUndefined();
    expect(style.borderRadius).toBeUndefined();
    expect(style.boxShadow).toBeUndefined();
  });

  it('renders NO title header (the group is chrome-less)', () => {
    // No NodeHeader, no title element, no titlebar — the group never draws a
    // header band. Identification comes from the aria-label only.
    const tree = callGroupNode({ childIds: [], name: 'My group', width: 300, height: 200 });
    const titleEls = findAll(
      tree,
      (el) =>
        el.props['data-testid'] === 'group-node-header' ||
        el.props['data-testid'] === 'group-node-title' ||
        el.props['data-testid'] === 'group-node-titlebar',
    );
    expect(titleEls).toHaveLength(0);
  });

  it('fills the wrapper (h-full/w-full) and omits fixed px when sized', () => {
    const tree = callGroupNode({ childIds: [], width: 400, height: 300 });
    const style = (tree.props.style ?? {}) as { width?: number; height?: number };
    expect(style.width).toBeUndefined();
    expect(style.height).toBeUndefined();
    const className = String(tree.props.className ?? '');
    expect(className).toContain('h-full');
    expect(className).toContain('w-full');
  });

  it('falls back to the default box size when unsized', () => {
    const tree = callGroupNode({ childIds: [] });
    const style = (tree.props.style ?? {}) as { width?: number; height?: number };
    expect(style.width).toBe(320);
    expect(style.height).toBe(220);
    const className = String(tree.props.className ?? '');
    expect(className).not.toContain('h-full');
  });

  it('exposes an accessible name from the title (aria-label)', () => {
    const titled = callGroupNode({ childIds: [], name: 'Payments', width: 300, height: 200 });
    expect(titled.props['aria-label']).toBe('Payments');

    const untitled = callGroupNode({ childIds: [], width: 300, height: 200 });
    expect(untitled.props['aria-label']).toBe('Group');
  });

  it('MUST NOT mount ResizeControls (design §12.3 — resize is served by the overlay)', () => {
    const tree = callGroupNode({ childIds: [], width: 300, height: 200 }, {
      selected: true,
    } as Partial<NodeProps>);
    const controls = findElement(tree, (type) => type === ResizeControls);
    expect(controls).toBeNull();
  });

  it('renders four connection handles with ids t/l/r/b', () => {
    const tree = callGroupNode({ childIds: [], width: 300, height: 200 });
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
    const ids = new Set(handles.map((h) => String((h.props as { id?: string }).id)));
    expect(ids).toEqual(new Set(['t', 'l', 'r', 'b']));
  });

  // -- M8 connectors: a group is a connector endpoint (design §3 #4, §11 L7.4) --
  describe('M8: connection handles let a group be a connector endpoint', () => {
    type HandleProps = { id?: string; type?: string; position?: Position; isConnectable?: boolean };
    const handlesOf = (tree: ReactElementLike) =>
      findAll(tree, (el) => el.type === Handle).map((h) => h.props as HandleProps);

    it('places target handles on TOP + LEFT and source handles on RIGHT + BOTTOM (border-anchored)', () => {
      // The handles are anchored to the OUTER border via xyflow's Position enum,
      // so they sit on the box edges. Mirrors the rectangle-node handle contract
      // so a group connects exactly like a card.
      const byId = new Map(
        handlesOf(callGroupNode({ childIds: [], width: 300, height: 200 })).map((h) => [
          String(h.id),
          h,
        ]),
      );
      expect(byId.get('t')).toMatchObject({ type: 'target', position: Position.Top });
      expect(byId.get('l')).toMatchObject({ type: 'target', position: Position.Left });
      expect(byId.get('r')).toMatchObject({ type: 'source', position: Position.Right });
      expect(byId.get('b')).toMatchObject({ type: 'source', position: Position.Bottom });
    });

    it('forwards isConnectable to every handle (gated off in view/mini)', () => {
      const on = handlesOf(
        callGroupNode({ childIds: [], width: 300, height: 200 }, {
          isConnectable: true,
        } as Partial<NodeProps>),
      );
      expect(on.every((h) => h.isConnectable === true)).toBe(true);
      const off = handlesOf(
        callGroupNode({ childIds: [], width: 300, height: 200 }, {
          isConnectable: false,
        } as Partial<NodeProps>),
      );
      expect(off.every((h) => h.isConnectable === false)).toBe(true);
    });
  });

  it('exports a NEGATIVE zIndex so the group paints behind members and edges', () => {
    // Edges sit at zIndex 0 and other nodes leave zIndex undefined (→ 0); the
    // group must be strictly below both, hence negative. This is the z-order
    // contract M5/M9 build on (design §9.6).
    expect(GROUP_NODE_Z_INDEX).toBeLessThan(0);
  });

  it('z-order is REORDER-INVARIANT: a member (z→0) always sits above a group (z<0) (M9 §9.6 step D)', () => {
    // The bring-to-front / send-to-back context-menu ops are ARRAY reorders
    // (server-side `/nodes/:id/order`), not zIndex writes. `buildNode` re-pins a
    // group to GROUP_NODE_Z_INDEX on EVERY render regardless of where the group
    // lands in the node array, and `elevateNodesOnSelect={false}` keeps it there
    // even when selected. So whatever a user does with reorder, a member's
    // effective z (undefined → 0) stays strictly above its group's (< 0).
    const memberEffectiveZ = 0; // members leave zIndex undefined → xyflow treats as 0
    expect(GROUP_NODE_Z_INDEX).toBeLessThan(memberEffectiveZ);
  });

  // -- M6 isolation affordance (design §5.3) --------------------------------
  describe('M6: entered (data.active) affordance', () => {
    it('NOT entered: no data-active, hit-area stays interactive, no outline', () => {
      const tree = callGroupNode({ childIds: ['a'], width: 300, height: 200 });
      expect(tree.props['data-active']).toBeUndefined();
      const style = (tree.props.style ?? {}) as React.CSSProperties;
      // The hit-area captures clicks (selects the group as a unit).
      expect(style.pointerEvents).toBeUndefined();
      expect(style.outline).toBeUndefined();
    });

    it('entered: data-active="true", hit-area click-through, faint dashed outline', () => {
      const tree = callGroupNode({ childIds: ['a'], width: 300, height: 200, active: true });
      // Stable test hook for entry.
      expect(tree.props['data-active']).toBe('true');
      const style = (tree.props.style ?? {}) as React.CSSProperties;
      // The hit-area becomes click-through so members underneath + the empty pane
      // in the band around them are reachable (→ select member / exit).
      expect(style.pointerEvents).toBe('none');
      // A subtle dashed outline marks the entered bounds (layout-free).
      expect(typeof style.outline).toBe('string');
      expect(String(style.outline)).toContain('dashed');
    });
  });
});
