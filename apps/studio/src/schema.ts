import { COMPONENT_NAMES, componentCatalog } from '@seeflow/canvas/catalog';
import { z } from 'zod';

const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

// `HttpMethodSchema` is documentation metadata on connectors.
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
  'gray',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'fuchsia',
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
  // Curated font-family token; resolves to a concrete CSS stack in the canvas
  // (FONT_STACKS). Stored as a token so saved flows stay portable. Omitted →
  // inherits the canvas default font.
  fontFamily: z.enum(['sans', 'system', 'serif', 'mono', 'rounded', 'handwritten']).optional(),
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
      "Decorative header glyph. Encoded as `vendor:name` — unprefixed values are Lucide kebab-case (e.g. 'database', 'cloud-upload'); prefixed values target installed icon packs ('aws:lambda', 'azure:functions') or the iconify catalog ('iconify:logos:google-cloud'). Falls back to a placeholder when unknown. On type:'icon' nodes the icon IS the visual and is required.",
    ),
};

// Relative-path safety refine (textual). Mirrors the same rule used for
// image-node paths (no absolute / traversal).
const isCleanRelativePath = (s: string): boolean => {
  if (s.length === 0) return false;
  if (s.startsWith('/') || s.startsWith('\\')) return false;
  if (/^[A-Za-z]:[\\/]/.test(s)) return false;
  const segments = s.split(/[\\/]/);
  return !segments.some((seg) => seg === '..');
};

// Group membership integrity, shared by BOTH the resolved and on-disk flow
// `superRefine`s (mirrors how the connector-existence check is duplicated across
// the two unions). Enforces: every id in a group's `childIds` exists; a node
// belongs to AT MOST ONE group; and a group id never appears in any `childIds`
// (no nested groups in v1, design §9.7). Operates on the minimal shape both
// unions share — `{ id, type, data.childIds? }`.
const addGroupMembershipIssues = (
  // `data` is typed `unknown` because the resolved/on-disk node unions are
  // structurally exclusive (most variants have no `childIds`), so a narrow
  // `{ childIds?: string[] }` arg type would be rejected as "no common
  // properties". We read `childIds` off the group variant via a local cast.
  nodes: ReadonlyArray<{ id: string; type: string; data?: unknown }>,
  ctx: z.RefinementCtx,
): void => {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const groupIds = new Set(nodes.filter((n) => n.type === 'group').map((n) => n.id));
  const claimedBy = new Map<string, string>();
  nodes.forEach((node, idx) => {
    if (node.type !== 'group') return;
    const childIds = (node.data as { childIds?: string[] } | undefined)?.childIds ?? [];
    childIds.forEach((childId, childIdx) => {
      const path = ['nodes', idx, 'data', 'childIds', childIdx];
      if (!nodeIds.has(childId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `Group ${node.id} references unknown child node: ${childId}`,
        });
        return;
      }
      if (groupIds.has(childId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `Group ${node.id} may not contain another group: ${childId} (no nested groups)`,
        });
      }
      const owner = claimedBy.get(childId);
      if (owner !== undefined && owner !== node.id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `Node ${childId} is already a member of group ${owner} (no double-membership)`,
        });
        return;
      }
      claimedBy.set(childId, node.id);
    });
  });
};

// Flow ids are URL-safe and folder-safe: lowercase alphanumerics + dashes,
// must start with an alphanumeric character. Same pattern enforced by the
// manifest CRUD endpoints (POST/PATCH /api/projects/:project/flows[/:flow]).
// Defined early so the linkflow node data shapes below can reference it; the
// SeeflowManifest schemas at the bottom of the file reuse the same constant.
export const FlowIdPattern = /^[a-z0-9][a-z0-9-]*$/;

// 23 flat node types. The first 14 are geometric/illustrative and share
// GeometricNodeData. `image`, `html`, `icon`, `component`, `linkflow`,
// `freehand`, `line`, `group`, `table` carry per-type fields. The renderer
// picks the SVG / chrome by `type`; the schema treats them (apart from the
// per-type fields below) as identical.
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
  'triangle',
  'parallelogram',
  'document',
] as const;

