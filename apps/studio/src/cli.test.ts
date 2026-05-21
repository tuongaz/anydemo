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

const tmpRegistryPath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'seeflow-cli-reg-'));
  return join(dir, 'registry.json');
};

const startTestStudio = () => {
  const registry = createRegistry({ path: tmpRegistryPath() });
  const app = createApp({ mode: 'prod', staticRoot: './dist/web', registry, disableWatcher: true });
  const server = Bun.serve({ port: 0, fetch: app.fetch });
  return {
    registry,
    url: `http://${server.hostname}:${server.port}`,
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

      const baseEnv = { SEEFLOW_STUDIO_URL: studio.url };

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
      const r = await runCli(['projects:create', '--no-start', '--name', 'Checkout One'], {
        SEEFLOW_STUDIO_URL: studio.url,
      });
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

      const r = await runCli(['flows:list', '--no-start'], { SEEFLOW_STUDIO_URL: studio.url });
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

      const get = await runCli(['flows:get', entry.id, '--no-start'], {
        SEEFLOW_STUDIO_URL: studio.url,
      });
      expect(get.code).toBe(0);
      const parsedGet = JSON.parse(get.stdout) as { ok: boolean; id: string };
      expect(parsedGet.id).toBe(entry.id);

      const del = await runCli(['flows:delete', entry.id, '--no-start'], {
        SEEFLOW_STUDIO_URL: studio.url,
      });
      expect(del.code).toBe(0);
      expect(studio.registry.list()).toHaveLength(0);
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('flows:get returns exit 1 with stderr for unknown flowId', async () => {
    const studio = startTestStudio();
    try {
      const r = await runCli(['flows:get', 'nope', '--no-start'], {
        SEEFLOW_STUDIO_URL: studio.url,
      });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('Studio returned 404');
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('nodes:add-bulk adds nodes via --json', async () => {
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

      const payload = JSON.stringify({
        nodes: [
          {
            id: 'n1',
            type: 'stateNode',
            data: { name: 'one', kind: 'state', stateSource: { kind: 'request' } },
          },
        ],
      });
      const r = await runCli(['nodes:add-bulk', entry.id, '--no-start', '--json', payload], {
        SEEFLOW_STUDIO_URL: studio.url,
      });
      if (r.code !== 0) {
        throw new Error(`exit=${r.code} stdout=${r.stdout} stderr=${r.stderr}`);
      }
      const parsed = JSON.parse(r.stdout) as { ok: boolean; nodes: Array<{ id: string }> };
      expect(parsed.ok).toBe(true);
      expect(parsed.nodes[0]?.id).toBe('n1');
    } finally {
      studio.stop();
    }
  }, 20_000);

  it('nodes:add-bulk reports duplicate id error', async () => {
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
      const r = await runCli(['nodes:add-bulk', entry.id, '--no-start', '--json', payload], {
        SEEFLOW_STUDIO_URL: studio.url,
      });
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/Studio returned \d+/);
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

      const ok = await runCli(['validate', '--no-start', '--file', goodFile], {
        SEEFLOW_STUDIO_URL: studio.url,
      });
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
      const bad = await runCli(['validate', '--no-start', '--file', badFile], {
        SEEFLOW_STUDIO_URL: studio.url,
      });
      expect(bad.code).toBe(1);
    } finally {
      studio.stop();
    }
  }, 20_000);
});
