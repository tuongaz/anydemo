import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const dir = mkdtempSync(join(tmpdir(), 'seeflow-mcp-reg-'));
  return join(dir, 'registry.json');
};

const tmpRepoWithDemo = (demo: unknown = VALID_DEMO) => {
  const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-mcp-repo-'));
  writeFileSync(join(repoDir, 'flow.json'), JSON.stringify(demo));
  return repoDir;
};

const tmpEmptyFolder = () => mkdtempSync(join(tmpdir(), 'seeflow-mcp-proj-'));

const buildApp = () => {
  const registry = createRegistry({ path: tmpRegistry() });
  const app = createApp({
    mode: 'prod',
    staticRoot: './dist/web',
    registry,
    disableWatcher: true,
  });
  return { app, registry };
};

interface JsonRpcEnvelope {
  jsonrpc: '2.0';
  id: number;
  result?: {
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
    tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
  };
  error?: { message: string };
}

let rpcId = 1;
const mcpRequest = async (
  app: ReturnType<typeof buildApp>['app'],
  method: string,
  params: Record<string, unknown>,
): Promise<JsonRpcEnvelope> => {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as JsonRpcEnvelope;
};

const callTool = (
  app: ReturnType<typeof buildApp>['app'],
  name: string,
  args: Record<string, unknown> = {},
) => mcpRequest(app, 'tools/call', { name, arguments: args });

const expectOk = (envelope: JsonRpcEnvelope): unknown => {
  expect(envelope.result?.isError).toBeFalsy();
  const text = envelope.result?.content?.[0]?.text;
  expect(typeof text).toBe('string');
  return JSON.parse(text ?? 'null');
};

const expectError = (envelope: JsonRpcEnvelope): string => {
  expect(envelope.result?.isError).toBe(true);
  const text = envelope.result?.content?.[0]?.text;
  expect(typeof text).toBe('string');
  return text ?? '';
};

describe('POST /mcp tools/list', () => {
  it('returns the discovery + node-lifecycle + patch + connector + bulk tools', async () => {
    const { app } = buildApp();
    const envelope = await mcpRequest(app, 'tools/list', {});
    const names = (envelope.result?.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual([
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
    ]);
  });

  it('every tool inputSchema has type: "object" (MCP spec)', async () => {
    const { app } = buildApp();
    const envelope = await mcpRequest(app, 'tools/list', {});
    const tools = envelope.result?.tools ?? [];
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.inputSchema?.type).toBe('object');
    }
  });

  it('emits inputSchemas derived from the Zod bodies for register + create_project', async () => {
    const { app } = buildApp();
    const envelope = await mcpRequest(app, 'tools/list', {});
    const byName = new Map((envelope.result?.tools ?? []).map((t) => [t.name, t]));

    const register = byName.get('seeflow_register_flow');
    expect(register?.inputSchema?.type).toBe('object');
    const registerProps = register?.inputSchema?.properties as Record<string, unknown>;
    expect(Object.keys(registerProps)).toEqual(expect.arrayContaining(['repoPath', 'flowPath']));

    const createProject = byName.get('seeflow_create_project');
    const cpProps = createProject?.inputSchema?.properties as Record<string, unknown>;
    expect(Object.keys(cpProps).sort()).toEqual(['description', 'name', 'path']);
    const cpRequired = createProject?.inputSchema?.required as string[];
    expect(cpRequired.sort()).toEqual(['name', 'path']);
  });
});

describe('seeflow_schema', () => {
  it('returns the category index when called with no args', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'seeflow_schema');
    const body = expectOk(envelope) as {
      categories: Array<{ name: string; description: string }>;
    };
    expect(body.categories.map((c) => c.name)).toEqual([
      'flow',
      'node',
      'connector',
      'action',
      'componentSpec',
      'style',
    ]);
  });

  it('returns full JSON Schemas + notes for a named category', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'seeflow_schema', { name: 'node' });
    const body = expectOk(envelope) as {
      name: string;
      schemas: Record<string, { type: string }>;
      notes: string[];
    };
    expect(body.name).toBe('node');
    expect(Object.keys(body.schemas).sort()).toEqual(
      [
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
      ].sort(),
    );
    expect(body.schemas.rectangle?.type).toBe('object');
    expect(body.notes.length).toBeGreaterThan(0);
  });

  it('returns isError for an unknown category', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'seeflow_schema', { name: 'bogus' });
    const msg = expectError(envelope);
    expect(msg).toContain('unknown schema category: bogus');
    expect(msg).toContain('flow');
  });
});

describe('seeflow_ids', () => {
  it('returns count ids with the node prefix', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'seeflow_ids', { type: 'node', count: 4 });
    const body = expectOk(envelope) as { ids: string[] };
    expect(body.ids).toHaveLength(4);
    for (const id of body.ids) {
      expect(/^node-[A-Za-z0-9]{10}$/.test(id)).toBe(true);
    }
    expect(new Set(body.ids).size).toBe(4);
  });

  it('returns count ids with the connector → `conn-` prefix', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'seeflow_ids', { type: 'connector', count: 2 });
    const body = expectOk(envelope) as { ids: string[] };
    expect(body.ids).toHaveLength(2);
    for (const id of body.ids) {
      expect(/^conn-[A-Za-z0-9]{10}$/.test(id)).toBe(true);
    }
  });

  it('accepts the upper bound (100) and rejects 101', async () => {
    const { app } = buildApp();
    const okEnv = await callTool(app, 'seeflow_ids', { type: 'node', count: 100 });
    expect((expectOk(okEnv) as { ids: string[] }).ids).toHaveLength(100);

    const badEnv = await callTool(app, 'seeflow_ids', { type: 'node', count: 101 });
    expect(expectError(badEnv)).toContain('invalid count: 101');
  });

  it('rejects unknown types (e.g. `conn`, capitalised, empty)', async () => {
    const { app } = buildApp();
    for (const bad of ['conn', 'Node', '', 'flow']) {
      const env = await callTool(app, 'seeflow_ids', { type: bad, count: 1 });
      const msg = expectError(env);
      expect(msg).toContain(`invalid type: ${bad}`);
      expect(msg).toContain('node');
      expect(msg).toContain('connector');
    }
  });

  it('rejects non-integer / zero / negative counts', async () => {
    const { app } = buildApp();
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const env = await callTool(app, 'seeflow_ids', { type: 'node', count: bad });
      expect(expectError(env)).toContain('invalid count:');
    }
  });

  it('rejects missing args', async () => {
    const { app } = buildApp();
    const env1 = await callTool(app, 'seeflow_ids', { count: 1 });
    expect(expectError(env1)).toContain('invalid type:');
    const env2 = await callTool(app, 'seeflow_ids', { type: 'node' });
    expect(expectError(env2)).toContain('invalid count:');
  });

  it('advertises an inputSchema with the type enum and count bounds', async () => {
    const { app } = buildApp();
    const envelope = await mcpRequest(app, 'tools/list', {});
    const tool = (envelope.result?.tools ?? []).find((t) => t.name === 'seeflow_ids');
    expect(tool).toBeDefined();
    const schema = tool?.inputSchema as {
      type: string;
      properties: {
        type: { type: string; enum: string[] };
        count: { type: string; minimum: number; maximum: number };
      };
      required: string[];
    };
    expect(schema.type).toBe('object');
    expect(schema.properties.type.enum).toEqual(['node', 'connector']);
    expect(schema.properties.count.minimum).toBe(1);
    expect(schema.properties.count.maximum).toBe(100);
    expect(schema.required.sort()).toEqual(['count', 'type']);
  });
});

