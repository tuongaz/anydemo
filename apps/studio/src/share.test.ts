import { describe, expect, it } from 'bun:test';
import type {
  AuditEntry,
  AuditLog,
  AuditLogOpts,
  AuditLogger,
  FrameAuditEntry,
} from './share-audit.ts';
import type { Envelope } from './share-envelope.ts';
import type { RateLimitResult, RateLimiter } from './share-ratelimit.ts';
import type { ShareTransport, ShareTransportOpts, ShareTransportState } from './share-transport.ts';
import { type ShareState, createShareController } from './share.ts';

// Default audit factory for tests: returns a no-op log so the real audit dir
// (`~/.seeflow/share-history`) is never touched by unit tests. Tests that want
// to observe audit writes inject their own via `auditLogFactory`.
const noopAuditFactory = (_opts: AuditLogOpts): AuditLog => ({
  append: () => {},
  close: async () => {},
});

const noopAuditLoggerFactory = (_sessionId: string, _root?: string): AuditLogger => ({
  append: async () => {},
  list: async () => ({ entries: [], nextCursor: null }),
  close: async () => {},
});

const baseDeps = {
  relayHttpUrl: 'https://relay.example',
  shareUrlBase: 'https://share.example',
  auditLogFactory: noopAuditFactory,
  auditLoggerFactory: noopAuditLoggerFactory,
};

interface AuditLoggerCapture {
  entries: AuditEntry[];
  factory: (sessionId: string, root?: string) => AuditLogger;
  capturedSessionId: () => string | null;
  capturedRoot: () => string | null;
}

function makeAuditLoggerCapture(): AuditLoggerCapture {
  const entries: AuditEntry[] = [];
  let sessionId: string | null = null;
  let root: string | null = null;
  return {
    entries,
    factory: (sid, r) => {
      sessionId = sid;
      root = r ?? null;
      return {
        append: async (entry) => {
          entries.push({ ...entry, ts: Date.now() });
        },
        list: async () => ({ entries: [...entries], nextCursor: null }),
        close: async () => {},
      };
    },
    capturedSessionId: () => sessionId,
    capturedRoot: () => root,
  };
}

interface AuditCapture {
  entries: FrameAuditEntry[];
  closed: boolean;
  factory: (opts: AuditLogOpts) => AuditLog;
  capturedDir: () => string | null;
  capturedSessionId: () => string | null;
}

function makeAuditCapture(): AuditCapture {
  const entries: FrameAuditEntry[] = [];
  let dir: string | null = null;
  let sessionId: string | null = null;
  const cap: AuditCapture = {
    entries,
    closed: false,
    factory: (opts) => {
      dir = opts.dir;
      sessionId = opts.sessionId;
      return {
        append: (e) => {
          entries.push(e);
        },
        close: async () => {
          cap.closed = true;
        },
      };
    },
    capturedDir: () => dir,
    capturedSessionId: () => sessionId,
  };
  return cap;
}

function makeRateLimiter(results: RateLimitResult[]): RateLimiter {
  let i = 0;
  return {
    check() {
      const r = results[i] ?? results[results.length - 1] ?? { ok: true };
      i += 1;
      return r;
    },
  };
}

interface FakeTransportHandle {
  factory: (opts: ShareTransportOpts) => ShareTransport;
  emit: (s: ShareTransportState) => void;
  emitFrame: (env: Envelope) => void;
  capturedOpts: () => ShareTransportOpts | null;
  wasClosed: () => boolean;
  closeCount: () => number;
  sends: () => Envelope[];
  instanceCount: () => number;
}

function makeFakeTransport(autoEmit: ShareTransportState[] = []): FakeTransportHandle {
  let lastOpts: ShareTransportOpts | null = null;
  let closed = false;
  let closeCount = 0;
  let instanceCount = 0;
  const sends: Envelope[] = [];
  const factory = (opts: ShareTransportOpts): ShareTransport => {
    lastOpts = opts;
    instanceCount += 1;
    const t: ShareTransport = {
      send(frame) {
        sends.push(frame);
      },
      close() {
        closed = true;
        closeCount += 1;
      },
      isOpen() {
        return true;
      },
    };
    for (const s of autoEmit) opts.onStateChange(s);
    return t;
  };
  return {
    factory,
    emit: (s) => lastOpts?.onStateChange(s),
    emitFrame: (env) => lastOpts?.onFrame(env),
    capturedOpts: () => lastOpts,
    wasClosed: () => closed,
    closeCount: () => closeCount,
    sends: () => sends,
    instanceCount: () => instanceCount,
  };
}

function mockFetch(response: { status?: number; body?: unknown }): typeof fetch {
  const status = response.status ?? 200;
  const fake = async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => response.body ?? {},
    }) as unknown as Response;
  return fake as unknown as typeof fetch;
}

