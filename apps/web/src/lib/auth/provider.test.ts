import { describe, expect, it } from 'bun:test';
import { NullAuthProvider } from './null-provider.ts';
import { getAuthProvider, resolveAuthProvider, setAuthProvider } from './provider.ts';
import type { AuthProvider } from './types.ts';

describe('provider singleton', () => {
  it('defaults to NullAuthProvider', () => {
    expect(getAuthProvider()).toBe(NullAuthProvider);
  });

  it('set/get round-trips and can be restored', () => {
    const fake = { ...NullAuthProvider, getToken: async () => 'tok' } as AuthProvider;
    setAuthProvider(fake);
    expect(getAuthProvider()).toBe(fake);
    setAuthProvider(NullAuthProvider);
    expect(getAuthProvider()).toBe(NullAuthProvider);
  });
});

describe('resolveAuthProvider', () => {
  it('returns NullAuthProvider when auth is not required', async () => {
    expect(await resolveAuthProvider({ mode: 'local', auth: { required: false } })).toBe(
      NullAuthProvider,
    );
    expect(await resolveAuthProvider({ mode: 'local' })).toBe(NullAuthProvider);
  });

  it('throws when auth is required but no adapterUrl is given', async () => {
    await expect(resolveAuthProvider({ mode: 'cloud', auth: { required: true } })).rejects.toThrow(
      /adapterUrl/,
    );
  });
});

describe('NullAuthProvider', () => {
  it('is an always-authenticated, tokenless no-op', async () => {
    expect(NullAuthProvider.isAuthenticated()).toBe(true);
    expect(await NullAuthProvider.getToken()).toBeNull();
    expect(typeof NullAuthProvider.onChange(() => {})).toBe('function');
    expect(NullAuthProvider.getUser?.()).toBeNull();
  });
});
