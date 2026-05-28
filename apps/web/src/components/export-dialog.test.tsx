import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as React from 'react';

// Module mocks must be installed before the component is imported. We stub
// the two hooks the dialog calls so the hook-shim render tree only walks
// ExportDialog's own useState calls.

let projectFlowsResult: {
  flows: Array<{ flowSlug: string; name: string; icon?: string; isDefault: boolean }> | null;
  loading: boolean;
  error: string | null;
} = { flows: null, loading: false, error: null };

let refreshCalls = 0;

mock.module('@/hooks/use-project-flows', () => ({
  useProjectFlows: () => ({
    ...projectFlowsResult,
    refresh: () => {
      refreshCalls++;
    },
    createFlow: () => Promise.reject(new Error('not implemented in test')),
    renameFlow: () => Promise.reject(new Error('not implemented in test')),
    deleteFlow: () => Promise.reject(new Error('not implemented in test')),
  }),
}));

const cloudCalls: Array<{
  email: string;
  name: string;
  visibility: string;
  preview: string | undefined;
  selectedFlowSlugs: string[] | undefined;
}> = [];

// `mock.module` is process-global in bun:test, so include the rest of the
// module's named exports (used by use-export-to-cloud.test.ts).
const realModule = await import('@/hooks/use-export-to-cloud');
mock.module('@/hooks/use-export-to-cloud', () => ({
  ...realModule,
  useExportToCloud:
    () =>
    (
      email: string,
      name: string,
      visibility: string,
      preview: string | undefined,
      selectedFlowSlugs?: string[],
    ) => {
      cloudCalls.push({ email, name, visibility, preview, selectedFlowSlugs });
      return Promise.resolve({ shareUrl: 'https://seeflow.dev/project/test' });
    },
}));

// Import AFTER mocks are installed.
const { ExportDialog } = await import('@/components/export-dialog');
type ExportDialogProps = Parameters<typeof ExportDialog>[0];

// Hook-shim test pattern — same as flow-create-dialog.test.tsx. Bypass DOM by
// installing a synchronous dispatcher so we can render the component as a
// function and walk the returned React tree directly.
type SetterCall = { slot: number; value: unknown };

type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: () => void;
};

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
  return (
    findAll(tree, (el) => (el.props as { 'data-testid'?: string })['data-testid'] === id)[0] ?? null
  );
}

function defaultProps(): ExportDialogProps {
  return {
    open: true,
    onOpenChange: () => {},
    project: 'demo',
  };
}

function render(
  stateOverrides: readonly unknown[] = [],
  setterCalls: SetterCall[] = [],
  propsOverrides: Partial<ExportDialogProps> = {},
): unknown {
  return renderWithHooks(
    () =>
      (ExportDialog as unknown as (p: ExportDialogProps) => unknown)({
        ...defaultProps(),
        ...propsOverrides,
      }),
    stateOverrides,
    setterCalls,
  );
}

// State slot index (DECLARATION ORDER inside ExportDialog):
//   0: email
//   1: name
//   2: visibility
//   3: state (idle/loading/done/error)
//   4: copied
//   5: selectedFlows  (Set<string>)
const SLOT_EMAIL = 0;
const SLOT_NAME = 1;
const SLOT_SELECTED_FLOWS = 5;

beforeEach(() => {
  projectFlowsResult = { flows: null, loading: false, error: null };
  cloudCalls.length = 0;
  refreshCalls = 0;
});

afterEach(() => {
  projectFlowsResult = { flows: null, loading: false, error: null };
  cloudCalls.length = 0;
});

