/**
 * End-to-end integration test for the Live Share host pipeline (US-023).
 *
 * Boots the full studio HTTP stack in-process (createApp + Bun.serve) and
 * points the injected ShareController at an in-process FakeRelay. Both ends
 * use real Bun WebSockets so the transport, envelope schema, auth handshake,
 * presence router, and outbound SSE bridge all get a genuine network round
 * trip — only the relay routing logic is faked. The FakeRelay mirrors the
 * production routing rules in cloud/lambda/share/ws-default.ts: route by
 * `env.to` (with 'all'/undefined fan-out and 'host' shortcut), and rewrite
 * the outbound `from` field to the sender's server-assigned connId so the
 * host's handleFrame can use it as the kick routing key.
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
import { connectSse } from './support/sse-client.ts';

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
  observed: {
    hostConnectionCount: () => number;
    hostAuthFrames: () => Array<{ sessionId: string; hostKey: string }>;
    hasHostFor: (sessionId: string) => boolean;
  };
}

function startFakeRelay(): FakeRelay {
  let connSeq = 0;
  const sessions = new Map<string, IssuedSession>();
  const conns = new Map<string, ServerWebSocket<RelayConnData>>();
  const sessionHost = new Map<string, string>();
  const sessionPeers = new Map<string, Set<string>>();
  const hostAuthFrames: Array<{ sessionId: string; hostKey: string }> = [];
  let hostConnectionCount = 0;

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
      // Any other GET is treated as a WS upgrade attempt.
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
          hostConnectionCount++;
          hostAuthFrames.push({ sessionId: issued.sessionId, hostKey: issued.hostKey });
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
    observed: {
      hostConnectionCount: () => hostConnectionCount,
      hostAuthFrames: () => [...hostAuthFrames],
      hasHostFor: (sessionId) => sessionHost.has(sessionId),
    },
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
  const tmpHome = mkdtempSync(join(tmpdir(), 'share-it-'));
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
    // Avoid the SPA bundle requirement — these tests only hit /api/share/*.
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

const openPeerWs = async (wsUrl: string, onFrame?: (env: Envelope) => void): Promise<WebSocket> => {
  const ws = new WebSocket(wsUrl);
  if (onFrame) {
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
  }
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

describe('integration: share host ↔ peer round-trip via FakeRelay', () => {
  let relay: FakeRelay;
  let studio: StudioFixture;
  const flowId = 'test-flow';

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

  it('test 1: POST /api/share/start completes the host auth-host handshake', async () => {
    const res = await fetch(`${studio.baseURL}/api/share/start`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; sessionId: string };
    expect(typeof body.sessionId).toBe('string');
    expect(body.url).toBe(`http://share.test/tok-${body.sessionId}`);

    // Wait until the FakeRelay observes the auth-host frame (loopback is
    // sub-ms, but Bun.serve dispatches messages on the event loop).
    await waitUntil(() => relay.observed.hostAuthFrames().length === 1, 1000);
    const frames = relay.observed.hostAuthFrames();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({
      sessionId: body.sessionId,
      hostKey: `hk-${body.sessionId}`,
    });
    expect(relay.observed.hostConnectionCount()).toBe(1);
  });

  it('test 2: peer presence/join surfaces in /api/share/state SSE stream', async () => {
    const startRes = await fetch(`${studio.baseURL}/api/share/start`, { method: 'POST' });
    expect(startRes.status).toBe(200);
    const startBody = (await startRes.json()) as { url: string; sessionId: string };
    const token = startBody.url.split('/').pop() ?? '';
    await waitUntil(() => relay.observed.hasHostFor(startBody.sessionId), 1000);

    const peer = await openPeerWs(relay.wsUrl);
    peer.send(
      JSON.stringify(
        makeEnvelope('auth-peer', { token, displayName: 'Test Peer' }, { from: 'peer-self' }),
      ),
    );
    // Give the relay a tick to register the peer before we send presence.
    await Bun.sleep(25);
    peer.send(
      JSON.stringify(
        makeEnvelope(
          'presence',
          { kind: 'join', peerId: 'peer-1', displayName: 'Test Peer' },
          { from: 'peer-self' },
        ),
      ),
    );

    const sse = await connectSse(studio.baseURL, '/api/share/state');
    try {
      const event = await sse.waitFor((e) => {
        if (e.event !== 'state') return false;
        try {
          const s = JSON.parse(e.data) as { status: string; peers?: Array<{ peerId: string }> };
          return s.status === 'active' && (s.peers ?? []).some((p) => p.peerId === 'peer-1');
        } catch {
          return false;
        }
      }, 3000);
      const state = JSON.parse(event.data) as {
        status: 'active';
        peers: Array<{ peerId: string; displayName: string; joinedAt: number }>;
      };
      const joined = state.peers.find((p) => p.peerId === 'peer-1');
      expect(joined?.displayName).toBe('Test Peer');
      expect(typeof joined?.joinedAt).toBe('number');
    } finally {
      sse.close();
      peer.close();
    }
  });

  it('test 3: studio eventBus broadcast fans out to peer as sse envelope', async () => {
    const startRes = await fetch(`${studio.baseURL}/api/share/start`, { method: 'POST' });
    expect(startRes.status).toBe(200);
    const startBody = (await startRes.json()) as { url: string; sessionId: string };
    const token = startBody.url.split('/').pop() ?? '';
    await waitUntil(() => relay.observed.hasHostFor(startBody.sessionId), 1000);

    const peerFrames: Envelope[] = [];
    const peer = await openPeerWs(relay.wsUrl, (env) => peerFrames.push(env));
    peer.send(
      JSON.stringify(makeEnvelope('auth-peer', { token, displayName: 'P' }, { from: 'peer-self' })),
    );
    // Wait for the relay to register the peer in sessionPeers; without this
    // the broadcast could fire before the peer is a routing target.
    await Bun.sleep(50);

    studio.eventBus.broadcast({
      type: 'node:running',
      flowId,
      payload: { nodeId: 'n1', runId: 'r1' },
    });

    await waitUntil(() => peerFrames.some((f) => f.type === 'sse'), 1000);
    const sseFrame = peerFrames.find((f) => f.type === 'sse');
    expect(sseFrame).toBeDefined();
    if (!sseFrame) throw new Error('unreachable');
    const payload = sseFrame.payload as {
      t: string;
      flowId: string;
      data: { nodeId: string };
    };
    expect(payload.t).toBe('node:running');
    expect(payload.flowId).toBe(flowId);
    expect(payload.data.nodeId).toBe('n1');

    peer.close();
  });

  it('test 4: POST /api/share/stop tears down WS and controller is reusable', async () => {
    const startRes = await fetch(`${studio.baseURL}/api/share/start`, { method: 'POST' });
    expect(startRes.status).toBe(200);
    const startBody = (await startRes.json()) as { url: string; sessionId: string };
    await waitUntil(() => relay.observed.hasHostFor(startBody.sessionId), 1000);
    expect(relay.observed.hostConnectionCount()).toBe(1);

    const stopRes = await fetch(`${studio.baseURL}/api/share/stop`, { method: 'POST' });
    expect(stopRes.status).toBe(204);

    // The host transport's user-close (1000) propagates through the relay's
    // close handler within a tick or two. 1s budget per acceptance criteria.
    await waitUntil(() => !relay.observed.hasHostFor(startBody.sessionId), 1000);

    const restartRes = await fetch(`${studio.baseURL}/api/share/start`, { method: 'POST' });
    expect(restartRes.status).toBe(200);
    const restartBody = (await restartRes.json()) as { url: string; sessionId: string };
    expect(restartBody.sessionId).not.toBe(startBody.sessionId);

    await waitUntil(() => relay.observed.hostConnectionCount() === 2, 1000);
    expect(relay.observed.hasHostFor(restartBody.sessionId)).toBe(true);
  });
});
