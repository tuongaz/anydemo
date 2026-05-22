import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slugify } from '../src/registry.ts';
import { runCli } from './support/cli-runner.ts';
import { uniqueFlowId } from './support/ids.ts';
import { connectSse } from './support/sse-client.ts';
import { spawnStudio } from './support/studio-harness.ts';

// Edges tier — each test spawns its own studio because the scenarios
// manipulate process lifecycle (SIGTERM mid-write, SIGKILL + recovery,
// double-start collision). A shared file-level harness would entangle these.

interface CreateProjectResponse {
  id: string;
  slug: string;
}

interface OnDiskFlow {
  version: number;
  name: string;
  nodes: Array<{ id: string; type: string; data?: Record<string, unknown> }>;
  connectors: Array<unknown>;
}

interface OnDiskStyle {
  nodes?: Record<string, { position?: { x: number; y: number } } & Record<string, unknown>>;
}

const headers = { 'content-type': 'application/json' } as const;

async function createProject(
  baseURL: string,
  workspace: string,
  name: string,
): Promise<CreateProjectResponse> {
  const res = await fetch(`${baseURL}/api/projects`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path: join(workspace, slugify(name)), name }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as CreateProjectResponse;
}

function readFlowJson(workspace: string, slug: string): OnDiskFlow {
  const path = join(workspace, slug, '.seeflow', 'flow.json');
  return JSON.parse(readFileSync(path, 'utf8')) as OnDiskFlow;
}

function readStyleJson(workspace: string, slug: string): OnDiskStyle {
  const path = join(workspace, slug, '.seeflow', 'style.json');
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as OnDiskStyle;
}

// Poll process.kill(pid, 0) until ESRCH (process gone). Cheaper than
// importing isPidAlive from `runtime.ts` (a studio internal).
async function waitForPidDead(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await Bun.sleep(50);
  }
  return false;
}

