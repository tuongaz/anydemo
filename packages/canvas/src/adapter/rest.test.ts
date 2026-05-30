import { describe, expect, it } from 'bun:test';
import { createRestAdapter } from './rest.ts';
import type { InstallEvent } from './types.ts';

interface FetchCall {
  url: string;
  method?: string;
  body?: BodyInit | null;
  headers?: Record<string, string>;
}

const headersToObject = (init: HeadersInit | undefined): Record<string, string> => {
  if (!init) return {};
  if (init instanceof Headers) {
    const out: Record<string, string> = {};
    init.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(init)) {
    return Object.fromEntries(init);
  }
  return { ...init };
};

const stubResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const stubFetch = (handler: (call: FetchCall) => Response) => {
  const calls: FetchCall[] = [];
  const fn = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const call: FetchCall = {
      url,
      method: init?.method,
      body: init?.body ?? null,
      headers: headersToObject(init?.headers),
    };
    calls.push(call);
    return handler(call);
  };
  // Bun's `typeof fetch` includes a static `preconnect` member; cast to
  // satisfy the adapter's `fetch?: typeof fetch` option without polyfilling.
  const impl = fn as unknown as typeof fetch;
  return { impl, calls };
};

describe('createRestAdapter (US-009)', () => {
  it('createNode POSTs the input to /api/projects/:project/flows/:flow/nodes and returns the server-issued id + node', async () => {
    const { impl, calls } = stubFetch(() =>
      stubResponse({
        ok: true,
        id: 'server-id',
        node: { id: 'server-id', type: 'rectangle', position: { x: 10, y: 20 } },
      }),
    );
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'demo-42',
      flow: 'main',
      fetch: impl,
    });

    const result = await adapter.createNode({
      type: 'rectangle',
      position: { x: 10, y: 20 },
      data: { name: 'Hello' },
    });

    expect(result.id).toBe('server-id');
    expect(result.node).toEqual({ id: 'server-id', type: 'rectangle', position: { x: 10, y: 20 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/projects/demo-42/flows/main/nodes');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers?.['content-type']).toBe('application/json');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      type: 'rectangle',
      position: { x: 10, y: 20 },
      data: { name: 'Hello' },
    });
  });

  it('updateNode PATCHes the patch body to /api/projects/:project/flows/:flow/nodes/:nodeId', async () => {
    const { impl, calls } = stubFetch(() => stubResponse({ ok: true }));
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'demo-42',
      flow: 'main',
      fetch: impl,
    });

    await adapter.updateNode('node-a', { name: 'Renamed', borderColor: 'blue' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/projects/demo-42/flows/main/nodes/node-a');
    expect(calls[0]?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ name: 'Renamed', borderColor: 'blue' });
  });

  it('updateNodePosition PATCHes the /position endpoint and returns the server result', async () => {
    const { impl, calls } = stubFetch(() => stubResponse({ ok: true, position: { x: 50, y: 60 } }));
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'demo-42',
      flow: 'main',
      fetch: impl,
    });

    const result = await adapter.updateNodePosition('node-a', { x: 50, y: 60 });

    expect(result).toEqual({ ok: true, position: { x: 50, y: 60 } });
    expect(calls[0]?.url).toBe('/api/projects/demo-42/flows/main/nodes/node-a/position');
    expect(calls[0]?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ x: 50, y: 60 });
  });

  it('deleteNode DELETEs /api/projects/:project/flows/:flow/nodes/:nodeId with no body', async () => {
    const { impl, calls } = stubFetch(() => stubResponse({ ok: true }));
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'demo-42',
      flow: 'main',
      fetch: impl,
    });

    await adapter.deleteNode('node-a');

    expect(calls[0]?.url).toBe('/api/projects/demo-42/flows/main/nodes/node-a');
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.body).toBeNull();
  });

  it('createConnector POSTs to /api/projects/:project/flows/:flow/connectors and returns the server-issued id', async () => {
    const { impl, calls } = stubFetch(() => stubResponse({ ok: true, id: 'conn-1' }));
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'demo-42',
      flow: 'main',
      fetch: impl,
    });

    const result = await adapter.createConnector({ source: 'a', target: 'b' });

    expect(result).toEqual({ id: 'conn-1' });
    expect(calls[0]?.url).toBe('/api/projects/demo-42/flows/main/connectors');
    expect(calls[0]?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ source: 'a', target: 'b' });
  });

  it('reorderNode PATCHes the order op to /nodes/:nodeId/order', async () => {
    const { impl, calls } = stubFetch(() => stubResponse({ ok: true }));
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'demo-42',
      flow: 'main',
      fetch: impl,
    });

    await adapter.reorderNode('node-a', { op: 'toFront' });

    expect(calls[0]?.url).toBe('/api/projects/demo-42/flows/main/nodes/node-a/order');
    expect(calls[0]?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ op: 'toFront' });
  });

  it('uploadImage POSTs FormData to the per-node /files/upload endpoint under the flow-scoped path', async () => {
    const { impl, calls } = stubFetch(() =>
      stubResponse({ path: 'nodes/node-Abcdef1234/pic.png' }),
    );
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'project-77',
      flow: 'main',
      fetch: impl,
    });

    const file = new File([new Uint8Array([1, 2, 3])], 'Pic.png', { type: 'image/png' });
    const result = await adapter.uploadImage('node-Abcdef1234', file, 'pic.png');

    expect(result).toEqual({ path: 'nodes/node-Abcdef1234/pic.png' });
    expect(calls[0]?.url).toBe(
      '/api/projects/project-77/flows/main/nodes/node-Abcdef1234/files/upload',
    );
    expect(calls[0]?.method).toBe('POST');
    // FormData body — must NOT have an explicit content-type header.
    expect(calls[0]?.headers?.['content-type']).toBeUndefined();
    expect(calls[0]?.body).toBeInstanceOf(FormData);
    const form = calls[0]?.body as FormData;
    expect(form.get('filename')).toBe('pic.png');
    expect(form.get('file')).toBeInstanceOf(File);
  });

  it('throws an Error carrying the server error message on non-2xx responses', async () => {
    const { impl } = stubFetch(() => stubResponse({ error: 'node not found' }, 404));
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'demo-42',
      flow: 'main',
      fetch: impl,
    });

    await expect(adapter.deleteNode('missing')).rejects.toThrow('node not found');
  });

  it('falls back to a "METHOD URL → status" message when the error body has no `error` field', async () => {
    const { impl } = stubFetch(() => stubResponse({}, 500));
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'demo-42',
      flow: 'main',
      fetch: impl,
    });

    await expect(adapter.updateNode('node-a', { name: 'x' })).rejects.toThrow(
      'PATCH /api/projects/demo-42/flows/main/nodes/node-a → 500',
    );
  });

  it('openFile POSTs the path to /api/projects/:project/files/open (project-scoped)', async () => {
    const { impl, calls } = stubFetch(() =>
      stubResponse({ ok: true, absPath: '/abs/flows/demo/state.ts' }),
    );
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'demo-42',
      flow: 'main',
      fetch: impl,
    });

    await adapter.openFile?.('flows/demo/state.ts');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/projects/demo-42/files/open');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers?.['content-type']).toBe('application/json');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ path: 'flows/demo/state.ts' });
  });

  it('revealFile POSTs the path to /api/projects/:project/files/reveal (project-scoped)', async () => {
    const { impl, calls } = stubFetch(() =>
      stubResponse({ ok: true, absPath: '/abs/flows/demo/state.ts' }),
    );
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'demo-42',
      flow: 'main',
      fetch: impl,
    });

    await adapter.revealFile?.('flows/demo/state.ts');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/projects/demo-42/files/reveal');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers?.['content-type']).toBe('application/json');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ path: 'flows/demo/state.ts' });
  });

  it('openFile and revealFile URL-encode the project slug in the projects path', async () => {
    const { impl, calls } = stubFetch(() => stubResponse({ ok: true, absPath: '/abs/x' }));
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'demo with space',
      flow: 'main',
      fetch: impl,
    });

    await adapter.openFile?.('a.ts');
    await adapter.revealFile?.('a.ts');

    expect(calls[0]?.url).toBe('/api/projects/demo%20with%20space/files/open');
    expect(calls[1]?.url).toBe('/api/projects/demo%20with%20space/files/reveal');
  });

  it('URL-encodes the project and flow slugs in flow-scoped routes', async () => {
    const { impl, calls } = stubFetch(() => stubResponse({ ok: true }));
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'demo with space',
      flow: 'flow/with slash',
      fetch: impl,
    });

    await adapter.updateNode('node-a', { name: 'x' });

    expect(calls[0]?.url).toBe(
      '/api/projects/demo%20with%20space/flows/flow%2Fwith%20slash/nodes/node-a',
    );
  });

  it('attaches options.headers to every JSON request alongside content-type', async () => {
    const { impl, calls } = stubFetch(() => stubResponse({ ok: true }));
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'demo-42',
      flow: 'main',
      fetch: impl,
      headers: { 'X-Seeflow-Token': 'tok-abc' },
    });

    await adapter.updateNode('node-a', { name: 'x' });
    await adapter.deleteNode('node-a');

    expect(calls[0]?.headers?.['X-Seeflow-Token']).toBe('tok-abc');
    expect(calls[0]?.headers?.['content-type']).toBe('application/json');
    // DELETE has no body but should still carry the auth header.
    expect(calls[1]?.headers?.['X-Seeflow-Token']).toBe('tok-abc');
    expect(calls[1]?.headers?.['content-type']).toBeUndefined();
  });

  it('attaches options.headers to the multipart upload without setting content-type', async () => {
    const { impl, calls } = stubFetch(() =>
      stubResponse({ path: 'nodes/node-Abcdef1234/pic.png' }),
    );
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'project-77',
      flow: 'main',
      fetch: impl,
      headers: { 'X-Seeflow-Token': 'tok-xyz' },
    });

    const file = new File([new Uint8Array([1])], 'pic.png', { type: 'image/png' });
    await adapter.uploadImage('node-Abcdef1234', file, 'pic.png');

    expect(calls[0]?.headers?.['X-Seeflow-Token']).toBe('tok-xyz');
    // FormData body must NOT have an explicit content-type header — the
    // browser sets the multipart boundary itself.
    expect(calls[0]?.headers?.['content-type']).toBeUndefined();
  });

  it('prepends the configured baseUrl to every request URL', async () => {
    const { impl, calls } = stubFetch(() => stubResponse({ ok: true }));
    const adapter = createRestAdapter({
      baseUrl: 'https://studio.example.com',
      project: 'demo-42',
      flow: 'main',
      fetch: impl,
    });

    await adapter.updateNode('node-a', { name: 'x' });

    expect(calls[0]?.url).toBe(
      'https://studio.example.com/api/projects/demo-42/flows/main/nodes/node-a',
    );
  });
});

