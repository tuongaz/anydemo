import { LockBadge } from '@/components/nodes/lock-badge';
import { ResizeControls } from '@/components/nodes/resize-controls';
import { StatusBadge } from '@/components/nodes/status-badge';
import type { NodeStatus } from '@/components/nodes/status-pill';
import { useResizeGesture } from '@/components/nodes/use-resize-gesture';
import type { NodeData, StatusReport } from '@/lib/api';
import { NODE_DEFAULT_BG_WHITE, colorTokenStyle } from '@/lib/color-tokens';
import { Button, InlineEdit, cn } from '@seeflow/canvas';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { Loader2, Play } from 'lucide-react';
import { type CSSProperties, type MouseEvent as ReactMouseEvent, memo, useState } from 'react';

export type PlayNodeData = NodeData & {
  /**
   * Undefined when this node has no entry in the runs map (i.e. the user has
   * never clicked Play on it). Once a run is dispatched, status becomes
   * 'running' → 'done'/'error'. Status is communicated visually via the Play
   * button itself (US-018) — no separate status chip.
   */
  status?: NodeStatus;
  /** Filled when status === 'error' — surfaced as the play-button tooltip. */
  errorMessage?: string;
  /**
   * US-007: latest StatusReport from this node's statusAction script (if any),
   * driven by `node:status` SSE events. Undefined when no entry exists in the
   * `statusByNode` map — the badge row is suppressed entirely so the no-status
   * path is byte-identical to legacy renders (no layout shift).
   */
  statusReport?: StatusReport & { ts: number };
  onPlay?: (nodeId: string) => void;
  onResize?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  setResizing?: (on: boolean) => void;
  onNameChange?: (nodeId: string, name: string) => void;
  onDescriptionChange?: (nodeId: string, description: string) => void;
} & Record<string, unknown>;
export type PlayNodeType = Node<PlayNodeData, 'playNode'>;

type EditField = 'name' | 'description' | null;

const MIN_W = 100;
const MIN_H = 44;
const DEFAULT_W = 200;

function PlayNodeImpl({ id, data, selected, isConnectable }: NodeProps<PlayNodeType>) {
  const status = data.status;
  const action = data.playAction;
  const description = data.description ?? data.kind;
  const playable = !!action && !!data.onPlay;
  const isRunning = status === 'running';
  const isError = status === 'error';
  // US-018: failed runs surface their reason as the button tooltip — replaces
  // the removed status chip. Falls back to a generic "Failed" if the SSE
  // event arrived without a message.
  const buttonLabel = isRunning
    ? 'Running…'
    : isError
      ? data.errorMessage
        ? `Failed: ${data.errorMessage}`
        : 'Failed'
      : 'Play';
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
  // shouldn't tint the background and vice versa. Border unset → fall
  // through to the theme default (--border) via the 'default' token.
  // US-021: when `backgroundColor` is unset, falls back to NODE_DEFAULT_BG_WHITE
  // (hsl(var(--card)) dark surface). An explicit token (including 'default')
  // still wins. Field stays unset on disk.
  // US-010: selection outline moved to CSS (`.react-flow__node.selected > div`
  // in index.css) so per-render style-object identity is stable for
  // `React.memo`'s prop-equality check below — no inline `outline*` keys
  // whose identity churns when `selected` flips.
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

  // Region-aware double-click routing. Header → name edit; content body
  // (including blank space below short text) → description edit; padding
  // outside both falls back to description (when editable). Bails out for
  // handles + resize controls so connect/resize gestures keep their drag
  // semantics. No-op while ANY field is already editing.
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
        'group flex flex-col justify-center overflow-hidden rounded-lg border-[3px] shadow-sm transition-shadow',
        sized ? 'h-full w-full' : '',
        isRunning ? 'seeflow-node-pulse' : '',
      )}
      style={containerStyle}
      data-status={status ?? 'idle'}
      data-testid="play-node"
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
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!playable || isRunning}
            // US-018: circular play button. On error, a thick red border
            // wraps the circle — replaces the standalone status chip. The
            // play glyph (or running spinner) stays visible inside.
            // US-021: hover/focus-visible flips the fill to a saturated
            // emerald and the icon (currentColor) to white — color-codes
            // the action without re-rendering. `disabled:pointer-events-none`
            // on the Button base class blocks the hover state while running
            // or unplayable, so the rule below applies only to live targets.
            className={cn(
              'h-8 w-8 rounded-full p-0 hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground',
              isError && 'border-2 border-rose-500',
            )}
            data-testid="play-button"
            data-status={status ?? 'idle'}
            aria-label={buttonLabel}
            title={buttonLabel}
            onClick={(e) => {
              e.stopPropagation();
              data.onPlay?.(id);
            }}
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Play className="h-4 w-4" aria-hidden />
            )}
          </Button>
        </div>
      </div>
      <div
        className="flex min-h-0 flex-1 items-center px-2 py-1"
        data-testid="node-content"
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
      {data.statusReport && (
        <div className="flex items-center px-2 pb-1" data-testid="play-node-status-badge">
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

// US-010: skip re-renders when only React Flow's internal props (`dragging`,
// `isConnectable`, `xPos`, `yPos`, …) tick — only `data`, `selected`, and the
// wrapper dimensions are visually load-bearing for this renderer. The big win
// is during the marquee gesture: hundreds of mid-drag selection updates land,
// but only the nodes whose `selected` flag flipped re-render.
function arePropsEqual(prev: NodeProps<PlayNodeType>, next: NodeProps<PlayNodeType>): boolean {
  return (
    prev.selected === next.selected &&
    prev.data === next.data &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

export const PlayNode = memo(PlayNodeImpl, arePropsEqual);
