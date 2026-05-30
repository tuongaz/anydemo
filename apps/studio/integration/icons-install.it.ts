import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import type { IconFetcher } from '../src/icons/router.ts';
import { createApp } from '../src/server.ts';
import { connectSse } from './support/sse-client.ts';

// Boot the full studio HTTP stack in-process so the install pipeline goes
// through real fetch + SSE, not just `app.request`. We inject an iconFetcher
// (so the test owns the ZIP bytes — no network) and an isolated iconCacheRoot
// (so each test gets a fresh on-disk state).
interface IconTestStudio {
  baseURL: string;
  cacheRoot: string;
  stop: () => Promise<void>;
}

function makeAwsZipBuffer(): Buffer {
  const zip = zipSync({
    'Arch_AWS-Lambda_64.svg': strToU8('<svg>lambda</svg>'),
  });
  return Buffer.from(zip);
}

function makeGcpZipBuffer(): Buffer {
  const zip = zipSync({
    'Cloud Functions.svg': strToU8('<svg>cloud-functions</svg>'),
    'Cloud Run.svg': strToU8('<svg>cloud-run</svg>'),
  });
  return Buffer.from(zip);
}

function startIconStudio(fetcher: IconFetcher): IconTestStudio {
  const cacheRoot = mkdtempSync(join(tmpdir(), 'sf-icons-it-'));
  const app = createApp({
    mode: 'prod',
    // Skip serving the SPA bundle; tests only hit /api/icons/*.
    staticRoot: join(cacheRoot, '__nosuch_static__'),
    disableWatcher: true,
    iconCacheRoot: cacheRoot,
    iconFetcher: fetcher,
  });
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: app.fetch });
  const baseURL = `http://127.0.0.1:${server.port}`;
  return {
    baseURL,
    cacheRoot,
    stop: async () => {
      server.stop(true);
      try {
        rmSync(cacheRoot, { recursive: true, force: true });
      } catch {
        /* nothing to clean */
      }
    },
  };
}

describe('integration: icons/install pipeline via HTTP + SSE', () => {
  let studio: IconTestStudio;

  beforeAll(() => {
    studio = startIconStudio(async () => makeAwsZipBuffer());
  });

  afterAll(async () => {
    await studio.stop();
  });

  it('POST /install → SSE done → /packs flips → /aws/lambda.svg serves the fixture', async () => {
    const postRes = await fetch(`${studio.baseURL}/api/icons/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vendor: 'aws', acceptTerms: true }),
    });
    expect(postRes.status).toBe(200);
    const { jobId } = (await postRes.json()) as { jobId: string };
    expect(typeof jobId).toBe('string');

    // Stream the SSE feed — the handler replays buffered events and closes when
    // the install completes (markComplete → onEnd → loop exit). awaiting
    // res.text() therefore returns the full ordered transcript.
    const sse = await connectSse(studio.baseURL, `/api/icons/jobs/${jobId}/events`);
    try {
      await sse.waitFor((e) => {
        try {
          return (JSON.parse(e.data) as { type: string }).type === 'done';
        } catch {
          return false;
        }
      }, 5_000);
    } finally {
      sse.close();
    }

    const eventTypes = sse.events.map((e) => (JSON.parse(e.data) as { type: string }).type);
    expect(eventTypes).toContain('download-started');
    expect(eventTypes).toContain('done');

    const packsRes = await fetch(`${studio.baseURL}/api/icons/packs`);
    expect(packsRes.status).toBe(200);
    const packsBody = (await packsRes.json()) as {
      packs: Array<{ vendor: string; installed: boolean }>;
    };
    expect(packsBody.packs.find((p) => p.vendor === 'aws')?.installed).toBe(true);

    const svgRes = await fetch(`${studio.baseURL}/api/icons/aws/lambda.svg`);
    expect(svgRes.status).toBe(200);
    expect(svgRes.headers.get('content-type')).toBe('image/svg+xml');
    expect(await svgRes.text()).toBe('<svg>lambda</svg>');
  });
});

describe('integration: icons/install pipeline for GCP via HTTP + SSE', () => {
  let studio: IconTestStudio;

  beforeAll(() => {
    studio = startIconStudio(async () => makeGcpZipBuffer());
  });

  afterAll(async () => {
    await studio.stop();
  });

  it('POST /install gcp → SSE done → /packs flips → /gcp/cloud-functions.svg serves the fixture', async () => {
    const postRes = await fetch(`${studio.baseURL}/api/icons/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vendor: 'gcp' }),
    });
    expect(postRes.status).toBe(200);
    const { jobId } = (await postRes.json()) as { jobId: string };
    expect(typeof jobId).toBe('string');

    const sse = await connectSse(studio.baseURL, `/api/icons/jobs/${jobId}/events`);
    try {
      await sse.waitFor((e) => {
        try {
          return (JSON.parse(e.data) as { type: string }).type === 'done';
        } catch {
          return false;
        }
      }, 5_000);
    } finally {
      sse.close();
    }

    const eventTypes = sse.events.map((e) => (JSON.parse(e.data) as { type: string }).type);
    expect(eventTypes).toContain('download-started');
    expect(eventTypes).toContain('done');

    const packsRes = await fetch(`${studio.baseURL}/api/icons/packs`);
    expect(packsRes.status).toBe(200);
    const packsBody = (await packsRes.json()) as {
      packs: Array<{ vendor: string; installed: boolean }>;
    };
    expect(packsBody.packs.find((p) => p.vendor === 'gcp')?.installed).toBe(true);

    const svgRes = await fetch(`${studio.baseURL}/api/icons/gcp/cloud-functions.svg`);
    expect(svgRes.status).toBe(200);
    expect(svgRes.headers.get('content-type')).toBe('image/svg+xml');
    expect(await svgRes.text()).toBe('<svg>cloud-functions</svg>');
  });
});

describe('integration: icons/install concurrency rejects parallel installs with 409', () => {
  let studio: IconTestStudio;
  let release: () => void = () => undefined;

  beforeAll(() => {
    // Block the fetcher until the test releases it so two POSTs can race the
    // same vendor while the first job is still in-flight.
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    studio = startIconStudio(async () => {
      await blocker;
      return makeAwsZipBuffer();
    });
  });

  afterAll(async () => {
    release();
    await studio.stop();
  });

  it('second POST returns 409 with the first install jobId', async () => {
    const first = await fetch(`${studio.baseURL}/api/icons/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vendor: 'aws', acceptTerms: true }),
    });
    expect(first.status).toBe(200);
    const { jobId: firstId } = (await first.json()) as { jobId: string };

    const second = await fetch(`${studio.baseURL}/api/icons/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vendor: 'aws', acceptTerms: true }),
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { jobId?: string; error?: string };
    expect(body.jobId).toBe(firstId);
    expect(typeof body.error).toBe('string');
  });
});
