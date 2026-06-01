/**
 * Pure SVG rendering layer for the alignment-guides subsystem.
 *
 * Receives the active `GuideLine[]` and draws them as SVG `<line>`s in WORLD
 * coordinates. The caller mounts this inside React Flow's `<ViewportPortal>`,
 * whose children render inside the transformed viewport `<g>` — so no manual
 * pan/zoom math is needed here. `vector-effect="non-scaling-stroke"` keeps
 * every stroke at exactly 1 screen pixel regardless of zoom.
 *
 * Internal-only: exported from `./index.ts` (subsystem barrel) but NOT from the
 * package's public `src/index.ts`.
 *
 * The guides are rendered by plain helper FUNCTIONS (not nested components) so
 * the returned element tree is composed entirely of SVG host elements — which
 * lets `alignment-overlay.test.tsx` assert on `<line>` / `<foreignObject>`
 * structure by calling `AlignmentOverlay` as a function (Bun runs this package's
 * tests without a DOM; see glow-overlay.test.tsx).
 */

import type { CSSProperties, ReactElement } from 'react';
import type { GuideLine } from './geometry.ts';

const EDGE_COLOR = 'var(--sf-accent)';
const SPACING_COLOR = 'var(--sf-alignment-spacing)';

/** Half-length (world units) of the perpendicular "T" caps on spacing guides. */
const CAP_HALF = 5;
/** Badge box size (world units) for the spacing gap label. */
const BADGE_W = 44;
const BADGE_H = 18;

// The SVG root sits at the viewport-portal origin (world 0,0) and must not clip
// guides that extend beyond a zero-size box, so overflow is visible and pointer
// events pass straight through to the canvas below.
const ROOT_STYLE: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: 1,
  height: 1,
  overflow: 'visible',
  pointerEvents: 'none',
};

function guideLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  key?: string,
): ReactElement {
  return (
    <line
      key={key}
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={color}
      strokeWidth={1}
      opacity={0.9}
      vector-effect="non-scaling-stroke"
    />
  );
}

function renderEdgeGuide(
  guide: Extract<GuideLine, { kind: 'v' | 'h' }>,
  key: string,
): ReactElement {
  const [x1, y1, x2, y2] =
    guide.kind === 'v'
      ? [guide.x, guide.y1, guide.x, guide.y2]
      : [guide.x1, guide.y, guide.x2, guide.y];
  return guideLine(x1, y1, x2, y2, EDGE_COLOR, key);
}

function renderSpacingGuide(
  guide: Extract<GuideLine, { kind: 'spacing-v' | 'spacing-h' }>,
  key: string,
): ReactElement {
  // spacing-v: horizontal segment {x1,x2,y} → vertical "T" caps + a centered
  // gap badge. spacing-h: vertical segment {y1,y2,x} → horizontal caps + badge.
  const isHorizontalSegment = guide.kind === 'spacing-v';

  const mainX1 = guide.kind === 'spacing-v' ? guide.x1 : guide.x;
  const mainY1 = guide.kind === 'spacing-v' ? guide.y : guide.y1;
  const mainX2 = guide.kind === 'spacing-v' ? guide.x2 : guide.x;
  const mainY2 = guide.kind === 'spacing-v' ? guide.y : guide.y2;

  const midX = (mainX1 + mainX2) / 2;
  const midY = (mainY1 + mainY2) / 2;

  const caps = isHorizontalSegment
    ? [
        guideLine(mainX1, mainY1 - CAP_HALF, mainX1, mainY1 + CAP_HALF, SPACING_COLOR, 'cap-a'),
        guideLine(mainX2, mainY2 - CAP_HALF, mainX2, mainY2 + CAP_HALF, SPACING_COLOR, 'cap-b'),
      ]
    : [
        guideLine(mainX1 - CAP_HALF, mainY1, mainX1 + CAP_HALF, mainY1, SPACING_COLOR, 'cap-a'),
        guideLine(mainX2 - CAP_HALF, mainY2, mainX2 + CAP_HALF, mainY2, SPACING_COLOR, 'cap-b'),
      ];

  return (
    <g key={key}>
      {guideLine(mainX1, mainY1, mainX2, mainY2, SPACING_COLOR, 'main')}
      {caps}
      <foreignObject x={midX - BADGE_W / 2} y={midY - BADGE_H / 2} width={BADGE_W} height={BADGE_H}>
        <span className="sf:flex sf:h-full sf:w-full sf:items-center sf:justify-center sf:rounded sf:bg-[var(--sf-alignment-spacing)] sf:px-1 sf:text-[10px] sf:font-medium sf:leading-none sf:text-white">
          {`${Math.round(guide.gap)}px`}
        </span>
      </foreignObject>
    </g>
  );
}

export function AlignmentOverlay({ guides }: { guides: GuideLine[] }): ReactElement | null {
  if (guides.length === 0) return null;
  return (
    <svg aria-hidden="true" style={ROOT_STYLE}>
      {guides.map((guide, i) => {
        const key = `${guide.kind}-${i}`;
        return guide.kind === 'v' || guide.kind === 'h'
          ? renderEdgeGuide(guide, key)
          : renderSpacingGuide(guide, key);
      })}
    </svg>
  );
}
