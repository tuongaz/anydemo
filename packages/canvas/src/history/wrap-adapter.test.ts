import { describe, expect, it } from 'bun:test';
import type {
  CanvasAdapter,
  ConnectorCreateInput,
  ConnectorPatch,
  ReorderOp,
} from '../adapter/types.ts';
import type { Connector, FlowNode } from '../types.ts';
import type { GetFlowState } from './types.ts';
import { wrapAdapterWithHistory } from './wrap-adapter.ts';

interface FakeAdapter extends CanvasAdapter {
  calls: string[];
  /**
   * Rich record of every createConnector input so order/id assertions can
   * inspect more than just the call name (Task 11 needs the input shape to
   * verify cascade restore preserves insertion order + original ids).
   */
  createConnectorCalls: ConnectorCreateInput[];
  /**
   * Rich record of every updateConnector call so Task 13 tests can assert
   * the exact `{id, patch}` shape the wrapper threads through on undo
   * (touched-key patches; raw equality on the patch object).
   */
  updateConnectorCalls: Array<{ id: string; patch: ConnectorPatch }>;
  /**
   * Rich record of every reorderNode call so Task 13 tests can assert the
   * inverse `{op: 'toIndex', index}` shape the wrapper sends on undo.
   */
  reorderNodeCalls: Array<{ id: string; op: ReorderOp }>;
}

/**
 * Deterministic in-memory adapter that records every call into `calls`
 * (no side effects). The mutating methods return shapes that satisfy
 * `CanvasAdapter` but never touch real state — the wrapper only cares
 * about call ordering and snapshot/inverse correctness.
 */
const fakeAdapter = (): FakeAdapter => {
  const calls: string[] = [];
  const createConnectorCalls: ConnectorCreateInput[] = [];
  const updateConnectorCalls: Array<{ id: string; patch: ConnectorPatch }> = [];
  const reorderNodeCalls: Array<{ id: string; op: ReorderOp }> = [];
  return {
    calls,
    createConnectorCalls,
    updateConnectorCalls,
    reorderNodeCalls,
    createNode: async (input) => {
      calls.push(`createNode:${input.id ?? 'n-?'}:${input.type}`);
      return { id: input.id ?? 'n-1', node: {} };
    },
    updateNode: async (id, patch) => {
      calls.push(`updateNode:${id}:${JSON.stringify(patch)}`);
    },
    updateNodePosition: async (id, pos) => {
      calls.push(`pos:${id}:${pos.x},${pos.y}`);
      return { ok: true, position: pos };
    },
    deleteNode: async (id) => {
      calls.push(`del:${id}`);
    },
    reorderNode: async (id, op) => {
      reorderNodeCalls.push({ id, op });
      calls.push(`reorder:${id}:${JSON.stringify(op)}`);
    },
    createConnector: async (input) => {
      createConnectorCalls.push(input);
      calls.push(`createConn:${input.id ?? 'c-?'}:${input.source}->${input.target}`);
      return { id: input.id ?? 'c-1' };
    },
    updateConnector: async (id, patch) => {
      updateConnectorCalls.push({ id, patch });
      calls.push(`updateConn:${id}:${JSON.stringify(patch)}`);
    },
    deleteConnector: async (id) => {
      calls.push(`delConn:${id}`);
    },
    uploadImage: async () => ({ path: '' }),
  };
};

const noState: GetFlowState = () => ({ nodes: [], connectors: [] });

const stateWithNode = (id: string, pos: { x: number; y: number }): GetFlowState => {
  // The wrapper only reads `id` + `position`; cast through unknown to keep
  // TS happy without constructing a full discriminated-union FlowNode.
  const node = {
    id,
    type: 'rectangle' as const,
    position: pos,
    data: {},
  } as unknown as FlowNode;
  return () => ({ nodes: [node], connectors: [] });
};

/**
 * Build a `GetFlowState` whose single node has the supplied `data` fields
 * (`borderColor`, `borderSize`, …). The wrapper's `updateNode` path reads
 * these for the per-key `before` snapshot.
 */
const stateWithNodeData = (
  id: string,
  pos: { x: number; y: number },
  data: Record<string, unknown>,
): GetFlowState => {
  const node = {
    id,
    type: 'rectangle' as const,
    position: pos,
    data,
  } as unknown as FlowNode;
  return () => ({ nodes: [node], connectors: [] });
};

/**
 * Build a `GetFlowState` with the supplied node + connectors. Used by the
 * deleteNode cascade-restore tests: the wrapper snapshots the node AND
 * every connector that touches it at intercept time, so the test fixture
 * must surface both.
 */
const stateWithNodeAndConnectors = (
  node: FlowNode,
  connectors: readonly Connector[],
): GetFlowState => {
  return () => ({ nodes: [node], connectors });
};

