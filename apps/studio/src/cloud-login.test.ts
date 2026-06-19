import { describe, expect, it } from 'bun:test';
import { startLoopbackLogin } from './cloud-login.ts';

describe('startLoopbackLogin', () => {
  it('builds a /cli/login URL carrying the port and state, then resolves on a matching callback', async () => {
    const session = await startLoopbackLogin({ endpoint: 'https://cloud.seeflow.dev' });
    const url = new URL(session.loginUrl);
    expect(url.pathname).toBe('/cli/login');
    expect(url.searchParams.get('port')).toBe(String(session.port));
    const state = url.searchParams.get('state');
    expect(state && state.length).toBeGreaterThan(10);

    // Simulate the cloud SPA POSTing the token back to the loopback callback.
    const cb = `http://127.0.0.1:${session.port}/callback?state=${state}&token=ctok_123&userId=u1&email=u1%40x.dev`;
    const res = await fetch(cb);
    expect(res.status).toBe(200);

    const result = await session.result;
    expect(result).toMatchObject({ token: 'ctok_123', userId: 'u1', email: 'u1@x.dev' });
  });

  it('rejects a callback whose state does not match (CSRF guard)', async () => {
    const session = await startLoopbackLogin({ endpoint: 'https://cloud.seeflow.dev' });
    const res = await fetch(`http://127.0.0.1:${session.port}/callback?state=WRONG&token=x`);
    expect(res.status).toBe(400);
    session.close();
  });
});
