/**
 * Map a share-mode rpc op to a human-readable verb + best-effort node label for
 * the attribution toast renderer. Pure, no React, no DOM — safe to call from
 * both the host studio and peer SPA hooks.
 *
 * `nodeLabel` falls back to the diff's `name`, `label`, or `text` field when the
 * caller didn't pass one, then to the `nodeId` from the diff, then to a generic
 * 'Node'. This keeps toasts readable even when an `addNode` op precedes any
 * local knowledge of the new node's name.
 */
export interface FormatAttributionResult {
  verb: string;
  nodeLabel: string;
}

const VERB_BY_OP: Record<string, string> = {
  moveNode: 'moved',
  patchNode: 'updated',
  addNode: 'added',
  deleteNode: 'deleted',
  addConnector: 'connected',
  patchConnector: 'updated',
  deleteConnector: 'disconnected',
  addBulk: 'created',
  reorderNode: 'reordered',
};

function pickStringField(
  source: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const v = source[key];
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return undefined;
}

function deriveNodeLabel(diff: unknown, fallback?: string): string {
  if (typeof fallback === 'string' && fallback.trim().length > 0) return fallback;
  if (diff !== null && typeof diff === 'object') {
    const d = diff as Record<string, unknown>;
    const direct = pickStringField(d, ['name', 'label', 'text', 'title']);
    if (direct) return direct;
    if (d.patch && typeof d.patch === 'object') {
      const fromPatch = pickStringField(d.patch as Record<string, unknown>, [
        'name',
        'label',
        'text',
        'title',
      ]);
      if (fromPatch) return fromPatch;
    }
    if (d.node && typeof d.node === 'object') {
      const fromNode = pickStringField(d.node as Record<string, unknown>, [
        'name',
        'label',
        'text',
        'title',
      ]);
      if (fromNode) return fromNode;
    }
    const id = pickStringField(d, ['nodeId', 'connectorId', 'id']);
    if (id) return id;
  }
  return 'Node';
}

export function formatAttribution(
  op: string,
  diff: unknown,
  nodeLabel?: string,
): FormatAttributionResult {
  const verb = VERB_BY_OP[op] ?? op;
  return { verb, nodeLabel: deriveNodeLabel(diff, nodeLabel) };
}
