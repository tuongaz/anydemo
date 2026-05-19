import { useCallback, useReducer, useRef } from 'react';

// US-008 mutation-coverage audit (every user-visible canvas mutation produces
// exactly one undo entry per gesture; coalesced gestures reuse the 500ms window
// keyed on the gesture id):
//   • node add — onCreateShapeNode / onCreateIconNode (no key)
//   • node delete — onDeleteNode / onDeleteSelection (no key, batched)
//   • node drag — onNodePositionChange (key: node:<id>:position) / onNodePositionsChange (batched)
//   • node resize — onNodeResize (key: node:<id>:resize)
//   • node label edit — onNodeLabelChange (key: node:<id>:label)
//   • node description edit — onNodeDescriptionChange (key: node:<id>:description), onDetailDescriptionChange (key: node:<id>:detail-description)
//   • node color/style change — onStyleNode (key: node:<id>:style) / onStyleNodes (batched)
//   • icon change — handleIconPicked replace mode (key: node:<id>:icon)
//   • edge create — onCreateConnector / onCreateAndConnectFromPane (no key)
//   • edge delete — onDeleteConnector / onDeleteSelection (no key)
//   • edge label edit — onConnectorLabelChange (key: connector:<id>:label)
//   • edge style change — onStyleConnector (key: connector:<id>:style)
//   • edge reconnect — onReconnectConnector (key: connector:<id>:reconnect)
//   • edge endpoint pin — onPinEndpoint (key: connector:<id>:<sourcePin|targetPin>)
//   • edge endpoint unpin — onUnpinEndpoint (no key, single-shot)
//   • reorder z-index — onReorderNode (no key)
//   • tidy layout — onTidy (no key, batched)
//   • paste — onPasteNodes (no key, batched)

export interface UndoEntry {
  do: () => Promise<void>;
  undo: () => Promise<void>;
  coalesceKey?: string;
  capturedAt: number;
}

export interface UndoStackState {
  stack: UndoEntry[];
  cursor: number;
}

// US-008: 500 entries cover ~an hour of varied editing on the canvas without
// dropping early state. Each entry is a closure pair (~hundreds of bytes), so
// retained memory at the cap is on the order of low hundreds of KB.
export const MAX_HISTORY = 500;
export const COALESCE_WINDOW_MS = 500;
/**
 * Idle window after the most recent UI mutation. If a flow:reload echo arrives
 * AFTER this window, the change is treated as external (text editor, git
 * checkout) and the stack is cleared so undo never replays against stale state.
 * Sized comfortably above the watcher's ~150-500ms post-mutation echo so normal
 * UI activity never triggers a false clear.
 */
export const STALE_MUTATION_WINDOW_MS = 2000;

const INITIAL_STATE: UndoStackState = { stack: [], cursor: 0 };

interface PushOpts {
  now?: number;
  max?: number;
  coalesceWindowMs?: number;
}

