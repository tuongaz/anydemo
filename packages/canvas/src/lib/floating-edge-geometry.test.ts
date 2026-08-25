import { describe, expect, it } from 'bun:test';
import {
  type Endpoint,
  type Pin,
  endpointFromPin,
  endpointToPin,
  getNodeIntersection,
  projectCursorToPerimeter,
  resolveEdgeEndpoints,
  snapPinToStraight,
} from './floating-edge-geometry';

describe('getNodeIntersection', () => {
  // Standard 100×60 rectangle anchored at the origin so center=(50,30).
  const rect = { x: 0, y: 0, w: 100, h: 60 };

  it('returns side="right" when target is straight to the right', () => {
    const out = getNodeIntersection(rect, { x: 500, y: 30 });
    expect(out.side).toBe('right');
    expect(out.x).toBeCloseTo(100);
    expect(out.y).toBeCloseTo(30);
  });

  it('returns side="left" when target is straight to the left', () => {
    const out = getNodeIntersection(rect, { x: -500, y: 30 });
    expect(out.side).toBe('left');
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(30);
  });

  it('returns side="top" when target is straight above', () => {
    const out = getNodeIntersection(rect, { x: 50, y: -500 });
    expect(out.side).toBe('top');
    expect(out.x).toBeCloseTo(50);
    expect(out.y).toBeCloseTo(0);
  });

  it('returns side="bottom" when target is straight below', () => {
    const out = getNodeIntersection(rect, { x: 50, y: 500 });
    expect(out.side).toBe('bottom');
    expect(out.x).toBeCloseTo(50);
    expect(out.y).toBeCloseTo(60);
  });

  it('returns a deterministic side at the 45° tie (x-axis wins)', () => {
    // Square geometry — halfW === halfH so the |dx|*halfH vs |dy|*halfW tie
    // resolves to the x-axis with the sign of dx.
    const square = { x: 0, y: 0, w: 100, h: 100 };
    expect(getNodeIntersection(square, { x: 200, y: 200 }).side).toBe('right');
    expect(getNodeIntersection(square, { x: -200, y: -200 }).side).toBe('left');
  });

  it('returns a stable fallback (no NaN/Infinity) for degenerate same-center input', () => {
    const out = getNodeIntersection(rect, { x: 50, y: 30 });
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.y)).toBe(true);
    expect(out.x).toBe(50);
    expect(out.y).toBe(30);
    // Side is documented to fall back to 'right' for stability.
    expect(out.side).toBe('right');
  });

  it('intersection lies on the rectangle perimeter for arbitrary directions', () => {
    // Sample a few off-axis directions and verify the intersection's
    // distance from the center matches the analytic formula (the ray exits
    // at exactly one of the four edges).
    const samples = [
      { x: 200, y: 100 },
      { x: -300, y: 50 },
      { x: 50, y: -90 },
      { x: 75, y: 80 },
    ];
    for (const s of samples) {
      const out = getNodeIntersection(rect, s);
      // Either x is on the left/right edge OR y is on the top/bottom edge
      // (within float tolerance).
      const onVertical = Math.abs(out.x - 0) < 1e-6 || Math.abs(out.x - 100) < 1e-6;
      const onHorizontal = Math.abs(out.y - 0) < 1e-6 || Math.abs(out.y - 60) < 1e-6;
      expect(onVertical || onHorizontal).toBe(true);
    }
  });

  it('honors the rectangle aspect ratio when picking the side', () => {
    // Tall rectangle: 50×200, center (25, 100). A target at (200, 200) is
    // 175 right and 100 down. Aspect: |dx|*halfH = 175*100 = 17500;
    // |dy|*halfW = 100*25 = 2500. Horizontal dominates → 'right'.
    const tall = { x: 0, y: 0, w: 50, h: 200 };
    expect(getNodeIntersection(tall, { x: 200, y: 200 }).side).toBe('right');
    // For the same target relative to a wide rectangle (200×50, center
    // (100,25)), |dx|=100 |dy|=175, halfH=25, halfW=100 →
    // |dx|*halfH=2500, |dy|*halfW=17500 → 'bottom'.
    const wide = { x: 0, y: 0, w: 200, h: 50 };
    expect(getNodeIntersection(wide, { x: 200, y: 200 }).side).toBe('bottom');
  });

  // Canvas grouping M8 (step 2): a connector to/from a GROUP must anchor to the
  // group's (large) perimeter, not a member's. The geometry is size-agnostic —
  // these tests pin it for a realistic large group box so a regression that
  // anchored to a member-sized box (e.g. 160×60) instead of the group box would
  // fail here. Group box: 600×400 at (1000, 1000), center (1300, 1200).
  describe('group-sized (large) box anchoring (M8)', () => {
    const groupBox = { x: 1000, y: 1000, w: 600, h: 400 };

    it('anchors a connector from an outside node on the RIGHT to the group right edge', () => {
      // Outside node center far to the right and vertically centered → exits the
      // group's right edge at its vertical midpoint, NOT a member's edge.
      const out = getNodeIntersection(groupBox, { x: 5000, y: 1200 });
      expect(out.side).toBe('right');
      expect(out.x).toBeCloseTo(1600); // x + w
      expect(out.y).toBeCloseTo(1200); // center y
    });

    it('anchors a connector from an outside node ABOVE to the group top edge (title band)', () => {
      // A Position.Top anchor lands on the title band's top border (design §11
      // L7.4: the band is INSIDE the box; the anchor sits on the box's top edge).
      const out = getNodeIntersection(groupBox, { x: 1300, y: -2000 });
      expect(out.side).toBe('top');
      expect(out.x).toBeCloseTo(1300); // center x
      expect(out.y).toBeCloseTo(1000); // y (top edge)
    });

    it('the anchor lies ON the large perimeter for arbitrary outside directions', () => {
      const center = { x: 1300, y: 1200 };
      const samples = [
        { x: 4000, y: 2500 },
        { x: -1000, y: 1100 },
        { x: 1350, y: -800 },
        { x: 1250, y: 6000 },
      ];
      for (const s of samples) {
        const out = getNodeIntersection(groupBox, s);
        const onVertical =
          Math.abs(out.x - groupBox.x) < 1e-6 || Math.abs(out.x - (groupBox.x + groupBox.w)) < 1e-6;
        const onHorizontal =
          Math.abs(out.y - groupBox.y) < 1e-6 || Math.abs(out.y - (groupBox.y + groupBox.h)) < 1e-6;
        expect(onVertical || onHorizontal).toBe(true);
        // And the anchor stays on the ray from the group center toward the target
        // (same direction → cross-product ~0), i.e. it never snaps to a member.
        const cross = (out.x - center.x) * (s.y - center.y) - (out.y - center.y) * (s.x - center.x);
        expect(Math.abs(cross)).toBeLessThan(1e-6);
      }
    });
  });
});

