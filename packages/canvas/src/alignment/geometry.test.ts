import { describe, expect, it } from 'bun:test';
import { type GuideLine, type Rect, computeGuides } from './geometry';

const T = 6; // threshold (world units)

const kinds = (guides: GuideLine[]): string[] => guides.map((g) => g.kind);
const has = (guides: GuideLine[], kind: GuideLine['kind']): boolean =>
  guides.some((g) => g.kind === kind);

describe('computeGuides — edge/center pass (6 anchors in isolation)', () => {
  // Wide, far ref so only ONE of the moving rect's anchors lands near a ref
  // anchor — isolates each of the six alignments. Moving sits at y=500 so the
  // Y axis never snaps (and vice versa for the Y cases).
  const wideRef: Rect = { id: 'wide', x: 0, y: 0, w: 1000, h: 10 };
  const tallRef: Rect = { id: 'tall', x: 0, y: 0, w: 10, h: 1000 };

  it('snaps the LEFT edge', () => {
    const out = computeGuides({ id: 'm', x: 4, y: 500, w: 80, h: 60 }, [wideRef], T);
    expect(out.snappedX).toBe(0);
    expect(out.snappedY).toBe(500);
    const v = out.guides.find((g) => g.kind === 'v');
    expect(v).toBeDefined();
    expect((v as { x: number }).x).toBe(0);
  });

  it('snaps the RIGHT edge', () => {
    const out = computeGuides({ id: 'm', x: 922, y: 500, w: 80, h: 60 }, [wideRef], T);
    // right edge 1002 snaps to wideRef right 1000 → x = 920
    expect(out.snappedX).toBe(920);
  });

  it('snaps the horizontal CENTER', () => {
    const out = computeGuides({ id: 'm', x: 462, y: 500, w: 80, h: 60 }, [wideRef], T);
    // centerX 502 snaps to wideRef centerX 500 → x = 460
    expect(out.snappedX).toBe(460);
    const v = out.guides.find((g) => g.kind === 'v') as { x: number };
    expect(v.x).toBe(500);
  });

  it('snaps the TOP edge', () => {
    const out = computeGuides({ id: 'm', x: 500, y: 4, w: 60, h: 40 }, [tallRef], T);
    expect(out.snappedY).toBe(0);
    expect(out.snappedX).toBe(500);
  });

  it('snaps the vertical CENTER', () => {
    const out = computeGuides({ id: 'm', x: 500, y: 482, w: 60, h: 40 }, [tallRef], T);
    // centerY 502 snaps to tallRef centerY 500 → y = 480
    expect(out.snappedY).toBe(480);
    const h = out.guides.find((g) => g.kind === 'h') as { y: number };
    expect(h.y).toBe(500);
  });

  it('snaps the BOTTOM edge', () => {
    const out = computeGuides({ id: 'm', x: 500, y: 922, w: 60, h: 80 }, [tallRef], T);
    // bottom 1002 snaps to tallRef bottom 1000 → y = 920
    expect(out.snappedY).toBe(920);
  });
});

describe('computeGuides — threshold boundary', () => {
  const wideRef: Rect = { id: 'wide', x: 0, y: 0, w: 1000, h: 10 };

  it('snaps when exactly at the threshold', () => {
    const out = computeGuides({ id: 'm', x: 6, y: 500, w: 80, h: 60 }, [wideRef], T);
    expect(out.snappedX).toBe(0);
    expect(has(out.guides, 'v')).toBe(true);
  });

  it('does NOT snap at threshold + 1', () => {
    const out = computeGuides({ id: 'm', x: 7, y: 500, w: 80, h: 60 }, [wideRef], T);
    expect(out.snappedX).toBe(7);
    expect(out.guides).toHaveLength(0);
  });
});

describe('computeGuides — tie-breaks', () => {
  it('breaks an edge-vs-center tie toward the center', () => {
    // moving left/center/right are all 3px from a same-sized ref → 3-way tie.
    const ref: Rect = { id: 'a', x: 0, y: 0, w: 100, h: 60 };
    const out = computeGuides({ id: 'm', x: 3, y: 500, w: 100, h: 60 }, [ref], T);
    const v = out.guides.find((g) => g.kind === 'v') as { x: number };
    // center wins → guide drawn on the center line (x=50), not an edge.
    expect(v.x).toBe(50);
    expect(out.snappedX).toBe(0);
  });

  it('lets an edge snap win over spacing on the same axis (no spacing-v emitted)', () => {
    const a: Rect = { id: 'a', x: 0, y: 0, w: 100, h: 60 };
    const b: Rect = { id: 'b', x: 200, y: 0, w: 100, h: 60 };
    // moving.left (98) is 2px from a.right (100): edge snaps X to 100. The
    // centered-spacing target is also x=100, but spacing must NOT run on X.
    const out = computeGuides({ id: 'm', x: 98, y: 0, w: 100, h: 60 }, [a, b], T);
    expect(out.snappedX).toBe(100);
    expect(has(out.guides, 'spacing-v')).toBe(false);
    expect(has(out.guides, 'v')).toBe(true);
  });
});

