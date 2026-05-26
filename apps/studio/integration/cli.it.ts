import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slugify } from '../src/registry.ts';
import { runCli } from './support/cli-runner.ts';
import { uniqueFlowId } from './support/ids.ts';
import { type StudioHandle, getFreePort, spawnStudio } from './support/studio-harness.ts';

// One shared studio per file for the HTTP-passthrough subcommands. The CLI
// is pointed at it via SEEFLOW_STUDIO_URL so studioUrlOrDie short-circuits
// out of its daemon-spawn path. SEEFLOW_WORKSPACE also matches so that any
// CLI subcommand that touches the on-disk state directory (config / pid /
// project dirs) sees the same files the studio sees. The `stop` test in
// the bottom describe block spawns its own per-test studio because stopping
// the shared one would torpedo every later test in the file.
let studio: StudioHandle;
let cliEnv: Record<string, string>;

beforeAll(async () => {
  studio = await spawnStudio();
  cliEnv = {
    SEEFLOW_STUDIO_URL: studio.baseURL,
    SEEFLOW_WORKSPACE: studio.home,
  };
});

afterAll(async () => {
  if (studio) await studio.stop();
});

interface OkLine {
  ok: boolean;
  [k: string]: unknown;
}

interface CreateProjectResponse {
  id: string;
  slug: string;
}

function projectPathFor(name: string): string {
  return join(studio.workspace, slugify(name));
}

interface FlowListItem {
  id: string;
  slug: string;
  name: string;
}

// HTTP-passthrough subcommands print a single line `{"ok":true,...}` via
// printOk(). Some commands also log human-friendly lines (register, stop)
// — those are split-line + non-JSON, so callers pick the line they need.
function parseOkLine(stdout: string): OkLine {
  const trimmed = stdout.trim();
  // The last non-empty line is the JSON envelope.
  const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);
  const last = lines[lines.length - 1];
  if (!last) throw new Error(`No output to parse from CLI stdout: ${JSON.stringify(stdout)}`);
  return JSON.parse(last) as OkLine;
}

async function createProject(name: string): Promise<CreateProjectResponse> {
  const res = await fetch(`${studio.baseURL}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: projectPathFor(name), name }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as CreateProjectResponse;
}

// Per-flow HTTP routes moved under /api/projects/:project/flows/:flow/... in
// US-007. `created.slug` is `${projectSlug}/${flowSlug}` so substituting the
// inner `/` for `/flows/` produces the new path with no parsing.
function flowApi(slug: string): string {
  return `${studio.baseURL}/api/projects/${slug.replace('/', '/flows/')}`;
}

// US-020: flow-scoped CLI verbs require --project + --flow instead of a
// positional flowId.
function flowFlags(slug: string): string[] {
  const [projectSlug, flowSlug] = slug.split('/');
  return ['--project', projectSlug as string, '--flow', flowSlug as string];
}

async function seedRectangleNodes(slug: string, ids: string[]): Promise<void> {
  const res = await fetch(`${flowApi(slug)}/bulk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodes: ids.map((id) => ({ id, type: 'rectangle', data: {} })),
    }),
  });
  expect(res.status).toBe(200);
}

