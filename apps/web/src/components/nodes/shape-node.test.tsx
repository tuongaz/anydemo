import { describe, expect, it } from 'bun:test';
import { InlineEdit } from '@/components/inline-edit';
import { ResizeControls } from '@/components/nodes/resize-controls';
import { ShapeNode } from '@/components/nodes/shape-node';
import {
  SHAPE_CLASS,
  SHAPE_DEFAULT_SIZE,
  shapeChromeClass,
  shapeChromeStyle,
} from '@/components/nodes/shape-node';
import { CloudShape } from '@/components/nodes/shapes/cloud';
import { DatabaseShape } from '@/components/nodes/shapes/database';
import { QueueShape } from '@/components/nodes/shapes/queue';
import { ServerShape } from '@/components/nodes/shapes/server';
import { UserShape } from '@/components/nodes/shapes/user';
import { COLOR_TOKENS, NODE_DEFAULT_BG_WHITE } from '@/lib/color-tokens';
import { Handle, type NodeProps } from '@xyflow/react';
import * as React from 'react';

// US-009: the drag-create ghost in demo-canvas.tsx (`canvas-draw-ghost`) MUST
// render with the same chrome as the committed node so the preview is
// WYSIWYG. The ghost reuses these helpers verbatim, so any drift between the
// helper output and the committed node would break the contract — these tests
// pin both halves to the documented values.
describe('shape-node chrome helpers', () => {
  describe('shapeChromeClass', () => {
    it('returns the documented Tailwind chrome string for each shape', () => {
      expect(shapeChromeClass('rectangle')).toBe(SHAPE_CLASS.rectangle);
      expect(shapeChromeClass('ellipse')).toBe(SHAPE_CLASS.ellipse);
      expect(shapeChromeClass('sticky')).toBe(SHAPE_CLASS.sticky);
      expect(shapeChromeClass('text')).toBe(SHAPE_CLASS.text);
    });

    it('keeps sticky-specific tilt + shadow in the class so the ghost matches the placed sticky', () => {
      // The ghost is the only consumer outside ShapeNode that reads this
      // class; if a future change removes the tilt the ghost drops it too,
      // and the WYSIWYG promise breaks unless this test is updated.
      expect(SHAPE_CLASS.sticky).toContain('-rotate-1');
      expect(SHAPE_CLASS.sticky).toContain('shadow-md');
    });
  });

  describe('shapeChromeStyle', () => {
    it('rectangle/ellipse default to theme border + NODE_DEFAULT_BG_WHITE background (US-021)', () => {
      // US-021: unset backgroundColor renders NODE_DEFAULT_BG_WHITE (dark card
      // surface) on rectangle + ellipse. Text + sticky are special-cased separately below.
      const rect = shapeChromeStyle('rectangle');
      expect(rect.borderColor).toBe(COLOR_TOKENS.default.border);
      expect(rect.backgroundColor).toBe(NODE_DEFAULT_BG_WHITE);
      expect(rect.borderWidth).toBeUndefined();
      expect(rect.borderRadius).toBeUndefined();

      const ellipse = shapeChromeStyle('ellipse');
      expect(ellipse.borderColor).toBe(COLOR_TOKENS.default.border);
      expect(ellipse.backgroundColor).toBe(NODE_DEFAULT_BG_WHITE);
    });

    it('sticky defaults to the amber palette (border + background) so the ghost previews yellow, not primary', () => {
      const sticky = shapeChromeStyle('sticky');
      expect(sticky.borderColor).toBe(COLOR_TOKENS.default.border);
      expect(sticky.backgroundColor).toBe(COLOR_TOKENS.amber.background);
    });

    it('text returns an empty style — chromeless on commit', () => {
      // The ghost compensates with a faint dashed outline (added in
      // demo-canvas.tsx); the placed text node still has no chrome.
      expect(shapeChromeStyle('text')).toEqual({});
    });

    it('honours explicit author overrides for color, border size/style, and corner radius', () => {
      const styled = shapeChromeStyle('rectangle', {
        borderColor: 'blue',
        backgroundColor: 'green',
        borderSize: 5,
        borderStyle: 'dashed',
        cornerRadius: 12,
      });
      expect(styled.borderColor).toBe(COLOR_TOKENS.blue.border);
      expect(styled.backgroundColor).toBe(COLOR_TOKENS.green.background);
      expect(styled.borderWidth).toBe(5);
      expect(styled.borderStyle).toBe('dashed');
      expect(styled.borderRadius).toBe(12);
    });

    it('ignores cornerRadius for ellipse (rounded-full owns the shape)', () => {
      const ellipse = shapeChromeStyle('ellipse', { cornerRadius: 20 });
      expect(ellipse.borderRadius).toBeUndefined();
    });

    it('ignores cornerRadius for text (no border to round)', () => {
      const text = shapeChromeStyle('text', { cornerRadius: 8 });
      expect(text).toEqual({});
    });

    // US-021: render-time dark card surface fallback for in-scope shape variants.
    // Sticky and text are special-cased (sticky → amber, text → chromeless).
    describe('US-021 default node background', () => {
      it('rectangle with explicit backgroundColor wins over the fallback', () => {
        const rect = shapeChromeStyle('rectangle', { backgroundColor: 'blue' });
        expect(rect.backgroundColor).toBe(COLOR_TOKENS.blue.background);
      });

      it('rectangle with backgroundColor=default keeps theme --card token (explicit wins)', () => {
        const rect = shapeChromeStyle('rectangle', { backgroundColor: 'default' });
        expect(rect.backgroundColor).toBe(COLOR_TOKENS.default.background);
      });

      it('ellipse falls back to NODE_DEFAULT_BG_WHITE when backgroundColor is unset', () => {
        const ellipse = shapeChromeStyle('ellipse');
        expect(ellipse.backgroundColor).toBe(NODE_DEFAULT_BG_WHITE);
      });

      it('sticky keeps amber default — NOT overridden by US-021 fallback', () => {
        const sticky = shapeChromeStyle('sticky');
        expect(sticky.backgroundColor).toBe(COLOR_TOKENS.amber.background);
      });

      it('text returns {} regardless of backgroundColor (chromeless invariant preserved)', () => {
        // US-003 fence: text shapes never render a fill, even if the field is
        // explicitly set on disk (which the property panel doesn't allow).
        expect(shapeChromeStyle('text', { backgroundColor: 'blue' })).toEqual({});
        expect(shapeChromeStyle('text')).toEqual({});
      });
    });
  });

  // US-009 illustrative shapes: the SVG inside <DatabaseShape> owns the
  // border + fill, so the wrapper chrome (border / bg / corner-radius) must
  // be suppressed — otherwise CSS borders overlap the SVG strokes and the
  // wrapper background occludes the rim disc.
  describe('illustrative shapes (US-009)', () => {
    it('database returns empty Tailwind chrome class', () => {
      expect(shapeChromeClass('database')).toBe('');
      expect(SHAPE_CLASS.database).toBe('');
    });

    it('database returns {} from shapeChromeStyle regardless of author overrides', () => {
      // The SVG owns the visuals; passing color / borderSize / borderStyle
      // through the wrapper would visibly compete with the SVG strokes.
      expect(shapeChromeStyle('database')).toEqual({});
      expect(
        shapeChromeStyle('database', {
          borderColor: 'blue',
          backgroundColor: 'green',
          borderSize: 5,
          borderStyle: 'dashed',
          cornerRadius: 12,
        }),
      ).toEqual({});
    });

    it('SHAPE_DEFAULT_SIZE.database matches the PRD spec (120 x 140)', () => {
      expect(SHAPE_DEFAULT_SIZE.database).toEqual({ width: 120, height: 140 });
    });

    // US-022: server is the second illustrative shape. Same chrome-suppression
    // invariant as database — the SVG owns border + fill, so the wrapper must
    // stay empty/transparent.
    it('server returns empty Tailwind chrome class', () => {
      expect(shapeChromeClass('server')).toBe('');
      expect(SHAPE_CLASS.server).toBe('');
    });

    it('server returns {} from shapeChromeStyle regardless of author overrides', () => {
      expect(shapeChromeStyle('server')).toEqual({});
      expect(
        shapeChromeStyle('server', {
          borderColor: 'blue',
          backgroundColor: 'green',
          borderSize: 5,
          borderStyle: 'dashed',
          cornerRadius: 12,
        }),
      ).toEqual({});
    });

    it('SHAPE_DEFAULT_SIZE.server matches the spec (140 x 120 landscape rack)', () => {
      expect(SHAPE_DEFAULT_SIZE.server).toEqual({ width: 140, height: 120 });
    });

    // US-023: user follows the same chrome-suppression invariant — the SVG
    // owns the silhouette (head + torso) and the wrapper stays transparent.
    it('user returns empty Tailwind chrome class', () => {
      expect(shapeChromeClass('user')).toBe('');
      expect(SHAPE_CLASS.user).toBe('');
    });

    it('user returns {} from shapeChromeStyle regardless of author overrides', () => {
      expect(shapeChromeStyle('user')).toEqual({});
      expect(
        shapeChromeStyle('user', {
          borderColor: 'blue',
          backgroundColor: 'green',
          borderSize: 5,
          borderStyle: 'dashed',
          cornerRadius: 12,
        }),
      ).toEqual({});
    });

    it('SHAPE_DEFAULT_SIZE.user matches the spec (100 x 140 portrait person)', () => {
      expect(SHAPE_DEFAULT_SIZE.user).toEqual({ width: 100, height: 140 });
    });

    // US-024: queue mirrors the chrome-suppression invariant — the capsule +
    // dividers are owned by the SVG, so the wrapper stays empty/transparent.
    it('queue returns empty Tailwind chrome class', () => {
      expect(shapeChromeClass('queue')).toBe('');
      expect(SHAPE_CLASS.queue).toBe('');
    });

    it('queue returns {} from shapeChromeStyle regardless of author overrides', () => {
      expect(shapeChromeStyle('queue')).toEqual({});
      expect(
        shapeChromeStyle('queue', {
          borderColor: 'blue',
          backgroundColor: 'green',
          borderSize: 5,
          borderStyle: 'dashed',
          cornerRadius: 12,
        }),
      ).toEqual({});
    });

    it('SHAPE_DEFAULT_SIZE.queue matches the spec (220 x 80 wide pill)', () => {
      expect(SHAPE_DEFAULT_SIZE.queue).toEqual({ width: 220, height: 80 });
    });

    // US-025: cloud mirrors the chrome-suppression invariant — the puffy
    // outline is owned by the SVG, so the wrapper stays empty/transparent.
    it('cloud returns empty Tailwind chrome class', () => {
      expect(shapeChromeClass('cloud')).toBe('');
      expect(SHAPE_CLASS.cloud).toBe('');
    });

    it('cloud returns {} from shapeChromeStyle regardless of author overrides', () => {
      expect(shapeChromeStyle('cloud')).toEqual({});
      expect(
        shapeChromeStyle('cloud', {
          borderColor: 'blue',
          backgroundColor: 'green',
          borderSize: 5,
          borderStyle: 'dashed',
          cornerRadius: 12,
        }),
      ).toEqual({});
    });

    it('SHAPE_DEFAULT_SIZE.cloud matches the spec (180 x 120 landscape)', () => {
      expect(SHAPE_DEFAULT_SIZE.cloud).toEqual({ width: 180, height: 120 });
    });
  });
});