describe('ExportDialog — flow picker', () => {
  it('hides the Flows section when the project has a single flow', () => {
    projectFlowsResult = {
      flows: [{ flowSlug: 'main', name: 'Main', isDefault: true }],
      loading: false,
      error: null,
    };
    const tree = render();
    expect(findByTestId(tree, 'export-flows-section')).toBeNull();
  });

  it('renders one checkbox per flow when the project has multiple flows', () => {
    projectFlowsResult = {
      flows: [
        { flowSlug: 'main', name: 'Main', isDefault: true },
        { flowSlug: 'retry', name: 'Retry', isDefault: false },
        { flowSlug: 'audit', name: 'Audit', isDefault: false },
      ],
      loading: false,
      error: null,
    };
    const tree = render([
      'a@b.com', // email
      'Demo', // name
      undefined,
      undefined,
      undefined,
      new Set(['main', 'retry', 'audit']), // selectedFlows
    ]);
    expect(findByTestId(tree, 'export-flows-section')).not.toBeNull();
    expect(findByTestId(tree, 'export-flow-checkbox-main')).not.toBeNull();
    expect(findByTestId(tree, 'export-flow-checkbox-retry')).not.toBeNull();
    expect(findByTestId(tree, 'export-flow-checkbox-audit')).not.toBeNull();
  });

  it('marks the default flow with a star', () => {
    projectFlowsResult = {
      flows: [
        { flowSlug: 'main', name: 'Main', isDefault: true },
        { flowSlug: 'retry', name: 'Retry', isDefault: false },
      ],
      loading: false,
      error: null,
    };
    const tree = render([
      'a@b.com',
      'Demo',
      undefined,
      undefined,
      undefined,
      new Set(['main', 'retry']),
    ]);
    expect(findByTestId(tree, 'export-flow-default-main')).not.toBeNull();
    expect(findByTestId(tree, 'export-flow-default-retry')).toBeNull();
  });

  it('all checkboxes start checked when the dialog opens', () => {
    projectFlowsResult = {
      flows: [
        { flowSlug: 'main', name: 'Main', isDefault: true },
        { flowSlug: 'retry', name: 'Retry', isDefault: false },
      ],
      loading: false,
      error: null,
    };
    const tree = render([
      'a@b.com',
      'Demo',
      undefined,
      undefined,
      undefined,
      new Set(['main', 'retry']),
    ]);
    const mainCheckbox = findByTestId(tree, 'export-flow-checkbox-main');
    const retryCheckbox = findByTestId(tree, 'export-flow-checkbox-retry');
    expect((mainCheckbox?.props as { checked: boolean }).checked).toBe(true);
    expect((retryCheckbox?.props as { checked: boolean }).checked).toBe(true);
  });

  it('toggle-all button reads "Clear" when all are selected and unchecks all on click', () => {
    projectFlowsResult = {
      flows: [
        { flowSlug: 'main', name: 'Main', isDefault: true },
        { flowSlug: 'retry', name: 'Retry', isDefault: false },
      ],
      loading: false,
      error: null,
    };
    const setterCalls: SetterCall[] = [];
    const tree = render(
      ['a@b.com', 'Demo', undefined, undefined, undefined, new Set(['main', 'retry'])],
      setterCalls,
    );
    const toggle = findByTestId(tree, 'export-flows-toggle-all');
    expect(toggle).not.toBeNull();
    const label = (toggle?.props as { children: string }).children;
    expect(label).toBe('Clear');

    setterCalls.length = 0;
    (toggle?.props as { onClick: () => void }).onClick();
    const flowCalls = setterCalls.filter((c) => c.slot === SLOT_SELECTED_FLOWS);
    expect(flowCalls).toHaveLength(1);
    expect((flowCalls[0]?.value as Set<string>).size).toBe(0);
  });

  it('toggle-all button reads "Select all" when nothing is selected and selects everything', () => {
    projectFlowsResult = {
      flows: [
        { flowSlug: 'main', name: 'Main', isDefault: true },
        { flowSlug: 'retry', name: 'Retry', isDefault: false },
      ],
      loading: false,
      error: null,
    };
    const setterCalls: SetterCall[] = [];
    const tree = render(
      ['a@b.com', 'Demo', undefined, undefined, undefined, new Set<string>()],
      setterCalls,
    );
    const toggle = findByTestId(tree, 'export-flows-toggle-all');
    expect((toggle?.props as { children: string }).children).toBe('Select all');

    setterCalls.length = 0;
    (toggle?.props as { onClick: () => void }).onClick();
    const flowCalls = setterCalls.filter((c) => c.slot === SLOT_SELECTED_FLOWS);
    expect(flowCalls).toHaveLength(1);
    expect(Array.from(flowCalls[0]?.value as Set<string>).sort()).toEqual(['main', 'retry']);
  });

  it('clicking a checkbox toggles its slug in the selection', () => {
    projectFlowsResult = {
      flows: [
        { flowSlug: 'main', name: 'Main', isDefault: true },
        { flowSlug: 'retry', name: 'Retry', isDefault: false },
      ],
      loading: false,
      error: null,
    };
    const setterCalls: SetterCall[] = [];
    const tree = render(
      ['a@b.com', 'Demo', undefined, undefined, undefined, new Set(['main', 'retry'])],
      setterCalls,
    );
    const retryCheckbox = findByTestId(tree, 'export-flow-checkbox-retry');
    setterCalls.length = 0;
    (retryCheckbox?.props as { onChange: () => void }).onChange();
    const flowCalls = setterCalls.filter((c) => c.slot === SLOT_SELECTED_FLOWS);
    expect(flowCalls).toHaveLength(1);
    expect(Array.from(flowCalls[0]?.value as Set<string>)).toEqual(['main']);
  });

  it('Export button is disabled when zero flows are selected', () => {
    projectFlowsResult = {
      flows: [
        { flowSlug: 'main', name: 'Main', isDefault: true },
        { flowSlug: 'retry', name: 'Retry', isDefault: false },
      ],
      loading: false,
      error: null,
    };
    const tree = render([
      'a@b.com',
      'Demo',
      undefined,
      undefined,
      undefined,
      new Set<string>(), // none selected
    ]);
    const submit = findByTestId(tree, 'export-submit');
    expect(submit).not.toBeNull();
    expect((submit?.props as { disabled: boolean }).disabled).toBe(true);
  });

  it('Export button is enabled when at least one flow is selected', () => {
    projectFlowsResult = {
      flows: [
        { flowSlug: 'main', name: 'Main', isDefault: true },
        { flowSlug: 'retry', name: 'Retry', isDefault: false },
      ],
      loading: false,
      error: null,
    };
    const tree = render(['a@b.com', 'Demo', undefined, undefined, undefined, new Set(['main'])]);
    const submit = findByTestId(tree, 'export-submit');
    expect((submit?.props as { disabled: boolean }).disabled).toBe(false);
  });

  it('passes the current selection to the cloud call on Export', async () => {
    projectFlowsResult = {
      flows: [
        { flowSlug: 'main', name: 'Main', isDefault: true },
        { flowSlug: 'retry', name: 'Retry', isDefault: false },
      ],
      loading: false,
      error: null,
    };
    const tree = render(['a@b.com', 'Demo', undefined, undefined, undefined, new Set(['retry'])]);
    const submit = findByTestId(tree, 'export-submit');
    await (submit?.props as { onClick: () => Promise<void> }).onClick();
    expect(cloudCalls).toHaveLength(1);
    expect(cloudCalls[0]?.selectedFlowSlugs).toEqual(['retry']);
  });

  it('renders a loading state while the flow list is in-flight', () => {
    projectFlowsResult = { flows: null, loading: true, error: null };
    const tree = render();
    expect(findByTestId(tree, 'export-flows-loading')).not.toBeNull();
    const submit = findByTestId(tree, 'export-submit');
    expect((submit?.props as { disabled: boolean }).disabled).toBe(true);
  });

  it('renders an error state if the flow list fetch fails', () => {
    projectFlowsResult = { flows: null, loading: false, error: 'boom' };
    const tree = render(['a@b.com', 'Demo']);
    expect(findByTestId(tree, 'export-flows-error')).not.toBeNull();
    const submit = findByTestId(tree, 'export-submit');
    expect((submit?.props as { disabled: boolean }).disabled).toBe(true);
  });

  it('re-fetches the flow list when the error-state Retry button is clicked', () => {
    projectFlowsResult = { flows: null, loading: false, error: 'boom' };
    const tree = render(['a@b.com', 'Demo']);
    const retry = findByTestId(tree, 'export-flows-retry');
    expect(retry).not.toBeNull();
    (retry?.props as { onClick: () => void }).onClick();
    expect(refreshCalls).toBe(1);
  });
});
