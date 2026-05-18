import { describe, expect, it } from 'bun:test';
import type { LucideProps } from 'lucide-react';
import * as React from 'react';
import { ICON_FALLBACK_NAME, ICON_REGISTRY } from '../lib/icon-registry.ts';
import { Icon, type IconRegistryValue } from './icon.tsx';

// Hook-shim renderer pattern (see icon-node.test.tsx). Bun runs without a DOM,
// so we replace React's internal dispatcher to drive a single render and walk
// the returned element tree. Icon only uses `useContext`, which we shim with
// the supplied registry value.
type Hooks = {
  useContext: <T>(ctx: unknown) => T;
};

function renderWithHooks<T>(fn: () => T, registry?: IconRegistryValue): T {
  const internals = (
    React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: Hooks | null };
      };
    }
  ).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const prev = internals.ReactCurrentDispatcher.current;
  internals.ReactCurrentDispatcher.current = {
    useContext: <T,>() => (registry ?? { custom: {} }) as T,
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

function callIcon(props: React.ComponentProps<typeof Icon>, registry?: IconRegistryValue): unknown {
  return renderWithHooks(() => (Icon as (p: typeof props) => unknown)(props), registry);
}

describe('Icon', () => {
  it('renders the correct Lucide component for a known name', () => {
    const tree = callIcon({ name: 'shopping-cart' });
    expect(isElement(tree)).toBe(true);
    if (!isElement(tree)) return;
    expect(tree.type).toBe(ICON_REGISTRY['shopping-cart']);
  });

  it('falls back to ICON_FALLBACK_NAME on an unknown name', () => {
    const tree = callIcon({ name: 'definitely-not-a-real-icon' });
    expect(isElement(tree)).toBe(true);
    if (!isElement(tree)) return;
    expect(tree.type).toBe(ICON_REGISTRY[ICON_FALLBACK_NAME]);
  });

  it('honors the `fallback` prop when name is unknown', () => {
    const tree = callIcon({ name: 'definitely-not-a-real-icon', fallback: 'circle' });
    expect(isElement(tree)).toBe(true);
    if (!isElement(tree)) return;
    expect(tree.type).toBe(ICON_REGISTRY.circle);
  });

  it('honors the `as` prop and ignores name lookup', () => {
    const Stub: React.ComponentType<LucideProps> = () => null;
    const tree = callIcon({ name: 'shopping-cart', as: Stub });
    expect(isElement(tree)).toBe(true);
    if (!isElement(tree)) return;
    // `as` wins over name lookup.
    expect(tree.type).toBe(Stub);
  });

  it('resolves custom icons from the IconRegistryProvider context by name', () => {
    const Custom: React.ComponentType<LucideProps> = () => null;
    const tree = callIcon({ name: 'my-custom' }, { custom: { 'my-custom': Custom } });
    expect(isElement(tree)).toBe(true);
    if (!isElement(tree)) return;
    expect(tree.type).toBe(Custom);
  });

  it('custom registry takes precedence over the built-in lucide registry', () => {
    const Override: React.ComponentType<LucideProps> = () => null;
    // 'shopping-cart' exists in ICON_REGISTRY — custom must win for the same key.
    const tree = callIcon({ name: 'shopping-cart' }, { custom: { 'shopping-cart': Override } });
    expect(isElement(tree)).toBe(true);
    if (!isElement(tree)) return;
    expect(tree.type).toBe(Override);
  });

  it('passes through className and strokeWidth to the underlying component', () => {
    const tree = callIcon({ name: 'shopping-cart', className: 'shrink-0', strokeWidth: 1.5 });
    expect(isElement(tree)).toBe(true);
    if (!isElement(tree)) return;
    expect(tree.props.className).toBe('shrink-0');
    expect(tree.props.strokeWidth).toBe(1.5);
  });

  it('defaults size to 16 and forwards an explicit size override', () => {
    const defaultTree = callIcon({ name: 'shopping-cart' });
    expect(isElement(defaultTree)).toBe(true);
    if (!isElement(defaultTree)) return;
    expect(defaultTree.props.size).toBe(16);

    const explicitTree = callIcon({ name: 'shopping-cart', size: 24 });
    expect(isElement(explicitTree)).toBe(true);
    if (!isElement(explicitTree)) return;
    expect(explicitTree.props.size).toBe(24);
  });
});
