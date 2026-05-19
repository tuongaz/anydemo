import { useCallback, useState } from 'react';

export type OverrideMap<T extends { id: string }> = Record<string, Partial<T>>;

export interface PendingOverrides<T extends { id: string }> {
  /** Map of entity id → partial override. Read at render time to overlay on server data. */
  overrides: OverrideMap<T>;
  /**
   * Merge `partial` into the override for `id`. Existing fields not present
   * in `partial` are preserved (so multi-field optimistic edits accumulate).
   */
  setOverride: (id: string, partial: Partial<T>) => void;
  /** Drop the entire override for `id` (used on API failure to revert to server state). */
  dropOverride: (id: string) => void;
  /**
   * Reconcile against a fresh snapshot of server entities. For each override,
   * drop any field whose value already matches the server's value (server
   * caught up); if no fields remain, drop the entry. Entities missing from
   * the snapshot are left alone — they get cleared on the next demo-id reset.
   */
  pruneAgainst: (items: T[]) => void;
  /** Clear every override (used when switching demos). */
  reset: () => void;
}

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
};

export const applySetOverride = <T extends { id: string }>(
  prev: OverrideMap<T>,
  id: string,
  partial: Partial<T>,
): OverrideMap<T> => ({ ...prev, [id]: { ...prev[id], ...partial } });

export const applyDropOverride = <T extends { id: string }>(
  prev: OverrideMap<T>,
  id: string,
): OverrideMap<T> => {
  if (!(id in prev)) return prev;
  const next = { ...prev };
  delete next[id];
  return next;
};

export const applyPruneAgainst = <T extends { id: string }>(
  prev: OverrideMap<T>,
  items: T[],
): OverrideMap<T> => {
  const entries = Object.entries(prev);
  if (entries.length === 0) return prev;
  const byId = new Map(items.map((it) => [it.id, it]));
  let mutated = false;
  const next: OverrideMap<T> = { ...prev };
  for (const [id, partial] of entries) {
    const server = byId.get(id);
    if (!server) continue;
    const remaining: Partial<T> = {};
    let kept = false;
    for (const key of Object.keys(partial) as (keyof T)[]) {
      if (deepEqual(partial[key], server[key])) {
        mutated = true;
      } else {
        remaining[key] = partial[key];
        kept = true;
      }
    }
    if (kept) {
      next[id] = remaining;
    } else {
      mutated = true;
      delete next[id];
    }
  }
  return mutated ? next : prev;
};

/**
 * Generalized optimistic-edit reconciliation. Generalizes the original
 * `positionOverrides` flow in `demo-view.tsx`: callers `setOverride` BEFORE
 * firing the API call, then either `pruneAgainst` on the next flow:reload
 * echo (server caught up) or `dropOverride` on API failure (revert).
 */
export const usePendingOverrides = <T extends { id: string }>(): PendingOverrides<T> => {
  const [overrides, setOverrides] = useState<OverrideMap<T>>({});

  const setOverride = useCallback((id: string, partial: Partial<T>) => {
    setOverrides((prev) => applySetOverride(prev, id, partial));
  }, []);

  const dropOverride = useCallback((id: string) => {
    setOverrides((prev) => applyDropOverride(prev, id));
  }, []);

  const pruneAgainst = useCallback((items: T[]) => {
    setOverrides((prev) => applyPruneAgainst(prev, items));
  }, []);

  const reset = useCallback(() => setOverrides({}), []);

  return { overrides, setOverride, dropOverride, pruneAgainst, reset };
};
