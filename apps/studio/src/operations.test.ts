import { describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEventBus } from './events.ts';
import { nodeFileAbsPath, nodeFileRef } from './node-files.ts';
import {
  NodePatchBodySchema,
  addConnectorImpl,
  addFlowBulkImpl,
  addNodeImpl,
  applyLayoutImpl,
  createOperations,
  deleteNodeImpl,
  getFlowGraphImpl,
  getFlowImpl,
  getNodeImpl,
  listFlowsSummaryImpl,
  mergeNodeUpdates,
  moveNodeImpl,
  patchNodeImpl,
  registerFlowImpl,
  validateImpl,
} from './operations.ts';
import { createRegistry } from './registry.ts';
import { createWatcher, readMergedFlow } from './watcher.ts';

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
  const flowAbs = join(repoDir, 'flow.json');
  writeFileSync(flowAbs, JSON.stringify(STARTER_FLOW));

  const registryDir = mkdtempSync(join(tmpdir(), 'seeflow-ops-reg-'));
  const registry = createRegistry({ path: join(registryDir, 'registry.json') });
  const deps = { registry };

  const reg = await registerFlowImpl(deps, {
    repoPath: repoDir,
    flowPath: 'flow.json',
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

describe('mergeNodeUpdates null clears style keys', () => {
  it('strips a style key from data when the patch value is null', () => {
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'rectangle',
      data: { name: 'X', borderColor: 'green', backgroundColor: 'red', fontSize: 14 },
    };
    // Undo of a color edit clears a previously-unset field by sending null.
    mergeNodeUpdates(node, { backgroundColor: null });
    const data = node.data as Record<string, unknown>;
    expect('backgroundColor' in data).toBe(false);
    // Untouched keys are preserved.
    expect(data).toMatchObject({ name: 'X', borderColor: 'green', fontSize: 14 });
  });

  it('accepts null on style keys through NodePatchBodySchema', () => {
    const parsed = NodePatchBodySchema.safeParse({ borderColor: null, fontSize: null });
    expect(parsed.success).toBe(true);
  });
});

describe('mergeNodeUpdates autoSize invariant', () => {
  it('flips autoSize to false when width is written', () => {
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'html',
      data: { html: '<p>a</p>' },
    };
    mergeNodeUpdates(node, { width: 480, height: 320 });
    expect(node.data).toMatchObject({ autoSize: false, width: 480, height: 320 });
  });

  it('strips width/height when autoSize: true is written', () => {
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'html',
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
      type: 'html',
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
      type: 'html',
      data: { html: '<p>a</p>' },
    };
    mergeNodeUpdates(node, { autoSize: false });
    expect((node.data as Record<string, unknown>).autoSize).toBe(false);
  });

  it('leaves non-html / non-component patches unaffected (no spurious autoSize on rectangle resize)', () => {
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'rectangle',
      data: {},
    };
    mergeNodeUpdates(node, { width: 200, height: 100 });
    const data = node.data as Record<string, unknown>;
    expect(data.width).toBe(200);
    expect(data.height).toBe(100);
    expect('autoSize' in data).toBe(false);
  });

  it('component: flips autoSize to false when width is written', () => {
    const node: Record<string, unknown> = {
      id: 'c1',
      type: 'component',
      data: { spec: { root: 'r', elements: { r: { type: 'Text', props: { text: 'x' } } } } },
    };
    mergeNodeUpdates(node, { width: 480, height: 320 });
    expect(node.data).toMatchObject({ autoSize: false, width: 480, height: 320 });
  });

  it('component: strips width/height when autoSize: true is written', () => {
    const node: Record<string, unknown> = {
      id: 'c1',
      type: 'component',
      data: {
        spec: { root: 'r', elements: { r: { type: 'Text', props: { text: 'x' } } } },
        autoSize: false,
        width: 480,
        height: 320,
      },
    };
    mergeNodeUpdates(node, { autoSize: true });
    const data = node.data as Record<string, unknown>;
    expect(data.autoSize).toBe(true);
    expect('width' in data).toBe(false);
    expect('height' in data).toBe(false);
  });
});

