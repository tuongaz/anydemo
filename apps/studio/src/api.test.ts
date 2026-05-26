import { describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEventBus } from './events.ts';
import { createRegistry } from './registry.ts';
import { createApp } from './server.ts';

const VALID_DEMO = {
  version: 2,
  name: 'Checkout Flow',
  nodes: [
    {
      id: 'api-checkout',
      type: 'rectangle',
      data: {
        name: 'POST /checkout',
        stateSource: { kind: 'request' },
        playAction: {
          kind: 'script',
          interpreter: 'bun',
          scriptPath: 'scripts/checkout.ts',
        },
      },
    },
  ],
  connectors: [],
};

const tmpRegistry = () => {
  const dir = mkdtempSync(join(tmpdir(), 'seeflow-api-reg-'));
  return join(dir, 'registry.json');
};

const tmpRepoWithDemo = (demo: unknown = VALID_DEMO) => {
  const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-api-repo-'));
  writeFileSync(join(repoDir, 'flow.json'), JSON.stringify(demo));
  return repoDir;
};

const buildApp = () => {
  const registry = createRegistry({ path: tmpRegistry() });
  const app = createApp({ mode: 'prod', staticRoot: './dist/web', registry, disableWatcher: true });
  return { app, registry };
};

const post = (app: ReturnType<typeof buildApp>['app'], path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/flows/register', () => {
  it('registers a valid demo and returns id + slug + skipped sdk for request-only demo', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo();

    const res = await post(app, '/api/flows/register', {
      name: 'Checkout Flow',
      repoPath,
      flowPath: 'flow.json',
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      id: string;
      slug: string;
    };
    expect(json.slug).toBe('checkout-flow/main');
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.id).toBe(json.id);
  });

  it('returns 400 with Zod issues when the demo file fails schema validation', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo({ version: 1 });

    const res = await post(app, '/api/flows/register', {
      name: 'Bad demo',
      repoPath,
      flowPath: 'flow.json',
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; issues?: Array<{ path: unknown[] }> };
    expect(json.error).toContain('schema validation');
    expect(json.issues?.length ?? 0).toBeGreaterThan(0);
    expect(registry.list()).toHaveLength(0);
  });

  it('returns 400 when the demo file does not exist', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/flows/register', {
      name: 'Missing',
      repoPath: '/this/path/does/not/exist',
      flowPath: 'flow.json',
    });
    expect(res.status).toBe(400);
  });

  it('re-registering the same repoPath updates in place (same id, same slug)', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo();

    const first = await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json();
    const second = await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json();

    expect((second as { id: string }).id).toBe((first as { id: string }).id);
    expect((second as { slug: string }).slug).toBe((first as { slug: string }).slug);
    expect(registry.list()).toHaveLength(1);
  });

  it('same repoPath + different flowPath returns two distinct ids + slugs; both listed', async () => {
    const { app, registry } = buildApp();
    const repoPath = mkdtempSync(join(tmpdir(), 'seeflow-api-multi-'));
    mkdirSync(join(repoPath, 'checkout'), { recursive: true });
    mkdirSync(join(repoPath, 'refund'), { recursive: true });
    writeFileSync(
      join(repoPath, 'checkout', 'flow.json'),
      JSON.stringify({ ...VALID_DEMO, name: 'Checkout' }),
    );
    writeFileSync(
      join(repoPath, 'refund', 'flow.json'),
      JSON.stringify({ ...VALID_DEMO, name: 'Refund' }),
    );

    const a = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'checkout/flow.json',
      })
    ).json()) as { id: string; slug: string };
    const b = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'refund/flow.json',
      })
    ).json()) as { id: string; slug: string };

    expect(a.id).not.toBe(b.id);
    expect(a.slug).not.toBe(b.slug);
    expect(registry.list()).toHaveLength(2);

    const listRes = await app.request('/api/flows');
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Array<{ id: string; slug: string }>;
    const ids = list.map((d) => d.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());

    // Re-registering one entry should only update that entry.
    const updatedA = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'checkout/flow.json',
      })
    ).json()) as { id: string };
    expect(updatedA.id).toBe(a.id);
    expect(registry.list()).toHaveLength(2);
    expect(registry.getById(b.id)?.flowPath).toBe('refund/flow.json');
  });
});

describe('POST /api/flows/validate', () => {
  it('returns ok:true with zero issues for a valid static demo', async () => {
    const { app } = buildApp();
    // /api/flows/validate predates the flow/style split — it validates
    // against the merged Flow shape (position required), so we synthesize one
    // here from the flow-only VALID_DEMO fixture.
    const validateBody = {
      ...VALID_DEMO,
      nodes: VALID_DEMO.nodes.map((n) => ({ ...n, position: { x: 0, y: 0 } })),
    };
    const res = await post(app, '/api/flows/validate', { demo: validateBody, tier: 'static' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      issues: unknown[];
      warnings: unknown[];
      stats: { tier: string; nodeCount: number };
    };
    expect(json.ok).toBe(true);
    expect(json.issues).toHaveLength(0);
    expect(json.stats.tier).toBe('static');
    expect(json.stats.nodeCount).toBe(1);
  });

  it('returns Zod issues for a malformed demo', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/flows/validate', { demo: { version: 1 } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; issues: Array<{ kind: string }> };
    expect(json.ok).toBe(false);
    expect(json.issues.some((i) => i.kind === 'zod')).toBe(true);
  });

  it('flags tier-mismatch when tier=real but no playable nodes exist', async () => {
    const { app } = buildApp();
    const staticOnly = {
      version: 2,
      name: 'Static only',
      nodes: [
        {
          id: 'box',
          type: 'rectangle',
          data: {},
        },
      ],
      connectors: [],
    };
    const res = await post(app, '/api/flows/validate', { demo: staticOnly, tier: 'real' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; issues: Array<{ kind: string }> };
    expect(json.ok).toBe(false);
    expect(json.issues.some((i) => i.kind === 'tier-mismatch')).toBe(true);
  });

  it('flags cap issue when node count exceeds 30', async () => {
    const { app } = buildApp();
    const bigDemo = {
      version: 2,
      name: 'Too big',
      nodes: Array.from({ length: 31 }, (_, i) => ({
        id: `n${i}`,
        type: 'rectangle' as const,
        data: {},
      })),
      connectors: [],
    };
    const res = await post(app, '/api/flows/validate', { demo: bigDemo, tier: 'static' });
    const json = (await res.json()) as { issues: Array<{ kind: string }> };
    expect(json.issues.some((i) => i.kind === 'cap')).toBe(true);
  });

  // US-001: HTTP-based reachability warning no longer applies — playActions are
  // script-shaped now. A future story may add an analogous "does this script
  // file exist?" warning, but the http branch in diagram.ts is dead code under
  // the new schema.
  it.skip('warns about reachability for tier=real with http playActions', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/flows/validate', { demo: VALID_DEMO, tier: 'real' });
    const json = (await res.json()) as { warnings: Array<{ kind: string }> };
    expect(json.warnings.some((w) => w.kind === 'real-tier-reachability')).toBe(true);
  });

  it('returns 400 for malformed JSON body', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/flows/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/diagram/propose-scope', () => {
  it('returns ranked entry-point candidates from a scan-result-shaped body', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/diagram/propose-scope', {
      files: [
        { path: 'src/server.ts', category: 'code' },
        { path: 'src/lib/helper.ts', category: 'code' },
        { path: 'README.md', category: 'docs' },
        { path: 'node_modules/foo/index.js', category: 'code' },
      ],
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      candidates: Array<{ path: string; score: number; reasons: string[] }>;
    };
    expect(json.candidates.length).toBeGreaterThan(0);
    expect(json.candidates[0]?.path).toBe('src/server.ts');
    expect(json.candidates.some((c) => c.path.includes('node_modules'))).toBe(false);
  });

  it('returns empty candidates when there are no code files', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/diagram/propose-scope', {
      files: [{ path: 'README.md', category: 'docs' }],
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { candidates: unknown[] };
    expect(json.candidates).toHaveLength(0);
  });

  it('returns 400 when files is missing', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/diagram/propose-scope', {});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/diagram/assemble', () => {
  it('assembles wiring + layout into a demo with snapped positions and stats', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/diagram/assemble', {
      wiring: {
        name: 'Test Flow',
        nodes: [
          {
            id: 'API',
            type: 'rectangle',
            position: { x: 11, y: 23 },
            data: {
              name: 'API',
              stateSource: { kind: 'request' },
              playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
            },
          },
          {
            id: 'db',
            type: 'rectangle',
            position: { x: 100, y: 100 },
            data: { name: 'DB', stateSource: { kind: 'request' } },
          },
        ],
        connectors: [
          { id: 'a-b', source: 'API', target: 'db' },
          { source: 'ghost', target: 'db' },
        ],
      },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      demo: {
        name: string;
        nodes: Array<{ id: string; position: { x: number; y: number } }>;
        connectors: unknown[];
      };
      stats: { danglingConnectorsDropped: number; positionsSnapped: number };
    };
    expect(json.demo.name).toBe('Test Flow');
    expect(json.demo.nodes.map((n) => n.id)).toEqual(['api', 'db']);
    const firstPos = json.demo.nodes[0]?.position;
    expect(firstPos).toBeDefined();
    expect((firstPos?.x ?? -1) % 24).toBe(0);
    expect((firstPos?.y ?? -1) % 24).toBe(0);
    expect(json.stats.danglingConnectorsDropped).toBe(1);
    expect(json.stats.positionsSnapped).toBeGreaterThan(0);
  });

  it('applies layout positions to override wiring positions', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/diagram/assemble', {
      wiring: {
        nodes: [{ id: 'n1', position: { x: 0, y: 0 } }],
        connectors: [],
      },
      layout: { positions: { n1: { x: 240, y: 480 } } },
    });
    const json = (await res.json()) as {
      demo: { nodes: Array<{ id: string; position: { x: number; y: number } }> };
    };
    expect(json.demo.nodes[0]?.position).toEqual({ x: 240, y: 480 });
  });

  it('returns 400 for missing wiring', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/diagram/assemble', { layout: { positions: {} } });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/layout', () => {
  const sampleFlow = {
    version: 2,
    name: 'Layout Demo',
    nodes: [
      {
        id: 'api',
        type: 'rectangle',
        data: {
          name: 'API',
          stateSource: { kind: 'request' },
          playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/api.ts' },
        },
      },
      {
        id: 'db',
        type: 'rectangle',
        data: { name: 'DB', stateSource: { kind: 'event' } },
      },
    ],
    connectors: [{ id: 'c1', source: 'api', target: 'db' }],
  };

  it('returns positions + handles for a valid flow', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/layout', { flow: sampleFlow });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      nodes: Record<string, { position: { x: number; y: number } }>;
      connectors: Record<string, { sourceHandle: string; targetHandle: string }>;
    };
    expect(json.ok).toBe(true);
    expect(json.nodes.api?.position).toBeDefined();
    expect(json.nodes.db?.position).toBeDefined();
    expect(json.connectors.c1).toEqual({ sourceHandle: 'r', targetHandle: 'l' });
  });

  it('returns ok:false + issues when the flow fails schema parsing', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/layout', { flow: { version: 1, nodes: [], connectors: [] } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      issues: Array<{ scope: string; message: string }>;
    };
    expect(json.ok).toBe(false);
    expect(json.issues.length).toBeGreaterThan(0);
    expect(json.issues[0]?.scope).toBe('flow');
  });

  it('returns ok:false with a connectors.source issue when a connector points to an unknown node', async () => {
    const { app } = buildApp();
    const bad = {
      ...sampleFlow,
      connectors: [{ id: 'c1', source: 'api', target: 'ghost' }],
    };
    const res = await post(app, '/api/layout', { flow: bad });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      issues: Array<{ path: (string | number)[]; message: string }>;
    };
    expect(json.ok).toBe(false);
    expect(json.issues.some((i) => i.path.includes('target') || i.message.includes('ghost'))).toBe(
      true,
    );
  });

  it('returns 400 when the body has no flow field', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/layout', { options: { direction: 'RIGHT' } });
    expect(res.status).toBe(400);
  });

  it('accepts the structural { nodes, edges } shape (Tidy-button input)', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/layout', {
      nodes: [
        { id: 'a', type: 'rectangle', width: 220, height: 100 },
        { id: 'b', type: 'rectangle', width: 220, height: 100 },
      ],
      edges: [{ id: 'e1', source: 'a', target: 'b' }],
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      nodes: Record<string, { position: { x: number; y: number } }>;
      connectors: Record<string, { sourceHandle: string; targetHandle: string }>;
    };
    expect(json.ok).toBe(true);
    expect(json.nodes.a?.position).toBeDefined();
    expect(json.nodes.b?.position).toBeDefined();
    expect(json.connectors.e1).toEqual({ sourceHandle: 'r', targetHandle: 'l' });
  });

  it('honours the direction option', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/layout', {
      flow: sampleFlow,
      options: { direction: 'DOWN' },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      connectors: Record<string, { sourceHandle: string; targetHandle: string }>;
    };
    expect(json.ok).toBe(true);
    // With DOWN direction, the source ends up above the target, so handles
    // route via bottom→top instead of right→left.
    expect(json.connectors.c1).toEqual({ sourceHandle: 'b', targetHandle: 't' });
  });
});

