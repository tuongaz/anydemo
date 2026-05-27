import {
  BG_FALLBACK,
  BORDER_FALLBACK,
  DEFAULT_STROKE_WIDTH,
  type ShapePartProps,
  dashFor,
} from './types.ts';

// Cloud silhouette: large top-left bump joined to a smaller top-right
// bump, with a flat bottom and softly rounded bottom-left / bottom-right
// corners — the classic "iCloud" / cloud-icon shape.
//
// The reference arc geometry is borrowed from the Heroicons cloud-outline
// glyph (24×24 viewBox) but only occupies x ∈ [2.25, 19.332],
// y ∈ [~4.15, 19.5]. We shift it to the origin and rescale it to fill the
// node's full `width × height` so the glyph spans edge-to-edge at any
// aspect ratio.
const HX_OFFSET = 2.25;
const HY_OFFSET = 4.15;
const HX_RANGE = 17.082; // 19.332 - 2.25
const HY_RANGE = 15.35; // 19.5 - 4.15

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
  const X = (x: number) => (inset + (x - HX_OFFSET) * sx).toFixed(3);
  const Y = (y: number) => (inset + (y - HY_OFFSET) * sy).toFixed(3);
  const RX = (r: number) => (r * sx).toFixed(3);
  const RY = (r: number) => (r * sy).toFixed(3);

  const d = [
    `M ${X(2.25)} ${Y(15)}`,
    `A ${RX(4.5)} ${RY(4.5)} 0 0 0 ${X(6.75)} ${Y(19.5)}`,
    `L ${X(18)} ${Y(19.5)}`,
    `A ${RX(3.75)} ${RY(3.75)} 0 0 0 ${X(19.332)} ${Y(12.243)}`,
    `A ${RX(3)} ${RY(3)} 0 0 0 ${X(15.574)} ${Y(8.395)}`,
    `A ${RX(5.25)} ${RY(5.25)} 0 0 0 ${X(5.341)} ${Y(10.725)}`,
    `A ${RX(4.502)} ${RY(4.502)} 0 0 0 ${X(2.25)} ${Y(15)}`,
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
