import type { Node, NodeProps } from '@xyflow/react';
import { type ReactElement, memo } from 'react';
import { cn } from '../lib/cn.ts';
import { colorTokenStyle } from '../lib/color-tokens.ts';
import { denormalizePoints } from '../lib/line-geometry.ts';
import type { ColorToken, LineNodeData } from '../types.ts';
import { dashFor } from './shapes/types.ts';

// Runtime data widens the persisted schema with the endpoint-edit delegates the
// canvas injects in edit mode (M4 — line endpoint handles). They are not part of
// the on-disk schema, so the runtime type carries them separately.
export type LineNodeRuntimeData = LineNodeData & Record<string, unknown>;

export type LineNodeType = Node<LineNodeRuntimeData, 'line'>;

/** Default stroke width (flow units) when a line carries no `borderSize`. */
export const LINE_DEFAULT_STROKE = 2;

// Mirrors freehand/icon stroke resolution: the saturated 'text' edge color for a
// set token, falling through to `currentColor` for the unset/default case.
function resolveStrokeColor(token: ColorToken | undefined): string {
  return colorTokenStyle(token, 'text').color ?? 'currentColor';
}

function LineNodeImpl({ id, data, selected }: NodeProps<LineNodeType>): ReactElement {
  const width = data.width ?? 160;
  const height = data.height ?? 80;
  const sized = data.width !== undefined || data.height !== undefined;

  const [[x1, y1], [x2, y2]] = denormalizePoints(data.points, width, height);
  const stroke = resolveStrokeColor(data.borderColor);
  const strokeWidth = data.borderSize ?? LINE_DEFAULT_STROKE;
  const dash = dashFor(data.borderStyle);
  const label = data.name ?? 'Line';

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
