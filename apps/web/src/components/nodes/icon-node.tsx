import { LockBadge } from '@/components/nodes/lock-badge';
import { ResizeControls } from '@/components/nodes/resize-controls';
import { useResizeGesture } from '@/components/nodes/use-resize-gesture';
import type { IconNodeData } from '@/lib/api';
import { colorTokenStyle } from '@/lib/color-tokens';
import { ICON_REGISTRY } from '@/lib/icon-registry';
import { InlineEdit, cn } from '@seeflow/canvas';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { type CSSProperties, type MouseEvent as ReactMouseEvent, memo, useState } from 'react';

export type IconNodeRuntimeData = IconNodeData & {
  onResize?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  setResizing?: (on: boolean) => void;
  // Persist the inline-edited name (PATCH /nodes/:id { name }).
  // Mirrors the shape-node name-edit path; demo-view's onNodeNameChange
  // pushes a single coalesced undo entry per edit session (500ms window).
  // Absent → dblclick is a no-op (the no-demo / readonly contexts where
  // name edits aren't wired).
  onNameChange?: (nodeId: string, name: string) => void;
} & Record<string, unknown>;
export type IconNodeType = Node<IconNodeRuntimeData, 'iconNode'>;

export const ICON_DEFAULT_SIZE = { width: 48, height: 48 } as const;
export const ICON_FALLBACK_NAME = 'help-circle';

const MIN_W = 24;
const MIN_H = 24;

const HANDLE_CLASS = 'opacity-0 transition-opacity';

// PRD spec says `colorTokenStyle(data.color, 'node').color ?? 'currentColor'`,
// but `colorTokenStyle(_, 'node')` returns { borderColor, backgroundColor } —
// it has no `.color` property, so the icon would always fall through to
// `currentColor` and `data.color` would have no effect (contradicting the
// "data.color overrides default" acceptance). Use 'text' to get the saturated
// edge color that matches the rest of the palette for chromeless glyphs;
// 'default' token returns `{}` so unset values fall through to `currentColor`.
function resolveIconColor(token: IconNodeData['color']): string {
  return colorTokenStyle(token, 'text').color ?? 'currentColor';
}

// Console-warn once per unknown icon name so a broken demo doesn't spam logs.
const WARNED_NAMES = new Set<string>();

function IconNodeImpl({ id, data, selected, isConnectable }: NodeProps<IconNodeType>) {
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    setResizing: data.setResizing,
  });
  const sized = isResizing || data.width !== undefined || data.height !== undefined;
  const nameEditable = !!data.onNameChange;
  const [isEditing, setIsEditing] = useState(false);

  const requested = ICON_REGISTRY[data.icon];
  if (!requested && !WARNED_NAMES.has(data.icon)) {
    WARNED_NAMES.add(data.icon);
    console.warn(
      `[iconNode] Unknown icon "${data.icon}"; falling back to "${ICON_FALLBACK_NAME}".`,
    );
  }
  const IconComponent = requested ?? ICON_REGISTRY[ICON_FALLBACK_NAME];

  const iconColor = resolveIconColor(data.color);
  const strokeWidth = data.strokeWidth ?? 2;

  // US-010: selection outline moved to CSS (see play-node.tsx note).
  const containerStyle: CSSProperties = {
    ...(sized ? {} : { width: ICON_DEFAULT_SIZE.width, height: ICON_DEFAULT_SIZE.height }),
  };

  // US-004: dblclick enters inline label-edit mode (replaces the US-016
  // picker-on-dblclick binding; the picker now opens via the US-003 right-click
  // "Change icon" item). No-op when label edits aren't wired (e.g. readonly).
  // stopPropagation prevents React Flow's canvas dblclick handler from firing.
  const handleDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!nameEditable || isEditing) return;
    e.stopPropagation();
    setIsEditing(true);
  };

  return (
    <div
      className={cn('group relative', sized ? 'h-full w-full' : '')}
      style={containerStyle}
      data-testid="icon-node"
      onDoubleClick={handleDoubleClick}
    >
      <ResizeControls
        visible={!!selected && !!data.onResize && !isEditing && !data.locked}
        cornerVariant="visible"
        minWidth={MIN_W}
        minHeight={MIN_H}
        onResizeStart={onResizeStart}
        onResize={onResizeEvent}
        onResizeEnd={onResizeEnd}
      />
      {data.locked ? <LockBadge /> : null}
      <Handle
        type="target"
        position={Position.Top}
        id="t"
        isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && '!opacity-100')}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="l"
        isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && '!opacity-100')}
      />
      {IconComponent ? (
        <IconComponent
          color={iconColor}
          strokeWidth={strokeWidth}
          absoluteStrokeWidth
          aria-label={data.alt}
          className="block h-full w-full pointer-events-none select-none"
        />
      ) : null}
      {isEditing && nameEditable ? (
        // US-004: positioned where the read-mode caption would render (below
        // the icon, full node width, centered). Wrapped in an absolutely
        // positioned strip so the icon's bounding box (read by React Flow
        // for layout + edge geometry) stays identical to the read state.
        <div className="absolute left-0 right-0 top-full mt-1 text-center text-xs text-muted-foreground">
          <InlineEdit
            initialValue={data.name ?? ''}
            field="icon-node-label"
            onCommit={(v) => data.onNameChange?.(id, v)}
            onExit={() => setIsEditing(false)}
            placeholder="Label"
          />
        </div>
      ) : data.name ? (
        // US-002: caption below the icon. Absolutely positioned so the icon's
        // bounding box (read by React Flow for layout + edge geometry) is
        // identical whether or not a label is set. Width matches the node so
        // `truncate` clips overflow to an ellipsis at the node's edges.
        <span
          data-testid="icon-node-label"
          className="pointer-events-none absolute left-0 right-0 top-full mt-1 truncate text-center text-xs text-muted-foreground select-none"
        >
          {data.name}
        </span>
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        id="r"
        isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && '!opacity-100')}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="b"
        isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && '!opacity-100')}
      />
    </div>
  );
}

// US-010: see play-node.tsx — skip re-renders on xyflow's internal prop ticks.
function arePropsEqual(prev: NodeProps<IconNodeType>, next: NodeProps<IconNodeType>): boolean {
  return (
    prev.selected === next.selected &&
    prev.data === next.data &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

export const IconNode = memo(IconNodeImpl, arePropsEqual);