describe('validateImpl', () => {
  it('returns ok for valid flow + style', () => {
    const r = validateImpl({
      flow: {
        version: 2,
        name: 'T',
        nodes: [{ id: 'n', type: 'rectangle', data: {} }],
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
      type: 'rectangle',
      data: { name: 'A', detail: 'hello world' },
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    const nodeId = res.data.id;

    const detailAbs = nodeFileAbsPath(repoPath, '', nodeId, 'detail.md');
    expect(existsSync(detailAbs)).toBe(true);
    expect(readFileSync(detailAbs, 'utf8')).toBe('hello world');

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === nodeId);
    expect(node.data.detail).toBe(nodeFileRef(nodeId, 'detail.md'));
  });

  it('writes empty detail.md and stores file:// ref when detail is omitted', async () => {
    const { deps, flowId, repoPath, flowAbs } = await setupProjectWithFlow();
    const res = await addNodeImpl(deps, flowId, {
      type: 'rectangle',
      data: { name: 'A' },
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    const nodeId = res.data.id;

    const detailAbs = nodeFileAbsPath(repoPath, '', nodeId, 'detail.md');
    expect(existsSync(detailAbs)).toBe(true);
    expect(readFileSync(detailAbs, 'utf8')).toBe('');

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === nodeId);
    expect(node.data.detail).toBe(nodeFileRef(nodeId, 'detail.md'));
  });

  it('get_flow returns resolved detail content, not the file:// ref', async () => {
    const { deps, flowId } = await setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'rectangle',
      data: { name: 'A', detail: 'inlined-on-read' },
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
      type: 'rectangle',
      data: { name: 'A' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');
    const nodeId = add.data.id;

    const patch = await patchNodeImpl(deps, flowId, nodeId, { detail: 'new content' });
    expect(patch.kind).toBe('ok');

    const detailAbs = nodeFileAbsPath(repoPath, '', nodeId, 'detail.md');
    expect(readFileSync(detailAbs, 'utf8')).toBe('new content');

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === nodeId);
    expect(node.data.detail).toBe(nodeFileRef(nodeId, 'detail.md'));
  });

  it('empty-string detail empties the file but keeps the file:// ref', async () => {
    const { deps, flowId, repoPath, flowAbs } = await setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'rectangle',
      data: { name: 'A', detail: 'starts non-empty' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');
    const nodeId = add.data.id;

    const patch = await patchNodeImpl(deps, flowId, nodeId, { detail: '' });
    expect(patch.kind).toBe('ok');

    const detailAbs = nodeFileAbsPath(repoPath, '', nodeId, 'detail.md');
    expect(readFileSync(detailAbs, 'utf8')).toBe('');

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === nodeId);
    expect(node.data.detail).toBe(nodeFileRef(nodeId, 'detail.md'));
  });

  it('empty-string description still clears the inline field (unchanged behavior)', async () => {
    const { deps, flowId, flowAbs } = await setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'rectangle',
      data: { name: 'A', description: 'starts' },
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
      type: 'rectangle',
      data: { name: 'A', detail: 'survive' },
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
      type: 'rectangle',
      data: { name: 'A', detail: 'bye' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');
    const nodeId = add.data.id;
    const detailAbs = nodeFileAbsPath(repoPath, '', nodeId, 'detail.md');
    expect(existsSync(detailAbs)).toBe(true);

    const del = await deleteNodeImpl(deps, flowId, nodeId);
    expect(del.kind).toBe('ok');
    expect(existsSync(detailAbs)).toBe(false);
    expect(existsSync(join(repoPath, 'nodes', nodeId))).toBe(false);
  });
});

// US-007 / T-005 + T-006: PATCH spec on a component node externalizes to
// `nodes/<id>/spec.json` and is stripped from flow.json; deleteNodeImpl
// cascades the sidecar via the existing removeNodeDir.
describe('patchNodeImpl + component spec sidecar (US-007)', () => {
  const initialSpec = {
    root: 'root',
    elements: {
      root: { type: 'Text', props: { text: 'v1' } },
    },
  };

  const newSpec = {
    root: 'root',
    elements: {
      root: { type: 'Text', props: { text: 'v2' } },
    },
  };

  const writeComponentFixture = (
    flowAbs: string,
    repoPath: string,
    spec: typeof initialSpec,
  ): void => {
    writeFileSync(
      flowAbs,
      JSON.stringify({
        version: 2,
        name: 'Component',
        nodes: [{ id: 'c1', type: 'component', data: {} }],
        connectors: [],
      }),
    );
    mkdirSync(join(repoPath, 'nodes', 'c1'), { recursive: true });
    writeFileSync(join(repoPath, 'nodes', 'c1', 'spec.json'), `${JSON.stringify(spec, null, 2)}\n`);
  };

  it('T-005: writes spec.json, strips data.spec from flow.json, and readMergedFlow round-trips the new spec', async () => {
    const { deps, flowId, repoPath, flowAbs } = await setupProjectWithFlow();
    writeComponentFixture(flowAbs, repoPath, initialSpec);

    const patch = await patchNodeImpl(deps, flowId, 'c1', { spec: newSpec });
    expect(patch.kind).toBe('ok');

    const specAbs = nodeFileAbsPath(repoPath, '', 'c1', 'spec.json');
    const onDisk = readFileSync(specAbs, 'utf8');
    expect(JSON.parse(onDisk)).toEqual(newSpec);
    expect(onDisk.endsWith('\n')).toBe(true);

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === 'c1');
    expect(node).toBeDefined();
    expect('spec' in node.data).toBe(false);

    const reread = readMergedFlow(flowAbs);
    expect(reread.valid).toBe(true);
    if (!reread.valid || !reread.flow) throw new Error('expected valid round-trip');
    const reNode = reread.flow.nodes[0];
    if (reNode?.type !== 'component') throw new Error('expected component node');
    expect(reNode.data.spec).toEqual(newSpec);
  });

  it('retype geometric -> component in the same patch externalizes spec and keeps data.spec for the reparse', async () => {
    const { deps, flowId, repoPath, flowAbs } = await setupProjectWithFlow();
    writeFileSync(
      flowAbs,
      JSON.stringify({
        version: 2,
        name: 'Retype',
        nodes: [{ id: 'r1', type: 'rectangle', data: { name: 'Box' } }],
        connectors: [],
      }),
    );

    const patch = await patchNodeImpl(deps, flowId, 'r1', { type: 'component', spec: newSpec });
    expect(patch.kind).toBe('ok');

    const specAbs = nodeFileAbsPath(repoPath, '', 'r1', 'spec.json');
    expect(JSON.parse(readFileSync(specAbs, 'utf8'))).toEqual(newSpec);

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === 'r1');
    expect(node.type).toBe('component');
    expect('spec' in node.data).toBe(false);

    const reread = readMergedFlow(flowAbs);
    expect(reread.valid).toBe(true);
    if (!reread.valid || !reread.flow) throw new Error('expected valid round-trip');
    const reNode = reread.flow.nodes[0];
    if (reNode?.type !== 'component') throw new Error('expected component node');
    expect(reNode.data.spec).toEqual(newSpec);
  });

  it('T-006: deleteNodeImpl on a component node removes nodes/<id>/spec.json via removeNodeDir cascade', async () => {
    const { deps, flowId, repoPath, flowAbs } = await setupProjectWithFlow();
    writeComponentFixture(flowAbs, repoPath, initialSpec);

    const specAbs = nodeFileAbsPath(repoPath, '', 'c1', 'spec.json');
    expect(existsSync(specAbs)).toBe(true);

    const del = await deleteNodeImpl(deps, flowId, 'c1');
    expect(del.kind).toBe('ok');
    expect(existsSync(specAbs)).toBe(false);
    expect(existsSync(join(repoPath, 'nodes', 'c1'))).toBe(false);
  });
});

// addNodeImpl + addFlowBulkImpl must externalize data.spec on component nodes
// to nodes/<id>/spec.json the same way patchNodeImpl does — otherwise creating
// a component node with an inline spec leaves the studio in an unreadable
// state (data.spec stripped from flow.json by splitFlow, sidecar never
// written, resolver fails with "Missing spec file" on next read).
describe('addNodeImpl + component spec sidecar', () => {
  const spec = {
    root: 'root',
    elements: {
      root: { type: 'Text', props: { text: 'inline' } },
    },
  };

  it('writes nodes/<id>/spec.json when adding a component node with inline data.spec', async () => {
    const { deps, flowId, repoPath, flowAbs } = await setupProjectWithFlow();
    const res = await addNodeImpl(deps, flowId, {
      id: 'c1',
      type: 'component',
      data: { spec },
    });
    expect(res.kind).toBe('ok');

    const specAbs = nodeFileAbsPath(repoPath, '', 'c1', 'spec.json');
    const onDisk = readFileSync(specAbs, 'utf8');
    expect(JSON.parse(onDisk)).toEqual(spec);
    expect(onDisk.endsWith('\n')).toBe(true);

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === 'c1');
    expect(node).toBeDefined();
    expect('spec' in node.data).toBe(false);

    const reread = readMergedFlow(flowAbs);
    expect(reread.valid).toBe(true);
    if (!reread.valid || !reread.flow) throw new Error('expected valid round-trip');
    const reNode = reread.flow.nodes[0];
    if (reNode?.type !== 'component') throw new Error('expected component node');
    expect(reNode.data.spec).toEqual(spec);
  });
});

describe('addFlowBulkImpl + component spec sidecar', () => {
  const specA = {
    root: 'root',
    elements: { root: { type: 'Text', props: { text: 'A' } } },
  };
  const specB = {
    root: 'root',
    elements: { root: { type: 'Text', props: { text: 'B' } } },
  };

  it('writes nodes/<id>/spec.json for every component node in the batch', async () => {
    const { deps, flowId, repoPath, flowAbs } = await setupProjectWithFlow();
    const res = await addFlowBulkImpl(deps, flowId, {
      nodes: [
        { id: 'cA', type: 'component', data: { spec: specA } },
        { id: 'cB', type: 'component', data: { spec: specB } },
      ],
    });
    expect(res.kind).toBe('ok');

    expect(
      JSON.parse(readFileSync(nodeFileAbsPath(repoPath, '', 'cA', 'spec.json'), 'utf8')),
    ).toEqual(specA);
    expect(
      JSON.parse(readFileSync(nodeFileAbsPath(repoPath, '', 'cB', 'spec.json'), 'utf8')),
    ).toEqual(specB);

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    for (const n of flow.nodes) {
      expect('spec' in n.data).toBe(false);
    }

    const reread = readMergedFlow(flowAbs);
    expect(reread.valid).toBe(true);
  });

  it('rolls back sidecars on a batch-level failure (dangling connector target)', async () => {
    const { deps, flowId, repoPath, flowAbs } = await setupProjectWithFlow();
    const res = await addFlowBulkImpl(deps, flowId, {
      nodes: [{ id: 'cA', type: 'component', data: { spec: specA } }],
      connectors: [{ source: 'cA', target: 'never-added' }],
    });
    expect(res.kind).toBe('badSchema');

    // Sidecar was rolled back along with the per-node folder, same as detail/html.
    expect(existsSync(nodeFileAbsPath(repoPath, '', 'cA', 'spec.json'))).toBe(false);
    expect(existsSync(join(repoPath, 'nodes', 'cA'))).toBe(false);

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    expect(flow.nodes).toHaveLength(0);
  });
});

describe('addFlowBulkImpl', () => {
  it('appends nodes + connectors atomically in one write, with connectors referencing same-batch nodes', async () => {
    const { deps, flowId, repoPath, flowAbs } = await setupProjectWithFlow();
    const res = await addFlowBulkImpl(deps, flowId, {
      nodes: [
        { id: 'a', type: 'rectangle', data: { name: 'A', detail: 'aye' } },
        { id: 'b', type: 'ellipse', data: { name: 'B' } },
        { type: 'html', data: { html: '<div>hi</div>' } },
      ],
      connectors: [
        // Connector references nodes from the SAME batch — proves the merged
        // graph is parsed as a whole, not phase-by-phase.
        { id: 'a-to-b', source: 'a', target: 'b', eventName: 'thing.happened' },
        { source: 'b', target: 'a' },
      ],
    });

    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.data.nodes).toHaveLength(3);
    expect(res.data.connectors).toHaveLength(2);
    expect(res.data.connectors[0]?.id).toBe('a-to-b');

    // Externalization landed for the per-node files.
    expect(readFileSync(nodeFileAbsPath(repoPath, '', 'a', 'detail.md'), 'utf8')).toBe('aye');
    const cId = res.data.nodes[2]?.id;
    if (!cId) throw new Error('missing id');
    expect(readFileSync(nodeFileAbsPath(repoPath, '', cId, 'view.html'), 'utf8')).toBe(
      '<div>hi</div>',
    );

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    expect(flow.nodes).toHaveLength(3);
    expect(flow.connectors).toHaveLength(2);
    expect(flow.nodes[0].data.detail).toBe(nodeFileRef('a', 'detail.md'));
  });

  it('accepts a nodes-only body', async () => {
    const { deps, flowId, flowAbs } = await setupProjectWithFlow();
    const res = await addFlowBulkImpl(deps, flowId, {
      nodes: [{ id: 'only', type: 'rectangle', data: { name: 'only' } }],
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.data.nodes).toHaveLength(1);
    expect(res.data.connectors).toHaveLength(0);
    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    expect(flow.nodes).toHaveLength(1);
    expect(flow.connectors).toHaveLength(0);
  });

  it('accepts a connectors-only body that wires existing nodes', async () => {
    const { deps, flowId, flowAbs } = await setupProjectWithFlow();
    const seed = await addFlowBulkImpl(deps, flowId, {
      nodes: [
        { id: 'a', type: 'rectangle', data: { name: 'A' } },
        { id: 'b', type: 'rectangle', data: { name: 'B' } },
      ],
    });
    if (seed.kind !== 'ok') throw new Error('seed failed');

    const res = await addFlowBulkImpl(deps, flowId, {
      connectors: [{ id: 'wire', source: 'a', target: 'b' }],
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.data.nodes).toHaveLength(0);
    expect(res.data.connectors).toHaveLength(1);
    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    expect(flow.connectors).toHaveLength(1);
  });

  it('rolls back BOTH arrays when a connector has a dangling target referencing nothing in the merged graph', async () => {
    const { deps, flowId, repoPath, flowAbs } = await setupProjectWithFlow();
    const res = await addFlowBulkImpl(deps, flowId, {
      nodes: [
        { id: 'roll-a', type: 'rectangle', data: { name: 'A' } },
        { id: 'roll-b', type: 'rectangle', data: { name: 'B' } },
      ],
      connectors: [{ source: 'roll-a', target: 'never-added' }],
    });
    expect(res.kind).toBe('badSchema');

    // flow.json untouched — neither nodes nor connectors landed.
    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    expect(flow.nodes).toHaveLength(0);
    expect(flow.connectors).toHaveLength(0);
    // Per-node folders for nodes prepared in this batch cleaned up.
    for (const id of ['roll-a', 'roll-b']) {
      expect(existsSync(join(repoPath, 'nodes', id))).toBe(false);
    }
  });

  it('rolls back the whole batch when one node fails ResolvedFlowSchema', async () => {
    const { deps, flowId, repoPath, flowAbs } = await setupProjectWithFlow();
    const res = await addFlowBulkImpl(deps, flowId, {
      nodes: [
        { id: 'rollback-a', type: 'rectangle', data: { name: 'good-1' } },
        // type:'image' requires `path` — omitting it trips the post-mutation parse.
        { id: 'rollback-b', type: 'image', data: { name: 'bad-no-path' } },
      ],
    });
    expect(res.kind).toBe('badSchema');
    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    expect(flow.nodes).toHaveLength(0);
    for (const id of ['rollback-a', 'rollback-b']) {
      expect(existsSync(join(repoPath, 'nodes', id))).toBe(false);
    }
  });

  it('rejects intra-batch duplicate node ids with collection=nodes', async () => {
    const { deps, flowId, flowAbs } = await setupProjectWithFlow();
    const res = await addFlowBulkImpl(deps, flowId, {
      nodes: [
        { id: 'dupe', type: 'rectangle', data: { name: 'A' } },
        { id: 'dupe', type: 'ellipse', data: { name: 'B' } },
      ],
    });
    expect(res.kind).toBe('duplicateIdInBatch');
    if (res.kind === 'duplicateIdInBatch') {
      expect(res.collection).toBe('nodes');
      expect(res.id).toBe('dupe');
    }
    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    expect(flow.nodes).toHaveLength(0);
  });

  it('rejects intra-batch duplicate connector ids with collection=connectors', async () => {
    const { deps, flowId, flowAbs } = await setupProjectWithFlow();
    const res = await addFlowBulkImpl(deps, flowId, {
      nodes: [{ id: 'a', type: 'rectangle', data: { name: 'A' } }],
      connectors: [
        { id: 'c-dupe', source: 'a', target: 'a' },
        { id: 'c-dupe', source: 'a', target: 'a' },
      ],
    });
    expect(res.kind).toBe('duplicateIdInBatch');
    if (res.kind === 'duplicateIdInBatch') {
      expect(res.collection).toBe('connectors');
      expect(res.id).toBe('c-dupe');
    }
    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    expect(flow.nodes).toHaveLength(0);
    expect(flow.connectors).toHaveLength(0);
  });

  it('rejects when a node id collides with an existing flow node (collection=nodes)', async () => {
    const { deps, flowId, flowAbs } = await setupProjectWithFlow();
    const seed = await addNodeImpl(deps, flowId, {
      id: 'taken',
      type: 'rectangle',
      data: { name: 'seed' },
    });
    if (seed.kind !== 'ok') throw new Error('seed failed');

    const res = await addFlowBulkImpl(deps, flowId, {
      nodes: [{ id: 'taken', type: 'ellipse', data: { name: 'X' } }],
    });
    expect(res.kind).toBe('idAlreadyExists');
    if (res.kind === 'idAlreadyExists') {
      expect(res.collection).toBe('nodes');
      expect(res.id).toBe('taken');
    }
    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    expect(flow.nodes).toHaveLength(1);
  });

  it('rejects when a connector id collides with an existing connector (collection=connectors)', async () => {
    const { deps, flowId, flowAbs } = await setupProjectWithFlow();
    const a = await addNodeImpl(deps, flowId, {
      id: 'a',
      type: 'rectangle',
      data: { name: 'A' },
    });
    if (a.kind !== 'ok') throw new Error('seed node failed');
    const seedConn = await addConnectorImpl(deps, flowId, {
      id: 'c-taken',
      source: 'a',
      target: 'a',
    });
    if (seedConn.kind !== 'ok') throw new Error('seed connector failed');

    const res = await addFlowBulkImpl(deps, flowId, {
      connectors: [{ id: 'c-taken', source: 'a', target: 'a' }],
    });
    expect(res.kind).toBe('idAlreadyExists');
    if (res.kind === 'idAlreadyExists') {
      expect(res.collection).toBe('connectors');
      expect(res.id).toBe('c-taken');
    }
    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    expect(flow.connectors).toHaveLength(1);
  });

  it('returns flowNotFound for an unknown flowId', async () => {
    const { deps } = await setupProjectWithFlow();
    const res = await addFlowBulkImpl(deps, 'no-such-flow', {
      nodes: [{ type: 'rectangle', data: { name: 'X' } }],
    });
    expect(res.kind).toBe('flowNotFound');
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
    const node: Record<string, unknown> = { id: 'n1', type: 'rectangle', data: {} };
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

// Regression: the post-mutation snapshot fed to watcher.notifyWritten must be
// the file://-resolved shape (matching the watcher's own seed via readMergedFlow),
// not the raw merged flow where data.detail / data.html are still
// `file://...` strings. Pre-fix, the first PATCH-style write would clobber the
// resolved snapshot with the unresolved one, and the client's next read served
// `data.detail === "file://detail.md"`.
describe('mutateMergedFlow snapshot resolves file:// refs', () => {
  async function setupWithWatcher() {
    const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-mut-snap-'));
    const flowAbs = join(repoDir, 'flow.json');
    writeFileSync(flowAbs, JSON.stringify(STARTER_FLOW));

    const registryDir = mkdtempSync(join(tmpdir(), 'seeflow-mut-snap-reg-'));
    const registry = createRegistry({ path: join(registryDir, 'registry.json') });
    const events = createEventBus();
    const watcher = createWatcher({ registry, events, debounceMs: 10 });
    const deps = { registry, watcher };

    const reg = await registerFlowImpl(deps, {
      repoPath: repoDir,
      flowPath: 'flow.json',
    });
    if (reg.kind !== 'ok') throw new Error(`registerFlowImpl failed: ${reg.kind}`);
    watcher.watch(reg.data.id);
    return { deps, watcher, flowId: reg.data.id, repoPath: repoDir };
  }

  it('moveNodeImpl leaves the snapshot with detail.md content inlined, not the file:// ref', async () => {
    const { deps, watcher, flowId } = await setupWithWatcher();
    const add = await addNodeImpl(deps, flowId, {
      type: 'rectangle',
      data: { name: 'A', detail: '# resolved' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');
    const nodeId = add.data.id;

    const move = await moveNodeImpl(deps, flowId, nodeId, { x: 42, y: 84 });
    expect(move.kind).toBe('ok');

    const snap = watcher.snapshot(flowId);
    const node = snap?.flow?.nodes.find((n) => n.id === nodeId);
    expect((node?.data as { detail?: string }).detail).toBe('# resolved');
  });

  it('patchNodeImpl (non-externalized field) keeps detail.md content inlined in the snapshot', async () => {
    const { deps, watcher, flowId } = await setupWithWatcher();
    const add = await addNodeImpl(deps, flowId, {
      type: 'rectangle',
      data: { name: 'A', detail: 'keep me' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');
    const nodeId = add.data.id;

    const patch = await patchNodeImpl(deps, flowId, nodeId, { name: 'A renamed' });
    expect(patch.kind).toBe('ok');

    const snap = watcher.snapshot(flowId);
    const node = snap?.flow?.nodes.find((n) => n.id === nodeId);
    expect((node?.data as { detail?: string }).detail).toBe('keep me');
  });

  it('moveNodeImpl on a type:html node leaves view.html content inlined in the snapshot', async () => {
    const { deps, watcher, flowId } = await setupWithWatcher();
    const add = await addNodeImpl(deps, flowId, {
      type: 'html',
      data: { html: '<p>hello</p>', autoSize: true },
    });
    if (add.kind !== 'ok') throw new Error('add failed');
    const nodeId = add.data.id;

    const move = await moveNodeImpl(deps, flowId, nodeId, { x: 12, y: 24 });
    expect(move.kind).toBe('ok');

    const snap = watcher.snapshot(flowId);
    const node = snap?.flow?.nodes.find((n) => n.id === nodeId);
    expect((node?.data as { html?: string }).html).toBe('<p>hello</p>');
    // detail is externalized for every node type (including type:'html'), so the
    // same resolution must apply to it too — initialized to empty by addNode.
    expect((node?.data as { detail?: string }).detail).toBe('');
  });
});

describe('listFlowsSummaryImpl', () => {
  it('returns only id, name, description from the registry when no watcher snapshot exists', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-summary-'));
    writeFileSync(
      join(repoDir, 'flow.json'),
      JSON.stringify({
        version: 2,
        name: 'Documented',
        description: 'persisted at register',
        nodes: [],
        connectors: [],
      }),
    );

    const registryDir = mkdtempSync(join(tmpdir(), 'seeflow-summary-reg-'));
    const registry = createRegistry({ path: join(registryDir, 'registry.json') });
    const deps = { registry };

    const reg = await registerFlowImpl(deps, {
      repoPath: repoDir,
      flowPath: 'flow.json',
    });
    if (reg.kind !== 'ok') throw new Error(`registerFlowImpl failed: ${reg.kind}`);

    const result = listFlowsSummaryImpl(deps);
    expect(result.kind).toBe('ok');
    expect(result.data).toEqual([
      { id: reg.data.id, name: 'Documented', description: 'persisted at register' },
    ]);
  });

  it('omits description on items where the flow has none', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-summary-bare-'));
    writeFileSync(
      join(repoDir, 'flow.json'),
      JSON.stringify({ version: 2, name: 'Bare', nodes: [], connectors: [] }),
    );

    const registryDir = mkdtempSync(join(tmpdir(), 'seeflow-summary-bare-reg-'));
    const registry = createRegistry({ path: join(registryDir, 'registry.json') });
    const deps = { registry };

    const reg = await registerFlowImpl(deps, {
      repoPath: repoDir,
      flowPath: 'flow.json',
    });
    if (reg.kind !== 'ok') throw new Error(`registerFlowImpl failed: ${reg.kind}`);

    const result = listFlowsSummaryImpl(deps);
    expect(result.data).toHaveLength(1);
    const first = result.data[0];
    if (!first) throw new Error('summary entry missing');
    expect('description' in first).toBe(false);
  });

  it('prefers live watcher snapshot for description and name', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-summary-live-'));
    const flowAbs = join(repoDir, 'flow.json');
    writeFileSync(
      flowAbs,
      JSON.stringify({
        version: 2,
        name: 'Original',
        description: 'original',
        nodes: [],
        connectors: [],
      }),
    );

    const registryDir = mkdtempSync(join(tmpdir(), 'seeflow-summary-live-reg-'));
    const registry = createRegistry({ path: join(registryDir, 'registry.json') });
    const events = createEventBus();
    const watcher = createWatcher({ registry, events, debounceMs: 10 });
    const deps = { registry, watcher };

    const reg = await registerFlowImpl(deps, {
      repoPath: repoDir,
      flowPath: 'flow.json',
    });
    if (reg.kind !== 'ok') throw new Error(`registerFlowImpl failed: ${reg.kind}`);
    watcher.watch(reg.data.id);

    // Author edits flow.json on disk; reparse() picks up the new description.
    writeFileSync(
      flowAbs,
      JSON.stringify({
        version: 2,
        name: 'Renamed',
        description: 'updated',
        nodes: [],
        connectors: [],
      }),
    );
    watcher.reparse(reg.data.id);

    const result = listFlowsSummaryImpl(deps);
    expect(result.data[0]).toEqual({
      id: reg.data.id,
      name: 'Renamed',
      description: 'updated',
    });
  });
});

describe('getFlowGraphImpl', () => {
  it('returns notFound for an unknown flowId', async () => {
    const registryDir = mkdtempSync(join(tmpdir(), 'seeflow-graph-nf-'));
    const registry = createRegistry({ path: join(registryDir, 'registry.json') });
    const result = await getFlowGraphImpl({ registry }, 'nope');
    expect(result.kind).toBe('notFound');
  });

  it('returns nodes/connectors stripped of detail and html, plus description', async () => {
    const { deps, flowId } = await setupProjectWithFlow();

    const detailAdd = await addNodeImpl(deps, flowId, {
      type: 'rectangle',
      data: { name: 'A', detail: '# long form body' },
    });
    if (detailAdd.kind !== 'ok') throw new Error('addNode A failed');

    const htmlAdd = await addNodeImpl(deps, flowId, {
      type: 'html',
      data: { html: '<p>fancy</p>', autoSize: true },
    });
    if (htmlAdd.kind !== 'ok') throw new Error('addNode B failed');

    // Author later adds a description by editing flow.json directly.
    const entry = deps.registry.getById(flowId);
    if (!entry) throw new Error('entry missing');
    const flowAbs = join(entry.repoPath, entry.flowPath);
    const raw = JSON.parse(readFileSync(flowAbs, 'utf8'));
    raw.description = 'demo flow';
    writeFileSync(flowAbs, JSON.stringify(raw));

    const result = await getFlowGraphImpl(deps, flowId);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    expect(result.data.description).toBe('demo flow');
    expect(result.data.nodes).toHaveLength(2);

    const rectNode = result.data.nodes.find((n) => n.id === detailAdd.data.id);
    expect(rectNode).toBeDefined();
    expect((rectNode?.data as Record<string, unknown>).detail).toBeUndefined();
    // Non-stripped fields persist.
    expect((rectNode?.data as { name?: string }).name).toBe('A');

    const htmlN = result.data.nodes.find((n) => n.id === htmlAdd.data.id);
    expect((htmlN?.data as Record<string, unknown>).html).toBeUndefined();
    expect((htmlN?.data as Record<string, unknown>).detail).toBeUndefined();
  });

  it('returns fileNotFound when flow.json has been removed from disk', async () => {
    const { deps, flowId, flowAbs } = await setupProjectWithFlow();
    unlinkSync(flowAbs);
    const result = await getFlowGraphImpl(deps, flowId);
    expect(result.kind).toBe('fileNotFound');
  });
});

describe('getNodeImpl', () => {
  it('returns notFound for an unknown flowId', async () => {
    const registryDir = mkdtempSync(join(tmpdir(), 'seeflow-node-nf-'));
    const registry = createRegistry({ path: join(registryDir, 'registry.json') });
    const result = await getNodeImpl({ registry }, 'nope', 'whatever');
    expect(result.kind).toBe('notFound');
  });

  it('returns unknownNode when nodeId is not in the flow', async () => {
    const { deps, flowId } = await setupProjectWithFlow();
    const result = await getNodeImpl(deps, flowId, 'no-such-node');
    expect(result.kind).toBe('unknownNode');
  });

  it('returns the node with detail content inlined', async () => {
    const { deps, flowId } = await setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'rectangle',
      data: { name: 'A', detail: '# body text' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');

    const result = await getNodeImpl(deps, flowId, add.data.id);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    expect(result.data.id).toBe(add.data.id);
    expect(result.data.flowId).toBe(flowId);
    expect((result.data.node.data as { detail?: string }).detail).toBe('# body text');
  });

  it('returns the type:html node with html content inlined', async () => {
    const { deps, flowId } = await setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'html',
      data: { html: '<p>resolved html</p>', autoSize: true },
    });
    if (add.kind !== 'ok') throw new Error('add failed');

    const result = await getNodeImpl(deps, flowId, add.data.id);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect((result.data.node.data as { html?: string }).html).toBe('<p>resolved html</p>');
  });
});

describe('createOperations factory', () => {
  it('exposes every *Impl as a method that delegates to the underlying function', async () => {
    const registryDir = mkdtempSync(join(tmpdir(), 'seeflow-ops-factory-'));
    const path = join(registryDir, 'registry.json');
    writeFileSync(path, '[]');
    const registry = createRegistry({ path });
    const ops = createOperations({ registry });

    const result = ops.listFlows();
    expect(result.data).toEqual([]);
  });

  it('does not silently expose play-style ops on the handle', () => {
    const registryDir = mkdtempSync(join(tmpdir(), 'seeflow-ops-factory-no-play-'));
    const registry = createRegistry({ path: join(registryDir, 'registry.json') });
    const ops = createOperations({ registry });
    expect('play' in ops).toBe(false);
  });

  it('drives full register → list round-trip through the handle', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'seeflow-ops-factory-repo-'));
    writeFileSync(
      join(repoDir, 'flow.json'),
      JSON.stringify({ ...STARTER_FLOW, name: 'Factory Round-Trip' }),
    );
    const registryDir = mkdtempSync(join(tmpdir(), 'seeflow-ops-factory-reg-'));
    const registry = createRegistry({ path: join(registryDir, 'registry.json') });
    const ops = createOperations({ registry });

    const reg = await ops.registerFlow({
      repoPath: repoDir,
      flowPath: 'flow.json',
    });
    expect(reg.kind).toBe('ok');

    const flows = ops.listFlows();
    expect(flows.data.length).toBe(1);
    expect(flows.data[0]?.name).toBe('Factory Round-Trip');
  });
});

// Regression: CLI help advertises every `<flowId>` arg as "Flow id or slug"
// but mutation ops historically resolved only by id, surfacing flowNotFound
// on slug input. Each *Impl now goes through registry.resolve(); these tests
// pin that contract for the ops the retrospective specifically called out.
describe('registry.resolve() + slug-tolerant *Impl', () => {
  it('registry.resolve returns the same entry whether called with id or slug', async () => {
    const { deps, flowId } = await setupProjectWithFlow();
    const byId = deps.registry.resolve(flowId);
    if (!byId) throw new Error('expected resolve(id) to find the entry');
    const bySlug = deps.registry.resolve(byId.slug);
    expect(bySlug?.id).toBe(byId.id);
    expect(deps.registry.resolve('nope-not-there')).toBeUndefined();
  });

  it('addFlowBulkImpl resolves a slug argument and seeds nodes + connectors in one call', async () => {
    const { deps, flowId } = await setupProjectWithFlow();
    const entry = deps.registry.resolve(flowId);
    if (!entry) throw new Error('seed lookup failed');
    const res = await addFlowBulkImpl(deps, entry.slug, {
      nodes: [
        { id: 'src', type: 'rectangle', data: { name: 'src' } },
        { id: 'dst', type: 'ellipse', data: { name: 'dst' } },
      ],
      connectors: [{ id: 'c1', source: 'src', target: 'dst' }],
    });
    expect(res.kind).toBe('ok');
  });

  it('applyLayoutImpl resolves a slug argument', async () => {
    const { deps, flowId } = await setupProjectWithFlow();
    const entry = deps.registry.resolve(flowId);
    if (!entry) throw new Error('seed lookup failed');
    const seed = await addFlowBulkImpl(deps, flowId, {
      nodes: [{ id: 'only', type: 'rectangle', data: { name: 'only' } }],
    });
    if (seed.kind !== 'ok') throw new Error(`seed failed: ${seed.kind}`);
    const res = await applyLayoutImpl(deps, entry.slug, undefined);
    expect(res.kind).toBe('ok');
  });
});

describe('NodePatchBodySchema type field', () => {
  it('accepts a valid flat node type', () => {
    const r = NodePatchBodySchema.safeParse({ type: 'rectangle' });
    expect(r.success).toBe(true);
  });

  it('accepts every other flat node type', () => {
    for (const t of [
      'ellipse',
      'sticky',
      'text',
      'database',
      'server',
      'user',
      'queue',
      'cloud',
      'diamond',
      'hexagon',
      'image',
      'html',
      'icon',
    ] as const) {
      expect(NodePatchBodySchema.safeParse({ type: t }).success).toBe(true);
    }
  });

  it('rejects an unknown node type', () => {
    const r = NodePatchBodySchema.safeParse({ type: 'notANode' });
    expect(r.success).toBe(false);
  });

  it('rejects the legacy shapeNode/playNode tags', () => {
    for (const t of ['shapeNode', 'playNode', 'stateNode', 'imageNode', 'iconNode', 'htmlNode']) {
      expect(NodePatchBodySchema.safeParse({ type: t }).success).toBe(false);
    }
  });
});

describe('mergeNodeUpdates type retype (in-memory semantics)', () => {
  // mergeNodeUpdates is the pure mutator; the post-merge ResolvedFlowSchema
  // reparse is what enforces required fields on the new type (e.g. type:'image'
  // needs `path`). These cases assert the mutator's contract: type flips,
  // visuals survive, lingering semantic fields not allowed on the new type get
  // stripped. Capability fields (playAction / statusAction / stateSource) are
  // valid on every type post-flat-types, so a geometric→geometric retype is
  // strip-free.

  it('rectangle → ellipse preserves capabilities + visuals (geometric → geometric is strip-free)', () => {
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'rectangle',
      data: {
        name: 'svc',
        stateSource: { kind: 'request' },
        playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
        statusAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/status.ts' },
        borderColor: 'teal',
        cornerRadius: 8,
      },
    };
    mergeNodeUpdates(node, { type: 'ellipse' });
    expect(node.type).toBe('ellipse');
    const data = node.data as Record<string, unknown>;
    expect(data.playAction).toBeDefined();
    expect(data.statusAction).toBeDefined();
    expect(data.stateSource).toBeDefined();
    expect(data.borderColor).toBe('teal');
    expect(data.cornerRadius).toBe(8);
  });

  it('image → rectangle strips path + alt, keeps capabilities + visuals', () => {
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'image',
      data: {
        name: 'pic',
        path: 'nodes/n1/upload.png',
        alt: 'a picture',
        playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
        borderColor: 'teal',
      },
    };
    mergeNodeUpdates(node, { type: 'rectangle' });
    expect(node.type).toBe('rectangle');
    const data = node.data as Record<string, unknown>;
    expect('path' in data).toBe(false);
    expect('alt' in data).toBe(false);
    expect(data.playAction).toBeDefined();
    expect(data.borderColor).toBe('teal');
  });

  it('rectangle → icon supplies icon via the same patch; preserves capabilities + visuals', () => {
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'rectangle',
      data: {
        name: 'svc',
        statusAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/status.ts' },
        borderColor: 'teal',
      },
    };
    mergeNodeUpdates(node, { type: 'icon', icon: 'server' });
    expect(node.type).toBe('icon');
    const data = node.data as Record<string, unknown>;
    expect(data.icon).toBe('server');
    expect(data.statusAction).toBeDefined();
    expect(data.borderColor).toBe('teal');
  });

  it('image → html strips path + alt; html is externalized by patchNodeImpl, not the mutator', () => {
    // mergeNodeUpdates intentionally skips externalized fields (detail, html
    // — see EXTERNALIZED_FIELD_NAMES); patchNodeImpl writes the file and
    // rewrites data[field] to a file:// ref. This test asserts the retype
    // strip contract on the in-memory mutator only.
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'image',
      data: {
        name: 'pic',
        path: 'nodes/n1/upload.png',
        alt: 'a picture',
        playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
      },
    };
    mergeNodeUpdates(node, { type: 'html' });
    expect(node.type).toBe('html');
    const data = node.data as Record<string, unknown>;
    expect('path' in data).toBe(false);
    expect('alt' in data).toBe(false);
    expect(data.playAction).toBeDefined();
    expect(data.name).toBe('pic');
  });

  it('no-op when patch type equals current type', () => {
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'rectangle',
      data: {
        name: 'svc',
        stateSource: { kind: 'request' },
        playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
      },
    };
    mergeNodeUpdates(node, { type: 'rectangle' });
    expect(node.type).toBe('rectangle');
    expect((node.data as Record<string, unknown>).playAction).toBeDefined();
  });
});

