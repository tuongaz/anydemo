import { describe, expect, it } from 'bun:test';
import type { IoAdapter, IoAdapterDispatchEnvelope, IoAdapterResult } from './io-adapter.ts';
import type { CanvasAdapter } from './types.ts';

// Build a minimal IoAdapter that succeeds for every method — exercises the
// type at construction time and the success branch of `IoAdapterResult`.
const makeOkAdapter = (): IoAdapter => ({
  createNode: async () => ({ ok: true, value: { id: 'n1', node: {} } }),
  updateNode: async () => ({ ok: true, value: undefined }),
  updateNodePosition: async (_id, position) => ({
    ok: true,
    value: { ok: true, position },
  }),
  deleteNode: async () => ({ ok: true, value: undefined }),
  reorderNode: async () => ({ ok: true, value: undefined }),
  createConnector: async () => ({ ok: true, value: { id: 'c1' } }),
  updateConnector: async () => ({ ok: true, value: undefined }),
  deleteConnector: async () => ({ ok: true, value: undefined }),
  uploadImage: async () => ({ ok: true, value: { path: 'nodes/n1/img.png' } }),
});

const makeFailAdapter = (reason: string): IoAdapter => ({
  createNode: async () => ({ ok: false, reason }),
  updateNode: async () => ({ ok: false, reason }),
  updateNodePosition: async () => ({ ok: false, reason }),
  deleteNode: async () => ({ ok: false, reason }),
  reorderNode: async () => ({ ok: false, reason }),
  createConnector: async () => ({ ok: false, reason }),
  updateConnector: async () => ({ ok: false, reason }),
  deleteConnector: async () => ({ ok: false, reason }),
  uploadImage: async () => ({ ok: false, reason }),
});

describe('IoAdapter — result narrowing', () => {
  it('success path narrows to value', async () => {
    const adapter = makeOkAdapter();
    const res = await adapter.createNode({
      type: 'rectangle',
      position: { x: 0, y: 0 },
      data: {},
    });
    if (!res.ok) throw new Error('expected ok');
    // Type narrowed — `value` is `{ id; node }` here.
    expect(res.value.id).toBe('n1');
    expect(typeof res.value.node).toBe('object');
  });

  it('failure path narrows to reason', async () => {
    const adapter = makeFailAdapter('peer rejected');
    const res = await adapter.updateNodePosition('n1', { x: 5, y: 5 });
    if (res.ok) throw new Error('expected !ok');
    // Type narrowed — `reason` is a string here, no `value` accessible.
    expect(res.reason).toBe('peer rejected');
  });

  it('every IoAdapter method returns the IoAdapterResult discriminant', async () => {
    const adapter = makeOkAdapter();
    const file = new File([new Uint8Array([1, 2, 3])], 'img.png', { type: 'image/png' });
    const results: IoAdapterResult<unknown>[] = await Promise.all([
      adapter.createNode({ type: 'rectangle', position: { x: 0, y: 0 }, data: {} }),
      adapter.updateNode('n1', {}),
      adapter.updateNodePosition('n1', { x: 1, y: 1 }),
      adapter.deleteNode('n1'),
      adapter.reorderNode('n1', { op: 'forward' }),
      adapter.createConnector({ source: 'a', target: 'b' }),
      adapter.updateConnector('c1', {}),
      adapter.deleteConnector('c1'),
      adapter.uploadImage('n1', file, 'img.png'),
    ]);
    expect(results.length).toBe(9);
    for (const r of results) {
      expect(r.ok).toBe(true);
    }
  });
});

describe('IoAdapterDispatchEnvelope — op discriminator', () => {
  // Each op string is a literal that should compile against the union. Picking
  // each one in turn covers the discriminator surface area.
  const ops: IoAdapterDispatchEnvelope['op'][] = [
    'addNode',
    'patchNode',
    'moveNode',
    'reorderNode',
    'deleteNode',
    'addConnector',
    'patchConnector',
    'deleteConnector',
  ];

  for (const op of ops) {
    it(`accepts op='${op}' with an arbitrary payload`, () => {
      const envelope: IoAdapterDispatchEnvelope = { op, payload: { sentinel: op } };
      expect(envelope.op).toBe(op);
      expect((envelope.payload as { sentinel: string }).sentinel).toBe(op);
    });
  }

  it('exposes exactly the 8 documented op tags', () => {
    expect(ops.length).toBe(8);
    expect(new Set(ops).size).toBe(8);
  });
});

describe('IoAdapter — type-level compatibility with CanvasAdapter', () => {
  // Wrapping IoAdapter into the throwing CanvasAdapter contract is what
  // <SeeflowCanvas> does internally (US-036). Express the conversion here at
  // the type level via a minimal wrapper so a future drift between the two
  // surfaces fails compilation.
  const wrap = (io: IoAdapter): CanvasAdapter => ({
    createNode: async (input) => {
      const r = await io.createNode(input);
      if (!r.ok) throw new Error(r.reason);
      return r.value;
    },
    updateNode: async (id, patch) => {
      const r = await io.updateNode(id, patch);
      if (!r.ok) throw new Error(r.reason);
    },
    updateNodePosition: async (id, position) => {
      const r = await io.updateNodePosition(id, position);
      if (!r.ok) throw new Error(r.reason);
      return r.value;
    },
    deleteNode: async (id) => {
      const r = await io.deleteNode(id);
      if (!r.ok) throw new Error(r.reason);
    },
    reorderNode: async (id, op) => {
      const r = await io.reorderNode(id, op);
      if (!r.ok) throw new Error(r.reason);
    },
    createConnector: async (input) => {
      const r = await io.createConnector(input);
      if (!r.ok) throw new Error(r.reason);
      return r.value;
    },
    updateConnector: async (id, patch) => {
      const r = await io.updateConnector(id, patch);
      if (!r.ok) throw new Error(r.reason);
    },
    deleteConnector: async (id) => {
      const r = await io.deleteConnector(id);
      if (!r.ok) throw new Error(r.reason);
    },
    uploadImage: async (nodeId, file, filename) => {
      const r = await io.uploadImage(nodeId, file, filename);
      if (!r.ok) throw new Error(r.reason);
      return r.value;
    },
  });

  it('wrapper turns ok results into return values', async () => {
    const adapter = wrap(makeOkAdapter());
    const res = await adapter.createNode({
      type: 'rectangle',
      position: { x: 0, y: 0 },
      data: {},
    });
    expect(res.id).toBe('n1');
  });

  it('wrapper turns !ok results into thrown Errors carrying the reason', async () => {
    const adapter = wrap(makeFailAdapter('nope'));
    let thrown: unknown;
    try {
      await adapter.deleteNode('n1');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('nope');
  });
});
