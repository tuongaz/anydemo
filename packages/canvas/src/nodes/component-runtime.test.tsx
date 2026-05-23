import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as React from 'react';
import { componentRegistry } from '../registry/component-registry.tsx';
import type { ComponentSpec } from '../types.ts';
import { ComponentRuntime } from './component-runtime.tsx';

// Hook-shim renderer that supports useReducer with persistent slots, so a
// dispatch call between renders survives into the next render. Mirrors the
// dispatcher-swap pattern in html-node.test.tsx; adds stateful slot tracking
// because ComponentRuntime's behaviour depends on state mutating across calls.
type ReducerSlot = { kind: 'reducer'; state: unknown };
type StateSlot = { kind: 'state'; value: unknown };
type Slot = ReducerSlot | StateSlot;

const slots: Slot[] = [];
let cursor = 0;

function clearSlots(): void {
  slots.length = 0;
  cursor = 0;
}

function getReducerSlot<S, A>(reducer: (s: S, a: A) => S, init: S): readonly [S, (a: A) => void] {
  const i = cursor++;
  const existing = slots[i];
  let slot: ReducerSlot;
  if (existing && existing.kind === 'reducer') {
    slot = existing;
  } else {
    slot = { kind: 'reducer', state: init };
    slots[i] = slot;
  }
  const dispatch = (action: A): void => {
    slot.state = reducer(slot.state as S, action);
  };
  return [slot.state as S, dispatch] as const;
}

type Hooks = {
  useReducer: <S, A>(
    reducer: (s: S, a: A) => S,
    init: S,
    initFn?: (i: S) => S,
  ) => [S, (a: A) => void];
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
  cursor = 0;
  internals.ReactCurrentDispatcher.current = {
    useReducer: <S, A>(reducer: (s: S, a: A) => S, init: S, initFn?: (i: S) => S) => {
      const seed = initFn ? initFn(init) : init;
      return [...getReducerSlot(reducer, seed)] as [S, (a: A) => void];
    },
    useState: <S,>(initial: S | (() => S)) => {
      const i = cursor++;
      const existing = slots[i];
      let slot: StateSlot;
      if (existing && existing.kind === 'state') {
        slot = existing;
      } else {
        const value = typeof initial === 'function' ? (initial as () => S)() : initial;
        slot = { kind: 'state', value };
        slots[i] = slot;
      }
      const setter = (next: S | ((prev: S) => S)): void => {
        slot.value = typeof next === 'function' ? (next as (prev: S) => S)(slot.value as S) : next;
      };
      return [slot.value as S, setter] as [S, (next: S | ((prev: S) => S)) => void];
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

function renderRuntime(spec: ComponentSpec, nodeId = 'n1'): unknown {
  const impl = ComponentRuntime as unknown as (props: {
    spec: ComponentSpec;
    nodeId: string;
  }) => unknown;
  return renderWithHooks(() => impl({ spec, nodeId }));
}

function findComponent(tree: unknown, name: string): ReactElementLike | null {
  const Impl = componentRegistry.components[name];
  if (!Impl) return null;
  return findElement(tree, (el) => el.type === Impl);
}

describe('ComponentRuntime', () => {
  beforeEach(() => clearSlots());
  afterEach(() => clearSlots());

  it('renders initial state into resolved props ({ $state } ref)', () => {
    const spec: ComponentSpec = {
      root: 'btn',
      state: { '/count': 0 },
      actions: {
        inc: { kind: 'set', path: '/count', value: { $param: 'next' } },
      },
      elements: {
        btn: {
          type: 'Button',
          props: { label: { $state: '/count' }, onClick: { $action: 'inc' } },
        },
      },
    };

    const tree = renderRuntime(spec);
    const btn = findComponent(tree, 'Button');
    if (!btn) throw new Error('Button impl not rendered');
    expect(btn.props.label).toBe(0);
    expect(typeof btn.props.onClick).toBe('function');
  });

  it('resolves { $action } into a callable that dispatches by name', () => {
    const spec: ComponentSpec = {
      root: 'btn',
      state: { '/count': 0 },
      actions: {
        inc: { kind: 'set', path: '/count', value: { $param: 'next' } },
      },
      elements: {
        btn: {
          type: 'Button',
          props: { label: { $state: '/count' }, onClick: { $action: 'inc' } },
        },
      },
    };

    const tree = renderRuntime(spec);
    const btn = findComponent(tree, 'Button');
    if (!btn) throw new Error('Button impl not rendered');
    const onClick = btn.props.onClick as (payload?: unknown) => unknown;
    expect(onClick).toBeInstanceOf(Function);
  });

  it('dispatches a set action that mutates state and re-renders new resolved props', () => {
    const spec: ComponentSpec = {
      root: 'btn',
      state: { '/count': 0 },
      actions: {
        inc: { kind: 'set', path: '/count', value: { $param: 'next' } },
      },
      elements: {
        btn: {
          type: 'Button',
          props: { label: { $state: '/count' }, onClick: { $action: 'inc' } },
        },
      },
    };

    const tree1 = renderRuntime(spec);
    const btn1 = findComponent(tree1, 'Button');
    if (!btn1) throw new Error('Button impl not rendered');
    expect(btn1.props.label).toBe(0);

    const onClick = btn1.props.onClick as (payload?: unknown) => unknown;
    onClick({ next: 7 });

    const tree2 = renderRuntime(spec);
    const btn2 = findComponent(tree2, 'Button');
    if (!btn2) throw new Error('Button impl not rendered after dispatch');
    expect(btn2.props.label).toBe(7);
  });

  it('returns null when spec.root references an unknown element id', () => {
    const spec: ComponentSpec = {
      root: 'missing',
      elements: {},
    };
    const tree = renderRuntime(spec);
    expect(tree).toBeNull();
  });

  it('recursively renders children referenced by id', () => {
    const spec: ComponentSpec = {
      root: 'card',
      elements: {
        card: { type: 'Card', children: ['title', 'count'] },
        title: { type: 'Heading', props: { text: 'Stats', level: 2 } },
        count: { type: 'Metric', props: { label: 'Count', value: { $state: '/count' } } },
      },
      state: { '/count': 42 },
    };

    const tree = renderRuntime(spec);
    const card = findComponent(tree, 'Card');
    if (!card) throw new Error('Card not rendered');
    const heading = findComponent(tree, 'Heading');
    const metric = findComponent(tree, 'Metric');
    if (!heading) throw new Error('Heading not rendered');
    if (!metric) throw new Error('Metric not rendered');
    expect(heading.props.text).toBe('Stats');
    expect(metric.props.label).toBe('Count');
    expect(metric.props.value).toBe(42);
  });

  it('resolves { $cond/$then/$else } refs against current state', () => {
    const spec: ComponentSpec = {
      root: 'badge',
      state: { '/active': true },
      elements: {
        badge: {
          type: 'Badge',
          props: {
            label: 'Status',
            variant: {
              $cond: { $state: '/active' },
              $then: 'default',
              $else: 'secondary',
            },
          },
        },
      },
    };

    const tree = renderRuntime(spec);
    const badge = findComponent(tree, 'Badge');
    if (!badge) throw new Error('Badge not rendered');
    expect(badge.props.variant).toBe('default');
  });
});
