/**
 * US-072 — Per-peer outbound SSE queue with drop-on-slow-consumer.
 *
 * A bounded async queue, one instance per connected peer, that decouples the
 * host's SSE bridge (synchronous EventBus -> tap -> per-peer enqueue) from the
 * relay WebSocket's send path. If a peer's drain is slow, frames accumulate up
 * to `maxFrames` (default 256). On overflow:
 *
 *   - Non-terminal new frame: evict the OLDEST non-terminal entry. If no
 *     non-terminal entries exist (queue full of terminals), drop the new one.
 *   - Terminal new frame (`node:done` / `node:error`): evict the OLDEST entry
 *     regardless of type so the terminal is always queued.
 *
 * Per-peer metrics (`queueDepth`, `droppedFrames`, `lastSendMs`) are surfaced
 * to the LiveShareDialog via the local `/api/share/state` SSE stream. When the
 * rolling 60s drop count exceeds 100, the queue fires `onResyncTriggered` so
 * the host can emit an `sse-snapshot` to recover the peer's canvas state.
 *
 * Enqueue is synchronous and non-blocking; the producer (the SSE tap) never
 * awaits the WebSocket send. The drain runs as a single concurrent async loop
 * — at most one in-flight send per peer keeps frame ordering stable while
 * still letting different peers' queues drain in parallel.
 */

import type { SsePayload } from './sse-frame.ts';

const TERMINAL_TYPES = new Set<SsePayload['t']>(['node:done', 'node:error']);

export const DEFAULT_MAX_FRAMES = 256;
export const DEFAULT_DROP_RESYNC_THRESHOLD = 100;
export const DEFAULT_DROP_RESYNC_WINDOW_MS = 60_000;

const isTerminalPayload = (p: SsePayload): boolean => TERMINAL_TYPES.has(p.t);

export interface PeerSseQueueMetrics {
  /** Frames currently waiting to be sent (excludes the in-flight frame). */
  queueDepth: number;
  /** Lifetime count of frames evicted due to overflow. */
  droppedFrames: number;
  /** Duration in ms of the last awaited `send` call (null until first send). */
  lastSendMs: number | null;
}

export interface PeerSseQueueOpts {
  peerConnId: string;
  /**
   * Underlying send for the queue. Awaited per-frame so slow consumers create
   * backpressure here rather than in the producer. Resolves on success; any
   * error is swallowed (logged) so a single bad frame doesn't stall the drain.
   */
  send: (payload: SsePayload, peerConnId: string) => Promise<void> | void;
  /** Defaults to 256. */
  maxFrames?: number;
  /**
   * Called when `droppedFrames` within `dropResyncWindowMs` exceeds
   * `dropResyncThreshold`. The window counter is reset after firing so the
   * next trigger requires another full window of drops.
   */
  onResyncTriggered?: () => void;
  /** Defaults to 100. */
  dropResyncThreshold?: number;
  /** Defaults to 60_000. */
  dropResyncWindowMs?: number;
  /** Defaults to `Date.now`. */
  now?: () => number;
}

export interface PeerSseQueue {
  /** Synchronously enqueue. Returns void; never awaits the underlying send. */
  enqueue(payload: SsePayload): void;
  metrics(): PeerSseQueueMetrics;
  /** Stops the drain loop and discards pending frames. Idempotent. */
  dispose(): void;
}

interface QueuedFrame {
  payload: SsePayload;
  terminal: boolean;
}

export function createPeerSseQueue(opts: PeerSseQueueOpts): PeerSseQueue {
  const maxFrames = opts.maxFrames ?? DEFAULT_MAX_FRAMES;
  const dropThreshold = opts.dropResyncThreshold ?? DEFAULT_DROP_RESYNC_THRESHOLD;
  const dropWindowMs = opts.dropResyncWindowMs ?? DEFAULT_DROP_RESYNC_WINDOW_MS;
  const now = opts.now ?? Date.now;

  const queue: QueuedFrame[] = [];
  const dropTimestamps: number[] = [];
  let droppedFrames = 0;
  let lastSendMs: number | null = null;
  let disposed = false;
  let draining = false;

  const recordDrop = (): void => {
    droppedFrames += 1;
    const ts = now();
    dropTimestamps.push(ts);
    const cutoff = ts - dropWindowMs;
    while (dropTimestamps.length > 0 && (dropTimestamps[0] ?? 0) < cutoff) {
      dropTimestamps.shift();
    }
    if (dropTimestamps.length > dropThreshold) {
      dropTimestamps.length = 0;
      try {
        opts.onResyncTriggered?.();
      } catch (err) {
        console.warn('[share] sse-outbound onResyncTriggered threw:', err);
      }
    }
  };

  const drain = async (): Promise<void> => {
    if (draining || disposed) return;
    draining = true;
    try {
      while (queue.length > 0 && !disposed) {
        const frame = queue.shift();
        if (!frame) break;
        const start = now();
        try {
          await opts.send(frame.payload, opts.peerConnId);
        } catch (err) {
          console.warn('[share] sse-outbound send failed:', err);
        }
        lastSendMs = now() - start;
      }
    } finally {
      draining = false;
    }
  };

  const enqueue = (payload: SsePayload): void => {
    if (disposed) return;
    const terminal = isTerminalPayload(payload);

    if (queue.length >= maxFrames) {
      if (terminal) {
        // Drop the oldest entry regardless of type so the terminal frame
        // always finds a slot — terminal-wins semantics drive the peer's
        // visual reconciliation back to a settled state.
        queue.shift();
        recordDrop();
      } else {
        const idx = queue.findIndex((f) => !f.terminal);
        if (idx === -1) {
          // Queue is full of terminals — drop the incoming non-terminal so
          // we don't displace a settled state with a stale running tick.
          recordDrop();
          return;
        }
        queue.splice(idx, 1);
        recordDrop();
      }
    }

    queue.push({ payload, terminal });
    void drain();
  };

  return {
    enqueue,
    metrics: (): PeerSseQueueMetrics => ({
      queueDepth: queue.length,
      droppedFrames,
      lastSendMs,
    }),
    dispose: (): void => {
      disposed = true;
      queue.length = 0;
      dropTimestamps.length = 0;
    },
  };
}