describe('resolveEdgeEndpoints', () => {
  // Two 100×60 rectangles: A at origin, B at (300, 0) — clear left-of-right
  // geometry that lets the assertions read off the perimeter coords.
  const aBox = { x: 0, y: 0, w: 100, h: 60 };
  const bBox = { x: 300, y: 0, w: 100, h: 60 };
  const aFallback: Endpoint = { x: 50, y: 0, side: 'top' };
  const bFallback: Endpoint = { x: 350, y: 60, side: 'bottom' };

  it('uses perimeter intersections when both endpoints are floating (true)', () => {
    const out = resolveEdgeEndpoints(
      { box: aBox, autoPicked: true, fallback: aFallback },
      { box: bBox, autoPicked: true, fallback: bFallback },
    );
    // A is left of B → A's source endpoint floats out the right edge at
    // (100, 30); B's target endpoint floats out the left edge at (300, 30).
    expect(out.source).toEqual({ x: 100, y: 30, side: 'right' });
    expect(out.target).toEqual({ x: 300, y: 30, side: 'left' });
  });

  it('uses perimeter intersections when both endpoints are floating (undefined → default)', () => {
    // autoPicked: undefined is the migration default — pre-US-021 connectors
    // had no flag at all and must render as floating.
    const out = resolveEdgeEndpoints(
      { box: aBox, autoPicked: undefined, fallback: aFallback },
      { box: bBox, autoPicked: undefined, fallback: bFallback },
    );
    expect(out.source).toEqual({ x: 100, y: 30, side: 'right' });
    expect(out.target).toEqual({ x: 300, y: 30, side: 'left' });
  });

  it('returns the React-Flow fallback for a pinned (autoPicked: false) endpoint', () => {
    // Source pinned, target floating: only the target endpoint moves to the
    // perimeter. The pinned source stays at its fallback coords/side even
    // though the geometry "wants" right, not top.
    const out = resolveEdgeEndpoints(
      { box: aBox, autoPicked: false, fallback: aFallback },
      { box: bBox, autoPicked: true, fallback: bFallback },
    );
    expect(out.source).toEqual(aFallback);
    expect(out.target).toEqual({ x: 300, y: 30, side: 'left' });
  });

  it('handles both endpoints pinned by returning both fallbacks unchanged', () => {
    const out = resolveEdgeEndpoints(
      { box: aBox, autoPicked: false, fallback: aFallback },
      { box: bBox, autoPicked: false, fallback: bFallback },
    );
    expect(out.source).toEqual(aFallback);
    expect(out.target).toEqual(bFallback);
  });

  it('falls back when the source node box is missing', () => {
    // sourceNode hasn't been measured yet — the helper returns the React
    // Flow fallback rather than crashing. Real path: editable-edge passes
    // null when useInternalNode returns undefined. With only one side
    // available, neither endpoint floats (computing the line-through-
    // centers requires both centers), so both endpoints return fallbacks.
    const out = resolveEdgeEndpoints(null, {
      box: bBox,
      autoPicked: true,
      fallback: bFallback,
    });
    // No source input was provided — the helper returns its built-in
    // safe-fallback for the source side.
    expect(out.source.side).toBe('right');
    expect(out.source.x).toBe(0);
    expect(out.source.y).toBe(0);
    expect(out.target).toEqual(bFallback);
  });

  it('falls back when the target node box is missing', () => {
    const out = resolveEdgeEndpoints({ box: aBox, autoPicked: true, fallback: aFallback }, null);
    expect(out.source).toEqual(aFallback);
    expect(out.target.side).toBe('left');
  });

  // US-006: pinned endpoints. A pin parameterizes the endpoint to `(side, t)`
  // against the live node bbox, so the endpoint tracks the node through
  // translation and resize. Pins take precedence over both floating
  // (autoPicked !== false) and handle-pinned (autoPicked === false).
  describe('US-006 pinned endpoints', () => {
    it('uses the pin when sourcePin is set, overriding floating behavior', () => {
      // Pin source at top-side, midpoint. Without the pin, A is left of B and
      // would float out the right edge at (100, 30). With the pin, it must
      // sit at (50, 0) on the top edge.
      const out = resolveEdgeEndpoints(
        {
          box: aBox,
          autoPicked: true,
          fallback: aFallback,
          pin: { side: 'top', t: 0.5 },
        },
        { box: bBox, autoPicked: true, fallback: bFallback },
      );
      expect(out.source).toEqual({ x: 50, y: 0, side: 'top' });
      // Target stays floating; geometry-wise the line through the centers
      // now exits B somewhere different, but it's still on B's perimeter.
      expect(out.target.side).toBe('left');
    });

    it('uses the pin when targetPin is set, overriding floating behavior', () => {
      const out = resolveEdgeEndpoints(
        { box: aBox, autoPicked: true, fallback: aFallback },
        {
          box: bBox,
          autoPicked: true,
          fallback: bFallback,
          pin: { side: 'right', t: 0.25 },
        },
      );
      // Target pinned: right edge of B at t=0.25 along the side (top→bottom).
      // B spans y in [0, 60], so t=0.25 → y=15. Right edge x = 300 + 100 = 400.
      expect(out.target).toEqual({ x: 400, y: 15, side: 'right' });
    });

    it('overrides autoPicked === false when a pin is set', () => {
      // autoPicked === false would normally return the React-Flow fallback,
      // but the pin takes precedence and computes from the bbox.
      const out = resolveEdgeEndpoints(
        {
          box: aBox,
          autoPicked: false,
          fallback: aFallback,
          pin: { side: 'bottom', t: 1 },
        },
        { box: bBox, autoPicked: true, fallback: bFallback },
      );
      // Bottom-right corner of A: (100, 60).
      expect(out.source).toEqual({ x: 100, y: 60, side: 'bottom' });
    });

    it('keeps a pinned endpoint at its parameterized perimeter position across node translation', () => {
      const pin: Pin = { side: 'right', t: 0.75 };
      const before = resolveEdgeEndpoints(
        { box: aBox, autoPicked: true, fallback: aFallback, pin },
        { box: bBox, autoPicked: true, fallback: bFallback },
      );
      // Translate A by (+200, +400). Pin must follow.
      const translated = { x: 200, y: 400, w: 100, h: 60 };
      const after = resolveEdgeEndpoints(
        { box: translated, autoPicked: true, fallback: aFallback, pin },
        { box: bBox, autoPicked: true, fallback: bFallback },
      );
      // Before: right edge x=100, t=0.75 of h=60 → y=45.
      expect(before.source).toEqual({ x: 100, y: 45, side: 'right' });
      // After: right edge x=300, y=400 + 45 = 445.
      expect(after.source).toEqual({ x: 300, y: 445, side: 'right' });
      // Both sit on the right edge — confirms no drift toward the other
      // endpoint's center (which is what an unpinned floating endpoint
      // would do after a large translation).
      expect(after.source.side).toBe('right');
    });

    it('scales a pinned endpoint with node resize (t is parameterized along the side)', () => {
      const pin: Pin = { side: 'bottom', t: 0.5 };
      // A starts as 100×60; widen to 400×120 and the pin should re-anchor to
      // the midpoint of the new bottom edge.
      const small = { x: 0, y: 0, w: 100, h: 60 };
      const large = { x: 0, y: 0, w: 400, h: 120 };
      const before = resolveEdgeEndpoints(
        { box: small, autoPicked: true, fallback: aFallback, pin },
        { box: bBox, autoPicked: true, fallback: bFallback },
      );
      const after = resolveEdgeEndpoints(
        { box: large, autoPicked: true, fallback: aFallback, pin },
        { box: bBox, autoPicked: true, fallback: bFallback },
      );
      // Bottom-edge midpoint of 100×60 → (50, 60); of 400×120 → (200, 120).
      expect(before.source).toEqual({ x: 50, y: 60, side: 'bottom' });
      expect(after.source).toEqual({ x: 200, y: 120, side: 'bottom' });
    });

    it('clamps an out-of-range t to [0, 1] so callers cannot produce off-perimeter coords', () => {
      // t below 0 → clamps to 0 (start of side).
      const below = endpointFromPin(aBox, { side: 'left', t: -1 });
      expect(below).toEqual({ x: 0, y: 0, side: 'left' });
      // t above 1 → clamps to 1 (end of side).
      const above = endpointFromPin(aBox, { side: 'left', t: 5 });
      expect(above).toEqual({ x: 0, y: 60, side: 'left' });
    });

    it('honors no-pin case (geometry byte-identical to today)', () => {
      // Explicitly omit the pin field and confirm both endpoints still
      // float — this is the back-compat invariant for existing flow files.
      const out = resolveEdgeEndpoints(
        { box: aBox, autoPicked: undefined, fallback: aFallback },
        { box: bBox, autoPicked: undefined, fallback: bFallback },
      );
      expect(out.source).toEqual({ x: 100, y: 30, side: 'right' });
      expect(out.target).toEqual({ x: 300, y: 30, side: 'left' });
    });
  });

  // Canvas grouping M8 (step 2 + guardrail "edge re-anchors on group move/
  // resize"): a connector between a loose node and a GROUP must float against
  // the group's large box, and the anchor must follow when the group is
  // translated (M5 move) or resized (M5 resize). resolveEdgeEndpoints is the
  // exact function editable-edge.tsx calls with the group's live measured box.
  describe('connector to a group (large box, re-anchors on move/resize) (M8)', () => {
    // Loose node well to the LEFT of the group.
    const loose = { x: 0, y: 1180, w: 100, h: 60 };
    const looseFallback: Endpoint = { x: 100, y: 1210, side: 'right' };
    const groupFallback: Endpoint = { x: 1000, y: 1200, side: 'left' };

    it('floats both endpoints against the group box (anchor on the group border, not a member)', () => {
      const group = { x: 1000, y: 1000, w: 600, h: 400 }; // center (1300, 1200)
      const out = resolveEdgeEndpoints(
        { box: loose, autoPicked: true, fallback: looseFallback },
        { box: group, autoPicked: true, fallback: groupFallback },
      );
      // Loose center (50, 1210); group center (1300, 1200). The line is almost
      // horizontal → loose exits its right edge, group's TARGET exits its LEFT
      // edge at x = 1000 (the group border), never a member inside it.
      expect(out.source.side).toBe('right');
      expect(out.source.x).toBeCloseTo(100);
      expect(out.target.side).toBe('left');
      expect(out.target.x).toBeCloseTo(1000);
    });

    it('re-anchors the group endpoint when the group is MOVED (M5 fan-out)', () => {
      const before = resolveEdgeEndpoints(
        { box: loose, autoPicked: true, fallback: looseFallback },
        { box: { x: 1000, y: 1000, w: 600, h: 400 }, autoPicked: true, fallback: groupFallback },
      );
      // Move the group +500 right / +200 down. The target anchor must follow to
      // the moved group's left edge (still the border, recomputed live).
      const after = resolveEdgeEndpoints(
        { box: loose, autoPicked: true, fallback: looseFallback },
        { box: { x: 1500, y: 1200, w: 600, h: 400 }, autoPicked: true, fallback: groupFallback },
      );
      expect(before.target.x).toBeCloseTo(1000);
      expect(after.target.x).toBeCloseTo(1500); // tracks the group's new left edge
      expect(after.target.side).toBe('left');
    });

    it('re-anchors the group endpoint when the group is RESIZED (M5 scale)', () => {
      // Group grows from 600×400 to 1000×800 anchored at the same top-left. Its
      // left edge x is unchanged but the anchor's y (the side midpoint of the
      // near-horizontal line) re-resolves against the new height.
      const small = resolveEdgeEndpoints(
        { box: loose, autoPicked: true, fallback: looseFallback },
        { box: { x: 1000, y: 1000, w: 600, h: 400 }, autoPicked: true, fallback: groupFallback },
      );
      const large = resolveEdgeEndpoints(
        { box: loose, autoPicked: true, fallback: looseFallback },
        { box: { x: 1000, y: 1000, w: 1000, h: 800 }, autoPicked: true, fallback: groupFallback },
      );
      expect(small.target.side).toBe('left');
      expect(large.target.side).toBe('left');
      expect(large.target.x).toBeCloseTo(1000);
      // The anchor stays on the (now taller) perimeter — within the new box's y
      // span [1000, 1800], confirming it recomputed against the resized box.
      expect(large.target.y).toBeGreaterThanOrEqual(1000);
      expect(large.target.y).toBeLessThanOrEqual(1800);
    });
  });
});

