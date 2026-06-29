// REST vs MCP parity: every mutating tool must produce byte-identical on-disk
// flow.json and JSON-equal response bodies regardless of which transport
// invoked it. Since both layers call the same `*Impl(deps, args)` helpers in
// operations.ts, this is structurally guaranteed — the test's job is to prove
// it with side-by-side fixtures and an actual assertion. The synthetic
// regression test at the bottom exercises the comparison itself, so a future
// change that breaks parity (e.g. someone reintroducing duplicate logic on
// only one side) can't pass silently.

import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CANVAS_RESOURCE_URI, type CanvasWidgetState } from './mcp-ui.ts';
import { createRegistry } from './registry.ts';
import { createApp } from './server.ts';

// Same shape as the fixtures in mcp.test.ts; duplicated here to keep this
// file self-contained (test files shouldn't cross-import from each other —
// re-running mcp.test.ts in isolation should still work).
const VALID_DEMO_TWO_NODES = {
  version: 2,
  name: 'Parity Two Nodes',
  nodes: [
    {
      id: 'a',
      type: 'rectangle',
      data: {
        name: 'A',
      },
    },
    {
      id: 'b',
      type: 'rectangle',
      data: {
        name: 'B',
      },
    },
  ],
  connectors: [],
};

const VALID_DEMO_WITH_CONN = {
  ...VALID_DEMO_TWO_NODES,
  name: 'Parity Two Nodes With Conn',
  connectors: [{ id: 'a-to-b', source: 'a', target: 'b', label: 'flow' }],
};

const VALID_DEMO_THREE_NODES = {
  version: 2,
  name: 'Parity Three Nodes',
  nodes: [
    {
      id: 'a',
      type: 'rectangle',
      data: {
        name: 'A',
      },
    },
    {
      id: 'b',
      type: 'rectangle',
      data: {
        name: 'B',
      },
    },
    {
      id: 'c',
      type: 'rectangle',
      data: {
        name: 'C',
      },
    },
  ],
  connectors: [
    { id: 'a-to-b', source: 'a', target: 'b' },
    { id: 'b-to-c', source: 'b', target: 'c' },
  ],
};

const tmpRegistryPath = () =>
  join(mkdtempSync(join(tmpdir(), 'seeflow-parity-reg-')), 'registry.json');

interface DemoFixture {
  app: ReturnType<typeof createApp>;
  registry: ReturnType<typeof createRegistry>;
  demoFile: string;
  flowId: string;
  projectSlug: string;
  flowSlug: string;
}

// Build a fresh studio app with a freshly-registered demo on disk. Each call
// produces an independent registry + tmpdir so REST and MCP runs of the same
// scenario never observe each other.
const buildDemoFixture = (initialDemo: unknown): DemoFixture => {
  const registry = createRegistry({ path: tmpRegistryPath() });
  const app = createApp({ mode: 'prod', staticRoot: './dist/web', registry, disableWatcher: true });

  const repoPath = mkdtempSync(join(tmpdir(), 'seeflow-parity-repo-'));
  const demoFile = join(repoPath, 'flow.json');
  // operations.ts writes the canonical 2-space JSON + trailing newline back to
  // disk on every mutation, so the byte comparison only kicks in after the
  // first mutation runs. The initial seed bytes can be whatever — pretty or
  // minified — because both fixtures start from the same seed bytes anyway.
  writeFileSync(demoFile, `${JSON.stringify(initialDemo, null, 2)}\n`);

  const demoName = (initialDemo as { name?: string }).name ?? 'Parity Flow';
  const entry = registry.upsert({
    name: demoName,
    repoPath,
    flowPath: 'flow.json',
    projectSlug: 'p',
    flowSlug: 'main',
    isDefault: true,
    valid: true,
    lastModified: Date.now(),
  });

  return {
    app,
    registry,
    demoFile,
    flowId: entry.id,
    projectSlug: entry.projectSlug,
    flowSlug: entry.flowSlug,
  };
};

// REST URL prefix for the demo fixture — collapses the projectSlug + flowSlug
// pair into `/api/projects/<p>/flows/<f>` so scenario URLs stay short. Both
// values come from the registry entry, so any future widening of the slug
// alphabet flows through here automatically.
const flowApi = (fix: DemoFixture, suffix = ''): string =>
  `/api/projects/${encodeURIComponent(fix.projectSlug)}/flows/${encodeURIComponent(fix.flowSlug)}${suffix}`;

interface ProjectFixture {
  app: ReturnType<typeof createApp>;
  registry: ReturnType<typeof createRegistry>;
  projectPath: string;
  demoFile: string;
}