describe('computeGuides — spacing pass', () => {
  it('centers between two refs (3-rect config) and emits spacing-v', () => {
    const a: Rect = { id: 'a', x: 0, y: 0, w: 100, h: 60 };
    const b: Rect = { id: 'b', x: 300, y: 0, w: 100, h: 60 };
    // y=0 gives a Y edge snap (enables spacing pass); X is free.
    const out = computeGuides({ id: 'm', x: 152, y: 0, w: 100, h: 60 }, [a, b], T);
    // free = 300-100 = 200, gap = (200-100)/2 = 50 → targetLeft = 150
    expect(out.snappedX).toBe(150);
    const sp = out.guides.find((g) => g.kind === 'spacing-v') as { gap: number };
    expect(sp).toBeDefined();
    expect(sp.gap).toBe(50);
  });

  it('does NOT chain past the immediate left neighbor (line-of-sight rule)', () => {
    // Line-of-sight hides `a` and `b` behind `c` (the rightmost ref in the
    // chain), so the spacing pass only sees one neighbor and can't detect an
    // equal-gap chain to extend. Matches the "only align to nodes you can see
    // from moving" rule.
    const a: Rect = { id: 'a', x: 0, y: 0, w: 50, h: 60 };
    const b: Rect = { id: 'b', x: 100, y: 0, w: 50, h: 60 };
    const c: Rect = { id: 'c', x: 200, y: 0, w: 50, h: 60 };
    const out = computeGuides({ id: 'm', x: 302, y: 0, w: 50, h: 60 }, [a, b, c], T);
    expect(out.snappedX).toBe(302);
    expect(has(out.guides, 'spacing-v')).toBe(false);
  });

  it('does NOT chain past the immediate left neighbor in a 5-rect config either', () => {
    const refs: Rect[] = [
      { id: 'a', x: 0, y: 0, w: 40, h: 60 },
      { id: 'b', x: 80, y: 0, w: 40, h: 60 },
      { id: 'c', x: 160, y: 0, w: 40, h: 60 },
      { id: 'd', x: 240, y: 0, w: 40, h: 60 },
    ];
    const out = computeGuides({ id: 'm', x: 318, y: 0, w: 40, h: 60 }, refs, T);
    expect(out.snappedX).toBe(318);
    expect(has(out.guides, 'spacing-v')).toBe(false);
  });

  it('emits a vertical spacing-h guide for Y-axis distribution', () => {
    const a: Rect = { id: 'a', x: 0, y: 0, w: 60, h: 100 };
    const b: Rect = { id: 'b', x: 0, y: 300, w: 60, h: 100 };
    // x=0 gives an X edge snap; Y free → vertical spacing.
    const out = computeGuides({ id: 'm', x: 0, y: 152, w: 60, h: 100 }, [a, b], T);
    expect(out.snappedY).toBe(150);
    expect(has(out.guides, 'spacing-h')).toBe(true);
  });
});

describe('computeGuides — projection-overlap gating', () => {
  it('ignores spacing refs whose perpendicular projection does not overlap', () => {
    // z aligns moving on Y (enables spacing pass) but does not align on X.
    const z: Rect = { id: 'z', x: 500, y: 0, w: 80, h: 60 };
    // p/q would center moving at x=150 — but they sit at y=1000, no Y overlap.
    const p: Rect = { id: 'p', x: 0, y: 1000, w: 100, h: 60 };
    const q: Rect = { id: 'q', x: 300, y: 1000, w: 100, h: 60 };
    const out = computeGuides({ id: 'm', x: 152, y: 0, w: 100, h: 60 }, [z, p, q], T);
    expect(out.snappedX).toBe(152); // unchanged — spacing gated out
    expect(has(out.guides, 'spacing-v')).toBe(false);
  });

  it('applies spacing once the refs DO overlap on the perpendicular axis', () => {
    const z: Rect = { id: 'z', x: 500, y: 0, w: 80, h: 60 };
    const p: Rect = { id: 'p', x: 0, y: 0, w: 100, h: 60 };
    const q: Rect = { id: 'q', x: 300, y: 0, w: 100, h: 60 };
    const out = computeGuides({ id: 'm', x: 152, y: 0, w: 100, h: 60 }, [z, p, q], T);
    expect(out.snappedX).toBe(150);
    expect(has(out.guides, 'spacing-v')).toBe(true);
  });
});

