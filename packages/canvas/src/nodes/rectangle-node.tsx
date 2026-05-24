import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { type CSSProperties, type MouseEvent as ReactMouseEvent, memo, useState } from 'react';
import { InlineEdit } from '../components/inline-edit.tsx';
import { cn } from '../lib/cn.ts';
import { NODE_DEFAULT_BG_WHITE, colorTokenStyle } from '../lib/color-tokens.ts';
import type { GeometricNodeData, NodeStatus, StatusReport } from '../types.ts';
import { NodeHeader } from './lib/node-header.tsx';
import { PlayButton } from './lib/play-button.tsx';
import { deriveVisualStatus } from './lib/visual-status.ts';
import { ResizeControls } from './resize-controls.tsx';
import { StatusBadge } from './status-badge.tsx';
import { useResizeGesture } from './use-resize-gesture.ts';

/**
 * Runtime data attached to a rectangle node by the canvas host. Extends the
 * persisted GeometricNodeData with the SSE-driven status + the action
 * callbacks the canvas injects. `playAction` and `statusAction` (on `data`)
 * are inherited from GeometricNodeData and are independently optional —
 * presence drives whether the play button and status badge render.
 */
export type RectangleNodeData = GeometricNodeData & {
  /** Latest run status from the runs map; undefined when never played. */
  status?: NodeStatus;
  /** Filled when status === 'error' — surfaced as the play-button tooltip. */
  errorMessage?: string;
  /** Latest StatusReport from this node's statusAction script (if any). */
  statusReport?: StatusReport & { ts: number };
  onPlay?: (nodeId: string) => void;
  onResize?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  onResizeEnd?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  setResizing?: (on: boolean) => void;
  onNameChange?: (nodeId: string, name: string) => void;
  onDescriptionChange?: (nodeId: string, description: string) => void;
  onIconChange?: (nodeId: string, icon: string | null) => void;
} & Record<string, unknown>;
export type RectangleNodeType = Node<RectangleNodeData, 'rectangle'>;

const MIN_W = 100;
const MIN_H = 44;
const DEFAULT_W = 250;

