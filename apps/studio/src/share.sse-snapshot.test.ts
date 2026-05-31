/**
 * US-069 — `sse-snapshot` replay frame tests.
 *
 * Exercises the host-side path that, on a presence/join, replays the SSE
 * tap's latest-status-per-node snapshot to the new peer so its canvas state
 * matches the host within one render.
 *
 * Covers acceptance criteria:
 *   - Exactly one `sse-snapshot` frame is sent to the joining peer's connId
 *     (not broadcast).
 *   - Other already-joined peers do NOT receive the snapshot.
 *   - Large snapshots are chunked per-flow with `{ chunk, total }` headers
 *     so no single frame's serialized payload exceeds 256 KB.
 *   - Empty snapshots (no observed events yet) emit zero frames — there is
 *     nothing to replay.
 */

import { describe, expect, it } from 'bun:test';
import { createEventBus } from './events.ts';
import type { AuditLog, AuditLogOpts } from './share-audit.ts';
import type { Envelope } from './share-envelope.ts';
import type { ShareTransport, ShareTransportOpts, ShareTransportState } from './share-transport.ts';
import { SSE_SNAPSHOT_CHUNK_BYTES, chunkSnapshotByFlow, createShareController } from './share.ts';
import { SsePayloadSchema, SseSnapshotPayloadSchema } from './share/sse-frame.ts';

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

describe('share.ts — sse-snapshot on join (US-069)', () => {
  it('sends a single sse-snapshot frame addressed to the joiner with the tap snapshot', async () => {
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

    // Drive a few events through the tap so snapshot has content.
    bus.broadcast({ type: 'node:running', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    bus.broadcast({ type: 'node:done', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    bus.broadcast({ type: 'node:running', flowId: 'flow-a', payload: { nodeId: 'n2' } });
    const liveSendCount = fake.sends().length;
    expect(liveSendCount).toBe(3);

    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-7',
      payload: { kind: 'join', peerId: 'peer-42', displayName: 'Ada' },
    });

    const snapshotFrames = fake.sends().filter((e) => e.type === 'sse-snapshot');
    expect(snapshotFrames).toHaveLength(1);
    const env = snapshotFrames[0];
    if (!env) throw new Error('expected snapshot envelope');
    expect(env.v).toBe(1);
    expect(env.from).toBe('host');
    expect(env.to).toBe('conn-7');

    const parsed = SseSnapshotPayloadSchema.safeParse(env.payload);
    if (!parsed.success) {
      throw new Error(`payload did not match SseSnapshotPayloadSchema: ${parsed.error}`);
    }
    // Single chunk -> no chunk/total headers.
    expect(parsed.data.chunk).toBeUndefined();
    expect(parsed.data.total).toBeUndefined();
    const nodes = parsed.data.flows['flow-a'];
    if (!nodes) throw new Error('expected flow-a entries');
    expect(nodes.n1?.t).toBe('node:done'); // last-wins between running + done
    expect(nodes.n2?.t).toBe('node:running');

    await ctrl.stop();
  });

  it('does not broadcast the snapshot to already-joined peers — only the joiner sees it', async () => {
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

    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-A',
      payload: { kind: 'join', peerId: 'peer-A', displayName: 'Alice' },
    });
    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-B',
      payload: { kind: 'join', peerId: 'peer-B', displayName: 'Bob' },
    });

    const snapshotFrames = fake.sends().filter((e) => e.type === 'sse-snapshot');
    expect(snapshotFrames).toHaveLength(2);
    // Each snapshot is addressed to its respective joiner connId — never 'all'.
    const targets = snapshotFrames.map((e) => e.to).sort();
    expect(targets).toEqual(['conn-A', 'conn-B']);
    for (const env of snapshotFrames) {
      expect(env.to).not.toBe('all');
    }

    await ctrl.stop();
  });

  it('emits zero snapshot frames when the tap snapshot is empty (no live events yet)', async () => {
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

    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-7',
      payload: { kind: 'join', peerId: 'peer-42', displayName: 'Ada' },
    });

    const snapshotFrames = fake.sends().filter((e) => e.type === 'sse-snapshot');
    expect(snapshotFrames).toHaveLength(0);

    await ctrl.stop();
  });

  it('chunks a large snapshot per-flow when serialized payload exceeds 256 KB', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const bus = createEventBus();
    // Register many flows so the tap's snapshot has lots of content to break
    // into chunks. We use long, padded payloads to push the JSON size past
    // the 256 KB cap.
    const flowIds = Array.from({ length: 24 }, (_, i) => `flow-${i}`);
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch(RELAY_SESSION),
      transportFactory: fake.factory,
      eventBus: bus,
      flowIdsForBroadcast: () => flowIds,
    });
    await ctrl.start();

    const filler = 'x'.repeat(15_000); // ~15 KB per node payload
    for (const flowId of flowIds) {
      bus.broadcast({
        type: 'node:status',
        flowId,
        payload: { nodeId: 'n1', filler },
      });
    }

    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-99',
      payload: { kind: 'join', peerId: 'peer-99', displayName: 'Carol' },
    });

    const snapshotFrames = fake.sends().filter((e) => e.type === 'sse-snapshot');
    expect(snapshotFrames.length).toBeGreaterThan(1);

    const totals = new Set<number | undefined>();
    const chunks: number[] = [];
    const allFlowIds: string[] = [];
    for (const env of snapshotFrames) {
      const parsed = SseSnapshotPayloadSchema.safeParse(env.payload);
      if (!parsed.success) {
        throw new Error(`chunk failed schema: ${parsed.error}`);
      }
      expect(env.to).toBe('conn-99');
      totals.add(parsed.data.total);
      if (parsed.data.chunk !== undefined) chunks.push(parsed.data.chunk);
      for (const flowId of Object.keys(parsed.data.flows)) allFlowIds.push(flowId);
      // Per-chunk payload size respects the 256 KB ceiling.
      expect(JSON.stringify(parsed.data).length).toBeLessThanOrEqual(SSE_SNAPSHOT_CHUNK_BYTES);
    }
    // Every chunk shares the same `total`.
    expect(totals.size).toBe(1);
    expect([...totals][0]).toBe(snapshotFrames.length);
    // Chunk indices are 0..N-1 with no gaps.
    expect(chunks.sort((a, b) => a - b)).toEqual(
      Array.from({ length: snapshotFrames.length }, (_, i) => i),
    );
    // Every registered flow appears exactly once across chunks.
    expect(allFlowIds.sort()).toEqual(flowIds.slice().sort());

    await ctrl.stop();
  });

  it('snapshot payload entries match SsePayloadSchema for each node', async () => {
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

    bus.broadcast({
      type: 'node:status',
      flowId: 'flow-a',
      payload: { nodeId: 'n1', step: 'parsing' },
    });

    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-7',
      payload: { kind: 'join', peerId: 'peer-42', displayName: 'Ada' },
    });

    const snap = fake.sends().find((e) => e.type === 'sse-snapshot');
    if (!snap) throw new Error('expected snapshot');
    const parsed = SseSnapshotPayloadSchema.parse(snap.payload);
    const entry = parsed.flows['flow-a']?.n1;
    if (!entry) throw new Error('expected n1 entry');
    expect(SsePayloadSchema.safeParse(entry).success).toBe(true);

    await ctrl.stop();
  });

  it('does NOT emit a snapshot when there is no eventBus (bridge disabled)', async () => {
    const fake = makeFakeTransport(['connecting', 'open']);
    const ctrl = createShareController({
      ...baseDeps,
      fetch: mockFetch(RELAY_SESSION),
      transportFactory: fake.factory,
      // Intentionally omit eventBus / flowIdsForBroadcast — the SSE bridge
      // is off and there is no tap to snapshot.
    });
    await ctrl.start();

    fake.emitFrame({
      v: 1,
      type: 'presence',
      from: 'conn-7',
      payload: { kind: 'join', peerId: 'peer-42', displayName: 'Ada' },
    });

    expect(fake.sends().filter((e) => e.type === 'sse-snapshot')).toHaveLength(0);

    await ctrl.stop();
  });

  it('duplicate presence/join for the same peerId does not re-send a snapshot', async () => {
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

    const joinFrame: Envelope = {
      v: 1,
      type: 'presence',
      from: 'conn-7',
      payload: { kind: 'join', peerId: 'peer-42', displayName: 'Ada' },
    };
    fake.emitFrame(joinFrame);
    fake.emitFrame(joinFrame);

    // Duplicate join is suppressed by the existing idempotency guard before
    // reaching the snapshot emit path — only one snapshot frame goes out.
    const snapshotFrames = fake.sends().filter((e) => e.type === 'sse-snapshot');
    expect(snapshotFrames).toHaveLength(1);

    await ctrl.stop();
  });
});

