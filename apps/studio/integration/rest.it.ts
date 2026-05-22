import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { slugify } from '../src/registry.ts';
import { uniqueFlowId } from './support/ids.ts';
import { connectSse } from './support/sse-client.ts';
import { type StudioHandle, spawnStudio } from './support/studio-harness.ts';

// One shared studio per file — every test uses uniqueFlowId for its own
// project name, so the file-level harness stays parallel-safe.
let studio: StudioHandle;

beforeAll(async () => {
  studio = await spawnStudio();
});

afterAll(async () => {
  if (studio) await studio.stop();
});

interface CreateProjectResponse {
  id: string;
  slug: string;
}

interface FlowListItem {
  id: string;
  slug: string;
  name: string;
  repoPath: string;
  lastModified: number;
  valid: boolean;
}

interface FlowGetResponse {
  id: string;
  slug: string;
  name: string;
  filePath: string;
  flow: { version: number; name: string } | null;
  valid: boolean;
  error: string | null;
}

interface RegisterResponse {
  id: string;
  slug: string;
  sdk: { outcome: string; filePath: string | null };
}

interface ValidateReport {
  ok: boolean;
  stats: { tier: string; nodeCount: number; connectorCount: number };
  issues: Array<{ kind: string; path?: string; message: string }>;
  warnings: Array<{ kind: string; path?: string; message: string }>;
}

interface OnDiskFlow {
  version: number;
  name: string;
  nodes: Array<{ id: string; type: string; data?: Record<string, unknown> }>;
  connectors: Array<{
    id: string;
    source: string;
    target: string;
    kind: string;
    label?: string;
    eventName?: string;
    queueName?: string;
  }>;
}

interface OnDiskStyle {
  nodes?: Record<string, { position?: { x: number; y: number } } & Record<string, unknown>>;
  connectors?: Record<string, Record<string, unknown>>;
}

