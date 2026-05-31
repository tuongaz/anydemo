import { describe, expect, it } from 'bun:test';
import {
  AddBulkOpSchema,
  AddConnectorOpSchema,
  AddNodeOpSchema,
  DeleteConnectorOpSchema,
  DeleteNodeOpSchema,
  MoveNodeOpSchema,
  PatchConnectorOpSchema,
  PatchNodeOpSchema,
  ReorderNodeOpSchema,
  RpcFrameSchema,
  RpcOpSchema,
  RpcResultFrameSchema,
} from './share-rpc-schema.ts';

describe('share-rpc-schema: per-op shape', () => {
  describe('addNode', () => {
    it('accepts { node: {…} }', () => {
      const ok = AddNodeOpSchema.safeParse({
        op: 'addNode',
        flowId: 'f1',
        node: { id: 'n1', type: 'rectangle' },
      });
      expect(ok.success).toBe(true);
    });
    it('rejects when node is missing', () => {
      const bad = AddNodeOpSchema.safeParse({ op: 'addNode', flowId: 'f1' });
      expect(bad.success).toBe(false);
    });
  });

  describe('patchNode', () => {
    it('accepts a patch record', () => {
      const ok = PatchNodeOpSchema.safeParse({
        op: 'patchNode',
        flowId: 'f1',
        nodeId: 'n1',
        patch: { name: 'foo' },
      });
      expect(ok.success).toBe(true);
    });
    it('rejects empty nodeId', () => {
      const bad = PatchNodeOpSchema.safeParse({
        op: 'patchNode',
        flowId: 'f1',
        nodeId: '',
        patch: {},
      });
      expect(bad.success).toBe(false);
    });
  });

  describe('moveNode', () => {
    it('accepts a finite x/y position', () => {
      const ok = MoveNodeOpSchema.safeParse({
        op: 'moveNode',
        flowId: 'f1',
        nodeId: 'n1',
        position: { x: 10, y: 20 },
      });
      expect(ok.success).toBe(true);
    });
    it('rejects NaN in position', () => {
      const bad = MoveNodeOpSchema.safeParse({
        op: 'moveNode',
        flowId: 'f1',
        nodeId: 'n1',
        position: { x: Number.NaN, y: 20 },
      });
      expect(bad.success).toBe(false);
    });
  });

  describe('reorderNode', () => {
    it('accepts { op: forward }', () => {
      const ok = ReorderNodeOpSchema.safeParse({
        op: 'reorderNode',
        flowId: 'f1',
        nodeId: 'n1',
        reorder: { op: 'forward' },
      });
      expect(ok.success).toBe(true);
    });
    it('rejects toIndex with negative index', () => {
      const bad = ReorderNodeOpSchema.safeParse({
        op: 'reorderNode',
        flowId: 'f1',
        nodeId: 'n1',
        reorder: { op: 'toIndex', index: -1 },
      });
      expect(bad.success).toBe(false);
    });
  });

  describe('deleteNode', () => {
    it('accepts { flowId, nodeId }', () => {
      const ok = DeleteNodeOpSchema.safeParse({
        op: 'deleteNode',
        flowId: 'f1',
        nodeId: 'n1',
      });
      expect(ok.success).toBe(true);
    });
    it('rejects an extra unknown field via .strict()', () => {
      const bad = DeleteNodeOpSchema.safeParse({
        op: 'deleteNode',
        flowId: 'f1',
        nodeId: 'n1',
        bogus: 'x',
      });
      expect(bad.success).toBe(false);
    });
  });

  describe('addConnector', () => {
    it('accepts { connector: {…} }', () => {
      const ok = AddConnectorOpSchema.safeParse({
        op: 'addConnector',
        flowId: 'f1',
        connector: { source: 'a', target: 'b' },
      });
      expect(ok.success).toBe(true);
    });
    it('rejects when connector is missing', () => {
      const bad = AddConnectorOpSchema.safeParse({ op: 'addConnector', flowId: 'f1' });
      expect(bad.success).toBe(false);
    });
  });

  describe('patchConnector', () => {
    it('accepts a patch record', () => {
      const ok = PatchConnectorOpSchema.safeParse({
        op: 'patchConnector',
        flowId: 'f1',
        connectorId: 'c1',
        patch: { label: 'hello' },
      });
      expect(ok.success).toBe(true);
    });
    it('rejects empty connectorId', () => {
      const bad = PatchConnectorOpSchema.safeParse({
        op: 'patchConnector',
        flowId: 'f1',
        connectorId: '',
        patch: {},
      });
      expect(bad.success).toBe(false);
    });
  });

  describe('deleteConnector', () => {
    it('accepts { flowId, connectorId }', () => {
      const ok = DeleteConnectorOpSchema.safeParse({
        op: 'deleteConnector',
        flowId: 'f1',
        connectorId: 'c1',
      });
      expect(ok.success).toBe(true);
    });
    it('rejects when connectorId is missing', () => {
      const bad = DeleteConnectorOpSchema.safeParse({
        op: 'deleteConnector',
        flowId: 'f1',
      });
      expect(bad.success).toBe(false);
    });
  });

  describe('addBulk', () => {
    it('accepts { nodes: [...] }', () => {
      const ok = AddBulkOpSchema.safeParse({
        op: 'addBulk',
        flowId: 'f1',
        nodes: [{ id: 'n1', type: 'rectangle' }],
      });
      expect(ok.success).toBe(true);
    });
    it('rejects when nodes exceeds the 100-item cap', () => {
      const tooMany = Array.from({ length: 101 }, (_, i) => ({ id: `n${i}` }));
      const bad = AddBulkOpSchema.safeParse({
        op: 'addBulk',
        flowId: 'f1',
        nodes: tooMany,
      });
      expect(bad.success).toBe(false);
    });
  });
});