// US-006: direct unit coverage of the pin → coordinate transform. Tested
// independently of resolveEdgeEndpoints because the function is exported and
// used by US-007's pin-drag UI to drive the drag preview.
describe('endpointFromPin', () => {
  const rect = { x: 10, y: 20, w: 100, h: 60 };

  it('top side: t=0 → top-left corner, t=1 → top-right corner', () => {
    expect(endpointFromPin(rect, { side: 'top', t: 0 })).toEqual({ x: 10, y: 20, side: 'top' });
    expect(endpointFromPin(rect, { side: 'top', t: 1 })).toEqual({ x: 110, y: 20, side: 'top' });
  });

  it('bottom side: t=0 → bottom-left corner, t=1 → bottom-right corner', () => {
    expect(endpointFromPin(rect, { side: 'bottom', t: 0 })).toEqual({
      x: 10,
      y: 80,
      side: 'bottom',
    });
    expect(endpointFromPin(rect, { side: 'bottom', t: 1 })).toEqual({
      x: 110,
      y: 80,
      side: 'bottom',
    });
  });

  it('left side: t=0 → top-left corner, t=1 → bottom-left corner', () => {
    expect(endpointFromPin(rect, { side: 'left', t: 0 })).toEqual({ x: 10, y: 20, side: 'left' });
    expect(endpointFromPin(rect, { side: 'left', t: 1 })).toEqual({ x: 10, y: 80, side: 'left' });
  });

  it('right side: t=0 → top-right corner, t=1 → bottom-right corner', () => {
    expect(endpointFromPin(rect, { side: 'right', t: 0 })).toEqual({
      x: 110,
      y: 20,
      side: 'right',
    });
    expect(endpointFromPin(rect, { side: 'right', t: 1 })).toEqual({
      x: 110,
      y: 80,
      side: 'right',
    });
  });

  it('returns t=0.5 at the midpoint of every side', () => {
    expect(endpointFromPin(rect, { side: 'top', t: 0.5 })).toEqual({ x: 60, y: 20, side: 'top' });
    expect(endpointFromPin(rect, { side: 'bottom', t: 0.5 })).toEqual({
      x: 60,
      y: 80,
      side: 'bottom',
    });
    expect(endpointFromPin(rect, { side: 'left', t: 0.5 })).toEqual({ x: 10, y: 50, side: 'left' });
    expect(endpointFromPin(rect, { side: 'right', t: 0.5 })).toEqual({
      x: 110,
      y: 50,
      side: 'right',
    });
  });
});

