import { type EdgeMarker, MarkerType } from '@xyflow/react';
import type {
  Connector,
  ConnectorHeadShape,
  ConnectorPath,
  ConnectorStyle,
  EdgePin,
  FontFamilyToken,
} from '../types.ts';
import { colorTokenStyle } from './color-tokens.ts';

export interface DerivedEdge {
  id: string;
  source: string;
  target: string;
  // Handle ids on the source/target nodes (US-013). Absent → React Flow
  // attaches to the first matching handle (back-compat for pre-handle demos).
  sourceHandle?: string;
  targetHandle?: string;
  type: 'editableEdge';
  label?: string;
  animated: boolean;
  // Per-edge runtime callbacks (e.g. onLabelChange) are injected by
  // DemoCanvas at render time so they don't churn the connectorToEdge memo.
  // `path` belongs in `data` (not `style`) because it changes the SVG `d`
  // attribute generation, not stroke styling — see EditableEdge for the
  // bezier vs smoothstep branch.
  // `sourceHandleAutoPicked` / `targetHandleAutoPicked` (US-025): when
  // !== false (true OR absent → floating), EditableEdge ignores React
  // Flow's stored handle coords and recomputes the endpoint as the
  // perimeter intersection of the line through the two node centers. When
  // === false (user-pinned), the React-Flow-supplied coords win.
  //
  // `sourcePin` / `targetPin` (US-007): when set, overrides both floating and
  // auto-pick behavior — EditableEdge anchors the endpoint to `(side, t)` on
  // the connected node's perimeter so it survives moves and resizes.
  data: {
    path?: ConnectorPath;
    sourceHandleAutoPicked?: boolean;
    targetHandleAutoPicked?: boolean;
    sourcePin?: EdgePin;
    targetPin?: EdgePin;
    /** US-018: per-connector label font size in px (undefined → 11px). */
    fontSize?: number;
    /** Curated font-family token for the label; resolves via FONT_STACKS. */
    fontFamily?: FontFamilyToken;
    // Custom (non-arrow) glyph for EditableEdge to draw at the target (head)
    // end. Absent for the default arrow (which uses native markers) so the
    // edge stays marker-driven.
    headShape?: Exclude<ConnectorHeadShape, 'arrow'>;
    // Custom (non-arrow) glyph at the source (tail) end. Independent of
    // `headShape` so an edge can carry different glyphs at each end (e.g. ER
    // one-to-many). Absent for the default arrow.
    tailShape?: Exclude<ConnectorHeadShape, 'arrow'>;
    /** Whether the source end carries a head at all (per `direction`). */
    headStart?: boolean;
    /** Whether the target end carries a head at all (per `direction`). */
    headEnd?: boolean;
  };
  style: { strokeDasharray?: string; stroke?: string; strokeWidth?: number; opacity?: number };
  // Only the default 'arrow' end uses native React Flow markers. The custom
  // shapes (crow's-foot/diamond/circle) are drawn by EditableEdge via edge.data
  // (headShape/tailShape) — see the `data` comment below — so a given marker
  // field stays undefined whenever that end carries a custom glyph.
  markerStart?: EdgeMarker;
  markerEnd?: EdgeMarker;
  selected?: boolean;
  // Invisible wider stroke React Flow uses for hover/click/reconnect-start
  // hit-testing. Keeps the visible stroke width unchanged while giving
  // users a comfortable buffer to grab the edge.
  interactionWidth?: number;
}

const EDGE_INTERACTION_WIDTH = 24;

// Closed arrowhead — width/height tuned to look balanced against the 1px stroke.
// `color` is set per-connector so the arrow tracks the connector's stroke color
// (without it React Flow falls back to its default marker fill, which clashes
// with any non-default token).
const arrowMarker = (color?: string): EdgeMarker => ({
  type: MarkerType.ArrowClosed,
  width: 18,
  height: 18,
  ...(color ? { color } : {}),
});

// Exported so the in-flight connection-line preview (seeflow-canvas.tsx) can
// mirror the committed connector's dash pattern without re-deriving the map —
// keeping the new-connection preview byte-identical to what commits on release.
export const STYLE_BY_NAME: Record<ConnectorStyle, { strokeDasharray?: string }> = {
  solid: {},
  dashed: { strokeDasharray: '6 4' },
  dotted: { strokeDasharray: '2 4' },
};

// Selected connectors render with a thicker stroke (US-004) so the selection is
// readable at a glance against the dashed/dotted/solid kinds. We also pin
// opacity to 1 so any future muted-when-idle treatment doesn't dim the
// selected edge.
const SELECTED_STROKE_WIDTH = 3;

