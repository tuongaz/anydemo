import { describe, expect, test } from 'bun:test';
import { type AutoLayoutNode, applyLayout } from './auto-layout';

const node = (id: string, w = 100, h = 60, x = 0, y = 0): AutoLayoutNode => ({
  id,
  width: w,
  height: h,
  position: { x, y },
});

describe('applyLayout', () => {
  test('linear chain A→B→C lays out monotonically increasing x at similar y (LR)', () => {
    const nodes = [node('A'), node('B'), node('C')];
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
    ];
    const out = applyLayout(nodes, edges);
    const a = out.get('A');
    const b = out.get('B');
    const c = out.get('C');
    if (!a || !b || !c) throw new Error('missing layout entry');
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
    // Same rank-line per chain: y should be identical (same horizontal track).
    expect(a.y).toBe(b.y);
    expect(b.y).toBe(c.y);
  });

  test('fan-out P → C1/C2/C3 gives three distinct y values at the same x rank', () => {
    const nodes = [node('P'), node('C1'), node('C2'), node('C3')];
    const edges = [
      { source: 'P', target: 'C1' },
      { source: 'P', target: 'C2' },
      { source: 'P', target: 'C3' },
    ];
    const out = applyLayout(nodes, edges);
    const c1 = out.get('C1');
    const c2 = out.get('C2');
    const c3 = out.get('C3');
    if (!c1 || !c2 || !c3) throw new Error('missing child layout');
    // Same x rank: dagre places all three children at the same column.
    expect(c1.x).toBe(c2.x);
    expect(c2.x).toBe(c3.x);
    // Distinct y values — three siblings can't share a row.
    const ys = new Set([c1.y, c2.y, c3.y]);
    expect(ys.size).toBe(3);
  });

  test('two disconnected components have disjoint bounding boxes', () => {
    const nodes = [node('A'), node('B'), node('X'), node('Y')];
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'X', target: 'Y' },
    ];
    const out = applyLayout(nodes, edges);
    const ids = ['A', 'B', 'X', 'Y'] as const;
    for (const id of ids) if (!out.get(id)) throw new Error(`missing ${id}`);
    const bbox = (id1: string, id2: string) => {
      const p1 = out.get(id1);
      const p2 = out.get(id2);
      if (!p1 || !p2) throw new Error('bbox missing');
      const left = Math.min(p1.x, p2.x);
      const right = Math.max(p1.x + 100, p2.x + 100);
      const top = Math.min(p1.y, p2.y);
      const bottom = Math.max(p1.y + 60, p2.y + 60);
      return { left, right, top, bottom };
    };
    const ab = bbox('A', 'B');
    const xy = bbox('X', 'Y');
    // Disjoint = either fully separated horizontally or vertically.
    const horizontallyDisjoint = ab.right <= xy.left || xy.right <= ab.left;
    const verticallyDisjoint = ab.bottom <= xy.top || xy.bottom <= ab.top;
    expect(horizontallyDisjoint || verticallyDisjoint).toBe(true);
  });

  test('single-node graph returns the input position', () => {
    const nodes = [node('only', 100, 60, 42, 99)];
    const out = applyLayout(nodes, []);
    expect(out.get('only')).toEqual({ x: 42, y: 99 });
  });

  test('TB direction yields monotonically increasing y instead of x', () => {
    const nodes = [node('A'), node('B'), node('C')];
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
    ];
    const out = applyLayout(nodes, edges, { direction: 'TB' });
    const a = out.get('A');
    const b = out.get('B');
    const c = out.get('C');
    if (!a || !b || !c) throw new Error('missing layout entry');
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
    // Same column: x should match.
    expect(a.x).toBe(b.x);
    expect(b.x).toBe(c.x);
  });

  test('returns empty map for empty input', () => {
    const out = applyLayout([], []);
    expect(out.size).toBe(0);
  });

  test('skips edges whose endpoints are not in the node set', () => {
    const nodes = [node('A'), node('B')];
    // 'C' isn't supplied — the edge must not crash dagre.
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
    ];
    const out = applyLayout(nodes, edges);
    expect(out.get('A')).toBeDefined();
    expect(out.get('B')).toBeDefined();
    expect(out.get('C')).toBeUndefined();
  });

  test('output coords are top-left (not center)', () => {
    // Two nodes, fixed dims; the smaller of the two x's must be ≥ 0 (dagre
    // never produces negative ranks for a simple two-node graph), and the
    // y coordinate equals the dagre-center minus halfHeight, so for a node
    // of height 60 placed at y-center 30, the returned y should be 0.
    const nodes = [node('A', 100, 60), node('B', 100, 60)];
    const out = applyLayout(nodes, [{ source: 'A', target: 'B' }]);
    const a = out.get('A');
    if (!a) throw new Error('missing A');
    // top-left: a.x corresponds to dagre's centerX - 50; since dagre starts
    // at marginX 0 with a node centered at 50,30 by default, top-left is 0,0.
    expect(a.x).toBe(0);
    expect(a.y).toBe(0);
  });
});
