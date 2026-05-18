import {
  BG_FALLBACK,
  BORDER_FALLBACK,
  DEFAULT_STROKE_WIDTH,
  type ShapePartProps,
  dashFor,
} from './types.ts';

// US-023: person glyph — a head circle in the top quarter sitting above a
// half-pill torso (rounded top corners, flat bottom). Reads as the
// whiteboard-convention "person" silhouette at portrait sizes. With
// `preserveAspectRatio="none"`, an extreme landscape stretch flattens the head
// into a horizontal oval — same artifact ServerShape and DatabaseShape accept;
// portrait-ish authoring sizes (the 100x140 default) keep it crisp.
export function UserShape({
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

  // Head: clamped radius so neither a tiny avatar nor an oversized one
  // distorts the head-to-body proportion. cy sits ~22% from the top, leaving
  // room above for the stroke and below for the torso.
  const headCY = height * 0.22;
  const headR = Math.max(8, Math.min(28, Math.min(width, height) * 0.18));

  // Torso: top edge sits a few pixels below the head so the two glyphs read
  // as related-but-distinct. Side padding scales with width so a stretched
  // user keeps shoulder-width-to-canvas proportions.
  const bodyTop = headCY + headR + Math.max(4, height * 0.05);
  const bodySidePad = Math.max(6, width * 0.1);
  const bodyLeft = bodySidePad;
  const bodyRight = width - bodySidePad;
  // Shoulder corner radius shrinks gracefully — clamped so a narrow torso
  // doesn't collapse to a circle and a very short body still rounds.
  const shoulderR = Math.min((bodyRight - bodyLeft) / 2, (height - bodyTop) / 2, 40);

  const bodyPath = [
    `M ${bodyLeft} ${height}`,
    `L ${bodyLeft} ${bodyTop + shoulderR}`,
    `A ${shoulderR} ${shoulderR} 0 0 1 ${bodyLeft + shoulderR} ${bodyTop}`,
    `L ${bodyRight - shoulderR} ${bodyTop}`,
    `A ${shoulderR} ${shoulderR} 0 0 1 ${bodyRight} ${bodyTop + shoulderR}`,
    `L ${bodyRight} ${height}`,
    'Z',
  ].join(' ');

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="User"
      data-testid="user-shape"
    >
      <title>User</title>
      <circle
        cx={width / 2}
        cy={headCY}
        r={headR}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
      />
      <path
        d={bodyPath}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
      />
    </svg>
  );
}