// US-003: text shapes are chromeless annotations with NO connect handles —
// they can't be wired into the flow. The render-based assertions below mirror
// the hook-shim pattern from icon-node.test.tsx (no DOM, no React Flow
// store): we shim React's internal dispatcher, call the memoized impl as a
// function, and walk the returned tree to assert handle presence/absence and
// inline-edit-on-mount behavior.
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

function callShapeNode(data: Record<string, unknown>, overrides: Partial<NodeProps> = {}): unknown {
  const props = {
    id: 's1',
    type: 'shapeNode',
    data: { name: 'Hello', ...data },
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
  // ShapeNode is memo(ShapeNodeImpl, …) — the inner impl lives at `.type` per
  // React's memo descriptor shape; call it directly so the hook shim drives
  // the rendered tree.
  const impl = (ShapeNode as unknown as { type: (p: NodeProps) => unknown }).type;
  return renderWithHooks(() => impl(props));
}

describe('ShapeNode connect handles', () => {
  it('rectangle shape renders all four <Handle> elements', () => {
    const tree = callShapeNode({ shape: 'rectangle' });
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
  });

  it('ellipse shape renders all four <Handle> elements', () => {
    const tree = callShapeNode({ shape: 'ellipse' });
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
  });

  it('sticky shape renders all four <Handle> elements', () => {
    const tree = callShapeNode({ shape: 'sticky' });
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
  });

  it('text shape renders ZERO <Handle> elements (US-003: chromeless annotation)', () => {
    const tree = callShapeNode({ shape: 'text' });
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(0);
  });

  it('selected text shape still renders ZERO <Handle> elements (no opacity flip path)', () => {
    // The chromed shapes flip handles to opacity:1 on selection. Text has no
    // handles at all, selected or not — pin the invariant so a future refactor
    // that re-introduces a `selected ? <Handle/> : null` branch breaks here.
    const tree = callShapeNode({ shape: 'text' }, { selected: true } as Partial<NodeProps>);
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(0);
  });
});

describe('ShapeNode header/body layout (rectangle + ellipse)', () => {
  // Rectangle and ellipse render a header section (data.name) plus a body
  // section (data.description) when a title is set in the detail panel.
  // Other shapes keep the centered single-label layout.
  it('rectangle with name renders header + body regions', () => {
    const tree = callShapeNode({
      shape: 'rectangle',
      name: 'Order Service',
      description: 'Handles checkout orchestration',
    });
    const headers = findAll(
      tree,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'shape-node-header',
    );
    const bodies = findAll(
      tree,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'shape-node-body',
    );
    expect(headers).toHaveLength(1);
    expect(bodies).toHaveLength(1);
  });

  it('ellipse NEVER renders a header even when a name is set (description-only shape)', () => {
    // The ellipse intentionally drops the Name concept — see DetailPanel,
    // which hides the Name field for ellipses. The on-canvas label is
    // `description`, not `name`.
    const tree = callShapeNode({
      shape: 'ellipse',
      name: 'IgnoredName',
      description: 'In-memory store',
    });
    const headers = findAll(
      tree,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'shape-node-header',
    );
    expect(headers).toHaveLength(0);
  });

  it('ellipse renders description as the centered label', () => {
    const tree = callShapeNode({
      shape: 'ellipse',
      description: 'Hot cache',
    });
    const buttons = findAll(tree, (el) => el.type === 'button');
    const labels = buttons.map((b) =>
      typeof (b.props as { children?: unknown }).children === 'string'
        ? ((b.props as { children: string }).children as string)
        : '',
    );
    expect(labels.some((t) => t === 'Hot cache')).toBe(true);
  });

  it('rectangle WITHOUT a name does NOT render a header (no title set yet)', () => {
    // Override the callShapeNode default name='Hello' with an empty name so we
    // exercise the no-title path the user hits right after drawing a shape.
    const tree = callShapeNode({ shape: 'rectangle', name: '' });
    const headers = findAll(
      tree,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'shape-node-header',
    );
    expect(headers).toHaveLength(0);
  });

  it('rectangle WITHOUT a name renders description as the centered label (single-label parity with ellipse/sticky)', () => {
    // Bug regression: the untitled rectangle used to render `data.name` as
    // its single label AND route dblclick to name edit. Typing into the
    // empty rect would populate the title (because dblclick targeted name),
    // hasName would flip true mid-typing, and the header strip would
    // "suddenly appear" with the typed text. Now the no-title rectangle
    // joins ellipse/sticky: description is the label, dblclick edits
    // description, header only surfaces after Name is set via the detail
    // panel.
    const tree = callShapeNode({
      shape: 'rectangle',
      name: '',
      description: 'Body content',
    });
    const buttons = findAll(tree, (el) => el.type === 'button');
    const labels = buttons.map((b) =>
      typeof (b.props as { children?: unknown }).children === 'string'
        ? ((b.props as { children: string }).children as string)
        : '',
    );
    expect(labels.some((t) => t === 'Body content')).toBe(true);
  });

  it('rectangle WITH name: dblclick on border (target is outer wrapper, not header/body) opens description edit', () => {
    // Bug regression: clicking the 3px border sets e.target to the outer wrapper.
    // closest('[data-testid="shape-node-header"]') and closest('[data-testid="shape-node-body"]')
    // both return null, so the old code fell through to setEditing('name') — opening the title
    // InlineEdit when the user expected to type in the body. This is most visible after a drag
    // (users click near the node edge to re-enter edit mode).
    const setterCalls: unknown[] = [];
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
        const setter = (v: unknown) => setterCalls.push(v);
        return [value, setter as unknown as (v: S | ((prev: S) => S)) => void];
      },
      useCallback: <T,>(fn: T) => fn,
      useMemo: <T,>(fn: () => T) => fn(),
      useRef: <T,>(initial: T) => ({ current: initial }),
      useEffect: () => {},
    };
    let tree: unknown;
    try {
      const impl = (ShapeNode as unknown as { type: (p: NodeProps) => unknown }).type;
      tree = impl({
        id: 's1',
        type: 'shapeNode',
        data: {
          name: 'My Title',
          description: 'My body',
          shape: 'rectangle',
          onNameChange: () => {},
          onDescriptionChange: () => {},
        },
        selected: false,
        isConnectable: true,
        xPos: 0,
        yPos: 0,
        zIndex: 0,
        dragging: false,
        deletable: true,
        draggable: true,
        selectable: true,
      } as unknown as NodeProps);
    } finally {
      internals.ReactCurrentDispatcher.current = prev;
    }
    // Find the outer div's onDoubleClick handler
    const outerDiv = findAll(
      tree,
      (el) => typeof (el.props as { onDoubleClick?: unknown }).onDoubleClick === 'function',
    ).at(0);
    expect(outerDiv).toBeDefined();
    const handler = (outerDiv?.props as { onDoubleClick: (e: unknown) => void }).onDoubleClick;
    // Simulate border click: target has no header/body ancestor (closest always null)
    const borderTarget = { closest: (_: string) => null };
    handler({ target: borderTarget, stopPropagation: () => {} });
    // Must open description edit, not name edit
    expect(setterCalls).toContain('description');
    expect(setterCalls).not.toContain('name');
  });

  it('sticky NEVER renders a header even when a name is set (description-only shape)', () => {
    // Sticky intentionally drops the Name concept — see DetailPanel,
    // which hides the Name field for stickies. The on-canvas label is
    // `description`, not `name`.
    const tree = callShapeNode({
      shape: 'sticky',
      name: 'IgnoredName',
      description: 'Quick note',
    });
    const headers = findAll(
      tree,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'shape-node-header',
    );
    expect(headers).toHaveLength(0);
  });

  it('sticky renders description as the centered label (ignores name)', () => {
    const tree = callShapeNode({
      shape: 'sticky',
      name: 'IgnoredName',
      description: 'Sticky body',
    });
    const buttons = findAll(tree, (el) => el.type === 'button');
    const labels = buttons.map((b) =>
      typeof (b.props as { children?: unknown }).children === 'string'
        ? ((b.props as { children: string }).children as string)
        : '',
    );
    expect(labels.some((t) => t === 'Sticky body')).toBe(true);
    expect(labels.some((t) => t === 'IgnoredName')).toBe(false);
  });

  it('text with name does NOT render a header (chromeless annotation)', () => {
    const tree = callShapeNode({ shape: 'text', name: 'Label' });
    const headers = findAll(
      tree,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'shape-node-header',
    );
    expect(headers).toHaveLength(0);
  });

  it('database with name does NOT switch layouts (illustrative shape keeps SVG visuals)', () => {
    const tree = callShapeNode({ shape: 'database', name: 'Users DB' });
    const headers = findAll(
      tree,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'shape-node-header',
    );
    expect(headers).toHaveLength(0);
  });

  it('server with name does NOT switch layouts (illustrative shape keeps SVG visuals)', () => {
    const tree = callShapeNode({ shape: 'server', name: 'API rack' });
    const headers = findAll(
      tree,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'shape-node-header',
    );
    expect(headers).toHaveLength(0);
  });

  it('user with name does NOT switch layouts (illustrative shape keeps SVG visuals)', () => {
    const tree = callShapeNode({ shape: 'user', name: 'Alice' });
    const headers = findAll(
      tree,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'shape-node-header',
    );
    expect(headers).toHaveLength(0);
  });

  it('queue with name does NOT switch layouts (illustrative shape keeps SVG visuals)', () => {
    const tree = callShapeNode({ shape: 'queue', name: 'orders' });
    const headers = findAll(
      tree,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'shape-node-header',
    );
    expect(headers).toHaveLength(0);
  });

  it('cloud with name does NOT switch layouts (illustrative shape keeps SVG visuals)', () => {
    const tree = callShapeNode({ shape: 'cloud', name: 'AWS' });
    const headers = findAll(
      tree,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'shape-node-header',
    );
    expect(headers).toHaveLength(0);
  });
});