describe('createShareController', () => {
  it('starts in idle state', () => {
    const ctrl = createShareController(baseDeps);
    expect(ctrl.state()).toEqual({ status: 'idle' });
  });

  it('subscribe is invoked synchronously with the current state', () => {
    const ctrl = createShareController(baseDeps);
    const seen: ShareState[] = [];
    ctrl.subscribe((s) => seen.push(s));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ status: 'idle' });
  });

  it('subscribe returns a working unsubscribe', () => {
    const ctrl = createShareController(baseDeps);
    let count = 0;
    const off = ctrl.subscribe(() => {
      count++;
    });
    expect(count).toBe(1);
    off();
    // Calling unsubscribe again must be a no-op.
    off();
    expect(count).toBe(1);
  });

  it('state() never exposes a hostKey field', () => {
    const ctrl = createShareController(baseDeps);
    const snapshot = ctrl.state() as Record<string, unknown>;
    expect(snapshot.hostKey).toBeUndefined();
  });
});

describe('createShareController.start()', () => {
  it('idle -> starting -> active happy path; resolves to share url', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch({
        body: { sessionId: 'sess-1', token: 'tok-1', hostKey: 'hk-1', wsUrl: 'wss://relay/ws' },
      }),
      transportFactory: fake.factory,
    });
    const seen: ShareState[] = [];
    ctrl.subscribe((s) => seen.push(s));

    const result = await ctrl.start();
    expect(result).toEqual({ url: 'https://share.example/tok-1', sessionId: 'sess-1' });

    const statuses = seen.map((s) => s.status);
    expect(statuses).toEqual(['idle', 'starting', 'active']);

    const active = seen[2];
    if (!active || active.status !== 'active') throw new Error('expected active state');
    expect(active.token).toBe('tok-1');
    expect(active.url).toBe('https://share.example/tok-1');
    expect(active.peers).toEqual([]);
    expect(typeof active.startedAt).toBe('number');

    const captured = fake.capturedOpts();
    expect(captured?.hostKey).toBe('hk-1');
    expect(captured?.wsUrl).toBe('wss://relay/ws');
    expect(captured?.sessionId).toBe('sess-1');
  });

  it('rejects on HTTP 500 and leaves state idle', async () => {
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch({ status: 500 }),
      transportFactory: makeFakeTransport().factory,
    });
    await expect(ctrl.start()).rejects.toThrow(/500/);
    expect(ctrl.state()).toEqual({ status: 'idle' });
  });

  it('rejects when transport closes during boot, returning state to idle', async () => {
    const fake = makeFakeTransport(['connecting', 'closed']);
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch({
        body: { sessionId: 's', token: 't', hostKey: 'h', wsUrl: 'wss://r' },
      }),
      transportFactory: fake.factory,
    });
    const seen: ShareState[] = [];
    ctrl.subscribe((s) => seen.push(s));
    await expect(ctrl.start()).rejects.toThrow('share-transport-closed-during-boot');
    expect(ctrl.state()).toEqual({ status: 'idle' });
    // Subscribers observed idle -> starting -> idle (the rollback).
    expect(seen.map((s) => s.status)).toEqual(['idle', 'starting', 'idle']);
  });

  it('second start() while active rejects with share-already-active', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch({
        body: { sessionId: 'sess-1', token: 'tok-1', hostKey: 'hk-1', wsUrl: 'wss://relay/ws' },
      }),
      transportFactory: fake.factory,
    });
    await ctrl.start();
    await expect(ctrl.start()).rejects.toThrow('share-already-active');
    expect(ctrl.state().status).toBe('active');
  });
});

