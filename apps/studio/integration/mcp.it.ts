import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { slugify } from '../src/registry.ts';
import { uniqueFlowId } from './support/ids.ts';
import { type McpClient, spawnMcpClient } from './support/mcp-client.ts';
import { type StudioHandle, spawnStudio } from './support/studio-harness.ts';

// One shared studio + one MCP stdio client per file. Every mutating test
// creates its own flow via REST so it can run in parallel and so each tool's
// happy-path stays independent of the others. The mcp-shim proxies tool calls
// to the studio's HTTP /mcp endpoint, so this exercises the full wire path
// (stdio → shim → HTTP → MCP server → operations.ts).
let studio: StudioHandle;
let client: McpClient;

beforeAll(async () => {
  studio = await spawnStudio();
  client = await spawnMcpClient({ SEEFLOW_STUDIO_URL: `${studio.baseURL}/mcp` });
});

afterAll(async () => {
  if (client) await client.close();
  if (studio) await studio.stop();
});

// Every MCP tool returns CallToolResult { content: [{ type: 'text', text: '<json>' }] }
// for okResult, or { isError: true, content: [{ type: 'text', text: '<msg>' }] }
// for errorResult. okJson asserts the not-error branch and parses the text.
function okJson<T>(result: CallToolResult): T {
  if (result.isError === true) {
    const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? '<no text>';
    throw new Error(`MCP tool returned isError=true: ${text}`);
  }
  expect(Array.isArray(result.content)).toBe(true);
  const first = result.content?.[0] as { type: string; text: string } | undefined;
  expect(first?.type).toBe('text');
  expect(typeof first?.text).toBe('string');
  return JSON.parse(first?.text ?? 'null') as T;
}

interface CreateProjectResponse {
  id: string;
  slug: string;
}

async function restCreateProject(name: string): Promise<CreateProjectResponse> {
  const res = await fetch(`${studio.baseURL}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: join(studio.workspace, slugify(name)), name }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as CreateProjectResponse;
}

// Per-flow HTTP routes moved under /api/projects/:project/flows/:flow/...
// (US-007). `slug` is `${projectSlug}/${flowSlug}`; substituting the inner
// `/` for `/flows/` produces the new path with no parsing.
function flowApi(slug: string): string {
  return `/api/projects/${slug.replace('/', '/flows/')}`;
}

// MCP tools take `{ project, flow }` instead of the old flat `{ flowId }`.
// Split the slug so callers can spread the result into tool arg objects.
function pf(slug: string): { project: string; flow: string } {
  const [project, flow] = slug.split('/');
  return { project: project as string, flow: flow as string };
}

async function seedRectangleNodesViaRest(slug: string, ids: string[]): Promise<void> {
  const res = await fetch(`${studio.baseURL}${flowApi(slug)}/bulk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodes: ids.map((id) => ({ id, type: 'rectangle', data: {} })),
    }),
  });
  expect(res.status).toBe(200);
}

// Sorted list of every tool registered in apps/studio/src/mcp.ts. A diff here
// is intentional: adding or removing a tool should require an explicit update
// to this snapshot AND a new per-tool test below.
const EXPECTED_TOOL_NAMES = [
  'seeflow_add_bulk',
  'seeflow_add_connector',
  'seeflow_add_node',
  'seeflow_create_project',
  'seeflow_delete_connector',
  'seeflow_delete_flow',
  'seeflow_delete_node',
  'seeflow_get_flow',
  'seeflow_get_flow_graph',
  'seeflow_get_node',
  'seeflow_ids',
  'seeflow_list_flows',
  'seeflow_list_flows_summary',
  'seeflow_move_node',
  'seeflow_patch_connector',
  'seeflow_patch_node',
  'seeflow_register_flow',
  'seeflow_reorder_node',
  'seeflow_schema',
  'validate_seeflow',
];