describe('ShapeNode autoEditOnMount (US-003 + US-015)', () => {
  it('text shape with autoEditOnMount mounts directly into InlineEdit (focus claimed on mount)', () => {
    // US-015 already mounts shape nodes directly into label-edit when
    // autoEditOnMount is true; US-003's AC pins this for text specifically so
    // a freshly created text annotation accepts typing immediately. The
    // InlineEdit useEffect calls el.focus() + selectAll on mount (see
    // inline-edit.tsx) — its presence in the tree IS the focus-claim
    // assertion in this hook-shim renderer.
    const tree = callShapeNode({
      shape: 'text',
      autoEditOnMount: true,
      onNameChange: () => {},
    });
    const inlineEdits = findAll(tree, (el) => el.type === InlineEdit);
    expect(inlineEdits).toHaveLength(1);
  });

  it('text shape WITHOUT autoEditOnMount does NOT mount into InlineEdit', () => {
    const tree = callShapeNode({
      shape: 'text',
      onNameChange: () => {},
    });
    const inlineEdits = findAll(tree, (el) => el.type === InlineEdit);
    expect(inlineEdits).toHaveLength(0);
  });
});

// US-009: illustrative shapes own their visual via inline SVG. The renderer
// must surface a <DatabaseShape> in the tree for shape='database' and keep
// resize controls available when selected, just like the existing chromed
// shapes.
describe('ShapeNode database shape (US-009)', () => {
  it('renders <DatabaseShape> in the tree when shape=database', () => {
    const tree = callShapeNode({ shape: 'database' });
    const shapes = findAll(tree, (el) => el.type === DatabaseShape);
    expect(shapes).toHaveLength(1);
  });

  it('database shape still renders four connect handles (US-009: cylinder is wireable)', () => {
    const tree = callShapeNode({ shape: 'database' });
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
  });

  it('renders ResizeControls with visible=true when selected with onResize callback', () => {
    const tree = callShapeNode({ shape: 'database', onResize: () => {} }, {
      selected: true,
    } as Partial<NodeProps>);
    const controls = findAll(tree, (el) => el.type === ResizeControls);
    expect(controls).toHaveLength(1);
    const props = controls[0]?.props as { visible?: boolean } | undefined;
    expect(props?.visible).toBe(true);
  });

  it('renders ResizeControls with visible=false when not selected', () => {
    const tree = callShapeNode({ shape: 'database', onResize: () => {} });
    const controls = findAll(tree, (el) => el.type === ResizeControls);
    const props = controls[0]?.props as { visible?: boolean } | undefined;
    expect(props?.visible).toBe(false);
  });

  it('non-illustrative shapes do NOT render <DatabaseShape> in the tree', () => {
    for (const shape of ['rectangle', 'ellipse', 'sticky', 'text'] as const) {
      const tree = callShapeNode({ shape });
      const shapes = findAll(tree, (el) => el.type === DatabaseShape);
      expect(shapes).toHaveLength(0);
    }
  });
});

