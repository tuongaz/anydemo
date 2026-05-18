import { describe, expect, it } from 'bun:test';
import { createApp } from '../src/server.ts';

describe('GET /healthz (US-011 readiness probe)', () => {
  it('returns 200 with { status: "ok" } against a freshly-created app', async () => {
    const app = createApp({ disableWatcher: true });
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('works without any registered demos and without authentication headers', async () => {
    const app = createApp({ disableWatcher: true });
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });
});
