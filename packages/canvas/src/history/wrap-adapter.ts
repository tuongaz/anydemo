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
    createNode: async (input: NodeCreateInput) => {
      beginIntercept();
      const result = await inner.createNode(input);
      // Use the RETURNED id (not `input.id`) so the inverse delete + a
      // redo's recreate both reference the same id the server assigned.
      // Threading `{...input, id: result.id}` on redo keeps the entity at
      // the same id across create→undo→redo chains, so any later entries
      // that captured the original id still resolve.
      push({
        do: async () => {
          await inner.createNode({ ...input, id: result.id });
        },
        undo: async () => {
          await inner.deleteNode(result.id);
        },
      });
      return result;
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

    reorderNode: async (nodeId: string, op: ReorderOp): Promise<void> => {
      beginIntercept();
      const { nodes } = getFlowState();
      const priorIndex = nodes.findIndex((n) => n.id === nodeId);
      // No snapshot to invert against — mirror the other passthrough
      // branches and forward without pushing. Skipping a push is safe
      // because the inner adapter still runs; the wrapper just can't
      // construct a meaningful inverse without the prior index.
      if (priorIndex < 0) {
        await inner.reorderNode(nodeId, op);
        return;
      }
      await inner.reorderNode(nodeId, op);
      // No coalesce: reorder bursts are rare and visually obvious, so
      // discrete per-click entries are the right UX. No beforeFields:
      // reorder is a positional rewrite (no key set to merge).
      push({
        do: async () => {
          await inner.reorderNode(nodeId, op);
        },
        undo: async () => {
          await inner.reorderNode(nodeId, { op: 'toIndex', index: priorIndex });
        },
      });
    },

    createConnector: async (input: ConnectorCreateInput) => {
      beginIntercept();
      const result = await inner.createConnector(input);
      // Same shape as createNode: redo recreates with the server-assigned
      // id so the entity lives at a stable id across create→undo→redo.
      push({
        do: async () => {
          await inner.createConnector({ ...input, id: result.id });
        },
        undo: async () => {
          await inner.deleteConnector(result.id);
        },
      });
      return result;
    },

    updateConnector: async (connectorId: string, patch: ConnectorPatch): Promise<void> => {
      beginIntercept();
      const { connectors } = getFlowState();
      const connector = connectors.find((c) => c.id === connectorId);
      // No snapshot to invert against (stale id, race, or the host stripped
      // the connector before the adapter call landed). Mirror the
      // `updateNode` skip-push-silently behaviour rather than guess at the
      // prior state.
      if (!connector) {
        await inner.updateConnector(connectorId, patch);
        return;
      }
      // Snapshot ONLY the keys the patch touches. Every `ConnectorPatch`
      // field lives at the top level of the `Connector` (no nested `data`
      // bag the way nodes have), so the read is a direct property lookup
      // off the saved connector. When a key isn't set on the connector,
      // `before[k] = undefined`; passing `{k: undefined}` back to
      // inner.updateConnector mirrors the post-clear state for the happy
      // paths the studio adapter handles today.
      const before: ConnectorPatch = {};
      const source = connector as unknown as Record<string, unknown>;
      for (const key of Object.keys(patch) as (keyof ConnectorPatch)[]) {
        (before as Record<string, unknown>)[key] = source[key as string];
      }
      await inner.updateConnector(connectorId, patch);
      const sortedKeys = Object.keys(patch).sort().join(',');
      push({
        do: async () => {
          await inner.updateConnector(connectorId, patch);
        },
        // Closure-captures `before` directly: same reasoning as `updateNode`.
        // Distinct touched-field sets land in DIFFERENT coalesce slots (the
        // sortedKeys suffix below), so two entries that DO share a key
        // necessarily snapshot the SAME field set — `applyPush`'s
        // field-by-field merge is then equivalent to keeping the older
        // `before` wholesale.
        undo: async () => {
          await inner.updateConnector(connectorId, before);
        },
        coalesceKey: `update:conn:${connectorId}:${sortedKeys}`,
        beforeFields: before as Record<string, unknown>,
      });
    },

    deleteConnector: async (connectorId: string): Promise<void> => {
      beginIntercept();
      const { connectors } = getFlowState();
      const saved = connectors.find((c) => c.id === connectorId);
      // No snapshot to invert against — mirror the other passthrough
      // branches and forward without pushing. The inner adapter still
      // runs (the host may have a stricter idea of "live" than the
      // wrapper's getFlowState snapshot — e.g. a stale id the server
      // can still resolve).
      if (!saved) {
        await inner.deleteConnector(connectorId);
        return;
      }
      await inner.deleteConnector(connectorId);
      // Delete is a full-replacement operation — no `beforeFields`
      // snapshot, no coalesceKey. Two deletes of the same id within
      // 500ms is not a meaningful "burst".
      push({
        do: async () => {
          await inner.deleteConnector(connectorId);
        },
        undo: async () => {
          // Thread EVERY field of the saved connector through so the undo
          // is a faithful restoration: id (so subsequent entries that
          // captured the original id still resolve), source/target (the
          // structural identity), and every optional field the connector
          // carried (handles, pins, label, style, etc.).
          await inner.createConnector({
            id: saved.id,
            source: saved.source,
            target: saved.target,
            sourceHandle: saved.sourceHandle,
            targetHandle: saved.targetHandle,
            sourceHandleAutoPicked: saved.sourceHandleAutoPicked,
            targetHandleAutoPicked: saved.targetHandleAutoPicked,
            sourcePin: saved.sourcePin,
            targetPin: saved.targetPin,
            label: saved.label,
            style: saved.style,
            color: saved.color,
            direction: saved.direction,
            eventName: saved.eventName,
            queueName: saved.queueName,
            method: saved.method,
            url: saved.url,
          });
        },
      });
    },

    /**
     * Passthrough — no undo entry. The undo for an image insert lives on
     * the paired `createNode` entry inside a host-side `history.batch(
     * 'insert-image', ...)` (design §2): undoing the batch deletes the
     * node, and the backend cascades the file. Calling `uploadImage`
     * standalone orphans the file; the wrapper has no inverse to push
     * because `CanvasAdapter` exposes no `deleteFile` method.
     */
    uploadImage: (nodeId: string, file: File, filename: string): Promise<UploadImageResult> => {
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
