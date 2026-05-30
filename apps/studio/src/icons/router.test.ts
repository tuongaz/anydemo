import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import type { InstallEvent } from './installer-types.ts';
import { createJobRegistry } from './jobs.ts';
import { createIconsRouter } from './router.ts';

let cache: string;
beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), 'sf-icons-router-'));
});
afterEach(() => {
  rmSync(cache, { recursive: true, force: true });
});

function makeAwsZipBuffer(): Buffer {
  const zip = zipSync({
    'Arch_AWS-Lambda_64.svg': strToU8('<svg>lambda</svg>'),
    'Arch_Amazon-S3_64.svg': strToU8('<svg>s3</svg>'),
  });
  return Buffer.from(zip);
}

// Wait for the install job to mark complete. Uses subscribe's onEnd hook —
// fires immediately if the job is already complete by the time subscribe runs.
function waitForJobEnd(
  jobs: ReturnType<typeof createJobRegistry>,
  jobId: string,
): Promise<InstallEvent[]> {
  return new Promise((resolve) => {
    const captured: InstallEvent[] = [];
    const off = jobs.subscribe(
      jobId,
      (ev) => captured.push(ev),
      () => {
        off();
        resolve(captured);
      },
    );
  });
}

describe('createIconsRouter', () => {
  it('GET /packs returns the two uninstalled vendors on fresh cacheRoot', async () => {
    const jobs = createJobRegistry();
    const app = createIconsRouter({ jobs, cacheRoot: cache });
    const res = await app.request('/packs');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { packs: Array<{ vendor: string; installed: boolean }> };
    expect(body.packs.map((p) => p.vendor)).toEqual(['aws', 'azure']);
    expect(body.packs.every((p) => p.installed === false)).toBe(true);
  });

  it('GET /licenses/:vendor returns the descriptor for known vendors and 404s otherwise', async () => {
    const jobs = createJobRegistry();
    const app = createIconsRouter({ jobs, cacheRoot: cache });
    const ok = await app.request('/licenses/aws');
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as {
      vendor: string;
      label: string;
      summary: string;
      url: string;
      requiresAcceptance: boolean;
    };
    expect(body.vendor).toBe('aws');
    expect(body.url).toContain('aws.amazon.com');
    expect(typeof body.summary).toBe('string');

    const bad = await app.request('/licenses/bogus');
    expect(bad.status).toBe(404);
  });

  it('POST /install + SSE replay + GET /packs + GET /:vendor/:name.svg pipeline', async () => {
    const jobs = createJobRegistry();
    const app = createIconsRouter({
      jobs,
      cacheRoot: cache,
      fetcher: async () => makeAwsZipBuffer(),
    });

    const postRes = await app.request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vendor: 'aws', acceptTerms: true }),
    });
    expect(postRes.status).toBe(200);
    const { jobId } = (await postRes.json()) as { jobId: string };
    expect(typeof jobId).toBe('string');

    // Wait for the fire-and-forget install to finish so SSE replay covers all events.
    await waitForJobEnd(jobs, jobId);

    const sseRes = await app.request(`/jobs/${jobId}/events`);
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get('content-type') ?? '').toContain('text/event-stream');
    const text = await sseRes.text();
    const events = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => JSON.parse(l.slice('data:'.length).trim()) as InstallEvent);
    expect(events.map((e) => e.type)).toContain('done');
    expect(events.at(-1)?.type).toBe('done');

    const packsRes = await app.request('/packs');
    const packsBody = (await packsRes.json()) as {
      packs: Array<{ vendor: string; installed: boolean }>;
    };
    expect(packsBody.packs.find((p) => p.vendor === 'aws')?.installed).toBe(true);

    const svgRes = await app.request('/aws/lambda.svg');
    expect(svgRes.status).toBe(200);
    expect(svgRes.headers.get('content-type')).toBe('image/svg+xml');
    expect(svgRes.headers.get('cache-control') ?? '').toContain('immutable');
    expect(await svgRes.text()).toBe('<svg>lambda</svg>');

    const missingSvgRes = await app.request('/aws/no-such-icon.svg');
    expect(missingSvgRes.status).toBe(404);
    const missingBody = (await missingSvgRes.json()) as { install?: string };
    expect(missingBody.install).toContain('POST /api/icons/install');
  });

  it('POST /install rejects parallel install for the same vendor with 409 + existing jobId', async () => {
    const jobs = createJobRegistry();
    // Block the installer's fetcher so the first job stays in-flight while the
    // second POST races in.
    let release: () => void = () => undefined;
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    const app = createIconsRouter({
      jobs,
      cacheRoot: cache,
      fetcher: async () => {
        await blocker;
        return makeAwsZipBuffer();
      },
    });

    const first = await app.request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vendor: 'aws', acceptTerms: true }),
    });
    expect(first.status).toBe(200);
    const { jobId: firstId } = (await first.json()) as { jobId: string };

    const second = await app.request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vendor: 'aws', acceptTerms: true }),
    });
    expect(second.status).toBe(409);
    const secondBody = (await second.json()) as { jobId: string; error: string };
    expect(secondBody.jobId).toBe(firstId);

    release();
    await waitForJobEnd(jobs, firstId);
  });

  it('POST /install with malformed body returns 400', async () => {
    const jobs = createJobRegistry();
    const app = createIconsRouter({ jobs, cacheRoot: cache });
    const bad = await app.request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vendor: 'nope' }),
    });
    expect(bad.status).toBe(400);

    const noBody = await app.request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(noBody.status).toBe(400);
  });

  it('DELETE /packs/:vendor removes a vendor pack and flips its summary to uninstalled', async () => {
    const jobs = createJobRegistry();
    const app = createIconsRouter({
      jobs,
      cacheRoot: cache,
      fetcher: async () => makeAwsZipBuffer(),
    });
    const installRes = await app.request('/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vendor: 'aws', acceptTerms: true }),
    });
    const { jobId } = (await installRes.json()) as { jobId: string };
    await waitForJobEnd(jobs, jobId);

    const del = await app.request('/packs/aws', { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ removed: 'aws' });

    const packs = (await (await app.request('/packs')).json()) as {
      packs: Array<{ vendor: string; installed: boolean }>;
    };
    expect(packs.packs.find((p) => p.vendor === 'aws')?.installed).toBe(false);
  });

  it('DELETE /packs/:vendor with unknown vendor returns 404', async () => {
    const jobs = createJobRegistry();
    const app = createIconsRouter({ jobs, cacheRoot: cache });
    const res = await app.request('/packs/bogus', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
