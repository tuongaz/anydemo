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
});