describe('integration: MCP — tools/list', () => {
  it('returns the stable expected set of tool names', async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOL_NAMES);
  });

  it('every tool advertises an object-typed inputSchema', async () => {
    const result = await client.listTools();
    for (const tool of result.tools) {
      expect((tool.description ?? '').length).toBeGreaterThan(0);
      expect((tool.inputSchema as { type?: string }).type).toBe('object');
    }
  });
});

describe('integration: MCP — read-only tools', () => {
  it('seeflow_list_flows returns an array (includes any seeded flow)', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-list'));

    const result = await client.callTool('seeflow_list_flows');
    const data =
      okJson<Array<{ id: string; slug: string; name: string; repoPath: string; valid: boolean }>>(
        result,
      );
    expect(Array.isArray(data)).toBe(true);
    const found = data.find((f) => f.id === seeded.id);
    expect(found).toBeDefined();
    expect(found?.slug).toBe(seeded.slug);
    expect(found?.valid).toBe(true);
  });

  it('seeflow_get_flow returns the full flow definition for a flowId', async () => {
    const name = uniqueFlowId('mcp-get');
    const seeded = await restCreateProject(name);

    const result = await client.callTool('seeflow_get_flow', pf(seeded.slug));
    const data = okJson<{
      id: string;
      slug: string;
      name: string;
      filePath: string;
      flow: { version: number; name: string; nodes: unknown[]; connectors: unknown[] } | null;
      valid: boolean;
      error: string | null;
    }>(result);
    expect(data.id).toBe(seeded.id);
    expect(data.slug).toBe(seeded.slug);
    // data.name is `entry.name` (the manifest's flow entry, "Main" for a
    // freshly-scaffolded project); data.flow.name is the flow.json `name`
    // field (the user-supplied project name).
    expect(data.name).toBe('Main');
    expect(data.valid).toBe(true);
    expect(data.error).toBeNull();
    expect(data.flow?.name).toBe(name);
    expect(data.flow?.nodes).toEqual([]);
    expect(data.filePath.endsWith('flow.json')).toBe(true);
  });

  it('seeflow_list_flows_summary returns id, name, description per flow', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-summary'));

    const result = await client.callTool('seeflow_list_flows_summary');
    const data = okJson<Array<{ id: string; name: string; description?: string }>>(result);
    expect(Array.isArray(data)).toBe(true);
    const found = data.find((f) => f.id === seeded.id);
    expect(found).toBeDefined();
    expect(found?.name).toBeTruthy();
  });

  it('seeflow_get_flow_graph returns nodes/connectors with detail stripped', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-graph'));

    // Add a node with detail content via REST so file:// externalization runs.
    await fetch(`${studio.baseURL}${flowApi(seeded.slug)}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'shape-1',
        type: 'rectangle',
        data: { name: 'note', detail: '# inside' },
      }),
    });

    const result = await client.callTool('seeflow_get_flow_graph', pf(seeded.slug));
    const data = okJson<{
      id: string;
      nodes: Array<{ id: string; data: Record<string, unknown> }>;
    }>(result);
    const shape = data.nodes.find((n) => n.id === 'shape-1');
    expect(shape).toBeDefined();
    expect(shape?.data.detail).toBeUndefined();
  });

  it('seeflow_get_node returns the node with detail content inlined', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-getnode'));

    await fetch(`${studio.baseURL}${flowApi(seeded.slug)}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'shape-1',
        type: 'rectangle',
        data: { name: 'A', detail: '# inlined body' },
      }),
    });

    const result = await client.callTool('seeflow_get_node', {
      ...pf(seeded.slug),
      nodeId: 'shape-1',
    });
    const data = okJson<{ id: string; flowId: string; node: { data: { detail?: string } } }>(
      result,
    );
    expect(data.id).toBe('shape-1');
    // seeflow_get_node now keys responses by slug (US-007); the old short-id
    // wiring was dropped when flow-scoped routes moved under /api/projects/.
    expect(data.flowId).toBe(seeded.slug);
    expect(data.node.data.detail).toBe('# inlined body');
  });

  it('seeflow_schema (no args) returns the category index; (name) returns that category', async () => {
    // No args → index of schema categories. Every entry has name + description.
    const indexResult = await client.callTool('seeflow_schema', {});
    const index = okJson<{ categories: { name: string; description: string }[] }>(indexResult);
    expect(Array.isArray(index.categories)).toBe(true);
    const indexNames = index.categories.map((c) => c.name).sort();
    expect(indexNames).toEqual(['action', 'componentSpec', 'connector', 'flow', 'node', 'style']);

    // With a known category → that category's JSON Schemas + notes.
    const nodeResult = await client.callTool('seeflow_schema', { name: 'node' });
    const node = okJson<{ name: string; schemas: Record<string, unknown>; notes: string[] }>(
      nodeResult,
    );
    expect(node.name).toBe('node');
    // Flat 13-tag set: 9 geometric (rectangle/ellipse/sticky/text/database/
    // server/user/queue/cloud) + image + html + icon + component. The
    // schema-catalog returns one entry per FlowNodeSchema variant — visual
    // kind is the type. `component` is the json-render variant whose spec
    // lives in <project>/nodes/<id>/spec.json (see schema category
    // `componentSpec`).
    expect(Object.keys(node.schemas).sort()).toEqual([
      'cloud',
      'component',
      'database',
      'ellipse',
      'html',
      'icon',
      'image',
      'queue',
      'rectangle',
      'server',
      'sticky',
      'text',
      'user',
    ]);
    expect(Array.isArray(node.notes)).toBe(true);

    // Unknown category → errorResult with the available names surfaced.
    const bogus = await client.callTool('seeflow_schema', { name: 'does-not-exist' });
    expect(bogus.isError).toBe(true);
  });

  it('validate_seeflow returns { ok: true } for a minimal valid flow', async () => {
    // The MCP tool wraps validateImpl directly (NOT the REST `/api/flows/validate`
    // route — that one wraps it with its own `stats` + `warnings` envelope). On
    // a clean parse validateImpl returns just `{ ok: true }`; on failure it
    // returns `{ ok: false, issues: [...] }`.
    const flow = {
      version: 2,
      name: uniqueFlowId('mcp-validate'),
      nodes: [],
      connectors: [],
    };
    const result = await client.callTool('validate_seeflow', { flow });
    const data = okJson<{ ok: true } | { ok: false; issues: unknown[] }>(result);
    expect(data.ok).toBe(true);
    if (data.ok === false) {
      // Surfacing the issues helps debug if the schema gets stricter later.
      throw new Error(`Expected ok:true, got issues: ${JSON.stringify(data.issues)}`);
    }
  });

  it('seeflow_ids mints node ids with the canonical `node-` prefix', async () => {
    const result = await client.callTool('seeflow_ids', { type: 'node', count: 6 });
    const data = okJson<{ ids: string[] }>(result);
    expect(data.ids).toHaveLength(6);
    for (const id of data.ids) {
      expect(/^node-[A-Za-z0-9]{10}$/.test(id)).toBe(true);
    }
    expect(new Set(data.ids).size).toBe(6);
  });

  it('seeflow_ids mints connector ids with the canonical `conn-` prefix', async () => {
    const result = await client.callTool('seeflow_ids', { type: 'connector', count: 4 });
    const data = okJson<{ ids: string[] }>(result);
    expect(data.ids).toHaveLength(4);
    for (const id of data.ids) {
      expect(/^conn-[A-Za-z0-9]{10}$/.test(id)).toBe(true);
    }
  });

  it('seeflow_ids returns isError for unknown types and out-of-range counts', async () => {
    const badType = await client.callTool('seeflow_ids', { type: 'conn', count: 1 });
    expect(badType.isError).toBe(true);

    const tooMany = await client.callTool('seeflow_ids', { type: 'node', count: 101 });
    expect(tooMany.isError).toBe(true);

    const zero = await client.callTool('seeflow_ids', { type: 'node', count: 0 });
    expect(zero.isError).toBe(true);
  });
});

