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
