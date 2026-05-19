import { describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEventBus } from './events.ts';
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
  const dir = mkdtempSync(join(tmpdir(), 'seeflow-api-reg-'));
  return join(dir, 'registry.json');
};

const tmpRepoWithDemo = (demo: unknown = VALID_DEMO) => {
  const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-api-repo-'));
  mkdirSync(join(repoDir, '.seeflow'));
  writeFileSync(join(repoDir, '.seeflow', 'seeflow.json'), JSON.stringify(demo));
  return repoDir;
};

const buildApp = () => {
  const registry = createRegistry({ path: tmpRegistry() });
  const app = createApp({ mode: 'prod', staticRoot: './dist/web', registry, disableWatcher: true });
  return { app, registry };
};

const post = (app: ReturnType<typeof buildApp>['app'], path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/flows/register', () => {
  it('registers a valid demo and returns id + slug + skipped sdk for request-only demo', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo();

    const res = await post(app, '/api/flows/register', {
      name: 'Checkout Flow',
      repoPath,
      architecturePath: '.seeflow/seeflow.json',
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      id: string;
      slug: string;
      sdk: { outcome: string; filePath: string | null };
    };
    expect(json.slug).toBe('checkout-flow');
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.id).toBe(json.id);
    expect(json.sdk).toEqual({ outcome: 'skipped', filePath: null });
  });

  it('writes .seeflow/sdk/emit.ts when the demo declares an event-bound state node', async () => {
    const { app } = buildApp();
    const eventDemo = {
      version: 2,
      name: 'Event Flow',
      nodes: [
        {
          id: 'queue-orders',
          type: 'stateNode',
              data: {
            name: 'orders.created',
            kind: 'queue',
            stateSource: { kind: 'event' },
          },
        },
      ],
      connectors: [],
    };
    const repoPath = tmpRepoWithDemo(eventDemo);

    const res = await post(app, '/api/flows/register', {
      repoPath,
      architecturePath: '.seeflow/seeflow.json',
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      sdk: { outcome: string; filePath: string | null };
    };
    expect(json.sdk.outcome).toBe('written');
    expect(json.sdk.filePath).toBe(join(repoPath, '.seeflow', 'sdk', 'emit.ts'));
    const written = readFileSync(join(repoPath, '.seeflow', 'sdk', 'emit.ts'), 'utf8');
    expect(written.length).toBeGreaterThan(0);

    const second = await post(app, '/api/flows/register', {
      repoPath,
      architecturePath: '.seeflow/seeflow.json',
    });
    const secondJson = (await second.json()) as { sdk: { outcome: string } };
    expect(secondJson.sdk.outcome).toBe('present');
  });

  it('returns 400 with Zod issues when the demo file fails schema validation', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo({ version: 1 });

    const res = await post(app, '/api/flows/register', {
      name: 'Bad demo',
      repoPath,
      architecturePath: '.seeflow/seeflow.json',
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; issues?: Array<{ path: unknown[] }> };
    expect(json.error).toContain('schema validation');
    expect(json.issues?.length ?? 0).toBeGreaterThan(0);
    expect(registry.list()).toHaveLength(0);
  });

  it('returns 400 when the demo file does not exist', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/flows/register', {
      name: 'Missing',
      repoPath: '/this/path/does/not/exist',
      architecturePath: '.seeflow/seeflow.json',
    });
    expect(res.status).toBe(400);
  });

  it('re-registering the same repoPath updates in place (same id, same slug)', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo();

    const first = await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json();
    const second = await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json();

    expect((second as { id: string }).id).toBe((first as { id: string }).id);
    expect((second as { slug: string }).slug).toBe((first as { slug: string }).slug);
    expect(registry.list()).toHaveLength(1);
  });

  it('same repoPath + different architecturePath returns two distinct ids + slugs; both listed', async () => {
    const { app, registry } = buildApp();
    const repoPath = mkdtempSync(join(tmpdir(), 'seeflow-api-multi-'));
    mkdirSync(join(repoPath, '.seeflow', 'checkout'), { recursive: true });
    mkdirSync(join(repoPath, '.seeflow', 'refund'), { recursive: true });
    writeFileSync(
      join(repoPath, '.seeflow', 'checkout', 'seeflow.json'),
      JSON.stringify({ ...VALID_DEMO, name: 'Checkout' }),
    );
    writeFileSync(
      join(repoPath, '.seeflow', 'refund', 'seeflow.json'),
      JSON.stringify({ ...VALID_DEMO, name: 'Refund' }),
    );

    const a = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        architecturePath: '.seeflow/checkout/seeflow.json',
      })
    ).json()) as { id: string; slug: string };
    const b = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        architecturePath: '.seeflow/refund/seeflow.json',
      })
    ).json()) as { id: string; slug: string };

    expect(a.id).not.toBe(b.id);
    expect(a.slug).not.toBe(b.slug);
    expect(registry.list()).toHaveLength(2);

    const listRes = await app.request('/api/flows');
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Array<{ id: string; slug: string }>;
    const ids = list.map((d) => d.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());

    // Re-registering one entry should only update that entry.
    const updatedA = (await (
      await post(app, '/api/flows/register', {
        repoPath,
        architecturePath: '.seeflow/checkout/seeflow.json',
      })
    ).json()) as { id: string };
    expect(updatedA.id).toBe(a.id);
    expect(registry.list()).toHaveLength(2);
    expect(registry.getById(b.id)?.architecturePath).toBe('.seeflow/refund/seeflow.json');
  });
});