// US-007: project a cursor onto the nearest side of a node bbox. Drives the
// pin-drag UI's per-frame side+t computation, so the helper covers the cases
// the drag handler hits: cursor on each side, cursor inside the rect, cursor
// outside the rect (clamped), corner ties, and degenerate zero-dim rects.
describe('projectCursorToPerimeter', () => {
  const rect = { x: 0, y: 0, w: 100, h: 60 };

  it('cursor on the left edge → side="left", t parameterized top→bottom', () => {
    expect(projectCursorToPerimeter(rect, { x: 0, y: 0 })).toEqual({ side: 'left', t: 0 });
    expect(projectCursorToPerimeter(rect, { x: 0, y: 30 })).toEqual({ side: 'left', t: 0.5 });
    expect(projectCursorToPerimeter(rect, { x: 0, y: 60 })).toEqual({ side: 'left', t: 1 });
  });

  it('cursor on the right edge → side="right", t parameterized top→bottom', () => {
    expect(projectCursorToPerimeter(rect, { x: 100, y: 15 })).toEqual({ side: 'right', t: 0.25 });
    expect(projectCursorToPerimeter(rect, { x: 100, y: 45 })).toEqual({ side: 'right', t: 0.75 });
  });

  it('cursor on the top edge → side="top", t parameterized left→right', () => {
    expect(projectCursorToPerimeter(rect, { x: 25, y: 0 })).toEqual({ side: 'top', t: 0.25 });
    expect(projectCursorToPerimeter(rect, { x: 75, y: 0 })).toEqual({ side: 'top', t: 0.75 });
  });

  it('cursor on the bottom edge → side="bottom", t parameterized left→right', () => {
    expect(projectCursorToPerimeter(rect, { x: 50, y: 60 })).toEqual({ side: 'bottom', t: 0.5 });
  });

  it('cursor outside the rect clamps to the nearest perimeter point', () => {
    // Far above-right: clamped to (100, 0); equal distance to top vs right
    // (both 0) — top→bottom tie-break order picks top first since left/right
    // are checked before top, but at the clamped corner relX=100 → dRight=0,
    // dTop=0, dLeft=100, dBottom=60. Order check: left(100)→right(0)→top(0)
    // first non-left match is right because `min === dLeft` is false (100 !== 0).
    expect(projectCursorToPerimeter(rect, { x: 500, y: -500 })).toEqual({
      side: 'right',
      t: 0,
    });
    // Far below-left: clamped to (0, 60). dLeft=0 wins immediately.
    expect(projectCursorToPerimeter(rect, { x: -500, y: 500 })).toEqual({
      side: 'left',
      t: 1,
    });
  });

  it('cursor inside the rect snaps to the closest side', () => {
    // Center is equidistant from top/bottom (30 each) but closer to left (50)
    // and right (50). Tie order: dLeft=50, dRight=50, dTop=30, dBottom=30 →
    // top wins (since dTop=30 < dLeft=50). Verifies the dominant-axis fall.
    expect(projectCursorToPerimeter(rect, { x: 50, y: 30 })).toEqual({ side: 'top', t: 0.5 });
    // 10 inside from the left edge: dLeft=10 wins.
    expect(projectCursorToPerimeter(rect, { x: 10, y: 30 })).toEqual({ side: 'left', t: 0.5 });
    // 10 inside from the bottom edge: dBottom=10 wins.
    expect(projectCursorToPerimeter(rect, { x: 50, y: 50 })).toEqual({ side: 'bottom', t: 0.5 });
  });

  it('tracks the node when the rect is translated (same cursor relative offset → same pin)', () => {
    // Cursor on the right edge of a translated rect should still produce
    // (right, 0.5) — verifies the helper handles non-origin rects correctly.
    const translated = { x: 300, y: 200, w: 100, h: 60 };
    expect(projectCursorToPerimeter(translated, { x: 400, y: 230 })).toEqual({
      side: 'right',
      t: 0.5,
    });
  });

  it('handles a zero-width rect by collapsing left/right t to 0', () => {
    // 0×60 rect: relX is always clamped to 0 so dLeft=0 wins; t is the
    // vertical fraction.
    const zeroWidth = { x: 0, y: 0, w: 0, h: 60 };
    expect(projectCursorToPerimeter(zeroWidth, { x: 5, y: 30 })).toEqual({
      side: 'left',
      t: 0.5,
    });
  });

  it('handles a zero-height rect by collapsing top/bottom t to 0', () => {
    const zeroHeight = { x: 0, y: 0, w: 100, h: 0 };
    expect(projectCursorToPerimeter(zeroHeight, { x: 50, y: 5 })).toEqual({
      side: 'top',
      t: 0.5,
    });
  });
});

