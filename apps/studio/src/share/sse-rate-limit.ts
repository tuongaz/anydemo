/**
 * Token-bucket rate limiter + per-(flowId, nodeId) coalescer for SSE bridge
 * frames. Sits between the SSE tap's event source and the relay broadcast so
 * a noisy `node:status` storm cannot saturate the relay or peer browsers.
 *
 * Semantics:
 * - Sustained rate `tokensPerSecond` (default 60) with bucket capacity
 *   `burst` (default 120). Each non-terminal frame consumes one token.
 * - Non-terminal frames that arrive with no tokens are queued. When a
 *   `node:status` frame for the same `(flowId, nodeId)` is already pending,
 *   the latest payload replaces the queued one (last-wins coalescing) and
 *   `droppedFrames` is incremented for the displaced payload.
 * - Terminal events (`node:done`, `node:error`) are NEVER coalesced or
 *   dropped — they bypass the bucket and emit immediately.
 * - When the queue exceeds `maxQueueDepth` (default = burst), the oldest
 *   pending non-terminal frame is dropped and `droppedFrames` is incremented.
 */

import type { SsePayload } from './sse-frame.ts';

const TERMINAL_TYPES: ReadonlySet<SsePayload['t']> = new Set(['node:done', 'node:error']);

export interface RateLimitOptions {
  /** Tokens added per second. Default 60. */
  tokensPerSecond?: number;
  /** Bucket capacity (burst size). Default 120. */
  burst?: number;
  /**
   * Max pending non-terminal frames in the queue. Default = `burst`.
   * Overflow drops the oldest pending frame.
   */
  maxQueueDepth?: number;
  /** Outbound emit callback (post-rate-limit). */
  onEmit: (frame: SsePayload) => void;
  /** Monotonic time source in milliseconds. Defaults to `performance.now()`. */
  now?: () => number;
  /**
   * Schedule `fn` to run after `ms` milliseconds, returning a cancel function.
   * Defaults to `setTimeout`. Injected in tests for deterministic draining.
   */
  schedule?: (ms: number, fn: () => void) => () => void;
}

export interface RateLimitMetrics {
  droppedFrames: number;
  queueDepth: number;
}

export interface RateLimiter {
  submit(frame: SsePayload): void;
  metrics(): RateLimitMetrics;
  /** Drain all queued frames immediately, ignoring tokens. */
  flush(): void;
  dispose(): void;
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function defaultSchedule(ms: number, fn: () => void): () => void {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
}

function coalesceKey(frame: SsePayload): string | null {
  if (frame.t !== 'node:status') return null;
  const data = frame.data;
  const nodeId =
    data && typeof data === 'object' ? (data as { nodeId?: unknown }).nodeId : undefined;
  if (typeof nodeId !== 'string' || nodeId.length === 0) return null;
  return `${frame.flowId}\x00${nodeId}`;
}

export function createRateLimiter(opts: RateLimitOptions): RateLimiter {
  const tokensPerSecond = Math.max(0.0001, opts.tokensPerSecond ?? 60);
  const burst = Math.max(1, opts.burst ?? 120);
  const maxQueueDepth = Math.max(1, opts.maxQueueDepth ?? burst);
  const now = opts.now ?? defaultNow;
  const schedule = opts.schedule ?? defaultSchedule;

  let tokens = burst;
  let lastRefill = now();
  let droppedFrames = 0;
  let drainCancel: (() => void) | null = null;
  let disposed = false;

  const queue: SsePayload[] = [];
  /** coalesceKey -> queue index */
  const queueIndex = new Map<string, number>();

  function safeEmit(frame: SsePayload): void {
    try {
      opts.onEmit(frame);
    } catch (err) {
      console.error('[sse-rate-limit] onEmit listener threw:', err);
    }
  }

  function refill(): void {
    const t = now();
    const dt = (t - lastRefill) / 1000;
    if (dt <= 0) return;
    tokens = Math.min(burst, tokens + dt * tokensPerSecond);
    lastRefill = t;
  }

  function rebuildIndex(): void {
    queueIndex.clear();
    for (let i = 0; i < queue.length; i++) {
      const frame = queue[i];
      if (!frame) continue;
      const k = coalesceKey(frame);
      if (k !== null) queueIndex.set(k, i);
    }
  }

  function clearDrainTimer(): void {
    if (drainCancel) {
      drainCancel();
      drainCancel = null;
    }
  }

  function scheduleDrain(): void {
    if (disposed || queue.length === 0 || drainCancel) return;
    refill();
    const needed = Math.max(0, 1 - tokens);
    const waitMs = Math.ceil((needed / tokensPerSecond) * 1000);
    drainCancel = schedule(Math.max(1, waitMs), () => {
      drainCancel = null;
      drainQueue();
    });
  }

  function drainQueue(): void {
    refill();
    while (queue.length > 0 && tokens >= 1) {
      const frame = queue.shift();
      if (!frame) break;
      tokens -= 1;
      safeEmit(frame);
    }
    rebuildIndex();
    scheduleDrain();
  }

  function enqueueNonTerminal(frame: SsePayload): void {
    const key = coalesceKey(frame);
    if (key !== null) {
      const idx = queueIndex.get(key);
      if (idx !== undefined && idx < queue.length && queue[idx] !== undefined) {
        // Last-wins: replace the queued payload; older payload is "dropped".
        queue[idx] = frame;
        droppedFrames += 1;
        return;
      }
    }
    if (queue.length >= maxQueueDepth) {
      queue.shift();
      droppedFrames += 1;
      rebuildIndex();
    }
    const newIdx = queue.length;
    queue.push(frame);
    if (key !== null) queueIndex.set(key, newIdx);
  }

  return {
    submit(frame) {
      if (disposed) return;

      if (TERMINAL_TYPES.has(frame.t)) {
        safeEmit(frame);
        return;
      }

      refill();
      if (queue.length === 0 && tokens >= 1) {
        tokens -= 1;
        safeEmit(frame);
        return;
      }

      enqueueNonTerminal(frame);
      scheduleDrain();
    },
    metrics() {
      return { droppedFrames, queueDepth: queue.length };
    },
    flush() {
      for (const frame of queue) safeEmit(frame);
      queue.length = 0;
      queueIndex.clear();
      clearDrainTimer();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearDrainTimer();
      queue.length = 0;
      queueIndex.clear();
    },
  };
}
