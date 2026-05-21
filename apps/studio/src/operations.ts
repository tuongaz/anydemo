// Shared inner helpers that REST handlers in api.ts and MCP tool handlers in
// mcp.ts both call. Each helper returns an Outcome discriminated union so the
// caller layer can translate it into its native response shape (HTTP status
// vs. MCP CallToolResult) without duplicating any of the business logic.
//
// Helpers extracted in US-002: discovery + project setup (5 tools).
// Helpers extracted in US-003: node lifecycle (add/delete/move/reorder).
// Future stories add patch_node + connector helpers alongside these.

import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { type ZodIssue, z } from 'zod';
import { writeFileAtomic } from './atomic-write.ts';
import { mergeFlowAndStyle, splitFlow } from './merge.ts';
import {
  EXTERNALIZED_NODE_FIELDS,
  externalizedFieldsForNodeType,
  nodeFileAbsPath,
  nodeFileRef,
  removeNodeDir,
  writeNodeFile,
} from './node-files.ts';
import { seeflowHome } from './paths.ts';
import { type Registry, slugify } from './registry.ts';
import {
  ColorTokenSchema,
  EdgePinSchema,
  type Flow,
  FlowSchema,
  PlayActionSchema,
  type ResolvedFlow,
  ResolvedFlowSchema,
  ShapeKindSchema,
  SourceHandleIdSchema,
  StateSourceSchema,
  StatusActionSchema,
  StyleSchema,
  TargetHandleIdSchema,
} from './schema.ts';
import { writeSdkEmitIfNeeded } from './sdk-writer.ts';
import { shortId } from './short-id.ts';
import { type FlowSnapshot, type FlowWatcher, readMergedFlow } from './watcher.ts';

const DEFAULT_FLOW_RELATIVE_PATH = '.seeflow/flow.json';

export const RegisterBodySchema = z.object({
  name: z.string().min(1).optional(),
  repoPath: z.string().min(1),
  flowPath: z.string().min(1),
});
export type RegisterBody = z.infer<typeof RegisterBodySchema>;

export const CreateProjectBodySchema = z.object({
  name: z.string().min(1),
});
export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;

export const PositionBodySchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});
export type PositionBody = z.infer<typeof PositionBodySchema>;

// Reorder a node within `demo.nodes[]`. The four ops mirror the typical
// "send backward / bring forward / to back / to front" actions; `toIndex`
// pins the node back to a captured absolute index so undo for `forward` /
// `backward` from the middle is faithful even under concurrent edits.
export const ReorderBodySchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('forward') }),
  z.object({ op: z.literal('backward') }),
  z.object({ op: z.literal('toFront') }),
  z.object({ op: z.literal('toBack') }),
  z.object({ op: z.literal('toIndex'), index: z.number().int().nonnegative() }),
]);
export type ReorderBody = z.infer<typeof ReorderBodySchema>;

// Partial node update body. Top-level `position` lands on node.position; every
// other key lands inside node.data. Final validity is enforced by re-parsing
// the whole demo through ResolvedFlowSchema after the merge — this body schema just
// rejects unknown top-level keys to catch typos.
export const NodePatchBodySchema = z
  .object({
    position: PositionBodySchema.optional(),
    name: z.string().optional(),
    borderColor: ColorTokenSchema.optional(),
    backgroundColor: ColorTokenSchema.optional(),
    borderSize: z.number().positive().optional(),
    borderWidth: z.number().min(1).max(8).optional(),
    borderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
    fontSize: z.number().positive().optional(),
    textColor: ColorTokenSchema.optional(),
    cornerRadius: z.number().min(0).optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    // htmlNode-only: when true, the renderer measures content and React Flow
    // sizes the wrapper around it. mergeNodeUpdates enforces the invariant
    // that autoSize:true never coexists with persisted width/height.
    autoSize: z.boolean().optional(),
    shape: ShapeKindSchema.optional(),
    // iconNode-only: stroke color token. Lands at data.color; ResolvedFlowSchema's
    // post-merge reparse gates that this is only valid on an iconNode.
    color: ColorTokenSchema.optional(),
    // iconNode-only: glyph stroke width. Lands at data.strokeWidth; the
    // post-merge reparse gates the [0.5, 4] bound and arm validity.
    strokeWidth: z.number().min(0.5).max(4).optional(),
    // iconNode-only: accessible alt text for the icon. Lands at data.alt.
    alt: z.string().optional(),
    // kebab-case Lucide icon name. Lands at data.icon. The post-merge reparse
    // enforces the schema's `.min(1)` non-empty rule for nodes that require
    // icon (iconNode), and gates which variants allow it. Explicit `null`
    // clears the field (mergeNodeUpdates strips the key from disk) — mirrors
    // the empty-string clear convention used for description / detail.
    icon: z.string().min(1).nullable().optional(),
    // Three-field consolidation: free-text metadata on every node variant.
    // Empty string on `description` or `detail` is the documented clear-on-
    // serialize signal — `mergeNodeUpdates` strips the key from disk.
    description: z.string().optional(),
    detail: z.string().optional(),
    // htmlNode-only: inline HTML content. Externalized to
    // `<project>/.seeflow/nodes/<id>/view.html` by patchNodeImpl; the file://
    // ref on the node persists. Empty string empties the file but keeps the ref.
    html: z.string().optional(),
    // P5 overlay attach: lets the skill (or any consumer) wire executable
    // behaviour onto a previously-created node without re-issuing it. Final
    // validity is enforced by the post-merge ResolvedFlowSchema reparse —
    // e.g. statusAction is only valid on playNode / stateNode.
    playAction: PlayActionSchema.optional(),
    statusAction: StatusActionSchema.optional(),
    stateSource: StateSourceSchema.optional(),
  })
  .strict();
export type NodePatchBody = z.infer<typeof NodePatchBodySchema>;

// Apply a partial PATCH body to a raw on-disk node. `position` lives at the
// node root; every other key lives inside `data`. We mutate the raw parsed
// JSON directly so unknown forward-compat fields the schema doesn't yet
// recognize survive the round-trip untouched.
const NODE_DATA_PATCH_KEYS = [
  'name',
  'borderColor',
  'backgroundColor',
  'borderSize',
  'borderWidth',
  'borderStyle',
  'fontSize',
  'textColor',
  'cornerRadius',
  'width',
  'height',
  'autoSize',
  'shape',
  'color',
  'strokeWidth',
  'alt',
  'icon',
  'description',
  'detail',
  'html',
  'playAction',
  'statusAction',
  'stateSource',
] as const satisfies ReadonlyArray<keyof NodePatchBody>;

const EXTERNALIZED_FIELD_NAMES = new Set<string>(EXTERNALIZED_NODE_FIELDS.map((e) => e.field));

