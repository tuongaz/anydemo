import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerProject } from './cli-ops.ts';
import { createEventBus } from './events.ts';
import { createRegistry } from './registry.ts';
import { createApp } from './server.ts';

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), 'cli.ts');

const VALID_DEMO = {
  version: 2,
  name: 'Checkout',
  nodes: [
    {
      id: 'api-checkout',
      type: 'rectangle',
      data: {
        name: 'POST /checkout',
      },
    },
  ],
  connectors: [],
};

const startTestStudio = (opts: { withEvents?: boolean } = {}) => {
  const workspace = mkdtempSync(join(tmpdir(), 'seeflow-cli-ws-'));
  // SEEFLOW_WORKSPACE drives `seeflowHome()` → `<workspace>/.seeflow/`.
  // The CLI subprocess uses that for its registry; the in-process studio
  // must point at the same file so reload() picks up CLI writes.
  mkdirSync(join(workspace, '.seeflow'), { recursive: true });
  const registry = createRegistry({
    path: join(workspace, '.seeflow', 'registry.json'),
  });
  const events = opts.withEvents ? createEventBus() : undefined;
  const app = createApp({
    mode: 'prod',
    staticRoot: './dist/web',
    registry,
    disableWatcher: true,
    ...(events ? { events } : {}),
  });
  const server = Bun.serve({ port: 0, fetch: app.fetch });
  const url = `http://${server.hostname}:${server.port}`;
  return {
    registry,
    events,
    workspace,
    url,
    /** Env that the CLI needs to share the studio's registry and URL. */
    env: { SEEFLOW_STUDIO_URL: url, SEEFLOW_WORKSPACE: workspace },
    stop: () => server.stop(true),
  };
};

