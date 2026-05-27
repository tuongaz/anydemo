import {
  BG_FALLBACK,
  BORDER_FALLBACK,
  DEFAULT_STROKE_WIDTH,
  type ShapePartProps,
  dashFor,
} from './types.ts';

// Cloud silhouette: large top bump joined to a smaller upper-right lobe,
// with a flat bottom and softly rounded corners — the classic Material
// cloud-filled silhouette.
//
// The path is described with cubic Béziers (rather than elliptical arcs)
// so the curve stays smooth — and corners stay visibly rounded — even
// when the node is stretched to a much wider aspect ratio than the
// design's natural 24×16 (1.5:1). With arcs, the right-side rounded
// corner would collapse into a near-vertical sliver as `width / height`
// grew; with Béziers the control points scale with the stretch and the
// corner keeps its weight.
const HX_RANGE = 24;
const HY_RANGE = 16;
const HY_OFFSET = 4; // raw path uses y ∈ [4, 20]; shift to [0, 16]

export function CloudShape({
  width,
  height,
  borderColor,
  backgroundColor,
  borderSize,
  borderStyle,
}: ShapePartProps) {
  const stroke = borderColor ?? BORDER_FALLBACK;
  const fill = backgroundColor ?? BG_FALLBACK;
  const strokeWidth = borderSize ?? DEFAULT_STROKE_WIDTH;
  const dash = dashFor(borderStyle);

  // Inset by half the stroke so the outline isn't clipped at the viewBox
  // edges when borderSize grows.
  const inset = strokeWidth / 2;
  const w = Math.max(0, width - strokeWidth);
  const h = Math.max(0, height - strokeWidth);
  const sx = w / HX_RANGE;
  const sy = h / HY_RANGE;
  const X = (x: number) => (inset + x * sx).toFixed(3);
  const Y = (y: number) => (inset + (y - HY_OFFSET) * sy).toFixed(3);

  const d = [
    `M ${X(19.36)} ${Y(10.04)}`,
    `C ${X(18.67)} ${Y(6.59)}, ${X(15.64)} ${Y(4)}, ${X(12)} ${Y(4)}`,
    `C ${X(9.11)} ${Y(4)}, ${X(6.6)} ${Y(5.64)}, ${X(5.35)} ${Y(8.04)}`,
    `C ${X(2.39)} ${Y(8.36)}, ${X(0)} ${Y(10.91)}, ${X(0)} ${Y(14)}`,
    `C ${X(0)} ${Y(17.31)}, ${X(2.69)} ${Y(20)}, ${X(6)} ${Y(20)}`,
    `L ${X(19)} ${Y(20)}`,
    `C ${X(21.76)} ${Y(20)}, ${X(24)} ${Y(17.76)}, ${X(24)} ${Y(15)}`,
    `C ${X(24)} ${Y(12.36)}, ${X(21.95)} ${Y(10.22)}, ${X(19.36)} ${Y(10.04)}`,
    'Z',
  ].join(' ');

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Cloud"
      data-testid="cloud-shape"
    >
      <title>Cloud</title>
      <path
        d={d}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
