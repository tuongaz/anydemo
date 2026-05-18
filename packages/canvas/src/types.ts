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
// The runtime `StatusReport` interface (which references this union) lives in
// apps/web/src/lib/api.ts today and will move into @seeflow/canvas in US-026.
// `apps/web/src/lib/api.ts` re-exports this type from `@seeflow/canvas` so
// the canvas remains the single source of truth.
export type StatusReportState = 'ok' | 'warn' | 'error' | 'pending';

export interface Demo {
  version: 1;
  name: string;
  nodes: DemoNode[];
  connectors: Connector[];
}
