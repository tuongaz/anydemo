import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type StudioEvent, createEventBus } from './events.ts';
import type { ProcessSpawner, SpawnHandle, SpawnOptions } from './process-spawner.ts';
import { runPlay, runReset, stopAllPlays } from './proxy.ts';

type Captured = { type: string; payload: Record<string, unknown> };
type CapturedStdin = { text: string; closed: boolean };

interface FakeOptions {
  stdout?: string;
  stderr?: string;
  /** Exit code if the script "exits naturally" (i.e. without being killed). */
  exitCode?: number;
  /** When set, exited never resolves on its own — only `kill()` resolves it. */
  neverExit?: boolean;
  /**
   * Signals on which `kill(signal)` resolves the exit promise. Use to model
   * a process that ignores SIGTERM but dies on SIGKILL.
   */
  killExitsOn?: Array<'SIGTERM' | 'SIGKILL'>;
}

interface FakeRecord {
  spawnCalls: SpawnOptions[];
  killCalls: Array<'SIGTERM' | 'SIGKILL'>;
  stdin: CapturedStdin;
}

function streamFromString(s: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (s.length > 0) controller.enqueue(new TextEncoder().encode(s));
      controller.close();
    },
  });
}

function captureStdin(): { stream: WritableStream<Uint8Array>; captured: CapturedStdin } {
  const captured: CapturedStdin = { text: '', closed: false };
  const decoder = new TextDecoder();
  const stream = new WritableStream<Uint8Array>({
    write(chunk) {
      captured.text += decoder.decode(chunk, { stream: true });
    },
    close() {
      captured.text += decoder.decode();
      captured.closed = true;
    },
    abort() {
      captured.closed = true;
    },
  });
  return { stream, captured };
}

function makeFakeSpawner(opts: FakeOptions): { spawner: ProcessSpawner; record: FakeRecord } {
  const exitsOn = new Set(opts.killExitsOn ?? ['SIGTERM', 'SIGKILL']);
  const record: FakeRecord = {
    spawnCalls: [],
    killCalls: [],
    stdin: { text: '', closed: false },
  };
  const spawner: ProcessSpawner = {
    spawn(spawnOpts) {
      record.spawnCalls.push(spawnOpts);
      let resolveExit: (code: number) => void = () => {};
      const exited = new Promise<number>((res) => {
        resolveExit = res;
      });
      let exitFn: () => void = () => {};

      if (!opts.neverExit) {
        // Resolve next tick so consumers can race against timeouts deterministically.
        exitFn = () => resolveExit(opts.exitCode ?? 0);
        queueMicrotask(exitFn);
      }

      let stdinStream: WritableStream<Uint8Array> | undefined;
      if (spawnOpts.stdin === 'pipe') {
        const cap = captureStdin();
        stdinStream = cap.stream;
        record.stdin = cap.captured;
      }

      const handle: SpawnHandle = {
        pid: 12345,
        stdout: streamFromString(opts.stdout ?? ''),
        stderr: streamFromString(opts.stderr ?? ''),
        stdin: stdinStream,
        exited,
        kill(signal) {
          record.killCalls.push(signal);
          if (exitsOn.has(signal)) {
            resolveExit(signal === 'SIGTERM' ? 143 : 137);
          }
        },
      };
      return handle;
    },
  };
  return { spawner, record };
}

const tmpDirs: string[] = [];

function makeProjectWithScript(scriptName = 'play.ts'): { cwd: string; scriptPath: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'seeflow-proxy-'));
  tmpDirs.push(cwd);
  mkdirSync(join(cwd, 'scripts'), { recursive: true });
  writeFileSync(join(cwd, 'scripts', scriptName), '// stub for tests');
  return { cwd, scriptPath: `scripts/${scriptName}` };
}