describe('integration: MCP — project + flow lifecycle tools', () => {
  it('seeflow_create_project scaffolds a new project on disk', async () => {
    const name = uniqueFlowId('mcp-create');
    const projectPath = join(studio.workspace, slugify(name));
    const result = await client.callTool('seeflow_create_project', {
      path: projectPath,
      name,
    });
    const data = okJson<{ id: string; slug: string }>(result);
    expect(data.id).toBeTruthy();
    expect(data.slug).toBeTruthy();

    // GET via REST to confirm registry side effect.
    const get = await fetch(`${studio.baseURL}${flowApi(data.slug)}`);
    expect(get.status).toBe(200);
  });

  it('seeflow_register_flow registers a flow.json sitting on disk', async () => {
    // Write the flow outside the workspace dir (sibling of it) so /api/projects
    // doesn't trip over it. This mirrors the REST register test in rest.it.ts.
    const slug = uniqueFlowId('mcp-register');
    const repoPath = join(studio.home, slug);
    mkdirSync(repoPath, { recursive: true });
    const flowJson = { version: 2, name: slug, nodes: [], connectors: [] };
    writeFileSync(join(repoPath, 'flow.json'), `${JSON.stringify(flowJson, null, 2)}\n`);

    const result = await client.callTool('seeflow_register_flow', {
      repoPath,
      flowPath: 'flow.json',
    });
    const data = okJson<{
      id: string;
      slug: string;
    }>(result);
    expect(data.id).toBeTruthy();
    expect(data.slug).toBeTruthy();

    // Cross-check via REST list.
    const list = (await (await fetch(`${studio.baseURL}/api/flows`)).json()) as Array<{
      id: string;
    }>;
    expect(list.find((f) => f.id === data.id)).toBeDefined();
  });

  it('seeflow_delete_flow unregisters a flow from the registry', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-delete-flow'));

    const result = await client.callTool('seeflow_delete_flow', pf(seeded.slug));
    const data = okJson<{ ok: boolean }>(result);
    expect(data.ok).toBe(true);

    // GET returns 404 after delete.
    const get = await fetch(`${studio.baseURL}${flowApi(seeded.slug)}`);
    expect(get.status).toBe(404);
  });
});