async function createProject(name: string): Promise<CreateProjectResponse> {
  const res = await fetch(`${studio.baseURL}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: join(studio.workspace, slugify(name)), name }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as CreateProjectResponse;
}

async function readFlowJson(slug: string): Promise<OnDiskFlow> {
  const path = join(studio.workspace, slug, '.seeflow', 'flow.json');
  return JSON.parse(await Bun.file(path).text()) as OnDiskFlow;
}

async function readStyleJson(slug: string): Promise<OnDiskStyle> {
  const path = join(studio.workspace, slug, '.seeflow', 'style.json');
  if (!existsSync(path)) return {};
  return JSON.parse(await Bun.file(path).text()) as OnDiskStyle;
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${studio.baseURL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patchJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${studio.baseURL}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function seedShapeNodes(flowId: string, ids: string[]): Promise<void> {
  const res = await postJson(`/api/flows/${flowId}/bulk`, {
    nodes: ids.map((id) => ({ id, type: 'shapeNode', data: { shape: 'rectangle' } })),
  });
  expect(res.status).toBe(200);
}

describe('integration: REST — flow lifecycle', () => {
  describe('GET /healthz', () => {
    it('returns 200 with { status: "ok" }', async () => {
      const res = await fetch(`${studio.baseURL}/healthz`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
    });
  });

  describe('POST /api/projects', () => {
    it('creates a flow dir + flow.json on disk and registers it', async () => {
      const name = uniqueFlowId('create-project');
      const created = await createProject(name);
      expect(created.id).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(created.slug).toBeTruthy();

      const flowPath = join(studio.workspace, created.slug, '.seeflow', 'flow.json');
      expect(existsSync(flowPath)).toBe(true);
      const parsed = JSON.parse(await Bun.file(flowPath).text()) as {
        version: number;
        name: string;
        nodes: unknown[];
        connectors: unknown[];
      };
      expect(parsed.version).toBe(2);
      expect(parsed.name).toBe(name);
      expect(parsed.nodes).toEqual([]);
      expect(parsed.connectors).toEqual([]);
    });
  });

  describe('GET /api/flows', () => {
    it('list includes a newly-created flow', async () => {
      const name = uniqueFlowId('list-flows');
      const created = await createProject(name);

      const res = await fetch(`${studio.baseURL}/api/flows`);
      expect(res.status).toBe(200);
      const list = (await res.json()) as FlowListItem[];
      expect(Array.isArray(list)).toBe(true);
      const entry = list.find((f) => f.id === created.id);
      expect(entry).toBeDefined();
      expect(entry?.slug).toBe(created.slug);
      expect(entry?.name).toBe(name);
      expect(entry?.valid).toBe(true);
    });
  });

  describe('GET /api/flows/:id', () => {
    it('returns the expected shape for a registered flow', async () => {
      const name = uniqueFlowId('get-flow');
      const created = await createProject(name);

      const res = await fetch(`${studio.baseURL}/api/flows/${created.id}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as FlowGetResponse;
      expect(body.id).toBe(created.id);
      expect(body.slug).toBe(created.slug);
      expect(body.name).toBe(name);
      expect(body.valid).toBe(true);
      expect(body.error).toBeNull();
      expect(body.flow).not.toBeNull();
      expect(body.flow?.name).toBe(name);
      expect(body.filePath).toContain(`${created.slug}`);
      expect(body.filePath.endsWith('flow.json')).toBe(true);
    });
  });

  describe('GET /api/flows/summary', () => {
    it('returns id, name, and description for each registered flow', async () => {
      const name = uniqueFlowId('summary-flow');
      const created = await createProject(name);

      // Patch flow.json on disk to add a description.
      const flowPath = join(studio.workspace, created.slug, '.seeflow', 'flow.json');
      const raw = JSON.parse(await Bun.file(flowPath).text());
      raw.description = 'integration summary';
      writeFileSync(flowPath, `${JSON.stringify(raw, null, 2)}\n`);
      // Re-register so the watcher snapshot picks up the description.
      await fetch(`${studio.baseURL}/api/flows/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repoPath: join(studio.workspace, created.slug),
          flowPath: '.seeflow/flow.json',
        }),
      });

      const res = await fetch(`${studio.baseURL}/api/flows/summary`);
      expect(res.status).toBe(200);
      const list = (await res.json()) as Array<{
        id: string;
        name: string;
        description?: string;
      }>;
      const entry = list.find((e) => e.id === created.id);
      expect(entry).toBeDefined();
      expect(entry?.name).toBe(name);
      expect(entry?.description).toBe('integration summary');
    });
  });

  describe('GET /api/flows/:id/graph', () => {
    it('returns nodes/connectors with detail and html stripped', async () => {
      const name = uniqueFlowId('graph-flow');
      const created = await createProject(name);

      // Add a shapeNode with detail through the standard write path so
      // detail.md is externalized; the graph endpoint should still hide it.
      await postJson(`/api/flows/${created.id}/nodes`, {
        id: 'shape-1',
        type: 'shapeNode',
        data: { name: 'note', shape: 'rectangle', detail: '# secret body' },
      });

      const res = await fetch(`${studio.baseURL}/api/flows/${created.id}/graph`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        id: string;
        nodes: Array<{ id: string; data: Record<string, unknown> }>;
      };
      const shape = body.nodes.find((n) => n.id === 'shape-1');
      expect(shape).toBeDefined();
      expect(shape?.data.detail).toBeUndefined();
      expect((shape?.data as { name?: string }).name).toBe('note');
    });
  });

  describe('GET /api/flows/:id/nodes/:nodeId', () => {
    it('returns a single node with detail content inlined', async () => {
      const name = uniqueFlowId('node-get-flow');
      const created = await createProject(name);

      await postJson(`/api/flows/${created.id}/nodes`, {
        id: 'shape-1',
        type: 'shapeNode',
        data: { name: 'note', shape: 'rectangle', detail: '# inlined body' },
      });

      const res = await fetch(`${studio.baseURL}/api/flows/${created.id}/nodes/shape-1`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        id: string;
        flowId: string;
        node: { data: { detail?: string } };
      };
      expect(body.id).toBe('shape-1');
      expect(body.flowId).toBe(created.id);
      expect(body.node.data.detail).toBe('# inlined body');
    });

    it('returns 404 for an unknown nodeId', async () => {
      const name = uniqueFlowId('node-get-404');
      const created = await createProject(name);
      const res = await fetch(`${studio.baseURL}/api/flows/${created.id}/nodes/not-a-node`);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/flows/register', () => {
    // PRD listed `/api/flows/:id/register`; the real route is `/api/flows/register`
    // and the request body identifies the flow by `{ repoPath, flowPath }` — see
    // RegisterBodySchema in operations.ts. We write a flow.json under a sibling
    // of `studio.workspace` and register it via that path.
    it('registers an existing on-disk flow into the registry', async () => {
      const slug = uniqueFlowId('register-flow');
      const repoPath = join(studio.home, slug);
      const seeflowDir = join(repoPath, '.seeflow');
      mkdirSync(seeflowDir, { recursive: true });
      const flowJson = { version: 2, name: slug, nodes: [], connectors: [] };
      writeFileSync(join(seeflowDir, 'flow.json'), `${JSON.stringify(flowJson, null, 2)}\n`);

      const res = await fetch(`${studio.baseURL}/api/flows/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoPath, flowPath: '.seeflow/flow.json' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as RegisterResponse;
      expect(body.id).toBeTruthy();
      expect(body.slug).toBeTruthy();
      expect(typeof body.sdk.outcome).toBe('string');

      // Side effect: it's now listed by GET /api/flows.
      const list = (await (await fetch(`${studio.baseURL}/api/flows`)).json()) as FlowListItem[];
      expect(list.find((f) => f.id === body.id)).toBeDefined();
    });
  });

  describe('POST /api/flows/validate', () => {
    // PRD listed `/api/flows/:id/validate`; the real route is `/api/flows/validate`
    // and the body is `{ demo, tier? }` per ValidateRequestSchema in diagram.ts.
    it('accepts a valid demo and returns ok: true with no issues', async () => {
      const demo = {
        version: 2,
        name: uniqueFlowId('validate-demo'),
        nodes: [],
        connectors: [],
      };
      const res = await fetch(`${studio.baseURL}/api/flows/validate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ demo }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ValidateReport;
      expect(body.ok).toBe(true);
      expect(body.issues).toEqual([]);
      expect(body.stats.nodeCount).toBe(0);
      expect(body.stats.connectorCount).toBe(0);
    });
  });

  describe('DELETE /api/flows/:id', () => {
    // deleteFlowImpl only removes the registry entry (and unwatches) — the
    // flow.json on disk is intentionally preserved. The PRD's "removes from
    // disk" wording is loose; this test asserts the actual behavior.
    it('removes the flow from the registry (file on disk is untouched)', async () => {
      const name = uniqueFlowId('delete-flow');
      const created = await createProject(name);
      const flowPath = join(studio.workspace, created.slug, '.seeflow', 'flow.json');
      expect(existsSync(flowPath)).toBe(true);

      // Sanity: registered.
      const before = (await (await fetch(`${studio.baseURL}/api/flows`)).json()) as FlowListItem[];
      expect(before.find((f) => f.id === created.id)).toBeDefined();

      const res = await fetch(`${studio.baseURL}/api/flows/${created.id}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      // Registry: gone.
      const after = (await (await fetch(`${studio.baseURL}/api/flows`)).json()) as FlowListItem[];
      expect(after.find((f) => f.id === created.id)).toBeUndefined();
      const get = await fetch(`${studio.baseURL}/api/flows/${created.id}`);
      expect(get.status).toBe(404);

      // Disk: flow.json is intentionally preserved.
      expect(existsSync(flowPath)).toBe(true);
    });
  });

  describe('GET /api/ids/:type/:count', () => {
    // Pure compute, exercised through the full server route. End-to-end smoke
    // test for the wire format an AI / skill script consumes when pre-minting
    // ids before assembling a flow.json.
    it('returns count node ids with the `node-` prefix', async () => {
      const res = await fetch(`${studio.baseURL}/api/ids/node/8`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; ids: string[] };
      expect(body.ok).toBe(true);
      expect(body.ids).toHaveLength(8);
      for (const id of body.ids) {
        expect(/^node-[A-Za-z0-9]{10}$/.test(id)).toBe(true);
      }
      expect(new Set(body.ids).size).toBe(8);
    });

    it('returns count connector ids with the `conn-` prefix', async () => {
      const res = await fetch(`${studio.baseURL}/api/ids/connector/4`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; ids: string[] };
      expect(body.ok).toBe(true);
      expect(body.ids).toHaveLength(4);
      for (const id of body.ids) {
        expect(/^conn-[A-Za-z0-9]{10}$/.test(id)).toBe(true);
      }
    });

    it('returns 400 for an unknown type', async () => {
      const res = await fetch(`${studio.baseURL}/api/ids/conn/3`);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toContain('invalid type: conn');
    });

    it('returns 400 for count > 100 or < 1', async () => {
      const tooMany = await fetch(`${studio.baseURL}/api/ids/node/101`);
      expect(tooMany.status).toBe(400);

      const zero = await fetch(`${studio.baseURL}/api/ids/node/0`);
      expect(zero.status).toBe(400);
    });
  });
});