describe('POST /api/flows/:id/layout', () => {
  const layoutFlow = {
    version: 2,
    name: 'Layout By Id',
    nodes: [
      {
        id: 'api',
        type: 'rectangle',
        data: {
          name: 'API',
          stateSource: { kind: 'request' },
          playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/api.ts' },
        },
      },
      {
        id: 'db',
        type: 'rectangle',
        data: { name: 'DB', stateSource: { kind: 'event' } },
      },
    ],
    connectors: [{ id: 'c1', source: 'api', target: 'db' }],
  };

  const buildLayoutApp = () => {
    const bus = createEventBus();
    const registry = createRegistry({ path: tmpRegistry() });
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      events: bus,
      disableWatcher: true,
    });
    return { app, registry, bus };
  };

  const registerLayoutFlow = async (
    app: ReturnType<typeof buildLayoutApp>['app'],
    demo: unknown = layoutFlow,
  ) => {
    const repoPath = tmpRepoWithDemo(demo);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, flowPath: 'flow.json' })
    ).json()) as { id: string };
    return { id: reg.id, repoPath, stylePath: join(repoPath, 'style.json') };
  };

  it('writes style.json and returns { ok: true } for a registered flow', async () => {
    const { app, bus } = buildLayoutApp();
    const { id, stylePath } = await registerLayoutFlow(app);
    const captured: string[] = [];
    bus.subscribe(id, (e) => captured.push(e.type));

    const res = await app.request(`/api/flows/${id}/layout`, { method: 'POST' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; nodes?: unknown; connectors?: unknown };
    expect(json).toEqual({ ok: true });

    expect(existsSync(stylePath)).toBe(true);
    const style = JSON.parse(readFileSync(stylePath, 'utf8')) as {
      nodes: Record<string, { position: { x: number; y: number } }>;
      connectors: Record<string, { sourceHandle: string; targetHandle: string }>;
    };
    expect(style.nodes.api?.position).toBeDefined();
    expect(style.nodes.db?.position).toBeDefined();
    expect(style.connectors.c1).toEqual({ sourceHandle: 'r', targetHandle: 'l' });

    expect(captured).toEqual(['flow:reload']);
  });

  it('honours { options: { direction: "DOWN" } } in the body', async () => {
    const { app } = buildLayoutApp();
    const { id, stylePath } = await registerLayoutFlow(app);

    const res = await post(app, `/api/flows/${id}/layout`, { options: { direction: 'DOWN' } });
    expect(res.status).toBe(200);

    const style = JSON.parse(readFileSync(stylePath, 'utf8')) as {
      connectors: Record<string, { sourceHandle: string; targetHandle: string }>;
    };
    // DOWN routes top-to-bottom, so handles flip to b→t.
    expect(style.connectors.c1).toEqual({ sourceHandle: 'b', targetHandle: 't' });
  });

  it('treats a malformed body as 400 without writing style.json', async () => {
    const { app } = buildLayoutApp();
    const { id, stylePath } = await registerLayoutFlow(app);

    const res = await app.request(`/api/flows/${id}/layout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Body must be valid JSON');
    expect(existsSync(stylePath)).toBe(false);
  });

  it('returns 404 for an unknown flow id', async () => {
    const { app } = buildLayoutApp();
    const res = await app.request('/api/flows/nope/layout', { method: 'POST' });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('unknown demo');
  });

  it('returns 404 when flow.json was removed after register', async () => {
    const { app } = buildLayoutApp();
    const { id, repoPath } = await registerLayoutFlow(app);
    unlinkSync(join(repoPath, 'flow.json'));

    const res = await app.request(`/api/flows/${id}/layout`, { method: 'POST' });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/Flow file not found/);
  });

  it('returns 400 when flow.json on disk is not valid JSON', async () => {
    const { app } = buildLayoutApp();
    const { id, repoPath } = await registerLayoutFlow(app);
    // Corrupt the file after register so it loads at register-time but fails
    // on the layout call.
    writeFileSync(join(repoPath, 'flow.json'), '{ not json');

    const res = await app.request(`/api/flows/${id}/layout`, { method: 'POST' });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Flow file is not valid JSON');
  });

  it('returns 200 { ok: false, issues } when flow.json fails schema', async () => {
    const { app } = buildLayoutApp();
    const { id, repoPath, stylePath } = await registerLayoutFlow(app);
    // Drop required field to force a schema failure.
    writeFileSync(
      join(repoPath, 'flow.json'),
      JSON.stringify({ version: 1, nodes: [], connectors: [] }),
    );

    const res = await app.request(`/api/flows/${id}/layout`, { method: 'POST' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      issues: Array<{ scope: string; message: string }>;
    };
    expect(json.ok).toBe(false);
    expect(json.issues.length).toBeGreaterThan(0);
    expect(json.issues[0]?.scope).toBe('flow');
    // No write should happen on schema failure.
    expect(existsSync(stylePath)).toBe(false);
  });

  it('leaves no .tmp straggler after a successful write', async () => {
    const { app } = buildLayoutApp();
    const { id, repoPath } = await registerLayoutFlow(app);

    await app.request(`/api/flows/${id}/layout`, { method: 'POST' });
    const entries = readdirSync(repoPath);
    expect(entries.some((name) => name.startsWith('style.json.tmp'))).toBe(false);
  });
});

describe('GET /api/schema', () => {
  it('returns the category index', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/schema');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      categories: Array<{ name: string; description: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.categories.map((c) => c.name)).toEqual([
      'flow',
      'node',
      'connector',
      'action',
      'componentSpec',
      'style',
    ]);
    for (const c of body.categories) {
      expect(c.description.length).toBeGreaterThan(0);
    }
  });

  it('returns full JSON Schemas + notes for each known category', async () => {
    const { app } = buildApp();
    for (const name of ['flow', 'node', 'connector', 'action', 'componentSpec', 'style']) {
      const res = await app.request(`/api/schema/${name}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        name: string;
        schemas: Record<string, { type?: string }>;
        notes: string[];
      };
      expect(body.ok).toBe(true);
      expect(body.name).toBe(name);
      expect(Object.keys(body.schemas).length).toBeGreaterThan(0);
      expect(Array.isArray(body.notes)).toBe(true);
    }
  });

  it('returns 404 with available list for unknown categories', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/schema/bogus');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; available: string[] };
    expect(body.error).toContain('unknown schema category: bogus');
    expect(body.available).toEqual([
      'flow',
      'node',
      'connector',
      'action',
      'componentSpec',
      'style',
    ]);
  });
});

describe('GET /api/ids/:type/:count', () => {
  it('mints node ids with the `node-` prefix and 10 base62 chars', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/ids/node/5');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; ids: string[] };
    expect(body.ok).toBe(true);
    expect(body.ids).toHaveLength(5);
    for (const id of body.ids) {
      expect(/^node-[A-Za-z0-9]{10}$/.test(id)).toBe(true);
    }
    // No duplicates in a single batch.
    expect(new Set(body.ids).size).toBe(5);
  });

  it('mints connector ids with the `conn-` prefix', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/ids/connector/3');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; ids: string[] };
    expect(body.ok).toBe(true);
    expect(body.ids).toHaveLength(3);
    for (const id of body.ids) {
      expect(/^conn-[A-Za-z0-9]{10}$/.test(id)).toBe(true);
    }
  });

  it('accepts the upper bound (100) but rejects 101', async () => {
    const { app } = buildApp();
    const okRes = await app.request('/api/ids/node/100');
    expect(okRes.status).toBe(200);
    const okBody = (await okRes.json()) as { ok: boolean; ids: string[] };
    expect(okBody.ids).toHaveLength(100);

    const badRes = await app.request('/api/ids/node/101');
    expect(badRes.status).toBe(400);
    const badBody = (await badRes.json()) as { ok: boolean; error: string };
    expect(badBody.ok).toBe(false);
    expect(badBody.error).toContain('invalid count: 101');
  });

  it('rejects unknown types with 400 and lists valid ones', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/ids/conn/3');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('invalid type: conn');
    expect(body.error).toContain('node');
    expect(body.error).toContain('connector');
  });

  it('rejects non-integer / zero / negative counts with 400', async () => {
    const { app } = buildApp();
    for (const bad of ['0', '-1', 'abc', '1.5']) {
      const res = await app.request(`/api/ids/node/${encodeURIComponent(bad)}`);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toContain(`invalid count: ${bad}`);
    }
  });
});

describe('GET /api/flows', () => {
  it('returns the registry list as summaries', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    await post(app, '/api/flows/register', { repoPath, flowPath: 'flow.json' });

    const res = await app.request('/api/flows');
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{
      id: string;
      slug: string;
      name: string;
      repoPath: string;
      lastModified: number;
      valid: boolean;
    }>;
    expect(list).toHaveLength(1);
    expect(list[0]?.slug).toBe('checkout-flow/main');
    expect(list[0]?.name).toBe('Checkout Flow');
    expect(list[0]?.valid).toBe(true);
  });

  it('flags entries whose demo file no longer exists as valid:false', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    await post(app, '/api/flows/register', { repoPath, flowPath: 'flow.json' });

    rmSync(join(repoPath, 'flow.json'));

    const list = (await (await app.request('/api/flows')).json()) as Array<{ valid: boolean }>;
    expect(list).toHaveLength(1);
    expect(list[0]?.valid).toBe(false);
  });

  it('rehydrates registered demos after the registry is rebuilt from disk', async () => {
    const registryPath = tmpRegistry();
    const repoA = tmpRepoWithDemo();
    const repoB = tmpRepoWithDemo({ ...VALID_DEMO, name: 'Other Flow' });

    const reg1 = createRegistry({ path: registryPath });
    const app1 = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry: reg1,
      disableWatcher: true,
    });
    await post(app1, '/api/flows/register', {
      repoPath: repoA,
      flowPath: 'flow.json',
    });
    await post(app1, '/api/flows/register', {
      repoPath: repoB,
      flowPath: 'flow.json',
    });

    const reg2 = createRegistry({ path: registryPath });
    const app2 = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry: reg2,
      disableWatcher: true,
    });
    const list = (await (await app2.request('/api/flows')).json()) as Array<{
      slug: string;
      valid: boolean;
    }>;
    expect(list).toHaveLength(2);
    expect(list.map((e) => e.slug).sort()).toEqual(['checkout-flow/main', 'other-flow/main']);
    expect(list.every((e) => e.valid)).toBe(true);
  });
});

