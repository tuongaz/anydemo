import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
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
  scaffolded: boolean;
}

async function restCreateProject(name: string): Promise<CreateProjectResponse> {
  const res = await fetch(`${studio.baseURL}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as CreateProjectResponse;
}

async function seedShapeNodesViaRest(flowId: string, ids: string[]): Promise<void> {
  const res = await fetch(`${studio.baseURL}/api/flows/${flowId}/nodes/bulk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodes: ids.map((id) => ({ id, type: 'shapeNode', data: { shape: 'rectangle' } })),
    }),
  });
  expect(res.status).toBe(200);
}

// Sorted list of every tool registered in apps/studio/src/mcp.ts. A diff here
// is intentional: adding or removing a tool should require an explicit update
// to this snapshot AND a new per-tool test below.
const EXPECTED_TOOL_NAMES = [
  'seeflow_add_connector',
  'seeflow_add_connectors',
  'seeflow_add_node',
  'seeflow_add_nodes',
  'seeflow_create_project',
  'seeflow_delete_connector',
  'seeflow_delete_flow',
  'seeflow_delete_node',
  'seeflow_get_flow',
  'seeflow_get_flow_graph',
  'seeflow_get_node',
  'seeflow_list_flows',
  'seeflow_list_flows_summary',
  'seeflow_move_node',
  'seeflow_patch_connector',
  'seeflow_patch_node',
  'seeflow_register_flow',
  'seeflow_reorder_node',
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

    const result = await client.callTool('seeflow_get_flow', { flowId: seeded.id });
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
    expect(data.name).toBe(name);
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
    await fetch(`${studio.baseURL}/api/flows/${seeded.id}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'shape-1',
        type: 'shapeNode',
        data: { name: 'note', shape: 'rectangle', detail: '# inside' },
      }),
    });

    const result = await client.callTool('seeflow_get_flow_graph', { flowId: seeded.id });
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

    await fetch(`${studio.baseURL}/api/flows/${seeded.id}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'shape-1',
        type: 'shapeNode',
        data: { name: 'A', shape: 'rectangle', detail: '# inlined body' },
      }),
    });

    const result = await client.callTool('seeflow_get_node', {
      flowId: seeded.id,
      nodeId: 'shape-1',
    });
    const data = okJson<{ id: string; flowId: string; node: { data: { detail?: string } } }>(
      result,
    );
    expect(data.id).toBe('shape-1');
    expect(data.flowId).toBe(seeded.id);
    expect(data.node.data.detail).toBe('# inlined body');
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
});

describe('integration: MCP — project + flow lifecycle tools', () => {
  it('seeflow_create_project scaffolds a new project on disk', async () => {
    const name = uniqueFlowId('mcp-create');
    const result = await client.callTool('seeflow_create_project', { name });
    const data = okJson<{ id: string; slug: string; scaffolded: boolean }>(result);
    expect(data.id).toBeTruthy();
    expect(data.slug).toBeTruthy();
    expect(data.scaffolded).toBe(true);

    // GET via REST to confirm registry side effect.
    const get = await fetch(`${studio.baseURL}/api/flows/${data.id}`);
    expect(get.status).toBe(200);
  });

  it('seeflow_register_flow registers a flow.json sitting on disk', async () => {
    // Write the flow outside the workspace dir (sibling of it) so /api/projects
    // doesn't trip over it. This mirrors the REST register test in rest.it.ts.
    const slug = uniqueFlowId('mcp-register');
    const repoPath = join(studio.home, slug);
    const seeflowDir = join(repoPath, '.seeflow');
    mkdirSync(seeflowDir, { recursive: true });
    const flowJson = { version: 2, name: slug, nodes: [], connectors: [] };
    writeFileSync(join(seeflowDir, 'flow.json'), `${JSON.stringify(flowJson, null, 2)}\n`);

    const result = await client.callTool('seeflow_register_flow', {
      repoPath,
      flowPath: '.seeflow/flow.json',
    });
    const data = okJson<{
      id: string;
      slug: string;
      sdk: { outcome: string; filePath: string | null };
    }>(result);
    expect(data.id).toBeTruthy();
    expect(data.slug).toBeTruthy();
    expect(typeof data.sdk.outcome).toBe('string');

    // Cross-check via REST list.
    const list = (await (await fetch(`${studio.baseURL}/api/flows`)).json()) as Array<{
      id: string;
    }>;
    expect(list.find((f) => f.id === data.id)).toBeDefined();
  });

  it('seeflow_delete_flow unregisters a flow from the registry', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-delete-flow'));

    const result = await client.callTool('seeflow_delete_flow', { flowId: seeded.id });
    const data = okJson<{ ok: boolean }>(result);
    expect(data.ok).toBe(true);

    // GET returns 404 after delete.
    const get = await fetch(`${studio.baseURL}/api/flows/${seeded.id}`);
    expect(get.status).toBe(404);
  });
});

