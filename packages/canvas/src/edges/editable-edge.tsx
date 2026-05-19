import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  Position,
  ViewportPortal,
  getBezierPath,
  getSmoothStepPath,
  useInternalNode,
} from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { InlineEdit } from '../components/inline-edit.tsx';
import { cn } from '../lib/cn.ts';
import {
  type Endpoint,
  type Pin,
  type Side,
  resolveEdgeEndpoints,
} from '../lib/floating-edge-geometry.ts';
import { deriveVisualStatus } from '../nodes/lib/visual-status.ts';
import type { ConnectorPath, EdgePin, NodeStatus, StatusReport } from '../types.ts';

/**
 * Returns true when an edge should fire its handoff pulse, given the source
 * node's previous and next visual status. Rising edge into 'success' only —
 * staying in success or moving out of it does not pulse.
 */
export function shouldFireEdgeHandoff(
  prev: string | undefined,
  next: string,
): boolean {
  return next === 'success' && prev !== 'success';
}

// Smoothstep corner rounding — matches typical "zigzag" diagrams without
// looking jagged. (US-017)
const SMOOTHSTEP_BORDER_RADIUS = 8;

// US-011 / US-024: shift in flow units applied to the EdgeAnchor circle's
// cx/cy (mirrors xyflow's `shiftX/shiftY(centerX, radius, position)` with
// radius = the `reconnectRadius` prop on <ReactFlow>, which is 10 in
// demo-canvas.tsx). Keep in lock-step so the visible reconnect dot's
// center sits half a diameter outside the floating endpoint — same offset
// xyflow uses for its (default) anchor placement.
const RECONNECT_ANCHOR_SHIFT = 10;
const shiftAnchorForSide = (
  baseX: number,
  baseY: number,
  side: Side,
): { cx: number; cy: number } => {
  switch (side) {
    case 'top':
      return { cx: baseX, cy: baseY - RECONNECT_ANCHOR_SHIFT };
    case 'bottom':
      return { cx: baseX, cy: baseY + RECONNECT_ANCHOR_SHIFT };
    case 'left':
      return { cx: baseX - RECONNECT_ANCHOR_SHIFT, cy: baseY };
    case 'right':
      return { cx: baseX + RECONNECT_ANCHOR_SHIFT, cy: baseY };
  }
};

const POSITION_BY_SIDE: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

const sideFromPosition = (p: Position): Side => {
  switch (p) {
    case Position.Top:
      return 'top';
    case Position.Right:
      return 'right';
    case Position.Bottom:
      return 'bottom';
    case Position.Left:
      return 'left';
  }
};

export type EditableEdgeData = {
  /** Persist a new label (PATCH /connectors/:id { label }). */
  onLabelChange?: (id: string, label: string) => void;
  /** Path geometry — 'curve' (default bezier) or 'step' (smoothstep). */
  path?: ConnectorPath;
  /** US-018: per-connector label font size in px (undefined → 11px default). */
  fontSize?: number;
  /**
   * US-018: register a stable handle that enters inline label edit mode.
   * demo-canvas calls the registered `enter()` from its onEdgeDoubleClick
   * callback so double-click anywhere on the edge body opens the editor.
   */
  registerEditHandle?: (id: string, enter: () => void) => () => void;
  /** US-025: floating endpoints when !== false. */
  sourceHandleAutoPicked?: boolean;
  /** US-025: same as sourceHandleAutoPicked but for the target endpoint. */
  targetHandleAutoPicked?: boolean;
  /** US-007: perimeter pin for the source endpoint (if set, overrides float/auto-pick). */
  sourcePin?: EdgePin;
  /** US-007: same as sourcePin but for the target endpoint. */
  targetPin?: EdgePin;
  /**
   * US-024 / US-007: when true, render the visible endpoint dots above
   * every node and edge in the canvas. The dots are purely visual; React
   * Flow's native EdgeUpdateAnchors sit underneath them (`pointer-events:
   * none` on the dot lets clicks pass through) and drive the free-floating
   * reconnect drag.
   */
  reconnectable?: boolean;
} & Record<string, unknown>;

export type EditableEdgeType = Edge<EditableEdgeData, 'editableEdge'>;

/**
 * Custom React Flow edge rendered as a smooth bezier (or smoothstep) curve.
 * Doubles up as an inline-editor for the connector label via double-click.
 *
 * US-025: when `data.sourceHandleAutoPicked !== false` the source endpoint
 * floats — we read the source node's live geometry via `useInternalNode`
 * and place the endpoint at the perimeter intersection of the line through
 * the two node centers, ignoring React Flow's stored handle coords. Same
 * for target.
 *
 * US-007: when `data.sourcePin` / `data.targetPin` is set, the endpoint is
 * anchored to a specific perimeter point that follows the node through
 * moves and resizes. (Pins are written by external tooling / data edits;
 * the visible endpoint dots are non-interactive — drag is handled by React
 * Flow's native reconnect anchors underneath.)
 */
