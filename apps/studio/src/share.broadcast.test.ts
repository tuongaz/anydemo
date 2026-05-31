import { describe, expect, it } from 'bun:test';
import type { AuditLog, AuditLogOpts } from './share-audit.ts';
import type { Envelope } from './share-envelope.ts';
import type { RpcOp } from './share-rpc-schema.ts';
import type { ShareTransport, ShareTransportOpts, ShareTransportState } from './share-transport.ts';
import { type RpcDispatchOutcome, type RpcDispatcher, createShareController } from './share.ts';

const noopAuditFactory = (_opts: AuditLogOpts): AuditLog => ({
  append: () => {},
  close: async () => {},
});

const FAKE_RELAY_SESSION = {
  sessionId: 'sess-b',
  token: 'tok-b',
  hostKey: 'hk-b',
  wsUrl: 'wss://relay/ws',
};

const mockFetch = (body: unknown): typeof fetch => {
  const fake = async () =>
    ({
      ok: true,
      status: 200,
      json: async () => body,
    }) as unknown as Response;
  return fake as unknown as typeof fetch;
};

const makeFakeTransport = (autoEmit: ShareTransportState[] = []) => {
  let lastOpts: ShareTransportOpts | null = null;
  const factory = (opts: ShareTransportOpts): ShareTransport => {
    lastOpts = opts;
    const t: ShareTransport = {
      send() {},
      close() {},
      isOpen() {
        return true;
      },
    };
    for (const s of autoEmit) opts.onStateChange(s);
    return t;
  };
  return { factory, last: () => lastOpts };
};

interface BroadcastCapture {
  envelopes: Envelope[];
  // When set, every accepted broadcast records the resolution-order of the
  // matching rpc-result so we can assert "broadcast before rpc-result".
  order: string[];
}

const makeBroadcastSpy = (
  order: string[],
): { capture: BroadcastCapture; spy: (env: Envelope) => void } => {
  const envelopes: Envelope[] = [];
  return {
    capture: { envelopes, order },
    spy: (env: Envelope) => {
      envelopes.push(env);
      order.push('broadcast');
    },
  };
};

interface BroadcastFixture {
  startActive: (opts?: { outcome?: RpcDispatchOutcome }) => Promise<{
    ctrl: ReturnType<typeof createShareController>;
    capture: BroadcastCapture;
    order: string[];
    setOutcome: (next: RpcDispatchOutcome) => void;
  }>;
}

const fixture: BroadcastFixture = {
  async startActive(opts) {
    const order: string[] = [];
    const { capture, spy } = makeBroadcastSpy(order);
    let outcome: RpcDispatchOutcome = opts?.outcome ?? { kind: 'ok' };
    const dispatcher: RpcDispatcher = async (_op) => outcome;
    const fake = makeFakeTransport(['connecting', 'open']);
    const ctrl = createShareController({
      relayHttpUrl: 'https://relay.example',
      shareUrlBase: 'https://share.example',
      auditLogFactory: noopAuditFactory,
      fetch: mockFetch(FAKE_RELAY_SESSION),
      transportFactory: fake.factory,
      rpcDispatcher: dispatcher,
      appendShareAuditFn: () => {},
      broadcast: spy,
    });
    await ctrl.start();
    return {
      ctrl,
      capture,
      order,
      setOutcome: (next) => {
        outcome = next;
      },
    };
  },
};

const baseFrame = (id: string, payload: RpcOp) => ({
  v: 1,
  type: 'rpc',
  id,
  payload,
});

const expectNodePatched = (
  env: Envelope,
): {
  flowId: string;
  op: string;
  diff: Record<string, unknown>;
  version: number;
} => {
  expect(env.v).toBe(1);
  expect(env.type).toBe('node-patched');
  expect(env.from).toBe('host');
  expect(env.to).toBe('all');
  const payload = env.payload as {
    flowId: string;
    op: string;
    diff: Record<string, unknown>;
    version: number;
  };
  expect(typeof payload.flowId).toBe('string');
  expect(typeof payload.op).toBe('string');
  expect(typeof payload.version).toBe('number');
  expect(typeof payload.diff).toBe('object');
  return payload;
};

describe('handleRpcFrame — node-patched broadcast ordering', () => {
  it('fires broadcast BEFORE rpc-result resolves', async () => {
    const fx = await fixture.startActive();
    const result = await fx.ctrl.handleRpcFrame(
      baseFrame('r-1', {
        op: 'moveNode',
        flowId: 'flow-a',
        nodeId: 'n-1',
        position: { x: 5, y: 6 },
      }),
      'peer-1',
    );
    fx.order.push('result');
    expect(fx.order).toEqual(['broadcast', 'result']);
    expect(fx.capture.envelopes).toHaveLength(1);
    if (result.payload.ok !== true) throw new Error('expected ok');
  });
});

