import { describe, expect, it, mock } from 'bun:test';
import * as React from 'react';
import { InstallPackModal, type InstallPackModalProps } from './install-pack-modal.tsx';

type Hooks = {
  useState: <S>(initial: S | (() => S)) => [S, (next: S | ((prev: S) => S)) => void];
  useCallback: <T>(fn: T) => T;
  useMemo: <T>(fn: () => T) => T;
  useRef: <T>(initial: T) => { current: T };
  useEffect: () => void;
  useContext: <T>(ctx: { _currentValue?: T }) => T;
};

function renderWithHooks<T>(
  fn: () => T,
  options: { useStateOverrides?: ReadonlyArray<unknown> } = {},
): T {
  const { useStateOverrides } = options;
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
    useContext: <T,>(ctx: { _currentValue?: T }) => ctx._currentValue as T,
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

function testIdEquals(id: string) {
  return (el: ReactElementLike) => (el.props as { 'data-testid'?: string })['data-testid'] === id;
}

function callModal(
  overrides: Partial<InstallPackModalProps> = {},
  useStateOverrides: ReadonlyArray<unknown> = [],
): unknown {
  const props: InstallPackModalProps = {
    open: true,
    onOpenChange: () => {},
    vendor: 'aws',
    licenseSummary: 'AWS Architecture Icons are free to use under the AWS Trademark Guidelines.',
    licenseUrl: 'https://aws.amazon.com/architecture/icons/',
    requiresAcceptance: false,
    onConfirm: () => {},
    onCancel: () => {},
    ...overrides,
  };
  return renderWithHooks(
    () => (InstallPackModal as unknown as (p: InstallPackModalProps) => unknown)(props),
    { useStateOverrides },
  );
}

describe('InstallPackModal', () => {
  it('shows the license summary and a license-link with the given URL', () => {
    const tree = callModal({ licenseSummary: 'Some terms', licenseUrl: 'https://example.com/lic' });
    const lic = findElement(tree, testIdEquals('install-pack-modal-license'));
    expect(lic).not.toBeNull();
    const link = findElement(tree, testIdEquals('install-pack-modal-license-link'));
    expect((link?.props as { href?: string }).href).toBe('https://example.com/lic');
  });

  it('vendor without requiresAcceptance: confirm enabled, no checkbox; payload acceptTerms=false', () => {
    const onConfirm = mock(() => {});
    const tree = callModal({ requiresAcceptance: false, onConfirm });
    expect(findElement(tree, testIdEquals('install-pack-modal-accept'))).toBeNull();
    const confirm = findElement(tree, testIdEquals('install-pack-modal-confirm'));
    expect((confirm?.props as { disabled?: boolean }).disabled).toBe(false);
    (confirm?.props.onClick as () => void)();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ acceptTerms: false });
  });

  it('requiresAcceptance + unchecked: confirm is disabled and clicking it does nothing', () => {
    const onConfirm = mock(() => {});
    // Default useState(false) for `accepted` — the dispatcher shim returns the initial value.
    const tree = callModal({ requiresAcceptance: true, onConfirm });
    const checkbox = findElement(tree, testIdEquals('install-pack-modal-accept'));
    expect(checkbox).not.toBeNull();
    expect((checkbox?.props as { checked?: boolean }).checked).toBe(false);
    const confirm = findElement(tree, testIdEquals('install-pack-modal-confirm'));
    expect((confirm?.props as { disabled?: boolean }).disabled).toBe(true);
    (confirm?.props.onClick as () => void)();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('requiresAcceptance + checked: confirm enabled and emits acceptTerms=true', () => {
    const onConfirm = mock(() => {});
    // Override useState(0) (accepted) to true to simulate the post-tick state.
    const tree = callModal({ requiresAcceptance: true, onConfirm }, [true]);
    const confirm = findElement(tree, testIdEquals('install-pack-modal-confirm'));
    expect((confirm?.props as { disabled?: boolean }).disabled).toBe(false);
    (confirm?.props.onClick as () => void)();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ acceptTerms: true });
  });

  it('Cancel fires onCancel', () => {
    const onCancel = mock(() => {});
    const tree = callModal({ onCancel });
    const cancel = findElement(tree, testIdEquals('install-pack-modal-cancel'));
    if (!cancel) throw new Error('cancel not found');
    (cancel.props.onClick as () => void)();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
