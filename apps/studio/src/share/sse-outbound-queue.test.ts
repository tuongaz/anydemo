/**
 * US-072 — Unit tests for the per-peer outbound SSE queue.
 *
 * Verifies the bounded-queue semantics in isolation from share.ts wiring:
 *   - Synchronous enqueue (producer never blocks on slow send).
 *   - Eviction policy: oldest non-terminal first; terminal evicts anything.
 *   - droppedFrames counter and lastSendMs measurement.
 *   - onResyncTriggered fires after threshold drops in the rolling window.
 *   - Dispose tears down the drain loop and clears metrics.
 */

import { describe, expect, it } from 'bun:test';
import type { SsePayload } from './sse-frame.ts';
import { createPeerSseQueue } from './sse-outbound-queue.ts';

const makePayload = (
  t: SsePayload['t'],
  seq: number,
  extras: Partial<Pick<SsePayload, 'flowId' | 'ts' | 'data'>> = {},
): SsePayload => ({
  t,
  flowId: extras.flowId ?? 'flow-a',
  ts: extras.ts ?? 0,
  data: extras.data ?? { nodeId: 'n1' },
  seq,
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('createPeerSseQueue (US-072)', () => {
  it('enqueue is synchronous — the producer never awaits the underlying send', async () => {
    const sendCalls: SsePayload[] = [];
    const queue = createPeerSseQueue({
      peerConnId: 'conn-1',
      send: async (p) => {
        await sleep(20);
        sendCalls.push(p);
      },
    });

    const t0 = Date.now();
    for (let i = 0; i < 50; i++) queue.enqueue(makePayload('node:status', i));
    const enqueueElapsed = Date.now() - t0;

    // 50 enqueues should finish in well under one send window (20ms).
    expect(enqueueElapsed).toBeLessThan(20);
    expect(queue.metrics().queueDepth).toBeGreaterThan(0);

    // Let the drain flush — 50 sends * 20ms is too slow for the test, so we
    // dispose mid-drain and only assert the synchronous-enqueue property.
    queue.dispose();
  });

  it('caps the queue at maxFrames and drops the oldest non-terminal on overflow', () => {
    const queue = createPeerSseQueue({
      peerConnId: 'conn-1',
      maxFrames: 4,
      // Never-resolving send so frames stay queued.
      send: () => new Promise<void>(() => {}),
    });

    // Burst 10 non-terminal frames. The drain pulls the FIRST one into an
    // in-flight await before subsequent enqueues run, so the queue holds
    // (10 - 1 in-flight) - dropped frames, capped at maxFrames=4.
    for (let i = 0; i < 10; i++) queue.enqueue(makePayload('node:status', i));

    const m = queue.metrics();
    expect(m.queueDepth).toBe(4);
    expect(m.droppedFrames).toBe(5);
    queue.dispose();
  });

  it('terminal frame on a full queue evicts the oldest entry regardless of type', () => {
    const queue = createPeerSseQueue({
      peerConnId: 'conn-1',
      maxFrames: 3,
      send: () => new Promise<void>(() => {}),
    });

    // 1st enqueue lands in-flight (drain shifts it before the next call).
    // Subsequent enqueues build the queue toward maxFrames=3; the 5th forces
    // an eviction even though everything is terminal.
    queue.enqueue(makePayload('node:done', 0)); // in-flight
    queue.enqueue(makePayload('node:done', 1));
    queue.enqueue(makePayload('node:done', 2));
    queue.enqueue(makePayload('node:done', 3));
    queue.enqueue(makePayload('node:done', 4)); // triggers eviction
    expect(queue.metrics().droppedFrames).toBeGreaterThanOrEqual(1);
    queue.dispose();
  });

  it('drops the new non-terminal when the queue is full of terminals', () => {
    const queue = createPeerSseQueue({
      peerConnId: 'conn-1',
      maxFrames: 2,
      send: () => new Promise<void>(() => {}),
    });

    queue.enqueue(makePayload('node:done', 0)); // in-flight
    queue.enqueue(makePayload('node:done', 1));
    queue.enqueue(makePayload('node:done', 2));
    // queue is now [done@1, done@2], in-flight is done@0; non-terminal new
    // should be dropped because no non-terminal exists to evict.
    queue.enqueue(makePayload('node:status', 3));
    const m = queue.metrics();
    expect(m.droppedFrames).toBe(1);
    expect(m.queueDepth).toBe(2);
    queue.dispose();
  });

  it('sends frames in FIFO order through the drain loop', async () => {
    const sent: SsePayload[] = [];
    const queue = createPeerSseQueue({
      peerConnId: 'conn-1',
      send: async (p) => {
        await sleep(2);
        sent.push(p);
      },
    });

    for (let i = 0; i < 5; i++) queue.enqueue(makePayload('node:status', i));
    await sleep(50);

    expect(sent.map((p) => p.seq)).toEqual([0, 1, 2, 3, 4]);
    queue.dispose();
  });

  it('records lastSendMs after each successful send', async () => {
    const queue = createPeerSseQueue({
      peerConnId: 'conn-1',
      send: async () => {
        await sleep(20);
      },
    });

    queue.enqueue(makePayload('node:status', 0));
    await sleep(60);
    const m = queue.metrics();
    expect(m.lastSendMs).not.toBeNull();
    expect(m.lastSendMs ?? 0).toBeGreaterThanOrEqual(10); // allow timer slop
    queue.dispose();
  });

  it('fires onResyncTriggered after threshold drops in the rolling window', () => {
    let resyncCount = 0;
    const queue = createPeerSseQueue({
      peerConnId: 'conn-1',
      maxFrames: 1,
      dropResyncThreshold: 5,
      dropResyncWindowMs: 60_000,
      send: () => new Promise<void>(() => {}),
      onResyncTriggered: () => {
        resyncCount += 1;
      },
    });

    // First enqueue is in-flight; subsequent enqueues each evict the queued
    // tail (since max=1) and drop. We need 6 drops to cross threshold (>5).
    for (let i = 0; i < 8; i++) queue.enqueue(makePayload('node:status', i));
    expect(resyncCount).toBeGreaterThanOrEqual(1);
    queue.dispose();
  });

  it('prunes old drop timestamps outside the rolling window', () => {
    let nowMs = 0;
    let resyncCount = 0;
    const queue = createPeerSseQueue({
      peerConnId: 'conn-1',
      maxFrames: 1,
      dropResyncThreshold: 3,
      dropResyncWindowMs: 1000,
      now: () => nowMs,
      send: () => new Promise<void>(() => {}),
      onResyncTriggered: () => {
        resyncCount += 1;
      },
    });

    // 3 drops at t=0 — below threshold.
    queue.enqueue(makePayload('node:status', 0)); // in-flight
    queue.enqueue(makePayload('node:status', 1));
    queue.enqueue(makePayload('node:status', 2)); // drop
    queue.enqueue(makePayload('node:status', 3)); // drop
    queue.enqueue(makePayload('node:status', 4)); // drop
    expect(resyncCount).toBe(0);

    // Advance past the window — old drops age out.
    nowMs = 2000;
    // Two more drops now — these alone are below threshold even though
    // lifetime droppedFrames > threshold.
    queue.enqueue(makePayload('node:status', 5)); // drop
    queue.enqueue(makePayload('node:status', 6)); // drop
    expect(resyncCount).toBe(0);

    // Two more — still 4 within the window, below threshold of 3? Actually 4
    // within is > 3 so should trigger here.
    queue.enqueue(makePayload('node:status', 7)); // drop
    queue.enqueue(makePayload('node:status', 8)); // drop
    expect(resyncCount).toBeGreaterThanOrEqual(1);
    queue.dispose();
  });

  it('dispose stops the drain loop and clears the queue', async () => {
    const sent: SsePayload[] = [];
    const queue = createPeerSseQueue({
      peerConnId: 'conn-1',
      send: async (p) => {
        await sleep(5);
        sent.push(p);
      },
    });

    for (let i = 0; i < 10; i++) queue.enqueue(makePayload('node:status', i));
    queue.dispose();
    await sleep(30);

    // After dispose, no further frames should be sent (at most one in-flight
    // may complete its iteration before the disposed check breaks the loop).
    expect(sent.length).toBeLessThanOrEqual(1);
    expect(queue.metrics().queueDepth).toBe(0);
  });

  it('enqueue is a no-op after dispose', () => {
    const queue = createPeerSseQueue({
      peerConnId: 'conn-1',
      send: () => new Promise<void>(() => {}),
    });
    queue.dispose();
    queue.enqueue(makePayload('node:status', 0));
    expect(queue.metrics().queueDepth).toBe(0);
    expect(queue.metrics().droppedFrames).toBe(0);
  });
});
