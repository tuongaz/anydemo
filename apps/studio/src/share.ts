/**
 * Live Share controller. Owns the state machine for a host-side share session:
 * idle -> starting -> active -> stopping -> idle.
 *
 * This module is the local-API surface that the studio HTTP routes and toolbar
 * UI delegate to. start() drives the relay handshake (POST /api/share/sessions)
 * and boots a WebSocket transport; transport state events drive the controller
 * state machine. stop() tears the session down cleanly (and aborts a mid-boot
 * start), kick() sends a kick envelope to a peer, rotateUrl() stops + restarts
 * so an abused share link can be invalidated.
 *
 * `node-patched` broadcasts include the originator — peer SPAs reconcile their
 * optimistic state against the canonical diff; suppress reconcile-only
 * re-renders via the rpc-result `id` correlation in US-041.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from './atomic-write.ts';
import type { EventBus } from './events.ts';
import {
  ConnectorPatchBodySchema,
  FLOW_BULK_NON_EMPTY_MESSAGE,
  NodePatchBodySchema,
  type OperationsDeps,
  addConnectorImpl,
  addFlowBulkImpl,
  addNodeImpl,
  deleteConnectorImpl,
  deleteNodeImpl,
  flowBulkNonEmpty,
  moveNodeImpl,
  patchConnectorImpl,
  patchNodeImpl,
  reorderNodeImpl,
} from './operations.ts';
import {
  type AuditEntry,
  type AuditLog,
  type AuditLogOpts,
  type AuditLogger,
  type FrameAuditEntry,
  type RpcAuditEntry,
  appendShareAudit,
  createAuditLog,
  createAuditLogger,
} from './share-audit.ts';
import { type Envelope, makeEnvelope } from './share-envelope.ts';
import {
  type FileRequestHandler,
  type PutToS3,
  type RequestUploadIntent,
  createFileRequestHandler,
} from './share-file-request.ts';
import {
  type AppendFileUploadAudit,
  type FileUploadHandler,
  createFileUploadHandler,
} from './share-file-upload.ts';
import { type FilesManifestBuilder, createFilesManifestBuilder } from './share-files-manifest.ts';
import { type RateLimiter, createRateLimiter } from './share-ratelimit.ts';
import { RpcFrameSchema, type RpcOp, type RpcResultFrame } from './share-rpc-schema.ts';
import {
  type ShareTransport,
  type ShareTransportOpts,
  type ShareTransportState,
  createShareTransport,
} from './share-transport.ts';
import type { SsePayload, SseSnapshotPayload } from './share/sse-frame.ts';
import {
  type PeerSseQueue,
  type PeerSseQueueMetrics,
  createPeerSseQueue,
} from './share/sse-outbound-queue.ts';
import type { RateLimitOptions } from './share/sse-rate-limit.ts';
import { type SseTap, createSseTap } from './share/sse-tap.ts';

// Presence frame payloads. We validate `kind` against the base shape, then
// re-validate join/leave with their strict required fields so malformed
// join/leave frames are dropped rather than treated as sideband. Cursor,
// viewport, and any other future `kind` no-op in v1 per the design doc.
// Presence payload shapes accepted on the wire. The cloud relay uses
// `state: 'joined' | 'left' | 'active' | 'idle' | 'host-offline'`; older host
// builds emitted `kind: 'join' | 'leave'`. We accept either to stay
// forward/backward compatible.
const PresenceBaseSchema = z
  .object({
    kind: z.string().optional(),
    state: z.string().optional(),
  })
  .passthrough();
const PresenceJoinSchema = z
  .object({
    peerId: z.string(),
    displayName: z.string(),
    kind: z.literal('join').optional(),
    state: z.literal('joined').optional(),
  })
  .passthrough();
const PresenceLeaveSchema = z
  .object({
    peerId: z.string(),
    kind: z.literal('leave').optional(),
    state: z.literal('left').optional(),
  })
  .passthrough();

export interface PeerSummary {
  peerId: string;
  displayName: string;
  joinedAt: number;
  /**
   * Per-peer SSE outbound queue metrics surfaced for the LiveShareDialog's
   * "slow peer" warning (US-072). Absent when the peer has no SSE queue
   * (e.g. before the bridge has wired up, or when the session was started
   * without an `eventBus`).
   */
  outboundSse?: PeerSseQueueMetrics;
}

export type ShareState =
  | { status: 'idle' }
  | { status: 'starting' }
  | {
      status: 'active';
      sessionId: string;
      token: string;
      url: string;
      peers: PeerSummary[];
      startedAt: number;
      // Display label used as `attributedTo.displayName` for host-originated
      // node-patched broadcasts. Derived from `ShareDeps.hostDisplayName`
      // (defaults to 'Host') and exposed on state so the SSE bridge and local
      // studio UI can render the host's own suppressed self-attribution.
      hostDisplayName: string;
      // US-082: count of sessions currently tracked in active.json. Surfaced
      // on state so the apps/web LiveShareDialog can disable the kill-switch
      // button (and render "Active sessions: N") without a side-channel fetch.
      recentSessionCount: number;
    }
  | { status: 'stopping' }
  | { status: 'error'; reason: string };

export interface ShareController {
  start(): Promise<{ url: string; sessionId: string }>;
  stop(): Promise<void>;
  kick(peerId: string): Promise<void>;
  rotateUrl(): Promise<{ url: string }>;
  /**
   * Host kill-switch (US-081). Revokes every session this studio has ever
   * opened — not just the currently active one. Tracked sessions live in
   * `<auditDir>/active.json`; killAll POSTs `/api/share/end` to the relay
   * for each entry, appends a `kill-switch` audit entry to each affected
   * session's JSONL log, then truncates `active.json`. Returns counts so
   * the UI toast can show "Ended N live sessions".
   */
  killAll(): Promise<{ revoked: number; failed: number }>;
  state(): ShareState;
  subscribe(fn: (s: ShareState) => void): () => void;
  /**
   * Dispatch an inbound `rpc` envelope as if it came from `fromPeerId`. Tests
   * call this directly without driving the transport. When the originator is
   * a known peer (registered via presence/join), pass `displayName` so the
   * outgoing `node-patched` broadcast's `attributedTo` field carries the
   * human-readable label; if omitted, `fromPeerId` is used as the fallback.
   */
  handleRpcFrame(frame: unknown, fromPeerId: string, displayName?: string): Promise<RpcResultFrame>;
  /**
   * Broadcast a `node-patched` frame for an edit applied by the host's own UI
   * (no peer rpc). `attributedTo.peerId` is the literal `'host'` and
   * `displayName` is the active state's `hostDisplayName`. No-ops when the
   * controller is not active or the outcome was not `kind: 'ok'`. Returns the
   * monotonic per-flow version assigned (or `null` when no broadcast fired).
   */
  broadcastHostEdit(op: RpcOp, outcome: RpcDispatchOutcome): number | null;
  /**
   * Subscribe to attribution events fired for every accepted op the host
   * broadcasts (peer-originated AND host-originated). Used by the host
   * studio's apps/web UI to render attribution toasts (US-053); the SSE
   * bridge in `apps/studio/src/api.ts` fans these out to /api/share/attributions.
   */
  subscribeAttributions(fn: (event: AttributionEvent) => void): () => void;
  /**
   * Read access to the per-session `AuditEntry` JSONL stream (US-079). The
   * /api/share/audit endpoint delegates to this; when no session is active
   * `list()` returns an empty page so the endpoint can still answer 200
   * (the endpoint itself gates on state before calling).
   */
  audit: {
    list(opts?: {
      limit?: number;
      cursor?: number;
    }): Promise<{ entries: AuditEntry[]; nextCursor: number | null }>;
  };
}

export interface AttributionEvent {
  flowId: string;
  op: string;
  diff: unknown;
  version: number;
  attributedTo: { peerId: string; displayName: string };
  ts: number;
}

