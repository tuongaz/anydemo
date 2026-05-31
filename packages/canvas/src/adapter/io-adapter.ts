// IoAdapter — non-throwing seam over the same mutation surface as CanvasAdapter.
//
// This seam exists for live share (US-035 / US-036) and future non-HTTP
// embedders that route canvas mutations over a custom transport — typically a
// WebSocket RPC channel where errors come back as a `{ ok: false, reason }`
// envelope rather than a thrown JS Error. The canvas's rendering layer NEVER
// imports this module directly; the only entry point is the `ioAdapter` prop
// on `<SeeflowCanvas>` (US-036), which wraps it back into the throwing
// `CanvasAdapter` contract before reaching anything inside `seeflow-canvas.tsx`.
//
// IoAdapter is additive — `CanvasAdapter` remains the in-studio default and is
// unchanged by anything in this file.
//
// `IoAdapterDispatchEnvelope` is the serializable shape peer transports use to
// frame a mutation on the wire (`{ op, payload }`); the `op` discriminator is
// the canvas's stable operation vocabulary independent of the underlying
// method name (e.g. `updateNodePosition` → `op: 'moveNode'`).

import type {
  ConnectorCreateInput,
  ConnectorPatch,
  NodeCreateInput,
  NodePatch,
  ReorderOp,
  UpdateNodePositionResult,
  UploadImageResult,
} from './types.ts';

/**
 * Result envelope returned by every IoAdapter method. Discriminated by `ok` so
 * peer transports can encode `{ ok: false, reason }` over the wire without
 * relying on thrown JS errors crossing process boundaries.
 */
export type IoAdapterResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Serializable envelope used by peer transports to frame a single canvas
 * mutation on the wire. The `op` enum is the canvas's stable operation
 * vocabulary; the `payload` is method-specific and validated by the host
 * before applying.
 *
 * `op` mapping to `CanvasAdapter` methods:
 *   - `addNode`         → createNode
 *   - `patchNode`       → updateNode
 *   - `moveNode`        → updateNodePosition
 *   - `reorderNode`     → reorderNode
 *   - `deleteNode`      → deleteNode
 *   - `addConnector`    → createConnector
 *   - `patchConnector`  → updateConnector
 *   - `deleteConnector` → deleteConnector
 *
 * `uploadImage` intentionally has no envelope `op` — file uploads use a
 * separate binary-frame path (`file-bytes` / `file-upload-intent`) in the
 * live-share protocol, not the RPC envelope.
 */
export interface IoAdapterDispatchEnvelope {
  op:
    | 'addNode'
    | 'patchNode'
    | 'moveNode'
    | 'reorderNode'
    | 'deleteNode'
    | 'addConnector'
    | 'patchConnector'
    | 'deleteConnector';
  payload: unknown;
}

/**
 * Runtime event shape delivered to listeners registered via
 * `IoAdapter.subscribeEvents` (US-071). Mirrors the host's flat
 * `StudioEvent` (apps/web/src/hooks/use-studio-events.ts) — `payload` fields
 * are spread to the top level so the canvas's existing `deriveVisualStatus`
 * consumers (StatusIconPill, PlayButton ring, edge handoff pulse) don't
 * need to learn a new schema. `flowId` is included so a single multiplexed
 * transport (e.g. the live-share WebSocket relay) can demux per-flow.
 *
 * The `type` field is kept as a free-form string so the adapter seam doesn't
 * pin a concrete union — peer transports that bridge additional event types
 * over the same channel can pass them through without a type-change here.
 */
export interface CanvasSseEvent {
  type: string;
  ts: number;
  flowId: string;
  [key: string]: unknown;
}

/**
 * IoAdapter — non-throwing twin of `CanvasAdapter`. Same nine mutation method
 * shapes; every return type is wrapped in `IoAdapterResult<T>` so transports
 * can surface `{ ok: false, reason }` instead of rejecting the promise.
 *
 * Implementations are expected to be plug-and-play with the host-side
 * `wrapIoAdapterAsCanvasAdapter` helper (US-036), which converts each result
 * envelope back into the throw-on-error `CanvasAdapter` contract that
 * `<SeeflowCanvas>` internally relies on.
 */
export interface IoAdapter {
  createNode(
    input: NodeCreateInput,
  ): Promise<IoAdapterResult<{ id: string; node: Record<string, unknown> }>>;
  updateNode(nodeId: string, patch: NodePatch): Promise<IoAdapterResult<void>>;
  updateNodePosition(
    nodeId: string,
    position: { x: number; y: number },
  ): Promise<IoAdapterResult<UpdateNodePositionResult>>;
  deleteNode(nodeId: string): Promise<IoAdapterResult<void>>;
  reorderNode(nodeId: string, op: ReorderOp): Promise<IoAdapterResult<void>>;
  createConnector(input: ConnectorCreateInput): Promise<IoAdapterResult<{ id: string }>>;
  updateConnector(connectorId: string, patch: ConnectorPatch): Promise<IoAdapterResult<void>>;
  deleteConnector(connectorId: string): Promise<IoAdapterResult<void>>;
  uploadImage(
    nodeId: string,
    file: File,
    filename: string,
  ): Promise<IoAdapterResult<UploadImageResult>>;
  /**
   * Optional: subscribe to runtime studio events for `flowId` (US-071). When
   * present, embedders use this seam INSTEAD of constructing an EventSource
   * against `/api/events` — peer SPAs route SSE through the live-share
   * WebSocket relay (US-067 / US-070), and other non-HTTP transports inject
   * their own event source here. Returns a disposer; idempotent on repeated
   * calls. Listeners receive `CanvasSseEvent` ({type, ts, flowId, ...payload})
   * so the visual-status derivation path stays unchanged. Absent →
   * consumers fall back to their default `EventSource` path.
   */
  subscribeEvents?(flowId: string, listener: (event: CanvasSseEvent) => void): () => void;
}