describe('seeflow_list_flows', () => {
  it('returns the registry list (initially empty)', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'seeflow_list_flows');
    expect(expectOk(envelope)).toEqual([]);
  });

  it('reflects entries added through seeflow_register_flow', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    await callTool(app, 'seeflow_register_flow', {
      repoPath,
      flowPath: 'flow.json',
    });

    const envelope = await callTool(app, 'seeflow_list_flows');
    const list = expectOk(envelope) as Array<{ slug: string; valid: boolean; name: string }>;
    expect(list).toHaveLength(1);
    expect(list[0]?.slug).toBe('checkout-flow/main');
    expect(list[0]?.valid).toBe(true);
  });
});

describe('seeflow_get_flow', () => {
  it('returns the validated demo for a registered id', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const registerEnvelope = await callTool(app, 'seeflow_register_flow', {
      repoPath,
      flowPath: 'flow.json',
    });
    const reg = expectOk(registerEnvelope) as { id: string };

    const envelope = await callTool(app, 'seeflow_get_flow', { flowId: reg.id });
    const body = expectOk(envelope) as {
      id: string;
      valid: boolean;
      flow: { name: string };
      error: string | null;
    };
    expect(body.id).toBe(reg.id);
    expect(body.valid).toBe(true);
    expect(body.flow.name).toBe('Checkout Flow');
    expect(body.error).toBeNull();
  });

  it('returns an isError result for an unknown flowId', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'seeflow_get_flow', { flowId: 'does-not-exist' });
    expect(expectError(envelope)).toBe('not found');
  });
});

describe('seeflow_list_flows_summary', () => {
  it('returns id, name, description for each registered flow', async () => {
    const { app } = buildApp();
    const repoA = tmpRepoWithDemo({ ...VALID_DEMO, description: 'main flow' });
    const repoB = tmpRepoWithDemo({ ...VALID_DEMO, name: 'Refund' });
    await callTool(app, 'seeflow_register_flow', {
      repoPath: repoA,
      flowPath: 'flow.json',
    });
    await callTool(app, 'seeflow_register_flow', {
      repoPath: repoB,
      flowPath: 'flow.json',
    });

    const envelope = await callTool(app, 'seeflow_list_flows_summary');
    const list = expectOk(envelope) as Array<{ id: string; name: string; description?: string }>;
    expect(list).toHaveLength(2);
    const docs = list.find((e) => e.name === 'Checkout Flow');
    expect(docs?.description).toBe('main flow');
    const bare = list.find((e) => e.name === 'Refund');
    expect(bare).toBeDefined();
    expect('description' in (bare as object)).toBe(false);
  });
});

describe('seeflow_get_flow_graph', () => {
  it('returns nodes/connectors with detail and html stripped, description preserved', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo({
      ...VALID_DEMO,
      description: 'demo flow',
      nodes: [
        ...VALID_DEMO.nodes,
        {
          id: 'shape-1',
          type: 'rectangle',
          data: { name: 'note', detail: '# secrets' },
        },
        { id: 'html-1', type: 'html', data: { html: '<p>also secret</p>' } },
      ],
    });
    const reg = expectOk(
      await callTool(app, 'seeflow_register_flow', {
        repoPath,
        flowPath: 'flow.json',
      }),
    ) as { id: string };

    const envelope = await callTool(app, 'seeflow_get_flow_graph', { flowId: reg.id });
    const body = expectOk(envelope) as {
      description?: string;
      nodes: Array<{ id: string; data: Record<string, unknown> }>;
    };
    expect(body.description).toBe('demo flow');
    expect(body.nodes.find((n) => n.id === 'shape-1')?.data.detail).toBeUndefined();
    expect(body.nodes.find((n) => n.id === 'html-1')?.data.html).toBeUndefined();
  });

  it('returns an isError result for an unknown flowId', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'seeflow_get_flow_graph', { flowId: 'missing' });
    expect(expectError(envelope)).toBe('not found');
  });
});

describe('seeflow_get_node', () => {
  it('returns a single node with detail content inlined', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = expectOk(
      await callTool(app, 'seeflow_register_flow', {
        repoPath,
        flowPath: 'flow.json',
      }),
    ) as { id: string };

    const add = expectOk(
      await callTool(app, 'seeflow_add_node', {
        flowId: reg.id,
        node: {
          type: 'rectangle',
          data: { name: 'A', detail: '# inlined body' },
        },
      }),
    ) as { id: string };

    const envelope = await callTool(app, 'seeflow_get_node', { flowId: reg.id, nodeId: add.id });
    const body = expectOk(envelope) as {
      id: string;
      flowId: string;
      node: { data: { detail?: string } };
    };
    expect(body.id).toBe(add.id);
    expect(body.flowId).toBe(reg.id);
    expect(body.node.data.detail).toBe('# inlined body');
  });

  it('returns an isError result for an unknown flow id', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'seeflow_get_node', { flowId: 'missing', nodeId: 'n' });
    expect(expectError(envelope)).toBe('not found');
  });

  it('returns an isError result for an unknown nodeId in a registered flow', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = expectOk(
      await callTool(app, 'seeflow_register_flow', {
        repoPath,
        flowPath: 'flow.json',
      }),
    ) as { id: string };
    const envelope = await callTool(app, 'seeflow_get_node', {
      flowId: reg.id,
      nodeId: 'no-such-node',
    });
    expect(expectError(envelope)).toContain('Unknown nodeId');
  });
});

