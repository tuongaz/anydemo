import type {
  CanvasAdapter,
  ConnectorCreateInput,
  ConnectorPatch,
  LayoutEdgeInput,
  LayoutNodeInput,
  LayoutResult,
  NodeCreateInput,
  NodePatch,
  PlayActionResult,
  ReorderOp,
  UpdateNodePositionResult,
  UploadImageResult,
} from '../adapter/types.ts';
import {
  applyClear,
  applyDropRedoBranch,
  applyPush,
  applyRedo,
  applyStaleClear,
  applyUndo,
} from './stack.ts';
import type { GetFlowState, HistoryEntry, HistoryHandle, HistoryState } from './types.ts';

/**
 * Wrap a host-supplied `CanvasAdapter` and return a paired
 * `{ adapter, history }` where every mutating call is intercepted to record
 * an inverse on the history stack. The returned `adapter` is a drop-in
 * replacement; the returned `history` is the public `HistoryHandle` the
 * canvas reads for Cmd+Z / palette state / SSE stale-clear.
 *
 * Scope of THIS commit (Task 9): skeleton + ONE wired method
 * (`updateNodePosition`). The other adapter methods forward unchanged so
 * the wrapped object satisfies `CanvasAdapter`'s exhaustive interface;
 * Tasks 10-15 replace these passthroughs with proper push-on-success
 * wrappers. `batch` and `subscribe` are intentional stubs filled in by
 * Tasks 15-16.
 */
