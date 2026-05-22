import { z } from 'zod';

const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

// US-008: HttpAction was the original shape for both playAction and resetAction
// in pre-script-action releases. After US-001 cut playAction to script-only and
// US-008 cut resetAction the same way, no schema in this file uses HttpAction
// anymore. `HttpMethodSchema` is still used for the optional `method` field on
// connectors (documentation metadata).
const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

// Curated palette tokens. Stored on disk as readable names; the frontend maps
// them to actual CSS values (theme-aware, light + dark).
export const ColorTokenSchema = z.enum([
  'default',
  'slate',
  'blue',
  'green',
  'amber',
  'red',
  'purple',
  'pink',
]);

// Visual fields shared by every node type (functional + decorative). All
// optional — existing demo files predate them and must continue to parse.
const NodeVisualBaseShape = {
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  borderColor: ColorTokenSchema.optional(),
  backgroundColor: ColorTokenSchema.optional(),
  borderSize: z.number().positive().optional(),
  borderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
  fontSize: z.number().positive().optional(),
  textColor: ColorTokenSchema.optional(),
  cornerRadius: z.number().min(0).optional(),
};

// Consolidated three-field metadata shared by every node variant. `description`
// is the short body text rendered on the canvas under the node header (and as
// light-bold text in the sidebar). `detail` is the long-form free-text body
// rendered only in the sidebar. Both optional so unset fields round-trip
// unchanged. Spread into every node-data schema below since Icon doesn't
// spread NodeVisualBaseShape.
const NodeDescriptionBaseShape = {
  description: z.string().optional(),
  detail: z.string().optional(),
};

// US-001: relative-path safety refine (textual). Mirrors the same rule used
// for image/html-node paths further down. Realpath verification is layered on
// top by the proxy/status-runner before any spawn (symlink-escape defense).
const isCleanRelativePath = (s: string): boolean => {
  if (s.length === 0) return false;
  if (s.startsWith('/') || s.startsWith('\\')) return false;
  if (/^[A-Za-z]:[\\/]/.test(s)) return false;
  const segments = s.split(/[\\/]/);
  return !segments.some((seg) => seg === '..');
};

// Script-based action: the studio spawns `<interpreter> [...args] <scriptPath>`
// from the project's repoPath. `scriptPath` is a relative path under the
// project root (typically `nodes/<id>/scripts/<name>` for play/status, or any
// project-root-relative path for reset); `args` (optional) prepend to the
// interpreter; `input` (optional) gets JSON-serialized and written to the
// child's stdin then closed; `timeoutMs` caps execution (default applied at
// the spawn layer, not here).
const ScriptActionSchema = z.object({
  kind: z.literal('script'),
  interpreter: z.string().min(1),
  args: z.array(z.string()).optional(),
  scriptPath: z.string().min(1).refine(isCleanRelativePath, {
    message: 'scriptPath must be a relative path under the node folder (no absolute / traversal)',
  }),
  input: z.unknown().optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
});

export const PlayActionSchema = ScriptActionSchema;

// US-008: resetAction is a one-shot script action — same shape as a play
// script (interpreter + args + scriptPath + optional input/timeoutMs) but
// invoked from the /reset endpoint. The studio kills every live play and
// status script for the demo before running this script, so the running app
// sees a clean baseline when wiping its state.
export const ResetActionSchema = ScriptActionSchema;

// Long-running status script. Same spawn shape as ScriptAction (interpreter +
// args + scriptPath) but no stdin payload and a much longer max lifetime since
// these processes tick continuously and stream StatusReports to stdout.
export const StatusActionSchema = z.object({
  kind: z.literal('script'),
  interpreter: z.string().min(1),
  args: z.array(z.string()).optional(),
  scriptPath: z.string().min(1).refine(isCleanRelativePath, {
    message: 'scriptPath must be a relative path under the node folder (no absolute / traversal)',
  }),
  maxLifetimeMs: z.number().int().positive().max(3_600_000).optional(),
});