// Round-trip helper: pin → endpoint → pin should preserve (side, t) for
// any side/t pair on a non-degenerate rect. Used by the reconnect-and-pin
// path to convert a floating intersection back into a pin so the un-moved
// endpoint stays anchored when the moved side changes nodes.
describe('endpointToPin (inverse of endpointFromPin)', () => {
  const rect = { x: 10, y: 20, w: 200, h: 100 };

  it('round-trips every side at t=0, t=0.5, t=1', () => {
    const sides = ['top', 'right', 'bottom', 'left'] as const;
    const ts = [0, 0.25, 0.5, 0.75, 1];
    for (const side of sides) {
      for (const t of ts) {
        const pin: Pin = { side, t };
        const ep = endpointFromPin(rect, pin);
        const back = endpointToPin(rect, ep);
        expect(back.side).toBe(side);
        expect(back.t).toBeCloseTo(t, 6);
      }
    }
  });

  it('clamps off-perimeter endpoints into [0, 1]', () => {
    // An endpoint claimed to be on the top side but with x past the right
    // edge → t clamps to 1. (Defensive: getNodeIntersection always lands on
    // the perimeter, so this shouldn't happen in practice, but the helper
    // must never produce a t outside [0, 1].)
    const ep: Endpoint = { x: rect.x + rect.w + 50, y: rect.y, side: 'top' };
    expect(endpointToPin(rect, ep)).toEqual({ side: 'top', t: 1 });
  });

  it('collapses t to 0 on a zero-width rect (top/bottom)', () => {
    const zeroW = { x: 0, y: 0, w: 0, h: 60 };
    const ep: Endpoint = { x: 0, y: 0, side: 'top' };
    expect(endpointToPin(zeroW, ep)).toEqual({ side: 'top', t: 0 });
  });

  it('collapses t to 0 on a zero-height rect (left/right)', () => {
    const zeroH = { x: 0, y: 0, w: 100, h: 0 };
    const ep: Endpoint = { x: 0, y: 0, side: 'left' };
    expect(endpointToPin(zeroH, ep)).toEqual({ side: 'left', t: 0 });
  });
});