describe('GET /api/flows/:id', () => {
  it('returns the validated demo + filePath when watcher is disabled (sync read fallback)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await app.request(`/api/flows/${reg.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      slug: string;
      name: string;
      filePath: string;
      flow: { name: string };
      valid: boolean;
      error: string | null;
    };
    expect(body.valid).toBe(true);
    expect(body.flow.name).toBe('Checkout Flow');
    expect(body.filePath.endsWith('flow.json')).toBe(true);
    expect(body.error).toBeNull();
  });

  it('returns 404 for unknown demo ids', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/flows/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('reports valid:false + error when on-disk JSON is malformed', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    writeFileSync(join(repoPath, 'flow.json'), '{ broken');

    const res = await app.request(`/api/flows/${reg.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { valid: boolean; error: string | null };
    expect(body.valid).toBe(false);
    expect(body.error).toContain('Invalid JSON');
  });
});

describe('POST /api/flows/:id/play/:nodeId', () => {
  // Fake ProcessSpawner: returns a SpawnHandle whose stdout/stderr come from
  // configurable strings, exited resolves on next microtask with `exitCode`
  // (default 0), and `kill()` is a recorded no-op. Captures every spawn call.
  type SpawnOpts = {
    cmd: string[];
    cwd: string;
    env: Record<string, string>;
    stdin: 'pipe' | 'ignore';
  };
  type FakeRecord = { spawnCalls: SpawnOpts[] };
  const makeFakeSpawner = (
    config: { stdout?: string; stderr?: string; exitCode?: number } = {},
  ): {
    spawner: import('./process-spawner.ts').ProcessSpawner;
    record: FakeRecord;
  } => {
    const record: FakeRecord = { spawnCalls: [] };
    const streamFromString = (s: string): ReadableStream<Uint8Array> =>
      new ReadableStream<Uint8Array>({
        start(c) {
          if (s.length > 0) c.enqueue(new TextEncoder().encode(s));
          c.close();
        },
      });
    const spawner: import('./process-spawner.ts').ProcessSpawner = {
      spawn(opts) {
        record.spawnCalls.push({ cmd: opts.cmd, cwd: opts.cwd, env: opts.env, stdin: opts.stdin });
        let resolveExit: (code: number) => void = () => {};
        const exited = new Promise<number>((res) => {
          resolveExit = res;
        });
        queueMicrotask(() => resolveExit(config.exitCode ?? 0));
        let stdinStream: WritableStream<Uint8Array> | undefined;
        if (opts.stdin === 'pipe') {
          stdinStream = new WritableStream<Uint8Array>({ write() {}, close() {}, abort() {} });
        }
        return {
          pid: 11111,
          stdout: streamFromString(config.stdout ?? ''),
          stderr: streamFromString(config.stderr ?? ''),
          stdin: stdinStream,
          exited,
          kill() {},
        };
      },
    };
    return { spawner, record };
  };

  // Fake StatusRunner: records every restart/stop/stopAll call so tests can
  // assert the /play handler fans out on each click.
  type RunnerCalls = { restart: string[]; stop: string[]; stopAll: number };
  const makeFakeStatusRunner = (): {
    runner: import('./status-runner.ts').StatusRunner;
    calls: RunnerCalls;
  } => {
    const calls: RunnerCalls = { restart: [], stop: [], stopAll: 0 };
    const runner: import('./status-runner.ts').StatusRunner = {
      async restart(flowId) {
        calls.restart.push(flowId);
      },
      async stop(flowId) {
        calls.stop.push(flowId);
      },
      async stopAll() {
        calls.stopAll++;
      },
    };
    return { runner, calls };
  };

  // Build an app with the fake spawner + fake statusRunner pre-wired so the
  // /play tests can drive runPlay through the API surface without touching the
  // OS process table or the filesystem-resident demo file beyond the spawn
  // call assembly.
  const buildPlayApp = (
    spawnerConfig: { stdout?: string; stderr?: string; exitCode?: number } = {},
  ) => {
    const { spawner, record } = makeFakeSpawner(spawnerConfig);
    const { runner, calls } = makeFakeStatusRunner();
    const bus = createEventBus();
    const registry = createRegistry({ path: tmpRegistry() });
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      events: bus,
      disableWatcher: true,
      processSpawner: spawner,
      statusRunner: runner,
    });
    return { app, bus, registry, spawnerRecord: record, runnerCalls: calls };
  };

  // Flow with a play.ts script staged inside the per-node folder
  // (<repo>/nodes/api-checkout/scripts/) so the realpath check in
  // proxy.ts:resolveScript passes.
  const demoWithPlayScript = (scriptPath = 'scripts/play.ts') => ({
    ...VALID_DEMO,
    nodes: [
      {
        ...VALID_DEMO.nodes[0],
        data: {
          ...VALID_DEMO.nodes[0]?.data,
          playAction: { kind: 'script', interpreter: 'bun', scriptPath },
        },
      },
    ],
  });

  const tmpRepoWithPlayScript = (scriptName = 'play.ts') => {
    const repoPath = tmpRepoWithDemo(demoWithPlayScript(`scripts/${scriptName}`));
    const nodeScripts = join(repoPath, 'nodes', 'api-checkout', 'scripts');
    mkdirSync(nodeScripts, { recursive: true });
    writeFileSync(join(nodeScripts, scriptName), '// stub\n');
    return repoPath;
  };

  it('spawns the script and returns parsed JSON body with status 200', async () => {
    const { app, spawnerRecord } = buildPlayApp({ stdout: '{"ok":true,"echoed":42}\n' });
    const repoPath = tmpRepoWithPlayScript();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/play/api-checkout`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string; status?: number; body?: unknown };
    expect(typeof body.runId).toBe('string');
    expect(body.status).toBe(200);
    expect(body.body).toEqual({ ok: true, echoed: 42 });

    // Verify the spawner was actually invoked with the resolved abs script path.
    expect(spawnerRecord.spawnCalls).toHaveLength(1);
    const call = spawnerRecord.spawnCalls[0];
    expect(call?.cmd[0]).toBe('bun');
    expect(call?.cmd[1]?.endsWith('/scripts/play.ts')).toBe(true);
    expect(call?.cwd).toBe(repoPath);
    expect(call?.env.SEEFLOW_DEMO_ID).toBe(reg.id);
    expect(call?.env.SEEFLOW_NODE_ID).toBe('api-checkout');
  });

  it('broadcasts node:running and node:done around the spawn', async () => {
    const { app, bus } = buildPlayApp({ stdout: '{"ok":true}' });
    const repoPath = tmpRepoWithPlayScript();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const captured: Array<{ type: string; payload: unknown }> = [];
    bus.subscribe(reg.id, (e) => captured.push({ type: e.type, payload: e.payload }));

    const playRes = await post(app, `/api/flows/${reg.id}/play/api-checkout`, {});
    expect(playRes.status).toBe(200);

    const types = captured.map((e) => e.type);
    expect(types[0]).toBe('node:running');
    expect(types[types.length - 1]).toBe('node:done');
    const done = captured[captured.length - 1]?.payload as { nodeId: string; status: number };
    expect(done.nodeId).toBe('api-checkout');
    expect(done.status).toBe(200);
  });

  it('Play click triggers statusRunner.restart for the flowId', async () => {
    const { app, runnerCalls } = buildPlayApp({ stdout: '{"ok":true}' });
    const repoPath = tmpRepoWithPlayScript();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/play/api-checkout`, {});
    expect(res.status).toBe(200);

    expect(runnerCalls.restart).toEqual([reg.id]);
  });

  it('a second Play click calls statusRunner.restart again', async () => {
    const { app, runnerCalls } = buildPlayApp({ stdout: '{"ok":true}' });
    const repoPath = tmpRepoWithPlayScript();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    await post(app, `/api/flows/${reg.id}/play/api-checkout`, {});
    await post(app, `/api/flows/${reg.id}/play/api-checkout`, {});

    expect(runnerCalls.restart).toEqual([reg.id, reg.id]);
  });

  it('returns 400 when the scriptPath escapes the project root via symlink', async () => {
    const { app } = buildPlayApp({ stdout: '{}' });
    // Build a demo whose playAction points at `escape.ts` (textually clean) and
    // stage a symlink at <repo>/nodes/api-checkout/escape.ts pointing outside the root.
    const repoPath = tmpRepoWithDemo({
      ...VALID_DEMO,
      nodes: [
        {
          ...VALID_DEMO.nodes[0],
          data: {
            ...VALID_DEMO.nodes[0]?.data,
            playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'escape.ts' },
          },
        },
      ],
    });
    const outside = mkdtempSync(join(tmpdir(), 'seeflow-api-out-'));
    writeFileSync(join(outside, 'evil.ts'), '// outside');
    symlinkSync(join(outside, 'evil.ts'), join(repoPath, 'escape.ts'));

    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/play/api-checkout`, {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('scriptPath escapes project root');
  });

  it('returns 404 for unknown flowId', async () => {
    const { app } = buildPlayApp();
    const res = await post(app, '/api/flows/nope/play/x', {});
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown nodeId', async () => {
    const { app } = buildPlayApp({ stdout: '{}' });
    const repoPath = tmpRepoWithPlayScript();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };
    const res = await post(app, `/api/flows/${reg.id}/play/missing`, {});
    expect(res.status).toBe(404);
  });

  it('returns 400 when the node has no playAction', async () => {
    const { app } = buildPlayApp({ stdout: '{}' });
    // Build a demo whose node is a rectangle (no playAction by definition).
    const demo = {
      version: 2,
      name: 'Shape only',
      nodes: [
        {
          id: 'shape-only',
          type: 'rectangle',
          data: {},
        },
      ],
      connectors: [],
    };
    const repoPath = tmpRepoWithDemo(demo);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/play/shape-only`, {});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/flows/:id/reset', () => {
  // US-008: /reset now spawns a script (replacing the legacy HTTP resetAction)
  // and orchestrates stopAllPlays + statusRunner.stop BEFORE the spawn, plus
  // statusRunner.restart fire-and-forget after the flow:reload broadcast. The
  // suite uses an injectable proxy facade + a fake statusRunner so we can
  // assert call order across all three subsystems without spinning up real
  // child processes or stubbing an HTTP server.
  type ResetActionShape = {
    kind: 'script';
    interpreter: string;
    scriptPath: string;
    args?: string[];
  };
  const demoWithResetAction = (action: ResetActionShape) => ({
    ...VALID_DEMO,
    resetAction: action,
  });

  type ProxyCall =
    | { kind: 'stopAllPlays'; flowId: string }
    | { kind: 'runReset'; flowId: string }
    | { kind: 'runPlay'; flowId: string; nodeId: string };
  type RunnerCall = { kind: 'stop' | 'restart' | 'stopAll'; flowId?: string };

  const makeFakeProxy = (
    resetResult: { ok: boolean; body?: unknown; error?: string },
    log: Array<ProxyCall | RunnerCall>,
  ): import('./api.ts').ProxyFacade => {
    return {
      async stopAllPlays(flowId) {
        log.push({ kind: 'stopAllPlays', flowId });
      },
      async runReset({ flowId, events }) {
        log.push({ kind: 'runReset', flowId });
        events.broadcast({
          type: 'demo:reset',
          flowId,
          payload: resetResult,
        });
        return resetResult;
      },
      async runPlay({ flowId, nodeId, events }) {
        log.push({ kind: 'runPlay', flowId, nodeId });
        const runId = 'fake-run-id';
        events.broadcast({ type: 'node:done', flowId, payload: { nodeId, runId, status: 200 } });
        return { runId, status: 200, body: {} };
      },
    };
  };

  const makeFakeStatusRunner = (
    log: Array<ProxyCall | RunnerCall>,
  ): import('./status-runner.ts').StatusRunner => ({
    async stop(flowId) {
      log.push({ kind: 'stop', flowId });
    },
    async restart(flowId) {
      log.push({ kind: 'restart', flowId });
    },
    async stopAll() {
      log.push({ kind: 'stopAll' });
    },
  });

  const buildResetApp = (
    options: {
      resetResult?: { ok: boolean; body?: unknown; error?: string };
    } = {},
  ) => {
    const log: Array<ProxyCall | RunnerCall> = [];
    const bus = createEventBus();
    const registry = createRegistry({ path: tmpRegistry() });
    const proxy = makeFakeProxy(options.resetResult ?? { ok: true, body: { ok: true } }, log);
    const statusRunner = makeFakeStatusRunner(log);
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      events: bus,
      disableWatcher: true,
      proxy,
      statusRunner,
    });
    return { app, registry, bus, log };
  };

  it('returns 200 and broadcasts flow:reload when the demo has no resetAction', async () => {
    const { app, bus, log } = buildResetApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const captured: Array<{ type: string }> = [];
    bus.subscribe(reg.id, (e) => captured.push({ type: e.type }));

    const res = await post(app, `/api/flows/${reg.id}/reset`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; calledResetAction: boolean };
    expect(body.ok).toBe(true);
    expect(body.calledResetAction).toBe(false);

    expect(captured.map((e) => e.type)).toEqual(['flow:reload']);
    // stop + reload + restart still happen even when there's no resetAction;
    // runReset is the only step skipped.
    const kinds = log.map((c) => c.kind);
    expect(kinds).toContain('stopAllPlays');
    expect(kinds).toContain('stop');
    expect(kinds).toContain('restart');
    expect(kinds).not.toContain('runReset');
  });

  it('stops plays + status BEFORE invoking resetAction, then runs it, then reloads + restarts', async () => {
    const { app, log } = buildResetApp({ resetResult: { ok: true, body: { ok: true } } });
    const repoPath = tmpRepoWithDemo(
      demoWithResetAction({
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/reset.ts',
      }),
    );
    // Stage the script file so the demo doesn't fail any future realpath
    // checks (the fake proxy doesn't actually validate, but matches reality).
    mkdirSync(join(repoPath, 'scripts'), { recursive: true });
    writeFileSync(join(repoPath, 'scripts', 'reset.ts'), '// stub\n');

    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/reset`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; calledResetAction: boolean };
    expect(body.ok).toBe(true);
    expect(body.calledResetAction).toBe(true);

    // Order assertion: stopAllPlays + stop must both happen BEFORE runReset.
    const idxStopPlays = log.findIndex((c) => c.kind === 'stopAllPlays');
    const idxStopStatus = log.findIndex((c) => c.kind === 'stop');
    const idxRunReset = log.findIndex((c) => c.kind === 'runReset');
    const idxRestart = log.findIndex((c) => c.kind === 'restart');
    expect(idxStopPlays).toBeGreaterThanOrEqual(0);
    expect(idxStopStatus).toBeGreaterThanOrEqual(0);
    expect(idxRunReset).toBeGreaterThan(idxStopPlays);
    expect(idxRunReset).toBeGreaterThan(idxStopStatus);
    // restart is the very last call (fire-and-forget after broadcast).
    expect(idxRestart).toBeGreaterThan(idxRunReset);
  });

  it('broadcasts flow:reload AND demo:reset around a successful reset script', async () => {
    const { app, bus } = buildResetApp({ resetResult: { ok: true, body: { wiped: true } } });
    const repoPath = tmpRepoWithDemo(
      demoWithResetAction({
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/reset.ts',
      }),
    );
    mkdirSync(join(repoPath, 'scripts'), { recursive: true });
    writeFileSync(join(repoPath, 'scripts', 'reset.ts'), '// stub\n');

    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const captured: Array<{ type: string }> = [];
    bus.subscribe(reg.id, (e) => captured.push({ type: e.type }));

    await post(app, `/api/flows/${reg.id}/reset`, {});

    expect(captured.map((e) => e.type)).toEqual(['demo:reset', 'flow:reload']);
  });

  it('returns 502 with the error message but still broadcasts flow:reload + restarts on reset-script failure', async () => {
    const { app, bus, log } = buildResetApp({
      resetResult: { ok: false, error: 'reset script exited with code 1' },
    });
    const repoPath = tmpRepoWithDemo(
      demoWithResetAction({
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/reset.ts',
      }),
    );
    mkdirSync(join(repoPath, 'scripts'), { recursive: true });
    writeFileSync(join(repoPath, 'scripts', 'reset.ts'), '// stub\n');

    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const captured: Array<{ type: string }> = [];
    bus.subscribe(reg.id, (e) => captured.push({ type: e.type }));

    const res = await post(app, `/api/flows/${reg.id}/reset`, {});
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; calledResetAction: boolean };
    expect(body.calledResetAction).toBe(true);
    expect(body.error).toBe('reset script exited with code 1');

    // flow:reload still fires; statusRunner.restart still fires.
    expect(captured.map((e) => e.type)).toContain('flow:reload');
    expect(log.map((c) => c.kind)).toContain('restart');
  });

  it('returns 404 for an unknown flowId', async () => {
    const { app } = buildResetApp();
    const res = await post(app, '/api/flows/does-not-exist/reset', {});
    expect(res.status).toBe(404);
  });
});