// US-022: server mirrors database's wireable-illustrative contract — same
// renderer dispatch through the shapes registry, same four connect handles,
// same resize affordance when selected.
describe('ShapeNode server shape (US-022)', () => {
  it('renders <ServerShape> in the tree when shape=server', () => {
    const tree = callShapeNode({ shape: 'server' });
    const shapes = findAll(tree, (el) => el.type === ServerShape);
    expect(shapes).toHaveLength(1);
  });

  it('server shape still renders four connect handles (wireable like database)', () => {
    const tree = callShapeNode({ shape: 'server' });
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
  });

  it('renders ResizeControls with visible=true when selected with onResize callback', () => {
    const tree = callShapeNode({ shape: 'server', onResize: () => {} }, {
      selected: true,
    } as Partial<NodeProps>);
    const controls = findAll(tree, (el) => el.type === ResizeControls);
    expect(controls).toHaveLength(1);
    const props = controls[0]?.props as { visible?: boolean } | undefined;
    expect(props?.visible).toBe(true);
  });

  it('non-server shapes do NOT render <ServerShape> in the tree', () => {
    for (const shape of ['rectangle', 'ellipse', 'sticky', 'text', 'database'] as const) {
      const tree = callShapeNode({ shape });
      const shapes = findAll(tree, (el) => el.type === ServerShape);
      expect(shapes).toHaveLength(0);
    }
  });
});