describe('seeflow_register_flow', () => {
  it('registers a valid demo and returns id + slug', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const envelope = await callTool(app, 'seeflow_register_flow', {
      repoPath,
      flowPath: 'flow.json',
    });
    const body = expectOk(envelope) as {
      id: string;
      slug: string;
    };
    expect(body.slug).toBe('checkout-flow/main');
    expect(registry.list()).toHaveLength(1);
  });

  it('errors when the demo file is missing on disk', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'seeflow_register_flow', {
      repoPath: '/this/path/does/not/exist',
      flowPath: 'flow.json',
    });
    const text = expectError(envelope);
    expect(text).toContain('Flow file not found');
    expect(text).toContain('/this/path/does/not/exist');
  });
});

describe('seeflow_delete_flow', () => {
  it('removes a registered demo and accepts id or slug', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const regEnvelope = await callTool(app, 'seeflow_register_flow', {
      repoPath,
      flowPath: 'flow.json',
    });
    const reg = expectOk(regEnvelope) as { id: string; slug: string };
    expect(registry.list()).toHaveLength(1);

    const byIdEnvelope = await callTool(app, 'seeflow_delete_flow', { flowId: reg.id });
    expect(expectOk(byIdEnvelope)).toEqual({ ok: true });
    expect(registry.list()).toHaveLength(0);

    // Slug-based deletion mirrors REST DELETE /api/flows/:id behavior.
    const repoPath2 = tmpRepoWithDemo();
    const second = expectOk(
      await callTool(app, 'seeflow_register_flow', {
        repoPath: repoPath2,
        flowPath: 'flow.json',
      }),
    ) as { slug: string };
    const bySlugEnvelope = await callTool(app, 'seeflow_delete_flow', { flowId: second.slug });
    expect(expectOk(bySlugEnvelope)).toEqual({ ok: true });
    expect(registry.list()).toHaveLength(0);
  });

  it('errors with "not found" for an unknown flowId', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'seeflow_delete_flow', { flowId: 'does-not-exist' });
    expect(expectError(envelope)).toBe('not found');
  });
});

describe('seeflow_create_project', () => {
  it('scaffolds a new project folder and writes flow.json', async () => {
    const projectPath = join(tmpEmptyFolder(), 'brand-new-flow');
    const { app, registry } = buildApp();
    const envelope = await callTool(app, 'seeflow_create_project', {
      path: projectPath,
      name: 'Brand New Flow',
    });
    const body = expectOk(envelope) as { id: string; slug: string };
    expect(body.slug).toBe('brand-new-flow/main');
    expect(existsSync(join(projectPath, 'flow.json'))).toBe(true);
    expect(existsSync(join(projectPath, '.tmp'))).toBe(true);
    expect(readFileSync(join(projectPath, '.tmp', '.gitignore'), 'utf8')).toBe('*\n!.gitignore\n');
    expect(registry.list()).toHaveLength(1);
  });

  it('errors when a project already exists at <path>/flow.json', async () => {
    const projectPath = join(tmpEmptyFolder(), 'taken');
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(
      join(projectPath, 'flow.json'),
      JSON.stringify({ version: 2, name: 'Taken', nodes: [], connectors: [] }),
    );

    const { app, registry } = buildApp();
    const envelope = await callTool(app, 'seeflow_create_project', {
      path: projectPath,
      name: 'Taken',
    });
    expect(expectError(envelope)).toContain(projectPath);
    expect(registry.list()).toHaveLength(0);
  });
});

// ---------- Node lifecycle tools (US-003) ----------

// Multi-node fixture for delete-cascade and reorder coverage. Nodes a/b/c
// chained via connectors a→b and b→c.
const VALID_DEMO_THREE_NODES = {
  version: 2,
  name: 'Three Nodes',
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

interface RegisterResult {
  id: string;
  slug: string;
}

const registerFixture = async (
  app: ReturnType<typeof buildApp>['app'],
  demo: unknown = VALID_DEMO,
) => {
  const repoPath = tmpRepoWithDemo(demo);
  const envelope = await callTool(app, 'seeflow_register_flow', {
    repoPath,
    flowPath: 'flow.json',
  });
  const reg = expectOk(envelope) as RegisterResult;
  return {
    repoPath,
    demoFile: join(repoPath, 'flow.json'),
    styleFile: join(repoPath, 'style.json'),
    reg,
  };
};

describe('seeflow_add_node', () => {
  it('appends a new node and auto-generates an id when absent', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app);

    const envelope = await callTool(app, 'seeflow_add_node', {
      flowId: reg.id,
      node: {
        type: 'rectangle',
        data: { name: 'Note A' },
      },
    });
    const body = expectOk(envelope) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^node-/);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; type: string }>;
    };
    expect(onDisk.nodes).toHaveLength(2);
    expect(onDisk.nodes.find((n) => n.id === body.id)?.type).toBe('rectangle');
  });

  it('returns isError with schema text when the new node is malformed', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app);
    const before = readFileSync(demoFile, 'utf8');

    // type:'image' without required `path` — ResolvedFlowSchema rejects the post-merge.
    const envelope = await callTool(app, 'seeflow_add_node', {
      flowId: reg.id,
      node: { type: 'image', position: { x: 0, y: 0 }, data: {} },
    });
    expect(expectError(envelope)).toContain('Flow failed schema validation');
    // File untouched on failed validation.
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('errors with "unknown demo" for an unknown flowId', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'seeflow_add_node', {
      flowId: 'does-not-exist',
      node: { type: 'rectangle', position: { x: 0, y: 0 }, data: {} },
    });
    expect(expectError(envelope)).toBe('unknown demo');
  });

  it('externalizes detail to nodes/<id>/detail.md when provided', async () => {
    const { app } = buildApp();
    const { demoFile, repoPath, reg } = await registerFixture(app);

    const envelope = await callTool(app, 'seeflow_add_node', {
      flowId: reg.id,
      node: {
        id: 'with-detail',
        type: 'rectangle',
        data: { detail: 'hello' },
      },
    });
    expect(expectOk(envelope)).toMatchObject({ ok: true });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: { detail?: string } }>;
    };
    const node = onDisk.nodes.find((n) => n.id === 'with-detail');
    expect(node?.data.detail).toBe('file://detail.md');
    expect(readFileSync(join(repoPath, 'nodes', 'with-detail', 'detail.md'), 'utf8')).toBe('hello');
  });

  it('writes an empty detail.md and file:// ref when detail is omitted', async () => {
    const { app } = buildApp();
    const { demoFile, repoPath, reg } = await registerFixture(app);

    await callTool(app, 'seeflow_add_node', {
      flowId: reg.id,
      node: {
        id: 'no-detail',
        type: 'rectangle',
        data: {},
      },
    });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: { detail?: string } }>;
    };
    const node = onDisk.nodes.find((n) => n.id === 'no-detail');
    expect(node?.data.detail).toBe('file://detail.md');
    expect(readFileSync(join(repoPath, 'nodes', 'no-detail', 'detail.md'), 'utf8')).toBe('');
  });
});

