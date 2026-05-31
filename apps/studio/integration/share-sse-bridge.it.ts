/**
 * End-to-end integration test for the SSE bridge through the relay (US-073).
 *
 * Mirrors the harness in `share-host-peer.it.ts`: boots the full studio HTTP
 * stack in-process behind a `Bun.serve` listener with the share bridge
 * enabled, points the ShareController at an in-process FakeRelay (also a
 * `Bun.serve` WebSocket), and exercises the path from `EventBus.broadcast()`
 * through the SseTap → outbound `sse` envelope → relay route → peer socket.
 *
 * What it asserts that the per-unit tests don't:
 *  - Ordering and monotonic `seq` of bridged frames across the real WebSocket
 *    transport (not via an injected `broadcast` stub).
 *  - `sse-snapshot` is emitted to a freshly-joined peer, addressed to that
 *    peer's connId, and carries the latest-status-per-node entries seeded
 *    by events fired BEFORE the peer joined.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerWebSocket } from 'bun';
import { type EventBus, createEventBus } from '../src/events.ts';
import { createApp } from '../src/server.ts';
import { type Envelope, makeEnvelope, parseEnvelope } from '../src/share-envelope.ts';
import { type ShareController, createShareController } from '../src/share.ts';
import {
  type SsePayload,
  SsePayloadSchema,
  type SseSnapshotPayload,
  SseSnapshotPayloadSchema,
} from '../src/share/sse-frame.ts';

interface IssuedSession {
  sessionId: string;
  token: string;
  hostKey: string;
}

interface RelayConnData {
  connId: string;
  sessionId: string | null;
  role: 'pending' | 'host' | 'peer';
}

interface FakeRelay {
  baseURL: string;
  wsUrl: string;
  stop: () => void;
  hasHostFor: (sessionId: string) => boolean;
}

function startFakeRelay(): FakeRelay {
  let connSeq = 0;
  const sessions = new Map<string, IssuedSession>();
  const conns = new Map<string, ServerWebSocket<RelayConnData>>();
  const sessionHost = new Map<string, string>();
  const sessionPeers = new Map<string, Set<string>>();

  const removeFromSession = (data: RelayConnData) => {
    if (!data.sessionId) return;
    if (sessionHost.get(data.sessionId) === data.connId) {
      sessionHost.delete(data.sessionId);
    }
    sessionPeers.get(data.sessionId)?.delete(data.connId);
  };

  const route = (env: Envelope, fromConnId: string, sessionId: string) => {
    const hostConn = sessionHost.get(sessionId);
    const peers = sessionPeers.get(sessionId) ?? new Set<string>();
    const rewritten: Envelope = { ...env, from: fromConnId };
    const targets: string[] = [];
    if (env.to === undefined || env.to === 'all') {
      if (hostConn && hostConn !== fromConnId) targets.push(hostConn);
      for (const p of peers) if (p !== fromConnId) targets.push(p);
    } else if (env.to === 'host') {
      if (hostConn && hostConn !== fromConnId) targets.push(hostConn);
    } else if (env.to !== fromConnId) {
      targets.push(env.to);
    }
    const payload = JSON.stringify(rewritten);
    for (const t of targets) {
      const sock = conns.get(t);
      if (sock) sock.send(payload);
    }
  };

  const server = Bun.serve<RelayConnData>({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req, srv) {
      const url = new URL(req.url);
      if (req.method === 'POST' && url.pathname === '/api/share/sessions') {
        const sessionId = `sess-${++connSeq}`;
        const token = `tok-${sessionId}`;
        const hostKey = `hk-${sessionId}`;
        sessions.set(sessionId, { sessionId, token, hostKey });
        return Response.json({
          sessionId,
          token,
          hostKey,
          wsUrl: `ws://127.0.0.1:${srv.port}/`,
        });
      }
      if (req.method === 'GET') {
        const data: RelayConnData = {
          connId: `conn-${++connSeq}`,
          sessionId: null,
          role: 'pending',
        };
        if (srv.upgrade(req, { data })) return undefined;
        return new Response('upgrade failed', { status: 400 });
      }
      return new Response('not found', { status: 404 });
    },
    websocket: {
      open(ws) {
        conns.set(ws.data.connId, ws);
      },
      message(ws, raw) {
        if (typeof raw !== 'string') return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }
        const result = parseEnvelope(parsed);
        if (!result.ok) return;
        const env = result.envelope;
        if (env.type === 'auth-host') {
          const payload = env.payload as { sessionId?: string; hostKey?: string } | null;
          const issued = payload?.sessionId ? sessions.get(payload.sessionId) : undefined;
          if (!issued || issued.hostKey !== payload?.hostKey) {
            ws.close(1008, 'unauthorized');
            return;
          }
          ws.data.sessionId = issued.sessionId;
          ws.data.role = 'host';
          sessionHost.set(issued.sessionId, ws.data.connId);
          return;
        }
        if (env.type === 'auth-peer') {
          const payload = env.payload as { token?: string } | null;
          let session: IssuedSession | undefined;
          if (payload?.token) {
            for (const s of sessions.values()) {
              if (s.token === payload.token) {
                session = s;
                break;
              }
            }
          }
          if (!session) {
            ws.close(1008, 'unauthorized');
            return;
          }
          ws.data.sessionId = session.sessionId;
          ws.data.role = 'peer';
          let set = sessionPeers.get(session.sessionId);
          if (!set) {
            set = new Set();
            sessionPeers.set(session.sessionId, set);
          }
          set.add(ws.data.connId);
          return;
        }
        if (!ws.data.sessionId) {
          ws.close(1008, 'not-authed');
          return;
        }
        route(env, ws.data.connId, ws.data.sessionId);
      },
      close(ws) {
        conns.delete(ws.data.connId);
        removeFromSession(ws.data);
      },
    },
  });

  return {
    baseURL: `http://127.0.0.1:${server.port}`,
    wsUrl: `ws://127.0.0.1:${server.port}/`,
    stop: () => {
      server.stop(true);
    },
    hasHostFor: (sessionId) => sessionHost.has(sessionId),
  };
}

interface StudioFixture {
  baseURL: string;
  eventBus: EventBus;
  share: ShareController;
  stop: () => void;
  tmpHome: string;
  auditDir: string;
}

function startStudio(relayHttpUrl: string, flowId: string): StudioFixture {
  const tmpHome = mkdtempSync(join(tmpdir(), 'share-sse-it-'));
  const auditDir = join(tmpHome, 'share-audit');
  const eventBus = createEventBus();
  const share = createShareController({
    relayHttpUrl,
    shareUrlBase: 'http://share.test',
    eventBus,
    flowIdsForBroadcast: () => [flowId],
    auditDir,
  });
  const app = createApp({
    mode: 'prod',
    staticRoot: join(tmpHome, '__nosuch_static__'),
    disableWatcher: true,
    events: eventBus,
    share,
  });
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: app.fetch });
  return {
    baseURL: `http://127.0.0.1:${server.port}`,
    eventBus,
    share,
    tmpHome,
    auditDir,
    stop: () => {
      server.stop(true);
    },
  };
}

const waitUntil = async (
  cond: () => boolean,
  timeoutMs: number,
  intervalMs = 25,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await Bun.sleep(intervalMs);
  }
  if (!cond()) throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
};

const openPeerWs = async (wsUrl: string, onFrame: (env: Envelope) => void): Promise<WebSocket> => {
  const ws = new WebSocket(wsUrl);
  ws.addEventListener('message', (ev) => {
    const data = (ev as MessageEvent).data;
    if (typeof data !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    const result = parseEnvelope(parsed);
    if (result.ok) onFrame(result.envelope);
  });
  await new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      ws.removeEventListener('error', onError);
      resolve();
    };
    const onError = () => {
      ws.removeEventListener('open', onOpen);
      reject(new Error('peer ws failed to open'));
    };
    ws.addEventListener('open', onOpen, { once: true });
    ws.addEventListener('error', onError, { once: true });
  });
  return ws;
};

describe('integration: SSE bridge through relay (US-073)', () => {
  let relay: FakeRelay;
  let studio: StudioFixture;
  const flowId = 'sse-bridge-flow';

  beforeEach(() => {
    relay = startFakeRelay();
    studio = startStudio(relay.baseURL, flowId);
  });

  afterEach(() => {
    try {
      studio.stop();
    } catch {
      /* already stopped */
    }
    try {
      relay.stop();
    } catch {
      /* already stopped */
    }
    try {
      rmSync(studio.tmpHome, { recursive: true, force: true });
    } catch {
      /* nothing to clean */
    }
  });

  it('bridges node:running / node:done / node:error to the peer in order with monotonic seq', async () => {
    // Start the host session and wait for the FakeRelay to register the
    // auth-host before we connect the peer.
    const startRes = await fetch(`${studio.baseURL}/api/share/start`, { method: 'POST' });
    expect(startRes.status).toBe(200);
    const startBody = (await startRes.json()) as { url: string; sessionId: string };
    const token = startBody.url.split('/').pop() ?? '';
    await waitUntil(() => relay.hasHostFor(startBody.sessionId), 1000);

    // Connect a peer WS and auth as a peer. We intentionally do NOT send a
    // presence/join here — without a known peer connId, the bridge falls back
    // to the legacy `to: 'all'` broadcast which the relay still fans out to
    // every authed peer in the session. This exercises the bridge path that
    // matters for the AC: the outbound envelope shape + seq monotonicity.
    const peerFrames: Envelope[] = [];
    const peer = await openPeerWs(relay.wsUrl, (env) => peerFrames.push(env));
    peer.send(
      JSON.stringify(makeEnvelope('auth-peer', { token, displayName: 'P' }, { from: 'peer-self' })),
    );
    // Give the relay a tick to register the peer in sessionPeers so the
    // subsequent broadcast has a routing target.
    await Bun.sleep(50);

    studio.eventBus.broadcast({
      type: 'node:running',
      flowId,
      payload: { nodeId: 'n1', runId: 'r1' },
    });
    studio.eventBus.broadcast({
      type: 'node:done',
      flowId,
      payload: { nodeId: 'n1', runId: 'r1' },
    });
    studio.eventBus.broadcast({
      type: 'node:error',
      flowId,
      payload: { nodeId: 'n1', runId: 'r1', error: 'boom' },
    });

    await waitUntil(() => peerFrames.filter((f) => f.type === 'sse').length >= 3, 2000);

    const sseFrames = peerFrames.filter((f) => f.type === 'sse');
    expect(sseFrames).toHaveLength(3);

    // Each payload must parse against the SsePayloadSchema (the wire contract
    // shared with the seeflow-viewer peer mirror).
    const payloads: SsePayload[] = sseFrames.map((f) => SsePayloadSchema.parse(f.payload));

    expect(payloads[0]?.t).toBe('node:running');
    expect(payloads[1]?.t).toBe('node:done');
    expect(payloads[2]?.t).toBe('node:error');

    for (const p of payloads) {
      expect(p.flowId).toBe(flowId);
      expect(typeof p.ts).toBe('number');
    }

    // Seq is strictly monotonic across the 3 bridged events.
    const seqs = payloads.map((p) => p.seq);
    expect(seqs[1]).toBeGreaterThan(seqs[0] ?? -1);
    expect(seqs[2]).toBeGreaterThan(seqs[1] ?? -1);

    // The bridged payload carries the original StudioEvent.payload under
    // `data` (opaque pass-through; the canvas reshapes downstream).
    const firstData = payloads[0]?.data as { nodeId?: string; runId?: string };
    expect(firstData?.nodeId).toBe('n1');
    expect(firstData?.runId).toBe('r1');

    peer.close();
  });

  it('late join: emits sse-snapshot addressed to the joining peer with latest-per-node entries', async () => {
    const startRes = await fetch(`${studio.baseURL}/api/share/start`, { method: 'POST' });
    expect(startRes.status).toBe(200);
    const startBody = (await startRes.json()) as { url: string; sessionId: string };
    const token = startBody.url.split('/').pop() ?? '';
    await waitUntil(() => relay.hasHostFor(startBody.sessionId), 1000);

    // Fire a few events BEFORE the peer joins. These seed the SseTap's
    // last-status-per-node map so the snapshot has something to replay.
    // Last write wins per (flowId, nodeId): n1 -> node:done, n2 -> node:running.
    studio.eventBus.broadcast({
      type: 'node:running',
      flowId,
      payload: { nodeId: 'n1', runId: 'r1' },
    });
    studio.eventBus.broadcast({
      type: 'node:done',
      flowId,
      payload: { nodeId: 'n1', runId: 'r1' },
    });
    studio.eventBus.broadcast({
      type: 'node:running',
      flowId,
      payload: { nodeId: 'n2', runId: 'r2' },
    });

    // Now connect the peer and join. The relay rewrites `from` to the peer's
    // server-assigned connId; the host then addresses sse-snapshot to that
    // same connId.
    const peerFrames: Envelope[] = [];
    const peer = await openPeerWs(relay.wsUrl, (env) => peerFrames.push(env));
    peer.send(
      JSON.stringify(
        makeEnvelope('auth-peer', { token, displayName: 'LateJoiner' }, { from: 'peer-self' }),
      ),
    );
    await Bun.sleep(50);
    peer.send(
      JSON.stringify(
        makeEnvelope(
          'presence',
          { kind: 'join', peerId: 'peer-1', displayName: 'LateJoiner' },
          { from: 'peer-self' },
        ),
      ),
    );

    await waitUntil(() => peerFrames.some((f) => f.type === 'sse-snapshot'), 2000);

    const snapshotFrame = peerFrames.find((f) => f.type === 'sse-snapshot');
    expect(snapshotFrame).toBeDefined();
    if (!snapshotFrame) throw new Error('unreachable');

    // Snapshot must be addressed to the peer's connId (NOT 'all' / 'host').
    expect(snapshotFrame.to).toBeDefined();
    expect(snapshotFrame.to).not.toBe('all');
    expect(snapshotFrame.to).not.toBe('host');
    expect(typeof snapshotFrame.to).toBe('string');

    // Snapshot payload must parse against SseSnapshotPayloadSchema and carry
    // the latest-per-node entries for the seeded flow.
    const snap: SseSnapshotPayload = SseSnapshotPayloadSchema.parse(snapshotFrame.payload);
    const flowEntry = snap.flows[flowId];
    expect(flowEntry).toBeDefined();
    if (!flowEntry) throw new Error('unreachable');
    // n1's latest is node:done (the running was overwritten); n2's latest is node:running.
    expect(flowEntry.n1?.t).toBe('node:done');
    expect(flowEntry.n2?.t).toBe('node:running');
    expect(flowEntry.n1?.flowId).toBe(flowId);
    expect(flowEntry.n2?.flowId).toBe(flowId);

    peer.close();
  });
});
