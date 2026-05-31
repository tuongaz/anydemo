import { describe, expect, it } from 'bun:test';
import type { AuditLog, AuditLogOpts, RpcAuditEntry } from './share-audit.ts';
import type { Envelope } from './share-envelope.ts';
import type { RpcOp, RpcResultFrame } from './share-rpc-schema.ts';
import type { ShareTransport, ShareTransportOpts, ShareTransportState } from './share-transport.ts';
import { type RpcDispatchOutcome, type RpcDispatcher, createShareController } from './share.ts';

// Audit factory used by every test — no-op so audit writes never reach disk.
const noopAuditFactory = (_opts: AuditLogOpts): AuditLog => ({
  append: () => {},
  close: async () => {},
});

const FAKE_RELAY_SESSION = {
  sessionId: 'sess-1',
  token: 'tok-1',
  hostKey: 'hk-1',
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

interface FakeTransportHandle {
  factory: (opts: ShareTransportOpts) => ShareTransport;
  emit: (s: ShareTransportState) => void;
  emitFrame: (env: Envelope) => void;
  sends: () => Envelope[];
}

const makeFakeTransport = (autoEmit: ShareTransportState[] = []): FakeTransportHandle => {
  let lastOpts: ShareTransportOpts | null = null;
  const sends: Envelope[] = [];
  const factory = (opts: ShareTransportOpts): ShareTransport => {
    lastOpts = opts;
    const t: ShareTransport = {
      send(frame) {
        sends.push(frame);
      },
      close() {},
      isOpen() {
        return true;
      },
    };
    for (const s of autoEmit) opts.onStateChange(s);
    return t;
  };
  return {
    factory,
    emit: (s) => lastOpts?.onStateChange(s),
    emitFrame: (env) => lastOpts?.onFrame(env),
    sends: () => sends,
  };
};

interface SharedFixture {
  dispatched: RpcOp[];
  audited: Array<{ sessionId: string; entry: RpcAuditEntry }>;
  setOutcome: (next: RpcDispatchOutcome) => void;
  startActive: () => Promise<ReturnType<typeof createShareController>>;
}

const makeFixture = (initialOutcome: RpcDispatchOutcome): SharedFixture => {
  const dispatched: RpcOp[] = [];
  const audited: Array<{ sessionId: string; entry: RpcAuditEntry }> = [];
  let outcome = initialOutcome;
  const dispatcher: RpcDispatcher = async (op) => {
    dispatched.push(op);
    return outcome;
  };
  return {
    dispatched,
    audited,
    setOutcome: (next) => {
      outcome = next;
    },
    startActive: async () => {
      const fake = makeFakeTransport(['connecting', 'open']);
      const ctrl = createShareController({
        relayHttpUrl: 'https://relay.example',
        shareUrlBase: 'https://share.example',
        auditLogFactory: noopAuditFactory,
        fetch: mockFetch(FAKE_RELAY_SESSION),
        transportFactory: fake.factory,
        rpcDispatcher: dispatcher,
        appendShareAuditFn: (sessionId, entry) => audited.push({ sessionId, entry }),
      });
      await ctrl.start();
      return ctrl;
    },
  };
};

const baseFrame = (id: string, payload: RpcOp) => ({
  v: 1,
  type: 'rpc',
  id,
  payload,
});

const expectResultOk = (result: RpcResultFrame, id: string): void => {
  expect(result.v).toBe(1);
  expect(result.type).toBe('rpc-result');
  expect(result.id).toBe(id);
  expect(result.payload.ok).toBe(true);
};

describe('handleRpcFrame — happy path per allowlisted op', () => {
  it('addNode dispatches with op + flowId + node body', async () => {
    const fx = makeFixture({ kind: 'ok', data: { id: 'node-x', node: { id: 'node-x' } } });
    const ctrl = await fx.startActive();
    const frame = baseFrame('r-1', {
      op: 'addNode',
      flowId: 'flow-a',
      node: { type: 'rect' },
    });
    const result = await ctrl.handleRpcFrame(frame, 'peer-1');
    expectResultOk(result, 'r-1');
    if (result.payload.ok)
      expect(result.payload.result).toEqual({ id: 'node-x', node: { id: 'node-x' } });
    expect(fx.dispatched).toHaveLength(1);
    expect(fx.dispatched[0]?.op).toBe('addNode');
    expect(fx.audited).toHaveLength(1);
    expect(fx.audited[0]?.entry.op).toBe('addNode');
    expect(fx.audited[0]?.entry.flowId).toBe('flow-a');
    expect(fx.audited[0]?.entry.ok).toBe(true);
    expect(fx.audited[0]?.sessionId).toBe('sess-1');
  });

  it('patchNode dispatches', async () => {
    const fx = makeFixture({ kind: 'ok' });
    const ctrl = await fx.startActive();
    const frame = baseFrame('r-2', {
      op: 'patchNode',
      flowId: 'flow-a',
      nodeId: 'node-1',
      patch: { label: 'hello' },
    });
    const result = await ctrl.handleRpcFrame(frame, 'peer-1');
    expectResultOk(result, 'r-2');
    // No `result` field when outcome had no `data`.
    if (result.payload.ok) expect(result.payload.result).toBeUndefined();
    expect(fx.dispatched[0]?.op).toBe('patchNode');
  });

  it('moveNode dispatches', async () => {
    const fx = makeFixture({ kind: 'ok', data: { position: { x: 1, y: 2 } } });
    const ctrl = await fx.startActive();
    const result = await ctrl.handleRpcFrame(
      baseFrame('r-3', {
        op: 'moveNode',
        flowId: 'flow-a',
        nodeId: 'node-1',
        position: { x: 1, y: 2 },
      }),
      'peer-1',
    );
    expectResultOk(result, 'r-3');
    expect(fx.dispatched[0]?.op).toBe('moveNode');
  });

  it('reorderNode dispatches', async () => {
    const fx = makeFixture({ kind: 'ok' });
    const ctrl = await fx.startActive();
    const result = await ctrl.handleRpcFrame(
      baseFrame('r-4', {
        op: 'reorderNode',
        flowId: 'flow-a',
        nodeId: 'node-1',
        reorder: { op: 'forward' },
      }),
      'peer-1',
    );
    expectResultOk(result, 'r-4');
    expect(fx.dispatched[0]?.op).toBe('reorderNode');
  });

  it('deleteNode dispatches', async () => {
    const fx = makeFixture({ kind: 'ok' });
    const ctrl = await fx.startActive();
    const result = await ctrl.handleRpcFrame(
      baseFrame('r-5', { op: 'deleteNode', flowId: 'flow-a', nodeId: 'node-1' }),
      'peer-1',
    );
    expectResultOk(result, 'r-5');
    expect(fx.dispatched[0]?.op).toBe('deleteNode');
  });

  it('addConnector dispatches', async () => {
    const fx = makeFixture({ kind: 'ok', data: { id: 'conn-x' } });
    const ctrl = await fx.startActive();
    const result = await ctrl.handleRpcFrame(
      baseFrame('r-6', {
        op: 'addConnector',
        flowId: 'flow-a',
        connector: { source: 'a', target: 'b' },
      }),
      'peer-1',
    );
    expectResultOk(result, 'r-6');
    expect(fx.dispatched[0]?.op).toBe('addConnector');
  });

  it('patchConnector dispatches', async () => {
    const fx = makeFixture({ kind: 'ok' });
    const ctrl = await fx.startActive();
    const result = await ctrl.handleRpcFrame(
      baseFrame('r-7', {
        op: 'patchConnector',
        flowId: 'flow-a',
        connectorId: 'conn-1',
        patch: { label: 'updated' },
      }),
      'peer-1',
    );
    expectResultOk(result, 'r-7');
    expect(fx.dispatched[0]?.op).toBe('patchConnector');
  });

  it('deleteConnector dispatches', async () => {
    const fx = makeFixture({ kind: 'ok' });
    const ctrl = await fx.startActive();
    const result = await ctrl.handleRpcFrame(
      baseFrame('r-8', {
        op: 'deleteConnector',
        flowId: 'flow-a',
        connectorId: 'conn-1',
      }),
      'peer-1',
    );
    expectResultOk(result, 'r-8');
    expect(fx.dispatched[0]?.op).toBe('deleteConnector');
  });

  it('addBulk dispatches', async () => {
    const fx = makeFixture({
      kind: 'ok',
      data: { nodes: [{ id: 'n-1', node: { id: 'n-1' } }], connectors: [] },
    });
    const ctrl = await fx.startActive();
    const result = await ctrl.handleRpcFrame(
      baseFrame('r-9', {
        op: 'addBulk',
        flowId: 'flow-a',
        nodes: [{ type: 'rect' }],
      }),
      'peer-1',
    );
    expectResultOk(result, 'r-9');
    expect(fx.dispatched[0]?.op).toBe('addBulk');
  });
});

describe('handleRpcFrame — envelope validation', () => {
  it('rejects an envelope that fails Zod parse with reason invalid_envelope', async () => {
    const fx = makeFixture({ kind: 'ok' });
    const ctrl = await fx.startActive();
    // Missing `payload` field.
    const result = await ctrl.handleRpcFrame({ v: 1, type: 'rpc', id: 'r-invalid' }, 'peer-1');
    expect(result.payload.ok).toBe(false);
    if (!result.payload.ok) expect(result.payload.reason).toBe('invalid_envelope');
    // Preserves the original id since it survived as a string.
    expect(result.id).toBe('r-invalid');
    // Dispatcher never called.
    expect(fx.dispatched).toHaveLength(0);
    // No audit entry on parse-failure.
    expect(fx.audited).toHaveLength(0);
  });

  it('rejects an envelope with unknown op as invalid_envelope (Zod gates the discriminator)', async () => {
    const fx = makeFixture({ kind: 'ok' });
    const ctrl = await fx.startActive();
    const result = await ctrl.handleRpcFrame(
      { v: 1, type: 'rpc', id: 'r-unknown', payload: { op: 'destroyAll', flowId: 'f' } },
      'peer-1',
    );
    expect(result.payload.ok).toBe(false);
    if (!result.payload.ok) expect(result.payload.reason).toBe('invalid_envelope');
    expect(fx.dispatched).toHaveLength(0);
  });

  it('returns invalid frame id when the unparsed envelope has no usable id', async () => {
    const fx = makeFixture({ kind: 'ok' });
    const ctrl = await fx.startActive();
    const result = await ctrl.handleRpcFrame({ garbage: true }, 'peer-1');
    expect(result.payload.ok).toBe(false);
    expect(result.id.length).toBeGreaterThan(0);
  });
});

describe('handleRpcFrame — outcome translation', () => {
  it("surfaces a `notFound` Outcome as rpc-result.ok:false with reason 'notFound'", async () => {
    const fx = makeFixture({ kind: 'notFound' });
    const ctrl = await fx.startActive();
    const result = await ctrl.handleRpcFrame(
      baseFrame('r-nf', { op: 'deleteNode', flowId: 'flow-a', nodeId: 'missing' }),
      'peer-1',
    );
    expect(result.payload.ok).toBe(false);
    if (!result.payload.ok) expect(result.payload.reason).toBe('notFound');
    expect(fx.audited).toHaveLength(1);
    expect(fx.audited[0]?.entry.ok).toBe(false);
    expect(fx.audited[0]?.entry.reason).toBe('notFound');
  });

  it('appends `: message` to the reason when the Outcome carries one', async () => {
    const fx = makeFixture({ kind: 'writeFailed', message: 'EBUSY' });
    const ctrl = await fx.startActive();
    const result = await ctrl.handleRpcFrame(
      baseFrame('r-wf', { op: 'deleteNode', flowId: 'flow-a', nodeId: 'n' }),
      'peer-1',
    );
    expect(result.payload.ok).toBe(false);
    if (!result.payload.ok) expect(result.payload.reason).toBe('writeFailed: EBUSY');
  });
});

describe('handleRpcFrame — state guard', () => {
  it('returns not_active when called before start()', async () => {
    const fx = makeFixture({ kind: 'ok' });
    const ctrl = createShareController({
      relayHttpUrl: 'https://relay.example',
      shareUrlBase: 'https://share.example',
      auditLogFactory: noopAuditFactory,
      appendShareAuditFn: (sessionId, entry) => fx.audited.push({ sessionId, entry }),
      rpcDispatcher: async (op) => {
        fx.dispatched.push(op);
        return { kind: 'ok' };
      },
    });
    const result = await ctrl.handleRpcFrame(
      baseFrame('r-na', { op: 'deleteNode', flowId: 'f', nodeId: 'n' }),
      'peer-1',
    );
    expect(result.payload.ok).toBe(false);
    if (!result.payload.ok) expect(result.payload.reason).toBe('not_active');
    expect(fx.dispatched).toHaveLength(0);
  });
});
