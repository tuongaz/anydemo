import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { exportProjectToCloud } from '@/hooks/use-export-to-cloud';
import { strFromU8, unzipSync } from 'fflate';

const realFetch = globalThis.fetch;

type MockHandler = (
  url: string,
  init?: RequestInit,
) => { status: number; body: unknown; binary?: Uint8Array };

function installMock(handler: MockHandler) {
  globalThis.fetch = (async (
    input: Request | string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const r = handler(url, init);
    if (r.binary) {
      return new Response(r.binary.buffer as ArrayBuffer, { status: r.status });
    }
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

function assertArrayBuffer(v: unknown): asserts v is ArrayBuffer {
  if (!(v instanceof ArrayBuffer)) throw new Error('expected ArrayBuffer');
}

beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const projectMeta = {
  projectSlug: 'demo',
  name: 'Demo',
  defaultFlow: 'main',
  flows: [
    { flowSlug: 'main', name: 'Main', isDefault: true },
    { flowSlug: 'retry', name: 'Retry', isDefault: false },
  ],
};

// Mirrors the merged detail endpoint the bundle builder now reads from
// (`/api/projects/:project/flows/:flow`), wrapping the flow under `flow`.
const projectDetail = (slug: string, name: string) => ({
  id: `entry-${slug}`,
  slug: `demo/${slug}`,
  name,
  filePath: `/repo/${slug}/flow.json`,
  flow: { version: 2 as const, name, nodes: [], connectors: [] },
});

describe('exportProjectToCloud', () => {
  it('builds the multi-flow bundle and POSTs to /api/projects', async () => {
    const requests: Array<{ url: string; method?: string; headers?: Record<string, string> }> = [];
    let capturedBody: ArrayBuffer | null = null;

    installMock((url, init) => {
      const method = init?.method ?? 'GET';
      const rawHeaders = init?.headers ?? {};
      const headers: Record<string, string> = {};
      if (rawHeaders instanceof Headers) {
        rawHeaders.forEach((v, k) => {
          headers[k.toLowerCase()] = v;
        });
      } else if (!Array.isArray(rawHeaders)) {
        for (const [k, v] of Object.entries(rawHeaders)) headers[k.toLowerCase()] = String(v);
      }
      requests.push({ url, method, headers });

      if (url === '/api/projects/demo') return { status: 200, body: projectMeta };
      if (url === '/api/projects/demo/flows/main')
        return { status: 200, body: projectDetail('main', 'Main') };
      if (url === '/api/projects/demo/flows/retry')
        return { status: 200, body: projectDetail('retry', 'Retry') };
      if (url.startsWith('https://seeflow.dev/api/projects')) {
        const raw = init?.body;
        capturedBody = raw instanceof ArrayBuffer ? raw : null;
        return { status: 201, body: { url: 'https://seeflow.dev/project/uuid-abc' } };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await exportProjectToCloud(
      'demo',
      'test@example.com',
      'My Project',
      'public',
      undefined,
      ['main', 'retry'],
    );

    expect(result.shareUrl).toBe('https://seeflow.dev/project/uuid-abc');

    const cloudRequest = requests.find((r) => r.url.startsWith('https://seeflow.dev'));
    expect(cloudRequest).toBeDefined();
    if (!cloudRequest) throw new Error('cloud request not captured');
    expect(cloudRequest.url).toContain('seeflow.dev/api/projects');
    expect(cloudRequest.url).toContain('email=test%40example.com');
    expect(cloudRequest.url).toContain('name=My%20Project');
    expect(cloudRequest.url).toContain('visibility=public');
    expect(cloudRequest.method).toBe('POST');
    expect(cloudRequest.headers?.['content-type']).toBe('application/zip');

    assertArrayBuffer(capturedBody);
    const entries = unzipSync(new Uint8Array(capturedBody));
    const keys = Object.keys(entries).sort();
    expect(keys).toContain('seeflow.json');
    expect(keys).toContain('flows/main/flow.json');
    expect(keys).toContain('flows/retry/flow.json');

    const seeflowEntry = entries['seeflow.json'];
    if (!seeflowEntry) throw new Error('seeflow.json missing from zip');
    const manifest = JSON.parse(strFromU8(seeflowEntry));
    expect(manifest.name).toBe('Demo');
    expect(manifest.defaultFlow).toBe('main');
  });

  it('passes visibility through the URL query string', async () => {
    const capturedUrls: string[] = [];

    installMock((url) => {
      capturedUrls.push(url);
      if (url === '/api/projects/demo') return { status: 200, body: projectMeta };
      if (url === '/api/projects/demo/flows/main')
        return { status: 200, body: projectDetail('main', 'Main') };
      if (url === '/api/projects/demo/flows/retry')
        return { status: 200, body: projectDetail('retry', 'Retry') };
      if (url.startsWith('https://seeflow.dev/api/projects'))
        return { status: 201, body: { url: 'https://seeflow.dev/project/uuid-link' } };
      throw new Error(`Unexpected URL: ${url}`);
    });

    await exportProjectToCloud('demo', 'u@example.com', 'P', 'link', undefined, ['main', 'retry']);

    const cloudUrl = capturedUrls.find((u) => u.startsWith('https://seeflow.dev'));
    expect(cloudUrl).toBeDefined();
    expect(cloudUrl).toContain('visibility=link');
  });

  it('includes preview.png in the zip when previewDataUrl is provided', async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
    const base64 = btoa(String.fromCharCode(...pngBytes));
    let capturedBody: ArrayBuffer | null = null;

    installMock((url, init) => {
      if (url === '/api/projects/demo') return { status: 200, body: projectMeta };
      if (url === '/api/projects/demo/flows/main')
        return { status: 200, body: projectDetail('main', 'Main') };
      if (url === '/api/projects/demo/flows/retry')
        return { status: 200, body: projectDetail('retry', 'Retry') };
      if (url.startsWith('https://seeflow.dev/api/projects')) {
        const raw = init?.body;
        capturedBody = raw instanceof ArrayBuffer ? raw : null;
        return { status: 201, body: { url: 'https://seeflow.dev/project/uuid' } };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await exportProjectToCloud(
      'demo',
      'u@example.com',
      'P',
      'public',
      `data:image/png;base64,${base64}`,
      ['main', 'retry'],
    );

    assertArrayBuffer(capturedBody);
    const entries = unzipSync(new Uint8Array(capturedBody));
    expect('preview.png' in entries).toBe(true);
    expect(entries['preview.png']).toEqual(pngBytes);
  });

  it('throws when cloud API returns non-ok status', async () => {
    installMock((url) => {
      if (url === '/api/projects/demo') return { status: 200, body: projectMeta };
      if (url === '/api/projects/demo/flows/main')
        return { status: 200, body: projectDetail('main', 'Main') };
      if (url === '/api/projects/demo/flows/retry')
        return { status: 200, body: projectDetail('retry', 'Retry') };
      if (url.startsWith('https://seeflow.dev/api/projects'))
        return { status: 413, body: { error: 'too large' } };
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      exportProjectToCloud('demo', 'u@example.com', 'P', 'public', undefined, ['main', 'retry']),
    ).rejects.toThrow('Export failed with status 413');
  });

  it('throws when cloud API response is missing url field', async () => {
    installMock((url) => {
      if (url === '/api/projects/demo') return { status: 200, body: projectMeta };
      if (url === '/api/projects/demo/flows/main')
        return { status: 200, body: projectDetail('main', 'Main') };
      if (url === '/api/projects/demo/flows/retry')
        return { status: 200, body: projectDetail('retry', 'Retry') };
      if (url.startsWith('https://seeflow.dev/api/projects'))
        return { status: 201, body: { ok: true } };
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      exportProjectToCloud('demo', 'u@example.com', 'P', 'public', undefined, ['main', 'retry']),
    ).rejects.toThrow('missing url');
  });

  it('bundles only the selected flows when a subset is provided', async () => {
    let capturedBody: ArrayBuffer | null = null;
    const graphRequests: string[] = [];

    installMock((url, init) => {
      if (url === '/api/projects/demo') return { status: 200, body: projectMeta };
      if (url.startsWith('/api/projects/demo/flows/')) graphRequests.push(url);
      if (url === '/api/projects/demo/flows/main')
        return { status: 200, body: projectDetail('main', 'Main') };
      if (url === '/api/projects/demo/flows/retry')
        return { status: 200, body: projectDetail('retry', 'Retry') };
      if (url.startsWith('https://seeflow.dev/api/projects')) {
        const raw = init?.body;
        capturedBody = raw instanceof ArrayBuffer ? raw : null;
        return { status: 201, body: { url: 'https://seeflow.dev/project/uuid-subset' } };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await exportProjectToCloud('demo', 'u@example.com', 'P', 'public', undefined, ['retry']);

    expect(graphRequests).toEqual(['/api/projects/demo/flows/retry']);

    assertArrayBuffer(capturedBody);
    const entries = unzipSync(new Uint8Array(capturedBody));
    expect(Object.keys(entries).sort()).toEqual(['flows/retry/flow.json', 'seeflow.json']);

    const seeflowEntry = entries['seeflow.json'];
    if (!seeflowEntry) throw new Error('seeflow.json missing from zip');
    const manifest = JSON.parse(strFromU8(seeflowEntry));
    expect(manifest.flows).toEqual([{ id: 'retry', name: 'Retry' }]);
    // defaultFlow was 'main' in meta; falls back to 'retry' because that's the only selected slug.
    expect(manifest.defaultFlow).toBe('retry');
  });
});
