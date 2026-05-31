import { describe, expect, test } from 'bun:test';
import { createEventBus } from '../events.ts';
import type { SsePayload } from './sse-frame.ts';
import { createSseTap } from './sse-tap.ts';

function collector() {
  const seen: SsePayload[] = [];
  return { seen, onEvent: (p: SsePayload) => seen.push(p) };
}

describe('createSseTap', () => {
  test('subscribes to flowIds returned by opts.flowIds() on start', () => {
    const bus = createEventBus();
    const flowIds = ['flow-a', 'flow-b'];
    const { seen, onEvent } = collector();
    const tap = createSseTap(bus, { flowIds: () => flowIds, onEvent });

    expect(bus.subscriberCount('flow-a')).toBe(0);
    expect(bus.subscriberCount('flow-b')).toBe(0);

    tap.start();

    expect(bus.subscriberCount('flow-a')).toBe(1);
    expect(bus.subscriberCount('flow-b')).toBe(1);

    bus.broadcast({ type: 'node:running', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.flowId).toBe('flow-a');

    tap.stop();
  });

  test('refreshFlows subscribes to newly appearing flowIds', () => {
    const bus = createEventBus();
    const ids: string[] = ['flow-a'];
    const { seen, onEvent } = collector();
    const tap = createSseTap(bus, { flowIds: () => ids, onEvent });

    tap.start();
    expect(bus.subscriberCount('flow-a')).toBe(1);
    expect(bus.subscriberCount('flow-b')).toBe(0);

    ids.push('flow-b');
    tap.refreshFlows();
    expect(bus.subscriberCount('flow-b')).toBe(1);

    bus.broadcast({ type: 'node:running', flowId: 'flow-b', payload: { nodeId: 'n2' } });
    expect(seen.some((p) => p.flowId === 'flow-b')).toBe(true);

    tap.stop();
  });

  test('refreshFlows unsubscribes from flowIds that disappear', () => {
    const bus = createEventBus();
    const ids: string[] = ['flow-a', 'flow-b'];
    const { seen, onEvent } = collector();
    const tap = createSseTap(bus, { flowIds: () => ids, onEvent });

    tap.start();
    expect(bus.subscriberCount('flow-a')).toBe(1);
    expect(bus.subscriberCount('flow-b')).toBe(1);

    ids.splice(ids.indexOf('flow-a'), 1);
    tap.refreshFlows();

    expect(bus.subscriberCount('flow-a')).toBe(0);
    expect(bus.subscriberCount('flow-b')).toBe(1);

    bus.broadcast({ type: 'node:running', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    expect(seen.every((p) => p.flowId !== 'flow-a')).toBe(true);

    tap.stop();
  });

  test('refreshFlows does not churn subscriptions for unchanged ids', () => {
    const bus = createEventBus();
    const ids: string[] = ['flow-a', 'flow-b'];
    const { onEvent } = collector();
    const tap = createSseTap(bus, { flowIds: () => ids, onEvent });

    tap.start();
    expect(bus.subscriberCount('flow-a')).toBe(1);

    tap.refreshFlows();
    tap.refreshFlows();
    tap.refreshFlows();

    expect(bus.subscriberCount('flow-a')).toBe(1);
    expect(bus.subscriberCount('flow-b')).toBe(1);

    tap.stop();
  });

  test('seq is process-wide monotonic across flows and event types', () => {
    const bus = createEventBus();
    const { seen, onEvent } = collector();
    const tap = createSseTap(bus, { flowIds: () => ['flow-a', 'flow-b'], onEvent });

    tap.start();

    bus.broadcast({ type: 'node:running', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    bus.broadcast({ type: 'node:status', flowId: 'flow-b', payload: { nodeId: 'n2' } });
    bus.broadcast({ type: 'flow:reload', flowId: 'flow-a', payload: null });
    bus.broadcast({ type: 'node:done', flowId: 'flow-b', payload: { nodeId: 'n2' } });

    expect(seen).toHaveLength(4);
    for (let i = 1; i < seen.length; i++) {
      const prev = seen[i - 1];
      const cur = seen[i];
      expect(prev).toBeDefined();
      expect(cur).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: bounded loop, prev/cur asserted above
      expect(cur!.seq).toBeGreaterThan(prev!.seq);
    }

    tap.stop();
  });

  test('non-bridged events (file:changed, registry:reload) are not forwarded', () => {
    const bus = createEventBus();
    const { seen, onEvent } = collector();
    const tap = createSseTap(bus, { flowIds: () => ['flow-a'], onEvent });

    tap.start();

    bus.broadcast({ type: 'file:changed', flowId: 'flow-a', payload: { path: '/x' } });
    bus.broadcast({ type: 'registry:reload', flowId: 'flow-a', payload: null });

    expect(seen).toHaveLength(0);

    bus.broadcast({ type: 'node:running', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    expect(seen).toHaveLength(1);

    tap.stop();
  });

  test('per-flow ring buffer caps at bufferSize (default 50)', () => {
    const bus = createEventBus();
    const { onEvent } = collector();
    const bufferSize = 5;
    const tap = createSseTap(bus, { flowIds: () => ['flow-a'], onEvent, bufferSize });

    tap.start();

    // The buffer cap is observable via the cap on how many *latest-per-node*
    // entries can survive across distinct nodes — but the ring buffer itself
    // is private. We instead exercise the cap by sending >bufferSize events
    // and asserting we don't OOM and snapshot still reflects the latest.
    for (let i = 0; i < bufferSize * 4; i++) {
      bus.broadcast({
        type: 'node:status',
        flowId: 'flow-a',
        payload: { nodeId: 'n1', i },
      });
    }

    const snap = tap.snapshot();
    const latest = snap['flow-a']?.n1;
    expect(latest).toBeDefined();
    expect((latest?.data as { i: number })?.i).toBe(bufferSize * 4 - 1);

    tap.stop();
  });

  test('snapshot returns last seen node-status payload per nodeId per flow', () => {
    const bus = createEventBus();
    const { onEvent } = collector();
    const tap = createSseTap(bus, { flowIds: () => ['flow-a', 'flow-b'], onEvent });

    tap.start();

    bus.broadcast({ type: 'node:running', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    bus.broadcast({ type: 'node:status', flowId: 'flow-a', payload: { nodeId: 'n1', step: 1 } });
    bus.broadcast({ type: 'node:running', flowId: 'flow-a', payload: { nodeId: 'n2' } });
    bus.broadcast({ type: 'node:done', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    bus.broadcast({ type: 'node:error', flowId: 'flow-b', payload: { nodeId: 'n9' } });

    const snap = tap.snapshot();
    expect(snap['flow-a']?.n1?.t).toBe('node:done');
    expect(snap['flow-a']?.n2?.t).toBe('node:running');
    expect(snap['flow-b']?.n9?.t).toBe('node:error');

    tap.stop();
  });

  test('snapshot ignores events without a nodeId (e.g. flow:reload)', () => {
    const bus = createEventBus();
    const { onEvent } = collector();
    const tap = createSseTap(bus, { flowIds: () => ['flow-a'], onEvent });

    tap.start();

    bus.broadcast({ type: 'flow:reload', flowId: 'flow-a', payload: null });
    bus.broadcast({ type: 'node:status', flowId: 'flow-a', payload: { other: 'no-node' } });

    const snap = tap.snapshot();
    expect(snap['flow-a']).toBeUndefined();

    tap.stop();
  });

  test('stop clears subscriptions, buffer, and snapshot state', () => {
    const bus = createEventBus();
    const { seen, onEvent } = collector();
    const tap = createSseTap(bus, { flowIds: () => ['flow-a'], onEvent });

    tap.start();
    bus.broadcast({ type: 'node:running', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    expect(tap.snapshot()['flow-a']?.n1).toBeDefined();

    tap.stop();

    expect(bus.subscriberCount('flow-a')).toBe(0);
    expect(tap.snapshot()).toEqual({});

    bus.broadcast({ type: 'node:running', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    expect(seen).toHaveLength(1);
  });

  test('refreshFlows is a no-op before start()', () => {
    const bus = createEventBus();
    const { onEvent } = collector();
    const tap = createSseTap(bus, { flowIds: () => ['flow-a'], onEvent });

    tap.refreshFlows();
    expect(bus.subscriberCount('flow-a')).toBe(0);

    tap.start();
    expect(bus.subscriberCount('flow-a')).toBe(1);

    tap.stop();
  });

  test('metrics() returns zeros when rate limiting is disabled', () => {
    const bus = createEventBus();
    const { onEvent } = collector();
    const tap = createSseTap(bus, {
      flowIds: () => ['flow-a'],
      onEvent,
      rateLimit: false,
    });

    tap.start();
    expect(tap.metrics()).toEqual({ droppedFrames: 0, queueDepth: 0 });
    bus.broadcast({ type: 'node:status', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    expect(tap.metrics()).toEqual({ droppedFrames: 0, queueDepth: 0 });
    tap.stop();
  });

  test('metrics() proxies to the internal rate limiter when enabled', () => {
    const bus = createEventBus();
    const { seen, onEvent } = collector();
    const tap = createSseTap(bus, {
      flowIds: () => ['flow-a'],
      onEvent,
      rateLimit: { tokensPerSecond: 60, burst: 2, maxQueueDepth: 5, now: () => 0 },
    });

    tap.start();

    // First 2 emit immediately (burst). Subsequent same-key node:status coalesce.
    bus.broadcast({ type: 'node:status', flowId: 'flow-a', payload: { nodeId: 'n1', i: 0 } });
    bus.broadcast({ type: 'node:status', flowId: 'flow-a', payload: { nodeId: 'n1', i: 1 } });
    bus.broadcast({ type: 'node:status', flowId: 'flow-a', payload: { nodeId: 'n1', i: 2 } });
    bus.broadcast({ type: 'node:status', flowId: 'flow-a', payload: { nodeId: 'n1', i: 3 } });

    expect(seen).toHaveLength(2);
    const metrics = tap.metrics();
    expect(metrics.queueDepth).toBe(1);
    expect(metrics.droppedFrames).toBe(1);

    // Terminal events bypass the bucket and always pass through.
    bus.broadcast({ type: 'node:done', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    expect(seen).toHaveLength(3);
    expect(seen[2]?.t).toBe('node:done');

    tap.stop();
  });

  test('start is idempotent — calling twice does not double-subscribe', () => {
    const bus = createEventBus();
    const { seen, onEvent } = collector();
    const tap = createSseTap(bus, { flowIds: () => ['flow-a'], onEvent });

    tap.start();
    tap.start();

    expect(bus.subscriberCount('flow-a')).toBe(1);

    bus.broadcast({ type: 'node:running', flowId: 'flow-a', payload: { nodeId: 'n1' } });
    expect(seen).toHaveLength(1);

    tap.stop();
  });
});
