/**
 * Pure alignment geometry for the canvas alignment-guides subsystem.
 *
 * Zero React / DOM dependencies so the snapping algorithm can be exhaustively
 * unit-tested. See docs/plans/2026-06-01-canvas-alignment-guides-design.md.
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

  const xSnap = bestAxisSnap(
    movingXAnchors(moving, activeEdges),
    refs,
    refXAnchorValues,
    thresholdWorld,
  );
  const ySnap = bestAxisSnap(
    movingYAnchors(moving, activeEdges),
    refs,
    refYAnchorValues,
    thresholdWorld,
  );

  let snappedX = moving.x + (xSnap?.delta ?? 0);
  let snappedY = moving.y + (ySnap?.delta ?? 0);

  const snapped: Rect = { ...moving, x: snappedX, y: snappedY };

  if (xSnap) guides.push(buildVGuide(xSnap.line, snapped, refs));
  if (ySnap) guides.push(buildHGuide(ySnap.line, snapped, refs));

  // Spacing pass — cheap hot path: only after the edge pass found a snap.
  if (xSnap || ySnap) {
    // X-axis spacing only if the edge pass left X free (edge wins same-axis tie).
    if (!xSnap) {
      const yOverlap = refs.filter(
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
      const xOverlap = refs.filter(
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
