import type { Connector, FlowNode } from '../types.ts';

/**
 * A single undo/redo entry. `do` and `undo` are async closures the wrapper
 * runs against the underlying adapter. `coalesceKey` opts the entry into the
 * 500ms merge window — a subsequent push with the same key collapses into
 * the top entry while preserving the OLDEST `undo` (so a gesture still
 * reverts to its pre-burst state).
 */
export interface HistoryEntry {
  do: () => Promise<void>;
  undo: () => Promise<void>;
  coalesceKey?: string;
  /**
   * Per-field "before" snapshot. Used when coalescing: the merged entry
   * takes the OLDEST value per field, so a style burst that touches
   * different fields stays fully revertible. Optional — batch entries
   * and create/delete entries don't carry a snapshot.
   */
  beforeFields?: Record<string, unknown>;
  capturedAt: number;
}

export interface HistoryState {
  stack: HistoryEntry[];
  cursor: number;
}

/**
 * Snapshot of the live flow used by the wrapper to capture "before" state
 * at call time (without holding a stale reference). Supplied by the host.
 */
export interface FlowStateSnapshot {
  nodes: readonly FlowNode[];
  connectors: readonly Connector[];
}

export type GetFlowState = () => FlowStateSnapshot;

/**
 * Public handle returned alongside the wrapped adapter. Hosts use it for
 * Cmd+Z / Cmd+Shift+Z plumbing, command-palette enable state, and
 * SSE-driven stale-clear via `markExternalChange()`.
 */
export interface HistoryHandle {
  undo(): Promise<void>;
  redo(): Promise<void>;
  clear(): void;
  markExternalChange(): void;
  batch<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /**
   * Subscribe to `{canUndo, canRedo}` snapshots. The callback is invoked
   * ONCE IMMEDIATELY with the current state so consumers can populate
   * initial UI without a separate getSnapshot step (matches the
   * React-style `useSyncExternalStore` expectation), and then again after
   * every state mutation: push, undo, redo, clear, stale-clear, batch
   * open redo-branch truncation, and batch close. Mid-batch adapter calls
   * do NOT notify — subscribers see exactly one transition per gesture.
   *
   * Returns an unsubscribe function. Safe to call multiple times.
   */
  subscribe(cb: (state: { canUndo: boolean; canRedo: boolean }) => void): () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

/**
 * 500 entries cover ~an hour of varied editing without dropping early
 * state. Each entry is a closure pair (~hundreds of bytes), so retained
 * memory at the cap is on the order of low hundreds of KB.
 */
export const MAX_HISTORY = 500;
export const COALESCE_WINDOW_MS = 500;
/**
 * Idle window after the most recent UI mutation. If a flow:reload echo
 * arrives AFTER this window, the change is treated as external (text
 * editor, git checkout) and the stack is cleared so undo never replays
 * against stale state. Sized comfortably above the watcher's ~150-500ms
 * post-mutation echo so normal UI activity never triggers a false clear.
 */
export const STALE_MUTATION_WINDOW_MS = 2000;
