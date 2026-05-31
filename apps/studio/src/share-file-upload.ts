/**
 * Host-side `file-upload-intent` / `file-bytes` / `file-upload-done` handler.
 *
 * Peer drops a file onto a node; the relay routes `file-upload-intent` to the
 * host (US-058 amends the intent with `payload.upload = { via, key?, putUrl? }`
 * so the host learns whether the peer will stream chunks over WS or PUT to
 * ephemeral S3). On accept, the host replies with an `rpc-result` carrying the
 * via decision back to the peer so the peer knows which transfer path to take.
 *
 * For the `via: 'ws'` path the peer follows up with one or more `file-bytes`
 * frames; the host appends to an in-flight buffer keyed by `reqId`, hashes
 * incrementally, and on `eof: true` verifies the assembled bytes against the
 * intent's `sha256`, writes atomically under the resolved per-node folder, and
 * broadcasts a `node-patched` diff.
 *
 * For the `via: 's3'` path the peer PUTs the bytes directly to the relay's
 * staging URL and then sends `file-upload-done`. The host fetches the
 * relay-presigned GET URL embedded on the done frame, verifies the sha256,
 * writes atomically, and acks the relay with `rpc-result { ok:true }` so the
 * relay can DeleteObject (US-058).
 *
 * Defense-in-depth: file-bytes are rate-limited per peer to 5 MB / 60 s (the
 * relay tracks the same window but the host re-enforces). Path safety is
 * delegated to `resolveNodeFile` — any traversal-equivalent filename is
 * rejected with `reason: 'path-invalid'` before bytes flow.
 */

import { type Hash, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import { writeFileAtomic } from './atomic-write.ts';
import type { Registry } from './registry.ts';
import type { FileUploadAuditEntry } from './share-audit.ts';
import {
  type Envelope,
  FileBytesPayloadSchema,
  FileUploadDonePayloadSchema,
  FileUploadIntentPayloadSchema,
  makeEnvelope,
} from './share-envelope.ts';
import { resolveNodeFile } from './share-file-resolver.ts';

export type { FileUploadAuditEntry } from './share-audit.ts';

const INLINE_LIMIT_BYTES = 256 * 1024;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const RATE_LIMIT_BYTES = 5 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;

// Mirrors `UPLOAD_ALLOWED_EXTS` in api.ts ~line 181. Drift here means a peer
// upload would accept an extension the canonical /nodes/.../files/upload
// endpoint refuses (or vice versa) — keep the sets identical.
const UPLOAD_ALLOWED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

const CONTENT_TYPE_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

const contentTypeForExt = (ext: string): string =>
  CONTENT_TYPE_MAP[ext.toLowerCase()] ?? 'application/octet-stream';

export type AppendFileUploadAudit = (sessionId: string, entry: FileUploadAuditEntry) => void;

export interface FileUploadDeps {
  registry: Registry;
  // Sends outbound envelopes; wired from share.ts's `broadcast` closure so
  // `to: 'all'` fan-out and direct `to: <connId>` replies share the transport.
  broadcast: (envelope: Envelope) => void;
  // Returns the active session id when the controller is in the `active`
  // state, otherwise null. The handler refuses to write when there is no
  // session (the relay shouldn't be routing frames in that case anyway).
  getSessionId: () => string | null;
  // Test seam: append a one-line JSONL entry to <auditDir>/<sessionId>.jsonl.
  // Defaults to a closure that calls `appendShareAudit`-style writes — but the
  // shape differs from `RpcAuditEntry` (no flowId/ok; uses op:'file-upload'),
  // so callers can also inject a recording stub.
  appendAudit?: AppendFileUploadAudit;
  // Test override: write bytes atomically. Defaults to `writeFileAtomic`.
  writeFile?: (absPath: string, bytes: Uint8Array) => void;
  // Test override: create the parent directory. Defaults to `mkdirSync(p, { recursive: true })`.
  ensureDir?: (dir: string) => void;
  // Test override: fetch the relay-presigned GET URL on the S3-done path.
  fetchFn?: typeof fetch;
  // Test override: monotonic clock for the rate-limit window.
  now?: () => number;
  // Resolve which `flowId` owns a given nodeId. Defaults to: iterate
  // registry.list() and take the first entry whose flowPath can produce a
  // valid resolveNodeFile() result for this nodeId. Tests can inject to
  // disambiguate multi-flow projects.
  flowIdForNode?: (nodeId: string) => string | null;
}

export interface PeerContext {
  peerId: string;
  displayName: string;
}

export interface FileUploadHandler {
  handleIntent(envelope: Envelope, peer: PeerContext): Promise<void>;
  handleBytes(envelope: Envelope, peer: PeerContext): Promise<void>;
  handleDone(envelope: Envelope, peer: PeerContext): Promise<void>;
  // Test helpers — assert in-flight state was released after each request settles.
  inflightCount(connId: string): number;
  windowBytes(connId: string): number;
}

interface InflightUpload {
  reqId: string;
  peerId: string;
  connId: string;
  absPath: string;
  filename: string;
  contentType: string;
  intentSha256: string;
  totalBytes: number;
  receivedBytes: number;
  chunks: Buffer[];
  hash: Hash;
  nodeId: string;
  flowId: string;
}

interface RateWindow {
  startMs: number;
  bytes: number;
}

const defaultEnsureDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true });
};