describe("seeflow_add_node + html externalization (type:'html')", () => {
  it('externalizes html to nodes/<id>/view.html when provided', async () => {
    const { app } = buildApp();
    const { demoFile, repoPath, reg } = await registerFixture(app);

    await callTool(app, 'seeflow_add_node', {
      flowId: reg.id,
      node: {
        id: 'html-mcp',
        type: 'html',
        data: { html: '<p>via mcp</p>' },
      },
    });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: { html?: string } }>;
    };
    const node = onDisk.nodes.find((n) => n.id === 'html-mcp');
    expect(node?.data.html).toBe('file://view.html');
    expect(readFileSync(join(repoPath, 'nodes', 'html-mcp', 'view.html'), 'utf8')).toBe(
      '<p>via mcp</p>',
    );
  });

  it("writes empty view.html and file:// ref when html is omitted on type:'html'", async () => {
    const { app } = buildApp();
    const { demoFile, repoPath, reg } = await registerFixture(app);

    await callTool(app, 'seeflow_add_node', {
      flowId: reg.id,
      node: { id: 'html-empty', type: 'html', data: {} },
    });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: { html?: string } }>;
    };
    expect(onDisk.nodes.find((n) => n.id === 'html-empty')?.data.html).toBe('file://view.html');
    expect(readFileSync(join(repoPath, 'nodes', 'html-empty', 'view.html'), 'utf8')).toBe('');
  });
});

describe("seeflow_patch_node + html externalization (type:'html')", () => {
  it('writes patch.html to view.html and keeps the file:// ref', async () => {
    const { app } = buildApp();
    const { demoFile, repoPath, reg } = await registerFixture(app);

    await callTool(app, 'seeflow_add_node', {
      flowId: reg.id,
      node: { id: 'h1', type: 'html', data: { html: 'init' } },
    });
    await callTool(app, 'seeflow_patch_node', {
      flowId: reg.id,
      nodeId: 'h1',
      html: '<p>patched</p>',
    });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: { html?: string } }>;
    };
    expect(onDisk.nodes.find((n) => n.id === 'h1')?.data.html).toBe('file://view.html');
    expect(readFileSync(join(repoPath, 'nodes', 'h1', 'view.html'), 'utf8')).toBe('<p>patched</p>');
  });
});

describe('seeflow_patch_node + detail externalization', () => {
  it('writes patch.detail to detail.md and keeps the file:// ref', async () => {
    const { app } = buildApp();
    const { demoFile, repoPath, reg } = await registerFixture(app);

    await callTool(app, 'seeflow_add_node', {
      flowId: reg.id,
      node: { id: 'n1', type: 'rectangle', data: {} },
    });
    await callTool(app, 'seeflow_patch_node', {
      flowId: reg.id,
      nodeId: 'n1',
      detail: 'patched',
    });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: { detail?: string } }>;
    };
    const node = onDisk.nodes.find((n) => n.id === 'n1');
    expect(node?.data.detail).toBe('file://detail.md');
    expect(readFileSync(join(repoPath, 'nodes', 'n1', 'detail.md'), 'utf8')).toBe('patched');
  });

  it('empties detail.md when patch.detail is empty, keeps the file:// ref', async () => {
    const { app } = buildApp();
    const { demoFile, repoPath, reg } = await registerFixture(app);

    await callTool(app, 'seeflow_add_node', {
      flowId: reg.id,
      node: {
        id: 'n1',
        type: 'rectangle',
        data: { detail: 'starts non-empty' },
      },
    });
    await callTool(app, 'seeflow_patch_node', {
      flowId: reg.id,
      nodeId: 'n1',
      detail: '',
    });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: { detail?: string } }>;
    };
    const node = onDisk.nodes.find((n) => n.id === 'n1');
    expect(node?.data.detail).toBe('file://detail.md');
    expect(readFileSync(join(repoPath, 'nodes', 'n1', 'detail.md'), 'utf8')).toBe('');
  });
});

describe('seeflow_delete_node', () => {
  it('removes the node and cascades adjacent connectors in one write', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app, VALID_DEMO_THREE_NODES);

    const envelope = await callTool(app, 'seeflow_delete_node', { flowId: reg.id, nodeId: 'b' });
    expect(expectOk(envelope)).toEqual({ ok: true });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string }>;
      connectors: Array<{ id: string }>;
    };
    expect(onDisk.nodes.map((n) => n.id)).toEqual(['a', 'c']);
    // Both a-to-b and b-to-c referenced node 'b' — cascade-removed.
    expect(onDisk.connectors).toEqual([]);
  });

  it('cascades the nodes/<id>/ folder along with the node row', async () => {
    const { app } = buildApp();
    const { repoPath, reg } = await registerFixture(app);

    await callTool(app, 'seeflow_add_node', {
      flowId: reg.id,
      node: {
        id: 'gone',
        type: 'rectangle',
        data: { detail: 'bye' },
      },
    });
    const folder = join(repoPath, 'nodes', 'gone');
    expect(existsSync(folder)).toBe(true);

    const envelope = await callTool(app, 'seeflow_delete_node', {
      flowId: reg.id,
      nodeId: 'gone',
    });
    expect(expectOk(envelope)).toEqual({ ok: true });
    expect(existsSync(folder)).toBe(false);
  });

  it('errors with the node id in the message for an unknown nodeId', async () => {
    const { app } = buildApp();
    const { reg } = await registerFixture(app);
    const envelope = await callTool(app, 'seeflow_delete_node', {
      flowId: reg.id,
      nodeId: 'missing',
    });
    expect(expectError(envelope)).toBe('Unknown nodeId: missing');
  });
});