// US-025: cloud mirrors the wireable-illustrative contract — same registry-
// driven dispatch, four handles, resize affordance, chrome-suppressed wrapper.
describe('ShapeNode cloud shape (US-025)', () => {
  it('renders <CloudShape> in the tree when shape=cloud', () => {
    const tree = callShapeNode({ shape: 'cloud' });
    const shapes = findAll(tree, (el) => el.type === CloudShape);
    expect(shapes).toHaveLength(1);
  });

  it('cloud shape still renders four connect handles (wireable like database)', () => {
    const tree = callShapeNode({ shape: 'cloud' });
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
  });

  it('renders ResizeControls with visible=true when selected with onResize callback', () => {
    const tree = callShapeNode({ shape: 'cloud', onResize: () => {} }, {
      selected: true,
    } as Partial<NodeProps>);
    const controls = findAll(tree, (el) => el.type === ResizeControls);
    expect(controls).toHaveLength(1);
    const props = controls[0]?.props as { visible?: boolean } | undefined;
    expect(props?.visible).toBe(true);
  });

  it('non-cloud shapes do NOT render <CloudShape> in the tree', () => {
    for (const shape of [
      'rectangle',
      'ellipse',
      'sticky',
      'text',
      'database',
      'server',
      'user',
      'queue',
    ] as const) {
      const tree = callShapeNode({ shape });
      const shapes = findAll(tree, (el) => el.type === CloudShape);
      expect(shapes).toHaveLength(0);
    }
  });
});

