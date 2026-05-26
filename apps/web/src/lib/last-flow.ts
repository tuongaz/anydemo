/**
 * US-026: per-project "last opened flow" persistence + redirect picker.
 *
 *   - `readLastFlow(project)` / `writeLastFlow(project, flowSlug)` live behind
 *     localStorage keyed by `seeflow:last-flow:<project>` — one entry per
 *     project so two projects with a `main` flow don't trample each other.
 *   - `pickInitialFlow(flows, lastFlow)` is the pure picker the App.tsx
 *     redirect effect calls when the URL is `/projects/<project>` with no flow
 *     segment. Priority: localStorage value (if it still resolves to a flow in
 *     the list) → the project's default flow → the first flow in the list.
 *     Returns null only when the list is empty.
 */
import type { ProjectFlowSummary } from '@/lib/api';

export const LAST_FLOW_STORAGE_KEY_PREFIX = 'seeflow:last-flow:';

const storageKey = (project: string): string => `${LAST_FLOW_STORAGE_KEY_PREFIX}${project}`;

export const readLastFlow = (project: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(storageKey(project));
  } catch {
    return null;
  }
};

export const writeLastFlow = (project: string, flowSlug: string): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(project), flowSlug);
  } catch {
    // localStorage may be unavailable (private mode, quota, etc.) — non-fatal.
  }
};

export type PickableFlow = Pick<ProjectFlowSummary, 'flowSlug' | 'isDefault'>;

/**
 * Pick which flow to redirect to when the URL is `/projects/<project>` with no
 * flow segment. URL takes priority before this function is called — App.tsx
 * only invokes the picker when the URL lacks a flow.
 */
export const pickInitialFlow = (
  flows: ReadonlyArray<PickableFlow>,
  lastFlow: string | null,
): string | null => {
  if (flows.length === 0) return null;
  if (lastFlow) {
    const match = flows.find((f) => f.flowSlug === lastFlow);
    if (match) return match.flowSlug;
  }
  const def = flows.find((f) => f.isDefault);
  if (def) return def.flowSlug;
  return flows[0]?.flowSlug ?? null;
};
