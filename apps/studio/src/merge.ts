import type { Flow, ResolvedFlow, Style } from './schema.ts';

/**
 * Merge flow.json (semantic data) and the optional style.json (presentation
 * overrides) into the merged ResolvedFlow shape consumed by the API, the
 * canvas, and the rest of the studio.
 *
 * Style entries with no matching flow id are silently dropped — the write
 * path strips dangling entries after delete, but a stale file on disk
 * shouldn't break the read path.
 */
export function mergeFlowAndStyle(flow: Flow, style: Style): ResolvedFlow {
  const nodeStyles = style.nodes ?? {};
  const connectorStyles = style.connectors ?? {};

  const mergedNodes = flow.nodes.map((node) => {
    const s = nodeStyles[node.id] ?? {};
    const { position, ...visual } = s;
    return {
      ...node,
      position: position ?? { x: 0, y: 0 },
      data: { ...node.data, ...visual },
    };
  });

  const mergedConnectors = flow.connectors.map((conn) => {
    const s = connectorStyles[conn.id] ?? {};
    return { ...conn, ...s };
  });

  return {
    version: flow.version,
    name: flow.name,
    ...(flow.description !== undefined ? { description: flow.description } : {}),
    ...(flow.resetAction ? { resetAction: flow.resetAction } : {}),
    nodes: mergedNodes,
    connectors: mergedConnectors,
  } as ResolvedFlow;
}

// Fields that live in a node's `data` block on flow.json. Every other data
// field is visual and routes to style.json. The flat-types refactor folds
// the visual kind into `node.type` itself (no more nested data.shape / data.kind)
// and makes every capability (playAction / statusAction / stateSource) valid
// on every type.
const NODE_DATA_FLOW_KEYS = new Set([
  'name',
  'stateSource',
  'handlerModule',
  'icon',
  'description',
  'detail',
  'playAction',
  'statusAction',
  'path',
  'alt',
  'html',
]);

const NODE_STYLE_KEYS = new Set([
  'width',
  'height',
  'borderColor',
  'backgroundColor',
  'borderSize',
  'borderStyle',
  'fontSize',
  'textColor',
  'cornerRadius',
  'borderWidth',
  'color',
  'strokeWidth',
  'autoSize',
]);

const CONNECTOR_FLOW_KEYS = new Set([
  'id',
  'source',
  'target',
  'label',
  'method',
  'url',
  'eventName',
  'queueName',
]);

const CONNECTOR_STYLE_KEYS = new Set([
  'sourceHandle',
  'targetHandle',
  'sourceHandleAutoPicked',
  'targetHandleAutoPicked',
  'sourcePin',
  'targetPin',
  'style',
  'color',
  'direction',
  'borderSize',
  'path',
  'fontSize',
]);

/**
 * Split a merged ResolvedFlow back into (flow, style) for atomic write. The
 * inverse of mergeFlowAndStyle: position and every visual field on each node
 * moves to `style.nodes[id]`; handles, pins, and visual fields on each
 * connector move to `style.connectors[id]`. Flow keeps every semantic data
 * field — the routing tables above are the source of truth.
 *
 * Style entries that end up empty are omitted from the output so the file
 * stays compact (matches the design's "delete style.json when {}" rule).
 */
export function splitFlow(resolved: {
  version: number;
  name: string;
  description?: string;
  resetAction?: unknown;
  nodes: Array<Record<string, unknown>>;
  connectors: Array<Record<string, unknown>>;
}): { flow: Record<string, unknown>; style: Record<string, unknown> } {
  const flowNodes: Array<Record<string, unknown>> = [];
  const styleNodes: Record<string, Record<string, unknown>> = {};

  for (const node of resolved.nodes) {
    const id = node.id as string;
    const flowNode: Record<string, unknown> = { id, type: node.type };
    const styleEntry: Record<string, unknown> = {};

    if (node.position && typeof node.position === 'object') {
      styleEntry.position = node.position;
    }

    const data = (node.data ?? {}) as Record<string, unknown>;
    const flowData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      // Component nodes externalize `spec` to <project>/nodes/<id>/spec.json
      // (the sidecar). Drop it from flow.json so the strict on-disk schema
      // doesn't reject it and the spec stays single-sourced on disk.
      if (node.type === 'component' && k === 'spec') continue;
      if (NODE_DATA_FLOW_KEYS.has(k)) {
        flowData[k] = v;
      } else if (NODE_STYLE_KEYS.has(k)) {
        styleEntry[k] = v;
      } else {
        // Unknown forward-compat key — keep on flow side so the schema's
        // strict() will catch typos but extension is possible by updating
        // the routing tables here.
        flowData[k] = v;
      }
    }
    flowNode.data = flowData;
    flowNodes.push(flowNode);

    if (Object.keys(styleEntry).length > 0) {
      styleNodes[id] = styleEntry;
    }
  }

  const flowConnectors: Array<Record<string, unknown>> = [];
  const styleConnectors: Record<string, Record<string, unknown>> = {};

  for (const conn of resolved.connectors) {
    const id = conn.id as string;
    const flowConn: Record<string, unknown> = {};
    const styleEntry: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(conn)) {
      if (v === undefined) continue;
      if (CONNECTOR_FLOW_KEYS.has(k)) {
        flowConn[k] = v;
      } else if (CONNECTOR_STYLE_KEYS.has(k)) {
        styleEntry[k] = v;
      } else {
        flowConn[k] = v;
      }
    }
    flowConnectors.push(flowConn);
    if (Object.keys(styleEntry).length > 0) {
      styleConnectors[id] = styleEntry;
    }
  }

  const flow: Record<string, unknown> = {
    version: resolved.version,
    name: resolved.name,
    nodes: flowNodes,
    connectors: flowConnectors,
  };
  if (resolved.description !== undefined) flow.description = resolved.description;
  if (resolved.resetAction !== undefined) flow.resetAction = resolved.resetAction;

  const style: Record<string, unknown> = {};
  if (Object.keys(styleNodes).length > 0) style.nodes = styleNodes;
  if (Object.keys(styleConnectors).length > 0) style.connectors = styleConnectors;

  return { flow, style };
}