export const NodeTypeSchema = z.enum([
  ...GEOMETRIC_NODE_TYPES,
  'image',
  'html',
  'icon',
  'component',
  'linkflow',
  'freehand',
  'line',
  // A `group` is a first-class container node, NOT a geometric shape — it owns
  // `data.childIds` (membership) and is deliberately kept out of
  // GEOMETRIC_NODE_TYPES so it routes through its own GroupNodeData variant.
  'group',
  // A `table` is a Miro-style visual grid — its own structural data
  // (columns/rows/cells) routes through the TableNodeData variant.
  'table',
]);

// --- Component node spec/action schemas --------------------------------------
// The 'component' node renders a json-render-driven reactive UI on the canvas.
// `spec` is the source of truth for layout + interactivity; on disk it lives at
// `<project>/nodes/<id>/spec.json` (the resolver inlines it into data.spec for
// ResolvedFlowSchema). Element types and props are catalog-validated by the
// `superRefine` on ResolvedFlowSchema below.

export const ComponentSpecElementSchema = z.object({
  type: z
    .string()
    .min(1)
    .describe(
      'Component name from the catalog — see `seeflow schema componentCatalog` for the legal values and the props each type accepts.',
    ),
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

// Component actions are declarative `set` mutations only — they update local
// canvas state via a JSON Pointer path and never round-trip to the server.
export const ComponentActionSchema = SetActionSchema;

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
});

// Image node — references a file under the project root by relative path.
// `path` is constrained to live under `nodes/<id>/` (post-validate refine on
// ResolvedFlowSchema below) so the delete_node cascade owns cleanup.
const ResolvedImageNodeData = z.object({
  ...NodeSemanticBaseShape,
  ...NodeVisualBaseShape,
  path: z.string().min(1).refine(isCleanRelativePath, {
    message: 'path must be a relative path under the project root (no absolute / traversal)',
  }),
  alt: z.string().optional(),
  caption: z.string().optional(),
  borderWidth: z.number().min(0).max(8).optional(),
});

// Html node — escape-hatch for content the curated visuals don't cover.
// `html` is externalized to `<project>/nodes/<id>/view.html` on write; the
// file-ref resolver inlines it back on read. The renderer sanitizes before
// injection. `autoSize:true` lets the renderer size around the content.
const ResolvedHtmlNodeData = z.object({
  ...NodeSemanticBaseShape,
  ...NodeVisualBaseShape,
  html: z.string().optional(),
  autoSize: z.boolean().optional(),
});

// Icon node — renders a Lucide glyph as its main visual. `icon` is required
// here (overrides the optional decorative `icon` from NodeSemanticBaseShape).
const ResolvedIconNodeData = z.object({
  ...NodeSemanticBaseShape,
  ...NodeVisualBaseShape,
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
  spec: ComponentSpecSchema,
  autoSize: z.boolean().optional(),
});

// Linkflow node — clickable "go to another flow" link. `target` is optional
// because freshly-dropped nodes start unlinked; once the user picks a flow
// via the picker dialog, the studio patches both `project` and `flow` (each
// matching FlowIdPattern). Target existence (does the project + flow still
// resolve to a known flow?) is a render-time concern, not a parse-time one:
// renames/deletes still parse cleanly so undo / cross-project picks work
// without the schema rejecting them.
export const LinkflowTargetSchema = z.object({
  project: z.string().regex(FlowIdPattern, {
    message: 'target.project must match /^[a-z0-9][a-z0-9-]*$/',
  }),
  flow: z.string().regex(FlowIdPattern, {
    message: 'target.flow must match /^[a-z0-9][a-z0-9-]*$/',
  }),
});

const ResolvedLinkflowNodeData = z.object({
  ...NodeSemanticBaseShape,
  ...NodeVisualBaseShape,
  target: LinkflowTargetSchema.optional(),
});