// Generic outcome shape returned by a dispatcher entry. Each operations.ts
// impl already conforms (`{ kind: 'ok'; data?: ... } | { kind: ...; message?: ... }`),
// so the default dispatcher passes them through. Tests inject custom
// dispatchers that return whatever they want for the per-op happy paths.
export interface RpcDispatchOutcome {
  kind: string;
  data?: unknown;
  message?: string;
}

export type RpcDispatcher = (op: RpcOp) => Promise<RpcDispatchOutcome>;

// Op allowlist — duplicated from `RpcOpSchema`'s discriminator literals as a
// runtime defense-in-depth. The Zod schema rejects unknown ops up front; this
// secondary gate catches a tampered runtime injection (e.g. a future code path
// that skips the schema parse) before it reaches the impl.
const ALLOWED_RPC_OPS = new Set<RpcOp['op']>([
  'addNode',
  'patchNode',
  'moveNode',
  'reorderNode',
  'deleteNode',
  'addConnector',
  'patchConnector',
  'deleteConnector',
  'addBulk',
]);

export function createDefaultRpcDispatcher(deps: OperationsDeps): RpcDispatcher {
  return async (op) => {
    switch (op.op) {
      case 'addNode':
        return addNodeImpl(deps, op.flowId, op.node);
      case 'patchNode': {
        const parsed = NodePatchBodySchema.safeParse(op.patch);
        if (!parsed.success) return { kind: 'badSchema', message: parsed.error.message };
        return patchNodeImpl(deps, op.flowId, op.nodeId, parsed.data);
      }
      case 'moveNode':
        return moveNodeImpl(deps, op.flowId, op.nodeId, op.position);
      case 'reorderNode':
        return reorderNodeImpl(deps, op.flowId, op.nodeId, op.reorder);
      case 'deleteNode':
        return deleteNodeImpl(deps, op.flowId, op.nodeId);
      case 'addConnector':
        return addConnectorImpl(deps, op.flowId, op.connector);
      case 'patchConnector': {
        const parsed = ConnectorPatchBodySchema.safeParse(op.patch);
        if (!parsed.success) return { kind: 'badSchema', message: parsed.error.message };
        return patchConnectorImpl(deps, op.flowId, op.connectorId, parsed.data);
      }
      case 'deleteConnector':
        return deleteConnectorImpl(deps, op.flowId, op.connectorId);
      case 'addBulk': {
        const body = { nodes: op.nodes, connectors: op.connectors };
        // The non-empty refine couldn't be expressed in the wire schema (a
        // ZodEffects member can't participate in a discriminatedUnion). It's
        // enforced here before dispatch so the wire stays loose.
        if (!flowBulkNonEmpty(body)) {
          return { kind: 'invalid', message: FLOW_BULK_NON_EMPTY_MESSAGE };
        }
        return addFlowBulkImpl(deps, op.flowId, body);
      }
    }
  };
}

export interface ShareDeps {
  relayHttpUrl: string;
  shareUrlBase: string;
  fetch?: typeof fetch;
  transportFactory?: (opts: ShareTransportOpts) => ShareTransport;
  // Rate-limiter is shared across the controller's lifetime so per-peer
  // buckets survive across kick/rejoin within a single session. Defaults to
  // 30 ops/sec / burst 30 per the design doc.
  rateLimiter?: RateLimiter;
  // Audit log lives one-per-session: created on transition to active, closed
  // by stop(). Path defaults to ~/.seeflow/share-history.
  auditDir?: string;
  /**
   * Path to the active-sessions tracking file (US-081 kill-switch). Defaults
   * to `<auditDir>/active.json`. The host appends `{sessionId, hostKey}` on
   * each start() and removes it on stop(); `killAll()` reads the file,
   * revokes every entry via POST /api/share/end, then truncates.
   */
  activeSessionsPath?: string;
  auditLogFactory?: (opts: AuditLogOpts) => AuditLog;
  // Phase-8 audit logger (US-078 shape: AuditEntry with kind). Created on
  // idle -> active alongside the legacy per-frame `auditLog`. Tests inject a
  // capturing factory; production callers leave it undefined and the real
  // `createAuditLogger` writes to `auditDir`.
  auditLoggerFactory?: (sessionId: string, root?: string) => AuditLogger;
  // Local EventBus to bridge onto outbound 'sse' envelopes so peers see live
  // runtime events (node:running, node:done, etc.) the same way the studio's
  // own SSE listeners do. On transition idle -> active we subscribe to each
  // flowId returned by flowIdsForBroadcast() and forward every StudioEvent as
  // makeEnvelope('sse', event, { to: 'all', from: 'host' }). Subscriptions are
  // torn down on teardown(). If either dep is absent the bridge is a no-op.
  eventBus?: EventBus;
  flowIdsForBroadcast?: () => string[];
  // OperationsDeps used by the default RPC dispatcher. Required when
  // `rpcDispatcher` is omitted; tests inject `rpcDispatcher` directly and can
  // skip this.
  operationsDeps?: OperationsDeps;
  // Per-op dispatcher invoked by `handleRpcFrame` after envelope validation.
  // Defaults to `createDefaultRpcDispatcher(operationsDeps)`. Tests inject
  // stubs to assert dispatch contract without touching the real impls.
  rpcDispatcher?: RpcDispatcher;
  // Injected for tests so they can capture audit writes without hitting disk.
  // Defaults to the real `appendShareAudit` writing to `auditDir`.
  appendShareAuditFn?: (sessionId: string, entry: RpcAuditEntry) => void;
  // Outbound broadcast seam. Defaults to forwarding the envelope through the
  // active transport when open. Tests inject a spy to assert the
  // node-patched fan-out without standing up a relay.
  broadcast?: (envelope: Envelope) => void;
  // Display label used as `attributedTo.displayName` for host-originated
  // node-patched broadcasts (and surfaced on `state().hostDisplayName` while
  // active). Defaults to `'Host'`. US-054 supplies the real OS username.
  hostDisplayName?: string;
  // Optional S3 staging deps for the oversize file-request path (US-060).
  // Both must be present to enable >256 KB file serving; otherwise the
  // handler replies `too-large` for big files. Tests can wire stubs.
  requestUploadIntent?: RequestUploadIntent;
  putToS3?: PutToS3;
  // Test seam: swap the entire file-request handler. Production callers
  // leave this undefined and the controller builds one from registry +
  // broadcast + the S3 deps above.
  fileRequestHandler?: FileRequestHandler;
  // Test seam: swap the entire file-upload handler. Production callers leave
  // this undefined and the controller builds one from registry + broadcast +
  // the active session id.
  fileUploadHandler?: FileUploadHandler;
  // Injected for tests so they can capture the upload audit entry without
  // hitting disk. Defaults to `appendShareAudit` writing to `auditDir`.
  appendFileUploadAuditFn?: AppendFileUploadAudit;
  // Test seam: swap the entire files-manifest builder (US-062). Production
  // callers leave this undefined and the controller builds one from
  // `operationsDeps.registry`. Without a registry the manifest is empty.
  filesManifestBuilder?: FilesManifestBuilder;
  /**
   * Per-peer outbound SSE send seam (US-072). Awaited per-frame inside the
   * per-peer queue so a slow consumer creates backpressure HERE rather than
   * in the producer. Defaults to a sync wrapper around `broadcast` that
   * sends an `sse` envelope addressed to the peer's connId. Tests inject a
   * delayed stub to exercise queue overflow + drop policy without standing
   * up a transport.
   */
  outboundSseSend?: (payload: SsePayload, peerConnId: string) => Promise<void> | void;
  /** Max in-queue frames per peer before eviction kicks in. Defaults to 256. */
  outboundSseMaxFrames?: number;
  /** Lifetime drops within this rolling window trigger a resync. Default 60000. */
  outboundSseDropResyncWindowMs?: number;
  /** Default 100. */
  outboundSseDropResyncThreshold?: number;
  /**
   * Tap-level rate-limit override (US-068). Passed through to `createSseTap`
   * as its `rateLimit` option. Defaults to the tap's own defaults (60/sec,
   * burst 120). Pass `false` to disable when testing per-peer backpressure
   * (US-072) so frames reach the queues without the tap's coalescer
   * absorbing the storm first.
   */
  sseTapRateLimit?: false | Omit<RateLimitOptions, 'onEmit'>;
}