describe('POST /api/emit', () => {
  const buildAppWithBus = () => {
    const bus = createEventBus();
    const registry = createRegistry({ path: tmpRegistry() });
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      events: bus,
      disableWatcher: true,
    });
    return { app, registry, bus };
  };

  it('broadcasts node:running for status=running and returns ok', async () => {
    const { app, bus } = buildAppWithBus();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const captured: Array<{ type: string; payload: unknown }> = [];
    bus.subscribe(reg.id, (e) => captured.push({ type: e.type, payload: e.payload }));

    const res = await post(app, '/api/emit', {
      flowId: reg.id,
      nodeId: 'worker',
      status: 'running',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.type).toBe('node:running');
    expect((captured[0]?.payload as { nodeId: string }).nodeId).toBe('worker');
  });

  it('maps status=done → node:done and merges payload', async () => {
    const { app, bus } = buildAppWithBus();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const captured: Array<{ type: string; payload: unknown }> = [];
    bus.subscribe(reg.id, (e) => captured.push({ type: e.type, payload: e.payload }));

    const res = await post(app, '/api/emit', {
      flowId: reg.id,
      nodeId: 'worker',
      status: 'done',
      runId: 'run-42',
      payload: { status: 200, body: { ok: true } },
    });
    expect(res.status).toBe(200);

    expect(captured).toHaveLength(1);
    expect(captured[0]?.type).toBe('node:done');
    const payload = captured[0]?.payload as {
      nodeId: string;
      runId: string;
      status: number;
      body: unknown;
    };
    expect(payload.nodeId).toBe('worker');
    expect(payload.runId).toBe('run-42');
    expect(payload.status).toBe(200);
    expect(payload.body).toEqual({ ok: true });
  });

  it('maps status=error → node:error', async () => {
    const { app, bus } = buildAppWithBus();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const captured: Array<{ type: string }> = [];
    bus.subscribe(reg.id, (e) => captured.push({ type: e.type }));

    const res = await post(app, '/api/emit', {
      flowId: reg.id,
      nodeId: 'worker',
      status: 'error',
      payload: { message: 'boom' },
    });
    expect(res.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.type).toBe('node:error');
  });

  it('returns 404 when flowId is unknown', async () => {
    const { app } = buildAppWithBus();
    const res = await post(app, '/api/emit', {
      flowId: 'does-not-exist',
      nodeId: 'worker',
      status: 'running',
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when status is not one of running|done|error', async () => {
    const { app } = buildAppWithBus();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await post(app, '/api/emit', {
      flowId: reg.id,
      nodeId: 'worker',
      status: 'oops',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not valid JSON', async () => {
    const { app } = buildAppWithBus();
    const res = await app.request('/api/emit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/events', () => {
  it('returns 400 when flowId is missing', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/events');
    expect(res.status).toBe(400);
  });

  it('returns 404 when flowId is unknown', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/events?flowId=nope');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/registry/events', () => {
  it('opens an SSE stream and delivers the initial hello frame', async () => {
    const registry = createRegistry({ path: tmpRegistry() });
    const events = createEventBus();
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      events,
      disableWatcher: true,
    });

    const res = await app.request('/api/registry/events');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body?.getReader();
    if (!reader) throw new Error('SSE body missing');
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('event: hello');
    expect(text).toContain('"channel":"registry"');

    await reader.cancel();
  });

  it('routes broadcasts on the __registry__ channel through to subscribers', () => {
    const events = createEventBus();
    let seen = 0;
    const unsub = events.subscribe('__registry__', (e) => {
      if (e.type === 'registry:reload') seen += 1;
    });
    events.broadcast({
      type: 'registry:reload',
      flowId: '__registry__',
      payload: {},
    });
    expect(seen).toBe(1);
    unsub();
  });
});

describe('PATCH /api/flows/:id/nodes/:nodeId/position', () => {
  const patch = (app: ReturnType<typeof buildApp>['app'], path: string, body: unknown) =>
    app.request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('updates the node position and rewrites the demo file', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const styleFile = join(repoPath, 'style.json');

    const res = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout/position`, {
      x: 250,
      y: 320,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; position: { x: number; y: number } };
    expect(body.ok).toBe(true);
    expect(body.position).toEqual({ x: 250, y: 320 });

    const style = JSON.parse(readFileSync(styleFile, 'utf8')) as {
      nodes: Record<string, { position: { x: number; y: number } }>;
    };
    expect(style.nodes['api-checkout']?.position).toEqual({ x: 250, y: 320 });
  });

  it('preserves 2-space indent and trailing newline (clean editor diffs)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');
    await patch(app, `/api/flows/${reg.id}/nodes/api-checkout/position`, { x: 1, y: 2 });

    const text = readFileSync(demoFile, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    // Top-level "version" line should be indented with 2 spaces.
    expect(text).toMatch(/^\{\n {2}"version": 2,/);
  });

  it('returns 404 for unknown flowId', async () => {
    const { app } = buildApp();
    const res = await patch(app, '/api/flows/nope/nodes/x/position', { x: 0, y: 0 });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown nodeId', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };
    const res = await patch(app, `/api/flows/${reg.id}/nodes/missing/position`, { x: 0, y: 0 });
    expect(res.status).toBe(404);
  });

  it('returns 400 when x or y is non-numeric', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };
    const res = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout/position`, {
      x: 'oops',
      y: 0,
    });
    expect(res.status).toBe(400);
  });

  it('writes via tempfile + rename (no .tmp residue, preserves content on success)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    await patch(app, `/api/flows/${reg.id}/nodes/api-checkout/position`, { x: 99, y: 99 });

    const files = readdirSync(repoPath).sort();
    // Only flow.json + style.json should remain — temp files must be renamed/cleaned up.
    expect(files).toEqual(['flow.json', 'style.json']);
  });
});

describe('PATCH /api/flows/:id/nodes/:nodeId/order', () => {
  const VALID_DEMO_THREE_NODES = {
    version: 2,
    name: 'Three Nodes',
    nodes: [
      {
        id: 'a',
        type: 'rectangle',
        data: {},
      },
      {
        id: 'b',
        type: 'rectangle',
        data: {},
      },
      {
        id: 'c',
        type: 'rectangle',
        data: {},
      },
    ],
    connectors: [],
  };

  const patch = (app: ReturnType<typeof buildApp>['app'], path: string, body: unknown) =>
    app.request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const ids = (path: string) =>
    (JSON.parse(readFileSync(path, 'utf8')) as { nodes: Array<{ id: string }> }).nodes.map(
      (n) => n.id,
    );

  const setup = async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_THREE_NODES);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };
    const demoFile = join(repoPath, 'flow.json');
    return { app, demoFile, flowId: reg.id };
  };

  it("op:'forward' swaps with the next neighbour", async () => {
    const { app, demoFile, flowId } = await setup();
    const res = await patch(app, `/api/flows/${flowId}/nodes/a/order`, { op: 'forward' });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['b', 'a', 'c']);
  });

  it("op:'forward' on the topmost node is a no-op", async () => {
    const { app, demoFile, flowId } = await setup();
    const res = await patch(app, `/api/flows/${flowId}/nodes/c/order`, { op: 'forward' });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['a', 'b', 'c']);
  });

  it("op:'backward' swaps with the previous neighbour", async () => {
    const { app, demoFile, flowId } = await setup();
    const res = await patch(app, `/api/flows/${flowId}/nodes/c/order`, { op: 'backward' });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['a', 'c', 'b']);
  });

  it("op:'backward' on the bottommost node is a no-op", async () => {
    const { app, demoFile, flowId } = await setup();
    const res = await patch(app, `/api/flows/${flowId}/nodes/a/order`, { op: 'backward' });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['a', 'b', 'c']);
  });

  it("op:'toFront' moves to the end of the array", async () => {
    const { app, demoFile, flowId } = await setup();
    const res = await patch(app, `/api/flows/${flowId}/nodes/a/order`, { op: 'toFront' });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['b', 'c', 'a']);
  });

  it("op:'toBack' moves to the start of the array", async () => {
    const { app, demoFile, flowId } = await setup();
    const res = await patch(app, `/api/flows/${flowId}/nodes/c/order`, { op: 'toBack' });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['c', 'a', 'b']);
  });

  it("op:'toIndex' pins to an absolute index (used by undo)", async () => {
    const { app, demoFile, flowId } = await setup();
    // Move 'a' (idx 0) to idx 2 — same as toFront on a 3-node array.
    const res = await patch(app, `/api/flows/${flowId}/nodes/a/order`, { op: 'toIndex', index: 2 });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['b', 'c', 'a']);

    // Then pin it back to idx 0 — exact inverse.
    const res2 = await patch(app, `/api/flows/${flowId}/nodes/a/order`, {
      op: 'toIndex',
      index: 0,
    });
    expect(res2.status).toBe(200);
    expect(ids(demoFile)).toEqual(['a', 'b', 'c']);
  });

  it("op:'toIndex' clamps out-of-range indices", async () => {
    const { app, demoFile, flowId } = await setup();
    const res = await patch(app, `/api/flows/${flowId}/nodes/a/order`, {
      op: 'toIndex',
      index: 99,
    });
    expect(res.status).toBe(200);
    // Clamped to length-1 = 2 → same as toFront.
    expect(ids(demoFile)).toEqual(['b', 'c', 'a']);
  });

  it('returns 400 for an unknown op', async () => {
    const { app, demoFile, flowId } = await setup();
    const res = await patch(app, `/api/flows/${flowId}/nodes/a/order`, { op: 'noSuchOp' });
    expect(res.status).toBe(400);
    expect(ids(demoFile)).toEqual(['a', 'b', 'c']);
  });

  it('returns 404 for unknown nodeId', async () => {
    const { app, flowId } = await setup();
    const res = await patch(app, `/api/flows/${flowId}/nodes/missing/order`, { op: 'forward' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown flowId', async () => {
    const { app } = buildApp();
    const res = await patch(app, '/api/flows/nope/nodes/a/order', { op: 'forward' });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/flows/:id/nodes/:nodeId', () => {
  const patch = (app: ReturnType<typeof buildApp>['app'], path: string, body: unknown) =>
    app.request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('merges a partial update into node.data and rewrites the demo file', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');
    const styleFile = join(repoPath, 'style.json');

    const res = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, {
      name: 'POST /checkout (renamed)',
      borderColor: 'blue',
      backgroundColor: 'amber',
      width: 240,
      height: 120,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const arch = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: { name: string; playAction: { kind: string } } }>;
    };
    const style = JSON.parse(readFileSync(styleFile, 'utf8')) as {
      nodes: Record<
        string,
        { borderColor?: string; backgroundColor?: string; width?: number; height?: number }
      >;
    };
    const node = arch.nodes.find((n) => n.id === 'api-checkout');
    expect(node?.data.name).toBe('POST /checkout (renamed)');
    expect(node?.data.playAction.kind).toBe('script');
    const styleEntry = style.nodes['api-checkout'];
    expect(styleEntry?.borderColor).toBe('blue');
    expect(styleEntry?.backgroundColor).toBe('amber');
    expect(styleEntry?.width).toBe(240);
    expect(styleEntry?.height).toBe(120);
  });

  it('updates node.position when included in the patch body', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const styleFile = join(repoPath, 'style.json');
    const res = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, {
      position: { x: 42, y: 84 },
    });
    expect(res.status).toBe(200);

    const style = JSON.parse(readFileSync(styleFile, 'utf8')) as {
      nodes: Record<string, { position: { x: number; y: number } }>;
    };
    expect(style.nodes['api-checkout']?.position).toEqual({ x: 42, y: 84 });
  });

  it('returns 400 with issues when the patched demo would fail schema validation', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');
    const before = readFileSync(demoFile, 'utf8');

    // borderColor token outside the enum — the body schema itself should reject this.
    const res = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, {
      borderColor: 'neon-pink',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues?: unknown };
    expect(body.error).toBeTruthy();

    // The file must NOT have been touched on validation failure.
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('returns 400 when the resulting demo violates FlowSchema (retype to image without path)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');
    const before = readFileSync(demoFile, 'utf8');

    // Under the flat schema, `name` is optional on every type, so the legacy
    // "empty name" rejection no longer applies. The schema-fence test now
    // retypes a rectangle to `image` without supplying the required `path`
    // field — the merge succeeds, then the post-merge ResolvedFlowSchema
    // reparse surfaces it as badSchema (400).
    const res = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, { type: 'image' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues?: unknown };
    expect(body.error).toContain('schema');

    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('returns 400 when the body has an unknown top-level key', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, {
      somethingMadeUp: true,
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown flowId', async () => {
    const { app } = buildApp();
    const res = await patch(app, '/api/flows/nope/nodes/x', { name: 'x' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown nodeId', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };
    const res = await patch(app, `/api/flows/${reg.id}/nodes/missing`, { name: 'x' });
    expect(res.status).toBe(404);
  });

  it('preserves 2-space indent + trailing newline on rewrite', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');
    await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, { name: 'Renamed' });

    const text = readFileSync(demoFile, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toMatch(/^\{\n {2}"version": 2,/);
  });

  // Three-field consolidation: description (short body) + detail (long form)
  // land at the top level of node.data and round-trip through FlowSchema
  // unchanged. Empty string on either field is the documented clear-on-
  // serialize signal — mergeNodeUpdates strips the key so the on-disk demo
  // stays compact.
  it('persists description inline + externalizes detail to nodes/<id>/detail.md', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');
    const res = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, {
      description: 'short body',
      detail: 'multi-line\nnotes about the node',
    });
    expect(res.status).toBe(200);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: { description?: string; detail?: string } }>;
    };
    const node = onDisk.nodes.find((n) => n.id === 'api-checkout');
    expect(node?.data.description).toBe('short body');
    expect(node?.data.detail).toBe('file://detail.md');
    expect(readFileSync(join(repoPath, 'nodes', 'api-checkout', 'detail.md'), 'utf8')).toBe(
      'multi-line\nnotes about the node',
    );
  });

  it('strips description on empty; empties detail.md but keeps the file:// ref', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');
    // First set both fields, then clear them with empty strings.
    await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, {
      description: 'tmp',
      detail: 'tmp notes',
    });
    const res = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, {
      description: '',
      detail: '',
    });
    expect(res.status).toBe(200);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: Record<string, unknown> }>;
    };
    const node = onDisk.nodes.find((n) => n.id === 'api-checkout');
    expect(node?.data.description).toBeUndefined();
    expect('description' in (node?.data ?? {})).toBe(false);
    expect(node?.data.detail).toBe('file://detail.md');
    expect(readFileSync(join(repoPath, 'nodes', 'api-checkout', 'detail.md'), 'utf8')).toBe('');
  });

  // US-009: persist an icon name, then clear it via null. NodePatchBodySchema
  // accepts string | null | undefined for icon; mergeNodeUpdates strips the
  // key from disk on null (same compactness rule used for description /
  // detail empty-string).
  it('persists icon name then strips it on disk when null is patched', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');
    const setRes = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, {
      icon: 'database',
    });
    expect(setRes.status).toBe(200);
    let onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: Record<string, unknown> }>;
    };
    expect(onDisk.nodes.find((n) => n.id === 'api-checkout')?.data.icon).toBe('database');

    const clearRes = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, {
      icon: null,
    });
    expect(clearRes.status).toBe(200);
    onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: Record<string, unknown> }>;
    };
    const node = onDisk.nodes.find((n) => n.id === 'api-checkout');
    expect(node?.data.icon).toBeUndefined();
    expect('icon' in (node?.data ?? {})).toBe(false);
  });

  it('patches html on an html by writing nodes/<id>/view.html', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    await post(app, `/api/flows/${reg.id}/nodes`, {
      id: 'html-patch',
      type: 'html',
      data: { html: 'initial' },
    });
    const res = await patch(app, `/api/flows/${reg.id}/nodes/html-patch`, {
      html: '<p>via PATCH</p>',
    });
    expect(res.status).toBe(200);

    const onDisk = JSON.parse(readFileSync(join(repoPath, 'flow.json'), 'utf8')) as {
      nodes: Array<{ id: string; data: { html?: string } }>;
    };
    expect(onDisk.nodes.find((n) => n.id === 'html-patch')?.data.html).toBe('file://view.html');
    expect(readFileSync(join(repoPath, 'nodes', 'html-patch', 'view.html'), 'utf8')).toBe(
      '<p>via PATCH</p>',
    );
  });
});

