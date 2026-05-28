import { COMPONENT_NAMES, componentCatalog } from '@seeflow/canvas/catalog';
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
  // `'none'` renders transparent border / fill on nodes (no stroke, no fill).
  // Hidden from the connector-color picker — invisible edges aren't useful,
  // and `'default'` already covers "inherit".
  'none',
  'default',
  'white',
  'slate',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
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
  borderSize: z.number().min(0).optional(),
  borderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
  fontSize: z.number().positive().optional(),
  // Horizontal alignment for the node's text content. Defaults to 'center'
  // at render time when omitted; explicit picks from the toolbar's Align
  // toggle persist here.
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  cornerRadius: z.number().min(0).optional(),
  // Theme-aware elevation level (0 = none, 5 = deepest). Undefined preserves
  // each renderer's baseline shadow (e.g. rectangle: sf:shadow-sm); explicit
  // 0 removes it. Renderers translate this to `var(--node-shadow-N)`.
  shadow: z.number().int().min(0).max(5).optional(),
};

// Semantic-data fields shared by every node type. `name` is optional —
// every visual works without a label. `icon` is decorative-by-default; the
// `type:'icon'` variant overrides it to required.
const NodeSemanticBaseShape = {
  name: z
    .string()
    .optional()
    .describe(
      "Short human-readable label rendered in the node header. Omit on decorative nodes (sticky, type:'text') where the body content IS the label.",
    ),
  description: z
    .string()
    .optional()
    .describe(
      'One-sentence summary surfaced in the detail sidebar and tooltips. Set whenever a reader would benefit from more context than the name alone.',
    ),
  detail: z
    .string()
    .optional()
    .describe(
      'Long-form markdown shown in the detail sidebar. Supports headings, lists, code, and ```mermaid``` blocks (the canvas renders mermaid inline). Use for runbooks, schemas, sequence diagrams.',
    ),
  icon: z
    .string()
    .optional()
    .describe(
      "Decorative header glyph (Lucide icon name in kebab-case, e.g. 'database', 'cloud-upload'). Falls back to a placeholder when unknown. On type:'icon' nodes the icon IS the visual and is required.",
    ),
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
export const ScriptActionSchema = z.object({
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

export const StateSourceSchema = z
  .discriminatedUnion('kind', [
    z
      .object({ kind: z.literal('request') })
      .describe(
        'Poll-based state: `statusAction` samples an endpoint on an interval (REST GET, healthcheck, DB query). Use for services you can probe.',
      ),
    z
      .object({ kind: z.literal('event') })
      .describe(
        'Push-based state: `statusAction` subscribes to a stream (SSE, webhook, queue topic). Use for message buses, async pipelines, anything that announces state changes.',
      ),
  ])
  .describe(
    "Declares how this node's live state is sourced. Pair with `statusAction` so observers can tell at a glance whether the node's status is polled or pushed.",
  );

// Capabilities — any subset of these makes a node Playable / Stateful. All
// optional, valid on every node type. A node is Playable iff `playAction` is
// set; Stateful iff `statusAction` is set; Both iff both. `stateSource` is
// informational metadata that pairs with statusAction. `handlerModule` is
// reserved for a future skills runtime and is schema-only at v1.
const NodeCapabilitiesShape = {
  playAction: PlayActionSchema.optional().describe(
    'One-shot script the user invokes by clicking the node (a "Play" affordance). Studio spawns `<interpreter> [...args] <scriptPath>` from the project root with the optional `input` JSON-serialized to stdin. Use for HTTP calls, CLI invocations, anything triggered on demand.',
  ),
  statusAction: StatusActionSchema.optional().describe(
    "Long-running status probe. Same spawn shape as `playAction` but the script ticks continuously and writes one JSON `StatusReport` per line to stdout; the canvas renders the most recent state badge. Pair with `stateSource` so observers know whether it's poll- or push-based.",
  ),
  stateSource: StateSourceSchema.optional().describe(
    'Set this on any node that has a `statusAction`. Choose `request` for poll-based sources, `event` for push-based sources. Omit on decorative nodes (sticky, label-only text) and on action nodes whose only behavior is `playAction`.',
  ),
  handlerModule: z
    .string()
    .optional()
    .describe(
      'Reserved for the v2 skills runtime. Schema-only at v1 — set by tooling; leave undefined when authoring flows by hand.',
    ),
};

// 15 flat node types. The first 11 are geometric/illustrative and share
// GeometricNodeData. `image`, `html`, `icon`, `component` carry per-type
// fields. The renderer picks the SVG / chrome by `type`; the schema treats
// them (apart from the per-type fields below) as identical.
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
  'diamond',
  'hexagon',
] as const;

export const NodeTypeSchema = z.enum([
  ...GEOMETRIC_NODE_TYPES,
  'image',
  'html',
  'icon',
  'component',
]);

// --- Component node spec/action schemas --------------------------------------
// The 'component' node renders a json-render-driven reactive UI on the canvas.
// `spec` is the source of truth for layout + interactivity; on disk it lives at
// `<project>/nodes/<id>/spec.json` (the resolver inlines it into data.spec for
// ResolvedFlowSchema). Element types and props are catalog-validated by a
// superRefine wired in a later story.

export const ComponentSpecElementSchema = z.object({
  type: z.string().min(1),
  props: z.record(z.string(), z.unknown()).optional(),
  children: z.array(z.string()).optional(),
  watch: z.record(z.string(), z.unknown()).optional(),
});

// Declarative state mutation. `path` is a JSON Pointer (starts with '/');
// `value` may itself carry { $param } / { $state } refs resolved by the
// runtime at dispatch time.
const SetActionSchema = z.object({
  kind: z.literal('set'),
  path: z
    .string()
    .min(1)
    .startsWith('/', { message: 'path must be a JSON Pointer (start with /)' }),
  value: z.unknown(),
});

// Script-kind component actions reuse the existing ScriptActionSchema shape
// (interpreter, scriptPath, timeoutMs, ...). The action runner roots scriptPath
// under `<projectRoot>/nodes/<nodeId>/`.
export const ComponentActionSchema = z.discriminatedUnion('kind', [
  SetActionSchema,
  ScriptActionSchema,
]);

export const ComponentSpecSchema = z.object({
  root: z.string().min(1),
  elements: z.record(z.string(), ComponentSpecElementSchema),
  state: z.record(z.string(), z.unknown()).optional(),
  actions: z.record(z.string(), ComponentActionSchema).optional(),
});

export type ComponentSpec = z.infer<typeof ComponentSpecSchema>;
export type ComponentAction = z.infer<typeof ComponentActionSchema>;
export type ComponentSpecElement = z.infer<typeof ComponentSpecElementSchema>;

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
  borderWidth: z.number().min(0).max(8).optional(),
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

// Component node — `spec` is the json-render tree. On disk the spec lives in
// `<project>/nodes/<id>/spec.json`; the resolver inlines it into data.spec
// before ResolvedFlowSchema validates the merged shape. The on-disk
// FlowComponentNodeData below has no `spec` field.
const ResolvedComponentNodeData = z.object({
  ...NodeSemanticBaseShape,
  ...NodeVisualBaseShape,
  ...NodeCapabilitiesShape,
  spec: ComponentSpecSchema,
  autoSize: z.boolean().optional(),
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
  makeResolvedGeometricSchema('diamond'),
  makeResolvedGeometricSchema('hexagon'),
  z.object({ ...NodeBaseShape, type: z.literal('image'), data: ResolvedImageNodeData }),
  z.object({ ...NodeBaseShape, type: z.literal('html'), data: ResolvedHtmlNodeData }),
  z.object({ ...NodeBaseShape, type: z.literal('icon'), data: ResolvedIconNodeData }),
  z.object({
    ...NodeBaseShape,
    type: z.literal('component'),
    data: ResolvedComponentNodeData,
  }),
]);

// Connector — unchanged by the flat-types refactor.
const ConnectorStyleSchema = z.enum(['solid', 'dashed', 'dotted']);
const ConnectorDirectionSchema = z.enum(['forward', 'backward', 'both', 'none']);
const ConnectorPathSchema = z.enum(['curve', 'step']);

const ConnectorVisualBaseShape = {
  style: ConnectorStyleSchema.optional(),
  color: ColorTokenSchema.optional(),
  direction: ConnectorDirectionSchema.optional(),
  borderSize: z.number().min(0).optional(),
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
    // type:'component' spec.elements entries are catalog-validated here so
    // unknown component names and prop shape mismatches surface at flow-read
    // time with paths pointing into the offending element.
    resolved.nodes.forEach((node, idx) => {
      if (node.type !== 'component') return;
      const elements = node.data.spec.elements;
      for (const [elId, entry] of Object.entries(elements)) {
        const def = componentCatalog.components[entry.type];
        if (!def) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['nodes', idx, 'data', 'spec', 'elements', elId, 'type'],
            message: `Unknown component type "${entry.type}". Valid names: ${COMPONENT_NAMES.join(', ')}`,
          });
          continue;
        }
        const propsResult = def.props.safeParse(entry.props ?? {});
        if (!propsResult.success) {
          for (const issue of propsResult.error.issues) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['nodes', idx, 'data', 'spec', 'elements', elId, 'props', ...issue.path],
              message: issue.message,
            });
          }
        }
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
    path: z
      .string()
      .min(1)
      .refine(isCleanRelativePath, {
        message: 'path must be a relative path under the project root (no absolute / traversal)',
      })
      .describe(
        "Project-root-relative path to the image file. MUST start with 'nodes/<id>/' so the delete_node cascade owns cleanup. Supported formats: PNG, JPEG, SVG, GIF, WebP.",
      ),
    alt: z
      .string()
      .optional()
      .describe('Accessibility alt text. Set on every non-decorative image.'),
  })
  .strict();

