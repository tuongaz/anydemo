import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeFileAbsPath, nodeFileRef } from './node-files.ts';
import {
  NodePatchBodySchema,
  addConnectorImpl,
  addConnectorsBulkImpl,
  addNodeImpl,
  addNodesBulkImpl,
  deleteNodeImpl,
  getFlowImpl,
  mergeNodeUpdates,
  patchNodeImpl,
  registerFlowImpl,
  validateImpl,
} from './operations.ts';
import { createRegistry } from './registry.ts';

const STARTER_FLOW = {
  version: 2,
  name: 'Test Flow',
  nodes: [],
  connectors: [],
};

interface Setup {
  deps: { registry: ReturnType<typeof createRegistry> };
  flowId: string;
  repoPath: string;
  flowAbs: string;
}

async function setupProjectWithFlow(): Promise<Setup> {
  const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-ops-'));
  mkdirSync(join(repoDir, '.seeflow'), { recursive: true });
  const flowAbs = join(repoDir, '.seeflow', 'flow.json');
  writeFileSync(flowAbs, JSON.stringify(STARTER_FLOW));

  const registryDir = mkdtempSync(join(tmpdir(), 'seeflow-ops-reg-'));
  const registry = createRegistry({ path: join(registryDir, 'registry.json') });
  const deps = { registry };

  const reg = await registerFlowImpl(deps, {
    repoPath: repoDir,
    flowPath: '.seeflow/flow.json',
  });
  if (reg.kind !== 'ok') throw new Error(`registerFlowImpl failed: ${reg.kind}`);

  return { deps, flowId: reg.data.id, repoPath: repoDir, flowAbs };
}

describe('NodePatchBodySchema autoSize', () => {
  it('accepts autoSize: true', () => {
    const r = NodePatchBodySchema.safeParse({ autoSize: true });
    expect(r.success).toBe(true);
  });

  it('accepts autoSize: false alongside width/height', () => {
    const r = NodePatchBodySchema.safeParse({ autoSize: false, width: 480, height: 320 });
    expect(r.success).toBe(true);
  });

  it('rejects non-boolean autoSize', () => {
    const r = NodePatchBodySchema.safeParse({ autoSize: 'yes' });
    expect(r.success).toBe(false);
  });
});

describe('mergeNodeUpdates autoSize invariant', () => {
  it('flips autoSize to false when width is written', () => {
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'htmlNode',
      data: { html: '<p>a</p>' },
    };
    mergeNodeUpdates(node, { width: 480, height: 320 });
    expect(node.data).toMatchObject({ autoSize: false, width: 480, height: 320 });
  });

  it('strips width/height when autoSize: true is written', () => {
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'htmlNode',
      data: { html: '<p>a</p>', autoSize: false, width: 480, height: 320 },
    };
    mergeNodeUpdates(node, { autoSize: true });
    const data = node.data as Record<string, unknown>;
    expect(data.autoSize).toBe(true);
    expect(data.width).toBeUndefined();
    expect(data.height).toBeUndefined();
    expect('width' in data).toBe(false);
    expect('height' in data).toBe(false);
  });

  it('autoSize: true wins when both autoSize: true and width are in the same patch', () => {
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'htmlNode',
      data: { html: '<p>a</p>' },
    };
    mergeNodeUpdates(node, { autoSize: true, width: 500, height: 300 });
    const data = node.data as Record<string, unknown>;
    expect(data.autoSize).toBe(true);
    expect('width' in data).toBe(false);
    expect('height' in data).toBe(false);
  });

  it('autoSize: false alone (no width/height) is a no-op normalization-wise', () => {
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'htmlNode',
      data: { html: '<p>a</p>' },
    };
    mergeNodeUpdates(node, { autoSize: false });
    expect((node.data as Record<string, unknown>).autoSize).toBe(false);
  });

  it('leaves non-htmlNode patches unaffected (no spurious autoSize on shapeNode resize)', () => {
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'shapeNode',
      data: { shape: 'rectangle' },
    };
    mergeNodeUpdates(node, { width: 200, height: 100 });
    const data = node.data as Record<string, unknown>;
    expect(data.width).toBe(200);
    expect(data.height).toBe(100);
    expect('autoSize' in data).toBe(false);
  });
});

