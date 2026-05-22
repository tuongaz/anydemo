import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type StudioEvent, createEventBus } from './events.ts';
import type { ProcessSpawner, SpawnHandle, SpawnOptions } from './process-spawner.ts';
import type { FlowEntry, Registry } from './registry.ts';
import { createStatusRunner } from './status-runner.ts';

interface FakeSpawnConfig {
  stdout?: string;
  stderr?: string;
  /** Exit code if the script exits without being killed. */
  exitCode?: number;
  /** When true, exited never resolves on its own — only kill() resolves it. */
  neverExit?: boolean;
  /** Signals on which kill resolves exit. Default: both. */
  killExitsOn?: Array<'SIGTERM' | 'SIGKILL'>;
}

interface SpawnRecord {
  options: SpawnOptions;
  killCalls: Array<'SIGTERM' | 'SIGKILL'>;
}

function streamFromString(s: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (s.length > 0) controller.enqueue(new TextEncoder().encode(s));
      controller.close();
    },
  });
}

function makeFakeSpawner(configFor: (index: number, opts: SpawnOptions) => FakeSpawnConfig): {
  spawner: ProcessSpawner;
  spawns: SpawnRecord[];
} {
  const spawns: SpawnRecord[] = [];
  const spawner: ProcessSpawner = {
    spawn(spawnOpts) {
      const idx = spawns.length;
      const record: SpawnRecord = { options: spawnOpts, killCalls: [] };
      spawns.push(record);
      const config = configFor(idx, spawnOpts);
      const killExitsOn = new Set(config.killExitsOn ?? ['SIGTERM', 'SIGKILL']);

      let resolveExit!: (code: number) => void;
      const exited = new Promise<number>((res) => {
        resolveExit = res;
      });
      if (!config.neverExit) {
        // Resolve on next microtask so tests can race against timers deterministically.
        queueMicrotask(() => resolveExit(config.exitCode ?? 0));
      }

      const handle: SpawnHandle = {
        pid: 10_000 + idx,
        stdout: streamFromString(config.stdout ?? ''),
        stderr: streamFromString(config.stderr ?? ''),
        stdin: undefined,
        exited,
        kill(signal) {
          record.killCalls.push(signal);
          if (killExitsOn.has(signal)) {
            resolveExit(signal === 'SIGTERM' ? 143 : 137);
          }
        },
      };
      return handle;
    },
  };
  return { spawner, spawns };
}

function makeFakeRegistry(entries: FlowEntry[]): Registry {
  const map = new Map(entries.map((e) => [e.id, e]));
  return {
    path: '/tmp/fake-registry.json',
    list: () => [...map.values()],
    getById: (id) => map.get(id),
    getBySlug: () => undefined,
    resolve: (id) => map.get(id),
    getByRepoPath: () => undefined,
    getByRepoPathAndFlowPath: () => undefined,
    upsert() {
      throw new Error('not implemented in fake');
    },
    remove: () => false,
    onChange: () => () => {},
    reload: () => {},
    isOwnWrite: () => false,
  };
}

const tmpDirs: string[] = [];