// US-025: CloudShape is a pure SVG renderer. Pin the structural invariants
// (svg root, single closed cloud path, viewBox + testid) so a future change
// to the silhouette is intentional and reviewable.
describe('CloudShape (US-025)', () => {
  it('returns an <svg> element with the expected viewBox and testid', () => {
    const el = CloudShape({ width: 180, height: 120 }) as {
      type: string;
      props: Record<string, unknown>;
    };
    expect(el.type).toBe('svg');
    expect(el.props.viewBox).toBe('0 0 180 120');
    expect(el.props['data-testid']).toBe('cloud-shape');
  });

  it('SVG body composition is title + single closed cloud path', () => {
    const el = CloudShape({ width: 180, height: 120 }) as {
      props: { children?: unknown };
    };
    const types = (Array.isArray(el.props.children) ? el.props.children : [el.props.children])
      .filter((c): c is { type: string } => !!c && typeof c === 'object' && 'type' in c)
      .map((c) => c.type);
    expect(types).toEqual(['title', 'path']);
  });
});

// US-024: queue mirrors the wireable-illustrative contract — same registry-
// driven renderer dispatch, same four handles, same resize affordance.
describe('ShapeNode queue shape (US-024)', () => {
  it('renders <QueueShape> in the tree when shape=queue', () => {
    const tree = callShapeNode({ shape: 'queue' });
    const shapes = findAll(tree, (el) => el.type === QueueShape);
    expect(shapes).toHaveLength(1);
  });

  it('queue shape still renders four connect handles (wireable like database)', () => {
    const tree = callShapeNode({ shape: 'queue' });
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
  });

  it('renders ResizeControls with visible=true when selected with onResize callback', () => {
    const tree = callShapeNode({ shape: 'queue', onResize: () => {} }, {
      selected: true,
    } as Partial<NodeProps>);
    const controls = findAll(tree, (el) => el.type === ResizeControls);
    expect(controls).toHaveLength(1);
    const props = controls[0]?.props as { visible?: boolean } | undefined;
    expect(props?.visible).toBe(true);
  });

  it('non-queue shapes do NOT render <QueueShape> in the tree', () => {
    for (const shape of [
      'rectangle',
      'ellipse',
      'sticky',
      'text',
      'database',
      'server',
      'user',
    ] as const) {
      const tree = callShapeNode({ shape });
      const shapes = findAll(tree, (el) => el.type === QueueShape);
      expect(shapes).toHaveLength(0);
    }
  });
});

