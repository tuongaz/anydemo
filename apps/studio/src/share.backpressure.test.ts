/**
 * US-072 — Per-peer outbound SSE queue backpressure tests.
 *
 * Exercises the share-controller wiring of the per-peer bounded async queue
 * introduced in `apps/studio/src/share/sse-outbound-queue.ts`. A slow peer
 * (50ms-per-frame `outboundSseSend` stub) must not stall the host's event
 * loop, must not back-pressure the SSE tap's producer, and must drop the
 * oldest non-terminal frames while still delivering any terminal frame.
 *
 * Acceptance criteria (from PRD US-072):
 *   - No host-side await stalls beyond the 256-frame cap.
 *   - `droppedFrames > 0` after a 500-frame burst on a slow consumer.
 *   - Terminal frames (`node:done`/`node:error`) are always delivered.
 *   - The OLDEST frames are the ones dropped (FIFO eviction preserves
 *     latest-state semantics for the peer's canvas badges).
 *   - Per-peer metrics (`queueDepth`, `droppedFrames`, `lastSendMs`) surface
 *     on the active ShareState's peer entries.
 */

import { describe, expect, it } from 'bun:test';
import { createEventBus } from './events.ts';
import type { AuditLog, AuditLogOpts } from './share-audit.ts';
import type { Envelope } from './share-envelope.ts';
import type { ShareTransport, ShareTransportOpts, ShareTransportState } from './share-transport.ts';
import { createShareController } from './share.ts';
import type { SsePayload } from './share/sse-frame.ts';

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
  emitFrame: (env: Envelope) => void;
  sends: () => Envelope[];
}

function makeFakeTransport(autoEmit: ShareTransportState[] = []): FakeTransportHandle {
  let lastOpts: ShareTransportOpts | null = null;
  const sends: Envelope[] = [];
  const factory = (opts: ShareTransportOpts): ShareTransport => {
    lastOpts = opts;
    const t: ShareTransport = {
      send(frame) {
        sends.push(frame);
      },
      close() {},
      isOpen() {
        return true;
      },
    };
    for (const s of autoEmit) opts.onStateChange(s);
    return t;
  };
  return {
    factory,
    emitFrame: (env) => lastOpts?.onFrame(env),
    sends: () => sends,
  };
}