describe('computeGuides — multi-selection bounding box', () => {
  it('snaps the bounding-box rect like any other rect', () => {
    // The hook passes the selection's outer bbox as one logical Rect.
    const ref: Rect = { id: 'ref', x: 0, y: 0, w: 1000, h: 10 };
    const bbox: Rect = { id: 'sel', x: 4, y: 500, w: 240, h: 120 };
    const out = computeGuides(bbox, [ref], T);
    expect(out.snappedX).toBe(0); // left edges align
  });
});

describe('computeGuides — resize mode', () => {
  it('detects spacing and emits the guide but never adjusts the snap offset', () => {
    const a: Rect = { id: 'a', x: 0, y: 0, w: 100, h: 60 };
    const b: Rect = { id: 'b', x: 300, y: 0, w: 100, h: 60 };
    const out = computeGuides({ id: 'm', x: 152, y: 0, w: 100, h: 60 }, [a, b], T, {
      resizeMode: true,
    });
    expect(out.snappedX).toBe(152); // NOT moved to 150
    expect(has(out.guides, 'spacing-v')).toBe(true);
  });

  it('only considers active edges (right handle) and excludes centers', () => {
    const ref: Rect = { id: 'wide', x: 0, y: 0, w: 1000, h: 10 };
    // moving.left (3) would snap to ref.left (0) if considered, but only the
    // right edge is active and it is nowhere near a ref anchor → no snap.
    const out = computeGuides({ id: 'm', x: 3, y: 500, w: 80, h: 60 }, [ref], T, {
      activeEdges: { right: true },
    });
    expect(out.snappedX).toBe(3);
    expect(out.guides).toHaveLength(0);
  });

  it('snaps the active right edge while leaving the left edge fixed', () => {
    const ref: Rect = { id: 'wide', x: 0, y: 0, w: 1000, h: 10 };
    // right edge 998 → snaps to ref right 1000; delta applies to the right edge.
    const out = computeGuides({ id: 'm', x: 918, y: 500, w: 80, h: 60 }, [ref], T, {
      activeEdges: { right: true },
    });
    expect(out.snappedX).toBe(920); // delta +2; hook applies it to width
    expect(has(out.guides, 'v')).toBe(true);
  });

  it('snaps the active top edge', () => {
    const ref: Rect = { id: 'tall', x: 0, y: 0, w: 10, h: 1000 };
    const out = computeGuides({ id: 'm', x: 500, y: 4, w: 60, h: 40 }, [ref], T, {
      activeEdges: { top: true },
    });
    expect(out.snappedY).toBe(0);
  });
});

describe('computeGuides — no candidates', () => {
  it('returns the raw position and no guides when nothing is in range', () => {
    const ref: Rect = { id: 'far', x: 0, y: 0, w: 100, h: 60 };
    const out = computeGuides({ id: 'm', x: 5000, y: 5000, w: 100, h: 60 }, [ref], T);
    expect(out.snappedX).toBe(5000);
    expect(out.snappedY).toBe(5000);
    expect(out.guides).toHaveLength(0);
  });

  it('returns no guides for an empty ref set', () => {
    const out = computeGuides({ id: 'm', x: 10, y: 10, w: 100, h: 60 }, [], T);
    expect(out.guides).toHaveLength(0);
    expect(out.snappedX).toBe(10);
  });
});

describe('computeGuides — both axes + guide composition', () => {
  it('snaps both axes simultaneously and records ref ids on the guide', () => {
    const ref: Rect = { id: 'corner', x: 0, y: 0, w: 100, h: 100 };
    // left within 3, top within 3 → both axes snap to the same ref.
    const out = computeGuides({ id: 'm', x: 3, y: 3, w: 100, h: 100 }, [ref], T);
    const v = out.guides.find((g) => g.kind === 'v') as { x: number; refIds: string[] };
    const h = out.guides.find((g) => g.kind === 'h') as { y: number; refIds: string[] };
    // both axes resolve to a 3-way tie → centers win
    expect(v.x).toBe(50);
    expect(h.y).toBe(50);
    expect(v.refIds).toContain('corner');
    expect(kinds(out.guides)).toEqual(expect.arrayContaining(['v', 'h']));
  });
});

