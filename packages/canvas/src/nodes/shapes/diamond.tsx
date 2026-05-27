import {
  BG_FALLBACK,
  BORDER_FALLBACK,
  DEFAULT_STROKE_WIDTH,
  type ShapePartProps,
  dashFor,
} from './types.ts';

// Decision / gateway glyph — a rhombus with apexes at the four edge midpoints
// of the bounding box. Drawn as a single `<polygon>` so the stroke joins
// cleanly at every corner. `preserveAspectRatio="none"` lets the polygon
// stretch with the wrapper exactly like the other illustrative shapes; the
// stroke renders along the geometric edges so non-square aspect ratios skew
// into an elongated diamond without breaking the stroke.
export function DiamondShape({
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

  const cx = width / 2;
  const cy = height / 2;
  const points = `${cx},0 ${width},${cy} ${cx},${height} 0,${cy}`;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Diamond"
      data-testid="diamond-shape"
    >
      <title>Diamond</title>
      <polygon
        points={points}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
        strokeLinejoin="miter"
      />
    </svg>
  );
}
