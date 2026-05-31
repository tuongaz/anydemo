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
  'sse-snapshot',
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

// File frame payload schemas. Vendored copy of the cloud relay's per-type
// schemas (`cloud/lambda/share/shared/envelope.ts`) so the host can validate
// inbound file-request frames and shape outbound file-bytes / file-redirect /
// file-upload-intent / file-upload-done / files-manifest replies with the same
// invariants the relay enforces. Keep these aligned with the cloud copy.
const NodeIdSchema = z.string().regex(/^node-[A-Za-z0-9]{10}$/);
const Sha256HexSchema = z.string().length(64);

export const FileRequestPayloadSchema = z.object({
  reqId: z.string().min(1),
  nodeId: z.string(),
  relPath: z.string(),
});
export type FileRequestPayload = z.infer<typeof FileRequestPayloadSchema>;

export const FileBytesPayloadSchema = z.object({
  reqId: z.string(),
  seq: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  base64: z.string(),
  contentType: z.string().optional(),
  sha256: z.string(),
  eof: z.boolean(),
});
export type FileBytesPayload = z.infer<typeof FileBytesPayloadSchema>;

export const FileRedirectPayloadSchema = z.object({
  reqId: z.string(),
  getUrl: z.string().url(),
  sha256: z.string(),
  expiresAt: z.number().int().nonnegative(),
});
export type FileRedirectPayload = z.infer<typeof FileRedirectPayloadSchema>;

// Host-serve variant: the host asks the relay to mint a presigned PUT so it
// can stream a >256 KB file via S3 instead of inline WS chunks. `role` is set
// to `'host-serve'` to distinguish from peer-originated uploads (US-061).
export const FileUploadIntentPayloadSchema = z.object({
  reqId: z.string(),
  filename: z.string().min(1).max(255),
  size: z.number().int().nonnegative().max(1_073_741_824),
  contentType: z.string(),
  nodeId: NodeIdSchema,
  sha256: Sha256HexSchema,
  role: z.enum(['host-serve', 'peer-upload']).optional(),
});
export type FileUploadIntentPayload = z.infer<typeof FileUploadIntentPayloadSchema>;

export const FileUploadDonePayloadSchema = z.object({
  reqId: z.string(),
  key: z.string(),
  sha256: z.string(),
});
export type FileUploadDonePayload = z.infer<typeof FileUploadDonePayloadSchema>;

export const FilesManifestEntrySchema = z.object({
  nodeId: z.string(),
  relPath: z.string(),
  size: z.number().int().nonnegative(),
  etag: z.string(),
});
export type FilesManifestEntry = z.infer<typeof FilesManifestEntrySchema>;

export const FilesManifestPayloadSchema = z.object({
  entries: z.array(FilesManifestEntrySchema),
});
export type FilesManifestPayload = z.infer<typeof FilesManifestPayloadSchema>;

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