describe('computeGuides — line-of-sight filter', () => {
  it('aligns to a side-by-side ref (clear horizontal line of sight)', () => {
    const left: Rect = { id: 'left', x: 0, y: 0, w: 100, h: 50 };
    const moving: Rect = { id: 'm', x: 152, y: 0, w: 100, h: 50 };
    const out = computeGuides(moving, [left], T);
    // Same Y → H-guide fires.
    expect(out.guides.find((g) => g.kind === 'h')).toBeDefined();
  });

  it('filters out a ref blocked by an intervening node in the same column', () => {
    // moving at (100, 100), blocker between, far ref at (102, 5000).
    // The blocker sits in moving's column AND between moving and far → far is
    // hidden behind blocker → no alignment to far.
    const moving: Rect = { id: 'm', x: 100, y: 100, w: 50, h: 50 };
    const blocker: Rect = { id: 'blocker', x: 100, y: 300, w: 50, h: 50 };
    const far: Rect = { id: 'far', x: 102, y: 5000, w: 50, h: 50 };
    const out = computeGuides(moving, [blocker, far], T);
    const v = out.guides.find((g) => g.kind === 'v') as
      | { refIds: string[]; y2: number }
      | undefined;
    expect(v).toBeDefined();
    expect(v?.refIds).toEqual(['blocker']);
    expect(v?.refIds).not.toContain('far');
    // Guide line ends at blocker, not far.
    expect(v?.y2).toBeLessThanOrEqual(350);
  });

  it('aligns to a ref with no blocker in between (clear vertical line of sight)', () => {
    // Even in a sparse canvas a ref is seeable when nothing blocks it.
    const moving: Rect = { id: 'm', x: 100, y: 100, w: 50, h: 50 };
    const near: Rect = { id: 'near', x: 100, y: 200, w: 50, h: 50 };
    const out = computeGuides(moving, [near], T);
    expect(out.guides.find((g) => g.kind === 'v')).toBeDefined();
  });

  it('keeps a diagonal ref alignable when no other ref obscures the channel', () => {
    // moving and ref share neither X nor Y projection. Diagonal sight lines
    // are treated as seeable (no principled "between" test in 2D).
    const moving: Rect = { id: 'm', x: 100, y: 100, w: 50, h: 50 };
    const diag: Rect = { id: 'diag', x: 300, y: 152, w: 50, h: 50 };
    const out = computeGuides(moving, [diag], T);
    // moving.bottom=150 within T=6 of diag.top=152 → H-guide fires.
    expect(out.guides.find((g) => g.kind === 'h')).toBeDefined();
  });

  it('horizontal sight line blocks a far same-row ref behind an intervening node', () => {
    // moving on the left; blocker right next to it; far ref way past blocker
    // in the same row.
    const moving: Rect = { id: 'm', x: 0, y: 0, w: 50, h: 50 };
    const blocker: Rect = { id: 'blocker', x: 200, y: 0, w: 50, h: 50 };
    const far: Rect = { id: 'far', x: 5000, y: 0, w: 50, h: 50 };
    const out = computeGuides(moving, [blocker, far], T);
    const h = out.guides.find((g) => g.kind === 'h') as
      | { refIds: string[]; x2: number }
      | undefined;
    expect(h).toBeDefined();
    expect(h?.refIds).toEqual(expect.arrayContaining(['blocker']));
    expect(h?.refIds).not.toContain('far');
  });

  it('includes multiple unblocked refs in the same guide line span', () => {
    // Two refs both above moving, in moving's column, but neither blocks the
    // other (they sit side-by-side X-wise within the column).
    // Actually: refs in the same column with full X-overlap CAN block each
    // other if Y-stacked. Use refs with partial X-overlap so neither hides
    // the other: ref1 at x=100..120, ref2 at x=130..150, moving covers 100..150.
    const moving: Rect = { id: 'm', x: 100, y: 200, w: 50, h: 50 };
    const r1: Rect = { id: 'r1', x: 100, y: 0, w: 20, h: 40 };
    const r2: Rect = { id: 'r2', x: 130, y: 50, w: 20, h: 40 };
    const out = computeGuides(moving, [r1, r2], T);
    // moving.left=100 matches r1.left=100 → V-guide fires; r1 + r2 both
    // contribute since neither blocks the other (different X-columns).
    const v = out.guides.find((g) => g.kind === 'v') as { refIds: string[] } | undefined;
    expect(v).toBeDefined();
    expect(v?.refIds).toContain('r1');
  });
});
