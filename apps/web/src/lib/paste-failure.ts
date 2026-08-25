import type { FlowDetail } from '@/lib/api';
import { reconcilePasteFailure } from '@/lib/clipboard';

/**
 * Side-effect seams the paste-failure handler drives. Injected so the
 * reconcile orchestration can be unit-tested without mounting the canvas.
 */
export interface PasteFailureDeps {
  /** Refetch the authoritative flow detail from the server. */
  fetchDetail: () => Promise<FlowDetail>;
  /** Push a fresh detail into the flow-data cache (SSE `flow:reload` channel). */
  applyDetail: (detail: FlowDetail) => void;
  /** Drop a node's optimistic override. */
  dropNode: (id: string) => void;
  /** Drop a connector's optimistic override. */
  dropConnector: (id: string) => void;
  /** Surface a user-facing error banner. */
  setError: (message: string) => void;
  /** Log a diagnostic (console.error in the app). */
  logError: (message: string, err: unknown) => void;
}

/**
 * Recover from a rejected paste batch by reconciling the optimistic overrides
 * against server truth.
 *
 * A paste POST can reject on the client AFTER the server already persisted the
 * node (a false-negative response, a partial batch whose node leg succeeded but
 * a later connector leg failed, or the SSE echo arriving mid-reconnect). The
 * naive "drop every override + show an error" reaction then strands a node that
 * exists on disk but is invisible until a manual refresh. This handler refetches
 * the flow, pushes it so persisted-but-unechoed entities render, and uses
 * {@link reconcilePasteFailure} to drop overrides + raise an error ONLY for the
 * entities the server confirms are absent. When the refetch itself fails it
 * falls back to the conservative drop-everything behaviour.
 */
export async function handlePasteFailure(
  err: unknown,
  newNodeIds: readonly string[],
  newConnectorIds: readonly string[],
  deps: PasteFailureDeps,
): Promise<void> {
  deps.logError('paste failed', err);

  let serverNodeIds: Set<string> | null = null;
  let serverConnectorIds: Set<string> | null = null;
  try {
    const fresh = await deps.fetchDetail();
    serverNodeIds = new Set((fresh.flow?.nodes ?? []).map((n) => n.id));
    serverConnectorIds = new Set((fresh.flow?.connectors ?? []).map((c) => c.id));
    // Push server truth so a persisted-but-unechoed paste renders even when the
    // SSE stream never delivered the reload.
    deps.applyDetail(fresh);
  } catch (refetchErr) {
    deps.logError('paste reconcile refetch failed', refetchErr);
  }

  const { dropNodeIds, dropConnectorIds, showError } = reconcilePasteFailure({
    newNodeIds,
    newConnectorIds,
    serverNodeIds,
    serverConnectorIds,
  });
  for (const id of dropNodeIds) deps.dropNode(id);
  for (const id of dropConnectorIds) deps.dropConnector(id);
  if (showError) deps.setError(err instanceof Error ? err.message : String(err));
}
