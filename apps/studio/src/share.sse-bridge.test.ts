/**
 * US-067 — SSE bridge tests.
 *
 * Exercises the `createShareController` path that owns a single per-session
 * `SseTap`, subscribes to the local EventBus per flow returned by
 * `flowIdsForBroadcast()`, and forwards each bridged StudioEvent to the relay
 * as a `{ type: 'sse' }` envelope whose payload conforms to SsePayloadSchema.
 *
 * Covers acceptance criteria:
 *   - A `node:running` event for a registered flow produces exactly one
 *     outbound `{type:'sse'}` frame whose payload parses against
 *     SsePayloadSchema.
 *   - Events for flowIds NOT in flowIdsForBroadcast() are dropped.
 *   - A `registry:reload` event triggers refreshFlows() so a newly registered
 *     flow's events start forwarding without restarting the session.
 *   - On host WS reconnect the buffered ring is NOT re-sent; only events
 *     arriving after reconnect produce outbound frames (no double-emit).
 */

import { describe, expect, it } from 'bun:test';
import { createEventBus } from './events.ts';
import type { AuditLog, AuditLogOpts } from './share-audit.ts';
import type { Envelope } from './share-envelope.ts';
import type { ShareTransport, ShareTransportOpts, ShareTransportState } from './share-transport.ts';
import { createShareController } from './share.ts';
import { SsePayloadSchema } from './share/sse-frame.ts';

const noopAuditFactory = (_opts: AuditLogOpts): AuditLog => ({
  append: () => {},
  close: async () => {},
});

const baseDeps = {
  relayHttpUrl: 'https://relay.example',
  shareUrlBase: 'https://share.example',
  auditLogFactory: noopAuditFactory,
};

const mockFetch = (body: unknown): typeof fetch => {
  const fake = async () =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
  return fake as unknown as typeof fetch;
};

interface FakeTransportHandle {
  factory: (opts: ShareTransportOpts) => ShareTransport;
  emit: (s: ShareTransportState) => void;
  sends: () => Envelope[];
  setOpen: (open: boolean) => void;
}

function makeFakeTransport(autoEmit: ShareTransportState[] = []): FakeTransportHandle {
  let lastOpts: ShareTransportOpts | null = null;
  let open = true;
  const sends: Envelope[] = [];
  const factory = (opts: ShareTransportOpts): ShareTransport => {
    lastOpts = opts;
    const t: ShareTransport = {
      send(frame) {
        sends.push(frame);
      },
      close() {},
      isOpen() {
        return open;
      },
    };
    for (const s of autoEmit) opts.onStateChange(s);
    return t;
  };
  return {
    factory,
    emit: (s) => lastOpts?.onStateChange(s),
    sends: () => sends,
    setOpen: (o) => {
      open = o;
    },
  };
}

const RELAY_SESSION = {
  sessionId: 'sess-x',
  token: 'tok-x',
  hostKey: 'hk-x',
  wsUrl: 'wss://relay/ws',
};

