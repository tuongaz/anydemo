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

    updateNode: async (nodeId: string, patch: NodePatch): Promise<void> => {
      beginIntercept();
      const { nodes } = getFlowState();
      const node = nodes.find((n) => n.id === nodeId);
      // No snapshot to invert against (stale id, race, or the host stripped
      // the node before the adapter call landed). Mirror the
      // `updateNodePosition` skip-push-silently behaviour rather than guess
      // at the prior state.
      if (!node) {
        await inner.updateNode(nodeId, patch);
        return;
      }
      // Snapshot ONLY the keys the patch touches — `before[k]` is the
      // current value at `k` on the node (top-level for `type`/`position`,
      // `node.data[k]` otherwise). When a key isn't set on the node,
      // `before[k] = undefined`; passing `{k: undefined}` back to
      // inner.updateNode mirrors the post-clear state at least for the
      // happy paths the studio adapter handles today (design §3).
      const before: NodePatch = {};
      const data = (node.data ?? {}) as Record<string, unknown>;
      for (const key of Object.keys(patch) as (keyof NodePatch)[]) {
        if (key === 'position') {
          (before as Record<string, unknown>)[key] = node.position;
        } else if (key === 'type') {
          (before as Record<string, unknown>)[key] = node.type;
        } else {
          (before as Record<string, unknown>)[key] = data[key as string];
        }
      }
      await inner.updateNode(nodeId, patch);
      const sortedKeys = Object.keys(patch).sort().join(',');
      push({
        do: async () => {
          await inner.updateNode(nodeId, patch);
        },
        // Closure-captures `before` directly: design §3 settles on the
        // simpler closure because distinct touched-field sets land in
        // DIFFERENT coalesce slots (the sortedKeys suffix below), so two
        // entries with the SAME key necessarily snapshot the SAME field
        // set — `applyPush`'s field-by-field merge is then equivalent to
        // keeping the older `before` wholesale.
        undo: async () => {
          await inner.updateNode(nodeId, before);
        },
        coalesceKey: `update:${nodeId}:${sortedKeys}`,
        beforeFields: before as Record<string, unknown>,
      });
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

    deleteNode: async (nodeId: string): Promise<void> => {
      beginIntercept();
      const { nodes, connectors } = getFlowState();
      const savedNode = nodes.find((n) => n.id === nodeId);
      // No snapshot to invert against — mirror the other passthrough
      // branches and forward without pushing. The inner adapter still
      // runs (the host may have a stricter idea of "live" than the
      // wrapper's getFlowState snapshot — e.g. a stale id the server
      // can still resolve).
      if (!savedNode) {
        await inner.deleteNode(nodeId);
        return;
      }
      // Capture EVERY connector touching the node, in the order the host
      // surfaces them. Insertion order matters: the studio derives
      // connector z-order from list position, so the undo must replay
      // them in the same sequence to keep visual stacking stable.
      const cascadedConnectors = connectors.filter(
        (c) => c.source === nodeId || c.target === nodeId,
      );
      await inner.deleteNode(nodeId);
      push({
        // Delete is a full-replacement operation — no `beforeFields`
        // snapshot, no coalesceKey. Two deletes of the same id within
        // 500ms is not a meaningful "burst" the way a style toggle is.
        do: async () => {
          await inner.deleteNode(nodeId);
        },
        undo: async () => {
          // Node restore is the priority: if THIS fails, the undo
          // failed and we MUST surface the error (callers rely on the
          // rejection to roll back UI state).
          await inner.createNode({
            id: savedNode.id,
            type: savedNode.type,
            position: savedNode.position,
            data: (savedNode.data ?? {}) as Record<string, unknown>,
          });
          // Cascade-restore every connector. Per-connector failures are
          // swallowed (and surfaced via console.warn) — design §2 calls
          // out that snapshots come from live state and carry the same
          // risk profile as today; one broken connector should NOT tank
          // the entire restore. Insertion order is preserved by the
          // sequential for-loop.
          for (const c of cascadedConnectors) {
            try {
              await inner.createConnector({
                id: c.id,
                source: c.source,
                target: c.target,
                sourceHandle: c.sourceHandle,
                targetHandle: c.targetHandle,
                sourceHandleAutoPicked: c.sourceHandleAutoPicked,
                targetHandleAutoPicked: c.targetHandleAutoPicked,
                sourcePin: c.sourcePin,
                targetPin: c.targetPin,
                label: c.label,
                style: c.style,
                color: c.color,
                direction: c.direction,
                eventName: c.eventName,
                queueName: c.queueName,
                method: c.method,
                url: c.url,
              });
            } catch (err) {
              console.warn(
                `[seeflow/canvas] failed to restore connector ${c.id} during deleteNode undo:`,
                err,
              );
            }
          }
        },
      });
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