const defaultWriteFile = (absPath: string, bytes: Uint8Array): void => {
  writeFileAtomic(absPath, bytes);
};

const sendReply = (
  broadcast: (env: Envelope) => void,
  replyTo: string,
  reqId: string,
  payload: unknown,
): void => {
  broadcast(makeEnvelope('rpc-result', payload, { to: replyTo, id: reqId }));
};

const sendOk = (
  broadcast: (env: Envelope) => void,
  replyTo: string,
  reqId: string,
  result?: unknown,
): void => {
  const payload = result === undefined ? { ok: true as const } : { ok: true as const, result };
  sendReply(broadcast, replyTo, reqId, payload);
};

const sendError = (
  broadcast: (env: Envelope) => void,
  replyTo: string,
  reqId: string,
  reason: string,
): void => {
  sendReply(broadcast, replyTo, reqId, { ok: false as const, reason });
};

export function createFileUploadHandler(deps: FileUploadDeps): FileUploadHandler {
  const writeFile = deps.writeFile ?? defaultWriteFile;
  const ensureDir = deps.ensureDir ?? defaultEnsureDir;
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? Date.now;
  const flowIdForNode =
    deps.flowIdForNode ??
    ((nodeId: string): string | null => {
      for (const entry of deps.registry.list()) {
        const r = resolveNodeFile({
          repoPath: entry.repoPath,
          flowPath: entry.flowPath,
          nodeId,
          relPath: 'probe',
        });
        if (!('error' in r)) return entry.id;
      }
      return null;
    });

  // reqId -> in-flight upload state. Lives for the lifetime of a single
  // upload (intent -> chunks -> verified write, or intent -> done -> verified
  // write). Cleared on terminal outcome (success / mismatch / abandon).
  const inflight = new Map<string, InflightUpload>();
  // connId -> sliding 60 s file-bytes window. Reset (start a new window)
  // whenever the current window has aged past RATE_LIMIT_WINDOW_MS.
  const peerWindows = new Map<string, RateWindow>();

  const releaseInflight = (reqId: string) => {
    inflight.delete(reqId);
  };

  const audit = (sessionId: string, entry: FileUploadAuditEntry) => {
    if (!deps.appendAudit) return;
    try {
      deps.appendAudit(sessionId, entry);
    } catch (err) {
      console.warn('[share] file-upload audit append failed:', err);
    }
  };

  const broadcastNodePatched = (flowId: string, nodeId: string, relPathFromRepo: string): void => {
    deps.broadcast(
      makeEnvelope(
        'node-patched',
        {
          flowId,
          op: 'file-upload',
          diff: { nodeId, data: { path: relPathFromRepo } },
        },
        { to: 'all' },
      ),
    );
  };

  // Accumulate `chunkBytes` against the peer's window; return false if the
  // peer has exhausted the 5 MB / 60 s budget. Window resets when the elapsed
  // span exceeds `RATE_LIMIT_WINDOW_MS`.
  const consumeWindow = (connId: string, chunkBytes: number): boolean => {
    const t = now();
    const w = peerWindows.get(connId);
    if (!w || t - w.startMs > RATE_LIMIT_WINDOW_MS) {
      if (chunkBytes > RATE_LIMIT_BYTES) return false;
      peerWindows.set(connId, { startMs: t, bytes: chunkBytes });
      return true;
    }
    if (w.bytes + chunkBytes > RATE_LIMIT_BYTES) return false;
    w.bytes += chunkBytes;
    return true;
  };

  const handleIntent: FileUploadHandler['handleIntent'] = async (envelope, peer) => {
    const replyTo = envelope.from;
    const parsed = FileUploadIntentPayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) {
      const rawReqId =
        envelope.payload &&
        typeof envelope.payload === 'object' &&
        'reqId' in envelope.payload &&
        typeof (envelope.payload as { reqId?: unknown }).reqId === 'string' &&
        (envelope.payload as { reqId: string }).reqId.length > 0
          ? (envelope.payload as { reqId: string }).reqId
          : 'invalid';
      sendError(deps.broadcast, replyTo, rawReqId, 'bad-payload');
      return;
    }
    const payload = parsed.data;
    const { reqId, filename, size, nodeId, sha256 } = payload;

    // Host enforces the intent shape before any state mutation.
    if (size > MAX_UPLOAD_BYTES) {
      sendError(deps.broadcast, replyTo, reqId, 'too-large');
      auditReject(reqId, peer, nodeId, filename, size, sha256, 'too-large');
      return;
    }
    const ext = extname(filename).toLowerCase();
    if (!UPLOAD_ALLOWED_EXTS.has(ext)) {
      sendError(deps.broadcast, replyTo, reqId, 'extension-not-allowed');
      auditReject(reqId, peer, nodeId, filename, size, sha256, 'extension-not-allowed');
      return;
    }

    const flowId = flowIdForNode(nodeId);
    if (!flowId) {
      sendError(deps.broadcast, replyTo, reqId, 'node-not-found');
      auditReject(reqId, peer, nodeId, filename, size, sha256, 'node-not-found');
      return;
    }
    const entry = deps.registry.list().find((e) => e.id === flowId);
    if (!entry) {
      sendError(deps.broadcast, replyTo, reqId, 'node-not-found');
      auditReject(reqId, peer, nodeId, filename, size, sha256, 'node-not-found');
      return;
    }

    // Re-run the resolver against the chosen entry using the supplied filename.
    // resolveNodeFile rejects traversal-equivalent payloads (`../../foo.png`,
    // absolute paths, win32 drive letters) so a malicious peer can't escape
    // the per-node folder.
    const resolved = resolveNodeFile({
      repoPath: entry.repoPath,
      flowPath: entry.flowPath,
      nodeId,
      relPath: filename,
    });
    if ('error' in resolved) {
      sendError(deps.broadcast, replyTo, reqId, 'path-invalid');
      auditReject(reqId, peer, nodeId, filename, size, sha256, 'path-invalid');
      return;
    }

    // Materialise the relay's via decision so the peer knows which transfer
    // path to take. The relay (US-058) amends `payload.upload` before
    // forwarding the intent; absent that, default to ws so small uploads
    // still work in tests that don't model the relay's amendment. Read from
    // the raw `envelope.payload` because `FileUploadIntentPayloadSchema`
    // strips unknown keys, so the schema-parsed `payload` won't carry the
    // `upload` amendment.
    const rawPayload =
      envelope.payload && typeof envelope.payload === 'object'
        ? (envelope.payload as { upload?: { via?: 'ws' | 's3'; key?: string; putUrl?: string } })
        : {};
    const via = rawPayload.upload?.via ?? (size > INLINE_LIMIT_BYTES ? 's3' : 'ws');
    const result: { via: 'ws' | 's3'; key?: string; putUrl?: string } = { via };
    if (rawPayload.upload?.key !== undefined) result.key = rawPayload.upload.key;
    if (rawPayload.upload?.putUrl !== undefined) result.putUrl = rawPayload.upload.putUrl;

    const contentType = payload.contentType || contentTypeForExt(ext);
    inflight.set(reqId, {
      reqId,
      peerId: peer.peerId,
      connId: replyTo,
      absPath: resolved.absPath,
      filename,
      contentType,
      intentSha256: sha256,
      totalBytes: size,
      receivedBytes: 0,
      chunks: [],
      hash: createHash('sha256'),
      nodeId,
      flowId,
    });

    sendOk(deps.broadcast, replyTo, reqId, result);
  };

  const auditReject = (
    _reqId: string,
    peer: PeerContext,
    nodeId: string,
    filename: string,
    size: number,
    sha256: string,
    reason: string,
  ): void => {
    const sessionId = deps.getSessionId();
    if (!sessionId) return;
    audit(sessionId, {
      ts: now(),
      peerId: peer.peerId,
      op: 'file-upload',
      nodeId,
      filename,
      size,
      sha256,
      accept: false,
      reason,
    });
  };

  const writeAndBroadcast = (
    state: InflightUpload,
    bytes: Buffer,
    finalSha: string,
    peer: PeerContext,
  ): { ok: true } | { ok: false; reason: string } => {
    // Verify the chosen entry is still resolvable + the abs path is still
    // within bounds at write time. resolveNodeFile is cheap; doing it again
    // catches the (vanishingly rare) case where the registry mutated between
    // intent + verify.
    const entry = deps.registry.list().find((e) => e.id === state.flowId);
    if (!entry) return { ok: false, reason: 'node-not-found' };
    const reResolved = resolveNodeFile({
      repoPath: entry.repoPath,
      flowPath: entry.flowPath,
      nodeId: state.nodeId,
      relPath: state.filename,
    });
    if ('error' in reResolved || reResolved.absPath !== state.absPath) {
      return { ok: false, reason: 'path-invalid' };
    }

    try {
      ensureDir(dirname(state.absPath));
    } catch (err) {
      console.warn('[share] file-upload ensureDir failed:', err);
      return { ok: false, reason: 'write-failed' };
    }
    try {
      writeFile(state.absPath, bytes);
    } catch (err) {
      console.warn('[share] file-upload write failed:', err);
      return { ok: false, reason: 'write-failed' };
    }

    // PROJECT-ROOT-relative path mirrors the api.ts upload endpoint return
    // shape: legacy single-flow `flow.json` projects collapse `flowDir` to
    // `.`; manifest-driven projects include the flow folder prefix so the
    // peer's canvas can reference the asset by the same path it would have
    // used had the user uploaded via the HTTP endpoint.
    const flowDir = dirname(entry.flowPath);
    const relFromRepo =
      flowDir === '.'
        ? `nodes/${state.nodeId}/${state.filename}`
        : `${flowDir}/nodes/${state.nodeId}/${state.filename}`;
    broadcastNodePatched(state.flowId, state.nodeId, relFromRepo);

    const sessionId = deps.getSessionId();
    if (sessionId) {
      audit(sessionId, {
        ts: now(),
        peerId: peer.peerId,
        op: 'file-upload',
        nodeId: state.nodeId,
        filename: state.filename,
        size: bytes.length,
        sha256: finalSha,
        accept: true,
      });
    }
    return { ok: true };
  };

  const handleBytes: FileUploadHandler['handleBytes'] = async (envelope, peer) => {
    const replyTo = envelope.from;
    const parsed = FileBytesPayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) {
      console.warn('[share] file-bytes rejected: bad payload');
      return;
    }
    const payload = parsed.data;
    const state = inflight.get(payload.reqId);
    if (!state) {
      // No matching intent — drop. The peer can retry with a fresh intent.
      console.warn('[share] file-bytes dropped: no in-flight intent', { reqId: payload.reqId });
      return;
    }
    if (state.connId !== replyTo) {
      // Different connection trying to fulfil another peer's upload — drop.
      console.warn('[share] file-bytes dropped: peer mismatch');
      return;
    }

    // Base64 decode + size accumulate happen before the rate-limit check so
    // we know the exact byte budget the peer is asking to spend.
    let chunk: Buffer;
    try {
      chunk = Buffer.from(payload.base64, 'base64');
    } catch {
      sendError(deps.broadcast, replyTo, state.reqId, 'bad-payload');
      releaseInflight(state.reqId);
      return;
    }
    if (!consumeWindow(replyTo, chunk.length)) {
      sendError(deps.broadcast, replyTo, state.reqId, 'rate-limited');
      releaseInflight(state.reqId);
      return;
    }
    if (state.receivedBytes + chunk.length > state.totalBytes) {
      sendError(deps.broadcast, replyTo, state.reqId, 'oversize-chunk');
      releaseInflight(state.reqId);
      return;
    }
    state.chunks.push(chunk);
    state.hash.update(chunk);
    state.receivedBytes += chunk.length;
    if (!payload.eof) return;

    const finalBytes = Buffer.concat(state.chunks);
    const finalSha = state.hash.digest('hex');
    if (finalSha !== state.intentSha256) {
      sendError(deps.broadcast, replyTo, state.reqId, 'integrity');
      auditReject(
        state.reqId,
        peer,
        state.nodeId,
        state.filename,
        state.totalBytes,
        state.intentSha256,
        'integrity',
      );
      releaseInflight(state.reqId);
      return;
    }
    if (finalBytes.length !== state.totalBytes) {
      sendError(deps.broadcast, replyTo, state.reqId, 'integrity');
      releaseInflight(state.reqId);
      return;
    }

    const outcome = writeAndBroadcast(state, finalBytes, finalSha, peer);
    if (!outcome.ok) {
      sendError(deps.broadcast, replyTo, state.reqId, outcome.reason);
      releaseInflight(state.reqId);
      return;
    }
    sendOk(deps.broadcast, replyTo, state.reqId);
    releaseInflight(state.reqId);
  };

  const handleDone: FileUploadHandler['handleDone'] = async (envelope, peer) => {
    const replyTo = envelope.from;
    const parsed = FileUploadDonePayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) {
      console.warn('[share] file-upload-done rejected: bad payload');
      return;
    }
    const payload = parsed.data;
    const state = inflight.get(payload.reqId);
    if (!state) {
      console.warn('[share] file-upload-done dropped: no in-flight intent', {
        reqId: payload.reqId,
      });
      return;
    }
    if (state.connId !== replyTo) {
      console.warn('[share] file-upload-done dropped: peer mismatch');
      return;
    }

    // The relay (US-058) embeds the presigned GET URL alongside the existing
    // `payload.key + payload.sha256` so the host can fetch the staged bytes
    // without the peer ever streaming them through the WS. Read from raw
    // `envelope.payload` because `FileUploadDonePayloadSchema` strips unknown
    // keys.
    const rawPayload =
      envelope.payload && typeof envelope.payload === 'object'
        ? (envelope.payload as { getUrl?: string })
        : {};
    const getUrl = rawPayload.getUrl;
    if (!getUrl) {
      sendError(deps.broadcast, replyTo, state.reqId, 'missing-get-url');
      releaseInflight(state.reqId);
      return;
    }

    let bytes: Buffer;
    try {
      const res = await fetchFn(getUrl);
      if (!res.ok) {
        sendError(deps.broadcast, replyTo, state.reqId, `fetch-status-${res.status}`);
        releaseInflight(state.reqId);
        return;
      }
      const ab = await res.arrayBuffer();
      bytes = Buffer.from(ab);
    } catch (err) {
      console.warn('[share] file-upload-done fetch failed:', err);
      sendError(deps.broadcast, replyTo, state.reqId, 'fetch-failed');
      releaseInflight(state.reqId);
      return;
    }

    if (bytes.length !== state.totalBytes) {
      sendError(deps.broadcast, replyTo, state.reqId, 'integrity');
      releaseInflight(state.reqId);
      return;
    }
    const finalSha = createHash('sha256').update(bytes).digest('hex');
    if (finalSha !== state.intentSha256) {
      sendError(deps.broadcast, replyTo, state.reqId, 'integrity');
      auditReject(
        state.reqId,
        peer,
        state.nodeId,
        state.filename,
        state.totalBytes,
        state.intentSha256,
        'integrity',
      );
      releaseInflight(state.reqId);
      return;
    }

    const outcome = writeAndBroadcast(state, bytes, finalSha, peer);
    if (!outcome.ok) {
      sendError(deps.broadcast, replyTo, state.reqId, outcome.reason);
      releaseInflight(state.reqId);
      return;
    }
    sendOk(deps.broadcast, replyTo, state.reqId);
    releaseInflight(state.reqId);
  };

  return {
    handleIntent,
    handleBytes,
    handleDone,
    inflightCount: (connId) => {
      let n = 0;
      for (const v of inflight.values()) if (v.connId === connId) n++;
      return n;
    },
    windowBytes: (connId) => peerWindows.get(connId)?.bytes ?? 0,
  };
}
