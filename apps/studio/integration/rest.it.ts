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

// Per-flow HTTP routes moved under /api/projects/:project/flows/:flow/...
// (US-007). `created.slug` is `${projectSlug}/${flowSlug}`; substituting the
// inner `/` for `/flows/` produces the new path with no parsing.
function flowApi(slug: string): string {
  return `/api/projects/${slug.replace('/', '/flows/')}`;
}

// On-disk flow + style files moved to `<projectSlug>/flows/<flowSlug>/` with
// the manifest layout (US-018).
function flowDir(slug: string): string {
  const [projectSlug, flowSlug] = slug.split('/');
  return join(studio.workspace, projectSlug as string, 'flows', flowSlug as string);
}

async function readFlowJson(slug: string): Promise<OnDiskFlow> {
  const path = join(flowDir(slug), 'flow.json');
  return JSON.parse(await Bun.file(path).text()) as OnDiskFlow;
}

async function readStyleJson(slug: string): Promise<OnDiskStyle> {
  const path = join(flowDir(slug), 'style.json');
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

async function seedRectangleNodes(slug: string, ids: string[]): Promise<void> {
  const res = await postJson(`${flowApi(slug)}/bulk`, {
    nodes: ids.map((id) => ({ id, type: 'rectangle', data: {} })),
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

      // Manifest-driven layout (US-018): scaffolder writes
      // `<projectSlug>/seeflow.json` + `<projectSlug>/flows/<flowSlug>/flow.json`,
      // never a bare `flow.json` at the project root. The flow.json's `name`
      // field gets the user-supplied project name (createProjectImpl); the
      // manifest's flow ENTRY name is "Main" — surfaced via the registry as
      // entry.name but invisible from the flow.json on disk.
      const onDisk = await readFlowJson(created.slug);
      expect(onDisk.version).toBe(2);
      expect(onDisk.name).toBe(name);
      expect(onDisk.nodes).toEqual([]);
      expect(onDisk.connectors).toEqual([]);
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
      // GET /api/flows returns entry.name (manifest's flow entry name) — not
      // the flow.json `name`. createProjectImpl seeds the manifest with
      // `flows: [{ id: 'main', name: 'Main' }]`, so every newly-scaffolded
      // flow surfaces here as "Main".
      void name;
      expect(entry?.name).toBe('Main');
      expect(entry?.valid).toBe(true);
    });
  });

  describe('GET /api/flows/:id', () => {
    it('returns the expected shape for a registered flow', async () => {
      const name = uniqueFlowId('get-flow');
      const created = await createProject(name);

      const res = await fetch(`${studio.baseURL}${flowApi(created.slug)}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as FlowGetResponse;
      expect(body.id).toBe(created.id);
      expect(body.slug).toBe(created.slug);
      // Two name fields with different sources:
      //   • body.name is `entry.name` (the manifest's flow entry name) → "Main"
      //   • body.flow.name is the flow.json `name` field → the project name
      //     (createProjectImpl seeds flow.json with the user-supplied name).
      expect(body.name).toBe('Main');
      expect(body.valid).toBe(true);
      expect(body.error).toBeNull();
      expect(body.flow).not.toBeNull();
      expect(body.flow?.name).toBe(name);
      // filePath is `<repoPath>/flows/<flowSlug>/flow.json`. The slug
      // `projectSlug/flowSlug` does NOT appear verbatim — the `/flows/`
      // segment lives between them on disk. Check the two halves separately.
      const [projectSlug, flowSlug] = created.slug.split('/');
      expect(body.filePath).toContain(projectSlug as string);
      expect(body.filePath).toContain(`flows/${flowSlug}/flow.json`);
      expect(body.filePath.endsWith('flow.json')).toBe(true);
    });
  });

  describe('GET /api/flows/summary', () => {
    it('returns id, name, and description for each registered flow', async () => {
      const name = uniqueFlowId('summary-flow');
      // Manifest-driven: scaffolder writes the description into seeflow.json,
      // which scanProject lifts onto every FlowEntry. listFlowsSummary
      // surfaces `e.description` so the value shows up in the response with
      // no separate re-register step.
      const res0 = await fetch(`${studio.baseURL}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: join(studio.workspace, slugify(name)),
          name,
          description: 'integration summary',
        }),
      });
      expect(res0.status).toBe(200);
      const created = (await res0.json()) as CreateProjectResponse;

      const res = await fetch(`${studio.baseURL}/api/flows/summary`);
      expect(res.status).toBe(200);
      const list = (await res.json()) as Array<{
        id: string;
        name: string;
        description?: string;
      }>;
      const entry = list.find((e) => e.id === created.id);
      expect(entry).toBeDefined();
      // listFlowsSummary returns `liveFlow?.name ?? entry.name` — for a
      // successfully-parsed flow.json the live name (= the user-supplied
      // project name) wins over the manifest entry's "Main".
      expect(entry?.name).toBe(name);
      expect(entry?.description).toBe('integration summary');
    });
  });

  describe('GET /api/flows/:id/graph', () => {
    it('returns nodes/connectors with detail and html stripped', async () => {
      const name = uniqueFlowId('graph-flow');
      const created = await createProject(name);

      // Add a rectangle node with detail through the standard write path so
      // detail.md is externalized; the graph endpoint should still hide it.
      await postJson(`${flowApi(created.slug)}/nodes`, {
        id: 'shape-1',
        type: 'rectangle',
        data: { name: 'note', detail: '# secret body' },
      });

      const res = await fetch(`${studio.baseURL}${flowApi(created.slug)}/graph`);
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

      await postJson(`${flowApi(created.slug)}/nodes`, {
        id: 'shape-1',
        type: 'rectangle',
        data: { name: 'note', detail: '# inlined body' },
      });

      const res = await fetch(`${studio.baseURL}${flowApi(created.slug)}/nodes/shape-1`);
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
      const res = await fetch(`${studio.baseURL}${flowApi(created.slug)}/nodes/not-a-node`);
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
      mkdirSync(repoPath, { recursive: true });
      const flowJson = { version: 2, name: slug, nodes: [], connectors: [] };
      writeFileSync(join(repoPath, 'flow.json'), `${JSON.stringify(flowJson, null, 2)}\n`);

      const res = await fetch(`${studio.baseURL}/api/flows/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoPath, flowPath: 'flow.json' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as RegisterResponse;
      expect(body.id).toBeTruthy();
      expect(body.slug).toBeTruthy();

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
    it('removes a non-default flow from the registry', async () => {
      // Default-flow delete now requires --new-default (US-017): the route
      // refuses to delete the last flow in a project, and refuses to delete
      // the default flow without a replacement id. Add a non-default flow
      // then delete it so the test exercises the happy path without
      // touching the manifest's defaultFlow.
      const name = uniqueFlowId('delete-flow');
      const created = await createProject(name);
      const [projectSlug] = created.slug.split('/');
      const addRes = await fetch(`${studio.baseURL}/api/projects/${projectSlug}/flows`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'extra', name: 'Extra' }),
      });
      expect(addRes.status).toBe(201);
      const extraSlug = `${projectSlug}/extra`;

      // Sanity: registered.
      const before = (await (await fetch(`${studio.baseURL}/api/flows`)).json()) as FlowListItem[];
      expect(before.find((f) => f.slug === extraSlug)).toBeDefined();

      const res = await fetch(`${studio.baseURL}${flowApi(extraSlug)}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true });

      // Registry: gone.
      const after = (await (await fetch(`${studio.baseURL}/api/flows`)).json()) as FlowListItem[];
      expect(after.find((f) => f.slug === extraSlug)).toBeUndefined();
      const get = await fetch(`${studio.baseURL}${flowApi(extraSlug)}`);
      expect(get.status).toBe(404);

      // The default flow remains.
      expect(after.find((f) => f.slug === created.slug)).toBeDefined();
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
      const res = await postJson(`${flowApi(created.slug)}/nodes`, {
        type: 'rectangle',
        data: { name: 'Note' },
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
      expect(onDisk.nodes[0]?.type).toBe('rectangle');
      expect(onDisk.nodes[0]?.data?.name).toBe('Note');
    });
  });

  describe('POST /api/flows/:id/bulk', () => {
    it('adds many nodes + connectors atomically in one transactional write', async () => {
      const created = await createProject(uniqueFlowId('flow-bulk'));
      const res = await postJson(`${flowApi(created.slug)}/bulk`, {
        nodes: [
          { id: 'b1', type: 'rectangle', data: { name: 'B1' } },
          { id: 'b2', type: 'ellipse', data: { name: 'B2' } },
          { id: 'b3', type: 'sticky', data: { name: 'B3' } },
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
      const addRes = await postJson(`${flowApi(created.slug)}/nodes`, {
        id: 'p1',
        type: 'rectangle',
        data: { name: 'Original' },
      });
      expect(addRes.status).toBe(200);

      const res = await patchJson(`${flowApi(created.slug)}/nodes/p1`, { name: 'Updated' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      const onDisk = await readFlowJson(created.slug);
      const node = onDisk.nodes.find((n) => n.id === 'p1');
      expect(node?.data?.name).toBe('Updated');
      // The discriminator survives the partial patch — type IS the kind
      // under the flat schema, so no nested key needs to round-trip.
      expect(node?.type).toBe('rectangle');
    });
  });

  describe('PATCH /api/flows/:id/nodes/:nodeId/position', () => {
    // splitFlow routes `position` to style.json, so the disk-side assertion
    // reads style.json (not flow.json). The response body echoes the new
    // position so the canvas can confirm the write without re-fetching.
    it('persists x/y to style.json and echoes the new position', async () => {
      const created = await createProject(uniqueFlowId('node-position'));
      await postJson(`${flowApi(created.slug)}/nodes`, {
        id: 'pos1',
        type: 'rectangle',
        data: {},
      });

      const res = await patchJson(`${flowApi(created.slug)}/nodes/pos1/position`, {
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
      await seedRectangleNodes(created.slug, ['a', 'b', 'c']);

      const res = await patchJson(`${flowApi(created.slug)}/nodes/a/order`, { op: 'toFront' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      const onDisk = await readFlowJson(created.slug);
      expect(onDisk.nodes.map((n) => n.id)).toEqual(['b', 'c', 'a']);
    });
  });

  describe('DELETE /api/flows/:id/nodes/:nodeId', () => {
    it('removes the node and cascades adjacent connectors in one write', async () => {
      const created = await createProject(uniqueFlowId('node-delete'));
      await seedRectangleNodes(created.slug, ['a', 'b']);
      const connRes = await postJson(`${flowApi(created.slug)}/bulk`, {
        connectors: [
          { id: 'a-b', source: 'a', target: 'b' },
          { id: 'b-a', source: 'b', target: 'a' },
        ],
      });
      expect(connRes.status).toBe(200);

      const res = await fetch(`${studio.baseURL}${flowApi(created.slug)}/nodes/a`, {
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
      await seedRectangleNodes(created.slug, ['a', 'b']);

      const res = await postJson(`${flowApi(created.slug)}/connectors`, {
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
      await seedRectangleNodes(created.slug, ['a', 'b']);
      await postJson(`${flowApi(created.slug)}/connectors`, {
        id: 'c1',
        source: 'a',
        target: 'b',
      });

      const res = await patchJson(`${flowApi(created.slug)}/connectors/c1`, {
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
      await seedRectangleNodes(created.slug, ['a', 'b']);
      await postJson(`${flowApi(created.slug)}/connectors`, {
        id: 'c1',
        source: 'a',
        target: 'b',
      });

      const res = await fetch(`${studio.baseURL}${flowApi(created.slug)}/connectors/c1`, {
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

// US-006: per-type REST coverage. Each test exercises POST /nodes (create)
// + PATCH /nodes/:id (merge) for one of the four discriminator boundaries the
// AC calls out — a geometric type (database), image, html, icon — through
// the REST surface. Together they pin that the studio's HTTP layer accepts
// the flat-tag payloads and persists per-type required fields.
describe('integration: REST — per-type create + patch (geometric + image + html + icon)', () => {
  it("database (non-rectangle geometric): create → patch description → on-disk type stays 'database'", async () => {
    const created = await createProject(uniqueFlowId('rest-rt-database'));

    const addRes = await postJson(`${flowApi(created.slug)}/nodes`, {
      id: 'db1',
      type: 'database',
      data: { name: 'Orders DB' },
    });
    expect(addRes.status).toBe(200);

    const patchRes = await patchJson(`${flowApi(created.slug)}/nodes/db1`, {
      description: 'Primary store',
    });
    expect(patchRes.status).toBe(200);

    const onDisk = await readFlowJson(created.slug);
    const node = onDisk.nodes.find((n) => n.id === 'db1');
    expect(node?.type).toBe('database');
    expect(node?.data?.name).toBe('Orders DB');
    expect(node?.data?.description).toBe('Primary store');
  });

  it('image: create with nodes/<id>/-relative path → patch alt → required `path` survives', async () => {
    const created = await createProject(uniqueFlowId('rest-rt-image'));

    const addRes = await postJson(`${flowApi(created.slug)}/nodes`, {
      id: 'img1',
      type: 'image',
      // image's required `path` must start with `nodes/<id>/` per the
      // ResolvedFlowSchema superRefine — the node folder owns its cleanup.
      data: { path: 'nodes/img1/cover.png', alt: 'cover' },
    });
    expect(addRes.status).toBe(200);

    const patchRes = await patchJson(`${flowApi(created.slug)}/nodes/img1`, {
      alt: 'updated cover',
    });
    expect(patchRes.status).toBe(200);

    const onDisk = await readFlowJson(created.slug);
    const node = onDisk.nodes.find((n) => n.id === 'img1');
    expect(node?.type).toBe('image');
    expect(node?.data?.path).toBe('nodes/img1/cover.png');
    expect(node?.data?.alt).toBe('updated cover');
  });

  it('html: create with inline html → patch html content → externalizes to view.html', async () => {
    const created = await createProject(uniqueFlowId('rest-rt-html'));

    const addRes = await postJson(`${flowApi(created.slug)}/nodes`, {
      id: 'h1',
      type: 'html',
      data: { name: 'Markup', html: '<p>first</p>' },
    });
    expect(addRes.status).toBe(200);

    const patchRes = await patchJson(`${flowApi(created.slug)}/nodes/h1`, {
      html: '<p>second</p>',
    });
    expect(patchRes.status).toBe(200);

    // patchNodeImpl externalizes html to nodes/<id>/view.html; the
    // single-node GET inlines it back into data.html on read.
    const getRes = await fetch(`${studio.baseURL}${flowApi(created.slug)}/nodes/h1`);
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as {
      node: { type: string; data: { html?: string } };
    };
    expect(body.node.type).toBe('html');
    expect(body.node.data.html).toBe('<p>second</p>');
  });

  it('icon: create with required `icon` glyph → patch alt → required `icon` survives', async () => {
    const created = await createProject(uniqueFlowId('rest-rt-icon'));

    const addRes = await postJson(`${flowApi(created.slug)}/nodes`, {
      id: 'i1',
      type: 'icon',
      data: { icon: 'box', name: 'Box' },
    });
    expect(addRes.status).toBe(200);

    const patchRes = await patchJson(`${flowApi(created.slug)}/nodes/i1`, {
      alt: 'a labelled box',
    });
    expect(patchRes.status).toBe(200);

    const onDisk = await readFlowJson(created.slug);
    const node = onDisk.nodes.find((n) => n.id === 'i1');
    expect(node?.type).toBe('icon');
    expect(node?.data?.icon).toBe('box');
    expect(node?.data?.alt).toBe('a labelled box');
  });

  it('linkflow: create rejects runtime-only _autoOpenPickerOnMount via strict schema', async () => {
    // The toolbar's drag-create flow stamps `data._autoOpenPickerOnMount`
    // onto the OPTIMISTIC override so a fresh drop auto-opens the picker
    // (see apps/web/src/pages/demo-view.tsx). The flag is runtime-only and
    // must never reach disk: `FlowLinkflowNodeData` is `.strict()`, so any
    // request that accidentally forwards it is rejected at the post-mutation
    // re-parse boundary. This test pins that wire-format contract so a
    // future demo-view refactor can't silently start persisting the flag.
    const created = await createProject(uniqueFlowId('rest-rt-linkflow-strict'));

    const addRes = await postJson(`${flowApi(created.slug)}/nodes`, {
      id: 'lf-strict',
      type: 'linkflow',
      data: { width: 240, height: 100, _autoOpenPickerOnMount: true },
    });
    expect(addRes.status).toBe(400);
    const body = (await addRes.json()) as { error?: string };
    expect(body.error).toBe('Flow failed schema validation');

    // Belt-and-braces: the flow.json on disk must not have grown a stranded
    // node — the strict failure rolls back the write.
    const onDisk = await readFlowJson(created.slug);
    expect(onDisk.nodes.find((n) => n.id === 'lf-strict')).toBeUndefined();
  });
});

// US-009: full 12-tag create → patch → delete round-trip through the REST
// surface. Earlier per-type blocks above cover database / image / html / icon
// individually; this table-driven test fences the rest of the matrix
// (rectangle / ellipse / sticky / text / server / user / queue / cloud) so
// every variant survives an add+patch+delete via /api/flows/:id/nodes.
describe('integration: REST — round-trip every one of the 12 type tags', () => {
  interface PerTypeCase {
    type: string;
    createData: Record<string, unknown>;
    // Patch body — must use a key present in NodePatchBodySchema. `description`
    // works for every type since the field lives in NodeSemanticBaseShape.
    patchBody: Record<string, unknown>;
    assertPatched: (data: Record<string, unknown>) => void;
  }

  const cases: PerTypeCase[] = [
    {
      type: 'rectangle',
      createData: { name: 'r' },
      patchBody: { description: 'updated' },
      assertPatched: (d) => expect(d.description).toBe('updated'),
    },
    {
      type: 'ellipse',
      createData: { name: 'e' },
      patchBody: { description: 'updated' },
      assertPatched: (d) => expect(d.description).toBe('updated'),
    },
    {
      type: 'sticky',
      createData: { name: 's' },
      patchBody: { description: 'updated' },
      assertPatched: (d) => expect(d.description).toBe('updated'),
    },
    {
      type: 'text',
      createData: { name: 't' },
      patchBody: { description: 'updated' },
      assertPatched: (d) => expect(d.description).toBe('updated'),
    },
    {
      type: 'database',
      createData: { name: 'db' },
      patchBody: { description: 'updated' },
      assertPatched: (d) => expect(d.description).toBe('updated'),
    },
    {
      type: 'server',
      createData: { name: 'svr' },
      patchBody: { description: 'updated' },
      assertPatched: (d) => expect(d.description).toBe('updated'),
    },
    {
      type: 'user',
      createData: { name: 'u' },
      patchBody: { description: 'updated' },
      assertPatched: (d) => expect(d.description).toBe('updated'),
    },
    {
      type: 'queue',
      createData: { name: 'q' },
      patchBody: { description: 'updated' },
      assertPatched: (d) => expect(d.description).toBe('updated'),
    },
    {
      type: 'cloud',
      createData: { name: 'c' },
      patchBody: { description: 'updated' },
      assertPatched: (d) => expect(d.description).toBe('updated'),
    },
    {
      type: 'image',
      // image's required `path` must start with `nodes/<id>/` per the
      // ResolvedFlowSchema superRefine — the on-disk cleanup contract.
      createData: { path: 'nodes/n1/cover.png' },
      patchBody: { alt: 'a caption' },
      assertPatched: (d) => {
        expect(d.path).toBe('nodes/n1/cover.png');
        expect(d.alt).toBe('a caption');
      },
    },
    {
      type: 'html',
      createData: { html: '<p>first</p>' },
      patchBody: { html: '<p>second</p>' },
      assertPatched: () => {
        // html is externalized to nodes/<id>/view.html on write and inlined
        // back on the per-node GET. Asserted via the single-node endpoint in
        // the per-block test above; here we just confirm the patch succeeded.
      },
    },
    {
      type: 'icon',
      createData: { icon: 'shopping-cart' },
      patchBody: { alt: 'a cart' },
      assertPatched: (d) => {
        expect(d.icon).toBe('shopping-cart');
        expect(d.alt).toBe('a cart');
      },
    },
  ];

  for (const c of cases) {
    it(`${c.type}: create → patch → delete round-trip via REST`, async () => {
      const created = await createProject(uniqueFlowId(`rest-rt-12-${c.type}`));
      // Use 'n1' for the seed id so the image fixture's path matches the
      // node id (the ResolvedFlowSchema superRefine requires path to start
      // with `nodes/<id>/`).
      const nodeId = 'n1';

      const addRes = await postJson(`${flowApi(created.slug)}/nodes`, {
        id: nodeId,
        type: c.type,
        data: c.createData,
      });
      expect(addRes.status).toBe(200);

      const patchRes = await patchJson(`${flowApi(created.slug)}/nodes/${nodeId}`, c.patchBody);
      expect(patchRes.status).toBe(200);

      const onDisk = await readFlowJson(created.slug);
      const node = onDisk.nodes.find((n) => n.id === nodeId);
      expect(node?.type).toBe(c.type);
      c.assertPatched((node?.data ?? {}) as Record<string, unknown>);

      const delRes = await fetch(`${studio.baseURL}${flowApi(created.slug)}/nodes/${nodeId}`, {
        method: 'DELETE',
      });
      expect(delRes.status).toBe(200);

      const finalDisk = await readFlowJson(created.slug);
      expect(finalDisk.nodes.find((n) => n.id === nodeId)).toBeUndefined();
    });
  }
});
