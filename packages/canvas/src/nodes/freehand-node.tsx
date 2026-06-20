import type { Node, NodeProps } from '@xyflow/react';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { colorTokenStyle } from '../lib/color-tokens.ts';
import type { ColorToken } from '../types.ts';
import { type Point, denormalizePoints } from './freehand-geometry.ts';
import { FREEHAND_STROKE_OPTIONS, strokeOutlineToPath } from './freehand-stroke.ts';

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

export interface FreehandNodeData {
  points: Point[];
  name?: string;
  width?: number;
  height?: number;
  color?: ColorToken;
  strokeWidth?: number;
}

export type FreehandNodeType = Node<FreehandNodeData & Record<string, unknown>, 'freehand'>;

// Matches icon-node.tsx's color resolution: the saturated 'text' edge color for
// a set token, falling through to `currentColor` for the unset/default case.
function resolveStrokeColor(token: ColorToken | undefined): string {
  return colorTokenStyle(token, 'text').color ?? 'currentColor';
}

export function FreehandNode({ data }: NodeProps<FreehandNodeType>): ReactElement {
  const width = data.width ?? 100;
  const height = data.height ?? 100;

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
    <svg
      role="img"
      aria-label={label}
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      style={{ width, height, overflow: 'visible' }}
    >
      {body}
    </svg>
  );
}