describe('POST /api/flows/validate', () => {
  it('returns ok:true with zero issues for a valid static demo', async () => {
    const { app } = buildApp();
    // /api/flows/validate predates the architecture/style split — it validates
    // against the merged Flow shape (position required), so we synthesize one
    // here from the architecture-only VALID_DEMO fixture.
    const validateBody = {
      ...VALID_DEMO,
      nodes: VALID_DEMO.nodes.map((n) => ({ ...n, position: { x: 0, y: 0 } })),
    };
    const res = await post(app, '/api/flows/validate', { demo: validateBody, tier: 'static' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      issues: unknown[];
      warnings: unknown[];
      stats: { tier: string; nodeCount: number };
    };
    expect(json.ok).toBe(true);
    expect(json.issues).toHaveLength(0);
    expect(json.stats.tier).toBe('static');
    expect(json.stats.nodeCount).toBe(1);
  });

  it('returns Zod issues for a malformed demo', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/flows/validate', { demo: { version: 1 } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; issues: Array<{ kind: string }> };
    expect(json.ok).toBe(false);
    expect(json.issues.some((i) => i.kind === 'zod')).toBe(true);
  });

  it('flags tier-mismatch when tier=real but no playable nodes exist', async () => {
    const { app } = buildApp();
    const staticOnly = {
      version: 2,
      name: 'Static only',
      nodes: [
        {
          id: 'box',
          type: 'shapeNode',
              data: { shape: 'rectangle' },
        },
      ],
      connectors: [],
    };
    const res = await post(app, '/api/flows/validate', { demo: staticOnly, tier: 'real' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; issues: Array<{ kind: string }> };
    expect(json.ok).toBe(false);
    expect(json.issues.some((i) => i.kind === 'tier-mismatch')).toBe(true);
  });

  it('flags cap issue when node count exceeds 30', async () => {
    const { app } = buildApp();
    const bigDemo = {
      version: 2,
      name: 'Too big',
      nodes: Array.from({ length: 31 }, (_, i) => ({
        id: `n${i}`,
        type: 'shapeNode',
          data: { shape: 'rectangle' as const },
      })),
      connectors: [],
    };
    const res = await post(app, '/api/flows/validate', { demo: bigDemo, tier: 'static' });
    const json = (await res.json()) as { issues: Array<{ kind: string }> };
    expect(json.issues.some((i) => i.kind === 'cap')).toBe(true);
  });

  // US-001: HTTP-based reachability warning no longer applies — playActions are
  // script-shaped now. A future story may add an analogous "does this script
  // file exist?" warning, but the http branch in diagram.ts is dead code under
  // the new schema.
  it.skip('warns about reachability for tier=real with http playActions', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/flows/validate', { demo: VALID_DEMO, tier: 'real' });
    const json = (await res.json()) as { warnings: Array<{ kind: string }> };
    expect(json.warnings.some((w) => w.kind === 'real-tier-reachability')).toBe(true);
  });

  it('returns 400 for malformed JSON body', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/flows/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/diagram/propose-scope', () => {
  it('returns ranked entry-point candidates from a scan-result-shaped body', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/diagram/propose-scope', {
      files: [
        { path: 'src/server.ts', category: 'code' },
        { path: 'src/lib/helper.ts', category: 'code' },
        { path: 'README.md', category: 'docs' },
        { path: 'node_modules/foo/index.js', category: 'code' },
      ],
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      candidates: Array<{ path: string; score: number; reasons: string[] }>;
    };
    expect(json.candidates.length).toBeGreaterThan(0);
    expect(json.candidates[0]?.path).toBe('src/server.ts');
    expect(json.candidates.some((c) => c.path.includes('node_modules'))).toBe(false);
  });

  it('returns empty candidates when there are no code files', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/diagram/propose-scope', {
      files: [{ path: 'README.md', category: 'docs' }],
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { candidates: unknown[] };
    expect(json.candidates).toHaveLength(0);
  });

  it('returns 400 when files is missing', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/diagram/propose-scope', {});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/diagram/assemble', () => {
  it('assembles wiring + layout into a demo with snapped positions and stats', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/diagram/assemble', {
      wiring: {
        name: 'Test Flow',
        nodes: [
          {
            id: 'API',
            type: 'playNode',
            position: { x: 11, y: 23 },
            data: {
              name: 'API',
              kind: 'service',
              stateSource: { kind: 'request' },
              playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
            },
          },
          {
            id: 'db',
            type: 'stateNode',
            position: { x: 100, y: 100 },
            data: { name: 'DB', kind: 'store', stateSource: { kind: 'request' } },
          },
        ],
        connectors: [
          { id: 'a-b', source: 'API', target: 'db', kind: 'http' },
          { source: 'ghost', target: 'db', kind: 'http' },
        ],
      },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      demo: {
        name: string;
        nodes: Array<{ id: string; position: { x: number; y: number } }>;
        connectors: unknown[];
      };
      stats: { danglingConnectorsDropped: number; positionsSnapped: number };
    };
    expect(json.demo.name).toBe('Test Flow');
    expect(json.demo.nodes.map((n) => n.id)).toEqual(['api', 'db']);
    const firstPos = json.demo.nodes[0]?.position;
    expect(firstPos).toBeDefined();
    expect((firstPos?.x ?? -1) % 24).toBe(0);
    expect((firstPos?.y ?? -1) % 24).toBe(0);
    expect(json.stats.danglingConnectorsDropped).toBe(1);
    expect(json.stats.positionsSnapped).toBeGreaterThan(0);
  });

  it('applies layout positions to override wiring positions', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/diagram/assemble', {
      wiring: {
        nodes: [{ id: 'n1', position: { x: 0, y: 0 } }],
        connectors: [],
      },
      layout: { positions: { n1: { x: 240, y: 480 } } },
    });
    const json = (await res.json()) as {
      demo: { nodes: Array<{ id: string; position: { x: number; y: number } }> };
    };
    expect(json.demo.nodes[0]?.position).toEqual({ x: 240, y: 480 });
  });

  it('returns 400 for missing wiring', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/diagram/assemble', { layout: { positions: {} } });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/flows', () => {
  it('returns the registry list as summaries', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' });

    const res = await app.request('/api/flows');
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{
      id: string;
      slug: string;
      name: string;
      repoPath: string;
      lastModified: number;
      valid: boolean;
    }>;
    expect(list).toHaveLength(1);
    expect(list[0]?.slug).toBe('checkout-flow');
    expect(list[0]?.name).toBe('Checkout Flow');
    expect(list[0]?.valid).toBe(true);
  });

  it('flags entries whose demo file no longer exists as valid:false', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' });

    rmSync(join(repoPath, '.seeflow', 'seeflow.json'));

    const list = (await (await app.request('/api/flows')).json()) as Array<{ valid: boolean }>;
    expect(list).toHaveLength(1);
    expect(list[0]?.valid).toBe(false);
  });

  it('rehydrates registered demos after the registry is rebuilt from disk', async () => {
    const registryPath = tmpRegistry();
    const repoA = tmpRepoWithDemo();
    const repoB = tmpRepoWithDemo({ ...VALID_DEMO, name: 'Other Flow' });

    const reg1 = createRegistry({ path: registryPath });
    const app1 = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry: reg1,
      disableWatcher: true,
    });
    await post(app1, '/api/flows/register', { repoPath: repoA, architecturePath: '.seeflow/seeflow.json' });
    await post(app1, '/api/flows/register', { repoPath: repoB, architecturePath: '.seeflow/seeflow.json' });

    const reg2 = createRegistry({ path: registryPath });
    const app2 = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry: reg2,
      disableWatcher: true,
    });
    const list = (await (await app2.request('/api/flows')).json()) as Array<{
      slug: string;
      valid: boolean;
    }>;
    expect(list).toHaveLength(2);
    expect(list.map((e) => e.slug).sort()).toEqual(['checkout-flow', 'other-flow']);
    expect(list.every((e) => e.valid)).toBe(true);
  });
});