// Freehand ink stroke. `points` are [x, y, pressure] normalized to the node's
// local box (x/y in 0..1, pressure in 0..1) so resize scales the rendered path.
// color + strokeWidth come from the style side-table (same fields as icons).
const ResolvedFreehandNodeData = z.object({
  ...NodeSemanticBaseShape,
  ...NodeVisualBaseShape,
  points: z.array(z.tuple([z.number(), z.number(), z.number()])).min(2),
  color: ColorTokenSchema.optional(),
  strokeWidth: z.number().min(0.5).max(4).optional(),
});

// Decorative straight line. `points` are EXACTLY two endpoints [x, y]
// normalized to the node's local box (0..1) so resize scales the rendered
// segment. Stroke colour/width/style come from the shared visual base
// (borderColor / borderSize / borderStyle) — no dedicated fields.
const ResolvedLineNodeData = z.object({
  ...NodeSemanticBaseShape,
  ...NodeVisualBaseShape,
  points: z.array(z.tuple([z.number(), z.number()])).length(2),
});

// Group node — a first-class container that owns membership via `childIds`
// (absolute-positioned member node ids). Reuses the shared semantic + visual
// base so title/description/sidebar and background/border/cornerRadius come for
// free; `childIds` is the one structural field. Member referential integrity
// (every id exists, no double-membership, no nesting) is enforced by the
// `superRefine` on ResolvedFlowSchema below — NOT here — so the per-node schema
// stays composable. An empty `childIds` is allowed (a labeled zone, design §9.11).
const ResolvedGroupNodeData = z.object({
  ...NodeSemanticBaseShape,
  ...NodeVisualBaseShape,
  childIds: z.array(z.string()).default([]),
});

// Table node — a Miro-style visual grid of plain-text cells. Each column/row
// carries a stable `id` AND its own pixel size, so structure + sizing are
// intrinsic and self-contained in flow.json (no width side-table keyed by id;
// insert/delete/resize never split one logical edit across flow.json +
// style.json). `cells` is sparse, keyed `${rowId}:${colId}`; empty cells are
// omitted. The node footprint is derived (Σ widths × Σ heights), never stored.
export const TableColumnSchema = z.object({
  id: z.string().min(1),
  width: z.number().positive(),
});
export const TableRowSchema = z.object({
  id: z.string().min(1),
  height: z.number().positive(),
});

// Table-specific structural fields shared by the resolved + on-disk shapes.
const TableDataShape = {
  columns: z.array(TableColumnSchema).min(1),
  rows: z.array(TableRowSchema).min(1),
  cells: z.record(z.string(), z.string()).default({}),
  headerRow: z.boolean().optional(),
};

const ResolvedTableNodeData = z.object({
  ...NodeSemanticBaseShape,
  ...NodeVisualBaseShape,
  ...TableDataShape,
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
  makeResolvedGeometricSchema('triangle'),
  makeResolvedGeometricSchema('parallelogram'),
  makeResolvedGeometricSchema('document'),
  z.object({ ...NodeBaseShape, type: z.literal('image'), data: ResolvedImageNodeData }),
  z.object({ ...NodeBaseShape, type: z.literal('html'), data: ResolvedHtmlNodeData }),
  z.object({ ...NodeBaseShape, type: z.literal('icon'), data: ResolvedIconNodeData }),
  z.object({
    ...NodeBaseShape,
    type: z.literal('component'),
    data: ResolvedComponentNodeData,
  }),
  z.object({
    ...NodeBaseShape,
    type: z.literal('linkflow'),
    data: ResolvedLinkflowNodeData,
  }),
  z.object({
    ...NodeBaseShape,
    type: z.literal('freehand'),
    data: ResolvedFreehandNodeData,
  }),
  z.object({
    ...NodeBaseShape,
    type: z.literal('line'),
    data: ResolvedLineNodeData,
  }),
  z.object({
    ...NodeBaseShape,
    type: z.literal('group'),
    data: ResolvedGroupNodeData,
  }),
  z.object({
    ...NodeBaseShape,
    type: z.literal('table'),
    data: ResolvedTableNodeData,
  }),
]);

