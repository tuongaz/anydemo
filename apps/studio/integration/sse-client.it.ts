import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { slugify } from '../src/registry.ts';
import { connectSse } from './support/sse-client.ts';
import { type StudioHandle, spawnStudio } from './support/studio-harness.ts';

describe('integration: sse client', () => {
  let studio: StudioHandle;
  let flowId: string;

  // bun-test defaults hooks to 5s, but spawnStudio waits up to 10s for
  // /healthz to flip plus the project POST round-trip — on a loaded system
  // (Docker building images in parallel, see test-integration.ts) the cold
  // start can blow past 5s and the hook flakes. 30s gives the studio's own
  // health-poll window the full headroom it was designed for.
  beforeAll(async () => {
    studio = await spawnStudio();
    // The /api/events route is flow-scoped — register one project so we can
    // open a stream and emit against it.
    const projRes = await fetch(`${studio.baseURL}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: join(studio.workspace, slugify('sse-it')),
        name: 'sse-it',
      }),
    });
    expect(projRes.status).toBe(200);
    const project = (await projRes.json()) as { id: string };
    flowId = project.id;
  }, 30_000);

  afterAll(async () => {
    if (studio) await studio.stop();
  });

  it('receives the initial hello frame and a node:running event from /api/emit', async () => {
    const sse = await connectSse(studio.baseURL, `/api/events?flowId=${flowId}`);
    try {
      // The route writes a `hello` frame immediately so reconnecting clients
      // can confirm the stream is open. Verify it parses round-trip.
      const hello = await sse.waitFor((e) => e.event === 'hello', 2_000);
      const helloPayload = JSON.parse(hello.data) as { flowId: string; ts: number };
      expect(helloPayload.flowId).toBe(flowId);
      expect(typeof helloPayload.ts).toBe('number');

      const emitRes = await fetch(`${studio.baseURL}/api/emit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          flowId,
          nodeId: 'sse-test-node',
          status: 'running',
          runId: 'run-sse-1',
        }),
      });
      expect(emitRes.status).toBe(200);

      const evt = await sse.waitFor((e) => e.event === 'node:running', 2_000);
      const parsed = JSON.parse(evt.data) as {
        nodeId: string;
        runId?: string;
        ts: number;
      };
      expect(parsed.nodeId).toBe('sse-test-node');
      expect(parsed.runId).toBe('run-sse-1');
    } finally {
      sse.close();
    }
  });
});
