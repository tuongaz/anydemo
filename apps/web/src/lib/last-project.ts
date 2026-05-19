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
 * Pick which demo to auto-open when the user lands on `/`. Returns `null` when
 * we should show the picker instead of jumping into a project.
 *
 *   - 0 demos → null (empty state).
 *   - 1 demo → that demo (skip the picker — there's nothing to choose).
 *   - 2+ demos and the stored last-used id still resolves → that demo.
 *   - 2+ demos with no valid stored id → null (show the picker).
 */
export const pickInitialDemo = (
  demos: FlowSummary[],
  lastId: string | null,
): FlowSummary | null => {
  if (demos.length === 0) return null;
  if (demos.length === 1) return demos[0] ?? null;
  if (lastId) {
    const match = demos.find((d) => d.id === lastId);
    if (match) return match;
  }
  return null;
};