interface RelaySessionResponse {
  sessionId: string;
  token: string;
  hostKey: string;
  wsUrl: string;
}

interface BootHandle {
  settled: boolean;
  cancelTimer: () => void;
  rejectStart: (err: Error) => void;
}

const BOOT_TIMEOUT_MS = 10_000;

// Per-frame snapshot payload size cap. The host splits the snapshot into
// per-flow chunks so no single `sse-snapshot` frame's serialized JSON exceeds
// this size. A flow whose own snapshot is larger than the cap is still
// emitted as one chunk — per-flow is the indivisible unit per the PRD.
export const SSE_SNAPSHOT_CHUNK_BYTES = 256 * 1024;

/**
 * Split a per-flow snapshot map into chunks so each chunk's serialized JSON
 * fits within `SSE_SNAPSHOT_CHUNK_BYTES`. Returns at least one chunk even
 * when the input is empty (callers gate on that separately). Always preserves
 * full flows — a single flow that overflows the cap occupies its own chunk
 * regardless of size.
 */
export function chunkSnapshotByFlow<T>(
  snap: Record<string, Record<string, T>>,
): Record<string, Record<string, T>>[] {
  const entries = Object.entries(snap);
  if (entries.length === 0) return [];

  const chunks: Record<string, Record<string, T>>[] = [];
  let current: Record<string, Record<string, T>> = {};

  for (const [flowId, nodes] of entries) {
    const candidate: Record<string, Record<string, T>> = { ...current, [flowId]: nodes };
    const candidateSize = JSON.stringify({ flows: candidate }).length;
    const isCurrentEmpty = Object.keys(current).length === 0;
    if (!isCurrentEmpty && candidateSize > SSE_SNAPSHOT_CHUNK_BYTES) {
      chunks.push(current);
      current = { [flowId]: nodes };
      continue;
    }
    current = candidate;
  }
  if (Object.keys(current).length > 0) chunks.push(current);
  return chunks;
}

/**
 * Resolve the host's display label for `attributedTo.displayName` on
 * host-originated `node-patched` broadcasts (US-054). Tries the running OS
 * user's `username` first; falls back to literal `'Host'` if the syscall
 * throws (sandboxed envs) or returns a blank value. Trimmed so a username
 * with whitespace doesn't propagate through to UI.
 */
export function resolveHostDisplayName(): string {
  try {
    const name = userInfo().username;
    if (typeof name === 'string') {
      const trimmed = name.trim();
      if (trimmed.length > 0) return trimmed;
    }
  } catch {
    // userInfo() throws on some sandboxed runtimes (e.g. Bun in a sealed
    // container with no /etc/passwd). Fall through to the literal default.
  }
  return 'Host';
}

// Fallback frame id surfaced when the inbound envelope failed validation
// hard enough that we can't recover `frame.id`. Anything is fine as long as
// it satisfies the wire schema's `min(1)` constraint on the `id` field.
const INVALID_FRAME_ID = 'invalid';

const extractFrameId = (frame: unknown): string => {
  if (frame && typeof frame === 'object' && 'id' in frame) {
    const raw = (frame as { id?: unknown }).id;
    if (typeof raw === 'string' && raw.length > 0) return raw;
  }
  return INVALID_FRAME_ID;
};

const makeRpcResultFrame = (id: string, payload: RpcResultFrame['payload']): RpcResultFrame => ({
  v: 1,
  type: 'rpc-result',
  id,
  payload,
});

// Build the diff payload broadcast as `node-patched` after a successful op.
// Each branch follows the contract documented on US-039:
//   moveNode      -> { kind: 'move', nodeId, position }
//   patchNode     -> { kind: 'patch', nodeId, patch }
//   addNode       -> { kind: 'add', node }         (full new node from outcome)
//   deleteNode    -> { kind: 'delete', nodeId }
//   reorderNode   -> { kind: 'reorder', nodeId, op }
// Connector variants mirror the same kinds with `connectorId` instead of
// `nodeId`. `addBulk` reports `{ kind: 'bulk', result }` so peers can decide
// whether to refetch or apply incrementally.
function computeNodePatchedDiff(op: RpcOp, outcome: RpcDispatchOutcome): unknown {
  switch (op.op) {
    case 'moveNode':
      return { kind: 'move', nodeId: op.nodeId, position: op.position };
    case 'patchNode':
      return { kind: 'patch', nodeId: op.nodeId, patch: op.patch };
    case 'addNode': {
      const data = outcome.data as { node?: unknown } | undefined;
      return { kind: 'add', node: data?.node };
    }
    case 'deleteNode':
      return { kind: 'delete', nodeId: op.nodeId };
    case 'reorderNode':
      return { kind: 'reorder', nodeId: op.nodeId, op: op.reorder };
    case 'addConnector': {
      const data = outcome.data as { id?: string } | undefined;
      const connector =
        data?.id !== undefined ? { ...op.connector, id: data.id } : { ...op.connector };
      return { kind: 'add', connector };
    }
    case 'patchConnector':
      return { kind: 'patch', connectorId: op.connectorId, patch: op.patch };
    case 'deleteConnector':
      return { kind: 'delete', connectorId: op.connectorId };
    case 'addBulk':
      return { kind: 'bulk', result: outcome.data };
  }
}