describe('validateImpl', () => {
  it('returns ok for valid flow + style', () => {
    const r = validateImpl({
      flow: {
        version: 2,
        name: 'T',
        nodes: [{ id: 'n', type: 'shapeNode', data: { shape: 'rectangle' } }],
        connectors: [],
      },
      style: { nodes: { n: { fontSize: 14 } } },
    });
    expect(r).toEqual({ ok: true });
  });

  it('returns flow-scoped issues on bad flow', () => {
    const r = validateImpl({
      flow: { version: 1, name: '', nodes: [], connectors: [] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.every((i) => i.scope === 'flow')).toBe(true);
  });

  it('returns style-scoped issues on bad style', () => {
    const r = validateImpl({
      flow: { version: 2, name: 'T', nodes: [], connectors: [] },
      style: { nodes: { x: { fontSize: -1 } } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.scope === 'style')).toBe(true);
  });

  it('flags style entries with no matching flow id', () => {
    const r = validateImpl({
      flow: { version: 2, name: 'T', nodes: [], connectors: [] },
      style: { nodes: { ghost: { fontSize: 14 } } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.find((i) => i.code === 'orphan_style_node')).toBeDefined();
  });
});

describe('addNodeImpl + detail externalization', () => {
  it('writes detail.md and stores file:// ref when detail is provided', async () => {
    const { deps, flowId, repoPath, flowAbs } = await setupProjectWithFlow();
    const res = await addNodeImpl(deps, flowId, {
      type: 'shapeNode',
      data: { name: 'A', shape: 'rectangle', detail: 'hello world' },
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    const nodeId = res.data.id;

    const detailAbs = nodeFileAbsPath(repoPath, nodeId, 'detail.md');
    expect(existsSync(detailAbs)).toBe(true);
    expect(readFileSync(detailAbs, 'utf8')).toBe('hello world');

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === nodeId);
    expect(node.data.detail).toBe(nodeFileRef(nodeId, 'detail.md'));
  });

  it('writes empty detail.md and stores file:// ref when detail is omitted', async () => {
    const { deps, flowId, repoPath, flowAbs } = await setupProjectWithFlow();
    const res = await addNodeImpl(deps, flowId, {
      type: 'shapeNode',
      data: { name: 'A', shape: 'rectangle' },
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    const nodeId = res.data.id;

    const detailAbs = nodeFileAbsPath(repoPath, nodeId, 'detail.md');
    expect(existsSync(detailAbs)).toBe(true);
    expect(readFileSync(detailAbs, 'utf8')).toBe('');

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === nodeId);
    expect(node.data.detail).toBe(nodeFileRef(nodeId, 'detail.md'));
  });

  it('get_flow returns resolved detail content, not the file:// ref', async () => {
    const { deps, flowId } = await setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'shapeNode',
      data: { name: 'A', shape: 'rectangle', detail: 'inlined-on-read' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');
    const get = await getFlowImpl(deps, flowId);
    if (get.kind !== 'ok' || !get.data.flow) throw new Error('get failed');
    const node = get.data.flow.nodes.find((n) => n.id === add.data.id);
    expect((node?.data as { detail?: string }).detail).toBe('inlined-on-read');
  });
});

describe('patchNodeImpl + detail externalization', () => {
  it('writes detail content to detail.md and keeps file:// ref in flow.json', async () => {
    const { deps, flowId, repoPath, flowAbs } = await setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'shapeNode',
      data: { name: 'A', shape: 'rectangle' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');
    const nodeId = add.data.id;

    const patch = await patchNodeImpl(deps, flowId, nodeId, { detail: 'new content' });
    expect(patch.kind).toBe('ok');

    const detailAbs = nodeFileAbsPath(repoPath, nodeId, 'detail.md');
    expect(readFileSync(detailAbs, 'utf8')).toBe('new content');

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === nodeId);
    expect(node.data.detail).toBe(nodeFileRef(nodeId, 'detail.md'));
  });

  it('empty-string detail empties the file but keeps the file:// ref', async () => {
    const { deps, flowId, repoPath, flowAbs } = await setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'shapeNode',
      data: { name: 'A', shape: 'rectangle', detail: 'starts non-empty' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');
    const nodeId = add.data.id;

    const patch = await patchNodeImpl(deps, flowId, nodeId, { detail: '' });
    expect(patch.kind).toBe('ok');

    const detailAbs = nodeFileAbsPath(repoPath, nodeId, 'detail.md');
    expect(readFileSync(detailAbs, 'utf8')).toBe('');

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === nodeId);
    expect(node.data.detail).toBe(nodeFileRef(nodeId, 'detail.md'));
  });

  it('empty-string description still clears the inline field (unchanged behavior)', async () => {
    const { deps, flowId, flowAbs } = await setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'shapeNode',
      data: { name: 'A', shape: 'rectangle', description: 'starts' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');
    const nodeId = add.data.id;

    await patchNodeImpl(deps, flowId, nodeId, { description: '' });
    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === nodeId);
    expect('description' in node.data).toBe(false);
  });

  it('patching an unrelated field preserves the detail file:// ref round-trip', async () => {
    const { deps, flowId, flowAbs } = await setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'shapeNode',
      data: { name: 'A', shape: 'rectangle', detail: 'survive' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');
    const nodeId = add.data.id;

    await patchNodeImpl(deps, flowId, nodeId, { name: 'A renamed' });

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === nodeId);
    expect(node.data.detail).toBe(nodeFileRef(nodeId, 'detail.md'));
    expect(node.data.name).toBe('A renamed');
  });
});

describe('deleteNodeImpl + per-node folder cascade', () => {
  it('removes nodes/<id>/ folder after flow.json write', async () => {
    const { deps, flowId, repoPath } = await setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'shapeNode',
      data: { name: 'A', shape: 'rectangle', detail: 'bye' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');
    const nodeId = add.data.id;
    const detailAbs = nodeFileAbsPath(repoPath, nodeId, 'detail.md');
    expect(existsSync(detailAbs)).toBe(true);

    const del = await deleteNodeImpl(deps, flowId, nodeId);
    expect(del.kind).toBe('ok');
    expect(existsSync(detailAbs)).toBe(false);
    expect(existsSync(join(repoPath, '.seeflow', 'nodes', nodeId))).toBe(false);
  });
});

describe('addNodesBulkImpl', () => {
  it('appends every node and externalizes per-item detail + html in one write', async () => {
    const { deps, flowId, repoPath, flowAbs } = await setupProjectWithFlow();
    const res = await addNodesBulkImpl(deps, flowId, {
      nodes: [
        { type: 'shapeNode', data: { name: 'A', shape: 'rectangle', detail: 'aye' } },
        { id: 'fixed-id', type: 'shapeNode', data: { name: 'B', shape: 'ellipse' } },
        { type: 'htmlNode', data: { html: '<div>hi</div>' } },
      ],
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.data.nodes).toHaveLength(3);
    expect(res.data.nodes[1]?.id).toBe('fixed-id');

    // detail.md / view.html landed under each node's folder.
    const aId = res.data.nodes[0]?.id;
    if (!aId) throw new Error('missing id');
    expect(readFileSync(nodeFileAbsPath(repoPath, aId, 'detail.md'), 'utf8')).toBe('aye');
    expect(readFileSync(nodeFileAbsPath(repoPath, 'fixed-id', 'detail.md'), 'utf8')).toBe('');
    const cId = res.data.nodes[2]?.id;
    if (!cId) throw new Error('missing id');
    expect(readFileSync(nodeFileAbsPath(repoPath, cId, 'view.html'), 'utf8')).toBe('<div>hi</div>');

    // flow.json carries file:// refs for all three.
    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    expect(flow.nodes).toHaveLength(3);
    expect(flow.nodes[0].data.detail).toBe(nodeFileRef(aId, 'detail.md'));
    expect(flow.nodes[2].data.html).toBe(nodeFileRef(cId, 'view.html'));
  });

  it('rolls back the whole batch when one item fails ResolvedFlowSchema', async () => {
    const { deps, flowId, repoPath, flowAbs } = await setupProjectWithFlow();
    const res = await addNodesBulkImpl(deps, flowId, {
      nodes: [
        { id: 'rollback-a', type: 'shapeNode', data: { name: 'good-1', shape: 'rectangle' } },
        // shapeNode requires `shape` — omitting it trips the post-mutation parse.
        { id: 'rollback-b', type: 'shapeNode', data: { name: 'bad-no-shape' } },
        { id: 'rollback-c', type: 'shapeNode', data: { name: 'good-2', shape: 'ellipse' } },
      ],
    });
    expect(res.kind).toBe('badSchema');

    // flow.json untouched.
    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    expect(flow.nodes).toHaveLength(0);
    // Every prepared per-node folder cleaned up — no orphans left behind.
    for (const id of ['rollback-a', 'rollback-b', 'rollback-c']) {
      expect(existsSync(join(repoPath, '.seeflow', 'nodes', id))).toBe(false);
    }
  });

  it('rejects intra-batch duplicate ids before touching disk', async () => {
    const { deps, flowId, flowAbs } = await setupProjectWithFlow();
    const res = await addNodesBulkImpl(deps, flowId, {
      nodes: [
        { id: 'dupe', type: 'shapeNode', data: { name: 'A', shape: 'rectangle' } },
        { id: 'dupe', type: 'shapeNode', data: { name: 'B', shape: 'ellipse' } },
      ],
    });
    expect(res.kind).toBe('duplicateIdInBatch');
    if (res.kind === 'duplicateIdInBatch') expect(res.id).toBe('dupe');
    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    expect(flow.nodes).toHaveLength(0);
  });

  it('rejects when an item id collides with an existing flow node', async () => {
    const { deps, flowId, flowAbs } = await setupProjectWithFlow();
    const seed = await addNodeImpl(deps, flowId, {
      id: 'taken',
      type: 'shapeNode',
      data: { name: 'seed', shape: 'rectangle' },
    });
    if (seed.kind !== 'ok') throw new Error('seed failed');

    const res = await addNodesBulkImpl(deps, flowId, {
      nodes: [{ id: 'taken', type: 'shapeNode', data: { name: 'X', shape: 'ellipse' } }],
    });
    expect(res.kind).toBe('idAlreadyExists');
    if (res.kind === 'idAlreadyExists') expect(res.id).toBe('taken');

    // Seed node is the only node on disk.
    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    expect(flow.nodes).toHaveLength(1);
  });

  it('returns flowNotFound for an unknown flowId', async () => {
    const { deps } = await setupProjectWithFlow();
    const res = await addNodesBulkImpl(deps, 'no-such-flow', {
      nodes: [{ type: 'shapeNode', data: { name: 'X', shape: 'rectangle' } }],
    });
    expect(res.kind).toBe('flowNotFound');
  });
});

describe('addConnectorsBulkImpl', () => {
  it('appends every connector and defaults id/kind per item', async () => {
    const { deps, flowId, flowAbs } = await setupProjectWithFlow();
    const a = await addNodeImpl(deps, flowId, {
      id: 'a',
      type: 'shapeNode',
      data: { name: 'A', shape: 'rectangle' },
    });
    const b = await addNodeImpl(deps, flowId, {
      id: 'b',
      type: 'shapeNode',
      data: { name: 'B', shape: 'rectangle' },
    });
    if (a.kind !== 'ok' || b.kind !== 'ok') throw new Error('seed failed');

    const res = await addConnectorsBulkImpl(deps, flowId, {
      connectors: [
        { source: 'a', target: 'b', kind: 'event', eventName: 'thing.happened' },
        { id: 'pinned', source: 'b', target: 'a' },
      ],
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.data.connectors).toHaveLength(2);
    expect(res.data.connectors[1]?.id).toBe('pinned');

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    expect(flow.connectors).toHaveLength(2);
    expect(flow.connectors[0].kind).toBe('event');
    // Item without an explicit kind defaulted to 'default'.
    expect(flow.connectors[1].kind).toBe('default');
  });

  it('rolls back the whole batch when one connector has a dangling target', async () => {
    const { deps, flowId, flowAbs } = await setupProjectWithFlow();
    const a = await addNodeImpl(deps, flowId, {
      id: 'a',
      type: 'shapeNode',
      data: { name: 'A', shape: 'rectangle' },
    });
    if (a.kind !== 'ok') throw new Error('seed failed');

    const res = await addConnectorsBulkImpl(deps, flowId, {
      connectors: [
        { source: 'a', target: 'a' },
        { source: 'a', target: 'no-such-node' },
      ],
    });
    expect(res.kind).toBe('badSchema');
    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    expect(flow.connectors).toHaveLength(0);
  });

  it('rejects intra-batch duplicate ids before touching disk', async () => {
    const { deps, flowId, flowAbs } = await setupProjectWithFlow();
    const a = await addNodeImpl(deps, flowId, {
      id: 'a',
      type: 'shapeNode',
      data: { name: 'A', shape: 'rectangle' },
    });
    if (a.kind !== 'ok') throw new Error('seed failed');

    const res = await addConnectorsBulkImpl(deps, flowId, {
      connectors: [
        { id: 'c-dupe', source: 'a', target: 'a' },
        { id: 'c-dupe', source: 'a', target: 'a' },
      ],
    });
    expect(res.kind).toBe('duplicateIdInBatch');
    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    expect(flow.connectors).toHaveLength(0);
  });

  it('rejects when an item id collides with an existing connector', async () => {
    const { deps, flowId, flowAbs } = await setupProjectWithFlow();
    const a = await addNodeImpl(deps, flowId, {
      id: 'a',
      type: 'shapeNode',
      data: { name: 'A', shape: 'rectangle' },
    });
    if (a.kind !== 'ok') throw new Error('seed failed');
    const seed = await addConnectorImpl(deps, flowId, { id: 'c-taken', source: 'a', target: 'a' });
    if (seed.kind !== 'ok') throw new Error('seed connector failed');

    const res = await addConnectorsBulkImpl(deps, flowId, {
      connectors: [{ id: 'c-taken', source: 'a', target: 'a' }],
    });
    expect(res.kind).toBe('idAlreadyExists');
    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    expect(flow.connectors).toHaveLength(1);
  });
});

describe('NodePatchBodySchema — action overlays', () => {
  it('accepts playAction in the patch body', () => {
    const parsed = NodePatchBodySchema.safeParse({
      playAction: {
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/play.ts',
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts statusAction in the patch body', () => {
    const parsed = NodePatchBodySchema.safeParse({
      statusAction: {
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/status.ts',
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts stateSource in the patch body', () => {
    const parsed = NodePatchBodySchema.safeParse({
      stateSource: { kind: 'request' },
    });
    expect(parsed.success).toBe(true);
  });

  it('mergeNodeUpdates writes playAction onto node.data', () => {
    const node: Record<string, unknown> = { id: 'n1', type: 'playNode', data: {} };
    mergeNodeUpdates(node, {
      playAction: {
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/play.ts',
      },
    });
    expect((node.data as Record<string, unknown>).playAction).toEqual({
      kind: 'script',
      interpreter: 'bun',
      scriptPath: 'scripts/play.ts',
    });
  });

  it('rejects unknown top-level keys (strict guarantee preserved)', () => {
    const parsed = NodePatchBodySchema.safeParse({ bogus: 1 });
    expect(parsed.success).toBe(false);
  });
});
