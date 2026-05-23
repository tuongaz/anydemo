/**
 * Dispatches a component node's `script`-kind ComponentAction over HTTP:
 * resolves `scriptPath` under `<cwd>/nodes/<nodeId>/` with the same realpath
 * escape check used by `runPlay` (see proxy.ts), spawns the interpreter via the
 * injectable `ProcessSpawner` seam, pipes the request payload to stdin as JSON,
 * and parses stdout back as JSON (falling back to the raw string).
 *
 * `set`-kind actions are intentionally rejected with statusHint 400: those
 * mutate canvas state locally and never round-trip through the API. The runner
 * is the single seam the API route calls; HTTP status mapping lives in the
 * route handler via `statusHint`.
 */

import { realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { EventBus } from './events.ts';
import { type ProcessSpawner, type SpawnHandle, defaultProcessSpawner } from './process-spawner.ts';
import type { ComponentAction } from './schema.ts';
import { shortId } from './short-id.ts';

const DEFAULT_TIMEOUT_MS = 5_000;
const SIGKILL_GRACE_MS = 2_000;
const SCRIPT_PATH_ESCAPE = 'scriptPath escapes node root';
const SET_KIND_REJECTION = 'Only script actions are dispatched over HTTP';

export interface RunComponentActionOptions {
  events: EventBus;
  flowId: string;
  nodeId: string;
  /** Project root (`<repoPath>`). Script resolves under `<cwd>/nodes/<nodeId>/`. */
  cwd: string;
  actionName: string;
  action: ComponentAction;
  payload: unknown;
  /** Injectable for tests; defaults to `defaultProcessSpawner`. */
  spawner?: ProcessSpawner;
}

export interface ComponentActionResult {
  ok: boolean;
  body?: unknown;
  error?: string;
  /** Suggested HTTP status for the API handler. */
  statusHint: number;
}

type Resolved = { ok: true; absPath: string } | { ok: false };

// Resolve `<cwd>/nodes/<nodeId>/<scriptPath>` and verify via realpath it stays
// inside the node folder. Mirrors proxy.ts:resolveScript — symlink-escape
// defense in line with `resolveProjectFile` in api.ts.
function resolveScript(cwd: string, nodeId: string, scriptPath: string): Resolved {
  const nodeRoot = join(cwd, 'nodes', nodeId);
  let realRoot: string;
  try {
    realRoot = realpathSync(nodeRoot);
  } catch {
    return { ok: false };
  }
  const target = resolve(nodeRoot, scriptPath);
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

async function writeStdinPayload(handle: SpawnHandle, payload: unknown): Promise<void> {
  if (!handle.stdin) return;
  const writer = handle.stdin.getWriter();
  try {
    await writer.write(new TextEncoder().encode(JSON.stringify(payload)));
  } finally {
    await writer.close().catch(() => {
      /* stdin already closed by child — not fatal */
    });
  }
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

export async function runComponentAction(
  opts: RunComponentActionOptions,
): Promise<ComponentActionResult> {
  if (opts.action.kind !== 'script') {
    return { ok: false, error: SET_KIND_REJECTION, statusHint: 400 };
  }
  const spawner = opts.spawner ?? defaultProcessSpawner;
  const resolved = resolveScript(opts.cwd, opts.nodeId, opts.action.scriptPath);
  if (!resolved.ok) {
    return { ok: false, error: SCRIPT_PATH_ESCAPE, statusHint: 400 };
  }

  const env = buildChildEnv({
    SEEFLOW_DEMO_ID: opts.flowId,
    SEEFLOW_NODE_ID: opts.nodeId,
    SEEFLOW_ACTION_NAME: opts.actionName,
    SEEFLOW_RUN_ID: shortId(),
  });

  let handle: SpawnHandle;
  try {
    handle = spawner.spawn({
      cmd: [opts.action.interpreter, ...(opts.action.args ?? []), resolved.absPath],
      cwd: opts.cwd,
      env,
      stdin: 'pipe',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, statusHint: 500 };
  }

  // Drain stdout AND stderr CONCURRENTLY with the process running so OS pipe
  // buffers (~64 KB) don't fill up and deadlock the child.
  const stdoutPromise = new Response(handle.stdout).text();
  const stderrPromise = new Response(handle.stderr).text();

  // Write stdin and close BEFORE awaiting exit (otherwise a child blocked on
  // `read(stdin)` and a parent blocked on `exited` deadlock each other).
  await writeStdinPayload(handle, opts.payload);

  const timeoutMs = opts.action.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
    return {
      ok: false,
      error: `action timed out after ${timeoutMs}ms`,
      statusHint: 504,
    };
  }

  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  if (race.code !== 0) {
    return {
      ok: false,
      error: stderr.trim() || `exit ${race.code}`,
      statusHint: 500,
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(stdout);
  } catch {
    body = stdout;
  }
  return { ok: true, body, statusHint: 200 };
}
