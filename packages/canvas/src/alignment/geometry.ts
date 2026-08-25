/**
 * Pure alignment geometry for the canvas alignment-guides subsystem.
 *
 * Zero React / DOM dependencies so the snapping algorithm can be exhaustively
 * unit-tested. See git history: 2026-06-01-canvas-alignment-guides-design.md.
 *
 * Spacing-guide naming follows the design-doc field SHAPES (not axis names):
 *   - `spacing-v` carries { x1, x2, y } → a horizontal segment, emitted for
 *     equal *horizontal* (X-axis) distribution.
 *   - `spacing-h` carries { y1, y2, x } → a vertical segment, emitted for
 *     equal *vertical* (Y-axis) distribution.
 *
 * Out of scope (v1): snapping to viewport center / canvas edges, snapping to a
 * background grid, keyboard nudge alignment.
 */

const EPS = 1e-6;

export type Rect = { id: string; x: number; y: number; w: number; h: number };

export type GuideLine =
  | { kind: 'v'; x: number; y1: number; y2: number; refIds: string[] }
  | { kind: 'h'; y: number; x1: number; x2: number; refIds: string[] }
  | { kind: 'spacing-v'; x1: number; x2: number; y: number; gap: number }
  | { kind: 'spacing-h'; y1: number; y2: number; x: number; gap: number };

export type SnapResult = {
  snappedX: number;
  snappedY: number;
  guides: GuideLine[];
};

/** Which edges of a rect are being dragged during a resize gesture. */
export type ResizeEdges = { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean };

export interface ComputeGuidesOptions {
  /** When true, spacing guides are still detected/emitted but never adjust the snap offset. */
  resizeMode?: boolean;
  /**
   * Resize only: restrict which moving edges participate in the edge/center pass.
   * Center anchors are never considered while resizing. When omitted, all six
   * edge/center anchors participate (the drag path).
   */
  activeEdges?: ResizeEdges;
}

type Anchor = { value: number; isCenter: boolean };

const near = (a: number, b: number): boolean => Math.abs(a - b) <= EPS;

function movingXAnchors(r: Rect, activeEdges?: ResizeEdges): Anchor[] {
  if (activeEdges) {
    const out: Anchor[] = [];
    if (activeEdges.left) out.push({ value: r.x, isCenter: false });
    if (activeEdges.right) out.push({ value: r.x + r.w, isCenter: false });
    return out;
  }
  return [
    { value: r.x, isCenter: false },
    { value: r.x + r.w / 2, isCenter: true },
    { value: r.x + r.w, isCenter: false },
  ];
}

function movingYAnchors(r: Rect, activeEdges?: ResizeEdges): Anchor[] {
  if (activeEdges) {
    const out: Anchor[] = [];
    if (activeEdges.top) out.push({ value: r.y, isCenter: false });
    if (activeEdges.bottom) out.push({ value: r.y + r.h, isCenter: false });
    return out;
  }
  return [
    { value: r.y, isCenter: false },
    { value: r.y + r.h / 2, isCenter: true },
    { value: r.y + r.h, isCenter: false },
  ];
}

function refXAnchorValues(r: Rect): number[] {
  return [r.x, r.x + r.w / 2, r.x + r.w];
}

function refYAnchorValues(r: Rect): number[] {
  return [r.y, r.y + r.h / 2, r.y + r.h];
}

/**
 * Line-of-sight visibility test: is `r` "seeable" from `moving`, given the
 * other refs in `all`? A ref is blocked when another ref's bounding box sits
 * directly between moving and r in the relevant communication channel:
 *
 *  - Refs that share moving's X-column (vertical sight line): blocked by any
 *    third ref also X-overlapping both, whose Y sits between them.
 *  - Refs that share moving's Y-row (horizontal sight line): blocked by any
 *    third ref also Y-overlapping both, whose X sits between them.
 *  - Diagonal refs (no projection overlap with moving on either axis): always
 *    seeable. No principled "between" test in two dimensions; matches the
 *    Figma/Miro feel where a corner-of-canvas neighbor can still align.
 */
