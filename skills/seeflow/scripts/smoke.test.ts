import { afterEach, describe, expect, it } from 'bun:test';
import { runSmoke } from './smoke';

const realFetch = globalThis.fetch;

interface Capture {
  url: string;
  method: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('runSmoke', () => {
  it('returns ok:false with friendly message when /health is unreachable', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;

    const result = await runSmoke({ url: 'http://127.0.0.1:65535' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Studio not reachable at http://127.0.0.1:65535');
    expect(result.error).toContain('seeflow start');
  });

  it('happy path: registers both demos, lists both, re-registers second without disturbing first', async () => {
    const captured: Capture[] = [];
    let registerCalls = 0;
    let listCalls = 0;
    const FIRST_ID = 'demo-first-aaa';
    const FIRST_SLUG = 'todo-demo';
    const SECOND_ID = 'demo-second-bbb';
    const SECOND_SLUG = 'sample-demo';
    let lastRegisteredRepoPath = '';

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      captured.push({ url, method });

      if (url.endsWith('/health')) return jsonResponse({ ok: true });

      if (url.endsWith('/api/flows/register') && method === 'POST') {
        const body = JSON.parse((init?.body as string) ?? '{}') as {
          repoPath: string;
          architecturePath: string;
        };
        lastRegisteredRepoPath = body.repoPath;
        registerCalls += 1;
        if (registerCalls === 1) {
          return jsonResponse({ id: FIRST_ID, slug: FIRST_SLUG });
        }
        return jsonResponse({ id: SECOND_ID, slug: SECOND_SLUG });
      }

      if (url.endsWith('/api/validate') && method === 'POST') {
        return jsonResponse({ ok: true });
      }

      if (url.endsWith('/api/flows') && method === 'GET') {
        listCalls += 1;
        return jsonResponse([
          { id: FIRST_ID, slug: FIRST_SLUG, repoPath: lastRegisteredRepoPath },
          { id: SECOND_ID, slug: SECOND_SLUG, repoPath: lastRegisteredRepoPath },
        ]);
      }

      if (method === 'DELETE') return jsonResponse({ ok: true });

      return new Response('unexpected', { status: 500 });
    }) as typeof fetch;

    const result = await runSmoke({ url: 'http://stub' });
    expect(result.ok).toBe(true);
    expect(result.firstId).toBe(FIRST_ID);
    expect(result.firstSlug).toBe(FIRST_SLUG);
    expect(result.secondId).toBe(SECOND_ID);
    expect(result.secondSlug).toBe(SECOND_SLUG);

    expect(registerCalls).toBe(3);
    expect(listCalls).toBe(2);

    const registerUrls = captured
      .filter((c) => c.url.endsWith('/api/flows/register'))
      .map((c) => c.method);
    expect(registerUrls).toEqual(['POST', 'POST', 'POST']);

    const deletes = captured.filter((c) => c.method === 'DELETE').map((c) => c.url);
    expect(deletes.length).toBe(2);
    expect(deletes.some((u) => u.endsWith(`/api/flows/${FIRST_ID}`))).toBe(true);
    expect(deletes.some((u) => u.endsWith(`/api/flows/${SECOND_ID}`))).toBe(true);
  });

  it('returns ok:false when the studio rejects the first register with 400', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/health')) return jsonResponse({ ok: true });
      if (url.endsWith('/api/flows/register') && method === 'POST') {
        return jsonResponse({ error: 'Flow file failed schema validation' }, 400);
      }
      return new Response('unexpected', { status: 500 });
    }) as typeof fetch;

    const result = await runSmoke({ url: 'http://stub' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('register first demo failed');
    expect(result.error).toContain('400');
  });

  it('detects id collision between first and second register responses', async () => {
    let calls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/health')) return jsonResponse({ ok: true });
      if (url.endsWith('/api/flows/register') && method === 'POST') {
        calls += 1;
        return jsonResponse({ id: 'collide-id', slug: `slug-${calls}` });
      }
      if (url.endsWith('/api/validate') && method === 'POST') {
        return jsonResponse({ ok: true });
      }
      if (method === 'DELETE') return jsonResponse({ ok: true });
      return new Response('unexpected', { status: 500 });
    }) as typeof fetch;

    const result = await runSmoke({ url: 'http://stub' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('first and second demo ids collided');
  });
});