describe('createShareController.stop()', () => {
  it('from active: transitions stopping -> idle, closes transport, clears session', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch({
        body: { sessionId: 'sess-1', token: 'tok-1', hostKey: 'hk-1', wsUrl: 'wss://relay/ws' },
      }),
      transportFactory: fake.factory,
    });
    await ctrl.start();
    expect(ctrl.state().status).toBe('active');

    const seen: ShareState[] = [];
    ctrl.subscribe((s) => seen.push(s));

    await ctrl.stop();

    expect(ctrl.state()).toEqual({ status: 'idle' });
    expect(fake.wasClosed()).toBe(true);
    // Subscribers observed active (initial deliver) -> stopping -> idle.
    expect(seen.map((s) => s.status)).toEqual(['active', 'stopping', 'idle']);
  });

  it('from idle is a no-op and does not throw', async () => {
    const ctrl = createShareController(baseDeps);
    const seen: ShareState[] = [];
    ctrl.subscribe((s) => seen.push(s));
    await expect(ctrl.stop()).resolves.toBeUndefined();
    expect(ctrl.state()).toEqual({ status: 'idle' });
    // No transitions beyond the initial-deliver.
    expect(seen.map((s) => s.status)).toEqual(['idle']);
  });

  it('during starting: rejects the original start with share-stopped-during-start', async () => {
    // autoEmit only goes through 'connecting' — boot stalls in starting until
    // stop() drives it back.
    const fake = makeFakeTransport(['connecting']);
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch({
        body: { sessionId: 's', token: 't', hostKey: 'h', wsUrl: 'wss://r' },
      }),
      transportFactory: fake.factory,
    });

    const startPromise = ctrl.start();
    // Wait for state to reach 'starting' before stopping.
    await new Promise<void>((resolve) => {
      const off = ctrl.subscribe((s) => {
        if (s.status === 'starting') {
          off();
          resolve();
        }
      });
    });

    const stopPromise = ctrl.stop();
    await expect(startPromise).rejects.toThrow('share-stopped-during-start');
    await stopPromise;

    expect(ctrl.state()).toEqual({ status: 'idle' });
    expect(fake.wasClosed()).toBe(true);
  });
});

describe('createShareController.kick()', () => {
  it('from idle rejects with share-not-active', async () => {
    const ctrl = createShareController(baseDeps);
    await expect(ctrl.kick('peer-1')).rejects.toThrow('share-not-active');
    expect(ctrl.state()).toEqual({ status: 'idle' });
  });

  it('from active without prior join rejects with share-peer-not-found and audits rpc-reject', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const klogger = makeAuditLoggerCapture();
    const fetchCalls: { url: string; init?: RequestInit }[] = [];
    const fetchSpy: typeof fetch = (async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sessionId: 'sess-1',
          token: 'tok-1',
          hostKey: 'hk-1',
          wsUrl: 'wss://relay/ws',
        }),
      } as Response;
    }) as unknown as typeof fetch;
    const ctrl = createShareController({
      ...baseDeps,
      fetch: fetchSpy,
      transportFactory: fake.factory,
      auditLoggerFactory: klogger.factory,
    });
    await ctrl.start();
    await expect(ctrl.kick('peer-42')).rejects.toThrow('share-peer-not-found');
    // No relay call was issued — the local map already proved the peer is unknown.
    const kickCalls = fetchCalls.filter((c) => c.url.endsWith('/api/share/kick'));
    expect(kickCalls).toHaveLength(0);
    const rejects = klogger.entries.filter((e) => e.kind === 'rpc-reject');
    expect(rejects).toHaveLength(1);
    expect(rejects[0]?.op).toBe('kick');
    expect(rejects[0]?.peerId).toBe('peer-42');
    expect(rejects[0]?.reason).toBe('share-peer-not-found');
  });

  it('from active after presence/join POSTs to relay /api/share/kick with hostKey and audits the kick', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const klogger = makeAuditLoggerCapture();
    const fetchCalls: { url: string; body?: string }[] = [];
    const fetchSpy: typeof fetch = (async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : undefined;
      fetchCalls.push({ url, body });
      if (url.endsWith('/api/share/sessions')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            sessionId: 'sess-1',
            token: 'tok-1',
            hostKey: 'hk-1',
            wsUrl: 'wss://relay/ws',
          }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, kicked: 1 }) } as Response;
    }) as unknown as typeof fetch;
    const ctrl = createShareController({
      ...baseDeps,
      fetch: fetchSpy,
      transportFactory: fake.factory,
      auditLoggerFactory: klogger.factory,
    });
    await ctrl.start();
    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-7',
      payload: { kind: 'join', peerId: 'peer-42', displayName: 'Ada' },
    });
    klogger.entries.length = 0; // ignore host-start + peer-join for this assert.

    await ctrl.kick('peer-42');

    const kickCalls = fetchCalls.filter((c) => c.url.endsWith('/api/share/kick'));
    expect(kickCalls).toHaveLength(1);
    expect(kickCalls[0]?.url).toBe('https://relay.example/api/share/kick');
    const parsed = JSON.parse(kickCalls[0]?.body ?? '{}');
    expect(parsed).toEqual({ sessionId: 'sess-1', hostKey: 'hk-1', peerId: 'peer-42' });
    const kickAudits = klogger.entries.filter((e) => e.kind === 'kick');
    expect(kickAudits).toHaveLength(1);
    expect(kickAudits[0]?.peerId).toBe('peer-42');
    expect(kickAudits[0]?.displayName).toBe('Ada');
  });

  it('relay rejection rethrows and records an rpc-reject audit entry', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const klogger = makeAuditLoggerCapture();
    const fetchSpy: typeof fetch = (async (url: string) => {
      if (url.endsWith('/api/share/sessions')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            sessionId: 'sess-1',
            token: 'tok-1',
            hostKey: 'hk-1',
            wsUrl: 'wss://relay/ws',
          }),
        } as Response;
      }
      return { ok: false, status: 502, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
    const ctrl = createShareController({
      ...baseDeps,
      fetch: fetchSpy,
      transportFactory: fake.factory,
      auditLoggerFactory: klogger.factory,
    });
    await ctrl.start();
    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-7',
      payload: { kind: 'join', peerId: 'peer-42', displayName: 'Ada' },
    });
    klogger.entries.length = 0;

    await expect(ctrl.kick('peer-42')).rejects.toThrow('share-relay-http-502');

    const kickAudits = klogger.entries.filter((e) => e.kind === 'kick');
    expect(kickAudits).toHaveLength(0);
    const rejects = klogger.entries.filter((e) => e.kind === 'rpc-reject');
    expect(rejects).toHaveLength(1);
    expect(rejects[0]?.op).toBe('kick');
    expect(rejects[0]?.peerId).toBe('peer-42');
    expect(rejects[0]?.displayName).toBe('Ada');
    expect(rejects[0]?.reason).toBe('share-relay-http-502');
  });
});