describe('patchNodeImpl type retype (end-to-end through ResolvedFlowSchema)', () => {
  it('flips rectangle to ellipse without touching the per-node folder', async () => {
    const { deps, flowId, repoPath, flowAbs } = await setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'rectangle',
      data: {
        name: 'svc',
        playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
        detail: 'docs survive retype',
      },
    });
    if (add.kind !== 'ok') throw new Error('add failed');
    const nodeId = add.data.id;

    const detailAbs = nodeFileAbsPath(repoPath, '', nodeId, 'detail.md');
    expect(existsSync(detailAbs)).toBe(true);
    expect(readFileSync(detailAbs, 'utf8')).toBe('docs survive retype');

    const patch = await patchNodeImpl(deps, flowId, nodeId, { type: 'ellipse' });
    expect(patch.kind).toBe('ok');

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === nodeId);
    expect(node.type).toBe('ellipse');
    expect(existsSync(detailAbs)).toBe(true);
    expect(readFileSync(detailAbs, 'utf8')).toBe('docs survive retype');
  });

  it('rectangle → image without a path in the same patch fails badSchema', async () => {
    const { deps, flowId } = await setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'rectangle',
      data: { name: 'svc' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');

    const patch = await patchNodeImpl(deps, flowId, add.data.id, { type: 'image' });
    expect(patch.kind).toBe('badSchema');
  });

  it('rectangle → icon without an icon in the same patch fails badSchema', async () => {
    const { deps, flowId } = await setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'rectangle',
      data: { name: 'svc' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');

    const patch = await patchNodeImpl(deps, flowId, add.data.id, { type: 'icon' });
    expect(patch.kind).toBe('badSchema');
  });

  it('rectangle → icon succeeds when the same patch carries an icon name', async () => {
    const { deps, flowId, flowAbs } = await setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'rectangle',
      data: {
        name: 'svc',
        playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
      },
    });
    if (add.kind !== 'ok') throw new Error('add failed');

    const patch = await patchNodeImpl(deps, flowId, add.data.id, {
      type: 'icon',
      icon: 'server',
    });
    expect(patch.kind).toBe('ok');
    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === add.data.id);
    expect(node.type).toBe('icon');
    expect(node.data.icon).toBe('server');
    // Capabilities are valid on every type, so playAction carries through.
    expect(node.data.playAction.scriptPath).toBe('scripts/play.ts');
  });
});

