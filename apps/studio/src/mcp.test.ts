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
      type: 'playNode',
      data: {
        name: 'POST /checkout',
        kind: 'service',
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
  mkdirSync(join(repoDir, '.seeflow'));
  writeFileSync(join(repoDir, '.seeflow', 'flow.json'), JSON.stringify(demo));
  return repoDir;
};

const tmpEmptyFolder = () => mkdtempSync(join(tmpdir(), 'seeflow-mcp-proj-'));

const buildApp = (opts: { projectBaseDir?: string } = {}) => {
  const registry = createRegistry({ path: tmpRegistry() });
  const app = createApp({
    mode: 'prod',
    staticRoot: './dist/web',
    registry,
    disableWatcher: true,
    ...opts,
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
  it('returns the discovery + node-lifecycle + patch + connector tools (5 + 4 + 1 + 3)', async () => {
    const { app } = buildApp();
    const envelope = await mcpRequest(app, 'tools/list', {});
    const names = (envelope.result?.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual([
      'seeflow_add_connector',
      'seeflow_add_node',
      'seeflow_create_project',
      'seeflow_delete_connector',
      'seeflow_delete_flow',
      'seeflow_delete_node',
      'seeflow_get_flow',
      'seeflow_list_flows',
      'seeflow_move_node',
      'seeflow_patch_connector',
      'seeflow_patch_node',
      'seeflow_register_flow',
      'seeflow_reorder_node',
      'validate_seeflow',
    ]);
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
    expect(Object.keys(cpProps)).toEqual(['name']);
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
      flowPath: '.seeflow/flow.json',
    });

    const envelope = await callTool(app, 'seeflow_list_flows');
    const list = expectOk(envelope) as Array<{ slug: string; valid: boolean; name: string }>;
    expect(list).toHaveLength(1);
    expect(list[0]?.slug).toBe('checkout-flow');
    expect(list[0]?.valid).toBe(true);
  });
});

describe('seeflow_get_flow', () => {
  it('returns the validated demo for a registered id', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const registerEnvelope = await callTool(app, 'seeflow_register_flow', {
      repoPath,
      flowPath: '.seeflow/flow.json',
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

describe('seeflow_register_flow', () => {
  it('registers a valid demo and returns id + slug + sdk outcome', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const envelope = await callTool(app, 'seeflow_register_flow', {
      repoPath,
      flowPath: '.seeflow/flow.json',
    });
    const body = expectOk(envelope) as {
      id: string;
      slug: string;
      sdk: { outcome: string; filePath: string | null };
    };
    expect(body.slug).toBe('checkout-flow');
    expect(body.sdk).toEqual({ outcome: 'skipped', filePath: null });
    expect(registry.list()).toHaveLength(1);
  });

  it('errors when the demo file is missing on disk', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'seeflow_register_flow', {
      repoPath: '/this/path/does/not/exist',
      flowPath: '.seeflow/flow.json',
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
      flowPath: '.seeflow/flow.json',
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
        flowPath: '.seeflow/flow.json',
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
  it('scaffolds a new project folder and writes .seeflow/flow.json', async () => {
    const projectBaseDir = tmpEmptyFolder();
    const { app, registry } = buildApp({ projectBaseDir });
    const envelope = await callTool(app, 'seeflow_create_project', { name: 'Brand New Flow' });
    const body = expectOk(envelope) as { id: string; slug: string; scaffolded: boolean };
    expect(body.scaffolded).toBe(true);
    expect(body.slug).toBe('brand-new-flow');
    expect(existsSync(join(projectBaseDir, 'brand-new-flow', '.seeflow', 'flow.json'))).toBe(true);
    expect(registry.list()).toHaveLength(1);
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
      type: 'playNode',
      data: {
        name: 'A',
        kind: 'service',
        stateSource: { kind: 'request' },
        playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
      },
    },
    {
      id: 'b',
      type: 'playNode',
      data: {
        name: 'B',
        kind: 'service',
        stateSource: { kind: 'request' },
        playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
      },
    },
    {
      id: 'c',
      type: 'playNode',
      data: {
        name: 'C',
        kind: 'service',
        stateSource: { kind: 'request' },
        playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
      },
    },
  ],
  connectors: [
    { id: 'a-to-b', source: 'a', target: 'b', kind: 'default' },
    { id: 'b-to-c', source: 'b', target: 'c', kind: 'default' },
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
    flowPath: '.seeflow/flow.json',
  });
  const reg = expectOk(envelope) as RegisterResult;
  return {
    repoPath,
    demoFile: join(repoPath, '.seeflow', 'flow.json'),
    styleFile: join(repoPath, '.seeflow', 'style.json'),
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
        type: 'shapeNode',
        data: { shape: 'rectangle', name: 'Note A' },
      },
    });
    const body = expectOk(envelope) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^node-/);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; type: string }>;
    };
    expect(onDisk.nodes).toHaveLength(2);
    expect(onDisk.nodes.find((n) => n.id === body.id)?.type).toBe('shapeNode');
  });

  it('returns isError with schema text when the new node is malformed', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app);
    const before = readFileSync(demoFile, 'utf8');

    // shapeNode without required `shape` — ResolvedFlowSchema rejects the post-merge.
    const envelope = await callTool(app, 'seeflow_add_node', {
      flowId: reg.id,
      node: { type: 'shapeNode', position: { x: 0, y: 0 }, data: {} },
    });
    expect(expectError(envelope)).toContain('Flow failed schema validation');
    // File untouched on failed validation.
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('errors with "unknown demo" for an unknown flowId', async () => {
    const { app } = buildApp();
    const envelope = await callTool(app, 'seeflow_add_node', {
      flowId: 'does-not-exist',
      node: { type: 'shapeNode', position: { x: 0, y: 0 }, data: { shape: 'rectangle' } },
    });
    expect(expectError(envelope)).toBe('unknown demo');
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
        'shape',
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

    // Empty name on a functional playNode trips ResolvedFlowSchema after merge.
    const envelope = await callTool(app, 'seeflow_patch_node', {
      flowId: reg.id,
      nodeId: 'api-checkout',
      name: '',
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
          type: 'playNode',
          futureField: 'survives',
          data: {
            name: 'Future',
            kind: 'service',
            stateSource: { kind: 'request' },
            playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
          },
        },
      ],
      connectors: [],
    });
    const envelope = await callTool(app, 'seeflow_register_flow', {
      repoPath,
      flowPath: '.seeflow/flow.json',
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
      type: 'playNode',
      data: {
        name: 'A',
        kind: 'service',
        stateSource: { kind: 'request' },
        playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
      },
    },
    {
      id: 'b',
      type: 'playNode',
      data: {
        name: 'B',
        kind: 'service',
        stateSource: { kind: 'request' },
        playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
      },
    },
  ],
  connectors: [],
};

