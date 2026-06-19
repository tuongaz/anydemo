import { describe, expect, it } from 'bun:test';
import * as React from 'react';
import { type AppConfigValue, DEFAULT_APP_CONFIG, useAppConfig } from './app-config.tsx';
import { NullAuthProvider } from './null-provider.ts';

// Shim React's internal dispatcher so we can call the useContext-based hook
// without a renderer (mirrors the component hook-shim tests).
function withUseContext<T>(useContextImpl: (ctx: unknown) => unknown, fn: () => T): T {
  const internals = (
    React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: { useContext: (ctx: unknown) => unknown } | null };
      };
    }
  ).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const prev = internals.ReactCurrentDispatcher.current;
  internals.ReactCurrentDispatcher.current = { useContext: useContextImpl };
  try {
    return fn();
  } finally {
    internals.ReactCurrentDispatcher.current = prev;
  }
}

describe('DEFAULT_APP_CONFIG', () => {
  it('is local mode, no user, NullAuthProvider', () => {
    expect(DEFAULT_APP_CONFIG.isCloud).toBe(false);
    expect(DEFAULT_APP_CONFIG.user).toBeNull();
    expect(DEFAULT_APP_CONFIG.provider).toBe(NullAuthProvider);
  });
});

describe('useAppConfig', () => {
  it('falls back to DEFAULT_APP_CONFIG when no provider is mounted', () => {
    const result = withUseContext(
      () => null,
      () => useAppConfig(),
    );
    expect(result).toBe(DEFAULT_APP_CONFIG);
  });

  it('returns the context value when a provider is mounted', () => {
    const value: AppConfigValue = {
      isCloud: true,
      user: { name: 'Ada', email: 'ada@seeflow.dev' },
      provider: NullAuthProvider,
    };
    const result = withUseContext(
      () => value,
      () => useAppConfig(),
    );
    expect(result).toBe(value);
  });
});