// Per-node anchor: writes the script under `nodes/<nodeId>/scripts/`
// so it matches the new runPlay resolver. Reset tests continue to use the
// legacy anchor (`scripts/`) via makeProjectWithScript.
function makeProjectWithNodeScript(
  nodeId: string,
  scriptName = 'play.ts',
): { cwd: string; scriptPath: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'seeflow-proxy-'));
  tmpDirs.push(cwd);
  const dir = join(cwd, 'nodes', nodeId, 'scripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, scriptName), '// stub for tests');
  return { cwd, scriptPath: `scripts/${scriptName}` };
}

// Drop the script into an additional node folder inside an existing cwd.
function addNodeScript(cwd: string, nodeId: string, scriptName = 'play.ts'): void {
  const dir = join(cwd, 'nodes', nodeId, 'scripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, scriptName), '// stub for tests');
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const d = tmpDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function captureEvents(bus: ReturnType<typeof createEventBus>, flowId: string): Captured[] {
  const captured: Captured[] = [];
  bus.subscribe(flowId, (e: StudioEvent) =>
    captured.push({ type: e.type, payload: e.payload as Record<string, unknown> }),
  );
  return captured;
}

describe('runPlay (script spawner)', () => {
  it('returns parsed JSON body when stdout is valid JSON and exit is 0', async () => {
    const { cwd, scriptPath } = makeProjectWithNodeScript('node1');
    const bus = createEventBus();
    const captured = captureEvents(bus, 'demoA');
    const { spawner } = makeFakeSpawner({ stdout: '{"ok":true,"n":42}\n' });

    const result = await runPlay({
      events: bus,
      flowId: 'demoA',
      nodeId: 'node1',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      spawner,
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, n: 42 });
    expect(result.error).toBeUndefined();
    expect(typeof result.runId).toBe('string');
    expect(captured.map((e) => e.type)).toEqual(['node:running', 'node:done']);
    const done = captured[1];
    expect(done?.payload).toMatchObject({
      nodeId: 'node1',
      status: 200,
      body: { ok: true, n: 42 },
    });
    expect(done?.payload.runId).toBe(result.runId);
  });

  it('returns raw string body when stdout is not valid JSON', async () => {
    const { cwd, scriptPath } = makeProjectWithNodeScript('n1');
    const bus = createEventBus();
    captureEvents(bus, 'demoA');
    const { spawner } = makeFakeSpawner({ stdout: 'hello world (not json)\n' });

    const result = await runPlay({
      events: bus,
      flowId: 'demoA',
      nodeId: 'n1',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      spawner,
    });

    expect(result.status).toBe(200);
    expect(result.body).toBe('hello world (not json)\n');
  });

  it('on exit code !== 0, surfaces the last non-empty stderr line as the error', async () => {
    const { cwd, scriptPath } = makeProjectWithNodeScript('n1');
    const bus = createEventBus();
    const captured = captureEvents(bus, 'demoA');
    const stderr = 'warming up\n\nerror: ENOENT something\n';
    const { spawner } = makeFakeSpawner({ exitCode: 1, stderr });

    const result = await runPlay({
      events: bus,
      flowId: 'demoA',
      nodeId: 'n1',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      spawner,
    });

    expect(result.status).toBeUndefined();
    expect(result.error).toBe('error: ENOENT something');
    const types = captured.map((e) => e.type);
    expect(types).toEqual(['node:running', 'node:error']);
    expect(captured[1]?.payload).toMatchObject({
      nodeId: 'n1',
      message: 'error: ENOENT something',
    });
  });

  it('on timeout, escalates SIGTERM → SIGKILL and reports the timeout error', async () => {
    const { cwd, scriptPath } = makeProjectWithNodeScript('n1');
    const bus = createEventBus();
    const captured = captureEvents(bus, 'demoA');
    // Process ignores SIGTERM, only dies on SIGKILL.
    const { spawner, record } = makeFakeSpawner({
      neverExit: true,
      killExitsOn: ['SIGKILL'],
    });

    const result = await runPlay({
      events: bus,
      flowId: 'demoA',
      nodeId: 'n1',
      cwd,
      action: {
        kind: 'script',
        interpreter: 'bun',
        scriptPath,
        timeoutMs: 50,
      },
      spawner,
    });

    expect(result.error).toBe('script timed out after 50ms');
    expect(record.killCalls).toEqual(['SIGTERM', 'SIGKILL']);
    const types = captured.map((e) => e.type);
    expect(types).toEqual(['node:running', 'node:error']);
    expect(captured[1]?.payload).toMatchObject({
      nodeId: 'n1',
      message: 'script timed out after 50ms',
    });
  }, 10_000);

  it('writes JSON.stringify(input) to stdin and closes it', async () => {
    const { cwd, scriptPath } = makeProjectWithNodeScript('n1');
    const bus = createEventBus();
    captureEvents(bus, 'demoA');
    const { spawner, record } = makeFakeSpawner({ stdout: '{"ok":true}' });

    await runPlay({
      events: bus,
      flowId: 'demoA',
      nodeId: 'n1',
      cwd,
      action: {
        kind: 'script',
        interpreter: 'bun',
        scriptPath,
        input: { hello: 'world', n: 1 },
      },
      spawner,
    });

    expect(record.spawnCalls[0]?.stdin).toBe('pipe');
    expect(record.stdin.text).toBe(JSON.stringify({ hello: 'world', n: 1 }));
    expect(record.stdin.closed).toBe(true);
  });

  it('spawns with stdin: ignore when action.input is undefined', async () => {
    const { cwd, scriptPath } = makeProjectWithNodeScript('n1');
    const bus = createEventBus();
    captureEvents(bus, 'demoA');
    const { spawner, record } = makeFakeSpawner({ stdout: '{}' });

    await runPlay({
      events: bus,
      flowId: 'demoA',
      nodeId: 'n1',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      spawner,
    });

    expect(record.spawnCalls[0]?.stdin).toBe('ignore');
  });

  it('sets SEEFLOW_* env vars and assembles cmd as [interpreter, ...args, absScriptPath]', async () => {
    const { cwd, scriptPath } = makeProjectWithNodeScript('node-x');
    const bus = createEventBus();
    captureEvents(bus, 'demoA');
    const { spawner, record } = makeFakeSpawner({ stdout: '{}' });

    const result = await runPlay({
      events: bus,
      flowId: 'demoA',
      nodeId: 'node-x',
      cwd,
      action: {
        kind: 'script',
        interpreter: 'bun',
        args: ['run', '--silent'],
        scriptPath,
      },
      spawner,
    });

    const call = record.spawnCalls[0];
    if (!call) throw new Error('expected spawn to have been called');
    expect(call.cmd[0]).toBe('bun');
    expect(call.cmd[1]).toBe('run');
    expect(call.cmd[2]).toBe('--silent');
    expect(call.cmd[3]?.endsWith('/scripts/play.ts')).toBe(true);
    expect(call.cwd).toBe(cwd);
    expect(call.env.SEEFLOW_DEMO_ID).toBe('demoA');
    expect(call.env.SEEFLOW_NODE_ID).toBe('node-x');
    expect(call.env.SEEFLOW_RUN_ID).toBe(result.runId);
  });

  it('rejects a scriptPath that escapes the project root via a symlink', async () => {
    // Make two tmp dirs: the project and an outside dir containing the target.
    const cwd = mkdtempSync(join(tmpdir(), 'seeflow-proxy-'));
    tmpDirs.push(cwd);
    const outside = mkdtempSync(join(tmpdir(), 'seeflow-proxy-out-'));
    tmpDirs.push(outside);
    mkdirSync(join(cwd, 'nodes', 'n1'), { recursive: true });
    writeFileSync(join(outside, 'evil.ts'), '// outside');
    // nodes/n1/escape.ts is a symlink pointing outside the per-node folder.
    symlinkSync(join(outside, 'evil.ts'), join(cwd, 'nodes', 'n1', 'escape.ts'));

    const bus = createEventBus();
    const captured = captureEvents(bus, 'demoA');
    const { spawner, record } = makeFakeSpawner({ stdout: '{}' });

    const result = await runPlay({
      events: bus,
      flowId: 'demoA',
      nodeId: 'n1',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath: 'escape.ts' },
      spawner,
    });

    expect(result.error).toBe('scriptPath escapes project root');
    expect(result.status).toBeUndefined();
    expect(record.spawnCalls).toHaveLength(0);
    const types = captured.map((e) => e.type);
    expect(types).toEqual(['node:error']);
    expect(captured[0]?.payload).toMatchObject({
      nodeId: 'n1',
      message: 'scriptPath escapes project root',
    });
  });

  it('resolves scriptPath relative to nodes/<nodeId>/', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'seeflow-proxy-anchor-'));
    tmpDirs.push(cwd);
    const nodeDir = join(cwd, 'nodes', 'checkout-api', 'scripts');
    mkdirSync(nodeDir, { recursive: true });
    writeFileSync(
      join(nodeDir, 'play.ts'),
      '#!/usr/bin/env bun\nconsole.log(JSON.stringify({ ok: true }));\n',
    );

    const bus = createEventBus();
    const { spawner } = makeFakeSpawner({ stdout: '{"ok":true}' });

    const result = await runPlay({
      events: bus,
      flowId: 'flow-1',
      nodeId: 'checkout-api',
      cwd,
      action: {
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/play.ts',
      },
      spawner,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
  });
});