function RectangleNodeImpl({ id, data, selected, isConnectable }: NodeProps<RectangleNodeType>) {
  const status = data.status;
  const action = data.playAction;
  const description = data.description;
  const playable = !!action && !!data.onPlay;
  const visualStatus = deriveVisualStatus(status, data.statusReport);
  const isRunning = status === 'running';
  const isError = visualStatus === 'error';
  const buttonLabel =
    visualStatus === 'active'
      ? 'Running…'
      : visualStatus === 'success'
        ? 'Succeeded, run again'
        : visualStatus === 'error'
          ? data.errorMessage
            ? `Failed: ${data.errorMessage}`
            : 'Failed, run again'
          : 'Play';
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    onResizeEnd: (dims) => data.onResizeEnd?.(id, dims),
    setResizing: data.setResizing,
  });
  const [descEditing, setDescEditing] = useState(false);
  const descEditable = !!data.onDescriptionChange;
  const sized = data.width !== undefined || data.height !== undefined;
  const descriptionFontStyle: CSSProperties = {
    ...(data.fontSize !== undefined ? { fontSize: `${data.fontSize}px` } : {}),
    ...colorTokenStyle(data.textColor, 'text'),
  };

  const containerStyle: CSSProperties = {
    borderColor:
      data.statusReport?.state === 'error'
        ? colorTokenStyle('red', 'node').borderColor
        : colorTokenStyle(data.borderColor, 'node').borderColor,
    backgroundColor:
      data.backgroundColor !== undefined
        ? colorTokenStyle(data.backgroundColor, 'node').backgroundColor
        : NODE_DEFAULT_BG_WHITE,
    borderWidth: data.borderSize !== undefined ? data.borderSize : undefined,
    borderStyle: data.borderStyle,
    borderRadius: data.cornerRadius !== undefined ? data.cornerRadius : undefined,
    ...(sized ? {} : { width: DEFAULT_W }),
  };

  const handleWrapperDoubleClick = descEditable
    ? (e: ReactMouseEvent<HTMLDivElement>) => {
        if (descEditing) return;
        const target = e.target as HTMLElement | null;
        if (target?.closest('.react-flow__handle')) return;
        if (target?.closest('.react-flow__resize-control')) return;
        if (target?.closest('[data-testid="node-header"]')) return;
        e.stopPropagation();
        setDescEditing(true);
      }
    : undefined;

  return (
    <div
      className={cn(
        'sf:group sf:flex sf:flex-col sf:justify-center sf:overflow-hidden sf:rounded-lg sf:border-[3px] sf:shadow-sm sf:transition-shadow',
        sized ? 'sf:h-full sf:w-full' : '',
        isRunning ? 'seeflow-node-pulse' : '',
      )}
      style={containerStyle}
      data-status={status ?? 'idle'}
      data-testid="rectangle-node"
      data-node-type="rectangle"
      onDoubleClick={handleWrapperDoubleClick}
    >
      <ResizeControls
        visible={!!selected && !!data.onResize}
        cornerVariant="visible"
        minWidth={MIN_W}
        minHeight={MIN_H}
        onResizeStart={onResizeStart}
        onResize={onResizeEvent}
        onResizeEnd={onResizeEnd}
      />
      <Handle
        type="target"
        position={Position.Top}
        id="t"
        isConnectable={isConnectable}
        className={cn('sf:opacity-0 sf:transition-opacity', selected && 'sf:opacity-100!')}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="l"
        isConnectable={isConnectable}
        className={cn('sf:opacity-0 sf:transition-opacity', selected && 'sf:opacity-100!')}
      />
      <NodeHeader
        nodeId={id}
        name={data.name ?? ''}
        icon={data.icon}
        selected={selected}
        fontSize={data.fontSize}
        textColor={data.textColor}
        onNameChange={data.onNameChange}
        onIconChange={data.onIconChange}
        trailing={
          action ? (
            <div className="sf:flex sf:shrink-0 sf:items-center sf:gap-1">
              <PlayButton
                visualStatus={visualStatus}
                disabled={!playable || visualStatus === 'active'}
                buttonLabel={buttonLabel}
                isError={isError}
                onClick={(e) => {
                  e.stopPropagation();
                  data.onPlay?.(id);
                }}
              />
            </div>
          ) : undefined
        }
      />
      <div
        className="sf:flex sf:min-h-0 sf:flex-1 sf:items-center sf:px-3 sf:py-2"
        data-testid="node-content"
        data-resizing={isResizing ? 'true' : undefined}
      >
        {descEditing && descEditable ? (
          <InlineEdit
            initialValue={description ?? ''}
            field="node-description"
            multiline
            onCommit={(v) => data.onDescriptionChange?.(id, v)}
            onExit={() => setDescEditing(false)}
            className="sf:w-full sf:text-[18px] sf:text-muted-foreground"
            style={descriptionFontStyle}
            placeholder="Description"
          />
        ) : (
          <button
            type="button"
            className={cn(
              'sf:block sf:w-full sf:whitespace-normal sf:wrap-break-word sf:bg-transparent sf:p-0 sf:text-left sf:text-[18px] sf:text-muted-foreground',
              descEditable ? 'sf:hover:opacity-80' : '',
            )}
            style={descriptionFontStyle}
          >
            {description}
          </button>
        )}
      </div>
      {data.statusReport && (
        <div
          className="sf:flex sf:items-center sf:px-3 sf:pb-2"
          data-testid="rectangle-node-status-badge"
        >
          <StatusBadge
            state={data.statusReport.state}
            summary={data.statusReport.summary}
            data-testid="status-badge"
          />
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        id="r"
        isConnectable={isConnectable}
        className={cn('sf:opacity-0 sf:transition-opacity', selected && 'sf:opacity-100!')}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="b"
        isConnectable={isConnectable}
        className={cn('sf:opacity-0 sf:transition-opacity', selected && 'sf:opacity-100!')}
      />
    </div>
  );
}

function arePropsEqual(
  prev: NodeProps<RectangleNodeType>,
  next: NodeProps<RectangleNodeType>,
): boolean {
  return (
    prev.selected === next.selected &&
    prev.data === next.data &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

export const RectangleNode = memo(RectangleNodeImpl, arePropsEqual);