describe('chunkSnapshotByFlow', () => {
  it('returns one chunk for a small snapshot', () => {
    const snap = {
      'flow-a': { n1: { t: 'node:running', flowId: 'flow-a', ts: 1, data: {}, seq: 0 } },
    };
    const chunks = chunkSnapshotByFlow(snap);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(snap);
  });

  it('returns no chunks for an empty input', () => {
    expect(chunkSnapshotByFlow({})).toEqual([]);
  });

  it('splits per-flow when serialized JSON exceeds the cap', () => {
    const big = 'x'.repeat(120_000);
    const snap: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 6; i += 1) {
      snap[`flow-${i}`] = {
        n1: { t: 'node:status', flowId: `flow-${i}`, ts: 1, data: { big }, seq: i },
      };
    }
    const chunks = chunkSnapshotByFlow(snap);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(JSON.stringify({ flows: chunk }).length).toBeLessThanOrEqual(SSE_SNAPSHOT_CHUNK_BYTES);
    }
    // No flow appears in more than one chunk.
    const seen = new Set<string>();
    for (const chunk of chunks) {
      for (const flowId of Object.keys(chunk)) {
        expect(seen.has(flowId)).toBe(false);
        seen.add(flowId);
      }
    }
    expect(seen.size).toBe(6);
  });

  it('emits an oversize flow as its own chunk (per-flow is indivisible)', () => {
    const huge = 'x'.repeat(SSE_SNAPSHOT_CHUNK_BYTES + 1024);
    const snap: Record<string, Record<string, unknown>> = {
      'flow-huge': {
        n1: { t: 'node:status', flowId: 'flow-huge', ts: 1, data: { huge }, seq: 0 },
      },
      'flow-tiny': {
        n1: { t: 'node:running', flowId: 'flow-tiny', ts: 1, data: {}, seq: 1 },
      },
    };
    const chunks = chunkSnapshotByFlow(snap);
    expect(chunks).toHaveLength(2);
    // The huge flow occupies its own chunk; the tiny one rides in its own
    // chunk too (since adding huge to current would breach the cap immediately).
    const flowsPerChunk = chunks.map((c) => Object.keys(c).sort());
    expect(flowsPerChunk).toContainEqual(['flow-huge']);
    expect(flowsPerChunk).toContainEqual(['flow-tiny']);
  });
});