describe('integration: edges — cross-boundary failure modes', () => {
  it('SIGTERM during in-flight flow:add-bulk leaves flow.json complete or untouched', async () => {
    const studio = await spawnStudio();
    let inflight: Promise<Response | null> | null = null;
    let finalFlow: OnDiskFlow | null = null;
    try {
      const name = uniqueFlowId('sigterm-bulk');
      const project = await createProject(studio.baseURL, studio.workspace, name);

      // Confirm starting state: scaffolded flow has no nodes.
      expect(readFlowJson(studio.workspace, project.slug).nodes).toEqual([]);

      const bulkSize = 30;
      const bulkBody = {
        nodes: Array.from({ length: bulkSize }, (_, i) => ({
          id: `n-${i}`,
          type: 'shapeNode',
          data: { shape: 'rectangle', name: `n${i}` },
        })),
      };

      // Fire the bulk write WITHOUT awaiting — we want SIGTERM to potentially
      // land mid-flight. Swallow any fetch error (the connection may abort
      // when the server dies).
      inflight = fetch(`${studio.baseURL}/api/flows/${project.id}/bulk`, {
        method: 'POST',
        headers,
        body: JSON.stringify(bulkBody),
      }).catch(() => null);

      // Send SIGTERM externally (bypasses harness.stop's rmSync so we can
      // read flow.json afterwards). Assert the process exits within 2s.
      process.kill(studio.pid, 'SIGTERM');
      const exited = await waitForPidDead(studio.pid, 2_000);
      expect(exited).toBe(true);

      // Atomicity check: writeFileAtomic uses write-temp + rename, so flow.json
      // is either fully the old contents (empty nodes) or fully the new
      // contents (all bulkSize nodes) — never partial. The file must always
      // parse as valid JSON.
      finalFlow = readFlowJson(studio.workspace, project.slug);
      expect([0, bulkSize]).toContain(finalFlow.nodes.length);
      expect(finalFlow.version).toBe(2);
      expect(finalFlow.name).toBe(name);
    } finally {
      // Settle the request promise so it can't leak past the test.
      if (inflight) await inflight;
      // studio.stop() rmSyncs home; process is already dead so it just cleans
      // up file handles + tmp dir.
      await studio.stop();
    }
  });

  it('double-start guard: second `seeflow start` on the same port exits non-zero', async () => {
    const studioA = await spawnStudio();
    try {
      // Foreground mode is what makes the second start try to actually bind
      // the port (the default daemon mode would just probe /health, see A is
      // healthy, and return 0 with "Studio already running"). The PRD's
      // acceptance criterion is "exit code != 0 and stderr mentions … or
      // port-in-use" — only the foreground path can produce that signal.
      // Use a separate tmp workspace so we don't fight A's config / pid.
      const home = mkdtempSync(join(tmpdir(), 'seeflow-it-double-'));
      let result: Awaited<ReturnType<typeof runCli>>;
      try {
        result = await runCli(
          ['start', '--port', String(studioA.port), '--host', '127.0.0.1', '--foreground'],
          {
            env: { SEEFLOW_WORKSPACE: home },
            timeoutMs: 5_000,
          },
        );
      } catch (err) {
        // If the CLI didn't fail fast on bind error we'd hit the timeout. Surface
        // a clear error rather than a generic test-timeout.
        throw new Error(
          `double-start guard: second CLI did not exit within 5s (port=${studioA.port}). ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      expect(result.code).not.toBe(0);
      const combined = `${result.stdout}\n${result.stderr}`;
      expect(combined).toMatch(/EADDRINUSE|in use|already.*running|address.*in use/i);
    } finally {
      await studioA.stop();
    }
  });

  it('external flow.json edit triggers a flow:reload SSE event within 1s', async () => {
    const studio = await spawnStudio();
    let sse: Awaited<ReturnType<typeof connectSse>> | null = null;
    try {
      const name = uniqueFlowId('edges-external-edit');
      const project = await createProject(studio.baseURL, studio.workspace, name);

      sse = await connectSse(studio.baseURL, `/api/events?flowId=${project.id}`);
      await sse.waitFor((e) => e.event === 'hello', 2_000);

      // flow.json on disk uses the strict FlowSchema — no `position` here
      // (position is split to style.json). Without this, the watcher's
      // reparse would broadcast `valid: false`.
      const edited = {
        version: 2,
        name,
        nodes: [{ id: 'edge-1', type: 'shapeNode', data: { shape: 'rectangle', name: 'Edge' } }],
        connectors: [],
      };
      const flowPath = join(studio.workspace, project.slug, '.seeflow', 'flow.json');
      writeFileSync(flowPath, `${JSON.stringify(edited, null, 2)}\n`);

      // PRD: arrives within 1s. Watcher debounce is 100ms so this is plenty.
      const reload = await sse.waitFor((e) => e.event === 'flow:reload', 1_000);
      const parsed = JSON.parse(reload.data) as {
        valid?: boolean;
        flow?: { nodes?: Array<{ id: string }> };
        error?: string | null;
      };
      expect(parsed.valid).toBe(true);
      expect(parsed.flow?.nodes?.map((n) => n.id)).toContain('edge-1');
    } finally {
      sse?.close();
      await studio.stop();
    }
  });

  it('parallel PATCH /nodes/:id/position lands at one input value with no torn write', async () => {
    const studio = await spawnStudio();
    try {
      const name = uniqueFlowId('parallel-patch');
      const project = await createProject(studio.baseURL, studio.workspace, name);

      // Seed a single shape node — easiest valid target for /position.
      const nodeId = 'pp-1';
      const seedRes = await fetch(`${studio.baseURL}/api/flows/${project.id}/bulk`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          nodes: [{ id: nodeId, type: 'shapeNode', data: { shape: 'rectangle' } }],
        }),
      });
      expect(seedRes.status).toBe(200);

      // Fire 10 concurrent PATCHes with distinct x/y values. withFlowWriteLock
      // serializes the mutations; the final on-disk position must equal
      // exactly one of the inputs (last-writer-wins) — never a torn mix.
      const inputs = Array.from({ length: 10 }, (_, i) => ({ x: i * 11, y: i * 23 }));
      const responses = await Promise.all(
        inputs.map((pos) =>
          fetch(`${studio.baseURL}/api/flows/${project.id}/nodes/${nodeId}/position`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(pos),
          }),
        ),
      );
      for (const r of responses) expect(r.status).toBe(200);

      // Disk state: position lives in style.json per NODE_STYLE_KEYS in
      // merge.ts. The file must parse cleanly (no torn JSON) and the recorded
      // position must equal one of the inputs verbatim.
      const style = readStyleJson(studio.workspace, project.slug);
      const persisted = style.nodes?.[nodeId]?.position;
      expect(persisted).toBeDefined();
      const persistedKey = `${persisted?.x},${persisted?.y}`;
      const inputKeys = inputs.map((p) => `${p.x},${p.y}`);
      expect(inputKeys).toContain(persistedKey);

      // Sanity: re-reading flow.json must still parse and not contain
      // position (it belongs in style.json).
      const flow = readFlowJson(studio.workspace, project.slug);
      expect(flow.nodes).toHaveLength(1);
      expect(flow.nodes[0]?.id).toBe(nodeId);
    } finally {
      await studio.stop();
    }
  });

  it('stale PID recovery: SIGKILL leaves a stale pid file; the next start overwrites it and boots cleanly', async () => {
    // Re-use the same SEEFLOW_WORKSPACE across both spawns so the stale pid
    // file from the killed studio is visible to the second one. Studio A is
    // SIGKILL'd directly (bypassing harness.stop) so its on-exit cleanup
    // (`if (readPid() === process.pid) clearPid()`) never runs — that's what
    // "stale" means here.
    const home = mkdtempSync(join(tmpdir(), 'seeflow-it-stalepid-'));
    const pidPath = join(home, '.seeflow', 'seeflow.pid');

    const studioA = await spawnStudio({ home });
    try {
      expect(existsSync(pidPath)).toBe(true);
      const recordedPidA = Number(readFileSync(pidPath, 'utf8').trim());
      expect(recordedPidA).toBe(studioA.pid);

      process.kill(studioA.pid, 'SIGKILL');
      expect(await waitForPidDead(studioA.pid, 2_000)).toBe(true);

      // Stale pid file is still on disk — A had no chance to clear it.
      expect(existsSync(pidPath)).toBe(true);
      expect(Number(readFileSync(pidPath, 'utf8').trim())).toBe(studioA.pid);

      // Boot a second studio against the SAME workspace. It must come up
      // healthy (waitForHealthz inside spawnStudio) and overwrite the stale
      // pid file with its own.
      const studioB = await spawnStudio({ home });
      try {
        expect(studioB.pid).not.toBe(studioA.pid);
        expect(existsSync(pidPath)).toBe(true);
        const recordedPidB = Number(readFileSync(pidPath, 'utf8').trim());
        expect(recordedPidB).toBe(studioB.pid);

        // B serves traffic — confirm with a fresh /healthz.
        const res = await fetch(`${studioB.baseURL}/healthz`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: 'ok' });
      } finally {
        await studioB.stop();
      }
    } finally {
      // A is already dead; harness.stop() will no-op the kill and rmSync the
      // (already-removed-by-B) home. Both operations are safe to repeat.
      await studioA.stop().catch(() => undefined);
    }
  });
});
