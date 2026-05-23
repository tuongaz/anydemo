import { describe, expect, it } from 'bun:test';
import type { NodeProps } from '@xyflow/react';
import * as React from 'react';
import { GeometricNode, type GeometricNodeFlowNode } from './geometric-node.tsx';
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

// US-009: capability-chrome-rectangle-only invariant — second half. The
// 8 non-rectangle geometric tags route through GeometricNode, which parses
// + persists capabilities (per the schema) but draws NO capability chrome.
// This is the Renderer phasing invariant from the flat-node-types design
// doc — fence it with a per-tag snapshot so a future "let's add a status
// pill to databases" tweak surfaces here first.
describe('US-009: GeometricNode draws NO capability chrome', () => {
  const NON_RECTANGLE_GEOMETRIC = [
    'ellipse',
    'sticky',
    'text',
    'database',
    'server',
    'user',
    'queue',
    'cloud',
  ] as const;

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

  for (const type of NON_RECTANGLE_GEOMETRIC) {
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

    it(`${type} with playAction + statusAction draws no rectangle-node-status-badge testid`, () => {
      const tree = callGeometric(type, {
        name: type,
        onPlay: () => {},
        playAction,
        statusAction,
        statusReport,
      });
      const matches = findAll(
        tree,
        (el) =>
          (el.props as { 'data-testid'?: string })['data-testid'] === 'rectangle-node-status-badge',
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
