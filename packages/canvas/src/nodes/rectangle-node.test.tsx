import { describe, expect, it } from 'bun:test';
import type { NodeProps } from '@xyflow/react';
import * as React from 'react';
import { RectangleNode, type RectangleNodeType } from './rectangle-node.tsx';
import { StatusBadge } from './status-badge.tsx';

// Shim React's internal dispatcher so we can render RectangleNode without a
// real React Flow mount (see icon-node.test.tsx for the same pattern). The
// shim returns synchronous useState initial values; setters are no-ops.
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: () => void;
};

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

// JSX-bearing slot keys other than `children` that we want the walker to
// descend into. `trailing` is NodeHeader's right-slot prop; `anchor` belongs
// to IconPickerPopover. Both pass real React elements that callers (and tests)
// reason about, so they should be reachable.
const JSX_SLOT_KEYS = ['children', 'trailing', 'anchor'] as const;

function findAll(tree: unknown, predicate: (el: ReactElementLike) => boolean): ReactElementLike[] {
  const out: ReactElementLike[] = [];
  const visit = (node: unknown) => {
    if (!isElement(node)) return;
    if (predicate(node)) out.push(node);
    for (const key of JSX_SLOT_KEYS) {
      const slot = (node.props as Record<string, unknown>)[key];
      if (slot === undefined || slot === null) continue;
      const arr = Array.isArray(slot) ? slot : [slot];
      for (const c of arr) visit(c);
    }
  };
  visit(tree);
  return out;
}

function findByTestId(tree: unknown, testId: string): ReactElementLike[] {
  return findAll(tree, (el) => (el.props as { 'data-testid'?: string })['data-testid'] === testId);
}

// Function components in the JSX tree appear as `{ type: FunctionRef, props }`
// without their render body executing under the shim. Match by the function's
// `.name` so local components (PlayButton) defined inside rectangle-node.tsx
// can be located without exporting them.
function findByComponentName(tree: unknown, name: string): ReactElementLike[] {
  return findAll(tree, (el) => {
    const t = el.type as { name?: string } | { type?: { name?: string } } | unknown;
    if (typeof t === 'function' && (t as { name?: string }).name === name) return true;
    // React.memo wraps the inner component in a descriptor with `.type`.
    if (
      typeof t === 'object' &&
      t !== null &&
      typeof (t as { type?: unknown }).type === 'function' &&
      (t as { type: { name?: string } }).type.name === name
    ) {
      return true;
    }
    return false;
  });
}

function callRectangleNode(
  data: Record<string, unknown>,
  overrides: Partial<NodeProps<RectangleNodeType>> = {},
): unknown {
  const props = {
    id: 'n1',
    type: 'rectangle',
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
  } as unknown as NodeProps<RectangleNodeType>;
  // memo descriptor — the inner impl is at `.type`.
  const impl = (RectangleNode as unknown as { type: (p: NodeProps<RectangleNodeType>) => unknown })
    .type;
  return renderWithHooks(() => impl(props));
}

// US-009: capability-chrome-rectangle-only invariant — first half. The
// rectangle is the SOLE renderer that draws the play button and status pill.
// Adding a play action / status action data field MUST surface chrome on
// rectangle. The other-half geometric-node test fences the inverse.
describe('US-009: RectangleNode renders capability chrome', () => {
  const onPlay = () => {};

  it('draws the play button when data.playAction is set', () => {
    const tree = callRectangleNode({
      name: 'svc',
      onPlay,
      playAction: {
        kind: 'script' as const,
        interpreter: 'bun',
        scriptPath: 'scripts/play.ts',
      },
    });
    const playButtons = findByComponentName(tree, 'PlayButton');
    expect(playButtons).toHaveLength(1);
  });

  it('does NOT draw the play button when data.playAction is absent', () => {
    const tree = callRectangleNode({ name: 'svc', onPlay });
    const playButtons = findByComponentName(tree, 'PlayButton');
    expect(playButtons).toHaveLength(0);
  });

  it('draws the status badge when data.statusReport is set', () => {
    const tree = callRectangleNode({
      name: 'svc',
      statusReport: { state: 'ok', summary: 'all good', ts: 1 },
    });
    // The status badge wraps a StatusBadge component inside a div with the
    // rectangle-node-status-badge testid. Find either.
    const badges = findByTestId(tree, 'rectangle-node-status-badge');
    expect(badges).toHaveLength(1);
    // The StatusBadge component is the child — confirms it really is rendered.
    const statusBadges = findAll(tree, (el) => el.type === StatusBadge);
    expect(statusBadges).toHaveLength(1);
  });

  it('does NOT draw the status badge when data.statusReport is absent', () => {
    const tree = callRectangleNode({ name: 'svc' });
    const badges = findByTestId(tree, 'rectangle-node-status-badge');
    expect(badges).toHaveLength(0);
  });

  it('emits data-node-type="rectangle" on the root element', () => {
    const tree = callRectangleNode({ name: 'svc' });
    const rect = findAll(
      tree,
      (el) => (el.props as { 'data-node-type'?: string })['data-node-type'] === 'rectangle',
    );
    expect(rect).toHaveLength(1);
  });
});

