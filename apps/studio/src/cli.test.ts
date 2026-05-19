import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry } from './registry.ts';
import { createApp } from './server.ts';

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), 'cli.ts');

const VALID_DEMO = {
  version: 1,
  name: 'Checkout',
  nodes: [
    {
      id: 'api-checkout',
      type: 'playNode',
      position: { x: 0, y: 0 },
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
  it('two registers from the same repo with different architecturePath produce two distinct studio entries', async () => {
    const studio = startTestStudio();
    try {
      const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-cli-repo-'));
      mkdirSync(join(repoDir, '.seeflow', 'checkout'), { recursive: true });
      mkdirSync(join(repoDir, '.seeflow', 'refund'), { recursive: true });
      writeFileSync(
        join(repoDir, '.seeflow', 'checkout', 'seeflow.json'),
        JSON.stringify({ ...VALID_DEMO, name: 'Checkout' }),
      );
      writeFileSync(
        join(repoDir, '.seeflow', 'refund', 'seeflow.json'),
        JSON.stringify({ ...VALID_DEMO, name: 'Refund' }),
      );

      const baseEnv = { SEEFLOW_STUDIO_URL: studio.url };

      const first = await runCli(
        ['register', '--no-start', '--path', repoDir, '--flow', '.seeflow/checkout/seeflow.json'],
        baseEnv,
      );
      expect(first.code).toBe(0);
      expect(first.stdout).toContain('Registered "Checkout"');

      const second = await runCli(
        ['register', '--no-start', '--path', repoDir, '--flow', '.seeflow/refund/seeflow.json'],
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