export function createShareController(deps: ShareDeps): ShareController {
  // current is mutated through setState() so subscribers fan-out on every
  // transition. hostKey + transport live in closure scope — hostKey is never
  // returned by state() or logged. bootHandle is non-null only while start()
  // is in flight; stop() consults it to abort a mid-boot start.
  let current: ShareState = { status: 'idle' };
  const subscribers = new Set<(s: ShareState) => void>();
  const attributionSubscribers = new Set<(event: AttributionEvent) => void>();
  const fetchFn = deps.fetch ?? fetch;
  const transportFactory = deps.transportFactory ?? createShareTransport;
  const rateLimiter = deps.rateLimiter ?? createRateLimiter({ ratePerSec: 30, burst: 30 });
  const auditDir = deps.auditDir ?? join(homedir(), '.seeflow', 'share-history');
  const activeSessionsPath = deps.activeSessionsPath ?? join(auditDir, 'active.json');
  const auditLogFactory = deps.auditLogFactory ?? createAuditLog;
  const auditLoggerFactory = deps.auditLoggerFactory ?? createAuditLogger;
  const hostDisplayName = deps.hostDisplayName ?? resolveHostDisplayName();
  const rpcDispatcher: RpcDispatcher | null =
    deps.rpcDispatcher ??
    (deps.operationsDeps ? createDefaultRpcDispatcher(deps.operationsDeps) : null);
  const appendShareAuditFn =
    deps.appendShareAuditFn ??
    ((sessionId, entry) => appendShareAudit(sessionId, entry, { dir: auditDir }));
  // Per-flow monotonic counter bumped just before every accepted node-patched
  // broadcast. Peers use this only for tie-breaking out-of-order frames in a
  // future story; for now we only assert monotonic-increasing in tests.
  const flowVersions = new Map<string, number>();

  let hostKey: string | null = null;
  let transport: ShareTransport | null = null;
  let bootHandle: BootHandle | null = null;
  let auditLog: AuditLog | null = null;
  let auditLogger: AuditLogger | null = null;
  // SSE tap (US-066/US-067): single per-controller instance owning the
  // EventBus -> outbound `sse` envelope bridge. Created on idle -> active,
  // torn down on stop()/teardown(). Null when inactive or when no eventBus
  // dep was provided.
  let sseTap: SseTap | null = null;
  // Unsubscribe handle for the `__registry__` listener that drives
  // `sseTap.refreshFlows()` on registry:reload events. Captured at active
  // time so teardown can drop the subscription cleanly.
  let registryUnsubscribe: (() => void) | null = null;
  // peerId -> connId. Populated by presence/join frames; consulted by kick()
  // so a host can address a peer by stable peerId while the relay routes on
  // the per-connection connId. Cleared on teardown.
  const peerConnIds = new Map<string, string>();
  // connId -> peer info. Inverse of peerConnIds, kept in lockstep. Used by
  // handleFrame to resolve env.from -> peerId before rate-limiting/auditing.
  const connPeers = new Map<string, { peerId: string; displayName: string }>();
  // Per-peer outbound SSE queues (US-072), keyed by connId. Created on
  // presence/join, disposed on presence/leave + teardown. Absent before the
  // first peer joins; the SSE bridge falls back to a `to: 'all'` broadcast
  // when this map is empty so the relay's own fan-out still reaches
  // unattributed peers (and so the legacy 0-peer tests keep passing).
  const peerSseQueues = new Map<string, PeerSseQueue>();
  const outboundSseMaxFrames = deps.outboundSseMaxFrames;
  const outboundSseDropResyncThreshold = deps.outboundSseDropResyncThreshold;
  const outboundSseDropResyncWindowMs = deps.outboundSseDropResyncWindowMs;

  const broadcast =
    deps.broadcast ??
    ((envelope: Envelope) => {
      if (!transport || !transport.isOpen()) return;
      try {
        transport.send(envelope);
      } catch (err) {
        console.warn('[share] broadcast send failed:', err);
      }
    });

  // Default per-peer SSE send: emit an addressed `sse` envelope through the
  // broadcast seam. Tests override with a stub that returns a delayed Promise
  // to exercise queue backpressure without touching the transport.
  const outboundSseSend: (payload: SsePayload, peerConnId: string) => Promise<void> | void =
    deps.outboundSseSend ??
    ((payload, peerConnId) => {
      broadcast(makeEnvelope('sse', payload, { to: peerConnId, from: 'host' }));
    });

  // File-request handler (US-060). Instantiated lazily so test deps that pass
  // an explicit `fileRequestHandler` win; otherwise we build one from the
  // registry on `operationsDeps`. Without a registry there is no resolver
  // surface and file-request envelopes are dropped with a warn.
  const fileRequestHandler: FileRequestHandler | null =
    deps.fileRequestHandler ??
    (deps.operationsDeps
      ? createFileRequestHandler({
          registry: deps.operationsDeps.registry,
          broadcast: (env) => broadcast(env),
          requestUploadIntent: deps.requestUploadIntent,
          putToS3: deps.putToS3,
        })
      : null);

  // File-upload handler (US-061). Mirrors the file-request lazy-instantiation
  // contract: tests supply an explicit `fileUploadHandler` to short-circuit;
  // production callers thread `operationsDeps.registry`. Without a registry
  // upload frames are dropped with a warn.
  const appendFileUploadAuditFn: AppendFileUploadAudit =
    deps.appendFileUploadAuditFn ??
    ((sessionId, entry) => appendShareAudit(sessionId, entry, { dir: auditDir }));
  const fileUploadHandler: FileUploadHandler | null =
    deps.fileUploadHandler ??
    (deps.operationsDeps
      ? createFileUploadHandler({
          registry: deps.operationsDeps.registry,
          broadcast: (env) => broadcast(env),
          getSessionId: () => (current.status === 'active' ? current.sessionId : null),
          appendAudit: appendFileUploadAuditFn,
        })
      : null);

  // Files-manifest builder (US-062). Lazy-instantiated from the registry, with
  // the same test-seam pattern as file-request / file-upload handlers. The
  // controller drives `init()` on transition idle -> active and emits one
  // `files-manifest` frame per accepted presence/join.
  const filesManifestBuilder: FilesManifestBuilder | null =
    deps.filesManifestBuilder ??
    (deps.operationsDeps
      ? createFilesManifestBuilder({ registry: deps.operationsDeps.registry })
      : null);
  // Resolves when `filesManifestBuilder.init()` has finished for the current
  // session. Set on idle -> active; cleared on teardown. A presence/join that
  // races with init awaits this before broadcasting.
  let filesManifestReady: Promise<void> | null = null;

  // Enrich an active ShareState with current per-peer outbound SSE metrics
  // (US-072) and the live tracked-session count (US-082). Idempotent —
  // re-reading state() at any time picks up the latest queue depths/drops AND
  // the latest `active.json` count without requiring a setState transition.
  const enrichWithSseMetrics = (s: ShareState): ShareState => {
    if (s.status !== 'active') return s;
    const enrichedPeers = s.peers.map((p) => {
      const connId = peerConnIds.get(p.peerId);
      const queue = connId ? peerSseQueues.get(connId) : undefined;
      if (!queue) return p;
      return { ...p, outboundSse: queue.metrics() };
    });
    return {
      ...s,
      peers: enrichedPeers,
      recentSessionCount: readTrackedSessions().length,
    };
  };

  const setState = (next: ShareState) => {
    current = next;
    const enriched = enrichWithSseMetrics(next);
    for (const fn of subscribers) {
      try {
        fn(enriched);
      } catch (err) {
        console.error('[share] subscriber threw on transition:', err);
      }
    }
  };

  const subscribeToEventBus = () => {
    if (!deps.eventBus || !deps.flowIdsForBroadcast) return;
    const flowIdsForBroadcast = deps.flowIdsForBroadcast;
    // Build the SSE tap with a fresh per-session monotonic seq counter (owned
    // by createSseTap). onEvent forwards the validated SsePayload as the
    // `payload` of an outbound `sse` envelope; the buffer + snapshot are
    // private to the tap and used by US-069 / US-070 for join replay.
    const tap = createSseTap(deps.eventBus, {
      flowIds: () => flowIdsForBroadcast(),
      ...(deps.sseTapRateLimit !== undefined ? { rateLimit: deps.sseTapRateLimit } : {}),
      onEvent: (payload) => {
        // With at least one connected peer, fan out per-peer through bounded
        // queues so a slow consumer can't stall the host event loop (US-072).
        // With zero known peers, fall back to the legacy `to: 'all'` broadcast
        // so the relay still fans out to any peer the host hasn't seen
        // presence/join for yet (e.g. first frame after auth-peer races with
        // the bridge).
        if (peerSseQueues.size === 0) {
          try {
            broadcast(makeEnvelope('sse', payload, { to: 'all', from: 'host' }));
          } catch (err) {
            console.warn('[share] sse fan-out broadcast failed:', err);
          }
          return;
        }
        for (const queue of peerSseQueues.values()) {
          try {
            queue.enqueue(payload);
          } catch (err) {
            console.warn('[share] sse enqueue failed:', err);
          }
        }
      },
    });
    sseTap = tap;
    tap.start();
    // Watch the registry channel so adds/removes flow through to the tap's
    // subscription set without restarting the share session. Listens on the
    // sentinel flowId used by `apps/studio/src/api.ts` registry mutators.
    registryUnsubscribe = deps.eventBus.subscribe('__registry__', (event) => {
      if (event.type !== 'registry:reload') return;
      try {
        tap.refreshFlows();
      } catch (err) {
        console.warn('[share] sse tap refreshFlows failed:', err);
      }
    });
  };

  const unsubscribeFromEventBus = () => {
    const off = registryUnsubscribe;
    registryUnsubscribe = null;
    if (off) {
      try {
        off();
      } catch (err) {
        console.warn('[share] registry unsubscribe failed:', err);
      }
    }
    const tap = sseTap;
    sseTap = null;
    if (tap) {
      try {
        tap.stop();
      } catch (err) {
        console.warn('[share] sse tap stop failed:', err);
      }
    }
  };

  // Build a per-peer SSE outbound queue (US-072). On threshold drops the queue
  // fires our onResyncTriggered, which we use to emit a one-shot `sse-snapshot`
  // addressed to the peer so its canvas catches back up after the host stops
  // sending live frames (or, more typically, after the peer's network gets
  // back enough headroom to drain).
  const buildPeerSseQueue = (peerConnId: string): PeerSseQueue =>
    createPeerSseQueue({
      peerConnId,
      send: outboundSseSend,
      maxFrames: outboundSseMaxFrames,
      dropResyncThreshold: outboundSseDropResyncThreshold,
      dropResyncWindowMs: outboundSseDropResyncWindowMs,
      onResyncTriggered: () => {
        try {
          emitSseSnapshotForPeer(peerConnId);
        } catch (err) {
          console.warn('[share] sse resync emit failed:', err);
        }
      },
    });

  const disposePeerSseQueue = (peerConnId: string): void => {
    const q = peerSseQueues.get(peerConnId);
    if (!q) return;
    peerSseQueues.delete(peerConnId);
    try {
      q.dispose();
    } catch (err) {
      console.warn('[share] sse queue dispose failed:', err);
    }
  };

  const teardown = () => {
    const t = transport;
    const log = auditLog;
    const klogger = auditLogger;
    transport = null;
    hostKey = null;
    auditLog = null;
    auditLogger = null;
    filesManifestReady = null;
    unsubscribeFromEventBus();
    for (const q of peerSseQueues.values()) {
      try {
        q.dispose();
      } catch (err) {
        console.warn('[share] sse queue dispose failed:', err);
      }
    }
    peerSseQueues.clear();
    peerConnIds.clear();
    connPeers.clear();
    if (t) {
      try {
        t.close('user');
      } catch (err) {
        console.warn('[share] close failed during teardown:', err);
      }
    }
    if (log) {
      log.close().catch((err) => {
        console.warn('[share] audit log close failed:', err);
      });
    }
    if (klogger) {
      klogger.close().catch((err) => {
        console.warn('[share] audit kind log close failed:', err);
      });
    }
  };

  const audit = (entry: FrameAuditEntry) => {
    if (!auditLog) return;
    try {
      auditLog.append(entry);
    } catch (err) {
      console.warn('[share] audit append failed:', err);
    }
  };

  // Fire-and-forget append of a Phase-8 `AuditEntry` to the per-session JSONL
  // log. Errors only warn — auditing is best-effort; never block hot paths
  // (RPC dispatch, kick, rotate) on disk I/O.
  const auditKind = (entry: Omit<AuditEntry, 'ts'>): void => {
    const logger = auditLogger;
    if (!logger) return;
    logger.append(entry).catch((err) => {
      console.warn('[share] audit kind append failed:', err);
    });
  };

  // The studio API receives a flat node-patch body (`name`, `description`,
  // color tokens, `width` / `height`, …) which `mergeNodeUpdates` dispatches
  // into `node.data.*`. The peer SPA applies the wire diff as a shallow merge
  // against the node root, so a flat patch would land at the root and leave
  // `data.*` stale — the renderer reads `data.name` and would silently keep
  // the old label. Normalize the wire shape by reading the post-mutation node
  // from the watcher's snapshot and forwarding the full merged `data` (plus
  // `position` / `type` if they moved). Keeps the peer's shallow-merge
  // semantics correct without changing the wire schema.
  const NODE_ROOT_PATCH_KEYS = new Set(['position', 'type']);
  const canonicalizePatchNode = (op: RpcOp): RpcOp => {
    if (op.op !== 'patchNode') return op;
    const watcher = deps.operationsDeps?.watcher;
    const snap = watcher?.snapshot(op.flowId);
    const node = snap?.flow?.nodes.find((n) => n.id === op.nodeId);
    if (!node) return op;
    const newPatch: Record<string, unknown> = {};
    for (const key of Object.keys(op.patch)) {
      if (NODE_ROOT_PATCH_KEYS.has(key)) {
        newPatch[key] = (node as unknown as Record<string, unknown>)[key];
      } else {
        newPatch.data = node.data;
      }
    }
    return { ...op, patch: newPatch };
  };

  // Build + emit a `node-patched` envelope for an accepted op. Centralized so
  // peer-rpc and host-local edits assemble the wire payload identically (only
  // the `attributedTo` value differs). Returns the version assigned so callers
  // can echo it back into rpc-result if needed.
  const broadcastNodePatched = (
    rawOp: RpcOp,
    outcome: RpcDispatchOutcome,
    attributedTo: { peerId: string; displayName: string },
  ): number => {
    const op = canonicalizePatchNode(rawOp);
    const nextVersion = (flowVersions.get(op.flowId) ?? 0) + 1;
    flowVersions.set(op.flowId, nextVersion);
    const diff = computeNodePatchedDiff(op, outcome);
    try {
      broadcast(
        makeEnvelope(
          'node-patched',
          { flowId: op.flowId, op: op.op, diff, version: nextVersion, attributedTo },
          { to: 'all' },
        ),
      );
    } catch (err) {
      console.warn('[share] node-patched broadcast failed:', err);
    }
    const event: AttributionEvent = {
      flowId: op.flowId,
      op: op.op,
      diff,
      version: nextVersion,
      attributedTo,
      ts: Date.now(),
    };
    for (const fn of attributionSubscribers) {
      try {
        fn(event);
      } catch (err) {
        console.error('[share] attribution subscriber threw:', err);
      }
    }
    return nextVersion;
  };

  const dispatchRpcFrame = async (
    frame: unknown,
    actor: { peerId: string; displayName: string },
  ): Promise<RpcResultFrame> => {
    const fallbackId = extractFrameId(frame);
    const parsed = RpcFrameSchema.safeParse(frame);
    if (!parsed.success) {
      // Never include payload in the log: a tampered envelope is hostile by
      // assumption.
      console.warn('[share] rpc frame rejected:', {
        type: 'rpc',
        from: actor.peerId,
        reason: 'invalid_envelope',
      });
      return makeRpcResultFrame(fallbackId, { ok: false, reason: 'invalid_envelope' });
    }
    const op = parsed.data.payload;
    if (!ALLOWED_RPC_OPS.has(op.op)) {
      // Defense-in-depth: unreachable past the schema, but guards a future
      // path that bypasses validation.
      console.warn('[share] rpc frame rejected:', {
        type: 'rpc',
        from: actor.peerId,
        reason: 'op_not_allowed',
      });
      return makeRpcResultFrame(parsed.data.id, { ok: false, reason: 'op_not_allowed' });
    }
    if (current.status !== 'active') {
      return makeRpcResultFrame(parsed.data.id, { ok: false, reason: 'not_active' });
    }
    if (!rpcDispatcher) {
      return makeRpcResultFrame(parsed.data.id, { ok: false, reason: 'no_dispatcher' });
    }
    const sessionId = current.sessionId;
    let outcome: RpcDispatchOutcome;
    try {
      outcome = await rpcDispatcher(op);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcome = { kind: 'dispatcherThrew', message };
    }
    const ok = outcome.kind === 'ok';
    const reason = ok ? undefined : outcome.kind + (outcome.message ? `: ${outcome.message}` : '');
    const attributedTo = { peerId: actor.peerId, displayName: actor.displayName };
    try {
      const entry: RpcAuditEntry = {
        ts: Date.now(),
        peerId: actor.peerId,
        op: op.op,
        flowId: op.flowId,
        ok,
        ...(reason ? { reason } : {}),
        attributedTo,
      };
      appendShareAuditFn(sessionId, entry);
    } catch (err) {
      console.warn('[share] rpc audit append failed:', err);
    }
    if (ok) {
      // Phase-8 kind-shaped audit (US-079). Coexists with the RpcAuditEntry
      // line written above so consumers can filter by either schema.
      // `details` carries flowId + (for node-targeted ops) the nodeId so the
      // audit drawer can render the target without re-reading the op union.
      const rpcDetails: Record<string, unknown> = { flowId: op.flowId };
      if ('nodeId' in op && typeof op.nodeId === 'string') {
        rpcDetails.nodeId = op.nodeId;
      }
      auditKind({
        kind: 'rpc-accept',
        peerId: actor.peerId,
        displayName: actor.displayName,
        op: op.op,
        details: rpcDetails,
      });
      // Broadcast the canonical diff BEFORE resolving rpc-result so peers
      // (including the originator) see the patch first; the originator's
      // optimistic reconcile then folds into a no-op.
      broadcastNodePatched(op, outcome, attributedTo);
      return makeRpcResultFrame(parsed.data.id, {
        ok: true,
        ...(outcome.data !== undefined ? { result: outcome.data } : {}),
        attributedTo,
      });
    }
    auditKind({
      kind: 'rpc-reject',
      peerId: actor.peerId,
      displayName: actor.displayName,
      op: op.op,
      reason: reason ?? outcome.kind,
    });
    return makeRpcResultFrame(parsed.data.id, {
      ok: false,
      reason: reason ?? outcome.kind,
    });
  };

  // Emit one or more `sse-snapshot` frames to a freshly-joined peer so its
  // canvas badges / play-button rings match the host's live state without
  // waiting for the next tick. Caps each frame's serialized payload at 256 KB
  // by splitting per-flow into chunks (chunk + total stamped on each frame).
  // A single flow whose own snapshot exceeds the cap is still emitted as one
  // chunk — per the PRD, per-flow is the indivisible unit.
  const emitSseSnapshotForPeer = (peerConnId: string): void => {
    if (!sseTap) return;
    let snap: Record<string, Record<string, SsePayload>>;
    try {
      snap = sseTap.snapshot();
    } catch (err) {
      console.warn('[share] sse-snapshot read failed:', err);
      return;
    }
    const entries = Object.entries(snap);
    if (entries.length === 0) return;

    const chunks = chunkSnapshotByFlow(snap);
    const total = chunks.length;
    for (let i = 0; i < chunks.length; i += 1) {
      const chunkFlows = chunks[i];
      if (!chunkFlows) continue;
      const payload: SseSnapshotPayload =
        total === 1 ? { flows: chunkFlows } : { flows: chunkFlows, chunk: i, total };
      try {
        broadcast(makeEnvelope('sse-snapshot', payload, { to: peerConnId }));
      } catch (err) {
        console.warn('[share] sse-snapshot broadcast failed:', err);
      }
    }
  };

  // Emit the files-manifest frame to a freshly-joined peer. Awaits init() so a
  // racing join (e.g. peer auth-peer'd before the walk completed) still gets a
  // populated manifest. Errors only warn — the manifest is a hint, not a
  // gating signal; the peer can fall back to file-request on cache miss.
  const emitFilesManifestForPeer = async (peerConnId: string): Promise<void> => {
    if (!filesManifestBuilder) return;
    try {
      if (filesManifestReady) await filesManifestReady;
      const payload = filesManifestBuilder.build();
      broadcast(makeEnvelope('files-manifest', payload, { to: peerConnId }));
    } catch (err) {
      console.warn('[share] files-manifest emit failed:', err);
    }
  };

  // Emit a `flow-snapshot` envelope to a freshly-joined peer so its canvas can
  // render the host's flow graph. Prefers the watcher's resolved snapshot
  // (file refs inlined, style merged, schema-validated) so component / icon
  // / image nodes render without the peer needing to walk the host's
  // filesystem. Falls back to raw on-disk JSON for setups that boot without
  // a watcher (CLI smoke tests, integration). Without this the peer is stuck
  // on "CONNECTING…" forever (viewer's share-session.tsx blocks until
  // `snapshot` is populated). Errors only warn — the peer can refresh /
  // rotate to retry.
  const emitFlowSnapshotForPeer = (peerConnId: string): void => {
    const registry = deps.operationsDeps?.registry;
    const watcher = deps.operationsDeps?.watcher;
    if (!registry) return;
    const entries = registry.list();
    if (entries.length === 0) return;
    const flows: Record<string, unknown> = {};
    let activeFlowId: string | null = null;
    for (const entry of entries) {
      let flow: unknown = null;
      const snap = watcher?.snapshot(entry.id) ?? watcher?.reparse(entry.id) ?? null;
      if (snap?.valid && snap.flow) {
        flow = snap.flow;
      } else {
        try {
          flow = JSON.parse(readFileSync(join(entry.repoPath, entry.flowPath), 'utf8'));
        } catch (err) {
          console.warn(`[share] flow-snapshot read failed for ${entry.id}:`, err);
          continue;
        }
      }
      flows[entry.id] = flow;
      if (activeFlowId === null) activeFlowId = entry.id;
      if (entry.isDefault) activeFlowId = entry.id;
    }
    if (!activeFlowId) return;
    try {
      broadcast(
        makeEnvelope('flow-snapshot', { flows, activeFlowId }, { to: peerConnId, from: 'host' }),
      );
    } catch (err) {
      console.warn('[share] flow-snapshot broadcast failed:', err);
    }
  };

  const handleFrame = (env: Envelope) => {
    if (env.type === 'presence') {
      const base = PresenceBaseSchema.safeParse(env.payload);
      if (!base.success) {
        console.warn('[share] dropped presence frame: invalid payload');
        return;
      }
      // Relay uses `state: 'joined'/'left'/...`; older host builds emitted
      // `kind: 'join'/'leave'`. Map either onto our internal verbs.
      const kind =
        base.data.kind ??
        (base.data.state === 'joined'
          ? 'join'
          : base.data.state === 'left'
            ? 'leave'
            : base.data.state);
      if (kind === 'join') {
        const parsed = PresenceJoinSchema.safeParse(env.payload);
        if (!parsed.success) {
          console.warn('[share] dropped presence/join: invalid fields');
          return;
        }
        const { peerId, displayName } = parsed.data;
        peerConnIds.set(peerId, env.from);
        connPeers.set(env.from, { peerId, displayName });
        // Spin up the per-peer outbound SSE queue alongside the connId
        // bookkeeping so any live frame that fires after presence/join lands
        // on a bounded queue rather than hitting the legacy `to: 'all'` path.
        if (!peerSseQueues.has(env.from)) {
          peerSseQueues.set(env.from, buildPeerSseQueue(env.from));
        }
        // Join itself is always accepted — the peer becomes "known" only as
        // a result of this frame, so rate-limiting it would be a chicken-and-
        // egg problem. Audit it as accept so the trail shows who joined when.
        audit({ ts: Date.now(), peerId, displayName, type: 'presence', verdict: 'accept' });
        auditKind({ kind: 'peer-join', peerId, displayName });
        if (current.status !== 'active') return;
        if (current.peers.some((peer) => peer.peerId === peerId)) return;
        setState({
          ...current,
          peers: [...current.peers, { peerId, displayName, joinedAt: Date.now() }],
        });
        // Prime the new peer with the host's flow graph first — without this
        // the peer is stuck on "CONNECTING…" forever (viewer waits on
        // snapshot before rendering the canvas).
        emitFlowSnapshotForPeer(env.from);
        // Prime the new peer with a one-shot files-manifest snapshot so its
        // canvas can render placeholder sizing before any file-request fires.
        // Fire-and-forget; emit failures are warned, never propagated.
        void emitFilesManifestForPeer(env.from);
        // Replay the SSE tap's last-seen per-node status so the joiner's
        // canvas badges + play-button rings match the host within one render.
        // Addressed to the joiner's connId only (not broadcast). Chunked
        // per-flow when the serialized payload exceeds 256 KB.
        emitSseSnapshotForPeer(env.from);
        return;
      }
      if (kind === 'leave') {
        const parsed = PresenceLeaveSchema.safeParse(env.payload);
        if (!parsed.success) {
          console.warn('[share] dropped presence/leave: invalid fields');
          return;
        }
        const { peerId } = parsed.data;
        const known = connPeers.get(env.from);
        peerConnIds.delete(peerId);
        connPeers.delete(env.from);
        disposePeerSseQueue(env.from);
        if (known) {
          audit({
            ts: Date.now(),
            peerId: known.peerId,
            displayName: known.displayName,
            type: 'presence',
            verdict: 'accept',
          });
          auditKind({
            kind: 'peer-leave',
            peerId: known.peerId,
            displayName: known.displayName,
          });
        }
        if (current.status !== 'active') return;
        if (!current.peers.some((peer) => peer.peerId === peerId)) return;
        setState({
          ...current,
          peers: current.peers.filter((peer) => peer.peerId !== peerId),
        });
        return;
      }
      // Other presence kinds (cursor, viewport, etc.) are sideband-only in v1.
      return;
    }

    // Non-presence frames must come from a known peer (introduced earlier via
    // presence/join). Frames from an unknown connId are dropped silently — we
    // have no peerId/displayName to attribute the audit entry to.
    const peer = connPeers.get(env.from);
    if (!peer) {
      console.debug('[share] dropped frame from unknown peer:', {
        type: env.type,
        from: env.from,
      });
      return;
    }

    const verdict = rateLimiter.check(peer.peerId);
    if (!verdict.ok) {
      audit({
        ts: Date.now(),
        peerId: peer.peerId,
        displayName: peer.displayName,
        type: env.type,
        verdict: 'reject',
        reason: 'rate-limited',
      });
      return;
    }

    audit({
      ts: Date.now(),
      peerId: peer.peerId,
      displayName: peer.displayName,
      type: env.type,
      verdict: 'accept',
    });

    if (env.type === 'file-request') {
      if (!fileRequestHandler) {
        console.warn('[share] dropped file-request: no handler configured');
        return;
      }
      fileRequestHandler.handle(env).catch((err) => {
        console.warn('[share] file-request handler threw:', err);
      });
      return;
    }

    if (
      env.type === 'file-upload-intent' ||
      env.type === 'file-bytes' ||
      env.type === 'file-upload-done'
    ) {
      if (!fileUploadHandler) {
        console.warn(`[share] dropped ${env.type}: no upload handler configured`);
        return;
      }
      const peerCtx = { peerId: peer.peerId, displayName: peer.displayName };
      const dispatch =
        env.type === 'file-upload-intent'
          ? fileUploadHandler.handleIntent(env, peerCtx)
          : env.type === 'file-bytes'
            ? fileUploadHandler.handleBytes(env, peerCtx)
            : fileUploadHandler.handleDone(env, peerCtx);
      dispatch.catch((err) => {
        console.warn(`[share] ${env.type} handler threw:`, err);
      });
      return;
    }

    if (env.type === 'rpc') {
      // The wire-side `RpcFrameSchema` is strict, so strip envelope-only fields
      // (`from`, `to`) before dispatch. Missing fields surface as
      // 'invalid_envelope' below.
      const wireFrame = {
        v: env.v,
        type: env.type,
        id: env.id,
        payload: env.payload,
      };
      const replyTo = env.from;
      dispatchRpcFrame(wireFrame, { peerId: peer.peerId, displayName: peer.displayName })
        .then((result) => {
          if (!transport || !transport.isOpen()) return;
          try {
            transport.send(
              makeEnvelope('rpc-result', result.payload, { to: replyTo, id: result.id }),
            );
          } catch (err) {
            console.warn('[share] rpc-result send failed:', err);
          }
        })
        .catch((err) => {
          console.warn('[share] dispatchRpcFrame threw:', err);
        });
      return;
    }

    // All other envelope types are accepted-and-dropped in v1; real handling
    // (file streaming, etc.) lands in phase 6+. Log type+from only — never
    // the payload.
    console.debug('[share] dropped frame:', { type: env.type, from: env.from });
  };

  // Active-sessions tracker (US-081). Persists `{sessionId, hostKey}` per
  // session in `<auditDir>/active.json` so a single `killAll()` call can
  // revoke every share link this studio has ever opened — not just the
  // currently active one. Writes are atomic; reads tolerate a missing or
  // corrupted file by returning an empty array.
  interface TrackedSession {
    sessionId: string;
    hostKey: string;
  }
  const readTrackedSessions = (): TrackedSession[] => {
    try {
      if (!existsSync(activeSessionsPath)) return [];
      const raw = readFileSync(activeSessionsPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (s): s is TrackedSession =>
          typeof s === 'object' &&
          s !== null &&
          typeof (s as { sessionId?: unknown }).sessionId === 'string' &&
          typeof (s as { hostKey?: unknown }).hostKey === 'string',
      );
    } catch {
      return [];
    }
  };
  const writeTrackedSessions = (sessions: TrackedSession[]): void => {
    try {
      mkdirSync(dirname(activeSessionsPath), { recursive: true });
      writeFileAtomic(activeSessionsPath, JSON.stringify(sessions));
    } catch (err) {
      console.warn('[share] active sessions write failed:', err);
    }
  };
  const addTrackedSession = (sessionId: string, hk: string): void => {
    const tracked = readTrackedSessions();
    if (tracked.some((s) => s.sessionId === sessionId)) return;
    writeTrackedSessions([...tracked, { sessionId, hostKey: hk }]);
  };
  const removeTrackedSession = (sessionId: string): void => {
    const tracked = readTrackedSessions();
    const next = tracked.filter((s) => s.sessionId !== sessionId);
    if (next.length === tracked.length) return;
    writeTrackedSessions(next);
  };

  const controller: ShareController = {
    async start() {
      if (current.status !== 'idle') {
        throw new Error('share-already-active');
      }
      const res = await fetchFn(`${deps.relayHttpUrl}/api/share/sessions`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`share-relay-http-${res.status}`);
      }
      const body = (await res.json()) as RelaySessionResponse;

      hostKey = body.hostKey;

      return await new Promise<{ url: string; sessionId: string }>((resolve, reject) => {
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

        const handle: BootHandle = {
          settled: false,
          cancelTimer: () => {
            if (timeoutHandle !== null) {
              clearTimeout(timeoutHandle);
              timeoutHandle = null;
            }
          },
          rejectStart: (err) => {
            handle.settled = true;
            reject(err);
          },
        };
        bootHandle = handle;

        timeoutHandle = setTimeout(() => {
          if (handle.settled) return;
          handle.settled = true;
          timeoutHandle = null;
          bootHandle = null;
          teardown();
          setState({ status: 'idle' });
          reject(new Error('share-boot-timeout'));
        }, BOOT_TIMEOUT_MS);

        const onTransportState = (s: ShareTransportState) => {
          if (handle.settled) return;
          if (s === 'connecting' || s === 'reconnecting') {
            if (current.status !== 'starting') setState({ status: 'starting' });
            return;
          }
          if (s === 'open') {
            handle.settled = true;
            handle.cancelTimer();
            bootHandle = null;
            const url = `${deps.shareUrlBase}/${body.token}`;
            // Open the per-session audit log before transitioning state so
            // any frame that races in (e.g. immediate presence/join from a
            // pre-connected peer) is captured.
            try {
              auditLog = auditLogFactory({ dir: auditDir, sessionId: body.sessionId });
            } catch (err) {
              console.warn('[share] audit log open failed:', err);
              auditLog = null;
            }
            try {
              auditLogger = auditLoggerFactory(body.sessionId, auditDir);
            } catch (err) {
              console.warn('[share] audit kind log open failed:', err);
              auditLogger = null;
            }
            // host-start is the first kind-shaped entry written to the file
            // so a consumer reading from cursor:0 sees the session boundary.
            auditKind({ kind: 'host-start', peerId: null, displayName: null });
            // Track the session in active.json so killAll() can revoke it
            // later — even after the controller goes idle.
            if (hostKey) addTrackedSession(body.sessionId, hostKey);
            // Subscribe to local runtime events BEFORE transitioning state so
            // any event that fires synchronously from a state subscriber finds
            // the bridge wired up.
            subscribeToEventBus();
            // Kick off the files-manifest disk walk. presence/join handlers
            // await this before emitting so the first joiner gets a populated
            // payload even if it races init.
            if (filesManifestBuilder) {
              filesManifestReady = filesManifestBuilder.init().catch((err) => {
                console.warn('[share] files-manifest init failed:', err);
              });
            }
            setState({
              status: 'active',
              sessionId: body.sessionId,
              token: body.token,
              url,
              peers: [],
              startedAt: Date.now(),
              hostDisplayName,
              recentSessionCount: 0,
            });
            resolve({ url, sessionId: body.sessionId });
            return;
          }
          // s === 'closed' before reaching 'open' => boot failed.
          handle.settled = true;
          handle.cancelTimer();
          bootHandle = null;
          transport = null;
          hostKey = null;
          setState({ status: 'idle' });
          reject(new Error('share-transport-closed-during-boot'));
        };

        transport = transportFactory({
          wsUrl: body.wsUrl,
          sessionId: body.sessionId,
          hostKey: body.hostKey,
          onFrame: handleFrame,
          onStateChange: onTransportState,
        });
      });
    },
    async stop() {
      if (current.status === 'idle') return;

      if (current.status === 'starting') {
        // Abort the in-flight start: mark its boot settled BEFORE closing the
        // transport so a synchronous 'closed' emit can't double-reject with
        // 'share-transport-closed-during-boot'.
        const handle = bootHandle;
        bootHandle = null;
        if (handle) {
          handle.settled = true;
          handle.cancelTimer();
        }
        setState({ status: 'stopping' });
        teardown();
        setState({ status: 'idle' });
        if (handle) handle.rejectStart(new Error('share-stopped-during-start'));
        return;
      }

      if (current.status === 'active') {
        // host-stop fires BEFORE teardown so the audit append lands on the
        // still-open logger; teardown closes it after.
        auditKind({ kind: 'host-stop', peerId: null, displayName: null });
        removeTrackedSession(current.sessionId);
        setState({ status: 'stopping' });
        teardown();
        setState({ status: 'idle' });
        return;
      }

      // status === 'stopping' or 'error' — treat as no-op; the in-flight
      // stop will complete on its own and a fresh start() can follow.
    },
    handleRpcFrame: (frame, fromPeerId, displayName) =>
      dispatchRpcFrame(frame, {
        peerId: fromPeerId,
        // Prefer the controller's known peer record so test/UI callers that
        // only pass a peerId still attribute correctly when the peer is
        // already known via presence/join. Falls back to the passed
        // displayName, then the peerId itself, so attribution is always
        // non-empty (AttributionSchema requires `displayName.min(1)`).
        displayName:
          [...connPeers.values()].find((p) => p.peerId === fromPeerId)?.displayName ??
          displayName ??
          fromPeerId,
      }),
    broadcastHostEdit(op, outcome) {
      if (current.status !== 'active') return null;
      if (outcome.kind !== 'ok') return null;
      const attributedTo = { peerId: 'host', displayName: current.hostDisplayName };
      // Audit the host-local edit so the JSONL file reflects every accepted
      // mutation regardless of origin. peerId mirrors `attributedTo.peerId`
      // ('host') so consumers can filter by attribution without a join.
      try {
        const entry: RpcAuditEntry = {
          ts: Date.now(),
          peerId: 'host',
          op: op.op,
          flowId: op.flowId,
          ok: true,
          attributedTo,
        };
        appendShareAuditFn(current.sessionId, entry);
      } catch (err) {
        console.warn('[share] host-edit audit append failed:', err);
      }
      return broadcastNodePatched(op, outcome, attributedTo);
    },
    async kick(peerId: string) {
      if (current.status !== 'active' || !hostKey) {
        throw new Error('share-not-active');
      }
      // Look up displayName from connPeers so the audit entry records the
      // human-readable label even though the relay endpoint only takes a
      // peerId. Falls back to null when the peer is unknown — but in that
      // case we throw share-peer-not-found before issuing the RPC.
      const known = [...connPeers.values()].find((p) => p.peerId === peerId);
      if (!known) {
        const reason = 'share-peer-not-found';
        auditKind({
          kind: 'rpc-reject',
          peerId,
          displayName: null,
          op: 'kick',
          reason,
        });
        throw new Error(reason);
      }
      const sessionId = current.sessionId;
      try {
        const res = await fetchFn(`${deps.relayHttpUrl}/api/share/kick`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, hostKey, peerId }),
        });
        if (!res.ok) {
          throw new Error(`share-relay-http-${res.status}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        auditKind({
          kind: 'rpc-reject',
          peerId,
          displayName: known.displayName,
          op: 'kick',
          reason,
        });
        throw err;
      }
      auditKind({
        kind: 'kick',
        peerId,
        displayName: known.displayName,
      });
    },
    async rotateUrl() {
      if (current.status !== 'active' || !hostKey) {
        throw new Error('share-not-active');
      }
      const sessionId = current.sessionId;
      const res = await fetchFn(`${deps.relayHttpUrl}/api/share/rotate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, hostKey }),
      });
      if (!res.ok) {
        throw new Error(`share-relay-http-${res.status}`);
      }
      const body = (await res.json()) as { token: string };
      const newUrl = `${deps.shareUrlBase}/${body.token}`;
      // The relay's rotate endpoint kicks every peer connection as part of
      // the rotation — none of them will reconnect with the old token. Clear
      // our local peer book-keeping so state() reflects the empty roster the
      // next subscriber tick will read.
      for (const q of peerSseQueues.values()) {
        try {
          q.dispose();
        } catch (err) {
          console.warn('[share] sse queue dispose failed during rotate:', err);
        }
      }
      peerSseQueues.clear();
      peerConnIds.clear();
      connPeers.clear();
      if (current.status === 'active') {
        setState({ ...current, token: body.token, url: newUrl, peers: [] });
      }
      auditKind({ kind: 'rotate', peerId: null, displayName: null });
      return { url: newUrl };
    },
    async killAll() {
      const tracked = readTrackedSessions();
      let revoked = 0;
      let failed = 0;
      for (const { sessionId, hostKey: hk } of tracked) {
        try {
          const res = await fetchFn(`${deps.relayHttpUrl}/api/share/end`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, hostKey: hk }),
          });
          if (!res.ok) {
            failed += 1;
            continue;
          }
          revoked += 1;
        } catch {
          failed += 1;
        }
      }
      // Per-session audit append. Each session gets a `kill-switch` entry so
      // a reader paging through that file sees the boundary. Use the factory
      // (not the active controller's `auditLogger`) so we can target any
      // tracked session — including ones whose controller is long since
      // torn down.
      for (const { sessionId } of tracked) {
        try {
          const logger = auditLoggerFactory(sessionId, auditDir);
          await logger.append({
            kind: 'kill-switch',
            peerId: null,
            displayName: null,
            details: { revoked, failed },
          });
          await logger.close();
        } catch (err) {
          console.warn('[share] kill-switch audit append failed:', err);
        }
      }
      writeTrackedSessions([]);
      return { revoked, failed };
    },
    state() {
      return enrichWithSseMetrics(current);
    },
    subscribe(fn) {
      subscribers.add(fn);
      try {
        fn(enrichWithSseMetrics(current));
      } catch (err) {
        console.error('[share] subscriber threw on initial deliver, dropping:', err);
      }
      return () => {
        subscribers.delete(fn);
      };
    },
    subscribeAttributions(fn) {
      attributionSubscribers.add(fn);
      return () => {
        attributionSubscribers.delete(fn);
      };
    },
    audit: {
      // Delegates to the per-session AuditLogger. Returns an empty page
      // when no session is active so the endpoint can answer without a
      // file-read; the endpoint itself returns 400 in that case before
      // calling in, but stay safe-by-default here too.
      async list(opts) {
        const logger = auditLogger;
        if (!logger) return { entries: [], nextCursor: null };
        return logger.list(opts);
      },
    },
  };

  return controller;
}