describe('seeflow_move_node', () => {
  it('writes { x, y } back to the on-disk node position', async () => {
    const { app } = buildApp();
    const { styleFile, reg } = await registerFixture(app);

    const envelope = await callTool(app, 'seeflow_move_node', {
      flowId: reg.id,
      nodeId: 'api-checkout',
      x: 250,
      y: 320,
    });
    const body = expectOk(envelope) as { ok: boolean; position: { x: number; y: number } };
    expect(body).toEqual({ ok: true, position: { x: 250, y: 320 } });

    const style = JSON.parse(readFileSync(styleFile, 'utf8')) as {
      nodes: Record<string, { position: { x: number; y: number } }>;
    };
    expect(style.nodes['api-checkout']?.position).toEqual({ x: 250, y: 320 });
  });

  it('errors for an unknown nodeId', async () => {
    const { app } = buildApp();
    const { reg } = await registerFixture(app);
    const envelope = await callTool(app, 'seeflow_move_node', {
      flowId: reg.id,
      nodeId: 'nope',
      x: 0,
      y: 0,
    });
    expect(expectError(envelope)).toBe('Unknown nodeId: nope');
  });
});

describe('seeflow_reorder_node', () => {
  const onDiskOrder = (demoFile: string) =>
    (JSON.parse(readFileSync(demoFile, 'utf8')) as { nodes: Array<{ id: string }> }).nodes.map(
      (n) => n.id,
    );

  it('moves a node forward (swap with the next sibling)', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app, VALID_DEMO_THREE_NODES);

    const envelope = await callTool(app, 'seeflow_reorder_node', {
      flowId: reg.id,
      nodeId: 'a',
      op: 'forward',
    });
    expect(expectOk(envelope)).toEqual({ ok: true });
    expect(onDiskOrder(demoFile)).toEqual(['b', 'a', 'c']);
  });

  it('toIndex pins the node to an absolute index', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app, VALID_DEMO_THREE_NODES);

    const envelope = await callTool(app, 'seeflow_reorder_node', {
      flowId: reg.id,
      nodeId: 'a',
      op: 'toIndex',
      index: 2,
    });
    expect(expectOk(envelope)).toEqual({ ok: true });
    expect(onDiskOrder(demoFile)).toEqual(['b', 'c', 'a']);
  });

  it('errors for an unknown nodeId', async () => {
    const { app } = buildApp();
    const { reg } = await registerFixture(app, VALID_DEMO_THREE_NODES);
    const envelope = await callTool(app, 'seeflow_reorder_node', {
      flowId: reg.id,
      nodeId: 'missing',
      op: 'forward',
    });
    expect(expectError(envelope)).toBe('Unknown nodeId: missing');
  });

  it('rejects invalid op via the discriminated union', async () => {
    const { app } = buildApp();
    const { reg } = await registerFixture(app);
    const envelope = await callTool(app, 'seeflow_reorder_node', {
      flowId: reg.id,
      nodeId: 'api-checkout',
      op: 'noSuchOp',
    });
    expect(expectError(envelope)).toContain('Invalid reorder_node arguments');
  });
});

// ---------- Node patch tool (US-004) ----------