describe('POST /api/flows/:id/nodes', () => {
  it('appends a new node and auto-generates an id when absent', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');

    const res = await post(app, `/api/flows/${reg.id}/nodes`, {
      type: 'rectangle',
      data: { name: 'Note A' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^node-/);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; type: string }>;
    };
    expect(onDisk.nodes).toHaveLength(2);
    const created = onDisk.nodes.find((n) => n.id === body.id);
    expect(created?.type).toBe('rectangle');
  });

  it('honors a caller-provided id when given', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/nodes`, {
      id: 'sticky-note-1',
      type: 'sticky',
      data: {},
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('sticky-note-1');
  });

  it('returns 400 with schema issues when the new node is malformed', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');
    const before = readFileSync(demoFile, 'utf8');

    // type 'image' requires a `path` field anchored under `nodes/<id>/`;
    // omitting it surfaces as a post-merge ResolvedFlowSchema reparse
    // failure (badSchema → 400) per US-009's per-type required-field gate.
    const res = await post(app, `/api/flows/${reg.id}/nodes`, {
      type: 'image',
      data: {},
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues?: unknown };
    expect(body.error).toContain('schema');

    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('returns 404 for unknown flowId', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/flows/nope/nodes', {
      type: 'rectangle',
      data: {},
    });
    expect(res.status).toBe(404);
  });

  it('externalizes detail to nodes/<id>/detail.md when provided', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');
    const res = await post(app, `/api/flows/${reg.id}/nodes`, {
      id: 'with-detail',
      type: 'rectangle',
      data: { detail: 'hello world' },
    });
    expect(res.status).toBe(200);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: { detail?: string } }>;
    };
    const node = onDisk.nodes.find((n) => n.id === 'with-detail');
    expect(node?.data.detail).toBe('file://detail.md');
    expect(readFileSync(join(repoPath, 'nodes', 'with-detail', 'detail.md'), 'utf8')).toBe(
      'hello world',
    );
  });

  it('writes an empty detail.md and file:// ref when detail is omitted', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');
    await post(app, `/api/flows/${reg.id}/nodes`, {
      id: 'no-detail',
      type: 'rectangle',
      data: {},
    });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: { detail?: string } }>;
    };
    const node = onDisk.nodes.find((n) => n.id === 'no-detail');
    expect(node?.data.detail).toBe('file://detail.md');
    expect(readFileSync(join(repoPath, 'nodes', 'no-detail', 'detail.md'), 'utf8')).toBe('');
  });

  // html externalization: every html write lands in
  // `nodes/<id>/view.html`; flow.json carries the file:// ref.
  describe('html html externalization', () => {
    it('writes nodes/<id>/view.html (empty) and persists file:// ref when html is omitted', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/flows/register', {
          repoPath,
          flowPath: 'flow.json',
        })
      ).json()) as { id: string };

      const res = await post(app, `/api/flows/${reg.id}/nodes`, {
        id: 'hero-block',
        type: 'html',
        data: {},
      });
      expect(res.status).toBe(200);

      const onDisk = JSON.parse(readFileSync(join(repoPath, 'flow.json'), 'utf8')) as {
        nodes: Array<{ id: string; type: string; data: { html?: string } }>;
      };
      const persisted = onDisk.nodes.find((n) => n.id === 'hero-block');
      expect(persisted?.data.html).toBe('file://view.html');
      expect(readFileSync(join(repoPath, 'nodes', 'hero-block', 'view.html'), 'utf8')).toBe('');
    });

    it('writes nodes/<id>/view.html with content when html is provided', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/flows/register', {
          repoPath,
          flowPath: 'flow.json',
        })
      ).json()) as { id: string };

      const res = await post(app, `/api/flows/${reg.id}/nodes`, {
        id: 'with-content',
        type: 'html',
        data: { html: '<p>inline</p>' },
      });
      expect(res.status).toBe(200);

      const onDisk = JSON.parse(readFileSync(join(repoPath, 'flow.json'), 'utf8')) as {
        nodes: Array<{ id: string; data: { html?: string } }>;
      };
      const persisted = onDisk.nodes.find((n) => n.id === 'with-content');
      expect(persisted?.data.html).toBe('file://view.html');
      expect(readFileSync(join(repoPath, 'nodes', 'with-content', 'view.html'), 'utf8')).toBe(
        '<p>inline</p>',
      );
    });

    it('preserves other data fields when externalizing html', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/flows/register', {
          repoPath,
          flowPath: 'flow.json',
        })
      ).json()) as { id: string };

      const res = await post(app, `/api/flows/${reg.id}/nodes`, {
        id: 'pricing',
        type: 'html',
        data: { name: 'Pricing card', icon: 'tag' },
      });
      expect(res.status).toBe(200);

      const onDisk = JSON.parse(readFileSync(join(repoPath, 'flow.json'), 'utf8')) as {
        nodes: Array<{ id: string; data: { name?: string; icon?: string; html?: string } }>;
      };
      const persisted = onDisk.nodes.find((n) => n.id === 'pricing');
      expect(persisted?.data.name).toBe('Pricing card');
      expect(persisted?.data.icon).toBe('tag');
      expect(persisted?.data.html).toBe('file://view.html');
    });
  });
});

describe('POST /api/flows/:id/bulk', () => {
  it('creates every node + connector atomically in one call and returns ids in order', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/bulk`, {
      nodes: [
        { id: 'b1', type: 'rectangle', data: { name: 'B1' } },
        { id: 'b2', type: 'ellipse', data: { name: 'B2', detail: 'hi' } },
        { id: 'b3', type: 'html', data: { html: '<div>x</div>' } },
      ],
      // Connector references nodes from THIS batch — only works because the
      // merged-graph parse runs after both arrays are pushed.
      connectors: [{ id: 'b1-to-b2', source: 'b1', target: 'b2' }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      nodes: Array<{ id: string; node: { type: string } }>;
      connectors: Array<{ id: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.nodes.map((n) => n.id)).toEqual(['b1', 'b2', 'b3']);
    expect(body.connectors.map((c) => c.id)).toEqual(['b1-to-b2']);

    const onDisk = JSON.parse(readFileSync(join(repoPath, 'flow.json'), 'utf8')) as {
      nodes: Array<{ id: string; data: { detail?: string; html?: string } }>;
      connectors: Array<{ id: string }>;
    };
    // Pre-existing demo had 1 node, bulk added 3.
    expect(onDisk.nodes).toHaveLength(4);
    expect(onDisk.connectors).toHaveLength(1);
    const b2 = onDisk.nodes.find((n) => n.id === 'b2');
    expect(b2?.data.detail).toBe('file://detail.md');
    expect(readFileSync(join(repoPath, 'nodes', 'b2', 'detail.md'), 'utf8')).toBe('hi');
    const b3 = onDisk.nodes.find((n) => n.id === 'b3');
    expect(b3?.data.html).toBe('file://view.html');
    expect(readFileSync(join(repoPath, 'nodes', 'b3', 'view.html'), 'utf8')).toBe('<div>x</div>');
  });

  it('accepts a nodes-only body (no connectors field)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/bulk`, {
      nodes: [{ id: 'only', type: 'rectangle', data: { name: 'only' } }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nodes: unknown[]; connectors: unknown[] };
    expect(body.nodes).toHaveLength(1);
    expect(body.connectors).toHaveLength(0);
  });

  it('rolls back BOTH arrays when a connector dangles against the merged graph', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');
    const before = readFileSync(demoFile, 'utf8');

    const res = await post(app, `/api/flows/${reg.id}/bulk`, {
      nodes: [
        { id: 'good-a', type: 'rectangle', data: { name: 'A' } },
        { id: 'good-b', type: 'ellipse', data: { name: 'B' } },
      ],
      connectors: [{ source: 'good-a', target: 'never-added' }],
    });
    expect(res.status).toBe(400);
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
    // Per-node folders cleaned up.
    expect(existsSync(join(repoPath, 'nodes', 'good-a'))).toBe(false);
    expect(existsSync(join(repoPath, 'nodes', 'good-b'))).toBe(false);
  });

  it('rolls back the whole batch when one node is malformed', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');
    const before = readFileSync(demoFile, 'utf8');

    const res = await post(app, `/api/flows/${reg.id}/bulk`, {
      nodes: [
        { id: 'ok-1', type: 'rectangle', data: { name: 'A' } },
        // type:'image' requires a `path` field anchored under `nodes/<id>/`;
        // omitting it trips the post-mutation parse and rolls back the batch.
        { id: 'bad', type: 'image', data: { name: 'B' } },
      ],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('schema');

    expect(readFileSync(demoFile, 'utf8')).toBe(before);
    expect(existsSync(join(repoPath, 'nodes', 'ok-1'))).toBe(false);
    expect(existsSync(join(repoPath, 'nodes', 'bad'))).toBe(false);
  });

  it('reports intra-batch duplicate node id with collection=nodes', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/bulk`, {
      nodes: [
        { id: 'dupe', type: 'rectangle', data: { name: 'A' } },
        { id: 'dupe', type: 'ellipse', data: { name: 'B' } },
      ],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Duplicate nodes id in batch');
    expect(body.error).toContain('dupe');
  });

  it('reports intra-batch duplicate connector id with collection=connectors', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/bulk`, {
      nodes: [{ id: 'a', type: 'rectangle', data: { name: 'A' } }],
      connectors: [
        { id: 'c-dupe', source: 'a', target: 'a' },
        { id: 'c-dupe', source: 'a', target: 'a' },
      ],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Duplicate connectors id in batch');
  });

  it('reports an id collision with an existing node', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    await post(app, `/api/flows/${reg.id}/nodes`, {
      id: 'taken',
      type: 'rectangle',
      data: { name: 'seed' },
    });

    const res = await post(app, `/api/flows/${reg.id}/bulk`, {
      nodes: [{ id: 'taken', type: 'ellipse', data: { name: 'X' } }],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Node id already exists');
  });

  it('rejects an empty body (no nodes, no connectors)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/bulk`, {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Invalid bulk body');
  });

  it('rejects both-empty-arrays body via the refine', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/bulk`, { nodes: [], connectors: [] });
    expect(res.status).toBe(400);
  });

  it('rejects a batch over the 100-node-item cap', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const oversized = Array.from({ length: 101 }, (_, i) => ({
      type: 'rectangle',
      data: { name: `n${i}` },
    }));
    const res = await post(app, `/api/flows/${reg.id}/bulk`, { nodes: oversized });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown flowId', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/flows/nope/bulk', {
      nodes: [{ type: 'rectangle', data: { name: 'A' } }],
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/flows/:id/nodes/:nodeId', () => {
  const VALID_DEMO_TWO_NODES = {
    version: 2,
    name: 'Two Nodes',
    nodes: [
      {
        id: 'a',
        type: 'rectangle',
        data: {
          name: 'A',
          stateSource: { kind: 'request' },
          playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
        },
      },
      {
        id: 'b',
        type: 'rectangle',
        data: {
          name: 'B',
          stateSource: { kind: 'request' },
          playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
        },
      },
    ],
    connectors: [
      { id: 'a-to-b', source: 'a', target: 'b' },
      { id: 'b-to-a', source: 'b', target: 'a' },
    ],
  };

  it('removes the node and cascades adjacent connectors in one write', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_TWO_NODES);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');

    const res = await app.request(`/api/flows/${reg.id}/nodes/a`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string }>;
      connectors: Array<{ id: string; source: string; target: string }>;
    };
    expect(onDisk.nodes.map((n) => n.id)).toEqual(['b']);
    // Both connectors referenced node 'a' as source or target — both removed.
    expect(onDisk.connectors).toEqual([]);
  });

  it('leaves connectors that do not reference the deleted node untouched', async () => {
    const demo = {
      ...VALID_DEMO_TWO_NODES,
      nodes: [
        ...VALID_DEMO_TWO_NODES.nodes,
        {
          id: 'c',
          type: 'rectangle',
          data: {
            name: 'C',
            stateSource: { kind: 'request' },
            playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
          },
        },
      ],
      connectors: [
        { id: 'a-to-b', source: 'a', target: 'b' },
        { id: 'b-to-c', source: 'b', target: 'c' },
      ],
    };
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(demo);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');
    const res = await app.request(`/api/flows/${reg.id}/nodes/a`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string }>;
      connectors: Array<{ id: string }>;
    };
    expect(onDisk.nodes.map((n) => n.id).sort()).toEqual(['b', 'c']);
    // a-to-b is gone (source==a); b-to-c stays.
    expect(onDisk.connectors.map((c) => c.id)).toEqual(['b-to-c']);
  });

  it('returns 404 for unknown flowId', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/flows/nope/nodes/x', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown nodeId', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };
    const res = await app.request(`/api/flows/${reg.id}/nodes/missing`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('cascades the nodes/<id>/ folder along with the node row', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    await post(app, `/api/flows/${reg.id}/nodes`, {
      id: 'gone',
      type: 'rectangle',
      data: { detail: 'temp' },
    });
    const folder = join(repoPath, 'nodes', 'gone');
    expect(existsSync(folder)).toBe(true);

    const res = await app.request(`/api/flows/${reg.id}/nodes/gone`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(existsSync(folder)).toBe(false);
  });

  describe('html per-node folder cascade', () => {
    it('removes nodes/<id>/view.html and the whole folder on delete', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/flows/register', {
          repoPath,
          flowPath: 'flow.json',
        })
      ).json()) as { id: string };

      const created = (await (
        await post(app, `/api/flows/${reg.id}/nodes`, {
          id: 'cascade-html',
          type: 'html',
          data: { html: '<p>x</p>' },
        })
      ).json()) as { id: string };
      const viewFile = join(repoPath, 'nodes', created.id, 'view.html');
      expect(existsSync(viewFile)).toBe(true);

      const res = await app.request(`/api/flows/${reg.id}/nodes/${created.id}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(existsSync(viewFile)).toBe(false);
      expect(existsSync(join(repoPath, 'nodes', created.id))).toBe(false);

      const onDisk = JSON.parse(readFileSync(join(repoPath, 'flow.json'), 'utf8')) as {
        nodes: Array<{ id: string }>;
      };
      expect(onDisk.nodes.find((n) => n.id === created.id)).toBeUndefined();
    });

    it('does not touch other html folders when an unrelated node is deleted', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/flows/register', {
          repoPath,
          flowPath: 'flow.json',
        })
      ).json()) as { id: string };

      const first = (await (
        await post(app, `/api/flows/${reg.id}/nodes`, {
          id: 'first-html',
          type: 'html',
          data: { html: '<p>1</p>' },
        })
      ).json()) as { id: string };
      const second = (await (
        await post(app, `/api/flows/${reg.id}/nodes`, {
          id: 'second-html',
          type: 'html',
          data: { html: '<p>2</p>' },
        })
      ).json()) as { id: string };
      const firstFile = join(repoPath, 'nodes', first.id, 'view.html');
      const secondFile = join(repoPath, 'nodes', second.id, 'view.html');
      expect(existsSync(firstFile)).toBe(true);
      expect(existsSync(secondFile)).toBe(true);

      const res = await app.request(`/api/flows/${reg.id}/nodes/${first.id}`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(existsSync(firstFile)).toBe(false);
      expect(existsSync(secondFile)).toBe(true);
    });
  });
});

