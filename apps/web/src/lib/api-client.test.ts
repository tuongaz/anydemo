import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { apiFetch } from './api-client.ts';

const realFetch = globalThis.fetch;
let lastInit: RequestInit | undefined;

const installMockFetch = () => {
  lastInit = undefined;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    lastInit = init;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
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
  installMockFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('apiFetch', () => {
  it('passes init straight through to fetch', async () => {
    const init = { method: 'DELETE' as const };
    await apiFetch('/api/projects/x', init);
    expect(lastInit).toBe(init);
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
});
