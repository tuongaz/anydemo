/**
 * Shared RPC envelope schema for the live-share WebSocket protocol (phase 4).
 *
 * ⚠ BYTE-FOR-BYTE MIRROR: this file MUST stay identical to
 *   /Users/tuongaz/dev/seeflow-viewer/src/lib/share-rpc-schema.ts.
 * The integration check at apps/studio/integration/share-rpc-schema-sync.it.ts
 * reads both files and asserts strict bytewise equality. Any edit here MUST
 * be mirrored to the viewer copy in the same commit, or CI fails.
 *
 * Self-contained on purpose: NO imports from './operations.ts' or './schema.ts'.
 * Those paths don't resolve in the viewer repo, and byte-for-byte mirroring
 * requires identical imports across both files.
 *
 * Body-shape strictness:
 *   - PositionBody + ReorderBody are tiny self-contained Zod shapes — inlined
 *     here so obviously-malformed payloads (NaN x, unknown reorder op) reject
 *     at the wire layer.
 *   - Node/connector add + patch bodies are loose `z.record(z.unknown())`. The
 *     strict re-validation runs at impl-dispatch time in operations.ts via
 *     `NodePatchBodySchema` / `ConnectorPatchBodySchema` / the post-merge
 *     `ResolvedFlowSchema` reparse (US-038's `handleRpcFrame`). Treat this file
 *     as an envelope schema, not a substitute for the impl-layer guards.
 *
 * Op allowlist (9 ops): addNode, patchNode, moveNode, reorderNode, deleteNode,
 * addConnector, patchConnector, deleteConnector, addBulk. Unknown ops are
 * rejected by the discriminated union; the per-op `.strict()` rejects unknown
 * top-level keys so a `{ op: 'addNode', nodeId, position }` cross-op shape
 * fails fast instead of silently accepting the wrong wrapper.
 *
 * `addBulk` is the only op without `.strict()` because its body carries the
 * optional `nodes` + `connectors` arrays alongside `op` + `flowId`; the
 * 100-item-per-array cap mirrors operations.ts's `FlowBulkBodyShape`. The
 * "at least one non-empty" refine from `FlowBulkBodySchema` is NOT applied
 * here (discriminatedUnion requires bare ZodObjects, not ZodEffects) — the
 * non-empty check runs in US-038's handler before dispatching to
 * `addFlowBulkImpl`.
 */

import { z } from 'zod';

const FlowIdSchema = z.string().min(1);
const NodeIdSchema = z.string().min(1);
const ConnectorIdSchema = z.string().min(1);
const FrameIdSchema = z.string().min(1);

const PositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

const ReorderSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('forward') }),
  z.object({ op: z.literal('backward') }),
  z.object({ op: z.literal('toFront') }),
  z.object({ op: z.literal('toBack') }),
  z.object({ op: z.literal('toIndex'), index: z.number().int().nonnegative() }),
]);

const NodeBodySchema = z.record(z.unknown());
const ConnectorBodySchema = z.record(z.unknown());
const NodePatchBodyShape = z.record(z.unknown());
const ConnectorPatchBodyShape = z.record(z.unknown());

const BULK_MAX_ITEMS = 100;
const BulkArraySchema = z.array(z.record(z.unknown())).max(BULK_MAX_ITEMS);

export const AddNodeOpSchema = z
  .object({
    op: z.literal('addNode'),
    flowId: FlowIdSchema,
    node: NodeBodySchema,
  })
  .strict();

export const PatchNodeOpSchema = z
  .object({
    op: z.literal('patchNode'),
    flowId: FlowIdSchema,
    nodeId: NodeIdSchema,
    patch: NodePatchBodyShape,
  })
  .strict();

export const MoveNodeOpSchema = z
  .object({
    op: z.literal('moveNode'),
    flowId: FlowIdSchema,
    nodeId: NodeIdSchema,
    position: PositionSchema,
  })
  .strict();

export const ReorderNodeOpSchema = z
  .object({
    op: z.literal('reorderNode'),
    flowId: FlowIdSchema,
    nodeId: NodeIdSchema,
    reorder: ReorderSchema,
  })
  .strict();

export const DeleteNodeOpSchema = z
  .object({
    op: z.literal('deleteNode'),
    flowId: FlowIdSchema,
    nodeId: NodeIdSchema,
  })
  .strict();

export const AddConnectorOpSchema = z
  .object({
    op: z.literal('addConnector'),
    flowId: FlowIdSchema,
    connector: ConnectorBodySchema,
  })
  .strict();

export const PatchConnectorOpSchema = z
  .object({
    op: z.literal('patchConnector'),
    flowId: FlowIdSchema,
    connectorId: ConnectorIdSchema,
    patch: ConnectorPatchBodyShape,
  })
  .strict();

export const DeleteConnectorOpSchema = z
  .object({
    op: z.literal('deleteConnector'),
    flowId: FlowIdSchema,
    connectorId: ConnectorIdSchema,
  })
  .strict();

export const AddBulkOpSchema = z
  .object({
    op: z.literal('addBulk'),
    flowId: FlowIdSchema,
    nodes: BulkArraySchema.optional(),
    connectors: BulkArraySchema.optional(),
  })
  .strict();

export const RpcOpSchema = z.discriminatedUnion('op', [
  AddNodeOpSchema,
  PatchNodeOpSchema,
  MoveNodeOpSchema,
  ReorderNodeOpSchema,
  DeleteNodeOpSchema,
  AddConnectorOpSchema,
  PatchConnectorOpSchema,
  DeleteConnectorOpSchema,
  AddBulkOpSchema,
]);

export const RpcFrameSchema = z
  .object({
    v: z.literal(1),
    type: z.literal('rpc'),
    id: FrameIdSchema,
    payload: RpcOpSchema,
  })
  .strict();

export const RpcResultPayloadSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: z.unknown().optional() }).strict(),
  z.object({ ok: z.literal(false), reason: z.string() }).strict(),
]);

export const RpcResultFrameSchema = z
  .object({
    v: z.literal(1),
    type: z.literal('rpc-result'),
    id: FrameIdSchema,
    payload: RpcResultPayloadSchema,
  })
  .strict();

export type RpcOp = z.infer<typeof RpcOpSchema>;
export type RpcFrame = z.infer<typeof RpcFrameSchema>;
export type RpcResultFrame = z.infer<typeof RpcResultFrameSchema>;
