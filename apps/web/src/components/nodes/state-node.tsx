import { InlineEdit } from '@/components/inline-edit';
import { LockBadge } from '@/components/nodes/lock-badge';
import { ResizeControls } from '@/components/nodes/resize-controls';
import { type NodeStatus, StatusPill } from '@/components/nodes/status-pill';
import { useResizeGesture } from '@/components/nodes/use-resize-gesture';
import type { NodeData, StatusReport } from '@/lib/api';
import { colorTokenStyle } from '@/lib/color-tokens';
import { cn } from '@seeflow/canvas';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { type CSSProperties, type MouseEvent as ReactMouseEvent, memo, useState } from 'react';

export type StateNodeData = NodeData & {
  /**
   * Undefined when no emit() event has landed for this node — treated as
   * 'idle' visually (the StatusPill renders nothing for 'idle').
   */
  status?: NodeStatus;
  /**
   * US-007: latest StatusReport from this node's statusAction script (if any),
   * driven by `node:status` SSE events. Undefined when no entry exists in the
   * `statusByNode` map — the badge row is suppressed entirely so the no-status
   * path is byte-identical to legacy renders (no layout shift).
   */
  statusReport?: StatusReport & { ts: number };
  onResize?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  setResizing?: (on: boolean) => void;
  onNameChange?: (nodeId: string, name: string) => void;
  onDescriptionChange?: (nodeId: string, description: string) => void;
} & Record<string, unknown>;
export type StateNodeType = Node<StateNodeData, 'stateNode'>;

type EditField = 'name' | 'description' | null;

// Minimum dimensions: enough to fit a single-line header + single-line content
// row at our chosen text sizes. Resize gestures are clamped to this floor by
// React Flow so the user can't shrink the node below its readable content.
const MIN_W = 100;
const MIN_H = 44;
const DEFAULT_W = 200;