describe('handleRpcFrame — node-patched diff shapes', () => {
  it('moveNode produces a move diff with nodeId + position', async () => {
    const fx = await fixture.startActive();
    await fx.ctrl.handleRpcFrame(
      baseFrame('r-mv', {
        op: 'moveNode',
        flowId: 'flow-a',
        nodeId: 'n-1',
        position: { x: 10, y: 20 },
      }),
      'peer-1',
    );
    const payload = expectNodePatched(fx.capture.envelopes[0] as Envelope);
    expect(payload.op).toBe('moveNode');
    expect(payload.flowId).toBe('flow-a');
    expect(payload.diff).toEqual({ kind: 'move', nodeId: 'n-1', position: { x: 10, y: 20 } });
  });

  it('patchNode produces a patch diff with nodeId + patch body', async () => {
    const fx = await fixture.startActive();
    await fx.ctrl.handleRpcFrame(
      baseFrame('r-pn', {
        op: 'patchNode',
        flowId: 'flow-a',
        nodeId: 'n-1',
        patch: { label: 'hello' },
      }),
      'peer-1',
    );
    const payload = expectNodePatched(fx.capture.envelopes[0] as Envelope);
    expect(payload.op).toBe('patchNode');
    expect(payload.diff).toEqual({ kind: 'patch', nodeId: 'n-1', patch: { label: 'hello' } });
  });

  it('addNode produces an add diff carrying the full new node from outcome', async () => {
    const fx = await fixture.startActive({
      outcome: { kind: 'ok', data: { id: 'n-new', node: { id: 'n-new', type: 'rect' } } },
    });
    await fx.ctrl.handleRpcFrame(
      baseFrame('r-an', {
        op: 'addNode',
        flowId: 'flow-a',
        node: { type: 'rect' },
      }),
      'peer-1',
    );
    const payload = expectNodePatched(fx.capture.envelopes[0] as Envelope);
    expect(payload.op).toBe('addNode');
    expect(payload.diff).toEqual({ kind: 'add', node: { id: 'n-new', type: 'rect' } });
  });

  it('deleteNode produces a delete diff with nodeId', async () => {
    const fx = await fixture.startActive();
    await fx.ctrl.handleRpcFrame(
      baseFrame('r-dn', { op: 'deleteNode', flowId: 'flow-a', nodeId: 'n-1' }),
      'peer-1',
    );
    const payload = expectNodePatched(fx.capture.envelopes[0] as Envelope);
    expect(payload.op).toBe('deleteNode');
    expect(payload.diff).toEqual({ kind: 'delete', nodeId: 'n-1' });
  });

  it('reorderNode produces a reorder diff with nodeId + reorder op', async () => {
    const fx = await fixture.startActive();
    await fx.ctrl.handleRpcFrame(
      baseFrame('r-rn', {
        op: 'reorderNode',
        flowId: 'flow-a',
        nodeId: 'n-1',
        reorder: { op: 'forward' },
      }),
      'peer-1',
    );
    const payload = expectNodePatched(fx.capture.envelopes[0] as Envelope);
    expect(payload.op).toBe('reorderNode');
    expect(payload.diff).toEqual({ kind: 'reorder', nodeId: 'n-1', op: { op: 'forward' } });
  });

  it('addConnector produces an add diff carrying the connector + id from outcome', async () => {
    const fx = await fixture.startActive({
      outcome: { kind: 'ok', data: { id: 'c-new' } },
    });
    await fx.ctrl.handleRpcFrame(
      baseFrame('r-ac', {
        op: 'addConnector',
        flowId: 'flow-a',
        connector: { source: 'a', target: 'b' },
      }),
      'peer-1',
    );
    const payload = expectNodePatched(fx.capture.envelopes[0] as Envelope);
    expect(payload.op).toBe('addConnector');
    expect(payload.diff).toEqual({
      kind: 'add',
      connector: { source: 'a', target: 'b', id: 'c-new' },
    });
  });

  it('patchConnector produces a patch diff with connectorId + patch', async () => {
    const fx = await fixture.startActive();
    await fx.ctrl.handleRpcFrame(
      baseFrame('r-pc', {
        op: 'patchConnector',
        flowId: 'flow-a',
        connectorId: 'c-1',
        patch: { label: 'updated' },
      }),
      'peer-1',
    );
    const payload = expectNodePatched(fx.capture.envelopes[0] as Envelope);
    expect(payload.op).toBe('patchConnector');
    expect(payload.diff).toEqual({
      kind: 'patch',
      connectorId: 'c-1',
      patch: { label: 'updated' },
    });
  });

  it('deleteConnector produces a delete diff with connectorId', async () => {
    const fx = await fixture.startActive();
    await fx.ctrl.handleRpcFrame(
      baseFrame('r-dc', { op: 'deleteConnector', flowId: 'flow-a', connectorId: 'c-1' }),
      'peer-1',
    );
    const payload = expectNodePatched(fx.capture.envelopes[0] as Envelope);
    expect(payload.op).toBe('deleteConnector');
    expect(payload.diff).toEqual({ kind: 'delete', connectorId: 'c-1' });
  });

  it('addBulk produces a bulk diff carrying the outcome data', async () => {
    const fx = await fixture.startActive({
      outcome: {
        kind: 'ok',
        data: { nodes: [{ id: 'n-1', node: { id: 'n-1' } }], connectors: [] },
      },
    });
    await fx.ctrl.handleRpcFrame(
      baseFrame('r-bk', {
        op: 'addBulk',
        flowId: 'flow-a',
        nodes: [{ type: 'rect' }],
      }),
      'peer-1',
    );
    const payload = expectNodePatched(fx.capture.envelopes[0] as Envelope);
    expect(payload.op).toBe('addBulk');
    expect(payload.diff).toEqual({
      kind: 'bulk',
      result: { nodes: [{ id: 'n-1', node: { id: 'n-1' } }], connectors: [] },
    });
  });
});