describe('integration: MCP — node tools', () => {
  it('seeflow_add_node appends a node and returns its id', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-add-node'));

    const result = await client.callTool('seeflow_add_node', {
      flowId: seeded.id,
      node: { type: 'shapeNode', data: { shape: 'rectangle', name: 'MCP' } },
    });
    const data = okJson<{ ok: boolean; id: string; node: Record<string, unknown> }>(result);
    expect(data.ok).toBe(true);
    expect(data.id).toMatch(/^node-/);
    expect((data.node as { type?: string }).type).toBe('shapeNode');
  });

  it('seeflow_add_nodes appends multiple nodes in one transactional write', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-add-nodes'));

    const result = await client.callTool('seeflow_add_nodes', {
      flowId: seeded.id,
      nodes: [
        { id: 'm1', type: 'shapeNode', data: { shape: 'rectangle' } },
        { id: 'm2', type: 'shapeNode', data: { shape: 'ellipse' } },
      ],
    });
    const data = okJson<{
      ok: boolean;
      nodes: Array<{ id: string; node: Record<string, unknown> }>;
    }>(result);
    expect(data.ok).toBe(true);
    expect(data.nodes.map((n) => n.id)).toEqual(['m1', 'm2']);
  });

  it('seeflow_patch_node partial-merges into node.data', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-patch-node'));
    await seedShapeNodesViaRest(seeded.id, ['p1']);

    const result = await client.callTool('seeflow_patch_node', {
      flowId: seeded.id,
      nodeId: 'p1',
      name: 'Renamed',
    });
    const data = okJson<{ ok: boolean }>(result);
    expect(data.ok).toBe(true);

    // Re-fetch via REST and verify the merge landed.
    const get = (await (await fetch(`${studio.baseURL}/api/flows/${seeded.id}`)).json()) as {
      flow: { nodes: Array<{ id: string; data?: { name?: string; shape?: string } }> };
    };
    const node = get.flow.nodes.find((n) => n.id === 'p1');
    expect(node?.data?.name).toBe('Renamed');
    expect(node?.data?.shape).toBe('rectangle');
  });

  it('seeflow_move_node updates position and echoes it', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-move-node'));
    await seedShapeNodesViaRest(seeded.id, ['m1']);

    const result = await client.callTool('seeflow_move_node', {
      flowId: seeded.id,
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
    await seedShapeNodesViaRest(seeded.id, ['a', 'b', 'c']);

    const result = await client.callTool('seeflow_reorder_node', {
      flowId: seeded.id,
      nodeId: 'a',
      op: 'toFront',
    });
    const data = okJson<{ ok: boolean }>(result);
    expect(data.ok).toBe(true);

    // Verify order via REST.
    const get = (await (await fetch(`${studio.baseURL}/api/flows/${seeded.id}`)).json()) as {
      flow: { nodes: Array<{ id: string }> };
    };
    expect(get.flow.nodes.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('seeflow_delete_node removes the node and cascades adjacent connectors', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-delete-node'));
    await seedShapeNodesViaRest(seeded.id, ['a', 'b']);
    // Seed a connector touching 'a' so the cascade has something to clean up.
    const connRes = await fetch(`${studio.baseURL}/api/flows/${seeded.id}/connectors`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'c-ab', source: 'a', target: 'b', kind: 'default' }),
    });
    expect(connRes.status).toBe(200);

    const result = await client.callTool('seeflow_delete_node', {
      flowId: seeded.id,
      nodeId: 'a',
    });
    const data = okJson<{ ok: boolean }>(result);
    expect(data.ok).toBe(true);

    const get = (await (await fetch(`${studio.baseURL}/api/flows/${seeded.id}`)).json()) as {
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
    await seedShapeNodesViaRest(seeded.id, ['a', 'b']);

    const result = await client.callTool('seeflow_add_connector', {
      flowId: seeded.id,
      connector: { id: 'c1', source: 'a', target: 'b', kind: 'default' },
    });
    const data = okJson<{ ok: boolean; id: string }>(result);
    expect(data.ok).toBe(true);
    expect(data.id).toBe('c1');
  });

  it('seeflow_add_connectors appends many connectors in one write', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-add-conns'));
    await seedShapeNodesViaRest(seeded.id, ['a', 'b']);

    const result = await client.callTool('seeflow_add_connectors', {
      flowId: seeded.id,
      connectors: [
        { id: 'c1', source: 'a', target: 'b', kind: 'default' },
        { id: 'c2', source: 'b', target: 'a', kind: 'event', eventName: 'evt.one' },
      ],
    });
    const data = okJson<{
      ok: boolean;
      connectors: Array<{ id: string; connector: Record<string, unknown> }>;
    }>(result);
    expect(data.ok).toBe(true);
    expect(data.connectors.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('seeflow_patch_connector partial-merges into the connector', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-patch-conn'));
    await seedShapeNodesViaRest(seeded.id, ['a', 'b']);
    const addRes = await fetch(`${studio.baseURL}/api/flows/${seeded.id}/connectors`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'c1', source: 'a', target: 'b', kind: 'default' }),
    });
    expect(addRes.status).toBe(200);

    const result = await client.callTool('seeflow_patch_connector', {
      flowId: seeded.id,
      connectorId: 'c1',
      label: 'patched',
    });
    const data = okJson<{ ok: boolean }>(result);
    expect(data.ok).toBe(true);

    // Verify label landed in flow.json (via REST get).
    const get = (await (await fetch(`${studio.baseURL}/api/flows/${seeded.id}`)).json()) as {
      flow: { connectors: Array<{ id: string; label?: string }> };
    };
    expect(get.flow.connectors.find((c) => c.id === 'c1')?.label).toBe('patched');
  });

  it('seeflow_delete_connector removes a connector (nodes preserved)', async () => {
    const seeded = await restCreateProject(uniqueFlowId('mcp-delete-conn'));
    await seedShapeNodesViaRest(seeded.id, ['a', 'b']);
    const addRes = await fetch(`${studio.baseURL}/api/flows/${seeded.id}/connectors`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'c1', source: 'a', target: 'b', kind: 'default' }),
    });
    expect(addRes.status).toBe(200);

    const result = await client.callTool('seeflow_delete_connector', {
      flowId: seeded.id,
      connectorId: 'c1',
    });
    const data = okJson<{ ok: boolean }>(result);
    expect(data.ok).toBe(true);

    const get = (await (await fetch(`${studio.baseURL}/api/flows/${seeded.id}`)).json()) as {
      flow: { nodes: Array<{ id: string }>; connectors: Array<{ id: string }> };
    };
    expect(get.flow.connectors).toEqual([]);
    expect(get.flow.nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });
});
