import { describe, expect, test } from 'bun:test';
import { type ScalableNode, scaleNodesWithinRect } from './scale-nodes';

const node = (
  id: string,
  x: number,
  y: number,
  w?: number,
  h?: number,
  data?: { locked?: boolean },
): ScalableNode => ({
  id,
  position: { x, y },
  width: w,
  height: h,
  data,
});

describe('scaleNodesWithinRect', () => {
  test('single node — scales 2x in both axes relative to oldRect origin', () => {
    const nodes = [node('a', 10, 20, 50, 30)];
    const out = scaleNodesWithinRect(
      nodes,
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 200, height: 200 },
    );
    expect(out).toHaveLength(1);
    const n = out[0];
    if (!n) throw new Error('missing node');
    // x' = newRect.x + (x - oldRect.x) * sx = 0 + 10 * 2 = 20
    expect(n.position).toEqual({ x: 20, y: 40 });
    expect(n.width).toBe(100);
    expect(n.height).toBe(60);
  });

  test('single node — non-origin rects translate the anchor', () => {
    const nodes = [node('a', 110, 220, 50, 30)];
    const out = scaleNodesWithinRect(
      nodes,
      { x: 100, y: 200, width: 100, height: 100 },
      { x: 300, y: 400, width: 200, height: 200 },
    );
    const n = out[0];
    if (!n) throw new Error('missing node');
    // sx = 2, sy = 2; x' = 300 + (110-100)*2 = 320; y' = 400 + (220-200)*2 = 440
    expect(n.position).toEqual({ x: 320, y: 440 });
    expect(n.width).toBe(100);
    expect(n.height).toBe(60);
  });

  test('multi-node — each scales independently relative to oldRect origin', () => {
    const nodes = [node('a', 0, 0, 50, 50), node('b', 50, 50, 50, 50)];
    const out = scaleNodesWithinRect(
      nodes,
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 300, height: 200 },
    );
    const a = out[0];
    const b = out[1];
    if (!a || !b) throw new Error('missing node');
    // sx = 3, sy = 2
    expect(a.position).toEqual({ x: 0, y: 0 });
    expect(a.width).toBe(150);
    expect(a.height).toBe(100);
    expect(b.position).toEqual({ x: 150, y: 100 });
    expect(b.width).toBe(150);
    expect(b.height).toBe(100);
  });

  test('locked node — passes through unchanged even when other nodes scale', () => {
    const locked = node('locked', 10, 20, 50, 30, { locked: true });
    const free = node('free', 10, 20, 50, 30);
    const out = scaleNodesWithinRect(
      [locked, free],
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 200, height: 200 },
    );
    const lockedOut = out[0];
    const freeOut = out[1];
    if (!lockedOut || !freeOut) throw new Error('missing node');
    // Locked: unchanged
    expect(lockedOut.position).toEqual({ x: 10, y: 20 });
    expect(lockedOut.width).toBe(50);
    expect(lockedOut.height).toBe(30);
    // Free: scaled 2x
    expect(freeOut.position).toEqual({ x: 20, y: 40 });
    expect(freeOut.width).toBe(100);
    expect(freeOut.height).toBe(60);
  });

  test('lockAspectRatio — uses min(sx, sy) so content fits within the new rect', () => {
    const nodes = [node('a', 0, 0, 100, 100)];
    // sx = 3, sy = 2 → uniform scale = min(3, 2) = 2
    const out = scaleNodesWithinRect(
      nodes,
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 300, height: 200 },
      { lockAspectRatio: true },
    );
    const n = out[0];
    if (!n) throw new Error('missing node');
    expect(n.position).toEqual({ x: 0, y: 0 });
    expect(n.width).toBe(200);
    expect(n.height).toBe(200);
  });

  test('lockAspectRatio — anchor preserved at oldRect origin', () => {
    const nodes = [node('a', 50, 50, 50, 50)];
    // sx = 2, sy = 4 → uniform scale = 2
    const out = scaleNodesWithinRect(
      nodes,
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 200, height: 400 },
      { lockAspectRatio: true },
    );
    const n = out[0];
    if (!n) throw new Error('missing node');
    expect(n.position).toEqual({ x: 100, y: 100 });
    expect(n.width).toBe(100);
    expect(n.height).toBe(100);
  });

  test('zero-width oldRect — returns inputs unchanged (no div-by-zero)', () => {
    const nodes = [node('a', 10, 20, 50, 30)];
    const out = scaleNodesWithinRect(
      nodes,
      { x: 0, y: 0, width: 0, height: 100 },
      { x: 0, y: 0, width: 200, height: 200 },
    );
    const n = out[0];
    if (!n) throw new Error('missing node');
    expect(n.position).toEqual({ x: 10, y: 20 });
    expect(n.width).toBe(50);
    expect(n.height).toBe(30);
  });

  test('zero-height oldRect — returns inputs unchanged', () => {
    const nodes = [node('a', 10, 20, 50, 30)];
    const out = scaleNodesWithinRect(
      nodes,
      { x: 0, y: 0, width: 100, height: 0 },
      { x: 0, y: 0, width: 200, height: 200 },
    );
    const n = out[0];
    if (!n) throw new Error('missing node');
    expect(n.position).toEqual({ x: 10, y: 20 });
    expect(n.width).toBe(50);
    expect(n.height).toBe(30);
  });

  test('omits width/height when undefined on input', () => {
    const nodes = [node('a', 10, 20)];
    const out = scaleNodesWithinRect(
      nodes,
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 200, height: 200 },
    );
    const n = out[0];
    if (!n) throw new Error('missing node');
    expect(n.position).toEqual({ x: 20, y: 40 });
    expect(n.width).toBeUndefined();
    expect(n.height).toBeUndefined();
  });

  test('preserves extra fields on the input node (returns same shape)', () => {
    type Extra = ScalableNode & { type: 'shape'; data: { locked?: boolean; label: string } };
    const nodes: Extra[] = [
      {
        id: 'a',
        type: 'shape',
        position: { x: 10, y: 20 },
        width: 50,
        height: 30,
        data: { label: 'hi' },
      },
    ];
    const out = scaleNodesWithinRect(
      nodes,
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 200, height: 200 },
    );
    const n = out[0];
    if (!n) throw new Error('missing node');
    expect(n.type).toBe('shape');
    expect(n.data.label).toBe('hi');
    expect(n.position).toEqual({ x: 20, y: 40 });
  });

  test('empty input returns empty output', () => {
    const out = scaleNodesWithinRect(
      [],
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 200, height: 200 },
    );
    expect(out).toEqual([]);
  });
});