describe('seeflow_patch_node', () => {
  it('exposes NodePatchBodySchema fields plus flowId/nodeId in inputSchema', async () => {
    const { app } = buildApp();
    const envelope = await mcpRequest(app, 'tools/list', {});
    const tool = (envelope.result?.tools ?? []).find((t) => t.name === 'seeflow_patch_node');
    expect(tool).toBeDefined();
    const props = tool?.inputSchema?.properties as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining([
        'flowId',
        'nodeId',
        'position',
        'name',
        'description',
        'detail',
        'borderColor',
        'backgroundColor',
        'borderSize',
        'borderWidth',
        'borderStyle',
        'fontSize',
        'cornerRadius',
        'width',
        'height',
        // Flat-types refactor: `type` replaces `shape` for retype operations
        // (the discriminator IS the variant; NodePatchBody.type takes any of
        // the 12 NodeTypeSchema values).
        'type',
      ]),
    );
    const required = tool?.inputSchema?.required as string[];
    expect(required).toEqual(expect.arrayContaining(['flowId', 'nodeId']));
  });

  it('merges a partial label update into node.data and rewrites the file', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app);

    const envelope = await callTool(app, 'seeflow_patch_node', {
      flowId: reg.id,
      nodeId: 'api-checkout',
      name: 'POST /checkout (renamed)',
    });
    expect(expectOk(envelope)).toEqual({ ok: true });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{
        id: string;
        data: { name: string; playAction: { kind: string } };
      }>;
    };
    const node = onDisk.nodes.find((n) => n.id === 'api-checkout');
    expect(node?.data.name).toBe('POST /checkout (renamed)');
    expect(node?.data.playAction.kind).toBe('script');
  });

  it('merges multiple fields at once (label + borderColor + width + height)', async () => {
    const { app } = buildApp();
    const { demoFile, styleFile, reg } = await registerFixture(app);

    const envelope = await callTool(app, 'seeflow_patch_node', {
      flowId: reg.id,
      nodeId: 'api-checkout',
      name: 'Multi-Edit',
      borderColor: 'blue',
      backgroundColor: 'amber',
      width: 240,
      height: 120,
    });
    expect(expectOk(envelope)).toEqual({ ok: true });

    const arch = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: { name: string } }>;
    };
    const style = JSON.parse(readFileSync(styleFile, 'utf8')) as {
      nodes: Record<
        string,
        { borderColor?: string; backgroundColor?: string; width?: number; height?: number }
      >;
    };
    const node = arch.nodes.find((n) => n.id === 'api-checkout');
    expect(node?.data.name).toBe('Multi-Edit');
    const styleEntry = style.nodes['api-checkout'];
    expect(styleEntry?.borderColor).toBe('blue');
    expect(styleEntry?.backgroundColor).toBe('amber');
    expect(styleEntry?.width).toBe(240);
    expect(styleEntry?.height).toBe(120);
  });

  it('updates node.position when included in the patch body', async () => {
    const { app } = buildApp();
    const { styleFile, reg } = await registerFixture(app);

    const envelope = await callTool(app, 'seeflow_patch_node', {
      flowId: reg.id,
      nodeId: 'api-checkout',
      position: { x: 42, y: 84 },
    });
    expect(expectOk(envelope)).toEqual({ ok: true });

    const style = JSON.parse(readFileSync(styleFile, 'utf8')) as {
      nodes: Record<string, { position: { x: number; y: number } }>;
    };
    expect(style.nodes['api-checkout']?.position).toEqual({ x: 42, y: 84 });
  });

  it('rejects schema-violating input before the handler runs (borderColor outside enum)', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app);
    const before = readFileSync(demoFile, 'utf8');

    const envelope = await callTool(app, 'seeflow_patch_node', {
      flowId: reg.id,
      nodeId: 'api-checkout',
      borderColor: 'neon-pink',
    });
    expect(expectError(envelope)).toContain('Invalid patch_node arguments');
    // File untouched — Zod rejected before any IO.
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('rejects unknown top-level keys via .strict()', async () => {
    const { app } = buildApp();
    const { reg } = await registerFixture(app);

    const envelope = await callTool(app, 'seeflow_patch_node', {
      flowId: reg.id,
      nodeId: 'api-checkout',
      somethingMadeUp: true,
    });
    expect(expectError(envelope)).toContain('Invalid patch_node arguments');
  });

  // Regression: under the flat-types refactor, retyping is via NodePatchBody.type
  // (the discriminator IS the variant). NodePatchBodySchema accepts the full
  // 12-tag NodeTypeSchema; this test pins the 5 illustrative geometric
  // variants (database/server/user/queue/cloud) so a future schema split
  // narrowing the allowed retype set surfaces here.
  it('accepts the illustrative shape variants (database/server/user/queue/cloud)', async () => {
    const shapeDemo = {
      version: 2,
      name: 'Shape Patch',
      nodes: [{ id: 'shape-a', type: 'rectangle', data: { name: 'A' } }],
      connectors: [],
    };
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app, shapeDemo);

    for (const next of ['database', 'server', 'user', 'queue', 'cloud'] as const) {
      const envelope = await callTool(app, 'seeflow_patch_node', {
        flowId: reg.id,
        nodeId: 'shape-a',
        type: next,
      });
      expect(expectOk(envelope)).toEqual({ ok: true });

      const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
        nodes: Array<{ id: string; type: string }>;
      };
      expect(onDisk.nodes.find((n) => n.id === 'shape-a')?.type).toBe(next);
    }
  });

  it('returns isError for an unknown flowId', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'seeflow_patch_node', {
      flowId: 'does-not-exist',
      nodeId: 'api-checkout',
      name: 'x',
    });
    expect(expectError(envelope)).toBe('unknown demo');
  });

  it('returns isError with the node id in the message for an unknown nodeId', async () => {
    const { app } = buildApp();
    const { reg } = await registerFixture(app);

    const envelope = await callTool(app, 'seeflow_patch_node', {
      flowId: reg.id,
      nodeId: 'missing',
      name: 'x',
    });
    expect(expectError(envelope)).toBe('Unknown nodeId: missing');
  });

  it('returns Flow failed schema validation when the post-merge demo violates ResolvedFlowSchema', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app);
    const before = readFileSync(demoFile, 'utf8');

    // Under the flat-types refactor, `name` is optional on every variant —
    // the legacy "empty name" rejection no longer applies. Retype the
    // rectangle to `image` without a `path` in the same patch; the merge
    // succeeds and the post-merge ResolvedFlowSchema reparse surfaces it
    // as a badSchema error (because image requires path under
    // `nodes/<id>/`).
    const envelope = await callTool(app, 'seeflow_patch_node', {
      flowId: reg.id,
      nodeId: 'api-checkout',
      type: 'image',
    });
    expect(expectError(envelope)).toContain('Flow failed schema validation');
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('rejects unknown forward-compat fields on the flow node (strict schema)', async () => {
    const { app } = buildApp();
    // FlowSchema is strict — unknown fields at the node root are
    // rejected on register so the user gets a useful schema error.
    const repoPath = tmpRepoWithDemo({
      version: 2,
      name: 'Forward Compat',
      nodes: [
        {
          id: 'fc',
          type: 'rectangle',
          futureField: 'survives',
          data: {
            name: 'Future',
            stateSource: { kind: 'request' },
            playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
          },
        },
      ],
      connectors: [],
    });
    const envelope = await callTool(app, 'seeflow_register_flow', {
      repoPath,
      flowPath: 'flow.json',
    });
    expect(expectError(envelope)).toContain('chema validation');
  });
});

// ---------- Connector CRUD tools (US-005) ----------

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

const VALID_DEMO_WITH_CONN = {
  ...VALID_DEMO_TWO_NODES,
  connectors: [{ id: 'a-to-b', source: 'a', target: 'b', label: 'flow' }],
};

describe('seeflow_add_connector', () => {
  it('appends a new connector and auto-generates id', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app, VALID_DEMO_TWO_NODES);

    const envelope = await callTool(app, 'seeflow_add_connector', {
      flowId: reg.id,
      connector: { source: 'a', target: 'b' },
    });
    const body = expectOk(envelope) as { ok: boolean; id: string };
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

  it('honors a caller-provided id and persists optional eventName metadata', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app, VALID_DEMO_TWO_NODES);

    const envelope = await callTool(app, 'seeflow_add_connector', {
      flowId: reg.id,
      connector: {
        id: 'my-conn',
        source: 'a',
        target: 'b',
        eventName: 'OrderPlaced',
      },
    });
    const body = expectOk(envelope) as { id: string };
    expect(body.id).toBe('my-conn');

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      connectors: Array<{ id: string; eventName?: string }>;
    };
    const created = onDisk.connectors.find((c) => c.id === 'my-conn');
    expect(created?.eventName).toBe('OrderPlaced');
  });

  it('returns isError with schema text when source references an unknown node', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app, VALID_DEMO_TWO_NODES);
    const before = readFileSync(demoFile, 'utf8');

    const envelope = await callTool(app, 'seeflow_add_connector', {
      flowId: reg.id,
      connector: { source: 'ghost', target: 'b' },
    });
    expect(expectError(envelope)).toContain('Flow failed schema validation');
    // File untouched on failed validation.
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('errors with "unknown demo" for an unknown flowId', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'seeflow_add_connector', {
      flowId: 'does-not-exist',
      connector: { source: 'a', target: 'b' },
    });
    expect(expectError(envelope)).toBe('unknown demo');
  });
});