// US-024: QueueShape is a pure SVG renderer. Pin the structural invariants
// (svg root, capsule rect + 3 vertical dividers, viewBox + testid) so a
// future geometry change is intentional and reviewable.
describe('QueueShape (US-024)', () => {
  it('returns an <svg> element with the expected viewBox and testid', () => {
    const el = QueueShape({ width: 220, height: 80 }) as {
      type: string;
      props: Record<string, unknown>;
    };
    expect(el.type).toBe('svg');
    expect(el.props.viewBox).toBe('0 0 220 80');
    expect(el.props['data-testid']).toBe('queue-shape');
  });

  it('SVG body composition is title + capsule rect + three dividers', () => {
    const el = QueueShape({ width: 220, height: 80 }) as {
      props: { children?: unknown };
    };
    const types = (Array.isArray(el.props.children) ? el.props.children : [el.props.children])
      .filter((c): c is { type: string } => !!c && typeof c === 'object' && 'type' in c)
      .map((c) => c.type);
    expect(types).toEqual(['title', 'rect', 'line', 'line', 'line']);
  });
});

// US-023: user mirrors the wireable-illustrative contract. Same renderer
// dispatch through the shapes registry, same four connect handles, same
// resize affordance when selected — verified parallel to ServerShape.
describe('ShapeNode user shape (US-023)', () => {
  it('renders <UserShape> in the tree when shape=user', () => {
    const tree = callShapeNode({ shape: 'user' });
    const shapes = findAll(tree, (el) => el.type === UserShape);
    expect(shapes).toHaveLength(1);
  });

  it('user shape still renders four connect handles (wireable like database)', () => {
    const tree = callShapeNode({ shape: 'user' });
    const handles = findAll(tree, (el) => el.type === Handle);
    expect(handles).toHaveLength(4);
  });

  it('renders ResizeControls with visible=true when selected with onResize callback', () => {
    const tree = callShapeNode({ shape: 'user', onResize: () => {} }, {
      selected: true,
    } as Partial<NodeProps>);
    const controls = findAll(tree, (el) => el.type === ResizeControls);
    expect(controls).toHaveLength(1);
    const props = controls[0]?.props as { visible?: boolean } | undefined;
    expect(props?.visible).toBe(true);
  });

  it('non-user shapes do NOT render <UserShape> in the tree', () => {
    for (const shape of ['rectangle', 'ellipse', 'sticky', 'text', 'database', 'server'] as const) {
      const tree = callShapeNode({ shape });
      const shapes = findAll(tree, (el) => el.type === UserShape);
      expect(shapes).toHaveLength(0);
    }
  });
});

// US-023: UserShape is a pure SVG renderer. Pin the structural invariants
// (svg root, head circle + torso path, viewBox + testid) so a future change
// to the person silhouette is intentional and reviewable.
describe('UserShape (US-023)', () => {
  it('returns an <svg> element with the expected viewBox and testid', () => {
    const el = UserShape({ width: 100, height: 140 }) as {
      type: string;
      props: Record<string, unknown>;
    };
    expect(el.type).toBe('svg');
    expect(el.props.viewBox).toBe('0 0 100 140');
    expect(el.props['data-testid']).toBe('user-shape');
  });

  it('SVG body composition is title + head circle + torso path', () => {
    const el = UserShape({ width: 100, height: 140 }) as {
      props: { children?: unknown };
    };
    const types = (Array.isArray(el.props.children) ? el.props.children : [el.props.children])
      .filter((c): c is { type: string } => !!c && typeof c === 'object' && 'type' in c)
      .map((c) => c.type);
    expect(types).toEqual(['title', 'circle', 'path']);
  });
});

// US-022: ServerShape is a pure SVG renderer. Pin the structural invariants
// (svg root, outer rect + 2 dividers + 3 LED circles, viewBox + testid) so a
// future change to the rack geometry is intentional and reviewable.
describe('ServerShape (US-022)', () => {
  it('returns an <svg> element with the expected viewBox and testid', () => {
    const el = ServerShape({ width: 140, height: 120 }) as {
      type: string;
      props: Record<string, unknown>;
    };
    expect(el.type).toBe('svg');
    expect(el.props.viewBox).toBe('0 0 140 120');
    expect(el.props['data-testid']).toBe('server-shape');
  });

  it('SVG body composition is title + chassis rect + two dividers + three LEDs', () => {
    const el = ServerShape({ width: 140, height: 120 }) as {
      props: { children?: unknown };
    };
    const types = (Array.isArray(el.props.children) ? el.props.children : [el.props.children])
      .filter((c): c is { type: string } => !!c && typeof c === 'object' && 'type' in c)
      .map((c) => c.type);
    expect(types).toEqual(['title', 'rect', 'line', 'line', 'circle', 'circle', 'circle']);
  });
});