export function wrapAdapterWithHistory(
  inner: CanvasAdapter,
  getFlowState: GetFlowState,
): { adapter: CanvasAdapter; history: HistoryHandle } {
  let state: HistoryState = { stack: [], cursor: 0 };
  let lastMutationAt = 0;
  const subscribers = new Set<(s: { canUndo: boolean; canRedo: boolean }) => void>();

  const snapshot = (): { canUndo: boolean; canRedo: boolean } => ({
    canUndo: state.cursor > 0,
    canRedo: state.cursor < state.stack.length,
  });

  const notify = (): void => {
    const snap = snapshot();
    for (const cb of subscribers) cb(snap);
  };

  /**
   * Synchronous prelude every intercepted method runs BEFORE awaiting the
   * inner call. Truncates the redo branch (so a late-arriving push cannot
   * silently nuke a redo the user built between call + resolution — design
   * §5) and stamps `lastMutationAt` so the SSE stale-clear treats the
   * round-trip echo as "ours" rather than foreign.
   */
  const beginIntercept = (): void => {
    const next = applyDropRedoBranch(state);
    lastMutationAt = Date.now();
    if (next !== state) {
      state = next;
      notify();
    }
  };

  const push = (entry: Omit<HistoryEntry, 'capturedAt'>): void => {
    state = applyPush(state, { ...entry, capturedAt: Date.now() });
    notify();
  };

  // -----------------------------------------------------------------------
  // Wrapped adapter
  // -----------------------------------------------------------------------

  const wrappedAdapter: CanvasAdapter = {
    createNode: (input: NodeCreateInput) => {
      // TODO(Task 12): wrap so undo calls inner.deleteNode(returnedId).
      return inner.createNode(input);
    },

    updateNode: (nodeId: string, patch: NodePatch) => {
      // TODO(Task 10): snapshot touched keys, push inverse updateNode(before).
      return inner.updateNode(nodeId, patch);
    },

    updateNodePosition: async (
      nodeId: string,
      position: { x: number; y: number },
    ): Promise<UpdateNodePositionResult> => {
      beginIntercept();
      const { nodes } = getFlowState();
      const node = nodes.find((n) => n.id === nodeId);
      const before = node?.position;
      const result = await inner.updateNodePosition(nodeId, position);
      // Only push when we have a `before` snapshot to invert against. A
      // missing node id (stale id, race) means there's no meaningful undo.
      if (before) {
        push({
          do: async () => {
            await inner.updateNodePosition(nodeId, position);
          },
          undo: async () => {
            await inner.updateNodePosition(nodeId, before);
          },
          coalesceKey: `pos:${nodeId}`,
        });
      }
      return result;
    },

    deleteNode: (nodeId: string) => {
      // TODO(Task 11): snapshot node + cascade connectors, push inverse.
      return inner.deleteNode(nodeId);
    },

    reorderNode: (nodeId: string, op: ReorderOp) => {
      // TODO(Task 13): snapshot prior index, push inverse reorderNode(toIndex).
      return inner.reorderNode(nodeId, op);
    },

    createConnector: (input: ConnectorCreateInput) => {
      // TODO(Task 12): push inverse deleteConnector(returnedId).
      return inner.createConnector(input);
    },

    updateConnector: (connectorId: string, patch: ConnectorPatch) => {
      // TODO(Task 13): snapshot touched keys, push inverse updateConnector(before).
      return inner.updateConnector(connectorId, patch);
    },

    deleteConnector: (connectorId: string) => {
      // TODO(Task 13): snapshot connector, push inverse createConnector(saved).
      return inner.deleteConnector(connectorId);
    },

    uploadImage: (nodeId: string, file: File, filename: string): Promise<UploadImageResult> => {
      // Outside a batch the upload is recorded as a no-op (file orphaned;
      // canvas doesn't know how to delete). Inside a batch (Task 14) the
      // upload runs and the paired createNode becomes the undo handle.
      return inner.uploadImage(nodeId, file, filename);
    },

    // Optional methods — forward only when the host supplied them. Keeping
    // these conditional preserves `?` semantics in CanvasAdapter so embedders
    // can still omit them.
    ...(inner.playAction
      ? {
          playAction: (nodeId: string): Promise<PlayActionResult> =>
            // biome-ignore lint/style/noNonNullAssertion: presence checked above
            inner.playAction!(nodeId),
        }
      : {}),
    ...(inner.openFile
      ? {
          openFile: (path: string): Promise<void> =>
            // biome-ignore lint/style/noNonNullAssertion: presence checked above
            inner.openFile!(path),
        }
      : {}),
    ...(inner.revealFile
      ? {
          revealFile: (path: string): Promise<void> =>
            // biome-ignore lint/style/noNonNullAssertion: presence checked above
            inner.revealFile!(path),
        }
      : {}),
    ...(inner.computeLayout
      ? {
          computeLayout: (
            nodes: readonly LayoutNodeInput[],
            edges: readonly LayoutEdgeInput[],
          ): Promise<LayoutResult> =>
            // biome-ignore lint/style/noNonNullAssertion: presence checked above
            inner.computeLayout!(nodes, edges),
        }
      : {}),
  };

  // -----------------------------------------------------------------------
  // History handle
  // -----------------------------------------------------------------------

  // Serialize undo()/redo() with a chained promise so concurrent invocations
  // queue rather than race on the cursor. Same pattern as the legacy host
  // hook at apps/web/src/hooks/use-undo-stack.ts:178-217.
  let chain: Promise<unknown> = Promise.resolve();

  const runUndo = async (): Promise<void> => {
    const result = applyUndo(state);
    if (!result.entry) return;
    state = result.state;
    notify();
    await result.entry.undo();
  };

  const runRedo = async (): Promise<void> => {
    const result = applyRedo(state);
    if (!result.entry) return;
    state = result.state;
    notify();
    await result.entry.do();
  };

  const history: HistoryHandle = {
    get canUndo() {
      return state.cursor > 0;
    },
    get canRedo() {
      return state.cursor < state.stack.length;
    },
    undo: () => {
      // Stamp BEFORE queueing so a chain of undos doesn't get its own SSE
      // echo flagged as foreign by markExternalChange (design §7).
      lastMutationAt = Date.now();
      const next = chain.then(runUndo);
      chain = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    redo: () => {
      lastMutationAt = Date.now();
      const next = chain.then(runRedo);
      chain = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    clear: () => {
      state = applyClear();
      notify();
    },
    markExternalChange: () => {
      const next = applyStaleClear(state, lastMutationAt);
      if (next !== state) {
        state = next;
        notify();
      }
    },
    // TODO(Task 15): real batch with rollback. Transparent stub for now so
    // individual intercepted methods still push as if no batch is open.
    batch: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
    // TODO(Task 16): real subscribe wired to the subscribers Set above. The
    // Set already exists and `notify()` already calls it — this stub is a
    // no-op subscriber because no test in Task 9 exercises subscribe.
    subscribe: (_cb: (s: { canUndo: boolean; canRedo: boolean }) => void) => {
      return () => {
        /* noop */
      };
    },
  };

  return { adapter: wrappedAdapter, history };
}