describe('GET /api/flows/:id', () => {
  it('returns the validated demo + filePath when watcher is disabled (sync read fallback)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const res = await app.request(`/api/flows/${reg.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      slug: string;
      name: string;
      filePath: string;
      flow: { name: string };
      valid: boolean;
      error: string | null;
    };
    expect(body.valid).toBe(true);
    expect(body.flow.name).toBe('Checkout Flow');
    expect(body.filePath.endsWith('.seeflow/seeflow.json')).toBe(true);
    expect(body.error).toBeNull();
  });

  it('returns 404 for unknown demo ids', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/flows/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('reports valid:false + error when on-disk JSON is malformed', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    writeFileSync(join(repoPath, '.seeflow', 'seeflow.json'), '{ broken');

    const res = await app.request(`/api/flows/${reg.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { valid: boolean; error: string | null };
    expect(body.valid).toBe(false);
    expect(body.error).toContain('Invalid JSON');
  });
});

describe('POST /api/flows/:id/play/:nodeId', () => {
  // Fake ProcessSpawner: returns a SpawnHandle whose stdout/stderr come from
  // configurable strings, exited resolves on next microtask with `exitCode`
  // (default 0), and `kill()` is a recorded no-op. Captures every spawn call.
  type SpawnOpts = {
    cmd: string[];
    cwd: string;
    env: Record<string, string>;
    stdin: 'pipe' | 'ignore';
  };
  type FakeRecord = { spawnCalls: SpawnOpts[] };
  const makeFakeSpawner = (
    config: { stdout?: string; stderr?: string; exitCode?: number } = {},
  ): {
    spawner: import('./process-spawner.ts').ProcessSpawner;
    record: FakeRecord;
  } => {
    const record: FakeRecord = { spawnCalls: [] };
    const streamFromString = (s: string): ReadableStream<Uint8Array> =>
      new ReadableStream<Uint8Array>({
        start(c) {
          if (s.length > 0) c.enqueue(new TextEncoder().encode(s));
          c.close();
        },
      });
    const spawner: import('./process-spawner.ts').ProcessSpawner = {
      spawn(opts) {
        record.spawnCalls.push({ cmd: opts.cmd, cwd: opts.cwd, env: opts.env, stdin: opts.stdin });
        let resolveExit: (code: number) => void = () => {};
        const exited = new Promise<number>((res) => {
          resolveExit = res;
        });
        queueMicrotask(() => resolveExit(config.exitCode ?? 0));
        let stdinStream: WritableStream<Uint8Array> | undefined;
        if (opts.stdin === 'pipe') {
          stdinStream = new WritableStream<Uint8Array>({ write() {}, close() {}, abort() {} });
        }
        return {
          pid: 11111,
          stdout: streamFromString(config.stdout ?? ''),
          stderr: streamFromString(config.stderr ?? ''),
          stdin: stdinStream,
          exited,
          kill() {},
        };
      },
    };
    return { spawner, record };
  };

  // Fake StatusRunner: records every restart/stop/stopAll call so tests can
  // assert the /play handler fans out on each click.
  type RunnerCalls = { restart: string[]; stop: string[]; stopAll: number };
  const makeFakeStatusRunner = (): {
    runner: import('./status-runner.ts').StatusRunner;
    calls: RunnerCalls;
  } => {
    const calls: RunnerCalls = { restart: [], stop: [], stopAll: 0 };
    const runner: import('./status-runner.ts').StatusRunner = {
      async restart(flowId) {
        calls.restart.push(flowId);
      },
      async stop(flowId) {
        calls.stop.push(flowId);
      },
      async stopAll() {
        calls.stopAll++;
      },
    };
    return { runner, calls };
  };

  // Build an app with the fake spawner + fake statusRunner pre-wired so the
  // /play tests can drive runPlay through the API surface without touching the
  // OS process table or the filesystem-resident demo file beyond the spawn
  // call assembly.
  const buildPlayApp = (
    spawnerConfig: { stdout?: string; stderr?: string; exitCode?: number } = {},
  ) => {
    const { spawner, record } = makeFakeSpawner(spawnerConfig);
    const { runner, calls } = makeFakeStatusRunner();
    const bus = createEventBus();
    const registry = createRegistry({ path: tmpRegistry() });
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      events: bus,
      disableWatcher: true,
      processSpawner: spawner,
      statusRunner: runner,
    });
    return { app, bus, registry, spawnerRecord: record, runnerCalls: calls };
  };

  // Flow with a play.ts script staged inside <repo>/.seeflow/scripts/ so the
  // realpath check in proxy.ts:resolveScript passes.
  const demoWithPlayScript = (scriptPath = 'scripts/play.ts') => ({
    ...VALID_DEMO,
    nodes: [
      {
        ...VALID_DEMO.nodes[0],
        data: {
          ...VALID_DEMO.nodes[0]?.data,
          playAction: { kind: 'script', interpreter: 'bun', scriptPath },
        },
      },
    ],
  });

  const tmpRepoWithPlayScript = (scriptName = 'play.ts') => {
    const repoPath = tmpRepoWithDemo(demoWithPlayScript(`scripts/${scriptName}`));
    mkdirSync(join(repoPath, '.seeflow', 'scripts'), { recursive: true });
    writeFileSync(join(repoPath, '.seeflow', 'scripts', scriptName), '// stub\n');
    return repoPath;
  };

  it('spawns the script and returns parsed JSON body with status 200', async () => {
    const { app, spawnerRecord } = buildPlayApp({ stdout: '{"ok":true,"echoed":42}\n' });
    const repoPath = tmpRepoWithPlayScript();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/play/api-checkout`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string; status?: number; body?: unknown };
    expect(typeof body.runId).toBe('string');
    expect(body.status).toBe(200);
    expect(body.body).toEqual({ ok: true, echoed: 42 });

    // Verify the spawner was actually invoked with the resolved abs script path.
    expect(spawnerRecord.spawnCalls).toHaveLength(1);
    const call = spawnerRecord.spawnCalls[0];
    expect(call?.cmd[0]).toBe('bun');
    expect(call?.cmd[1]?.endsWith('/scripts/play.ts')).toBe(true);
    expect(call?.cwd).toBe(repoPath);
    expect(call?.env.SEEFLOW_DEMO_ID).toBe(reg.id);
    expect(call?.env.SEEFLOW_NODE_ID).toBe('api-checkout');
  });

  it('broadcasts node:running and node:done around the spawn', async () => {
    const { app, bus } = buildPlayApp({ stdout: '{"ok":true}' });
    const repoPath = tmpRepoWithPlayScript();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const captured: Array<{ type: string; payload: unknown }> = [];
    bus.subscribe(reg.id, (e) => captured.push({ type: e.type, payload: e.payload }));

    const playRes = await post(app, `/api/flows/${reg.id}/play/api-checkout`, {});
    expect(playRes.status).toBe(200);

    const types = captured.map((e) => e.type);
    expect(types[0]).toBe('node:running');
    expect(types[types.length - 1]).toBe('node:done');
    const done = captured[captured.length - 1]?.payload as { nodeId: string; status: number };
    expect(done.nodeId).toBe('api-checkout');
    expect(done.status).toBe(200);
  });

  it('Play click triggers statusRunner.restart for the flowId', async () => {
    const { app, runnerCalls } = buildPlayApp({ stdout: '{"ok":true}' });
    const repoPath = tmpRepoWithPlayScript();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/play/api-checkout`, {});
    expect(res.status).toBe(200);

    expect(runnerCalls.restart).toEqual([reg.id]);
  });

  it('a second Play click calls statusRunner.restart again', async () => {
    const { app, runnerCalls } = buildPlayApp({ stdout: '{"ok":true}' });
    const repoPath = tmpRepoWithPlayScript();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    await post(app, `/api/flows/${reg.id}/play/api-checkout`, {});
    await post(app, `/api/flows/${reg.id}/play/api-checkout`, {});

    expect(runnerCalls.restart).toEqual([reg.id, reg.id]);
  });

  it('returns 400 when the scriptPath escapes the project root via symlink', async () => {
    const { app } = buildPlayApp({ stdout: '{}' });
    // Build a demo whose playAction points at `escape.ts` (textually clean) and
    // stage a symlink at <repo>/.seeflow/escape.ts pointing outside the root.
    const repoPath = tmpRepoWithDemo({
      ...VALID_DEMO,
      nodes: [
        {
          ...VALID_DEMO.nodes[0],
          data: {
            ...VALID_DEMO.nodes[0]?.data,
            playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'escape.ts' },
          },
        },
      ],
    });
    const outside = mkdtempSync(join(tmpdir(), 'seeflow-api-out-'));
    writeFileSync(join(outside, 'evil.ts'), '// outside');
    symlinkSync(join(outside, 'evil.ts'), join(repoPath, '.seeflow', 'escape.ts'));

    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/play/api-checkout`, {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('scriptPath escapes project root');
  });

  it('returns 404 for unknown flowId', async () => {
    const { app } = buildPlayApp();
    const res = await post(app, '/api/flows/nope/play/x', {});
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown nodeId', async () => {
    const { app } = buildPlayApp({ stdout: '{}' });
    const repoPath = tmpRepoWithPlayScript();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };
    const res = await post(app, `/api/flows/${reg.id}/play/missing`, {});
    expect(res.status).toBe(404);
  });

  it('returns 400 when the node has no playAction', async () => {
    const { app } = buildPlayApp({ stdout: '{}' });
    // Build a demo whose node is a shapeNode (no playAction by definition).
    const demo = {
      version: 2,
      name: 'Shape only',
      nodes: [
        {
          id: 'shape-only',
          type: 'shapeNode',
              data: { shape: 'rectangle' },
        },
      ],
      connectors: [],
    };
    const repoPath = tmpRepoWithDemo(demo);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/play/shape-only`, {});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/flows/:id/reset', () => {
  // US-008: /reset now spawns a script (replacing the legacy HTTP resetAction)
  // and orchestrates stopAllPlays + statusRunner.stop BEFORE the spawn, plus
  // statusRunner.restart fire-and-forget after the flow:reload broadcast. The
  // suite uses an injectable proxy facade + a fake statusRunner so we can
  // assert call order across all three subsystems without spinning up real
  // child processes or stubbing an HTTP server.
  type ResetActionShape = {
    kind: 'script';
    interpreter: string;
    scriptPath: string;
    args?: string[];
  };
  const demoWithResetAction = (action: ResetActionShape) => ({
    ...VALID_DEMO,
    resetAction: action,
  });

  type ProxyCall =
    | { kind: 'stopAllPlays'; flowId: string }
    | { kind: 'runReset'; flowId: string }
    | { kind: 'runPlay'; flowId: string; nodeId: string };
  type RunnerCall = { kind: 'stop' | 'restart' | 'stopAll'; flowId?: string };

  const makeFakeProxy = (
    resetResult: { ok: boolean; body?: unknown; error?: string },
    log: Array<ProxyCall | RunnerCall>,
  ): import('./api.ts').ProxyFacade => {
    return {
      async stopAllPlays(flowId) {
        log.push({ kind: 'stopAllPlays', flowId });
      },
      async runReset({ flowId, events }) {
        log.push({ kind: 'runReset', flowId });
        events.broadcast({
          type: 'demo:reset',
          flowId,
          payload: resetResult,
        });
        return resetResult;
      },
      async runPlay({ flowId, nodeId, events }) {
        log.push({ kind: 'runPlay', flowId, nodeId });
        const runId = 'fake-run-id';
        events.broadcast({ type: 'node:done', flowId, payload: { nodeId, runId, status: 200 } });
        return { runId, status: 200, body: {} };
      },
    };
  };

  const makeFakeStatusRunner = (
    log: Array<ProxyCall | RunnerCall>,
  ): import('./status-runner.ts').StatusRunner => ({
    async stop(flowId) {
      log.push({ kind: 'stop', flowId });
    },
    async restart(flowId) {
      log.push({ kind: 'restart', flowId });
    },
    async stopAll() {
      log.push({ kind: 'stopAll' });
    },
  });

  const buildResetApp = (
    options: {
      resetResult?: { ok: boolean; body?: unknown; error?: string };
    } = {},
  ) => {
    const log: Array<ProxyCall | RunnerCall> = [];
    const bus = createEventBus();
    const registry = createRegistry({ path: tmpRegistry() });
    const proxy = makeFakeProxy(options.resetResult ?? { ok: true, body: { ok: true } }, log);
    const statusRunner = makeFakeStatusRunner(log);
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      events: bus,
      disableWatcher: true,
      proxy,
      statusRunner,
    });
    return { app, registry, bus, log };
  };

  it('returns 200 and broadcasts flow:reload when the demo has no resetAction', async () => {
    const { app, bus, log } = buildResetApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const captured: Array<{ type: string }> = [];
    bus.subscribe(reg.id, (e) => captured.push({ type: e.type }));

    const res = await post(app, `/api/flows/${reg.id}/reset`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; calledResetAction: boolean };
    expect(body.ok).toBe(true);
    expect(body.calledResetAction).toBe(false);

    expect(captured.map((e) => e.type)).toEqual(['flow:reload']);
    // stop + reload + restart still happen even when there's no resetAction;
    // runReset is the only step skipped.
    const kinds = log.map((c) => c.kind);
    expect(kinds).toContain('stopAllPlays');
    expect(kinds).toContain('stop');
    expect(kinds).toContain('restart');
    expect(kinds).not.toContain('runReset');
  });

  it('stops plays + status BEFORE invoking resetAction, then runs it, then reloads + restarts', async () => {
    const { app, log } = buildResetApp({ resetResult: { ok: true, body: { ok: true } } });
    const repoPath = tmpRepoWithDemo(
      demoWithResetAction({
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/reset.ts',
      }),
    );
    // Stage the script file so the demo doesn't fail any future realpath
    // checks (the fake proxy doesn't actually validate, but matches reality).
    mkdirSync(join(repoPath, '.seeflow', 'scripts'), { recursive: true });
    writeFileSync(join(repoPath, '.seeflow', 'scripts', 'reset.ts'), '// stub\n');

    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/reset`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; calledResetAction: boolean };
    expect(body.ok).toBe(true);
    expect(body.calledResetAction).toBe(true);

    // Order assertion: stopAllPlays + stop must both happen BEFORE runReset.
    const idxStopPlays = log.findIndex((c) => c.kind === 'stopAllPlays');
    const idxStopStatus = log.findIndex((c) => c.kind === 'stop');
    const idxRunReset = log.findIndex((c) => c.kind === 'runReset');
    const idxRestart = log.findIndex((c) => c.kind === 'restart');
    expect(idxStopPlays).toBeGreaterThanOrEqual(0);
    expect(idxStopStatus).toBeGreaterThanOrEqual(0);
    expect(idxRunReset).toBeGreaterThan(idxStopPlays);
    expect(idxRunReset).toBeGreaterThan(idxStopStatus);
    // restart is the very last call (fire-and-forget after broadcast).
    expect(idxRestart).toBeGreaterThan(idxRunReset);
  });

  it('broadcasts flow:reload AND demo:reset around a successful reset script', async () => {
    const { app, bus } = buildResetApp({ resetResult: { ok: true, body: { wiped: true } } });
    const repoPath = tmpRepoWithDemo(
      demoWithResetAction({
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/reset.ts',
      }),
    );
    mkdirSync(join(repoPath, '.seeflow', 'scripts'), { recursive: true });
    writeFileSync(join(repoPath, '.seeflow', 'scripts', 'reset.ts'), '// stub\n');

    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const captured: Array<{ type: string }> = [];
    bus.subscribe(reg.id, (e) => captured.push({ type: e.type }));

    await post(app, `/api/flows/${reg.id}/reset`, {});

    expect(captured.map((e) => e.type)).toEqual(['demo:reset', 'flow:reload']);
  });

  it('returns 502 with the error message but still broadcasts flow:reload + restarts on reset-script failure', async () => {
    const { app, bus, log } = buildResetApp({
      resetResult: { ok: false, error: 'reset script exited with code 1' },
    });
    const repoPath = tmpRepoWithDemo(
      demoWithResetAction({
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/reset.ts',
      }),
    );
    mkdirSync(join(repoPath, '.seeflow', 'scripts'), { recursive: true });
    writeFileSync(join(repoPath, '.seeflow', 'scripts', 'reset.ts'), '// stub\n');

    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const captured: Array<{ type: string }> = [];
    bus.subscribe(reg.id, (e) => captured.push({ type: e.type }));

    const res = await post(app, `/api/flows/${reg.id}/reset`, {});
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; calledResetAction: boolean };
    expect(body.calledResetAction).toBe(true);
    expect(body.error).toBe('reset script exited with code 1');

    // flow:reload still fires; statusRunner.restart still fires.
    expect(captured.map((e) => e.type)).toContain('flow:reload');
    expect(log.map((c) => c.kind)).toContain('restart');
  });

  it('returns 404 for an unknown flowId', async () => {
    const { app } = buildResetApp();
    const res = await post(app, '/api/flows/does-not-exist/reset', {});
    expect(res.status).toBe(404);
  });
});