function isSeeable(M: Rect, R: Rect, all: Rect[]): boolean {
  const xOverlapMR = M.x < R.x + R.w - EPS && R.x < M.x + M.w - EPS;
  const yOverlapMR = M.y < R.y + R.h - EPS && R.y < M.y + M.h - EPS;

  // Overlapping refs are trivially seeable (no gap to block).
  if (xOverlapMR && yOverlapMR) return true;

  if (xOverlapMR) {
    // Vertical sight line. R is above or below M.
    const aboveR = R.y + R.h <= M.y + EPS;
    for (const C of all) {
      if (C.id === M.id || C.id === R.id) continue;
      const xOverlapCM = C.x < M.x + M.w - EPS && M.x < C.x + C.w - EPS;
      const xOverlapCR = C.x < R.x + R.w - EPS && R.x < C.x + C.w - EPS;
      if (!xOverlapCM || !xOverlapCR) continue;
      const blocks = aboveR
        ? C.y + C.h > R.y + EPS && C.y < M.y - EPS
        : C.y + C.h > M.y + M.h + EPS && C.y < R.y - EPS;
      if (blocks) return false;
    }
    return true;
  }

  if (yOverlapMR) {
    // Horizontal sight line. R is left or right of M.
    const rightOfM = R.x >= M.x + M.w - EPS;
    for (const C of all) {
      if (C.id === M.id || C.id === R.id) continue;
      const yOverlapCM = C.y < M.y + M.h - EPS && M.y < C.y + C.h - EPS;
      const yOverlapCR = C.y < R.y + R.h - EPS && R.y < C.y + C.h - EPS;
      if (!yOverlapCM || !yOverlapCR) continue;
      const blocks = rightOfM
        ? C.x + C.w > M.x + M.w + EPS && C.x < R.x - EPS
        : C.x + C.w > R.x + R.w + EPS && C.x < M.x - EPS;
      if (blocks) return false;
    }
    return true;
  }

  // Diagonal: no principled "between" test; treat as seeable.
  return true;
}

/**
 * Filter `refs` down to the "seeable" set from `moving` — refs not blocked by
 * another ref's bounding box along their communication channel with moving.
 * O(n²) worst case; fine for the typical canvas (<100 nodes).
 */
function seeableRefs(moving: Rect, refs: Rect[]): Rect[] {
  return refs.filter((r) => isSeeable(moving, r, refs));
}

/**
 * Pick the single closest edge/center alignment on one axis within threshold.
 * Ties (equal |delta|) break toward a moving center anchor (Figma convention).
 */
function bestAxisSnap(
  movingAnchors: Anchor[],
  refs: Rect[],
  anchorValuesOf: (r: Rect) => number[],
  threshold: number,
): { delta: number; line: number } | null {
  let best: { delta: number; abs: number; isCenter: boolean; line: number } | null = null;
  for (const ma of movingAnchors) {
    for (const r of refs) {
      for (const rv of anchorValuesOf(r)) {
        const delta = rv - ma.value;
        const abs = Math.abs(delta);
        if (abs > threshold + EPS) continue;
        const better =
          best === null ||
          abs < best.abs - EPS ||
          (Math.abs(abs - best.abs) <= EPS && ma.isCenter && !best.isCenter);
        if (better) best = { delta, abs, isCenter: ma.isCenter, line: rv };
      }
    }
  }
  return best ? { delta: best.delta, line: best.line } : null;
}