// Empty-title guard: the rectangle header chrome (border + bg-muted strip)
// only renders when there's something to label. An empty/missing name hides
// the header entirely — icon presence does not override this.
describe('RectangleNode header visibility', () => {
  it('renders NodeHeader when data.name is set', () => {
    const tree = callRectangleNode({ name: 'svc' });
    expect(findByComponentName(tree, 'NodeHeader')).toHaveLength(1);
  });

  it('omits NodeHeader when data.name is undefined', () => {
    const tree = callRectangleNode({});
    expect(findByComponentName(tree, 'NodeHeader')).toHaveLength(0);
  });

  it('omits NodeHeader when data.name is the empty string', () => {
    const tree = callRectangleNode({ name: '' });
    expect(findByComponentName(tree, 'NodeHeader')).toHaveLength(0);
  });

  it('omits NodeHeader when only data.icon is set (icon does not surface a standalone header)', () => {
    const tree = callRectangleNode({ icon: 'sparkles' });
    expect(findByComponentName(tree, 'NodeHeader')).toHaveLength(0);
  });
});

// Theme-aware elevation. `data.shadow` swaps the baseline `sf:shadow-sm`
// class for the matching `var(--node-shadow-N)` so the two shadow sources
// don't compound.
describe('RectangleNode shadow elevation', () => {
  function getRoot(tree: unknown): {
    style: Record<string, string | undefined>;
    className: string;
  } {
    const root = findAll(
      tree,
      (el) => (el.props as { 'data-node-type'?: string })['data-node-type'] === 'rectangle',
    )[0];
    if (!root) throw new Error('rectangle root missing');
    const props = root.props as { style?: Record<string, string>; className?: string };
    return { style: props.style ?? {}, className: props.className ?? '' };
  }

  it('keeps the sf:shadow-sm baseline class when data.shadow is unset', () => {
    const { style, className } = getRoot(callRectangleNode({ name: 's' }));
    expect(style.boxShadow).toBeUndefined();
    expect(className).toContain('sf:shadow-sm');
  });

  it('paints var(--node-shadow-N) and drops sf:shadow-sm when data.shadow is set', () => {
    const { style, className } = getRoot(callRectangleNode({ name: 's', shadow: 3 }));
    expect(style.boxShadow).toBe('var(--node-shadow-3)');
    expect(className).not.toContain('sf:shadow-sm');
  });

  it('shadow: 0 paints var(--node-shadow-0) (none) and still drops the baseline class', () => {
    const { style, className } = getRoot(callRectangleNode({ name: 's', shadow: 0 }));
    expect(style.boxShadow).toBe('var(--node-shadow-0)');
    expect(className).not.toContain('sf:shadow-sm');
  });
});

// The Align toggle on the style strip writes data.textAlign; the rectangle
// renderer must (a) thread it into NodeHeader so the title aligns, (b) bake
// it into descriptionFontStyle so the body button aligns, and (c) drop the
// hardcoded `sf:text-left` class once an explicit alignment is set (otherwise
// the class wins regardless of the inline style). Earlier fix only touched
// geometric-node.tsx, leaving rectangles unaligned — this fence guards that.
describe('RectangleNode textAlign fan-out', () => {
  function findDescButton(tree: unknown): ReactElementLike {
    const buttons = findAll(tree, (el) => {
      if (el.type !== 'button') return false;
      const cls = (el.props as { className?: string }).className ?? '';
      return cls.includes('sf:text-muted-foreground');
    });
    if (!buttons[0]) throw new Error('description button missing');
    return buttons[0];
  }

  it('passes data.textAlign to NodeHeader', () => {
    const tree = callRectangleNode({ name: 'svc', textAlign: 'right' });
    const header = findByComponentName(tree, 'NodeHeader')[0];
    if (!header) throw new Error('NodeHeader missing');
    expect((header.props as { textAlign?: string }).textAlign).toBe('right');
  });

  it('applies data.textAlign to the description button inline style', () => {
    const tree = callRectangleNode({ name: 's', description: 'body', textAlign: 'center' });
    const desc = findDescButton(tree);
    const style = (desc.props as { style?: Record<string, string> }).style ?? {};
    expect(style.textAlign).toBe('center');
  });

  it('drops the hardcoded sf:text-left class once textAlign is set', () => {
    const tree = callRectangleNode({ name: 's', description: 'body', textAlign: 'right' });
    const cls = (findDescButton(tree).props as { className?: string }).className ?? '';
    expect(cls).not.toContain('sf:text-left');
  });

  it('keeps sf:text-left when data.textAlign is undefined (back-compat default)', () => {
    const tree = callRectangleNode({ name: 's', description: 'body' });
    const cls = (findDescButton(tree).props as { className?: string }).className ?? '';
    expect(cls).toContain('sf:text-left');
  });
});
