import { describe, expect, test } from 'bun:test';
import { type LayoutEdge, type LayoutNode, computeLayout } from './layout.ts';

// Rectangle is the canonical "playable" node — these dimensions mirror the
// canvas SHAPE_DEFAULT_SIZE.rectangle entry that layout.ts uses by default.
const PLAY_W = 200;
const PLAY_H = 120;
const STICKY_W = 180;
const STICKY_H = 180;

const rectangle = (id: string): LayoutNode => ({ id, type: 'rectangle' });
const stickyNode = (id: string): LayoutNode => ({ id, type: 'sticky' });
const edge = (id: string, source: string, target: string): LayoutEdge => ({
  id,
  source,
  target,
});

const rectsOverlap = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe('computeLayout', () => {
  test('returns empty result for empty input', async () => {
    const r = await computeLayout([], []);
    expect(r.nodes).toEqual({});
    expect(r.connectors).toEqual({});
  });

  test('single connected node still gets a position', async () => {
    const r = await computeLayout([rectangle('a')], []);
    expect(Object.keys(r.nodes)).toEqual(['a']);
    expect(r.connectors).toEqual({});
  });

  test('linear chain A→B→C lays out left-to-right with the same y', async () => {
    const r = await computeLayout(
      [rectangle('a'), rectangle('b'), rectangle('c')],
      [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
    );
    const a = r.nodes.a?.position;
    const b = r.nodes.b?.position;
    const c = r.nodes.c?.position;
    if (!a || !b || !c) throw new Error('missing positions');

    expect(b.x).toBeGreaterThan(a.x);
    expect(c.x).toBeGreaterThan(b.x);
    expect(b.y).toBe(a.y);
    expect(c.y).toBe(a.y);
    expect(r.connectors.e1).toEqual({ sourceHandle: 'r', targetHandle: 'l' });
    expect(r.connectors.e2).toEqual({ sourceHandle: 'r', targetHandle: 'l' });
  });

  test('layered LR leaves >=200px between sibling rectangles for label room', async () => {
    const r = await computeLayout([rectangle('a'), rectangle('b')], [edge('e1', 'a', 'b')]);
    const a = r.nodes.a?.position;
    const b = r.nodes.b?.position;
    if (!a || !b) throw new Error('missing positions');
    const gap = b.x - (a.x + PLAY_W);
    expect(gap).toBeGreaterThanOrEqual(200);
  });

  test('no two laid-out nodes overlap', async () => {
    const r = await computeLayout(
      [rectangle('a'), rectangle('b'), rectangle('c'), rectangle('d')],
      [edge('e1', 'a', 'b'), edge('e2', 'a', 'c'), edge('e3', 'b', 'd'), edge('e4', 'c', 'd')],
    );
    const rects = Object.entries(r.nodes).map(([_, v]) => ({
      x: v.position.x,
      y: v.position.y,
      w: PLAY_W,
      h: PLAY_H,
    }));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (!a || !b) continue;
        expect(rectsOverlap(a, b)).toBe(false);
      }
    }
  });

  test('disconnected components both get laid out (no (0,0) pileup)', async () => {
    const r = await computeLayout(
      [rectangle('a'), rectangle('b'), rectangle('x'), rectangle('y')],
      [edge('e1', 'a', 'b'), edge('e2', 'x', 'y')],
    );
    const positions = Object.values(r.nodes).map((v) => v.position);
    const atOrigin = positions.filter((p) => p.x === 0 && p.y === 0);
    expect(atOrigin.length).toBeLessThanOrEqual(1);
  });

  test('self-loop edge does not crash', async () => {
    const r = await computeLayout([rectangle('a')], [edge('self', 'a', 'a')]);
    expect(r.nodes.a).toBeDefined();
    expect(r.connectors.self).toBeDefined();
  });

  test('parallel edges between the same pair both get handle assignments', async () => {
    const r = await computeLayout(
      [rectangle('a'), rectangle('b')],
      [edge('e1', 'a', 'b'), edge('e2', 'a', 'b')],
    );
    expect(r.connectors.e1).toBeDefined();
    expect(r.connectors.e2).toBeDefined();
  });

  test('sticky and unreferenced decoratives are placed in a right-side column, not at (0,0)', async () => {
    const r = await computeLayout(
      [rectangle('a'), rectangle('b'), stickyNode('note')],
      [edge('e1', 'a', 'b')],
    );
    const a = r.nodes.a?.position;
    const b = r.nodes.b?.position;
    const note = r.nodes.note?.position;
    if (!a || !b || !note) throw new Error('missing positions');

    const maxRight = Math.max(a.x + PLAY_W, b.x + PLAY_W);
    expect(note.x).toBeGreaterThanOrEqual(maxRight);
    expect(
      rectsOverlap(
        { x: a.x, y: a.y, w: PLAY_W, h: PLAY_H },
        { x: note.x, y: note.y, w: STICKY_W, h: STICKY_H },
      ),
    ).toBe(false);
    expect(
      rectsOverlap(
        { x: b.x, y: b.y, w: PLAY_W, h: PLAY_H },
        { x: note.x, y: note.y, w: STICKY_W, h: STICKY_H },
      ),
    ).toBe(false);
  });

  test('output is deterministic across two runs with the same input', async () => {
    const nodes = [rectangle('a'), rectangle('b'), rectangle('c'), rectangle('d')];
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'a', 'c'), edge('e3', 'b', 'd')];
    const a = await computeLayout(nodes, edges);
    const b = await computeLayout(nodes, edges);
    expect(a).toEqual(b);
  });

  test('positions are integers', async () => {
    const r = await computeLayout(
      [rectangle('a'), rectangle('b'), rectangle('c')],
      [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
    );
    for (const v of Object.values(r.nodes)) {
      expect(Number.isInteger(v.position.x)).toBe(true);
      expect(Number.isInteger(v.position.y)).toBe(true);
    }
  });

  test('vertical handoff (target below source) uses bottom→top handles', async () => {
    const r = await computeLayout([rectangle('a'), rectangle('b')], [edge('e1', 'a', 'b')], {
      direction: 'DOWN',
    });
    expect(r.connectors.e1).toEqual({ sourceHandle: 'b', targetHandle: 't' });
  });

  test('connector handles vocabulary is always r|b for source and t|l for target', async () => {
    const r = await computeLayout(
      [rectangle('a'), rectangle('b'), rectangle('c'), rectangle('d')],
      [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'c', 'd'), edge('e4', 'a', 'd')],
    );
    for (const v of Object.values(r.connectors)) {
      expect(['r', 'b']).toContain(v.sourceHandle);
      expect(['t', 'l']).toContain(v.targetHandle);
    }
  });

  test('explicit data.width/data.height override the per-type defaults', async () => {
    const wide: LayoutNode = { id: 'wide', type: 'rectangle', data: { width: 600, height: 100 } };
    const small: LayoutNode = { id: 'small', type: 'rectangle' };
    const r = await computeLayout([wide, small], [edge('e1', 'wide', 'small')]);
    const w = r.nodes.wide?.position;
    const s = r.nodes.small?.position;
    if (!w || !s) throw new Error('missing positions');
    // Wide node consumes 600px, plus 220px layer gap → small.x >= wide.x + 600
    expect(s.x - w.x).toBeGreaterThanOrEqual(600);
  });
});