describe('PATCH /api/flows/:id/connectors/:connId', () => {
  const VALID_DEMO_WITH_CONN = {
    version: 2,
    name: 'Two Nodes',
    nodes: [
      {
        id: 'a',
        type: 'rectangle',
        data: {
          name: 'A',
          stateSource: { kind: 'request' },
          playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
        },
      },
      {
        id: 'b',
        type: 'rectangle',
        data: {
          name: 'B',
          stateSource: { kind: 'request' },
          playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
        },
      },
    ],
    connectors: [{ id: 'a-to-b', source: 'a', target: 'b', label: 'flow' }],
  };

  const patch = (app: ReturnType<typeof buildApp>['app'], path: string, body: unknown) =>
    app.request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('merges visual fields into the connector and rewrites the demo', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');
    const styleFile = join(repoPath, 'style.json');
    const res = await patch(app, `/api/flows/${reg.id}/connectors/a-to-b`, {
      label: 'renamed',
      style: 'dashed',
      color: 'blue',
      direction: 'both',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const arch = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      connectors: Array<{ id: string; label?: string }>;
    };
    const style = JSON.parse(readFileSync(styleFile, 'utf8')) as {
      connectors: Record<string, { style?: string; color?: string; direction?: string }>;
    };
    const conn = arch.connectors.find((c) => c.id === 'a-to-b');
    expect(conn?.label).toBe('renamed');
    const styleEntry = style.connectors['a-to-b'];
    expect(styleEntry?.style).toBe('dashed');
    expect(styleEntry?.color).toBe('blue');
    expect(styleEntry?.direction).toBe('both');
  });

  it('returns 400 when the body has an unknown top-level key', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await patch(app, `/api/flows/${reg.id}/connectors/a-to-b`, {
      somethingMadeUp: true,
    });
    expect(res.status).toBe(400);
  });

  // US-022: handle ids on a connector must match the role's allowed sides.
  // Source-side handles are 'r'/'b'; target-side are 't'/'l'. Anything else
  // is a stranded endpoint at render time, so the API rejects it.
  it("accepts a valid sourceHandle ('r') / targetHandle ('t')", async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const styleFile = join(repoPath, 'style.json');
    const res = await patch(app, `/api/flows/${reg.id}/connectors/a-to-b`, {
      sourceHandle: 'r',
      targetHandle: 't',
    });
    expect(res.status).toBe(200);
    const style = JSON.parse(readFileSync(styleFile, 'utf8')) as {
      connectors: Record<string, { sourceHandle?: string; targetHandle?: string }>;
    };
    const entry = style.connectors['a-to-b'];
    expect(entry?.sourceHandle).toBe('r');
    expect(entry?.targetHandle).toBe('t');
  });

  it("rejects an invalid sourceHandle ('top-bogus') with a 400", async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');
    const before = readFileSync(demoFile, 'utf8');

    const res = await patch(app, `/api/flows/${reg.id}/connectors/a-to-b`, {
      sourceHandle: 'top-bogus',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues?: unknown };
    expect(body.error).toBeTruthy();
    // The error must mention the offending field so clients can show a
    // useful message. Zod's enum error includes the path 'sourceHandle'.
    const flat = JSON.stringify(body);
    expect(flat).toContain('sourceHandle');
    // File must not have been touched on validation failure.
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it("rejects a target-only handle id on sourceHandle ('t' on source) with a 400", async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    // 't' is a valid handle id but only as a target — sending it as a
    // sourceHandle leaves a stranded endpoint, so the schema rejects it.
    const res = await patch(app, `/api/flows/${reg.id}/connectors/a-to-b`, {
      sourceHandle: 't',
    });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid targetHandle ('r' on target) with a 400", async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await patch(app, `/api/flows/${reg.id}/connectors/a-to-b`, {
      targetHandle: 'r',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown flowId', async () => {
    const { app } = buildApp();
    const res = await patch(app, '/api/flows/nope/connectors/x', { label: 'x' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown connectorId', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };
    const res = await patch(app, `/api/flows/${reg.id}/connectors/missing`, { label: 'x' });
    expect(res.status).toBe(404);
  });

  // US-007: sourcePin / targetPin round-trip through the PATCH endpoint, and
  // explicit `null` clears the field on disk (mirrors the sourceHandle: null
  // clearing path from US-025).
  it('persists sourcePin / targetPin on PATCH and clears them with null (US-007)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };
    const styleFile = join(repoPath, 'style.json');

    const setRes = await patch(app, `/api/flows/${reg.id}/connectors/a-to-b`, {
      sourcePin: { side: 'right', t: 0.25 },
      targetPin: { side: 'left', t: 0.75 },
    });
    expect(setRes.status).toBe(200);
    let style = JSON.parse(readFileSync(styleFile, 'utf8')) as {
      connectors: Record<string, Record<string, unknown>>;
    };
    let entry = style.connectors['a-to-b'];
    expect(entry?.sourcePin).toEqual({ side: 'right', t: 0.25 });
    expect(entry?.targetPin).toEqual({ side: 'left', t: 0.75 });

    // Clear only the source pin; target pin must survive.
    const clearRes = await patch(app, `/api/flows/${reg.id}/connectors/a-to-b`, {
      sourcePin: null,
    });
    expect(clearRes.status).toBe(200);
    style = JSON.parse(readFileSync(styleFile, 'utf8')) as {
      connectors: Record<string, Record<string, unknown>>;
    };
    entry = style.connectors['a-to-b'];
    expect(entry?.sourcePin).toBeUndefined();
    expect(entry?.targetPin).toEqual({ side: 'left', t: 0.75 });
  });

  it('rejects a sourcePin with an out-of-range t (US-007)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await patch(app, `/api/flows/${reg.id}/connectors/a-to-b`, {
      sourcePin: { side: 'top', t: 1.5 },
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/flows/:id/connectors', () => {
  const VALID_DEMO_TWO_NODES = {
    version: 2,
    name: 'Two Nodes',
    nodes: [
      {
        id: 'a',
        type: 'rectangle',
        data: {
          name: 'A',
          stateSource: { kind: 'request' },
          playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
        },
      },
      {
        id: 'b',
        type: 'rectangle',
        data: {
          name: 'B',
          stateSource: { kind: 'request' },
          playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
        },
      },
    ],
    connectors: [],
  };

  it('creates a connector and auto-generates id', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_TWO_NODES);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');
    const res = await post(app, `/api/flows/${reg.id}/connectors`, { source: 'a', target: 'b' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^conn-/);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      connectors: Array<{ id: string; source: string; target: string }>;
    };
    expect(onDisk.connectors).toHaveLength(1);
    const created = onDisk.connectors[0];
    expect(created?.id).toBe(body.id);
    expect(created?.source).toBe('a');
    expect(created?.target).toBe('b');
  });

  it('honors a caller-provided id and persists optional metadata', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_TWO_NODES);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/connectors`, {
      id: 'my-conn',
      source: 'a',
      target: 'b',
      eventName: 'OrderPlaced',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('my-conn');
  });

  it('returns 400 with schema issues when source references an unknown node', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_TWO_NODES);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');
    const before = readFileSync(demoFile, 'utf8');

    const res = await post(app, `/api/flows/${reg.id}/connectors`, {
      source: 'ghost',
      target: 'b',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues?: unknown };
    expect(body.error).toContain('schema');
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  // US-022: post-merge FlowSchema parse rejects invalid handle ids on POST too.
  it('returns 400 when posting a connector with an invalid sourceHandle id', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_TWO_NODES);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');
    const before = readFileSync(demoFile, 'utf8');

    const res = await post(app, `/api/flows/${reg.id}/connectors`, {
      source: 'a',
      target: 'b',
      sourceHandle: 'top-bogus',
    });
    expect(res.status).toBe(400);
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('returns 404 for unknown flowId', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/flows/nope/connectors', { source: 'a', target: 'b' });
    expect(res.status).toBe(404);
  });

  // US-023: an icon is a valid connector endpoint in either role. The
  // schema's discriminated NodeSchema doesn't constrain who can be a source or
  // target — only that the referenced id exists in nodes[]. These two cases
  // fence that against a future change to operations.ts / schema.ts that might
  // add a node-type whitelist (the bug the user reports is UX-shaped, not
  // server-shaped, but a REST round-trip is the cheapest regression fence).
  it('accepts a connector pointing AT an icon (US-023)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo({
      version: 2,
      name: 'Icon target',
      nodes: [
        {
          id: 'svc',
          type: 'rectangle',
          data: { name: 'S', stateSource: { kind: 'request' } },
        },
        {
          id: 'icon-1',
          type: 'icon',
          data: { icon: 'shopping-cart' },
        },
      ],
      connectors: [],
    });
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/connectors`, {
      source: 'svc',
      target: 'icon-1',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    const onDisk = JSON.parse(readFileSync(join(repoPath, 'flow.json'), 'utf8')) as {
      connectors: Array<{ id: string; source: string; target: string; kind: string }>;
    };
    expect(onDisk.connectors).toHaveLength(1);
    expect(onDisk.connectors[0]?.id).toBe(body.id);
    expect(onDisk.connectors[0]?.source).toBe('svc');
    expect(onDisk.connectors[0]?.target).toBe('icon-1');
  });

  it('accepts a connector pointing FROM an icon (US-023)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo({
      version: 2,
      name: 'Icon source',
      nodes: [
        {
          id: 'icon-1',
          type: 'icon',
          data: { icon: 'shopping-cart' },
        },
        {
          id: 'svc',
          type: 'rectangle',
          data: { name: 'S', stateSource: { kind: 'request' } },
        },
      ],
      connectors: [],
    });
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/connectors`, {
      source: 'icon-1',
      target: 'svc',
    });
    expect(res.status).toBe(200);
    const onDisk = JSON.parse(readFileSync(join(repoPath, 'flow.json'), 'utf8')) as {
      connectors: Array<{ source: string; target: string }>;
    };
    expect(onDisk.connectors).toHaveLength(1);
    expect(onDisk.connectors[0]?.source).toBe('icon-1');
    expect(onDisk.connectors[0]?.target).toBe('svc');
  });

  it('accepts a connector between two iconNodes (US-023)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo({
      version: 2,
      name: 'Icon-to-icon',
      nodes: [
        {
          id: 'icon-a',
          type: 'icon',
          data: { icon: 'circle' },
        },
        {
          id: 'icon-b',
          type: 'icon',
          data: { icon: 'square' },
        },
      ],
      connectors: [],
    });
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/connectors`, {
      source: 'icon-a',
      target: 'icon-b',
    });
    expect(res.status).toBe(200);
    const onDisk = JSON.parse(readFileSync(join(repoPath, 'flow.json'), 'utf8')) as {
      connectors: Array<{ source: string; target: string }>;
    };
    expect(onDisk.connectors[0]?.source).toBe('icon-a');
    expect(onDisk.connectors[0]?.target).toBe('icon-b');
  });
});