describe('integration: MCP — node tools', () => {
  it('seeflow_add_node appends a node and returns its id', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-add-node'));

    const result = await client.callTool('seeflow_add_node', {
      ...pf(seeded.slug),
      node: { type: 'rectangle', data: { name: 'MCP' } },
    });
    const data = okJson<{ ok: boolean; id: string; node: Record<string, unknown> }>(result);
    expect(data.ok).toBe(true);
    expect(data.id).toMatch(/^node-/);
    expect((data.node as { type?: string }).type).toBe('rectangle');
  });

  it('seeflow_add_bulk appends nodes + connectors atomically in one transactional write', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-add-bulk'));

    const result = await client.callTool('seeflow_add_bulk', {
      ...pf(seeded.slug),
      nodes: [
        { id: 'm1', type: 'rectangle', data: {} },
        { id: 'm2', type: 'ellipse', data: {} },
      ],
      // Connector references nodes from the same batch — only valid because the
      // merged-graph parse runs once after both arrays land.
      connectors: [{ id: 'm1-to-m2', source: 'm1', target: 'm2' }],
    });
    const data = okJson<{
      ok: boolean;
      nodes: Array<{ id: string; node: Record<string, unknown> }>;
      connectors: Array<{ id: string }>;
    }>(result);
    expect(data.ok).toBe(true);
    expect(data.nodes.map((n) => n.id)).toEqual(['m1', 'm2']);
    expect(data.connectors.map((c) => c.id)).toEqual(['m1-to-m2']);
  });

  it('seeflow_patch_node partial-merges into node.data', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-patch-node'));
    await seedRectangleNodesViaRest(seeded.slug, ['p1']);

    const result = await client.callTool('seeflow_patch_node', {
      ...pf(seeded.slug),
      nodeId: 'p1',
      name: 'Renamed',
    });
    const data = okJson<{ ok: boolean }>(result);
    expect(data.ok).toBe(true);

    // Re-fetch via REST and verify the merge landed. The node's flat
    // discriminator `type` (still 'rectangle') is preserved across the
    // partial patch — under the flat schema the type IS the geometric kind,
    // so no nested data field needs to round-trip the variant.
    const get = (await (await fetch(`${studio.baseURL}${flowApi(seeded.slug)}`)).json()) as {
      flow: { nodes: Array<{ id: string; type: string; data?: { name?: string } }> };
    };
    const node = get.flow.nodes.find((n) => n.id === 'p1');
    expect(node?.type).toBe('rectangle');
    expect(node?.data?.name).toBe('Renamed');
  });

  it('seeflow_move_node updates position and echoes it', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-move-node'));
    await seedRectangleNodesViaRest(seeded.slug, ['m1']);

    const result = await client.callTool('seeflow_move_node', {
      ...pf(seeded.slug),
      nodeId: 'm1',
      x: 42,
      y: 99,
    });
    const data = okJson<{ ok: boolean; position: { x: number; y: number } }>(result);
    expect(data.ok).toBe(true);
    expect(data.position).toEqual({ x: 42, y: 99 });
  });

  it('seeflow_reorder_node moves a node within flow.nodes[] (toFront)', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-reorder'));
    await seedRectangleNodesViaRest(seeded.slug, ['a', 'b', 'c']);

    const result = await client.callTool('seeflow_reorder_node', {
      ...pf(seeded.slug),
      nodeId: 'a',
      op: 'toFront',
    });
    const data = okJson<{ ok: boolean }>(result);
    expect(data.ok).toBe(true);

    // Verify order via REST.
    const get = (await (await fetch(`${studio.baseURL}${flowApi(seeded.slug)}`)).json()) as {
      flow: { nodes: Array<{ id: string }> };
    };
    expect(get.flow.nodes.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('seeflow_delete_node removes the node and cascades adjacent connectors', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-delete-node'));
    await seedRectangleNodesViaRest(seeded.slug, ['a', 'b']);
    // Seed a connector touching 'a' so the cascade has something to clean up.
    const connRes = await fetch(`${studio.baseURL}${flowApi(seeded.slug)}/connectors`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'c-ab', source: 'a', target: 'b' }),
    });
    expect(connRes.status).toBe(200);

    const result = await client.callTool('seeflow_delete_node', {
      ...pf(seeded.slug),
      nodeId: 'a',
    });
    const data = okJson<{ ok: boolean }>(result);
    expect(data.ok).toBe(true);

    const get = (await (await fetch(`${studio.baseURL}${flowApi(seeded.slug)}`)).json()) as {
      flow: {
        nodes: Array<{ id: string }>;
        connectors: Array<{ id: string }>;
      };
    };
    expect(get.flow.nodes.map((n) => n.id)).toEqual(['b']);
    expect(get.flow.connectors).toEqual([]);
  });
});

