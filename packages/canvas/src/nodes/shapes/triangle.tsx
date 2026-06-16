import {
  BG_FALLBACK,
  BORDER_FALLBACK,
  DEFAULT_STROKE_WIDTH,
  type ShapePartProps,
  dashFor,
} from './types.ts';

// Isoceles triangle — apex at top-center, base spanning the full bottom edge.
// Same `preserveAspectRatio="none"` + single-`<polygon>` recipe as the other
// illustrative shapes so the stroke renders along the geometric edges and
// non-square aspect ratios stretch into a wider/taller triangle without
// breaking the stroke join.
export function TriangleShape({
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

  const points = `${width / 2},0 ${width},${height} 0,${height}`;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Triangle"
      data-testid="triangle-shape"
    >
      <title>Triangle</title>
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