// Per-tick status report a statusAction script writes to stdout (one JSON
// record per line). `data` is a free-form key/value bag rendered as a table
// in the sidebar.
export const StatusReportSchema = z.object({
  state: z.enum(['ok', 'warn', 'error', 'pending']),
  summary: z.string().max(120).optional(),
  detail: z.string().max(2000).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  ts: z.number().int().positive().optional(),
});

export const StateSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('request') }),
  z.object({ kind: z.literal('event') }),
]);

const NodeDataBaseSchema = z.object({
  name: z.string().min(1),
  kind: z.string().min(1),
  stateSource: StateSourceSchema,
  // Reserved for v2: a module path resolved by future skills runtime.
  // Schema-only at v1 — never read at runtime.
  handlerModule: z.string().optional(),
  // Decorative header glyph. Lucide icon name (kebab-case) resolved by the
  // canvas <Icon> primitive; falls back to a placeholder when unknown.
  icon: z.string().optional(),
  ...NodeVisualBaseShape,
  ...NodeDescriptionBaseShape,
});

const PlayNodeDataSchema = NodeDataBaseSchema.extend({
  playAction: PlayActionSchema,
  statusAction: StatusActionSchema.optional(),
});

const StateNodeDataSchema = NodeDataBaseSchema.extend({
  playAction: PlayActionSchema.optional(),
  statusAction: StatusActionSchema.optional(),
});

const NodeBaseShape = {
  id: z.string().min(1),
  position: PositionSchema,
};

const PlayNodeSchema = z.object({
  ...NodeBaseShape,
  type: z.literal('playNode'),
  data: PlayNodeDataSchema,
});

const StateNodeSchema = z.object({
  ...NodeBaseShape,
  type: z.literal('stateNode'),
  data: StateNodeDataSchema,
});

// Decorative annotation node — rectangle / ellipse / sticky. No semantic
// payload (no kind/stateSource/playAction); reuses NodeVisualBaseShape so
// users can theme it the same way as functional nodes.
// US-009 added `database` as the first illustrative shape (cylinder rendered
// via inline SVG inside shape-node.tsx). Illustrative shapes share the same
// shapeNode wrapper and color/border fields but own their own visuals via a
// per-shape component under `apps/web/src/components/nodes/shapes/`.
export const ShapeKindSchema = z.enum([
  'rectangle',
  'ellipse',
  'sticky',
  'text',
  'database',
  'server',
  'user',
  'queue',
  'cloud',
]);

const ShapeNodeDataSchema = z.object({
  shape: ShapeKindSchema,
  name: z.string().optional(),
  ...NodeVisualBaseShape,
  ...NodeDescriptionBaseShape,
});

const ShapeNodeSchema = z.object({
  ...NodeBaseShape,
  type: z.literal('shapeNode'),
  data: ShapeNodeDataSchema,
});

// Decorative image node — references a file under the project root by
// relative path (US-004 hard-cut from base64 data URLs to path-backed files).
// `path` is a relative path under the project root for imageNode uploads:
// no leading slash, no `..` segments. The renderer fetches via
// `GET /api/projects/:id/files/:path`.
const ImageNodeDataSchema = z.object({
  path: z.string().min(1).refine(isCleanRelativePath, {
    message: 'path must be a relative path under the project root (no absolute / traversal)',
  }),
  alt: z.string().optional(),
  ...NodeVisualBaseShape,
  ...NodeDescriptionBaseShape,
  borderWidth: z.number().min(1).max(8).optional(),
});

const ImageNodeSchema = z.object({
  ...NodeBaseShape,
  type: z.literal('imageNode'),
  data: ImageNodeDataSchema,
});