export const applyPush = (
  state: UndoStackState,
  entry: UndoEntry,
  opts?: PushOpts,
): UndoStackState => {
  const now = opts?.now ?? Date.now();
  const max = opts?.max ?? MAX_HISTORY;
  const coalesceWindowMs = opts?.coalesceWindowMs ?? COALESCE_WINDOW_MS;

  const { stack, cursor } = state;

  // Coalesce: same key, top of stack, within the window → merge into the top
  // entry by replacing `do` with the new one and updating `capturedAt`. The
  // original `undo` is preserved so the entire gesture can still be reverted
  // back to its starting state. Cursor is unchanged.
  if (entry.coalesceKey && cursor > 0) {
    const top = stack[cursor - 1];
    if (top && top.coalesceKey === entry.coalesceKey && now - top.capturedAt <= coalesceWindowMs) {
      const nextStack = stack.slice(0, cursor);
      nextStack[cursor - 1] = { ...top, do: entry.do, capturedAt: now };
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

export const applyUndo = (state: UndoStackState): { state: UndoStackState; entry?: UndoEntry } => {
  if (state.cursor === 0) return { state, entry: undefined };
  return {
    state: { ...state, cursor: state.cursor - 1 },
    entry: state.stack[state.cursor - 1],
  };
};

export const applyRedo = (state: UndoStackState): { state: UndoStackState; entry?: UndoEntry } => {
  if (state.cursor === state.stack.length) return { state, entry: undefined };
  return {
    state: { ...state, cursor: state.cursor + 1 },
    entry: state.stack[state.cursor],
  };
};

export const applyClear = (): UndoStackState => ({ stack: [], cursor: 0 });

export const applyDropTop = (state: UndoStackState): UndoStackState => {
  if (state.cursor === 0) return state;
  const nextStack = state.stack.slice();
  nextStack.splice(state.cursor - 1, 1);
  return { stack: nextStack, cursor: state.cursor - 1 };
};

/**
 * If `now - lastMutationAt > STALE_MUTATION_WINDOW_MS`, return a fresh empty
 * state (caller should treat the next demo reload as external). Otherwise
 * return the same reference so callers can compare cheaply.
 */
export const applyStaleClear = (
  state: UndoStackState,
  lastMutationAt: number,
  now: number = Date.now(),
  windowMs: number = STALE_MUTATION_WINDOW_MS,
): UndoStackState => {
  if (now - lastMutationAt > windowMs) return applyClear();
  return state;
};

// ---- Hook ----

type Action = { type: 'replace'; state: UndoStackState };

const reducer = (_state: UndoStackState, action: Action): UndoStackState => action.state;

export type PushInput = Omit<UndoEntry, 'capturedAt'> & { capturedAt?: number };

export interface UseUndoStackResult {
  /** Push a new entry. `capturedAt` defaults to `Date.now()`. */
  push: (entry: PushInput) => void;
  /** Pop the cursor down by one. Returns the entry whose `undo` the caller should run. */
  undo: () => Promise<{ entry?: UndoEntry } | undefined>;
  /** Move the cursor up by one. Returns the entry whose `do` the caller should replay. */
  redo: () => Promise<{ entry?: UndoEntry } | undefined>;
  /** Empty the stack and reset the cursor. */
  clear: () => void;
  /** Revert the most recent push (used on optimistic API failure). */
  dropTop: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Stamp `lastMutationAt = Date.now()` to keep the stack alive across watcher echoes. */
  markMutation: () => void;
  /** Read the most recent `lastMutationAt` timestamp without re-rendering. */
  lastMutationAt: () => number;
}

/**
 * Per-demo undo/redo stack. Pure reducers above are exported for unit tests;
 * the hook wraps them in `useReducer` and adds an internal promise chain so
 * concurrent `undo()`/`redo()` calls queue rather than racing on the cursor.
 */
export const useUndoStack = (): UseUndoStackResult => {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // stateRef tracks the latest reducer state synchronously so the chained
  // promise callbacks below see fresh state without waiting on React's commit.
  const stateRef = useRef(state);
  stateRef.current = state;

  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const lastMutationAtRef = useRef(0);

  const replace = useCallback((next: UndoStackState) => {
    if (next === stateRef.current) return;
    stateRef.current = next;
    dispatch({ type: 'replace', state: next });
  }, []);

  const push = useCallback(
    (input: PushInput) => {
      const fullEntry: UndoEntry = {
        do: input.do,
        undo: input.undo,
        coalesceKey: input.coalesceKey,
        capturedAt: input.capturedAt ?? Date.now(),
      };
      replace(applyPush(stateRef.current, fullEntry));
    },
    [replace],
  );

  const undo = useCallback((): Promise<{ entry?: UndoEntry } | undefined> => {
    // US-008: an undo IS a fresh UI mutation — keep the stale-clear timer
    // refreshed so the SSE echo of the undo's own PATCH doesn't cross the
    // STALE_MUTATION_WINDOW_MS threshold and wipe the rest of the stack mid-
    // chain. Without this, a chain of >3-4 undos with API roundtrips dies.
    lastMutationAtRef.current = Date.now();
    const next = chainRef.current.then(() => {
      const result = applyUndo(stateRef.current);
      if (!result.entry) return undefined;
      replace(result.state);
      return { entry: result.entry };
    });
    chainRef.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }, [replace]);

  const redo = useCallback((): Promise<{ entry?: UndoEntry } | undefined> => {
    // Same reasoning as `undo` — see comment above.
    lastMutationAtRef.current = Date.now();
    const next = chainRef.current.then(() => {
      const result = applyRedo(stateRef.current);
      if (!result.entry) return undefined;
      replace(result.state);
      return { entry: result.entry };
    });
    chainRef.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }, [replace]);

  const clear = useCallback(() => {
    replace(applyClear());
  }, [replace]);

  const dropTop = useCallback(() => {
    replace(applyDropTop(stateRef.current));
  }, [replace]);

  const markMutation = useCallback(() => {
    lastMutationAtRef.current = Date.now();
  }, []);

  const lastMutationAt = useCallback(() => lastMutationAtRef.current, []);

  return {
    push,
    undo,
    redo,
    clear,
    dropTop,
    canUndo: state.cursor > 0,
    canRedo: state.cursor < state.stack.length,
    markMutation,
    lastMutationAt,
  };
};
