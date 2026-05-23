import { z } from 'zod';

const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

// `HttpMethodSchema` is documentation metadata on connectors. No node schema
// uses it — PlayAction/StatusAction are script-based.
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
// optional — every visual must work without per-field opinions. Live on
// resolved nodes; the disk-side flow.json strips them into style.json.
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

// Semantic-data fields shared by every node type. `name` is optional —
// every visual works without a label. `icon` is decorative-by-default; the
// `type:'icon'` variant overrides it to required.
const NodeSemanticBaseShape = {
  name: z.string().optional(),
  description: z.string().optional(),
  detail: z.string().optional(),
  // Decorative header glyph. Lucide icon name (kebab-case) resolved by the
  // canvas <Icon> primitive; falls back to a placeholder when unknown.
  icon: z.string().optional(),
};

// Relative-path safety refine (textual). Mirrors the same rule used for
// image-node and html-node script paths. Realpath verification is layered on
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

// resetAction is a one-shot script with the same shape as a play script.
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

// Capabilities — any subset of these makes a node Playable / Stateful. All
// optional, valid on every node type. A node is Playable iff `playAction` is
// set; Stateful iff `statusAction` is set; Both iff both. `stateSource` is
// informational metadata that pairs with statusAction. `handlerModule` is
// reserved for a future skills runtime and is schema-only at v1.
const NodeCapabilitiesShape = {
  playAction: PlayActionSchema.optional(),
  statusAction: StatusActionSchema.optional(),
  stateSource: StateSourceSchema.optional(),
  handlerModule: z.string().optional(),
};

// 12 flat node types. The first 9 are geometric/illustrative and share
// GeometricNodeData. `image`, `html`, `icon` carry per-type fields.
// The renderer picks the SVG / chrome by `type`; the schema treats them
// (apart from the per-type fields below) as identical.
export const GEOMETRIC_NODE_TYPES = [
  'rectangle',
  'ellipse',
  'sticky',
  'text',
  'database',
  'server',
  'user',
  'queue',
  'cloud',
] as const;

export const NodeTypeSchema = z.enum([...GEOMETRIC_NODE_TYPES, 'image', 'html', 'icon']);

// ---- Resolved (in-memory) per-type data -------------------------------------

const ResolvedGeometricNodeData = z.object({
  ...NodeSemanticBaseShape,
  ...NodeVisualBaseShape,
  ...NodeCapabilitiesShape,
});

// Image node — references a file under the project root by relative path.
// `path` is constrained to live under `nodes/<id>/` (post-validate refine on
// ResolvedFlowSchema below) so the delete_node cascade owns cleanup.
const ResolvedImageNodeData = z.object({
  ...NodeSemanticBaseShape,
  ...NodeVisualBaseShape,
  ...NodeCapabilitiesShape,
  path: z.string().min(1).refine(isCleanRelativePath, {
    message: 'path must be a relative path under the project root (no absolute / traversal)',
  }),
  alt: z.string().optional(),
  borderWidth: z.number().min(1).max(8).optional(),
});

// Html node — escape-hatch for content the curated visuals don't cover.
// `html` is externalized to `<project>/nodes/<id>/view.html` on write; the
// file-ref resolver inlines it back on read. The renderer sanitizes before
// injection. `autoSize:true` lets the renderer size around the content.
const ResolvedHtmlNodeData = z.object({
  ...NodeSemanticBaseShape,
  ...NodeVisualBaseShape,
  ...NodeCapabilitiesShape,
  html: z.string().optional(),
  autoSize: z.boolean().optional(),
});

// Icon node — renders a Lucide glyph as its main visual. `icon` is required
// here (overrides the optional decorative `icon` from NodeSemanticBaseShape).
const ResolvedIconNodeData = z.object({
  ...NodeSemanticBaseShape,
  ...NodeVisualBaseShape,
  ...NodeCapabilitiesShape,
  icon: z.string().min(1),
  color: ColorTokenSchema.optional(),
  strokeWidth: z.number().min(0.5).max(4).optional(),
  alt: z.string().optional(),
});

const NodeBaseShape = {
  id: z.string().min(1),
  position: PositionSchema,
};

const makeResolvedGeometricSchema = (type: (typeof GEOMETRIC_NODE_TYPES)[number]) =>
  z.object({
    ...NodeBaseShape,
    type: z.literal(type),
    data: ResolvedGeometricNodeData,
  });

const NodeSchema = z.discriminatedUnion('type', [
  makeResolvedGeometricSchema('rectangle'),
  makeResolvedGeometricSchema('ellipse'),
  makeResolvedGeometricSchema('sticky'),
  makeResolvedGeometricSchema('text'),
  makeResolvedGeometricSchema('database'),
  makeResolvedGeometricSchema('server'),
  makeResolvedGeometricSchema('user'),
  makeResolvedGeometricSchema('queue'),
  makeResolvedGeometricSchema('cloud'),
  z.object({ ...NodeBaseShape, type: z.literal('image'), data: ResolvedImageNodeData }),
  z.object({ ...NodeBaseShape, type: z.literal('html'), data: ResolvedHtmlNodeData }),
  z.object({ ...NodeBaseShape, type: z.literal('icon'), data: ResolvedIconNodeData }),
]);

// Connector — unchanged by the flat-types refactor.
const ConnectorStyleSchema = z.enum(['solid', 'dashed', 'dotted']);
const ConnectorDirectionSchema = z.enum(['forward', 'backward', 'both', 'none']);
const ConnectorPathSchema = z.enum(['curve', 'step']);

