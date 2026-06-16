/**
 * Per-node run lifecycle. `undefined` (no entry in the runs map) is treated
 * as `'idle'` visually — see deriveVisualStatus in
 * `./nodes/lib/visual-status.ts`.
 */
export type NodeStatus = 'idle' | 'running' | 'done' | 'error';

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

export interface NodeVisual {
  width?: number;
  height?: number;
  borderColor?: ColorToken;
  backgroundColor?: ColorToken;
  borderSize?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  fontSize?: number;
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

export interface ScriptAction {
  kind: 'script';
  interpreter: string;
  args?: string[];
  scriptPath: string;
  input?: unknown;
  timeoutMs?: number;
}

export interface StatusAction {
  kind: 'script';
  interpreter: string;
  args?: string[];
  scriptPath: string;
  maxLifetimeMs?: number;
}

export type StateSource = { kind: 'request' } | { kind: 'event' };

/**
 * Capabilities — any subset of these makes a node Playable / Stateful. All
 * optional, valid on every node type. A node is Playable iff `playAction` is
 * set; Stateful iff `statusAction` is set; Both iff both. `stateSource` is
 * informational metadata that pairs with statusAction.
 */
export interface NodeCapabilities {
  playAction?: ScriptAction;
  statusAction?: StatusAction;
  stateSource?: StateSource;
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
 * The 13 flat node types. Visual kind is the type. Capabilities are
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
] as const;
export type GeometricNodeType = (typeof GEOMETRIC_NODE_TYPES)[number];

export type NodeType = GeometricNodeType | 'image' | 'html' | 'icon' | 'component' | 'linkflow';

/**
 * Set of node types creatable via the canvas toolbar's draw-mode (click /
 * drag-to-place) gesture. Linkflow joins the geometric tiles because it ships
 * a toolbar affordance that drag-creates it, then auto-opens the picker.
 * `image`/`html`/`icon`/`component` are NOT drawable — they each need an
 * upload, picker, or dedicated authoring flow.
 */
export type DrawableNodeType = GeometricNodeType | 'linkflow';

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
  textAlign: true,
  cornerRadius: true,
  shadow: true,
  // capabilities
  playAction: true,
  statusAction: true,
  stateSource: true,
  handlerModule: true,
} as const satisfies Record<keyof GeometricNodeData, true>;

export interface ImageNodeData extends NodeSemanticBase, NodeVisual, NodeCapabilities {
  path: string;
  alt?: string;
  borderWidth?: number;
}

export interface IconNodeData extends Omit<NodeSemanticBase, 'icon'>, NodeVisual, NodeCapabilities {
  /** Required for type:'icon' — the icon IS the visual. */
  icon: string;
  color?: ColorToken;
  strokeWidth?: number;
  alt?: string;
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
 * A component-node action. `set` mutates internal state in-place; `script`
 * spawns a node-rooted script over HTTP (`POST /api/flows/:id/nodes/:nodeId/
 * actions/:name`) and merges the JSON response into state.
 */
export type ComponentAction = SetComponentAction | ScriptAction;

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
  | (NodeBase & { type: 'linkflow'; data: LinkflowNodeData });

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
  | { kind: 'draw-icon'; iconName: string };

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
}

export interface Connector extends ConnectorBase {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url?: string;
  eventName?: string;
  queueName?: string;
}

// Mirror of `StatusReportSchema['state']` in apps/studio/src/schema.ts.
// `apps/web/src/lib/api.ts` re-exports this type from `@seeflow/canvas` so the
// canvas remains the single source of truth.
export type StatusReportState = 'ok' | 'warn' | 'error' | 'pending';

// Runtime status payload emitted by a node's statusAction script and fanned
// out via SSE. The canvas needs the type so the rectangle renderer can
// reference it without an `@/lib/api` import; apps/web/src/lib/api.ts re-
// exports this from @seeflow/canvas.
export interface StatusReport {
  state: StatusReportState;
  summary?: string;
  detail?: string;
  data?: Record<string, unknown>;
  ts?: number;
}

// Per-node SSE run state.
export interface RunResult {
  status: NodeStatus;
  runId?: string;
  /** Filled when status === 'done': upstream HTTP status. */
  responseStatus?: number;
  /** Filled when status === 'done': parsed JSON or text body. */
  body?: unknown;
  /** Filled when status === 'error': human-readable message. */
  error?: string;
  /** ms since epoch of the most recent transition. */
  ts?: number;
}

export interface Flow {
  version: 2;
  name: string;
  nodes: FlowNode[];
  connectors: Connector[];
}
