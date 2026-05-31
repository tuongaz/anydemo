/**
 * Phase-8 integration test (US-084): exercises the full host-relay loop for
 * kick, rotate, and kill-switch via the studio HTTP stack + an in-process
 * FakeRelay. Asserts that each accepted RPC produces a kind-shaped audit
 * entry in the per-session JSONL log and that the relay-stub observes the
 * expected POST bodies. The "log discipline" requirement (relay frame logs
 * carry only {type, from, to, sizeBytes} and never a payload) is enforced
 * separately in `cloud/lambda/share/session-kick.log.test.ts`; see design
 * doc line 265 ("Relay log discipline").
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerWebSocket } from 'bun';
import { type EventBus, createEventBus } from '../src/events.ts';
import { createApp } from '../src/server.ts';
import type { AuditEntry } from '../src/share-audit.ts';
import { type Envelope, makeEnvelope, parseEnvelope } from '../src/share-envelope.ts';
import { type ShareController, createShareController } from '../src/share.ts';

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

interface RelayObservations {
  kickRequests: Array<{ sessionId: string; hostKey: string; peerId: string }>;
  rotateRequests: Array<{ sessionId: string; hostKey: string }>;
  endRequests: Array<{ sessionId: string; hostKey: string }>;
}

interface FakeRelay {
  baseURL: string;
  wsUrl: string;
  observations: RelayObservations;
  /** Seed a session row directly (kill-switch scenario: studio never started). */
  preIssueSession: (sessionId: string, hostKey: string) => string;
  /** Current token for a session (rotate test reads this to confirm rotation). */
  currentToken: (sessionId: string) => string | null;
  /** Mimic /api/share/join: returns 200 with token-valid, 404 for stale tokens. */
  joinUrl: (token: string) => string;
  stop: () => void;
}

