// Shared inner helpers that REST handlers in api.ts and MCP tool handlers in
// mcp.ts both call. Each helper returns an Outcome discriminated union so the
// caller layer can translate it into its native response shape (HTTP status
// vs. MCP CallToolResult) without duplicating any of the business logic.
//
// Helpers extracted in US-002: discovery + project setup (5 tools).
// Helpers extracted in US-003: node lifecycle (add/delete/move/reorder).
// Future stories add patch_node + connector helpers alongside these.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { type ZodIssue, z } from 'zod';
import { seeflowHome } from './paths.ts';
import { type Registry, slugify } from './registry.ts';
import {
  ColorTokenSchema,
  type Flow,
  FlowSchema,
  EdgePinSchema,
  SourceHandleIdSchema,
  TargetHandleIdSchema,
} from './schema.ts';
import { mergeArchitectureAndStyle, splitFlow } from './merge.ts';
import { writeSdkEmitIfNeeded } from './sdk-writer.ts';
import { type FlowSnapshot, type FlowWatcher, readMergedFlow } from './watcher.ts';
import { ArchitectureSchema, StyleSchema } from './schema.ts';

const DEFAULT_ARCHITECTURE_RELATIVE_PATH = '.seeflow/architecture.json';

export const RegisterBodySchema = z.object({
  name: z.string().min(1).optional(),
  repoPath: z.string().min(1),
  architecturePath: z.string().min(1),
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
// the whole demo through FlowSchema after the merge — this body schema just
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
    shape: z.enum(['rectangle', 'ellipse', 'sticky', 'text']).optional(),
    // iconNode-only: stroke color token. Lands at data.color; FlowSchema's
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
    // US-019: lock state. Lands at data.locked; persists across save/reload.
    // Absent → unlocked default (no badge, all gestures work).
    locked: z.boolean().optional(),
    // Three-field consolidation: free-text metadata on every node variant.
    // Empty string on `description` or `detail` is the documented clear-on-
    // serialize signal — `mergeNodeUpdates` strips the key from disk.
    description: z.string().optional(),
    detail: z.string().optional(),
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
  'locked',
  'description',
  'detail',
] as const satisfies ReadonlyArray<keyof NodePatchBody>;

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
    // Empty string on the two free-text metadata fields is the documented
    // clear-on-serialize signal — strip the key instead of writing "" to disk
    // so seeflow.json stays compact and round-tripping a cleared node doesn't
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
  flow: Flow | null;
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
// are enforced post-merge by re-parsing the whole demo through FlowSchema.
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
    // post-merge FlowSchema parse rejects dangling references, so we don't
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
// behind, which FlowSchema would silently strip on parse but leave on disk).
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

export type AddConnectorOutcome =
  | { kind: 'ok'; data: { id: string } }
  | { kind: 'flowNotFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
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

export const resolveFilePath = (repoPath: string, architecturePath: string): string =>
  isAbsolute(architecturePath) ? architecturePath : join(repoPath, architecturePath);

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
export const writeFileAtomic = (filePath: string, content: string): void => {
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    writeFileSync(tempPath, content);
    renameSync(tempPath, filePath);
  } catch (err) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
};

/**
 * Read architecture.json + optional style.json, return the raw parsed JSON
 * so operations can mutate the merged-flow shape without losing forward-compat
 * fields. Returns null if the architecture file is missing or invalid JSON.
 */
type ReadRawResult =
  | { kind: 'ok'; rawArch: Record<string, unknown>; rawStyle: Record<string, unknown> }
  | { kind: 'badJson'; message: string };

function readRawArchAndStyle(archPath: string): ReadRawResult {
  let rawArch: unknown;
  try {
    rawArch = JSON.parse(readFileSync(archPath, 'utf8'));
  } catch (err) {
    return { kind: 'badJson', message: err instanceof Error ? err.message : String(err) };
  }
  if (!rawArch || typeof rawArch !== 'object' || Array.isArray(rawArch)) {
    return { kind: 'badJson', message: 'architecture.json is not an object' };
  }
  const stylePath = join(dirname(archPath), 'style.json');
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
  return { kind: 'ok', rawArch: rawArch as Record<string, unknown>, rawStyle };
}

/**
 * Mutate-in-place helper: read both files into a merged Flow shape, hand it
 * to the mutator, then split back into architecture + style and atomically
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

type MutateMergedFlowResult<E> =
  | { kind: 'ok' }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'writeFailed'; message: string }
  | E;

export async function mutateMergedFlow<E extends { kind: string }>(
  archPath: string,
  mutator: MutateMergedFlowMutator<E>,
): Promise<MutateMergedFlowResult<E>> {
  const read = readRawArchAndStyle(archPath);
  if (read.kind === 'badJson') return { kind: 'badJson', message: read.message };

  const archParse = ArchitectureSchema.safeParse(read.rawArch);
  if (!archParse.success) return { kind: 'badSchema', issues: archParse.error.issues };
  const styleParse = StyleSchema.safeParse(read.rawStyle);
  if (!styleParse.success) return { kind: 'badSchema', issues: styleParse.error.issues };

  const merged = mergeArchitectureAndStyle(archParse.data, styleParse.data) as unknown as {
    version: number;
    name: string;
    resetAction?: unknown;
    nodes: Array<Record<string, unknown>>;
    connectors: Array<Record<string, unknown>>;
  };

  const outcome = mutator(merged);
  if (outcome.kind !== 'ok') return outcome;

  // Final FlowSchema parse so per-kind invariants (event needs eventName, etc.)
  // surface honestly instead of being silently papered over.
  const finalParse = FlowSchema.safeParse(merged);
  if (!finalParse.success) return { kind: 'badSchema', issues: finalParse.error.issues };

  const { architecture, style } = splitFlow(merged);
  // Re-validate the post-split files to catch the rare case where a forward-
  // compat field landed in the wrong bucket. Style validation is a no-op for
  // empty maps; architecture revalidation rejects unknown keys via strict().
  const archCheck = ArchitectureSchema.safeParse(architecture);
  if (!archCheck.success) return { kind: 'badSchema', issues: archCheck.error.issues };
  const styleCheck = StyleSchema.safeParse(style);
  if (!styleCheck.success) return { kind: 'badSchema', issues: styleCheck.error.issues };

  const stylePath = join(dirname(archPath), 'style.json');
  const styleIsEmpty =
    (!style.nodes || Object.keys(style.nodes as Record<string, unknown>).length === 0) &&
    (!style.connectors || Object.keys(style.connectors as Record<string, unknown>).length === 0);

  try {
    writeFileAtomic(archPath, `${JSON.stringify(architecture, null, 2)}\n`);
  } catch (err) {
    return { kind: 'writeFailed', message: err instanceof Error ? err.message : String(err) };
  }

  try {
    if (styleIsEmpty) {
      if (existsSync(stylePath)) unlinkSync(stylePath);
    } else {
      writeFileAtomic(stylePath, `${JSON.stringify(style, null, 2)}\n`);
    }
  } catch (err) {
    return { kind: 'writeFailed', message: err instanceof Error ? err.message : String(err) };
  }

  return { kind: 'ok' };
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
    const fullPath = resolveFilePath(e.repoPath, e.architecturePath);
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

  const fullPath = resolveFilePath(entry.repoPath, entry.architecturePath);
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
  const { repoPath, architecturePath } = body;
  const fullPath = resolveFilePath(repoPath, architecturePath);

  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  const merged = readMergedFlow(fullPath);
  if (merged.error && merged.flow === null) {
    if (merged.error.startsWith('Invalid JSON')) {
      return { kind: 'badJson', detail: merged.error };
    }
    // Schema validation failed — surface the issues as a bad-schema outcome
    // by re-running parse to get ZodIssue[].
    let rawArch: unknown;
    try {
      rawArch = JSON.parse(readFileSync(fullPath, 'utf8'));
    } catch (err) {
      return { kind: 'badJson', detail: String(err) };
    }
    const archParse = ArchitectureSchema.safeParse(rawArch);
    if (!archParse.success) return { kind: 'badSchema', issues: archParse.error.issues };
    return { kind: 'badJson', detail: merged.error };
  }
  if (!merged.flow) return { kind: 'badJson', detail: merged.error ?? 'unknown error' };

  const lastModified = statSync(fullPath).mtimeMs;
  const entry = registry.upsert({
    name: body.name ?? merged.flow.name,
    repoPath,
    architecturePath,
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

  const demoFullPath = join(folderPath, DEFAULT_ARCHITECTURE_RELATIVE_PATH);

  if (existsSync(demoFullPath)) {
    let raw: unknown;
    try {
      raw = await Bun.file(demoFullPath).json();
    } catch (err) {
      return { kind: 'badJson', detail: err instanceof Error ? err.message : String(err) };
    }
    const archParse = ArchitectureSchema.safeParse(raw);
    if (!archParse.success) return { kind: 'badSchema', issues: archParse.error.issues };

    const lastModified = statSync(demoFullPath).mtimeMs;
    const entry = registry.upsert({
      name,
      repoPath: folderPath,
      architecturePath: DEFAULT_ARCHITECTURE_RELATIVE_PATH,
      valid: true,
      lastModified,
    });
    watcher?.watch(entry.id);
    return { kind: 'ok', data: { id: entry.id, slug: entry.slug, scaffolded: false } };
  }

  // Architecture-only scaffold: empty nodes/connectors, no style.json needed.
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
    architecturePath: DEFAULT_ARCHITECTURE_RELATIVE_PATH,
    valid: true,
    lastModified,
  });
  watcher?.watch(entry.id);
  return { kind: 'ok', data: { id: entry.id, slug: entry.slug, scaffolded: true } };
}

// Append a new node to the demo. Auto-generates an id when absent; FlowSchema
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
    newNode.id = `node-${crypto.randomUUID()}`;
  }
  const newId = newNode.id as string;
  // Default position so the post-merge FlowSchema parse passes. Position lives
  // on style.json after the split — callers who care set it explicitly.
  if (!newNode.position || typeof newNode.position !== 'object') {
    newNode.position = { x: 0, y: 0 };
  }

  // US-015: for htmlNode without a client-supplied htmlPath, allocate the
  // studio-managed `blocks/<id>.html` path and queue a starter-file write.
  // Client-supplied htmlPath wins and we skip the starter file (symmetric
  // with US-016's hand-edited-path leave-alone rule).
  let starterFile: { absPath: string; content: string } | undefined;
  if (newNode.type === 'htmlNode') {
    const dataIsRecord =
      newNode.data !== null && typeof newNode.data === 'object' && !Array.isArray(newNode.data);
    const existingData: Record<string, unknown> = dataIsRecord
      ? { ...(newNode.data as Record<string, unknown>) }
      : {};
    const clientProvidedHtmlPath =
      typeof existingData.htmlPath === 'string' && existingData.htmlPath.length > 0;
    if (!clientProvidedHtmlPath) {
      const htmlPath = `blocks/${newId}.html`;
      existingData.htmlPath = htmlPath;
      newNode.data = existingData;
      starterFile = {
        absPath: join(entry.repoPath, '.seeflow', htmlPath),
        content: buildHtmlNodeStarter(newId),
      };
    } else if (!dataIsRecord) {
      // Coerce non-object data into the spread'd record so the schema parse
      // sees the right shape — shouldn't happen in practice but keeps types honest.
      newNode.data = existingData;
    }
  }

  const fullPath = resolveFilePath(entry.repoPath, entry.architecturePath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  const result = await withFlowWriteLock(flowId, () =>
    mutateMergedFlow<{ kind: 'writeFailed'; message: string }>(fullPath, (flow) => {
      flow.nodes.push(newNode);
      if (starterFile) {
        try {
          mkdirSync(dirname(starterFile.absPath), { recursive: true });
          writeFileAtomic(starterFile.absPath, starterFile.content);
        } catch (err) {
          return { kind: 'writeFailed', message: err instanceof Error ? err.message : String(err) };
        }
      }
      return { kind: 'ok' };
    }),
  );

  if (result.kind === 'ok') return { kind: 'ok', data: { id: newId, node: newNode } };
  return result;
}

// US-015: starter HTML content for studio-created htmlNodes. Centered 'Edit me'
// card with a `blocks/<id>.html` subtitle — matches the design's Section 6
// markup exactly so the renderer paints a useful first impression while the
// author hasn't yet edited the file.
const buildHtmlNodeStarter = (nodeId: string): string =>
  `<div class="flex h-full w-full items-center justify-center rounded-lg border border-slate-300 bg-white p-4 text-slate-900">
  <div class="text-center">
    <div class="font-semibold">Edit me</div>
    <div class="text-xs text-slate-500">blocks/${nodeId}.html</div>
  </div>
</div>
`;

// Remove a node and cascade-delete every connector touching it in a single
// atomic write. Final FlowSchema parse stays in place so a pre-existing
// schema violation surfaces honestly instead of being silently papered over.
// US-016: when the removed node is an htmlNode whose data.htmlPath matches the
// studio-managed shape `blocks/<id>.html`, the companion file is removed AFTER
// the seeflow.json write succeeds. Hand-edited paths are left alone (symmetric
// with US-015's "client-supplied htmlPath wins, no starter file written").
export async function deleteNodeImpl(
  deps: OperationsDeps,
  flowId: string,
  nodeId: string,
): Promise<DeleteNodeOutcome> {
  const entry = deps.registry.getById(flowId);
  if (!entry) return { kind: 'flowNotFound' };

  const fullPath = resolveFilePath(entry.repoPath, entry.architecturePath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  let managedHtmlAbsPath: string | undefined;

  const result = await withFlowWriteLock(flowId, () =>
    mutateMergedFlow<{ kind: 'unknownNode' }>(fullPath, (flow) => {
      const idx = flow.nodes.findIndex((n) => n.id === nodeId);
      if (idx < 0) return { kind: 'unknownNode' };
      const removed = flow.nodes[idx];
      managedHtmlAbsPath = managedHtmlNodePath(entry.repoPath, nodeId, removed);
      flow.nodes.splice(idx, 1);
      flow.connectors = flow.connectors.filter(
        (cn) => cn.source !== nodeId && cn.target !== nodeId,
      );
      return { kind: 'ok' };
    }),
  );

  if (result.kind === 'ok' && managedHtmlAbsPath) {
    try {
      unlinkSync(managedHtmlAbsPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code !== 'ENOENT') {
        console.warn(
          `[operations] failed to remove managed htmlNode file ${managedHtmlAbsPath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  return result;
}

// US-016: only delete the companion file when the htmlPath matches the
// studio-managed shape `blocks/<id>.html` exactly. Hand-edited paths
// (`custom/hero.html`, an absolute path, anything else) are left alone so
// authors don't lose work they pointed the node at.
const managedHtmlNodePath = (
  repoPath: string,
  nodeId: string,
  removed: Record<string, unknown> | undefined,
): string | undefined => {
  if (!removed || removed.type !== 'htmlNode') return undefined;
  const data = removed.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const htmlPath = (data as Record<string, unknown>).htmlPath;
  if (htmlPath !== `blocks/${nodeId}.html`) return undefined;
  return join(repoPath, '.seeflow', htmlPath);
};

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

  const fullPath = resolveFilePath(entry.repoPath, entry.architecturePath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  const result = await withFlowWriteLock(flowId, () =>
    mutateMergedFlow<{ kind: 'unknownNode' }>(fullPath, (flow) => {
      const node = flow.nodes.find((n) => n.id === nodeId) as
        | { id: string; position?: { x: number; y: number } }
        | undefined;
      if (!node) return { kind: 'unknownNode' };
      node.position = { x: position.x, y: position.y };
      return { kind: 'ok' };
    }),
  );

  if (result.kind === 'ok') {
    deps.watcher?.reparse(flowId);
    return { kind: 'ok', data: { position: { x: position.x, y: position.y } } };
  }
  return result;
}

// Apply a partial PATCH body to a single node. Mutation runs against the
// raw parsed JSON (so unknown forward-compat fields survive a round-trip),
// and the whole demo is re-validated through FlowSchema before commit so
// partial writes can't break invariants like the connector→node superRefine.
export async function patchNodeImpl(
  deps: OperationsDeps,
  flowId: string,
  nodeId: string,
  updates: NodePatchBody,
): Promise<PatchNodeOutcome> {
  const entry = deps.registry.getById(flowId);
  if (!entry) return { kind: 'flowNotFound' };

  const fullPath = resolveFilePath(entry.repoPath, entry.architecturePath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  return withFlowWriteLock(flowId, () =>
    mutateMergedFlow<{ kind: 'unknownNode' }>(fullPath, (flow) => {
      const node = flow.nodes.find((n) => n.id === nodeId);
      if (!node) return { kind: 'unknownNode' };
      mergeNodeUpdates(node, updates);
      return { kind: 'ok' };
    }),
  );
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

  const fullPath = resolveFilePath(entry.repoPath, entry.architecturePath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  const result = await withFlowWriteLock(flowId, () =>
    mutateMergedFlow<{ kind: 'unknownNode' } | { kind: 'noop' }>(fullPath, (flow) => {
      const fromIdx = flow.nodes.findIndex((n) => n.id === nodeId);
      if (fromIdx < 0) return { kind: 'unknownNode' };
      const moved = reorderNodes(flow.nodes, fromIdx, body);
      if (!moved) return { kind: 'noop' };
      return { kind: 'ok' };
    }),
  );

  if (result.kind === 'noop') return { kind: 'ok' };
  return result as ReorderNodeOutcome;
}

// Append a new connector to demo.connectors. `id` is auto-generated when
// absent and `kind` defaults to 'default' (the no-semantics user-drawn
// variant). Source/target referential integrity is enforced by FlowSchema's
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
    newConn.id = `conn-${crypto.randomUUID()}`;
  }
  if (typeof newConn.kind !== 'string' || newConn.kind.length === 0) {
    newConn.kind = 'default';
  }
  const newId = newConn.id as string;

  const fullPath = resolveFilePath(entry.repoPath, entry.architecturePath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  const result = await withFlowWriteLock(flowId, () =>
    mutateMergedFlow<never>(fullPath, (flow) => {
      flow.connectors.push(newConn);
      return { kind: 'ok' };
    }),
  );

  if (result.kind === 'ok') return { kind: 'ok', data: { id: newId } };
  return result;
}

// Apply a partial PATCH body to a single connector. Mutation runs against
// the raw parsed JSON (so unknown forward-compat fields survive a round-trip).
// When `kind` changes, the previous kind's payload fields are dropped first
// so the connector doesn't carry phantom data; explicit `null` in the patch
// clears the field on disk (used by reconnect-to-body to drop a pinned
// handle id). The whole demo is re-validated through FlowSchema before
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

  const fullPath = resolveFilePath(entry.repoPath, entry.architecturePath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  return withFlowWriteLock(flowId, () =>
    mutateMergedFlow<{ kind: 'unknownConnector' }>(fullPath, (flow) => {
      const conn = flow.connectors.find((cn) => cn.id === connectorId);
      if (!conn) return { kind: 'unknownConnector' };
      mergeConnectorUpdates(conn, updates);
      return { kind: 'ok' };
    }),
  );
}

// Remove a connector by id. No cascade — node deletion is what cascades,
// not connector deletion. Final FlowSchema parse still runs so a pre-existing
// schema violation surfaces honestly instead of being silently papered over.
export async function deleteConnectorImpl(
  deps: OperationsDeps,
  flowId: string,
  connectorId: string,
): Promise<DeleteConnectorOutcome> {
  const entry = deps.registry.getById(flowId);
  if (!entry) return { kind: 'flowNotFound' };

  const fullPath = resolveFilePath(entry.repoPath, entry.architecturePath);
  if (!existsSync(fullPath)) return { kind: 'fileNotFound', path: fullPath };

  return withFlowWriteLock(flowId, () =>
    mutateMergedFlow<{ kind: 'unknownConnector' }>(fullPath, (flow) => {
      const idx = flow.connectors.findIndex((cn) => cn.id === connectorId);
      if (idx < 0) return { kind: 'unknownConnector' };
      flow.connectors.splice(idx, 1);
      return { kind: 'ok' };
    }),
  );
}