describe('POST /api/flows/:id/bulk (connectors-only + existing-graph cases)', () => {
  const VALID_DEMO_TWO_NODES = {
    version: 2,
    name: 'Two Nodes',
    nodes: [
      {
        id: 'a',
        type: 'rectangle',
        data: {
          name: 'A',
          stateSource: { kind: 'request' },
          playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
        },
      },
      {
        id: 'b',
        type: 'rectangle',
        data: {
          name: 'B',
          stateSource: { kind: 'request' },
          playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
        },
      },
    ],
    connectors: [],
  };

  it('connectors-only body wires existing nodes and defaults id/kind', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_TWO_NODES);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/bulk`, {
      connectors: [
        { source: 'a', target: 'b', eventName: 'evt.one' },
        { id: 'pinned', source: 'b', target: 'a' },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      nodes: unknown[];
      connectors: Array<{ id: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.nodes).toHaveLength(0);
    expect(body.connectors).toHaveLength(2);
    expect(body.connectors[1]?.id).toBe('pinned');

    const onDisk = JSON.parse(readFileSync(join(repoPath, 'flow.json'), 'utf8')) as {
      connectors: Array<{ id: string; eventName?: string }>;
    };
    expect(onDisk.connectors).toHaveLength(2);
    expect(onDisk.connectors[0]?.eventName).toBe('evt.one');
  });

  it('rejects an id collision with an existing connector', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_TWO_NODES);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    await post(app, `/api/flows/${reg.id}/connectors`, {
      id: 'c-taken',
      source: 'a',
      target: 'b',
    });

    const res = await post(app, `/api/flows/${reg.id}/bulk`, {
      connectors: [{ id: 'c-taken', source: 'b', target: 'a' }],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Connector id already exists');
  });
});

describe('DELETE /api/flows/:id/connectors/:connId', () => {
  const VALID_DEMO_WITH_TWO_CONNS = {
    version: 2,
    name: 'Two Nodes',
    nodes: [
      {
        id: 'a',
        type: 'rectangle',
        data: {
          name: 'A',
          stateSource: { kind: 'request' },
          playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
        },
      },
      {
        id: 'b',
        type: 'rectangle',
        data: {
          name: 'B',
          stateSource: { kind: 'request' },
          playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
        },
      },
    ],
    connectors: [
      { id: 'a-to-b', source: 'a', target: 'b' },
      { id: 'b-to-a', source: 'b', target: 'a' },
    ],
  };

  it('removes only the targeted connector and leaves the rest', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_TWO_CONNS);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const demoFile = join(repoPath, 'flow.json');
    const res = await app.request(`/api/flows/${reg.id}/connectors/a-to-b`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      connectors: Array<{ id: string }>;
    };
    expect(onDisk.connectors.map((c) => c.id)).toEqual(['b-to-a']);
  });

  it('returns 404 for unknown flowId', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/flows/nope/connectors/x', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown connectorId', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_TWO_CONNS);
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };
    const res = await app.request(`/api/flows/${reg.id}/connectors/missing`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/flows/:id', () => {
  it('removes the entry and returns ok', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string };

    const res = await app.request(`/api/flows/${reg.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(registry.list()).toHaveLength(0);
  });

  it('removes the entry when requested by slug', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        flowPath: 'flow.json',
      })
    ).json()) as { id: string; slug: string };

    // Post-US-002 the slug encodes project + flow with a '/'. The legacy
    // /api/flows/:id route still uses a single path segment, so addressing
    // by slug needs URL encoding here. US-007 retires this route in favour
    // of the nested /api/projects/:project/flows/:flow shape.
    const res = await app.request(`/api/flows/${encodeURIComponent(reg.slug)}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(registry.list()).toHaveLength(0);
  });

  it('returns 404 for unknown ids', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/flows/does-not-exist', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/projects', () => {
  it('scaffolds a fresh project (folder + flow.json) at the supplied path', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'seeflow-create-fresh-'));
    const projectPath = join(baseDir, 'fresh-project');
    const registry = createRegistry({ path: tmpRegistry() });
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      disableWatcher: true,
    });

    const res = await post(app, '/api/projects', {
      path: projectPath,
      name: 'Fresh Project',
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; slug: string };
    expect(body.id).toBeTruthy();
    expect(body.slug).toBe('fresh-project/main');
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.repoPath).toBe(projectPath);
    expect(registry.list()[0]?.flowPath).toBe('flow.json');

    const written = JSON.parse(readFileSync(join(projectPath, 'flow.json'), 'utf-8'));
    expect(written).toEqual({ version: 2, name: 'Fresh Project', nodes: [], connectors: [] });
  });

  it('persists description into flow.json and the registry entry when supplied', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'seeflow-create-described-'));
    const projectPath = join(baseDir, 'described-project');
    const registry = createRegistry({ path: tmpRegistry() });
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      disableWatcher: true,
    });

    const res = await post(app, '/api/projects', {
      path: projectPath,
      name: 'Described Project',
      description: 'A project with a description',
    });

    expect(res.status).toBe(200);
    const written = JSON.parse(readFileSync(join(projectPath, 'flow.json'), 'utf-8'));
    expect(written).toEqual({
      version: 2,
      name: 'Described Project',
      description: 'A project with a description',
      nodes: [],
      connectors: [],
    });
    expect(registry.list()[0]?.description).toBe('A project with a description');
  });

  it('returns 409 when the target already has a flow.json', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'seeflow-create-existing-'));
    const projectPath = join(baseDir, 'existing-project');
    mkdirSync(projectPath, { recursive: true });
    const existingDemo = { version: 2, name: 'Existing Project', nodes: [], connectors: [] };
    writeFileSync(join(projectPath, 'flow.json'), JSON.stringify(existingDemo));
    const beforeBytes = readFileSync(join(projectPath, 'flow.json'), 'utf-8');

    const registry = createRegistry({ path: tmpRegistry() });
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      disableWatcher: true,
    });

    const res = await post(app, '/api/projects', {
      path: projectPath,
      name: 'Existing Project',
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain(projectPath);
    // Existing flow.json is untouched and not registered.
    expect(readFileSync(join(projectPath, 'flow.json'), 'utf-8')).toBe(beforeBytes);
    expect(registry.list()).toHaveLength(0);
  });

  it('rejects empty name with 400', async () => {
    const { app, registry } = buildApp();
    const res = await post(app, '/api/projects', {
      path: join(tmpdir(), 'seeflow-bad-name'),
      name: '',
    });
    expect(res.status).toBe(400);
    expect(registry.list()).toHaveLength(0);
  });

  it('rejects missing path with 400', async () => {
    const { app, registry } = buildApp();
    const res = await post(app, '/api/projects', { name: 'No Path' });
    expect(res.status).toBe(400);
    expect(registry.list()).toHaveLength(0);
  });
});

describe('POST /api/validate', () => {
  it('returns ok for valid flow-only body', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/validate', {
      flow: { version: 2, name: 'T', nodes: [], connectors: [] },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns 200 with issues array on bad flow', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/validate', { flow: { version: 1 } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      issues: Array<{ scope: string }>;
    };
    expect(body.ok).toBe(false);
    expect(body.issues.every((i) => i.scope === 'flow')).toBe(true);
  });

  it('flags cross-file orphan style entries', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/validate', {
      flow: { version: 2, name: 'T', nodes: [], connectors: [] },
      style: { nodes: { ghost: { fontSize: 14 } } },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      issues: Array<{ scope: string; code: string }>;
    };
    expect(body.ok).toBe(false);
    expect(body.issues.some((i) => i.code === 'orphan_style_node')).toBe(true);
  });

  it('returns 400 for malformed JSON body', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when flow key missing', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/validate', { foo: 'bar' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/flows/summary', () => {
  it('returns id, name, description for each registered flow', async () => {
    const { app } = buildApp();
    const repoA = tmpRepoWithDemo({ ...VALID_DEMO, description: 'main checkout flow' });
    const repoB = tmpRepoWithDemo({ ...VALID_DEMO, name: 'Refund', description: undefined });
    await post(app, '/api/flows/register', { repoPath: repoA, flowPath: 'flow.json' });
    await post(app, '/api/flows/register', { repoPath: repoB, flowPath: 'flow.json' });

    const res = await app.request('/api/flows/summary');
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ id: string; name: string; description?: string }>;
    expect(list).toHaveLength(2);

    const docs = list.find((e) => e.name === 'Checkout Flow');
    expect(docs?.description).toBe('main checkout flow');

    const bare = list.find((e) => e.name === 'Refund');
    expect(bare).toBeDefined();
    expect('description' in (bare as object)).toBe(false);
  });

  it('returns each summary with only id, name and description keys', async () => {
    const { app } = buildApp();
    const repo = tmpRepoWithDemo({ ...VALID_DEMO, description: 'doc' });
    await post(app, '/api/flows/register', { repoPath: repo, flowPath: 'flow.json' });

    const list = (await (await app.request('/api/flows/summary')).json()) as Array<object>;
    const keys = Object.keys(list[0] as object).sort();
    expect(keys).toEqual(['description', 'id', 'name']);
  });
});

describe('GET /api/flows/:id/graph', () => {
  it('returns nodes and connectors with detail/html stripped, description preserved', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo({
      ...VALID_DEMO,
      description: 'demo flow',
      nodes: [
        ...VALID_DEMO.nodes,
        {
          id: 'shape-1',
          type: 'rectangle',
          data: { name: 'note', detail: '# secrets here' },
        },
        {
          id: 'html-1',
          type: 'html',
          data: { html: '<p>also secret</p>' },
        },
      ],
    });
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, flowPath: 'flow.json' })
    ).json()) as { id: string };

    const res = await app.request(`/api/flows/${reg.id}/graph`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      name: string;
      description?: string;
      nodes: Array<{ id: string; data: Record<string, unknown> }>;
      connectors: unknown[];
    };
    expect(body.id).toBe(reg.id);
    expect(body.description).toBe('demo flow');
    const shape = body.nodes.find((n) => n.id === 'shape-1');
    const html = body.nodes.find((n) => n.id === 'html-1');
    expect(shape?.data.detail).toBeUndefined();
    expect(html?.data.html).toBeUndefined();
    // Non-stripped fields still ride along.
    expect((shape?.data as { name?: string }).name).toBe('note');
  });

  it('returns 404 for unknown flow ids', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/flows/no-such/graph');
    expect(res.status).toBe(404);
  });

  it('returns 404 when flow.json was removed from disk', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, flowPath: 'flow.json' })
    ).json()) as { id: string };
    unlinkSync(join(repoPath, 'flow.json'));

    const res = await app.request(`/api/flows/${reg.id}/graph`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/flows/:id/nodes/:nodeId', () => {
  it('returns a single node with detail content inlined', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, flowPath: 'flow.json' })
    ).json()) as { id: string };

    // Add a node via the existing add endpoint so detail.md is externalized
    // through the canonical write path. Pin the id so we can fetch the same
    // node by id below (the seed VALID_DEMO already carries an `api-checkout`
    // rectangle — finding "the rectangle" by type would return the seed).
    await post(app, `/api/flows/${reg.id}/nodes`, {
      id: 'with-detail',
      type: 'rectangle',
      data: { name: 'A', detail: '# inlined body' },
    });

    const shapeId = 'with-detail';

    const res = await app.request(`/api/flows/${reg.id}/nodes/${shapeId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      flowId: string;
      node: { data: { detail?: string } };
    };
    expect(body.id).toBe(shapeId);
    expect(body.flowId).toBe(reg.id);
    expect(body.node.data.detail).toBe('# inlined body');
  });

  it('returns 404 for unknown flow id', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/flows/missing/nodes/whatever');
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown nodeId in a known flow', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, flowPath: 'flow.json' })
    ).json()) as { id: string };

    const res = await app.request(`/api/flows/${reg.id}/nodes/not-a-node`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Unknown nodeId');
  });
});

