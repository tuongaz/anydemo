import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { createCorsMiddleware } from './cors.ts';

const TOKEN = '11111111-2222-3333-4444-555555555555';

const buildApp = (token: string | undefined): Hono => {
  const app = new Hono();
  app.use('*', createCorsMiddleware(token));
  app.get('/api/ping', (c) => c.json({ ok: true }));
  app.post('/api/ping', (c) => c.json({ ok: true, method: 'POST' }));
  return app;
};

describe('createCorsMiddleware — null origin', () => {
  it('allows null origin when X-Seeflow-Token matches', async () => {
    const app = buildApp(TOKEN);
    const res = await app.request('/api/ping', {
      headers: { origin: 'null', 'x-seeflow-token': TOKEN },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('null');
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns 403 when null origin has no X-Seeflow-Token header', async () => {
    const app = buildApp(TOKEN);
    const res = await app.request('/api/ping', { headers: { origin: 'null' } });
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('returns 403 when null origin has a wrong X-Seeflow-Token', async () => {
    const app = buildApp(TOKEN);
    const res = await app.request('/api/ping', {
      headers: { origin: 'null', 'x-seeflow-token': 'wrong-token' },
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 when null origin sends a token of matching length but different value', async () => {
    const sameLength = TOKEN.split('').reverse().join('');
    expect(sameLength.length).toBe(TOKEN.length);
    expect(sameLength).not.toBe(TOKEN);
    const app = buildApp(TOKEN);
    const res = await app.request('/api/ping', {
      headers: { origin: 'null', 'x-seeflow-token': sameLength },
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 for null origin requests when no studio token is configured', async () => {
    const app = buildApp(undefined);
    const res = await app.request('/api/ping', {
      headers: { origin: 'null', 'x-seeflow-token': 'anything' },
    });
    expect(res.status).toBe(403);
  });

  it('does not echo the configured token into 403 responses', async () => {
    const app = buildApp(TOKEN);
    const res = await app.request('/api/ping', { headers: { origin: 'null' } });
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).not.toContain(TOKEN);
    for (const [, value] of res.headers.entries()) {
      expect(value).not.toContain(TOKEN);
    }
  });

  it('allows OPTIONS preflight from null origin without a token (browser cannot send X-Seeflow-Token on preflights)', async () => {
    const app = buildApp(TOKEN);
    const res = await app.request('/api/ping', {
      method: 'OPTIONS',
      headers: {
        origin: 'null',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, x-seeflow-token',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('null');
    expect(res.headers.get('access-control-allow-headers') ?? '').toContain('X-Seeflow-Token');
  });
});

describe('createCorsMiddleware — localhost origins', () => {
  it('allows localhost:5173 without a token (dev SPA same-origin via proxy)', async () => {
    const app = buildApp(TOKEN);
    const res = await app.request('/api/ping', {
      headers: { origin: 'http://localhost:5173' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(res.headers.get('vary')).toBe('Origin');
  });

  it('allows 127.0.0.1 with any port', async () => {
    const app = buildApp(TOKEN);
    const res = await app.request('/api/ping', {
      headers: { origin: 'http://127.0.0.1:4321' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:4321');
  });

  it('allows IPv6 [::1] origins', async () => {
    const app = buildApp(TOKEN);
    const res = await app.request('/api/ping', {
      headers: { origin: 'http://[::1]:5173' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://[::1]:5173');
  });

  it('handles OPTIONS preflight from a localhost origin', async () => {
    const app = buildApp(TOKEN);
    const res = await app.request('/api/ping', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(res.headers.get('access-control-allow-methods') ?? '').toContain('POST');
  });

  it('works without a configured token (dev studio path)', async () => {
    const app = buildApp(undefined);
    const res = await app.request('/api/ping', {
      headers: { origin: 'http://localhost:5173' },
    });
    expect(res.status).toBe(200);
  });
});

describe('createCorsMiddleware — passthrough', () => {
  it('passes through with no CORS headers when Origin is absent', async () => {
    const app = buildApp(TOKEN);
    const res = await app.request('/api/ping');
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('passes a non-localhost origin through to the route handler without CORS headers', async () => {
    const app = buildApp(TOKEN);
    const res = await app.request('/api/ping', {
      headers: { origin: 'https://example.com' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