describe('createRestAdapter icons (US-018)', () => {
  it('icons.listPacks GETs /api/icons/packs and returns the packs array', async () => {
    const packs = [
      {
        vendor: 'aws' as const,
        installed: true as const,
        version: '2026-05-31',
        iconCount: 2,
        sizeBytes: 1024,
        iconNames: ['lambda', 's3'],
      },
      { vendor: 'azure' as const, installed: false as const },
    ];
    const { impl, calls } = stubFetch(() => stubResponse({ packs }));
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'demo-42',
      flow: 'main',
      fetch: impl,
    });

    const result = await adapter.icons?.listPacks();

    expect(result).toEqual(packs);
    expect(calls[0]?.url).toBe('/api/icons/packs');
    expect(calls[0]?.method).toBe('GET');
  });

  it('icons.install POSTs { vendor, acceptTerms } and returns the jobId', async () => {
    const { impl, calls } = stubFetch(() => stubResponse({ jobId: 'job-123' }));
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'demo-42',
      flow: 'main',
      fetch: impl,
    });

    const result = await adapter.icons?.install('aws', { acceptTerms: true });

    expect(result).toEqual({ jobId: 'job-123' });
    expect(calls[0]?.url).toBe('/api/icons/install');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers?.['content-type']).toBe('application/json');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      vendor: 'aws',
      acceptTerms: true,
    });
  });

  it('icons.install defaults acceptTerms to false when omitted', async () => {
    const { impl, calls } = stubFetch(() => stubResponse({ jobId: 'job-456' }));
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'demo-42',
      flow: 'main',
      fetch: impl,
    });

    await adapter.icons?.install('azure', {});

    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      vendor: 'azure',
      acceptTerms: false,
    });
  });

  it('icons.install surfaces server error message (e.g. 409 with body.error) via thrown Error', async () => {
    const { impl } = stubFetch(() =>
      stubResponse({ error: 'install for aws already in flight', jobId: 'job-existing' }, 409),
    );
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'demo-42',
      flow: 'main',
      fetch: impl,
    });

    expect(adapter.icons?.install('aws', { acceptTerms: true })).rejects.toThrow(
      'install for aws already in flight',
    );
  });

  it('icons.remove DELETEs /api/icons/packs/:vendor', async () => {
    const { impl, calls } = stubFetch(() => stubResponse({ removed: 'aws' }));
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'demo-42',
      flow: 'main',
      fetch: impl,
    });

    await adapter.icons?.remove('aws');

    expect(calls[0]?.url).toBe('/api/icons/packs/aws');
    expect(calls[0]?.method).toBe('DELETE');
  });

  it('icons.getLicense GETs /api/icons/licenses/:vendor and returns the canvas-shaped IconLicenseInfo', async () => {
    const { impl, calls } = stubFetch(() =>
      stubResponse({
        vendor: 'aws',
        label: 'Amazon Web Services',
        summary: 'AWS Architecture Icons license summary.',
        url: 'https://aws.amazon.com/architecture/icons/',
        requiresAcceptance: true,
      }),
    );
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'demo-42',
      flow: 'main',
      fetch: impl,
    });

    const result = await adapter.icons?.getLicense('aws');

    expect(result).toEqual({
      summary: 'AWS Architecture Icons license summary.',
      url: 'https://aws.amazon.com/architecture/icons/',
      requiresAcceptance: true,
    });
    expect(calls[0]?.url).toBe('/api/icons/licenses/aws');
    expect(calls[0]?.method).toBe('GET');
  });

  it('icons.subscribeJob opens an EventSource, parses JSON payloads to onEvent, and disposer closes it', () => {
    const created: { url: string; closed: boolean }[] = [];
    const handlers: { onmessage: ((e: MessageEvent) => void) | null }[] = [];
    class FakeEventSource {
      url: string;
      onmessage: ((e: MessageEvent) => void) | null = null;
      constructor(url: string) {
        this.url = url;
        const entry = { url, closed: false };
        created.push(entry);
        handlers.push(this);
      }
      close() {
        const entry = created[created.length - 1];
        if (entry) entry.closed = true;
      }
    }
    const { impl } = stubFetch(() => stubResponse({ ok: true }));
    const adapter = createRestAdapter({
      baseUrl: '',
      project: 'demo-42',
      flow: 'main',
      fetch: impl,
      EventSource: FakeEventSource as unknown as typeof EventSource,
    });

    const received: InstallEvent[] = [];
    const unsubscribe = adapter.icons?.subscribeJob('job-789', (ev) => received.push(ev));

    expect(created[0]?.url).toBe('/api/icons/jobs/job-789/events');
    const handler = handlers[0];
    expect(handler?.onmessage).not.toBeNull();
    handler?.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'download-started', vendor: 'aws', expectedBytes: 100 }),
      }),
    );
    handler?.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'done', vendor: 'aws', version: '2026-05-31', iconCount: 2 }),
      }),
    );

    expect(received).toEqual([
      { type: 'download-started', vendor: 'aws', expectedBytes: 100 },
      { type: 'done', vendor: 'aws', version: '2026-05-31', iconCount: 2 },
    ]);
    expect(created[0]?.closed).toBe(false);
    unsubscribe?.();
    expect(created[0]?.closed).toBe(true);
  });

  it('icons.subscribeJob URL-encodes the jobId', () => {
    const created: { url: string }[] = [];
    class FakeEventSource {
      onmessage: ((e: MessageEvent) => void) | null = null;
      constructor(url: string) {
        created.push({ url });
      }
      close() {}
    }
    const { impl } = stubFetch(() => stubResponse({ ok: true }));
    const adapter = createRestAdapter({
      baseUrl: 'https://studio.example.com',
      project: 'demo-42',
      flow: 'main',
      fetch: impl,
      EventSource: FakeEventSource as unknown as typeof EventSource,
    });

    adapter.icons?.subscribeJob('job/with slash', () => {});

    expect(created[0]?.url).toBe(
      'https://studio.example.com/api/icons/jobs/job%2Fwith%20slash/events',
    );
  });
});