const FlowHtmlNodeData = z
  .object({
    ...NodeSemanticBaseShape,
    ...NodeCapabilitiesShape,
    html: z
      .string()
      .optional()
      .describe(
        "Inline HTML rendered inside the node. Studio externalizes this to `<project>/nodes/<id>/view.html` on write and inlines it back on read, so authors always see the actual string. Sanitized before injection. Escape-hatch for content the geometric/icon/component visuals don't cover.",
      ),
  })
  .strict();

const FlowIconNodeData = z
  .object({
    ...NodeSemanticBaseShape,
    ...NodeCapabilitiesShape,
    icon: z
      .string()
      .min(1)
      .describe(
        "Required Lucide icon name (kebab-case, e.g. 'cloud-upload', 'database'). On type:'icon' nodes the icon IS the visual — overrides the optional decorative `icon` from the semantic base.",
      ),
    alt: z.string().optional().describe('Accessibility alt text for the icon glyph.'),
  })
  .strict();

// Component node, on-disk shape. `spec` is intentionally absent — the sidecar
// `<project>/nodes/<id>/spec.json` is the source of truth. `.strict()` rejects
// any stray spec field that slips through (the resolver layer is responsible
// for inlining + the writer for stripping it back out).
const FlowComponentNodeData = z
  .object({
    ...NodeSemanticBaseShape,
    ...NodeCapabilitiesShape,
    autoSize: z
      .boolean()
      .optional()
      .describe(
        'When true the renderer measures its content and React Flow sizes the wrapper around it. Default (undefined / false) uses the persisted width/height path.',
      ),
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
export const FlowDiamondNodeSchema = makeFlowGeometricSchema('diamond');
export const FlowHexagonNodeSchema = makeFlowGeometricSchema('hexagon');

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

export const FlowComponentNodeSchema = z
  .object({
    ...FlowNodeBaseShape,
    type: z.literal('component'),
    data: FlowComponentNodeData,
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
  FlowDiamondNodeSchema,
  FlowHexagonNodeSchema,
  FlowImageNodeSchema,
  FlowHtmlNodeSchema,
  FlowIconNodeSchema,
  FlowComponentNodeSchema,
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
    borderSize: z.number().min(0).optional(),
    borderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
    fontSize: z.number().positive().optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
    cornerRadius: z.number().min(0).optional(),
    shadow: z.number().int().min(0).max(5).optional(),
    // type:'image'-specific
    borderWidth: z.number().min(0).max(8).optional(),
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
    borderSize: z.number().min(0).optional(),
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

// =============================================================================
// Seeflow manifest — top-level descriptor for a multi-flow project.
// Lives at <project>/seeflow.json. Declares the flows the project hosts and
// which one to open by default. The scanner (project-scanner.ts) turns this
// plus the flows/<id>/flow.json files into ScannedFlow entries the registry
// can consume.
// =============================================================================

// Flow ids are URL-safe and folder-safe: lowercase alphanumerics + dashes,
// must start with an alphanumeric character. Same pattern enforced by the
// manifest CRUD endpoints (POST/PATCH /api/projects/:project/flows[/:flow]).
export const FlowIdPattern = /^[a-z0-9][a-z0-9-]*$/;

const SeeflowManifestFlowEntrySchema = z.object({
  id: z.string().regex(FlowIdPattern, {
    message: 'flow id must match /^[a-z0-9][a-z0-9-]*$/',
  }),
  name: z.string().min(1),
  icon: z.string().min(1).optional(),
});

export const SeeflowManifestSchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1),
    description: z.string().optional(),
    defaultFlow: z.string().min(1),
    flows: z.array(SeeflowManifestFlowEntrySchema).min(1),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    manifest.flows.forEach((flow, idx) => {
      if (seen.has(flow.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['flows', idx, 'id'],
          message: `duplicate flow id "${flow.id}"`,
        });
      }
      seen.add(flow.id);
    });
    if (!manifest.flows.some((flow) => flow.id === manifest.defaultFlow)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['defaultFlow'],
        message: `defaultFlow "${manifest.defaultFlow}" does not match any entry in flows[]`,
      });
    }
  });

export type SeeflowManifest = z.infer<typeof SeeflowManifestSchema>;
export type SeeflowManifestFlowEntry = z.infer<typeof SeeflowManifestFlowEntrySchema>;