describe('integration: MCP — connector tools', () => {
  it('seeflow_add_connector appends a single connector', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-add-conn'));
    await seedRectangleNodesViaRest(seeded.slug, ['a', 'b']);

    const result = await client.callTool('seeflow_add_connector', {
      ...pf(seeded.slug),
      connector: { id: 'c1', source: 'a', target: 'b' },
    });
    const data = okJson<{ ok: boolean; id: string }>(result);
    expect(data.ok).toBe(true);
    expect(data.id).toBe('c1');
  });

  it('seeflow_patch_connector partial-merges into the connector', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-patch-conn'));
    await seedRectangleNodesViaRest(seeded.slug, ['a', 'b']);
    const addRes = await fetch(`${studio.baseURL}${flowApi(seeded.slug)}/connectors`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'c1', source: 'a', target: 'b' }),
    });
    expect(addRes.status).toBe(200);

    const result = await client.callTool('seeflow_patch_connector', {
      ...pf(seeded.slug),
      connectorId: 'c1',
      label: 'patched',
    });
    const data = okJson<{ ok: boolean }>(result);
    expect(data.ok).toBe(true);

    // Verify label landed in flow.json (via REST get).
    const get = (await (await fetch(`${studio.baseURL}${flowApi(seeded.slug)}`)).json()) as {
      flow: { connectors: Array<{ id: string; label?: string }> };
    };
    expect(get.flow.connectors.find((c) => c.id === 'c1')?.label).toBe('patched');
  });

  it('seeflow_delete_connector removes a connector (nodes preserved)', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-delete-conn'));
    await seedRectangleNodesViaRest(seeded.slug, ['a', 'b']);
    const addRes = await fetch(`${studio.baseURL}${flowApi(seeded.slug)}/connectors`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'c1', source: 'a', target: 'b' }),
    });
    expect(addRes.status).toBe(200);

    const result = await client.callTool('seeflow_delete_connector', {
      ...pf(seeded.slug),
      connectorId: 'c1',
    });
    const data = okJson<{ ok: boolean }>(result);
    expect(data.ok).toBe(true);

    const get = (await (await fetch(`${studio.baseURL}${flowApi(seeded.slug)}`)).json()) as {
      flow: { nodes: Array<{ id: string }>; connectors: Array<{ id: string }> };
    };
    expect(get.flow.connectors).toEqual([]);
    expect(get.flow.nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });
});