describe('createShareController frame routing', () => {
  async function startActive() {
    const fake = makeFakeTransport(['connecting', 'open']);
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch({
        body: { sessionId: 'sess-1', token: 'tok-1', hostKey: 'hk-1', wsUrl: 'wss://relay/ws' },
      }),
      transportFactory: fake.factory,
    });
    await ctrl.start();
    return { ctrl, fake };
  }

  it("presence 'join' adds the peer to state.peers and notifies subscribers", async () => {
    const { ctrl, fake } = await startActive();
    const seen: ShareState[] = [];
    ctrl.subscribe((s) => seen.push(s));
    // First seen entry is the initial-deliver (active with peers=[]).
    expect(seen).toHaveLength(1);

    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-7',
      payload: { kind: 'join', peerId: 'peer-42', displayName: 'Ada' },
    });

    expect(seen).toHaveLength(2);
    const after = seen[1];
    if (!after || after.status !== 'active') throw new Error('expected active state');
    expect(after.peers).toHaveLength(1);
    expect(after.peers[0]?.peerId).toBe('peer-42');
    expect(after.peers[0]?.displayName).toBe('Ada');
    expect(typeof after.peers[0]?.joinedAt).toBe('number');
  });

  it('duplicate presence/join for the same peerId is idempotent', async () => {
    const { ctrl, fake } = await startActive();
    const seen: ShareState[] = [];
    ctrl.subscribe((s) => seen.push(s));

    const joinFrame = {
      v: 1 as const,
      type: 'presence' as const,
      from: 'conn-7',
      payload: { kind: 'join', peerId: 'peer-42', displayName: 'Ada' },
    };
    fake.emitFrame(joinFrame);
    fake.emitFrame(joinFrame);

    const s = ctrl.state();
    if (s.status !== 'active') throw new Error('expected active state');
    expect(s.peers).toHaveLength(1);
    // Initial-deliver + exactly one join transition (second is suppressed).
    expect(seen).toHaveLength(2);
  });

  it("presence 'leave' removes the peer and its connId mapping", async () => {
    const { ctrl, fake } = await startActive();
    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-7',
      payload: { kind: 'join', peerId: 'peer-42', displayName: 'Ada' },
    });
    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-7',
      payload: { kind: 'leave', peerId: 'peer-42' },
    });

    const s = ctrl.state();
    if (s.status !== 'active') throw new Error('expected active state');
    expect(s.peers).toEqual([]);
    // After leave, kick now finds no connId mapping.
    await expect(ctrl.kick('peer-42')).rejects.toThrow('share-peer-not-found');
  });

  it('malformed presence payload is dropped without throwing or mutating state', async () => {
    const { ctrl, fake } = await startActive();
    const before = ctrl.state();

    // Missing peerId — fails the strict 'join' variant, falls through
    // to the open-other variant and no-ops silently.
    expect(() =>
      fake.emitFrame({
        v: 1,
        type: 'presence',
        from: 'conn-7',
        payload: { kind: 'join' },
      }),
    ).not.toThrow();

    // Completely invalid (missing kind) — rejected by the sub-schema entirely.
    expect(() =>
      fake.emitFrame({
        v: 1,
        type: 'presence',
        from: 'conn-7',
        payload: 'not-an-object',
      }),
    ).not.toThrow();

    expect(ctrl.state()).toEqual(before);
  });

  it('rpc / file / sse / node-patched / rpc-result frames are accepted-and-dropped silently', async () => {
    const { ctrl, fake } = await startActive();
    const before = ctrl.state();

    const droppable: Envelope[] = [
      { v: 1, type: 'rpc', from: 'conn-7', payload: { method: 'patchNode' } },
      { v: 1, type: 'rpc-result', from: 'conn-7', payload: { ok: true } },
      { v: 1, type: 'sse', from: 'conn-7', payload: { evt: 'x' } },
      { v: 1, type: 'file-request', from: 'conn-7', payload: { path: 'a' } },
      { v: 1, type: 'file-upload-intent', from: 'conn-7', payload: { path: 'a' } },
      { v: 1, type: 'file-upload-done', from: 'conn-7', payload: { path: 'a' } },
      { v: 1, type: 'node-patched', from: 'conn-7', payload: {} },
      { v: 1, type: 'files-manifest', from: 'conn-7', payload: [] },
      { v: 1, type: 'file-bytes', from: 'conn-7', payload: {} },
      { v: 1, type: 'file-redirect', from: 'conn-7', payload: { url: 'x' } },
    ];
    for (const env of droppable) {
      expect(() => fake.emitFrame(env)).not.toThrow();
    }
    expect(ctrl.state()).toEqual(before);
    // Nothing was sent in response — host does not auto-ack in v1.
    expect(fake.sends()).toHaveLength(0);
  });
});