export const mergeNodeUpdates = (node: Record<string, unknown>, updates: NodePatchBody): void => {
  if (updates.position !== undefined) {
    node.position = updates.position;
  }
  const dataAny = node.data;
  const data: Record<string, unknown> =
    dataAny && typeof dataAny === 'object' && !Array.isArray(dataAny)
      ? (dataAny as Record<string, unknown>)
      : {};
  let touchedData = false;
  for (const key of NODE_DATA_PATCH_KEYS) {
    if (updates[key] === undefined) continue;
    // Externalized fields (detail, ...) flow through patchNodeImpl's own
    // pre-process — keep merge out of it so the file:// ref on disk stays
    // stable and the file is the source of truth for content.
    if (EXTERNALIZED_FIELD_NAMES.has(key)) continue;
    // Empty string on the two free-text metadata fields is the documented
    // clear-on-serialize signal — strip the key instead of writing "" to disk
    // so flow.json stays compact and round-tripping a cleared node doesn't
    // reintroduce the field.
    if ((key === 'description' || key === 'detail') && updates[key] === '') {
      if (key in data) {
        delete data[key];
        touchedData = true;
      }
      continue;
    }
    // US-009: explicit null on icon is the clear signal (`.min(1)` rules out
    // the empty-string convention used for description / detail). Strip the
    // key from disk so a re-parsed demo doesn't reintroduce it.
    if (key === 'icon' && updates[key] === null) {
      if (key in data) {
        delete data[key];
        touchedData = true;
      }
      continue;
    }
    data[key] = updates[key];
    touchedData = true;
  }

  // htmlNode-only invariant enforcement:
  //   autoSize === true ⊻ (width and height set).
  // autoSize: true is the dominant signal — it strips width/height even if
  // the same patch tried to write them. Writing width/height implicitly
  // flips autoSize to false.
  if (node.type === 'htmlNode') {
    // The autoSize invariant requires `width`/`height` to be ABSENT from the
    // serialized JSON when autoSize is true — not present with value
    // `undefined` (which would serialize as a stray `"width": null` or get
    // dropped inconsistently across the wire). `delete` is the right tool
    // here; the rest of the function is hot on read, not write.
    if (updates.autoSize === true) {
      if ('width' in data) {
        // biome-ignore lint/performance/noDelete: invariant requires key absence on serialize
        delete data.width;
        touchedData = true;
      }
      if ('height' in data) {
        // biome-ignore lint/performance/noDelete: invariant requires key absence on serialize
        delete data.height;
        touchedData = true;
      }
    } else if (updates.width !== undefined || updates.height !== undefined) {
      data.autoSize = false;
      touchedData = true;
    }
  }

  if (touchedData) {
    node.data = data;
  }
};

export interface OperationsDeps {
  registry: Registry;
  watcher?: FlowWatcher;
  /**
   * Override the base directory for new projects. Defaults to seeflowHome()
   * — `${SEEFLOW_WORKSPACE}/.seeflow` inside Docker, `~/.seeflow` locally.
   * Tests inject a tmp dir.
   */
  projectBaseDir?: string;
}

export interface FlowListItem {
  id: string;
  slug: string;
  name: string;
  repoPath: string;
  lastModified: number;
  valid: boolean;
}

export interface FlowGetResponse {
  id: string;
  slug: string;
  name: string;
  filePath: string;
  flow: ResolvedFlow | null;
  valid: boolean;
  error: string | null;
}

export interface RegisterFlowSuccess {
  id: string;
  slug: string;
  sdk: { outcome: 'written' | 'present' | 'skipped'; filePath: string | null };
}

export interface CreateProjectSuccess {
  id: string;
  slug: string;
  scaffolded: boolean;
}

export type ListFlowsOutcome = { kind: 'ok'; data: FlowListItem[] };

export type GetFlowOutcome =
  | { kind: 'ok'; data: FlowGetResponse }
  | { kind: 'notFound' }
  | { kind: 'fileNotFound'; path: string };

export type RegisterFlowOutcome =
  | { kind: 'ok'; data: RegisterFlowSuccess }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; detail: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'sdkWriteFailed'; id: string; slug: string; message: string };

export type DeleteFlowOutcome = { kind: 'ok' } | { kind: 'notFound' };

export type CreateProjectOutcome =
  | { kind: 'ok'; data: CreateProjectSuccess }
  | { kind: 'badJson'; detail: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'scaffoldFailed'; message: string }
  | { kind: 'sdkWriteFailed'; message: string };