const ConnectorVisualBaseShape = {
  style: ConnectorStyleSchema.optional(),
  color: ColorTokenSchema.optional(),
  direction: ConnectorDirectionSchema.optional(),
  borderSize: z.number().positive().optional(),
  path: ConnectorPathSchema.optional(),
  fontSize: z.number().positive().optional(),
};

// Handle ids — every node type uses the same four-handle layout:
// target-only on top + left, source-only on right + bottom.
export const SourceHandleIdSchema = z.enum(['r', 'b']);
export const TargetHandleIdSchema = z.enum(['t', 'l']);

const EdgePinSideSchema = z.enum(['top', 'right', 'bottom', 'left']);
export const EdgePinSchema = z.object({
  side: EdgePinSideSchema,
  t: z.number().min(0).max(1),
});

const ConnectorBaseShape = {
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: SourceHandleIdSchema.optional(),
  targetHandle: TargetHandleIdSchema.optional(),
  sourceHandleAutoPicked: z.boolean().optional(),
  targetHandleAutoPicked: z.boolean().optional(),
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
    // The studio kills every live play + status script for the flow BEFORE
    // invoking this script, so the script sees no stragglers.
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
    // type:'image' upload paths must live under the node's own
    // `nodes/<id>/` folder so delete_node's removeNodeDir cascade is the
    // single source of cleanup.
    resolved.nodes.forEach((node, idx) => {
      if (node.type !== 'image') return;
      const path = (node.data as { path?: string }).path;
      const expected = `nodes/${node.id}/`;
      if (typeof path === 'string' && !path.startsWith(expected)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nodes', idx, 'data', 'path'],
          message: `image node path must start with "${expected}"`,
        });
      }
    });
  });

export type ResolvedFlow = z.infer<typeof ResolvedFlowSchema>;
export type ResolvedFlowNode = z.infer<typeof NodeSchema>;
export type NodeType = z.infer<typeof NodeTypeSchema>;
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

const FlowGeometricNodeData = z
  .object({
    ...NodeSemanticBaseShape,
    ...NodeCapabilitiesShape,
  })
  .strict();

const FlowImageNodeData = z
  .object({
    ...NodeSemanticBaseShape,
    ...NodeCapabilitiesShape,
    path: z.string().min(1).refine(isCleanRelativePath, {
      message: 'path must be a relative path under the project root (no absolute / traversal)',
    }),
    alt: z.string().optional(),
  })
  .strict();

const FlowHtmlNodeData = z
  .object({
    ...NodeSemanticBaseShape,
    ...NodeCapabilitiesShape,
    html: z.string().optional(),
  })
  .strict();

const FlowIconNodeData = z
  .object({
    ...NodeSemanticBaseShape,
    ...NodeCapabilitiesShape,
    icon: z.string().min(1),
    alt: z.string().optional(),
  })
  .strict();

const FlowNodeBaseShape = {
  id: z.string().min(1),
};

const makeFlowGeometricSchema = (type: (typeof GEOMETRIC_NODE_TYPES)[number]) =>
  z
    .object({
      ...FlowNodeBaseShape,
      type: z.literal(type),
      data: FlowGeometricNodeData,
    })
    .strict();

export const FlowRectangleNodeSchema = makeFlowGeometricSchema('rectangle');
export const FlowEllipseNodeSchema = makeFlowGeometricSchema('ellipse');
export const FlowStickyNodeSchema = makeFlowGeometricSchema('sticky');
export const FlowTextNodeSchema = makeFlowGeometricSchema('text');
export const FlowDatabaseNodeSchema = makeFlowGeometricSchema('database');
export const FlowServerNodeSchema = makeFlowGeometricSchema('server');
export const FlowUserNodeSchema = makeFlowGeometricSchema('user');
export const FlowQueueNodeSchema = makeFlowGeometricSchema('queue');
export const FlowCloudNodeSchema = makeFlowGeometricSchema('cloud');

export const FlowImageNodeSchema = z
  .object({
    ...FlowNodeBaseShape,
    type: z.literal('image'),
    data: FlowImageNodeData,
  })
  .strict();

export const FlowHtmlNodeSchema = z
  .object({
    ...FlowNodeBaseShape,
    type: z.literal('html'),
    data: FlowHtmlNodeData,
  })
  .strict();

export const FlowIconNodeSchema = z
  .object({
    ...FlowNodeBaseShape,
    type: z.literal('icon'),
    data: FlowIconNodeData,
  })
  .strict();

const FlowNodeSchema = z.discriminatedUnion('type', [
  FlowRectangleNodeSchema,
  FlowEllipseNodeSchema,
  FlowStickyNodeSchema,
  FlowTextNodeSchema,
  FlowDatabaseNodeSchema,
  FlowServerNodeSchema,
  FlowUserNodeSchema,
  FlowQueueNodeSchema,
  FlowCloudNodeSchema,
  FlowImageNodeSchema,
  FlowHtmlNodeSchema,
  FlowIconNodeSchema,
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
// FlowSchema validates the whole graph; this companion describes the top-level
// shape without inlining every node variant or the connector shape, so the
// runtime-introspectable JSON Schema stays compact. Authors drill into
// `seeflow schema node` / `seeflow schema connector` for the detailed shapes.
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
    // type:'image'-specific
    borderWidth: z.number().min(1).max(8).optional(),
    // type:'icon'-specific
    color: ColorTokenSchema.optional(),
    strokeWidth: z.number().min(0.5).max(4).optional(),
    // type:'html'-specific
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
