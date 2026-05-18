import { describe, expect, it } from 'bun:test';
import { createRestAdapter } from './canvas-adapter-rest';

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

describe('createRestAdapter (US-024)', () => {
  it('createNode POSTs the input to /api/demos/:id/nodes and returns the server-issued id + node', async () => {
    const { impl, calls } = stubFetch(() =>
      stubResponse({
        ok: true,
        id: 'server-id',
        node: { id: 'server-id', type: 'shapeNode', position: { x: 10, y: 20 } },
      }),
    );
    const adapter = createRestAdapter({ baseUrl: '', demoId: 'demo-42', fetch: impl });

    const result = await adapter.createNode({
      type: 'shapeNode',
      position: { x: 10, y: 20 },
      data: { shape: 'rectangle' },
    });

    expect(result.id).toBe('server-id');
    expect(result.node).toEqual({ id: 'server-id', type: 'shapeNode', position: { x: 10, y: 20 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/demos/demo-42/nodes');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers?.['content-type']).toBe('application/json');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      type: 'shapeNode',
      position: { x: 10, y: 20 },
      data: { shape: 'rectangle' },
    });
  });

  it('updateNode PATCHes the patch body to /api/demos/:id/nodes/:nodeId', async () => {
    const { impl, calls } = stubFetch(() => stubResponse({ ok: true }));
    const adapter = createRestAdapter({ baseUrl: '', demoId: 'demo-42', fetch: impl });

    await adapter.updateNode('node-a', { name: 'Renamed', borderColor: 'blue' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/demos/demo-42/nodes/node-a');
    expect(calls[0]?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ name: 'Renamed', borderColor: 'blue' });
  });

  it('updateNodePosition PATCHes the /position endpoint and returns the server result', async () => {
    const { impl, calls } = stubFetch(() => stubResponse({ ok: true, position: { x: 50, y: 60 } }));
    const adapter = createRestAdapter({ baseUrl: '', demoId: 'demo-42', fetch: impl });

    const result = await adapter.updateNodePosition('node-a', { x: 50, y: 60 });

    expect(result).toEqual({ ok: true, position: { x: 50, y: 60 } });
    expect(calls[0]?.url).toBe('/api/demos/demo-42/nodes/node-a/position');
    expect(calls[0]?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ x: 50, y: 60 });
  });

  it('deleteNode DELETEs /api/demos/:id/nodes/:nodeId with no body', async () => {
    const { impl, calls } = stubFetch(() => stubResponse({ ok: true }));
    const adapter = createRestAdapter({ baseUrl: '', demoId: 'demo-42', fetch: impl });

    await adapter.deleteNode('node-a');

    expect(calls[0]?.url).toBe('/api/demos/demo-42/nodes/node-a');
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.body).toBeNull();
  });

  it('createConnector POSTs to /api/demos/:id/connectors and returns the server-issued id', async () => {
    const { impl, calls } = stubFetch(() => stubResponse({ ok: true, id: 'conn-1' }));
    const adapter = createRestAdapter({ baseUrl: '', demoId: 'demo-42', fetch: impl });

    const result = await adapter.createConnector({ source: 'a', target: 'b' });

    expect(result).toEqual({ id: 'conn-1' });
    expect(calls[0]?.url).toBe('/api/demos/demo-42/connectors');
    expect(calls[0]?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ source: 'a', target: 'b' });
  });

  it('reorderNode PATCHes the order op to /nodes/:nodeId/order', async () => {
    const { impl, calls } = stubFetch(() => stubResponse({ ok: true }));
    const adapter = createRestAdapter({ baseUrl: '', demoId: 'demo-42', fetch: impl });

    await adapter.reorderNode('node-a', { op: 'toFront' });

    expect(calls[0]?.url).toBe('/api/demos/demo-42/nodes/node-a/order');
    expect(calls[0]?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ op: 'toFront' });
  });

  it('uploadImage POSTs FormData to /api/projects/:id/files/upload', async () => {
    const { impl, calls } = stubFetch(() => stubResponse({ path: 'assets/pic.png' }));
    const adapter = createRestAdapter({ baseUrl: '', demoId: 'project-77', fetch: impl });

    const file = new File([new Uint8Array([1, 2, 3])], 'Pic.png', { type: 'image/png' });
    const result = await adapter.uploadImage(file, 'pic.png');

    expect(result).toEqual({ path: 'assets/pic.png' });
    expect(calls[0]?.url).toBe('/api/projects/project-77/files/upload');
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
    const adapter = createRestAdapter({ baseUrl: '', demoId: 'demo-42', fetch: impl });

    await expect(adapter.deleteNode('missing')).rejects.toThrow('node not found');
  });

  it('falls back to a "METHOD URL → status" message when the error body has no `error` field', async () => {
    const { impl } = stubFetch(() => stubResponse({}, 500));
    const adapter = createRestAdapter({ baseUrl: '', demoId: 'demo-42', fetch: impl });

    await expect(adapter.updateNode('node-a', { name: 'x' })).rejects.toThrow(
      'PATCH /api/demos/demo-42/nodes/node-a → 500',
    );
  });

  it('prepends the configured baseUrl to every request URL', async () => {
    const { impl, calls } = stubFetch(() => stubResponse({ ok: true }));
    const adapter = createRestAdapter({
      baseUrl: 'https://studio.example.com',
      demoId: 'demo-42',
      fetch: impl,
    });

    await adapter.updateNode('node-a', { name: 'x' });

    expect(calls[0]?.url).toBe('https://studio.example.com/api/demos/demo-42/nodes/node-a');
  });
});