// US-009: the DatabaseShape component is a pure SVG renderer. These tests
// pin the structural invariants — <svg> root, the three documented pieces
// (body rect + top ellipse + bottom arc path), clamp on ellipseRy, and the
// stroke-dasharray mapping for dashed / dotted borderStyles.
describe('DatabaseShape (US-009)', () => {
  it('returns an <svg> element with the expected viewBox', () => {
    const el = DatabaseShape({ width: 120, height: 140 }) as {
      type: string;
      props: Record<string, unknown>;
    };
    expect(el.type).toBe('svg');
    expect(el.props.viewBox).toBe('0 0 120 140');
    expect(el.props['data-testid']).toBe('database-shape');
  });

  it('SVG body composition contains a <rect>, two <line>s, a <path>, and an <ellipse>', () => {
    const el = DatabaseShape({ width: 120, height: 140 }) as {
      props: { children?: unknown };
    };
    const types = (Array.isArray(el.props.children) ? el.props.children : [el.props.children])
      .filter((c): c is { type: string } => !!c && typeof c === 'object' && 'type' in c)
      .map((c) => c.type);
    // a11y <title> first, then body rect + two side lines + bottom arc path + top ellipse rim.
    expect(types).toEqual(['title', 'rect', 'line', 'line', 'path', 'ellipse']);
  });

  it('ellipseRy is clamped to [6, 28]', () => {
    // height * 0.12 = 6 → at floor: stays 6.
    const small = DatabaseShape({ width: 100, height: 50 }) as {
      props: { children: Array<{ type: string; props: Record<string, unknown> }> };
    };
    const smallEllipse = small.props.children.find((c) => c.type === 'ellipse');
    expect(smallEllipse?.props.ry).toBe(6);

    // height * 0.12 = 60 → clamped down to 28.
    const big = DatabaseShape({ width: 100, height: 500 }) as {
      props: { children: Array<{ type: string; props: Record<string, unknown> }> };
    };
    const bigEllipse = big.props.children.find((c) => c.type === 'ellipse');
    expect(bigEllipse?.props.ry).toBe(28);

    // height * 0.12 = 16.8 → in band.
    const mid = DatabaseShape({ width: 100, height: 140 }) as {
      props: { children: Array<{ type: string; props: Record<string, unknown> }> };
    };
    const midEllipse = mid.props.children.find((c) => c.type === 'ellipse');
    expect(midEllipse?.props.ry).toBeCloseTo(16.8);
  });

  it('borderStyle=dashed maps to stroke-dasharray "6 4"', () => {
    const el = DatabaseShape({ width: 120, height: 140, borderStyle: 'dashed' }) as {
      props: { children: Array<{ type: string; props: Record<string, unknown> }> };
    };
    const ellipse = el.props.children.find((c) => c.type === 'ellipse');
    expect(ellipse?.props.strokeDasharray).toBe('6 4');
  });

  it('borderStyle=dotted maps to stroke-dasharray "2 4"', () => {
    const el = DatabaseShape({ width: 120, height: 140, borderStyle: 'dotted' }) as {
      props: { children: Array<{ type: string; props: Record<string, unknown> }> };
    };
    const ellipse = el.props.children.find((c) => c.type === 'ellipse');
    expect(ellipse?.props.strokeDasharray).toBe('2 4');
  });

  it('borderStyle=solid maps to undefined dasharray (no stroke pattern)', () => {
    const el = DatabaseShape({ width: 120, height: 140, borderStyle: 'solid' }) as {
      props: { children: Array<{ type: string; props: Record<string, unknown> }> };
    };
    const ellipse = el.props.children.find((c) => c.type === 'ellipse');
    expect(ellipse?.props.strokeDasharray).toBeUndefined();
  });

  it('uses var() fallbacks when borderColor / backgroundColor props are unset', () => {
    const el = DatabaseShape({ width: 120, height: 140 }) as {
      props: { children: Array<{ type: string; props: Record<string, unknown> }> };
    };
    const ellipse = el.props.children.find((c) => c.type === 'ellipse');
    expect(ellipse?.props.stroke).toBe('var(--seeflow-node-border)');
    expect(ellipse?.props.fill).toBe('var(--seeflow-node-bg)');
  });

  it('honours explicit stroke/fill props', () => {
    const el = DatabaseShape({
      width: 120,
      height: 140,
      borderColor: '#ff0000',
      backgroundColor: '#00ff00',
      borderSize: 4,
    }) as {
      props: { children: Array<{ type: string; props: Record<string, unknown> }> };
    };
    const ellipse = el.props.children.find((c) => c.type === 'ellipse');
    expect(ellipse?.props.stroke).toBe('#ff0000');
    expect(ellipse?.props.fill).toBe('#00ff00');
    expect(ellipse?.props.strokeWidth).toBe(4);
  });
});
