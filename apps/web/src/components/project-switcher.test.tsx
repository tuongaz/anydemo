import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { ProjectSwitcher, type ProjectSwitcherProps } from '@/components/project-switcher';
import type { ProjectSummary } from '@/lib/api';
import * as React from 'react';

// US-005: the switcher now calls `reset({project, flow})` from
// use-navigate-flow. mock.module() leaks process-globally in bun:test, so we
// don't mock the hook (that would clobber use-navigate-flow.test.ts when both
// run in the same process). Instead we stub globalThis.window so the real
// reset() pushes into our recorder. Same `/projects/<p>/flows/<f>` assertions.
const navigateCalls: string[] = [];
interface FakeWindow {
  history: {
    state: unknown;
    pushState: (state: unknown, _t: string, url: string) => void;
    replaceState: (state: unknown, _t: string, url: string) => void;
    back: () => void;
  };
  location: { pathname: string; search: string; hash: string };
  addEventListener: () => void;
  removeEventListener: () => void;
  dispatchEvent: () => boolean;
}
const fakeWindow: FakeWindow = {
  history: {
    state: { stackDepth: 0 },
    pushState(state, _t, url) {
      this.state = state;
      fakeWindow.location.pathname = url;
      navigateCalls.push(url);
    },
    replaceState(state, _t, url) {
      this.state = state;
      if (url) fakeWindow.location.pathname = url;
    },
    back() {},
  },
  location: { pathname: '/', search: '', hash: '' },
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return true;
  },
};
let originalWindow: unknown;
beforeAll(() => {
  const g = globalThis as { window?: unknown };
  originalWindow = g.window;
  g.window = fakeWindow;
});
afterAll(() => {
  (globalThis as { window?: unknown }).window = originalWindow;
});

const storageStub = new Map<string, string>();
mock.module('@/lib/last-flow', () => ({
  readLastFlow: (project: string): string | null =>
    storageStub.get(`seeflow:last-flow:${project}`) ?? null,
  writeLastFlow: (project: string, flowSlug: string): void => {
    storageStub.set(`seeflow:last-flow:${project}`, flowSlug);
  },
}));

beforeEach(() => {
  navigateCalls.length = 0;
  storageStub.clear();
  // Reset fake history so each test starts from `/` with depth 0.
  fakeWindow.location.pathname = '/';
  fakeWindow.history.state = { stackDepth: 0 };
});

afterEach(() => {
  navigateCalls.length = 0;
  storageStub.clear();
});

// apps/web tests run without a DOM. Shim React's internal hook dispatcher so we
// can call ProjectSwitcher as a function and walk the returned tree directly.
// Same pattern used by flow-switcher.test.tsx + command-palette.test.tsx.
//
// `stateOverrides` lets a test seed useState calls in source order — the
// switcher has six (`open`, `createOpen`, `unregisterTarget`, `unregistering`,
// `unregisterError`, `deleteSource`). Override slot 0 to `true` to surface the
// popover content inline; slot 2 to a ProjectSummary to surface the unregister
// dialog; slot 5 to `true` to render the dialog with deleteSource checked.
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: () => void;
  useContext: (context: unknown) => unknown;
};

function renderWithHooks<T>(fn: () => T, stateOverrides: readonly unknown[] = []): T {
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
      if (idx < stateOverrides.length && stateOverrides[idx] !== undefined) {
        return [stateOverrides[idx] as S, () => {}];
      }
      const value = typeof initial === 'function' ? (initial as () => S)() : initial;
      return [value, () => {}];
    },
    useCallback: <T,>(fn: T) => fn,
    useMemo: <T,>(fn: () => T) => fn(),
    useRef: <T,>(initial: T) => ({ current: initial }),
    useEffect: () => {},
    // useAppConfig() reads context; with no provider it falls back to
    // DEFAULT_APP_CONFIG (isCloud false) — i.e. local studio behavior.
    useContext: () => undefined,
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

function findAllByTestIdPrefix(tree: unknown, prefix: string): ReactElementLike[] {
  return findAll(tree, (el) => {
    const id = (el.props as { 'data-testid'?: string })['data-testid'];
    return typeof id === 'string' && id.startsWith(prefix);
  });
}

const PROJECTS: ProjectSummary[] = [
  {
    projectSlug: 'order-pipeline',
    name: 'Order Pipeline',
    defaultFlow: 'main',
    flowCount: 2,
    repoPath: '/tmp/order-pipeline',
  },
  {
    projectSlug: 'component-showcase',
    name: 'Component Showcase',
    defaultFlow: 'main',
    flowCount: 1,
    repoPath: '/tmp/component-showcase',
  },
];

