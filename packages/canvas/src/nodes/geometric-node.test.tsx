import { describe, expect, it } from 'bun:test';
import type { NodeProps } from '@xyflow/react';
import * as React from 'react';
import {
  GeometricNode,
  type GeometricNodeFlowNode,
  SKIRT_HEIGHT,
  isIllustrativeShape,
} from './geometric-node.tsx';
import { StatusBadge } from './status-badge.tsx';
import { StatusIconPill } from './status-icon-pill.tsx';

// React-internal-dispatcher shim — same pattern as icon-node.test.tsx +
// rectangle-node.test.tsx. Lets us render GeometricNode in a non-React-Flow
// host without tripping `<Handle>`'s zustand dependency.
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

// The shim doesn't execute component bodies, so JSX inside a function
// component (like `<PlayButton data-testid="play-button" />`) is invisible
// to findAll. Locate the component element itself by its function `.name`,
// the same pattern rectangle-node.test.tsx uses.
function findByComponentName(tree: unknown, name: string): ReactElementLike[] {
  return findAll(tree, (el) => {
    const t = el.type as { name?: string } | { type?: { name?: string } } | unknown;
    if (typeof t === 'function' && (t as { name?: string }).name === name) return true;
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

function callGeometric(
  type:
    | 'rectangle'
    | 'ellipse'
    | 'sticky'
    | 'text'
    | 'database'
    | 'server'
    | 'user'
    | 'queue'
    | 'cloud',
  data: Record<string, unknown>,
  overrides: Partial<NodeProps<GeometricNodeFlowNode>> = {},
): unknown {
  const props = {
    id: 'n1',
    type,
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
  } as unknown as NodeProps<GeometricNodeFlowNode>;
  const impl = (
    GeometricNode as unknown as { type: (p: NodeProps<GeometricNodeFlowNode>) => unknown }
  ).type;
  return renderWithHooks(() => impl(props));
}

// SKIRT_HEIGHT + isIllustrativeShape are the load-bearing constants for the
// capability-chrome skirt. SKIRT_HEIGHT pins the bottom row size; the
// predicate gates which shapes opt into the skirt (database / server /
// queue / cloud / user). Future changes — moving the skirt to ellipse,
// resizing it, etc. — must surface here first.
describe('capability-chrome skirt derivation', () => {
  it('exposes SKIRT_HEIGHT = 32 (matches the design spec)', () => {
    expect(SKIRT_HEIGHT).toBe(32);
  });

  it('isIllustrativeShape returns true for the 5 illustrative tags', () => {
    expect(isIllustrativeShape('database')).toBe(true);
    expect(isIllustrativeShape('server')).toBe(true);
    expect(isIllustrativeShape('queue')).toBe(true);
    expect(isIllustrativeShape('cloud')).toBe(true);
    expect(isIllustrativeShape('user')).toBe(true);
  });

  it('isIllustrativeShape returns false for rectangle / ellipse / sticky / text', () => {
    expect(isIllustrativeShape('rectangle')).toBe(false);
    expect(isIllustrativeShape('ellipse')).toBe(false);
    expect(isIllustrativeShape('sticky')).toBe(false);
    expect(isIllustrativeShape('text')).toBe(false);
  });
});

// US-009 (narrowed): GeometricNode still draws NO capability chrome on
// ellipse / sticky / text — those shapes are deferred from the
// capability-chrome-illustrative-shapes design (curved / borderless
// geometries need a separate placement decision). The 5 illustrative
// shapes (database / server / queue / cloud / user) opted IN and are
// covered by the chrome-matrix block below.
describe('US-009 (narrowed): GeometricNode draws NO chrome on ellipse / sticky / text', () => {
  const CHROMELESS_GEOMETRIC = ['ellipse', 'sticky', 'text'] as const;

  const playAction = {
    kind: 'script' as const,
    interpreter: 'bun',
    scriptPath: 'scripts/play.ts',
  };
  const statusAction = {
    kind: 'script' as const,
    interpreter: 'bun',
    scriptPath: 'scripts/status.ts',
  };
  const statusReport = { state: 'ok' as const, summary: 'all good', ts: 1 };

  for (const type of CHROMELESS_GEOMETRIC) {
    it(`${type} with playAction draws no play-button testid`, () => {
      const tree = callGeometric(type, {
        name: type,
        onPlay: () => {},
        playAction,
      });
      const playButtons = findAll(
        tree,
        (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'play-button',
      );
      expect(playButtons).toHaveLength(0);
    });

    it(`${type} with statusAction + statusReport draws no StatusBadge / StatusIconPill`, () => {
      const tree = callGeometric(type, {
        name: type,
        statusAction,
        statusReport,
      });
      const badges = findAll(tree, (el) => el.type === StatusBadge);
      const pills = findAll(tree, (el) => el.type === StatusIconPill);
      expect(badges).toHaveLength(0);
      expect(pills).toHaveLength(0);
    });

    it(`${type} with playAction + statusAction draws no geometric-node-skirt`, () => {
      const tree = callGeometric(type, {
        name: type,
        onPlay: () => {},
        playAction,
        statusAction,
        statusReport,
      });
      const matches = findAll(
        tree,
        (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'geometric-node-skirt',
      );
      expect(matches).toHaveLength(0);
    });
  }

  it('emits data-node-type matching the variant (e.g. database)', () => {
    const tree = callGeometric('database', { name: 'db' });
    const matches = findAll(
      tree,
      (el) => (el.props as { 'data-node-type'?: string })['data-node-type'] === 'database',
    );
    expect(matches).toHaveLength(1);
  });
});

// Capability-chrome skirt for illustrative shapes (database / server /
// queue / cloud / user). The skirt is a 32px-high horizontal flex row
// pinned to the bottom of the wrapper, rendered only when at least one
// capability is present. The illustrative SVG shortens by SKIRT_HEIGHT so
// the wrapper bounding box (and the bottom Handle's Y) stay invariant.
describe('capability-chrome skirt rendering on illustrative shapes', () => {
  const playAction = {
    kind: 'script' as const,
    interpreter: 'bun',
    scriptPath: 'scripts/play.ts',
  };
  const statusReport = { state: 'ok' as const, summary: 'all good', ts: 1 };

  const findSkirts = (tree: unknown) =>
    findAll(
      tree,
      (el) => (el.props as { 'data-testid'?: string })['data-testid'] === 'geometric-node-skirt',
    );
  // The shim doesn't recurse into the PlayButton body — locate the component
  // element by name (the same pattern rectangle-node.test.tsx uses).
  const findPlayButtons = (tree: unknown) => findByComponentName(tree, 'PlayButton');
  const findBadges = (tree: unknown) => findAll(tree, (el) => el.type === StatusBadge);
  // The SVG renderer is the only element in the tree that receives both a
  // numeric `width` AND a numeric `height` prop, so this matches it
  // regardless of which illustrative shape is mounted.
  const findRenderers = (tree: unknown) =>
    findAll(
      tree,
      (el) =>
        typeof (el.props as { height?: unknown }).height === 'number' &&
        typeof (el.props as { width?: unknown }).width === 'number',
    );

  it('database with no capabilities renders no skirt + full-height SVG', () => {
    const tree = callGeometric('database', { name: 'db', width: 120, height: 140 });
    expect(findSkirts(tree)).toHaveLength(0);
    const renderers = findRenderers(tree);
    expect(renderers).toHaveLength(1);
    const first = renderers[0]!;
    expect((first.props as { height: number }).height).toBe(140);
  });

  it('database with playAction renders skirt + PlayButton, no StatusBadge', () => {
    const tree = callGeometric('database', {
      name: 'db',
      onPlay: () => {},
      playAction,
    });
    expect(findSkirts(tree)).toHaveLength(1);
    expect(findPlayButtons(tree)).toHaveLength(1);
    expect(findBadges(tree)).toHaveLength(0);
  });

  it('database with playAction shrinks the SVG height by SKIRT_HEIGHT', () => {
    const tree = callGeometric('database', {
      name: 'db',
      width: 120,
      height: 140,
      onPlay: () => {},
      playAction,
    });
    const renderers = findRenderers(tree);
    expect(renderers).toHaveLength(1);
    const first = renderers[0]!;
    expect((first.props as { height: number }).height).toBe(140 - SKIRT_HEIGHT);
  });

  it('database with statusReport renders skirt + StatusBadge, no PlayButton', () => {
    const tree = callGeometric('database', { name: 'db', statusReport });
    expect(findSkirts(tree)).toHaveLength(1);
    expect(findBadges(tree)).toHaveLength(1);
    expect(findPlayButtons(tree)).toHaveLength(0);
  });

  it('database with playAction + statusReport renders both', () => {
    const tree = callGeometric('database', {
      name: 'db',
      onPlay: () => {},
      playAction,
      statusReport,
    });
    expect(findSkirts(tree)).toHaveLength(1);
    expect(findBadges(tree)).toHaveLength(1);
    expect(findPlayButtons(tree)).toHaveLength(1);
  });

  for (const shape of ['server', 'queue', 'cloud', 'user'] as const) {
    it(`${shape} with playAction + statusReport renders the same skirt structure`, () => {
      const tree = callGeometric(shape, {
        name: shape,
        onPlay: () => {},
        playAction,
        statusReport,
      });
      expect(findSkirts(tree)).toHaveLength(1);
      expect(findBadges(tree)).toHaveLength(1);
      expect(findPlayButtons(tree)).toHaveLength(1);
    });
  }

  it('clicking the skirt PlayButton calls data.onPlay with the node id', () => {
    const calls: string[] = [];
    const onPlay = (id: string) => calls.push(id);
    const tree = callGeometric('database', { name: 'db', onPlay, playAction });
    const buttons = findPlayButtons(tree);
    expect(buttons).toHaveLength(1);
    type ClickHandler = (e: { stopPropagation: () => void }) => void;
    const onClick = (buttons[0]!.props as { onClick: ClickHandler }).onClick;
    onClick({ stopPropagation: () => {} });
    expect(calls).toEqual(['n1']);
  });

  it('PlayButton receives error visual status + summary in its buttonLabel when statusReport.state === error', () => {
    const tree = callGeometric('database', {
      name: 'db',
      onPlay: () => {},
      playAction,
      statusReport: { state: 'error' as const, summary: 'boom', ts: 2 },
    });
    const buttons = findPlayButtons(tree);
    expect(buttons).toHaveLength(1);
    // GeometricNode passes visualStatus + buttonLabel as props into PlayButton.
    // The component itself maps them to data-visual-status + title; we assert
    // the inputs here since the shim doesn't recurse into PlayButton's body.
    const props = buttons[0]!.props as { visualStatus: string; buttonLabel: string };
    expect(props.visualStatus).toBe('error');
    expect(props.buttonLabel.toLowerCase()).toContain('boom');
  });
});

// Edge-case from the design doc: when the skirt is active, the user must not
// be able to resize the node so small that the 32px skirt crowds the SVG.
// Bump ResizeControls.minHeight to SKIRT_HEIGHT + 40 only when the skirt
// renders; default 40 otherwise.
describe('capability-chrome skirt: resize min-height', () => {
  const playAction = {
    kind: 'script' as const,
    interpreter: 'bun',
    scriptPath: 'scripts/play.ts',
  };

  const findResizeControls = (tree: unknown) => findByComponentName(tree, 'ResizeControls');

  it('database with no capabilities passes default minHeight 40 to ResizeControls', () => {
    const tree = callGeometric('database', { name: 'db', onResize: () => {} });
    const ctrls = findResizeControls(tree);
    expect(ctrls).toHaveLength(1);
    expect((ctrls[0]!.props as { minHeight: number }).minHeight).toBe(40);
  });

  it('database with playAction passes minHeight = SKIRT_HEIGHT + 40 to ResizeControls', () => {
    const tree = callGeometric('database', {
      name: 'db',
      onResize: () => {},
      onPlay: () => {},
      playAction,
    });
    const ctrls = findResizeControls(tree);
    expect(ctrls).toHaveLength(1);
    expect((ctrls[0]!.props as { minHeight: number }).minHeight).toBe(SKIRT_HEIGHT + 40);
  });

  it('ellipse with playAction stays at default minHeight 40 (no skirt)', () => {
    const tree = callGeometric('ellipse', {
      name: 'e',
      onResize: () => {},
      onPlay: () => {},
      playAction,
    });
    const ctrls = findResizeControls(tree);
    expect(ctrls).toHaveLength(1);
    expect((ctrls[0]!.props as { minHeight: number }).minHeight).toBe(40);
  });
});