function buildVGuide(line: number, moving: Rect, refs: Rect[]): GuideLine {
  const involved = refs.filter((r) => refXAnchorValues(r).some((v) => near(v, line)));
  let y1 = moving.y;
  let y2 = moving.y + moving.h;
  for (const r of involved) {
    y1 = Math.min(y1, r.y);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { kind: 'v', x: line, y1, y2, refIds: involved.map((r) => r.id) };
}

function buildHGuide(line: number, moving: Rect, refs: Rect[]): GuideLine {
  const involved = refs.filter((r) => refYAnchorValues(r).some((v) => near(v, line)));
  let x1 = moving.x;
  let x2 = moving.x + moving.w;
  for (const r of involved) {
    x1 = Math.min(x1, r.x);
    x2 = Math.max(x2, r.x + r.w);
  }
  return { kind: 'h', y: line, x1, x2, refIds: involved.map((r) => r.id) };
}

type SpacingSegment = { from: number; to: number; gap: number };

/**
 * Equal-spacing detection along one axis. `refsAlong` are the perpendicular-
 * overlapping reference intervals on that axis; `movingLo`/`size` describe the
 * moving rect's interval. Returns the snap delta plus the segments to draw.
 */
function computeSpacing(
  movingLo: number,
  size: number,
  refsAlong: { lo: number; hi: number }[],
  threshold: number,
): { delta: number; segments: SpacingSegment[] } | null {
  if (refsAlong.length < 2) return null;
  const sorted = [...refsAlong].sort((a, b) => a.lo - b.lo);
  const candidates: { targetLo: number; segments: SpacingSegment[] }[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (!a || !b) continue;
    const free = b.lo - a.hi;

    // Moving rect centered between two adjacent refs (equal gaps on both sides).
    if (free >= size - EPS) {
      const gap = (free - size) / 2;
      const targetLo = a.hi + gap;
      candidates.push({
        targetLo,
        segments: [
          { from: a.hi, to: targetLo, gap },
          { from: targetLo + size, to: b.lo, gap },
        ],
      });
    }

    // Continuation: extend the existing a→b gap to the outboard side.
    const existingGap = b.lo - a.hi;
    if (existingGap >= -EPS) {
      const rightTargetLo = b.hi + existingGap;
      candidates.push({
        targetLo: rightTargetLo,
        segments: [
          { from: a.hi, to: b.lo, gap: existingGap },
          { from: b.hi, to: rightTargetLo, gap: existingGap },
        ],
      });
      const leftTargetLo = a.lo - existingGap - size;
      candidates.push({
        targetLo: leftTargetLo,
        segments: [
          { from: leftTargetLo + size, to: a.lo, gap: existingGap },
          { from: a.hi, to: b.lo, gap: existingGap },
        ],
      });
    }
  }

  let best: { delta: number; abs: number; segments: SpacingSegment[] } | null = null;
  for (const c of candidates) {
    const delta = c.targetLo - movingLo;
    const abs = Math.abs(delta);
    if (abs > threshold + EPS) continue;
    if (best === null || abs < best.abs - EPS) best = { delta, abs, segments: c.segments };
  }
  return best ? { delta: best.delta, segments: best.segments } : null;
}

/**
 * Core alignment algorithm: given a moving rect and a set of reference rects,
 * compute the snapped top-left position plus the guide lines to render.
 *
 * Two passes:
 *  1. Edge/center pass — for each axis, snap to the closest ref edge/center
 *     within `thresholdWorld`. Ties break toward centers.
 *  2. Spacing pass — runs only when the edge pass snapped at least one axis.
 *     Equalizes distribution on the axis the edge pass left free (edge wins on
 *     same-axis ties). In `resizeMode`, spacing guides are emitted but never
 *     adjust the snap offset.
 */
export function computeGuides(
  moving: Rect,
  refs: Rect[],
  thresholdWorld: number,
  opts: ComputeGuidesOptions = {},
): SnapResult {
  const { resizeMode = false, activeEdges } = opts;
  const guides: GuideLine[] = [];

  // Only refs in line-of-sight of moving participate. A ref that shares a
  // column/row with moving but has ANOTHER ref between them is "blocked" and
  // never triggers a guide. Matches the "only align to nodes you can actually
  // see from moving" rule — a distant node only fires alignment when there's
  // no intervening node to hide behind.
  const neighbors = seeableRefs(moving, refs);

  const xSnap = bestAxisSnap(
    movingXAnchors(moving, activeEdges),
    neighbors,
    refXAnchorValues,
    thresholdWorld,
  );
  const ySnap = bestAxisSnap(
    movingYAnchors(moving, activeEdges),
    neighbors,
    refYAnchorValues,
    thresholdWorld,
  );

  let snappedX = moving.x + (xSnap?.delta ?? 0);
  let snappedY = moving.y + (ySnap?.delta ?? 0);

  const snapped: Rect = { ...moving, x: snappedX, y: snappedY };

  if (xSnap) guides.push(buildVGuide(xSnap.line, snapped, neighbors));
  if (ySnap) guides.push(buildHGuide(ySnap.line, snapped, neighbors));

  // Spacing pass — also restricted to cardinal neighbors. Equal-spacing only
  // makes sense with refs that are actually "next to" moving.
  if (xSnap || ySnap) {
    // X-axis spacing only if the edge pass left X free (edge wins same-axis tie).
    if (!xSnap) {
      const yOverlap = neighbors.filter(
        (r) => snapped.y < r.y + r.h - EPS && r.y < snapped.y + snapped.h - EPS,
      );
      const sp = computeSpacing(
        snapped.x,
        moving.w,
        yOverlap.map((r) => ({ lo: r.x, hi: r.x + r.w })),
        thresholdWorld,
      );
      if (sp) {
        if (!resizeMode) snappedX += sp.delta;
        const y = snapped.y + snapped.h / 2;
        for (const seg of sp.segments) {
          guides.push({ kind: 'spacing-v', x1: seg.from, x2: seg.to, y, gap: seg.gap });
        }
      }
    }
    // Y-axis spacing only if the edge pass left Y free.
    if (!ySnap) {
      const xOverlap = neighbors.filter(
        (r) => snapped.x < r.x + r.w - EPS && r.x < snapped.x + snapped.w - EPS,
      );
      const sp = computeSpacing(
        snapped.y,
        moving.h,
        xOverlap.map((r) => ({ lo: r.y, hi: r.y + r.h })),
        thresholdWorld,
      );
      if (sp) {
        if (!resizeMode) snappedY += sp.delta;
        const x = snapped.x + snapped.w / 2;
        for (const seg of sp.segments) {
          guides.push({ kind: 'spacing-h', y1: seg.from, y2: seg.to, x, gap: seg.gap });
        }
      }
    }
  }

  return { snappedX, snappedY, guides };
}
