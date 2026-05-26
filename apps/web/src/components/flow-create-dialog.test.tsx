import { describe, expect, it } from 'bun:test';
import { FlowCreateDialog, type FlowCreateDialogProps } from '@/components/flow-create-dialog';
import type { CreateFlowBody, MutateFlowResult } from '@/lib/api';
import * as React from 'react';

// apps/web component-test pattern: shim React's hook dispatcher so we can call
// FlowCreateDialog as a function and walk its tree (no DOM, no test renderer).
// Mirrors flow-switcher.test.tsx; see CLAUDE.md "Hook-shim tests" notes.
//
// `stateOverrides` indexes into the component's useState calls in DECLARATION
// order. FlowCreateDialog (in source order):
//   0: name
//   1: id
//   2: idDirty
//   3: error
//   4: submitting
//
// `stateSetters` lets a test capture the (slot, value) of every setState call
// invoked during render — needed because the default no-op setter loses the
// observation of e.g. setIdDirty(true).
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: () => void;
};

type SetterCall = { slot: number; value: unknown };

function renderWithHooks<T>(
  fn: () => T,
  stateOverrides: readonly unknown[] = [],
  setterCalls: SetterCall[] = [],
): T {
  const internals = (
    React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: Hooks | null };
      };
    }
  ).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const prev = internals.ReactCurrentDispatcher.current;
  let useStateCall = 0;
  internals.ReactCurrentDispatcher.current = {
    useState: <S,>(initial: S | (() => S)) => {
      const idx = useStateCall++;
      const seeded =
        idx < stateOverrides.length && stateOverrides[idx] !== undefined
          ? (stateOverrides[idx] as S)
          : typeof initial === 'function'
            ? (initial as () => S)()
            : initial;
      const setter = (next: S | ((prev: S) => S)) => {
        const resolved = typeof next === 'function' ? (next as (p: S) => S)(seeded) : (next as S);
        setterCalls.push({ slot: idx, value: resolved });
      };
      return [seeded, setter];
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

function findAll(
  tree: unknown,
  predicate: (el: ReactElementLike) => boolean,
  acc: ReactElementLike[] = [],
): ReactElementLike[] {
  if (Array.isArray(tree)) {
    for (const child of tree) findAll(child, predicate, acc);
    return acc;
  }
  if (!isElement(tree)) return acc;
  if (predicate(tree)) acc.push(tree);
  const children = tree.props.children;
  if (children === undefined || children === null) return acc;
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) findAll(child, predicate, acc);
  return acc;
}

function findByTestId(tree: unknown, id: string): ReactElementLike | null {
  const matches = findAll(
    tree,
    (el) => (el.props as { 'data-testid'?: string })['data-testid'] === id,
  );
  return matches[0] ?? null;
}

function defaultOnCreate(): Promise<MutateFlowResult> {
  return Promise.resolve({
    id: 'r-1',
    projectSlug: 'order-pipeline',
    flowSlug: 'edge-cases',
    name: 'Edge Cases',
    isDefault: false,
  });
}

function renderDialog(
  props: Partial<FlowCreateDialogProps> = {},
  stateOverrides: readonly unknown[] = [],
  setterCalls: SetterCall[] = [],
): unknown {
  const merged: FlowCreateDialogProps = {
    open: true,
    onOpenChange: () => {},
    onCreate: defaultOnCreate,
    ...props,
  };
  return renderWithHooks(
    () => (FlowCreateDialog as unknown as (p: FlowCreateDialogProps) => unknown)(merged),
    stateOverrides,
    setterCalls,
  );
}

describe('FlowCreateDialog', () => {
  it('renders the display name input BEFORE the flow id input', () => {
    const tree = renderDialog();
    // Collect both inputs in DOM order by walking the tree.
    const inputs = findAll(tree, (el) => {
      const id = (el.props as { 'data-testid'?: string })['data-testid'];
      return id === 'flow-create-name-input' || id === 'flow-create-id-input';
    });
    expect(inputs.length).toBe(2);
    expect((inputs[0]?.props as { 'data-testid': string })['data-testid']).toBe(
      'flow-create-name-input',
    );
    expect((inputs[1]?.props as { 'data-testid': string })['data-testid']).toBe(
      'flow-create-id-input',
    );
  });

  it('does NOT render an icon input (icon field removed in US-038)', () => {
    const tree = renderDialog();
    const iconInput = findByTestId(tree, 'flow-create-icon-input');
    expect(iconInput).toBeNull();
  });

  it('auto-derives the id when the display name changes and idDirty is false', () => {
    const setterCalls: SetterCall[] = [];
    // State: name='', id='', idDirty=false, error=null, submitting=false
    const tree = renderDialog({}, [], setterCalls);
    const nameInput = findByTestId(tree, 'flow-create-name-input');
    if (!nameInput) throw new Error('name input missing');
    const onChange = (nameInput.props as { onChange?: (e: { target: { value: string } }) => void })
      .onChange;
    if (!onChange) throw new Error('name onChange missing');

    setterCalls.length = 0;
    onChange({ target: { value: 'My Retry Flow' } });

    // Slot 0 = name, Slot 1 = id. handleNameChange calls setName(next) then setId(slugify(next)).
    const nameCalls = setterCalls.filter((c) => c.slot === 0);
    const idCalls = setterCalls.filter((c) => c.slot === 1);
    expect(nameCalls.length).toBe(1);
    expect(nameCalls[0]?.value).toBe('My Retry Flow');
    expect(idCalls.length).toBe(1);
    expect(idCalls[0]?.value).toBe('my-retry-flow');
  });

  it('stops auto-deriving once the user manually edits the id (idDirty sticks)', () => {
    const setterCalls: SetterCall[] = [];
    // State: name='Retry', id='retry-custom', idDirty=TRUE (slot 2)
    const tree = renderDialog({}, ['Retry', 'retry-custom', true], setterCalls);
    const nameInput = findByTestId(tree, 'flow-create-name-input');
    if (!nameInput) throw new Error('name input missing');
    const onChange = (nameInput.props as { onChange?: (e: { target: { value: string } }) => void })
      .onChange;
    if (!onChange) throw new Error('name onChange missing');

    setterCalls.length = 0;
    onChange({ target: { value: 'Retry-v2' } });

    // setName fires (slot 0); setId (slot 1) MUST NOT fire when idDirty is true.
    const nameCalls = setterCalls.filter((c) => c.slot === 0);
    const idCalls = setterCalls.filter((c) => c.slot === 1);
    expect(nameCalls.length).toBe(1);
    expect(idCalls.length).toBe(0);
  });

  it('flips idDirty=true on the first manual id keystroke', () => {
    const setterCalls: SetterCall[] = [];
    // idDirty starts false.
    const tree = renderDialog({}, ['Retry', 'retry', false], setterCalls);
    const idInput = findByTestId(tree, 'flow-create-id-input');
    if (!idInput) throw new Error('id input missing');
    const onChange = (idInput.props as { onChange?: (e: { target: { value: string } }) => void })
      .onChange;
    if (!onChange) throw new Error('id onChange missing');

    setterCalls.length = 0;
    onChange({ target: { value: 'retry-x' } });

    // Slot 1 = id, Slot 2 = idDirty.
    const idCalls = setterCalls.filter((c) => c.slot === 1);
    const dirtyCalls = setterCalls.filter((c) => c.slot === 2);
    expect(idCalls.length).toBe(1);
    expect(idCalls[0]?.value).toBe('retry-x');
    expect(dirtyCalls.length).toBe(1);
    expect(dirtyCalls[0]?.value).toBe(true);
  });

  it('submits body { id, name } with NO icon key', async () => {
    let captured: CreateFlowBody | null = null;
    const onCreate = async (body: CreateFlowBody) => {
      captured = body;
      return {
        id: 'r-1',
        projectSlug: 'order-pipeline',
        flowSlug: body.id,
        name: body.name,
        isDefault: false,
      } satisfies MutateFlowResult;
    };
    // Seed name + id so canSubmit is true.
    const tree = renderDialog({ onCreate }, ['Edge Cases', 'edge-cases', true]);
    const submit = findAll(tree, (el) => {
      // Find the <form> element by checking for an onSubmit handler.
      const onSubmit = (el.props as { onSubmit?: unknown }).onSubmit;
      return typeof onSubmit === 'function';
    })[0];
    if (!submit) throw new Error('form missing');
    const onSubmit = (
      submit.props as { onSubmit: (e: { preventDefault(): void }) => Promise<void> }
    ).onSubmit;
    await onSubmit({ preventDefault: () => {} });

    if (!captured) throw new Error('onCreate was not invoked');
    const body = captured as CreateFlowBody;
    expect(body.id).toBe('edge-cases');
    expect(body.name).toBe('Edge Cases');
    expect('icon' in body).toBe(false);
  });

  it('surfaces a FlowIdPattern error when the user submits an invalid manual id', async () => {
    const setterCalls: SetterCall[] = [];
    // Seed an invalid id (uppercase) so idValid is false and error path fires.
    const tree = renderDialog({}, ['Retry', 'Retry-X', true, null, false], setterCalls);
    const submit = findAll(tree, (el) => {
      const onSubmit = (el.props as { onSubmit?: unknown }).onSubmit;
      return typeof onSubmit === 'function';
    })[0];
    if (!submit) throw new Error('form missing');
    const onSubmit = (
      submit.props as { onSubmit: (e: { preventDefault(): void }) => Promise<void> }
    ).onSubmit;
    await onSubmit({ preventDefault: () => {} });

    // Slot 3 = error. handleSubmit calls setError(...) when the id is invalid + non-empty.
    const errorCalls = setterCalls.filter((c) => c.slot === 3);
    expect(errorCalls.length).toBe(1);
    expect(typeof errorCalls[0]?.value).toBe('string');
    expect(String(errorCalls[0]?.value)).toContain('[a-z0-9]');
  });

  it('applies fade-only animation style (overrides upstream zoom + slide)', () => {
    const tree = renderDialog();
    const content = findByTestId(tree, 'flow-create-dialog');
    if (!content) throw new Error('dialog content missing');
    const style = (content.props as { style?: Record<string, string> }).style;
    expect(style).toBeDefined();
    if (!style) throw new Error('style missing');
    // Centering preserved so the dialog stays put during the opacity fade.
    expect(style['--tw-enter-translate-x']).toBe('-50%');
    expect(style['--tw-enter-translate-y']).toBe('-50%');
    expect(style['--tw-exit-translate-x']).toBe('-50%');
    expect(style['--tw-exit-translate-y']).toBe('-50%');
    // Zoom neutralized (1 instead of upstream 0.95).
    expect(style['--tw-enter-scale']).toBe('1');
    expect(style['--tw-exit-scale']).toBe('1');
  });
});
