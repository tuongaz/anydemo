import {
  BG_FALLBACK,
  BORDER_FALLBACK,
  DEFAULT_STROKE_WIDTH,
  type ShapePartProps,
  dashFor,
} from './types.ts';

// Cloud glyph — three bumps on the top (small / large / small) and three
// equal bumps along the bottom. Both bump rows sit on a shared horizontal
// axis (`baselineY = height / 2`), so there's no vertical "seam" between
// the top and bottom curves — the silhouette is one continuous puffy
// outline, the way AWS / Azure / draw.io cloud icons paint.
//
// Bump-radius ratios:
//   top    : 1 : 1.5 : 1   (small-large-small, center mound dominates)
//   bottom : 1 : 1 : 1     (three equal lobes — smaller than the top centre
//                           so the cloud's silhouette stays top-heavy and
//                           doesn't read as a balloon)
//
// `SIDE_MARGIN` keeps the outermost bumps from kissing the viewBox edge so
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

  const usableW = width - 2 * SIDE_MARGIN;

  // Three top bumps: radii sum to usableW / 2 with center 1.5x the sides.
  //   r1 + r2 + r3 = usableW/2  with r2 = 1.5*r1  →  r1 = r3 = usableW/7.
  const rt1 = usableW / 7;
  const rt2 = (usableW / 7) * 1.5;
  const rt3 = rt1;

  // Three bottom bumps: equal radii summing to usableW/2  →  rb = usableW/6.
  const rb = usableW / 6;

  const xLeft = SIDE_MARGIN;
  const xRight = xLeft + usableW;
  const baselineY = height / 2;

  // SVG arc convention: sweep-flag=1 curves to the right of the travel
  // direction. Top bumps travel left-to-right and bulge UP; bottom bumps
  // travel right-to-left and bulge DOWN. Both use sweep=1.
  const d = [
    `M ${xLeft} ${baselineY}`,
    `A ${rt1} ${rt1} 0 0 1 ${xLeft + 2 * rt1} ${baselineY}`,
    `A ${rt2} ${rt2} 0 0 1 ${xLeft + 2 * rt1 + 2 * rt2} ${baselineY}`,
    `A ${rt3} ${rt3} 0 0 1 ${xRight} ${baselineY}`,
    `A ${rb} ${rb} 0 0 1 ${xRight - 2 * rb} ${baselineY}`,
    `A ${rb} ${rb} 0 0 1 ${xRight - 4 * rb} ${baselineY}`,
    `A ${rb} ${rb} 0 0 1 ${xLeft} ${baselineY}`,
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
