import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { type ReactElement, memo, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn.ts';
import { colorTokenStyle } from '../lib/color-tokens.ts';
import type { ColorToken, FreehandNodeData } from '../types.ts';
import { denormalizePoints } from './freehand-geometry.ts';
import { FREEHAND_STROKE_OPTIONS, strokeOutlineToPath } from './freehand-stroke.ts';
import { ResizeControls } from './resize-controls.tsx';
import { type ResizeAlignmentHooks, useResizeGesture } from './use-resize-gesture.ts';

// perfect-freehand is an optional peer dep. Module-singleton dynamic import
// resolving to `getStroke` or `null` (peer dep absent) — mirrors
// IconifyOrPlaceholder's loader in src/components/icon-renderer.tsx.
type GetStroke = (points: number[][], options?: Record<string, unknown>) => number[][];

let getStrokePromise: Promise<GetStroke | null> | null = null;

function loadGetStroke(): Promise<GetStroke | null> {
  if (getStrokePromise) return getStrokePromise;
  getStrokePromise = import('perfect-freehand').then(
    (m) => m.getStroke as unknown as GetStroke,
    () => null,
  );
  return getStrokePromise;
}

// Mirrors icon-node's IconNodeRuntimeData: the resize callbacks + alignment
// delegate are injected at runtime by the canvas (buildNode in
// seeflow-canvas.tsx) — they are not part of the persisted schema, so the
// runtime type widens the schema-level FreehandNodeData with them.
export type FreehandNodeRuntimeData = FreehandNodeData & {
  onResize?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  onResizeEnd?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  setResizing?: (on: boolean) => void;
  /** US-005: alignment-guide integration injected by the canvas in edit mode. */
  resizeAlignment?: ResizeAlignmentHooks;
} & Record<string, unknown>;

export type FreehandNodeType = Node<FreehandNodeRuntimeData, 'freehand'>;

const MIN_EXTENT = 8;
const HANDLE_CLASS = 'sf:opacity-0 sf:transition-opacity';

// Matches icon-node.tsx's color resolution: the saturated 'text' edge color for
// a set token, falling through to `currentColor` for the unset/default case.
function resolveStrokeColor(token: ColorToken | undefined): string {
  return colorTokenStyle(token, 'text').color ?? 'currentColor';
}

function FreehandNodeImpl({
  id,
  data,
  selected,
  isConnectable,
}: NodeProps<FreehandNodeType>): ReactElement {
  const width = data.width ?? 100;
  const height = data.height ?? 100;
  // Mirrors icon-node.tsx: a sized node (persisted dims) lets xyflow size the
  // wrapper live during a resize drag — `sf:h-full sf:w-full` makes the inner
  // svg track that growth and stretch the ink. Hardcoding the inline px for a
  // sized node would override the classes AND pin the ink to its pre-drag size
  // (only updating on resize-stop). An unsized node falls back to the fixed
  // default px so the wrapper isn't zero-height before any dims exist.
  const sized = data.width !== undefined || data.height !== undefined;

  const { onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    onResizeEnd: (dims) => data.onResizeEnd?.(id, dims),
    setResizing: data.setResizing,
    nodeId: id,
    alignment: data.resizeAlignment,
  });

  const [getStroke, setGetStroke] = useState<GetStroke | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    loadGetStroke().then((g) => {
      if (mounted.current) setGetStroke(() => g);
    });
    return () => {
      mounted.current = false;
    };
  }, []);

  const local = denormalizePoints(data.points, { x: 0, y: 0, width, height });
  const color = resolveStrokeColor(data.color);
  const size = (data.strokeWidth ?? 1) * FREEHAND_STROKE_OPTIONS.size;
  const label = data.name ?? 'Freehand drawing';

  let body: ReactElement;
  if (getStroke) {
    const outline = getStroke(local, { ...FREEHAND_STROKE_OPTIONS, size });
    body = <path d={strokeOutlineToPath(outline)} fill={color} />;
  } else {
    // Fallback until perfect-freehand resolves (or forever if it's missing):
    // a polyline through the raw denormalized samples.
    body = (
      <polyline
        points={local.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={size / 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }

  return (
    <div
      className={cn('sf:group sf:relative', sized ? 'sf:h-full sf:w-full' : '')}
      style={sized ? undefined : { width, height }}
      data-testid="freehand-node"
      data-node-type="freehand"
    >
      <ResizeControls
        visible={!!selected && !!data.onResize}
        cornerVariant="visible"
        minWidth={MIN_EXTENT}
        minHeight={MIN_EXTENT}
        onResizeStart={onResizeStart}
        onResize={onResizeEvent}
        onResizeEnd={onResizeEnd}
      />
      <Handle
        type="target"
        position={Position.Top}
        id="t"
        isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="l"
        isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')}
      />
      <svg
        role="img"
        aria-label={label}
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ overflow: 'visible' }}
      >
        {body}
      </svg>
      <Handle
        type="source"
        position={Position.Right}
        id="r"
        isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="b"
        isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')}
      />
    </div>
  );
}

// Mirrors icon-node.tsx — skip re-renders on xyflow's internal prop ticks; the
// handles + resize chrome add render cost, so gate on the props that change the
// painted output.
function arePropsEqual(
  prev: NodeProps<FreehandNodeType>,
  next: NodeProps<FreehandNodeType>,
): boolean {
  return (
    prev.selected === next.selected &&
    prev.data === next.data &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

export const FreehandNode = memo(FreehandNodeImpl, arePropsEqual);
