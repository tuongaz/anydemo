/**
 * Phase-6 exit-criterion integration test (US-064): end-to-end file transfer
 * across the live-share wire.
 *
 * Boots a real ShareController against an in-process FakeRelay that mirrors
 * the production routing logic for file frames in cloud/lambda/share/ws-default.ts:
 *   - file-request peer->host (rewrite to 'host')
 *   - file-bytes / file-redirect host->peer (route by env.to)
 *   - file-upload-intent peer->host: if size > 256 KB, amend
 *     `payload.upload = { via:'s3', key, putUrl }` pointing at the in-process
 *     fake S3 (same Bun.serve, /staging/<key> routes). <=256 KB amends
 *     `payload.upload = { via:'ws' }`.
 *   - file-upload-done peer->host: amend `payload.getUrl` to the staging GET
 *     URL and track `pendingDeletes[reqId] = key`.
 *   - rpc-result from host with matching `id`: if `ok:true`, fire DeleteObject
 *     (drop the key from the fake S3 map) so the test can assert the bucket
 *     was cleaned up.
 *
 * The fake S3 is colocated on the relay's HTTP server (PUT/GET /staging/<key>)
 * so the host's `putToS3` stub (for the host-serve Scenario B) and the peer's
 * direct PUT (Scenario D) both write through real HTTP — only the AWS SDK is
 * replaced.
 *
 * Every other layer (auth, presence, rpc dispatch, file-request handler,
 * file-upload handler, atomic write, audit log, node-patched broadcast,
 * envelope schema) is the production implementation.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerWebSocket } from 'bun';
import { createRegistry } from '../src/registry.ts';
import type { RpcAuditEntry } from '../src/share-audit.ts';
import type { FileUploadAuditEntry } from '../src/share-audit.ts';
import { type Envelope, makeEnvelope, parseEnvelope } from '../src/share-envelope.ts';
import type { PutToS3, RequestUploadIntent } from '../src/share-file-request.ts';
import { type ShareController, createShareController } from '../src/share.ts';

const TEST_NODE_ID = 'node-aaaaaaaaaa';
const INLINE_LIMIT_BYTES = 256 * 1024;

const sha256Hex = (bytes: Buffer | Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

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

interface RelayObserved {
  stagingKeys: () => string[];
  deletedKeys: () => string[];
}

interface FakeRelay {
  baseURL: string;
  wsUrl: string;
  stop: () => void;
  observed: RelayObserved;
}

// In-process WebSocket relay + fake S3. Mirrors the cloud ws-default routing
// for file frames so the host-side handlers run against the same wire shapes
// they would in production (presigned URL amendment on file-upload-intent,
// getUrl amendment on file-upload-done, DeleteObject on host ack).
function startFakeRelay(): FakeRelay {
  let connSeq = 0;
  const sessions = new Map<string, IssuedSession>();
  const conns = new Map<string, ServerWebSocket<RelayConnData>>();
  const sessionHost = new Map<string, string>();
  const sessionPeers = new Map<string, Set<string>>();
  // sessionId -> { reqId -> stagingKey } for file-upload-done frames so the
  // relay can fire DeleteObject when the host acks with rpc-result.ok=true.
  const pendingDeletes = new Map<string, string>();
  const stagingMap = new Map<string, Buffer>();
  const deletedKeys = new Set<string>();

  const stagingUrlFor = (key: string): string =>
    `${baseURL}/staging/${key.split('/').map(encodeURIComponent).join('/')}`;

  let baseURL = '';

  const removeFromSession = (data: RelayConnData) => {
    if (!data.sessionId) return;
    if (sessionHost.get(data.sessionId) === data.connId) {
      sessionHost.delete(data.sessionId);
    }
    sessionPeers.get(data.sessionId)?.delete(data.connId);
  };

  // Amend a peer->host envelope when the file frame requires relay-side
  // mutation. Returns the (possibly amended) envelope payload that should be
  // forwarded; never mutates the input. Returns null when no amend applies.
  const maybeAmendPayload = (env: Envelope): Record<string, unknown> | null => {
    if (env.type === 'file-upload-intent') {
      const p = env.payload as {
        reqId?: string;
        size?: number;
        filename?: string;
      } & Record<string, unknown>;
      if (typeof p.reqId !== 'string' || typeof p.size !== 'number') return null;
      if (p.size > INLINE_LIMIT_BYTES) {
        const key = `peer-upload/${p.reqId}/${p.filename ?? 'file'}`;
        return { ...p, upload: { via: 's3', key, putUrl: stagingUrlFor(key) } };
      }
      return { ...p, upload: { via: 'ws' } };
    }
    if (env.type === 'file-upload-done') {
      const p = env.payload as { reqId?: string; key?: string } & Record<string, unknown>;
      if (typeof p.reqId !== 'string' || typeof p.key !== 'string') return null;
      pendingDeletes.set(p.reqId, p.key);
      return { ...p, getUrl: stagingUrlFor(p.key) };
    }
    return null;
  };

  const route = (env: Envelope, fromConnId: string, sessionId: string) => {
    // Snoop host rpc-result for DeleteObject side-effect before routing.
    if (env.type === 'rpc-result' && sessionHost.get(sessionId) === fromConnId && env.id) {
      const key = pendingDeletes.get(env.id);
      if (key !== undefined) {
        const ok = (env.payload as { ok?: boolean } | null)?.ok === true;
        if (ok) {
          stagingMap.delete(key);
          deletedKeys.add(key);
        }
        pendingDeletes.delete(env.id);
      }
    }

    const amended = maybeAmendPayload(env);
    const rewritten: Envelope = {
      ...env,
      from: fromConnId,
      ...(amended !== null ? { payload: amended } : {}),
    };
    const hostConn = sessionHost.get(sessionId);
    const peers = sessionPeers.get(sessionId) ?? new Set<string>();
    const targets: string[] = [];
    if (env.to === undefined || env.to === 'all') {
      if (hostConn && hostConn !== fromConnId) targets.push(hostConn);
      for (const p of peers) if (p !== fromConnId) targets.push(p);
    } else if (env.to === 'host') {
      if (hostConn && hostConn !== fromConnId) targets.push(hostConn);
    } else if (env.to !== fromConnId) {
      targets.push(env.to);
    }
    const wire = JSON.stringify(rewritten);
    for (const t of targets) {
      const sock = conns.get(t);
      if (sock) sock.send(wire);
    }
  };

  const server = Bun.serve<RelayConnData>({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req, srv) {
      const url = new URL(req.url);

      if (url.pathname.startsWith('/staging/')) {
        const rawKey = url.pathname.slice('/staging/'.length);
        const key = rawKey
          .split('/')
          .map((seg) => decodeURIComponent(seg))
          .join('/');
        if (req.method === 'PUT') {
          const ab = await req.arrayBuffer();
          stagingMap.set(key, Buffer.from(ab));
          return new Response('', { status: 200 });
        }
        if (req.method === 'GET') {
          const bytes = stagingMap.get(key);
          if (!bytes) return new Response('not found', { status: 404 });
          return new Response(new Uint8Array(bytes), { status: 200 });
        }
        return new Response('method not allowed', { status: 405 });
      }

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

  baseURL = `http://127.0.0.1:${server.port}`;
  return {
    baseURL,
    wsUrl: `ws://127.0.0.1:${server.port}/`,
    stop: () => {
      server.stop(true);
    },
    observed: {
      stagingKeys: () => [...stagingMap.keys()],
      deletedKeys: () => [...deletedKeys.values()],
    },
  };
}

interface SeededFlow {
  repoPath: string;
  flowFile: string;
  flowId: string;
  registry: ReturnType<typeof createRegistry>;
  nodeDir: string;
}

function seedFlow(tmpRoot: string): SeededFlow {
  const repoPath = mkdtempSync(join(tmpRoot, 'repo-'));
  const flowFile = join(repoPath, 'flow.json');
  const styleFile = join(repoPath, 'style.json');
  const flow = {
    version: 2,
    name: 'share-files fixture',
    nodes: [{ id: TEST_NODE_ID, type: 'rectangle', data: {} }],
    connectors: [],
  };
  const style = {
    nodes: { [TEST_NODE_ID]: { position: { x: 0, y: 0 } } },
    connectors: {},
  };
  writeFileSync(flowFile, `${JSON.stringify(flow, null, 2)}\n`);
  writeFileSync(styleFile, `${JSON.stringify(style, null, 2)}\n`);
  const nodeDir = join(repoPath, 'nodes', TEST_NODE_ID);
  mkdirSync(nodeDir, { recursive: true });
  const registry = createRegistry({ path: join(tmpRoot, 'registry.json') });
  const entry = registry.upsert({
    name: 'share-files fixture',
    repoPath,
    flowPath: 'flow.json',
    projectSlug: 'p',
    flowSlug: 'main',
    isDefault: true,
    valid: true,
    lastModified: Date.now(),
  });
  return { repoPath, flowFile, flowId: entry.id, registry, nodeDir };
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
    waitForFrame: (pred, timeoutMs = 1500) => {
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
  auditDir: string;
  nodeDir: string;
  url: string;
  sessionId: string;
  // Records that the host-side requestUploadIntent stub was invoked with the
  // host-serve role (Scenario B assertion target).
  hostServeIntentCalls: Array<{ role: string; size: number }>;
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
  const tmpHome = mkdtempSync(join(tmpdir(), 'share-files-'));
  const auditDir = join(tmpHome, 'share-audit');
  const seeded = seedFlow(tmpHome);
  const relay = startFakeRelay();

  // Host-side requestUploadIntent stub: mint a staging key against the same
  // fake S3 the relay serves so a subsequent peer GET on the redirect URL
  // returns the bytes the host PUT. Tracks call shape so Scenario B can
  // assert role:'host-serve'.
  const hostServeIntentCalls: Array<{ role: string; size: number }> = [];
  const requestUploadIntent: RequestUploadIntent = async (intent) => {
    hostServeIntentCalls.push({ role: intent.role, size: intent.size });
    const key = `host-serve/${intent.reqId}/${intent.filename}`;
    const url = `${relay.baseURL}/staging/${key.split('/').map(encodeURIComponent).join('/')}`;
    return {
      putUrl: url,
      getUrl: url,
      expiresAt: Date.now() + 60_000,
      key,
    };
  };
  const putToS3: PutToS3 = async (url, bytes, contentType) => {
    const res = await fetch(url, {
      method: 'PUT',
      body: new Uint8Array(bytes),
      headers: { 'content-type': contentType },
    });
    return { ok: res.ok, status: res.status };
  };

  const share = createShareController({
    relayHttpUrl: relay.baseURL,
    shareUrlBase: 'http://share.test',
    flowIdsForBroadcast: () => [seeded.flowId],
    auditDir,
    operationsDeps: { registry: seeded.registry },
    requestUploadIntent,
    putToS3,
  });
  const { url, sessionId } = await share.start();
  return {
    relay,
    share,
    flowFile: seeded.flowFile,
    flowId: seeded.flowId,
    tmpHome,
    auditDir,
    nodeDir: seeded.nodeDir,
    url,
    sessionId,
    hostServeIntentCalls,
  };
}

async function joinPeer(fx: Fixture, peerId: string, displayName: string): Promise<PeerClient> {
  const peer = await openPeer(fx.relay.wsUrl);
  const token = fx.url.split('/').pop() ?? '';
  peer.send(makeEnvelope('auth-peer', { token, displayName }, { from: 'peer-self' }));
  await Bun.sleep(25);
  peer.send(makeEnvelope('presence', { kind: 'join', peerId, displayName }, { from: 'peer-self' }));
  await waitUntil(() => {
    const s = fx.share.state();
    return s.status === 'active' && s.peers.some((p) => p.peerId === peerId);
  }, 1500);
  return peer;
}

const readAudit = (
  auditDir: string,
  sessionId: string,
): Array<RpcAuditEntry | FileUploadAuditEntry> => {
  const path = join(auditDir, `${sessionId}.jsonl`);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as RpcAuditEntry | FileUploadAuditEntry);
};

const base64 = (bytes: Buffer | Uint8Array): string => Buffer.from(bytes).toString('base64');

describe('integration: file transfer round-trip across relay (US-064)', () => {
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

  it('Scenario A: small file read (<=256 KB) returns single file-bytes frame with eof:true', async () => {
    const bytes = Buffer.alloc(5 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff;
    const filename = 'small.png';
    writeFileSync(join(fx.nodeDir, filename), bytes);
    const expectedSha = sha256Hex(bytes);

    const peer = await joinPeer(fx, 'peer-a', 'Peer A');
    const reqId = 'req-small-read';
    peer.send(
      makeEnvelope(
        'file-request',
        { reqId, nodeId: TEST_NODE_ID, relPath: filename },
        { from: 'peer-self', to: 'host', id: reqId },
      ),
    );

    const reply = await peer.waitForFrame(
      (e) => e.type === 'file-bytes' && (e.payload as { reqId?: string } | null)?.reqId === reqId,
      1500,
    );
    const payload = reply.payload as {
      reqId: string;
      seq: number;
      total: number;
      base64: string;
      sha256: string;
      eof: boolean;
      contentType?: string;
    };
    expect(payload.eof).toBe(true);
    expect(payload.total).toBe(1);
    expect(payload.seq).toBe(0);
    expect(payload.sha256).toBe(expectedSha);
    expect(payload.contentType).toBe('image/png');
    const decoded = Buffer.from(payload.base64, 'base64');
    expect(decoded.equals(bytes)).toBe(true);

    peer.close();
  });

  it('Scenario B: large file read (>256 KB) replies file-redirect; peer fetches getUrl and bytes match disk', async () => {
    const bytes = Buffer.alloc(512 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 0xff;
    const filename = 'big.png';
    writeFileSync(join(fx.nodeDir, filename), bytes);
    const expectedSha = sha256Hex(bytes);

    const peer = await joinPeer(fx, 'peer-b', 'Peer B');
    const reqId = 'req-big-read';
    peer.send(
      makeEnvelope(
        'file-request',
        { reqId, nodeId: TEST_NODE_ID, relPath: filename },
        { from: 'peer-self', to: 'host', id: reqId },
      ),
    );

    const redirect = await peer.waitForFrame(
      (e) =>
        e.type === 'file-redirect' && (e.payload as { reqId?: string } | null)?.reqId === reqId,
      2000,
    );
    const redirectPayload = redirect.payload as {
      reqId: string;
      getUrl: string;
      sha256: string;
      expiresAt: number;
    };
    expect(redirectPayload.sha256).toBe(expectedSha);
    expect(redirectPayload.getUrl).toContain('/staging/host-serve/');

    // Host-serve intent: the host emitted a file-upload-intent (host-serve role)
    // to the relay (modelled by our stub) before issuing the redirect.
    expect(fx.hostServeIntentCalls.length).toBeGreaterThan(0);
    expect(fx.hostServeIntentCalls.some((c) => c.role === 'host-serve')).toBe(true);

    const fetched = await fetch(redirectPayload.getUrl);
    expect(fetched.ok).toBe(true);
    const ab = await fetched.arrayBuffer();
    const downloaded = Buffer.from(ab);
    expect(downloaded.equals(bytes)).toBe(true);
    expect(sha256Hex(downloaded)).toBe(expectedSha);

    peer.close();
  });

  it('Scenario C: small file write (<=256 KB) via:ws emits node-patched + persists under nodes/<id>/<filename>', async () => {
    const peer = await joinPeer(fx, 'peer-c', 'Peer C');
    const fileBytes = Buffer.alloc(20 * 1024);
    for (let i = 0; i < fileBytes.length; i++) fileBytes[i] = (i * 3) & 0xff;
    const filename = 'upload-small.png';
    const sha = sha256Hex(fileBytes);
    const reqId = 'req-write-small';

    peer.send(
      makeEnvelope(
        'file-upload-intent',
        {
          reqId,
          filename,
          size: fileBytes.length,
          contentType: 'image/png',
          nodeId: TEST_NODE_ID,
          sha256: sha,
          role: 'peer-upload',
        },
        { from: 'peer-self', to: 'host', id: reqId },
      ),
    );

    const intentAck = await peer.waitForFrame(
      (e) => e.type === 'rpc-result' && e.id === reqId,
      1500,
    );
    const intentPayload = intentAck.payload as {
      ok: boolean;
      result?: { via: 'ws' | 's3' };
    };
    expect(intentPayload.ok).toBe(true);
    expect(intentPayload.result?.via).toBe('ws');

    peer.send(
      makeEnvelope(
        'file-bytes',
        {
          reqId,
          seq: 0,
          total: 1,
          base64: base64(fileBytes),
          contentType: 'image/png',
          sha256: sha,
          eof: true,
        },
        { from: 'peer-self', to: 'host', id: reqId },
      ),
    );

    const finalAck = await peer.waitForFrame(
      (e) =>
        e.type === 'rpc-result' &&
        e.id === reqId &&
        e !== intentAck &&
        (e.payload as { ok?: boolean } | null)?.ok === true,
      2000,
    );
    expect((finalAck.payload as { ok: boolean }).ok).toBe(true);

    const broadcast = await peer.waitForFrame((e) => e.type === 'node-patched', 1000);
    const bp = broadcast.payload as {
      flowId: string;
      op: string;
      diff: { nodeId: string; data: { path: string } };
    };
    expect(bp.flowId).toBe(fx.flowId);
    expect(bp.op).toBe('file-upload');
    expect(bp.diff.nodeId).toBe(TEST_NODE_ID);
    expect(bp.diff.data.path).toBe(`nodes/${TEST_NODE_ID}/${filename}`);

    const written = readFileSync(join(fx.nodeDir, filename));
    expect(written.equals(fileBytes)).toBe(true);

    const audit = readAudit(fx.auditDir, fx.sessionId);
    const uploadEntry = audit.find(
      (e): e is FileUploadAuditEntry =>
        'op' in e && e.op === 'file-upload' && 'filename' in e && e.filename === filename,
    );
    expect(uploadEntry).toBeDefined();
    expect(uploadEntry?.accept).toBe(true);
    expect(uploadEntry?.sha256).toBe(sha);
    expect(uploadEntry?.size).toBe(fileBytes.length);

    peer.close();
  });

  it('Scenario D: large file write (>256 KB) via:s3 PUTs bytes; host fetches getUrl; relay fires DeleteObject after host ack', async () => {
    const peer = await joinPeer(fx, 'peer-d', 'Peer D');
    const fileBytes = Buffer.alloc(400 * 1024);
    for (let i = 0; i < fileBytes.length; i++) fileBytes[i] = (i * 11 + 5) & 0xff;
    const filename = 'upload-large.png';
    const sha = sha256Hex(fileBytes);
    const reqId = 'req-write-large';

    peer.send(
      makeEnvelope(
        'file-upload-intent',
        {
          reqId,
          filename,
          size: fileBytes.length,
          contentType: 'image/png',
          nodeId: TEST_NODE_ID,
          sha256: sha,
          role: 'peer-upload',
        },
        { from: 'peer-self', to: 'host', id: reqId },
      ),
    );

    const intentAck = await peer.waitForFrame(
      (e) => e.type === 'rpc-result' && e.id === reqId,
      1500,
    );
    const intentPayload = intentAck.payload as {
      ok: boolean;
      result?: { via: 'ws' | 's3'; key?: string; putUrl?: string };
    };
    expect(intentPayload.ok).toBe(true);
    expect(intentPayload.result?.via).toBe('s3');
    expect(typeof intentPayload.result?.key).toBe('string');
    expect(typeof intentPayload.result?.putUrl).toBe('string');

    // Peer PUTs the bytes directly to the relay's fake S3.
    const putRes = await fetch(intentPayload.result?.putUrl ?? '', {
      method: 'PUT',
      body: new Uint8Array(fileBytes),
      headers: { 'content-type': 'image/png' },
    });
    expect(putRes.ok).toBe(true);
    expect(fx.relay.observed.stagingKeys()).toContain(intentPayload.result?.key as string);

    peer.send(
      makeEnvelope(
        'file-upload-done',
        { reqId, key: intentPayload.result?.key as string, sha256: sha },
        { from: 'peer-self', to: 'host', id: reqId },
      ),
    );

    const finalAck = await peer.waitForFrame(
      (e) =>
        e.type === 'rpc-result' &&
        e.id === reqId &&
        e !== intentAck &&
        (e.payload as { ok?: boolean } | null)?.ok === true,
      3000,
    );
    expect((finalAck.payload as { ok: boolean }).ok).toBe(true);

    // node-patched broadcast lands.
    await peer.waitForFrame((e) => e.type === 'node-patched', 1000);

    // File materialised on disk.
    const written = readFileSync(join(fx.nodeDir, filename));
    expect(written.equals(fileBytes)).toBe(true);

    // Relay observed DeleteObject (key removed from staging map).
    await waitUntil(
      () => fx.relay.observed.deletedKeys().includes(intentPayload.result?.key as string),
      1500,
    );
    expect(fx.relay.observed.stagingKeys()).not.toContain(intentPayload.result?.key as string);

    peer.close();
  });

  it('Scenario E: integrity violation (file-bytes sha256 != intent.sha256) returns reason:integrity and no file is written', async () => {
    const peer = await joinPeer(fx, 'peer-e', 'Peer E');
    const claimedBytes = Buffer.alloc(10 * 1024);
    for (let i = 0; i < claimedBytes.length; i++) claimedBytes[i] = i & 0xff;
    const claimedSha = sha256Hex(claimedBytes);
    // Tamper: send bytes whose actual content hashes differently.
    const tamperedBytes = Buffer.alloc(10 * 1024);
    for (let i = 0; i < tamperedBytes.length; i++) tamperedBytes[i] = (i ^ 0x5a) & 0xff;
    const filename = 'integrity.png';
    const reqId = 'req-integrity';

    peer.send(
      makeEnvelope(
        'file-upload-intent',
        {
          reqId,
          filename,
          size: claimedBytes.length,
          contentType: 'image/png',
          nodeId: TEST_NODE_ID,
          sha256: claimedSha,
          role: 'peer-upload',
        },
        { from: 'peer-self', to: 'host', id: reqId },
      ),
    );
    const intentAck = await peer.waitForFrame(
      (e) => e.type === 'rpc-result' && e.id === reqId,
      1500,
    );
    expect((intentAck.payload as { ok: boolean }).ok).toBe(true);

    peer.send(
      makeEnvelope(
        'file-bytes',
        {
          reqId,
          seq: 0,
          total: 1,
          base64: base64(tamperedBytes),
          contentType: 'image/png',
          sha256: claimedSha,
          eof: true,
        },
        { from: 'peer-self', to: 'host', id: reqId },
      ),
    );

    const reject = await peer.waitForFrame(
      (e) =>
        e.type === 'rpc-result' &&
        e.id === reqId &&
        e !== intentAck &&
        (e.payload as { ok?: boolean } | null)?.ok === false,
      2000,
    );
    expect(reject.payload).toEqual({ ok: false, reason: 'integrity' });

    expect(existsSync(join(fx.nodeDir, filename))).toBe(false);

    const audit = readAudit(fx.auditDir, fx.sessionId);
    const integrityReject = audit.find(
      (e): e is FileUploadAuditEntry =>
        'op' in e &&
        e.op === 'file-upload' &&
        'accept' in e &&
        e.accept === false &&
        'reason' in e &&
        e.reason === 'integrity',
    );
    expect(integrityReject).toBeDefined();

    peer.close();
  });

  it('Scenario F: traversal-shaped filename in intent returns reason:path-invalid and writes nothing outside nodes/<id>/', async () => {
    const peer = await joinPeer(fx, 'peer-f', 'Peer F');
    const bytes = Buffer.alloc(1024);
    const sha = sha256Hex(bytes);
    const reqId = 'req-traversal';
    const filename = '../../escape.png';

    peer.send(
      makeEnvelope(
        'file-upload-intent',
        {
          reqId,
          filename,
          size: bytes.length,
          contentType: 'image/png',
          nodeId: TEST_NODE_ID,
          sha256: sha,
          role: 'peer-upload',
        },
        { from: 'peer-self', to: 'host', id: reqId },
      ),
    );

    const reject = await peer.waitForFrame(
      (e) =>
        e.type === 'rpc-result' &&
        e.id === reqId &&
        (e.payload as { ok?: boolean } | null)?.ok === false,
      2000,
    );
    expect(reject.payload).toEqual({ ok: false, reason: 'path-invalid' });

    // Nothing outside the per-node folder. (resolveNodeFile rejects traversal
    // before any write; we explicitly look for the canonical names a successful
    // traversal would have produced.)
    expect(existsSync(join(fx.tmpHome, 'escape.png'))).toBe(false);
    expect(existsSync(join(fx.nodeDir, '..', '..', 'escape.png'))).toBe(false);
    expect(existsSync(join(fx.nodeDir, 'escape.png'))).toBe(false);

    const audit = readAudit(fx.auditDir, fx.sessionId);
    const pathInvalid = audit.find(
      (e): e is FileUploadAuditEntry =>
        'op' in e &&
        e.op === 'file-upload' &&
        'accept' in e &&
        e.accept === false &&
        'reason' in e &&
        e.reason === 'path-invalid',
    );
    expect(pathInvalid).toBeDefined();

    peer.close();
  });

  it('Scenario G: >5 MB of file-bytes within 60 s -> at least one chunk rejected rate-limited; subsequent intents still ack', async () => {
    const peer = await joinPeer(fx, 'peer-g', 'Peer G');
    // 6 MiB intent advertised (host stores in-flight regardless of via decision;
    // peer ignores the via:'s3' suggestion and streams file-bytes so we exercise
    // the host's per-peer 5 MB / 60 s window). All-zero bytes so chunk sha is
    // irrelevant; the rate-limit fires before the final eof integrity check.
    const totalSize = 6 * 1024 * 1024;
    const chunk = Buffer.alloc(1024 * 1024);
    const reqId = 'req-ratelimit';
    const sha = sha256Hex(Buffer.alloc(totalSize));

    peer.send(
      makeEnvelope(
        'file-upload-intent',
        {
          reqId,
          filename: 'ratelimit.png',
          size: totalSize,
          contentType: 'image/png',
          nodeId: TEST_NODE_ID,
          sha256: sha,
          role: 'peer-upload',
        },
        { from: 'peer-self', to: 'host', id: reqId },
      ),
    );
    const intentAck = await peer.waitForFrame(
      (e) => e.type === 'rpc-result' && e.id === reqId,
      1500,
    );
    expect((intentAck.payload as { ok: boolean }).ok).toBe(true);

    // Stream 6 x 1 MiB chunks. After chunk 5 the window holds exactly 5 MiB
    // (== RATE_LIMIT_BYTES); chunk 6 must push over -> rate-limited.
    const encoded = base64(chunk);
    for (let seq = 0; seq < 6; seq++) {
      peer.send(
        makeEnvelope(
          'file-bytes',
          {
            reqId,
            seq,
            total: 6,
            base64: encoded,
            contentType: 'image/png',
            sha256: sha,
            eof: seq === 5,
          },
          { from: 'peer-self', to: 'host', id: reqId },
        ),
      );
      // Tiny pacing so the host's handleBytes processes each frame before the
      // next arrives — Bun's WS receive ordering is sequential, but giving the
      // event loop a tick avoids the test asserting frames mid-batch.
      await Bun.sleep(5);
    }

    const rateLimitReject = await peer.waitForFrame(
      (e) =>
        e.type === 'rpc-result' &&
        e.id === reqId &&
        e !== intentAck &&
        (e.payload as { ok?: boolean; reason?: string } | null)?.ok === false &&
        (e.payload as { reason?: string } | null)?.reason === 'rate-limited',
      3000,
    );
    expect(rateLimitReject.payload).toEqual({ ok: false, reason: 'rate-limited' });

    // Subsequent intent (intents do not consume the file-bytes window) still
    // acks normally. Proves the controller stays alive after a rate-limit.
    const followupReqId = 'req-ratelimit-followup';
    const followupBytes = Buffer.alloc(2 * 1024);
    const followupSha = sha256Hex(followupBytes);
    peer.send(
      makeEnvelope(
        'file-upload-intent',
        {
          reqId: followupReqId,
          filename: 'followup.png',
          size: followupBytes.length,
          contentType: 'image/png',
          nodeId: TEST_NODE_ID,
          sha256: followupSha,
          role: 'peer-upload',
        },
        { from: 'peer-self', to: 'host', id: followupReqId },
      ),
    );
    const followupAck = await peer.waitForFrame(
      (e) => e.type === 'rpc-result' && e.id === followupReqId,
      1500,
    );
    expect((followupAck.payload as { ok: boolean }).ok).toBe(true);

    peer.close();
  });
});
