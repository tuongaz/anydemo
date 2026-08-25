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
   * the snapshot are left alone — they get cleared on the next flow-id reset.
   */
  pruneAgainst: (items: T[]) => void;
  /** Clear every override (used when switching flows). */
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

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

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
    const out = remaining as Record<string, unknown>;
    let kept = false;
    for (const key of Object.keys(partial) as (keyof T)[]) {
      const pv = partial[key];
      const sv = server[key];
      // `data` is a partial bag overlaid on the server's FULL `data` object —
      // comparing the two wholesale never matches (the server carries extra
      // keys), so the override would leak forever and mask later server
      // changes (notably an undo's revert). Reconcile its keys individually:
      // keep only the sub-keys that still differ from the server.
      if (key === 'data' && isPlainObject(pv) && isPlainObject(sv)) {
        const dataDiff: Record<string, unknown> = {};
        let dataKept = false;
        for (const dk of Object.keys(pv)) {
          if (!deepEqual(pv[dk], sv[dk])) {
            dataDiff[dk] = pv[dk];
            dataKept = true;
          }
        }
        if (dataKept) {
          out[key as string] = dataDiff;
          kept = true;
        }
      } else if (deepEqual(pv, sv)) {
        // matched — drop this key
      } else {
        out[key as string] = pv;
        kept = true;
      }
    }
    if (!kept) {
      delete next[id];
      mutated = true;
    } else if (!deepEqual(remaining, partial)) {
      next[id] = remaining;
      mutated = true;
    }
    // else: pruned result is identical to the existing override — keep the
    // original reference so the map stays referentially stable.
  }
  return mutated ? next : prev;
};

/**
 * Generalized optimistic-edit reconciliation. Generalizes the original
 * `positionOverrides` flow in `flow-view.tsx`: callers `setOverride` BEFORE
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
