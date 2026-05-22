import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry } from './registry.ts';
import { createApp } from './server.ts';

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), 'cli.ts');

const VALID_DEMO = {
  version: 2,
  name: 'Checkout',
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

const startTestStudio = () => {
  const workspace = mkdtempSync(join(tmpdir(), 'seeflow-cli-ws-'));
  mkdirSync(join(workspace, '.seeflow'), { recursive: true });
  const registry = createRegistry({
    path: join(workspace, '.seeflow', 'registry.json'),
  });
  const app = createApp({ mode: 'prod', staticRoot: './dist/web', registry, disableWatcher: true });
  const server = Bun.serve({ port: 0, fetch: app.fetch });
  const url = `http://${server.hostname}:${server.port}`;
  return {
    registry,
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

describe('seeflow CLI register integration', () => {
  it('two registers from the same repo with different flowPath produce two distinct studio entries', async () => {
    const studio = startTestStudio();
    try {
      const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-cli-repo-'));
      mkdirSync(join(repoDir, '.seeflow', 'checkout'), { recursive: true });
      mkdirSync(join(repoDir, '.seeflow', 'refund'), { recursive: true });
      writeFileSync(
        join(repoDir, '.seeflow', 'checkout', 'flow.json'),
        JSON.stringify({ ...VALID_DEMO, name: 'Checkout' }),
      );
      writeFileSync(
        join(repoDir, '.seeflow', 'refund', 'flow.json'),
        JSON.stringify({ ...VALID_DEMO, name: 'Refund' }),
      );

      const baseEnv = studio.env;

      const first = await runCli(
        ['register', '--no-start', '--path', repoDir, '--flow', '.seeflow/checkout/flow.json'],
        baseEnv,
      );
      expect(first.code).toBe(0);
      expect(first.stdout).toContain('Registered "Checkout"');

      const second = await runCli(
        ['register', '--no-start', '--path', repoDir, '--flow', '.seeflow/refund/flow.json'],
        baseEnv,
      );
      expect(second.code).toBe(0);
      expect(second.stdout).toContain('Registered "Refund"');

      // CLI runs in a separate process and writes the shared registry.json on
      // disk. The studio's in-memory registry needs a manual reload to see
      // the new state since the test harness disables the watcher.
      studio.registry.reload();
      expect(studio.registry.list()).toHaveLength(2);
      const entries = studio.registry.list();
      const slugs = entries.map((e) => e.slug).sort();
      expect(slugs).toEqual(['checkout', 'refund']);
      const ids = entries.map((e) => e.id);
      expect(new Set(ids).size).toBe(2);
      expect(entries.every((e) => e.repoPath === repoDir)).toBe(true);
    } finally {
      studio.stop();
    }
  }, 20_000);
});

describe('seeflow CLI new subcommands', () => {
  it('projects:create returns ok with slug', async () => {
    const studio = startTestStudio();
    try {
      const r = await runCli(
        ['projects:create', '--no-start', '--name', 'Checkout One'],
        studio.env,
      );
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { ok: boolean; slug: string };
      expect(parsed.ok).toBe(true);
      expect(parsed.slug).toBe('checkout-one');
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('flows:list returns the registered flows', async () => {
    const studio = startTestStudio();
    try {
      const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-cli-list-'));
      mkdirSync(join(repoDir, '.seeflow'), { recursive: true });
      writeFileSync(join(repoDir, '.seeflow', 'flow.json'), JSON.stringify(VALID_DEMO));
      studio.registry.upsert({
        name: 'Listed',
        repoPath: repoDir,
        flowPath: '.seeflow/flow.json',
      });

      const r = await runCli(['flows:list', '--no-start'], studio.env);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as {
        ok: boolean;
        flows: Array<{ slug: string }>;
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.flows.some((f) => f.slug === 'listed')).toBe(true);
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('flows:get returns the flow and flows:delete unregisters it', async () => {
    const studio = startTestStudio();
    try {
      const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-cli-getdel-'));
      mkdirSync(join(repoDir, '.seeflow'), { recursive: true });
      writeFileSync(join(repoDir, '.seeflow', 'flow.json'), JSON.stringify(VALID_DEMO));
      const entry = studio.registry.upsert({
        name: 'GD',
        repoPath: repoDir,
        flowPath: '.seeflow/flow.json',
      });

      const get = await runCli(['flows:get', entry.id, '--no-start'], studio.env);
      expect(get.code).toBe(0);
      const parsedGet = JSON.parse(get.stdout) as { ok: boolean; id: string };
      expect(parsedGet.id).toBe(entry.id);

      const del = await runCli(['flows:delete', entry.id, '--no-start'], studio.env);
      expect(del.code).toBe(0);
      studio.registry.reload();
      expect(studio.registry.list()).toHaveLength(0);
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('flows:get returns exit 3 with notFound stderr for unknown flowId', async () => {
    const studio = startTestStudio();
    try {
      const r = await runCli(['flows:get', 'nope', '--no-start'], studio.env);
      expect(r.code).toBe(3);
      expect(r.stderr).toContain('not found');
      expect(r.stderr).toContain('"code":"notFound"');
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('flow:add-bulk adds nodes + connectors atomically via --json', async () => {
    const studio = startTestStudio();
    try {
      const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-cli-bulk-'));
      mkdirSync(join(repoDir, '.seeflow'), { recursive: true });
      const emptyDemo = { version: 2, name: 'Empty', nodes: [], connectors: [] };
      writeFileSync(join(repoDir, '.seeflow', 'flow.json'), JSON.stringify(emptyDemo));
      const entry = studio.registry.upsert({
        name: 'Empty',
        repoPath: repoDir,
        flowPath: '.seeflow/flow.json',
      });

      // Connector references node from the same batch — proves transactional shape.
      const payload = JSON.stringify({
        nodes: [
          {
            id: 'n1',
            type: 'stateNode',
            data: { name: 'one', kind: 'state', stateSource: { kind: 'request' } },
          },
          {
            id: 'n2',
            type: 'stateNode',
            data: { name: 'two', kind: 'state', stateSource: { kind: 'request' } },
          },
        ],
        connectors: [{ id: 'n1-to-n2', source: 'n1', target: 'n2' }],
      });
      const r = await runCli(
        ['flow:add-bulk', entry.id, '--no-start', '--json', payload],
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
      const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-cli-dup-'));
      mkdirSync(join(repoDir, '.seeflow'), { recursive: true });
      writeFileSync(
        join(repoDir, '.seeflow', 'flow.json'),
        JSON.stringify({ version: 2, name: 'Dup', nodes: [], connectors: [] }),
      );
      const entry = studio.registry.upsert({
        name: 'Dup',
        repoPath: repoDir,
        flowPath: '.seeflow/flow.json',
      });

      const payload = JSON.stringify({
        nodes: [
          {
            id: 'same',
            type: 'stateNode',
            data: { name: 'a', kind: 'state', stateSource: { kind: 'request' } },
          },
          {
            id: 'same',
            type: 'stateNode',
            data: { name: 'b', kind: 'state', stateSource: { kind: 'request' } },
          },
        ],
      });
      const r = await runCli(
        ['flow:add-bulk', entry.id, '--no-start', '--json', payload],
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
      const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-cli-summary-'));
      mkdirSync(join(repoDir, '.seeflow'), { recursive: true });
      writeFileSync(
        join(repoDir, '.seeflow', 'flow.json'),
        JSON.stringify({ ...VALID_DEMO, name: 'Documented', description: 'doc body' }),
      );
      studio.registry.upsert({
        name: 'Documented',
        description: 'doc body',
        repoPath: repoDir,
        flowPath: '.seeflow/flow.json',
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
      const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-cli-graph-'));
      mkdirSync(join(repoDir, '.seeflow'), { recursive: true });
      writeFileSync(
        join(repoDir, '.seeflow', 'flow.json'),
        JSON.stringify({
          ...VALID_DEMO,
          description: 'demo',
          nodes: [
            ...VALID_DEMO.nodes,
            {
              id: 'shape-1',
              type: 'shapeNode',
              data: { name: 'note', shape: 'rectangle', detail: '# hidden' },
            },
          ],
        }),
      );
      const entry = studio.registry.upsert({
        name: 'Graph',
        description: 'demo',
        repoPath: repoDir,
        flowPath: '.seeflow/flow.json',
      });

      const r = await runCli(['flows:graph', entry.id, '--no-start'], studio.env);
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
        categories: Array<{ name: string; description: string }>;
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.categories.map((c) => c.name)).toEqual([
        'flow',
        'node',
        'connector',
        'action',
        'style',
      ]);
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
      };
      expect(parsed.name).toBe('node');
      expect(Object.keys(parsed.schemas).sort()).toEqual(
        ['htmlNode', 'iconNode', 'imageNode', 'playNode', 'shapeNode', 'stateNode'].sort(),
      );
      expect(parsed.schemas.playNode?.type).toBe('object');
      expect(parsed.notes.length).toBeGreaterThan(0);
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
      expect(parsedErr.available).toEqual(['flow', 'node', 'connector', 'action', 'style']);
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('nodes:get returns the node with detail content inlined', async () => {
    const studio = startTestStudio();
    try {
      const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-cli-nodeget-'));
      mkdirSync(join(repoDir, '.seeflow'), { recursive: true });
      writeFileSync(join(repoDir, '.seeflow', 'flow.json'), JSON.stringify(VALID_DEMO));
      const entry = studio.registry.upsert({
        name: 'NodeGet',
        repoPath: repoDir,
        flowPath: '.seeflow/flow.json',
      });

      // Add a shape node via the add endpoint so detail.md is externalized.
      const addRes = await fetch(`${studio.url}/api/flows/${entry.id}/nodes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'shapeNode',
          data: { name: 'A', shape: 'rectangle', detail: '# inlined body' },
        }),
      });
      const added = (await addRes.json()) as { id: string };

      const r = await runCli(['nodes:get', entry.id, added.id, '--no-start'], studio.env);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as {
        ok: boolean;
        flowId: string;
        node: { data: { detail?: string } };
      };
      expect(parsed.flowId).toBe(entry.id);
      expect(parsed.node.data.detail).toBe('# inlined body');
    } finally {
      studio.stop();
    }
  }, 20_000);
});