// US-011 (illustrative-shapes-htmlnode): htmlNode is the escape-hatch node type
// for content the curated nodes don't cover — carries author-written HTML
// inline via `data.html`. The studio externalizes the content to
// `<project>/nodes/<id>/view.html` and stores a `file://` ref in flow.json;
// the resolver inlines the content back on read so consumers see
// the resolved HTML string. The renderer sanitizes before injection
// (US-013/US-014). Spreads NodeVisualBaseShape so authors can theme the
// wrapper (border / background / radius / font) with the same fields
// available on every other visual node.
export const HtmlNodeDataSchema = z.object({
  html: z.string().optional(),
  name: z.string().optional(),
  // Decorative caption glyph. Lucide icon name (kebab-case) resolved by the
  // canvas <Icon> primitive; rendered inline with the caption when set.
  icon: z.string().optional(),
  // When true (or absent), the renderer measures the HTML content and React
  // Flow sizes the wrapper around it (capped at 800×600 by the renderer's
  // measuring container styles). The studio adapter (`mergeNodeUpdates`)
  // enforces the invariant that `autoSize === true` and persisted
  // `width`/`height` never coexist: writing width/height flips autoSize to
  // false; writing autoSize: true strips width/height.
  autoSize: z.boolean().optional(),
  ...NodeVisualBaseShape,
  ...NodeDescriptionBaseShape,
});

const HtmlNodeSchema = z.object({
  ...NodeBaseShape,
  type: z.literal('htmlNode'),
  data: HtmlNodeDataSchema,
});

// Decorative icon node — renders a Lucide glyph on the canvas. Unboxed
// (no border/cornerRadius/backgroundColor) so it does NOT spread
// NodeVisualBaseShape; only `width` / `height` are reused for resizing.
const IconNodeDataSchema = z.object({
  icon: z.string().min(1),
  color: ColorTokenSchema.optional(),
  strokeWidth: z.number().min(0.5).max(4).optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  alt: z.string().optional(),
  // US-002: optional visible caption rendered below the icon. Distinct from
  // `alt` (screen-reader text). Absent / empty → no caption rendered and the
  // node's bounding box is byte-identical to the unlabeled layout.
  name: z.string().optional(),
  ...NodeDescriptionBaseShape,
});

const IconNodeSchema = z.object({
  ...NodeBaseShape,
  type: z.literal('iconNode'),
  data: IconNodeDataSchema,
});

const NodeSchema = z.discriminatedUnion('type', [
  PlayNodeSchema,
  StateNodeSchema,
  ShapeNodeSchema,
  ImageNodeSchema,
  IconNodeSchema,
  HtmlNodeSchema,
]);

// Connector is the edge between two nodes. The frontend derives a React Flow
// Edge from each connector at render time (id/source/target are reused;
// `label` becomes the edge label; visual style comes from optional
// `style`/`color` fields). v1 has no separate `edges[]` array — connectors
// are the sole source of truth for inter-node connections. Optional
// metadata fields (`method`/`url`/`eventName`/`queueName`) may be present
// for documentation purposes; the renderer does not branch on them.
const ConnectorStyleSchema = z.enum(['solid', 'dashed', 'dotted']);
const ConnectorDirectionSchema = z.enum(['forward', 'backward', 'both', 'none']);
// Path geometry — orthogonal to `style` (which means the dash pattern). Absent
// → renders as today's smooth bezier curve. 'step' renders as a smoothstep
// (right-angle / zigzag) path. (US-017)
const ConnectorPathSchema = z.enum(['curve', 'step']);

// Visual fields shared by every connector. All optional — existing
// demo files predate them and must continue to parse. `direction` defaults
// to 'forward' when absent (the historical behavior).
const ConnectorVisualBaseShape = {
  style: ConnectorStyleSchema.optional(),
  color: ColorTokenSchema.optional(),
  direction: ConnectorDirectionSchema.optional(),
  borderSize: z.number().positive().optional(),
  path: ConnectorPathSchema.optional(),
  // US-018: per-connector label font size in CSS pixels. Absent → fall back to
  // the editable-edge default (11px). Mirrors NodeVisualBaseShape.fontSize.
  fontSize: z.number().positive().optional(),
};

// Handle ids — every node type in this codebase uses the same four-handle
// layout: target-only on top + left, source-only on right + bottom (US-013).
// `sourceHandle` MUST be a source-side id and `targetHandle` MUST be a
// target-side id; sending the wrong role leaves a stranded endpoint at render
// time, so the schema rejects it (US-022).
export const SourceHandleIdSchema = z.enum(['r', 'b']);
export const TargetHandleIdSchema = z.enum(['t', 'l']);