// US-010: memoization cache keyed by the connector object. The marquee gesture
// re-derives edges per frame; without this, every frame produced a fresh edge
// object and React Flow saw new identities → every edge re-rendered. With the
// cache, identical (connector ref, isAdjacentToRunning, selected) inputs return
// the same DerivedEdge ref, so downstream useMemo / React.memo see stable
// identity and skip work. WeakMap auto-evicts when the Connector goes out of
// scope (parent rebuilds the connectors array on an actual mutation).
type CacheEntry = { isAdjacentToRunning: boolean; selected: boolean; edge: DerivedEdge };
const edgeCache = new WeakMap<Connector, CacheEntry>();

export const connectorToEdge = (
  connector: Connector,
  isAdjacentToRunning: boolean,
  selected = false,
): DerivedEdge => {
  const cached = edgeCache.get(connector);
  if (
    cached &&
    cached.isAdjacentToRunning === isAdjacentToRunning &&
    cached.selected === selected
  ) {
    return cached.edge;
  }
  // Optional per-connector `style` overrides the default solid stroke.
  const dashStyle = connector.style ? STYLE_BY_NAME[connector.style] : {};
  // Color token (defaults to 'default') drives the stroke. Always call
  // `colorTokenStyle` — it falls back to the 'default' token internally — so
  // an unset color still produces an explicit stroke. Skipping that branch
  // would leave both the line AND the arrow marker color undefined, and React
  // Flow's two defaults differ (black line + gray arrow), so they'd render
  // mismatched even when the user picks no color at all.
  const colorStyle = colorTokenStyle(connector.color, 'edge');
  // Default to a heavier stroke than SVG's 1px so connectors read at canvas
  // zoom levels; per-connector borderSize overrides. Selection bumps it up
  // (max with the user's borderSize so we never thin a deliberately-bold edge).
  const baseStrokeWidth = connector.borderSize ?? 2;
  const strokeWidth = selected ? Math.max(SELECTED_STROKE_WIDTH, baseStrokeWidth) : baseStrokeWidth;
  const sizeStyle: { strokeWidth: number; opacity?: number } = selected
    ? { strokeWidth, opacity: 1 }
    : { strokeWidth };
  const style = { ...dashStyle, ...colorStyle, ...sizeStyle };
  // 'forward' (or absent) → arrow at target only (historical behavior).
  // 'backward' → arrow at source only.
  // 'both'     → arrows at both ends.
  // 'none'     → no arrows (plain line).
  const direction = connector.direction ?? 'forward';
  const markerColor = colorStyle.stroke;
  // `headShape`/`tailShape` decide each end's glyph; `direction` decides which
  // ends carry one.
  //   'forward' (or absent) → head at target only (historical behavior).
  //   'backward' → head at source only.  'both' → both ends.  'none' → none.
  // The source (tail) end falls back to `headShape` when `tailShape` is unset,
  // so a single head pick still styles both ends symmetrically.
  const endShape = connector.headShape ?? 'arrow';
  const startShape = connector.tailShape ?? endShape;
  const hasStart = direction === 'backward' || direction === 'both';
  const hasEnd = direction === 'forward' || direction === 'both';
  // Only the default arrow uses native React Flow markers; custom shapes are
  // drawn by EditableEdge (native markers can't live in React Flow's re-rendered
  // edge svg reliably). Resolved per end so an arrow tail can pair with a custom
  // head (or vice versa) without one end stealing the other's renderer.
  const endIsCustom = endShape !== 'arrow';
  const startIsCustom = startShape !== 'arrow';
  const arrow = arrowMarker(markerColor);
  const markerStart = hasStart && !startIsCustom ? arrow : undefined;
  const markerEnd = hasEnd && !endIsCustom ? arrow : undefined;
  const anyCustomHead = endIsCustom || startIsCustom;
  const edge: DerivedEdge = {
    id: connector.id,
    source: connector.source,
    target: connector.target,
    sourceHandle: connector.sourceHandle,
    targetHandle: connector.targetHandle,
    type: 'editableEdge',
    label: connector.label,
    animated: isAdjacentToRunning,
    data: {
      path: connector.path,
      sourceHandleAutoPicked: connector.sourceHandleAutoPicked,
      targetHandleAutoPicked: connector.targetHandleAutoPicked,
      sourcePin: connector.sourcePin,
      targetPin: connector.targetPin,
      fontSize: connector.fontSize,
      fontFamily: connector.fontFamily,
      ...(anyCustomHead
        ? {
            ...(endIsCustom ? { headShape: endShape as Exclude<ConnectorHeadShape, 'arrow'> } : {}),
            ...(startIsCustom
              ? { tailShape: startShape as Exclude<ConnectorHeadShape, 'arrow'> }
              : {}),
            headStart: hasStart,
            headEnd: hasEnd,
          }
        : {}),
    },
    style,
    markerStart,
    markerEnd,
    interactionWidth: EDGE_INTERACTION_WIDTH,
  };
  edgeCache.set(connector, { isAdjacentToRunning, selected, edge });
  return edge;
};