export function EditableEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  style,
  markerEnd,
  markerStart,
  interactionWidth,
  data,
}: EdgeProps<EditableEdgeType>) {
  const [editing, setEditing] = useState(false);
  // useInternalNode subscribes the edge to changes on each node — including
  // position and dimensions — so a drag visibly slides the floating
  // endpoint along the perimeter in real time without any rerouter machinery.
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  // Source-node visual-status drives the handoff pulse on outgoing edges.
  // The wrapper data attribute matches the CSS selector in styles/index.css
  // (`.react-flow__edge[data-handoff="true"] .react-flow__edge-path`).
  const sourceData = (sourceNode?.data ?? {}) as {
    status?: NodeStatus;
    statusReport?: StatusReport & { ts: number };
  };
  const sourceVisualStatus = deriveVisualStatus(sourceData.status, sourceData.statusReport);
  const prevSourceVisualStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevSourceVisualStatusRef.current;
    prevSourceVisualStatusRef.current = sourceVisualStatus;
    if (!shouldFireEdgeHandoff(prev, sourceVisualStatus)) return;
    const wrapper = document.querySelector(
      `.react-flow__edge[data-id="${CSS.escape(id)}"]`,
    ) as SVGGElement | null;
    if (!wrapper) return;
    wrapper.setAttribute('data-handoff', 'true');
    const timer = window.setTimeout(() => {
      wrapper.removeAttribute('data-handoff');
    }, 500);
    return () => {
      window.clearTimeout(timer);
      wrapper.removeAttribute('data-handoff');
    };
  }, [id, sourceVisualStatus]);

  const sourceFallback: Endpoint = {
    x: sourceX,
    y: sourceY,
    side: sideFromPosition(sourcePosition),
  };
  const targetFallback: Endpoint = {
    x: targetX,
    y: targetY,
    side: sideFromPosition(targetPosition),
  };
  const endpoints = resolveEdgeEndpoints(
    sourceNode
      ? {
          box: {
            x: sourceNode.internals.positionAbsolute.x,
            y: sourceNode.internals.positionAbsolute.y,
            w: sourceNode.measured.width ?? sourceNode.width ?? 0,
            h: sourceNode.measured.height ?? sourceNode.height ?? 0,
          },
          autoPicked: data?.sourceHandleAutoPicked,
          pin: data?.sourcePin as Pin | undefined,
          fallback: sourceFallback,
        }
      : null,
    targetNode
      ? {
          box: {
            x: targetNode.internals.positionAbsolute.x,
            y: targetNode.internals.positionAbsolute.y,
            w: targetNode.measured.width ?? targetNode.width ?? 0,
            h: targetNode.measured.height ?? targetNode.height ?? 0,
          },
          autoPicked: data?.targetHandleAutoPicked,
          pin: data?.targetPin as Pin | undefined,
          fallback: targetFallback,
        }
      : null,
  );

  const sX = endpoints.source.x;
  const sY = endpoints.source.y;
  const sPos = POSITION_BY_SIDE[endpoints.source.side];
  const tX = endpoints.target.x;
  const tY = endpoints.target.y;
  const tPos = POSITION_BY_SIDE[endpoints.target.side];
  const sourceSide = endpoints.source.side;
  const targetSide = endpoints.target.side;
  const sourceShift = shiftAnchorForSide(sX, sY, sourceSide);
  const targetShift = shiftAnchorForSide(tX, tY, targetSide);

  // US-011: xyflow's EdgeAnchor circles (rendered as siblings to BaseEdge
  // when `reconnectable: true`) use xyflow's own sourceX/sourceY/sourcePosition
  // — which point at xyflow's first-handle for floating edges, NOT at the
  // body-perimeter intersection we render the path through. To keep the
  // native reconnect anchors glued to the actual edge endpoints (so the
  // user clicks where they see the dot and React Flow's free drag fires),
  // imperatively override `cx`/`cy` on the EdgeAnchor circles after each
  // render. For pinned edges the floating-endpoint equals xyflow's handle
  // position so this is a no-op; for floating edges it's the difference
  // between "anchor at body midpoint" and "anchor where the edge actually
  // visually ends". Imperative because xyflow renders the EdgeAnchor in a
  // sibling render path we can't intercept declaratively.
  useEffect(() => {
    const wrapper = document.querySelector(
      `.react-flow__edge[data-id="${CSS.escape(id)}"]`,
    ) as SVGGElement | null;
    if (!wrapper) return;
    const sourceAnchor = wrapper.querySelector<SVGCircleElement>('.react-flow__edgeupdater-source');
    const targetAnchor = wrapper.querySelector<SVGCircleElement>('.react-flow__edgeupdater-target');
    if (sourceAnchor) {
      sourceAnchor.setAttribute('cx', String(sourceShift.cx));
      sourceAnchor.setAttribute('cy', String(sourceShift.cy));
    }
    if (targetAnchor) {
      targetAnchor.setAttribute('cx', String(targetShift.cx));
      targetAnchor.setAttribute('cy', String(targetShift.cy));
    }
  }, [id, sourceShift.cx, sourceShift.cy, targetShift.cx, targetShift.cy]);

  const [edgePath, labelX, labelY] =
    data?.path === 'step'
      ? getSmoothStepPath({
          sourceX: sX,
          sourceY: sY,
          sourcePosition: sPos,
          targetX: tX,
          targetY: tY,
          targetPosition: tPos,
          borderRadius: SMOOTHSTEP_BORDER_RADIUS,
        })
      : getBezierPath({
          sourceX: sX,
          sourceY: sY,
          sourcePosition: sPos,
          targetX: tX,
          targetY: tY,
          targetPosition: tPos,
        });
  const onLabelChange = data?.onLabelChange;
  const labelText = typeof label === 'string' ? label : '';
  const editable = !!onLabelChange;
  const fontSize = data?.fontSize;
  const fontSizeStyle = typeof fontSize === 'number' ? { fontSize: `${fontSize}px` } : undefined;

  // US-018: register an external entry point to enter edit mode.
  const registerEditHandle = data?.registerEditHandle;
  useEffect(() => {
    if (!registerEditHandle || !editable) return;
    return registerEditHandle(id, () => setEditing(true));
  }, [id, registerEditHandle, editable]);

  // US-024: only render the visible endpoint dots when this edge is
  // reconnectable (sole-selected). The dots are purely visual — `pointer-
  // events: none` lets clicks pass through to React Flow's native
  // EdgeUpdateAnchors that sit at the same position and drive the
  // free-floating reconnect drag.
  const showEndpointDots = data?.reconnectable === true;
  const sourcePinned = data?.sourcePin !== undefined;
  const targetPinned = data?.targetPin !== undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={style}
        markerEnd={markerEnd}
        markerStart={markerStart}
        interactionWidth={interactionWidth}
      />
      {showEndpointDots ? (
        <ViewportPortal>
          <div
            data-testid={`edge-endpoint-source-${id}`}
            data-pinned={sourcePinned ? 'true' : 'false'}
            className="seeflow-connector-endpoint-dot"
            style={{
              transform: `translate(-50%, -50%) translate(${sourceShift.cx}px, ${sourceShift.cy}px)`,
            }}
          />
          <div
            data-testid={`edge-endpoint-target-${id}`}
            data-pinned={targetPinned ? 'true' : 'false'}
            className="seeflow-connector-endpoint-dot"
            style={{
              transform: `translate(-50%, -50%) translate(${targetShift.cx}px, ${targetShift.cy}px)`,
            }}
          />
        </ViewportPortal>
      ) : null}
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan nowheel pointer-events-auto absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          {editing && editable ? (
            <InlineEdit
              initialValue={labelText}
              field="connector-label"
              onCommit={(v) => onLabelChange?.(id, v)}
              onExit={() => setEditing(false)}
              className="sf:rounded-md sf:border sf:border-border sf:bg-card sf:px-1.5 sf:py-0.5 sf:text-[11px] sf:text-foreground/85 sf:shadow-md"
              style={fontSizeStyle}
              placeholder="Label"
            />
          ) : labelText ? (
            <button
              type="button"
              className={cn(
                'sf:rounded-md sf:border sf:border-border sf:bg-card sf:px-1.5 sf:py-0.5 sf:text-[11px] sf:text-foreground/85 sf:shadow-md',
                editable ? 'sf:hover:bg-muted' : '',
              )}
              style={fontSizeStyle}
              onDoubleClick={
                editable
                  ? (e) => {
                      e.stopPropagation();
                      setEditing(true);
                    }
                  : undefined
              }
            >
              {labelText}
            </button>
          ) : editable ? (
            <button
              type="button"
              aria-label="Add connector label"
              className="sf:rounded-full sf:border sf:border-dashed sf:border-muted-foreground/40 sf:bg-card sf:px-1 sf:text-[10px] sf:text-muted-foreground/60 sf:opacity-0 sf:transition-opacity sf:hover:opacity-100 sf:group-hover/canvas:opacity-50"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
            >
              +
            </button>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