const RELAY_SESSION = {
  sessionId: 'sess-x',
  token: 'tok-x',
  hostKey: 'hk-x',
  wsUrl: 'wss://relay/ws',
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('share.ts — per-peer SSE backpressure (US-072)', () => {
  it('bursts 500 frames on a slow stub without stalling the producer; drops oldest non-terminals', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const bus = createEventBus();
    const sendCalls: { payload: SsePayload; peerConnId: string }[] = [];

    // PRD scenario: "peer with a send stub that delays 50ms per frame; bursting
    // 500 frames in 10ms". We model the same shape but shrink the cap + delay
    // so the test finishes inside the 5s bun:test budget; the eviction logic
    // is identical regardless of cap size.
    const QUEUE_CAP = 32;
    const SEND_DELAY_MS = 5;

    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch(RELAY_SESSION),
      transportFactory: fake.factory,
      eventBus: bus,
      flowIdsForBroadcast: () => ['flow-a'],
      outboundSseMaxFrames: QUEUE_CAP,
      // Disable the tap's coalescer so the storm reaches the per-peer queues
      // instead of being absorbed upstream (US-068 sets a 60/sec / burst 120
      // default that would mask the backpressure path under test).
      sseTapRateLimit: false,
      outboundSseSend: async (payload, peerConnId) => {
        await sleep(SEND_DELAY_MS);
        sendCalls.push({ payload, peerConnId });
      },
    });
    await ctrl.start();

    // Register a peer so the per-peer queue gets built.
    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-1',
      payload: { kind: 'join', peerId: 'peer-1', displayName: 'Slow Sally' },
    });

    // Synchronously burst 499 non-terminal frames + 1 terminal at the end.
    const t0 = Date.now();
    for (let i = 0; i < 499; i++) {
      bus.broadcast({
        type: 'node:status',
        flowId: 'flow-a',
        payload: { nodeId: 'n1', step: i },
      });
    }
    bus.broadcast({ type: 'node:done', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    const burstElapsed = Date.now() - t0;

    // The producer is fully synchronous from EventBus -> tap -> queue.enqueue.
    // The slow send must NOT stall the burst.
    expect(burstElapsed).toBeLessThan(50);

    // Metrics surface via state(): queue depth is capped at outboundSseMaxFrames,
    // and droppedFrames is well above zero (500 - cap - in_flight = lots).
    const state = ctrl.state();
    if (state.status !== 'active') throw new Error('expected active state');
    const peer = state.peers.find((p) => p.peerId === 'peer-1');
    if (!peer) throw new Error('expected peer in state');
    const m = peer.outboundSse;
    if (!m) throw new Error('expected outboundSse metrics on peer');
    expect(m.queueDepth).toBeLessThanOrEqual(QUEUE_CAP);
    expect(m.droppedFrames).toBeGreaterThan(0);

    // Wait long enough for the queue to fully drain.
    await sleep(SEND_DELAY_MS * (QUEUE_CAP + 5) + 200);

    // The terminal frame is always delivered (eviction policy reserves a slot
    // for it even when the queue is full).
    const sentTypes = sendCalls.map((c) => c.payload.t);
    expect(sentTypes).toContain('node:done');

    // The OLDEST queued frames are the ones dropped. The very first frame
    // (step 0) may be sent because the drain pulls it into the in-flight
    // await before subsequent enqueues even run — that's expected. But the
    // frames that landed in the queue early (e.g. step 100) MUST have been
    // evicted as later frames overflowed the cap.
    const sentSteps = sendCalls
      .filter((c) => c.payload.t === 'node:status')
      .map((c) => (c.payload.data as { step: number }).step);
    expect(sentSteps.length).toBeGreaterThan(0);
    expect(sentSteps).not.toContain(100);
    expect(sentSteps).not.toContain(200);
    // The TAIL of the queue (most recent frames) survives — the final
    // non-terminal step (498) should be present.
    expect(sentSteps).toContain(498);

    await ctrl.stop();
  });

  it('per-peer queue is created on presence/join and disposed on presence/leave', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const bus = createEventBus();
    const sendCalls: SsePayload[] = [];

    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch(RELAY_SESSION),
      transportFactory: fake.factory,
      eventBus: bus,
      flowIdsForBroadcast: () => ['flow-a'],
      sseTapRateLimit: false,
      outboundSseSend: (payload) => {
        sendCalls.push(payload);
      },
    });
    await ctrl.start();

    // Before any peer joins, SSE events fall through to a legacy `to: 'all'`
    // broadcast (so the relay still fans out to any peer not yet seen).
    bus.broadcast({ type: 'node:running', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    expect(sendCalls).toHaveLength(0);
    const allFrames = fake.sends().filter((e) => e.type === 'sse');
    expect(allFrames).toHaveLength(1);
    expect(allFrames[0]?.to).toBe('all');

    // After join: per-peer queue routes frames through outboundSseSend.
    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-1',
      payload: { kind: 'join', peerId: 'peer-1', displayName: 'Alice' },
    });
    bus.broadcast({ type: 'node:status', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    await sleep(20);
    expect(sendCalls.length).toBeGreaterThanOrEqual(1);

    // After leave: per-peer queue disposed; subsequent events return to the
    // legacy `to: 'all'` broadcast path.
    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-1',
      payload: { kind: 'leave', peerId: 'peer-1' },
    });
    const sentBeforeBroadcast = sendCalls.length;
    bus.broadcast({ type: 'node:status', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    await sleep(20);
    expect(sendCalls.length).toBe(sentBeforeBroadcast); // no per-peer enqueue

    await ctrl.stop();
  });

  it('emits an sse-snapshot resync when droppedFrames exceeds threshold within the window', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const bus = createEventBus();

    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch(RELAY_SESSION),
      transportFactory: fake.factory,
      eventBus: bus,
      flowIdsForBroadcast: () => ['flow-a'],
      sseTapRateLimit: false,
      outboundSseMaxFrames: 4,
      outboundSseDropResyncThreshold: 5,
      // Never resolves — every enqueue past in-flight + maxFrames is dropped.
      outboundSseSend: () => new Promise<void>(() => {}),
    });
    await ctrl.start();

    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-1',
      payload: { kind: 'join', peerId: 'peer-1', displayName: 'Sally' },
    });
    // Prime the snapshot so a resync actually emits something.
    bus.broadcast({ type: 'node:running', flowId: 'flow-a', payload: { nodeId: 'n1' } });

    // Snapshot frames already sent: the join itself emits zero (tap snapshot
    // was empty at join time). Now burst enough events to drive drops past
    // the threshold (>5 in this configuration).
    for (let i = 0; i < 30; i++) {
      bus.broadcast({
        type: 'node:status',
        flowId: 'flow-a',
        payload: { nodeId: 'n1', step: i },
      });
    }

    // A resync snapshot frame addressed to the slow peer must be emitted.
    const snapshotFrames = fake.sends().filter((e) => e.type === 'sse-snapshot');
    expect(snapshotFrames.length).toBeGreaterThanOrEqual(1);
    const last = snapshotFrames.at(-1);
    expect(last?.to).toBe('conn-1');
    expect(last?.from).toBe('host');

    await ctrl.stop();
  });
});