describe('createShareController.rotateUrl()', () => {
  it('from idle rejects with share-not-active', async () => {
    const ctrl = createShareController(baseDeps);
    await expect(ctrl.rotateUrl()).rejects.toThrow('share-not-active');
    expect(ctrl.state()).toEqual({ status: 'idle' });
  });

  it('from active POSTs to relay /api/share/rotate, updates token state in place, and audits rotate', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const klogger = makeAuditLoggerCapture();
    const fetchCalls: { url: string; body?: string }[] = [];
    const fetchSpy: typeof fetch = (async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : undefined;
      fetchCalls.push({ url, body });
      if (url.endsWith('/api/share/sessions')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            sessionId: 'sess-1',
            token: 'tok-1',
            hostKey: 'hk-1',
            wsUrl: 'wss://relay/ws',
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, token: 'tok-2', url: 'https://share.seeflow.dev/tok-2' }),
      } as Response;
    }) as unknown as typeof fetch;
    const ctrl = createShareController({
      ...baseDeps,
      fetch: fetchSpy,
      transportFactory: fake.factory,
      auditLoggerFactory: klogger.factory,
    });
    const states: ShareState[] = [];
    ctrl.subscribe((s) => states.push(s));
    await ctrl.start();
    // Register a peer so we can verify rotate also clears the local peer roster.
    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-7',
      payload: { kind: 'join', peerId: 'peer-42', displayName: 'Ada' },
    });
    klogger.entries.length = 0;

    const { url } = await ctrl.rotateUrl();
    expect(url).toBe('https://share.example/tok-2');

    const rotateCalls = fetchCalls.filter((c) => c.url.endsWith('/api/share/rotate'));
    expect(rotateCalls).toHaveLength(1);
    expect(rotateCalls[0]?.url).toBe('https://relay.example/api/share/rotate');
    expect(JSON.parse(rotateCalls[0]?.body ?? '{}')).toEqual({
      sessionId: 'sess-1',
      hostKey: 'hk-1',
    });

    // Token + url updated in place — sessionId stays the same (no restart).
    const s = ctrl.state();
    if (s.status !== 'active') throw new Error('expected active after rotate');
    expect(s.sessionId).toBe('sess-1');
    expect(s.token).toBe('tok-2');
    expect(s.url).toBe('https://share.example/tok-2');
    expect(s.peers).toEqual([]);

    // Transport not torn down — only one instance was ever created.
    expect(fake.instanceCount()).toBe(1);
    expect(fake.closeCount()).toBe(0);

    const rotateAudits = klogger.entries.filter((e) => e.kind === 'rotate');
    expect(rotateAudits).toHaveLength(1);
    expect(rotateAudits[0]?.peerId).toBeNull();

    // setState fired with the new token so SSE consumers see the change.
    const lastActive = [...states].reverse().find((st) => st.status === 'active');
    if (!lastActive || lastActive.status !== 'active') throw new Error('expected active state');
    expect(lastActive.token).toBe('tok-2');
    expect(lastActive.url).toBe('https://share.example/tok-2');
  });
});

