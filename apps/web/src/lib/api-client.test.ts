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

/**
 * Install a fetch mock that returns a scripted sequence of outcomes — an HTTP
 * status code, or the literal 'network' to reject like a dropped connection.
 * The last entry repeats once the script is exhausted. Returns a call counter.
 */
const stageFetch = (steps: Array<number | 'network'>) => {
  let i = 0;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    if (step === 'network') throw new TypeError('network down');
    return new Response('{}', { status: step });
  }) as unknown as typeof fetch;
  return { calls: () => calls };
};

beforeEach(() => {
  nextStatus = 200;
  installMockFetch();
});

const setBoot = (boot: Record<string, unknown> | undefined): void => {
  if (boot === undefined) {
    // biome-ignore lint/performance/noDelete: must remove the global, not set "undefined".
    delete (globalThis as { window?: unknown }).window;
    return;
  }
  (globalThis as { window?: unknown }).window = { __SEEFLOW_BOOT__: boot };
};

afterEach(() => {
  globalThis.fetch = realFetch;
  setAuthProvider(NullAuthProvider);
  setBoot(undefined);
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

  it('retries an idempotent PATCH on a transient 503, then succeeds', async () => {
    const m = stageFetch([503, 200]);
    const res = await apiFetch('/api/projects/x/flows/main/nodes/n1', { method: 'PATCH' });
    expect(res.status).toBe(200);
    expect(m.calls()).toBe(2);
  });

  it('does NOT retry a POST (non-idempotent create) on a 503', async () => {
    const m = stageFetch([503, 200]);
    const res = await apiFetch('/api/projects/x/flows/main/nodes', { method: 'POST' });
    expect(res.status).toBe(503);
    expect(m.calls()).toBe(1);
  });

  it('retries a DELETE on a network error, then succeeds', async () => {
    const m = stageFetch(['network', 200]);
    const res = await apiFetch('/api/projects/x/flows/main/nodes/n1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(m.calls()).toBe(2);
  });

  it('gives up after the retry budget and returns the last transient status', async () => {
    const m = stageFetch([503, 503, 503, 503]);
    const res = await apiFetch('/api/flows', { method: 'GET' });
    expect(res.status).toBe(503);
    expect(m.calls()).toBe(3); // 1 attempt + 2 retries
  });

  it('propagates a network error after exhausting retries', async () => {
    stageFetch(['network', 'network', 'network']);
    await expect(apiFetch('/api/flows', { method: 'PATCH' })).rejects.toThrow('network down');
  });

  it('does not retry a non-retryable 4xx (e.g. 400 bad request)', async () => {
    const m = stageFetch([400, 200]);
    const res = await apiFetch('/api/flows', { method: 'PATCH' });
    expect(res.status).toBe(400);
    expect(m.calls()).toBe(1);
  });

  it('tags requests with X-Seeflow-Project-Id when the boot carries a projectId', async () => {
    setBoot({ base: '/p/abc', projectSlug: 'main', projectId: 'cloud-uuid-1', mode: 'edit' });
    setAuthProvider({ ...NullAuthProvider, getToken: async () => 'tok' } as AuthProvider);
    await apiFetch('/api/projects/main/flows/main/nodes', { method: 'POST' });
    expect(headerOf(lastInit, 'x-seeflow-project-id')).toBe('cloud-uuid-1');
    expect(headerOf(lastInit, 'authorization')).toBe('Bearer tok');
  });

  it('omits the project header when the boot has no projectId', async () => {
    setBoot({ base: '/app', projectSlug: 'main', mode: 'edit' });
    setAuthProvider({ ...NullAuthProvider, getToken: async () => 'tok' } as AuthProvider);
    await apiFetch('/api/projects/main/flows/main/nodes', { method: 'POST' });
    expect(headerOf(lastInit, 'x-seeflow-project-id')).toBeNull();
    expect(headerOf(lastInit, 'authorization')).toBe('Bearer tok');
  });

  it('sends the project header even with no token (gating is independent)', async () => {
    setBoot({ base: '/p/abc', projectSlug: 'main', projectId: 'cloud-uuid-2', mode: 'edit' });
    // NullAuthProvider → no token; the project header must still be attached.
    await apiFetch('/api/projects/main/flows/main');
    expect(headerOf(lastInit, 'x-seeflow-project-id')).toBe('cloud-uuid-2');
    expect(headerOf(lastInit, 'authorization')).toBeNull();
  });
});