// Connector — unchanged by the flat-types refactor.
const ConnectorStyleSchema = z.enum(['solid', 'dashed', 'dotted']);
const ConnectorDirectionSchema = z.enum(['forward', 'backward', 'both', 'none']);
const ConnectorPathSchema = z.enum(['curve', 'step']);
// Endpoint glyph drawn at the arrow ends. `direction` decides WHICH ends carry
// a head; `headShape` (target end) and `tailShape` (source end) decide WHAT
// each looks like. Both absent ⇒ 'arrow' (the historical closed arrowhead), so
// existing flows render unchanged; `tailShape` absent falls back to `headShape`
// so a single pick still styles both ends symmetrically. 'one' / 'many' /
// 'optional-many' are ER crow's-foot endpoints (single tick, fork, circle+fork);
// 'diamond' / 'circle' are filled UML-ish endpoints. Mixing them — e.g.
// tailShape:'one' + headShape:'many' — draws ER one-to-many relationships.
export const ConnectorHeadShapeSchema = z.enum([
  'arrow',
  'one',
  'many',
  'optional-many',
  'diamond',
  'circle',
]);

const ConnectorVisualBaseShape = {
  style: ConnectorStyleSchema.optional(),
  color: ColorTokenSchema.optional(),
  direction: ConnectorDirectionSchema.optional(),
  borderSize: z.number().min(0).optional(),
  animated: z
    .boolean()
    .optional()
    .describe(
      'Marching-dash animation along the line. Marks the connection a change is really about; the canvas also animates connectors adjacent to a running node, and the two are ORed.',
    ),
  path: ConnectorPathSchema.optional(),
  headShape: ConnectorHeadShapeSchema.optional(),
  tailShape: ConnectorHeadShapeSchema.optional(),
  fontSize: z.number().positive().optional(),
  fontFamily: z.enum(['sans', 'system', 'serif', 'mono', 'rounded', 'handwritten']).optional(),
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
    // type:'group' membership integrity (childIds reference / single-membership
    // / no-nesting). Shared with the on-disk FlowSchema below.
    addGroupMembershipIssues(resolved.nodes, ctx);
    // type:'image' upload paths must live under the node's own
    // `nodes/<id>/` folder so delete_node's removeNodeDir cascade is the
    // single source of cleanup. The path is project-root-relative: legacy
    // single-flow projects (flowDir '.') store the bare `nodes/<id>/<file>`,
    // and manifest-driven projects prefix the flowDir (e.g.
    // `flows/main/nodes/<id>/<file>`). Both shapes must pass — accept either
    // a leading `nodes/<id>/` or an embedded `/nodes/<id>/` segment.
    resolved.nodes.forEach((node, idx) => {
      if (node.type !== 'image') return;
      const path = (node.data as { path?: string }).path;
      const segment = `nodes/${node.id}/`;
      if (typeof path === 'string' && !path.startsWith(segment) && !path.includes(`/${segment}`)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nodes', idx, 'data', 'path'],
          message: `image node path must contain "${segment}"`,
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
export type ConnectorHeadShape = z.infer<typeof ConnectorHeadShapeSchema>;
export type EdgePin = z.infer<typeof EdgePinSchema>;
export type EdgePinSide = z.infer<typeof EdgePinSideSchema>;

// =============================================================================
// Flow schema — pure semantic data, every visual/layout field stripped.
// What lives on disk in <project>/flow.json after the split.
// =============================================================================

const FlowGeometricNodeData = z
  .object({
    ...NodeSemanticBaseShape,
  })
  .strict();

const FlowImageNodeData = z
  .object({
    ...NodeSemanticBaseShape,
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
    caption: z
      .string()
      .optional()
      .describe('Optional caption shown below the image. Edited by double-clicking the image.'),
  })
  .strict();

const FlowHtmlNodeData = z
  .object({
    ...NodeSemanticBaseShape,
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
    icon: z
      .string()
      .min(1)
      .describe(
        "Required icon. Encoded as `vendor:name` — unprefixed values are Lucide kebab-case (e.g. 'cloud-upload', 'database'); prefixed values target installed icon packs ('aws:lambda', 'azure:functions') or the iconify catalog ('iconify:logos:google-cloud'). On type:'icon' nodes the icon IS the visual — overrides the optional decorative `icon` from the semantic base.",
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
    autoSize: z
      .boolean()
      .optional()
      .describe(
        'When true the renderer measures its content and React Flow sizes the wrapper around it. Default (undefined / false) uses the persisted width/height path.',
      ),
  })
  .strict();

// Linkflow node, on-disk shape. `target` carries the slug pair that names
// another flow in the registry; optional because a freshly-dropped link node
// is unlinked until the picker commits a choice. Target existence is checked
// at render time (broken-link state), never at parse time, so renames /
// deletes still parse cleanly.
const FlowLinkflowNodeData = z
  .object({
    ...NodeSemanticBaseShape,
    target: LinkflowTargetSchema.optional().describe(
      "Slug pair { project, flow } naming the flow this node links to. Both fields are matched against /^[a-z0-9][a-z0-9-]*$/. Omitted on freshly-dropped nodes — the picker dialog patches it once the user picks a target. Cross-project links are allowed (project may differ from the host flow's project).",
    ),
  })
  .strict();

// On-disk freehand data. `points` are normalized to the node box; the box
// (position/width/height) plus color/strokeWidth live in style.json, never here.
const FlowFreehandNodeData = z
  .object({
    ...NodeSemanticBaseShape,
    points: z
      .array(z.tuple([z.number(), z.number(), z.number()]))
      .min(2)
      .describe(
        'Freehand ink samples as [x, y, pressure], normalized to the node box (x/y in 0..1, pressure in 0..1). Authored by the pen tool, not by hand.',
      ),
  })
  .strict();

// On-disk line data. `points` are EXACTLY two endpoints normalized to the node
// box; the box (position/width/height) plus stroke colour/width/style live in
// style.json, never here.
const FlowLineNodeData = z
  .object({
    ...NodeSemanticBaseShape,
    points: z
      .array(z.tuple([z.number(), z.number()]))
      .length(2)
      .describe(
        'Decorative line endpoints as [x, y], normalized to the node box (0..1). Exactly two points. Authored by the line tool, not by hand.',
      ),
  })
  .strict();

// Group node, on-disk shape. `childIds` is SEMANTIC (membership), so it lives
// in flow.json — NOT style.json. The visual base fields (width/height/colors)
// route to style.json via splitFlow, exactly like every other node type, so
// they are intentionally absent from this strict on-disk data schema. `.strict()`
// rejects any stray visual key that failed to route. An empty `childIds` is
// allowed (design §9.11) and `.default([])` normalizes a missing array on read.
const FlowGroupNodeData = z
  .object({
    ...NodeSemanticBaseShape,
    childIds: z
      .array(z.string())
      .default([])
      .describe(
        "Ids of the member nodes this group contains. Member node positions stay ABSOLUTE (no reparenting); the group owns membership via this list. A node may belong to at most one group, and a group id may never appear here (no nested groups). An empty list is a valid 'labeled zone'.",
      ),
  })
  .strict();

// Table node, on-disk shape. Structure + per-column/row sizing are SEMANTIC and
// intrinsic (the whole table is self-contained), so they persist to flow.json —
// NOT style.json. `.strict()` rejects any stray visual key that should have
// routed to style.json (border/font/colors ride the shared visual base and are
// split out by splitFlow's NODE_STYLE_KEYS, exactly like every other node).
const FlowTableNodeData = z
  .object({
    ...NodeSemanticBaseShape,
    ...TableDataShape,
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
export const FlowTriangleNodeSchema = makeFlowGeometricSchema('triangle');
export const FlowParallelogramNodeSchema = makeFlowGeometricSchema('parallelogram');
export const FlowDocumentNodeSchema = makeFlowGeometricSchema('document');

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

// Authoring shape surfaced by `seeflow schema node component` — the contract an
// agent reads to BUILD a component node, NOT the on-disk parse shape above. The
// on-disk FlowComponentNodeData omits `spec` because the studio externalizes it
// to <project>/nodes/<id>/spec.json on write, but add_node / add_bulk / patch
// callers MUST supply `spec` inline at data.spec or the post-merge
// ResolvedFlowSchema reparse rejects the node ("data.spec Required"). Surfacing
// the spec-less on-disk schema for introspection is actively misleading (its
// additionalProperties:false reads as "spec forbidden"), so the catalog points
// at this authoring schema instead. Parsing flow.json still uses the spec-less
// FlowComponentNodeSchema above; this schema is introspection-only.
export const FlowComponentNodeAuthoringSchema = z
  .object({
    ...FlowNodeBaseShape,
    type: z.literal('component'),
    data: FlowComponentNodeData.extend({
      spec: ComponentSpecSchema.describe(
        'Required when authoring a component node. The json-render element tree for the reactive UI — pass it inline here on add_node / add_bulk / patch. Shape: `seeflow schema componentSpec`; legal elements[].type + props: `seeflow schema componentCatalog`. The studio externalizes it to <project>/nodes/<id>/spec.json on write, so it is absent from flow.json on disk (and from the on-disk node schema).',
      ),
    }),
  })
  .strict();

export const FlowLinkflowNodeSchema = z
  .object({
    ...FlowNodeBaseShape,
    type: z.literal('linkflow'),
    data: FlowLinkflowNodeData,
  })
  .strict();

export const FlowFreehandNodeSchema = z
  .object({
    ...FlowNodeBaseShape,
    type: z.literal('freehand'),
    data: FlowFreehandNodeData,
  })
  .strict();

export const FlowLineNodeSchema = z
  .object({
    ...FlowNodeBaseShape,
    type: z.literal('line'),
    data: FlowLineNodeData,
  })
  .strict();

export const FlowGroupNodeSchema = z
  .object({
    ...FlowNodeBaseShape,
    type: z.literal('group'),
    data: FlowGroupNodeData,
  })
  .strict();

export const FlowTableNodeSchema = z
  .object({
    ...FlowNodeBaseShape,
    type: z.literal('table'),
    data: FlowTableNodeData,
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
  FlowTriangleNodeSchema,
  FlowParallelogramNodeSchema,
  FlowDocumentNodeSchema,
  FlowImageNodeSchema,
  FlowHtmlNodeSchema,
  FlowIconNodeSchema,
  FlowComponentNodeSchema,
  FlowLinkflowNodeSchema,
  FlowFreehandNodeSchema,
  FlowLineNodeSchema,
  FlowGroupNodeSchema,
  FlowTableNodeSchema,
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
    // Mirror the resolved-union membership integrity on the on-disk shape so
    // the direct-FlowSchema read paths (getFlowGraphImpl, registerFlowImpl)
    // reject dangling/contradictory group membership too.
    addGroupMembershipIssues(flow.nodes, ctx);
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
    fontFamily: z.enum(['sans', 'system', 'serif', 'mono', 'rounded', 'handwritten']).optional(),
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
    animated: z.boolean().optional(),
    path: ConnectorPathSchema.optional(),
    headShape: ConnectorHeadShapeSchema.optional(),
    tailShape: ConnectorHeadShapeSchema.optional(),
    fontSize: z.number().positive().optional(),
    fontFamily: z.enum(['sans', 'system', 'serif', 'mono', 'rounded', 'handwritten']).optional(),
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
