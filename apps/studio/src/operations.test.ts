import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeFileAbsPath, nodeFileRef } from './node-files.ts';
import {
  NodePatchBodySchema,
  addNodeImpl,
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