describe('POST /api/emit', () => {
  const buildAppWithBus = () => {
    const bus = createEventBus();
    const registry = createRegistry({ path: tmpRegistry() });
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      events: bus,
      disableWatcher: true,
    });
    return { app, registry, bus };
  };

  it('broadcasts node:running for status=running and returns ok', async () => {
    const { app, bus } = buildAppWithBus();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const captured: Array<{ type: string; payload: unknown }> = [];
    bus.subscribe(reg.id, (e) => captured.push({ type: e.type, payload: e.payload }));

    const res = await post(app, '/api/emit', {
      flowId: reg.id,
      nodeId: 'worker',
      status: 'running',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.type).toBe('node:running');
    expect((captured[0]?.payload as { nodeId: string }).nodeId).toBe('worker');
  });

  it('maps status=done → node:done and merges payload', async () => {
    const { app, bus } = buildAppWithBus();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const captured: Array<{ type: string; payload: unknown }> = [];
    bus.subscribe(reg.id, (e) => captured.push({ type: e.type, payload: e.payload }));

    const res = await post(app, '/api/emit', {
      flowId: reg.id,
      nodeId: 'worker',
      status: 'done',
      runId: 'run-42',
      payload: { status: 200, body: { ok: true } },
    });
    expect(res.status).toBe(200);

    expect(captured).toHaveLength(1);
    expect(captured[0]?.type).toBe('node:done');
    const payload = captured[0]?.payload as {
      nodeId: string;
      runId: string;
      status: number;
      body: unknown;
    };
    expect(payload.nodeId).toBe('worker');
    expect(payload.runId).toBe('run-42');
    expect(payload.status).toBe(200);
    expect(payload.body).toEqual({ ok: true });
  });

  it('maps status=error → node:error', async () => {
    const { app, bus } = buildAppWithBus();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const captured: Array<{ type: string }> = [];
    bus.subscribe(reg.id, (e) => captured.push({ type: e.type }));

    const res = await post(app, '/api/emit', {
      flowId: reg.id,
      nodeId: 'worker',
      status: 'error',
      payload: { message: 'boom' },
    });
    expect(res.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.type).toBe('node:error');
  });

  it('returns 404 when flowId is unknown', async () => {
    const { app } = buildAppWithBus();
    const res = await post(app, '/api/emit', {
      flowId: 'does-not-exist',
      nodeId: 'worker',
      status: 'running',
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when status is not one of running|done|error', async () => {
    const { app } = buildAppWithBus();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const res = await post(app, '/api/emit', {
      flowId: reg.id,
      nodeId: 'worker',
      status: 'oops',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not valid JSON', async () => {
    const { app } = buildAppWithBus();
    const res = await app.request('/api/emit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/events', () => {
  it('returns 400 when flowId is missing', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/events');
    expect(res.status).toBe(400);
  });

  it('returns 404 when flowId is unknown', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/events?flowId=nope');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/flows/:id/nodes/:nodeId/position', () => {
  const patch = (app: ReturnType<typeof buildApp>['app'], path: string, body: unknown) =>
    app.request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('updates the node position and rewrites the demo file', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const styleFile = join(repoPath, '.seeflow', 'style.json');

    const res = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout/position`, {
      x: 250,
      y: 320,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; position: { x: number; y: number } };
    expect(body.ok).toBe(true);
    expect(body.position).toEqual({ x: 250, y: 320 });

    const style = JSON.parse(readFileSync(styleFile, 'utf8')) as {
      nodes: Record<string, { position: { x: number; y: number } }>;
    };
    expect(style.nodes['api-checkout']?.position).toEqual({ x: 250, y: 320 });
  });

  it('preserves 2-space indent and trailing newline (clean editor diffs)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');
    await patch(app, `/api/flows/${reg.id}/nodes/api-checkout/position`, { x: 1, y: 2 });

    const text = readFileSync(demoFile, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    // Top-level "version" line should be indented with 2 spaces.
    expect(text).toMatch(/^\{\n {2}"version": 2,/);
  });

  it('returns 404 for unknown flowId', async () => {
    const { app } = buildApp();
    const res = await patch(app, '/api/flows/nope/nodes/x/position', { x: 0, y: 0 });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown nodeId', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };
    const res = await patch(app, `/api/flows/${reg.id}/nodes/missing/position`, { x: 0, y: 0 });
    expect(res.status).toBe(404);
  });

  it('returns 400 when x or y is non-numeric', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };
    const res = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout/position`, {
      x: 'oops',
      y: 0,
    });
    expect(res.status).toBe(400);
  });

  it('writes via tempfile + rename (no .tmp residue, preserves content on success)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const dir = join(repoPath, '.seeflow');
    await patch(app, `/api/flows/${reg.id}/nodes/api-checkout/position`, { x: 99, y: 99 });

    const files = readdirSync(dir).sort();
    // Only seeflow.json + style.json should remain — temp files must be renamed/cleaned up.
    expect(files).toEqual(['seeflow.json', 'style.json']);
  });
});

describe('PATCH /api/flows/:id/nodes/:nodeId/order', () => {
  const VALID_DEMO_THREE_NODES = {
    version: 2,
    name: 'Three Nodes',
    nodes: [
      {
        id: 'a',
        type: 'shapeNode',
          data: { shape: 'rectangle' },
      },
      {
        id: 'b',
        type: 'shapeNode',
          data: { shape: 'rectangle' },
      },
      {
        id: 'c',
        type: 'shapeNode',
          data: { shape: 'rectangle' },
      },
    ],
    connectors: [],
  };

  const patch = (app: ReturnType<typeof buildApp>['app'], path: string, body: unknown) =>
    app.request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const ids = (path: string) =>
    (JSON.parse(readFileSync(path, 'utf8')) as { nodes: Array<{ id: string }> }).nodes.map(
      (n) => n.id,
    );

  const setup = async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_THREE_NODES);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };
    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');
    return { app, demoFile, flowId: reg.id };
  };

  it("op:'forward' swaps with the next neighbour", async () => {
    const { app, demoFile, flowId } = await setup();
    const res = await patch(app, `/api/flows/${flowId}/nodes/a/order`, { op: 'forward' });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['b', 'a', 'c']);
  });

  it("op:'forward' on the topmost node is a no-op", async () => {
    const { app, demoFile, flowId } = await setup();
    const res = await patch(app, `/api/flows/${flowId}/nodes/c/order`, { op: 'forward' });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['a', 'b', 'c']);
  });

  it("op:'backward' swaps with the previous neighbour", async () => {
    const { app, demoFile, flowId } = await setup();
    const res = await patch(app, `/api/flows/${flowId}/nodes/c/order`, { op: 'backward' });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['a', 'c', 'b']);
  });

  it("op:'backward' on the bottommost node is a no-op", async () => {
    const { app, demoFile, flowId } = await setup();
    const res = await patch(app, `/api/flows/${flowId}/nodes/a/order`, { op: 'backward' });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['a', 'b', 'c']);
  });

  it("op:'toFront' moves to the end of the array", async () => {
    const { app, demoFile, flowId } = await setup();
    const res = await patch(app, `/api/flows/${flowId}/nodes/a/order`, { op: 'toFront' });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['b', 'c', 'a']);
  });

  it("op:'toBack' moves to the start of the array", async () => {
    const { app, demoFile, flowId } = await setup();
    const res = await patch(app, `/api/flows/${flowId}/nodes/c/order`, { op: 'toBack' });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['c', 'a', 'b']);
  });

  it("op:'toIndex' pins to an absolute index (used by undo)", async () => {
    const { app, demoFile, flowId } = await setup();
    // Move 'a' (idx 0) to idx 2 — same as toFront on a 3-node array.
    const res = await patch(app, `/api/flows/${flowId}/nodes/a/order`, { op: 'toIndex', index: 2 });
    expect(res.status).toBe(200);
    expect(ids(demoFile)).toEqual(['b', 'c', 'a']);

    // Then pin it back to idx 0 — exact inverse.
    const res2 = await patch(app, `/api/flows/${flowId}/nodes/a/order`, {
      op: 'toIndex',
      index: 0,
    });
    expect(res2.status).toBe(200);
    expect(ids(demoFile)).toEqual(['a', 'b', 'c']);
  });

  it("op:'toIndex' clamps out-of-range indices", async () => {
    const { app, demoFile, flowId } = await setup();
    const res = await patch(app, `/api/flows/${flowId}/nodes/a/order`, {
      op: 'toIndex',
      index: 99,
    });
    expect(res.status).toBe(200);
    // Clamped to length-1 = 2 → same as toFront.
    expect(ids(demoFile)).toEqual(['b', 'c', 'a']);
  });

  it('returns 400 for an unknown op', async () => {
    const { app, demoFile, flowId } = await setup();
    const res = await patch(app, `/api/flows/${flowId}/nodes/a/order`, { op: 'noSuchOp' });
    expect(res.status).toBe(400);
    expect(ids(demoFile)).toEqual(['a', 'b', 'c']);
  });

  it('returns 404 for unknown nodeId', async () => {
    const { app, flowId } = await setup();
    const res = await patch(app, `/api/flows/${flowId}/nodes/missing/order`, { op: 'forward' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown flowId', async () => {
    const { app } = buildApp();
    const res = await patch(app, '/api/flows/nope/nodes/a/order', { op: 'forward' });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/flows/:id/nodes/:nodeId', () => {
  const patch = (app: ReturnType<typeof buildApp>['app'], path: string, body: unknown) =>
    app.request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('merges a partial update into node.data and rewrites the demo file', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');
    const styleFile = join(repoPath, '.seeflow', 'style.json');

    const res = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, {
      name: 'POST /checkout (renamed)',
      borderColor: 'blue',
      backgroundColor: 'amber',
      width: 240,
      height: 120,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const arch = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: { name: string; playAction: { kind: string } } }>;
    };
    const style = JSON.parse(readFileSync(styleFile, 'utf8')) as {
      nodes: Record<
        string,
        { borderColor?: string; backgroundColor?: string; width?: number; height?: number }
      >;
    };
    const node = arch.nodes.find((n) => n.id === 'api-checkout');
    expect(node?.data.name).toBe('POST /checkout (renamed)');
    expect(node?.data.playAction.kind).toBe('script');
    const styleEntry = style.nodes['api-checkout'];
    expect(styleEntry?.borderColor).toBe('blue');
    expect(styleEntry?.backgroundColor).toBe('amber');
    expect(styleEntry?.width).toBe(240);
    expect(styleEntry?.height).toBe(120);
  });

  it('updates node.position when included in the patch body', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const styleFile = join(repoPath, '.seeflow', 'style.json');
    const res = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, {
      position: { x: 42, y: 84 },
    });
    expect(res.status).toBe(200);

    const style = JSON.parse(readFileSync(styleFile, 'utf8')) as {
      nodes: Record<string, { position: { x: number; y: number } }>;
    };
    expect(style.nodes['api-checkout']?.position).toEqual({ x: 42, y: 84 });
  });

  it('returns 400 with issues when the patched demo would fail schema validation', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');
    const before = readFileSync(demoFile, 'utf8');

    // borderColor token outside the enum — the body schema itself should reject this.
    const res = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, {
      borderColor: 'neon-pink',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues?: unknown };
    expect(body.error).toBeTruthy();

    // The file must NOT have been touched on validation failure.
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('returns 400 when the resulting demo violates FlowSchema (empty name on functional node)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');
    const before = readFileSync(demoFile, 'utf8');

    const res = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, { name: '' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues?: unknown };
    expect(body.error).toContain('schema');

    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('returns 400 when the body has an unknown top-level key', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const res = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, {
      somethingMadeUp: true,
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown flowId', async () => {
    const { app } = buildApp();
    const res = await patch(app, '/api/flows/nope/nodes/x', { name: 'x' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown nodeId', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };
    const res = await patch(app, `/api/flows/${reg.id}/nodes/missing`, { name: 'x' });
    expect(res.status).toBe(404);
  });

  it('preserves 2-space indent + trailing newline on rewrite', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');
    await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, { name: 'Renamed' });

    const text = readFileSync(demoFile, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toMatch(/^\{\n {2}"version": 2,/);
  });

  // Three-field consolidation: description (short body) + detail (long form)
  // land at the top level of node.data and round-trip through FlowSchema
  // unchanged. Empty string on either field is the documented clear-on-
  // serialize signal — mergeNodeUpdates strips the key so the on-disk demo
  // stays compact.
  it('persists description + detail fields to data on patch', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');
    const res = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, {
      description: 'short body',
      detail: 'multi-line\nnotes about the node',
    });
    expect(res.status).toBe(200);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: { description?: string; detail?: string } }>;
    };
    const node = onDisk.nodes.find((n) => n.id === 'api-checkout');
    expect(node?.data.description).toBe('short body');
    expect(node?.data.detail).toBe('multi-line\nnotes about the node');
  });

  it('strips description / detail on disk when empty string is patched', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');
    // First set both fields, then clear them with empty strings.
    await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, {
      description: 'tmp',
      detail: 'tmp notes',
    });
    const res = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, {
      description: '',
      detail: '',
    });
    expect(res.status).toBe(200);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: Record<string, unknown> }>;
    };
    const node = onDisk.nodes.find((n) => n.id === 'api-checkout');
    expect(node?.data.description).toBeUndefined();
    expect(node?.data.detail).toBeUndefined();
    expect('description' in (node?.data ?? {})).toBe(false);
    expect('detail' in (node?.data ?? {})).toBe(false);
  });

  // US-009: persist an icon name, then clear it via null. NodePatchBodySchema
  // accepts string | null | undefined for icon; mergeNodeUpdates strips the
  // key from disk on null (same compactness rule used for description /
  // detail empty-string).
  it('persists icon name then strips it on disk when null is patched', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');
    const setRes = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, {
      icon: 'database',
    });
    expect(setRes.status).toBe(200);
    let onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: Record<string, unknown> }>;
    };
    expect(onDisk.nodes.find((n) => n.id === 'api-checkout')?.data.icon).toBe('database');

    const clearRes = await patch(app, `/api/flows/${reg.id}/nodes/api-checkout`, {
      icon: null,
    });
    expect(clearRes.status).toBe(200);
    onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; data: Record<string, unknown> }>;
    };
    const node = onDisk.nodes.find((n) => n.id === 'api-checkout');
    expect(node?.data.icon).toBeUndefined();
    expect('icon' in (node?.data ?? {})).toBe(false);
  });
});