describe('seeflow_patch_connector', () => {
  it('exposes ConnectorPatchBodySchema fields plus flowId/connectorId in inputSchema', async () => {
    const { app } = buildApp();
    const envelope = await mcpRequest(app, 'tools/list', {});
    const tool = (envelope.result?.tools ?? []).find((t) => t.name === 'seeflow_patch_connector');
    expect(tool).toBeDefined();
    const props = tool?.inputSchema?.properties as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining([
        'flowId',
        'connectorId',
        'label',
        'style',
        'color',
        'direction',
        'eventName',
        'queueName',
        'method',
        'url',
        'source',
        'target',
        'sourceHandle',
        'targetHandle',
      ]),
    );
    const required = tool?.inputSchema?.required as string[];
    expect(required).toEqual(expect.arrayContaining(['flowId', 'connectorId']));
  });

  it('merges visual fields into the connector and rewrites the demo', async () => {
    const { app } = buildApp();
    const { demoFile, styleFile, reg } = await registerFixture(app, VALID_DEMO_WITH_CONN);

    const envelope = await callTool(app, 'seeflow_patch_connector', {
      flowId: reg.id,
      connectorId: 'a-to-b',
      label: 'renamed',
      style: 'dashed',
      color: 'blue',
      direction: 'both',
    });
    expect(expectOk(envelope)).toEqual({ ok: true });

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

  it('merges optional eventName metadata into the connector on PATCH', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app, VALID_DEMO_WITH_CONN);

    const envelope = await callTool(app, 'seeflow_patch_connector', {
      flowId: reg.id,
      connectorId: 'a-to-b',
      eventName: 'OrderPlaced',
    });
    expect(expectOk(envelope)).toEqual({ ok: true });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      connectors: Array<{ id: string; eventName?: string }>;
    };
    const conn = onDisk.connectors.find((c) => c.id === 'a-to-b');
    expect(conn?.eventName).toBe('OrderPlaced');
  });

  it('clears handle id when patch body passes sourceHandle: null', async () => {
    const demo = {
      ...VALID_DEMO_TWO_NODES,
      connectors: [{ id: 'a-to-b', source: 'a', target: 'b' }],
    };
    const { app } = buildApp();
    const { repoPath, styleFile, reg } = await registerFixture(app, demo);
    // Seed style.json with handle ids on the connector — those live in style.json
    // post-split, not on the flow file's connector entry.
    writeFileSync(
      styleFile,
      JSON.stringify({ connectors: { 'a-to-b': { sourceHandle: 'r', targetHandle: 't' } } }),
    );
    void repoPath; // suppress unused

    const envelope = await callTool(app, 'seeflow_patch_connector', {
      flowId: reg.id,
      connectorId: 'a-to-b',
      sourceHandle: null,
    });
    expect(expectOk(envelope)).toEqual({ ok: true });

    const style = JSON.parse(readFileSync(styleFile, 'utf8')) as {
      connectors: Record<string, Record<string, unknown>>;
    };
    const entry = style.connectors['a-to-b'];
    expect(entry).toBeDefined();
    expect('sourceHandle' in (entry as object)).toBe(false);
    expect(entry?.targetHandle).toBe('t');
  });

  it('rejects unknown top-level keys via .strict()', async () => {
    const { app } = buildApp();
    const { reg } = await registerFixture(app, VALID_DEMO_WITH_CONN);

    const envelope = await callTool(app, 'seeflow_patch_connector', {
      flowId: reg.id,
      connectorId: 'a-to-b',
      somethingMadeUp: true,
    });
    expect(expectError(envelope)).toContain('Invalid patch_connector arguments');
  });

  it('returns isError for an unknown flowId', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'seeflow_patch_connector', {
      flowId: 'does-not-exist',
      connectorId: 'a-to-b',
      label: 'x',
    });
    expect(expectError(envelope)).toBe('unknown demo');
  });

  it('returns isError with the connector id in the message for an unknown connectorId', async () => {
    const { app } = buildApp();
    const { reg } = await registerFixture(app, VALID_DEMO_WITH_CONN);

    const envelope = await callTool(app, 'seeflow_patch_connector', {
      flowId: reg.id,
      connectorId: 'missing',
      label: 'x',
    });
    expect(expectError(envelope)).toBe('Unknown connectorId: missing');
  });
});

describe('seeflow_delete_connector', () => {
  const VALID_DEMO_WITH_TWO_CONNS = {
    ...VALID_DEMO_TWO_NODES,
    connectors: [
      { id: 'a-to-b', source: 'a', target: 'b' },
      { id: 'b-to-a', source: 'b', target: 'a' },
    ],
  };

  it('removes only the targeted connector and leaves the rest', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app, VALID_DEMO_WITH_TWO_CONNS);

    const envelope = await callTool(app, 'seeflow_delete_connector', {
      flowId: reg.id,
      connectorId: 'a-to-b',
    });
    expect(expectOk(envelope)).toEqual({ ok: true });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      connectors: Array<{ id: string }>;
    };
    expect(onDisk.connectors.map((c) => c.id)).toEqual(['b-to-a']);
  });

  it('errors with the connector id in the message for an unknown connectorId', async () => {
    const { app } = buildApp();
    const { reg } = await registerFixture(app, VALID_DEMO_WITH_CONN);
    const envelope = await callTool(app, 'seeflow_delete_connector', {
      flowId: reg.id,
      connectorId: 'missing',
    });
    expect(expectError(envelope)).toBe('Unknown connectorId: missing');
  });

  it('errors with "unknown demo" for an unknown flowId', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'seeflow_delete_connector', {
      flowId: 'does-not-exist',
      connectorId: 'a-to-b',
    });
    expect(expectError(envelope)).toBe('unknown demo');
  });
});

