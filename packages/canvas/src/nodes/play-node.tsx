import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { Loader2, Play } from 'lucide-react';
import { type CSSProperties, type MouseEvent as ReactMouseEvent, memo, useState } from 'react';
import { IconPickerPopover } from '../components/icon-picker-popover.tsx';
import { InlineEdit } from '../components/inline-edit.tsx';
import { cn } from '../lib/cn.ts';
import { NODE_DEFAULT_BG_WHITE, colorTokenStyle } from '../lib/color-tokens.ts';
import type { NodeData, StatusReport } from '../types.ts';
import { Button } from '../ui/button.tsx';
import { Icon } from '../ui/icon.tsx';
import { LockBadge } from './lock-badge.tsx';
import { ResizeControls } from './resize-controls.tsx';
import { StatusBadge } from './status-badge.tsx';
import type { NodeStatus } from './status-pill.tsx';
import { useResizeGesture } from './use-resize-gesture.ts';

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
  /**
   * When wired (edit mode + supported type), the header icon becomes a
   * popover trigger. The picker emits `null` for the "No icon" tile to
   * clear the field on disk. Mirrors the read-only gate used by
   * onNameChange / onDescriptionChange.
   */
  onIconChange?: (nodeId: string, icon: string | null) => void;
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
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const nameEditable = !!data.onNameChange;
  const descEditable = !!data.onDescriptionChange;
  // See state-node.tsx for the full rationale. The on-node icon trigger only
  // appears when an icon is already set; adding an icon to a bare node is the
  // sidebar's job.
  const iconEditable = !!data.onIconChange && !!selected && !data.locked && !!data.icon;
  // When data.width/height are unset, we own sizing — pin a default width so a
  // long label/description wraps inside the node instead of stretching it.
  // `isResizing` is NOT in this check: see state-node.tsx for the full
  // rationale (precreated-node click-shrink fix).
  const sized = data.width !== undefined || data.height !== undefined;
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
        'sf:group sf:flex sf:flex-col sf:justify-center sf:overflow-hidden sf:rounded-lg sf:border-[3px] sf:shadow-sm sf:transition-shadow',
        sized ? 'sf:h-full sf:w-full' : '',
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
        className={cn('sf:opacity-0 sf:transition-opacity', selected && 'sf:opacity-100!')}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="l"
        isConnectable={isConnectable}
        className={cn('sf:opacity-0 sf:transition-opacity', selected && 'sf:opacity-100!')}
      />
      <div
        className="sf:flex sf:shrink-0 sf:items-center sf:justify-between sf:gap-2 sf:border-b sf:bg-muted/30 sf:px-2 sf:py-2"
        data-testid="node-header"
      >
        {data.icon ? (
          iconEditable && data.onIconChange ? (
            <IconPickerPopover
              open={iconPickerOpen}
              onOpenChange={setIconPickerOpen}
              onPick={(name) => {
                data.onIconChange?.(id, name);
                setIconPickerOpen(false);
              }}
              anchor={
                <button
                  type="button"
                  data-testid="play-node-icon-trigger"
                  aria-label="Change icon"
                  aria-pressed={iconPickerOpen}
                  className={cn(
                    // Hit area matches the icon's intrinsic 16px so the header
                    // doesn't reflow when selection toggles the button wrapper
                    // around the icon. Hover/focus surfaces a subtle ring.
                    'sf:inline-flex sf:shrink-0 sf:cursor-pointer sf:items-center sf:justify-center sf:rounded-sm sf:bg-transparent sf:p-0 sf:transition-shadow',
                    'sf:hover:ring-2 sf:hover:ring-ring/40 sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring',
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <Icon
                    name={data.icon}
                    size={16}
                    style={colorTokenStyle(data.textColor, 'text')}
                    aria-hidden
                  />
                </button>
              }
            />
          ) : (
            <Icon
              name={data.icon}
              size={16}
              className="shrink-0"
              style={colorTokenStyle(data.textColor, 'text')}
              aria-hidden
            />
          )
        ) : null}
        <div
          className="sf:min-w-0 sf:flex-1 sf:text-[18px] sf:font-semibold sf:leading-tight sf:text-foreground/90"
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
              className="sf:text-[18px] sf:font-semibold sf:text-foreground/90"
              style={labelFontStyle}
            />
          ) : (
            <button
              type="button"
              className={cn(
                'sf:block sf:w-full sf:whitespace-pre-wrap sf:wrap-break-word sf:bg-transparent sf:p-0 sf:text-left sf:text-[18px] sf:font-semibold sf:leading-tight sf:text-foreground/90',
                nameEditable ? 'sf:hover:opacity-80' : '',
              )}
              style={labelFontStyle}
            >
              {data.name}
            </button>
          )}
        </div>
        <div className="sf:flex sf:shrink-0 sf:items-center sf:gap-1">
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
              'sf:h-8 sf:w-8 sf:rounded-full sf:p-0 sf:hover:bg-primary sf:hover:text-primary-foreground sf:focus-visible:bg-primary sf:focus-visible:text-primary-foreground',
              isError && 'sf:border-2 sf:border-rose-500',
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
              <Loader2 className="sf:h-4 sf:w-4 sf:animate-spin" aria-hidden />
            ) : (
              <Play className="sf:h-4 sf:w-4" aria-hidden />
            )}
          </Button>
        </div>
      </div>
      <div
        className="sf:flex sf:min-h-0 sf:flex-1 sf:items-center sf:px-2 sf:py-1"
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
            className="sf:w-full sf:text-[18px] sf:text-muted-foreground"
            style={descriptionFontStyle}
            placeholder={data.kind}
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
          className="sf:flex sf:items-center sf:px-2 sf:pb-1"
          data-testid="play-node-status-badge"
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