// US-008: multi-spawn fake supporting per-spawn-index config so a test can
// drive a long-running play (neverExit) alongside a fast reset spawn etc.
// Each spawn gets its own SpawnRecord with independent kill tracking.
interface SpawnRecord {
  options: SpawnOptions;
  killCalls: Array<'SIGTERM' | 'SIGKILL'>;
  resolveExit: (code: number) => void;
  exited: Promise<number>;
}

interface PerSpawnConfig {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  /** When true, exited only resolves via `kill(signal in killExitsOn)`. */
  neverExit?: boolean;
  killExitsOn?: Array<'SIGTERM' | 'SIGKILL'>;
}

function makeMultiFakeSpawner(configFor: (i: number) => PerSpawnConfig): {
  spawner: ProcessSpawner;
  records: SpawnRecord[];
} {
  const records: SpawnRecord[] = [];
  const spawner: ProcessSpawner = {
    spawn(opts) {
      const idx = records.length;
      const cfg = configFor(idx);
      let resolveExit: (code: number) => void = () => {};
      const exited = new Promise<number>((res) => {
        resolveExit = res;
      });
      const rec: SpawnRecord = { options: opts, killCalls: [], resolveExit, exited };
      records.push(rec);
      if (!cfg.neverExit) {
        queueMicrotask(() => resolveExit(cfg.exitCode ?? 0));
      }
      const exitsOn = new Set(cfg.killExitsOn ?? ['SIGTERM', 'SIGKILL']);
      const handle: SpawnHandle = {
        pid: 1000 + idx,
        stdout: streamFromString(cfg.stdout ?? ''),
        stderr: streamFromString(cfg.stderr ?? ''),
        stdin:
          opts.stdin === 'pipe'
            ? new WritableStream<Uint8Array>({ write() {}, close() {}, abort() {} })
            : undefined,
        exited,
        kill(signal) {
          rec.killCalls.push(signal);
          if (exitsOn.has(signal)) {
            resolveExit(signal === 'SIGTERM' ? 143 : 137);
          }
        },
      };
      return handle;
    },
  };
  return { spawner, records };
}