// Outcomes for the four node-lifecycle helpers. Every variant lines up with
// an existing REST error response so api.ts can translate them back to the
// same status code + JSON body it used to emit directly.
export type AddNodeOutcome =
  | { kind: 'ok'; data: { id: string; node: Record<string, unknown> } }
  | { kind: 'flowNotFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'writeFailed'; message: string };

// Bulk add: ok payload carries every created node so the caller can read
// server-assigned ids back. duplicateIdInBatch fires when two items in the
// same request share an id; idAlreadyExists fires when a request id collides
// with a node already on disk. Both are pre-write rejections, no rollback
// needed. writeFailed/badSchema cover the post-mutation failure modes.
export type AddNodesBulkOutcome =
  | { kind: 'ok'; data: { nodes: Array<{ id: string; node: Record<string, unknown> }> } }
  | { kind: 'flowNotFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'duplicateIdInBatch'; id: string }
  | { kind: 'idAlreadyExists'; id: string }
  | { kind: 'writeFailed'; message: string };

export type DeleteNodeOutcome =
  | { kind: 'ok' }
  | { kind: 'flowNotFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'unknownNode' }
  | { kind: 'writeFailed'; message: string };

export type MoveNodeOutcome =
  | { kind: 'ok'; data: { position: PositionBody } }
  | { kind: 'flowNotFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'unknownNode' }
  | { kind: 'writeFailed'; message: string };

export type ReorderNodeOutcome =
  | { kind: 'ok' }
  | { kind: 'flowNotFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'unknownNode' }
  | { kind: 'writeFailed'; message: string };

export type PatchNodeOutcome =
  | { kind: 'ok' }
  | { kind: 'flowNotFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'unknownNode' }
  | { kind: 'writeFailed'; message: string };

// Partial connector update body. Strict at the top level so client typos
// surface as 400. Per-kind invariants (e.g. kind='event' requires eventName)
// are enforced post-merge by re-parsing the whole demo through ResolvedFlowSchema.
const ConnectorKindSchema = z.enum(['http', 'event', 'queue', 'default']);
export const ConnectorPatchBodySchema = z
  .object({
    label: z.string().optional(),
    style: z.enum(['solid', 'dashed', 'dotted']).optional(),
    color: ColorTokenSchema.optional(),
    direction: z.enum(['forward', 'backward', 'both', 'none']).optional(),
    borderSize: z.number().positive().optional(),
    path: z.enum(['curve', 'step']).optional(),
    // US-018: per-connector label font size (mirrors NodeVisualBaseShape.fontSize).
    fontSize: z.number().positive().optional(),
    kind: ConnectorKindSchema.optional(),
    eventName: z.string().optional(),
    queueName: z.string().optional(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    url: z.string().optional(),
    // Reconnect: drag an edge endpoint onto another node's handle. The
    // post-merge ResolvedFlowSchema parse rejects dangling references, so we don't
    // need a referential check here.
    source: z.string().min(1).optional(),
    target: z.string().min(1).optional(),
    // Reconnect to a different handle on the same (or a new) node. Handle ids
    // identify which side (top/right/bottom/left) of the node the connector
    // attaches to (US-013); the role is locked — `sourceHandle` must be a
    // source-side id, `targetHandle` must be a target-side id (US-022).
    // Nullable so a body-drop reconnect (US-025) can clear a previously-pinned
    // handle id by sending `null`; mergeConnectorUpdates deletes the field
    // when the value is null.
    sourceHandle: SourceHandleIdSchema.nullable().optional(),
    targetHandle: TargetHandleIdSchema.nullable().optional(),
    // US-021: auto-pick flags. Originally written by the picker on body-drop
    // create / reconnect. US-025 keeps the schema shape but redefines the
    // semantics: `true`/absent means "render floating" against the line
    // through the two node centers; `false` means "render pinned to the
    // stored handle id".
    sourceHandleAutoPicked: z.boolean().optional(),
    targetHandleAutoPicked: z.boolean().optional(),
    // US-007: explicit perimeter pin for each endpoint. Sending an EdgePin
    // pins the endpoint to `(side, t)` against the connected node's live
    // bbox so it survives moves and resizes. Nullable so the right-click
    // Unpin flow can clear a stored pin by sending `null`;
    // mergeConnectorUpdates deletes the field when the value is null.
    sourcePin: EdgePinSchema.nullable().optional(),
    targetPin: EdgePinSchema.nullable().optional(),
  })
  .strict();
export type ConnectorPatchBody = z.infer<typeof ConnectorPatchBodySchema>;

// Kind-specific connector fields. When `kind` changes via PATCH, these are
// dropped first so the resulting connector doesn't carry phantom payloads
// from the previous kind (e.g. an event→default change leaving eventName
// behind, which ResolvedFlowSchema would silently strip on parse but leave on disk).
const CONNECTOR_KIND_FIELDS = ['method', 'url', 'eventName', 'queueName'] as const;

export const mergeConnectorUpdates = (
  conn: Record<string, unknown>,
  updates: ConnectorPatchBody,
): void => {
  if (updates.kind !== undefined && updates.kind !== conn.kind) {
    for (const key of CONNECTOR_KIND_FIELDS) {
      delete conn[key];
    }
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    // US-025: explicit null in the patch body means "clear this field on
    // disk". Used by reconnect-to-body to drop a previously-pinned handle
    // id when the endpoint flips back to floating.
    if (value === null) {
      delete conn[key];
      continue;
    }
    conn[key] = value;
  }
};

// Bulk-add envelopes. Body shape gated here; per-item shape is implicit and
// enforced by ResolvedFlowSchema after the whole batch is merged in — same
// pattern the singular add endpoints already rely on. The 100-item cap keeps
// one SSE broadcast payload reasonable; the LLM caller is meant to chunk if
// it ever needs more.
const BULK_MAX_ITEMS = 100;
export const NodesBulkBodySchema = z.object({
  nodes: z.array(z.record(z.unknown())).min(1).max(BULK_MAX_ITEMS),
});
export type NodesBulkBody = z.infer<typeof NodesBulkBodySchema>;
export const ConnectorsBulkBodySchema = z.object({
  connectors: z.array(z.record(z.unknown())).min(1).max(BULK_MAX_ITEMS),
});
export type ConnectorsBulkBody = z.infer<typeof ConnectorsBulkBodySchema>;

export type AddConnectorOutcome =
  | { kind: 'ok'; data: { id: string } }
  | { kind: 'flowNotFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'writeFailed'; message: string };

export type AddConnectorsBulkOutcome =
  | { kind: 'ok'; data: { connectors: Array<{ id: string }> } }
  | { kind: 'flowNotFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'duplicateIdInBatch'; id: string }
  | { kind: 'idAlreadyExists'; id: string }
  | { kind: 'writeFailed'; message: string };

export type PatchConnectorOutcome =
  | { kind: 'ok' }
  | { kind: 'flowNotFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'unknownConnector' }
  | { kind: 'writeFailed'; message: string };

export type DeleteConnectorOutcome =
  | { kind: 'ok' }
  | { kind: 'flowNotFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'unknownConnector' }
  | { kind: 'writeFailed'; message: string };

export const resolveFilePath = (repoPath: string, flowPath: string): string =>
  isAbsolute(flowPath) ? flowPath : join(repoPath, flowPath);

// Per-demo serialization: read-modify-write of the demo file isn't atomic
// across multiple PATCHes, so two concurrent drags would race (later writer's
// older read clobbers the earlier writer's update). We chain writes per
// flowId so the read+write sequence is effectively serialized.
const flowWriteChains = new Map<string, Promise<unknown>>();
export const withFlowWriteLock = <T>(flowId: string, fn: () => Promise<T>): Promise<T> => {
  const prev = flowWriteChains.get(flowId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // Replace with a tail that swallows errors so the chain keeps moving even
  // if one write fails — but the original promise still rejects to its caller.
  flowWriteChains.set(
    flowId,
    next.catch(() => undefined),
  );
  return next as Promise<T>;
};

/**
 * Atomic write: writes to a sibling tempfile then renames over the target.
 * `rename(2)` is atomic on POSIX, so a process reading mid-write either sees
 * the old file or the new one — never a half-written one. This keeps user
 * editor diffs clean (single fs.watch event for the rename) and means a crash
 * during write can never corrupt the original.
 */
export { writeFileAtomic } from './atomic-write.ts';

/**
 * Read flow.json + optional style.json, return the raw parsed JSON so
 * operations can mutate the merged-flow shape without losing forward-compat
 * fields. Returns null if the flow file is missing or invalid JSON.
 */
type ReadRawResult =
  | { kind: 'ok'; rawFlow: Record<string, unknown>; rawStyle: Record<string, unknown> }
  | { kind: 'badJson'; message: string };

function readRawFlowAndStyle(flowPath: string): ReadRawResult {
  let rawFlow: unknown;
  try {
    rawFlow = JSON.parse(readFileSync(flowPath, 'utf8'));
  } catch (err) {
    return { kind: 'badJson', message: err instanceof Error ? err.message : String(err) };
  }
  if (!rawFlow || typeof rawFlow !== 'object' || Array.isArray(rawFlow)) {
    return { kind: 'badJson', message: 'flow.json is not an object' };
  }
  const stylePath = join(dirname(flowPath), 'style.json');
  let rawStyle: Record<string, unknown> = {};
  if (existsSync(stylePath)) {
    try {
      const parsed = JSON.parse(readFileSync(stylePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { kind: 'badJson', message: 'style.json is not an object' };
      }
      rawStyle = parsed as Record<string, unknown>;
    } catch (err) {
      return {
        kind: 'badJson',
        message: `style.json: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  return { kind: 'ok', rawFlow: rawFlow as Record<string, unknown>, rawStyle };
}

/**
 * Mutate-in-place helper: read both files into a merged Flow shape, hand it
 * to the mutator, then split back into flow + style and atomically
 * write both. The mutator returns either { kind: 'ok' } or a discriminated
 * outcome for early-exits (e.g. unknownNode). On schema-validation failure,
 * neither file is written.
 */
type MutateMergedFlowMutator<E> = (flow: {
  version: number;
  name: string;
  resetAction?: unknown;
  nodes: Array<Record<string, unknown>>;
  connectors: Array<Record<string, unknown>>;
}) => { kind: 'ok' } | E;

type MutateMergedFlowOk = {
  kind: 'ok';
  /** Validated post-write merged flow — hand straight to watcher.notifyWritten. */
  snap: FlowSnapshot;
  /** Exact bytes written to flow.json — used for own-write hash dedupe. */
  flowContent: string;
  /** Exact bytes written to style.json, or '' when style.json was deleted / never existed. */
  styleContent: string;
};

type MutateMergedFlowResult<E> =
  | MutateMergedFlowOk
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'writeFailed'; message: string }
  | E;

export async function mutateMergedFlow<E extends { kind: string }>(
  flowPath: string,
  mutator: MutateMergedFlowMutator<E>,
): Promise<MutateMergedFlowResult<E>> {
  const read = readRawFlowAndStyle(flowPath);
  if (read.kind === 'badJson') return { kind: 'badJson', message: read.message };

  const flowParse = FlowSchema.safeParse(read.rawFlow);
  if (!flowParse.success) return { kind: 'badSchema', issues: flowParse.error.issues };
  const styleParse = StyleSchema.safeParse(read.rawStyle);
  if (!styleParse.success) return { kind: 'badSchema', issues: styleParse.error.issues };

  const merged = mergeFlowAndStyle(flowParse.data, styleParse.data) as unknown as {
    version: number;
    name: string;
    resetAction?: unknown;
    nodes: Array<Record<string, unknown>>;
    connectors: Array<Record<string, unknown>>;
  };

  const outcome = mutator(merged);
  // E is generic — TS can't prove the narrowed branch isn't `{ kind: 'ok' }`,
  // so we cast. By convention, E never reuses `'ok'` as a discriminant.
  if (outcome.kind !== 'ok') return outcome as E;

  // Final ResolvedFlowSchema parse so per-kind invariants (event needs eventName, etc.)
  // surface honestly instead of being silently papered over.
  const finalParse = ResolvedFlowSchema.safeParse(merged);
  if (!finalParse.success) return { kind: 'badSchema', issues: finalParse.error.issues };

  const { flow, style } = splitFlow(merged);
  // Re-validate the post-split files to catch the rare case where a forward-
  // compat field landed in the wrong bucket. Style validation is a no-op for
  // empty maps; flow revalidation rejects unknown keys via strict().
  const flowCheck = FlowSchema.safeParse(flow);
  if (!flowCheck.success) return { kind: 'badSchema', issues: flowCheck.error.issues };
  const styleCheck = StyleSchema.safeParse(style);
  if (!styleCheck.success) return { kind: 'badSchema', issues: styleCheck.error.issues };

  const stylePath = join(dirname(flowPath), 'style.json');
  const styleIsEmpty =
    (!style.nodes || Object.keys(style.nodes as Record<string, unknown>).length === 0) &&
    (!style.connectors || Object.keys(style.connectors as Record<string, unknown>).length === 0);

  // Pre-compute the bytes we're about to write so the caller can hand them
  // straight to watcher.notifyWritten without re-reading the file.
  const flowContent = `${JSON.stringify(flow, null, 2)}\n`;
  const styleContent = styleIsEmpty ? '' : `${JSON.stringify(style, null, 2)}\n`;

  try {
    writeFileAtomic(flowPath, flowContent);
  } catch (err) {
    return { kind: 'writeFailed', message: err instanceof Error ? err.message : String(err) };
  }

  try {
    if (styleIsEmpty) {
      if (existsSync(stylePath)) unlinkSync(stylePath);
    } else {
      writeFileAtomic(stylePath, styleContent);
    }
  } catch (err) {
    return { kind: 'writeFailed', message: err instanceof Error ? err.message : String(err) };
  }

  // Re-read through readMergedFlow so the snapshot we hand to notifyWritten
  // carries file://-resolved content (detail.md, view.html, …). The in-memory
  // `merged` tree above still holds raw `file://<name>` strings — broadcasting
  // it would clobber the watcher's resolved seed and ship unresolved refs to
  // every SSE subscriber until the next reparse.
  const reread = readMergedFlow(flowPath);
  const snap: FlowSnapshot = reread.valid
    ? {
        flow: reread.flow,
        valid: true,
        error: null,
        filePath: flowPath,
        parsedAt: Date.now(),
      }
    : {
        flow: finalParse.data as ResolvedFlow,
        valid: true,
        error: null,
        filePath: flowPath,
        parsedAt: Date.now(),
      };
  return { kind: 'ok', snap, flowContent, styleContent };
}

/**
 * Wrap a mutation in the write lock AND broadcast a flow:reload directly
 * from the post-write snapshot. Every mutation endpoint that updates flow
 * state should go through this so:
 *   1. The watcher's content-hash dedupe suppresses the fs-watcher echo for
 *      this same write — no double broadcast, no double reparse.
 *   2. The SSE event reaches the client without waiting for the fs debounce.
 *
 * For mutators whose ok branch carries no payload, `E` should be `never`.
 */
export async function mutateMergedFlowAndBroadcast<E extends { kind: string }>(
  deps: OperationsDeps,
  flowId: string,
  flowPath: string,
  mutator: MutateMergedFlowMutator<E>,
): Promise<MutateMergedFlowResult<E>> {
  return withFlowWriteLock(flowId, async () => {
    const result = await mutateMergedFlow(flowPath, mutator);
    if (result.kind === 'ok') {
      // E is generic, so TS can't prove the ok branch is MutateMergedFlowOk —
      // cast here, parallel to the cast inside mutateMergedFlow itself.
      const ok = result as MutateMergedFlowOk;
      deps.watcher?.notifyWritten(flowId, ok.snap, ok.flowContent, ok.styleContent);
    }
    return result;
  });
}

export const reorderNodes = (
  nodes: Array<Record<string, unknown>>,
  fromIdx: number,
  body: ReorderBody,
): boolean => {
  const len = nodes.length;
  switch (body.op) {
    case 'forward': {
      if (fromIdx >= len - 1) return false;
      const tmp = nodes[fromIdx];
      const next = nodes[fromIdx + 1];
      if (tmp === undefined || next === undefined) return false;
      nodes[fromIdx] = next;
      nodes[fromIdx + 1] = tmp;
      return true;
    }
    case 'backward': {
      if (fromIdx <= 0) return false;
      const tmp = nodes[fromIdx];
      const prev = nodes[fromIdx - 1];
      if (tmp === undefined || prev === undefined) return false;
      nodes[fromIdx] = prev;
      nodes[fromIdx - 1] = tmp;
      return true;
    }
    case 'toFront': {
      if (fromIdx === len - 1) return false;
      const [removed] = nodes.splice(fromIdx, 1);
      if (removed === undefined) return false;
      nodes.push(removed);
      return true;
    }
    case 'toBack': {
      if (fromIdx === 0) return false;
      const [removed] = nodes.splice(fromIdx, 1);
      if (removed === undefined) return false;
      nodes.unshift(removed);
      return true;
    }
    case 'toIndex': {
      const target = Math.min(Math.max(body.index, 0), len - 1);
      if (target === fromIdx) return false;
      const [removed] = nodes.splice(fromIdx, 1);
      if (removed === undefined) return false;
      nodes.splice(target, 0, removed);
      return true;
    }
  }
};

export function listDemosImpl(deps: OperationsDeps): ListFlowsOutcome {
  const data = deps.registry.list().map((e) => {
    const fullPath = resolveFilePath(e.repoPath, e.flowPath);
    const fileExists = existsSync(fullPath);
    return {
      id: e.id,
      slug: e.slug,
      name: e.name,
      repoPath: e.repoPath,
      lastModified: e.lastModified,
      valid: e.valid && fileExists,
    };
  });
  return { kind: 'ok', data };
}

export async function getFlowImpl(deps: OperationsDeps, flowId: string): Promise<GetFlowOutcome> {
  const { registry, watcher } = deps;
  const entry = registry.getById(flowId);
  if (!entry) return { kind: 'notFound' };

  const fullPath = resolveFilePath(entry.repoPath, entry.flowPath);
  const snap = watcher?.snapshot(flowId) ?? watcher?.reparse(flowId) ?? null;

  const buildResponse = (s: FlowSnapshot): FlowGetResponse => ({
    id: entry.id,
    slug: entry.slug,
    name: entry.name,
    filePath: fullPath,
    flow: s.flow,
    valid: s.valid,
    error: s.valid ? null : s.error,
  });

  if (snap) return { kind: 'ok', data: buildResponse(snap) };

  // No watcher available — fall back to a synchronous read so MCP / CLI
  // callers without a long-lived watcher still get a current snapshot.
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  const result = readMergedFlow(fullPath);
  return {
    kind: 'ok',
    data: buildResponse({
      flow: result.flow,
      valid: result.valid,
      error: result.error,
      filePath: fullPath,
      parsedAt: Date.now(),
    }),
  };
}

export async function registerFlowImpl(
  deps: OperationsDeps,
  body: RegisterBody,
): Promise<RegisterFlowOutcome> {
  const { registry, watcher } = deps;
  const { repoPath, flowPath } = body;
  const fullPath = resolveFilePath(repoPath, flowPath);

  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  const merged = readMergedFlow(fullPath);
  if (merged.error && merged.flow === null) {
    if (merged.error.startsWith('Invalid JSON')) {
      return { kind: 'badJson', detail: merged.error };
    }
    // Schema validation failed — surface the issues as a bad-schema outcome
    // by re-running parse to get ZodIssue[].
    let rawFlow: unknown;
    try {
      rawFlow = JSON.parse(readFileSync(fullPath, 'utf8'));
    } catch (err) {
      return { kind: 'badJson', detail: String(err) };
    }
    const flowParse = FlowSchema.safeParse(rawFlow);
    if (!flowParse.success) return { kind: 'badSchema', issues: flowParse.error.issues };
    return { kind: 'badJson', detail: merged.error };
  }
  if (!merged.flow) return { kind: 'badJson', detail: merged.error ?? 'unknown error' };

  const lastModified = statSync(fullPath).mtimeMs;
  const entry = registry.upsert({
    name: body.name ?? merged.flow.name,
    repoPath,
    flowPath,
    valid: true,
    lastModified,
  });

  watcher?.watch(entry.id);

  let sdkResult: { outcome: 'written' | 'present' | 'skipped'; filePath: string | null };
  try {
    sdkResult = writeSdkEmitIfNeeded(repoPath, merged.flow);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'sdkWriteFailed', id: entry.id, slug: entry.slug, message };
  }

  return {
    kind: 'ok',
    data: {
      id: entry.id,
      slug: entry.slug,
      sdk: { outcome: sdkResult.outcome, filePath: sdkResult.filePath },
    },
  };
}

export function deleteFlowImpl(deps: OperationsDeps, idOrSlug: string): DeleteFlowOutcome {
  const { registry, watcher } = deps;
  const entry = registry.getById(idOrSlug) ?? registry.getBySlug(idOrSlug);
  if (!entry) return { kind: 'notFound' };
  watcher?.unwatch(entry.id);
  registry.remove(entry.id);
  return { kind: 'ok' };
}

export async function createProjectImpl(
  deps: OperationsDeps,
  body: CreateProjectBody,
): Promise<CreateProjectOutcome> {
  const { registry, watcher } = deps;
  const { name } = body;
  const baseDir = deps.projectBaseDir ?? seeflowHome();
  const folderPath = join(baseDir, slugify(name));

  const demoFullPath = join(folderPath, DEFAULT_FLOW_RELATIVE_PATH);

  if (existsSync(demoFullPath)) {
    let raw: unknown;
    try {
      raw = await Bun.file(demoFullPath).json();
    } catch (err) {
      return { kind: 'badJson', detail: err instanceof Error ? err.message : String(err) };
    }
    const flowParse = FlowSchema.safeParse(raw);
    if (!flowParse.success) return { kind: 'badSchema', issues: flowParse.error.issues };

    const lastModified = statSync(demoFullPath).mtimeMs;
    const entry = registry.upsert({
      name,
      repoPath: folderPath,
      flowPath: DEFAULT_FLOW_RELATIVE_PATH,
      valid: true,
      lastModified,
    });
    watcher?.watch(entry.id);
    return { kind: 'ok', data: { id: entry.id, slug: entry.slug, scaffolded: false } };
  }

  // Flow-only scaffold: empty nodes/connectors, no style.json needed.
  const scaffold: Flow = { version: 2, name, nodes: [], connectors: [] };

  try {
    mkdirSync(join(folderPath, '.seeflow'), { recursive: true });
    writeFileSync(demoFullPath, `${JSON.stringify(scaffold, null, 2)}\n`);
  } catch (err) {
    return { kind: 'scaffoldFailed', message: err instanceof Error ? err.message : String(err) };
  }

  // Same SDK-emit path as the CLI register flow. For a fresh scaffold with no
  // event-bound state nodes this returns 'skipped' and writes nothing —
  // retained for parity with `seeflow register`.
  try {
    writeSdkEmitIfNeeded(folderPath, scaffold);
  } catch (err) {
    return { kind: 'sdkWriteFailed', message: err instanceof Error ? err.message : String(err) };
  }

  const lastModified = statSync(demoFullPath).mtimeMs;
  const entry = registry.upsert({
    name,
    repoPath: folderPath,
    flowPath: DEFAULT_FLOW_RELATIVE_PATH,
    valid: true,
    lastModified,
  });
  watcher?.watch(entry.id);
  return { kind: 'ok', data: { id: entry.id, slug: entry.slug, scaffolded: true } };
}

// Append a new node to the demo. Auto-generates an id when absent; ResolvedFlowSchema
// is re-run on the post-mutation raw object before commit so a malformed
// payload never produces a half-written file.
export async function addNodeImpl(
  deps: OperationsDeps,
  flowId: string,
  nodeBody: Record<string, unknown>,
): Promise<AddNodeOutcome> {
  const entry = deps.registry.getById(flowId);
  if (!entry) return { kind: 'flowNotFound' };

  const newNode = { ...nodeBody };
  if (typeof newNode.id !== 'string' || newNode.id.length === 0) {
    newNode.id = `node-${shortId()}`;
  }
  const newId = newNode.id as string;
  // Default position so the post-merge ResolvedFlowSchema parse passes. Position lives
  // on style.json after the split — callers who care set it explicitly.
  if (!newNode.position || typeof newNode.position !== 'object') {
    newNode.position = { x: 0, y: 0 };
  }

  // Generic spec-driven externalization. For each spec entry that applies to
  // this node type, capture inbound content (default empty string), replace
  // data[field] with the file:// ref, and queue a write inside the mutator
  // below — so flow.json only commits when the write succeeded.
  const externalized: Array<{ absPath: string; content: string }> = [];
  {
    const dataIsRecord =
      newNode.data !== null && typeof newNode.data === 'object' && !Array.isArray(newNode.data);
    const data: Record<string, unknown> = dataIsRecord
      ? { ...(newNode.data as Record<string, unknown>) }
      : {};
    for (const { field, fileName } of externalizedFieldsForNodeType(newNode.type)) {
      const incoming = data[field];
      const content = typeof incoming === 'string' ? incoming : '';
      data[field] = nodeFileRef(newId, fileName);
      externalized.push({
        absPath: nodeFileAbsPath(entry.repoPath, newId, fileName),
        content,
      });
    }
    newNode.data = data;
  }

  const fullPath = resolveFilePath(entry.repoPath, entry.flowPath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  const result = await mutateMergedFlowAndBroadcast<{ kind: 'writeFailed'; message: string }>(
    deps,
    flowId,
    fullPath,
    (flow) => {
      flow.nodes.push(newNode);
      for (const ext of externalized) {
        try {
          writeNodeFile(ext.absPath, ext.content);
        } catch (err) {
          return { kind: 'writeFailed', message: err instanceof Error ? err.message : String(err) };
        }
      }
      return { kind: 'ok' };
    },
  );

  if (result.kind === 'ok') return { kind: 'ok', data: { id: newId, node: newNode } };
  return result;
}

// Bulk add — N nodes in one read-validate-write-broadcast cycle. Transactional:
// any single item failing the post-mutation ResolvedFlowSchema parse rolls
// back the whole batch (nothing on flow.json, no per-node folders created).
// Per-node externalization runs per item exactly like the singular path; the
// queued file writes all happen inside the mutator so a writeFailed on item
// K leaves items 0..K-1 with stranded folders — same shape as the singular
// path's writeFailed, but amplified by N. Caller is expected to retry.
export async function addNodesBulkImpl(
  deps: OperationsDeps,
  flowId: string,
  body: NodesBulkBody,
): Promise<AddNodesBulkOutcome> {
  const entry = deps.registry.getById(flowId);
  if (!entry) return { kind: 'flowNotFound' };

  // Pre-allocate ids + capture externalization writes per item. Doing this
  // outside the mutator means the duplicateIdInBatch check runs before any
  // disk IO; the collide-with-existing check happens inside the mutator where
  // it can see the freshly-read flow.nodes.
  const prepared: Array<{
    id: string;
    node: Record<string, unknown>;
    externalized: Array<{ absPath: string; content: string }>;
  }> = [];
  const idsInBatch = new Set<string>();
  for (const item of body.nodes) {
    const newNode = { ...item };
    if (typeof newNode.id !== 'string' || newNode.id.length === 0) {
      newNode.id = `node-${shortId()}`;
    }
    const newId = newNode.id as string;
    if (idsInBatch.has(newId)) return { kind: 'duplicateIdInBatch', id: newId };
    idsInBatch.add(newId);
    if (!newNode.position || typeof newNode.position !== 'object') {
      newNode.position = { x: 0, y: 0 };
    }
    const externalized: Array<{ absPath: string; content: string }> = [];
    const dataIsRecord =
      newNode.data !== null && typeof newNode.data === 'object' && !Array.isArray(newNode.data);
    const data: Record<string, unknown> = dataIsRecord
      ? { ...(newNode.data as Record<string, unknown>) }
      : {};
    for (const { field, fileName } of externalizedFieldsForNodeType(newNode.type)) {
      const incoming = data[field];
      const content = typeof incoming === 'string' ? incoming : '';
      data[field] = nodeFileRef(newId, fileName);
      externalized.push({
        absPath: nodeFileAbsPath(entry.repoPath, newId, fileName),
        content,
      });
    }
    newNode.data = data;
    prepared.push({ id: newId, node: newNode, externalized });
  }

  const fullPath = resolveFilePath(entry.repoPath, entry.flowPath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  const result = await mutateMergedFlowAndBroadcast<
    { kind: 'idAlreadyExists'; id: string } | { kind: 'writeFailed'; message: string }
  >(deps, flowId, fullPath, (flow) => {
    const existing = new Set(
      flow.nodes
        .map((n) => (typeof n.id === 'string' ? n.id : null))
        .filter((id): id is string => id !== null),
    );
    for (const p of prepared) {
      if (existing.has(p.id)) return { kind: 'idAlreadyExists', id: p.id };
    }
    for (const p of prepared) {
      flow.nodes.push(p.node);
    }
    for (const p of prepared) {
      for (const ext of p.externalized) {
        try {
          writeNodeFile(ext.absPath, ext.content);
        } catch (err) {
          return { kind: 'writeFailed', message: err instanceof Error ? err.message : String(err) };
        }
      }
    }
    return { kind: 'ok' };
  });

  if (result.kind === 'ok') {
    return {
      kind: 'ok',
      data: { nodes: prepared.map((p) => ({ id: p.id, node: p.node })) },
    };
  }

  // Non-ok branch: the post-mutation ResolvedFlowSchema parse (or a later
  // writeFailed) ran AFTER the mutator already wrote per-node folders. The
  // collide-with-existing check ran first inside the mutator, so any folder
  // at `nodes/<prepared.id>/` was created by this call — safe to cascade.
  // The idAlreadyExists branch returns before any writeNodeFile, so we still
  // try to remove (it's a no-op when the folder doesn't exist).
  for (const p of prepared) {
    removeNodeDir(entry.repoPath, p.id);
  }
  return result;
}

// Remove a node and cascade-delete every connector touching it in a single
// atomic write. Final ResolvedFlowSchema parse stays in place so a pre-existing
// schema violation surfaces honestly instead of being silently papered over.
// After the flow.json write, `removeNodeDir` cascades the node's whole
// `<project>/.seeflow/nodes/<id>/` folder — covering detail.md, view.html,
// and any imageNode upload that lived there.
export async function deleteNodeImpl(
  deps: OperationsDeps,
  flowId: string,
  nodeId: string,
): Promise<DeleteNodeOutcome> {
  const entry = deps.registry.getById(flowId);
  if (!entry) return { kind: 'flowNotFound' };

  const fullPath = resolveFilePath(entry.repoPath, entry.flowPath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  const result = await mutateMergedFlowAndBroadcast<{ kind: 'unknownNode' }>(
    deps,
    flowId,
    fullPath,
    (flow) => {
      const idx = flow.nodes.findIndex((n) => n.id === nodeId);
      if (idx < 0) return { kind: 'unknownNode' };
      flow.nodes.splice(idx, 1);
      flow.connectors = flow.connectors.filter(
        (cn) => cn.source !== nodeId && cn.target !== nodeId,
      );
      return { kind: 'ok' };
    },
  );

  if (result.kind === 'ok') {
    try {
      removeNodeDir(entry.repoPath, nodeId);
    } catch (err) {
      // Best-effort: flow.json is already written and the orphan folder is
      // recoverable manually. ids are random so a future add_node won't collide.
      console.error(`[seeflow] failed to remove nodes/${nodeId}/`, err);
    }
  }

  return result;
}

// Move a single node by writing { x, y } back to its `position` on disk.
// Mutates the *raw* parsed JSON so any unknown forward-compat fields the
// schema doesn't yet recognize survive the round-trip untouched.
export async function moveNodeImpl(
  deps: OperationsDeps,
  flowId: string,
  nodeId: string,
  position: PositionBody,
): Promise<MoveNodeOutcome> {
  const entry = deps.registry.getById(flowId);
  if (!entry) return { kind: 'flowNotFound' };

  const fullPath = resolveFilePath(entry.repoPath, entry.flowPath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  const result = await mutateMergedFlowAndBroadcast<{ kind: 'unknownNode' }>(
    deps,
    flowId,
    fullPath,
    (flow) => {
      const node = flow.nodes.find((n) => n.id === nodeId) as
        | { id: string; position?: { x: number; y: number } }
        | undefined;
      if (!node) return { kind: 'unknownNode' };
      node.position = { x: position.x, y: position.y };
      return { kind: 'ok' };
    },
  );

  if (result.kind === 'ok') {
    return { kind: 'ok', data: { position: { x: position.x, y: position.y } } };
  }
  return result;
}

// Apply a partial PATCH body to a single node. Mutation runs against the
// raw parsed JSON (so unknown forward-compat fields survive a round-trip),
// and the whole demo is re-validated through ResolvedFlowSchema before commit so
// partial writes can't break invariants like the connector→node superRefine.
export async function patchNodeImpl(
  deps: OperationsDeps,
  flowId: string,
  nodeId: string,
  updates: NodePatchBody,
): Promise<PatchNodeOutcome> {
  const entry = deps.registry.getById(flowId);
  if (!entry) return { kind: 'flowNotFound' };

  const fullPath = resolveFilePath(entry.repoPath, entry.flowPath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  return mutateMergedFlowAndBroadcast<
    { kind: 'unknownNode' } | { kind: 'writeFailed'; message: string }
  >(deps, flowId, fullPath, (flow) => {
    const node = flow.nodes.find((n) => n.id === nodeId);
    if (!node) return { kind: 'unknownNode' };
    const externalizedWrites: Array<{
      absPath: string;
      ref: string;
      field: string;
      content: string;
    }> = [];
    for (const { field, fileName } of externalizedFieldsForNodeType(node.type)) {
      const incoming = (updates as Record<string, unknown>)[field];
      if (incoming === undefined) continue;
      externalizedWrites.push({
        absPath: nodeFileAbsPath(entry.repoPath, nodeId, fileName),
        ref: nodeFileRef(nodeId, fileName),
        field,
        content: typeof incoming === 'string' ? incoming : '',
      });
    }
    mergeNodeUpdates(node, updates);
    if (externalizedWrites.length > 0) {
      const dataAny = node.data;
      const data: Record<string, unknown> =
        dataAny && typeof dataAny === 'object' && !Array.isArray(dataAny)
          ? (dataAny as Record<string, unknown>)
          : {};
      for (const w of externalizedWrites) {
        try {
          writeNodeFile(w.absPath, w.content);
        } catch (err) {
          return {
            kind: 'writeFailed',
            message: err instanceof Error ? err.message : String(err),
          };
        }
        data[w.field] = w.ref;
      }
      node.data = data;
    }
    return { kind: 'ok' };
  });
}

// Reorder a node within demo.nodes[] (changes paint order in the canvas).
// A no-op reorder (e.g. forward on the topmost node) returns ok without
// writing so we don't trigger a watcher echo for nothing.
export async function reorderNodeImpl(
  deps: OperationsDeps,
  flowId: string,
  nodeId: string,
  body: ReorderBody,
): Promise<ReorderNodeOutcome> {
  const entry = deps.registry.getById(flowId);
  if (!entry) return { kind: 'flowNotFound' };

  const fullPath = resolveFilePath(entry.repoPath, entry.flowPath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  const result = await mutateMergedFlowAndBroadcast<{ kind: 'unknownNode' } | { kind: 'noop' }>(
    deps,
    flowId,
    fullPath,
    (flow) => {
      const fromIdx = flow.nodes.findIndex((n) => n.id === nodeId);
      if (fromIdx < 0) return { kind: 'unknownNode' };
      const moved = reorderNodes(flow.nodes, fromIdx, body);
      if (!moved) return { kind: 'noop' };
      return { kind: 'ok' };
    },
  );

  if (result.kind === 'noop') return { kind: 'ok' };
  return result as ReorderNodeOutcome;
}

// Append a new connector to demo.connectors. `id` is auto-generated when
// absent and `kind` defaults to 'default' (the no-semantics user-drawn
// variant). Source/target referential integrity is enforced by ResolvedFlowSchema's
// superRefine on the post-mutation parse.
export async function addConnectorImpl(
  deps: OperationsDeps,
  flowId: string,
  connBody: Record<string, unknown>,
): Promise<AddConnectorOutcome> {
  const entry = deps.registry.getById(flowId);
  if (!entry) return { kind: 'flowNotFound' };

  const newConn = { ...connBody };
  if (typeof newConn.id !== 'string' || newConn.id.length === 0) {
    newConn.id = `conn-${shortId()}`;
  }
  if (typeof newConn.kind !== 'string' || newConn.kind.length === 0) {
    newConn.kind = 'default';
  }
  const newId = newConn.id as string;

  const fullPath = resolveFilePath(entry.repoPath, entry.flowPath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  const result = await mutateMergedFlowAndBroadcast<never>(deps, flowId, fullPath, (flow) => {
    flow.connectors.push(newConn);
    return { kind: 'ok' };
  });

  if (result.kind === 'ok') return { kind: 'ok', data: { id: newId } };
  return result;
}

// Bulk add — N connectors in one read-validate-write-broadcast cycle. Same
// transactional shape as addNodesBulkImpl: any single connector failing the
// post-mutation ResolvedFlowSchema parse (dangling source/target, missing
// kind-specific field) rolls back the whole batch. No per-item externalization
// to manage — connectors don't own per-node folders.
export async function addConnectorsBulkImpl(
  deps: OperationsDeps,
  flowId: string,
  body: ConnectorsBulkBody,
): Promise<AddConnectorsBulkOutcome> {
  const entry = deps.registry.getById(flowId);
  if (!entry) return { kind: 'flowNotFound' };

  const prepared: Array<{ id: string; conn: Record<string, unknown> }> = [];
  const idsInBatch = new Set<string>();
  for (const item of body.connectors) {
    const newConn = { ...item };
    if (typeof newConn.id !== 'string' || newConn.id.length === 0) {
      newConn.id = `conn-${shortId()}`;
    }
    if (typeof newConn.kind !== 'string' || newConn.kind.length === 0) {
      newConn.kind = 'default';
    }
    const newId = newConn.id as string;
    if (idsInBatch.has(newId)) return { kind: 'duplicateIdInBatch', id: newId };
    idsInBatch.add(newId);
    prepared.push({ id: newId, conn: newConn });
  }

  const fullPath = resolveFilePath(entry.repoPath, entry.flowPath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  const result = await mutateMergedFlowAndBroadcast<{ kind: 'idAlreadyExists'; id: string }>(
    deps,
    flowId,
    fullPath,
    (flow) => {
      const existing = new Set(
        flow.connectors
          .map((c) => (typeof c.id === 'string' ? c.id : null))
          .filter((id): id is string => id !== null),
      );
      for (const p of prepared) {
        if (existing.has(p.id)) return { kind: 'idAlreadyExists', id: p.id };
      }
      for (const p of prepared) {
        flow.connectors.push(p.conn);
      }
      return { kind: 'ok' };
    },
  );

  if (result.kind === 'ok') {
    return { kind: 'ok', data: { connectors: prepared.map((p) => ({ id: p.id })) } };
  }
  return result;
}

// Apply a partial PATCH body to a single connector. Mutation runs against
// the raw parsed JSON (so unknown forward-compat fields survive a round-trip).
// When `kind` changes, the previous kind's payload fields are dropped first
// so the connector doesn't carry phantom data; explicit `null` in the patch
// clears the field on disk (used by reconnect-to-body to drop a pinned
// handle id). The whole demo is re-validated through ResolvedFlowSchema before
// commit so the discriminated union catches missing-required-fields
// (e.g. kind='event' without eventName) and the superRefine gates
// source/target referential integrity + handle role invariants.
export async function patchConnectorImpl(
  deps: OperationsDeps,
  flowId: string,
  connectorId: string,
  updates: ConnectorPatchBody,
): Promise<PatchConnectorOutcome> {
  const entry = deps.registry.getById(flowId);
  if (!entry) return { kind: 'flowNotFound' };

  const fullPath = resolveFilePath(entry.repoPath, entry.flowPath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  return mutateMergedFlowAndBroadcast<{ kind: 'unknownConnector' }>(
    deps,
    flowId,
    fullPath,
    (flow) => {
      const conn = flow.connectors.find((cn) => cn.id === connectorId);
      if (!conn) return { kind: 'unknownConnector' };
      mergeConnectorUpdates(conn, updates);
      return { kind: 'ok' };
    },
  );
}

// Remove a connector by id. No cascade — node deletion is what cascades,
// not connector deletion. Final ResolvedFlowSchema parse still runs so a pre-existing
// schema violation surfaces honestly instead of being silently papered over.
export async function deleteConnectorImpl(
  deps: OperationsDeps,
  flowId: string,
  connectorId: string,
): Promise<DeleteConnectorOutcome> {
  const entry = deps.registry.getById(flowId);
  if (!entry) return { kind: 'flowNotFound' };

  const fullPath = resolveFilePath(entry.repoPath, entry.flowPath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  return mutateMergedFlowAndBroadcast<{ kind: 'unknownConnector' }>(
    deps,
    flowId,
    fullPath,
    (flow) => {
      const idx = flow.connectors.findIndex((cn) => cn.id === connectorId);
      if (idx < 0) return { kind: 'unknownConnector' };
      flow.connectors.splice(idx, 1);
      return { kind: 'ok' };
    },
  );
}

// =============================================================================
// validateImpl — stateless schema validator. Powers POST /api/validate +
// the validate_seeflow MCP tool. Schema-only: no file:// resolution, no
// registry side-effects.
// =============================================================================

export interface ValidateBody {
  flow: unknown;
  style?: unknown;
}

export interface ValidationIssue {
  scope: 'flow' | 'style' | 'cross';
  path: (string | number)[];
  message: string;
  code: string;
}

export type ValidateOutcome = { ok: true } | { ok: false; issues: ValidationIssue[] };

export function validateImpl(body: ValidateBody): ValidateOutcome {
  const issues: ValidationIssue[] = [];

  const flowParse = FlowSchema.safeParse(body.flow);
  if (!flowParse.success) {
    for (const i of flowParse.error.issues) {
      issues.push({
        scope: 'flow',
        path: [...i.path],
        message: i.message,
        code: i.code,
      });
    }
  }

  let styleData:
    | { nodes?: Record<string, unknown>; connectors?: Record<string, unknown> }
    | undefined;
  if (body.style !== undefined) {
    const styleParse = StyleSchema.safeParse(body.style);
    if (!styleParse.success) {
      for (const i of styleParse.error.issues) {
        issues.push({
          scope: 'style',
          path: [...i.path],
          message: i.message,
          code: i.code,
        });
      }
    } else {
      styleData = styleParse.data as never;
    }
  }

  if (flowParse.success && styleData) {
    const flowNodeIds = new Set(flowParse.data.nodes.map((n) => n.id));
    const flowConnIds = new Set(flowParse.data.connectors.map((c) => c.id));
    for (const id of Object.keys(styleData.nodes ?? {})) {
      if (!flowNodeIds.has(id)) {
        issues.push({
          scope: 'cross',
          path: ['nodes', id],
          message: `Style entry references unknown node id: ${id}`,
          code: 'orphan_style_node',
        });
      }
    }
    for (const id of Object.keys(styleData.connectors ?? {})) {
      if (!flowConnIds.has(id)) {
        issues.push({
          scope: 'cross',
          path: ['connectors', id],
          message: `Style entry references unknown connector id: ${id}`,
          code: 'orphan_style_connector',
        });
      }
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
