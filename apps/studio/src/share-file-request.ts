/**
 * Host-side `file-request` handler. The relay routes inbound `file-request`
 * envelopes (peer -> host) here; the handler either responds inline with a
 * single `file-bytes` frame (<=256 KB) or stages the file in the relay's
 * ephemeral S3 bucket via `file-upload-intent` and replies with a
 * `file-redirect` URL.
 *
 * Design choice: S3 staging is preferred over multi-chunk WS streaming for
 * oversize files because the relay rate-limits `file-bytes` at 5 MB / 60 s per
 * peer (US-058); large assets would otherwise stall. Staged objects live for
 * <=60 s (the staging bucket has a 1-day lifecycle but presigned URLs expire
 * in 60 s) so bytes never persist past the read.
 *
 * Errors reply with both a sentinel `file-bytes { eof:true, sha256:'' }` so
 * the peer's `/files/<path>` proxy can return 4xx, AND an `rpc-result
 * { id:reqId, ok:false, reason }` so peer rpc callers see a structured error.
 *
 * Rate-limit: at most 30 concurrent in-flight file-requests per peer; excess
 * are rejected immediately with `reason: 'too-many-in-flight'`.
 */

import { createHash } from 'node:crypto';
import * as fsPromises from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { FlowEntry, Registry } from './registry.ts';
import {
  type Envelope,
  type FileBytesPayload,
  type FileRedirectPayload,
  FileRequestPayloadSchema,
  type FileUploadIntentPayload,
  makeEnvelope,
} from './share-envelope.ts';
import { resolveNodeFile } from './share-file-resolver.ts';

const INLINE_LIMIT_BYTES = 256 * 1024;
// Chunk size for the WS-streaming fallback (used when S3 staging is absent).
// Match the inline single-frame budget so the same MTU shape lands on the wire
// either way; the peer's reassembler is size-agnostic.
const FILE_CHUNK_BYTES = 256 * 1024;
// Hard cap on chunked-WS file serving — keeps a single oversize asset from
// dominating the per-peer queue when S3 isn't available. Above this size,
// host returns 'too-large' so the user uploads via a normal HTTP path.
const MAX_WS_BYTES = 10 * 1024 * 1024;
const MAX_INFLIGHT_PER_PEER = 30;

// Extension -> content type allowlist. Anything not in the map falls back to
// `application/octet-stream`. Lowercased keys; we lowercase the extension at
// lookup so `.PNG` resolves the same as `.png`.
const CONTENT_TYPE_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
};

export function contentTypeFor(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return CONTENT_TYPE_MAP[ext] ?? 'application/octet-stream';
}

export interface UploadIntentReply {
  // `getUrl`+`expiresAt` are returned alongside `putUrl` so the host can
  // immediately reply with `file-redirect` after the PUT succeeds. The cloud
  // relay currently embeds only `putUrl` (US-058); the wiring layer is
  // responsible for materialising matching getUrl/expiresAt either by
  // re-using the staging key with a second presigner call or by extending the
  // relay reply. Tests inject this dep wholesale.
  putUrl: string;
  getUrl: string;
  expiresAt: number;
  key: string;
}

export type RequestUploadIntent = (payload: {
  reqId: string;
  filename: string;
  size: number;
  contentType: string;
  sha256: string;
  nodeId: string;
  role: 'host-serve';
}) => Promise<UploadIntentReply>;

export type PutToS3 = (
  url: string,
  bytes: Buffer,
  contentType: string,
) => Promise<{ ok: boolean; status: number }>;

export interface FileRequestDeps {
  registry: Registry;
  // Sends outbound envelopes through the active transport. Defaults wire to
  // share.ts's existing `broadcast` closure when integrated.
  broadcast: (envelope: Envelope) => void;
  // S3 staging path. Both deps must be provided to enable the oversize path;
  // if either is absent, oversize requests reply with `reason: 'too-large'`
  // and the peer falls back to a 413.
  requestUploadIntent?: RequestUploadIntent;
  putToS3?: PutToS3;
  // Test overrides — production callers leave these on the node:fs defaults.
  readFile?: (p: string) => Promise<Buffer>;
  fileExists?: (p: string) => Promise<boolean>;
}

export interface FileRequestHandler {
  handle(envelope: Envelope): Promise<void>;
  // Exposed for tests so they can assert the in-flight counter is released
  // after each request settles.
  inflightCount(peerConnId: string): number;
}

const defaultFileExists = async (p: string): Promise<boolean> => {
  try {
    const s = await fsPromises.stat(p);
    return s.isFile();
  } catch {
    return false;
  }
};

