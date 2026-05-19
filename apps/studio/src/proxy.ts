/**
 * Play proxy: spawns the script declared on a node's `playAction` and
 * broadcasts `node:running` / `node:done` / `node:error` SSE events around the
 * spawn so the canvas can animate. The interpreter, args, scriptPath, optional
 * stdin input, and timeoutMs come from the validated `PlayAction` (see
 * schema.ts). Process spawning goes through the `ProcessSpawner` seam from
 * US-002 so tests inject an in-memory fake.
 *
 * Defense-in-depth on scriptPath: schema.ts already rejects absolute paths
 * and `..` traversal textually. Here we additionally realpath-resolve the
 * script under `<cwd>/.seeflow/` and reject anything that escapes that root —
 * symlink-escape defense in line with `resolveProjectFile` in api.ts.
 */

import { realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { EventBus } from './events.ts';
import { type ProcessSpawner, type SpawnHandle, defaultProcessSpawner } from './process-spawner.ts';
import type { PlayAction, ResetAction } from './schema.ts';

export interface PlayResult {
  /** Correlates this run across SSE events + the synchronous response. */
  runId: string;
  /** Synthetic status: 200 when the script exited 0, undefined otherwise. */
  status?: number;
  /** Parsed JSON stdout when valid JSON, else the raw stdout string. */
  body?: unknown;
  /** Spawn-level error (path escape, ENOENT, exit !== 0, timeout, …). */
  error?: string;
}

export interface RunPlayOptions {
  events: EventBus;
  flowId: string;
  nodeId: string;
  /** Project root (`<repoPath>`). Script resolves under `<cwd>/.seeflow/`. */
  cwd: string;
  action: PlayAction;
  /** Injectable for tests; defaults to `defaultProcessSpawner`. */
  spawner?: ProcessSpawner;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const SIGKILL_GRACE_MS = 2_000;
const STDERR_TRUNCATE = 500;
const SCRIPT_PATH_ESCAPE = 'scriptPath escapes project root';

type Resolved = { ok: true; absPath: string } | { ok: false };

// Resolve `<cwd>/.seeflow/<scriptPath>` and verify via realpath it stays inside
// the `.seeflow` root. Mirrors `resolveProjectFile` in api.ts.
function resolveScript(cwd: string, scriptPath: string): Resolved {
  const seeflowRoot = join(cwd, '.seeflow');
  let realRoot: string;
  try {
    realRoot = realpathSync(seeflowRoot);
  } catch {
    return { ok: false };
  }
  const target = resolve(seeflowRoot, scriptPath);
  let realTarget: string;
  try {
    realTarget = realpathSync(target);
  } catch {
    return { ok: false };
  }
  const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (realTarget !== realRoot && !realTarget.startsWith(rootWithSep)) {
    return { ok: false };
  }
  return { ok: true, absPath: realTarget };
}

// Copy `process.env` into a string-only record, then layer the per-run extras.
// Bun.spawn's env contract is `Record<string, string>` so the undefineds that
// `process.env` advertises in its type must be filtered out first.
function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v;
  }
  return { ...env, ...extra };
}

function lastNonEmptyLine(s: string): string {
  const lines = s.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (line) return line;
  }
  return '';
}

async function writeStdinPayload(handle: SpawnHandle, input: unknown): Promise<void> {
  if (!handle.stdin) return;
  const writer = handle.stdin.getWriter();
  try {
    await writer.write(new TextEncoder().encode(JSON.stringify(input)));
  } finally {
    await writer.close().catch(() => {
      /* stdin already closed by child — not fatal */
    });
  }
}

// Live play-script handles indexed by flowId. Populated by runPlay() on spawn;
// entries are removed when each handle's `exited` promise resolves (success
// AND error paths). `stopAllPlays(flowId)` consults this map to terminate
// every in-flight play for a demo on /reset.
const livePlayHandles = new Map<string, Set<SpawnHandle>>();

function registerLiveHandle(flowId: string, handle: SpawnHandle): void {
  let set = livePlayHandles.get(flowId);
  if (!set) {
    set = new Set();
    livePlayHandles.set(flowId, set);
  }
  set.add(handle);
  handle.exited.finally(() => {
    const current = livePlayHandles.get(flowId);
    if (!current) return;
    current.delete(handle);
    if (current.size === 0) livePlayHandles.delete(flowId);
  });
}

