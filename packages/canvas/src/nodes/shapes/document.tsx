import {
  BG_FALLBACK,
  BORDER_FALLBACK,
  DEFAULT_STROKE_WIDTH,
  type ShapePartProps,
  dashFor,
  paddedViewBox,
} from './types.ts';

// Classic flowchart "document" glyph — a rectangle with a wavy bottom edge.
// Top + sides are straight; the bottom is a single S-curve cubic bezier so
// the right half dips below the baseline and the left half rises above it.
// Both end-points of the wave sit at the same y so the silhouette closes
// cleanly with a straight vertical on each side. All coordinates stay inside
// the [0..width, 0..height] viewBox — the wave's swing is bounded by
// control points pulled inward from the box edges so resize gestures don't
// clip the curve.
const BASELINE_RATIO = 0.78;
const TROUGH_RATIO = 0.95;
const PEAK_RATIO = 0.6;

export function DocumentShape({
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

  const baseY = height * BASELINE_RATIO;
  const troughY = height * TROUGH_RATIO;
  const peakY = height * PEAK_RATIO;
  const c1x = width * 0.66;
  const c2x = width * 0.33;

  const d = [
    'M 0 0',
    `L ${width} 0`,
    `L ${width} ${baseY}`,
    `C ${c1x} ${troughY}, ${c2x} ${peakY}, 0 ${baseY}`,
    'Z',
  ].join(' ');

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={paddedViewBox(width, height, strokeWidth)}
      preserveAspectRatio="none"
      role="img"
      aria-label="Document"
      data-testid="document-shape"
    >
      <title>Document</title>
      <path
        d={d}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
        strokeLinejoin="miter"
      />
    </svg>
  );
}
