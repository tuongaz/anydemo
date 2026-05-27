import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runComponentAction } from './component-action-runner.ts';
import { createEventBus } from './events.ts';
import type { ProcessSpawner, SpawnHandle, SpawnOptions } from './process-spawner.ts';

type CapturedStdin = { text: string; closed: boolean };

interface FakeOptions {
  stdout?: string;
  stderr?: string;
  /** Exit code if the script "exits naturally" (i.e. without being killed). */
  exitCode?: number;
  /** When set, exited never resolves on its own — only `kill()` resolves it. */
  neverExit?: boolean;
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

// Same fake-spawner shape as proxy.test.ts (kept local so the two test files
// stay independent).
function makeFakeSpawner(opts: FakeOptions): { spawner: ProcessSpawner; record: FakeRecord } {
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

      if (!opts.neverExit) {
        // Resolve next tick so consumers can race against timeouts deterministically.
        queueMicrotask(() => resolveExit(opts.exitCode ?? 0));
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
          resolveExit(signal === 'SIGTERM' ? 143 : 137);
        },
      };
      return handle;
    },
  };
  return { spawner, record };
}

const tmpDirs: string[] = [];

function makeProjectWithNodeScript(
  nodeId: string,
  scriptPath = 'actions/refresh.ts',
): { cwd: string; scriptPath: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'seeflow-action-runner-'));
  tmpDirs.push(cwd);
  const fullPath = join(cwd, 'nodes', nodeId, scriptPath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, '// stub for tests');
  return { cwd, scriptPath };
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const d = tmpDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe('runComponentAction', () => {
  it('spawns a script-kind action and returns its parsed JSON stdout', async () => {
    const { cwd, scriptPath } = makeProjectWithNodeScript('n1');
    const { spawner, record } = makeFakeSpawner({ stdout: '{"queueDepth":7}' });

    const result = await runComponentAction({
      events: createEventBus(),
      flowId: 'f1',
      nodeId: 'n1',
      cwd,
      actionName: 'refresh',
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      payload: { force: true },
      spawner,
    });

    expect(result.ok).toBe(true);
    expect(result.statusHint).toBe(200);
    expect(result.body).toEqual({ queueDepth: 7 });
    expect(result.error).toBeUndefined();

    // Spawn invocation shape
    const call = record.spawnCalls[0];
    if (!call) throw new Error('unreachable: spawn was not called');
    expect(call.cwd).toBe(cwd);
    expect(call.stdin).toBe('pipe');
    expect(call.cmd[0]).toBe('bun');
    expect(call.cmd[call.cmd.length - 1]).toContain(join('nodes', 'n1', 'actions', 'refresh.ts'));

    // Standard env vars surfaced to the child
    expect(call.env.SEEFLOW_DEMO_ID).toBe('f1');
    expect(call.env.SEEFLOW_NODE_ID).toBe('n1');
    expect(call.env.SEEFLOW_ACTION_NAME).toBe('refresh');
    expect(typeof call.env.SEEFLOW_RUN_ID).toBe('string');
    expect((call.env.SEEFLOW_RUN_ID ?? '').length).toBeGreaterThan(0);

    // Payload is JSON-encoded onto stdin and the stream is closed.
    expect(record.stdin.text).toBe('{"force":true}');
    expect(record.stdin.closed).toBe(true);
  });

  it('falls back to raw string body when stdout is not valid JSON', async () => {
    const { cwd, scriptPath } = makeProjectWithNodeScript('n1');
    const { spawner } = makeFakeSpawner({ stdout: 'not-json\n' });

    const result = await runComponentAction({
      events: createEventBus(),
      flowId: 'f1',
      nodeId: 'n1',
      cwd,
      actionName: 'refresh',
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      payload: {},
      spawner,
    });

    expect(result.ok).toBe(true);
    expect(result.statusHint).toBe(200);
    expect(result.body).toBe('not-json\n');
  });

  it('returns 400 for set-kind actions (client-only)', async () => {
    const result = await runComponentAction({
      events: createEventBus(),
      flowId: 'f1',
      nodeId: 'n1',
      cwd: '/tmp/proj',
      actionName: 'switch',
      action: { kind: 'set', path: '/x', value: 1 } as never,
      payload: {},
      spawner: {} as never,
    });

    expect(result.ok).toBe(false);
    expect(result.statusHint).toBe(400);
    expect(result.error).toBe('Only script actions are dispatched over HTTP');
  });

  it('returns 400 when scriptPath escapes the node root', async () => {
    const { cwd } = makeProjectWithNodeScript('n1');
    const { spawner } = makeFakeSpawner({ stdout: '{}' });

    const result = await runComponentAction({
      events: createEventBus(),
      flowId: 'f1',
      nodeId: 'n1',
      cwd,
      actionName: 'evil',
      // Resolves to <cwd>/etc/passwd-ish — outside `<cwd>/nodes/n1/`.
      action: { kind: 'script', interpreter: 'bun', scriptPath: '../../escape.ts' },
      payload: {},
      spawner,
    });

    expect(result.ok).toBe(false);
    expect(result.statusHint).toBe(400);
    expect(result.error).toBe('scriptPath escapes node root');
  });

  it('returns 500 with trimmed stderr when the script exits non-zero', async () => {
    const { cwd, scriptPath } = makeProjectWithNodeScript('n1');
    const { spawner } = makeFakeSpawner({
      stdout: '',
      stderr: '  boom: kaput\n',
      exitCode: 2,
    });

    const result = await runComponentAction({
      events: createEventBus(),
      flowId: 'f1',
      nodeId: 'n1',
      cwd,
      actionName: 'refresh',
      action: { kind: 'script', interpreter: 'bun', scriptPath },
      payload: {},
      spawner,
    });

    expect(result.ok).toBe(false);
    expect(result.statusHint).toBe(500);
    expect(result.error).toBe('boom: kaput');
  });
});