describe('stopAllPlays (US-008)', () => {
  it('kills every live handle for the flowId via SIGTERM then awaits exit', async () => {
    const { cwd, scriptPath } = makeProjectWithNodeScript('n1');
    addNodeScript(cwd, 'n2');
    const bus = createEventBus();
    captureEvents(bus, 'demoA');
    // Two plays that never exit on their own — only SIGTERM/SIGKILL ends them.
    const { spawner, records } = makeMultiFakeSpawner(() => ({ neverExit: true }));

    const run1 = runPlay({
      events: bus,
      flowId: 'demoA',
      nodeId: 'n1',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      spawner,
    });
    const run2 = runPlay({
      events: bus,
      flowId: 'demoA',
      nodeId: 'n2',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      spawner,
    });
    // Let runPlay register the handles before stopping.
    await new Promise((res) => setTimeout(res, 10));

    await stopAllPlays('demoA');

    for (const rec of records) {
      expect(rec.killCalls[0]).toBe('SIGTERM');
    }
    // Each runPlay should now resolve with an error (timed out path won't fire;
    // they exit via SIGTERM = code 143 which is exit !== 0 → error).
    await Promise.all([run1, run2]);
  });

  it('escalates to SIGKILL when SIGTERM is ignored beyond the grace period', async () => {
    const { cwd, scriptPath } = makeProjectWithNodeScript('n1');
    const bus = createEventBus();
    captureEvents(bus, 'demoA');
    // Ignores SIGTERM, only dies on SIGKILL.
    const { spawner, records } = makeMultiFakeSpawner(() => ({
      neverExit: true,
      killExitsOn: ['SIGKILL'],
    }));

    const run = runPlay({
      events: bus,
      flowId: 'demoA',
      nodeId: 'n1',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      spawner,
    });
    await new Promise((res) => setTimeout(res, 10));

    await stopAllPlays('demoA');

    expect(records[0]?.killCalls).toEqual(['SIGTERM', 'SIGKILL']);
    await run;
  }, 10_000);

  it('is a no-op for an unknown flowId', async () => {
    // No spawns; just ensure the call resolves without throwing.
    await stopAllPlays('never-spawned');
  });

  it('isolates per flowId — stop on demo A does not touch demo B', async () => {
    const { cwd, scriptPath } = makeProjectWithNodeScript('n1');
    const bus = createEventBus();
    captureEvents(bus, 'demoA');
    captureEvents(bus, 'demoB');
    const { spawner, records } = makeMultiFakeSpawner(() => ({ neverExit: true }));

    const runA = runPlay({
      events: bus,
      flowId: 'demoA',
      nodeId: 'n1',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      spawner,
    });
    const runB = runPlay({
      events: bus,
      flowId: 'demoB',
      nodeId: 'n1',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      spawner,
    });
    await new Promise((res) => setTimeout(res, 10));

    await stopAllPlays('demoA');

    expect(records[0]?.killCalls.length).toBeGreaterThan(0);
    expect(records[1]?.killCalls).toEqual([]);

    // Clean up B so the test doesn't hang.
    records[1]?.resolveExit(0);
    await Promise.all([runA, runB]);
  });

  it('registers and unregisters live handles around runPlay lifecycle', async () => {
    const { cwd, scriptPath } = makeProjectWithNodeScript('n1');
    const bus = createEventBus();
    captureEvents(bus, 'demoA');
    // First spawn exits naturally; stopAllPlays should be a no-op after.
    const { spawner, records } = makeMultiFakeSpawner(() => ({ stdout: '{}' }));

    await runPlay({
      events: bus,
      flowId: 'demoA',
      nodeId: 'n1',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      spawner,
    });
    // After the run resolves the handle should have been unregistered from
    // the demo's live set, so a subsequent stopAllPlays issues no kill calls.
    await stopAllPlays('demoA');
    expect(records[0]?.killCalls).toEqual([]);
  });
});

