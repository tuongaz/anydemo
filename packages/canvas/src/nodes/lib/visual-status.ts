import type { NodeStatus, StatusReport } from '../../types.ts';

/**
 * Canonical four-state visual model shared by PlayNode + StateNode.
 *
 * - idle:    no run, no pending status. Pill not rendered; play button shows Play.
 * - active:  running (PlayNode) OR pending status (StateNode "checking").
 * - success: done OR statusReport.state === 'ok'.
 * - error:   error OR statusReport.state === 'error'. Beats every other state.
 *
 * `warn` reports do NOT promote to a visual state — they still show up in the
 * footer `StatusBadge`, but the pill stays idle so warn doesn't read as
 * "something needs your attention right now".
 */
export type VisualStatus = 'idle' | 'active' | 'success' | 'error';

export function deriveVisualStatus(
  status: NodeStatus | undefined,
  statusReport: StatusReport | undefined,
): VisualStatus {
  // Error wins over everything — both run-error and status-error are loud.
  if (status === 'error' || statusReport?.state === 'error') return 'error';
  // Active beats success: a fresh re-check after a completed run reads as
  // active again, so the user sees the new check happening.
  if (status === 'running' || statusReport?.state === 'pending') return 'active';
  if (status === 'done' || statusReport?.state === 'ok') return 'success';
  return 'idle';
}
