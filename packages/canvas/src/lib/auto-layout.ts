import dagre from 'dagre';

export type LayoutDirection = 'LR' | 'TB' | 'RL' | 'BT';

export interface AutoLayoutNode {
  id: string;
  width: number;
  height: number;
  position: { x: number; y: number };
}

export interface AutoLayoutEdge {
  source: string;
  target: string;
}

export interface AutoLayoutOptions {
  direction?: LayoutDirection;
  nodesep?: number;
  ranksep?: number;
}

// Defaults give connectors a bit of extra breathing room over dagre's tight
// out-of-the-box gaps — the studio's /api/diagram/assemble endpoint uses the
// same algorithm with the same defaults so the canvas's Tidy button never
// "moves" an LLM-produced layout when pressed.
const DEFAULTS = { direction: 'LR' as const, nodesep: 60, ranksep: 140 };

/**
 * Run dagre against the given nodes + edges and return a Map of new top-left
 * positions, keyed by node id. Single-node graphs short-circuit to the input
 * position so a degenerate selection-tidy is a no-op. dagre returns center
 * coords; we subtract width/2 and height/2 so the result lines up with React
 * Flow's top-left position model.
 */
export const applyLayout = (
  nodes: readonly AutoLayoutNode[],
  edges: readonly AutoLayoutEdge[],
  opts?: AutoLayoutOptions,
): Map<string, { x: number; y: number }> => {
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return out;
  if (nodes.length === 1) {
    const only = nodes[0];
    if (only) out.set(only.id, { x: only.position.x, y: only.position.y });
    return out;
  }

  const direction = opts?.direction ?? DEFAULTS.direction;
  const nodesep = opts?.nodesep ?? DEFAULTS.nodesep;
  const ranksep = opts?.ranksep ?? DEFAULTS.ranksep;

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: direction, nodesep, ranksep });
  g.setDefaultEdgeLabel(() => ({}));

  const ids = new Set<string>();
  for (const n of nodes) {
    g.setNode(n.id, { width: n.width, height: n.height });
    ids.add(n.id);
  }
  let edgeCounter = 0;
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    // multigraph + unique name lets parallel edges between the same pair
    // coexist without collapsing (matches our connector model).
    g.setEdge(e.source, e.target, {}, `e${edgeCounter++}`);
  }

  dagre.layout(g);

  for (const n of nodes) {
    const laid = g.node(n.id);
    if (!laid) continue;
    out.set(n.id, { x: laid.x - n.width / 2, y: laid.y - n.height / 2 });
  }
  return out;
};
