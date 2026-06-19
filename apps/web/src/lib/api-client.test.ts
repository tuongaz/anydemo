import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { apiFetch } from './api-client.ts';
import { NullAuthProvider } from './auth/null-provider.ts';
import { setAuthProvider } from './auth/provider.ts';
import type { AuthProvider } from './auth/types.ts';

const realFetch = globalThis.fetch;
let lastInit: RequestInit | undefined;
let nextStatus = 200;

const installMockFetch = () => {
  lastInit = undefined;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    lastInit = init;
    return new Response('{}', { status: nextStatus });
  }) as typeof fetch;
};

const headerOf = (init: RequestInit | undefined, name: string): string | null => {
  const h = init?.headers;
  if (!h) return null;
  return new Headers(h).get(name);
};

beforeEach(() => {
  nextStatus = 200;
  installMockFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setAuthProvider(NullAuthProvider);
});

describe('apiFetch', () => {
  it('adds Authorization when the provider yields a token', async () => {
    setAuthProvider({ ...NullAuthProvider, getToken: async () => 'abc123' } as AuthProvider);
    await apiFetch('/api/flows');
    expect(headerOf(lastInit, 'authorization')).toBe('Bearer abc123');
  });

  it('leaves init untouched when there is no token (local mode)', async () => {
    // NullAuthProvider is the default → no header, init passed straight through.
    const init = { method: 'DELETE' as const };
    await apiFetch('/api/projects/x', init);
    expect(lastInit).toBe(init);
    expect(headerOf(lastInit, 'authorization')).toBeNull();
  });

  it('preserves caller headers alongside the bearer token', async () => {
    setAuthProvider({ ...NullAuthProvider, getToken: async () => 'tok' } as AuthProvider);
    await apiFetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(headerOf(lastInit, 'content-type')).toBe('application/json');
    expect(headerOf(lastInit, 'authorization')).toBe('Bearer tok');
  });

  it('triggers signIn on a 401', async () => {
    let signedIn = 0;
    setAuthProvider({
      ...NullAuthProvider,
      getToken: async () => 'expired',
      signIn: async () => {
        signedIn += 1;
      },
    } as AuthProvider);
    nextStatus = 401;
    const res = await apiFetch('/api/flows');
    expect(res.status).toBe(401);
    expect(signedIn).toBe(1);
  });
});
