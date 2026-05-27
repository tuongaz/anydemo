import {
  COALESCE_WINDOW_MS,
  type HistoryEntry,
  type HistoryState,
  MAX_HISTORY,
  STALE_MUTATION_WINDOW_MS,
} from './types.ts';

interface PushOpts {
  now?: number;
  max?: number;
  coalesceWindowMs?: number;
}

/**
 * Merge two per-field `before` snapshots, keeping the OLDEST value per
 * field. `older` wins for shared keys; new keys from `newer` are added.
 * Returns `undefined` when neither side supplies a snapshot so the merged
 * entry stays bit-identical to the host reducer's previous behavior.
 */
const mergeBeforeFields = (
  older: Record<string, unknown> | undefined,
  newer: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!older && !newer) return undefined;
  if (!older) return { ...newer };
  if (!newer) return { ...older };
  const merged: Record<string, unknown> = { ...newer };
  for (const [k, v] of Object.entries(older)) {
    merged[k] = v;
  }
  return merged;
};

/**
 * Push a new entry. Coalesces same-key entries within `COALESCE_WINDOW_MS`
 * by preserving the OLDEST `undo` (so a gesture reverts to its pre-burst
 * state) and merging `beforeFields` field-by-field with oldest-per-field
 * precedence. Otherwise truncates the redo branch and appends. Enforces
 * the `MAX_HISTORY` cap by dropping the oldest entries when exceeded.
 */
export const applyPush = (
  state: HistoryState,
  entry: HistoryEntry,
  opts?: PushOpts,
): HistoryState => {
  const now = opts?.now ?? Date.now();
  const max = opts?.max ?? MAX_HISTORY;
  const coalesceWindowMs = opts?.coalesceWindowMs ?? COALESCE_WINDOW_MS;

  const { stack, cursor } = state;

  // Coalesce: same key, top of stack, within the window → merge into the top
  // entry by replacing `do` with the new one and updating `capturedAt`. The
  // original `undo` is preserved so the entire gesture can still be reverted
  // back to its starting state. `beforeFields` are merged field-by-field
  // (oldest value per field wins) so a multi-key burst stays revertible.
  // Cursor is unchanged.
  if (entry.coalesceKey && cursor > 0) {
    const top = stack[cursor - 1];
    if (top && top.coalesceKey === entry.coalesceKey && now - top.capturedAt <= coalesceWindowMs) {
      const nextStack = stack.slice(0, cursor);
      nextStack[cursor - 1] = {
        ...top,
        do: entry.do,
        capturedAt: now,
        beforeFields: mergeBeforeFields(top.beforeFields, entry.beforeFields),
      };
      return { stack: nextStack, cursor };
    }
  }

  // Truncate the redo branch, then append.
  const nextStack = stack.slice(0, cursor);
  nextStack.push({ ...entry, capturedAt: now });
  let nextCursor = cursor + 1;

  // Capacity: drop oldest entries until we fit. Cursor moves with the shift.
  while (nextStack.length > max) {
    nextStack.shift();
    nextCursor -= 1;
  }
  if (nextCursor < 0) nextCursor = 0;

  return { stack: nextStack, cursor: nextCursor };
};

export const applyUndo = (state: HistoryState): { state: HistoryState; entry?: HistoryEntry } => {
  if (state.cursor === 0) return { state, entry: undefined };
  return {
    state: { ...state, cursor: state.cursor - 1 },
    entry: state.stack[state.cursor - 1],
  };
};

export const applyRedo = (state: HistoryState): { state: HistoryState; entry?: HistoryEntry } => {
  if (state.cursor === state.stack.length) return { state, entry: undefined };
  return {
    state: { ...state, cursor: state.cursor + 1 },
    entry: state.stack[state.cursor],
  };
};

export const applyClear = (): HistoryState => ({ stack: [], cursor: 0 });

/**
 * Remove the entry directly above the cursor (used on optimistic API
 * failure to revert the just-pushed entry without disturbing earlier
 * history). No-op when the cursor is at 0.
 */
export const applyDropTop = (state: HistoryState): HistoryState => {
  if (state.cursor === 0) return state;
  const nextStack = state.stack.slice();
  nextStack.splice(state.cursor - 1, 1);
  return { stack: nextStack, cursor: state.cursor - 1 };
};

/**
 * If `now - lastMutationAt > windowMs`, return a fresh empty state
 * (caller should treat the next external change as foreign). Otherwise
 * return the same reference so callers can compare cheaply.
 */
export const applyStaleClear = (
  state: HistoryState,
  lastMutationAt: number,
  now: number = Date.now(),
  windowMs: number = STALE_MUTATION_WINDOW_MS,
): HistoryState => {
  if (now - lastMutationAt > windowMs) return applyClear();
  return state;
};
