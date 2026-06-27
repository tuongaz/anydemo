import type { Node, NodeProps } from '@xyflow/react';
import {
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  memo,
  useRef,
  useState,
} from 'react';
import { cn } from '../lib/cn.ts';
import { colorTokenStyle } from '../lib/color-tokens.ts';
import { type LinePoints, denormalizePoints } from '../lib/line-geometry.ts';
import { snapSegmentToStraight } from '../lib/snap-segment.ts';
import type { ColorToken, LineNodeData } from '../types.ts';
import { dashFor } from './shapes/types.ts';

// Runtime data widens the persisted schema with the endpoint-edit delegates the
// canvas injects in edit mode. They are not part of the on-disk schema, so the
// runtime type carries them separately.
export type LineNodeRuntimeData = LineNodeData & {
  /** Current viewport zoom — converts the pointer's screen delta to flow units. */
  getLineZoom?: () => number;
  /** Commit the two endpoints (in CURRENT-box-local flow coords) on drag-stop. */
  onLineEndpointDragEnd?: (nodeId: string, points: LinePoints) => void;
} & Record<string, unknown>;

export type LineNodeType = Node<LineNodeRuntimeData, 'line'>;

/** Default stroke width (flow units) when a line carries no `borderSize`. */
export const LINE_DEFAULT_STROKE = 2;

/** Screen-px radius within which a dragged endpoint snaps to a perfectly
 * horizontal/vertical segment with the fixed endpoint (mirrors the connector +
 * draw-commit STRAIGHT_SNAP_PX). */
const ENDPOINT_SNAP_PX = 8;

// Mirrors freehand/icon stroke resolution: the saturated 'text' edge color for a
// set token, falling through to `currentColor` for the unset/default case.
function resolveStrokeColor(token: ColorToken | undefined): string {
  return colorTokenStyle(token, 'text').color ?? 'currentColor';
}

function LineNodeImpl({ id, data, selected }: NodeProps<LineNodeType>): ReactElement {
  const width = data.width ?? 160;
  const height = data.height ?? 80;
  const sized = data.width !== undefined || data.height !== undefined;

  const editable = !!data.onLineEndpointDragEnd;
  // In-progress endpoint drag: which end + its live local coords. Null when idle.
  const [drag, setDrag] = useState<{ index: 0 | 1; local: [number, number] } | null>(null);
  const startClientRef = useRef<{ x: number; y: number } | null>(null);
  const startLocalRef = useRef<[number, number] | null>(null);

  const baseLocal = denormalizePoints(data.points, width, height);
  const local: LinePoints = drag
    ? drag.index === 0
      ? [drag.local, baseLocal[1]]
      : [baseLocal[0], drag.local]
    : baseLocal;
  const [[x1, y1], [x2, y2]] = local;

  const stroke = resolveStrokeColor(data.borderColor);
  const strokeWidth = data.borderSize ?? LINE_DEFAULT_STROKE;
  const dash = dashFor(data.borderStyle);
  const label = data.name ?? 'Line';

  const zoomNow = (): number => data.getLineZoom?.() ?? 1;
  // Constant-ish screen-size handle: ~5 screen px at the render-time zoom.
  const handleR = 5 / zoomNow();

  const onEndpointDown = (index: 0 | 1) => (e: ReactPointerEvent) => {
    if (!editable) return;
    // Stop the node-drag gesture from claiming this pointer.
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    startClientRef.current = { x: e.clientX, y: e.clientY };
    startLocalRef.current = baseLocal[index];
    setDrag({ index, local: baseLocal[index] });
  };
  const onEndpointMove = (e: ReactPointerEvent) => {
    const startClient = startClientRef.current;
    const startLocal = startLocalRef.current;
    if (!drag || !startClient || !startLocal) return;
    e.stopPropagation();
    const zoom = zoomNow();
    const movedX = startLocal[0] + (e.clientX - startClient.x) / zoom;
    const movedY = startLocal[1] + (e.clientY - startClient.y) / zoom;
    const fixed = baseLocal[drag.index === 0 ? 1 : 0];
    const snapped = snapSegmentToStraight(
      { x: fixed[0], y: fixed[1] },
      { x: movedX, y: movedY },
      ENDPOINT_SNAP_PX / zoom,
    );
    setDrag({ index: drag.index, local: [snapped.x, snapped.y] });
  };
  const onEndpointUp = (e: ReactPointerEvent) => {
    if (!drag) return;
    e.stopPropagation();
    const finalLocal: LinePoints =
      drag.index === 0 ? [drag.local, baseLocal[1]] : [baseLocal[0], drag.local];
    data.onLineEndpointDragEnd?.(id, finalLocal);
    setDrag(null);
    startClientRef.current = null;
    startLocalRef.current = null;
  };

  const showHandles = editable && !!selected;

  return (
    <div
      className={cn('sf:group sf:relative', sized ? 'sf:h-full sf:w-full' : '')}
      style={sized ? undefined : { width, height }}
      data-testid="line-node"
      data-node-type="line"
      data-line-id={id}
    >
      <svg
        role="img"
        aria-label={label}
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ overflow: 'visible' }}
      >
        {/* Fat transparent hit line so the thin visible stroke is easy to click. */}
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="transparent"
          strokeWidth={Math.max(strokeWidth + 10, 12)}
          strokeLinecap="round"
        />
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={dash}
          strokeLinecap="round"
        />
        {showHandles
          ? ([0, 1] as const).map((i) => {
              const [hx, hy] = local[i];
              return (
                <circle
                  key={i}
                  data-testid={`line-endpoint-${i}`}
                  cx={hx}
                  cy={hy}
                  r={handleR}
                  fill="var(--seeflow-handle-fill, #fff)"
                  stroke="var(--seeflow-handle-border-color, currentColor)"
                  strokeWidth={Math.max(handleR / 3, 0.5)}
                  style={{ cursor: 'move', pointerEvents: 'all' }}
                  onPointerDown={onEndpointDown(i)}
                  onPointerMove={onEndpointMove}
                  onPointerUp={onEndpointUp}
                />
              );
            })
          : null}
      </svg>
    </div>
  );
}

// Mirrors freehand-node — skip xyflow's internal prop ticks; gate on the props
// that change the painted output.
function arePropsEqual(prev: NodeProps<LineNodeType>, next: NodeProps<LineNodeType>): boolean {
  return (
    prev.selected === next.selected &&
    prev.data === next.data &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

export const LineNode = memo(LineNodeImpl, arePropsEqual);