// US-006: pinned endpoint position. `side` names one of the four perimeter
// sides of the connected node; `t` is the parameterized position along that
// side, [0, 1], measured from the top-left corner of the side (top/bottom →
// left-to-right; left/right → top-to-bottom). Pins are persisted so they
// survive node moves and resizes without drifting toward the other endpoint's
// center the way floating endpoints do.
const EdgePinSideSchema = z.enum(['top', 'right', 'bottom', 'left']);
export const EdgePinSchema = z.object({
  side: EdgePinSideSchema,
  t: z.number().min(0).max(1),
});

const ConnectorBaseShape = {
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  // Optional — connectors authored before the four-handle layout omit them and
  // React Flow falls back to the first matching handle.
  sourceHandle: SourceHandleIdSchema.optional(),
  targetHandle: TargetHandleIdSchema.optional(),
  // US-021: tracks whether each endpoint's handle was auto-picked by the
  // facing-handle picker (true) or pinned by an explicit user handle drop
  // (false / absent). Auto-picked endpoints get re-routed when nodes move so
  // the connector keeps facing the other end; user-pinned ones never do.
  sourceHandleAutoPicked: z.boolean().optional(),
  targetHandleAutoPicked: z.boolean().optional(),
  // US-006: optional explicit perimeter positions for each endpoint. When
  // set, the endpoint is computed from `(side, t)` against the connected
  // node's current bbox at render time — the position parameterizes with the
  // node so the pin survives moves and resizes. Absent → floating /
  // handle-based endpoint behavior (back-compat).
  sourcePin: EdgePinSchema.optional(),
  targetPin: EdgePinSchema.optional(),
  label: z.string().optional(),
  ...ConnectorVisualBaseShape,
};

const ConnectorSchema = z.object({
  ...ConnectorBaseShape,
  method: HttpMethodSchema.optional(),
  url: z.string().min(1).optional(),
  eventName: z.string().min(1).optional(),
  queueName: z.string().min(1).optional(),
});

export const ResolvedFlowSchema = z
  .object({
    version: z.literal(2),
    name: z.string().min(1),
    description: z.string().optional(),
    nodes: z.array(NodeSchema),
    connectors: z.array(ConnectorSchema),
    // Optional one-shot script the studio runs when the user clicks Restart.
    // Lets the running app wipe its own in-memory state. The studio kills
    // every live play + status script for the flow BEFORE invoking this
    // script (US-008), so the script sees no stragglers.
    resetAction: ResetActionSchema.optional(),
  })
  .superRefine((resolved, ctx) => {
    const nodeIds = new Set(resolved.nodes.map((n) => n.id));
    resolved.connectors.forEach((c, idx) => {
      if (!nodeIds.has(c.source)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['connectors', idx, 'source'],
          message: `Connector ${c.id} references unknown source node: ${c.source}`,
        });
      }
      if (!nodeIds.has(c.target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['connectors', idx, 'target'],
          message: `Connector ${c.id} references unknown target node: ${c.target}`,
        });
      }
    });
    // imageNode upload paths must live under the node's own
    // `nodes/<id>/` folder so delete_node's removeNodeDir cascade is the
    // single source of cleanup.
    resolved.nodes.forEach((node, idx) => {
      if (node.type !== 'imageNode') return;
      const path = (node.data as { path?: string }).path;
      const expected = `nodes/${node.id}/`;
      if (typeof path === 'string' && !path.startsWith(expected)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nodes', idx, 'data', 'path'],
          message: `imageNode path must start with "${expected}"`,
        });
      }
    });
  });