const runCli = async (
  args: string[],
  env: Record<string, string>,
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> => {
  const proc = Bun.spawn(['bun', CLI_PATH, ...args], {
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  return { code: proc.exitCode ?? -1, stdout, stderr };
};

/**
 * Materialise a manifest-driven project at <tmp>/<slug>/ with the given flow
 * ids, then call registerProject so the studio's registry knows about it.
 * `flows[0]` becomes the defaultFlow.
 */
const seedProject = (
  studio: ReturnType<typeof startTestStudio>,
  slug: string,
  name: string,
  flows: Array<{ id: string; name: string }>,
) => {
  const repoPath = join(mkdtempSync(join(tmpdir(), 'seeflow-cli-manifest-')), slug);
  mkdirSync(repoPath, { recursive: true });
  const manifest = {
    version: 1 as const,
    name,
    defaultFlow: flows[0]?.id ?? 'main',
    flows,
  };
  writeFileSync(join(repoPath, 'seeflow.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const f of flows) {
    const flowDir = join(repoPath, 'flows', f.id);
    mkdirSync(flowDir, { recursive: true });
    writeFileSync(
      join(flowDir, 'flow.json'),
      `${JSON.stringify({ version: 2, name: f.name, nodes: [], connectors: [] }, null, 2)}\n`,
    );
  }
  const outcome = registerProject({ repoPath, registry: studio.registry });
  if (outcome.kind !== 'ok') throw new Error(`registerProject failed: ${JSON.stringify(outcome)}`);
  return { repoPath, projectSlug: outcome.projectSlug, entries: outcome.entries };
};

describe('seeflow CLI new subcommands', () => {
  it('projects:create writes seeflow.json + flows/main/flow.json and registers one entry', async () => {
    const studio = startTestStudio();
    const projectPath = join(mkdtempSync(join(tmpdir(), 'seeflow-cli-create-')), 'checkout-one');
    try {
      const r = await runCli(
        ['projects:create', '--no-start', '--path', projectPath, '--name', 'Checkout One'],
        studio.env,
      );
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { ok: boolean; slug: string };
      expect(parsed.ok).toBe(true);
      expect(parsed.slug).toBe('checkout-one/main');

      // On disk: manifest at the project root + flow.json under flows/main/.
      const manifestPath = join(projectPath, 'seeflow.json');
      const flowPath = join(projectPath, 'flows', 'main', 'flow.json');
      expect(existsSync(manifestPath)).toBe(true);
      expect(existsSync(flowPath)).toBe(true);
      expect(JSON.parse(readFileSync(manifestPath, 'utf-8'))).toEqual({
        version: 1,
        name: 'Checkout One',
        defaultFlow: 'main',
        flows: [{ id: 'main', name: 'Main' }],
      });
      expect(JSON.parse(readFileSync(flowPath, 'utf-8'))).toEqual({
        version: 2,
        name: 'Checkout One',
        nodes: [],
        connectors: [],
      });

      // Legacy single-flow layout must NOT be written.
      expect(existsSync(join(projectPath, 'flow.json'))).toBe(false);

      // Registry contains exactly one entry, addressed by projectSlug/main and
      // marked as the default flow.
      studio.registry.reload();
      const entries = studio.registry.list();
      expect(entries).toHaveLength(1);
      const entry = entries[0];
      if (!entry) throw new Error('registry entry missing');
      expect(entry.projectSlug).toBe('checkout-one');
      expect(entry.flowSlug).toBe('main');
      expect(entry.isDefault).toBe(true);
      expect(entry.flowPath).toBe('flows/main/flow.json');
      expect(entry.repoPath).toBe(projectPath);
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('flows:list returns the registered flows', async () => {
    const studio = startTestStudio();
    try {
      const { projectSlug } = seedProject(studio, 'listed', 'Listed', [
        { id: 'main', name: 'Main' },
      ]);

      const r = await runCli(['flows:list', '--no-start'], studio.env);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as {
        ok: boolean;
        flows: Array<{ slug: string }>;
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.flows.some((f) => f.slug === `${projectSlug}/main`)).toBe(true);
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('flows:get returns the flow keyed by --project + --flow', async () => {
    const studio = startTestStudio();
    try {
      const { projectSlug } = seedProject(studio, 'demo-get', 'Demo Get', [
        { id: 'main', name: 'Main' },
      ]);

      const get = await runCli(
        ['flows:get', '--no-start', '--project', projectSlug, '--flow', 'main'],
        studio.env,
      );
      expect(get.code).toBe(0);
      const parsedGet = JSON.parse(get.stdout) as { ok: boolean; id: string; slug: string };
      expect(parsedGet.slug).toBe(`${projectSlug}/main`);
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('flows:get returns exit 3 with notFound stderr for unknown project/flow', async () => {
    const studio = startTestStudio();
    try {
      const r = await runCli(
        ['flows:get', '--no-start', '--project', 'nope', '--flow', 'main'],
        studio.env,
      );
      expect(r.code).toBe(3);
      expect(r.stderr).toContain('not found');
      expect(r.stderr).toContain('"code":"notFound"');
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('flow-scoped verbs error out when --project or --flow is missing', async () => {
    const studio = startTestStudio();
    try {
      const noFlow = await runCli(['flows:get', '--project', 'p', '--no-start'], studio.env);
      expect(noFlow.code).toBe(1);
      expect(noFlow.stderr).toContain('Missing required flag: --flow');

      const noProject = await runCli(['flows:get', '--flow', 'main', '--no-start'], studio.env);
      expect(noProject.code).toBe(1);
      expect(noProject.stderr).toContain('Missing required flag: --project');
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('flow:add-bulk adds nodes + connectors atomically via --json', async () => {
    const studio = startTestStudio();
    try {
      const { projectSlug } = seedProject(studio, 'bulk', 'Bulk', [{ id: 'main', name: 'Main' }]);

      // Connector references node from the same batch — proves transactional shape.
      const payload = JSON.stringify({
        nodes: [
          {
            id: 'n1',
            type: 'rectangle',
            data: { name: 'one' },
          },
          {
            id: 'n2',
            type: 'rectangle',
            data: { name: 'two' },
          },
        ],
        connectors: [{ id: 'n1-to-n2', source: 'n1', target: 'n2' }],
      });
      const r = await runCli(
        [
          'flow:add-bulk',
          '--no-start',
          '--project',
          projectSlug,
          '--flow',
          'main',
          '--json',
          payload,
        ],
        studio.env,
      );
      if (r.code !== 0) {
        throw new Error(`exit=${r.code} stdout=${r.stdout} stderr=${r.stderr}`);
      }
      const parsed = JSON.parse(r.stdout) as {
        ok: boolean;
        nodes: Array<{ id: string }>;
        connectors: Array<{ id: string }>;
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
      expect(parsed.connectors.map((c) => c.id)).toEqual(['n1-to-n2']);
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('flow:add-bulk reports duplicate node id with collection=nodes', async () => {
    const studio = startTestStudio();
    try {
      const { projectSlug } = seedProject(studio, 'dup', 'Dup', [{ id: 'main', name: 'Main' }]);

      const payload = JSON.stringify({
        nodes: [
          {
            id: 'same',
            type: 'rectangle',
            data: { name: 'a' },
          },
          {
            id: 'same',
            type: 'rectangle',
            data: { name: 'b' },
          },
        ],
      });
      const r = await runCli(
        [
          'flow:add-bulk',
          '--no-start',
          '--project',
          projectSlug,
          '--flow',
          'main',
          '--json',
          payload,
        ],
        studio.env,
      );
      expect(r.code).toBe(4);
      expect(r.stderr).toContain('Duplicate nodes id in batch');
      expect(r.stderr).toContain('"code":"duplicateIdInBatch"');
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('validate accepts a valid flow and rejects a malformed one', async () => {
    const studio = startTestStudio();
    try {
      const tmpDir = mkdtempSync(join(tmpdir(), 'seeflow-cli-validate-'));
      const goodFile = join(tmpDir, 'good.json');
      writeFileSync(goodFile, JSON.stringify(VALID_DEMO));

      const ok = await runCli(['validate', '--no-start', '--file', goodFile], studio.env);
      expect(ok.code).toBe(0);

      const badFile = join(tmpDir, 'bad.json');
      writeFileSync(
        badFile,
        JSON.stringify({
          version: 2,
          name: 'Bad',
          nodes: [],
          connectors: [{ id: 'c1', source: 'missing', target: 'missing' }],
        }),
      );
      const bad = await runCli(['validate', '--no-start', '--file', badFile], studio.env);
      expect(bad.code).toBe(1);
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('flows:summary returns id, name, description per flow', async () => {
    const studio = startTestStudio();
    try {
      const entries = seedProject(studio, 'documented', 'Documented', [
        { id: 'main', name: 'Documented' },
      ]).entries;
      // listFlowsSummary falls back to the registry's stored description
      // when the watcher is disabled. Stamp it via upsert so the description
      // we want the test to verify reaches the CLI output.
      const entry = entries[0];
      if (!entry) throw new Error('seed produced no entries');
      studio.registry.upsert({
        name: entry.name,
        description: 'doc body',
        repoPath: entry.repoPath,
        flowPath: entry.flowPath,
        projectSlug: entry.projectSlug,
        flowSlug: entry.flowSlug,
        isDefault: entry.isDefault,
      });

      const r = await runCli(['flows:summary', '--no-start'], studio.env);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as {
        ok: boolean;
        flows: Array<{ id: string; name: string; description?: string }>;
      };
      expect(parsed.flows).toHaveLength(1);
      expect(parsed.flows[0]?.name).toBe('Documented');
      expect(parsed.flows[0]?.description).toBe('doc body');
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('flows:graph returns nodes/connectors and strips detail/html', async () => {
    const studio = startTestStudio();
    try {
      const { repoPath, projectSlug } = seedProject(studio, 'graph', 'Graph', [
        { id: 'main', name: 'Main' },
      ]);
      writeFileSync(
        join(repoPath, 'flows', 'main', 'flow.json'),
        JSON.stringify({
          ...VALID_DEMO,
          description: 'demo',
          nodes: [
            ...VALID_DEMO.nodes,
            {
              id: 'shape-1',
              type: 'rectangle',
              data: { name: 'note', detail: '# hidden' },
            },
          ],
        }),
      );

      const r = await runCli(
        ['flows:graph', '--no-start', '--project', projectSlug, '--flow', 'main'],
        studio.env,
      );
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as {
        ok: boolean;
        description: string;
        nodes: Array<{ id: string; data: Record<string, unknown> }>;
      };
      expect(parsed.description).toBe('demo');
      const shape = parsed.nodes.find((n) => n.id === 'shape-1');
      expect(shape?.data.detail).toBeUndefined();
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('schema with no arg prints category index', async () => {
    const studio = startTestStudio();
    try {
      const r = await runCli(['schema', '--no-start'], studio.env);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as {
        ok: boolean;
        categories: Array<{ name: string; description: string; subnames: string[] }>;
        usage: { drill: string; filter: string; examples: string[] };
        jqHints: { rootPath: string; examples: string[]; tip?: string };
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.categories.map((c) => c.name)).toEqual([
        'flow',
        'node',
        'connector',
        'action',
        'componentSpec',
        'componentCatalog',
        'style',
      ]);
      // Every category surfaces drill targets inline so the agent doesn't
      // round-trip back through listCategorySubnames.
      const node = parsed.categories.find((c) => c.name === 'node');
      expect(node?.subnames).toEqual(expect.arrayContaining(['rectangle', 'component', 'image']));
      const flow = parsed.categories.find((c) => c.name === 'flow');
      expect(flow?.subnames).toEqual(['flow']);
      // Usage block teaches the progressive workflow inline.
      expect(parsed.usage.drill).toMatch(/schema <category>/);
      expect(parsed.usage.filter).toMatch(/--jq/);
      expect(parsed.usage.examples.length).toBeGreaterThan(0);
      // Index carries jqHints.rootPath so the agent knows the filter prefix.
      expect(parsed.jqHints.rootPath).toBe('.categories');
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('schema <category> prints full JSON Schemas plus notes', async () => {
    const studio = startTestStudio();
    try {
      const r = await runCli(['schema', 'node', '--no-start'], studio.env);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as {
        ok: boolean;
        name: string;
        schemas: Record<string, { type: string }>;
        notes: string[];
        subnames: string[];
        jqHints: { examples: string[]; tip?: string };
      };
      expect(parsed.name).toBe('node');
      // Flat-types refactor: schema-catalog returns 19 variants (14 geometric
      // + image + html + icon + component + linkflow) — pinned in alphabetical order.
      expect(Object.keys(parsed.schemas).sort()).toEqual(
        [
          'cloud',
          'component',
          'database',
          'diamond',
          'document',
          'ellipse',
          'hexagon',
          'html',
          'icon',
          'image',
          'linkflow',
          'parallelogram',
          'queue',
          'rectangle',
          'server',
          'sticky',
          'text',
          'triangle',
          'user',
        ].sort(),
      );
      expect(parsed.schemas.rectangle?.type).toBe('object');
      expect(parsed.notes.length).toBeGreaterThan(0);
      // Category response surfaces subnames + jqHints so the agent can drill
      // in without parsing the schema map.
      expect(parsed.subnames).toEqual(expect.arrayContaining(['rectangle', 'component']));
      expect(parsed.jqHints.examples).toEqual(
        expect.arrayContaining(['.schemas', '.schemas[]', '.notes[]']),
      );
      expect(parsed.jqHints.tip).toMatch(/rectangle/);
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('schema <category> --jq extracts a single schema variant', async () => {
    const studio = startTestStudio();
    try {
      const r = await runCli(
        ['schema', 'node', '--jq', '.schemas.rectangle', '--no-start'],
        studio.env,
      );
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as {
        ok: boolean;
        name: string;
        result: { type: string; properties: Record<string, unknown> };
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.name).toBe('node');
      expect(parsed.result.type).toBe('object');
      expect(parsed.result.properties).toBeDefined();
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('schema <category> --jq with iteration returns an array of results', async () => {
    const studio = startTestStudio();
    try {
      const r = await runCli(['schema', 'node', '--jq', '.schemas[]', '--no-start'], studio.env);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { ok: boolean; name: string; result: unknown[] };
      expect(parsed.ok).toBe(true);
      // 19 flat variants iterated.
      expect(Array.isArray(parsed.result)).toBe(true);
      expect(parsed.result).toHaveLength(19);
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('schema --jq on a bad filter exits 2 with badJq', async () => {
    const studio = startTestStudio();
    try {
      const r = await runCli(['schema', 'node', '--jq', 'foo', '--no-start'], studio.env);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('"code":"badJq"');
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('schema <category> <subname> returns just that named schema', async () => {
    const studio = startTestStudio();
    try {
      const r = await runCli(['schema', 'node', 'component', '--no-start'], studio.env);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as {
        ok: boolean;
        name: string;
        subname: string;
        schemas: Record<string, { type: string }>;
        notes: string[];
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.name).toBe('node');
      expect(parsed.subname).toBe('component');
      expect(Object.keys(parsed.schemas)).toEqual(['component']);
      expect(parsed.schemas.component?.type).toBe('object');
      expect(parsed.notes.length).toBeGreaterThan(0);
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('schema node rectangle returns just rectangle (regression for the example in CLI help)', async () => {
    const studio = startTestStudio();
    try {
      const r = await runCli(['schema', 'node', 'rectangle', '--no-start'], studio.env);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as {
        ok: boolean;
        name: string;
        subname: string;
        schemas: Record<string, { type: string }>;
        jqHints: { dataFields?: string[]; examples: string[]; rootPath: string; tip?: string };
      };
      expect(parsed.name).toBe('node');
      expect(parsed.subname).toBe('rectangle');
      expect(Object.keys(parsed.schemas)).toEqual(['rectangle']);
      // jqHints.dataFields tells the agent which data.<field>s exist on the
      // variant so they can `--jq` straight to the one they care about.
      expect(parsed.jqHints.dataFields).toEqual(
        expect.arrayContaining(['name', 'description', 'detail', 'handlerModule']),
      );
      // jqHints.examples must include at least one ready-to-paste data-field path.
      expect(
        parsed.jqHints.examples.some((e) =>
          /\.schemas\.rectangle\.properties\.data\.properties\./.test(e),
        ),
      ).toBe(true);
      expect(parsed.jqHints.tip).toMatch(/dataFields/i);
      // rootPath reaches the single variant so the agent never guesses the prefix.
      expect(parsed.jqHints.rootPath).toBe('.schemas.rectangle');
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('schema componentCatalog lists every component, drills into one, and --jq slices it', async () => {
    const studio = startTestStudio();
    try {
      const category = await runCli(['schema', 'componentCatalog', '--no-start'], studio.env);
      expect(category.code).toBe(0);
      const parsedCategory = JSON.parse(category.stdout) as {
        name: string;
        schemas: Record<string, { type: string }>;
        subnames: string[];
        jqHints: { rootPath: string };
      };
      expect(parsedCategory.name).toBe('componentCatalog');
      // The catalog the agent could not previously see — Chart/Table/Button etc.
      expect(parsedCategory.subnames).toEqual(
        expect.arrayContaining(['Card', 'Chart', 'Table', 'Button']),
      );
      expect(parsedCategory.jqHints.rootPath).toBe('.schemas');

      const single = await runCli(
        ['schema', 'componentCatalog', 'Chart', '--no-start'],
        studio.env,
      );
      expect(single.code).toBe(0);
      const parsedSingle = JSON.parse(single.stdout) as {
        subname: string;
        schemas: Record<string, { properties?: Record<string, unknown> }>;
        jqHints: { rootPath: string };
      };
      expect(parsedSingle.subname).toBe('Chart');
      expect(Object.keys(parsedSingle.schemas)).toEqual(['Chart']);
      expect(parsedSingle.schemas.Chart?.properties?.kind).toBeDefined();
      expect(parsedSingle.jqHints.rootPath).toBe('.schemas.Chart');

      const sliced = await runCli(
        ['schema', 'componentCatalog', 'Chart', '--jq', '.schemas.Chart.required', '--no-start'],
        studio.env,
      );
      expect(sliced.code).toBe(0);
      const parsedSliced = JSON.parse(sliced.stdout) as { result: string[] };
      expect(parsedSliced.result).toEqual(expect.arrayContaining(['kind', 'data']));
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('schema action componentAction returns just componentAction (subname works for any multi-schema category)', async () => {
    const studio = startTestStudio();
    try {
      const r = await runCli(['schema', 'action', 'componentAction', '--no-start'], studio.env);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as {
        name: string;
        subname: string;
        schemas: Record<string, unknown>;
      };
      expect(parsed.name).toBe('action');
      expect(parsed.subname).toBe('componentAction');
      expect(Object.keys(parsed.schemas)).toEqual(['componentAction']);
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('schema <category> <subname> --jq narrows further into the single schema', async () => {
    const studio = startTestStudio();
    try {
      const r = await runCli(
        ['schema', 'node', 'rectangle', '--jq', '.schemas.rectangle.type', '--no-start'],
        studio.env,
      );
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as {
        ok: boolean;
        name: string;
        subname: string;
        result: string;
      };
      expect(parsed.subname).toBe('rectangle');
      expect(parsed.result).toBe('object');
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('schema <category> <bogusSubname> exits 3 with notFound + category + available subnames', async () => {
    const studio = startTestStudio();
    try {
      const r = await runCli(['schema', 'node', 'bogus', '--no-start'], studio.env);
      expect(r.code).toBe(3);
      expect(r.stderr).toContain('"code":"notFound"');
      expect(r.stderr).toContain('unknown schema subname: bogus');
      const parsedErr = JSON.parse(r.stderr) as { category: string; available: string[] };
      expect(parsedErr.category).toBe('node');
      expect(parsedErr.available.sort()).toEqual(
        [
          'cloud',
          'component',
          'database',
          'diamond',
          'document',
          'ellipse',
          'hexagon',
          'html',
          'icon',
          'image',
          'linkflow',
          'parallelogram',
          'queue',
          'rectangle',
          'server',
          'sticky',
          'text',
          'triangle',
          'user',
        ].sort(),
      );
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('schema with unknown category exits 3 with notFound + available list', async () => {
    const studio = startTestStudio();
    try {
      const r = await runCli(['schema', 'bogus', '--no-start'], studio.env);
      expect(r.code).toBe(3);
      expect(r.stderr).toContain('"code":"notFound"');
      expect(r.stderr).toContain('unknown schema category: bogus');
      const parsedErr = JSON.parse(r.stderr) as { available: string[] };
      expect(parsedErr.available).toEqual([
        'flow',
        'node',
        'connector',
        'action',
        'componentSpec',
        'componentCatalog',
        'style',
      ]);
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('nodes:get returns the node with detail content inlined', async () => {
    const studio = startTestStudio();
    try {
      const { projectSlug } = seedProject(studio, 'nodeget', 'NodeGet', [
        { id: 'main', name: 'Main' },
      ]);

      // Add a shape node via the add endpoint so detail.md is externalized.
      const addRes = await fetch(
        `${studio.url}/api/projects/${encodeURIComponent(projectSlug)}/flows/main/nodes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'rectangle',
            data: { name: 'A', detail: '# inlined body' },
          }),
        },
      );
      const added = (await addRes.json()) as { id: string };

      const r = await runCli(
        ['nodes:get', '--no-start', '--project', projectSlug, '--flow', 'main', added.id],
        studio.env,
      );
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as {
        ok: boolean;
        flowId: string;
        node: { data: { detail?: string } };
      };
      // ops.getNode echoes the slug it was called with (US-020 cutover).
      expect(parsed.flowId).toBe(`${projectSlug}/main`);
      expect(parsed.node.data.detail).toBe('# inlined body');
    } finally {
      studio.stop();
    }
  }, 20_000);

  // -- Linkflow node smoke (US-010) ----------------------------------------
  // Exercises the CLI op path (`nodes:add` → createCliOperations().addNode())
  // for the linkflow node type added in US-001. Asserts the on-disk flow.json
  // contains the node with the target slug pair preserved verbatim.
  it('nodes:add accepts a linkflow node with target and writes it to flow.json', async () => {
    const studio = startTestStudio();
    try {
      const { repoPath, projectSlug } = seedProject(studio, 'linkflow-cli', 'Linkflow CLI', [
        { id: 'main', name: 'Main' },
        { id: 'other', name: 'Other' },
      ]);

      const linkflowNode = {
        id: 'lf-cli-1',
        type: 'linkflow',
        data: {
          name: 'Go to Other',
          target: { project: projectSlug, flow: 'other' },
        },
      };
      const r = await runCli(
        [
          'nodes:add',
          '--no-start',
          '--project',
          projectSlug,
          '--flow',
          'main',
          '--json',
          JSON.stringify(linkflowNode),
        ],
        studio.env,
      );
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { ok: boolean; id: string };
      expect(parsed.ok).toBe(true);
      expect(parsed.id).toBe('lf-cli-1');

      // The on-disk flow.json must contain the linkflow node with the target
      // slug pair preserved exactly as supplied. seedProject's manifest layout
      // puts flow.json at flows/main/flow.json under repoPath.
      const flowJsonPath = join(repoPath, 'flows', 'main', 'flow.json');
      const flow = JSON.parse(readFileSync(flowJsonPath, 'utf8')) as {
        nodes: Array<{
          id: string;
          type: string;
          data: { name?: string; target?: { project: string; flow: string } };
        }>;
      };
      const node = flow.nodes.find((n) => n.id === 'lf-cli-1');
      expect(node).toBeDefined();
      expect(node?.type).toBe('linkflow');
      expect(node?.data.target).toEqual({ project: projectSlug, flow: 'other' });
      expect(node?.data.name).toBe('Go to Other');
    } finally {
      studio.stop();
    }
  }, 20_000);

  // -- Manifest CRUD verbs (US-019) ----------------------------------------

  it('flows:create writes the new flow on disk and registers it', async () => {
    const studio = startTestStudio();
    try {
      const { repoPath, projectSlug } = seedProject(studio, 'demo-create', 'Demo Create', [
        { id: 'main', name: 'Main' },
      ]);

      const r = await runCli(
        [
          'flows:create',
          '--no-start',
          '--project',
          projectSlug,
          '--flow',
          'retry',
          '--name',
          'Retry',
        ],
        studio.env,
      );
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as {
        ok: boolean;
        projectSlug: string;
        flowSlug: string;
        flowPath: string;
        isDefault: boolean;
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.projectSlug).toBe(projectSlug);
      expect(parsed.flowSlug).toBe('retry');
      expect(parsed.flowPath).toBe('flows/retry/flow.json');
      expect(parsed.isDefault).toBe(false);

      // On disk: new folder + flow.json envelope.
      const newFlow = join(repoPath, 'flows', 'retry', 'flow.json');
      expect(existsSync(newFlow)).toBe(true);
      expect(JSON.parse(readFileSync(newFlow, 'utf-8'))).toEqual({
        version: 2,
        name: 'Retry',
        nodes: [],
        connectors: [],
      });

      // Manifest now has both flows.
      const manifest = JSON.parse(readFileSync(join(repoPath, 'seeflow.json'), 'utf-8')) as {
        flows: Array<{ id: string; name: string }>;
      };
      expect(manifest.flows.map((f) => f.id).sort()).toEqual(['main', 'retry']);

      // Registry now has both entries (in-process — created via the HTTP
      // endpoint that lives in the same process as the test studio).
      const entries = studio.registry.list().filter((e) => e.projectSlug === projectSlug);
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.flowSlug).sort()).toEqual(['main', 'retry']);
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('flows:rename updates the manifest name without touching the folder', async () => {
    const studio = startTestStudio();
    try {
      const { repoPath, projectSlug } = seedProject(studio, 'demo-rename', 'Demo Rename', [
        { id: 'main', name: 'Main' },
      ]);

      const r = await runCli(
        [
          'flows:rename',
          '--no-start',
          '--project',
          projectSlug,
          '--flow',
          'main',
          '--name',
          'Primary',
        ],
        studio.env,
      );
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as {
        ok: boolean;
        flowSlug: string;
        name: string;
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.flowSlug).toBe('main');
      expect(parsed.name).toBe('Primary');

      // Manifest reflects the new name; folder layout unchanged.
      const manifest = JSON.parse(readFileSync(join(repoPath, 'seeflow.json'), 'utf-8')) as {
        flows: Array<{ id: string; name: string }>;
      };
      expect(manifest.flows).toEqual([{ id: 'main', name: 'Primary' }]);
      expect(existsSync(join(repoPath, 'flows', 'main', 'flow.json'))).toBe(true);
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('flows:delete removes the flow folder + manifest entry + registry entry', async () => {
    const studio = startTestStudio();
    try {
      const { repoPath, projectSlug } = seedProject(studio, 'demo-delete', 'Demo Delete', [
        { id: 'main', name: 'Main' },
        { id: 'retry', name: 'Retry' },
      ]);

      const r = await runCli(
        ['flows:delete', '--no-start', '--project', projectSlug, '--flow', 'retry'],
        studio.env,
      );
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { ok: boolean };
      expect(parsed.ok).toBe(true);

      // Folder removed.
      expect(existsSync(join(repoPath, 'flows', 'retry'))).toBe(false);
      // Manifest now lists only main.
      const manifest = JSON.parse(readFileSync(join(repoPath, 'seeflow.json'), 'utf-8')) as {
        flows: Array<{ id: string }>;
        defaultFlow: string;
      };
      expect(manifest.flows.map((f) => f.id)).toEqual(['main']);
      expect(manifest.defaultFlow).toBe('main');
      // Registry has only the surviving entry.
      const entries = studio.registry.list().filter((e) => e.projectSlug === projectSlug);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.flowSlug).toBe('main');
    } finally {
      studio.stop();
    }
  }, 20_000);
});
