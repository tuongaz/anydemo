import {
  BG_FALLBACK,
  BORDER_FALLBACK,
  DEFAULT_STROKE_WIDTH,
  type ShapePartProps,
  dashFor,
} from './types.ts';

// Right-leaning parallelogram — the BPMN convention for data / IO nodes. The
// horizontal shear is a fixed 20% of the bounding-box width so the slant
// stays visually consistent across resize gestures (a percentage-of-width
// shear means tall-narrow parallelograms still look like parallelograms
// rather than flattening toward a rectangle as height grows).
const SHEAR_RATIO = 0.2;

export function ParallelogramShape({
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

  const shear = width * SHEAR_RATIO;
  // Top edge starts inset from the left; bottom edge ends inset from the
  // right. The visible width therefore equals (1 − SHEAR_RATIO) × width;
  // SHAPE_DEFAULT_SIZE compensates with a slightly wider default so the
  // committed node reads at flowchart-IO proportions.
  const points = `${shear},0 ${width},0 ${width - shear},${height} 0,${height}`;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Parallelogram"
      data-testid="parallelogram-shape"
    >
      <title>Parallelogram</title>
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
