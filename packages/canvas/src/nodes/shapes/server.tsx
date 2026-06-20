import {
  BG_FALLBACK,
  BORDER_FALLBACK,
  DEFAULT_STROKE_WIDTH,
  type ShapePartProps,
  dashFor,
  paddedViewBox,
} from './types.ts';

// US-022: rack-chassis glyph. Three equal horizontal bays separated by two
// dividers, each bay carrying a small filled LED on the right. Reads as a 3U
// server rack at any size — when stretched, the LEDs flatten into pills (the
// `<svg preserveAspectRatio="none">` contract shared with DatabaseShape), which
// still reads as status lights rather than artifacts.
const BAY_COUNT = 3;

export function ServerShape({
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

  const bayH = height / BAY_COUNT;
  // LED radius clamped so a small rack still shows a readable dot and a tall
  // rack doesn't blow it up to a circle the size of the bay.
  const ledR = Math.max(3, Math.min(6, bayH * 0.18));
  // Right-inset proportional to LED size so it always reads as "on the right"
  // regardless of width.
  const ledCX = width - Math.max(10, ledR * 3);
  const cornerR = Math.min(8, Math.min(width, height) * 0.06);

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={paddedViewBox(width, height, strokeWidth)}
      preserveAspectRatio="none"
      role="img"
      aria-label="Server"
      data-testid="server-shape"
    >
      <title>Server</title>
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        rx={cornerR}
        ry={cornerR}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
      />
      <line
        x1={0}
        y1={bayH}
        x2={width}
        y2={bayH}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
      />
      <line
        x1={0}
        y1={bayH * 2}
        x2={width}
        y2={bayH * 2}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
      />
      <circle cx={ledCX} cy={bayH / 2} r={ledR} fill={stroke} />
      <circle cx={ledCX} cy={bayH + bayH / 2} r={ledR} fill={stroke} />
      <circle cx={ledCX} cy={bayH * 2 + bayH / 2} r={ledR} fill={stroke} />
    </svg>
  );
}
