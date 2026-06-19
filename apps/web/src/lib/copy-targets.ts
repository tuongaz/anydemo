import type { Connector, FlowNode } from '@/lib/api';

export interface CollectCopyTargetsInput {
  /** Node ids the user selected for copy. */
  selectedIds: readonly string[];
  /** Server snapshot of nodes (raw, un-decorated). */
  serverNodes: readonly FlowNode[];
  /** Optimistic node overrides keyed by id (full node for not-yet-echoed creates). */
  nodeOverrides: Record<string, Partial<FlowNode>>;
  /** Server snapshot of connectors. */
  serverConnectors: readonly Connector[];
  /** Optimistic connector overrides keyed by id. */
  connectorOverrides: Record<string, Partial<Connector>>;
}

export interface CollectCopyTargetsResult {
  nodes: FlowNode[];
  connectors: Connector[];
}

const isFullNodeOverride = (ov: Partial<FlowNode> | undefined): ov is FlowNode =>
  !!ov && typeof ov.type === 'string' && !!ov.position && !!ov.data;

/**
 * Build the live (override-merged) node + connector set to place on the clipboard.
 *
 * Sourcing from the raw server snapshot alone drops two cases the user can hit:
 *  - a just-created node that still only exists as an optimistic override (its
 *    SSE `flow:reload` echo hasn't landed) — `serverNodes` has no entry, so a
 *    naive filter copies nothing and the follow-up paste silently no-ops. This
 *    is the "copy and paste a new node sometimes doesn't work" report;
 *  - a node with pending optimistic edits (moved / recoloured) whose echo hasn't
 *    confirmed — a clone built off the server snapshot would carry stale data,
 *    not what's actually on the canvas.
 *
 * Merging the overrides in fixes both. Connectors are copied only when BOTH
 * endpoints landed in the copied node set, so a paste never produces a dangling
 * edge. Override-only connectors (optimistic, not yet echoed) are included too.
 */
export function collectCopyTargets({
  selectedIds,
  serverNodes,
  nodeOverrides,
  serverConnectors,
  connectorOverrides,
}: CollectCopyTargetsInput): CollectCopyTargetsResult {
  const byId = new Map(serverNodes.map((n) => [n.id, n]));
  const nodes: FlowNode[] = [];
  const copiedIds = new Set<string>();
  for (const id of selectedIds) {
    if (copiedIds.has(id)) continue;
    const base = byId.get(id);
    const ov = nodeOverrides[id];
    if (base) {
      if (ov) {
        const data = ov.data ? { ...base.data, ...ov.data } : base.data;
        nodes.push({ ...base, ...ov, data } as FlowNode);
      } else {
        nodes.push(base);
      }
      copiedIds.add(id);
    } else if (isFullNodeOverride(ov)) {
      // Override-only optimistic create not yet echoed into the server snapshot.
      nodes.push({ ...ov, id });
      copiedIds.add(id);
    }
  }

  const serverConnIds = new Set(serverConnectors.map((c) => c.id));
  const connectors: Connector[] = [];
  for (const c of serverConnectors) {
    if (!copiedIds.has(c.source) || !copiedIds.has(c.target)) continue;
    const ov = connectorOverrides[c.id];
    connectors.push(ov ? ({ ...c, ...ov } as Connector) : c);
  }
  // Override-only connectors (optimistic, not yet echoed) whose endpoints both copied.
  for (const [id, ov] of Object.entries(connectorOverrides)) {
    if (serverConnIds.has(id)) continue;
    const cand = ov as Partial<Connector>;
    if (
      typeof cand.source === 'string' &&
      typeof cand.target === 'string' &&
      copiedIds.has(cand.source) &&
      copiedIds.has(cand.target)
    ) {
      connectors.push({ ...(cand as Connector), id });
    }
  }

  return { nodes, connectors };
}
