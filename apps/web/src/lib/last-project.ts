import type { FlowSummary } from '@/lib/api';

export const LAST_PROJECT_STORAGE_KEY = 'seeflow:last-project';

export const readLastProjectId = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
};

export const writeLastProjectId = (id: string): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, id);
  } catch {
    // localStorage may be unavailable (private mode, quota, etc.) — non-fatal.
  }
};

/**
 * Pick which flow to auto-open when the user lands on `/`. Returns `null` when
 * we should show the picker instead of jumping into a project.
 *
 *   - 0 flows → null (empty state).
 *   - 1 flow → that flow (skip the picker — there's nothing to choose).
 *   - 2+ flows and the stored last-used id still resolves → that flow.
 *   - 2+ flows with no valid stored id → null (show the picker).
 */
export const pickLandingFlow = (
  flows: FlowSummary[],
  lastId: string | null,
): FlowSummary | null => {
  if (flows.length === 0) return null;
  if (flows.length === 1) return flows[0] ?? null;
  if (lastId) {
    const match = flows.find((d) => d.id === lastId);
    if (match) return match;
  }
  return null;
};
