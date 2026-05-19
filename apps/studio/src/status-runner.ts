/**
 * StatusRunner: spawns the long-running `statusAction` scripts declared on a
 * demo's nodes, kills the previous batch on respawn, and streams each script's
 * newline-delimited JSON stdout into `node:status` SSE events.
 *
 * Lifecycle per demo (held in `trackedByDemo`):
 *   restart(flowId) → kill previous batch (SIGTERM → 2s grace → SIGKILL in
 *     parallel) → re-read demo from disk → spawn each `statusAction` node in
 *     parallel.
 *   stop(flowId) / stopAll() → kill without respawn.
 *
 * Per-script lifecycle: spawn → drain stdout line-by-line → for each line,
 * JSON.parse + StatusReportSchema.safeParse → on success broadcast `node:status`,
 * on failure console.warn. A `maxLifetimeMs` timer kills the process and emits a
 * final error report. An unsolicited exit with code !== 0 emits a final error
 * report. A solicited kill (restart / stop / maxLifetimeMs) is silent on exit.
 *
 * Defense-in-depth on scriptPath mirrors proxy.ts:`resolveScript` — realpath
 * the resolved file against `<repoPath>/.seeflow/` so a symlink-escape can't
 * spawn arbitrary scripts outside the project.
 */

import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import type { EventBus } from './events.ts';
import { type ProcessSpawner, type SpawnHandle, defaultProcessSpawner } from './process-spawner.ts';
import type { FlowEntry, Registry } from './registry.ts';
import { type ResolvedFlow, type StatusAction, StatusReportSchema } from './schema.ts';
import { readMergedFlow } from './watcher.ts';

export interface StatusRunner {
  /** Kill the current batch for `flowId` and respawn from the on-disk demo. */
  restart(flowId: string): Promise<void>;
  /** Kill all status scripts for `flowId`. */
  stop(flowId: string): Promise<void>;
  /** Kill all status scripts for every demo. Used at studio shutdown. */
  stopAll(): Promise<void>;
}

export interface CreateStatusRunnerOptions {
  registry: Registry;
  events: EventBus;
  /** Injectable for tests; defaults to `defaultProcessSpawner`. */
  spawner?: ProcessSpawner;
}

const DEFAULT_MAX_LIFETIME_MS = 3_600_000;
const SIGKILL_GRACE_MS = 2_000;
const MALFORMED_LINE_TRUNCATE = 200;
const SCRIPT_PATH_ESCAPE = 'scriptPath escapes project root';

interface TrackedHandle {
  nodeId: string;
  handle: SpawnHandle;
  lifetimeTimer: ReturnType<typeof setTimeout> | undefined;
  /** True when our own code initiated the kill (restart / stop / lifetime). */
  expectingKill: boolean;
  /** Resolves once stdout drain + stderr drain + exit handler have all run. */
  lifecycle: Promise<void>;
}

type ResolvedScript = { ok: true; absPath: string } | { ok: false };

function resolveScript(repoPath: string, scriptPath: string): ResolvedScript {
  const seeflowRoot = join(repoPath, '.seeflow');
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

function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v;
  }
  return { ...env, ...extra };
}

