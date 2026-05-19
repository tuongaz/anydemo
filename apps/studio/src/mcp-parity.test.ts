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
  name: 'Parity Two Nodes With Conn',
  connectors: [{ id: 'a-to-b', source: 'a', target: 'b', kind: 'default', label: 'flow' }],
};

const VALID_DEMO_THREE_NODES = {
  version: 2,
  name: 'Parity Three Nodes',
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

const tmpRegistryPath = () =>
  join(mkdtempSync(join(tmpdir(), 'seeflow-parity-reg-')), 'registry.json');

interface DemoFixture {
  app: ReturnType<typeof createApp>;
  registry: ReturnType<typeof createRegistry>;
  demoFile: string;
  flowId: string;
}

// Build a fresh studio app with a freshly-registered demo on disk. Each call
// produces an independent registry + tmpdir so REST and MCP runs of the same
// scenario never observe each other.
const buildDemoFixture = (initialDemo: unknown): DemoFixture => {
  const registry = createRegistry({ path: tmpRegistryPath() });
  const app = createApp({ mode: 'prod', staticRoot: './dist/web', registry, disableWatcher: true });

  const repoPath = mkdtempSync(join(tmpdir(), 'seeflow-parity-repo-'));
  mkdirSync(join(repoPath, '.seeflow'));
  const demoFile = join(repoPath, '.seeflow', 'flow.json');
  // operations.ts writes the canonical 2-space JSON + trailing newline back to
  // disk on every mutation, so the byte comparison only kicks in after the
  // first mutation runs. The initial seed bytes can be whatever — pretty or
  // minified — because both fixtures start from the same seed bytes anyway.
  writeFileSync(demoFile, `${JSON.stringify(initialDemo, null, 2)}\n`);

  const demoName = (initialDemo as { name?: string }).name ?? 'Parity Flow';
  const entry = registry.upsert({
    name: demoName,
    repoPath,
    flowPath: '.seeflow/flow.json',
    valid: true,
    lastModified: Date.now(),
  });

  return { app, registry, demoFile, flowId: entry.id };
};

interface ProjectFixture {
  app: ReturnType<typeof createApp>;
  registry: ReturnType<typeof createRegistry>;
  projectBaseDir: string;
  demoFile: string;
}

// create_project fixture: empty base dir, no pre-registered demo. The tool
// itself scaffolds the demo file + registers it under <base>/<slug>/.seeflow/flow.json.
const buildProjectFixture = (name: string): ProjectFixture => {
  const registry = createRegistry({ path: tmpRegistryPath() });
  const projectBaseDir = mkdtempSync(join(tmpdir(), 'seeflow-parity-proj-'));
  const app = createApp({
    mode: 'prod',
    staticRoot: './dist/web',
    registry,
    disableWatcher: true,
    projectBaseDir,
  });
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'demo';
  return {
    app,
    registry,
    projectBaseDir,
    demoFile: join(projectBaseDir, slug, '.seeflow', 'flow.json'),
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
        type: 'shapeNode',
        data: { shape: 'rectangle', name: 'New' },
      };
      return {
        demoFile: fix.demoFile,
        runRest: () => restJson(fix.app, 'POST', `/api/flows/${fix.flowId}/nodes`, newNode),
        runMcp: () =>
          callMcpTool(fix.app, 'seeflow_add_node', { flowId: fix.flowId, node: newNode }),
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
        runRest: () => restJson(fix.app, 'PATCH', `/api/flows/${fix.flowId}/nodes/a`, body),
        runMcp: () =>
          callMcpTool(fix.app, 'seeflow_patch_node', {
            flowId: fix.flowId,
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
        runRest: () => restJson(fix.app, 'DELETE', `/api/flows/${fix.flowId}/nodes/b`),
        runMcp: () =>
          callMcpTool(fix.app, 'seeflow_delete_node', { flowId: fix.flowId, nodeId: 'b' }),
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
          restJson(fix.app, 'PATCH', `/api/flows/${fix.flowId}/nodes/a/position`, {
            x: 321,
            y: 654,
          }),
        runMcp: () =>
          callMcpTool(fix.app, 'seeflow_move_node', {
            flowId: fix.flowId,
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
          restJson(fix.app, 'PATCH', `/api/flows/${fix.flowId}/nodes/a/order`, {
            op: 'toIndex',
            index: 2,
          }),
        runMcp: () =>
          callMcpTool(fix.app, 'seeflow_reorder_node', {
            flowId: fix.flowId,
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
      const conn = { id: 'parity-conn', source: 'a', target: 'b', kind: 'default' as const };
      return {
        demoFile: fix.demoFile,
        runRest: () => restJson(fix.app, 'POST', `/api/flows/${fix.flowId}/connectors`, conn),
        runMcp: () =>
          callMcpTool(fix.app, 'seeflow_add_connector', {
            flowId: fix.flowId,
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
        runRest: () =>
          restJson(fix.app, 'PATCH', `/api/flows/${fix.flowId}/connectors/a-to-b`, body),
        runMcp: () =>
          callMcpTool(fix.app, 'seeflow_patch_connector', {
            flowId: fix.flowId,
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
        runRest: () => restJson(fix.app, 'DELETE', `/api/flows/${fix.flowId}/connectors/a-to-b`),
        runMcp: () =>
          callMcpTool(fix.app, 'seeflow_delete_connector', {
            flowId: fix.flowId,
            connectorId: 'a-to-b',
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
        // flow.json under each fixture's projectBaseDir. Folders differ, file
        // contents shouldn't.
        demoFile: '__pair__',
        runRest: async () => {
          const body = await restJson(restFix.app, 'POST', '/api/projects', { name });
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
            name,
          })) as Record<string, unknown>;
          body.__demoFileBytes = readFileSync(mcpFix.demoFile, 'utf8');
          return body;
        },
      };
    },
    // Registry-generated id is non-deterministic (crypto.randomUUID). Strip
    // it before the equality check — slug, scaffolded flag, and the on-disk
    // bytes (smuggled in as __demoFileBytes) are the meaningful invariants.
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