describe('integration: REST — nodes', () => {
  describe('POST /api/flows/:id/nodes', () => {
    it('adds a single node and persists to flow.json', async () => {
      const created = await createProject(uniqueFlowId('node-add'));
      const res = await postJson(`/api/flows/${created.id}/nodes`, {
        type: 'shapeNode',
        data: { shape: 'rectangle', name: 'Note' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        id: string;
        node: Record<string, unknown>;
      };
      expect(body.ok).toBe(true);
      expect(body.id).toMatch(/^node-/);

      const onDisk = await readFlowJson(created.slug);
      expect(onDisk.nodes).toHaveLength(1);
      expect(onDisk.nodes[0]?.id).toBe(body.id);
      expect(onDisk.nodes[0]?.type).toBe('shapeNode');
      expect(onDisk.nodes[0]?.data?.shape).toBe('rectangle');
      expect(onDisk.nodes[0]?.data?.name).toBe('Note');
    });
  });

  describe('POST /api/flows/:id/bulk', () => {
    it('adds many nodes + connectors atomically in one transactional write', async () => {
      const created = await createProject(uniqueFlowId('flow-bulk'));
      const res = await postJson(`/api/flows/${created.id}/bulk`, {
        nodes: [
          { id: 'b1', type: 'shapeNode', data: { shape: 'rectangle', name: 'B1' } },
          { id: 'b2', type: 'shapeNode', data: { shape: 'ellipse', name: 'B2' } },
          { id: 'b3', type: 'shapeNode', data: { shape: 'sticky', name: 'B3' } },
        ],
        // Connector references nodes from THIS batch — proves transactional shape.
        connectors: [{ id: 'b1-to-b2', source: 'b1', target: 'b2' }],
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        nodes: Array<{ id: string; node: Record<string, unknown> }>;
        connectors: Array<{ id: string }>;
      };
      expect(body.ok).toBe(true);
      expect(body.nodes.map((n) => n.id)).toEqual(['b1', 'b2', 'b3']);
      expect(body.connectors.map((c) => c.id)).toEqual(['b1-to-b2']);

      const onDisk = await readFlowJson(created.slug);
      expect(onDisk.nodes.map((n) => n.id)).toEqual(['b1', 'b2', 'b3']);
      expect(onDisk.connectors.map((c) => c.id)).toEqual(['b1-to-b2']);
    });
  });

  describe('PATCH /api/flows/:id/nodes/:nodeId', () => {
    it('partial-merges into node.data and re-validates the whole flow', async () => {
      const created = await createProject(uniqueFlowId('node-patch'));
      const addRes = await postJson(`/api/flows/${created.id}/nodes`, {
        id: 'p1',
        type: 'shapeNode',
        data: { shape: 'rectangle', name: 'Original' },
      });
      expect(addRes.status).toBe(200);

      const res = await patchJson(`/api/flows/${created.id}/nodes/p1`, { name: 'Updated' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      const onDisk = await readFlowJson(created.slug);
      const node = onDisk.nodes.find((n) => n.id === 'p1');
      expect(node?.data?.name).toBe('Updated');
      // The non-patched field still survives the round-trip.
      expect(node?.data?.shape).toBe('rectangle');
    });
  });

  describe('PATCH /api/flows/:id/nodes/:nodeId/position', () => {
    // splitFlow routes `position` to style.json, so the disk-side assertion
    // reads style.json (not flow.json). The response body echoes the new
    // position so the canvas can confirm the write without re-fetching.
    it('persists x/y to style.json and echoes the new position', async () => {
      const created = await createProject(uniqueFlowId('node-position'));
      await postJson(`/api/flows/${created.id}/nodes`, {
        id: 'pos1',
        type: 'shapeNode',
        data: { shape: 'rectangle' },
      });

      const res = await patchJson(`/api/flows/${created.id}/nodes/pos1/position`, {
        x: 123,
        y: 456,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; position: { x: number; y: number } };
      expect(body.ok).toBe(true);
      expect(body.position).toEqual({ x: 123, y: 456 });

      const style = await readStyleJson(created.slug);
      expect(style.nodes?.pos1?.position).toEqual({ x: 123, y: 456 });
    });
  });

  describe('PATCH /api/flows/:id/nodes/:nodeId/order', () => {
    it('moves a node within flow.nodes[] (toFront)', async () => {
      const created = await createProject(uniqueFlowId('node-order'));
      await seedShapeNodes(created.id, ['a', 'b', 'c']);

      const res = await patchJson(`/api/flows/${created.id}/nodes/a/order`, { op: 'toFront' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      const onDisk = await readFlowJson(created.slug);
      expect(onDisk.nodes.map((n) => n.id)).toEqual(['b', 'c', 'a']);
    });
  });

  describe('DELETE /api/flows/:id/nodes/:nodeId', () => {
    it('removes the node and cascades adjacent connectors in one write', async () => {
      const created = await createProject(uniqueFlowId('node-delete'));
      await seedShapeNodes(created.id, ['a', 'b']);
      const connRes = await postJson(`/api/flows/${created.id}/bulk`, {
        connectors: [
          { id: 'a-b', source: 'a', target: 'b' },
          { id: 'b-a', source: 'b', target: 'a' },
        ],
      });
      expect(connRes.status).toBe(200);

      const res = await fetch(`${studio.baseURL}/api/flows/${created.id}/nodes/a`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      const onDisk = await readFlowJson(created.slug);
      expect(onDisk.nodes.map((n) => n.id)).toEqual(['b']);
      // Both connectors referenced 'a' → both cascade out.
      expect(onDisk.connectors).toEqual([]);
    });
  });
});

describe('integration: REST — connectors', () => {
  describe('POST /api/flows/:id/connectors', () => {
    it('adds a single connector and persists to flow.json', async () => {
      const created = await createProject(uniqueFlowId('conn-add'));
      await seedShapeNodes(created.id, ['a', 'b']);

      const res = await postJson(`/api/flows/${created.id}/connectors`, {
        id: 'c1',
        source: 'a',
        target: 'b',
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; id: string };
      expect(body.ok).toBe(true);
      expect(body.id).toBe('c1');

      const onDisk = await readFlowJson(created.slug);
      expect(onDisk.connectors).toHaveLength(1);
      expect(onDisk.connectors[0]).toMatchObject({
        id: 'c1',
        source: 'a',
        target: 'b',
      });
    });
  });

  describe('PATCH /api/flows/:id/connectors/:connId', () => {
    it('partial-merges into the connector', async () => {
      const created = await createProject(uniqueFlowId('conn-patch'));
      await seedShapeNodes(created.id, ['a', 'b']);
      await postJson(`/api/flows/${created.id}/connectors`, {
        id: 'c1',
        source: 'a',
        target: 'b',
      });

      const res = await patchJson(`/api/flows/${created.id}/connectors/c1`, {
        label: 'flow-step',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      // `label` lives in flow.json per CONNECTOR_FLOW_KEYS.
      const onDisk = await readFlowJson(created.slug);
      const conn = onDisk.connectors.find((c) => c.id === 'c1');
      expect(conn?.label).toBe('flow-step');
    });
  });

  describe('DELETE /api/flows/:id/connectors/:connId', () => {
    it('removes the connector from flow.json (nodes are untouched)', async () => {
      const created = await createProject(uniqueFlowId('conn-delete'));
      await seedShapeNodes(created.id, ['a', 'b']);
      await postJson(`/api/flows/${created.id}/connectors`, {
        id: 'c1',
        source: 'a',
        target: 'b',
      });

      const res = await fetch(`${studio.baseURL}/api/flows/${created.id}/connectors/c1`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      const onDisk = await readFlowJson(created.slug);
      expect(onDisk.connectors).toEqual([]);
      expect(onDisk.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    });
  });
});

describe('integration: REST — runtime (play / emit / SSE)', () => {
  describe('POST /api/flows/:id/play/:nodeId', () => {
    // Seed a playNode with a scriptPath that resolves under the node folder.
    // addNodeImpl externalizes `detail` to <repoPath>/.seeflow/nodes/<id>/detail.md,
    // which creates the node directory; we then drop a tiny scripts/play.ts
    // beside it so resolveScript's realpath check passes. The script exits 0
    // and prints a JSON line so runPlay parses it as the body.
    it('spawns the node script, returns runId, and broadcasts node:done over SSE', async () => {
      const created = await createProject(uniqueFlowId('play-node'));
      const nodeId = 'play-it-1';
      const addRes = await postJson(`/api/flows/${created.id}/nodes`, {
        id: nodeId,
        type: 'playNode',
        data: {
          name: 'Play',
          stateSource: { kind: 'request' },
          playAction: {
            kind: 'script',
            interpreter: 'bun',
            scriptPath: 'scripts/play.ts',
          },
        },
      });
      expect(addRes.status).toBe(200);

      const scriptDir = join(
        studio.workspace,
        created.slug,
        '.seeflow',
        'nodes',
        nodeId,
        'scripts',
      );
      mkdirSync(scriptDir, { recursive: true });
      writeFileSync(
        join(scriptDir, 'play.ts'),
        'console.log(JSON.stringify({ hello: "play" }));\nprocess.exit(0);\n',
      );

      const sse = await connectSse(studio.baseURL, `/api/events?flowId=${created.id}`);
      try {
        await sse.waitFor((e) => e.event === 'hello', 2_000);

        const playRes = await fetch(`${studio.baseURL}/api/flows/${created.id}/play/${nodeId}`, {
          method: 'POST',
        });
        expect(playRes.status).toBe(200);
        const playBody = (await playRes.json()) as {
          runId: string;
          status?: number;
          body?: unknown;
          error?: string;
        };
        expect(playBody.error).toBeUndefined();
        expect(playBody.runId).toBeTruthy();
        expect(playBody.status).toBe(200);
        expect(playBody.body).toEqual({ hello: 'play' });

        const done = await sse.waitFor((e) => e.event === 'node:done', 5_000);
        const parsed = JSON.parse(done.data) as {
          nodeId: string;
          runId: string;
          status: number;
          body: unknown;
        };
        expect(parsed.nodeId).toBe(nodeId);
        expect(parsed.runId).toBe(playBody.runId);
        expect(parsed.status).toBe(200);
        expect(parsed.body).toEqual({ hello: 'play' });
      } finally {
        sse.close();
      }
    });
  });

  describe('POST /api/emit', () => {
    it('returns 200 and is idempotent across repeated calls', async () => {
      const created = await createProject(uniqueFlowId('emit-idempotent'));
      const body = {
        flowId: created.id,
        nodeId: 'emit-it-1',
        status: 'running',
        runId: 'run-emit-1',
      };
      const res1 = await postJson('/api/emit', body);
      expect(res1.status).toBe(200);
      expect(await res1.json()).toEqual({ ok: true });

      const res2 = await postJson('/api/emit', body);
      expect(res2.status).toBe(200);
      expect(await res2.json()).toEqual({ ok: true });

      const res3 = await postJson('/api/emit', body);
      expect(res3.status).toBe(200);
      expect(await res3.json()).toEqual({ ok: true });
    });
  });

  describe('GET /api/events (SSE)', () => {
    it('delivers a node:status event posted via /api/emit within 2s', async () => {
      const created = await createProject(uniqueFlowId('sse-runtime'));
      const sse = await connectSse(studio.baseURL, `/api/events?flowId=${created.id}`);
      try {
        await sse.waitFor((e) => e.event === 'hello', 2_000);

        const emitRes = await postJson('/api/emit', {
          flowId: created.id,
          nodeId: 'sse-rt-1',
          status: 'done',
          runId: 'run-sse-rt-1',
          payload: { status: 201 },
        });
        expect(emitRes.status).toBe(200);

        const evt = await sse.waitFor((e) => e.event === 'node:done', 2_000);
        const parsed = JSON.parse(evt.data) as {
          nodeId: string;
          runId: string;
          status: number;
        };
        expect(parsed.nodeId).toBe('sse-rt-1');
        expect(parsed.runId).toBe('run-sse-rt-1');
        expect(parsed.status).toBe(201);
      } finally {
        sse.close();
      }
    });
  });

  describe('external flow.json edit', () => {
    // Watcher fires fs.watch on <workspace>/<slug>/.seeflow/, debounces 100ms,
    // computes the combined flow+style hash, and if it doesn't match a recent
    // own-write hash, broadcasts `flow:reload` with the merged payload. An
    // external writeFileSync from this test isn't in the writtenHashes ring,
    // so the broadcast fires. Event name is `flow:reload` (not `reloaded`).
    it('triggers a flow:reload SSE event after writing a modified flow.json to disk', async () => {
      const name = uniqueFlowId('external-edit');
      const created = await createProject(name);
      const flowPath = join(studio.workspace, created.slug, '.seeflow', 'flow.json');

      const sse = await connectSse(studio.baseURL, `/api/events?flowId=${created.id}`);
      try {
        await sse.waitFor((e) => e.event === 'hello', 2_000);

        // flow.json on disk uses FlowSchema (strict, position-stripped — that
        // field lives in style.json after splitFlow). Don't include `position`
        // here or the watcher's reparse will broadcast valid: false.
        const edited = {
          version: 2,
          name,
          nodes: [
            {
              id: 'ext-1',
              type: 'shapeNode',
              data: { shape: 'rectangle', name: 'External' },
            },
          ],
          connectors: [],
        };
        writeFileSync(flowPath, `${JSON.stringify(edited, null, 2)}\n`);

        const reload = await sse.waitFor((e) => e.event === 'flow:reload', 3_000);
        const parsed = JSON.parse(reload.data) as {
          valid?: boolean;
          flow?: { name?: string; nodes?: Array<{ id: string }> };
          error?: string | null;
          ts?: number;
        };
        expect(parsed.valid).toBe(true);
        expect(parsed.flow?.name).toBe(name);
        expect(parsed.flow?.nodes?.map((n) => n.id)).toContain('ext-1');
      } finally {
        sse.close();
      }
    });
  });
});