describe('createShareController rate-limit + audit', () => {
  it('rate-limited frame is dropped and audited as reject', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const audit = makeAuditCapture();
    // Allow the join (1st check) then deny every subsequent check.
    const limiter = makeRateLimiter([{ ok: false, retryAfterMs: 100 }]);
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch({
        body: { sessionId: 'sess-1', token: 'tok-1', hostKey: 'hk-1', wsUrl: 'wss://relay/ws' },
      }),
      transportFactory: fake.factory,
      auditLogFactory: audit.factory,
      rateLimiter: limiter,
    });
    await ctrl.start();

    // Introduce the peer first (presence/join bypasses the rate limiter).
    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-7',
      payload: { kind: 'join', peerId: 'peer-42', displayName: 'Ada' },
    });

    const stateBeforeRpc = ctrl.state();
    const seen: ShareState[] = [];
    ctrl.subscribe((s) => seen.push(s));

    // RPC frame from the known peer — rate limiter denies it.
    fake.emitFrame({ v: 1, type: 'rpc', from: 'conn-7', payload: { method: 'patchNode' } });

    // No state change beyond the one initial-deliver tick.
    expect(seen).toHaveLength(1);
    expect(ctrl.state()).toEqual(stateBeforeRpc);

    // Audit captured the join (accept) AND the denied rpc (reject).
    const rpcRejects = audit.entries.filter((e) => e.type === 'rpc' && e.verdict === 'reject');
    expect(rpcRejects).toHaveLength(1);
    expect(rpcRejects[0]?.peerId).toBe('peer-42');
    expect(rpcRejects[0]?.displayName).toBe('Ada');
    expect(rpcRejects[0]?.reason).toBe('rate-limited');
  });

  it('audit log records accept entries for allowed frames', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const audit = makeAuditCapture();
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch({
        body: { sessionId: 'sess-1', token: 'tok-1', hostKey: 'hk-1', wsUrl: 'wss://relay/ws' },
      }),
      transportFactory: fake.factory,
      auditLogFactory: audit.factory,
      // Default rate limiter — generous enough for these few calls.
    });
    await ctrl.start();
    expect(audit.capturedSessionId()).toBe('sess-1');

    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-7',
      payload: { kind: 'join', peerId: 'peer-42', displayName: 'Ada' },
    });
    fake.emitFrame({ v: 1, type: 'rpc', from: 'conn-7', payload: { method: 'patchNode' } });
    fake.emitFrame({ v: 1, type: 'sse', from: 'conn-7', payload: { evt: 'x' } });

    const accepts = audit.entries.filter((e) => e.verdict === 'accept');
    // 1 presence/join + 1 rpc + 1 sse = 3 accept entries.
    expect(accepts).toHaveLength(3);
    expect(accepts.map((e) => e.type)).toEqual(['presence', 'rpc', 'sse']);
    for (const entry of accepts) {
      expect(entry.peerId).toBe('peer-42');
      expect(entry.displayName).toBe('Ada');
      expect(typeof entry.ts).toBe('number');
    }
  });

  it('frames from an unknown connId are dropped without an audit entry', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const audit = makeAuditCapture();
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch({
        body: { sessionId: 'sess-1', token: 'tok-1', hostKey: 'hk-1', wsUrl: 'wss://relay/ws' },
      }),
      transportFactory: fake.factory,
      auditLogFactory: audit.factory,
    });
    await ctrl.start();

    // No prior join from conn-99 — we have no peerId/displayName to attribute.
    fake.emitFrame({ v: 1, type: 'rpc', from: 'conn-99', payload: { method: 'x' } });

    expect(audit.entries).toHaveLength(0);
    expect(ctrl.state().status).toBe('active');
  });

  it('audit log is closed on stop()', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const audit = makeAuditCapture();
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch({
        body: { sessionId: 'sess-1', token: 'tok-1', hostKey: 'hk-1', wsUrl: 'wss://relay/ws' },
      }),
      transportFactory: fake.factory,
      auditLogFactory: audit.factory,
    });
    await ctrl.start();
    expect(audit.closed).toBe(false);

    await ctrl.stop();
    // close() runs asynchronously inside teardown — flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(audit.closed).toBe(true);
  });
});

