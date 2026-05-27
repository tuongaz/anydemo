import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { exportProjectToCloud, exportToCloud } from '@/hooks/use-export-to-cloud';
import type { Flow, FlowDetail } from '@/lib/api';
import { strFromU8, unzipSync } from 'fflate';

const realFetch = globalThis.fetch;

const emptyDemo: Flow = { version: 2, name: 'Test', nodes: [], connectors: [] };

function makeDetail(flow: Flow | null = emptyDemo): FlowDetail {
  return {
    id: 'proj-1',
    slug: 'test',
    name: 'Test',
    filePath: '/f',
    flow,
    valid: true,
    error: null,
  };
}

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

describe('exportToCloud', () => {
  it('fetches demo, posts zip to cloud, returns shareUrl', async () => {
    const requests: Array<{ url: string; method?: string; headers?: Record<string, string> }> = [];

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

      if (url.startsWith('/api/projects/') && url.includes('/flows/') && !url.includes('/files/')) {
        return { status: 200, body: makeDetail() };
      }
      if (url.includes('seeflow.dev')) {
        return { status: 201, body: { url: 'https://seeflow.dev/flow/uuid-123' } };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await exportToCloud('proj-1', 'main', 'test@example.com', 'My Flow', 'public');

    expect(result.shareUrl).toBe('https://seeflow.dev/flow/uuid-123');
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe('/api/projects/proj-1/flows/main');
    expect(requests[1]?.url).toContain('seeflow.dev/api/flows');
    expect(requests[1]?.url).toContain('email=test%40example.com');
    expect(requests[1]?.method).toBe('POST');
    expect(requests[1]?.headers?.['content-type']).toBe('application/zip');
  });

  it('includes flow.json in the zip', async () => {
    let capturedBody: ArrayBuffer | null = null;

    installMock((url, init) => {
      if (url.startsWith('/api/projects/') && url.includes('/flows/') && !url.includes('/files/'))
        return { status: 200, body: makeDetail() };
      if (url.includes('seeflow.dev')) {
        const raw = init?.body;
        capturedBody = raw instanceof ArrayBuffer ? raw : null;
        return { status: 201, body: { url: 'https://seeflow.dev/flow/abc' } };
      }
      throw new Error(`Unexpected: ${url}`);
    });

    await exportToCloud('proj-1', 'main', 'test@example.com', 'My Flow', 'public');

    assertArrayBuffer(capturedBody);
    const entries = unzipSync(new Uint8Array(capturedBody));
    expect('flow.json' in entries).toBe(true);
    const seeflowEntry = entries['flow.json'];
    if (!seeflowEntry) throw new Error('flow.json missing from zip');
    const parsed = JSON.parse(strFromU8(seeflowEntry));
    expect(parsed.name).toBe('Test');
  });

  it("fetches type:'image' files and includes them under files/ in the zip", async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    const demo: Flow = {
      version: 2,
      name: 'Img Flow',
      nodes: [
        { id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { path: 'assets/img.png' } },
      ],
      connectors: [],
    };
    let capturedBody: ArrayBuffer | null = null;
    const requests: string[] = [];

    installMock((url, init) => {
      requests.push(url);
      if (url === '/api/projects/proj-1/flows/main') return { status: 200, body: makeDetail(demo) };
      if (url.includes('/api/projects/') && url.includes('/files/')) {
        return { status: 200, body: null, binary: pngBytes };
      }
      if (url.includes('seeflow.dev')) {
        const raw = init?.body;
        capturedBody = raw instanceof ArrayBuffer ? raw : null;
        return { status: 201, body: { url: 'https://seeflow.dev/flow/abc' } };
      }
      throw new Error(`Unexpected: ${url}`);
    });

    await exportToCloud('proj-1', 'main', 'test@example.com', 'Img Flow', 'public');

    expect(requests).toHaveLength(3);
    expect(requests[1]).toContain('/api/projects/proj-1/files/assets/img.png');

    assertArrayBuffer(capturedBody);
    const entries = unzipSync(new Uint8Array(capturedBody));
    expect('files/assets/img.png' in entries).toBe(true);
    expect(entries['files/assets/img.png']).toEqual(pngBytes);
  });

  it("inlines type:'html' content into flow.json without bundling files/ (resolver inlined it)", async () => {
    const demo: Flow = {
      version: 2,
      name: 'Html Flow',
      nodes: [
        {
          id: 'n1',
          type: 'html',
          position: { x: 0, y: 0 },
          data: { html: '<p>inlined</p>', name: 'Widget' },
        },
      ],
      connectors: [],
    };
    let capturedBody: ArrayBuffer | null = null;
    const requests: string[] = [];

    installMock((url, init) => {
      requests.push(url);
      if (url === '/api/projects/proj-1/flows/main') return { status: 200, body: makeDetail(demo) };
      if (url.includes('seeflow.dev')) {
        const raw = init?.body;
        capturedBody = raw instanceof ArrayBuffer ? raw : null;
        return { status: 201, body: { url: 'https://seeflow.dev/flow/abc' } };
      }
      throw new Error(`Unexpected: ${url}`);
    });

    await exportToCloud('proj-1', 'main', 'test@example.com', 'Html Flow', 'public');

    // No file bundling needed for type:'html' — content rides inside flow.json.
    expect(requests.some((u) => u.includes('/files/'))).toBe(false);
    assertArrayBuffer(capturedBody);
    const entries = unzipSync(new Uint8Array(capturedBody));
    expect('flow.json' in entries).toBe(true);
    // The inlined HTML round-trips through the zip's flow.json.
    const flowText = new TextDecoder().decode(entries['flow.json']);
    expect(flowText).toContain('inlined');
  });

  it('deduplicates file paths when multiple nodes reference the same file', async () => {
    const demo: Flow = {
      version: 2,
      name: 'Dup Flow',
      nodes: [
        {
          id: 'n1',
          type: 'image',
          position: { x: 0, y: 0 },
          data: { path: 'assets/shared.png' },
        },
        {
          id: 'n2',
          type: 'image',
          position: { x: 100, y: 0 },
          data: { path: 'assets/shared.png' },
        },
      ],
      connectors: [],
    };
    const fileRequests: string[] = [];

    installMock((url) => {
      if (url === '/api/projects/proj-1/flows/main') return { status: 200, body: makeDetail(demo) };
      if (url.includes('/api/projects/')) {
        fileRequests.push(url);
        return { status: 200, body: null, binary: new Uint8Array([0]) };
      }
      if (url.includes('seeflow.dev'))
        return { status: 201, body: { url: 'https://seeflow.dev/flow/x' } };
      throw new Error(`Unexpected: ${url}`);
    });

    await exportToCloud('proj-1', 'main', 'test@example.com', 'Dup Flow', 'public');
    expect(fileRequests).toHaveLength(1);
  });

  it('skips files that return a non-ok status', async () => {
    const demo: Flow = {
      version: 2,
      name: 'Missing Flow',
      nodes: [
        {
          id: 'n1',
          type: 'image',
          position: { x: 0, y: 0 },
          data: { path: 'assets/missing.png' },
        },
      ],
      connectors: [],
    };
    let capturedBody: ArrayBuffer | null = null;

    installMock((url, init) => {
      if (url === '/api/projects/proj-1/flows/main') return { status: 200, body: makeDetail(demo) };
      if (url.includes('/api/projects/')) return { status: 404, body: { error: 'not found' } };
      if (url.includes('seeflow.dev')) {
        const raw = init?.body;
        capturedBody = raw instanceof ArrayBuffer ? raw : null;
        return { status: 201, body: { url: 'https://seeflow.dev/flow/x' } };
      }
      throw new Error(`Unexpected: ${url}`);
    });

    await exportToCloud('proj-1', 'main', 'test@example.com', 'Missing Flow', 'public');

    assertArrayBuffer(capturedBody);
    const entries = unzipSync(new Uint8Array(capturedBody));
    expect('flow.json' in entries).toBe(true);
    expect('files/assets/missing.png' in entries).toBe(false);
  });

  it('throws when demo is null', async () => {
    installMock((url) => {
      if (url === '/api/projects/proj-1/flows/main') return { status: 200, body: makeDetail(null) };
      throw new Error(`Unexpected: ${url}`);
    });

    await expect(
      exportToCloud('proj-1', 'main', 'test@example.com', 'Null Flow', 'public'),
    ).rejects.toThrow('Flow has no data');
  });

  it('throws when cloud API returns non-ok status', async () => {
    installMock((url) => {
      if (url.startsWith('/api/projects/') && url.includes('/flows/') && !url.includes('/files/'))
        return { status: 200, body: makeDetail() };
      if (url.includes('seeflow.dev')) return { status: 413, body: { error: 'too large' } };
      throw new Error(`Unexpected: ${url}`);
    });

    await expect(
      exportToCloud('proj-1', 'main', 'test@example.com', 'Too Large', 'public'),
    ).rejects.toThrow('Export failed with status 413');
  });

  it('includes preview.png in the zip when previewDataUrl is provided', async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
    const base64 = btoa(String.fromCharCode(...pngBytes));
    const previewDataUrl = `data:image/png;base64,${base64}`;
    let capturedBody: ArrayBuffer | null = null;

    installMock((url, init) => {
      if (url.startsWith('/api/projects/') && url.includes('/flows/') && !url.includes('/files/'))
        return { status: 200, body: makeDetail() };
      if (url.includes('seeflow.dev')) {
        const raw = init?.body;
        capturedBody = raw instanceof ArrayBuffer ? raw : null;
        return { status: 201, body: { url: 'https://seeflow.dev/flow/abc' } };
      }
      throw new Error(`Unexpected: ${url}`);
    });

    await exportToCloud(
      'proj-1',
      'main',
      'test@example.com',
      'Preview Flow',
      'public',
      previewDataUrl,
    );

    assertArrayBuffer(capturedBody);
    const entries = unzipSync(new Uint8Array(capturedBody));
    expect('preview.png' in entries).toBe(true);
    expect(entries['preview.png']).toEqual(pngBytes);
  });

  it('omits preview.png from the zip when previewDataUrl is not provided', async () => {
    let capturedBody: ArrayBuffer | null = null;

    installMock((url, init) => {
      if (url.startsWith('/api/projects/') && url.includes('/flows/') && !url.includes('/files/'))
        return { status: 200, body: makeDetail() };
      if (url.includes('seeflow.dev')) {
        const raw = init?.body;
        capturedBody = raw instanceof ArrayBuffer ? raw : null;
        return { status: 201, body: { url: 'https://seeflow.dev/flow/abc' } };
      }
      throw new Error(`Unexpected: ${url}`);
    });

    await exportToCloud('proj-1', 'main', 'test@example.com', 'No Preview', 'public');

    assertArrayBuffer(capturedBody);
    const entries = unzipSync(new Uint8Array(capturedBody));
    expect('preview.png' in entries).toBe(false);
  });

  it('throws when cloud API response is missing url field', async () => {
    installMock((url) => {
      if (url.startsWith('/api/projects/') && url.includes('/flows/') && !url.includes('/files/'))
        return { status: 200, body: makeDetail() };
      if (url.includes('seeflow.dev')) return { status: 201, body: { ok: true } };
      throw new Error(`Unexpected: ${url}`);
    });

    await expect(
      exportToCloud('proj-1', 'main', 'test@example.com', 'Missing URL', 'public'),
    ).rejects.toThrow('missing url');
  });

  it("visibility 'link' produces flow.private.json in zip instead of flow.json", async () => {
    let capturedBody: ArrayBuffer | null = null;

    installMock((url, init) => {
      if (url.startsWith('/api/projects/') && url.includes('/flows/') && !url.includes('/files/'))
        return { status: 200, body: makeDetail() };
      if (url.includes('seeflow.dev')) {
        const raw = init?.body;
        capturedBody = raw instanceof ArrayBuffer ? raw : null;
        return { status: 201, body: { url: 'https://seeflow.dev/flow/abc' } };
      }
      throw new Error(`Unexpected: ${url}`);
    });

    await exportToCloud('proj-1', 'main', 'test@example.com', 'Private Flow', 'link');

    assertArrayBuffer(capturedBody);
    const entries = unzipSync(new Uint8Array(capturedBody));
    expect('flow.private.json' in entries).toBe(true);
    expect('flow.json' in entries).toBe(false);
  });

  it('name appears in cloud API URL query params', async () => {
    const capturedUrls: string[] = [];

    installMock((url) => {
      capturedUrls.push(url);
      if (url.startsWith('/api/projects/') && url.includes('/flows/') && !url.includes('/files/'))
        return { status: 200, body: makeDetail() };
      if (url.includes('seeflow.dev'))
        return { status: 201, body: { url: 'https://seeflow.dev/flow/abc' } };
      throw new Error(`Unexpected: ${url}`);
    });

    await exportToCloud('proj-1', 'main', 'user@example.com', 'My Awesome Flow', 'public');

    const cloudUrl = capturedUrls.find((u) => u.includes('seeflow.dev'));
    expect(cloudUrl).toBeDefined();
    expect(cloudUrl).toContain('name=My%20Awesome%20Flow');
  });
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

const projectGraph = (slug: string, name: string) => ({
  id: `entry-${slug}`,
  slug: `demo/${slug}`,
  name,
  nodes: [],
  connectors: [],
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
      if (url === '/api/projects/demo/flows/main/graph')
        return { status: 200, body: projectGraph('main', 'Main') };
      if (url === '/api/projects/demo/flows/retry/graph')
        return { status: 200, body: projectGraph('retry', 'Retry') };
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
      if (url === '/api/projects/demo/flows/main/graph')
        return { status: 200, body: projectGraph('main', 'Main') };
      if (url === '/api/projects/demo/flows/retry/graph')
        return { status: 200, body: projectGraph('retry', 'Retry') };
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
      if (url === '/api/projects/demo/flows/main/graph')
        return { status: 200, body: projectGraph('main', 'Main') };
      if (url === '/api/projects/demo/flows/retry/graph')
        return { status: 200, body: projectGraph('retry', 'Retry') };
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
      if (url === '/api/projects/demo/flows/main/graph')
        return { status: 200, body: projectGraph('main', 'Main') };
      if (url === '/api/projects/demo/flows/retry/graph')
        return { status: 200, body: projectGraph('retry', 'Retry') };
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
      if (url === '/api/projects/demo/flows/main/graph')
        return { status: 200, body: projectGraph('main', 'Main') };
      if (url === '/api/projects/demo/flows/retry/graph')
        return { status: 200, body: projectGraph('retry', 'Retry') };
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
      if (url.includes('/graph')) graphRequests.push(url);
      if (url === '/api/projects/demo/flows/main/graph')
        return { status: 200, body: projectGraph('main', 'Main') };
      if (url === '/api/projects/demo/flows/retry/graph')
        return { status: 200, body: projectGraph('retry', 'Retry') };
      if (url.startsWith('https://seeflow.dev/api/projects')) {
        const raw = init?.body;
        capturedBody = raw instanceof ArrayBuffer ? raw : null;
        return { status: 201, body: { url: 'https://seeflow.dev/project/uuid-subset' } };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await exportProjectToCloud('demo', 'u@example.com', 'P', 'public', undefined, ['retry']);

    expect(graphRequests).toEqual(['/api/projects/demo/flows/retry/graph']);

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
