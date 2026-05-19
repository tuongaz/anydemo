import { describe, expect, it } from 'bun:test';
import { NodePatchBodySchema, mergeNodeUpdates, validateImpl } from './operations.ts';

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
      data: { htmlPath: 'a.html' },
    };
    mergeNodeUpdates(node, { width: 480, height: 320 });
    expect(node.data).toMatchObject({ autoSize: false, width: 480, height: 320 });
  });

  it('strips width/height when autoSize: true is written', () => {
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'htmlNode',
      data: { htmlPath: 'a.html', autoSize: false, width: 480, height: 320 },
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
      data: { htmlPath: 'a.html' },
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
      data: { htmlPath: 'a.html' },
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
  it('returns ok for valid architecture + style', () => {
    const r = validateImpl({
      architecture: {
        version: 2,
        name: 'T',
        nodes: [{ id: 'n', type: 'shapeNode', data: { shape: 'rectangle' } }],
        connectors: [],
      },
      style: { nodes: { n: { fontSize: 14 } } },
    });
    expect(r).toEqual({ ok: true });
  });

  it('returns architecture-scoped issues on bad arch', () => {
    const r = validateImpl({
      architecture: { version: 1, name: '', nodes: [], connectors: [] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.every((i) => i.scope === 'architecture')).toBe(true);
  });

  it('returns style-scoped issues on bad style', () => {
    const r = validateImpl({
      architecture: { version: 2, name: 'T', nodes: [], connectors: [] },
      style: { nodes: { x: { fontSize: -1 } } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.scope === 'style')).toBe(true);
  });

  it('flags style entries with no matching architecture id', () => {
    const r = validateImpl({
      architecture: { version: 2, name: 'T', nodes: [], connectors: [] },
      style: { nodes: { ghost: { fontSize: 14 } } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.issues.find((i) => i.code === 'orphan_style_node')).toBeDefined();
  });
});