describe('createShareController attribution (US-052)', () => {
  // Peer-originated rpc: `node-patched` broadcast + rpc-result reply must
  // both carry the originating peer's `{ peerId, displayName }`. We capture
  // the broadcast via the explicit `broadcast` seam (clearer separation
  // than re-using `fake.sends()`, which mixes rpc-result + broadcast).
  it('peer-originated rpc broadcasts node-patched with attribution + audits + replies attribution', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const audit = makeAuditCapture();
    const broadcasts: Envelope[] = [];
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch({
        body: { sessionId: 'sess-1', token: 'tok-1', hostKey: 'hk-1', wsUrl: 'wss://relay/ws' },
      }),
      transportFactory: fake.factory,
      auditLogFactory: audit.factory,
      rpcDispatcher: async () => ({ kind: 'ok' }),
      appendShareAuditFn: () => {},
      broadcast: (env) => broadcasts.push(env),
    });
    await ctrl.start();
    // Peer must be registered first so handleFrame -> dispatchRpcFrame
    // resolves the displayName from connPeers.
    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-7',
      payload: { kind: 'join', peerId: 'peer-42', displayName: 'Alice' },
    });
    fake.emitFrame({
      v: 1,
      type: 'rpc',
      from: 'conn-7',
      id: 'r-1',
      payload: {
        op: 'moveNode',
        flowId: 'flow-a',
        nodeId: 'n-1',
        position: { x: 1, y: 2 },
      },
    });
    // dispatchRpcFrame inside handleFrame is async via a promise chain — flush.
    await new Promise((r) => setTimeout(r, 0));

    expect(broadcasts).toHaveLength(1);
    const env = broadcasts[0];
    if (!env) throw new Error('expected broadcast');
    expect(env.type).toBe('node-patched');
    const payload = env.payload as {
      flowId: string;
      op: string;
      attributedTo: { peerId: string; displayName: string };
    };
    expect(payload.attributedTo).toEqual({ peerId: 'peer-42', displayName: 'Alice' });

    // rpc-result reply: handleFrame forwards via transport.send.
    const rpcResult = fake.sends().find((e) => e.type === 'rpc-result');
    if (!rpcResult) throw new Error('expected rpc-result');
    const replyPayload = rpcResult.payload as {
      ok: boolean;
      attributedTo?: { peerId: string; displayName: string };
    };
    expect(replyPayload.ok).toBe(true);
    expect(replyPayload.attributedTo).toEqual({ peerId: 'peer-42', displayName: 'Alice' });
  });

  // Host-originated edit: `broadcastHostEdit` attributes `'host'` with the
  // configured `hostDisplayName` and surfaces the same on the audit entry.
  it('host-originated edit broadcasts node-patched attributed to host', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const broadcasts: Envelope[] = [];
    const auditEntries: {
      peerId: string;
      attributedTo?: { peerId: string; displayName: string };
    }[] = [];
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch({
        body: { sessionId: 'sess-1', token: 'tok-1', hostKey: 'hk-1', wsUrl: 'wss://relay/ws' },
      }),
      transportFactory: fake.factory,
      hostDisplayName: 'tuong',
      broadcast: (env) => broadcasts.push(env),
      appendShareAuditFn: (_sid, entry) => {
        auditEntries.push(entry);
      },
    });
    await ctrl.start();

    // active state exposes hostDisplayName so the local studio UI can render
    // its own (suppressed) self-attribution consistently.
    const s = ctrl.state();
    if (s.status !== 'active') throw new Error('expected active');
    expect(s.hostDisplayName).toBe('tuong');

    const version = ctrl.broadcastHostEdit(
      { op: 'moveNode', flowId: 'flow-host', nodeId: 'n-1', position: { x: 9, y: 9 } },
      { kind: 'ok' },
    );
    expect(version).toBe(1);
    expect(broadcasts).toHaveLength(1);
    const env = broadcasts[0];
    if (!env) throw new Error('expected broadcast');
    const payload = env.payload as {
      flowId: string;
      op: string;
      version: number;
      attributedTo: { peerId: string; displayName: string };
    };
    expect(payload.flowId).toBe('flow-host');
    expect(payload.op).toBe('moveNode');
    expect(payload.version).toBe(1);
    expect(payload.attributedTo).toEqual({ peerId: 'host', displayName: 'tuong' });

    // Host edit was audited with the same attribution.
    const hostAudits = auditEntries.filter((e) => e.peerId === 'host');
    expect(hostAudits).toHaveLength(1);
    expect(hostAudits[0]?.attributedTo).toEqual({ peerId: 'host', displayName: 'tuong' });
  });

  // Unknown sender connId: rpc must be dropped at the relay-frame layer
  // (handleFrame already drops it for lack of a peer record) and NO
  // node-patched broadcast may fire.
  it('rpc from unknown connId is rejected and produces no broadcast', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const broadcasts: Envelope[] = [];
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch({
        body: { sessionId: 'sess-1', token: 'tok-1', hostKey: 'hk-1', wsUrl: 'wss://relay/ws' },
      }),
      transportFactory: fake.factory,
      rpcDispatcher: async () => ({ kind: 'ok' }),
      appendShareAuditFn: () => {},
      broadcast: (env) => broadcasts.push(env),
    });
    await ctrl.start();
    // No prior presence/join — conn-99 is unknown.
    fake.emitFrame({
      v: 1,
      type: 'rpc',
      from: 'conn-99',
      id: 'r-z',
      payload: {
        op: 'moveNode',
        flowId: 'flow-a',
        nodeId: 'n-1',
        position: { x: 0, y: 0 },
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(broadcasts).toHaveLength(0);
    // No rpc-result either: the frame never reached dispatchRpcFrame.
    expect(fake.sends().filter((e) => e.type === 'rpc-result')).toHaveLength(0);
  });
});

