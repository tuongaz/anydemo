import { describe, expect, it } from 'bun:test';
import type { Envelope } from './share-envelope.ts';
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

function mockFetchSequence(responses: { status?: number; body?: unknown }[]): typeof fetch {
  let i = 0;
  const fake = async () => {
    const r = responses[i] ?? responses[responses.length - 1];
    i += 1;
    const status = r?.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => r?.body ?? {},
    } as unknown as Response;
  };
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

  it('from active sends a kick envelope addressed to peerId', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch({
        body: { sessionId: 'sess-1', token: 'tok-1', hostKey: 'hk-1', wsUrl: 'wss://relay/ws' },
      }),
      transportFactory: fake.factory,
    });
    await ctrl.start();
    await ctrl.kick('peer-42');

    expect(fake.sends()).toHaveLength(1);
    const frame = fake.sends()[0];
    expect(frame).toBeDefined();
    if (!frame) throw new Error('expected kick frame');
    expect(frame.v).toBe(1);
    expect(frame.type).toBe('kick');
    expect(frame.from).toBe('host');
    expect(frame.to).toBe('peer-42');
    expect(frame.payload).toEqual({ peerId: 'peer-42' });
  });
});

describe('createShareController.rotateUrl()', () => {
  it('from idle rejects with share-not-active', async () => {
    const ctrl = createShareController(baseDeps);
    await expect(ctrl.rotateUrl()).rejects.toThrow('share-not-active');
    expect(ctrl.state()).toEqual({ status: 'idle' });
  });

  it('from active returns a new url and the old token is no longer in state', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetchSequence([
        { body: { sessionId: 'sess-1', token: 'tok-1', hostKey: 'hk-1', wsUrl: 'wss://relay/ws' } },
        { body: { sessionId: 'sess-2', token: 'tok-2', hostKey: 'hk-2', wsUrl: 'wss://relay/ws' } },
      ]),
      transportFactory: fake.factory,
    });

    const first = await ctrl.start();
    expect(first.url).toBe('https://share.example/tok-1');

    const { url } = await ctrl.rotateUrl();
    expect(url).toBe('https://share.example/tok-2');

    const s = ctrl.state();
    if (s.status !== 'active') throw new Error('expected active after rotate');
    expect(s.token).toBe('tok-2');
    expect(s.url).toBe('https://share.example/tok-2');
    expect(s.sessionId).toBe('sess-2');

    // Two transport instances created (one per start), and the first was closed.
    expect(fake.instanceCount()).toBe(2);
    expect(fake.closeCount()).toBe(1);
  });
});