async function killAndWait(handle: SpawnHandle): Promise<void> {
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

// Read newline-delimited UTF-8 from `stream`, invoke `onLine` for each
// non-empty line (CRLF tolerated). Returns when the stream ends — including
// any trailing chunk that has no final newline.
async function streamLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      while (true) {
        const nl = buf.indexOf('\n');
        if (nl === -1) break;
        const raw = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        if (line.length > 0) onLine(line);
      }
    }
    buf += decoder.decode();
    const tail = buf.endsWith('\r') ? buf.slice(0, -1) : buf;
    if (tail.length > 0) onLine(tail);
  } finally {
    reader.releaseLock();
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

async function loadDemo(entry: FlowEntry): Promise<ResolvedFlow | undefined> {
  const fullPath = isAbsolute(entry.flowPath)
    ? entry.flowPath
    : join(entry.repoPath, entry.flowPath);
  if (!existsSync(fullPath)) return undefined;
  const result = readMergedFlow(fullPath);
  return result.flow ?? undefined;
}

interface StatusNode {
  nodeId: string;
  action: StatusAction;
}

function collectStatusNodes(demo: ResolvedFlow): StatusNode[] {
  const out: StatusNode[] = [];
  for (const node of demo.nodes) {
    if (node.type !== 'playNode' && node.type !== 'stateNode') continue;
    const action = node.data.statusAction;
    if (!action) continue;
    out.push({ nodeId: node.id, action });
  }
  return out;
}

export function createStatusRunner(options: CreateStatusRunnerOptions): StatusRunner {
  const { registry, events } = options;
  const spawner = options.spawner ?? defaultProcessSpawner;
  const trackedByDemo = new Map<string, TrackedHandle[]>();

  function spawnStatusScript(
    flowId: string,
    repoPath: string,
    sn: StatusNode,
  ): TrackedHandle | undefined {
    const { nodeId, action } = sn;

    const resolved = resolveScript(repoPath, action.scriptPath);
    if (!resolved.ok) {
      events.broadcast({
        type: 'node:status',
        flowId,
        payload: {
          nodeId,
          state: 'error',
          summary: SCRIPT_PATH_ESCAPE,
          ts: Date.now(),
        },
      });
      return undefined;
    }

    const runId = crypto.randomUUID();
    const env = buildChildEnv({
      SEEFLOW_DEMO_ID: flowId,
      SEEFLOW_NODE_ID: nodeId,
      SEEFLOW_RUN_ID: runId,
    });

    let handle: SpawnHandle;
    try {
      handle = spawner.spawn({
        cmd: [action.interpreter, ...(action.args ?? []), resolved.absPath],
        cwd: repoPath,
        env,
        stdin: 'ignore',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      events.broadcast({
        type: 'node:status',
        flowId,
        payload: {
          nodeId,
          state: 'error',
          summary: 'status script failed to spawn',
          detail: message,
          ts: Date.now(),
        },
      });
      return undefined;
    }

    const tracked: TrackedHandle = {
      nodeId,
      handle,
      lifetimeTimer: undefined,
      expectingKill: false,
      // Assigned below; allSettled ensures lifecycle resolves regardless of
      // which leg errored. Initialized eagerly so the struct is fully built.
      lifecycle: Promise.resolve(),
    };

    const maxLifetimeMs = action.maxLifetimeMs ?? DEFAULT_MAX_LIFETIME_MS;
    tracked.lifetimeTimer = setTimeout(() => {
      // We're killing it; suppress the unsolicited-exit error branch.
      tracked.expectingKill = true;
      events.broadcast({
        type: 'node:status',
        flowId,
        payload: {
          nodeId,
          state: 'error',
          summary: 'status script exceeded maxLifetimeMs',
          ts: Date.now(),
        },
      });
      void killAndWait(handle);
    }, maxLifetimeMs);

    const stdoutDrain = streamLines(handle.stdout, (rawLine) => {
      const trimmed = rawLine.trim();
      if (trimmed.length === 0) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(
          `[status-runner] malformed status line (demo=${flowId} node=${nodeId}): ${truncate(trimmed, MALFORMED_LINE_TRUNCATE)} (${reason})`,
        );
        return;
      }
      const result = StatusReportSchema.safeParse(parsed);
      if (!result.success) {
        const reason = result.error.issues[0]?.message ?? 'schema validation failed';
        console.warn(
          `[status-runner] invalid status report (demo=${flowId} node=${nodeId}): ${truncate(trimmed, MALFORMED_LINE_TRUNCATE)} (${reason})`,
        );
        return;
      }
      const report = result.data;
      events.broadcast({
        type: 'node:status',
        flowId,
        payload: {
          nodeId,
          state: report.state,
          summary: report.summary,
          detail: report.detail,
          data: report.data,
          ts: report.ts ?? Date.now(),
        },
      });
    });

    const stderrDrain = new Response(handle.stderr).text();

    const onExit = handle.exited.then((code) => {
      if (tracked.lifetimeTimer) {
        clearTimeout(tracked.lifetimeTimer);
        tracked.lifetimeTimer = undefined;
      }
      if (tracked.expectingKill) return;
      if (code !== 0) {
        events.broadcast({
          type: 'node:status',
          flowId,
          payload: {
            nodeId,
            state: 'error',
            summary: `status script exited with code ${code}`,
            ts: Date.now(),
          },
        });
      }
    });

    tracked.lifecycle = Promise.allSettled([stdoutDrain, stderrDrain, onExit]).then(() => {
      /* swallow — lifecycle is observed only for await-on-stop */
    });

    return tracked;
  }

  async function killBatch(existing: TrackedHandle[]): Promise<void> {
    for (const t of existing) {
      t.expectingKill = true;
      if (t.lifetimeTimer) {
        clearTimeout(t.lifetimeTimer);
        t.lifetimeTimer = undefined;
      }
    }
    await Promise.all(
      existing.map(async (t) => {
        await killAndWait(t.handle);
        await t.lifecycle;
      }),
    );
  }

  async function restart(flowId: string): Promise<void> {
    const existing = trackedByDemo.get(flowId);
    if (existing) {
      trackedByDemo.delete(flowId);
      await killBatch(existing);
    }

    const entry = registry.getById(flowId);
    if (!entry) return;
    const demo = await loadDemo(entry);
    if (!demo) return;
    const statusNodes = collectStatusNodes(demo);
    if (statusNodes.length === 0) return;

    const batch: TrackedHandle[] = [];
    for (const sn of statusNodes) {
      const t = spawnStatusScript(flowId, entry.repoPath, sn);
      if (t) batch.push(t);
    }
    if (batch.length > 0) trackedByDemo.set(flowId, batch);
  }

  async function stop(flowId: string): Promise<void> {
    const existing = trackedByDemo.get(flowId);
    if (!existing) return;
    trackedByDemo.delete(flowId);
    await killBatch(existing);
  }

  async function stopAll(): Promise<void> {
    const demoIds = [...trackedByDemo.keys()];
    await Promise.all(demoIds.map((id) => stop(id)));
  }

  return { restart, stop, stopAll };
}
