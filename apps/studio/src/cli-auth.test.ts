import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLogin, runLogout, runWhoami } from './cli-auth.ts';
import { DEFAULT_CLOUD_ENDPOINT, loadCredential, saveCredential } from './credentials.ts';

describe('cli auth verbs', () => {
  let dir: string;
  const origXdg = process.env.XDG_CONFIG_HOME;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'seeflow-cliauth-'));
    process.env.XDG_CONFIG_HOME = dir;
  });
  afterEach(() => {
    if (origXdg === undefined) Reflect.deleteProperty(process.env, 'XDG_CONFIG_HOME');
    else process.env.XDG_CONFIG_HOME = origXdg;
    rmSync(dir, { recursive: true, force: true });
  });

  it('runLogin persists the token returned via the loopback callback', async () => {
    const out = await runLogin({
      endpoint: DEFAULT_CLOUD_ENDPOINT,
      // The fake "browser" drives the loopback callback the cloud SPA would hit.
      openBrowser: async (loginUrl) => {
        const u = new URL(loginUrl);
        const port = u.searchParams.get('port');
        const state = u.searchParams.get('state');
        await fetch(
          `http://127.0.0.1:${port}/callback?state=${state}&token=ctok_abc&userId=u1&email=u1%40x.dev`,
        );
      },
    });
    expect(out).toMatchObject({ ok: true, userId: 'u1' });
    expect(loadCredential(DEFAULT_CLOUD_ENDPOINT)?.token).toBe('ctok_abc');
  });

  it('runWhoami reports the stored identity', () => {
    saveCredential({
      endpoint: DEFAULT_CLOUD_ENDPOINT,
      token: 't',
      userId: 'u9',
      email: 'u9@x.dev',
    });
    expect(runWhoami(DEFAULT_CLOUD_ENDPOINT)).toMatchObject({
      loggedIn: true,
      userId: 'u9',
      email: 'u9@x.dev',
    });
  });

  it('runWhoami reports logged-out when no credential', () => {
    expect(runWhoami(DEFAULT_CLOUD_ENDPOINT)).toEqual({ loggedIn: false });
  });

  it('runLogout clears the credential', () => {
    saveCredential({ endpoint: DEFAULT_CLOUD_ENDPOINT, token: 't' });
    runLogout(DEFAULT_CLOUD_ENDPOINT);
    expect(loadCredential(DEFAULT_CLOUD_ENDPOINT)).toBeUndefined();
  });
});