// US-006: per-type round-trip coverage for the four discriminator boundaries
// the AC calls out — a geometric type (database), image, html, icon — through
// the MCP tool surface. Each case exercises add → patch → delete and verifies
// the per-type required field (path / html / icon) survives the round-trip.
describe('integration: MCP — per-type round-trip (geometric + image + html + icon)', () => {
  it("database (geometric): add → patch description → delete; type stays 'database' across the merge", async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-rt-database'));

    const addResult = await client.callTool('seeflow_add_node', {
      ...pf(seeded.slug),
      node: { id: 'db1', type: 'database', data: { name: 'Orders DB' } },
    });
    const added = okJson<{ ok: boolean; id: string; node: { type: string } }>(addResult);
    expect(added.ok).toBe(true);
    expect(added.id).toBe('db1');
    expect(added.node.type).toBe('database');

    const patchResult = await client.callTool('seeflow_patch_node', {
      ...pf(seeded.slug),
      nodeId: 'db1',
      description: 'Primary store',
    });
    expect(okJson<{ ok: boolean }>(patchResult).ok).toBe(true);

    const get = (await (await fetch(`${studio.baseURL}${flowApi(seeded.slug)}`)).json()) as {
      flow: { nodes: Array<{ id: string; type: string; data?: { description?: string } }> };
    };
    const node = get.flow.nodes.find((n) => n.id === 'db1');
    expect(node?.type).toBe('database');
    expect(node?.data?.description).toBe('Primary store');

    const delResult = await client.callTool('seeflow_delete_node', {
      ...pf(seeded.slug),
      nodeId: 'db1',
    });
    expect(okJson<{ ok: boolean }>(delResult).ok).toBe(true);

    const after = (await (await fetch(`${studio.baseURL}${flowApi(seeded.slug)}`)).json()) as {
      flow: { nodes: Array<{ id: string }> };
    };
    expect(after.flow.nodes.find((n) => n.id === 'db1')).toBeUndefined();
  });

  it('image: add with nodes/<id>/-relative path → patch alt → delete; required `path` survives the merge', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-rt-image'));

    const addResult = await client.callTool('seeflow_add_node', {
      ...pf(seeded.slug),
      // image's required `path` must start with `nodes/<id>/` per the
      // ResolvedFlowSchema superRefine — the node folder owns its cleanup.
      node: { id: 'img1', type: 'image', data: { path: 'nodes/img1/cover.png', alt: 'cover' } },
    });
    const added = okJson<{ ok: boolean; id: string; node: { type: string } }>(addResult);
    expect(added.ok).toBe(true);
    expect(added.node.type).toBe('image');

    const patchResult = await client.callTool('seeflow_patch_node', {
      ...pf(seeded.slug),
      nodeId: 'img1',
      alt: 'updated cover',
    });
    expect(okJson<{ ok: boolean }>(patchResult).ok).toBe(true);

    const get = (await (await fetch(`${studio.baseURL}${flowApi(seeded.slug)}`)).json()) as {
      flow: { nodes: Array<{ id: string; type: string; data?: { path?: string; alt?: string } }> };
    };
    const node = get.flow.nodes.find((n) => n.id === 'img1');
    expect(node?.type).toBe('image');
    expect(node?.data?.path).toBe('nodes/img1/cover.png');
    expect(node?.data?.alt).toBe('updated cover');

    const delResult = await client.callTool('seeflow_delete_node', {
      ...pf(seeded.slug),
      nodeId: 'img1',
    });
    expect(okJson<{ ok: boolean }>(delResult).ok).toBe(true);
  });

  it('html: add with inline html → patch html content → delete; html externalizes to view.html', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-rt-html'));

    const addResult = await client.callTool('seeflow_add_node', {
      ...pf(seeded.slug),
      node: {
        id: 'h1',
        type: 'html',
        data: { name: 'Markup', html: '<p>first</p>' },
      },
    });
    const added = okJson<{ ok: boolean; id: string; node: { type: string } }>(addResult);
    expect(added.ok).toBe(true);
    expect(added.node.type).toBe('html');

    const patchResult = await client.callTool('seeflow_patch_node', {
      ...pf(seeded.slug),
      nodeId: 'h1',
      html: '<p>second</p>',
    });
    expect(okJson<{ ok: boolean }>(patchResult).ok).toBe(true);

    const getNodeResult = await client.callTool('seeflow_get_node', {
      ...pf(seeded.slug),
      nodeId: 'h1',
    });
    const node = okJson<{ node: { type: string; data: { html?: string } } }>(getNodeResult);
    expect(node.node.type).toBe('html');
    // patchNodeImpl externalizes html to nodes/<id>/view.html; seeflow_get_node
    // inlines the file content back into data.html on read.
    expect(node.node.data.html).toBe('<p>second</p>');

    const delResult = await client.callTool('seeflow_delete_node', {
      ...pf(seeded.slug),
      nodeId: 'h1',
    });
    expect(okJson<{ ok: boolean }>(delResult).ok).toBe(true);
  });

  it('icon: add with required `icon` glyph → patch alt → delete; required `icon` survives', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-rt-icon'));

    const addResult = await client.callTool('seeflow_add_node', {
      ...pf(seeded.slug),
      node: { id: 'i1', type: 'icon', data: { icon: 'box', name: 'Box' } },
    });
    const added = okJson<{ ok: boolean; id: string; node: { type: string } }>(addResult);
    expect(added.ok).toBe(true);
    expect(added.node.type).toBe('icon');

    const patchResult = await client.callTool('seeflow_patch_node', {
      ...pf(seeded.slug),
      nodeId: 'i1',
      alt: 'a labelled box',
    });
    expect(okJson<{ ok: boolean }>(patchResult).ok).toBe(true);

    const get = (await (await fetch(`${studio.baseURL}${flowApi(seeded.slug)}`)).json()) as {
      flow: { nodes: Array<{ id: string; type: string; data?: { icon?: string; alt?: string } }> };
    };
    const node = get.flow.nodes.find((n) => n.id === 'i1');
    expect(node?.type).toBe('icon');
    expect(node?.data?.icon).toBe('box');
    expect(node?.data?.alt).toBe('a labelled box');

    const delResult = await client.callTool('seeflow_delete_node', {
      ...pf(seeded.slug),
      nodeId: 'i1',
    });
    expect(okJson<{ ok: boolean }>(delResult).ok).toBe(true);
  });
});
