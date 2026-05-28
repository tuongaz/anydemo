import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { buildProjectBundle } from '@/lib/build-project-bundle';
import { strFromU8, unzipSync } from 'fflate';

const realFetch = globalThis.fetch;

type MockHandler = (
  url: string,
  init?: RequestInit,
) => { status: number; body?: unknown; binary?: Uint8Array };

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
    return new Response(JSON.stringify(r.body ?? null), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const baseMeta = {
  projectSlug: 'demo',
  name: 'Demo',
  description: 'A demo project',
  defaultFlow: 'main',
  flows: [
    { flowSlug: 'main', name: 'Main', isDefault: true },
    { flowSlug: 'retry', name: 'Retry', icon: 'refresh-ccw', isDefault: false },
  ],
};

// The bundle builder reads the merged detail endpoint
// (`/api/projects/:project/flows/:flow`) — NOT `/graph` — so the bundled
// flow.json carries node positions + visual style from style.json. The
// detail response wraps the resolved flow under a `flow` key.
const emptyDetail = (slug: string, name: string) => ({
  id: `entry-${slug}`,
  slug: `demo/${slug}`,
  name,
  filePath: `/repo/${slug}/flow.json`,
  flow: { version: 2, name, nodes: [], connectors: [] },
});

describe('buildProjectBundle', () => {
  it('emits seeflow.json + per-flow flow.json with the right keys', async () => {
    installMock((url) => {
      if (url === '/api/projects/demo') return { status: 200, body: baseMeta };
      if (url === '/api/projects/demo/flows/main')
        return { status: 200, body: emptyDetail('main', 'Main') };
      if (url === '/api/projects/demo/flows/retry')
        return { status: 200, body: emptyDetail('retry', 'Retry') };
      throw new Error(`Unexpected URL: ${url}`);
    });

    const zip = await buildProjectBundle({
      project: 'demo',
      flows: [{ flowSlug: 'main' }, { flowSlug: 'retry' }],
    });

    const entries = unzipSync(zip);
    expect(Object.keys(entries).sort()).toEqual([
      'flows/main/flow.json',
      'flows/retry/flow.json',
      'seeflow.json',
    ]);
  });

  it('seeflow.json mirrors the manifest shape (id from flowSlug, optional icon, top-level description)', async () => {
    installMock((url) => {
      if (url === '/api/projects/demo') return { status: 200, body: baseMeta };
      if (url.startsWith('/api/projects/demo/flows/')) {
        const slug = url.includes('/main') ? 'main' : 'retry';
        return { status: 200, body: emptyDetail(slug, slug === 'main' ? 'Main' : 'Retry') };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const zip = await buildProjectBundle({
      project: 'demo',
      flows: [{ flowSlug: 'main' }, { flowSlug: 'retry' }],
    });

    const entries = unzipSync(zip);
    const seeflowEntry = entries['seeflow.json'];
    if (!seeflowEntry) throw new Error('seeflow.json missing from zip');
    const manifest = JSON.parse(strFromU8(seeflowEntry));
    expect(manifest).toEqual({
      version: 1,
      name: 'Demo',
      description: 'A demo project',
      defaultFlow: 'main',
      flows: [
        { id: 'main', name: 'Main' },
        { id: 'retry', name: 'Retry', icon: 'refresh-ccw' },
      ],
    });
  });

  it('per-flow flow.json wraps the merged flow (with positions) in a version-2 envelope', async () => {
    const detail = {
      id: 'entry-main',
      slug: 'demo/main',
      name: 'Main',
      filePath: '/repo/main/flow.json',
      flow: {
        version: 2 as const,
        name: 'Main',
        description: 'main flow',
        nodes: [{ id: 'n1', type: 'rect', position: { x: 12, y: 34 }, data: {} }],
        connectors: [{ id: 'c1', source: 'n1', target: 'n1' }],
      },
    };
    installMock((url) => {
      if (url === '/api/projects/demo') return { status: 200, body: baseMeta };
      if (url === '/api/projects/demo/flows/main') return { status: 200, body: detail };
      if (url === '/api/projects/demo/flows/retry')
        return { status: 200, body: emptyDetail('retry', 'Retry') };
      throw new Error(`Unexpected URL: ${url}`);
    });

    const zip = await buildProjectBundle({
      project: 'demo',
      flows: [{ flowSlug: 'main' }, { flowSlug: 'retry' }],
    });

    const entries = unzipSync(zip);
    const mainEntry = entries['flows/main/flow.json'];
    if (!mainEntry) throw new Error('flows/main/flow.json missing from zip');
    const envelope = JSON.parse(strFromU8(mainEntry));
    expect(envelope).toEqual({
      version: 2,
      name: 'Main',
      description: 'main flow',
      nodes: detail.flow.nodes,
      connectors: detail.flow.connectors,
    });
    // Positions must survive into the bundle — their absence is what made the
    // cloud viewer crash on `node.position.x`.
    expect(envelope.nodes[0].position).toEqual({ x: 12, y: 34 });
  });

  it('bundles type:image asset bytes under flows/<flow>/files/<path>', async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
    const detail = {
      id: 'entry-main',
      slug: 'demo/main',
      name: 'Main',
      filePath: '/repo/main/flow.json',
      flow: {
        version: 2 as const,
        name: 'Main',
        nodes: [
          { id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { path: 'assets/img.png' } },
        ],
        connectors: [],
      },
    };
    installMock((url) => {
      if (url === '/api/projects/demo')
        return { status: 200, body: { ...baseMeta, flows: [baseMeta.flows[0]] } };
      if (url === '/api/projects/demo/flows/main') return { status: 200, body: detail };
      if (url === '/api/projects/demo/files/assets/img.png')
        return { status: 200, binary: pngBytes };
      throw new Error(`Unexpected URL: ${url}`);
    });

    const zip = await buildProjectBundle({ project: 'demo', flows: [{ flowSlug: 'main' }] });
    const entries = unzipSync(zip);
    expect('flows/main/files/assets/img.png' in entries).toBe(true);
    expect(entries['flows/main/files/assets/img.png']).toEqual(pngBytes);
  });

  it('deduplicates the same asset path across multiple image nodes', async () => {
    const detail = {
      id: 'entry-main',
      slug: 'demo/main',
      name: 'Main',
      filePath: '/repo/main/flow.json',
      flow: {
        version: 2 as const,
        name: 'Main',
        nodes: [
          { id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { path: 'shared.png' } },
          { id: 'n2', type: 'image', position: { x: 50, y: 0 }, data: { path: 'shared.png' } },
        ],
        connectors: [],
      },
    };
    const fileRequests: string[] = [];
    installMock((url) => {
      if (url === '/api/projects/demo')
        return { status: 200, body: { ...baseMeta, flows: [baseMeta.flows[0]] } };
      if (url === '/api/projects/demo/flows/main') return { status: 200, body: detail };
      if (url === '/api/projects/demo/files/shared.png') {
        fileRequests.push(url);
        return { status: 200, binary: new Uint8Array([1]) };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await buildProjectBundle({ project: 'demo', flows: [{ flowSlug: 'main' }] });
    expect(fileRequests).toHaveLength(1);
  });

  it('skips assets that return a non-ok status', async () => {
    const detail = {
      id: 'entry-main',
      slug: 'demo/main',
      name: 'Main',
      filePath: '/repo/main/flow.json',
      flow: {
        version: 2 as const,
        name: 'Main',
        nodes: [
          { id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { path: 'missing.png' } },
        ],
        connectors: [],
      },
    };
    installMock((url) => {
      if (url === '/api/projects/demo')
        return { status: 200, body: { ...baseMeta, flows: [baseMeta.flows[0]] } };
      if (url === '/api/projects/demo/flows/main') return { status: 200, body: detail };
      if (url === '/api/projects/demo/files/missing.png')
        return { status: 404, body: { error: 'not found' } };
      throw new Error(`Unexpected URL: ${url}`);
    });

    const zip = await buildProjectBundle({ project: 'demo', flows: [{ flowSlug: 'main' }] });
    const entries = unzipSync(zip);
    expect('flows/main/files/missing.png' in entries).toBe(false);
    // seeflow.json + flow.json still present.
    expect('seeflow.json' in entries).toBe(true);
    expect('flows/main/flow.json' in entries).toBe(true);
  });

  it('encodes project + flow slugs in the URL path segments', async () => {
    const captured: string[] = [];
    installMock((url) => {
      captured.push(url);
      if (url === '/api/projects/my%20proj')
        return {
          status: 200,
          body: {
            ...baseMeta,
            projectSlug: 'my proj',
            flows: [{ flowSlug: 'a/b', name: 'A', isDefault: true }],
            defaultFlow: 'a/b',
          },
        };
      if (url === '/api/projects/my%20proj/flows/a%2Fb')
        return { status: 200, body: emptyDetail('a/b', 'A') };
      throw new Error(`Unexpected URL: ${url}`);
    });

    await buildProjectBundle({ project: 'my proj', flows: [{ flowSlug: 'a/b' }] });
    expect(captured).toContain('/api/projects/my%20proj');
    expect(captured).toContain('/api/projects/my%20proj/flows/a%2Fb');
  });

  it('throws when the project metadata fetch returns a non-ok status', async () => {
    installMock((url) => {
      if (url === '/api/projects/nope')
        return { status: 404, body: { error: 'project-not-found' } };
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      buildProjectBundle({ project: 'nope', flows: [{ flowSlug: 'main' }] }),
    ).rejects.toThrow('GET /api/projects/nope → 404');
  });

  it('throws when a flow detail fetch returns a non-ok status', async () => {
    installMock((url) => {
      if (url === '/api/projects/demo') return { status: 200, body: baseMeta };
      if (url === '/api/projects/demo/flows/main') return { status: 500, body: { error: 'boom' } };
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      buildProjectBundle({ project: 'demo', flows: [{ flowSlug: 'main' }] }),
    ).rejects.toThrow('/api/projects/demo/flows/main → 500');
  });

  it('keeps meta.defaultFlow when the subset still includes it', async () => {
    installMock((url) => {
      if (url === '/api/projects/demo') return { status: 200, body: baseMeta };
      if (url === '/api/projects/demo/flows/main')
        return { status: 200, body: emptyDetail('main', 'Main') };
      throw new Error(`Unexpected URL: ${url}`);
    });

    const zip = await buildProjectBundle({
      project: 'demo',
      flows: [{ flowSlug: 'main' }],
    });

    const entries = unzipSync(zip);
    const manifest = JSON.parse(strFromU8(entries['seeflow.json'] as Uint8Array));
    expect(manifest.defaultFlow).toBe('main');
    expect(manifest.flows).toEqual([{ id: 'main', name: 'Main' }]);
  });

  it('falls back to the first selected slug when meta.defaultFlow is excluded from the subset', async () => {
    installMock((url) => {
      if (url === '/api/projects/demo') return { status: 200, body: baseMeta };
      if (url === '/api/projects/demo/flows/retry')
        return { status: 200, body: emptyDetail('retry', 'Retry') };
      throw new Error(`Unexpected URL: ${url}`);
    });

    const zip = await buildProjectBundle({
      project: 'demo',
      flows: [{ flowSlug: 'retry' }],
    });

    const entries = unzipSync(zip);
    const manifest = JSON.parse(strFromU8(entries['seeflow.json'] as Uint8Array));
    expect(manifest.defaultFlow).toBe('retry');
    expect(manifest.flows).toEqual([{ id: 'retry', name: 'Retry', icon: 'refresh-ccw' }]);
  });

  it('only fetches flows + assets for flows in the subset', async () => {
    const requested: string[] = [];
    installMock((url) => {
      requested.push(url);
      if (url === '/api/projects/demo') return { status: 200, body: baseMeta };
      if (url === '/api/projects/demo/flows/main')
        return { status: 200, body: emptyDetail('main', 'Main') };
      throw new Error(`Unexpected URL: ${url}`);
    });

    await buildProjectBundle({ project: 'demo', flows: [{ flowSlug: 'main' }] });

    expect(requested).toContain('/api/projects/demo/flows/main');
    expect(requested).not.toContain('/api/projects/demo/flows/retry');
  });

  it('omits manifest.description when the project has none', async () => {
    const { description: _ignored, ...metaNoDescription } = baseMeta;
    installMock((url) => {
      if (url === '/api/projects/demo') return { status: 200, body: metaNoDescription };
      if (url.startsWith('/api/projects/demo/flows/')) {
        const slug = url.includes('/main') ? 'main' : 'retry';
        return { status: 200, body: emptyDetail(slug, slug === 'main' ? 'Main' : 'Retry') };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const zip = await buildProjectBundle({
      project: 'demo',
      flows: [{ flowSlug: 'main' }, { flowSlug: 'retry' }],
    });
    const entries = unzipSync(zip);
    const seeflowEntry = entries['seeflow.json'];
    if (!seeflowEntry) throw new Error('seeflow.json missing from zip');
    const manifest = JSON.parse(strFromU8(seeflowEntry));
    expect('description' in manifest).toBe(false);
  });
});