const defaultReadFile = (p: string): Promise<Buffer> => fsPromises.readFile(p) as Promise<Buffer>;

// Iterate all registered flow entries and return the first whose resolved
// per-node path exists on disk. nodeIds are globally unique (10-char base62
// shortIds) so collisions across flows are astronomically unlikely; the
// existence probe disambiguates if it ever happens.
type LocateResult =
  | { kind: 'ok'; entry: FlowEntry; absPath: string }
  | { kind: 'bad-node-id' }
  | { kind: 'traversal' }
  | { kind: 'not-found' };

async function locateNodeFile(
  registry: Registry,
  nodeId: string,
  relPath: string,
  fileExists: (p: string) => Promise<boolean>,
): Promise<LocateResult> {
  const entries = registry.list();
  if (entries.length === 0) return { kind: 'not-found' };

  // Run the resolver against the first entry to surface the static-shape
  // errors (bad nodeId / traversal). These depend only on nodeId+relPath, so
  // any registry entry yields the same verdict.
  const first = entries[0];
  if (first) {
    const r = resolveNodeFile({
      repoPath: first.repoPath,
      flowPath: first.flowPath,
      nodeId,
      relPath,
    });
    if ('error' in r) {
      if (r.error === 'bad-node-id') return { kind: 'bad-node-id' };
      return { kind: 'traversal' };
    }
  }

  for (const entry of entries) {
    const r = resolveNodeFile({
      repoPath: entry.repoPath,
      flowPath: entry.flowPath,
      nodeId,
      relPath,
    });
    if ('error' in r) continue;
    if (await fileExists(r.absPath)) {
      return { kind: 'ok', entry, absPath: r.absPath };
    }
  }
  return { kind: 'not-found' };
}

