import {
  BG_FALLBACK,
  BORDER_FALLBACK,
  DEFAULT_STROKE_WIDTH,
  type ShapePartProps,
  dashFor,
  paddedViewBox,
} from './types.ts';

// US-024: message-queue glyph — a horizontal pill (rx = height/2 for true
// capsule ends) divided into 4 vertical cells by 3 evenly-spaced separators.
// Reads as Kafka / SQS / RabbitMQ "messages in line" at the default 220x80
// landscape size. Inline dividers (rather than `.map(...)`) keep the SVG
// children flat so the structural test in `shape-node.test.tsx` can walk
// `props.children` without flattening nested arrays.
export function QueueShape({
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

  const rx = height / 2;
  const d1 = width * 0.25;
  const d2 = width * 0.5;
  const d3 = width * 0.75;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={paddedViewBox(width, height, strokeWidth)}
      preserveAspectRatio="none"
      role="img"
      aria-label="Queue"
      data-testid="queue-shape"
    >
      <title>Queue</title>
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        rx={rx}
        ry={rx}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
      />
      <line
        x1={d1}
        y1={0}
        x2={d1}
        y2={height}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
      />
      <line
        x1={d2}
        y1={0}
        x2={d2}
        y2={height}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
      />
      <line
        x1={d3}
        y1={0}
        x2={d3}
        y2={height}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
      />
    </svg>
  );
}