describe('share.ts — SSE bridge via SseTap (US-067)', () => {
  it('forwards a node:running for a registered flow as a single sse envelope matching SsePayloadSchema', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const bus = createEventBus();
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch(RELAY_SESSION),
      transportFactory: fake.factory,
      eventBus: bus,
      flowIdsForBroadcast: () => ['flow-a'],
    });
    await ctrl.start();

    bus.broadcast({ type: 'node:running', flowId: 'flow-a', payload: { nodeId: 'n1' } });

    expect(fake.sends()).toHaveLength(1);
    const env = fake.sends()[0];
    if (!env) throw new Error('expected envelope');
    expect(env.v).toBe(1);
    expect(env.type).toBe('sse');
    expect(env.from).toBe('host');
    expect(env.to).toBe('all');

    const parsed = SsePayloadSchema.safeParse(env.payload);
    if (!parsed.success) throw new Error(`payload did not match SsePayloadSchema: ${parsed.error}`);
    expect(parsed.data.t).toBe('node:running');
    expect(parsed.data.flowId).toBe('flow-a');
    expect(parsed.data.data).toEqual({ nodeId: 'n1' });
    expect(parsed.data.seq).toBe(0);
    expect(typeof parsed.data.ts).toBe('number');

    await ctrl.stop();
  });

  it('drops events for flowIds that are not in flowIdsForBroadcast()', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const bus = createEventBus();
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch(RELAY_SESSION),
      transportFactory: fake.factory,
      eventBus: bus,
      flowIdsForBroadcast: () => ['flow-a'],
    });
    await ctrl.start();

    // flow-b never registers — the tap has no subscriber for it.
    bus.broadcast({ type: 'node:running', flowId: 'flow-b', payload: { nodeId: 'n1' } });
    expect(fake.sends()).toHaveLength(0);

    await ctrl.stop();
  });

  it('seq increments monotonically across forwarded events', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const bus = createEventBus();
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch(RELAY_SESSION),
      transportFactory: fake.factory,
      eventBus: bus,
      flowIdsForBroadcast: () => ['flow-a'],
    });
    await ctrl.start();

    bus.broadcast({ type: 'node:running', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    bus.broadcast({ type: 'node:status', flowId: 'flow-a', payload: { nodeId: 'n1', step: 1 } });
    bus.broadcast({ type: 'node:done', flowId: 'flow-a', payload: { nodeId: 'n1' } });

    const seqs = fake.sends().map((env) => SsePayloadSchema.parse(env.payload).seq);
    expect(seqs).toEqual([0, 1, 2]);

    await ctrl.stop();
  });

  it('refreshes its subscription set when a registry:reload event fires', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const bus = createEventBus();
    const registered = new Set<string>(['flow-a']);
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch(RELAY_SESSION),
      transportFactory: fake.factory,
      eventBus: bus,
      flowIdsForBroadcast: () => [...registered],
    });
    await ctrl.start();

    // flow-b is not yet registered: events for it are dropped by the tap.
    bus.broadcast({ type: 'node:running', flowId: 'flow-b', payload: { nodeId: 'n2' } });
    expect(fake.sends()).toHaveLength(0);

    // Simulate registry mutation -> registry:reload (mirrors api.ts).
    registered.add('flow-b');
    bus.broadcast({ type: 'registry:reload', flowId: '__registry__', payload: {} });

    // Now flow-b events should forward.
    bus.broadcast({ type: 'node:running', flowId: 'flow-b', payload: { nodeId: 'n2' } });
    expect(fake.sends()).toHaveLength(1);
    expect(SsePayloadSchema.parse(fake.sends()[0]?.payload).flowId).toBe('flow-b');

    // And removed flows should stop forwarding after refresh.
    registered.delete('flow-a');
    bus.broadcast({ type: 'registry:reload', flowId: '__registry__', payload: {} });
    bus.broadcast({ type: 'node:running', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    expect(fake.sends()).toHaveLength(1);

    await ctrl.stop();
  });

  it('tears down the tap + registry listener on stop() so later broadcasts do not reach the transport', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const bus = createEventBus();
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch(RELAY_SESSION),
      transportFactory: fake.factory,
      eventBus: bus,
      flowIdsForBroadcast: () => ['flow-a'],
    });
    await ctrl.start();
    expect(bus.subscriberCount('flow-a')).toBe(1);
    expect(bus.subscriberCount('__registry__')).toBe(1);

    await ctrl.stop();
    expect(bus.subscriberCount('flow-a')).toBe(0);
    expect(bus.subscriberCount('__registry__')).toBe(0);

    bus.broadcast({ type: 'node:done', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    expect(fake.sends()).toHaveLength(0);
  });

  it('on reconnect, only events after reconnect are forwarded — no double-emit of the buffered ring', async () => {
    // Drive the transport through open -> reconnecting -> open and assert
    // each broadcast results in exactly ONE outbound frame, not a replay of
    // the prior buffered events. The tap's ring buffer is private snapshot
    // priming state, never replayed at the broadcast layer.
    const fake = makeFakeTransport(['connecting', 'open']);
    const bus = createEventBus();
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch(RELAY_SESSION),
      transportFactory: fake.factory,
      eventBus: bus,
      flowIdsForBroadcast: () => ['flow-a'],
    });
    await ctrl.start();

    bus.broadcast({ type: 'node:running', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    bus.broadcast({ type: 'node:status', flowId: 'flow-a', payload: { nodeId: 'n1', step: 1 } });
    expect(fake.sends()).toHaveLength(2);

    // Simulate WS reconnect cycle (transport closes + re-opens). The tap
    // does NOT replay its ring buffer when the transport returns to 'open'.
    fake.setOpen(false);
    fake.emit('reconnecting');
    fake.setOpen(true);
    fake.emit('open');
    expect(fake.sends()).toHaveLength(2);

    // Post-reconnect events forward as before — one frame per broadcast.
    bus.broadcast({ type: 'node:done', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    expect(fake.sends()).toHaveLength(3);
    const seqs = fake.sends().map((env) => SsePayloadSchema.parse(env.payload).seq);
    expect(seqs).toEqual([0, 1, 2]);

    await ctrl.stop();
  });
});
