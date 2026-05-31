/**
 * SSE tap: subscribes to the local EventBus for every flowId in the shared
 * project, mirrors each bridged event into a per-flow ring buffer, and feeds
 * the relay bridge via `onEvent`. A process-wide monotonic `seq` counter is
 * stamped on every payload so peers can detect drops and out-of-order frames.
 *
 * Used by `apps/studio/src/share.ts` (US-067) to forward live runtime events
 * to connected peers, and exposes a `snapshot()` of last-seen status per node
 * so newly joined peers can be primed without replaying the entire buffer
 * (US-069 / US-070).
 */

import type { EventBus, StudioEvent } from '../events.ts';
import { type SsePayload, isSseEventType } from './sse-frame.ts';

export interface SseTapOptions {
  /** Called on every refresh to compute the desired subscription set. */
  flowIds: () => string[];
  /** Invoked synchronously with each bridged event's payload. */
  onEvent: (frame: SsePayload) => void;
  /** Per-flow ring-buffer cap; defaults to 50. */
  bufferSize?: number;
}

export interface SseTap {
  start(): void;
  stop(): void;
  /** Re-syncs the subscription set against `opts.flowIds()`. Idempotent. */
  refreshFlows(): void;
  /**
   * Latest per-node status payload, grouped by flow. Only carries node-level
   * event types (`node:running`/`node:done`/`node:error`/`node:status`).
   */
  snapshot(): Record<string, Record<string, SsePayload>>;
}

const DEFAULT_BUFFER_SIZE = 50;

const NODE_STATUS_TYPES: ReadonlySet<SsePayload['t']> = new Set([
  'node:running',
  'node:done',
  'node:error',
  'node:status',
]);

function extractNodeId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = (payload as { nodeId?: unknown }).nodeId;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

export function createSseTap(events: EventBus, opts: SseTapOptions): SseTap {
  const bufferSize = Math.max(1, opts.bufferSize ?? DEFAULT_BUFFER_SIZE);
  let seqCounter = 0;
  let started = false;

  const unsubs = new Map<string, () => void>();
  const buffers = new Map<string, SsePayload[]>();
  const latestByNode = new Map<string, Map<string, SsePayload>>();

  function pushToBuffer(flowId: string, payload: SsePayload): void {
    let buf = buffers.get(flowId);
    if (!buf) {
      buf = [];
      buffers.set(flowId, buf);
    }
    buf.push(payload);
    if (buf.length > bufferSize) buf.shift();
  }

  function recordLatestStatus(flowId: string, payload: SsePayload): void {
    if (!NODE_STATUS_TYPES.has(payload.t)) return;
    const nodeId = extractNodeId(payload.data);
    if (!nodeId) return;
    let nodeMap = latestByNode.get(flowId);
    if (!nodeMap) {
      nodeMap = new Map();
      latestByNode.set(flowId, nodeMap);
    }
    nodeMap.set(nodeId, payload);
  }

  function makeSubscriber(flowId: string) {
    return (event: StudioEvent): void => {
      if (!isSseEventType(event.type)) return;
      const payload: SsePayload = {
        t: event.type,
        flowId: event.flowId,
        ts: event.ts,
        data: event.payload,
        seq: seqCounter++,
      };
      pushToBuffer(flowId, payload);
      recordLatestStatus(flowId, payload);
      try {
        opts.onEvent(payload);
      } catch (err) {
        console.error('[sse-tap] onEvent listener threw:', err);
      }
    };
  }

  function subscribeFlow(flowId: string): void {
    if (unsubs.has(flowId)) return;
    const off = events.subscribe(flowId, makeSubscriber(flowId));
    unsubs.set(flowId, off);
  }

  function unsubscribeFlow(flowId: string): void {
    const off = unsubs.get(flowId);
    if (!off) return;
    off();
    unsubs.delete(flowId);
    buffers.delete(flowId);
    latestByNode.delete(flowId);
  }

  function syncSubscriptions(): void {
    const desired = new Set(opts.flowIds());
    for (const existing of [...unsubs.keys()]) {
      if (!desired.has(existing)) unsubscribeFlow(existing);
    }
    for (const id of desired) subscribeFlow(id);
  }

  return {
    start(): void {
      if (started) return;
      started = true;
      syncSubscriptions();
    },
    stop(): void {
      if (!started) return;
      started = false;
      for (const off of unsubs.values()) off();
      unsubs.clear();
      buffers.clear();
      latestByNode.clear();
    },
    refreshFlows(): void {
      if (!started) return;
      syncSubscriptions();
    },
    snapshot(): Record<string, Record<string, SsePayload>> {
      const out: Record<string, Record<string, SsePayload>> = {};
      for (const [flowId, nodeMap] of latestByNode) {
        const nodes: Record<string, SsePayload> = {};
        for (const [nodeId, payload] of nodeMap) {
          nodes[nodeId] = payload;
        }
        out[flowId] = nodes;
      }
      return out;
    },
  };
}
