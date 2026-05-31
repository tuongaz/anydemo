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

import { homedir } from 'node:os';
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
import { type RateLimiter, createRateLimiter } from './share-ratelimit.ts';
import { RpcFrameSchema, type RpcOp, type RpcResultFrame } from './share-rpc-schema.ts';
import {
  type ShareTransport,
  type ShareTransportOpts,
  type ShareTransportState,
  createShareTransport,
} from './share-transport.ts';

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
  handleRpcFrame(frame: unknown, fromPeerId: string): Promise<RpcResultFrame>;
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
  const fetchFn = deps.fetch ?? fetch;
  const transportFactory = deps.transportFactory ?? createShareTransport;
  const rateLimiter = deps.rateLimiter ?? createRateLimiter({ ratePerSec: 30, burst: 30 });
  const auditDir = deps.auditDir ?? join(homedir(), '.seeflow', 'share-history');
  const auditLogFactory = deps.auditLogFactory ?? createAuditLog;
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
  // EventBus unsubscribe closures captured at active-time, drained in teardown.
  let eventUnsubscribes: (() => void)[] = [];
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
    const flowIds = deps.flowIdsForBroadcast();
    for (const flowId of flowIds) {
      const off = deps.eventBus.subscribe(flowId, (event) => {
        // Best-effort fan-out: if the transport is gone or not open, drop the
        // event (no buffering for v1). Wrap send in try/catch so a throwing
        // transport doesn't poison the EventBus subscriber list.
        if (!transport || !transport.isOpen()) return;
        try {
          transport.send(makeEnvelope('sse', event, { to: 'all', from: 'host' }));
        } catch (err) {
          console.warn('[share] sse fan-out send failed:', err);
        }
      });
      eventUnsubscribes.push(off);
    }
  };

  const unsubscribeFromEventBus = () => {
    const offs = eventUnsubscribes;
    eventUnsubscribes = [];
    for (const off of offs) {
      try {
        off();
      } catch (err) {
        console.warn('[share] eventBus unsubscribe failed:', err);
      }
    }
  };

  const teardown = () => {
    const t = transport;
    const log = auditLog;
    transport = null;
    hostKey = null;
    auditLog = null;
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

  const dispatchRpcFrame = async (frame: unknown, fromPeerId: string): Promise<RpcResultFrame> => {
    const fallbackId = extractFrameId(frame);
    const parsed = RpcFrameSchema.safeParse(frame);
    if (!parsed.success) {
      // Never include payload in the log: a tampered envelope is hostile by
      // assumption.
      console.warn('[share] rpc frame rejected:', {
        type: 'rpc',
        from: fromPeerId,
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
        from: fromPeerId,
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
    try {
      const entry: RpcAuditEntry = {
        ts: Date.now(),
        peerId: fromPeerId,
        op: op.op,
        flowId: op.flowId,
        ok,
        ...(reason ? { reason } : {}),
      };
      appendShareAuditFn(sessionId, entry);
    } catch (err) {
      console.warn('[share] rpc audit append failed:', err);
    }
    if (ok) {
      // Broadcast the canonical diff BEFORE resolving rpc-result so peers
      // (including the originator) see the patch first; the originator's
      // optimistic reconcile then folds into a no-op.
      const nextVersion = (flowVersions.get(op.flowId) ?? 0) + 1;
      flowVersions.set(op.flowId, nextVersion);
      const diff = computeNodePatchedDiff(op, outcome);
      try {
        broadcast(
          makeEnvelope(
            'node-patched',
            { flowId: op.flowId, op: op.op, diff, version: nextVersion },
            { to: 'all' },
          ),
        );
      } catch (err) {
        console.warn('[share] node-patched broadcast failed:', err);
      }
      return makeRpcResultFrame(parsed.data.id, {
        ok: true,
        ...(outcome.data !== undefined ? { result: outcome.data } : {}),
      });
    }
    return makeRpcResultFrame(parsed.data.id, {
      ok: false,
      reason: reason ?? outcome.kind,
    });
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
      dispatchRpcFrame(wireFrame, peer.peerId)
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
            setState({
              status: 'active',
              sessionId: body.sessionId,
              token: body.token,
              url,
              peers: [],
              startedAt: Date.now(),
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
    handleRpcFrame: (frame, fromPeerId) => dispatchRpcFrame(frame, fromPeerId),
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
  };

  return controller;
}