describe('ShareController.subscribeAttributions (US-053)', () => {
  it('fires once per accepted peer rpc with full attribution metadata', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch({
        body: { sessionId: 'sess-1', token: 'tok-1', hostKey: 'hk-1', wsUrl: 'wss://relay/ws' },
      }),
      transportFactory: fake.factory,
      rpcDispatcher: async () => ({ kind: 'ok' }),
      appendShareAuditFn: () => {},
    });
    await ctrl.start();
    const events: import('./share.ts').AttributionEvent[] = [];
    const off = ctrl.subscribeAttributions((e) => events.push(e));

    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-42',
      payload: { kind: 'join', peerId: 'peer-42', displayName: 'Alice' },
    });
    fake.emitFrame({
      v: 1,
      type: 'rpc',
      from: 'conn-42',
      id: 'r-1',
      payload: { op: 'moveNode', flowId: 'flow-a', nodeId: 'n-1', position: { x: 1, y: 2 } },
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(events).toHaveLength(1);
    const ev = events[0];
    if (!ev) throw new Error('expected attribution event');
    expect(ev.flowId).toBe('flow-a');
    expect(ev.op).toBe('moveNode');
    expect(ev.version).toBe(1);
    expect(ev.attributedTo).toEqual({ peerId: 'peer-42', displayName: 'Alice' });
    expect(typeof ev.ts).toBe('number');
    off();
  });

  it('fires for host-originated broadcastHostEdit with peerId=host', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch({
        body: { sessionId: 'sess-1', token: 'tok-1', hostKey: 'hk-1', wsUrl: 'wss://relay/ws' },
      }),
      transportFactory: fake.factory,
      hostDisplayName: 'tuong',
      appendShareAuditFn: () => {},
    });
    await ctrl.start();
    const events: import('./share.ts').AttributionEvent[] = [];
    ctrl.subscribeAttributions((e) => events.push(e));

    ctrl.broadcastHostEdit(
      { op: 'moveNode', flowId: 'flow-host', nodeId: 'n-1', position: { x: 0, y: 0 } },
      { kind: 'ok' },
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.attributedTo).toEqual({ peerId: 'host', displayName: 'tuong' });
  });

  it('returns an unsubscribe that stops further events', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch({
        body: { sessionId: 'sess-1', token: 'tok-1', hostKey: 'hk-1', wsUrl: 'wss://relay/ws' },
      }),
      transportFactory: fake.factory,
      hostDisplayName: 'tuong',
      appendShareAuditFn: () => {},
    });
    await ctrl.start();
    const events: import('./share.ts').AttributionEvent[] = [];
    const off = ctrl.subscribeAttributions((e) => events.push(e));
    off();
    ctrl.broadcastHostEdit(
      { op: 'moveNode', flowId: 'flow-host', nodeId: 'n-1', position: { x: 0, y: 0 } },
      { kind: 'ok' },
    );
    expect(events).toHaveLength(0);
  });

  it('does not fire when broadcastNodePatched is suppressed (non-ok outcome via broadcastHostEdit)', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch({
        body: { sessionId: 'sess-1', token: 'tok-1', hostKey: 'hk-1', wsUrl: 'wss://relay/ws' },
      }),
      transportFactory: fake.factory,
      hostDisplayName: 'tuong',
      appendShareAuditFn: () => {},
    });
    await ctrl.start();
    const events: import('./share.ts').AttributionEvent[] = [];
    ctrl.subscribeAttributions((e) => events.push(e));
    const v = ctrl.broadcastHostEdit(
      { op: 'moveNode', flowId: 'flow-host', nodeId: 'n-1', position: { x: 0, y: 0 } },
      { kind: 'invalid' },
    );
    expect(v).toBeNull();
    expect(events).toHaveLength(0);
  });
});

describe('ShareState hostDisplayName default', () => {
  it("falls back to literal 'Host' when explicitly passed", async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const ctrl = createShareController({
      ...baseDeps,
      hostDisplayName: 'Host',
      fetch: mockFetch({
        body: { sessionId: 'sess-1', token: 'tok-1', hostKey: 'hk-1', wsUrl: 'wss://relay/ws' },
      }),
      transportFactory: fake.factory,
    });
    await ctrl.start();
    const s = ctrl.state();
    if (s.status !== 'active') throw new Error('expected active');
    expect(s.hostDisplayName).toBe('Host');
  });
});
