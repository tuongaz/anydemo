// CanvasAdapter abstraction over the studio REST surface.
//
// The adapter binds a flowId (== projectId in the studio registry) at
// construction and exposes single-method calls that drop the flowId param.
// Patch shapes mirror the wire format accepted by apps/studio's REST endpoints
// and are owned by the canvas package so embedders can plug in their own
// backend.

import type {
  ColorToken,
  Connector,
  ConnectorDirection,
  ConnectorHeadShape,
  ConnectorPath,
  ConnectorStyle,
  EdgePin,
  FlowNode,
  NodeType,
  RunResult,
  StatusReport,
} from '../types.ts';

/**
 * Adapter-facing node-type union. Mirrors `NodeType` in `../types.ts` (the
 * 12 flat tags: 9 geometric + image + html + icon). Kept as a named alias
 * so the public barrel exposes a stable adapter-layer name while the
 * canonical union lives in the schema-mirroring `types.ts`.
 */
export type NodeKind = NodeType;

export interface NodeCreateInput {
  /** Optional client-allocated id. When set, server uses it verbatim. */
  id?: string;
  type: NodeKind;
  position: { x: number; y: number };
  /** Per-type data payload (GeometricNodeData / ImageNodeData / HtmlNodeData / IconNodeData). */
  data: Record<string, unknown>;
}

export interface NodePatch {
  /**
   * Retype: change the node's visual kind in place. Type IS the shape in the
   * flat model, so a retype patch swaps the variant without nesting in `data`.
   * The studio re-parses the merged node against the new type's per-type
   * schema and rejects patches missing required fields (e.g. retype to
   * type:'image' without a `path`).
   */
  type?: NodeKind;
  position?: { x: number; y: number };
  name?: string;
  borderColor?: ColorToken;
  backgroundColor?: ColorToken;
  borderSize?: number;
  /** type:'image'-only: border thickness (0–8; 0 = no border). Distinct from geometric `borderSize`. */
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  fontSize?: number;
  cornerRadius?: number;
  /** Elevation level 0–5; renders as `var(--node-shadow-N)`. */
  shadow?: number;
  width?: number;
  height?: number;
  /**
   * type:'html'-only: when true, the renderer measures content and React Flow
   * sizes the wrapper around it. The studio adapter strips width/height when
   * autoSize:true is patched, and flips autoSize:false when width/height is
   * patched, per the autoSize invariant.
   */
  autoSize?: boolean;
  /** type:'icon'-only: stroke color token. Lands at data.color. */
  color?: ColorToken;
  /** type:'icon'-only: glyph stroke width in [0.5, 4]. Lands at data.strokeWidth. */
  strokeWidth?: number;
  /** type:'icon'/type:'image'-only: accessible alt text. Lands at data.alt. */
  alt?: string;
  /**
   * Kebab-case Lucide icon name. Lands at data.icon. Decorative on every
   * type except type:'icon', where the icon IS the visual and the field is
   * required. Explicit `null` clears the field (the studio strips the key
   * from disk).
   */
  icon?: string | null;
  /** Short body text rendered on the canvas and as light-bold in the sidebar. */
  description?: string;
  /** Long-form sidebar-only body text. */
  detail?: string;
  /**
   * type:'linkflow'-only: slug pair { project, flow } naming the target flow.
   * Lands at data.target. Explicit `null` clears the field (the studio strips
   * the key from disk) so undo of a link/edit reverts to the unlinked state.
   */
  target?: { project: string; flow: string } | null;
}

export type ReorderOp =
  | { op: 'forward' }
  | { op: 'backward' }
  | { op: 'toFront' }
  | { op: 'toBack' }
  | { op: 'toIndex'; index: number };

export interface ConnectorCreateInput {
  id?: string;
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
  eventName?: string;
  queueName?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url?: string;
}

export interface ConnectorPatch {
  label?: string;
  style?: ConnectorStyle;
  color?: ColorToken;
  direction?: ConnectorDirection;
  borderSize?: number;
  path?: ConnectorPath;
  /** Head glyph drawn at the active arrow ends (per `direction`). */
  headShape?: ConnectorHeadShape;
  /** Per-connector label font size in px. */
  fontSize?: number;
  eventName?: string;
  queueName?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url?: string;
  /** Reconnect: retarget this edge to a different source node. */
  source?: string;
  /** Reconnect: retarget this edge to a different target node. */
  target?: string;
  /** Pin source endpoint to a specific handle id. `null` clears. */
  sourceHandle?: string | null;
  /** Pin target endpoint to a specific handle id. `null` clears. */
  targetHandle?: string | null;
  sourceHandleAutoPicked?: boolean;
  targetHandleAutoPicked?: boolean;
  /** Pin source endpoint at `(side, t)` on the source node's perimeter. `null` clears. */
  sourcePin?: EdgePin | null;
  /** Pin target endpoint at `(side, t)` on the target node's perimeter. `null` clears. */
  targetPin?: EdgePin | null;
}