const VALID_DEMO_WITH_CONN = {
  ...VALID_DEMO_TWO_NODES,
  connectors: [{ id: 'a-to-b', source: 'a', target: 'b', kind: 'default', label: 'flow' }],
};

describe('seeflow_add_connector', () => {
  it('appends a new connector, defaults kind to default, auto-generates id', async () => {
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
      connectors: Array<{ id: string; source: string; target: string; kind: string }>;
    };
    expect(onDisk.connectors).toHaveLength(1);
    const created = onDisk.connectors[0];
    expect(created?.id).toBe(body.id);
    expect(created?.source).toBe('a');
    expect(created?.target).toBe('b');
    expect(created?.kind).toBe('default');
  });

  it('honors a caller-provided id and kind=event with eventName', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app, VALID_DEMO_TWO_NODES);

    const envelope = await callTool(app, 'seeflow_add_connector', {
      flowId: reg.id,
      connector: {
        id: 'my-conn',
        source: 'a',
        target: 'b',
        kind: 'event',
        eventName: 'OrderPlaced',
      },
    });
    const body = expectOk(envelope) as { id: string };
    expect(body.id).toBe('my-conn');

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      connectors: Array<{ id: string; kind: string; eventName?: string }>;
    };
    const created = onDisk.connectors.find((c) => c.id === 'my-conn');
    expect(created?.kind).toBe('event');
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
        'kind',
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
      connectors: Array<{ id: string; kind: string; label?: string }>;
    };
    const style = JSON.parse(readFileSync(styleFile, 'utf8')) as {
      connectors: Record<string, { style?: string; color?: string; direction?: string }>;
    };
    const conn = arch.connectors.find((c) => c.id === 'a-to-b');
    expect(conn?.label).toBe('renamed');
    expect(conn?.kind).toBe('default');
    const styleEntry = style.connectors['a-to-b'];
    expect(styleEntry?.style).toBe('dashed');
    expect(styleEntry?.color).toBe('blue');
    expect(styleEntry?.direction).toBe('both');
  });

  it('clears stale kind-specific fields when kind changes (event → default)', async () => {
    const demo = {
      ...VALID_DEMO_TWO_NODES,
      connectors: [
        { id: 'a-to-b', source: 'a', target: 'b', kind: 'event', eventName: 'OrderPlaced' },
      ],
    };
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app, demo);

    const envelope = await callTool(app, 'seeflow_patch_connector', {
      flowId: reg.id,
      connectorId: 'a-to-b',
      kind: 'default',
    });
    expect(expectOk(envelope)).toEqual({ ok: true });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      connectors: Array<Record<string, unknown>>;
    };
    const conn = onDisk.connectors.find((c) => c.id === 'a-to-b');
    expect(conn?.kind).toBe('default');
    // Stale 'eventName' from the previous kind must be removed.
    expect(conn?.eventName).toBeUndefined();
  });

  it('switching to kind=event with an eventName succeeds (kind-change happy path)', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app, VALID_DEMO_WITH_CONN);

    const envelope = await callTool(app, 'seeflow_patch_connector', {
      flowId: reg.id,
      connectorId: 'a-to-b',
      kind: 'event',
      eventName: 'OrderPlaced',
    });
    expect(expectOk(envelope)).toEqual({ ok: true });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      connectors: Array<{ id: string; kind: string; eventName?: string }>;
    };
    const conn = onDisk.connectors.find((c) => c.id === 'a-to-b');
    expect(conn?.kind).toBe('event');
    expect(conn?.eventName).toBe('OrderPlaced');
  });

  it('clears handle id when patch body passes sourceHandle: null', async () => {
    const demo = {
      ...VALID_DEMO_TWO_NODES,
      connectors: [{ id: 'a-to-b', source: 'a', target: 'b', kind: 'default' }],
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

  it('returns Flow failed schema validation when kind=event lacks eventName', async () => {
    const { app } = buildApp();
    const { demoFile, reg } = await registerFixture(app, VALID_DEMO_WITH_CONN);
    const before = readFileSync(demoFile, 'utf8');

    const envelope = await callTool(app, 'seeflow_patch_connector', {
      flowId: reg.id,
      connectorId: 'a-to-b',
      kind: 'event',
    });
    expect(expectError(envelope)).toContain('Flow failed schema validation');
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
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
      { id: 'a-to-b', source: 'a', target: 'b', kind: 'default' },
      { id: 'b-to-a', source: 'b', target: 'a', kind: 'default' },
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