function renderSwitcher(
  props: Partial<ProjectSwitcherProps> = {},
  overrides: readonly unknown[] = [true],
): unknown {
  const merged: ProjectSwitcherProps = {
    projects: PROJECTS,
    currentProjectSlug: 'order-pipeline',
    ...props,
  };
  return renderWithHooks(
    () => (ProjectSwitcher as unknown as (p: ProjectSwitcherProps) => unknown)(merged),
    overrides,
  );
}

describe('ProjectSwitcher', () => {
  it('renders one row per project (dedupe: a 2-flow project is still 1 row)', () => {
    const tree = renderSwitcher();
    for (const project of PROJECTS) {
      const row = findByTestId(tree, `project-switcher-row-${project.projectSlug}`);
      if (!row) throw new Error(`row missing for ${project.projectSlug}`);
      expect(row).not.toBeNull();
    }
    const rows = findAllByTestIdPrefix(tree, 'project-switcher-row-');
    expect(rows.length).toBe(PROJECTS.length);
  });

  it('the trigger label reflects the currently-open project name', () => {
    const tree = renderSwitcher({}, [false]);
    const trigger = findByTestId(tree, 'project-switcher-trigger');
    if (!trigger) throw new Error('trigger missing');
    const labels = findAll(trigger, (el) => {
      const children = el.props.children;
      return typeof children === 'string' && children === 'Order Pipeline';
    });
    expect(labels.length).toBe(1);
  });

  it('renders each row with the project name and repoPath subline (when present)', () => {
    const tree = renderSwitcher();
    const row = findByTestId(tree, 'project-switcher-row-order-pipeline');
    if (!row) throw new Error('row missing');
    const sublines = findAll(row, (el) => {
      const children = el.props.children;
      return typeof children === 'string' && children === '/tmp/order-pipeline';
    });
    expect(sublines.length).toBe(1);
  });

  it('omits the repoPath subline when the API did not supply it', () => {
    const tree = renderSwitcher({
      projects: [
        {
          projectSlug: 'sealed',
          name: 'Sealed',
          defaultFlow: 'main',
          flowCount: 1,
        },
      ],
    });
    const row = findByTestId(tree, 'project-switcher-row-sealed');
    if (!row) throw new Error('row missing');
    // No <code> or muted-foreground subline should be rendered.
    const codeNodes = findAll(row, (el) => el.type === 'code');
    expect(codeNodes.length).toBe(0);
  });

  it('selecting a row navigates to /projects/<slug>/flows/<defaultFlow>', () => {
    const tree = renderSwitcher();
    const row = findByTestId(tree, 'project-switcher-row-order-pipeline');
    if (!row) throw new Error('row missing');
    const onSelect = (row.props as { onSelect?: () => void }).onSelect;
    if (!onSelect) throw new Error('row onSelect missing');

    onSelect();
    expect(navigateCalls).toEqual(['/projects/order-pipeline/flows/main']);
  });

  it('honors the per-project last-opened flow from localStorage when navigating', () => {
    storageStub.set('seeflow:last-flow:order-pipeline', 'retry');
    const tree = renderSwitcher();
    const row = findByTestId(tree, 'project-switcher-row-order-pipeline');
    if (!row) throw new Error('row missing');
    const onSelect = (row.props as { onSelect?: () => void }).onSelect;
    if (!onSelect) throw new Error('row onSelect missing');

    onSelect();
    expect(navigateCalls).toEqual(['/projects/order-pipeline/flows/retry']);
  });

  it('per-row trash button surfaces with the documented test id', () => {
    const tree = renderSwitcher();
    for (const project of PROJECTS) {
      const trash = findByTestId(tree, `project-switcher-unregister-${project.projectSlug}`);
      if (!trash) throw new Error(`trash missing for ${project.projectSlug}`);
      expect(trash.props['aria-label']).toBe(`Unregister ${project.name}`);
    }
  });

  it('renders the "+ Create new project" footer button', () => {
    const tree = renderSwitcher();
    const create = findByTestId(tree, 'project-switcher-create');
    if (!create) throw new Error('create button missing');
    expect(create).not.toBeNull();
  });

  it('unregister dialog warns about cascading every flow in the project', () => {
    const tree = renderSwitcher({}, [true, undefined, PROJECTS[0]]);
    const dialog = findByTestId(tree, 'unregister-project-dialog');
    if (!dialog) throw new Error('dialog missing');
    // Walk every child slot (including numeric interpolations) and confirm the
    // flowCount (2) is rendered somewhere in the dialog body.
    let sawFlowCount = false;
    const visit = (node: unknown): void => {
      if (node === null || node === undefined) return;
      if (typeof node === 'number') {
        if (node === PROJECTS[0]?.flowCount) sawFlowCount = true;
        return;
      }
      if (Array.isArray(node)) {
        for (const child of node) visit(child);
        return;
      }
      if (typeof node === 'object' && node && 'props' in (node as { props?: unknown })) {
        visit((node as { props: { children?: unknown } }).props.children);
      }
    };
    visit(dialog);
    expect(sawFlowCount).toBe(true);
  });

  it('clicking confirm dispatches onUnregisterProject with the project slug', async () => {
    const received: Array<{ slug: string; opts?: { deleteSource?: boolean } }> = [];
    const onUnregisterProject = async (
      projectSlug: string,
      opts?: { deleteSource?: boolean },
    ): Promise<void> => {
      received.push({ slug: projectSlug, opts });
    };
    const tree = renderSwitcher({ onUnregisterProject }, [true, undefined, PROJECTS[0]]);
    const confirm = findByTestId(tree, 'unregister-project-confirm');
    if (!confirm) throw new Error('confirm button missing');
    const onClick = (confirm.props as { onClick?: () => void | Promise<void> }).onClick;
    if (!onClick) throw new Error('confirm onClick missing');
    await onClick();
    expect(received).toEqual([{ slug: 'order-pipeline', opts: { deleteSource: false } }]);
  });

  it('forwards deleteSource:true when the "Also delete files" checkbox is checked', async () => {
    const received: Array<{ slug: string; opts?: { deleteSource?: boolean } }> = [];
    const onUnregisterProject = async (
      projectSlug: string,
      opts?: { deleteSource?: boolean },
    ): Promise<void> => {
      received.push({ slug: projectSlug, opts });
    };
    // Slot 5 = deleteSource overridden to true (the user clicked the checkbox).
    const tree = renderSwitcher({ onUnregisterProject }, [
      true,
      undefined,
      PROJECTS[0],
      undefined,
      undefined,
      true,
    ]);

    const checkbox = findByTestId(tree, 'unregister-project-delete-source');
    if (!checkbox) throw new Error('delete-source checkbox missing');
    expect((checkbox.props as { checked?: boolean }).checked).toBe(true);

    const confirm = findByTestId(tree, 'unregister-project-confirm');
    if (!confirm) throw new Error('confirm button missing');
    const onClick = (confirm.props as { onClick?: () => void | Promise<void> }).onClick;
    if (!onClick) throw new Error('confirm onClick missing');
    await onClick();
    expect(received).toEqual([{ slug: 'order-pipeline', opts: { deleteSource: true } }]);
  });

  it('omits the delete-source checkbox when the project has no repoPath', () => {
    const tree = renderSwitcher(
      {
        projects: [
          {
            projectSlug: 'sealed',
            name: 'Sealed',
            defaultFlow: 'main',
            flowCount: 1,
          },
        ],
      },
      [
        true,
        undefined,
        {
          projectSlug: 'sealed',
          name: 'Sealed',
          defaultFlow: 'main',
          flowCount: 1,
        },
      ],
    );
    const checkbox = findByTestId(tree, 'unregister-project-delete-source');
    expect(checkbox).toBeNull();
  });

  it('renders an empty list when no projects are registered', () => {
    const tree = renderSwitcher({ projects: [] });
    const rows = findAllByTestIdPrefix(tree, 'project-switcher-row-');
    expect(rows.length).toBe(0);
    // The "+ Create new project" footer should still be present so the user
    // has an obvious path forward.
    const create = findByTestId(tree, 'project-switcher-create');
    expect(create).not.toBeNull();
  });

  it('trigger falls back to "Select project" when the current slug does not match', () => {
    const tree = renderSwitcher({ currentProjectSlug: 'orphan' }, [false]);
    const trigger = findByTestId(tree, 'project-switcher-trigger');
    if (!trigger) throw new Error('trigger missing');
    const labels = findAll(trigger, (el) => {
      const children = el.props.children;
      return typeof children === 'string' && children === 'Select project';
    });
    expect(labels.length).toBe(1);
  });
});