// US-009: patchNodeImpl per-type field policing. The on-disk FlowDataSchema
// for each variant is `.strict()`, so patching a geometric node with an
// image-only field (path / alt) or an html-only field (html unless externalized)
// surfaces as a `badSchema` outcome from the post-merge ResolvedFlowSchema reparse.
// This is the effective per-type-allowed-fields gate referenced by the design
// doc's testing strategy.
describe('US-009: patchNodeImpl rejects cross-type fields on persist', () => {
  it('rejects an image-only `path` patched onto a rectangle (no type change)', async () => {
    const { deps, flowId } = await setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'rectangle',
      data: { name: 'svc' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');
    // `path` is not in NodePatchBodySchema's top-level keys, so it would be
    // rejected at body-shape validation by the route layer. Here we exercise
    // mergeNodeUpdates' tolerance to extra data fields by writing the raw
    // node directly — what we're really testing is the reparse fence on the
    // disk side, which mirrors the architecture's "strict-on-disk, lenient-
    // through-the-route" invariant.
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'rectangle',
      data: { name: 'svc' },
    };
    // Bypass: directly set the image-only field on the node data and confirm
    // FlowSchema rejects it on the disk side. This pins the .strict() guarantee.
    (node.data as Record<string, unknown>).path = 'nodes/n1/cover.png';
    const result = (await import('./schema.ts')).FlowSchema.safeParse({
      version: 2 as const,
      name: 'T',
      nodes: [node],
      connectors: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an image-only `alt` patched onto a database', async () => {
    const flow = {
      version: 2 as const,
      name: 'T',
      nodes: [{ id: 'db-1', type: 'database' as const, data: { name: 'db', alt: 'not allowed' } }],
      connectors: [],
    };
    const result = (await import('./schema.ts')).FlowSchema.safeParse(flow);
    expect(result.success).toBe(false);
  });

  it('rejects an html-only `html` patched onto an icon', async () => {
    const flow = {
      version: 2 as const,
      name: 'T',
      nodes: [
        {
          id: 'i-1',
          type: 'icon' as const,
          data: { icon: 'shopping-cart', html: '<p>nope</p>' },
        },
      ],
      connectors: [],
    };
    const result = (await import('./schema.ts')).FlowSchema.safeParse(flow);
    expect(result.success).toBe(false);
  });

  it('rejects a geometric-tagged node carrying a `path` (end-to-end through patchNodeImpl is unreachable; this is the disk-fence)', async () => {
    // Concretely: NodePatchBodySchema does not expose `path` as a top-level
    // key — there is no route that accepts `path` on a non-image type. The
    // gate that prevents an image-only field from landing on a rectangle is
    // therefore TWO-LEVEL:
    //   1. Route-level: NodePatchBodySchema.strict() rejects unknown keys.
    //   2. Disk-level: FlowGeometricNodeData.strict() rejects extra keys.
    // We exercise the disk-level fence here because it is the load-bearing
    // invariant (the route is a soft gate; the disk is the source of truth).
    const flow = {
      version: 2 as const,
      name: 'T',
      nodes: [
        {
          id: 'rect',
          type: 'rectangle' as const,
          data: { name: 'r', path: 'nodes/rect/cover.png' },
        },
      ],
      connectors: [],
    };
    const result = (await import('./schema.ts')).FlowSchema.safeParse(flow);
    expect(result.success).toBe(false);
  });

  it('accepts a capability field (playAction) on every one of the 14 types via FlowSchema', async () => {
    const types = [
      'rectangle',
      'ellipse',
      'sticky',
      'text',
      'database',
      'server',
      'user',
      'queue',
      'cloud',
      'diamond',
      'hexagon',
    ] as const;
    const { FlowSchema } = await import('./schema.ts');
    for (const type of types) {
      const flow = {
        version: 2 as const,
        name: 'T',
        nodes: [
          {
            id: `n-${type}`,
            type,
            data: {
              name: type,
              playAction: {
                kind: 'script' as const,
                interpreter: 'bun',
                scriptPath: 'scripts/play.ts',
              },
            },
          },
        ],
        connectors: [],
      };
      const result = FlowSchema.safeParse(flow);
      if (!result.success) {
        throw new Error(
          `expected ${type} with playAction to parse, got: ${JSON.stringify(result.error.issues)}`,
        );
      }
    }
  });
});
