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

import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
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
  type RpcAuditEntry,
  appendShareAudit,
  createAuditLog,
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
import { type SseTap, createSseTap } from './share/sse-tap.ts';

// Presence frame payloads. We validate `kind` against the base shape, then
// re-validate join/leave with their strict required fields so malformed
// join/leave frames are dropped rather than treated as sideband. Cursor,
// viewport, and any other future `kind` no-op in v1 per the design doc.
const PresenceBaseSchema = z.object({ kind: z.string() }).passthrough();
const PresenceJoinSchema = z.object({
  kind: z.literal('join'),
  peerId: z.string(),
  displayName: z.string(),
});
const PresenceLeaveSchema = z.object({ kind: z.literal('leave'), peerId: z.string() });

export interface PeerSummary {
  peerId: string;
  displayName: string;
  joinedAt: number;
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
    }
  | { status: 'stopping' }
  | { status: 'error'; reason: string };

export interface ShareController {
  start(): Promise<{ url: string; sessionId: string }>;
  stop(): Promise<void>;
  kick(peerId: string): Promise<void>;
  rotateUrl(): Promise<{ url: string }>;
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
  auditLogFactory?: (opts: AuditLogOpts) => AuditLog;
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
  const auditLogFactory = deps.auditLogFactory ?? createAuditLog;
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

  const setState = (next: ShareState) => {
    current = next;
    for (const fn of subscribers) {
      try {
        fn(next);
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
      onEvent: (payload) => {
        // Best-effort fan-out: if the transport is gone or not open, drop the
        // event (no buffering at the broadcast layer — the tap's ring buffer
        // is for snapshot priming, NOT relay-side replay; reconnect handled
        // peer-side via sse-snapshot in US-069).
        try {
          broadcast(makeEnvelope('sse', payload, { to: 'all', from: 'host' }));
        } catch (err) {
          console.warn('[share] sse fan-out broadcast failed:', err);
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

  const teardown = () => {
    const t = transport;
    const log = auditLog;
    transport = null;
    hostKey = null;
    auditLog = null;
    filesManifestReady = null;
    unsubscribeFromEventBus();
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
  };

  const audit = (entry: AuditEntry) => {
    if (!auditLog) return;
    try {
      auditLog.append(entry);
    } catch (err) {
      console.warn('[share] audit append failed:', err);
    }
  };

  // Build + emit a `node-patched` envelope for an accepted op. Centralized so
  // peer-rpc and host-local edits assemble the wire payload identically (only
  // the `attributedTo` value differs). Returns the version assigned so callers
  // can echo it back into rpc-result if needed.
  const broadcastNodePatched = (
    op: RpcOp,
    outcome: RpcDispatchOutcome,
    attributedTo: { peerId: string; displayName: string },
  ): number => {
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
    return makeRpcResultFrame(parsed.data.id, {
      ok: false,
      reason: reason ?? outcome.kind,
    });
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

  const handleFrame = (env: Envelope) => {
    if (env.type === 'presence') {
      const base = PresenceBaseSchema.safeParse(env.payload);
      if (!base.success) {
        console.warn('[share] dropped presence frame: invalid payload');
        return;
      }
      const kind = base.data.kind;
      if (kind === 'join') {
        const parsed = PresenceJoinSchema.safeParse(env.payload);
        if (!parsed.success) {
          console.warn('[share] dropped presence/join: invalid fields');
          return;
        }
        const { peerId, displayName } = parsed.data;
        peerConnIds.set(peerId, env.from);
        connPeers.set(env.from, { peerId, displayName });
        // Join itself is always accepted — the peer becomes "known" only as
        // a result of this frame, so rate-limiting it would be a chicken-and-
        // egg problem. Audit it as accept so the trail shows who joined when.
        audit({ ts: Date.now(), peerId, displayName, type: 'presence', verdict: 'accept' });
        if (current.status !== 'active') return;
        if (current.peers.some((peer) => peer.peerId === peerId)) return;
        setState({
          ...current,
          peers: [...current.peers, { peerId, displayName, joinedAt: Date.now() }],
        });
        // Prime the new peer with a one-shot files-manifest snapshot so its
        // canvas can render placeholder sizing before any file-request fires.
        // Fire-and-forget; emit failures are warned, never propagated.
        void emitFilesManifestForPeer(env.from);
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
        if (known) {
          audit({
            ts: Date.now(),
            peerId: known.peerId,
            displayName: known.displayName,
            type: 'presence',
            verdict: 'accept',
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
      if (current.status !== 'active' || !transport) {
        throw new Error('share-not-active');
      }
      const connId = peerConnIds.get(peerId);
      if (!connId) {
        throw new Error('share-peer-not-found');
      }
      transport.send(makeEnvelope('kick', { peerId }, { to: connId }));
    },
    async rotateUrl() {
      if (current.status !== 'active') {
        throw new Error('share-not-active');
      }
      await controller.stop();
      const { url } = await controller.start();
      return { url };
    },
    state() {
      return current;
    },
    subscribe(fn) {
      subscribers.add(fn);
      try {
        fn(current);
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
  };

  return controller;
}
