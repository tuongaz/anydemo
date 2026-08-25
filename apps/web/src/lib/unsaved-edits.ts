/**
 * Optimistic-edit confirmation guard.
 *
 * Every node/connector add/edit/delete in the canvas is applied optimistically:
 * an in-memory override (or pending-deletion mark) renders the change BEFORE the
 * server has confirmed it, and the override is only dropped once the SSE
 * `flow:reload` echo proves the write landed (see `usePendingOverrides` /
 * `usePendingDeletions`). That override is the ONLY record of the change while
 * it's in flight — a navigation or page reload discards it, and the subsequent
 * GET re-reads whatever is actually on disk. If the write hadn't landed yet (in
 * flight, or failed and the override was kept), the edit is silently lost and
 * the refreshed page shows stale data.
 *
 * `hasUnconfirmedEdits` is the single predicate behind the `beforeunload`
 * guard: when it's true, the studio warns before letting the tab unload so the
 * user doesn't lose an edit the canvas already shows as applied.
 */
export interface UnconfirmedEditCounts {
  /** Pending optimistic field overrides on nodes (usePendingOverrides). */
  nodeOverrides: number;
  /** Pending optimistic field overrides on connectors. */
  connectorOverrides: number;
  /** Nodes optimistically deleted, server delete not yet confirmed. */
  nodeDeletions: number;
  /** Connectors optimistically deleted, server delete not yet confirmed. */
  connectorDeletions: number;
}

export const hasUnconfirmedEdits = (counts: UnconfirmedEditCounts): boolean =>
  counts.nodeOverrides > 0 ||
  counts.connectorOverrides > 0 ||
  counts.nodeDeletions > 0 ||
  counts.connectorDeletions > 0;
