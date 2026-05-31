/**
 * Live Share WebSocket envelope schema and helpers.
 *
 * Every frame on the relay wire — host->relay and relay->peer — is shaped
 * exactly like the design doc's envelope (v=1, typed `type`, optional `id`
 * for rpc correlation, `from` connId, optional `to`, opaque `payload`).
 * The relay is a dumb router and never inspects `payload`; validation
 * happens at the host (this module) and the peer canvas.
 *
 * `parseEnvelope` returns a discriminated `{ ok }` result so the transport
 * can drop invalid frames without throwing inside the WS read loop.
 * `makeEnvelope` constructs outbound frames with `from='host'` by default
 * so callers don't have to repeat it.
 */

import { z } from 'zod';

export const ENVELOPE_TYPES = [
  'auth-host',
  'auth-peer',
  'rpc',
  'rpc-result',
  'sse',
  'presence',
  'file-request',
  'file-bytes',
  'file-redirect',
  'file-upload-intent',
  'file-upload-done',
  'node-patched',
  'files-manifest',
  'kick',
] as const;

export const EnvelopeTypeSchema = z.enum(ENVELOPE_TYPES);

export const EnvelopeSchema = z.object({
  v: z.literal(1),
  type: EnvelopeTypeSchema,
  id: z.string().optional(),
  from: z.string(),
  to: z.string().optional(),
  payload: z.unknown(),
});

export type EnvelopeType = z.infer<typeof EnvelopeTypeSchema>;
export type Envelope = z.infer<typeof EnvelopeSchema>;

export function parseEnvelope(
  raw: unknown,
): { ok: true; envelope: Envelope } | { ok: false; reason: string } {
  const result = EnvelopeSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, envelope: result.data };
  }
  // Surface the first issue path/message so the transport's console.warn
  // is actionable without leaking the payload itself.
  const first = result.error.issues[0];
  const reason = first ? `${first.path.join('.') || '<root>'}: ${first.message}` : 'invalid';
  return { ok: false, reason };
}

export interface MakeEnvelopeOpts {
  id?: string;
  from?: string;
  to?: string;
}

export function makeEnvelope<T extends EnvelopeType>(
  type: T,
  payload: unknown,
  opts: MakeEnvelopeOpts = {},
): Envelope {
  const env: Envelope = {
    v: 1,
    type,
    from: opts.from ?? 'host',
    payload,
  };
  if (opts.id !== undefined) env.id = opts.id;
  if (opts.to !== undefined) env.to = opts.to;
  return env;
}
