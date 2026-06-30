export type ColorToken =
  | 'none'
  | 'default'
  | 'white'
  | 'slate'
  | 'gray'
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'green'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'fuchsia'
  | 'pink';

/**
 * Curated, cross-platform font-family tokens. Each resolves to a concrete CSS
 * font stack via FONT_STACKS in `./lib/font-stacks.ts`; storing the token (not
 * a raw stack) keeps saved flows portable and lets the stacks be tuned later.
 */
export type FontFamilyToken = 'sans' | 'system' | 'serif' | 'mono' | 'rounded' | 'handwritten';

export interface NodeVisual {
  width?: number;
  height?: number;
  borderColor?: ColorToken;
  backgroundColor?: ColorToken;
  borderSize?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  fontSize?: number;
  /** Curated font-family token; resolves to a CSS stack via FONT_STACKS. Unset → inherits the canvas default. */
  fontFamily?: FontFamilyToken;
  /**
   * Horizontal alignment for the node's text content. Defaults to `'center'`
   * at render time when unset (most node labels read better centered); the
   * toolbar's Align toggle persists explicit picks via this field.
   */
  textAlign?: 'left' | 'center' | 'right';
  cornerRadius?: number;
  /** Elevation level 0–5; renders as `var(--node-shadow-N)`. */
  shadow?: number;
}

export interface NodeDescription {
  description?: string;
  detail?: string;
}

/**
 * Optional, schema-only capability fields shared by every node type. Valid on
 * every node type.
 */
export interface NodeCapabilities {
  /** Reserved for v2 skills runtime. Schema-only at v1. */
  handlerModule?: string;
}

/**
 * Semantic-data fields shared by every node type. `name` is optional —
 * every visual works without a label. `icon` is decorative on every type
 * except `type:'icon'`, where it becomes the main visual and is required.
 */
export interface NodeSemanticBase extends NodeDescription {
  name?: string;
  icon?: string;
}

/**
 * The 19 flat node types. Visual kind is the type. Capabilities are
 * independent optional fields on `data`.
 */
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
export type GeometricNodeType = (typeof GEOMETRIC_NODE_TYPES)[number];

export type NodeType =
  | GeometricNodeType
  | 'image'
  | 'html'
  | 'icon'
  | 'component'
  | 'linkflow'
  | 'freehand'
  | 'line'
  | 'group'
  | 'table';

/**
 * Set of node types creatable via the canvas toolbar's draw-mode (click /
 * drag-to-place) gesture. Linkflow joins the geometric tiles because it ships
 * a toolbar affordance that drag-creates it, then auto-opens the picker.
 * `image`/`html`/`icon`/`component` are NOT drawable — they each need an
 * upload, picker, or dedicated authoring flow.
 */
export type DrawableNodeType = GeometricNodeType | 'linkflow' | 'line' | 'table';

/** Geometric nodes share the same data schema; type drives the SVG variant. */
export interface GeometricNodeData extends NodeSemanticBase, NodeVisual, NodeCapabilities {}

// Exhaustive enumeration of every field on `GeometricNodeData`. The `satisfies
// Record<keyof GeometricNodeData, true>` clause makes TypeScript fail compilation
// when the type gains a field and this const doesn't — the apps/studio parity
// test then catches drift between this set and the on-disk Zod schema.
export const CANVAS_NODE_DATA_FIELDS = {
  // semantic
  name: true,
  description: true,
  detail: true,
  icon: true,
  // visual
  width: true,
  height: true,
  borderColor: true,
  backgroundColor: true,
  borderSize: true,
  borderStyle: true,
  fontSize: true,
  fontFamily: true,
  textAlign: true,
  cornerRadius: true,
  shadow: true,
  // capabilities
  handlerModule: true,
} as const satisfies Record<keyof GeometricNodeData, true>;

export interface ImageNodeData extends NodeSemanticBase, NodeVisual, NodeCapabilities {
  path: string;
  alt?: string;
  /** Optional caption rendered below the image; edited via double-click. */
  caption?: string;
  borderWidth?: number;
}

export interface IconNodeData extends Omit<NodeSemanticBase, 'icon'>, NodeVisual, NodeCapabilities {
  /** Required for type:'icon' — the icon IS the visual. */
  icon: string;
  color?: ColorToken;
  strokeWidth?: number;
  alt?: string;
}

export interface FreehandNodeData extends NodeSemanticBase, NodeVisual, NodeCapabilities {
  /** Required for type:'freehand' — normalized [x, y, pressure] stroke samples. */
  points: [number, number, number][];
  color?: ColorToken;
  strokeWidth?: number;
}

/**
 * `type:'line'` node data — a decorative straight line segment. Mirrors the
 * freehand model but carries EXACTLY two endpoints (no pressure), normalized to
 * the node box (x/y in 0..1). Reuses NodeVisual stroke fields: `borderColor`
 * (stroke colour), `borderSize` (stroke width), `borderStyle`
 * (solid/dashed/dotted). NOT connectable — endpoints are edited via the two
 * endpoint handles, never through the connection system.
 */