describe('snapPinToStraight', () => {
  const box = { x: 0, y: 0, w: 100, h: 100 };

  it('snaps a bottom-side pin to vertical alignment when within threshold', () => {
    // Pin at t=0.5 → moving point (50, 100). Fixed endpoint at x=52 is 2px away
    // (< 8 threshold) → retarget t so moving.x === 52 → t = 0.52.
    const snapped = snapPinToStraight(box, { side: 'bottom', t: 0.5 }, { x: 52, y: 200 }, 8);
    expect(snapped.side).toBe('bottom');
    expect(snapped.t).toBeCloseTo(0.52, 6);
    expect(endpointFromPin(box, snapped).x).toBeCloseTo(52, 6);
  });

  it('snaps a right-side pin to horizontal alignment when within threshold', () => {
    // Pin at t=0.5 → moving (100, 50). Fixed y=53 → t = 0.53 (horizontal line).
    const snapped = snapPinToStraight(box, { side: 'right', t: 0.5 }, { x: 200, y: 53 }, 8);
    expect(snapped.side).toBe('right');
    expect(snapped.t).toBeCloseTo(0.53, 6);
    expect(endpointFromPin(box, snapped).y).toBeCloseTo(53, 6);
  });

  it('returns the pin unchanged when the fixed endpoint is beyond the threshold', () => {
    const pin: Pin = { side: 'bottom', t: 0.5 };
    expect(snapPinToStraight(box, pin, { x: 70, y: 200 }, 8)).toEqual(pin);
  });

  it('never changes the side (only nudges t)', () => {
    const pin: Pin = { side: 'top', t: 0.4 };
    const snapped = snapPinToStraight(box, pin, { x: 43, y: -50 }, 8);
    expect(snapped.side).toBe('top');
    expect(snapped.t).toBeCloseTo(0.43, 6);
  });

  it('does not snap when the aligned t would fall outside [0, 1]', () => {
    // Moving x=2 (t=0.02 on bottom). Fixed x=-3 is within 8px but would need
    // t=-0.03 (off the side) → leave the pin alone rather than clamp.
    const pin: Pin = { side: 'bottom', t: 0.02 };
    expect(snapPinToStraight(box, pin, { x: -3, y: 200 }, 8)).toEqual(pin);
  });

  it('leaves degenerate (zero-size) boxes untouched', () => {
    const zeroW = { x: 0, y: 0, w: 0, h: 100 };
    const pin: Pin = { side: 'bottom', t: 0 };
    expect(snapPinToStraight(zeroW, pin, { x: 0, y: 200 }, 8)).toEqual(pin);
  });
});
