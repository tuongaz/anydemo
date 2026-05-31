import { describe, expect, it } from 'bun:test';
import type { ShareTransport, ShareTransportOpts, ShareTransportState } from './share-transport.ts';
import { type ShareState, createShareController } from './share.ts';

const baseDeps = {
  relayHttpUrl: 'https://relay.example',
  shareUrlBase: 'https://share.example',
};

interface FakeTransportHandle {
  factory: (opts: ShareTransportOpts) => ShareTransport;
  emit: (s: ShareTransportState) => void;
  capturedOpts: () => ShareTransportOpts | null;
  wasClosed: () => boolean;
}

function makeFakeTransport(autoEmit: ShareTransportState[] = []): FakeTransportHandle {
  let lastOpts: ShareTransportOpts | null = null;
  let closed = false;
  const factory = (opts: ShareTransportOpts): ShareTransport => {
    lastOpts = opts;
    const t: ShareTransport = {
      send() {},
      close() {
        closed = true;
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
    capturedOpts: () => lastOpts,
    wasClosed: () => closed,
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

  it('stub kick/rotateUrl throw not-implemented without mutating state', async () => {
    const ctrl = createShareController(baseDeps);
    await expect(ctrl.kick('peer-1')).rejects.toThrow('not-implemented');
    await expect(ctrl.rotateUrl()).rejects.toThrow('not-implemented');
    expect(ctrl.state()).toEqual({ status: 'idle' });
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
