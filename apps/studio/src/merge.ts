import type { Architecture, Flow, Style } from './schema.ts';

/**
 * Merge architecture.json (semantic data) and the optional style.json
 * (presentation overrides) into the merged Flow shape consumed by the API,
 * the canvas, and the rest of the studio.
 *
 * Style entries with no matching architecture id are silently dropped — the
 * write path strips dangling entries after delete, but a stale file on disk
 * shouldn't break the read path.
 */
export function mergeArchitectureAndStyle(arch: Architecture, style: Style): Flow {
  const nodeStyles = style.nodes ?? {};
  const connectorStyles = style.connectors ?? {};

  const mergedNodes = arch.nodes.map((node) => {
    const s = nodeStyles[node.id] ?? {};
    const { position, ...visual } = s;
    return {
      ...node,
      position: position ?? { x: 0, y: 0 },
      data: { ...node.data, ...visual },
    };
  });

  const mergedConnectors = arch.connectors.map((conn) => {
    const s = connectorStyles[conn.id] ?? {};
    return { ...conn, ...s };
  });

  return {
    version: arch.version,
    name: arch.name,
    ...(arch.resetAction ? { resetAction: arch.resetAction } : {}),
    nodes: mergedNodes,
    connectors: mergedConnectors,
  } as Flow;
}

// Fields that live in a node's `data` block on architecture.json. Every other
// data field is visual and routes to style.json.
const NODE_DATA_ARCH_KEYS = new Set([
  'name',
  'kind',
  'stateSource',
  'handlerModule',
  'icon',
  'description',
  'detail',
  'playAction',
  'statusAction',
  'shape',
  'path',
  'alt',
  'htmlPath',
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
  'locked',
  'borderWidth',
  'color',
  'strokeWidth',
  'autoSize',
]);

const CONNECTOR_ARCH_KEYS = new Set([
  'id',
  'source',
  'target',
  'kind',
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
 * Split a merged Flow back into (architecture, style) for atomic write. The
 * inverse of mergeArchitectureAndStyle: position and every visual field on
 * each node moves to `style.nodes[id]`; handles, pins, and visual fields on
 * each connector move to `style.connectors[id]`. Architecture keeps every
 * semantic data field — the routing tables above are the source of truth.
 *
 * Style entries that end up empty are omitted from the output so the file
 * stays compact (matches the design's "delete style.json when {}" rule).
 */
export function splitFlow(flow: {
  version: number;
  name: string;
  resetAction?: unknown;
  nodes: Array<Record<string, unknown>>;
  connectors: Array<Record<string, unknown>>;
}): { architecture: Record<string, unknown>; style: Record<string, unknown> } {
  const archNodes: Array<Record<string, unknown>> = [];
  const styleNodes: Record<string, Record<string, unknown>> = {};

  for (const node of flow.nodes) {
    const id = node.id as string;
    const archNode: Record<string, unknown> = { id, type: node.type };
    const styleEntry: Record<string, unknown> = {};

    if (node.position && typeof node.position === 'object') {
      styleEntry.position = node.position;
    }

    const data = (node.data ?? {}) as Record<string, unknown>;
    const archData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (NODE_DATA_ARCH_KEYS.has(k)) {
        archData[k] = v;
      } else if (NODE_STYLE_KEYS.has(k)) {
        styleEntry[k] = v;
      } else {
        // Unknown forward-compat key — keep on architecture side so the
        // schema's strict() will catch typos but extension is possible by
        // updating the routing tables here.
        archData[k] = v;
      }
    }
    archNode.data = archData;
    archNodes.push(archNode);

    if (Object.keys(styleEntry).length > 0) {
      styleNodes[id] = styleEntry;
    }
  }

  const archConnectors: Array<Record<string, unknown>> = [];
  const styleConnectors: Record<string, Record<string, unknown>> = {};

  for (const conn of flow.connectors) {
    const id = conn.id as string;
    const archConn: Record<string, unknown> = {};
    const styleEntry: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(conn)) {
      if (v === undefined) continue;
      if (CONNECTOR_ARCH_KEYS.has(k)) {
        archConn[k] = v;
      } else if (CONNECTOR_STYLE_KEYS.has(k)) {
        styleEntry[k] = v;
      } else {
        archConn[k] = v;
      }
    }
    archConnectors.push(archConn);
    if (Object.keys(styleEntry).length > 0) {
      styleConnectors[id] = styleEntry;
    }
  }

  const architecture: Record<string, unknown> = {
    version: flow.version,
    name: flow.name,
    nodes: archNodes,
    connectors: archConnectors,
  };
  if (flow.resetAction !== undefined) architecture.resetAction = flow.resetAction;

  const style: Record<string, unknown> = {};
  if (Object.keys(styleNodes).length > 0) style.nodes = styleNodes;
  if (Object.keys(styleConnectors).length > 0) style.connectors = styleConnectors;

  return { architecture, style };
}