describe('integration: CLI — meta (help / version / unknown)', () => {
  it('--help exits 0 and lists every supported subcommand', async () => {
    const r = await runCli(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('seeflow');
    // Spot-check every subcommand dispatched in cli.ts is documented.
    for (const cmd of [
      'start',
      'stop',
      'register',
      'flows:register',
      'projects:create',
      'flows:list',
      'flows:summary',
      'flows:get',
      'flows:graph',
      'flows:delete',
      'flows:layout',
      'flows:play',
      'nodes:add',
      'nodes:get',
      'nodes:patch',
      'nodes:move',
      'nodes:reorder',
      'nodes:delete',
      'connectors:add',
      'connectors:patch',
      'flow:add-bulk',
      'connectors:delete',
      'validate',
      'e2e',
      'version',
      'help',
    ]) {
      expect(r.stdout).toContain(cmd);
    }
  });

  it('help (subcommand form) exits 0 and prints the help banner', async () => {
    const r = await runCli(['help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('seeflow');
    expect(r.stdout).toContain('start');
  });

  it('-h (short form) exits 0 and prints the help banner', async () => {
    const r = await runCli(['-h']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('seeflow');
  });

  it('--version prints a semver-like version line and exits 0', async () => {
    const r = await runCli(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('-v (short form) prints a semver-like version line', async () => {
    const r = await runCli(['-v']);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('version (subcommand form) prints a semver-like version line', async () => {
    const r = await runCli(['version']);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('unknown subcommand exits non-zero with an explanation to stderr', async () => {
    const r = await runCli(['this-subcommand-does-not-exist']);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('Unknown subcommand');
    // Help banner is also dumped so the user sees recovery options.
    expect(r.stdout).toContain('seeflow');
  });
});

describe('integration: CLI — projects + flows', () => {
  it('projects:create creates a new project on disk and prints ok', async () => {
    const name = uniqueFlowId('cli-projects-create');
    const projectPath = projectPathFor(name);
    const r = await runCli(['projects:create', '--path', projectPath, '--name', name], {
      env: cliEnv,
    });
    expect(r.code).toBe(0);
    const body = parseOkLine(r.stdout);
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe('string');
    expect(typeof body.slug).toBe('string');

    // Manifest-driven layout (US-018): scaffolder writes seeflow.json + a
    // flows/main/flow.json folder, never a bare flow.json at the project root.
    expect(existsSync(join(projectPath, 'seeflow.json'))).toBe(true);
    expect(existsSync(join(projectPath, 'flows', 'main', 'flow.json'))).toBe(true);
    expect(existsSync(join(projectPath, 'flow.json'))).toBe(false);
  });

  it('flows:list returns the registry as { ok, flows: [...] }', async () => {
    const name = uniqueFlowId('cli-flows-list');
    const created = await createProject(name);

    const r = await runCli(['flows:list'], { env: cliEnv });
    expect(r.code).toBe(0);
    const body = parseOkLine(r.stdout) as OkLine & { flows: FlowListItem[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.flows)).toBe(true);
    expect(body.flows.find((f) => f.id === created.id)).toBeDefined();
  });

  it('flows:get returns the shape for a registered flow', async () => {
    const name = uniqueFlowId('cli-flows-get');
    const created = await createProject(name);

    const r = await runCli(['flows:get', ...flowFlags(created.slug)], { env: cliEnv });
    expect(r.code).toBe(0);
    const body = parseOkLine(r.stdout);
    expect(body.ok).toBe(true);
    expect(body.id).toBe(created.id);
    expect(body.slug).toBe(created.slug);
    // The manifest-driven scaffolder writes a single flow named "Main" inside
    // the project (US-018). The PROJECT carries the user-supplied name; the
    // FLOW does not. Keep `name` referenced so the lint sweep stays happy.
    void name;
    expect(body.name).toBe('Main');
    expect(body.valid).toBe(true);
  });

  it('flows:summary returns flows with id, name, and optional description', async () => {
    const name = uniqueFlowId('cli-flows-summary');
    const created = await createProject(name);

    const r = await runCli(['flows:summary'], { env: cliEnv });
    expect(r.code).toBe(0);
    const body = parseOkLine(r.stdout) as OkLine & {
      flows: Array<{ id: string; name: string; description?: string }>;
    };
    expect(body.ok).toBe(true);
    const found = body.flows.find((f) => f.id === created.id);
    expect(found).toBeDefined();
    // Manifest-driven scaffolder names the default flow "Main"; the unique
    // project name is reflected at the project level, not the flow level.
    void name;
    expect(found?.name).toBe('Main');
  });

  it('flows:graph returns nodes and connectors without inlined detail', async () => {
    const name = uniqueFlowId('cli-flows-graph');
    const created = await createProject(name);

    const addRes = await fetch(`${flowApi(created.slug)}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'shape-1',
        type: 'rectangle',
        data: { name: 'note', detail: '# hidden' },
      }),
    });
    expect(addRes.status).toBe(200);

    const r = await runCli(['flows:graph', ...flowFlags(created.slug)], { env: cliEnv });
    expect(r.code).toBe(0);
    const body = parseOkLine(r.stdout) as OkLine & {
      nodes: Array<{ id: string; data: Record<string, unknown> }>;
    };
    expect(body.ok).toBe(true);
    const shape = body.nodes.find((n) => n.id === 'shape-1');
    expect(shape?.data.detail).toBeUndefined();
  });

  it('nodes:get returns the node with detail content inlined', async () => {
    const name = uniqueFlowId('cli-nodes-get');
    const created = await createProject(name);

    const addRes = await fetch(`${flowApi(created.slug)}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'shape-1',
        type: 'rectangle',
        data: { name: 'A', detail: '# inlined body' },
      }),
    });
    expect(addRes.status).toBe(200);

    const r = await runCli(['nodes:get', ...flowFlags(created.slug), 'shape-1'], { env: cliEnv });
    expect(r.code).toBe(0);
    const body = parseOkLine(r.stdout) as OkLine & {
      id: string;
      flowId: string;
      node: { data: { detail?: string } };
    };
    expect(body.ok).toBe(true);
    // nodes:get keys responses by slug (US-007); legacy short-id wiring was
    // dropped when flow-scoped routes moved under /api/projects/:project/...
    expect(body.flowId).toBe(created.slug);
    expect(body.node.data.detail).toBe('# inlined body');
  });

  it('flows:delete removes a non-default flow from the registry', async () => {
    const name = uniqueFlowId('cli-flows-delete');
    const created = await createProject(name);
    const [projectSlug] = created.slug.split('/');

    // Default-flow delete now requires --new-default (US-017): the deletion
    // route returns 409 `last-flow` for a one-flow project and
    // `default-flow-no-replacement` for the default flow without a
    // replacement id. Add a second flow then delete it so the test exercises
    // the happy path without touching the default.
    const addRes = await fetch(`${studio.baseURL}/api/projects/${projectSlug}/flows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'extra', name: 'Extra' }),
    });
    expect(addRes.status).toBe(201);

    const r = await runCli(
      ['flows:delete', '--project', projectSlug as string, '--flow', 'extra'],
      { env: cliEnv },
    );
    expect(r.code).toBe(0);
    expect(parseOkLine(r.stdout).ok).toBe(true);

    const list = (await (await fetch(`${studio.baseURL}/api/flows`)).json()) as FlowListItem[];
    expect(list.find((f) => f.slug === `${projectSlug}/extra`)).toBeUndefined();
  });

  it('flows:layout writes a layout to style.json and prints ok', async () => {
    // An empty layout body is the canonical "use defaults" call. The route
    // requires the flow.json on disk to be valid, so a freshly scaffolded
    // empty project (0 nodes / 0 connectors) is enough to exercise the path.
    const name = uniqueFlowId('cli-flows-layout');
    const created = await createProject(name);

    const r = await runCli(
      ['flows:layout', ...flowFlags(created.slug), '--json', JSON.stringify({})],
      { env: cliEnv },
    );
    expect(r.code).toBe(0);
    expect(parseOkLine(r.stdout).ok).toBe(true);
  });

  // `register --path` and `flows:register` exercise the pre-manifest single-
  // flow.json layout. Production createRegistry() now passes
  // manifestOnlyEntryFilter (see registry.ts), so an entry whose flowPath is
  // the legacy root flow.json is dropped on the studio's next registry
  // reload. The CLI subcommand still exists but no longer survives the
  // round-trip — and per the manifest-only commit, the matching unit test
  // was deleted as obsolete. The integration analog is dropped here.

  it('flows:play triggers a rectangle node with playAction and prints { ok, runId, status, body }', async () => {
    // Mirrors rest.it.ts: seed a type:'rectangle' node carrying a playAction
    // capability whose scriptPath resolves under <repoPath>/nodes/<id>/, then
    // drop a tiny script that prints a JSON line and exits 0. CLI's flows:play
    // POSTs to /play and the response is printed via printOk →
    // `{"ok":true, runId, status, body}`. Under the flat schema, playAction is
    // a capability valid on every node type — rectangle is the canonical host.
    const created = await createProject(uniqueFlowId('cli-flows-play'));
    const nodeId = 'cli-play-1';
    const addRes = await fetch(`${flowApi(created.slug)}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: nodeId,
        type: 'rectangle',
        data: {
          name: 'Play',
          stateSource: { kind: 'request' },
          playAction: {
            kind: 'script',
            interpreter: 'bun',
            scriptPath: 'scripts/play.ts',
          },
        },
      }),
    });
    expect(addRes.status).toBe(200);

    // `proxy.resolveScript` resolves `<cwd>/nodes/<nodeId>/<scriptPath>` where
    // `cwd = entry.repoPath` (the project root) — independent of which flow
    // the node belongs to. So the play script lives at `<workspace>/
    // <projectSlug>/nodes/<nodeId>/scripts/play.ts`, NOT inside `flows/...`.
    const [projectSlug] = created.slug.split('/');
    const scriptDir = join(studio.workspace, projectSlug as string, 'nodes', nodeId, 'scripts');
    mkdirSync(scriptDir, { recursive: true });
    writeFileSync(
      join(scriptDir, 'play.ts'),
      'console.log(JSON.stringify({ hello: "cli-play" }));\nprocess.exit(0);\n',
    );

    const r = await runCli(['flows:play', ...flowFlags(created.slug), nodeId], { env: cliEnv });
    expect(r.code).toBe(0);
    const body = parseOkLine(r.stdout) as OkLine & {
      runId: string;
      status: number;
      body: { hello?: string };
    };
    expect(body.ok).toBe(true);
    expect(typeof body.runId).toBe('string');
    expect(body.status).toBe(200);
    expect(body.body).toEqual({ hello: 'cli-play' });
  });
});

describe('integration: CLI — nodes', () => {
  it('nodes:add adds a single node and prints { ok, id, node }', async () => {
    const created = await createProject(uniqueFlowId('cli-nodes-add'));
    const r = await runCli(
      [
        'nodes:add',
        ...flowFlags(created.slug),
        '--json',
        JSON.stringify({ type: 'rectangle', data: {} }),
      ],
      { env: cliEnv },
    );
    expect(r.code).toBe(0);
    const body = parseOkLine(r.stdout);
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe('string');
    expect((body.id as string).startsWith('node-')).toBe(true);
  });

  it('flow:add-bulk adds many nodes + connectors atomically in one call', async () => {
    const created = await createProject(uniqueFlowId('cli-flow-add-bulk'));
    const r = await runCli(
      [
        'flow:add-bulk',
        ...flowFlags(created.slug),
        '--json',
        JSON.stringify({
          nodes: [
            { id: 'a', type: 'rectangle', data: {} },
            { id: 'b', type: 'ellipse', data: {} },
          ],
          connectors: [
            { id: 'c1', source: 'a', target: 'b' },
            { id: 'c2', source: 'b', target: 'a', eventName: 'evt.cli' },
          ],
        }),
      ],
      { env: cliEnv },
    );
    expect(r.code).toBe(0);
    const body = parseOkLine(r.stdout) as OkLine & {
      nodes: Array<{ id: string }>;
      connectors: Array<{ id: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(body.connectors.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('nodes:patch partial-merges into node.data', async () => {
    const created = await createProject(uniqueFlowId('cli-nodes-patch'));
    await seedRectangleNodes(created.slug, ['p1']);

    const r = await runCli(
      [
        'nodes:patch',
        ...flowFlags(created.slug),
        'p1',
        '--json',
        JSON.stringify({ name: 'CLI patched' }),
      ],
      { env: cliEnv },
    );
    expect(r.code).toBe(0);
    expect(parseOkLine(r.stdout).ok).toBe(true);

    const get = (await (await fetch(flowApi(created.slug))).json()) as {
      flow: { nodes: Array<{ id: string; data?: { name?: string } }> };
    };
    expect(get.flow.nodes.find((n) => n.id === 'p1')?.data?.name).toBe('CLI patched');
  });

  it('nodes:move persists x/y to style.json (echoed in response)', async () => {
    const created = await createProject(uniqueFlowId('cli-nodes-move'));
    await seedRectangleNodes(created.slug, ['m1']);

    const r = await runCli(
      ['nodes:move', ...flowFlags(created.slug), 'm1', '--x', '123', '--y', '456'],
      { env: cliEnv },
    );
    expect(r.code).toBe(0);
    const body = parseOkLine(r.stdout) as OkLine & { position: { x: number; y: number } };
    expect(body.ok).toBe(true);
    expect(body.position).toEqual({ x: 123, y: 456 });
  });

  it('nodes:reorder moves a node within flow.nodes[]', async () => {
    const created = await createProject(uniqueFlowId('cli-nodes-reorder'));
    await seedRectangleNodes(created.slug, ['a', 'b', 'c']);

    const r = await runCli(['nodes:reorder', ...flowFlags(created.slug), 'a', '--op', 'toFront'], {
      env: cliEnv,
    });
    expect(r.code).toBe(0);
    expect(parseOkLine(r.stdout).ok).toBe(true);

    const get = (await (await fetch(flowApi(created.slug))).json()) as {
      flow: { nodes: Array<{ id: string }> };
    };
    expect(get.flow.nodes.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('nodes:delete removes the node from the flow', async () => {
    const created = await createProject(uniqueFlowId('cli-nodes-delete'));
    await seedRectangleNodes(created.slug, ['d1', 'd2']);

    const r = await runCli(['nodes:delete', ...flowFlags(created.slug), 'd1'], { env: cliEnv });
    expect(r.code).toBe(0);
    expect(parseOkLine(r.stdout).ok).toBe(true);

    const get = (await (await fetch(flowApi(created.slug))).json()) as {
      flow: { nodes: Array<{ id: string }> };
    };
    expect(get.flow.nodes.map((n) => n.id)).toEqual(['d2']);
  });
});

describe('integration: CLI — connectors', () => {
  it('connectors:add adds a single connector', async () => {
    const created = await createProject(uniqueFlowId('cli-connectors-add'));
    await seedRectangleNodes(created.slug, ['a', 'b']);

    const r = await runCli(
      [
        'connectors:add',
        ...flowFlags(created.slug),
        '--json',
        JSON.stringify({ id: 'c1', source: 'a', target: 'b' }),
      ],
      { env: cliEnv },
    );
    expect(r.code).toBe(0);
    const body = parseOkLine(r.stdout);
    expect(body.ok).toBe(true);
    expect(body.id).toBe('c1');
  });

  it('connectors:patch partial-merges a connector field', async () => {
    const created = await createProject(uniqueFlowId('cli-connectors-patch'));
    await seedRectangleNodes(created.slug, ['a', 'b']);
    await fetch(`${flowApi(created.slug)}/connectors`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'c1', source: 'a', target: 'b' }),
    });

    const r = await runCli(
      [
        'connectors:patch',
        ...flowFlags(created.slug),
        'c1',
        '--json',
        JSON.stringify({ label: 'cli-patched-edge' }),
      ],
      { env: cliEnv },
    );
    expect(r.code).toBe(0);
    expect(parseOkLine(r.stdout).ok).toBe(true);

    const get = (await (await fetch(flowApi(created.slug))).json()) as {
      flow: { connectors: Array<{ id: string; label?: string }> };
    };
    expect(get.flow.connectors.find((c) => c.id === 'c1')?.label).toBe('cli-patched-edge');
  });

  it('connectors:delete removes the connector', async () => {
    const created = await createProject(uniqueFlowId('cli-connectors-delete'));
    await seedRectangleNodes(created.slug, ['a', 'b']);
    await fetch(`${flowApi(created.slug)}/connectors`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'c1', source: 'a', target: 'b' }),
    });

    const r = await runCli(['connectors:delete', ...flowFlags(created.slug), 'c1'], {
      env: cliEnv,
    });
    expect(r.code).toBe(0);
    expect(parseOkLine(r.stdout).ok).toBe(true);

    const get = (await (await fetch(flowApi(created.slug))).json()) as {
      flow: { connectors: Array<{ id: string }> };
    };
    expect(get.flow.connectors.find((c) => c.id === 'c1')).toBeUndefined();
  });
});

describe('integration: CLI — validate', () => {
  it('validate --file accepts a structurally valid flow.json', async () => {
    const slug = uniqueFlowId('cli-validate');
    const tmpPath = join(studio.home, `${slug}.flow.json`);
    writeFileSync(
      tmpPath,
      `${JSON.stringify({ version: 2, name: slug, nodes: [], connectors: [] }, null, 2)}\n`,
    );

    const r = await runCli(['validate', '--file', tmpPath], { env: cliEnv });
    expect(r.code).toBe(0);
    expect(parseOkLine(r.stdout).ok).toBe(true);
  });
});

describe('integration: CLI — ids', () => {
  // Pure compute — no studio touched. The whole point of these tests is to
  // pin the wire format an AI / skill script consumes: one id per line on
  // stdout, exit 0, prefix matches the operations.ts convention.
  it('prints <count> node ids on stdout, one per line', async () => {
    const r = await runCli(['ids', 'node', '7']);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    const lines = r.stdout.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(7);
    for (const id of lines) {
      expect(/^node-[A-Za-z0-9]{10}$/.test(id)).toBe(true);
    }
    expect(new Set(lines).size).toBe(7);
  });

  it('prints <count> connector ids with the `conn-` prefix', async () => {
    const r = await runCli(['ids', 'connector', '3']);
    expect(r.code).toBe(0);
    const lines = r.stdout.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(3);
    for (const id of lines) {
      expect(/^conn-[A-Za-z0-9]{10}$/.test(id)).toBe(true);
    }
  });

  it('rejects unknown types with a non-zero exit and a helpful stderr', async () => {
    const r = await runCli(['ids', 'conn', '3']);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('Invalid type: conn');
    expect(r.stderr).toContain('node');
    expect(r.stderr).toContain('connector');
  });

  it('rejects count > 100 and count < 1', async () => {
    const tooMany = await runCli(['ids', 'node', '101']);
    expect(tooMany.code).not.toBe(0);
    expect(tooMany.stderr).toContain('Invalid count: 101');

    const zero = await runCli(['ids', 'node', '0']);
    expect(zero.code).not.toBe(0);
    expect(zero.stderr).toContain('Invalid count: 0');
  });
});

describe('integration: CLI — e2e', () => {
  // e2e iterates every node carrying playAction + every node carrying
  // statusAction and runs them. With no nodes carrying either capability,
  // both arrays are empty and the validator vacuously passes — sufficient as
  // a smoke test for the subcommand wiring (arg parsing, SSE channel open,
  // hard-ceiling, printOk).
  it('e2e --project/--flow runs against a flow with no play/status capabilities and exits ok', async () => {
    const created = await createProject(uniqueFlowId('cli-e2e'));
    const r = await runCli(['e2e', ...flowFlags(created.slug)], { env: cliEnv });
    expect(r.code).toBe(0);
    const body = parseOkLine(r.stdout) as OkLine & {
      plays: unknown[];
      statuses: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(body.plays).toEqual([]);
    expect(body.statuses).toEqual([]);
  });
});

describe('integration: CLI — lifecycle (start / stop)', () => {
  it('start is documented in --help', async () => {
    const r = await runCli(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('start');
    expect(r.stdout).toContain('--foreground');
  });

  it('start refuses with a clean error when the studio port is already in use', async () => {
    // Pre-flight: occupy a port with a plain Bun.serve, then ask the CLI to
    // bind to the same port. The pre-flight check should fire BEFORE we try
    // to bind / write the pid file and exit 1 with a port-conflict message.
    const blockedPort = await getFreePort();
    const blocker = Bun.serve({
      port: blockedPort,
      hostname: '127.0.0.1',
      fetch: () => new Response('block'),
    });
    const home = mkdtempSync(join(tmpdir(), 'seeflow-port-conflict-'));
    const pidPath = join(home, '.seeflow', 'seeflow.pid');

    try {
      const r = await runCli(['start', '--foreground', `--port=${blockedPort}`], {
        env: { SEEFLOW_WORKSPACE: home },
        timeoutMs: 10_000,
      });
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('Cannot start SeeFlow');
      expect(r.stderr).toContain(String(blockedPort));
      expect(r.stderr).toContain('Stop the running server');
      // Pre-flight must short-circuit before writePid runs.
      expect(existsSync(pidPath)).toBe(false);
    } finally {
      blocker.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('start ignores a busy 5173 (Vite owns that port in `bun run dev`)', async () => {
    // Reproduces the `make dev` flow: Vite binds 5173 first, then the
    // studio dev script runs `seeflow start`. The studio doesn't bind 5173
    // — only the dev-mode proxy targets it — so a listener on 5173 must
    // NOT block the studio from coming up on its own port.
    let blocker: ReturnType<typeof Bun.serve> | undefined;
    try {
      blocker = Bun.serve({
        port: 5173,
        hostname: '127.0.0.1',
        fetch: () => new Response('pretend-vite'),
      });
    } catch {
      // 5173 already busy with someone else's process — can't run this
      // test in this environment. Skipping is safer than a false positive.
      return;
    }
    try {
      const own = await spawnStudio();
      try {
        const res = await fetch(`${own.baseURL}/healthz`);
        expect(res.ok).toBe(true);
      } finally {
        await own.stop();
      }
    } finally {
      blocker.stop(true);
    }
  }, 15_000);

  it('stop signals a running studio and clears the pid file', async () => {
    // Spawn a dedicated studio for this test — using the shared one would
    // kill every later test in the file. The harness writes the pid file
    // at ${workspace}/seeflow.pid even in --foreground mode (writePid runs
    // unconditionally in runStart after the foreground branch).
    const own = await spawnStudio();
    const pidPath = join(own.workspace, 'seeflow.pid');
    expect(existsSync(pidPath)).toBe(true);
    expect(own.pid).toBeGreaterThan(0);

    try {
      const r = await runCli(['stop'], {
        env: {
          SEEFLOW_WORKSPACE: own.home,
        },
      });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('Stopped studio');
      expect(r.stdout).toContain(String(own.pid));

      // pid file cleared by clearPid().
      expect(existsSync(pidPath)).toBe(false);
    } finally {
      // Defensive: own.stop() is idempotent — sends SIGTERM, but if the
      // process is already gone (from CLI stop above) it's a fast no-op
      // followed by the home-dir rmSync.
      await own.stop();
    }
  });
});