function StateNodeImpl({ id, data, selected, isConnectable }: NodeProps<StateNodeType>) {
  const status = data.status ?? 'idle';
  const description = data.description ?? data.kind;
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    setResizing: data.setResizing,
  });
  const [editing, setEditing] = useState<EditField>(null);
  const nameEditable = !!data.onNameChange;
  const descEditable = !!data.onDescriptionChange;
  // When data.width/height are unset and we're not mid-resize, the React Flow
  // wrapper has no explicit dims and we own sizing — pin a default width so a
  // long label/description wraps inside the node instead of stretching it.
  const sized = isResizing || data.width !== undefined || data.height !== undefined;
  // US-008: title and body now share the same font size — title is bolded
  // instead of larger. The Style-tab fontSize override applies equally to
  // both, so a user-set 28px bumps the title AND the body to 28px.
  const labelFontStyle: CSSProperties = {
    ...(data.fontSize !== undefined ? { fontSize: `${data.fontSize}px` } : {}),
    ...colorTokenStyle(data.textColor, 'text'),
  };
  const descriptionFontStyle: CSSProperties = labelFontStyle;

  // Border + background tokens are independent — picking a border color
  // shouldn't tint the background and vice versa. Unset → fall through to
  // the theme defaults baked into the 'default' token (--border / --card).
  // US-010: selection outline moved to CSS (see play-node.tsx note) so the
  // inline style is stable across renders when only `selected` flips.
  const containerStyle: CSSProperties = {
    borderColor:
      data.statusReport?.state === 'error'
        ? colorTokenStyle('red', 'node').borderColor
        : colorTokenStyle(data.borderColor, 'node').borderColor,
    backgroundColor: colorTokenStyle(data.backgroundColor, 'node').backgroundColor,
    borderWidth: data.borderSize !== undefined ? data.borderSize : undefined,
    borderStyle: data.borderStyle,
    borderRadius: data.cornerRadius !== undefined ? data.cornerRadius : undefined,
    ...(sized ? {} : { width: DEFAULT_W }),
  };

  // US-020: region-aware double-click routing. Header → label edit; content
  // body (including blank space below short text) → description edit; padding
  // outside both falls back to description (when editable) so a tall node with
  // an empty description still routes blank-area clicks to the description.
  // Bails out for handles + resize controls so connect/resize gestures keep
  // their drag semantics. No-op while ANY field is already editing — InlineEdit
  // also stops propagation so a stray dblclick mid-edit doesn't switch fields.
  const handleWrapperDoubleClick =
    nameEditable || descEditable
      ? (e: ReactMouseEvent<HTMLDivElement>) => {
          if (editing !== null) return;
          const target = e.target as HTMLElement | null;
          if (target?.closest('.react-flow__handle')) return;
          if (target?.closest('.react-flow__resize-control')) return;
          e.stopPropagation();
          if (target?.closest('[data-testid="node-header"]')) {
            if (nameEditable) setEditing('name');
            return;
          }
          if (target?.closest('[data-testid="node-content"]')) {
            if (descEditable) setEditing('description');
            else if (nameEditable) setEditing('name');
            return;
          }
          if (descEditable) setEditing('description');
          else if (nameEditable) setEditing('name');
        }
      : undefined;

  return (
    <div
      className={cn(
        'group flex flex-col justify-center overflow-hidden rounded-lg border-[3px] border-dashed shadow-sm transition-shadow',
        sized ? 'h-full w-full' : '',
        status === 'running' ? 'seeflow-node-pulse' : '',
      )}
      style={containerStyle}
      data-status={status}
      data-testid="state-node"
      onDoubleClick={handleWrapperDoubleClick}
    >
      <ResizeControls
        visible={!!selected && !!data.onResize && !data.locked}
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
        className={cn('opacity-0 transition-opacity', selected && '!opacity-100')}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="l"
        isConnectable={isConnectable}
        className={cn('opacity-0 transition-opacity', selected && '!opacity-100')}
      />
      <div
        className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/30 px-2 py-2"
        data-testid="node-header"
      >
        <div
          className="min-w-0 flex-1 text-[18px] font-semibold leading-tight"
          style={labelFontStyle}
        >
          {editing === 'name' && nameEditable ? (
            <InlineEdit
              initialValue={data.name}
              field="node-name"
              required
              commitMode="blur-only"
              onCommit={(v) => data.onNameChange?.(id, v)}
              onExit={() => setEditing(null)}
              className="text-[18px] font-semibold"
              style={labelFontStyle}
            />
          ) : (
            <button
              type="button"
              className={cn(
                'block w-full whitespace-pre-wrap break-words bg-transparent p-0 text-left text-[18px] font-semibold leading-tight',
                nameEditable ? 'hover:opacity-80' : '',
              )}
              style={labelFontStyle}
            >
              {data.name}
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <StatusPill status={status} />
        </div>
      </div>
      <div
        className="flex min-h-0 flex-1 items-center px-2 py-1"
        data-testid="node-content"
        // While resizing, NodeResizer mutates wrapper dims live; we don't need
        // a special class but suppress noise from the linter about isResizing.
        data-resizing={isResizing ? 'true' : undefined}
      >
        {editing === 'description' && descEditable ? (
          <InlineEdit
            initialValue={data.description ?? ''}
            field="node-description"
            multiline
            onCommit={(v) => data.onDescriptionChange?.(id, v)}
            onExit={() => setEditing(null)}
            className="w-full text-[18px] text-muted-foreground"
            style={descriptionFontStyle}
            placeholder={data.kind}
          />
        ) : (
          <button
            type="button"
            className={cn(
              'block w-full whitespace-normal break-words bg-transparent p-0 text-left text-[18px] text-muted-foreground',
              descEditable ? 'hover:opacity-80' : '',
            )}
            style={descriptionFontStyle}
          >
            {description}
          </button>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="r"
        isConnectable={isConnectable}
        className={cn('opacity-0 transition-opacity', selected && '!opacity-100')}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="b"
        isConnectable={isConnectable}
        className={cn('opacity-0 transition-opacity', selected && '!opacity-100')}
      />
    </div>
  );
}

// US-010: see play-node.tsx — only data / selected / dimensions are
// render-triggering. xyflow's per-frame `dragging` / `isConnectable` ticks
// don't churn the renderer.
function arePropsEqual(prev: NodeProps<StateNodeType>, next: NodeProps<StateNodeType>): boolean {
  return (
    prev.selected === next.selected &&
    prev.data === next.data &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

export const StateNode = memo(StateNodeImpl, arePropsEqual);
