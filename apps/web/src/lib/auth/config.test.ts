import { describe, expect, it } from 'bun:test';
import { DEFAULT_CONFIG, loadConfig, normalizeConfig } from './config.ts';

describe('normalizeConfig', () => {
  it('defaults to local mode with auth not required', () => {
    expect(normalizeConfig(undefined)).toEqual({ mode: 'local', auth: { required: false } });
    expect(normalizeConfig({})).toEqual({ mode: 'local', auth: { required: false } });
  });

  it('passes through a cloud auth descriptor', () => {
    const out = normalizeConfig({
      mode: 'cloud',
      auth: {
        required: true,
        adapterUrl: '/auth/clerk-adapter.js',
        publishableKey: 'pk_live_x',
        issuer: 'https://clerk.seeflow.dev',
      },
    });
    expect(out).toEqual({
      mode: 'cloud',
      auth: {
        required: true,
        adapterUrl: '/auth/clerk-adapter.js',
        publishableKey: 'pk_live_x',
        issuer: 'https://clerk.seeflow.dev',
      },
    });
  });

  it('drops non-string adapter/key fields and coerces required to boolean', () => {
    const out = normalizeConfig({
      mode: 'cloud',
      // @ts-expect-error exercising untrusted input
      auth: { required: 'yes', adapterUrl: 123, publishableKey: null },
    });
    expect(out.auth).toEqual({
      required: false,
      adapterUrl: undefined,
      publishableKey: undefined,
      issuer: undefined,
    });
  });
});

describe('loadConfig', () => {
  const ok = (body: unknown): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  it('returns the parsed config on 200', async () => {
    const cfg = await loadConfig(
      ok({ mode: 'cloud', auth: { required: true, adapterUrl: '/a.js' } }),
    );
    expect(cfg.mode).toBe('cloud');
    expect(cfg.auth?.required).toBe(true);
    expect(cfg.auth?.adapterUrl).toBe('/a.js');
  });

  it('degrades to local config on non-200', async () => {
    const notFound = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    expect(await loadConfig(notFound)).toEqual(DEFAULT_CONFIG);
  });

  it('degrades to local config when fetch throws', async () => {
    const boom = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await loadConfig(boom)).toEqual(DEFAULT_CONFIG);
  });
});
