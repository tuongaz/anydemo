import type { Side } from '../lib/floating-edge-geometry.ts';
import type { ConnectorHeadShape } from '../types.ts';

/**
 * Connector head glyphs drawn as React-owned SVG inside the edge's own `<g>`
 * (see EditableEdge). The default `arrow` head uses React Flow's native
 * `MarkerType.ArrowClosed` marker instead and is NOT drawn here.
 *
 * Two families:
 *  - ER crow's-foot endpoints — `one` (single tick), `many` (fork), and
 *    `optional-many` (hollow circle + fork). Stroke-only line marks.
 *  - Filled UML-ish endpoints — `diamond`, `circle`.
 *
 * Why not SVG `<marker>`s: a `<marker>` def must live in the SAME svg root as
 * the referencing path, but React Flow owns that svg and strips foreign nodes
 * on re-render. Drawing the glyph as a normal React element inside the edge
 * group sidesteps markers entirely — it persists across re-renders, colors
 * directly from the edge stroke, and needs no cross-root resource resolution.
 *
 * Local geometry points "East" (+X) INTO the node, the marks touching the node
 * at the origin (x=0) and trailing back along -X toward the line. Each side
 * rotates the glyph along that side's inward normal (screen coords, +Y down).
 */

const SIDE_ROTATION: Record<Side, number> = {
  top: 90, // line attaches to the node's top face → glyph points down into it
  bottom: 270,
  left: 0,
  right: 180,
};

// Half-spread of the crow's-foot prongs / filled-shape height, in px.
const SPREAD = 7;

/**
 * How far back along the line (px) each glyph extends from the node edge. The
 * connector path is trimmed by this (see EditableEdge) so the line terminates
 * AT the glyph instead of running through it. `one` is a tick that crosses the
 * line near the entity, so it isn't trimmed.
 */
export const HEAD_TRIM: Record<Exclude<ConnectorHeadShape, 'arrow'>, number> = {
  one: 0,
  many: 14, // crow's-foot apex
  'optional-many': 24, // outer edge of the circle behind the fork
  diamond: 16, // back vertex
  circle: 15, // outer edge of the ring (cx 8 + r 7)
};

// Three prongs fanning from an apex back on the line (`apexX`) to the node edge
// (x=0) at -SPREAD / 0 / +SPREAD — the ER "many" fork.
const crowsFoot = (apexX: number) =>
  `M${apexX},0 L0,${-SPREAD} M${apexX},0 L0,0 M${apexX},0 L0,${SPREAD}`;

function glyphFor(shape: Exclude<ConnectorHeadShape, 'arrow'>, color: string) {
  switch (shape) {
    case 'one':
      // Single perpendicular tick a little back from the node edge.
      return <path d={`M-7,${-SPREAD} L-7,${SPREAD}`} fill="none" />;
    case 'many':
      // Crow's foot: fork opening onto the node, apex back on the line.
      return <path d={crowsFoot(-14)} fill="none" />;
    case 'optional-many':
      // Hollow circle on the line + crow's foot between it and the node.
      return (
        <>
          <circle cx={-20} cy={0} r={4} fill="none" />
          <path d={crowsFoot(-14)} fill="none" />
        </>
      );
    case 'diamond':
      // Filled rhombus; front vertex meets the node, body trails back.
      return <polygon points={`0,0 -8,${-SPREAD} -16,0 -8,${SPREAD}`} fill={color} />;
    case 'circle':
      // Hollow ring sitting just back from the node.
      return <circle cx={-8} cy={0} r={SPREAD} fill="none" />;
  }
}

export function ConnectorHeadGlyph({
  x,
  y,
  side,
  shape,
  color,
}: {
  x: number;
  y: number;
  side: Side;
  shape: Exclude<ConnectorHeadShape, 'arrow'>;
  color?: string;
}) {
  const resolved = color ?? 'currentColor';
  return (
    <g
      data-testid="connector-head-glyph"
      data-head-shape={shape}
      transform={`translate(${x} ${y}) rotate(${SIDE_ROTATION[side]})`}
      fill="none"
      stroke={resolved}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {glyphFor(shape, resolved)}
    </g>
  );
}