export interface LineNodeData extends NodeSemanticBase, NodeVisual, NodeCapabilities {
  /** Exactly two endpoints [[x, y], [x, y]], normalized to the node box (0..1). */
  points: [[number, number], [number, number]];
}

export interface HtmlNodeData extends NodeSemanticBase, NodeVisual, NodeCapabilities {
  /**
   * Inline HTML content. Studio externalizes this to
   * `<project>/nodes/<id>/view.html` and stores a `file://` ref in flow.json;
   * the file-ref resolver inlines the resolved content on read, so the
   * renderer always sees the actual HTML string.
   */
  html?: string;
  /**
   * When true (or absent), the renderer measures content and React Flow sizes
   * the wrapper around it (capped at 800×600 by CSS). The studio adapter
   * enforces that autoSize:true and persisted width/height never coexist.
   */
  autoSize?: boolean;
}

/**
 * A single node in a component spec tree. `type` names a catalog entry (e.g.
 * 'Card', 'Button', 'Metric'); `props` carries that catalog entry's expected
 * fields, with values that may carry `$state` / `$action` / `$cond` runtime
 * refs resolved by ComponentRuntime. `children` lists element ids defined
 * elsewhere in `ComponentSpec.elements`.
 */
export interface ComponentSpecElement {
  type: string;
  props?: Record<string, unknown>;
  children?: string[];
  watch?: Record<string, unknown>;
}

/**
 * Declarative state mutation: write `value` at JSON Pointer `path` in the
 * component's internal state. `value` may itself reference `{ $param }` /
 * `{ $state }` resolved at dispatch time by ComponentRuntime.
 */
export interface SetComponentAction {
  kind: 'set';
  path: string;
  value: unknown;
}

/**
 * A component-node action. Only the `set` kind is supported — it mutates
 * internal state in-place. Kept as an alias (rather than inlining
 * `SetComponentAction`) so existing references read clearly.
 */
export type ComponentAction = SetComponentAction;

/**
 * The json-render tree backing a `type:'component'` node. On disk this lives
 * at `<project>/nodes/<id>/spec.json`; the studio resolver inlines it into
 * `data.spec` before the canvas sees it.
 */
export interface ComponentSpec {
  root: string;
  elements: Record<string, ComponentSpecElement>;
  state?: Record<string, unknown>;
  actions?: Record<string, ComponentAction>;
}

/**
 * `type:'component'` node data — json-render-powered reactive UI. `spec` is
 * inlined from the sidecar by the studio; the runtime maintains internal
 * state seeded from `spec.state`, resolves `$state` / `$action` / `$cond`
 * refs in element props, and dispatches `spec.actions` on user interaction.
 */
export interface ComponentNodeData extends NodeSemanticBase, NodeVisual, NodeCapabilities {
  spec: ComponentSpec;
  /**
   * When true, the renderer measures its content and React Flow sizes the
   * wrapper around it (mirrors HtmlNodeData.autoSize). Default behaviour
   * matches the explicit width/height path.
   */
  autoSize?: boolean;
}

/**
 * Target of a linkflow node — points to another flow by slug pair. Both slugs
 * match the canonical FlowIdPattern (lowercase, digits, dashes; starts with
 * alnum). Optional on the parent `LinkflowNodeData` — an unset target is the
 * "unlinked" visual state.
 */
export interface LinkflowTarget {
  project: string;
  flow: string;
}

/**
 * `type:'linkflow'` node data — a clickable card that navigates to another
 * flow. `target` is optional (unlinked state). All visual base fields apply
 * in the linked-healthy state; the unlinked + broken states paint their own
 * fixed chrome (dashed border + tint).
 */
export interface LinkflowNodeData extends NodeSemanticBase, NodeVisual, NodeCapabilities {
  target?: LinkflowTarget;
}

/**
 * `type:'group'` node data — a first-class container that owns membership via
 * `childIds`. Member node positions stay ABSOLUTE (no xyflow `parentId`
 * reparenting), so the rest of the canvas treats members as ordinary nodes;
 * the group only paints its box/title behind them and fans out move/resize in
 * later milestones. Reuses the shared semantic + visual base so title,
 * description/sidebar, and background/border come for free. An empty
 * `childIds` is a valid "labeled zone" (design §9.11).
 *
 * `childIds` is NOT part of `CANVAS_NODE_DATA_FIELDS` (that satisfies-const is
 * bound to `GeometricNodeData`); the studio↔canvas parity test only checks the
 * geometric field set, and `childIds` persists to flow.json via its own
 * `FlowGroupNodeData` on-disk schema.
 */
export interface GroupNodeData extends NodeSemanticBase, NodeVisual, NodeCapabilities {
  /** Ids of the member nodes (absolute-positioned). At most one group per node; never another group's id (no nesting in v1). */
  childIds: string[];
}

