import { describe, expect, test } from 'bun:test';
import type { SsePayload } from './sse-frame.ts';
import { createRateLimiter } from './sse-rate-limit.ts';

function payload(
  t: SsePayload['t'],
  data: unknown,
  seq = 0,
  flowId = 'flow-a',
  ts = 0,
): SsePayload {
  return { t, flowId, ts, data, seq };
}

function noopSchedule(): () => void {
  return () => {};
}

describe('createRateLimiter', () => {
  test('passes frames through immediately while bucket has tokens', () => {
    const emitted: SsePayload[] = [];
    const limiter = createRateLimiter({
      tokensPerSecond: 60,
      burst: 120,
      onEmit: (f) => emitted.push(f),
      now: () => 0,
      schedule: noopSchedule,
    });

    for (let i = 0; i < 120; i++) {
      limiter.submit(payload('node:status', { nodeId: `n${i}`, i }, i));
    }

    expect(emitted).toHaveLength(120);
    expect(limiter.metrics()).toEqual({ droppedFrames: 0, queueDepth: 0 });
  });

  test('burst of 200 same-node status frames produces <=120 outbound and droppedFrames > 0', () => {
    const emitted: SsePayload[] = [];
    const limiter = createRateLimiter({
      tokensPerSecond: 60,
      burst: 120,
      onEmit: (f) => emitted.push(f),
      // Freeze time inside the burst window — refills cannot disguise a saturation event.
      now: () => 0,
      schedule: noopSchedule,
    });

    // 200 frames sprayed in an instant; same (flowId, nodeId, node:status).
    for (let i = 0; i < 200; i++) {
      limiter.submit(payload('node:status', { nodeId: 'n1', seq: i }, i));
    }

    expect(emitted.length).toBeLessThanOrEqual(120);
    expect(limiter.metrics().droppedFrames).toBeGreaterThan(0);
    expect(limiter.metrics().queueDepth).toBe(1);
  });

  test('intermixed terminal events bypass the bucket and always emit immediately', () => {
    const emitted: SsePayload[] = [];
    const limiter = createRateLimiter({
      tokensPerSecond: 60,
      burst: 5,
      onEmit: (f) => emitted.push(f),
      now: () => 0,
      schedule: noopSchedule,
    });

    // Drain the burst so the bucket is empty.
    for (let i = 0; i < 5; i++) {
      limiter.submit(payload('node:status', { nodeId: 'n1', seq: i }, i));
    }
    expect(emitted).toHaveLength(5);

    // Next non-terminal queues with no token.
    limiter.submit(payload('node:status', { nodeId: 'n2', seq: 5 }, 5));
    expect(emitted).toHaveLength(5);
    expect(limiter.metrics().queueDepth).toBe(1);

    // A terminal arrives with no tokens — must still emit immediately.
    limiter.submit(payload('node:done', { nodeId: 'n3' }, 6));
    expect(emitted).toHaveLength(6);
    expect(emitted[5]?.t).toBe('node:done');
    expect(emitted[5]?.data).toMatchObject({ nodeId: 'n3' });

    // Another non-terminal still queues — but a node:error also passes through.
    limiter.submit(payload('node:error', { nodeId: 'n4' }, 7));
    expect(emitted).toHaveLength(7);
    expect(emitted[6]?.t).toBe('node:error');
  });

  test('same-node coalescing keeps the LATEST payload (by serial number)', () => {
    const emitted: SsePayload[] = [];
    const limiter = createRateLimiter({
      tokensPerSecond: 60,
      burst: 1,
      onEmit: (f) => emitted.push(f),
      now: () => 0,
      schedule: noopSchedule,
    });

    limiter.submit(payload('node:status', { nodeId: 'n1', seq: 0 }, 0));
    expect(emitted).toHaveLength(1);

    // Bucket empty: each of these replaces the queued one. seq=3 should win.
    limiter.submit(payload('node:status', { nodeId: 'n1', seq: 1 }, 1));
    limiter.submit(payload('node:status', { nodeId: 'n1', seq: 2 }, 2));
    limiter.submit(payload('node:status', { nodeId: 'n1', seq: 3 }, 3));

    expect(emitted).toHaveLength(1);
    expect(limiter.metrics().queueDepth).toBe(1);
    expect(limiter.metrics().droppedFrames).toBe(2);

    limiter.flush();
    expect(emitted).toHaveLength(2);
    expect((emitted[1]?.data as { seq: number }).seq).toBe(3);
    expect(limiter.metrics().queueDepth).toBe(0);
  });

  test('coalescing only applies to node:status with a string nodeId', () => {
    const emitted: SsePayload[] = [];
    const limiter = createRateLimiter({
      tokensPerSecond: 60,
      burst: 1,
      maxQueueDepth: 10,
      onEmit: (f) => emitted.push(f),
      now: () => 0,
      schedule: noopSchedule,
    });

    limiter.submit(payload('node:running', { nodeId: 'n1' }, 0));
    expect(emitted).toHaveLength(1);

    // node:running for same nodeId must NOT coalesce — they queue distinctly.
    limiter.submit(payload('node:running', { nodeId: 'n1' }, 1));
    limiter.submit(payload('node:running', { nodeId: 'n1' }, 2));
    expect(limiter.metrics().queueDepth).toBe(2);
    expect(limiter.metrics().droppedFrames).toBe(0);

    // node:status without a nodeId does NOT coalesce either.
    limiter.submit(payload('node:status', { step: 'x' }, 3));
    expect(limiter.metrics().queueDepth).toBe(3);
  });

  test('queue overflow drops the oldest pending non-terminal frame', () => {
    const emitted: SsePayload[] = [];
    const limiter = createRateLimiter({
      tokensPerSecond: 60,
      burst: 1,
      maxQueueDepth: 3,
      onEmit: (f) => emitted.push(f),
      now: () => 0,
      schedule: noopSchedule,
    });

    limiter.submit(payload('node:running', { nodeId: 'n0' }, 0));
    limiter.submit(payload('node:running', { nodeId: 'n1' }, 1));
    limiter.submit(payload('node:running', { nodeId: 'n2' }, 2));
    limiter.submit(payload('node:running', { nodeId: 'n3' }, 3));

    expect(emitted).toHaveLength(1);
    expect(limiter.metrics().queueDepth).toBe(3);
    expect(limiter.metrics().droppedFrames).toBe(0);

    // Overflow: oldest pending (n1) dropped, n4 enqueued.
    limiter.submit(payload('node:running', { nodeId: 'n4' }, 4));
    expect(limiter.metrics().queueDepth).toBe(3);
    expect(limiter.metrics().droppedFrames).toBe(1);

    limiter.flush();
    const nodeIds = emitted.map((f) => (f.data as { nodeId: string }).nodeId);
    expect(nodeIds).toEqual(['n0', 'n2', 'n3', 'n4']);
  });

  test('queued frames drain when scheduled timer fires after token refill', () => {
    const emitted: SsePayload[] = [];
    let nowMs = 0;
    const pending: { value: { ms: number; fn: () => void } | null } = { value: null };
    const limiter = createRateLimiter({
      tokensPerSecond: 60,
      burst: 1,
      onEmit: (f) => emitted.push(f),
      now: () => nowMs,
      schedule: (ms, fn) => {
        pending.value = { ms, fn };
        return () => {
          pending.value = null;
        };
      },
    });

    limiter.submit(payload('node:status', { nodeId: 'n1', seq: 0 }, 0));
    expect(emitted).toHaveLength(1);

    limiter.submit(payload('node:status', { nodeId: 'n1', seq: 1 }, 1));
    expect(emitted).toHaveLength(1);
    expect(pending.value).not.toBeNull();

    // Refill enough time for one token (~1/60 s = ~17ms).
    nowMs = 20;
    pending.value?.fn();
    expect(emitted).toHaveLength(2);
    expect((emitted[1]?.data as { seq: number }).seq).toBe(1);
    expect(limiter.metrics().queueDepth).toBe(0);
  });

  test('dispose clears queued frames and prevents further emits', () => {
    const emitted: SsePayload[] = [];
    const pending: { value: { ms: number; fn: () => void } | null } = { value: null };
    const limiter = createRateLimiter({
      tokensPerSecond: 60,
      burst: 1,
      onEmit: (f) => emitted.push(f),
      now: () => 0,
      schedule: (ms, fn) => {
        pending.value = { ms, fn };
        return () => {
          pending.value = null;
        };
      },
    });

    limiter.submit(payload('node:status', { nodeId: 'n1' }, 0));
    limiter.submit(payload('node:status', { nodeId: 'n2' }, 1));
    expect(emitted).toHaveLength(1);
    expect(limiter.metrics().queueDepth).toBe(1);

    limiter.dispose();
    expect(pending.value).toBeNull();
    expect(limiter.metrics().queueDepth).toBe(0);

    // No-ops after dispose.
    limiter.submit(payload('node:status', { nodeId: 'n3' }, 2));
    limiter.submit(payload('node:done', { nodeId: 'n4' }, 3));
    expect(emitted).toHaveLength(1);
  });

  test('flush drains all queued frames in order, regardless of tokens', () => {
    const emitted: SsePayload[] = [];
    const limiter = createRateLimiter({
      tokensPerSecond: 60,
      burst: 1,
      maxQueueDepth: 10,
      onEmit: (f) => emitted.push(f),
      now: () => 0,
      schedule: noopSchedule,
    });

    // Drain the burst, then queue 3 more frames.
    limiter.submit(payload('node:running', { nodeId: 'n0' }, 0));
    limiter.submit(payload('node:running', { nodeId: 'n1' }, 1));
    limiter.submit(payload('node:running', { nodeId: 'n2' }, 2));
    limiter.submit(payload('node:running', { nodeId: 'n3' }, 3));
    expect(emitted).toHaveLength(1);

    limiter.flush();
    expect(emitted.map((f) => (f.data as { nodeId: string }).nodeId)).toEqual([
      'n0',
      'n1',
      'n2',
      'n3',
    ]);
  });
});
