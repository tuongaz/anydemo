// CanvasAdapter abstraction over the studio REST surface.
//
// The adapter binds a demoId (== projectId in the studio registry) at
// construction and exposes single-method calls that drop the demoId param.
// Patch shapes mirror the wire format accepted by apps/studio's REST endpoints
// and are owned by the canvas package so embedders can plug in their own
// backend.

import type {
  ColorToken,
  Connector,
  ConnectorDirection,
  ConnectorPath,
  ConnectorStyle,
  DemoNode,
  EdgePin,
  RunResult,
  ShapeKind,
  StatusReport,
} from '../types.ts';

export type NodeKind =
  | 'playNode'
  | 'stateNode'
  | 'shapeNode'
  | 'imageNode'
  | 'iconNode'
  | 'htmlNode';

export interface NodeCreateInput {
  /** Optional client-allocated id. When set, server uses it verbatim. */
  id?: string;
  type: NodeKind;
  position: { x: number; y: number };
  /** Node-kind-specific data payload (ShapeNodeData / IconNodeData / …). */
  data: Record<string, unknown>;
}

export interface NodePatch {
  position?: { x: number; y: number };
  name?: string;
  borderColor?: ColorToken;
  backgroundColor?: ColorToken;
  borderSize?: number;
  /** Image node border-thickness (1–8). Distinct from shape nodes' `borderSize`. */
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  fontSize?: number;
  textColor?: ColorToken;
  cornerRadius?: number;
  width?: number;
  height?: number;
  shape?: ShapeKind;
  /** iconNode-only: stroke color token. Lands at data.color. */
  color?: ColorToken;
  /** iconNode-only: glyph stroke width in [0.5, 4]. Lands at data.strokeWidth. */
  strokeWidth?: number;
  /** iconNode-only: accessible alt text. Lands at data.alt. */
  alt?: string;
  /** iconNode-only: kebab-case Lucide icon name. Lands at data.icon. */
  icon?: string;
  /** Lock state. true freezes the node; false unlocks. */
  locked?: boolean;
  /** Short body text rendered on the canvas and as light-bold in the sidebar. */
  description?: string;
  /** Long-form sidebar-only body text. */
  detail?: string;
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
  kind?: Connector['kind'];
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
  /** Per-connector label font size in px. */
  fontSize?: number;
  kind?: Connector['kind'];
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

export interface UploadImageResult {
  path: string;
}

export interface PlayNodeResult {
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
    nodes?: Record<string, Partial<DemoNode>>;
    connectors?: Record<string, Partial<Connector>>;
  };
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
  uploadImage(file: File, filename: string): Promise<UploadImageResult>;
  /** Optional: invoke the node's playAction. Adapters that don't support
   *  server-side execution can omit this — view-mode canvases never call it. */
  playNode?(nodeId: string): Promise<PlayNodeResult>;
}