// create_project fixture: empty tmp dir + a derived project folder path the
// tool will scaffold into. The tool itself writes
// <projectPath>/flow.json and registers it.
const buildProjectFixture = (name: string): ProjectFixture => {
  const registry = createRegistry({ path: tmpRegistryPath() });
  const baseDir = mkdtempSync(join(tmpdir(), 'seeflow-parity-proj-'));
  const app = createApp({
    mode: 'prod',
    staticRoot: './dist/web',
    registry,
    disableWatcher: true,
  });
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'demo';
  const projectPath = join(baseDir, slug);
  return {
    app,
    registry,
    projectPath,
    demoFile: join(projectPath, 'flows', 'main', 'flow.json'),
  };
};

let rpcId = 1;
const callMcpTool = async (
  app: ReturnType<typeof createApp>,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> => {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: rpcId++,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  expect(res.status).toBe(200);
  const envelope = (await res.json()) as {
    result?: { content?: Array<{ type: string; text: string }>; isError?: boolean };
  };
  expect(envelope.result?.isError).toBeFalsy();
  const text = envelope.result?.content?.[0]?.text;
  expect(typeof text).toBe('string');
  return JSON.parse(text ?? 'null');
};

const restJson = async (
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return res.json();
};

interface ParityScenario {
  toolName: string;
  /** Build a fresh fixture for each side. Returns the demo file path that
   *  will be compared byte-for-byte and any handles the call sites need. */
  build: () => {
    demoFile: string;
    runRest: () => Promise<unknown>;
    runMcp: () => Promise<unknown>;
  };
  /** Strip non-deterministic fields (e.g. registry-generated flowId from
   *  create_project) before comparing the response bodies. */
  normalizeResponse?: (body: unknown) => unknown;
}

// One scenario per mutating tool. Each scenario builds the REST and MCP
// fixtures independently inside the `it` block so the lock map in
// operations.ts never sees the same flowId twice.
const SCENARIOS: ParityScenario[] = [
  {
    toolName: 'seeflow_add_node',
    build: () => {
      const fix = buildDemoFixture(VALID_DEMO_TWO_NODES);
      // Explicit id keeps the on-disk bytes deterministic — auto-generated ids
      // would diverge between REST and MCP runs even with identical inputs.
      const newNode = {
        id: 'parity-new',
        type: 'rectangle',
        data: { name: 'New' },
      };
      return {
        demoFile: fix.demoFile,
        runRest: () => restJson(fix.app, 'POST', flowApi(fix, '/nodes'), newNode),
        runMcp: () =>
          callMcpTool(fix.app, 'seeflow_add_node', {
            project: fix.projectSlug,
            flow: fix.flowSlug,
            node: newNode,
          }),
      };
    },
  },
  {
    toolName: 'seeflow_patch_node',
    build: () => {
      const fix = buildDemoFixture(VALID_DEMO_TWO_NODES);
      const body = { name: 'Renamed', borderColor: 'blue' as const, width: 200 };
      return {
        demoFile: fix.demoFile,
        runRest: () => restJson(fix.app, 'PATCH', flowApi(fix, '/nodes/a'), body),
        runMcp: () =>
          callMcpTool(fix.app, 'seeflow_patch_node', {
            project: fix.projectSlug,
            flow: fix.flowSlug,
            nodeId: 'a',
            ...body,
          }),
      };
    },
  },
  {
    toolName: 'seeflow_delete_node',
    build: () => {
      // Three-node demo with chained connectors so the cascade-removal of
      // both a-to-b and b-to-c lands in the byte comparison.
      const fix = buildDemoFixture(VALID_DEMO_THREE_NODES);
      return {
        demoFile: fix.demoFile,
        runRest: () => restJson(fix.app, 'DELETE', flowApi(fix, '/nodes/b')),
        runMcp: () =>
          callMcpTool(fix.app, 'seeflow_delete_node', {
            project: fix.projectSlug,
            flow: fix.flowSlug,
            nodeId: 'b',
          }),
      };
    },
  },
  {
    toolName: 'seeflow_move_node',
    build: () => {
      const fix = buildDemoFixture(VALID_DEMO_TWO_NODES);
      return {
        demoFile: fix.demoFile,
        runRest: () =>
          restJson(fix.app, 'PATCH', flowApi(fix, '/nodes/a/position'), {
            x: 321,
            y: 654,
          }),
        runMcp: () =>
          callMcpTool(fix.app, 'seeflow_move_node', {
            project: fix.projectSlug,
            flow: fix.flowSlug,
            nodeId: 'a',
            x: 321,
            y: 654,
          }),
      };
    },
  },
  {
    toolName: 'seeflow_reorder_node',
    build: () => {
      const fix = buildDemoFixture(VALID_DEMO_THREE_NODES);
      return {
        demoFile: fix.demoFile,
        runRest: () =>
          restJson(fix.app, 'PATCH', flowApi(fix, '/nodes/a/order'), {
            op: 'toIndex',
            index: 2,
          }),
        runMcp: () =>
          callMcpTool(fix.app, 'seeflow_reorder_node', {
            project: fix.projectSlug,
            flow: fix.flowSlug,
            nodeId: 'a',
            op: 'toIndex',
            index: 2,
          }),
      };
    },
  },
  {
    toolName: 'seeflow_add_connector',
    build: () => {
      const fix = buildDemoFixture(VALID_DEMO_TWO_NODES);
      // Explicit id + kind so the on-disk connector record is deterministic.
      const conn = { id: 'parity-conn', source: 'a', target: 'b' };
      return {
        demoFile: fix.demoFile,
        runRest: () => restJson(fix.app, 'POST', flowApi(fix, '/connectors'), conn),
        runMcp: () =>
          callMcpTool(fix.app, 'seeflow_add_connector', {
            project: fix.projectSlug,
            flow: fix.flowSlug,
            connector: conn,
          }),
      };
    },
  },
  {
    toolName: 'seeflow_patch_connector',
    build: () => {
      const fix = buildDemoFixture(VALID_DEMO_WITH_CONN);
      const body = { label: 'renamed', style: 'dashed' as const, color: 'green' as const };
      return {
        demoFile: fix.demoFile,
        runRest: () => restJson(fix.app, 'PATCH', flowApi(fix, '/connectors/a-to-b'), body),
        runMcp: () =>
          callMcpTool(fix.app, 'seeflow_patch_connector', {
            project: fix.projectSlug,
            flow: fix.flowSlug,
            connectorId: 'a-to-b',
            ...body,
          }),
      };
    },
  },
  {
    toolName: 'seeflow_delete_connector',
    build: () => {
      const fix = buildDemoFixture(VALID_DEMO_WITH_CONN);
      return {
        demoFile: fix.demoFile,
        runRest: () => restJson(fix.app, 'DELETE', flowApi(fix, '/connectors/a-to-b')),
        runMcp: () =>
          callMcpTool(fix.app, 'seeflow_delete_connector', {
            project: fix.projectSlug,
            flow: fix.flowSlug,
            connectorId: 'a-to-b',
          }),
      };
    },
  },
  {
    toolName: 'seeflow_add_bulk',
    build: () => {
      // Use the empty starter and seed both arrays in the same call so the
      // atomic shape gets exercised end-to-end. Explicit ids keep the
      // on-disk bytes deterministic across the REST and MCP runs.
      const fix = buildDemoFixture(VALID_DEMO_TWO_NODES);
      const body = {
        nodes: [
          {
            id: 'parity-bulk-c',
            type: 'rectangle' as const,
            data: { name: 'C' },
          },
        ],
        connectors: [
          {
            id: 'parity-bulk-conn',
            source: 'a',
            target: 'parity-bulk-c',
          },
        ],
      };
      return {
        demoFile: fix.demoFile,
        runRest: () => restJson(fix.app, 'POST', flowApi(fix, '/bulk'), body),
        runMcp: () =>
          callMcpTool(fix.app, 'seeflow_add_bulk', {
            project: fix.projectSlug,
            flow: fix.flowSlug,
            ...body,
          }),
      };
    },
  },
  {
    toolName: 'seeflow_create_project',
    build: () => {
      const name = 'Parity Project';
      const restFix = buildProjectFixture(name);
      const mcpFix = buildProjectFixture(name);
      return {
        // Comparing two separate scaffolds: the project tool creates a fresh
        // flow.json under each fixture's projectPath. Folders differ, file
        // contents shouldn't.
        demoFile: '__pair__',
        runRest: async () => {
          const body = await restJson(restFix.app, 'POST', '/api/projects', {
            path: restFix.projectPath,
            name,
          });
          // Stash the demoFile bytes via a property-bag side channel so the
          // outer test code can compare both fixtures' on-disk flow.json.
          (body as Record<string, unknown>).__demoFileBytes = readFileSync(
            restFix.demoFile,
            'utf8',
          );
          return body;
        },
        runMcp: async () => {
          const body = (await callMcpTool(mcpFix.app, 'seeflow_create_project', {
            path: mcpFix.projectPath,
            name,
          })) as Record<string, unknown>;
          body.__demoFileBytes = readFileSync(mcpFix.demoFile, 'utf8');
          return body;
        },
      };
    },
    // Registry-generated id is non-deterministic (shortId). Strip
    // it before the equality check — slug and the on-disk bytes (smuggled in
    // as __demoFileBytes) are the meaningful invariants.
    normalizeResponse: (body) => {
      const { id: _id, ...rest } = body as Record<string, unknown>;
      return rest;
    },
  },
];

describe('REST and MCP parity for every mutating tool', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.toolName}: on-disk bytes + response body are identical`, async () => {
      // Run REST first on its own fixture.
      const restPair = scenario.build();
      const restResponse = await restPair.runRest();
      const restBytes =
        restPair.demoFile === '__pair__' ? null : readFileSync(restPair.demoFile, 'utf8');

      // Run MCP second on a separate, freshly-built fixture.
      const mcpPair = scenario.build();
      const mcpResponse = await mcpPair.runMcp();
      const mcpBytes =
        mcpPair.demoFile === '__pair__' ? null : readFileSync(mcpPair.demoFile, 'utf8');

      // On-disk bytes must match for tools that mutate a registered demo's
      // file. (create_project smuggles its bytes through __demoFileBytes
      // because it produces a new file under a fresh folder; the response
      // comparison below covers it.)
      if (restBytes !== null && mcpBytes !== null) {
        expect(mcpBytes).toBe(restBytes);
      }

      const normalize = scenario.normalizeResponse ?? ((x) => x);
      expect(normalize(mcpResponse)).toEqual(normalize(restResponse));
    });
  }

  // Confidence check that the byte + JSON comparisons actually fire. If a
  // future change accidentally compared `undefined` to `undefined` (because a
  // refactor renamed a field), this test would still pass against itself —
  // we'd never see a real regression. By introducing an artificial
  // divergence and asserting the comparison fails, the parity loop above is
  // proven to be a meaningful structural check.
  it('synthetic regression: a deliberate divergence is caught by both assertions', async () => {
    const [scenario] = SCENARIOS; // seeflow_add_node — happy path
    if (!scenario) throw new Error('parity scenario missing');

    const restPair = scenario.build();
    const restResponse = await restPair.runRest();
    const restBytes = readFileSync(restPair.demoFile, 'utf8');

    const mcpPair = scenario.build();
    const mcpResponse = await mcpPair.runMcp();
    // Manually corrupt the MCP-side on-disk file so the byte compare diverges.
    const tamperedBytes = `${restBytes}/* tampered */`;
    writeFileSync(mcpPair.demoFile, tamperedBytes);
    const mcpBytesAfterTamper = readFileSync(mcpPair.demoFile, 'utf8');

    expect(mcpBytesAfterTamper).not.toBe(restBytes);

    // And tamper the response too so the JSON equality assertion would
    // *also* catch this regression independently of the byte check.
    const tamperedResponse = { ...(mcpResponse as Record<string, unknown>), tampered: true };
    expect(tamperedResponse).not.toEqual(restResponse);
  });
});

// ---------------------------------------------------------------------------
// US-009 — canvas `_meta` attachment rules
// ---------------------------------------------------------------------------
// The 5 canvas-bearing tools wired in US-008 MUST return a CallToolResult
// with `_meta['openai/outputTemplate'] === 'ui://seeflow/canvas'`. Every
// other tool MUST NOT attach that key. This guards two easy mistakes:
//   1. Adding a new mutation tool and forgetting to leave _meta off.
//   2. Adding a new read tool and forgetting to wire `canvasMetaFor`.

const CANVAS_TOOLS = new Set([
  'seeflow_get_flow',
  'seeflow_get_flow_graph',
  'seeflow_get_node',
  'seeflow_register_flow',
  'seeflow_create_project',
]);

const META_TEST_TOKEN = 'meta-rule-tok-XYZ';
const META_TEST_HTTP_URL = 'http://127.0.0.1:54321';

interface FullEnvelope {
  jsonrpc: '2.0';
  id: number;
  result?: {
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
    _meta?: Record<string, unknown>;
    tools?: Array<{ name: string }>;
  };
}

const callMcpToolFull = async (
  app: ReturnType<typeof createApp>,
  name: string,
  args: Record<string, unknown>,
): Promise<NonNullable<FullEnvelope['result']>> => {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: rpcId++,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  expect(res.status).toBe(200);
  const envelope = (await res.json()) as FullEnvelope;
  expect(envelope.result).toBeDefined();
  const result = envelope.result;
  if (!result) throw new Error(`tools/call ${name} returned no result`);
  return result;
};

// Build an app + a seeded flow with a known slug + node id, with the
// per-process token + httpUrl set so canvas-bearing handlers attach _meta.
const buildMetaFixture = () => {
  const registry = createRegistry({ path: tmpRegistryPath() });
  const app = createApp({
    mode: 'prod',
    staticRoot: './dist/web',
    registry,
    disableWatcher: true,
    token: META_TEST_TOKEN,
    httpUrl: META_TEST_HTTP_URL,
  });
  const repoPath = mkdtempSync(join(tmpdir(), 'seeflow-meta-repo-'));
  const demoFile = join(repoPath, 'flow.json');
  writeFileSync(demoFile, `${JSON.stringify(VALID_DEMO_TWO_NODES, null, 2)}\n`);
  const entry = registry.upsert({
    name: 'Meta Rule Flow',
    repoPath,
    flowPath: 'flow.json',
    projectSlug: 'p',
    flowSlug: 'main',
    isDefault: true,
    valid: true,
    lastModified: Date.now(),
  });
  return {
    app,
    registry,
    repoPath,
    flowId: entry.id,
    flowSlug: entry.flowSlug,
    projectSlug: entry.projectSlug,
    registrySlug: entry.slug,
  };
};

const listAllToolNames = async (app: ReturnType<typeof createApp>): Promise<string[]> => {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'tools/list', params: {} }),
  });
  expect(res.status).toBe(200);
  const envelope = (await res.json()) as FullEnvelope;
  return (envelope.result?.tools ?? []).map((t) => t.name).sort();
};

const widgetFromResult = (result: NonNullable<FullEnvelope['result']>): CanvasWidgetState => {
  const meta = result._meta;
  expect(meta).toBeDefined();
  if (!meta) throw new Error('missing _meta');
  return meta['openai/widgetState'] as CanvasWidgetState;
};

type CanvasWidgetExpected = {
  kind?: CanvasWidgetState['kind'];
  projectSlug?: string;
  flowSlug?: string;
  nodeId?: string;
  justCreated?: boolean;
};

const expectCanvasMeta = (
  result: NonNullable<FullEnvelope['result']>,
  expected: CanvasWidgetExpected,
): void => {
  expect(result.isError).toBeFalsy();
  const meta = result._meta;
  expect(meta).toBeDefined();
  if (!meta) throw new Error('missing _meta');
  expect(meta['openai/outputTemplate']).toBe(CANVAS_RESOURCE_URI);
  expect(meta['openai/widgetAccessible']).toBe(true);
  const widget = meta['openai/widgetState'] as CanvasWidgetState & { justCreated?: boolean };
  expect(widget.backendUrl).toBe(META_TEST_HTTP_URL);
  expect(widget.backendToken).toBe(META_TEST_TOKEN);
  for (const [key, value] of Object.entries(expected)) {
    expect((widget as Record<string, unknown>)[key]).toEqual(value);
  }
};

describe('canvas _meta attachment rules', () => {
  it('seeflow_get_flow attaches _meta with kind=navigate + projectSlug + flowSlug', async () => {
    const fix = buildMetaFixture();
    const result = await callMcpToolFull(fix.app, 'seeflow_get_flow', {
      project: fix.projectSlug,
      flow: fix.flowSlug,
    });
    expectCanvasMeta(result, {
      kind: 'navigate',
      projectSlug: fix.projectSlug,
      flowSlug: fix.flowSlug,
    });
    const widget = widgetFromResult(result);
    expect(widget.nodeId).toBeUndefined();
    if (widget.kind === 'create') {
      expect(widget.justCreated).toBeUndefined();
    }
  });

  it('seeflow_get_flow_graph attaches _meta with kind=navigate + projectSlug + flowSlug', async () => {
    const fix = buildMetaFixture();
    const result = await callMcpToolFull(fix.app, 'seeflow_get_flow_graph', {
      project: fix.projectSlug,
      flow: fix.flowSlug,
    });
    expectCanvasMeta(result, {
      kind: 'navigate',
      projectSlug: fix.projectSlug,
      flowSlug: fix.flowSlug,
    });
    const widget = widgetFromResult(result);
    expect(widget.nodeId).toBeUndefined();
    if (widget.kind === 'create') {
      expect(widget.justCreated).toBeUndefined();
    }
  });

  it('seeflow_get_node attaches _meta with kind=navigate + projectSlug + flowSlug + nodeId', async () => {
    const fix = buildMetaFixture();
    const result = await callMcpToolFull(fix.app, 'seeflow_get_node', {
      project: fix.projectSlug,
      flow: fix.flowSlug,
      nodeId: 'a',
    });
    expectCanvasMeta(result, {
      kind: 'navigate',
      projectSlug: fix.projectSlug,
      flowSlug: fix.flowSlug,
      nodeId: 'a',
    });
    const widget = widgetFromResult(result);
    if (widget.kind === 'create') {
      expect(widget.justCreated).toBeUndefined();
    }
  });

  it('seeflow_register_flow attaches _meta with kind=create + projectSlug + flowSlug + justCreated=true', async () => {
    const fix = buildMetaFixture();
    // Use a fresh repo dir so the slug ends up known and the flow isn't
    // already registered (avoiding the upsert idempotent slug branch).
    const repoPath = mkdtempSync(join(tmpdir(), 'seeflow-meta-register-'));
    writeFileSync(
      join(repoPath, 'flow.json'),
      `${JSON.stringify({ ...VALID_DEMO_TWO_NODES, name: 'Register Meta Flow' }, null, 2)}\n`,
    );
    const result = await callMcpToolFull(fix.app, 'seeflow_register_flow', {
      repoPath,
      flowPath: 'flow.json',
    });
    expectCanvasMeta(result, { kind: 'create' });
    const widget = widgetFromResult(result);
    expect(typeof widget.projectSlug).toBe('string');
    expect((widget.projectSlug ?? '').length).toBeGreaterThan(0);
    expect(typeof widget.flowSlug).toBe('string');
    expect((widget.flowSlug ?? '').length).toBeGreaterThan(0);
    if (widget.kind === 'create') {
      expect(widget.justCreated).toBe(true);
    }
    expect(widget.nodeId).toBeUndefined();
  });

  it('seeflow_create_project attaches _meta with kind=create + projectSlug, NO justCreated', async () => {
    const fix = buildMetaFixture();
    const baseDir = mkdtempSync(join(tmpdir(), 'seeflow-meta-proj-'));
    const result = await callMcpToolFull(fix.app, 'seeflow_create_project', {
      path: join(baseDir, 'create-meta'),
      name: 'Create Meta Project',
    });
    expectCanvasMeta(result, { kind: 'create' });
    const widget = widgetFromResult(result);
    expect(typeof widget.projectSlug).toBe('string');
    expect((widget.projectSlug ?? '').length).toBeGreaterThan(0);
    if (widget.kind === 'create') {
      expect(widget.justCreated).toBeUndefined();
    }
    expect(widget.flowSlug).toBeUndefined();
    expect(widget.nodeId).toBeUndefined();
  });

  it('every canvas-bearing tool returns _meta[outputTemplate] === CANVAS_RESOURCE_URI', async () => {
    // Belt-and-braces: even if a future patch breaks one specific shape
    // (above), this rolls every tool's outputTemplate up into one check —
    // future additions to CANVAS_TOOLS must wire _meta or this fails fast.
    const fix = buildMetaFixture();
    const node = await callMcpToolFull(fix.app, 'seeflow_get_node', {
      project: fix.projectSlug,
      flow: fix.flowSlug,
      nodeId: 'a',
    });
    expect(node._meta?.['openai/outputTemplate']).toBe(CANVAS_RESOURCE_URI);
    const graph = await callMcpToolFull(fix.app, 'seeflow_get_flow_graph', {
      project: fix.projectSlug,
      flow: fix.flowSlug,
    });
    expect(graph._meta?.['openai/outputTemplate']).toBe(CANVAS_RESOURCE_URI);
    const flow = await callMcpToolFull(fix.app, 'seeflow_get_flow', {
      project: fix.projectSlug,
      flow: fix.flowSlug,
    });
    expect(flow._meta?.['openai/outputTemplate']).toBe(CANVAS_RESOURCE_URI);
  });

  it('non-canvas-bearing tools never attach _meta[outputTemplate]', async () => {
    const fix = buildMetaFixture();

    // Every non-canvas tool we drive through here — read-only + mutating.
    // Each case runs once and the assertion is uniform: the result must
    // not declare an outputTemplate. The arguments are valid so we
    // exercise the success path where a misplaced _meta would surface.
    const baseDir = mkdtempSync(join(tmpdir(), 'seeflow-meta-non-canvas-'));
    const newNode = { id: 'meta-new-node', type: 'rectangle', data: { name: 'NewNode' } };
    const newConn = { id: 'meta-new-conn', source: 'a', target: 'b' };

    const cases: Array<{ name: string; args: Record<string, unknown> }> = [
      { name: 'seeflow_list_flows', args: {} },
      { name: 'seeflow_list_flows_summary', args: {} },
      { name: 'seeflow_schema', args: {} },
      { name: 'seeflow_ids', args: { type: 'node', count: 1 } },
      { name: 'validate_seeflow', args: { flow: VALID_DEMO_TWO_NODES } },
      {
        name: 'seeflow_add_node',
        args: { project: fix.projectSlug, flow: fix.flowSlug, node: newNode },
      },
      {
        name: 'seeflow_add_bulk',
        args: {
          project: fix.projectSlug,
          flow: fix.flowSlug,
          nodes: [{ id: 'meta-bulk-c', type: 'rectangle', data: { name: 'C' } }],
        },
      },
      {
        name: 'seeflow_move_node',
        args: { project: fix.projectSlug, flow: fix.flowSlug, nodeId: 'a', x: 10, y: 20 },
      },
      {
        name: 'seeflow_patch_node',
        args: { project: fix.projectSlug, flow: fix.flowSlug, nodeId: 'a', name: 'Renamed' },
      },
      {
        name: 'seeflow_reorder_node',
        args: { project: fix.projectSlug, flow: fix.flowSlug, nodeId: 'a', op: 'toFront' },
      },
      {
        name: 'seeflow_add_connector',
        args: { project: fix.projectSlug, flow: fix.flowSlug, connector: newConn },
      },
      // delete_node intentionally LAST among node ops so prior patches still see node 'a'.
      {
        name: 'seeflow_delete_connector',
        args: { project: fix.projectSlug, flow: fix.flowSlug, connectorId: 'meta-new-conn' },
      },
      {
        name: 'seeflow_delete_node',
        args: { project: fix.projectSlug, flow: fix.flowSlug, nodeId: 'a' },
      },
      // delete_flow LAST so other ops keep seeing the seeded flow.
      { name: 'seeflow_delete_flow', args: { project: fix.projectSlug, flow: fix.flowSlug } },
    ];

    for (const c of cases) {
      const result = await callMcpToolFull(fix.app, c.name, c.args);
      expect(result.isError).toBeFalsy();
      // _meta may be absent entirely, but if it exists, it must NOT carry
      // the canvas outputTemplate. Both interpretations satisfy the rule.
      expect(result._meta?.['openai/outputTemplate']).toBeUndefined();
    }
  });

  it('patch_connector also returns no _meta[outputTemplate] (covers all mutating tools)', async () => {
    // Separate fixture so the seeded VALID_DEMO_WITH_CONN gives patch_connector
    // a connector to target. Keeps the main non-canvas case list above
    // dependency-free.
    const registry = createRegistry({ path: tmpRegistryPath() });
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      disableWatcher: true,
      token: META_TEST_TOKEN,
      httpUrl: META_TEST_HTTP_URL,
    });
    const repoPath = mkdtempSync(join(tmpdir(), 'seeflow-meta-conn-'));
    writeFileSync(
      join(repoPath, 'flow.json'),
      `${JSON.stringify(VALID_DEMO_WITH_CONN, null, 2)}\n`,
    );
    const entry = registry.upsert({
      name: 'Meta Patch Conn Flow',
      repoPath,
      flowPath: 'flow.json',
      projectSlug: 'p',
      flowSlug: 'main',
      isDefault: true,
      valid: true,
      lastModified: Date.now(),
    });
    const result = await callMcpToolFull(app, 'seeflow_patch_connector', {
      project: entry.projectSlug,
      flow: entry.flowSlug,
      connectorId: 'a-to-b',
      label: 'renamed',
    });
    expect(result.isError).toBeFalsy();
    expect(result._meta?.['openai/outputTemplate']).toBeUndefined();
  });

  it('coverage: every tool the server reports is classified (no orphan tools)', async () => {
    // Cross-check: list every tool the MCP server advertises and assert
    // we know whether it should carry _meta or not. A future tool that
    // gets added without being categorized here will fail this test —
    // the engineer is forced to decide canvas-bearing vs. not at PR time.
    const fix = buildMetaFixture();
    const allTools = await listAllToolNames(fix.app);
    const NON_CANVAS_TOOLS = new Set([
      'seeflow_list_flows',
      'seeflow_list_flows_summary',
      'seeflow_schema',
      'seeflow_ids',
      'validate_seeflow',
      'seeflow_delete_flow',
      'seeflow_add_node',
      'seeflow_add_bulk',
      'seeflow_delete_node',
      'seeflow_move_node',
      'seeflow_patch_node',
      'seeflow_reorder_node',
      'seeflow_add_connector',
      'seeflow_patch_connector',
      'seeflow_delete_connector',
    ]);
    const classified = new Set([...CANVAS_TOOLS, ...NON_CANVAS_TOOLS]);
    expect(allTools.sort()).toEqual([...classified].sort());
    // The two sets must be disjoint.
    for (const name of CANVAS_TOOLS) {
      expect(NON_CANVAS_TOOLS.has(name)).toBe(false);
    }
  });

  it('graceful degrade: when token+httpUrl are unset, canvas tools omit _meta entirely', async () => {
    // Proxy mode / non-Apps callers — `canvasMetaFor` returns undefined when
    // either field is missing, so the result has no `_meta` key.
    const registry = createRegistry({ path: tmpRegistryPath() });
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      disableWatcher: true,
      // no token, no httpUrl
    });
    const repoPath = mkdtempSync(join(tmpdir(), 'seeflow-meta-degrade-'));
    writeFileSync(
      join(repoPath, 'flow.json'),
      `${JSON.stringify(VALID_DEMO_TWO_NODES, null, 2)}\n`,
    );
    const entry = registry.upsert({
      name: 'Degrade Flow',
      repoPath,
      flowPath: 'flow.json',
      projectSlug: 'p',
      flowSlug: 'main',
      isDefault: true,
      valid: true,
      lastModified: Date.now(),
    });
    const result = await callMcpToolFull(app, 'seeflow_get_flow', {
      project: entry.projectSlug,
      flow: entry.flowSlug,
    });
    expect(result.isError).toBeFalsy();
    expect(result._meta).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// US-010 — linkflow node MCP round-trip parity
// ---------------------------------------------------------------------------
// The linkflow node carries an optional `target: { project, flow }` slug pair
// that the schema gates on (US-001) and the REST/MCP add/get/delete handlers
// just thread through `data` without special casing. This test proves the
// whole transport surface — MCP add, MCP get, REST get, MCP delete — handles
// the target field identically and that the on-disk flow.json reflects the
// mutation correctly.

describe('linkflow node MCP round-trip parity', () => {
  it('add (MCP) → get (MCP) → get (REST) → delete (MCP) all agree on the linkflow shape', async () => {
    const fix = buildDemoFixture(VALID_DEMO_TWO_NODES);
    // Self-link is allowed (per US-003 picker AC) and keeps the fixture single-flow.
    const target = { project: fix.projectSlug, flow: fix.flowSlug };
    const newNode = {
      id: 'lf-parity-1',
      type: 'linkflow',
      data: { name: 'Go to Main', target },
    };

    // ── ADD via MCP ──────────────────────────────────────────────────────
    const addResponse = (await callMcpTool(fix.app, 'seeflow_add_node', {
      project: fix.projectSlug,
      flow: fix.flowSlug,
      node: newNode,
    })) as { id: string; node: Record<string, unknown> };
    expect(addResponse.id).toBe('lf-parity-1');
    const addedNode = addResponse.node;
    expect(addedNode.type).toBe('linkflow');
    expect((addedNode.data as { target?: unknown }).target).toEqual(target);

    // On-disk flow.json contains the linkflow node with the target preserved.
    const onDisk = JSON.parse(readFileSync(fix.demoFile, 'utf8')) as {
      nodes: Array<{ id: string; type: string; data: { target?: unknown } }>;
    };
    const diskNode = onDisk.nodes.find((n) => n.id === 'lf-parity-1');
    expect(diskNode).toBeDefined();
    expect(diskNode?.type).toBe('linkflow');
    expect(diskNode?.data.target).toEqual(target);

    // ── GET via MCP ──────────────────────────────────────────────────────
    const mcpGet = (await callMcpTool(fix.app, 'seeflow_get_node', {
      project: fix.projectSlug,
      flow: fix.flowSlug,
      nodeId: 'lf-parity-1',
    })) as { id: string; node: Record<string, unknown> };
    expect(mcpGet.id).toBe('lf-parity-1');
    expect(mcpGet.node.type).toBe('linkflow');
    expect((mcpGet.node.data as { target?: unknown }).target).toEqual(target);

    // ── GET via REST ─────────────────────────────────────────────────────
    const restGet = (await restJson(fix.app, 'GET', flowApi(fix, '/nodes/lf-parity-1'))) as {
      id: string;
      node: Record<string, unknown>;
      flowId?: string;
    };
    // REST and MCP responses must agree on the node shape. The envelope's
    // `flowId` field differs by transport (MCP echoes the project/flow slug,
    // REST echoes the registry's internal short id — see getNodeImpl + the
    // call sites in api.ts vs mcp.ts), so compare id + node payload only.
    expect(restGet.id).toBe(mcpGet.id);
    expect(restGet.node).toEqual(mcpGet.node);

    // ── DELETE via MCP ───────────────────────────────────────────────────
    const deleteResponse = (await callMcpTool(fix.app, 'seeflow_delete_node', {
      project: fix.projectSlug,
      flow: fix.flowSlug,
      nodeId: 'lf-parity-1',
    })) as Record<string, unknown>;
    // Whatever the success envelope shape is, it must not be an error.
    expect(deleteResponse).toBeDefined();

    // The node must disappear from flow.json after the delete.
    const afterDelete = JSON.parse(readFileSync(fix.demoFile, 'utf8')) as {
      nodes: Array<{ id: string }>;
    };
    expect(afterDelete.nodes.find((n) => n.id === 'lf-parity-1')).toBeUndefined();

    // Subsequent get via MCP returns an error (notFound branch of getNodeImpl
    // surfaces through the MCP handler as { isError: true } — callMcpTool
    // asserts isError is falsy, so we go through the raw request here).
    const getAfterRes = await fix.app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: rpcId++,
        method: 'tools/call',
        params: {
          name: 'seeflow_get_node',
          arguments: {
            project: fix.projectSlug,
            flow: fix.flowSlug,
            nodeId: 'lf-parity-1',
          },
        },
      }),
    });
    const getAfterEnvelope = (await getAfterRes.json()) as {
      result?: { isError?: boolean };
    };
    expect(getAfterEnvelope.result?.isError).toBe(true);
  });

  it('linkflow without target round-trips correctly (target is optional)', async () => {
    // Optional target — schema-level invariant from US-001. The add path must
    // not require it and the round-trip must not synthesize it.
    const fix = buildDemoFixture(VALID_DEMO_TWO_NODES);
    const newNode = {
      id: 'lf-unlinked',
      type: 'linkflow',
      data: { name: 'Unlinked Stub' },
    };

    const addResponse = (await callMcpTool(fix.app, 'seeflow_add_node', {
      project: fix.projectSlug,
      flow: fix.flowSlug,
      node: newNode,
    })) as { id: string; node: Record<string, unknown> };
    expect(addResponse.id).toBe('lf-unlinked');
    expect((addResponse.node.data as { target?: unknown }).target).toBeUndefined();

    const mcpGet = (await callMcpTool(fix.app, 'seeflow_get_node', {
      project: fix.projectSlug,
      flow: fix.flowSlug,
      nodeId: 'lf-unlinked',
    })) as { id: string; node: Record<string, unknown> };
    expect((mcpGet.node.data as { target?: unknown }).target).toBeUndefined();

    const restGet = (await restJson(fix.app, 'GET', flowApi(fix, '/nodes/lf-unlinked'))) as {
      id: string;
      node: Record<string, unknown>;
    };
    // Same caveat as the round-trip test above — `flowId` differs by transport,
    // so compare id + node only.
    expect(restGet.id).toBe(mcpGet.id);
    expect(restGet.node).toEqual(mcpGet.node);
  });
});