describe('POST /api/flows/:id/nodes', () => {
  it('appends a new node and auto-generates an id when absent', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');

    const res = await post(app, `/api/flows/${reg.id}/nodes`, {
      type: 'shapeNode',
      data: { shape: 'rectangle', name: 'Note A' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^node-/);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string; type: string }>;
    };
    expect(onDisk.nodes).toHaveLength(2);
    const created = onDisk.nodes.find((n) => n.id === body.id);
    expect(created?.type).toBe('shapeNode');
  });

  it('honors a caller-provided id when given', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/nodes`, {
      id: 'sticky-note-1',
      type: 'shapeNode',
      data: { shape: 'sticky' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('sticky-note-1');
  });

  it('returns 400 with schema issues when the new node is malformed', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');
    const before = readFileSync(demoFile, 'utf8');

    // type 'shapeNode' but missing required `shape`.
    const res = await post(app, `/api/flows/${reg.id}/nodes`, {
      type: 'shapeNode',
      data: {},
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues?: unknown };
    expect(body.error).toContain('schema');

    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('returns 404 for unknown flowId', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/flows/nope/nodes', {
      type: 'shapeNode',
      data: { shape: 'rectangle' },
    });
    expect(res.status).toBe(404);
  });

  // US-015: when an htmlNode is drop-created without a client-supplied htmlPath,
  // the backend allocates `blocks/<id>.html`, writes the starter file with the
  // 'Edit me' card markup, and persists the path on the node.
  describe('htmlNode starter-file (US-015)', () => {
    it('writes blocks/<id>.html with starter content and persists htmlPath', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
      ).json()) as { id: string };

      const res = await post(app, `/api/flows/${reg.id}/nodes`, {
        type: 'htmlNode',
          data: {},
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        id: string;
        node: { type: string; data: { htmlPath: string } };
      };
      expect(body.ok).toBe(true);
      expect(body.id).toMatch(/^node-/);
      expect(body.node.type).toBe('htmlNode');
      expect(body.node.data.htmlPath).toBe(`blocks/${body.id}.html`);

      const starter = readFileSync(join(repoPath, '.seeflow', 'blocks', `${body.id}.html`), 'utf8');
      expect(starter).toContain('Edit me');
      expect(starter).toContain(`blocks/${body.id}.html`);
      expect(starter).toContain('class="text-center"');

      const onDisk = JSON.parse(
        readFileSync(join(repoPath, '.seeflow', 'seeflow.json'), 'utf8'),
      ) as {
        nodes: Array<{ id: string; type: string; data: { htmlPath?: string } }>;
      };
      const persisted = onDisk.nodes.find((n) => n.id === body.id);
      expect(persisted?.type).toBe('htmlNode');
      expect(persisted?.data.htmlPath).toBe(`blocks/${body.id}.html`);
    });

    it('respects caller-provided id when allocating blocks/<id>.html', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
      ).json()) as { id: string };

      const res = await post(app, `/api/flows/${reg.id}/nodes`, {
        id: 'hero-block',
        type: 'htmlNode',
          data: {},
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; node: { data: { htmlPath: string } } };
      expect(body.id).toBe('hero-block');
      expect(body.node.data.htmlPath).toBe('blocks/hero-block.html');

      const starter = readFileSync(join(repoPath, '.seeflow', 'blocks', 'hero-block.html'), 'utf8');
      expect(starter).toContain('blocks/hero-block.html');
    });

    it('preserves a client-supplied htmlPath and skips the starter file', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
      ).json()) as { id: string };

      const res = await post(app, `/api/flows/${reg.id}/nodes`, {
        type: 'htmlNode',
          data: { htmlPath: 'custom/hero.html' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; node: { data: { htmlPath: string } } };
      expect(body.node.data.htmlPath).toBe('custom/hero.html');

      // No starter file should have been written under blocks/.
      const blocksDir = join(repoPath, '.seeflow', 'blocks');
      let blocksExists = true;
      try {
        readdirSync(blocksDir);
      } catch {
        blocksExists = false;
      }
      expect(blocksExists).toBe(false);
    });

    it('preserves other data fields when filling in htmlPath', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
      ).json()) as { id: string };

      const res = await post(app, `/api/flows/${reg.id}/nodes`, {
        type: 'htmlNode',
          data: { name: 'Pricing card', width: 280, height: 160 },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        id: string;
        node: { data: { htmlPath: string; name: string; width: number; height: number } };
      };
      expect(body.node.data.name).toBe('Pricing card');
      expect(body.node.data.width).toBe(280);
      expect(body.node.data.height).toBe(160);
      expect(body.node.data.htmlPath).toBe(`blocks/${body.id}.html`);
    });
  });
});

describe('DELETE /api/flows/:id/nodes/:nodeId', () => {
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
    connectors: [
      { id: 'a-to-b', source: 'a', target: 'b', kind: 'default' },
      { id: 'b-to-a', source: 'b', target: 'a', kind: 'default' },
    ],
  };

  it('removes the node and cascades adjacent connectors in one write', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_TWO_NODES);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');

    const res = await app.request(`/api/flows/${reg.id}/nodes/a`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string }>;
      connectors: Array<{ id: string; source: string; target: string }>;
    };
    expect(onDisk.nodes.map((n) => n.id)).toEqual(['b']);
    // Both connectors referenced node 'a' as source or target — both removed.
    expect(onDisk.connectors).toEqual([]);
  });

  it('leaves connectors that do not reference the deleted node untouched', async () => {
    const demo = {
      ...VALID_DEMO_TWO_NODES,
      nodes: [
        ...VALID_DEMO_TWO_NODES.nodes,
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
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(demo);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');
    const res = await app.request(`/api/flows/${reg.id}/nodes/a`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      nodes: Array<{ id: string }>;
      connectors: Array<{ id: string }>;
    };
    expect(onDisk.nodes.map((n) => n.id).sort()).toEqual(['b', 'c']);
    // a-to-b is gone (source==a); b-to-c stays.
    expect(onDisk.connectors.map((c) => c.id)).toEqual(['b-to-c']);
  });

  it('returns 404 for unknown flowId', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/flows/nope/nodes/x', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown nodeId', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };
    const res = await app.request(`/api/flows/${reg.id}/nodes/missing`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  describe('htmlNode managed file delete (US-016)', () => {
    it('removes blocks/<id>.html when the htmlPath matches the studio-managed shape', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
      ).json()) as { id: string };

      const created = (await (
        await post(app, `/api/flows/${reg.id}/nodes`, {
          type: 'htmlNode',
              data: {},
        })
      ).json()) as { id: string; node: { data: { htmlPath: string } } };
      const blockFile = join(repoPath, '.seeflow', 'blocks', `${created.id}.html`);
      expect(existsSync(blockFile)).toBe(true);

      const res = await app.request(`/api/flows/${reg.id}/nodes/${created.id}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(existsSync(blockFile)).toBe(false);

      const onDisk = JSON.parse(
        readFileSync(join(repoPath, '.seeflow', 'seeflow.json'), 'utf8'),
      ) as {
        nodes: Array<{ id: string }>;
      };
      expect(onDisk.nodes.find((n) => n.id === created.id)).toBeUndefined();
    });

    it('leaves a hand-edited htmlPath file alone when the path does not match blocks/<id>.html', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
      ).json()) as { id: string };

      const customDir = join(repoPath, '.seeflow', 'custom');
      mkdirSync(customDir, { recursive: true });
      const customFile = join(customDir, 'hero.html');
      writeFileSync(customFile, '<div>hand-edited</div>');

      const created = (await (
        await post(app, `/api/flows/${reg.id}/nodes`, {
          type: 'htmlNode',
              data: { htmlPath: 'custom/hero.html' },
        })
      ).json()) as { id: string; node: { data: { htmlPath: string } } };
      expect(created.node.data.htmlPath).toBe('custom/hero.html');

      const res = await app.request(`/api/flows/${reg.id}/nodes/${created.id}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      expect(existsSync(customFile)).toBe(true);
      expect(readFileSync(customFile, 'utf8')).toBe('<div>hand-edited</div>');
    });

    it('soft-fails when the managed file is already missing', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
      ).json()) as { id: string };

      const created = (await (
        await post(app, `/api/flows/${reg.id}/nodes`, {
          type: 'htmlNode',
              data: {},
        })
      ).json()) as { id: string };
      const blockFile = join(repoPath, '.seeflow', 'blocks', `${created.id}.html`);
      unlinkSync(blockFile);
      expect(existsSync(blockFile)).toBe(false);

      const res = await app.request(`/api/flows/${reg.id}/nodes/${created.id}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      const onDisk = JSON.parse(
        readFileSync(join(repoPath, '.seeflow', 'seeflow.json'), 'utf8'),
      ) as {
        nodes: Array<{ id: string }>;
      };
      expect(onDisk.nodes.find((n) => n.id === created.id)).toBeUndefined();
    });

    it('does not touch other htmlNode-shaped files in blocks/ when an unrelated node is deleted', async () => {
      const { app } = buildApp();
      const repoPath = tmpRepoWithDemo();
      const reg = (await (
        await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
      ).json()) as { id: string };

      const first = (await (
        await post(app, `/api/flows/${reg.id}/nodes`, {
          type: 'htmlNode',
              data: {},
        })
      ).json()) as { id: string };
      const second = (await (
        await post(app, `/api/flows/${reg.id}/nodes`, {
          type: 'htmlNode',
              data: {},
        })
      ).json()) as { id: string };
      const firstFile = join(repoPath, '.seeflow', 'blocks', `${first.id}.html`);
      const secondFile = join(repoPath, '.seeflow', 'blocks', `${second.id}.html`);
      expect(existsSync(firstFile)).toBe(true);
      expect(existsSync(secondFile)).toBe(true);

      const res = await app.request(`/api/flows/${reg.id}/nodes/${first.id}`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(existsSync(firstFile)).toBe(false);
      expect(existsSync(secondFile)).toBe(true);
    });
  });
});