export interface UpdateNodePositionResult {
  ok: boolean;
  position: { x: number; y: number };
}

/**
 * Tidy-button input. Adapter-facing shape used by both the canvas Tidy
 * handler and the studio's /api/layout endpoint. Decoupled from FlowSchema
 * so callers can supply DOM-measured dimensions without round-tripping the
 * whole node payload.
 */
export interface LayoutNodeInput {
  id: string;
  type: NodeKind;
  width: number;
  height: number;
}

export interface LayoutEdgeInput {
  id: string;
  source: string;
  target: string;
}

export type LayoutSourceHandle = 'r' | 'b';
export type LayoutTargetHandle = 't' | 'l';

export interface LayoutResult {
  /** New positions keyed by node id. */
  nodes: Record<string, { position: { x: number; y: number } }>;
  /** New handle assignments keyed by connector id. */
  connectors: Record<
    string,
    { sourceHandle: LayoutSourceHandle; targetHandle: LayoutTargetHandle }
  >;
}

export interface UploadImageResult {
  path: string;
}

export interface PlayActionResult {
  runId: string;
  status?: number;
  body?: unknown;
  error?: string;
}

/**
 * US-026: read-only runtime state injected into the canvas. Bundles the three
 * data streams the canvas needs to render dynamic chrome — SSE-driven per-node
 * `runs`, latest `statuses`, and optimistic `pendingOverrides` for node /
 * connector edits in flight. The hooks that produce these values stay in
 * apps/web (`use-node-runs`, `use-node-statuses`, `use-pending-overrides`); the
 * canvas treats this as an opaque data prop.
 *
 * Every field is optional so view-mode embedders can omit the whole prop. Inside
 * demo-canvas, `runtime?.runs?.[id]` etc. is the canonical access pattern —
 * the helpers fall back to `'idle'` / `undefined` when the entries are absent.
 */
export interface CanvasRuntime {
  /** Per-node SSE run state, keyed by node id. */
  runs?: Record<string, RunResult>;
  /** Latest StatusReport per node, keyed by node id. */
  statuses?: Record<string, StatusReport>;
  /**
   * Optimistic edits that haven't yet been reconciled by the server. Nodes and
   * connectors are stored separately because their generic parameters differ —
   * a single map would lose type safety on the values.
   */
  pendingOverrides?: {
    nodes?: Record<string, Partial<FlowNode>>;
    connectors?: Record<string, Partial<Connector>>;
  };
}

/**
 * Adapter-side icon pack vendor. Subset of canvas `IconVendor` — the studio
 * only manages downloadable packs for these two; lucide is bundled and
 * iconify ships inline. Mirrors the studio's vendor union but stays local to
 * the canvas to keep the adapter seam clean (no cross-package import).
 *
 * GCP was previously listed here but Google decommissioned the public
 * architecture-icons zip download, so we removed the install affordance. The
 * `gcp` value is still recognized by the canvas-side `IconVendor` in icon-id.ts
 * so existing flow files with `gcp:foo` icon ids continue to parse.
 */
export type IconPackVendor = 'aws' | 'azure';

/**
 * Pack summary returned by `adapter.icons.listPacks()` and consumed by the
 * picker's vendor tabs + Browse Packs panel. Discriminated by `installed`.
 * Owned by the canvas package — do NOT import the studio-side type.
 */
export type PackSummary =
  | {
      vendor: IconPackVendor;
      installed: true;
      version: string;
      iconCount: number;
      sizeBytes: number;
      /**
       * Canonical icon names (kebab-case) installed in this pack, sorted
       * alphabetically. Drives the picker's per-vendor grid via
       * `applyPackSummaries()` (see `lib/icon-registry.ts`). The studio's
       * mirror `PackSummary` derives this from `Object.keys(pack.icons)`.
       */
      iconNames: string[];
    }
  | { vendor: IconPackVendor; installed: false };

/**
 * Streaming install event delivered by `adapter.icons.subscribeJob()`. The
 * shape mirrors the studio's `InstallEvent` discriminated union but is owned
 * by the canvas so the adapter seam stays one-way (host → canvas).
 */