describe('wrapAdapterWithHistory', () => {
  it('forwards every adapter call to the underlying adapter', async () => {
    const inner = fakeAdapter();
    const { adapter } = wrapAdapterWithHistory(inner, stateWithNode('n-1', { x: 0, y: 0 }));
    await adapter.updateNodePosition('n-1', { x: 1, y: 2 });
    expect(inner.calls).toEqual(['pos:n-1:1,2']);
  });

  it('records canUndo=true after a successful updateNodePosition', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNode('n-1', { x: 0, y: 0 }),
    );
    expect(history.canUndo).toBe(false);
    await adapter.updateNodePosition('n-1', { x: 1, y: 2 });
    expect(history.canUndo).toBe(true);
  });

  it('does NOT push an entry when the adapter rejects', async () => {
    const inner = fakeAdapter();
    inner.updateNodePosition = async () => {
      throw new Error('boom');
    };
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNode('n-1', { x: 0, y: 0 }),
    );
    await adapter.updateNodePosition('n-1', { x: 1, y: 2 }).catch(() => {});
    expect(history.canUndo).toBe(false);
  });

  it('synchronously truncates the redo branch BEFORE the await', async () => {
    // Seed the wrapper with one entry + one undo (cursor at 0, redo branch
    // of length 1). Then start a fresh updateNodePosition whose inner call
    // is held by a manual deferred — synchronously after invocation the
    // redo branch must be gone (proves truncation happens BEFORE the await
    // yields).
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNode('n-1', { x: 0, y: 0 }),
    );

    await adapter.updateNodePosition('n-1', { x: 5, y: 5 });
    await history.undo();
    expect(history.canRedo).toBe(true);

    // Manual deferred: hold the inner call so the wrapper's await can't
    // proceed past beginIntercept().
    let release: (v: { ok: boolean; position: { x: number; y: number } }) => void = () => {};
    inner.updateNodePosition = (_id, pos) =>
      new Promise((resolve) => {
        release = resolve;
      }).then(() => ({ ok: true, position: pos }));

    const pending = adapter.updateNodePosition('n-1', { x: 9, y: 9 });
    // Synchronous assertion: truncation must have already happened.
    expect(history.canRedo).toBe(false);

    release({ ok: true, position: { x: 9, y: 9 } });
    await pending;
  });

  it('undo() calls inner.updateNodePosition with the prior position', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNode('n-1', { x: 0, y: 0 }),
    );
    await adapter.updateNodePosition('n-1', { x: 10, y: 20 });
    inner.calls.length = 0;
    await history.undo();
    expect(inner.calls).toEqual(['pos:n-1:0,0']);
  });

  it('redo() calls inner.updateNodePosition with the new position', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNode('n-1', { x: 0, y: 0 }),
    );
    await adapter.updateNodePosition('n-1', { x: 10, y: 20 });
    await history.undo();
    inner.calls.length = 0;
    await history.redo();
    expect(inner.calls).toEqual(['pos:n-1:10,20']);
  });

  it('concurrent undo() calls queue and do not race on the cursor', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNode('n-1', { x: 0, y: 0 }),
    );
    // Two non-coalescing pushes: stamp them >COALESCE_WINDOW apart by
    // using two adapter calls separated by a microtask-level wait that
    // advances Date.now-perceived time. The simplest way to defeat
    // coalescing here is to use DIFFERENT ids (different coalesce keys).
    const innerWith2: FakeAdapter = fakeAdapter();
    const { adapter: a2, history: h2 } = wrapAdapterWithHistory(innerWith2, () => ({
      nodes: [
        { id: 'a', type: 'rectangle', position: { x: 0, y: 0 }, data: {} } as unknown as FlowNode,
        { id: 'b', type: 'rectangle', position: { x: 0, y: 0 }, data: {} } as unknown as FlowNode,
      ],
      connectors: [],
    }));
    await a2.updateNodePosition('a', { x: 1, y: 1 });
    await a2.updateNodePosition('b', { x: 2, y: 2 });
    innerWith2.calls.length = 0;

    // Fire two undos without awaiting between them.
    const p1 = h2.undo();
    const p2 = h2.undo();
    await Promise.all([p1, p2]);

    // Inverses must run in LIFO order: undo top first (b → 0,0), then a → 0,0.
    expect(innerWith2.calls).toEqual(['pos:b:0,0', 'pos:a:0,0']);
    expect(h2.canUndo).toBe(false);
    expect(h2.canRedo).toBe(true);
    // Silence the unused-binding linter — `adapter` + `inner` above are
    // intentionally a separate setup verifying single-handle invariants.
    expect(adapter).toBeDefined();
    expect(inner.calls).toBeDefined();
  });

  it('clear() empties the stack', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNode('n-1', { x: 0, y: 0 }),
    );
    await adapter.updateNodePosition('n-1', { x: 1, y: 2 });
    expect(history.canUndo).toBe(true);
    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  // markExternalChange + stale-window test deferred to Task 16. The reducer
  // (`applyStaleClear`) is already pinned in stack.test.ts and the wrapper
  // forwards to it directly; injecting a fake clock through the wrapper
  // requires the broader test plumbing that Task 16 introduces.

  // --------------------------------------------------------------------
  // Task 10: updateNode + coalesce-burst tests
  // --------------------------------------------------------------------

  it('updateNode pushes an entry whose undo reverts the touched keys', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNodeData('n-1', { x: 0, y: 0 }, { borderColor: 'gray', borderSize: 2 }),
    );
    await adapter.updateNode('n-1', { borderColor: 'white' });
    inner.calls.length = 0;
    await history.undo();
    // Inverse touches ONLY borderColor — borderSize is not in the patch.
    expect(inner.calls).toEqual([`updateNode:n-1:${JSON.stringify({ borderColor: 'gray' })}`]);
  });

  it('updateNode undo sends null (not undefined) to clear a previously-unset style key', async () => {
    const inner = fakeAdapter();
    // Node has NO backgroundColor — the style edit adds it. The inverse must
    // send `null` so the studio strips the key (reverting to the unset
    // default); an `undefined` would be dropped by JSON and leave the field
    // at its post-edit value (undo no-op). Regression for the style-undo bug.
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNodeData('n-1', { x: 0, y: 0 }, { borderColor: 'green' }),
    );
    await adapter.updateNode('n-1', { borderColor: 'red', backgroundColor: 'red' });
    inner.calls.length = 0;
    await history.undo();
    // borderColor reverts to its prior value; backgroundColor clears via null.
    expect(inner.calls).toEqual([
      `updateNode:n-1:${JSON.stringify({ borderColor: 'green', backgroundColor: null })}`,
    ]);
  });

  it('updateNode undo of a first-time linkflow target sends { target: null }', async () => {
    // US-004: target is in the NULL_CLEARS_NODE_KEY set so undo of the
    // initial pick clears `data.target` back to unset on the server. Without
    // the null mapping, undo would PATCH `{ target: undefined }` which JSON
    // drops, and `data.target` would persist (undo no-op).
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNodeData('n-1', { x: 0, y: 0 }, {}),
    );
    await adapter.updateNode('n-1', { target: { project: 'docs', flow: 'index' } });
    inner.calls.length = 0;
    await history.undo();
    expect(inner.calls).toEqual([`updateNode:n-1:${JSON.stringify({ target: null })}`]);
  });

  it('updateNode coalesce key includes sorted touched-field names', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNodeData('n-1', { x: 0, y: 0 }, { borderColor: 'gray', borderSize: 2 }),
    );
    // Two rapid patches touching DIFFERENT fields → different coalesce keys
    // (`update:n-1:borderColor` vs `update:n-1:borderSize`), so they land in
    // two distinct stack entries. This is exactly the Phase-1 style-burst
    // regression we want to prevent at the architecture layer.
    await adapter.updateNode('n-1', { borderColor: 'white' });
    await adapter.updateNode('n-1', { borderSize: 4 });
    inner.calls.length = 0;

    // First undo reverts the LAST patch only (borderSize back to 2).
    await history.undo();
    expect(inner.calls).toEqual([`updateNode:n-1:${JSON.stringify({ borderSize: 2 })}`]);

    inner.calls.length = 0;
    // Second undo reverts the FIRST patch (borderColor back to gray).
    await history.undo();
    expect(inner.calls).toEqual([`updateNode:n-1:${JSON.stringify({ borderColor: 'gray' })}`]);
    expect(history.canUndo).toBe(false);
  });

  it('updateNode coalesces same touched-field set within the window', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNodeData('n-1', { x: 0, y: 0 }, { borderColor: 'gray' }),
    );
    // Same touched field across two patches → same coalesce key → merged.
    // The merged entry must keep the OLDEST `undo` (closure over 'gray')
    // so a single undo reverts to the pre-burst state, not just the
    // intermediate 'white'.
    await adapter.updateNode('n-1', { borderColor: 'white' });
    await adapter.updateNode('n-1', { borderColor: 'red' });
    inner.calls.length = 0;

    await history.undo();
    expect(inner.calls).toEqual([`updateNode:n-1:${JSON.stringify({ borderColor: 'gray' })}`]);
    expect(history.canUndo).toBe(false);
  });

  it('updateNodePosition coalesces per id within the window', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNode('n-1', { x: 0, y: 0 }),
    );
    // Two rapid position updates for the SAME node → coalesce on `pos:n-1`
    // → single stack entry. The merged undo closes over the FIRST starting
    // position (0,0), not the intermediate (5,5).
    await adapter.updateNodePosition('n-1', { x: 5, y: 5 });
    await adapter.updateNodePosition('n-1', { x: 10, y: 10 });
    inner.calls.length = 0;

    await history.undo();
    expect(inner.calls).toEqual(['pos:n-1:0,0']);
    expect(history.canUndo).toBe(false);
  });

  it('updateNodePosition does NOT coalesce across distinct node ids', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(inner, () => ({
      nodes: [
        { id: 'a', type: 'rectangle', position: { x: 0, y: 0 }, data: {} } as unknown as FlowNode,
        { id: 'b', type: 'rectangle', position: { x: 0, y: 0 }, data: {} } as unknown as FlowNode,
      ],
      connectors: [],
    }));
    // Burst across A then B → different coalesce keys per id → the stack
    // ends with one entry per node (not one merged entry that mixes both).
    // We intentionally do NOT alternate: coalesce only checks the TOP of
    // the stack, so an A→B→A→B sequence would yield FOUR entries (a
    // separate concern). Per-id-bursting is the case this pins.
    await adapter.updateNodePosition('a', { x: 1, y: 1 });
    await adapter.updateNodePosition('a', { x: 2, y: 2 });
    await adapter.updateNodePosition('b', { x: 3, y: 3 });
    await adapter.updateNodePosition('b', { x: 4, y: 4 });
    inner.calls.length = 0;

    // Stack: [a(merged: redo→2,2 / undo→0,0), b(merged: redo→4,4 / undo→0,0)].
    // Two undos in LIFO order revert b first, then a.
    await history.undo();
    await history.undo();
    expect(inner.calls).toEqual(['pos:b:0,0', 'pos:a:0,0']);
    expect(history.canUndo).toBe(false);
  });

  // --------------------------------------------------------------------
  // Task 11: deleteNode + cascade-connector restore
  // --------------------------------------------------------------------

  it('deleteNode undo recreates the node with the original id, type, position, and data', async () => {
    const inner = fakeAdapter();
    const node = {
      id: 'n-1',
      type: 'rectangle' as const,
      position: { x: 42, y: 99 },
      data: { name: 'hello', borderColor: 'blue', borderSize: 3 },
    } as unknown as FlowNode;
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNodeAndConnectors(node, []),
    );

    await adapter.deleteNode('n-1');
    expect(inner.calls).toEqual(['del:n-1']);

    inner.calls.length = 0;
    await history.undo();

    // First call must be a createNode that reuses the original id+type so
    // subsequent undos in the same chain still resolve against the same node.
    expect(inner.calls[0]).toBe('createNode:n-1:rectangle');
    // The wrapper threads the full FlowNode through (position + data
    // verbatim). Easier to assert via the input observed at the inner
    // adapter: read the last createNode invocation manually via the
    // calls-array shape we control. The fake adapter only records a
    // summary string, so we instead instrument by re-running with a
    // patched inner.createNode that captures input.
  });

  it('deleteNode undo threads the original FlowNode (position + data) through createNode', async () => {
    const inner = fakeAdapter();
    const captured: Array<{ id?: string; type: string; position: unknown; data: unknown }> = [];
    inner.createNode = async (input) => {
      captured.push({
        id: input.id,
        type: input.type,
        position: input.position,
        data: input.data,
      });
      return { id: input.id ?? 'n-1', node: {} };
    };
    const node = {
      id: 'n-1',
      type: 'rectangle' as const,
      position: { x: 42, y: 99 },
      data: { name: 'hello', borderColor: 'blue', borderSize: 3 },
    } as unknown as FlowNode;
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNodeAndConnectors(node, []),
    );

    await adapter.deleteNode('n-1');
    await history.undo();

    expect(captured).toEqual([
      {
        id: 'n-1',
        type: 'rectangle',
        position: { x: 42, y: 99 },
        data: { name: 'hello', borderColor: 'blue', borderSize: 3 },
      },
    ]);
  });

  it('deleteNode undo recreates every connector touching the deleted node', async () => {
    const inner = fakeAdapter();
    const node = {
      id: 'n-1',
      type: 'rectangle' as const,
      position: { x: 0, y: 0 },
      data: {},
    } as unknown as FlowNode;
    const connectors: Connector[] = [
      // Outgoing: n-1 is source.
      { id: 'c-out', source: 'n-1', target: 'n-2', label: 'outgoing' },
      // Incoming: n-1 is target.
      { id: 'c-in', source: 'n-0', target: 'n-1', label: 'incoming' },
      // Unrelated connector — must NOT be replayed by undo.
      { id: 'c-other', source: 'n-9', target: 'n-8' },
    ];
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNodeAndConnectors(node, connectors),
    );

    await adapter.deleteNode('n-1');
    inner.calls.length = 0;
    inner.createConnectorCalls.length = 0;
    await history.undo();

    // createNode first, then each cascaded connector via createConnector.
    const createConnIds = inner.createConnectorCalls.map((c) => c.id);
    expect(createConnIds).toEqual(['c-out', 'c-in']);
    // Unrelated connector was never recreated.
    expect(createConnIds).not.toContain('c-other');
  });

  it('deleteNode undo preserves connector insertion order', async () => {
    const inner = fakeAdapter();
    const node = {
      id: 'n-1',
      type: 'rectangle' as const,
      position: { x: 0, y: 0 },
      data: {},
    } as unknown as FlowNode;
    // Three connectors, all touching n-1, in a SPECIFIC order. The undo
    // must replay createConnector in this exact order so the studio's
    // insertion-order-derived z-order semantics are preserved.
    const connectors: Connector[] = [
      { id: 'c-alpha', source: 'n-1', target: 'n-2' },
      { id: 'c-beta', source: 'n-3', target: 'n-1' },
      { id: 'c-gamma', source: 'n-1', target: 'n-4' },
    ];
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNodeAndConnectors(node, connectors),
    );

    await adapter.deleteNode('n-1');
    inner.createConnectorCalls.length = 0;
    await history.undo();

    expect(inner.createConnectorCalls.map((c) => c.id)).toEqual(['c-alpha', 'c-beta', 'c-gamma']);
  });

  it('deleteNode without snapshotted state passes through silently', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(inner, noState);

    await adapter.deleteNode('missing-id');

    // Inner still received the call — the wrapper never blocks a delete
    // just because the host's live state didn't surface the node (race /
    // stale id).
    expect(inner.calls).toEqual(['del:missing-id']);
    // No push, so nothing to undo.
    expect(history.canUndo).toBe(false);
  });

  it('deleteNode redo replays the delete', async () => {
    const inner = fakeAdapter();
    const node = {
      id: 'n-1',
      type: 'rectangle' as const,
      position: { x: 0, y: 0 },
      data: {},
    } as unknown as FlowNode;
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNodeAndConnectors(node, []),
    );

    await adapter.deleteNode('n-1');
    await history.undo();
    inner.calls.length = 0;
    await history.redo();

    // Redo runs the original delete again.
    expect(inner.calls).toEqual(['del:n-1']);
  });

  it('deleteNode undo swallows per-connector restoration failures', async () => {
    const inner = fakeAdapter();
    const node = {
      id: 'n-1',
      type: 'rectangle' as const,
      position: { x: 0, y: 0 },
      data: {},
    } as unknown as FlowNode;
    const connectors: Connector[] = [
      { id: 'c-ok-1', source: 'n-1', target: 'n-2' },
      { id: 'c-doomed', source: 'n-1', target: 'n-3' },
      { id: 'c-ok-2', source: 'n-1', target: 'n-4' },
    ];
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNodeAndConnectors(node, connectors),
    );

    await adapter.deleteNode('n-1');

    // Patch createConnector to reject for the doomed id only. This mimics
    // the design's "snapshot from live state, same risk profile as today"
    // failure mode where one cascaded connector now references a
    // separately-deleted node.
    const allInputs: ConnectorCreateInput[] = [];
    inner.createConnector = async (input) => {
      allInputs.push(input);
      if (input.id === 'c-doomed') throw new Error('target n-3 missing');
      return { id: input.id ?? 'c-?' };
    };

    // Spy on console.warn so we can assert the failure was logged (and
    // also restore it on the way out so other tests in the file aren't
    // affected).
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    try {
      // Undo must RESOLVE — not reject — even though one cascaded
      // connector recreate fails. The node-restore is the priority.
      await history.undo();
    } finally {
      console.warn = originalWarn;
    }

    // All three were attempted, in insertion order.
    expect(allInputs.map((c) => c.id)).toEqual(['c-ok-1', 'c-doomed', 'c-ok-2']);
    // The failure surfaced through console.warn rather than as a
    // rejection.
    expect(warnings.length).toBe(1);
  });

  // --------------------------------------------------------------------
  // Task 12: createNode + createConnector
  // --------------------------------------------------------------------

  it('createNode undo deletes the just-created node by returned id', async () => {
    const inner = fakeAdapter();
    // Override createNode so the returned id is independent of any input.id,
    // proving the wrapper uses the RETURNED id (not the input's optional id)
    // for the inverse delete.
    inner.createNode = async (input) => {
      inner.calls.push(`createNode:${input.id ?? 'n-?'}:${input.type}`);
      return { id: 'n-42', node: {} };
    };
    const { adapter, history } = wrapAdapterWithHistory(inner, noState);

    await adapter.createNode({ type: 'rectangle', position: { x: 0, y: 0 }, data: {} });
    inner.calls.length = 0;
    await history.undo();

    expect(inner.calls).toEqual(['del:n-42']);
  });

  it('createNode redo recreates with the original returned id', async () => {
    const inner = fakeAdapter();
    inner.createNode = async (input) => {
      inner.calls.push(`createNode:${input.id ?? 'n-?'}:${input.type}`);
      return { id: 'n-42', node: {} };
    };
    const { adapter, history } = wrapAdapterWithHistory(inner, noState);

    await adapter.createNode({ type: 'rectangle', position: { x: 0, y: 0 }, data: {} });
    await history.undo();
    inner.calls.length = 0;
    await history.redo();

    // The second createNode receives id='n-42' so the redo lands at the
    // same id any downstream entry may still reference.
    expect(inner.calls).toEqual(['createNode:n-42:rectangle']);
  });

  it('createConnector undo deletes the just-created connector by returned id', async () => {
    const inner = fakeAdapter();
    inner.createConnector = async (input) => {
      inner.createConnectorCalls.push(input);
      inner.calls.push(`createConn:${input.id ?? 'c-?'}:${input.source}->${input.target}`);
      return { id: 'c-42' };
    };
    const { adapter, history } = wrapAdapterWithHistory(inner, noState);

    await adapter.createConnector({ source: 'n-1', target: 'n-2' });
    inner.calls.length = 0;
    await history.undo();

    expect(inner.calls).toEqual(['delConn:c-42']);
  });

  it('createConnector redo recreates with the original returned id', async () => {
    const inner = fakeAdapter();
    inner.createConnector = async (input) => {
      inner.createConnectorCalls.push(input);
      inner.calls.push(`createConn:${input.id ?? 'c-?'}:${input.source}->${input.target}`);
      return { id: 'c-42' };
    };
    const { adapter, history } = wrapAdapterWithHistory(inner, noState);

    await adapter.createConnector({ source: 'n-1', target: 'n-2' });
    await history.undo();
    inner.calls.length = 0;
    await history.redo();

    expect(inner.calls).toEqual(['createConn:c-42:n-1->n-2']);
  });

  it('createNode failure does not push an entry', async () => {
    const inner = fakeAdapter();
    inner.createNode = async () => {
      throw new Error('boom');
    };
    const { adapter, history } = wrapAdapterWithHistory(inner, noState);

    await adapter
      .createNode({ type: 'rectangle', position: { x: 0, y: 0 }, data: {} })
      .catch(() => {});

    expect(history.canUndo).toBe(false);
  });

  // --------------------------------------------------------------------
  // Task 13: updateConnector + deleteConnector + reorderNode
  // --------------------------------------------------------------------

  it('updateConnector undo reverts the touched keys', async () => {
    const inner = fakeAdapter();
    const connectors: Connector[] = [
      { id: 'c-1', source: 'n-1', target: 'n-2', label: 'A', color: 'blue' },
    ];
    const { adapter, history } = wrapAdapterWithHistory(inner, () => ({
      nodes: [],
      connectors,
    }));

    await adapter.updateConnector('c-1', { label: 'B' });
    inner.updateConnectorCalls.length = 0;
    await history.undo();

    // Inverse touches ONLY the `label` key — `color` is untouched.
    expect(inner.updateConnectorCalls).toEqual([{ id: 'c-1', patch: { label: 'A' } }]);
  });

  it('updateConnector coalesces same touched-field set within the window', async () => {
    const inner = fakeAdapter();
    const connectors: Connector[] = [{ id: 'c-1', source: 'n-1', target: 'n-2', label: 'A' }];
    const { adapter, history } = wrapAdapterWithHistory(inner, () => ({
      nodes: [],
      connectors,
    }));
    // Two rapid label edits → same coalesce key → single merged entry.
    // The merged undo must restore to the ORIGINAL 'A', not the
    // intermediate 'B'.
    await adapter.updateConnector('c-1', { label: 'B' });
    await adapter.updateConnector('c-1', { label: 'C' });
    inner.updateConnectorCalls.length = 0;

    await history.undo();
    expect(inner.updateConnectorCalls).toEqual([{ id: 'c-1', patch: { label: 'A' } }]);
    expect(history.canUndo).toBe(false);
  });

  it('updateConnector coalesce key includes sorted touched-field names', async () => {
    const inner = fakeAdapter();
    const connectors: Connector[] = [
      { id: 'c-1', source: 'n-1', target: 'n-2', label: 'A', color: 'blue' },
    ];
    const { adapter, history } = wrapAdapterWithHistory(inner, () => ({
      nodes: [],
      connectors,
    }));
    // Two rapid patches touching DIFFERENT fields → different coalesce
    // keys → two distinct stack entries (mirrors Phase-1 style-burst fix).
    await adapter.updateConnector('c-1', { label: 'B' });
    await adapter.updateConnector('c-1', { color: 'red' });
    inner.updateConnectorCalls.length = 0;

    // First undo reverts the last patch only (color back to blue).
    await history.undo();
    expect(inner.updateConnectorCalls).toEqual([{ id: 'c-1', patch: { color: 'blue' } }]);

    inner.updateConnectorCalls.length = 0;
    // Second undo reverts the first patch (label back to A).
    await history.undo();
    expect(inner.updateConnectorCalls).toEqual([{ id: 'c-1', patch: { label: 'A' } }]);
    expect(history.canUndo).toBe(false);
  });

  it('deleteConnector undo recreates the connector with the original id and fields', async () => {
    const inner = fakeAdapter();
    const richConnector: Connector = {
      id: 'c-1',
      source: 'n-1',
      target: 'n-2',
      sourceHandle: 'r',
      targetHandle: 'l',
      label: 'hello',
      style: 'dashed',
      color: 'red',
      direction: 'both',
      borderSize: 3,
    };
    const { adapter, history } = wrapAdapterWithHistory(inner, () => ({
      nodes: [],
      connectors: [richConnector],
    }));

    await adapter.deleteConnector('c-1');
    expect(inner.calls).toEqual(['delConn:c-1']);

    inner.createConnectorCalls.length = 0;
    await history.undo();

    // The recreated connector preserves the original id + every field.
    expect(inner.createConnectorCalls).toHaveLength(1);
    const recreated = inner.createConnectorCalls[0];
    expect(recreated?.id).toBe('c-1');
    expect(recreated?.source).toBe('n-1');
    expect(recreated?.target).toBe('n-2');
    expect(recreated?.sourceHandle).toBe('r');
    expect(recreated?.targetHandle).toBe('l');
    expect(recreated?.label).toBe('hello');
    expect(recreated?.style).toBe('dashed');
    expect(recreated?.color).toBe('red');
    expect(recreated?.direction).toBe('both');
  });

  it('deleteConnector without snapshotted state passes through silently', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(inner, noState);

    await adapter.deleteConnector('missing-id');

    // Inner still received the call; no push.
    expect(inner.calls).toEqual(['delConn:missing-id']);
    expect(history.canUndo).toBe(false);
  });

  it('reorderNode undo moves the node back to its prior index', async () => {
    const inner = fakeAdapter();
    const nodes: FlowNode[] = [
      { id: 'a', type: 'rectangle', position: { x: 0, y: 0 }, data: {} } as unknown as FlowNode,
      { id: 'b', type: 'rectangle', position: { x: 0, y: 0 }, data: {} } as unknown as FlowNode,
      { id: 'c', type: 'rectangle', position: { x: 0, y: 0 }, data: {} } as unknown as FlowNode,
    ];
    const { adapter, history } = wrapAdapterWithHistory(inner, () => ({
      nodes,
      connectors: [],
    }));

    // 'c' is at index 2 (last). Bring it to the front, then undo —
    // expect it to be restored to index 2.
    await adapter.reorderNode('c', { op: 'toFront' });
    inner.reorderNodeCalls.length = 0;
    await history.undo();

    expect(inner.reorderNodeCalls).toEqual([{ id: 'c', op: { op: 'toIndex', index: 2 } }]);
  });

  it('reorderNode undo handles toBack', async () => {
    const inner = fakeAdapter();
    const nodes: FlowNode[] = [
      { id: 'a', type: 'rectangle', position: { x: 0, y: 0 }, data: {} } as unknown as FlowNode,
      { id: 'b', type: 'rectangle', position: { x: 0, y: 0 }, data: {} } as unknown as FlowNode,
      { id: 'c', type: 'rectangle', position: { x: 0, y: 0 }, data: {} } as unknown as FlowNode,
    ];
    const { adapter, history } = wrapAdapterWithHistory(inner, () => ({
      nodes,
      connectors: [],
    }));

    // 'a' is at index 0. Send it to the back, then undo — expect 0.
    await adapter.reorderNode('a', { op: 'toBack' });
    inner.reorderNodeCalls.length = 0;
    await history.undo();

    expect(inner.reorderNodeCalls).toEqual([{ id: 'a', op: { op: 'toIndex', index: 0 } }]);
  });

  it('reorderNode without snapshotted state passes through silently', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(inner, noState);

    await adapter.reorderNode('missing-id', { op: 'toFront' });

    // Inner still received the call; no push.
    expect(inner.calls).toEqual([`reorder:missing-id:${JSON.stringify({ op: 'toFront' })}`]);
    expect(history.canUndo).toBe(false);
  });

  // --------------------------------------------------------------------
  // Task 14: uploadImage passthrough contract
  // --------------------------------------------------------------------

  it('uploadImage outside a batch does not push an entry', async () => {
    const inner = fakeAdapter();
    // Construct a minimal File-shaped stub. Node test envs don't have a real
    // File constructor in all versions; cast via `unknown` to satisfy TS.
    // The wrapper is a passthrough and never touches the file payload —
    // it only matters that the call reaches inner.uploadImage and that no
    // history entry is pushed (design §2: standalone uploadImage orphans
    // the file; the inverse lives on the paired createNode inside a
    // host-side `history.batch('insert-image', ...)`).
    const file = new Blob(['x'], { type: 'image/png' }) as unknown as File;
    const { adapter, history } = wrapAdapterWithHistory(inner, noState);
    await adapter.uploadImage('n-1', file, 'a.png');
    expect(history.canUndo).toBe(false);
  });

  // --------------------------------------------------------------------
  // Task 15: batch() with rollback
  // --------------------------------------------------------------------

  it('batch with N successful calls produces ONE entry', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(inner, noState);

    // Two creates in a batch → should land as exactly one combined entry,
    // not two individual entries (the whole point of batch).
    await history.batch('m', async () => {
      await adapter.createNode({ type: 'rectangle', position: { x: 0, y: 0 }, data: {} });
      await adapter.createConnector({ source: 'n-1', target: 'n-2' });
    });

    expect(history.canUndo).toBe(true);
    // One combined entry → exactly one undo brings canUndo back to false.
    await history.undo();
    expect(history.canUndo).toBe(false);
  });

  it('batch undo runs inverses in REVERSE order', async () => {
    const inner = fakeAdapter();
    // createNode returns DIFFERENT ids per call so the inverses are
    // distinguishable in the recorded order.
    let nextId = 1;
    inner.createNode = async (input) => {
      const id = `n-${nextId++}`;
      inner.calls.push(`createNode:${id}:${input.type}`);
      return { id, node: {} };
    };
    inner.createConnector = async (input) => {
      inner.createConnectorCalls.push(input);
      inner.calls.push(`createConn:c-1:${input.source}->${input.target}`);
      return { id: 'c-1' };
    };
    const { adapter, history } = wrapAdapterWithHistory(inner, noState);

    // Batch: create A (n-1), B (n-2), connector C (c-1). On undo the
    // inverses run in REVERSE order: delConn(c-1) → del(n-2) → del(n-1).
    await history.batch('m', async () => {
      await adapter.createNode({ type: 'rectangle', position: { x: 0, y: 0 }, data: {} });
      await adapter.createNode({ type: 'rectangle', position: { x: 1, y: 1 }, data: {} });
      await adapter.createConnector({ source: 'n-1', target: 'n-2' });
    });

    inner.calls.length = 0;
    await history.undo();

    expect(inner.calls).toEqual(['delConn:c-1', 'del:n-2', 'del:n-1']);
  });

  it('batch with empty ops list pushes nothing', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(inner, noState);
    // Silence the unused-binding linter — `adapter` is intentionally
    // unused inside the empty batch body.
    expect(adapter).toBeDefined();

    await history.batch('m', async () => {
      // no adapter calls → no ops collected → nothing to push.
    });

    expect(history.canUndo).toBe(false);
  });

  it('batch with mid-flight rejection rolls back collected ops and rethrows', async () => {
    const inner = fakeAdapter();
    let nextId = 1;
    inner.createNode = async (input) => {
      const id = `n-${nextId++}`;
      // Third createNode throws — A and B succeed, C fails.
      if (nextId === 4) throw new Error('boom on C');
      inner.calls.push(`createNode:${id}:${input.type}`);
      return { id, node: {} };
    };
    const { adapter, history } = wrapAdapterWithHistory(inner, noState);

    let caught: unknown = null;
    try {
      await history.batch('m', async () => {
        await adapter.createNode({ type: 'rectangle', position: { x: 0, y: 0 }, data: {} });
        await adapter.createNode({ type: 'rectangle', position: { x: 1, y: 1 }, data: {} });
        await adapter.createNode({ type: 'rectangle', position: { x: 2, y: 2 }, data: {} });
      });
    } catch (err) {
      caught = err;
    }

    // Original error propagated.
    expect((caught as Error).message).toBe('boom on C');
    // Stack has NO new entry (rollback ran, batch never pushed).
    expect(history.canUndo).toBe(false);
    // Rollback ran: deleteNode(B=n-2), then deleteNode(A=n-1), in reverse
    // order. The strings recorded mid-batch are:
    //   createNode:n-1:rectangle, createNode:n-2:rectangle, del:n-2, del:n-1
    // (the third createNode threw BEFORE pushing its 'createNode:n-3' string).
    expect(inner.calls).toEqual([
      'createNode:n-1:rectangle',
      'createNode:n-2:rectangle',
      'del:n-2',
      'del:n-1',
    ]);
  });

  it('batch rollback swallows per-leg inverse failures via console.warn', async () => {
    const inner = fakeAdapter();
    let nextId = 1;
    inner.createNode = async (input) => {
      const id = `n-${nextId++}`;
      // Second createNode throws → rollback runs for the first only.
      if (nextId === 3) throw new Error('boom on B');
      inner.calls.push(`createNode:${id}:${input.type}`);
      return { id, node: {} };
    };
    // Patch deleteNode to ALSO reject — the rollback's per-leg failure
    // must be swallowed (logged via console.warn), and the original
    // batch error must still propagate.
    inner.deleteNode = async (id) => {
      throw new Error(`delete failed for ${id}`);
    };
    const { adapter, history } = wrapAdapterWithHistory(inner, noState);

    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    let caught: unknown = null;
    try {
      try {
        await history.batch('m', async () => {
          await adapter.createNode({ type: 'rectangle', position: { x: 0, y: 0 }, data: {} });
          await adapter.createNode({ type: 'rectangle', position: { x: 1, y: 1 }, data: {} });
        });
      } catch (err) {
        caught = err;
      }
    } finally {
      console.warn = originalWarn;
    }

    // Original batch error propagated, NOT the rollback's inverse error.
    expect((caught as Error).message).toBe('boom on B');
    // Rollback inverse failure surfaced through console.warn.
    expect(warnings.length).toBe(1);
    // No entry landed despite the failure swallow.
    expect(history.canUndo).toBe(false);
  });

  it('batch redo runs forward ops in ORIGINAL order', async () => {
    const inner = fakeAdapter();
    // Honor a supplied input.id so the createNode wrapper's `do` closure
    // (which threads `{ ...input, id: result.id }`) lands at the same id
    // on redo as it did on the original call.
    let nextId = 1;
    inner.createNode = async (input) => {
      const id = input.id ?? `n-${nextId++}`;
      inner.calls.push(`createNode:${id}:${input.type}`);
      return { id, node: {} };
    };
    inner.createConnector = async (input) => {
      inner.createConnectorCalls.push(input);
      inner.calls.push(`createConn:${input.id ?? 'c-1'}:${input.source}->${input.target}`);
      return { id: input.id ?? 'c-1' };
    };
    const { adapter, history } = wrapAdapterWithHistory(inner, noState);

    await history.batch('m', async () => {
      await adapter.createNode({ type: 'rectangle', position: { x: 0, y: 0 }, data: {} });
      await adapter.createNode({ type: 'rectangle', position: { x: 1, y: 1 }, data: {} });
      await adapter.createConnector({ source: 'n-1', target: 'n-2' });
    });

    await history.undo();
    inner.calls.length = 0;
    await history.redo();

    // Redo replays the recorded `redo` ops in ORIGINAL order. The
    // createNode wrapper's `do` threads `{ ...input, id: result.id }` so
    // redo lands at the same ids the original calls assigned (n-1, n-2).
    expect(inner.calls).toEqual([
      'createNode:n-1:rectangle',
      'createNode:n-2:rectangle',
      'createConn:c-1:n-1->n-2',
    ]);
  });

  it('nested batches flatten — inner adapter calls accumulate into outer batch entry', async () => {
    const inner = fakeAdapter();
    let nextId = 1;
    inner.createNode = async (input) => {
      const id = `n-${nextId++}`;
      inner.calls.push(`createNode:${id}:${input.type}`);
      return { id, node: {} };
    };
    inner.createConnector = async (input) => {
      inner.createConnectorCalls.push(input);
      inner.calls.push(`createConn:c-1:${input.source}->${input.target}`);
      return { id: 'c-1' };
    };
    const { adapter, history } = wrapAdapterWithHistory(inner, noState);

    await history.batch('outer', async () => {
      await history.batch('inner', async () => {
        await adapter.createNode({ type: 'rectangle', position: { x: 0, y: 0 }, data: {} });
      });
      await adapter.createConnector({ source: 'n-1', target: 'n-2' });
    });

    // One combined entry only — the nested batch did not push its own.
    expect(history.canUndo).toBe(true);
    inner.calls.length = 0;
    await history.undo();
    // After one undo the stack is empty.
    expect(history.canUndo).toBe(false);
    // Reverse order: connector first, then node.
    expect(inner.calls).toEqual(['delConn:c-1', 'del:n-1']);
  });

  it('batch does NOT push individual intercept entries — only the outer combined entry', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(inner, noState);

    // Mid-batch hook: after the FIRST adapter call but before the second,
    // canUndo must STILL be false — proves no individual entry was pushed
    // mid-batch.
    const observed: boolean[] = [];
    await history.batch('m', async () => {
      await adapter.createNode({ type: 'rectangle', position: { x: 0, y: 0 }, data: {} });
      observed.push(history.canUndo);
      await adapter.createNode({ type: 'rectangle', position: { x: 1, y: 1 }, data: {} });
      observed.push(history.canUndo);
    });

    expect(observed).toEqual([false, false]);
    expect(history.canUndo).toBe(true);
  });

  // --------------------------------------------------------------------
  // Task 16: markExternalChange + subscribe
  // --------------------------------------------------------------------

  it('markExternalChange does NOT clear within the stale window', async () => {
    // Within-window safety: a flow:reload echo that arrives RIGHT AFTER a
    // UI mutation must be treated as "ours" — the stack stays intact.
    // The outside-window case (real foreign edit) is pinned at the
    // reducer layer by stack.test.ts's applyStaleClear tests; the
    // wrapper's `markExternalChange` accepts no `now` parameter and uses
    // real Date.now internally, so simulating the outside-window
    // transition here would require timer mocking that's deliberately
    // out of scope for this task.
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNode('n-1', { x: 0, y: 0 }),
    );
    await adapter.updateNodePosition('n-1', { x: 1, y: 2 });
    expect(history.canUndo).toBe(true);
    // Synchronous call right after the await — well within the stale window.
    history.markExternalChange();
    expect(history.canUndo).toBe(true);
  });

  it('subscribe invokes the callback immediately with current state', () => {
    const inner = fakeAdapter();
    const { history } = wrapAdapterWithHistory(inner, noState);
    const snaps: Array<{ canUndo: boolean; canRedo: boolean }> = [];
    history.subscribe((s) => snaps.push(s));
    // Immediate-on-subscribe semantics (documented in HistoryHandle.subscribe):
    // empty stack → both flags false.
    expect(snaps).toEqual([{ canUndo: false, canRedo: false }]);
  });

  it('subscribe receives a snapshot after every state mutation', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNode('n-1', { x: 0, y: 0 }),
    );
    const snaps: Array<{ canUndo: boolean; canRedo: boolean }> = [];
    history.subscribe((s) => snaps.push(s));
    // After mutate: immediate snap on subscribe + one post-mutation snap.
    await adapter.updateNodePosition('n-1', { x: 1, y: 2 });
    expect(snaps.length).toBe(2);
    expect(snaps[1]).toEqual({ canUndo: true, canRedo: false });
  });

  it('unsubscribe removes the callback', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNode('n-1', { x: 0, y: 0 }),
    );
    const snaps: Array<{ canUndo: boolean; canRedo: boolean }> = [];
    const off = history.subscribe((s) => snaps.push(s));
    off();
    await adapter.updateNodePosition('n-1', { x: 1, y: 2 });
    // Only the immediate-on-subscribe call landed.
    expect(snaps.length).toBe(1);
  });

  it('subscribe fires on undo/redo cursor transitions', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNode('n-1', { x: 0, y: 0 }),
    );
    await adapter.updateNodePosition('n-1', { x: 1, y: 2 });
    const snaps: Array<{ canUndo: boolean; canRedo: boolean }> = [];
    history.subscribe((s) => snaps.push(s));
    // Immediate snap: post-mutation state.
    expect(snaps).toEqual([{ canUndo: true, canRedo: false }]);
    await history.undo();
    expect(snaps[snaps.length - 1]).toEqual({ canUndo: false, canRedo: true });
    await history.redo();
    expect(snaps[snaps.length - 1]).toEqual({ canUndo: true, canRedo: false });
  });

  it('subscribe fires on clear()', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNode('n-1', { x: 0, y: 0 }),
    );
    await adapter.updateNodePosition('n-1', { x: 1, y: 2 });
    const snaps: Array<{ canUndo: boolean; canRedo: boolean }> = [];
    history.subscribe((s) => snaps.push(s));
    snaps.length = 0;
    history.clear();
    expect(snaps).toEqual([{ canUndo: false, canRedo: false }]);
  });

  // --------------------------------------------------------------------
  // Batch coalesceKey — per-tick gestures like multi-select resize need
  // their batch entries to merge inside the 500ms window so Cmd+Z reverts
  // the whole drag, not just the last tick.
  // --------------------------------------------------------------------

  it('batch with coalesceKey merges into the prior batch within the window', async () => {
    const inner = fakeAdapter();
    // Two batches back-to-back with the SAME coalesceKey. Each batch makes
    // one call so the per-tick inverses are distinguishable: the OLDER
    // batch's undo runs `pos:n-1:0,0` (revert to the pre-burst position);
    // the NEWER batch's `do` runs `pos:n-1:7,7` (the latest tick).
    let positions: { x: number; y: number } = { x: 0, y: 0 };
    const getState: GetFlowState = () => ({
      nodes: [
        {
          id: 'n-1',
          type: 'rectangle' as const,
          position: positions,
          data: {},
        } as unknown as FlowNode,
      ],
      connectors: [],
    });
    const { adapter, history } = wrapAdapterWithHistory(inner, getState);

    // Tick 1: drag from (0,0) to (3,3). After the call the live position
    // moves to (3,3) so the SECOND batch snapshots THIS as its `before`.
    await history.batch(
      'multi-resize',
      async () => {
        await adapter.updateNodePosition('n-1', { x: 3, y: 3 });
      },
      { coalesceKey: 'multi:resize:n-1' },
    );
    positions = { x: 3, y: 3 };

    // Tick 2: drag from (3,3) to (7,7). Same key → must merge with tick 1.
    await history.batch(
      'multi-resize',
      async () => {
        await adapter.updateNodePosition('n-1', { x: 7, y: 7 });
      },
      { coalesceKey: 'multi:resize:n-1' },
    );

    // ONE merged entry on the stack.
    expect(history.canUndo).toBe(true);
    inner.calls.length = 0;
    await history.undo();
    expect(history.canUndo).toBe(false);
    // Oldest-undo-wins: the merged entry's `undo` is the OLDER batch's
    // inverses, which revert to the pre-burst position (0,0) — NOT the
    // tick-2 starting position (3,3). This is the whole point of
    // forwarding the coalesceKey through.
    expect(inner.calls).toEqual(['pos:n-1:0,0']);

    // Redo: the merged entry's `do` is the NEWER batch's forward replay
    // — the LATEST tick (7,7), not every intermediate tick.
    inner.calls.length = 0;
    await history.redo();
    expect(inner.calls).toEqual(['pos:n-1:7,7']);
  });

  it('batch with coalesceKey does NOT merge across different keys', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNode('n-1', { x: 0, y: 0 }),
    );

    // Two batches with DIFFERENT coalesceKeys → two distinct entries on
    // the stack (different selections, different gestures).
    await history.batch(
      'multi-resize',
      async () => {
        await adapter.updateNodePosition('n-1', { x: 1, y: 1 });
      },
      { coalesceKey: 'multi:resize:n-1' },
    );
    await history.batch(
      'multi-resize',
      async () => {
        await adapter.updateNodePosition('n-1', { x: 2, y: 2 });
      },
      { coalesceKey: 'multi:resize:n-2' },
    );

    // Two entries: two undos required to clear the stack.
    expect(history.canUndo).toBe(true);
    await history.undo();
    expect(history.canUndo).toBe(true);
    await history.undo();
    expect(history.canUndo).toBe(false);
  });

  it('batch with no coalesceKey defaults to no-merge', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNode('n-1', { x: 0, y: 0 }),
    );

    // Two batches with NO coalesceKey (pre-migration behavior) → two
    // distinct entries on the stack, even back-to-back inside the
    // would-be window. Preserves the 81 existing batch tests' shape.
    await history.batch('m', async () => {
      await adapter.updateNodePosition('n-1', { x: 1, y: 1 });
    });
    await history.batch('m', async () => {
      await adapter.updateNodePosition('n-1', { x: 2, y: 2 });
    });

    expect(history.canUndo).toBe(true);
    await history.undo();
    expect(history.canUndo).toBe(true);
    await history.undo();
    expect(history.canUndo).toBe(false);
  });

  it('batch synchronously truncates the redo branch at start', async () => {
    const inner = fakeAdapter();
    const { adapter, history } = wrapAdapterWithHistory(
      inner,
      stateWithNode('n-1', { x: 0, y: 0 }),
    );

    // Seed one entry on the stack + undo so canRedo is true.
    await adapter.updateNodePosition('n-1', { x: 5, y: 5 });
    await history.undo();
    expect(history.canRedo).toBe(true);

    // Begin a batch via a never-resolving deferred. Synchronously after
    // calling `batch(...)`, the redo branch must already be gone — even
    // though `fn` hasn't done any work yet and the batch itself hasn't
    // resolved.
    let release: (() => void) | null = null;
    const pending = history.batch('m', async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });

    // Synchronous assertion: truncation happened at batch start.
    expect(history.canRedo).toBe(false);

    // Resolve the deferred + the batch (empty ops, so nothing lands).
    // biome-ignore lint/style/noNonNullAssertion: assigned by the promise above
    release!();
    await pending;
  });
});
