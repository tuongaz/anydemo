import { useCallback, useState } from 'react';

export interface PendingDeletions {
  /** Set of entity ids the user has optimistically deleted but the server hasn't confirmed yet. */
  ids: ReadonlySet<string>;
  /** Mark `id` as optimistically deleted (hide from canvas immediately). */
  mark: (id: string) => void;
  /** Mark every id in `idsToMark` in a single state update (batch deletes). */
  markMany: (idsToMark: readonly string[]) => void;
  /** Drop `id` from the deleted set (used on API failure to restore the entity). */
  unmark: (id: string) => void;
  /** Drop every id in `idsToUnmark` in a single state update. */
  unmarkMany: (idsToUnmark: readonly string[]) => void;
  /**
   * Reconcile against a fresh snapshot of server entities. Drop ids that the
   * server no longer carries (delete confirmed); keep ids the server still
   * has (delete still in flight, suppression still needed).
   */
  pruneAgainst: (items: readonly { id: string }[]) => void;
  /** Clear every pending deletion (used when switching flows). */
  reset: () => void;
}

export const applyMark = (prev: ReadonlySet<string>, id: string): ReadonlySet<string> => {
  if (prev.has(id)) return prev;
  const next = new Set(prev);
  next.add(id);
  return next;
};

export const applyMarkMany = (
  prev: ReadonlySet<string>,
  idsToMark: readonly string[],
): ReadonlySet<string> => {
  if (idsToMark.length === 0) return prev;
  let mutated = false;
  const next = new Set(prev);
  for (const id of idsToMark) {
    if (!next.has(id)) {
      next.add(id);
      mutated = true;
    }
  }
  return mutated ? next : prev;
};

export const applyUnmark = (prev: ReadonlySet<string>, id: string): ReadonlySet<string> => {
  if (!prev.has(id)) return prev;
  const next = new Set(prev);
  next.delete(id);
  return next;
};

export const applyUnmarkMany = (
  prev: ReadonlySet<string>,
  idsToUnmark: readonly string[],
): ReadonlySet<string> => {
  if (idsToUnmark.length === 0) return prev;
  let mutated = false;
  const next = new Set(prev);
  for (const id of idsToUnmark) {
    if (next.has(id)) {
      next.delete(id);
      mutated = true;
    }
  }
  return mutated ? next : prev;
};

export const applyPruneDeletionsAgainst = (
  prev: ReadonlySet<string>,
  items: readonly { id: string }[],
): ReadonlySet<string> => {
  if (prev.size === 0) return prev;
  const serverIds = new Set(items.map((it) => it.id));
  let mutated = false;
  const next = new Set(prev);
  for (const id of next) {
    if (!serverIds.has(id)) {
      next.delete(id);
      mutated = true;
    }
  }
  return mutated ? next : prev;
};

/**
 * Tracks entities the user has optimistically deleted but for which the
 * server delete + SSE echo has not yet landed. Mirrors `usePendingOverrides`
 * but for "this thing should be hidden" rather than "these fields are
 * pending". Callers `mark()` on delete, then either `pruneAgainst()` on the
 * next flow:reload echo (server caught up) or `unmark()` on API failure.
 */
export const usePendingDeletions = (): PendingDeletions => {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());

  const mark = useCallback((id: string) => {
    setIds((prev) => applyMark(prev, id));
  }, []);

  const markMany = useCallback((idsToMark: readonly string[]) => {
    setIds((prev) => applyMarkMany(prev, idsToMark));
  }, []);

  const unmark = useCallback((id: string) => {
    setIds((prev) => applyUnmark(prev, id));
  }, []);

  const unmarkMany = useCallback((idsToUnmark: readonly string[]) => {
    setIds((prev) => applyUnmarkMany(prev, idsToUnmark));
  }, []);

  const pruneAgainst = useCallback((items: readonly { id: string }[]) => {
    setIds((prev) => applyPruneDeletionsAgainst(prev, items));
  }, []);

  const reset = useCallback(() => setIds(new Set()), []);

  return { ids, mark, markMany, unmark, unmarkMany, pruneAgainst, reset };
};