describe('runReset (US-008)', () => {
  it('returns JSON body when stdout is valid JSON and exit is 0', async () => {
    const { cwd, scriptPath } = makeProjectWithScript('reset.ts');
    const bus = createEventBus();
    const captured = captureEvents(bus, 'demoA');
    const { spawner } = makeFakeSpawner({ stdout: '{"ok":true}\n' });

    const result = await runReset({
      events: bus,
      flowId: 'demoA',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      spawner,
    });

    expect(result.ok).toBe(true);
    expect(result.body).toEqual({ ok: true });
    expect(captured.map((e) => e.type)).toEqual(['demo:reset']);
    expect(captured[0]?.payload).toMatchObject({ ok: true, body: { ok: true } });
  });

  it('returns raw stdout when JSON parsing fails', async () => {
    const { cwd, scriptPath } = makeProjectWithScript('reset.ts');
    const bus = createEventBus();
    captureEvents(bus, 'demoA');
    const { spawner } = makeFakeSpawner({ stdout: 'plain text reply' });

    const result = await runReset({
      events: bus,
      flowId: 'demoA',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      spawner,
    });

    expect(result.ok).toBe(true);
    expect(result.body).toBe('plain text reply');
  });

  it('returns error with last stderr line on non-zero exit + broadcasts demo:reset', async () => {
    const { cwd, scriptPath } = makeProjectWithScript('reset.ts');
    const bus = createEventBus();
    const captured = captureEvents(bus, 'demoA');
    const stderr = 'warming up\n\nerror: boom\n';
    const { spawner } = makeFakeSpawner({ exitCode: 1, stderr });

    const result = await runReset({
      events: bus,
      flowId: 'demoA',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      spawner,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('error: boom');
    expect(captured.map((e) => e.type)).toEqual(['demo:reset']);
    expect(captured[0]?.payload).toMatchObject({ ok: false, error: 'error: boom' });
  });

  it('on timeout: SIGTERM → SIGKILL escalation + timeout error message', async () => {
    const { cwd, scriptPath } = makeProjectWithScript('reset.ts');
    const bus = createEventBus();
    captureEvents(bus, 'demoA');
    const { spawner, record } = makeFakeSpawner({ neverExit: true, killExitsOn: ['SIGKILL'] });

    const result = await runReset({
      events: bus,
      flowId: 'demoA',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath, timeoutMs: 50 },
      spawner,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('reset script timed out after 50ms');
    expect(record.killCalls).toEqual(['SIGTERM', 'SIGKILL']);
  }, 10_000);

  it('rejects scriptPath escape via symlink', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'seeflow-proxy-reset-'));
    tmpDirs.push(cwd);
    const outside = mkdtempSync(join(tmpdir(), 'seeflow-proxy-reset-out-'));
    tmpDirs.push(outside);
    writeFileSync(join(outside, 'evil.ts'), '// outside');
    symlinkSync(join(outside, 'evil.ts'), join(cwd, 'escape.ts'));

    const bus = createEventBus();
    const captured = captureEvents(bus, 'demoA');
    const { spawner, record } = makeFakeSpawner({ stdout: '{}' });

    const result = await runReset({
      events: bus,
      flowId: 'demoA',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath: 'escape.ts' },
      spawner,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('scriptPath escapes project root');
    expect(record.spawnCalls).toHaveLength(0);
    expect(captured.map((e) => e.type)).toEqual(['demo:reset']);
    expect(captured[0]?.payload).toMatchObject({
      ok: false,
      error: 'scriptPath escapes project root',
    });
  });

  it('sets SEEFLOW_DEMO_ID env var (no NODE_ID / RUN_ID — reset is one-shot)', async () => {
    const { cwd, scriptPath } = makeProjectWithScript('reset.ts');
    const bus = createEventBus();
    captureEvents(bus, 'demoA');
    const { spawner, record } = makeFakeSpawner({ stdout: '{}' });

    await runReset({
      events: bus,
      flowId: 'demoA',
      cwd,
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      spawner,
    });

    const call = record.spawnCalls[0];
    if (!call) throw new Error('expected spawn');
    expect(call.env.SEEFLOW_DEMO_ID).toBe('demoA');
    expect(call.env.SEEFLOW_NODE_ID).toBeUndefined();
    expect(call.env.SEEFLOW_RUN_ID).toBeUndefined();
  });
});