function startFakeRelay(): FakeRelay {
  let connSeq = 0;
  const sessions = new Map<string, IssuedSession>();
  const conns = new Map<string, ServerWebSocket<RelayConnData>>();
  const sessionHost = new Map<string, string>();
  const sessionPeers = new Map<string, Set<string>>();
  const observations: RelayObservations = {
    kickRequests: [],
    rotateRequests: [],
    endRequests: [],
  };

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

  const findSessionByToken = (token: string): IssuedSession | undefined => {
    for (const s of sessions.values()) {
      if (s.token === token) return s;
    }
    return undefined;
  };

  const server = Bun.serve<RelayConnData>({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req, srv) {
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

      if (req.method === 'POST' && url.pathname === '/api/share/kick') {
        const body = (await req.json()) as {
          sessionId: string;
          hostKey: string;
          peerId: string;
        };
        observations.kickRequests.push(body);
        const session = sessions.get(body.sessionId);
        if (!session) {
          return Response.json({ error: 'unknown-session' }, { status: 404 });
        }
        if (session.hostKey !== body.hostKey) {
          return Response.json({ error: 'unauthorized' }, { status: 401 });
        }
        return Response.json({ ok: true, kicked: 1 });
      }

      if (req.method === 'POST' && url.pathname === '/api/share/rotate') {
        const body = (await req.json()) as { sessionId: string; hostKey: string };
        observations.rotateRequests.push(body);
        const session = sessions.get(body.sessionId);
        if (!session) {
          return Response.json({ error: 'unknown-session' }, { status: 404 });
        }
        if (session.hostKey !== body.hostKey) {
          return Response.json({ error: 'unauthorized' }, { status: 401 });
        }
        const newToken = `tok-${body.sessionId}-rot-${++connSeq}`;
        session.token = newToken;
        return Response.json({ ok: true, token: newToken, url: `http://share.test/${newToken}` });
      }

      if (req.method === 'POST' && url.pathname === '/api/share/end') {
        const body = (await req.json()) as { sessionId: string; hostKey: string };
        observations.endRequests.push(body);
        const session = sessions.get(body.sessionId);
        if (!session) {
          return Response.json({ error: 'unknown-session' }, { status: 404 });
        }
        if (session.hostKey !== body.hostKey) {
          return Response.json({ error: 'unauthorized' }, { status: 401 });
        }
        sessions.delete(body.sessionId);
        sessionHost.delete(body.sessionId);
        sessionPeers.delete(body.sessionId);
        return Response.json({ ok: true, ended: 0 });
      }

      // /api/share/join — used by scenario 2 to assert token-version invalidation.
      if (req.method === 'POST' && url.pathname === '/api/share/join') {
        const body = (await req.json()) as { token: string };
        const matched = findSessionByToken(body.token);
        if (!matched) return Response.json({ error: 'unknown-token' }, { status: 404 });
        return Response.json({ ok: true, sessionId: matched.sessionId });
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
          const session = payload?.token ? findSessionByToken(payload.token) : undefined;
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
    observations,
    preIssueSession: (sessionId, hostKey) => {
      const token = `tok-${sessionId}`;
      sessions.set(sessionId, { sessionId, token, hostKey });
      return token;
    },
    currentToken: (sessionId) => sessions.get(sessionId)?.token ?? null,
    joinUrl: (token) => `http://127.0.0.1:${server.port}/api/share/join?token=${token}`,
    stop: () => {
      server.stop(true);
    },
  };
}

interface StudioFixture {
  baseURL: string;
  eventBus: EventBus;
  share: ShareController;
  stop: () => void;
}

function startStudio(
  relayHttpUrl: string,
  auditDir: string,
  activeSessionsPath: string,
): StudioFixture {
  const eventBus = createEventBus();
  const share = createShareController({
    relayHttpUrl,
    shareUrlBase: 'http://share.test',
    eventBus,
    flowIdsForBroadcast: () => [],
    auditDir,
    activeSessionsPath,
  });
  const app = createApp({
    mode: 'prod',
    staticRoot: join(auditDir, '__nosuch_static__'),
    disableWatcher: true,
    events: eventBus,
    share,
  });
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: app.fetch });
  return {
    baseURL: `http://127.0.0.1:${server.port}`,
    eventBus,
    share,
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

const readAuditEntries = (auditDir: string, sessionId: string): AuditEntry[] => {
  const path = join(auditDir, `${sessionId}.jsonl`);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as AuditEntry);
};

const isPhase8Entry = (e: AuditEntry): boolean =>
  typeof (e as { kind?: unknown }).kind === 'string';

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

describe('integration: phase-8 kick / rotate / kill-switch (US-084)', () => {
  let relay: FakeRelay;
  let tmpHome: string;
  let auditDir: string;
  let activeSessionsPath: string;
  let studio: StudioFixture | null = null;

  beforeEach(() => {
    relay = startFakeRelay();
    tmpHome = mkdtempSync(join(tmpdir(), 'share-phase8-it-'));
    auditDir = join(tmpHome, 'share-audit');
    activeSessionsPath = join(auditDir, 'active.json');
    mkdirSync(auditDir, { recursive: true });
  });

  afterEach(() => {
    if (studio) {
      try {
        studio.stop();
      } catch {
        /* already stopped */
      }
      studio = null;
    }
    try {
      relay.stop();
    } catch {
      /* already stopped */
    }
    try {
      rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      /* nothing to clean */
    }
  });

  it('scenario 1 — kick records {kind:"kick", peerId} audit entry and relay observes correct body', async () => {
    studio = startStudio(relay.baseURL, auditDir, activeSessionsPath);
    const startRes = await fetch(`${studio.baseURL}/api/share/start`, { method: 'POST' });
    expect(startRes.status).toBe(200);
    const { sessionId, url } = (await startRes.json()) as { sessionId: string; url: string };
    const token = url.split('/').pop() ?? '';

    // Join two peers so the host's connPeers map carries both. Without this the
    // controller's kick() throws share-peer-not-found before issuing the HTTP
    // call (no peer in the local index).
    const peerA = await openPeerWs(relay.wsUrl);
    peerA.send(
      JSON.stringify(
        makeEnvelope('auth-peer', { token, displayName: 'A' }, { from: 'peer-a-self' }),
      ),
    );
    await Bun.sleep(25);
    peerA.send(
      JSON.stringify(
        makeEnvelope(
          'presence',
          { kind: 'join', peerId: 'peer-a', displayName: 'A' },
          { from: 'peer-a-self' },
        ),
      ),
    );

    const peerB = await openPeerWs(relay.wsUrl);
    peerB.send(
      JSON.stringify(
        makeEnvelope('auth-peer', { token, displayName: 'B' }, { from: 'peer-b-self' }),
      ),
    );
    await Bun.sleep(25);
    peerB.send(
      JSON.stringify(
        makeEnvelope(
          'presence',
          { kind: 'join', peerId: 'peer-b', displayName: 'B' },
          { from: 'peer-b-self' },
        ),
      ),
    );

    // Wait for both peers to land in the state.peers roster so kick() resolves
    // them via connPeers.
    await waitUntil(() => {
      const s = studio?.share.state();
      if (!s || s.status !== 'active') return false;
      return (
        s.peers.some((p) => p.peerId === 'peer-a') && s.peers.some((p) => p.peerId === 'peer-b')
      );
    }, 1500);

    const kickRes = await fetch(`${studio.baseURL}/api/share/kick`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ peerId: 'peer-a' }),
    });
    expect(kickRes.status).toBe(204);

    // Audit entry lands within 1s (fire-and-forget append).
    await waitUntil(() => {
      const entries = readAuditEntries(auditDir, sessionId).filter(isPhase8Entry);
      return entries.some((e) => e.kind === 'kick' && e.peerId === 'peer-a');
    }, 1000);

    const kickEntries = readAuditEntries(auditDir, sessionId)
      .filter(isPhase8Entry)
      .filter((e) => e.kind === 'kick');
    expect(kickEntries).toHaveLength(1);
    expect(kickEntries[0]?.peerId).toBe('peer-a');

    // Relay stub saw exactly one kick POST with the studio's sessionId + hostKey.
    expect(relay.observations.kickRequests).toHaveLength(1);
    const observed = relay.observations.kickRequests[0];
    expect(observed?.sessionId).toBe(sessionId);
    expect(observed?.peerId).toBe('peer-a');
    expect(typeof observed?.hostKey).toBe('string');
    expect((observed?.hostKey ?? '').length).toBeGreaterThan(0);

    peerA.close();
    peerB.close();
  });

  it('scenario 2 — rotate swaps token, audit records {kind:"rotate"}, and stale token returns 404', async () => {
    studio = startStudio(relay.baseURL, auditDir, activeSessionsPath);
    const startRes = await fetch(`${studio.baseURL}/api/share/start`, { method: 'POST' });
    expect(startRes.status).toBe(200);
    const startBody = (await startRes.json()) as { sessionId: string; url: string };
    const tokenT1 = startBody.url.split('/').pop() ?? '';

    // Verify T1 joins fine pre-rotate.
    const joinT1Before = await fetch(`${relay.baseURL}/api/share/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: tokenT1 }),
    });
    expect(joinT1Before.status).toBe(200);

    const rotateRes = await fetch(`${studio.baseURL}/api/share/rotate`, { method: 'POST' });
    expect(rotateRes.status).toBe(200);
    const rotateBody = (await rotateRes.json()) as { url: string };
    const tokenT2 = rotateBody.url.split('/').pop() ?? '';
    expect(tokenT1).not.toBe(tokenT2);
    expect(tokenT2.length).toBeGreaterThan(0);
    expect(relay.currentToken(startBody.sessionId)).toBe(tokenT2);

    // Audit logger appends `rotate` within 1s.
    await waitUntil(() => {
      const entries = readAuditEntries(auditDir, startBody.sessionId).filter(isPhase8Entry);
      return entries.some((e) => e.kind === 'rotate');
    }, 1000);

    // Relay stub received exactly one rotate request.
    expect(relay.observations.rotateRequests).toHaveLength(1);
    expect(relay.observations.rotateRequests[0]?.sessionId).toBe(startBody.sessionId);

    // Subsequent join with T1 returns 404 (relay-stub mimics token-version
    // invalidation by replacing session.token on rotate).
    const joinT1After = await fetch(`${relay.baseURL}/api/share/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: tokenT1 }),
    });
    expect(joinT1After.status).toBe(404);

    // T2 joins successfully.
    const joinT2 = await fetch(`${relay.baseURL}/api/share/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: tokenT2 }),
    });
    expect(joinT2.status).toBe(200);
  });

  it('scenario 3 — kill-all revokes 2 tracked sessions, writes kill-switch to each, truncates active.json', async () => {
    // Seed active.json directly with two tracked sessions; pre-issue them on
    // the relay so /api/share/end accepts the hostKey. The studio process
    // never had to "start" these — killAll() works off active.json alone.
    const sessions = [
      { sessionId: 'sess-killtest-1', hostKey: 'hk-killtest-1' },
      { sessionId: 'sess-killtest-2', hostKey: 'hk-killtest-2' },
    ];
    for (const s of sessions) {
      relay.preIssueSession(s.sessionId, s.hostKey);
    }
    writeFileSync(activeSessionsPath, JSON.stringify(sessions));

    studio = startStudio(relay.baseURL, auditDir, activeSessionsPath);

    const killRes = await fetch(`${studio.baseURL}/api/share/kill-all`, { method: 'POST' });
    expect(killRes.status).toBe(200);
    const killBody = (await killRes.json()) as { revoked: number; failed: number };
    expect(killBody).toEqual({ revoked: 2, failed: 0 });

    // Relay stub received exactly 2 /api/share/end requests, one per session.
    expect(relay.observations.endRequests).toHaveLength(2);
    const endSessionIds = relay.observations.endRequests.map((r) => r.sessionId).sort();
    expect(endSessionIds).toEqual(['sess-killtest-1', 'sess-killtest-2']);

    // Each affected session's audit JSONL file carries one kill-switch entry
    // with details {revoked:2, failed:0}. killAll closes the per-session
    // logger after appending, so the line lands synchronously before the
    // HTTP response resolves.
    for (const s of sessions) {
      const entries = readAuditEntries(auditDir, s.sessionId).filter(isPhase8Entry);
      const killSwitch = entries.filter((e) => e.kind === 'kill-switch');
      expect(killSwitch).toHaveLength(1);
      expect(killSwitch[0]?.details).toEqual({ revoked: 2, failed: 0 });
    }

    // active.json is truncated to [].
    const tracked = JSON.parse(readFileSync(activeSessionsPath, 'utf8'));
    expect(tracked).toEqual([]);
  });
});
