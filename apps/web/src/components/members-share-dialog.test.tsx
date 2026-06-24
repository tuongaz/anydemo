import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as React from 'react';

// Mock the grants API BEFORE importing the component so it binds the mocks.
const fetchGrants = mock(
  async (_projectId: string) => [] as Array<{ email: string; role: string }>,
);
const addGrant = mock(async (_projectId: string, _email: string, _role: string) => {});
const removeGrant = mock(async (_projectId: string, _email: string) => {});

mock.module('@/lib/cloud-members-api', () => ({ fetchGrants, addGrant, removeGrant }));

const { MembersShareDialog } = await import('./members-share-dialog.tsx');

// Hook-shim render (no DOM): synchronous dispatcher, call the component as a
// plain function, walk the JSX tree. useState overrides are indexed by the
// component's useState DECLARATION order: 0=state, 1=email, 2=role,
// 3=submitting, 4=error.
type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  // `() => void` accepts effects that return a cleanup too (void-return is
  // bivariant on the return), and avoids biome's noConfusingVoidType.
  useEffect: (fn: () => void) => void;
};

function renderWithHooks<T>(
  fn: () => T,
  options: { useStateOverrides?: ReadonlyArray<unknown>; runEffects?: boolean } = {},
): T {
  const { useStateOverrides, runEffects } = options;
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
    useEffect: (effect: () => void) => {
      if (runEffects) effect();
    },
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

const testIdEquals = (id: string) => (el: ReactElementLike) =>
  (el.props as { 'data-testid'?: string })['data-testid'] === id;

type Props = { open: boolean; onOpenChange: (open: boolean) => void; projectId: string };
type DoneState = { status: 'done'; grants: Array<{ email: string; role: string }> };

function render(props: Props, options: Parameters<typeof renderWithHooks>[1] = {}): unknown {
  return renderWithHooks(
    () => (MembersShareDialog as unknown as (p: Props) => unknown)(props),
    options,
  );
}

describe('MembersShareDialog', () => {
  beforeEach(() => {
    fetchGrants.mockClear();
    addGrant.mockClear();
    removeGrant.mockClear();
    fetchGrants.mockImplementation(async () => []);
  });
  afterEach(() => {
    fetchGrants.mockReset();
    addGrant.mockReset();
    removeGrant.mockReset();
  });

  it('fetches grants for the projectId when opened', () => {
    render({ open: true, onOpenChange: () => {}, projectId: 'p1' }, { runEffects: true });
    expect(fetchGrants).toHaveBeenCalledTimes(1);
    expect(fetchGrants).toHaveBeenCalledWith('p1');
  });

  it('does not fetch when closed', () => {
    render({ open: false, onOpenChange: () => {}, projectId: 'p1' }, { runEffects: true });
    expect(fetchGrants).not.toHaveBeenCalled();
  });

  it('renders the empty state when no one else has access', () => {
    const done: DoneState = { status: 'done', grants: [] };
    const tree = render(
      { open: true, onOpenChange: () => {}, projectId: 'p1' },
      { useStateOverrides: [done] },
    );
    expect(findElement(tree, testIdEquals('member-empty'))).not.toBeNull();
  });

  it('renders a row per grant with role select + remove', () => {
    const done: DoneState = {
      status: 'done',
      grants: [{ email: 'ada@example.com', role: 'viewer' }],
    };
    const tree = render(
      { open: true, onOpenChange: () => {}, projectId: 'p1' },
      { useStateOverrides: [done] },
    );
    expect(findElement(tree, testIdEquals('member-row'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('member-role-ada@example.com'))).not.toBeNull();
    expect(findElement(tree, testIdEquals('member-remove-ada@example.com'))).not.toBeNull();
  });

  it('Add is disabled for an email without @', () => {
    const done: DoneState = { status: 'done', grants: [] };
    const tree = render(
      { open: true, onOpenChange: () => {}, projectId: 'p1' },
      { useStateOverrides: [done, 'nope', 'viewer', false] },
    );
    const add = findElement(tree, testIdEquals('member-invite-add'));
    expect((add as ReactElementLike).props.disabled).toBe(true);
  });

  it('Add with a valid email calls addGrant(projectId, email, role)', async () => {
    const done: DoneState = { status: 'done', grants: [] };
    const tree = render(
      { open: true, onOpenChange: () => {}, projectId: 'p1' },
      { useStateOverrides: [done, 'ada@example.com', 'editor', false] },
    );
    const add = findElement(tree, testIdEquals('member-invite-add'));
    await ((add as ReactElementLike).props.onClick as () => Promise<void>)();
    expect(addGrant).toHaveBeenCalledWith('p1', 'ada@example.com', 'editor');
  });

  it('remove calls removeGrant(projectId, email)', async () => {
    const done: DoneState = {
      status: 'done',
      grants: [{ email: 'ada@example.com', role: 'viewer' }],
    };
    const tree = render(
      { open: true, onOpenChange: () => {}, projectId: 'p1' },
      { useStateOverrides: [done] },
    );
    const remove = findElement(tree, testIdEquals('member-remove-ada@example.com'));
    await ((remove as ReactElementLike).props.onClick as () => Promise<void>)();
    expect(removeGrant).toHaveBeenCalledWith('p1', 'ada@example.com');
  });
});
