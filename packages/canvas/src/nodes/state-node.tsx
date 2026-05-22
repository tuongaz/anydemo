import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { type CSSProperties, type MouseEvent as ReactMouseEvent, memo, useState } from 'react';
import { IconPickerPopover } from '../components/icon-picker-popover.tsx';
import { InlineEdit } from '../components/inline-edit.tsx';
import { cn } from '../lib/cn.ts';
import { colorTokenStyle } from '../lib/color-tokens.ts';
import type { NodeData, NodeStatus, StatusReport } from '../types.ts';
import { Icon } from '../ui/icon.tsx';
import { deriveVisualStatus } from './lib/visual-status.ts';
import { ResizeControls } from './resize-controls.tsx';
import { StatusIconPill } from './status-icon-pill.tsx';
import { useResizeGesture } from './use-resize-gesture.ts';

export type StateNodeData = NodeData & {
  /**
   * Undefined when no emit() event has landed for this node — treated as
   * 'idle' visually (the StatusIconPill renders nothing for 'idle').
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
  onResizeEnd?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  setResizing?: (on: boolean) => void;
  onNameChange?: (nodeId: string, name: string) => void;
  onDescriptionChange?: (nodeId: string, description: string) => void;
  /**
   * When wired (only in edit mode, only for selected nodes), the icon in the
   * header becomes a popover trigger. The picker emits `null` for the
   * "No icon" tile, which clears the field on disk. Mirrors the same
   * read-only gate used by onNameChange / onDescriptionChange.
   */
  onIconChange?: (nodeId: string, icon: string | null) => void;
} & Record<string, unknown>;
export type StateNodeType = Node<StateNodeData, 'stateNode'>;

type EditField = 'name' | 'description' | null;

// Minimum dimensions: enough to fit a single-line header + single-line content
// row at our chosen text sizes. Resize gestures are clamped to this floor by
// React Flow so the user can't shrink the node below its readable content.
const MIN_W = 100;
const MIN_H = 44;
const DEFAULT_W = 250;

function StateNodeImpl({ id, data, selected, isConnectable }: NodeProps<StateNodeType>) {
  const status = data.status ?? 'idle';
  const visualStatus = deriveVisualStatus(data.status, data.statusReport);
  const description = data.description;
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    onResizeEnd: (dims) => data.onResizeEnd?.(id, dims),
    setResizing: data.setResizing,
  });
  const [editing, setEditing] = useState<EditField>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const nameEditable = !!data.onNameChange;
  const descEditable = !!data.onDescriptionChange;
  // Icon becomes a popover trigger only when (a) the node is selected so the
  // affordance is scoped to the user's current focus, (b) onIconChange is
  // wired (edit mode, supported type), and (c) an icon is already present —
  // adding an icon when there is none is the sidebar's job, so the on-node
  // trigger never appears in the empty state.
  const iconEditable = !!data.onIconChange && !!selected && !!data.icon;
  // When data.width/height are unset, we own sizing — pin a default width so a
  // long label/description wraps inside the node instead of stretching it.
  // `isResizing` is NOT in this check: on mousedown of the resize handle with
  // no movement, dropping the fallback width would leave the inner as `w-full`
  // of a wrapper that has no explicit width (data.width undef), collapsing it
  // to intrinsic content width. The first per-tick `onResize` of an actual
  // drag sets `data.width` and flips `sized` true naturally.
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
        'sf:group sf:flex sf:flex-col sf:justify-center sf:overflow-hidden sf:rounded-lg sf:border-[3px] sf:border-dashed sf:shadow-sm sf:transition-shadow',
        sized ? 'sf:h-full sf:w-full' : '',
        status === 'running' ? 'seeflow-node-pulse' : '',
      )}
      style={containerStyle}
      data-status={status}
      data-testid="state-node"
      data-node-type="stateNode"
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
      <div
        className="sf:flex sf:shrink-0 sf:items-center sf:justify-between sf:gap-2 sf:border-b sf:border-border sf:px-3 sf:py-3"
        style={colorTokenStyle(data.backgroundColor, 'node-header')}
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
                  data-testid="state-node-icon-trigger"
                  aria-label="Change icon"
                  aria-pressed={iconPickerOpen}
                  className={cn(
                    // Hit area matches the icon's intrinsic 16px so the header
                    // doesn't reflow when selection toggles the button wrapper
                    // around the icon. Hover/focus surfaces a subtle ring +
                    // cursor change to advertise interactivity.
                    'sf:inline-flex sf:shrink-0 sf:cursor-pointer sf:items-center sf:justify-center sf:rounded-sm sf:bg-transparent sf:p-0 sf:transition-shadow',
                    'sf:hover:ring-2 sf:hover:ring-ring/40 sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring',
                  )}
                  onClick={(e) => {
                    // Stop the click from reaching the wrapper's double-click
                    // router and React Flow's node-click handler.
                    e.stopPropagation();
                  }}
                  onMouseDown={(e) => {
                    // React Flow uses pointerdown to initiate drag; halt
                    // here so click-to-open doesn't also drag the node.
                    e.stopPropagation();
                  }}
                  onDoubleClick={(e) => {
                    // Don't let the icon dblclick fall through to the header
                    // double-click → name-edit path.
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
          <StatusIconPill
            visualStatus={visualStatus}
            summary={data.statusReport?.summary}
            data-testid="state-node-status-pill"
          />
        </div>
      </div>
      <div
        className="sf:flex sf:min-h-0 sf:flex-1 sf:items-center sf:px-3 sf:py-2"
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
