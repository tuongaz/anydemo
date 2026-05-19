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