export type InstallEvent =
  | { type: 'terms-required'; vendor: IconPackVendor; licenseUrl: string }
  | { type: 'download-started'; vendor: IconPackVendor; expectedBytes: number | null }
  | { type: 'download-progress'; vendor: IconPackVendor; receivedBytes: number }
  | { type: 'extracting'; vendor: IconPackVendor }
  | { type: 'indexing'; vendor: IconPackVendor; iconCount: number }
  | { type: 'done'; vendor: IconPackVendor; version: string; iconCount: number }
  | { type: 'error'; vendor: IconPackVendor; message: string };

/**
 * License summary returned by `adapter.icons.getLicense()` — used by the
 * Browse Packs install modal.
 */
export interface IconLicenseInfo {
  summary: string;
  url: string;
  requiresAcceptance: boolean;
}

/**
 * Adapter contract for the icon-pack pipeline. Optional because view/mini
 * mode canvases never need it; edit mode adapters wire it to `/api/icons/*`.
 */
export interface CanvasIconsAdapter {
  listPacks(): Promise<PackSummary[]>;
  install(vendor: IconPackVendor, opts: { acceptTerms?: boolean }): Promise<{ jobId: string }>;
  subscribeJob(jobId: string, onEvent: (ev: InstallEvent) => void): () => void;
  remove(vendor: IconPackVendor): Promise<void>;
  getLicense(vendor: IconPackVendor): Promise<IconLicenseInfo>;
}

/**
 * CanvasAdapter — the surface @seeflow/canvas calls when it needs to persist a
 * change. One adapter is bound to one demo/project at construction. Embedders
 * (the studio today, library consumers tomorrow) implement this against their
 * own backend; the canvas package never imports REST URLs directly.
 */
export interface CanvasAdapter {
  createNode(input: NodeCreateInput): Promise<{ id: string; node: Record<string, unknown> }>;
  updateNode(nodeId: string, patch: NodePatch): Promise<void>;
  /**
   * Position-only fast path. Kept separate from `updateNode` so position drags
   * can hit the granular `/position` endpoint (preserved from the pre-adapter
   * REST surface). Embedders that don't need the granular split can route this
   * through their generic node-patch path.
   */
  updateNodePosition(
    nodeId: string,
    position: { x: number; y: number },
  ): Promise<UpdateNodePositionResult>;
  deleteNode(nodeId: string): Promise<void>;
  reorderNode(nodeId: string, op: ReorderOp): Promise<void>;
  createConnector(input: ConnectorCreateInput): Promise<{ id: string }>;
  updateConnector(connectorId: string, patch: ConnectorPatch): Promise<void>;
  deleteConnector(connectorId: string): Promise<void>;
  /**
   * Upload an image file to the project, scoped to a specific node. The
   * server writes to <project>/nodes/<nodeId>/<filename> and the returned
   * path is `nodes/<nodeId>/<filename>` — used directly as `data.path` on
   * a type:'image' node. Scoping the upload to the node id lets delete_node's
   * cascade clean up the asset along with the row.
   */
  uploadImage(nodeId: string, file: File, filename: string): Promise<UploadImageResult>;
  /** Optional: invoke the node's playAction. Adapters that don't support
   *  server-side execution can omit this — view-mode canvases never call it. */
  playAction?(nodeId: string): Promise<PlayActionResult>;
  /** Optional: ask the host to open the given project-scoped file in its editor. */
  openFile?(path: string): Promise<void>;
  /** Optional: ask the host to reveal the given project-scoped file in its OS file manager. */
  revealFile?(path: string): Promise<void>;
  /**
   * Tidy / auto-layout. Returns fresh positions for every input node and a
   * handle assignment for every edge that survived the layout. The canvas
   * applies these via the usual `updateNodePosition` + connector pin patches.
   * Adapters that route to the studio's `POST /api/layout` get this for
   * free; standalone embedders may implement their own engine.
   */
  computeLayout?(
    nodes: readonly LayoutNodeInput[],
    edges: readonly LayoutEdgeInput[],
  ): Promise<LayoutResult>;
  /**
   * Optional: cloud icon pack pipeline. Hosts that don't manage cloud icon
   * packs may omit this — the picker hides vendor tabs and the Browse Packs
   * affordance falls back gracefully. Edit-mode adapters wire to the studio's
   * `/api/icons/*` REST + SSE surface.
   */
  icons?: CanvasIconsAdapter;
}
