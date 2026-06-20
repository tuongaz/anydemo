export interface PasteableNode {
  id: string;
  position: { x: number; y: number };
}

export interface PasteableConnector {
  id: string;
  source: string;
  target: string;
}

export interface BuildPastePayloadInput<N extends PasteableNode, C extends PasteableConnector> {
  nodes: readonly N[];
  connectors: readonly C[];
  /**
   * Anchor position in flow space. When set, the topmost-leftmost node lands at
   * this position; every other node maintains its relative offset. When null
   * (keyboard Cmd/Ctrl+V), every node is shifted by `defaultOffset` (default
   * +24,+24) from its original position.
   */
  flowPos: { x: number; y: number } | null;
  /** Generator for fresh node ids — injected so tests get deterministic ids. */
  nodeIdGen: (oldId: string) => string;
  /** Generator for fresh connector ids — same rationale as `nodeIdGen`. */
  connectorIdGen: (oldId: string) => string;
  /** Translation applied to nodes when `flowPos` is null. */
  defaultOffset?: { x: number; y: number };
}

export interface BuildPastePayloadResult<N extends PasteableNode, C extends PasteableConnector> {
  /** New nodes with rewritten ids and positions. */
  newNodes: N[];
  /** New connectors with rewritten ids + endpoints. */
  newConnectors: C[];
  /** Old-id → new-id mapping for both nodes and connectors. */
  idMap: ReadonlyMap<string, string>;
}

/**
 * Rewrite a copied clipboard payload into a fresh paste:
 *  - Every node gets a new id via `nodeIdGen(oldId)` and is translated by the
 *    paste offset (anchor to `flowPos` or +defaultOffset from original position).
 *  - Connectors whose source or target is in the copied set are rewired to the
 *    new ids; endpoints outside the set are left alone.
 */
export function buildPastePayload<N extends PasteableNode, C extends PasteableConnector>({
  nodes,
  connectors,
  flowPos,
  nodeIdGen,
  connectorIdGen,
  defaultOffset = { x: 24, y: 24 },
}: BuildPastePayloadInput<N, C>): BuildPastePayloadResult<N, C> {
  const idMap = new Map<string, string>();
  for (const n of nodes) {
    idMap.set(n.id, nodeIdGen(n.id));
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const n of nodes) {
    if (n.position.x < minX) minX = n.position.x;
    if (n.position.y < minY) minY = n.position.y;
  }
  if (!Number.isFinite(minX)) minX = 0;
  if (!Number.isFinite(minY)) minY = 0;
  const offsetX = flowPos ? flowPos.x - minX : defaultOffset.x;
  const offsetY = flowPos ? flowPos.y - minY : defaultOffset.y;

  const newNodes: N[] = nodes.map((n) => {
    const newId = idMap.get(n.id);
    if (newId === undefined) throw new Error(`paste id missing for ${n.id}`);
    return {
      ...n,
      id: newId,
      position: { x: n.position.x + offsetX, y: n.position.y + offsetY },
    };
  });

  const newConnectors: C[] = connectors.map((c) => {
    const newId = connectorIdGen(c.id);
    return {
      ...c,
      id: newId,
      source: idMap.get(c.source) ?? c.source,
      target: idMap.get(c.target) ?? c.target,
    };
  });

  return { newNodes, newConnectors, idMap };
}

export interface ReconcilePasteFailureInput {
  /** Ids of the optimistically-pasted nodes whose POSTs were in the failed batch. */
  newNodeIds: readonly string[];
  /** Ids of the optimistically-pasted connectors from the same batch. */
  newConnectorIds: readonly string[];
  /**
   * Node ids the server reports AFTER a reconcile refetch, or `null` when that
   * refetch itself failed (so we can't prove anything persisted).
   */
  serverNodeIds: ReadonlySet<string> | null;
  /** Connector ids the server reports after the refetch, or `null`. */
  serverConnectorIds: ReadonlySet<string> | null;
}

export interface ReconcilePasteFailureResult {
  /** Optimistic node overrides to drop — the server has no record of these. */
  dropNodeIds: string[];
  /** Optimistic connector overrides to drop — server confirmed absent. */
  dropConnectorIds: string[];
  /**
   * True when at least one pasted entity is genuinely missing from the server,
   * i.e. the paste really did fail and the user should see the error. When
   * every entity actually persisted (a false-negative response, or the SSE echo
   * never arrived) this is false so no misleading banner is shown.
   */
  showError: boolean;
}

/**
 * Decide how to recover from a rejected paste batch.
 *
 * The naive "drop every optimistic override + show an error" reaction is wrong
 * when the POST failed AFTER the server already persisted the node (a
 * false-negative response, or the SSE `flow:reload` echo arriving while the
 * stream was mid-reconnect). Dropping the override then strands a node that
 * exists on disk but is invisible until a manual refresh — the reported bug.
 *
 * Reconciling against a fresh server snapshot fixes that: keep the overrides
 * for entities the server actually has (the prune effect clears them once the
 * refetched detail lands) and only roll back + surface an error for the ones
 * the server confirms are absent. When the reconcile refetch itself failed
 * (`serverNodeIds`/`serverConnectorIds` are `null`) we can't prove anything
 * persisted, so fall back to the conservative drop-everything behaviour.
 */
export function reconcilePasteFailure({
  newNodeIds,
  newConnectorIds,
  serverNodeIds,
  serverConnectorIds,
}: ReconcilePasteFailureInput): ReconcilePasteFailureResult {
  const dropNodeIds = newNodeIds.filter((id) => !serverNodeIds || !serverNodeIds.has(id));
  const dropConnectorIds = newConnectorIds.filter(
    (id) => !serverConnectorIds || !serverConnectorIds.has(id),
  );
  return {
    dropNodeIds,
    dropConnectorIds,
    showError: dropNodeIds.length > 0 || dropConnectorIds.length > 0,
  };
}

/** Marker so a foreign clipboard string (a copied tweet, a file path) never
 *  parses as a paste-able flow fragment. Bump `v` if the envelope shape changes. */
const CLIPBOARD_MARKER = '__seeflow_clipboard__';
export const SEEFLOW_CLIPBOARD_MIME = 'text/plain';

export interface ClipboardEnvelope<N extends PasteableNode, C extends PasteableConnector> {
  nodes: readonly N[];
  connectors: readonly C[];
}

export function encodeClipboard<N extends PasteableNode, C extends PasteableConnector>(
  payload: ClipboardEnvelope<N, C>,
): string {
  return JSON.stringify({
    [CLIPBOARD_MARKER]: 1,
    nodes: payload.nodes,
    connectors: payload.connectors,
  });
}

export function parseClipboard<N extends PasteableNode, C extends PasteableConnector>(
  text: string,
): ClipboardEnvelope<N, C> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj[CLIPBOARD_MARKER] !== 1) return null;
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.connectors)) return null;
  return { nodes: obj.nodes as N[], connectors: obj.connectors as C[] };
}
