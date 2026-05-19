import { describe, expect, it } from 'bun:test';
import { NodePatchBodySchema, mergeNodeUpdates } from './operations.ts';

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
