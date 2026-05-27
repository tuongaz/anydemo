import {
  BG_FALLBACK,
  BORDER_FALLBACK,
  DEFAULT_STROKE_WIDTH,
  type ShapePartProps,
  dashFor,
} from './types.ts';

// Microservice / "hexagonal architecture" glyph — flat-top hexagon spanning
// the full bounding box. Vertices sit at the bounding-box midpoints of the
// four corners (¼ + ¾ along the top and bottom edges) and the left/right
// edge midpoints, so the silhouette skews into a stretched honeycomb cell
// when the wrapper is rectangular. Mirrors the other illustrative shapes:
// single `<polygon>` so the stroke joins cleanly at every corner.
export function HexagonShape({
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

  const cy = height / 2;
  const qx = width / 4;
  const points = `${qx},0 ${width - qx},0 ${width},${cy} ${width - qx},${height} ${qx},${height} 0,${cy}`;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Hexagon"
      data-testid="hexagon-shape"
    >
      <title>Hexagon</title>
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