async function killWithGrace(handle: SpawnHandle): Promise<void> {
  handle.kill('SIGTERM');
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const gracePromise = new Promise<'grace'>((res) => {
    graceTimer = setTimeout(() => res('grace'), SIGKILL_GRACE_MS);
  });
  const winner = await Promise.race([handle.exited.then(() => 'exited' as const), gracePromise]);
  if (graceTimer) clearTimeout(graceTimer);
  if (winner === 'grace') {
    handle.kill('SIGKILL');
    await handle.exited;
  }
}

// Kill every live play-script for `flowId` (SIGTERM → 2s grace → SIGKILL in
// parallel) and wait for each to exit. Idempotent on an unknown flowId. The
// map is keyed by flowId so a stop on demo A never touches demo B.
export async function stopAllPlays(flowId: string): Promise<void> {
  const set = livePlayHandles.get(flowId);
  if (!set || set.size === 0) return;
  const handles = [...set];
  // Clear eagerly so a parallel runPlay can't double-count an entry we're
  // about to await on. The exited.finally() will no-op the second delete.
  livePlayHandles.delete(flowId);
  await Promise.all(handles.map((h) => killWithGrace(h)));
}

export async function runPlay(options: RunPlayOptions): Promise<PlayResult> {
  const { events, flowId, nodeId, cwd, action } = options;
  const spawner = options.spawner ?? defaultProcessSpawner;
  const runId = crypto.randomUUID();

  const resolved = resolveScript(cwd, action.scriptPath);
  if (!resolved.ok) {
    events.broadcast({
      type: 'node:error',
      flowId,
      payload: { nodeId, runId, message: SCRIPT_PATH_ESCAPE },
    });
    return { runId, error: SCRIPT_PATH_ESCAPE };
  }

  events.broadcast({
    type: 'node:running',
    flowId,
    payload: {
      nodeId,
      runId,
      interpreter: action.interpreter,
      scriptPath: action.scriptPath,
    },
  });

  const wantsStdin = action.input !== undefined;
  const env = buildChildEnv({
    SEEFLOW_DEMO_ID: flowId,
    SEEFLOW_NODE_ID: nodeId,
    SEEFLOW_RUN_ID: runId,
  });

  let handle: SpawnHandle;
  try {
    handle = spawner.spawn({
      cmd: [action.interpreter, ...(action.args ?? []), resolved.absPath],
      cwd,
      env,
      stdin: wantsStdin ? 'pipe' : 'ignore',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    events.broadcast({
      type: 'node:error',
      flowId,
      payload: { nodeId, runId, message },
    });
    return { runId, error: message };
  }

  registerLiveHandle(flowId, handle);

  // Drain stdout AND stderr CONCURRENTLY with the process running so OS pipe
  // buffers (~64 KB) don't fill up and deadlock the child.
  const stdoutPromise = new Response(handle.stdout).text();
  const stderrPromise = new Response(handle.stderr).text();

  // Write stdin and close BEFORE awaiting exit (otherwise a child blocked on
  // `read(stdin)` and a parent blocked on `exited` deadlock each other).
  if (wantsStdin) {
    await writeStdinPayload(handle, action.input);
  }

  const timeoutMs = action.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<'timeout'>((res) => {
    timer = setTimeout(() => res('timeout'), timeoutMs);
  });
  const exitPromise = handle.exited.then((code) => ({ code }) as const);

  const race = await Promise.race([exitPromise, timeoutPromise]);
  if (timer) clearTimeout(timer);

  if (race === 'timeout') {
    handle.kill('SIGTERM');
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const gracePromise = new Promise<'grace'>((res) => {
      graceTimer = setTimeout(() => res('grace'), SIGKILL_GRACE_MS);
    });
    const winner = await Promise.race([handle.exited.then(() => 'exited' as const), gracePromise]);
    if (graceTimer) clearTimeout(graceTimer);
    if (winner === 'grace') {
      handle.kill('SIGKILL');
      await handle.exited;
    }
    // Best-effort drain so consumers don't leak an open ReadableStream.
    await Promise.allSettled([stdoutPromise, stderrPromise]);
    const message = `script timed out after ${timeoutMs}ms`;
    events.broadcast({
      type: 'node:error',
      flowId,
      payload: { nodeId, runId, message },
    });
    return { runId, error: message };
  }

  const code = race.code;
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

  if (code === 0) {
    let body: unknown;
    try {
      body = JSON.parse(stdout);
    } catch {
      body = stdout;
    }
    events.broadcast({
      type: 'node:done',
      flowId,
      payload: { nodeId, runId, status: 200, body },
    });
    return { runId, status: 200, body };
  }

  const lastLine = lastNonEmptyLine(stderr);
  const truncated = lastLine.slice(0, STDERR_TRUNCATE);
  const message = truncated.length > 0 ? truncated : `script exited with code ${code}`;
  events.broadcast({
    type: 'node:error',
    flowId,
    payload: { nodeId, runId, message },
  });
  return { runId, error: message };
}

export interface RunResetOptions {
  events: EventBus;
  flowId: string;
  /** Project root (`<repoPath>`). Script resolves under `<cwd>/.seeflow/`. */
  cwd: string;
  action: ResetAction;
  /** Injectable for tests; defaults to `defaultProcessSpawner`. */
  spawner?: ProcessSpawner;
}

export interface ResetResult {
  ok: boolean;
  body?: unknown;
  error?: string;
}

// Run the demo's one-shot `resetAction` script. Same spawn discipline as
// runPlay (realpath-guarded scriptPath, concurrent stdout/stderr drain,
// optional stdin payload, SIGTERM→2s→SIGKILL escalation on timeout) but the
// lifecycle SSE event is the single `demo:reset` broadcast that mirrors the
// returned shape. Callers (the /reset endpoint) decide what HTTP status to
// surface; this returns `{ ok }` plus body/error so the endpoint can map.
export async function runReset(options: RunResetOptions): Promise<ResetResult> {
  const { events, flowId, cwd, action } = options;
  const spawner = options.spawner ?? defaultProcessSpawner;

  const resolved = resolveScript(cwd, action.scriptPath);
  if (!resolved.ok) {
    events.broadcast({
      type: 'demo:reset',
      flowId,
      payload: { ok: false, error: SCRIPT_PATH_ESCAPE },
    });
    return { ok: false, error: SCRIPT_PATH_ESCAPE };
  }

  const wantsStdin = action.input !== undefined;
  const env = buildChildEnv({ SEEFLOW_DEMO_ID: flowId });

  let handle: SpawnHandle;
  try {
    handle = spawner.spawn({
      cmd: [action.interpreter, ...(action.args ?? []), resolved.absPath],
      cwd,
      env,
      stdin: wantsStdin ? 'pipe' : 'ignore',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    events.broadcast({
      type: 'demo:reset',
      flowId,
      payload: { ok: false, error: message },
    });
    return { ok: false, error: message };
  }

  const stdoutPromise = new Response(handle.stdout).text();
  const stderrPromise = new Response(handle.stderr).text();

  if (wantsStdin) {
    await writeStdinPayload(handle, action.input);
  }

  const timeoutMs = action.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<'timeout'>((res) => {
    timer = setTimeout(() => res('timeout'), timeoutMs);
  });
  const exitPromise = handle.exited.then((code) => ({ code }) as const);

  const race = await Promise.race([exitPromise, timeoutPromise]);
  if (timer) clearTimeout(timer);

  if (race === 'timeout') {
    await killWithGrace(handle);
    await Promise.allSettled([stdoutPromise, stderrPromise]);
    const message = `reset script timed out after ${timeoutMs}ms`;
    events.broadcast({
      type: 'demo:reset',
      flowId,
      payload: { ok: false, error: message },
    });
    return { ok: false, error: message };
  }

  const code = race.code;
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

  if (code === 0) {
    let body: unknown;
    try {
      body = JSON.parse(stdout);
    } catch {
      body = stdout;
    }
    events.broadcast({
      type: 'demo:reset',
      flowId,
      payload: { ok: true, body },
    });
    return { ok: true, body };
  }

  const lastLine = lastNonEmptyLine(stderr);
  const truncated = lastLine.slice(0, STDERR_TRUNCATE);
  const message = truncated.length > 0 ? truncated : `reset script exited with code ${code}`;
  events.broadcast({
    type: 'demo:reset',
    flowId,
    payload: { ok: false, error: message },
  });
  return { ok: false, error: message };
}
