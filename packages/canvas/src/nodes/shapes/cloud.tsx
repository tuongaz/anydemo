import {
  BG_FALLBACK,
  BORDER_FALLBACK,
  DEFAULT_STROKE_WIDTH,
  type ShapePartProps,
  dashFor,
} from './types.ts';

// US-025: cloud glyph — three top bumps (small / large / small) sitting on a
// short rectangular skirt with a flat bottom. The bumps are sized so they
// touch (right base of bump_i = left base of bump_{i+1}), forming a single
// continuous puffy upper outline that reads as a cloud at any aspect ratio.
//
// Bump-radius ratio is 1 : 1.5 : 1 — the center mound is the tallest, matching
// the convention used in AWS / Azure / draw.io cloud icons. Side margins
// (`SIDE_MARGIN`) keep the outermost bumps from kissing the viewBox edge so
// the stroke isn't clipped by the wrapper.
const SIDE_MARGIN = 5;

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

  // Three radii sized so r1 + r2 + r3 = (width - 2*margin) / 2, with the
  // center bump 1.5x the side bumps. Solving the constraint gives
  //   r1 = r3 = usableW / 7,  r2 = 1.5 * (usableW / 7).
  const usableW = width - 2 * SIDE_MARGIN;
  const r1 = usableW / 7;
  const r2 = (usableW / 7) * 1.5;
  const r3 = r1;

  const xLeft = SIDE_MARGIN;
  const cx1 = xLeft + r1;
  const cx2 = cx1 + r1 + r2;
  const cx3 = cx2 + r2 + r3;
  const xRight = cx3 + r3;

  // Baseline at 85% of height leaves a short skirt below the bumps so the
  // cloud silhouette has a small flat body to "sit" on. Center bump apex
  // reaches baselineY - r2, so the cloud spans roughly the top 70% of the
  // viewBox.
  const baselineY = height * 0.85;

  const d = [
    `M ${xLeft} ${baselineY}`,
    `A ${r1} ${r1} 0 0 1 ${cx1 + r1} ${baselineY}`,
    `A ${r2} ${r2} 0 0 1 ${cx2 + r2} ${baselineY}`,
    `A ${r3} ${r3} 0 0 1 ${xRight} ${baselineY}`,
    `L ${xRight} ${height}`,
    `L ${xLeft} ${height}`,
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
      <path d={d} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={dash} />
    </svg>
  );
}
