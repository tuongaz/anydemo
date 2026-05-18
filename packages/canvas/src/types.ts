import type { NodeStatus } from './nodes/status-pill.tsx';

export type ColorToken =
  | 'default'
  | 'slate'
  | 'blue'
  | 'green'
  | 'amber'
  | 'red'
  | 'purple'
  | 'pink';

export interface NodeVisual {
  width?: number;
  height?: number;
  borderColor?: ColorToken;
  backgroundColor?: ColorToken;
  borderSize?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  fontSize?: number;
  textColor?: ColorToken;
  cornerRadius?: number;
  locked?: boolean;
}

export interface NodeDescription {
  description?: string;
  detail?: string;
}

export interface NodeData extends NodeVisual, NodeDescription {
  name: string;
  kind: string;
  stateSource: { kind: 'request' | 'event' };
  playAction?: HttpAction;
  handlerModule?: string;
}

export interface HttpAction {
  kind: 'http';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
  bodySchema?: unknown;
}

export type ShapeKind =
  | 'rectangle'
  | 'ellipse'
  | 'sticky'
  | 'text'
  | 'database'
  | 'server'
  | 'user'
  | 'queue'
  | 'cloud';

export interface ShapeNodeData extends NodeVisual, NodeDescription {
  shape: ShapeKind;
  name?: string;
}

export interface ImageNodeData extends NodeVisual, NodeDescription {
  path: string;
  alt?: string;
  borderWidth?: number;
}

export interface IconNodeData extends NodeDescription {
  icon: string;
  color?: ColorToken;
  strokeWidth?: number;
  width?: number;
  height?: number;
  alt?: string;
  name?: string;
  locked?: boolean;
}

export interface HtmlNodeData extends NodeVisual, NodeDescription {
  htmlPath: string;
  name?: string;
}

interface NodeBase {
  id: string;
  position: { x: number; y: number };
}

export type DemoNode =
  | (NodeBase & { type: 'playNode'; data: NodeData })
  | (NodeBase & { type: 'stateNode'; data: NodeData })
  | (NodeBase & { type: 'shapeNode'; data: ShapeNodeData })
  | (NodeBase & { type: 'imageNode'; data: ImageNodeData })
  | (NodeBase & { type: 'iconNode'; data: IconNodeData })
  | (NodeBase & { type: 'htmlNode'; data: HtmlNodeData });

export type ConnectorStyle = 'solid' | 'dashed' | 'dotted';
export type ConnectorDirection = 'forward' | 'backward' | 'both' | 'none';
export type ConnectorPath = 'curve' | 'step';

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
  fontSize?: number;
}

export interface HttpConnector extends ConnectorBase {
  kind: 'http';
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url?: string;
}

export interface EventConnector extends ConnectorBase {
  kind: 'event';
  eventName: string;
}

export interface QueueConnector extends ConnectorBase {
  kind: 'queue';
  queueName: string;
}

export interface DefaultConnector extends ConnectorBase {
  kind: 'default';
}

export type Connector = HttpConnector | EventConnector | QueueConnector | DefaultConnector;

// US-012: mirror of `StatusReportSchema['state']` in apps/studio/src/schema.ts.
// `apps/web/src/lib/api.ts` re-exports this type from `@seeflow/canvas` so
// the canvas remains the single source of truth.
export type StatusReportState = 'ok' | 'warn' | 'error' | 'pending';

// US-013: runtime status payload emitted by a node's statusAction script and
// fanned out via SSE. The canvas needs the type so play-node + state-node can
// reference it without an `@/lib/api` import; apps/web/src/lib/api.ts now
// re-exports this from @seeflow/canvas (same pattern as `StatusReportState`).
// The hook that produces these values stays in apps/web; US-026 added the
// adapter-side `CanvasRuntime` type that references this so demo-canvas can
// receive a single bundled runtime prop.
export interface StatusReport {
  state: StatusReportState;
  summary?: string;
  detail?: string;
  data?: Record<string, unknown>;
  ts?: number;
}

// US-026: per-node SSE run state. The leaf type that backs `NodeRuns` in
// apps/web/src/hooks/use-node-runs.ts; promoted into the canvas package so
// CanvasRuntime (in apps/web/src/lib/canvas-adapter.ts) can reference it
// without reaching back into a hook file. The hook continues to produce the
// values; only the type lives here.
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

export interface Demo {
  version: 1;
  name: string;
  nodes: DemoNode[];
  connectors: Connector[];
}