export type ResolvedFlow = z.infer<typeof ResolvedFlowSchema>;
export type ResolvedFlowNode = z.infer<typeof NodeSchema>;
export type ShapeNode = z.infer<typeof ShapeNodeSchema>;
export type ImageNode = z.infer<typeof ImageNodeSchema>;
export type IconNode = z.infer<typeof IconNodeSchema>;
export type HtmlNode = z.infer<typeof HtmlNodeSchema>;
export type HtmlNodeData = z.infer<typeof HtmlNodeDataSchema>;
export type ShapeKind = z.infer<typeof ShapeKindSchema>;
export type ColorToken = z.infer<typeof ColorTokenSchema>;
export type Connector = z.infer<typeof ConnectorSchema>;
export type ConnectorStyle = z.infer<typeof ConnectorStyleSchema>;
export type ConnectorDirection = z.infer<typeof ConnectorDirectionSchema>;
export type ConnectorPath = z.infer<typeof ConnectorPathSchema>;
export type EdgePin = z.infer<typeof EdgePinSchema>;
export type EdgePinSide = z.infer<typeof EdgePinSideSchema>;
export type PlayAction = z.infer<typeof PlayActionSchema>;
export type StatusAction = z.infer<typeof StatusActionSchema>;
export type StatusReport = z.infer<typeof StatusReportSchema>;
export type ResetAction = z.infer<typeof ResetActionSchema>;
export type StateSource = z.infer<typeof StateSourceSchema>;

// =============================================================================
// Flow schema — pure semantic data, every visual/layout field stripped.
// What lives on disk in <project>/flow.json after the split.
// =============================================================================

const FlowNodeDataBaseShape = {
  name: z.string().min(1),
  kind: z.string().min(1),
  stateSource: StateSourceSchema,
  handlerModule: z.string().optional(),
  icon: z.string().optional(),
  ...NodeDescriptionBaseShape,
};

const FlowPlayNodeDataSchema = z
  .object({
    ...FlowNodeDataBaseShape,
    playAction: PlayActionSchema,
    statusAction: StatusActionSchema.optional(),
  })
  .strict();

const FlowStateNodeDataSchema = z
  .object({
    ...FlowNodeDataBaseShape,
    playAction: PlayActionSchema.optional(),
    statusAction: StatusActionSchema.optional(),
  })
  .strict();

const FlowShapeNodeDataSchema = z
  .object({
    shape: ShapeKindSchema,
    name: z.string().optional(),
    ...NodeDescriptionBaseShape,
  })
  .strict();

const FlowImageNodeDataSchema = z
  .object({
    path: z.string().min(1).refine(isCleanRelativePath, {
      message: 'path must be a relative path under the project root (no absolute / traversal)',
    }),
    alt: z.string().optional(),
    ...NodeDescriptionBaseShape,
  })
  .strict();

const FlowIconNodeDataSchema = z
  .object({
    icon: z.string().min(1),
    alt: z.string().optional(),
    name: z.string().optional(),
    ...NodeDescriptionBaseShape,
  })
  .strict();

const FlowHtmlNodeDataSchema = z
  .object({
    html: z.string().optional(),
    name: z.string().optional(),
    icon: z.string().optional(),
    ...NodeDescriptionBaseShape,
  })
  .strict();

const FlowNodeBaseShape = {
  id: z.string().min(1),
};

export const FlowPlayNodeSchema = z
  .object({
    ...FlowNodeBaseShape,
    type: z.literal('playNode'),
    data: FlowPlayNodeDataSchema,
  })
  .strict();

export const FlowStateNodeSchema = z
  .object({
    ...FlowNodeBaseShape,
    type: z.literal('stateNode'),
    data: FlowStateNodeDataSchema,
  })
  .strict();

export const FlowShapeNodeSchema = z
  .object({
    ...FlowNodeBaseShape,
    type: z.literal('shapeNode'),
    data: FlowShapeNodeDataSchema,
  })
  .strict();

export const FlowImageNodeSchema = z
  .object({
    ...FlowNodeBaseShape,
    type: z.literal('imageNode'),
    data: FlowImageNodeDataSchema,
  })
  .strict();

export const FlowIconNodeSchema = z
  .object({
    ...FlowNodeBaseShape,
    type: z.literal('iconNode'),
    data: FlowIconNodeDataSchema,
  })
  .strict();

export const FlowHtmlNodeSchema = z
  .object({
    ...FlowNodeBaseShape,
    type: z.literal('htmlNode'),
    data: FlowHtmlNodeDataSchema,
  })
  .strict();

const FlowNodeSchema = z.discriminatedUnion('type', [
  FlowPlayNodeSchema,
  FlowStateNodeSchema,
  FlowShapeNodeSchema,
  FlowImageNodeSchema,
  FlowIconNodeSchema,
  FlowHtmlNodeSchema,
]);