describe('share-rpc-schema: cross-op pairing', () => {
  it('moveNode payload shape under addNode op literal fails', () => {
    // A valid moveNode body shape (nodeId + position) but with the addNode
    // op literal. AddNodeOpSchema requires `node` and is .strict() so the
    // extraneous `nodeId`/`position` keys also fail.
    const bad = RpcOpSchema.safeParse({
      op: 'addNode',
      flowId: 'f1',
      nodeId: 'n1',
      position: { x: 5, y: 5 },
    });
    expect(bad.success).toBe(false);
  });

  it('unknown op literal is rejected by the discriminator', () => {
    const bad = RpcOpSchema.safeParse({
      op: 'forgeNode',
      flowId: 'f1',
    });
    expect(bad.success).toBe(false);
  });

  it('addBulk op with no arrays parses (non-empty refine deferred to handler)', () => {
    // Schema-layer note: discriminatedUnion forbids ZodEffects, so the
    // FlowBulkBodySchema-style non-empty refine is NOT applied here.
    // Handler in US-038 enforces it before dispatching to addFlowBulkImpl.
    const empty = AddBulkOpSchema.safeParse({ op: 'addBulk', flowId: 'f1' });
    expect(empty.success).toBe(true);
  });
});

describe('share-rpc-schema: RpcFrame envelope', () => {
  it('accepts a full rpc frame', () => {
    const ok = RpcFrameSchema.safeParse({
      v: 1,
      type: 'rpc',
      id: 'r-1',
      payload: {
        op: 'moveNode',
        flowId: 'f1',
        nodeId: 'n1',
        position: { x: 1, y: 1 },
      },
    });
    expect(ok.success).toBe(true);
  });

  it('rejects v !== 1', () => {
    const bad = RpcFrameSchema.safeParse({
      v: 2,
      type: 'rpc',
      id: 'r-1',
      payload: { op: 'deleteNode', flowId: 'f1', nodeId: 'n1' },
    });
    expect(bad.success).toBe(false);
  });

  it('rejects empty id', () => {
    const bad = RpcFrameSchema.safeParse({
      v: 1,
      type: 'rpc',
      id: '',
      payload: { op: 'deleteNode', flowId: 'f1', nodeId: 'n1' },
    });
    expect(bad.success).toBe(false);
  });
});

describe('share-rpc-schema: RpcResultFrame', () => {
  it('accepts { ok: true } with optional result', () => {
    const ok = RpcResultFrameSchema.safeParse({
      v: 1,
      type: 'rpc-result',
      id: 'r-1',
      payload: { ok: true, result: { id: 'n1' } },
    });
    expect(ok.success).toBe(true);
  });

  it('accepts { ok: true } without result', () => {
    const ok = RpcResultFrameSchema.safeParse({
      v: 1,
      type: 'rpc-result',
      id: 'r-1',
      payload: { ok: true },
    });
    expect(ok.success).toBe(true);
  });

  it('accepts { ok: false, reason }', () => {
    const ok = RpcResultFrameSchema.safeParse({
      v: 1,
      type: 'rpc-result',
      id: 'r-1',
      payload: { ok: false, reason: 'notFound' },
    });
    expect(ok.success).toBe(true);
  });

  it('rejects { ok: false } without reason', () => {
    const bad = RpcResultFrameSchema.safeParse({
      v: 1,
      type: 'rpc-result',
      id: 'r-1',
      payload: { ok: false },
    });
    expect(bad.success).toBe(false);
  });
});