describe('PATCH /api/flows/:id/connectors/:connId', () => {
  const VALID_DEMO_WITH_CONN = {
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
    connectors: [{ id: 'a-to-b', source: 'a', target: 'b', kind: 'default', label: 'flow' }],
  };

  const patch = (app: ReturnType<typeof buildApp>['app'], path: string, body: unknown) =>
    app.request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('merges visual fields into the connector and rewrites the demo', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');
    const styleFile = join(repoPath, '.seeflow', 'style.json');
    const res = await patch(app, `/api/flows/${reg.id}/connectors/a-to-b`, {
      label: 'renamed',
      style: 'dashed',
      color: 'blue',
      direction: 'both',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

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

  it('changes kind and clears stale kind-specific fields from the previous kind', async () => {
    const demo = {
      ...VALID_DEMO_WITH_CONN,
      connectors: [
        {
          id: 'a-to-b',
          source: 'a',
          target: 'b',
          kind: 'event',
          eventName: 'OrderPlaced',
        },
      ],
    };
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(demo);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');
    const res = await patch(app, `/api/flows/${reg.id}/connectors/a-to-b`, { kind: 'default' });
    expect(res.status).toBe(200);

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      connectors: Array<Record<string, unknown>>;
    };
    const conn = onDisk.connectors.find((c) => c.id === 'a-to-b');
    expect(conn?.kind).toBe('default');
    // Stale 'eventName' from the previous kind must be removed.
    expect(conn?.eventName).toBeUndefined();
  });

  it('returns 400 with schema issues when the resulting connector is invalid', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');
    const before = readFileSync(demoFile, 'utf8');

    // Switching to 'event' without supplying the required eventName is a
    // schema violation surfaced by the post-mutation FlowSchema parse.
    const res = await patch(app, `/api/flows/${reg.id}/connectors/a-to-b`, { kind: 'event' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues?: unknown };
    expect(body.error).toContain('schema');
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('returns 400 when the body has an unknown top-level key', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const res = await patch(app, `/api/flows/${reg.id}/connectors/a-to-b`, {
      somethingMadeUp: true,
    });
    expect(res.status).toBe(400);
  });

  // US-022: handle ids on a connector must match the role's allowed sides.
  // Source-side handles are 'r'/'b'; target-side are 't'/'l'. Anything else
  // is a stranded endpoint at render time, so the API rejects it.
  it("accepts a valid sourceHandle ('r') / targetHandle ('t')", async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const styleFile = join(repoPath, '.seeflow', 'style.json');
    const res = await patch(app, `/api/flows/${reg.id}/connectors/a-to-b`, {
      sourceHandle: 'r',
      targetHandle: 't',
    });
    expect(res.status).toBe(200);
    const style = JSON.parse(readFileSync(styleFile, 'utf8')) as {
      connectors: Record<string, { sourceHandle?: string; targetHandle?: string }>;
    };
    const entry = style.connectors['a-to-b'];
    expect(entry?.sourceHandle).toBe('r');
    expect(entry?.targetHandle).toBe('t');
  });

  it("rejects an invalid sourceHandle ('top-bogus') with a 400", async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');
    const before = readFileSync(demoFile, 'utf8');

    const res = await patch(app, `/api/flows/${reg.id}/connectors/a-to-b`, {
      sourceHandle: 'top-bogus',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues?: unknown };
    expect(body.error).toBeTruthy();
    // The error must mention the offending field so clients can show a
    // useful message. Zod's enum error includes the path 'sourceHandle'.
    const flat = JSON.stringify(body);
    expect(flat).toContain('sourceHandle');
    // File must not have been touched on validation failure.
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it("rejects a target-only handle id on sourceHandle ('t' on source) with a 400", async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    // 't' is a valid handle id but only as a target — sending it as a
    // sourceHandle leaves a stranded endpoint, so the schema rejects it.
    const res = await patch(app, `/api/flows/${reg.id}/connectors/a-to-b`, {
      sourceHandle: 't',
    });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid targetHandle ('r' on target) with a 400", async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const res = await patch(app, `/api/flows/${reg.id}/connectors/a-to-b`, {
      targetHandle: 'r',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown flowId', async () => {
    const { app } = buildApp();
    const res = await patch(app, '/api/flows/nope/connectors/x', { label: 'x' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown connectorId', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };
    const res = await patch(app, `/api/flows/${reg.id}/connectors/missing`, { label: 'x' });
    expect(res.status).toBe(404);
  });

  // US-007: sourcePin / targetPin round-trip through the PATCH endpoint, and
  // explicit `null` clears the field on disk (mirrors the sourceHandle: null
  // clearing path from US-025).
  it('persists sourcePin / targetPin on PATCH and clears them with null (US-007)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };
    const styleFile = join(repoPath, '.seeflow', 'style.json');

    const setRes = await patch(app, `/api/flows/${reg.id}/connectors/a-to-b`, {
      sourcePin: { side: 'right', t: 0.25 },
      targetPin: { side: 'left', t: 0.75 },
    });
    expect(setRes.status).toBe(200);
    let style = JSON.parse(readFileSync(styleFile, 'utf8')) as {
      connectors: Record<string, Record<string, unknown>>;
    };
    let entry = style.connectors['a-to-b'];
    expect(entry?.sourcePin).toEqual({ side: 'right', t: 0.25 });
    expect(entry?.targetPin).toEqual({ side: 'left', t: 0.75 });

    // Clear only the source pin; target pin must survive.
    const clearRes = await patch(app, `/api/flows/${reg.id}/connectors/a-to-b`, {
      sourcePin: null,
    });
    expect(clearRes.status).toBe(200);
    style = JSON.parse(readFileSync(styleFile, 'utf8')) as {
      connectors: Record<string, Record<string, unknown>>;
    };
    entry = style.connectors['a-to-b'];
    expect(entry?.sourcePin).toBeUndefined();
    expect(entry?.targetPin).toEqual({ side: 'left', t: 0.75 });
  });

  it('rejects a sourcePin with an out-of-range t (US-007)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_CONN);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const res = await patch(app, `/api/flows/${reg.id}/connectors/a-to-b`, {
      sourcePin: { side: 'top', t: 1.5 },
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/flows/:id/connectors', () => {
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

  it('creates a connector, defaults kind to default, auto-generates id', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_TWO_NODES);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');
    const res = await post(app, `/api/flows/${reg.id}/connectors`, { source: 'a', target: 'b' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id: string };
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

  it('honors a caller-provided id and kind', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_TWO_NODES);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/connectors`, {
      id: 'my-conn',
      source: 'a',
      target: 'b',
      kind: 'event',
      eventName: 'OrderPlaced',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('my-conn');
  });

  it('returns 400 with schema issues when source references an unknown node', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_TWO_NODES);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');
    const before = readFileSync(demoFile, 'utf8');

    const res = await post(app, `/api/flows/${reg.id}/connectors`, {
      source: 'ghost',
      target: 'b',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues?: unknown };
    expect(body.error).toContain('schema');
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  // US-022: post-merge FlowSchema parse rejects invalid handle ids on POST too.
  it('returns 400 when posting a connector with an invalid sourceHandle id', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_TWO_NODES);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');
    const before = readFileSync(demoFile, 'utf8');

    const res = await post(app, `/api/flows/${reg.id}/connectors`, {
      source: 'a',
      target: 'b',
      sourceHandle: 'top-bogus',
    });
    expect(res.status).toBe(400);
    expect(readFileSync(demoFile, 'utf8')).toBe(before);
  });

  it('returns 400 with schema issues when kind-discriminated payload is missing', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_TWO_NODES);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    // kind='event' but no eventName — fails the discriminated union shape.
    const res = await post(app, `/api/flows/${reg.id}/connectors`, {
      source: 'a',
      target: 'b',
      kind: 'event',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('schema');
  });

  it('returns 404 for unknown flowId', async () => {
    const { app } = buildApp();
    const res = await post(app, '/api/flows/nope/connectors', { source: 'a', target: 'b' });
    expect(res.status).toBe(404);
  });

  // US-023: an iconNode is a valid connector endpoint in either role. The
  // schema's discriminated NodeSchema doesn't constrain who can be a source or
  // target — only that the referenced id exists in nodes[]. These two cases
  // fence that against a future change to operations.ts / schema.ts that might
  // add a node-type whitelist (the bug the user reports is UX-shaped, not
  // server-shaped, but a REST round-trip is the cheapest regression fence).
  it('accepts a connector pointing AT an iconNode (US-023)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo({
      version: 2,
      name: 'Icon target',
      nodes: [
        {
          id: 'svc',
          type: 'stateNode',
              data: { name: 'S', kind: 'svc', stateSource: { kind: 'request' } },
        },
        {
          id: 'icon-1',
          type: 'iconNode',
              data: { icon: 'shopping-cart' },
        },
      ],
      connectors: [],
    });
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/connectors`, {
      source: 'svc',
      target: 'icon-1',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    const onDisk = JSON.parse(readFileSync(join(repoPath, '.seeflow', 'seeflow.json'), 'utf8')) as {
      connectors: Array<{ id: string; source: string; target: string; kind: string }>;
    };
    expect(onDisk.connectors).toHaveLength(1);
    expect(onDisk.connectors[0]?.id).toBe(body.id);
    expect(onDisk.connectors[0]?.source).toBe('svc');
    expect(onDisk.connectors[0]?.target).toBe('icon-1');
  });

  it('accepts a connector pointing FROM an iconNode (US-023)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo({
      version: 2,
      name: 'Icon source',
      nodes: [
        {
          id: 'icon-1',
          type: 'iconNode',
              data: { icon: 'shopping-cart' },
        },
        {
          id: 'svc',
          type: 'stateNode',
              data: { name: 'S', kind: 'svc', stateSource: { kind: 'request' } },
        },
      ],
      connectors: [],
    });
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/connectors`, {
      source: 'icon-1',
      target: 'svc',
    });
    expect(res.status).toBe(200);
    const onDisk = JSON.parse(readFileSync(join(repoPath, '.seeflow', 'seeflow.json'), 'utf8')) as {
      connectors: Array<{ source: string; target: string }>;
    };
    expect(onDisk.connectors).toHaveLength(1);
    expect(onDisk.connectors[0]?.source).toBe('icon-1');
    expect(onDisk.connectors[0]?.target).toBe('svc');
  });

  it('accepts a connector between two iconNodes (US-023)', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo({
      version: 2,
      name: 'Icon-to-icon',
      nodes: [
        {
          id: 'icon-a',
          type: 'iconNode',
              data: { icon: 'circle' },
        },
        {
          id: 'icon-b',
          type: 'iconNode',
              data: { icon: 'square' },
        },
      ],
      connectors: [],
    });
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const res = await post(app, `/api/flows/${reg.id}/connectors`, {
      source: 'icon-a',
      target: 'icon-b',
    });
    expect(res.status).toBe(200);
    const onDisk = JSON.parse(readFileSync(join(repoPath, '.seeflow', 'seeflow.json'), 'utf8')) as {
      connectors: Array<{ source: string; target: string }>;
    };
    expect(onDisk.connectors[0]?.source).toBe('icon-a');
    expect(onDisk.connectors[0]?.target).toBe('icon-b');
  });
});

describe('DELETE /api/flows/:id/connectors/:connId', () => {
  const VALID_DEMO_WITH_TWO_CONNS = {
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
    connectors: [
      { id: 'a-to-b', source: 'a', target: 'b', kind: 'default' },
      { id: 'b-to-a', source: 'b', target: 'a', kind: 'default' },
    ],
  };

  it('removes only the targeted connector and leaves the rest', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_TWO_CONNS);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const demoFile = join(repoPath, '.seeflow', 'seeflow.json');
    const res = await app.request(`/api/flows/${reg.id}/connectors/a-to-b`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const onDisk = JSON.parse(readFileSync(demoFile, 'utf8')) as {
      connectors: Array<{ id: string }>;
    };
    expect(onDisk.connectors.map((c) => c.id)).toEqual(['b-to-a']);
  });

  it('returns 404 for unknown flowId', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/flows/nope/connectors/x', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown connectorId', async () => {
    const { app } = buildApp();
    const repoPath = tmpRepoWithDemo(VALID_DEMO_WITH_TWO_CONNS);
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };
    const res = await app.request(`/api/flows/${reg.id}/connectors/missing`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/flows/:id', () => {
  it('removes the entry and returns ok', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string };

    const res = await app.request(`/api/flows/${reg.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(registry.list()).toHaveLength(0);
  });

  it('removes the entry when requested by slug', async () => {
    const { app, registry } = buildApp();
    const repoPath = tmpRepoWithDemo();
    const reg = (await (
      await post(app, '/api/flows/register', { repoPath, architecturePath: '.seeflow/seeflow.json' })
    ).json()) as { id: string; slug: string };

    const res = await app.request(`/api/flows/${reg.slug}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(registry.list()).toHaveLength(0);
  });

  it('returns 404 for unknown ids', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/flows/does-not-exist', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/projects', () => {
  it('detects an existing SeeFlow project at <projectBaseDir>/<slug>/.seeflow/seeflow.json and registers it as-is', async () => {
    const projectBaseDir = mkdtempSync(join(tmpdir(), 'seeflow-create-existing-'));
    const registry = createRegistry({ path: tmpRegistry() });
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      disableWatcher: true,
      projectBaseDir,
    });
    // Pre-create the expected project path.
    const projectPath = join(projectBaseDir, 'existing-project');
    mkdirSync(join(projectPath, '.seeflow'), { recursive: true });
    const existingDemo = { version: 2, name: 'Existing Project', nodes: [], connectors: [] };
    writeFileSync(join(projectPath, '.seeflow', 'architecture.json'), JSON.stringify(existingDemo));
    const beforeBytes = readFileSync(join(projectPath, '.seeflow', 'architecture.json'), 'utf-8');

    const res = await post(app, '/api/projects', { name: 'Existing Project' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; slug: string; scaffolded: boolean };
    expect(body.id).toBeTruthy();
    expect(body.slug).toBe('existing-project');
    expect(body.scaffolded).toBe(false);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.repoPath).toBe(projectPath);
    // Existing architecture.json content is untouched (no overwrite, no scaffold).
    expect(readFileSync(join(projectPath, '.seeflow', 'architecture.json'), 'utf-8')).toBe(
      beforeBytes,
    );
  });

  it('scaffolds a fresh project (folder + .seeflow/seeflow.json) when the target has no setup', async () => {
    const projectBaseDir = mkdtempSync(join(tmpdir(), 'seeflow-create-fresh-'));
    const registry = createRegistry({ path: tmpRegistry() });
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      disableWatcher: true,
      projectBaseDir,
    });

    const res = await post(app, '/api/projects', { name: 'Fresh Project' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; slug: string; scaffolded: boolean };
    expect(body.scaffolded).toBe(true);
    expect(body.slug).toBe('fresh-project');
    expect(registry.list()).toHaveLength(1);

    const written = JSON.parse(
      readFileSync(
        join(projectBaseDir, 'fresh-project', '.seeflow', 'architecture.json'),
        'utf-8',
      ),
    );
    expect(written).toEqual({ version: 2, name: 'Fresh Project', nodes: [], connectors: [] });
  });

  it('rejects empty name with 400', async () => {
    const { app, registry } = buildApp();
    const res = await post(app, '/api/projects', { name: '' });
    expect(res.status).toBe(400);
    expect(registry.list()).toHaveLength(0);
  });

  it('returns 400 with issues when an existing demo file fails schema validation', async () => {
    const projectBaseDir = mkdtempSync(join(tmpdir(), 'seeflow-create-bad-'));
    const registry = createRegistry({ path: tmpRegistry() });
    const app = createApp({
      mode: 'prod',
      staticRoot: './dist/web',
      registry,
      disableWatcher: true,
      projectBaseDir,
    });
    // Pre-create an invalid architecture.json at the expected path.
    const projectPath = join(projectBaseDir, 'bad');
    mkdirSync(join(projectPath, '.seeflow'), { recursive: true });
    writeFileSync(
      join(projectPath, '.seeflow', 'architecture.json'),
      JSON.stringify({ version: 1 }),
    );

    const res = await post(app, '/api/projects', { name: 'Bad' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues?: Array<{ path: unknown[] }> };
    expect(body.error).toContain('schema validation');
    expect(body.issues?.length ?? 0).toBeGreaterThan(0);
    expect(registry.list()).toHaveLength(0);
  });
});