describe('handleRpcFrame — version monotonicity', () => {
  it('per-flow version increments across consecutive accepted ops', async () => {
    const fx = await fixture.startActive();
    await fx.ctrl.handleRpcFrame(
      baseFrame('r-1', {
        op: 'moveNode',
        flowId: 'flow-a',
        nodeId: 'n-1',
        position: { x: 1, y: 1 },
      }),
      'peer-1',
    );
    await fx.ctrl.handleRpcFrame(
      baseFrame('r-2', {
        op: 'patchNode',
        flowId: 'flow-a',
        nodeId: 'n-1',
        patch: { label: 'next' },
      }),
      'peer-1',
    );
    expect(fx.capture.envelopes).toHaveLength(2);
    const first = expectNodePatched(fx.capture.envelopes[0] as Envelope);
    const second = expectNodePatched(fx.capture.envelopes[1] as Envelope);
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
  });

  it('different flows track independent counters', async () => {
    const fx = await fixture.startActive();
    await fx.ctrl.handleRpcFrame(
      baseFrame('r-a', {
        op: 'moveNode',
        flowId: 'flow-a',
        nodeId: 'n-1',
        position: { x: 1, y: 1 },
      }),
      'peer-1',
    );
    await fx.ctrl.handleRpcFrame(
      baseFrame('r-b', {
        op: 'moveNode',
        flowId: 'flow-b',
        nodeId: 'n-1',
        position: { x: 2, y: 2 },
      }),
      'peer-1',
    );
    const a = expectNodePatched(fx.capture.envelopes[0] as Envelope);
    const b = expectNodePatched(fx.capture.envelopes[1] as Envelope);
    expect(a.flowId).toBe('flow-a');
    expect(a.version).toBe(1);
    expect(b.flowId).toBe('flow-b');
    expect(b.version).toBe(1);
  });
});

describe('handleRpcFrame — failures do not broadcast', () => {
  it('a notFound outcome does NOT fire broadcast and does NOT bump version', async () => {
    const fx = await fixture.startActive({ outcome: { kind: 'notFound' } });
    const result = await fx.ctrl.handleRpcFrame(
      baseFrame('r-nf', { op: 'deleteNode', flowId: 'flow-a', nodeId: 'missing' }),
      'peer-1',
    );
    expect(result.payload.ok).toBe(false);
    expect(fx.capture.envelopes).toHaveLength(0);
    // Subsequent successful op should still start at version 1.
    fx.setOutcome({ kind: 'ok' });
    await fx.ctrl.handleRpcFrame(
      baseFrame('r-ok', {
        op: 'moveNode',
        flowId: 'flow-a',
        nodeId: 'n-1',
        position: { x: 0, y: 0 },
      }),
      'peer-1',
    );
    expect(fx.capture.envelopes).toHaveLength(1);
    expect(expectNodePatched(fx.capture.envelopes[0] as Envelope).version).toBe(1);
  });

  it('invalid_envelope does NOT broadcast', async () => {
    const fx = await fixture.startActive();
    await fx.ctrl.handleRpcFrame({ v: 1, type: 'rpc', id: 'r-bad' }, 'peer-1');
    expect(fx.capture.envelopes).toHaveLength(0);
  });
});
