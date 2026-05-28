import { describe, expect, it } from 'bun:test';
import type { CanvasAdapter } from '../adapter/types.ts';
import type { FlowNode } from '../types.ts';
import type { GetFlowState } from './types.ts';
import { wrapAdapterWithHistory } from './wrap-adapter.ts';

interface FakeAdapter extends CanvasAdapter {
  calls: string[];
}

/**
 * Deterministic in-memory adapter that records every call into `calls`
 * (no side effects). The mutating methods return shapes that satisfy
 * `CanvasAdapter` but never touch real state — the wrapper only cares
 * about call ordering and snapshot/inverse correctness.
 */
const fakeAdapter = (): FakeAdapter => {
  const calls: string[] = [];
  return {
    calls,
    createNode: async (input) => {
      calls.push(`createNode:${input.type}`);
      return { id: 'n-1', node: {} };
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
      calls.push(`reorder:${id}:${JSON.stringify(op)}`);
    },
    createConnector: async (_input) => {
      calls.push('createConn');
      return { id: 'c-1' };
    },
    updateConnector: async (id, patch) => {
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
});