/**
 * A single column in a `type:'table'` node. `id` is stable (survives
 * insert/delete of other columns); `width` is the column's own pixel width so
 * sizing co-locates with structure (the whole table is self-contained in
 * flow.json — no separate width side-table keyed by column id).
 */
export interface TableColumn {
  id: string;
  width: number;
}

/** A single row in a `type:'table'` node. `id` is stable; `height` is its own pixel height. */
export interface TableRow {
  id: string;
  height: number;
}

/**
 * `type:'table'` node data — a Miro-style visual grid of plain-text cells.
 * Structure + sizing are intrinsic and self-contained:
 *   - `columns` / `rows` carry stable ids AND their own width/height, so
 *     insert/delete/resize never churn array indices or split one logical edit
 *     across flow.json + style.json.
 *   - `cells` is sparse, keyed `${rowId}:${colId}` → text; empty cells are
 *     omitted entirely.
 * The overall node footprint is DERIVED (Σ widths × Σ heights, see
 * `deriveTableSize`), never stored. Generic styling (border, font, colors) still
 * rides the shared `NodeVisual` fields and routes to style.json like every other
 * node. Cell text is the content; there is no per-cell formatting in v1.
 */
export interface TableNodeData extends NodeSemanticBase, NodeVisual, NodeCapabilities {
  columns: TableColumn[];
  rows: TableRow[];
  /** Cell text keyed by `${rowId}:${colId}`. Empty cells are omitted (sparse). */
  cells: Record<string, string>;
  /** When true, the first row renders as a header (muted fill + semibold text). */
  headerRow?: boolean;
}

interface NodeBase {
  id: string;
  position: { x: number; y: number };
}

export type FlowNode =
  | (NodeBase & { type: GeometricNodeType; data: GeometricNodeData })
  | (NodeBase & { type: 'image'; data: ImageNodeData })
  | (NodeBase & { type: 'html'; data: HtmlNodeData })
  | (NodeBase & { type: 'icon'; data: IconNodeData })
  | (NodeBase & { type: 'component'; data: ComponentNodeData })
  | (NodeBase & { type: 'linkflow'; data: LinkflowNodeData })
  | (NodeBase & { type: 'freehand'; data: FreehandNodeData })
  | (NodeBase & { type: 'line'; data: LineNodeData })
  | (NodeBase & { type: 'group'; data: GroupNodeData })
  | (NodeBase & { type: 'table'; data: TableNodeData });

// Canvas interaction mode. Mutually exclusive: the toolbar is a radio group.
// `select` is the neutral default — click/marquee selects, pane-drag pans.
// `hand` locks node interaction; left-drag pans (cursor: grab/grabbing).
// `draw` carries the armed drawable node type for click/drag-to-create
// gestures. Image / html are NOT drawable — they need an upload or dedicated
// authoring flow. `linkflow` is drawable: it auto-opens the picker dialog on
// commit.
// `draw-icon` is the icon-equivalent of `draw`: armed AFTER the user picks
// an icon from the Insert-icon popover, so the click/drag-to-place gesture
// stays consistent with shapes (no auto-insert at viewport center).
export type CanvasMode =
  | { kind: 'select' }
  | { kind: 'hand' }
  | { kind: 'draw'; shape: DrawableNodeType }
  | { kind: 'draw-icon'; iconName: string }
  | { kind: 'pen' };

export type ConnectorStyle = 'solid' | 'dashed' | 'dotted';
export type ConnectorDirection = 'forward' | 'backward' | 'both' | 'none';
export type ConnectorPath = 'curve' | 'step';
export type ConnectorHeadShape = 'arrow' | 'one' | 'many' | 'optional-many' | 'diamond' | 'circle';

export type EdgePinSide = 'top' | 'right' | 'bottom' | 'left';
export interface EdgePin {
  side: EdgePinSide;
  t: number;
}

export interface ConnectorBase {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  sourceHandleAutoPicked?: boolean;
  targetHandleAutoPicked?: boolean;
  sourcePin?: EdgePin;
  targetPin?: EdgePin;
  label?: string;
  style?: ConnectorStyle;
  color?: ColorToken;
  direction?: ConnectorDirection;
  borderSize?: number;
  path?: ConnectorPath;
  /** Glyph at the target (head) end (per `direction`). Absent ⇒ 'arrow'. */
  headShape?: ConnectorHeadShape;
  /** Glyph at the source (tail) end. Absent ⇒ falls back to `headShape`. */
  tailShape?: ConnectorHeadShape;
  fontSize?: number;
  /** Curated font-family token for the connector label; resolves via FONT_STACKS. */
  fontFamily?: FontFamilyToken;
}

export interface Connector extends ConnectorBase {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url?: string;
  eventName?: string;
  queueName?: string;
}

export interface Flow {
  version: 2;
  name: string;
  nodes: FlowNode[];
  connectors: Connector[];
}
