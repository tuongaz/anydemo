import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { type StudioHandle, spawnStudio } from './support/studio-harness.ts';

describe('integration: healthz', () => {
  let handle: StudioHandle;

  beforeAll(async () => {
    handle = await spawnStudio();
  });

  afterAll(async () => {
    if (handle) await handle.stop();
  });

  it('GET /healthz returns { status: "ok" }', async () => {
    const res = await fetch(`${handle.baseURL}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