function makeProject(opts: { hasStatus: boolean; nodeId?: string; statusScriptName?: string }) {
  const cwd = mkdtempSync(join(tmpdir(), 'seeflow-status-'));
  tmpDirs.push(cwd);
  const statusScriptName = opts.statusScriptName ?? 'status.ts';
  const nodeId = opts.nodeId ?? 'status-node';
  const nodeScripts = join(cwd, 'nodes', nodeId, 'scripts');
  mkdirSync(nodeScripts, { recursive: true });
  writeFileSync(join(nodeScripts, statusScriptName), '// stub for tests');
  writeFileSync(join(nodeScripts, 'play.ts'), '// stub for tests');
  const demo = {
    version: 2,
    name: 'Test demo',
    nodes: [
      {
        id: nodeId,
        type: 'stateNode',
        data: {
          name: 'Status',
          kind: 'state',
          stateSource: { kind: 'request' },
          ...(opts.hasStatus
            ? {
                statusAction: {
                  kind: 'script',
                  interpreter: 'bun',
                  args: ['run'],
                  scriptPath: `scripts/${statusScriptName}`,
                  maxLifetimeMs: 60_000,
                },
              }
            : {}),
        },
      },
    ],
    connectors: [],
  };
  const flowPath = join(cwd, 'flow.json');
  writeFileSync(flowPath, JSON.stringify(demo, null, 2));
  return {
    cwd,
    nodeId,
    entry: {
      id: 'demoA',
      slug: 'demo-a',
      name: 'Test demo',
      repoPath: cwd,
      flowPath: 'flow.json',
      lastModified: Date.now(),
      valid: true,
    } satisfies FlowEntry,
  };
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const d = tmpDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function captureEvents(bus: ReturnType<typeof createEventBus>, flowId: string): StudioEvent[] {
  const list: StudioEvent[] = [];
  bus.subscribe(flowId, (e) => list.push(e));
  return list;
}

describe('createStatusRunner', () => {
  it('parses a single stdout line into a node:status broadcast', async () => {
    const { entry, nodeId } = makeProject({ hasStatus: true });
    const bus = createEventBus();
    const captured = captureEvents(bus, 'demoA');
    const { spawner } = makeFakeSpawner(() => ({
      stdout: `${JSON.stringify({ state: 'pending', summary: '1 pending', data: { pending: 1 } })}\n`,
      exitCode: 0,
    }));
    const runner = createStatusRunner({
      registry: makeFakeRegistry([entry]),
      events: bus,
      spawner,
    });

    await runner.restart('demoA');
    await runner.stop('demoA');

    const statusEvents = captured.filter((e) => e.type === 'node:status');
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0]?.payload).toMatchObject({
      nodeId,
      state: 'pending',
      summary: '1 pending',
      data: { pending: 1 },
    });
  });

  it('parses multi-line stdout into one broadcast per non-empty line', async () => {
    const { entry } = makeProject({ hasStatus: true });
    const bus = createEventBus();
    const captured = captureEvents(bus, 'demoA');
    const lines = [
      JSON.stringify({ state: 'pending', summary: 'tick 1' }),
      JSON.stringify({ state: 'ok', summary: 'tick 2' }),
      JSON.stringify({ state: 'ok', summary: 'tick 3' }),
    ];
    const { spawner } = makeFakeSpawner(() => ({
      stdout: `${lines.join('\n')}\n`,
      exitCode: 0,
    }));
    const runner = createStatusRunner({
      registry: makeFakeRegistry([entry]),
      events: bus,
      spawner,
    });

    await runner.restart('demoA');
    await runner.stop('demoA');

    const statusEvents = captured.filter((e) => e.type === 'node:status');
    expect(statusEvents).toHaveLength(3);
    expect(statusEvents.map((e) => (e.payload as { summary: string }).summary)).toEqual([
      'tick 1',
      'tick 2',
      'tick 3',
    ]);
  });

  it('skips malformed lines (no JSON / schema invalid) and continues processing', async () => {
    const { entry } = makeProject({ hasStatus: true });
    const bus = createEventBus();
    const captured = captureEvents(bus, 'demoA');
    const lines = [
      JSON.stringify({ state: 'ok', summary: 'first' }),
      'not-json-at-all',
      JSON.stringify({ state: 'bogus', summary: 'invalid state' }), // schema-invalid
      JSON.stringify({ state: 'warn', summary: 'third' }),
    ];
    const { spawner } = makeFakeSpawner(() => ({
      stdout: `${lines.join('\n')}\n`,
      exitCode: 0,
    }));
    // Suppress noisy warnings during test execution.
    const origWarn = console.warn;
    const warns: string[] = [];
    console.warn = (msg: unknown) => {
      warns.push(String(msg));
    };

    const runner = createStatusRunner({
      registry: makeFakeRegistry([entry]),
      events: bus,
      spawner,
    });

    try {
      await runner.restart('demoA');
      await runner.stop('demoA');
    } finally {
      console.warn = origWarn;
    }

    const statusEvents = captured.filter((e) => e.type === 'node:status');
    expect(statusEvents).toHaveLength(2);
    expect(statusEvents.map((e) => (e.payload as { summary: string }).summary)).toEqual([
      'first',
      'third',
    ]);
    expect(warns.length).toBe(2);
  });

  it('restart kills the previous batch (SIGTERM) and respawns', async () => {
    const { entry } = makeProject({ hasStatus: true });
    const bus = createEventBus();
    captureEvents(bus, 'demoA');
    const { spawner, spawns } = makeFakeSpawner(() => ({
      stdout: '',
      neverExit: true,
      killExitsOn: ['SIGTERM'],
    }));

    const runner = createStatusRunner({
      registry: makeFakeRegistry([entry]),
      events: bus,
      spawner,
    });

    await runner.restart('demoA');
    expect(spawns).toHaveLength(1);

    await runner.restart('demoA');
    expect(spawns).toHaveLength(2);
    expect(spawns[0]?.killCalls).toContain('SIGTERM');
    expect(spawns[1]?.killCalls).toHaveLength(0);

    await runner.stopAll();
  });

  it('isolates demos: restart on demo A does not touch demo B', async () => {
    const { entry: entryA } = makeProject({ hasStatus: true, nodeId: 'a-node' });
    const projB = makeProject({ hasStatus: true, nodeId: 'b-node' });
    const entryB: FlowEntry = { ...projB.entry, id: 'demoB', slug: 'demo-b' };

    const bus = createEventBus();
    captureEvents(bus, 'demoA');
    captureEvents(bus, 'demoB');
    const { spawner, spawns } = makeFakeSpawner(() => ({
      stdout: '',
      neverExit: true,
      killExitsOn: ['SIGTERM'],
    }));
    const runner = createStatusRunner({
      registry: makeFakeRegistry([entryA, entryB]),
      events: bus,
      spawner,
    });

    await runner.restart('demoA'); // index 0 = A
    await runner.restart('demoB'); // index 1 = B
    expect(spawns).toHaveLength(2);

    await runner.restart('demoA'); // kills A's first, spawns A's second (index 2)
    expect(spawns).toHaveLength(3);
    expect(spawns[0]?.killCalls).toContain('SIGTERM'); // A killed
    expect(spawns[1]?.killCalls).toHaveLength(0); // B untouched

    await runner.stopAll();
    expect(spawns[1]?.killCalls).toContain('SIGTERM');
    expect(spawns[2]?.killCalls).toContain('SIGTERM');
  });

  it('enforces maxLifetimeMs: kills process and emits final error event', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'seeflow-status-'));
    tmpDirs.push(cwd);
    mkdirSync(join(cwd, 'nodes', 'n1', 'scripts'), { recursive: true });
    writeFileSync(join(cwd, 'nodes', 'n1', 'scripts', 'status.ts'), '// stub');
    const demo = {
      version: 2,
      name: 'Lifetime test',
      nodes: [
        {
          id: 'n1',
          type: 'stateNode',
          data: {
            name: 'Status',
            kind: 'state',
            stateSource: { kind: 'request' },
            statusAction: {
              kind: 'script',
              interpreter: 'bun',
              args: ['run'],
              scriptPath: 'scripts/status.ts',
              maxLifetimeMs: 50,
            },
          },
        },
      ],
      connectors: [],
    };
    writeFileSync(join(cwd, 'flow.json'), JSON.stringify(demo));
    const entry: FlowEntry = {
      id: 'demoA',
      slug: 'demo-a',
      name: 'Lifetime test',
      repoPath: cwd,
      flowPath: 'flow.json',
      lastModified: Date.now(),
      valid: true,
    };

    const bus = createEventBus();
    const captured = captureEvents(bus, 'demoA');
    const { spawner, spawns } = makeFakeSpawner(() => ({
      stdout: '',
      neverExit: true,
      killExitsOn: ['SIGTERM'],
    }));
    const runner = createStatusRunner({
      registry: makeFakeRegistry([entry]),
      events: bus,
      spawner,
    });

    await runner.restart('demoA');
    // Wait long enough for the 50ms lifetime timer to fire.
    await new Promise((res) => setTimeout(res, 150));

    expect(spawns[0]?.killCalls).toContain('SIGTERM');
    const statusEvents = captured.filter((e) => e.type === 'node:status');
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0]?.payload).toMatchObject({
      nodeId: 'n1',
      state: 'error',
      summary: 'status script exceeded maxLifetimeMs',
    });

    await runner.stopAll();
  });

  it('on unsolicited exit code !== 0 broadcasts a final error event', async () => {
    const { entry, nodeId } = makeProject({ hasStatus: true });
    const bus = createEventBus();
    const captured = captureEvents(bus, 'demoA');
    const { spawner } = makeFakeSpawner(() => ({
      stdout: '',
      stderr: 'boom\n',
      exitCode: 2,
    }));
    const runner = createStatusRunner({
      registry: makeFakeRegistry([entry]),
      events: bus,
      spawner,
    });

    await runner.restart('demoA');
    // Yield a macrotask so the exit handler fires before we assert. In real
    // usage, a long-running status script doesn't exit during the same tick as
    // restart; this yield mirrors that ordering.
    await new Promise((res) => setTimeout(res, 0));

    const statusEvents = captured.filter((e) => e.type === 'node:status');
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0]?.payload).toMatchObject({
      nodeId,
      state: 'error',
      summary: 'status script exited with code 2',
    });

    await runner.stopAll();
  });

  it('restart with no statusAction nodes still kills the previous batch (idempotent on empty)', async () => {
    // Start with a project that has a statusAction; restart spawns one script.
    const proj1 = makeProject({ hasStatus: true });
    const bus = createEventBus();
    captureEvents(bus, 'demoA');
    const { spawner, spawns } = makeFakeSpawner(() => ({
      stdout: '',
      neverExit: true,
      killExitsOn: ['SIGTERM'],
    }));

    const entryWithStatus = proj1.entry;
    let entry = entryWithStatus;
    const runner = createStatusRunner({
      registry: {
        path: '/tmp/fake-registry.json',
        list: () => [entry],
        getById: () => entry,
        getBySlug: () => undefined,
        resolve: () => entry,
        getByRepoPath: () => undefined,
        getByRepoPathAndFlowPath: () => undefined,
        upsert: () => {
          throw new Error('nope');
        },
        remove: () => false,
        onChange: () => () => {},
        reload: () => {},
        isOwnWrite: () => false,
      },
      events: bus,
      spawner,
    });

    await runner.restart('demoA');
    expect(spawns).toHaveLength(1);

    // Swap in a demo file with no statusAction nodes.
    const proj2 = makeProject({ hasStatus: false });
    entry = proj2.entry;
    // Reuse flowId so the runner's internal map matches the previous batch.
    entry.id = 'demoA';

    await runner.restart('demoA');
    expect(spawns[0]?.killCalls).toContain('SIGTERM');
    expect(spawns).toHaveLength(1); // no new spawn since no status nodes
  });

  it('status-runner anchors scriptPath at nodes/<nodeId>/', async () => {
    const { entry, nodeId, cwd } = makeProject({ hasStatus: true, nodeId: 'checkout-api' });
    const bus = createEventBus();
    const captured = captureEvents(bus, 'demoA');
    const { spawner, spawns } = makeFakeSpawner(() => ({
      stdout: '',
      neverExit: true,
      killExitsOn: ['SIGTERM'],
    }));
    const runner = createStatusRunner({
      registry: makeFakeRegistry([entry]),
      events: bus,
      spawner,
    });

    await runner.restart('demoA');

    // Spawn must have happened (no SCRIPT_PATH_ESCAPE), and the absolute
    // script path must be rooted at the per-node folder.
    expect(spawns).toHaveLength(1);
    const absPath = spawns[0]?.options.cmd.at(-1) ?? '';
    expect(absPath).toContain(`/nodes/${nodeId}/scripts/`);
    // No error broadcast.
    const errors = captured.filter(
      (e) => e.type === 'node:status' && (e.payload as { state?: string }).state === 'error',
    );
    expect(errors).toHaveLength(0);

    await runner.stopAll();
    // touch cwd to satisfy unused checker
    expect(cwd).toBe(entry.repoPath);
  });

  it('sets SEEFLOW_* env vars and assembles cmd correctly per spawn', async () => {
    const { entry, nodeId } = makeProject({ hasStatus: true });
    const bus = createEventBus();
    captureEvents(bus, 'demoA');
    const { spawner, spawns } = makeFakeSpawner(() => ({
      stdout: '',
      neverExit: true,
      killExitsOn: ['SIGTERM'],
    }));
    const runner = createStatusRunner({
      registry: makeFakeRegistry([entry]),
      events: bus,
      spawner,
    });

    await runner.restart('demoA');
    const call = spawns[0]?.options;
    if (!call) throw new Error('expected at least one spawn');
    expect(call.cmd[0]).toBe('bun');
    expect(call.cmd[1]).toBe('run');
    expect(call.cmd[call.cmd.length - 1]?.endsWith('/scripts/status.ts')).toBe(true);
    expect(call.cwd).toBe(entry.repoPath);
    expect(call.env.SEEFLOW_DEMO_ID).toBe('demoA');
    expect(call.env.SEEFLOW_NODE_ID).toBe(nodeId);
    const runId = call.env.SEEFLOW_RUN_ID;
    if (!runId) throw new Error('expected SEEFLOW_RUN_ID to be set');
    expect(typeof runId).toBe('string');
    expect(runId.length).toBeGreaterThan(0);
    expect(call.stdin).toBe('ignore');

    await runner.stopAll();
  });
});