export function createFileRequestHandler(deps: FileRequestDeps): FileRequestHandler {
  const readFile = deps.readFile ?? defaultReadFile;
  const fileExists = deps.fileExists ?? defaultFileExists;
  const inflightPerPeer = new Map<string, number>();

  const sendErrorReply = (replyTo: string, reqId: string, reason: string) => {
    // Send the sentinel file-bytes so the peer's /files proxy returns 4xx,
    // then the structured rpc-result with the actual reason. Order matters
    // for the peer-side state machine in US-063 (proxy resolves on the
    // file-bytes sentinel, rpc callers resolve on the rpc-result).
    const sentinel: FileBytesPayload = {
      reqId,
      seq: 0,
      total: 0,
      base64: '',
      sha256: '',
      eof: true,
    };
    deps.broadcast(makeEnvelope('file-bytes', sentinel, { to: replyTo }));
    deps.broadcast(makeEnvelope('rpc-result', { ok: false, reason }, { to: replyTo, id: reqId }));
  };

  const respondInline = (
    replyTo: string,
    reqId: string,
    bytes: Buffer,
    contentType: string,
    sha256: string,
  ) => {
    const payload: FileBytesPayload = {
      reqId,
      seq: 0,
      total: 1,
      base64: bytes.toString('base64'),
      contentType,
      sha256,
      eof: true,
    };
    deps.broadcast(makeEnvelope('file-bytes', payload, { to: replyTo }));
  };

  // Chunked WS fallback for files larger than INLINE_LIMIT_BYTES when S3 staging
  // is not configured. The peer's `handleFileBytesIn` already reassembles by
  // (seq, total, eof) and verifies the final sha256 against the assembled bytes,
  // so each chunk repeats the same sha256 (it describes the whole file). Used
  // by self-hosted deployments + local studios where the relay can't mint a
  // presigned PUT.
  const respondChunked = (
    replyTo: string,
    reqId: string,
    bytes: Buffer,
    contentType: string,
    sha256: string,
  ) => {
    const total = Math.max(1, Math.ceil(bytes.length / FILE_CHUNK_BYTES));
    for (let seq = 0; seq < total; seq++) {
      const start = seq * FILE_CHUNK_BYTES;
      const end = Math.min(start + FILE_CHUNK_BYTES, bytes.length);
      const chunk = bytes.subarray(start, end);
      const payload: FileBytesPayload = {
        reqId,
        seq,
        total,
        base64: chunk.toString('base64'),
        contentType,
        sha256,
        eof: seq === total - 1,
      };
      deps.broadcast(makeEnvelope('file-bytes', payload, { to: replyTo }));
    }
  };

  const respondRedirect = (
    replyTo: string,
    reqId: string,
    intent: UploadIntentReply,
    sha256: string,
  ) => {
    const payload: FileRedirectPayload = {
      reqId,
      getUrl: intent.getUrl,
      sha256,
      expiresAt: intent.expiresAt,
    };
    deps.broadcast(makeEnvelope('file-redirect', payload, { to: replyTo }));
  };

  const handle = async (envelope: Envelope): Promise<void> => {
    const replyTo = envelope.from;
    const parsed = FileRequestPayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) {
      // We can't address the rpc-result without a reqId. Pull a best-effort id
      // from the raw payload (relay never inspects it, so anything goes) and
      // fall back to a literal `'invalid'` so the wire schema's min(1) holds.
      const rawReqId =
        envelope.payload &&
        typeof envelope.payload === 'object' &&
        'reqId' in envelope.payload &&
        typeof (envelope.payload as { reqId?: unknown }).reqId === 'string' &&
        (envelope.payload as { reqId: string }).reqId.length > 0
          ? (envelope.payload as { reqId: string }).reqId
          : 'invalid';
      sendErrorReply(replyTo, rawReqId, 'bad-payload');
      return;
    }
    const { reqId, nodeId, relPath } = parsed.data;

    const current = inflightPerPeer.get(replyTo) ?? 0;
    if (current >= MAX_INFLIGHT_PER_PEER) {
      sendErrorReply(replyTo, reqId, 'too-many-in-flight');
      return;
    }
    inflightPerPeer.set(replyTo, current + 1);

    try {
      const located = await locateNodeFile(deps.registry, nodeId, relPath, fileExists);
      if (located.kind === 'bad-node-id') {
        sendErrorReply(replyTo, reqId, 'bad-node-id');
        return;
      }
      if (located.kind === 'traversal') {
        sendErrorReply(replyTo, reqId, 'traversal');
        return;
      }
      if (located.kind === 'not-found') {
        sendErrorReply(replyTo, reqId, 'not-found');
        return;
      }

      let bytes: Buffer;
      try {
        bytes = await readFile(located.absPath);
      } catch (err) {
        console.warn('[share] file-request read failed:', {
          nodeId,
          reason: err instanceof Error ? err.message : String(err),
        });
        sendErrorReply(replyTo, reqId, 'read-failed');
        return;
      }

      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const filename = basename(located.absPath);
      const contentType = contentTypeFor(filename);

      if (bytes.length <= INLINE_LIMIT_BYTES) {
        respondInline(replyTo, reqId, bytes, contentType, sha256);
        return;
      }

      // Oversize path: prefer S3 redirect when staging is wired (avoids
      // base64-over-WS overhead). Fall back to chunked WS frames for
      // self-hosted / local studios that lack S3 — capped at MAX_WS_BYTES so
      // a giant asset doesn't pin the relay's per-peer queue.
      if (!deps.requestUploadIntent || !deps.putToS3) {
        if (bytes.length > MAX_WS_BYTES) {
          sendErrorReply(replyTo, reqId, 'too-large');
          return;
        }
        respondChunked(replyTo, reqId, bytes, contentType, sha256);
        return;
      }
      const intentPayload: FileUploadIntentPayload = {
        reqId,
        filename,
        size: bytes.length,
        contentType,
        sha256,
        nodeId,
        role: 'host-serve',
      };
      let intent: UploadIntentReply;
      try {
        intent = await deps.requestUploadIntent({
          reqId: intentPayload.reqId,
          filename: intentPayload.filename,
          size: intentPayload.size,
          contentType: intentPayload.contentType,
          sha256: intentPayload.sha256,
          nodeId: intentPayload.nodeId,
          role: 'host-serve',
        });
      } catch (err) {
        console.warn('[share] file-request intent failed:', {
          nodeId,
          reason: err instanceof Error ? err.message : String(err),
        });
        sendErrorReply(replyTo, reqId, 'intent-failed');
        return;
      }
      let putResult: { ok: boolean; status: number };
      try {
        putResult = await deps.putToS3(intent.putUrl, bytes, contentType);
      } catch (err) {
        console.warn('[share] file-request s3 put threw:', {
          nodeId,
          reason: err instanceof Error ? err.message : String(err),
        });
        sendErrorReply(replyTo, reqId, 'put-failed');
        return;
      }
      if (!putResult.ok) {
        sendErrorReply(replyTo, reqId, `put-status-${putResult.status}`);
        return;
      }
      respondRedirect(replyTo, reqId, intent, sha256);
    } finally {
      const next = (inflightPerPeer.get(replyTo) ?? 1) - 1;
      if (next <= 0) inflightPerPeer.delete(replyTo);
      else inflightPerPeer.set(replyTo, next);
    }
  };

  return {
    handle,
    inflightCount: (peerConnId) => inflightPerPeer.get(peerConnId) ?? 0,
  };
}