describe('seeflow_add_bulk', () => {
  it('appends nodes + connectors atomically, with connectors referencing same-batch nodes', async () => {
    const { app } = buildApp();
    const { demoFile, repoPath, reg } = await registerFixture(app);

    const envelope = await callTool(app, 'seeflow_add_bulk', {
      flowId: reg.id,
      nodes: [
        { id: 'n1', type: 'rectangle', data: { name: 'A' } },
        { id: 'n2', type: 'ellipse', data: { name: 'B', detail: 'd2' } },
        { id: 'n3', type: 'html', data: { html: '<p>hi</p>' } },
      ],
      // Connector references nodes added in THIS call.
      connectors: [{ id: 'n1-to-n2', source: 'n1', target: 'n2' }],
    });
    const body = expectOk(envelope) as {
      ok: boolean;
      nodes: Array<{ id: string; node: { type: string } }>;
      connectors: Array<{ id: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.nodes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
    expect(body.connectors.map((c) => c.id)).toEqual(['n1-to-n2']);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: { detail?: string; html?: string } }>;
      connectors: Array<{ id: string }>;
    };
    // Fixture had 1 seed node; bulk added 3 → 4 total.
    expect(onDisk.nodes).toHaveLength(4);
    expect(onDisk.connectors).toHaveLength(1);
    expect(readFileSync(join(repoPath, 'nodes', 'n2', 'detail.md'), 'utf8')).toBe('d2');
    expect(readFileSync(join(repoPath, 'nodes', 'n3', 'view.html'), 'utf8')).toBe('<p>hi</p>');
  });

  it('accepts a connectors-only body wiring existing nodes', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app);
    // Seed two rectangles so the connectors have endpoints to wire.
    await callTool(app, 'seeflow_add_bulk', {
      flowId: reg.id,
      nodes: [
        {
          id: 'src',
          type: 'rectangle',
          data: {
            name: 'S',
            stateSource: { kind: 'request' },
            playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/p.ts' },
          },
        },
        {
          id: 'dst',
          type: 'rectangle',
          data: {
            name: 'D',
            stateSource: { kind: 'request' },
            playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/p.ts' },
          },
        },
      ],
    });

    const envelope = await callTool(app, 'seeflow_add_bulk', {
      flowId: reg.id,
      connectors: [
        { source: 'src', target: 'dst', eventName: 'thing' },
        { id: 'pinned', source: 'dst', target: 'src' },
      ],
    });
    const body = expectOk(envelope) as {
      ok: boolean;
      nodes: unknown[];
      connectors: Array<{ id: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.nodes).toHaveLength(0);
    expect(body.connectors[1]?.id).toBe('pinned');

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      connectors: Array<{ id: string; eventName?: string }>;
    };
    expect(onDisk.connectors).toHaveLength(2);
    expect(onDisk.connectors[0]?.eventName).toBe('thing');
  });

  it('rolls back BOTH arrays when a connector dangles against the merged graph', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app);
    const before = readFileSync(demoFile, 'utf8');

    const envelope = await callTool(app, 'seeflow_add_bulk', {
      flowId: reg.id,
      nodes: [
        { id: 'a', type: 'rectangle', data: { name: 'A' } },
        { id: 'b', type: 'rectangle', data: { name: 'B' } },
      ],
      connectors: [{ source: 'a', target: 'never-added' }],
    });
    expect(expectError(envelope)).toContain('Flow failed schema validation');
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('rejects the whole batch with a schema-validation error when one node is bad', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app);
    const before = readFileSync(demoFile, 'utf8');

    const envelope = await callTool(app, 'seeflow_add_bulk', {
      flowId: reg.id,
      nodes: [
        { type: 'rectangle', data: { name: 'A' } },
        // type:'image' without `path` — post-mutation parse rejects.
        { type: 'image', data: { name: 'B' } },
      ],
    });
    expect(expectError(envelope)).toContain('Flow failed schema validation');
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('errors on intra-batch duplicate node id (collection labelled)', async () => {
    const { app } = buildApp();
    const { reg } = await registerFixture(app);
    const envelope = await callTool(app, 'seeflow_add_bulk', {
      flowId: reg.id,
      nodes: [
        { id: 'dupe', type: 'rectangle', data: { name: 'A' } },
        { id: 'dupe', type: 'ellipse', data: { name: 'B' } },
      ],
    });
    expect(expectError(envelope)).toContain('Duplicate nodes id in batch');
  });

  it('errors on intra-batch duplicate connector id (collection labelled)', async () => {
    const { app } = buildApp();
    const { reg } = await registerFixture(app);
    const envelope = await callTool(app, 'seeflow_add_bulk', {
      flowId: reg.id,
      nodes: [{ id: 'a', type: 'rectangle', data: { name: 'A' } }],
      connectors: [
        { id: 'c-dupe', source: 'a', target: 'a' },
        { id: 'c-dupe', source: 'a', target: 'a' },
      ],
    });
    expect(expectError(envelope)).toContain('Duplicate connectors id in batch');
  });

  it('errors on id collision with an existing node', async () => {
    const { app } = buildApp();
    const { reg } = await registerFixture(app);
    await callTool(app, 'seeflow_add_node', {
      flowId: reg.id,
      node: { id: 'taken', type: 'rectangle', data: { name: 'seed' } },
    });

    const envelope = await callTool(app, 'seeflow_add_bulk', {
      flowId: reg.id,
      nodes: [{ id: 'taken', type: 'ellipse', data: { name: 'X' } }],
    });
    expect(expectError(envelope)).toContain('Node id already exists');
  });

  it('rejects an empty body via the at-least-one refine', async () => {
    const { app } = buildApp();
    const { reg } = await registerFixture(app);
    const envelope = await callTool(app, 'seeflow_add_bulk', { flowId: reg.id });
    expect(expectError(envelope)).toContain('Invalid add_bulk arguments');
  });

  it('errors with "unknown demo" for an unknown flowId', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'seeflow_add_bulk', {
      flowId: 'does-not-exist',
      nodes: [{ type: 'rectangle', data: { name: 'A' } }],
    });
    expect(expectError(envelope)).toBe('unknown demo');
  });

  it('input schema advertises the 100-item cap for both nodes and connectors', async () => {
    const { app } = buildApp();
    const envelope = await mcpRequest(app, 'tools/list', {});
    const tool = (envelope.result?.tools ?? []).find((t) => t.name === 'seeflow_add_bulk');
    const props = tool?.inputSchema?.properties as Record<string, { maxItems?: number }>;
    expect(props?.nodes?.maxItems).toBe(100);
    expect(props?.connectors?.maxItems).toBe(100);
  });
});
