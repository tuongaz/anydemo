/**
 * SSE bridge envelope payload schema for live-share `sse` frames.
 *
 * Single source of truth for the wire shape of runtime events relayed from
 * the host studio's local EventBus to peers over the share WebSocket. Both
 * sides parse against the same Zod schema; drift between this file and the
 * peer SPA's mirror (`seeflow-viewer/src/lib/share-sse-frame.ts`) is gated
 * by `apps/studio/scripts/check-sse-frame-sync.ts`.
 */

import { z } from 'zod';
import type { StudioEvent } from '../events.ts';

// SYNC-WITH-PEER:BEGIN
export const SSE_EVENT_TYPES = [
  'flow:reload',
  'node:running',
  'node:done',
  'node:error',
  'node:status',
] as const;

export const SseEventTypeSchema = z.enum(SSE_EVENT_TYPES);
export type SseEventType = z.infer<typeof SseEventTypeSchema>;

export const SsePayloadSchema = z.object({
  t: SseEventTypeSchema,
  flowId: z.string().min(1),
  ts: z.number().int().nonnegative(),
  data: z.unknown(),
  seq: z.number().int().nonnegative(),
});

export type SsePayload = z.infer<typeof SsePayloadSchema>;

export interface SseEnvelope {
  v: 1;
  type: 'sse';
  from: 'host';
  to: 'all';
  payload: SsePayload;
}

export function isSseEventType(t: string): t is SseEventType {
  return (SSE_EVENT_TYPES as readonly string[]).includes(t);
}

/**
 * Snapshot replay payload sent to a freshly-joined peer so its canvas badges
 * match the host without waiting for the next live tick. `flows` is a 2-level
 * map of flowId -> nodeId -> latest SsePayload observed by the host's tap.
 * When the serialized snapshot exceeds the 256 KB per-frame cap, the host
 * splits per-flow and stamps each frame with `chunk` (zero-based) + `total`
 * so the peer can reassemble before applying.
 */
export const SseSnapshotPayloadSchema = z.object({
  flows: z.record(z.string(), z.record(z.string(), SsePayloadSchema)),
  chunk: z.number().int().nonnegative().optional(),
  total: z.number().int().positive().optional(),
});

export type SseSnapshotPayload = z.infer<typeof SseSnapshotPayloadSchema>;
// SYNC-WITH-PEER:END

/**
 * Wrap a local StudioEvent into a relay-shaped `sse` envelope. Returns null
 * when the event type is not one of the SSE-bridged kinds (`file:changed`,
 * `registry:reload`) so callers can filter without try/catch.
 */
export function wrapAsSseFrame(event: StudioEvent, seq: number): SseEnvelope | null {
  if (!isSseEventType(event.type)) return null;
  return {
    v: 1,
    type: 'sse',
    from: 'host',
    to: 'all',
    payload: {
      t: event.type,
      flowId: event.flowId,
      ts: event.ts,
      data: event.payload,
      seq,
    },
  };
}
