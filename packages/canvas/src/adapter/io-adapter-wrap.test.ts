import { describe, expect, it } from 'bun:test';
import { wrapIoAdapterAsCanvasAdapter } from './io-adapter-wrap.ts';
import type { IoAdapter, IoAdapterResult } from './io-adapter.ts';

// Build an IoAdapter whose every method returns a sentinel-bearing result so a
// downstream test can assert (a) the call routed through the wrapped surface
// and (b) the success value (or void) round-trips unchanged.
function makeRecordingOkAdapter(): {
  adapter: IoAdapter;
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    <T>(method: string, value: T) =>
    async (...args: unknown[]): Promise<IoAdapterResult<T>> => {
      calls.push({ method, args });
      return { ok: true, value };
    };
  const adapter: IoAdapter = {
    createNode: record('createNode', { id: 'n1', node: { foo: 'bar' } }) as IoAdapter['createNode'],
    updateNode: record('updateNode', undefined) as IoAdapter['updateNode'],
    updateNodePosition: record('updateNodePosition', {
      ok: true,
      position: { x: 10, y: 20 },
    }) as IoAdapter['updateNodePosition'],
    deleteNode: record('deleteNode', undefined) as IoAdapter['deleteNode'],
    reorderNode: record('reorderNode', undefined) as IoAdapter['reorderNode'],
    createConnector: record('createConnector', { id: 'c1' }) as IoAdapter['createConnector'],
    updateConnector: record('updateConnector', undefined) as IoAdapter['updateConnector'],
    deleteConnector: record('deleteConnector', undefined) as IoAdapter['deleteConnector'],
    uploadImage: record('uploadImage', {
      path: 'nodes/n1/img.png',
    }) as IoAdapter['uploadImage'],
  };
  return { adapter, calls };
}

function makeFailAdapter(reason: string): IoAdapter {
  const fail = async () => ({ ok: false as const, reason });
  return {
    createNode: fail,
    updateNode: fail,
    updateNodePosition: fail,
    deleteNode: fail,
    reorderNode: fail,
    createConnector: fail,
    updateConnector: fail,
    deleteConnector: fail,
    uploadImage: fail,
  };
}

describe('wrapIoAdapterAsCanvasAdapter — success path', () => {
  it('returns the value from createNode', async () => {
    const { adapter } = makeRecordingOkAdapter();
    const wrapped = wrapIoAdapterAsCanvasAdapter(adapter);
    const res = await wrapped.createNode({
      type: 'rectangle',
      position: { x: 0, y: 0 },
      data: {},
    });
    expect(res.id).toBe('n1');
    expect(res.node).toEqual({ foo: 'bar' });
  });

  it('returns the value from updateNodePosition', async () => {
    const { adapter } = makeRecordingOkAdapter();
    const wrapped = wrapIoAdapterAsCanvasAdapter(adapter);
    const res = await wrapped.updateNodePosition('n1', { x: 10, y: 20 });
    expect(res).toEqual({ ok: true, position: { x: 10, y: 20 } });
  });

  it('resolves void for updateNode / deleteNode / reorderNode / updateConnector / deleteConnector', async () => {
    const { adapter } = makeRecordingOkAdapter();
    const wrapped = wrapIoAdapterAsCanvasAdapter(adapter);
    expect(await wrapped.updateNode('n1', {})).toBeUndefined();
    expect(await wrapped.deleteNode('n1')).toBeUndefined();
    expect(await wrapped.reorderNode('n1', { op: 'forward' })).toBeUndefined();
    expect(await wrapped.updateConnector('c1', {})).toBeUndefined();
    expect(await wrapped.deleteConnector('c1')).toBeUndefined();
  });

  it('returns the value from createConnector', async () => {
    const { adapter } = makeRecordingOkAdapter();
    const wrapped = wrapIoAdapterAsCanvasAdapter(adapter);
    const res = await wrapped.createConnector({ source: 'a', target: 'b' });
    expect(res.id).toBe('c1');
  });

  it('returns the value from uploadImage and forwards the File argument unchanged', async () => {
    const { adapter, calls } = makeRecordingOkAdapter();
    const wrapped = wrapIoAdapterAsCanvasAdapter(adapter);
    const file = new File([new Uint8Array([1, 2, 3])], 'img.png', { type: 'image/png' });
    const res = await wrapped.uploadImage('n1', file, 'img.png');
    expect(res.path).toBe('nodes/n1/img.png');
    const call = calls.find((c) => c.method === 'uploadImage');
    if (!call) throw new Error('uploadImage was not invoked');
    expect(call.args[0]).toBe('n1');
    expect(call.args[1]).toBe(file);
    expect(call.args[2]).toBe('img.png');
  });
});

describe('wrapIoAdapterAsCanvasAdapter — failure path', () => {
  it('rejects with Error(reason) when the wrapped IoAdapter returns { ok: false }', async () => {
    const wrapped = wrapIoAdapterAsCanvasAdapter(makeFailAdapter('peer rejected'));
    let thrown: unknown;
    try {
      await wrapped.deleteNode('n1');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('peer rejected');
  });

  it('rejects on every value-returning method when the IoAdapter fails', async () => {
    const wrapped = wrapIoAdapterAsCanvasAdapter(makeFailAdapter('nope'));
    const file = new File([], 'x.png', { type: 'image/png' });
    const promises = [
      wrapped.createNode({ type: 'rectangle', position: { x: 0, y: 0 }, data: {} }),
      wrapped.updateNodePosition('n1', { x: 1, y: 1 }),
      wrapped.createConnector({ source: 'a', target: 'b' }),
      wrapped.uploadImage('n1', file, 'x.png'),
    ];
    for (const p of promises) {
      let thrown: unknown;
      try {
        await p;
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe('nope');
    }
  });
});

describe('wrapIoAdapterAsCanvasAdapter — round-trip', () => {
  it('routes each of the 9 wrapped methods through the underlying IoAdapter exactly once per call', async () => {
    const { adapter, calls } = makeRecordingOkAdapter();
    const wrapped = wrapIoAdapterAsCanvasAdapter(adapter);
    const file = new File([], 'x.png', { type: 'image/png' });
    await wrapped.createNode({ type: 'rectangle', position: { x: 0, y: 0 }, data: {} });
    await wrapped.updateNode('n1', {});
    await wrapped.updateNodePosition('n1', { x: 5, y: 5 });
    await wrapped.deleteNode('n1');
    await wrapped.reorderNode('n1', { op: 'forward' });
    await wrapped.createConnector({ source: 'a', target: 'b' });
    await wrapped.updateConnector('c1', {});
    await wrapped.deleteConnector('c1');
    await wrapped.uploadImage('n1', file, 'x.png');
    expect(calls.map((c) => c.method)).toEqual([
      'createNode',
      'updateNode',
      'updateNodePosition',
      'deleteNode',
      'reorderNode',
      'createConnector',
      'updateConnector',
      'deleteConnector',
      'uploadImage',
    ]);
  });
});
