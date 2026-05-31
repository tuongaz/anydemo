/**
 * Phase-4 exit-criterion integration test (US-044): two-peer co-edit through
 * host serialization end-to-end.
 *
 * Boots a real ShareController against an in-process FakeRelay (modelled on
 * the routing in cloud/lambda/share/ws-default.ts and the host↔peer test in
 * share-host-peer.it.ts), wires operations.ts via a real Registry pointing at
 * a tmp project's flow.json, then drives two simulated peers over real Bun
 * WebSockets.
 *
 * The relay is the only fake: every other layer (auth, presence, rpc dispatch,
 * Zod envelope schema, node-patched broadcast, disk write through
 * mutateMergedFlow) is the real implementation.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerWebSocket } from 'bun';
import { createRegistry } from '../src/registry.ts';
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

interface FakeRelay {
  baseURL: string;
  wsUrl: string;
  stop: () => void;
}

// In-process WebSocket relay. Mirrors the production lambda's routing rules:
// fan out `to:'all'` to every other connection in the session, route `to:'host'`
// to the host, address-by-connId for direct targets, and rewrite `from` to the
// sender's relay-assigned connId.
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
  };
}

interface SeededFlow {
  repoPath: string;
  flowFile: string;
  flowId: string;
  registry: ReturnType<typeof createRegistry>;
}

// Seed a minimal-but-valid flow.json + style.json split (the on-disk shape
// strips every visual/layout field from flow.json and parks position +
// presentation in the keyed style.json side-table — see merge.ts). Registry is
// path-isolated per fixture so concurrent runs don't collide.
function seedFlow(tmpRoot: string): SeededFlow {
  const repoPath = mkdtempSync(join(tmpRoot, 'repo-'));
  const flowFile = join(repoPath, 'flow.json');
  const styleFile = join(repoPath, 'style.json');
  const flow = {
    version: 2,
    name: 'co-edit fixture',
    nodes: [
      { id: 'n-a', type: 'rectangle', data: {} },
      { id: 'n-b', type: 'rectangle', data: {} },
    ],
    connectors: [],
  };
  const style = {
    nodes: {
      'n-a': { position: { x: 0, y: 0 } },
      'n-b': { position: { x: 200, y: 200 } },
    },
    connectors: {},
  };
  writeFileSync(flowFile, `${JSON.stringify(flow, null, 2)}\n`);
  writeFileSync(styleFile, `${JSON.stringify(style, null, 2)}\n`);
  const registry = createRegistry({ path: join(tmpRoot, 'registry.json') });
  const entry = registry.upsert({
    name: 'co-edit fixture',
    repoPath,
    flowPath: 'flow.json',
    projectSlug: 'p',
    flowSlug: 'main',
    isDefault: true,
    valid: true,
    lastModified: Date.now(),
  });
  return { repoPath, flowFile, flowId: entry.id, registry };
}

interface PeerClient {
  ws: WebSocket;
  inbox: Envelope[];
  waitForFrame: (pred: (e: Envelope) => boolean, timeoutMs?: number) => Promise<Envelope>;
  send: (env: Envelope) => void;
  close: () => void;
}

async function openPeer(wsUrl: string): Promise<PeerClient> {
  const ws = new WebSocket(wsUrl);
  const inbox: Envelope[] = [];
  const waiters: Array<{ pred: (e: Envelope) => boolean; resolve: (e: Envelope) => void }> = [];
  ws.addEventListener('message', (ev) => {
    const data = (ev as MessageEvent).data;
    if (typeof data !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    const r = parseEnvelope(parsed);
    if (!r.ok) return;
    inbox.push(r.envelope);
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      if (w?.pred(r.envelope)) {
        w.resolve(r.envelope);
        waiters.splice(i, 1);
      }
    }
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
  return {
    ws,
    inbox,
    waitForFrame: (pred, timeoutMs = 1000) => {
      const existing = inbox.find(pred);
      if (existing) return Promise.resolve(existing);
      return new Promise<Envelope>((resolve, reject) => {
        const handle = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.resolve === wrappedResolve);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(new Error(`waitForFrame timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        const wrappedResolve = (e: Envelope) => {
          clearTimeout(handle);
          resolve(e);
        };
        waiters.push({ pred, resolve: wrappedResolve });
      });
    },
    send: (env) => {
      ws.send(JSON.stringify(env));
    },
    close: () => {
      ws.close();
    },
  };
}

interface Fixture {
  relay: FakeRelay;
  share: ShareController;
  flowFile: string;
  flowId: string;
  tmpHome: string;
  url: string;
  sessionId: string;
}

const waitUntil = async (
  cond: () => boolean,
  timeoutMs: number,
  intervalMs = 10,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await Bun.sleep(intervalMs);
  }
  if (!cond()) throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
};

async function bootFixture(): Promise<Fixture> {
  const tmpHome = mkdtempSync(join(tmpdir(), 'share-coedit-'));
  const auditDir = join(tmpHome, 'share-audit');
  const seeded = seedFlow(tmpHome);
  const relay = startFakeRelay();
  const share = createShareController({
    relayHttpUrl: relay.baseURL,
    shareUrlBase: 'http://share.test',
    flowIdsForBroadcast: () => [seeded.flowId],
    auditDir,
    operationsDeps: { registry: seeded.registry },
  });
  const { url, sessionId } = await share.start();
  return {
    relay,
    share,
    flowFile: seeded.flowFile,
    flowId: seeded.flowId,
    tmpHome,
    url,
    sessionId,
  };
}

async function joinPeer(fx: Fixture, peerId: string, displayName: string): Promise<PeerClient> {
  const peer = await openPeer(fx.relay.wsUrl);
  const token = fx.url.split('/').pop() ?? '';
  peer.send(makeEnvelope('auth-peer', { token, displayName }, { from: 'peer-self' }));
  // Give the relay a tick to register the peer before sending presence.
  await Bun.sleep(25);
  peer.send(makeEnvelope('presence', { kind: 'join', peerId, displayName }, { from: 'peer-self' }));
  return peer;
}

// Reads the canonical position for each node from the on-disk style.json
// side-table — positions never live in flow.json (see merge.ts / splitFlow).
const readPositionsOnDisk = (
  flowFile: string,
): Record<string, { x: number; y: number } | undefined> => {
  const styleFile = join(flowFile, '..', 'style.json');
  const style = JSON.parse(readFileSync(styleFile, 'utf8')) as {
    nodes?: Record<string, { position?: { x: number; y: number } }>;
  };
  const nodes = style.nodes ?? {};
  const out: Record<string, { x: number; y: number } | undefined> = {};
  for (const [id, entry] of Object.entries(nodes)) {
    out[id] = entry.position;
  }
  return out;
};

describe('integration: two-peer co-edit through host serialization (US-044)', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await bootFixture();
  });

  afterEach(async () => {
    try {
      await fx.share.stop();
    } catch {
      /* already stopped */
    }
    try {
      fx.relay.stop();
    } catch {
      /* already stopped */
    }
    try {
      rmSync(fx.tmpHome, { recursive: true, force: true });
    } catch {
      /* nothing to clean */
    }
  });

  it('moveNode from PeerA persists to disk + PeerB observes node-patched + PeerA sees both broadcast and rpc-result', async () => {
    const peerA = await joinPeer(fx, 'peer-a', 'Peer A');
    const peerB = await joinPeer(fx, 'peer-b', 'Peer B');
    // Let the host accept both presence/join frames before issuing rpc.
    await waitUntil(() => fx.share.state().status === 'active', 1000);
    await waitUntil(() => {
      const s = fx.share.state();
      if (s.status !== 'active') return false;
      return s.peers.length === 2;
    }, 1000);

    const rpcId = 'r-move-1';
    peerA.send(
      makeEnvelope(
        'rpc',
        {
          op: 'moveNode',
          flowId: fx.flowId,
          nodeId: 'n-a',
          position: { x: 500, y: 500 },
        },
        { from: 'peer-self', to: 'host', id: rpcId },
      ),
    );

    const peerAResult = await peerA.waitForFrame(
      (e) => e.type === 'rpc-result' && e.id === rpcId,
      200,
    );
    expect((peerAResult.payload as { ok: boolean }).ok).toBe(true);

    const peerABroadcast = await peerA.waitForFrame((e) => e.type === 'node-patched', 200);
    const peerBBroadcast = await peerB.waitForFrame((e) => e.type === 'node-patched', 200);
    const expectedDiff = { kind: 'move', nodeId: 'n-a', position: { x: 500, y: 500 } };
    expect(peerABroadcast.payload).toEqual({
      flowId: fx.flowId,
      op: 'moveNode',
      diff: expectedDiff,
      version: 1,
      attributedTo: { peerId: 'peer-a', displayName: 'Peer A' },
    });
    expect(peerBBroadcast.payload).toEqual({
      flowId: fx.flowId,
      op: 'moveNode',
      diff: expectedDiff,
      version: 1,
      attributedTo: { peerId: 'peer-a', displayName: 'Peer A' },
    });

    // Style.json on disk should reflect the canonical position write.
    const positions = readPositionsOnDisk(fx.flowFile);
    expect(positions['n-a']).toEqual({ x: 500, y: 500 });

    peerA.close();
    peerB.close();
  });

  it('invalid op (patchNode against unknown node) surfaces ok:false to PeerA, no broadcast, disk unchanged', async () => {
    const peerA = await joinPeer(fx, 'peer-a', 'Peer A');
    const peerB = await joinPeer(fx, 'peer-b', 'Peer B');
    await waitUntil(() => {
      const s = fx.share.state();
      return s.status === 'active' && s.peers.length === 2;
    }, 1000);

    const positionBefore = readPositionsOnDisk(fx.flowFile)['n-a'];

    const rpcId = 'r-bad';
    peerA.send(
      makeEnvelope(
        'rpc',
        {
          op: 'patchNode',
          flowId: 'flow-that-does-not-exist',
          nodeId: 'n-a',
          patch: { name: 'Ignored' },
        },
        { from: 'peer-self', to: 'host', id: rpcId },
      ),
    );

    const result = await peerA.waitForFrame((e) => e.type === 'rpc-result' && e.id === rpcId, 300);
    const payload = result.payload as { ok: boolean; reason?: string };
    expect(payload.ok).toBe(false);
    expect(payload.reason).toMatch(/notFound/i);

    // Give the host a small grace window — node-patched broadcasts (if they
    // were going to fire) would arrive before this completes.
    await Bun.sleep(75);
    const peerANodePatches = peerA.inbox.filter((e) => e.type === 'node-patched');
    const peerBNodePatches = peerB.inbox.filter((e) => e.type === 'node-patched');
    expect(peerANodePatches).toHaveLength(0);
    expect(peerBNodePatches).toHaveLength(0);

    const positionAfter = readPositionsOnDisk(fx.flowFile)['n-a'];
    expect(positionAfter).toEqual(positionBefore ?? { x: 0, y: 0 });

    peerA.close();
    peerB.close();
  });

  it('concurrent moveNodes on the same node serialize through the host; both peers observe both broadcasts in arrival order', async () => {
    const peerA = await joinPeer(fx, 'peer-a', 'Peer A');
    const peerB = await joinPeer(fx, 'peer-b', 'Peer B');
    await waitUntil(() => {
      const s = fx.share.state();
      return s.status === 'active' && s.peers.length === 2;
    }, 1000);

    // Both peers fire moveNode on n-a in the same tick. Bun's single-threaded
    // event loop guarantees ordering by send-order at the relay; mutateMergedFlow's
    // per-flow write lock serializes the actual disk writes.
    peerA.send(
      makeEnvelope(
        'rpc',
        { op: 'moveNode', flowId: fx.flowId, nodeId: 'n-a', position: { x: 111, y: 111 } },
        { from: 'peer-self', to: 'host', id: 'r-A' },
      ),
    );
    peerB.send(
      makeEnvelope(
        'rpc',
        { op: 'moveNode', flowId: fx.flowId, nodeId: 'n-a', position: { x: 222, y: 222 } },
        { from: 'peer-self', to: 'host', id: 'r-B' },
      ),
    );

    // Wait for two node-patched broadcasts on each peer.
    await waitUntil(() => peerA.inbox.filter((e) => e.type === 'node-patched').length >= 2, 500);
    await waitUntil(() => peerB.inbox.filter((e) => e.type === 'node-patched').length >= 2, 500);

    const peerAVersions = peerA.inbox
      .filter((e) => e.type === 'node-patched')
      .map((e) => (e.payload as { version: number }).version);
    const peerBVersions = peerB.inbox
      .filter((e) => e.type === 'node-patched')
      .map((e) => (e.payload as { version: number }).version);
    // Per-peer arrival order matches version monotonicity. Strict equality on
    // [1,2] confirms the host's per-flow counter incremented exactly twice.
    expect(peerAVersions).toEqual([1, 2]);
    expect(peerBVersions).toEqual([1, 2]);

    // The two rpc-results should each round-trip to their originator.
    const resultA = await peerA.waitForFrame((e) => e.type === 'rpc-result' && e.id === 'r-A', 300);
    const resultB = await peerB.waitForFrame((e) => e.type === 'rpc-result' && e.id === 'r-B', 300);
    expect((resultA.payload as { ok: boolean }).ok).toBe(true);
    expect((resultB.payload as { ok: boolean }).ok).toBe(true);

    // Final disk state equals the LAST broadcast's position. Both peers see
    // the same ordering, so reading the last version-2 broadcast tells us the
    // canonical final position.
    const peerAPatched = peerA.inbox.filter((e) => e.type === 'node-patched');
    const lastDiff = (
      peerAPatched.at(-1)?.payload as {
        diff: { position: { x: number; y: number } };
      }
    ).diff;
    const positions = readPositionsOnDisk(fx.flowFile);
    expect(positions['n-a']).toEqual(lastDiff.position);

    peerA.close();
    peerB.close();
  });
});