const FlowConnectorBaseShape = {
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().optional(),
};

export const FlowConnectorSchema = z
  .object({
    ...FlowConnectorBaseShape,
    method: HttpMethodSchema.optional(),
    url: z.string().min(1).optional(),
    eventName: z.string().min(1).optional(),
    queueName: z.string().min(1).optional(),
  })
  .strict();

export const FlowSchema = z
  .object({
    version: z.literal(2),
    name: z.string().min(1),
    description: z.string().optional(),
    resetAction: ResetActionSchema.optional(),
    nodes: z.array(FlowNodeSchema),
    connectors: z.array(FlowConnectorSchema),
  })
  .strict()
  .superRefine((flow, ctx) => {
    const ids = new Set(flow.nodes.map((n) => n.id));
    flow.connectors.forEach((c, idx) => {
      if (!ids.has(c.source)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['connectors', idx, 'source'],
          message: `Connector ${c.id} references unknown source node: ${c.source}`,
        });
      }
      if (!ids.has(c.target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['connectors', idx, 'target'],
          message: `Connector ${c.id} references unknown target node: ${c.target}`,
        });
      }
    });
  });

export type Flow = z.infer<typeof FlowSchema>;
export type FlowNode = z.infer<typeof FlowNodeSchema>;
export type FlowConnector = z.infer<typeof FlowConnectorSchema>;

// Envelope-only flow shape for the `seeflow schema flow` surface. The full
// FlowSchema validates the whole graph; this companion schema describes the
// top-level shape without inlining every node variant or the connector
// shape, so the runtime-introspectable JSON Schema stays compact. Authors
// drill into `seeflow schema node` / `seeflow schema connector` for the
// detailed shapes. Not used for validation — only the catalog reads it.
export const FlowEnvelopeSchema = z
  .object({
    version: z.literal(2),
    name: z.string().min(1),
    description: z.string().optional(),
    resetAction: ResetActionSchema.optional(),
    nodes: z.array(z.unknown().describe('See `seeflow schema node`')),
    connectors: z.array(z.unknown().describe('See `seeflow schema connector`')),
  })
  .strict();

// =============================================================================
// Style schema — keyed map of presentation overrides, side-table by id.
// What lives on disk in <project>/style.json (optional file).
// =============================================================================

const NodeStyleSchema = z
  .object({
    position: PositionSchema.optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    borderColor: ColorTokenSchema.optional(),
    backgroundColor: ColorTokenSchema.optional(),
    borderSize: z.number().positive().optional(),
    borderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
    fontSize: z.number().positive().optional(),
    textColor: ColorTokenSchema.optional(),
    cornerRadius: z.number().min(0).optional(),
    // imageNode-specific
    borderWidth: z.number().min(1).max(8).optional(),
    // iconNode-specific
    color: ColorTokenSchema.optional(),
    strokeWidth: z.number().min(0.5).max(4).optional(),
    // htmlNode-specific
    autoSize: z.boolean().optional(),
  })
  .strict();

const ConnectorStyleEntrySchema = z
  .object({
    sourceHandle: SourceHandleIdSchema.optional(),
    targetHandle: TargetHandleIdSchema.optional(),
    sourceHandleAutoPicked: z.boolean().optional(),
    targetHandleAutoPicked: z.boolean().optional(),
    sourcePin: EdgePinSchema.optional(),
    targetPin: EdgePinSchema.optional(),
    style: ConnectorStyleSchema.optional(),
    color: ColorTokenSchema.optional(),
    direction: ConnectorDirectionSchema.optional(),
    borderSize: z.number().positive().optional(),
    path: ConnectorPathSchema.optional(),
    fontSize: z.number().positive().optional(),
  })
  .strict();

export const StyleSchema = z
  .object({
    nodes: z.record(z.string(), NodeStyleSchema).optional(),
    connectors: z.record(z.string(), ConnectorStyleEntrySchema).optional(),
  })
  .strict();

export type Style = z.infer<typeof StyleSchema>;
export type NodeStyle = z.infer<typeof NodeStyleSchema>;
export type ConnectorStyleEntry = z.infer<typeof ConnectorStyleEntrySchema>;