// US-009 / T-007: POST /api/flows/:id/nodes/:nodeId/actions/:name dispatches
// the named action defined under spec.actions for a component node. The
// runner spawns the script via the injected ProcessSpawner (shared in-memory
// fake from the /play suite) so we can drive the success + failure branches
// without spinning up real child processes.
describe('POST /api/flows/:id/nodes/:nodeId/actions/:name (T-007)', () => {
  type SpawnOpts = {
    cmd: string[];
    cwd: string;
    env: Record<string, string>;
    stdin: 'pipe' | 'ignore';
  };
  type FakeRecord = { spawnCalls: SpawnOpts[]; stdinPayloads: string[] };

  const makeFakeSpawner = (
    config: { stdout?: string; stderr?: string; exitCode?: number } = {},
  ): { spawner: import('./process-spawner.ts').ProcessSpawner; record: FakeRecord } => {
    const record: FakeRecord = { spawnCalls: [], stdinPayloads: [] };
    const streamFromString = (s: string): ReadableStream<Uint8Array> =>
      new ReadableStream<Uint8Array>({
        start(c) {
          if (s.length > 0) c.enqueue(new TextEncoder().encode(s));
          c.close();
        },
      });
    const spawner: import('./process-spawner.ts').ProcessSpawner = {
      spawn(opts) {
        record.spawnCalls.push({ cmd: opts.cmd, cwd: opts.cwd, env: opts.env, stdin: opts.stdin });
        let resolveExit: (code: number) => void = () => {};
        const exited = new Promise<number>((res) => {
          resolveExit = res;
        });
        queueMicrotask(() => resolveExit(config.exitCode ?? 0));
        let stdinStream: WritableStream<Uint8Array> | undefined;
        if (opts.stdin === 'pipe') {
          const idx = record.stdinPayloads.push('') - 1;
          const decoder = new TextDecoder();
          stdinStream = new WritableStream<Uint8Array>({
            write(chunk) {
              record.stdinPayloads[idx] += decoder.decode(chunk, { stream: true });
            },
            close() {},
            abort() {},
          });
        }
        return {
          pid: 22222,
          stdout: streamFromString(config.stdout ?? ''),
          stderr: streamFromString(config.stderr ?? ''),
          stdin: stdinStream,
          exited,
          kill() {},
        };
      },
    };
    return { spawner, record };
  };

  // Seed a project containing one component node + nodes/c1/spec.json carrying
  // the supplied actions map. Optionally writes a stub script at
  // nodes/c1/actions/<name>.ts so the realpath check in component-action-runner
  // passes.
  const seedComponentProject = (
    actions: Record<string, unknown>,
    scriptFiles: string[] = [],
  ): string => {
    const repoPath = tmpRepoWithDemo({
      version: 2,
      name: 'Component flow',
      nodes: [{ id: 'c1', type: 'component', data: {} }],
      connectors: [],
    });
    mkdirSync(join(repoPath, 'nodes', 'c1', 'actions'), { recursive: true });
    const spec = {
      root: 'root',
      elements: { root: { type: 'Text', props: { text: 'hello' } } },
      actions,
    };
    writeFileSync(join(repoPath, 'nodes', 'c1', 'spec.json'), `${JSON.stringify(spec, null, 2)}\n`);
    for (const name of scriptFiles) {
      writeFileSync(join(repoPath, 'nodes', 'c1', 'actions', name), '// stub\n');
    }
    return repoPath;
  };

  const buildActionApp = (
    spawnerConfig: { stdout?: string; stderr?: string; exitCode?: number } = {},
  ) => {
    const { spawner, record } = makeFakeSpawner(spawnerConfig);
    const bus = createEventBus();
    const registry = createRegistry({ path: tmpRegistry() });
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      events: bus,
      disableWatcher: true,
      processSpawner: spawner,
    });
    return { app, registry, bus, spawnerRecord: record };
  };

  it('dispatches a script-kind action and returns its parsed JSON body with status 200', async () => {
    const { app, spawnerRecord } = buildActionApp({ stdout: '{"queueDepth":3}' });
    const repoPath = seedComponentProject(
      {
        refresh: { kind: 'script', interpreter: 'bun', scriptPath: 'actions/refresh.ts' },
      },
      ['refresh.ts'],
    );

    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, flowPath: 'flow.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/nodes/c1/actions/refresh`, { force: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { queueDepth: number };
    expect(body).toEqual({ queueDepth: 3 });

    // Spawn invocation shape: interpreter + resolved abs script path, plus
    // the per-run env vars and the JSON-encoded payload on stdin.
    expect(spawnerRecord.spawnCalls).toHaveLength(1);
    const call = spawnerRecord.spawnCalls[0];
    expect(call?.cmd[0]).toBe('bun');
    expect(call?.cmd[1]?.endsWith('/nodes/c1/actions/refresh.ts')).toBe(true);
    expect(call?.env.SEEFLOW_DEMO_ID).toBe(reg.id);
    expect(call?.env.SEEFLOW_NODE_ID).toBe('c1');
    expect(call?.env.SEEFLOW_ACTION_NAME).toBe('refresh');
    expect(spawnerRecord.stdinPayloads[0]).toBe('{"force":true}');
  });

  it('404s when the action name is not present in spec.actions', async () => {
    const { app } = buildActionApp({ stdout: '{}' });
    const repoPath = seedComponentProject(
      {
        refresh: { kind: 'script', interpreter: 'bun', scriptPath: 'actions/refresh.ts' },
      },
      ['refresh.ts'],
    );
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, flowPath: 'flow.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/nodes/c1/actions/missing`, {});
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Unknown action');
  });

  it('400s when the target node is not a component node', async () => {
    const { app } = buildActionApp({ stdout: '{}' });
    // Default VALID_DEMO carries a rectangle node id 'api-checkout'.
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, flowPath: 'flow.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/nodes/api-checkout/actions/refresh`, {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not a component node');
  });

  it('400s when the resolved action is set-kind', async () => {
    const { app } = buildActionApp({ stdout: '{}' });
    const repoPath = seedComponentProject({
      toggle: { kind: 'set', path: '/open', value: true },
    });
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, flowPath: 'flow.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/nodes/c1/actions/toggle`, {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Only script actions are dispatched over HTTP');
  });

  it('returns 404 for an unknown flow id', async () => {
    const { app } = buildActionApp();
    const res = await post(app, '/api/flows/nope/nodes/c1/actions/refresh', {});
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown node id', async () => {
    const { app } = buildActionApp({ stdout: '{}' });
    const repoPath = seedComponentProject(
      {
        refresh: { kind: 'script', interpreter: 'bun', scriptPath: 'actions/refresh.ts' },
      },
      ['refresh.ts'],
    );
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, flowPath: 'flow.json' })
    ).json()) as { id: string };
    const res = await post(app, `/api/flows/${reg.id}/nodes/ghost/actions/refresh`, {});
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Unknown nodeId');
  });
});
