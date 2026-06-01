import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { AlertTriangle, Link2, Pencil } from 'lucide-react';
import { type CSSProperties, memo, useEffect, useRef } from 'react';
import { cn } from '../lib/cn.ts';
import { colorTokenStyle } from '../lib/color-tokens.ts';
import type { LinkflowNodeData } from '../types.ts';
import { ResizeControls } from './resize-controls.tsx';
import { type ResizeAlignmentHooks, useResizeGesture } from './use-resize-gesture.ts';

/**
 * Runtime data carried on a linkflow node. The on-disk shape is
 * `LinkflowNodeData` (semantic + visual base + capabilities + optional
 * target). The host injects extra fields at mount:
 *
 *  - `_resolvedTarget` — what the host's resolver (see US-008 — useDemos
 *    lookup in apps/web) found for `data.target`. `undefined` means
 *    "not yet resolved" (treated as broken once target is set);
 *    `null` means "resolved but missing" (broken state);
 *    `{ projectName, flowName }` means linked-healthy.
 *  - `onOpenPicker` — wired in US-004. Called with 'link' from the
 *    unlinked button, 'edit' from the pencil / broken body click.
 *  - `onFollow` — wired in US-007. Called from the linked-healthy body
 *    click to push the target onto the navigation stack.
 *  - `_autoOpenPickerOnMount` — runtime-only flag stamped by the toolbar's
 *    drag-create branch (see seeflow-canvas.tsx). When true, the node fires
 *    `onOpenPicker('link')` exactly once on mount so a fresh drop lands the
 *    user directly in the picker. The flag never persists: `NodePatchBodySchema`
 *    is `strict()` so the studio rejects it at the create-node boundary, and
 *    the renderer reads it once via a `firedRef` guard so a re-render with the
 *    flag still set doesn't re-fire (also makes undo/redo of the drop a clean
 *    delete/recreate without re-opening the picker).
 *
 * At US-002 (this story) the click handlers are no-op placeholders — the
 * renderer still wires the click paths so US-004/US-007 only have to
 * supply the callbacks.
 */
export type LinkflowNodeRuntimeData = LinkflowNodeData & {
  _resolvedTarget?: { projectName: string; flowName: string } | null;
  _autoOpenPickerOnMount?: boolean;
  onOpenPicker?: (mode: 'link' | 'edit') => void;
  onFollow?: () => void;
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

export type LinkflowNodeType = Node<LinkflowNodeRuntimeData, 'linkflow'>;

export const LINKFLOW_DEFAULT_SIZE = { width: 240, height: 100 } as const;

/**
 * Minimum size enforced when the toolbar's draw-mode commits a sized linkflow
 * node. A truly tiny rectangle would collapse the unlinked pill and the
 * linked-healthy card into an unreadable thumbnail; this floor keeps them
 * legible while still letting users size up. Near-zero drags (tap gestures)
 * skip the floor entirely and fall back to {@link LINKFLOW_DEFAULT_SIZE} — see
 * the drag-release branch in `seeflow-canvas.tsx`.
 */
export const LINKFLOW_MIN_SIZE = { width: 160, height: 80 } as const;

const HANDLE_CLASS = 'sf:opacity-0 sf:transition-opacity';

type LinkflowVisualState = 'unlinked' | 'linked-healthy' | 'broken';

function deriveState(data: LinkflowNodeRuntimeData): LinkflowVisualState {
  if (data.target === undefined) return 'unlinked';
  // target set + resolver returned a hit → healthy. `undefined` or `null`
  // both mean "no hit" → broken. The resolver layer (US-008) is what flips
  // these two apart from each other; the renderer treats them the same.
  if (data._resolvedTarget && data._resolvedTarget.flowName !== undefined) {
    return 'linked-healthy';
  }
  return 'broken';
}

function LinkflowNodeImpl({ id, data, selected, isConnectable }: NodeProps<LinkflowNodeType>) {
  const state = deriveState(data);
  const sized = data.width !== undefined || data.height !== undefined;

  const { onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    onResizeEnd: (dims) => data.onResizeEnd?.(id, dims),
    setResizing: data.setResizing,
    nodeId: id,
    alignment: data.resizeAlignment,
  });

  // One-shot auto-open hook for the toolbar's drag-create flow. `firedRef`
  // ensures a re-render with the flag still set doesn't re-fire the picker,
  // and the callback gate handles the (test/transitional) case where the host
  // injects `onOpenPicker` on a later render. Effect deps cover both inputs.
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    if (!data._autoOpenPickerOnMount) return;
    if (!data.onOpenPicker) return;
    firedRef.current = true;
    data.onOpenPicker('link');
  }, [data._autoOpenPickerOnMount, data.onOpenPicker]);

  const baseChrome: CSSProperties = {
    ...(data.backgroundColor !== undefined
      ? { backgroundColor: colorTokenStyle(data.backgroundColor, 'node').backgroundColor }
      : {}),
    ...(data.borderColor !== undefined
      ? { borderColor: colorTokenStyle(data.borderColor, 'node').borderColor }
      : {}),
    ...(data.borderSize !== undefined ? { borderWidth: data.borderSize } : {}),
    ...(data.borderStyle !== undefined ? { borderStyle: data.borderStyle } : {}),
    ...(data.cornerRadius !== undefined ? { borderRadius: data.cornerRadius } : {}),
    ...(data.shadow !== undefined ? { boxShadow: `var(--node-shadow-${data.shadow})` } : {}),
    ...(data.fontSize !== undefined ? { fontSize: `${data.fontSize}px` } : {}),
  };

  const containerStyle: CSSProperties = {
    ...baseChrome,
    ...(sized ? {} : { width: LINKFLOW_DEFAULT_SIZE.width, height: LINKFLOW_DEFAULT_SIZE.height }),
  };

  const resizeControls = (
    <ResizeControls
      visible={!!selected && !!data.onResize}
      cornerVariant="visible"
      minWidth={LINKFLOW_MIN_SIZE.width}
      minHeight={LINKFLOW_MIN_SIZE.height}
      onResizeStart={onResizeStart}
      onResize={onResizeEvent}
      onResizeEnd={onResizeEnd}
    />
  );

  const handles = (
    <>
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
    </>
  );

  if (state === 'unlinked') {
    return (
      <div
        data-testid="linkflow-node"
        data-node-type="linkflow"
        data-linkflow-state="unlinked"
        className="sf:group sf:relative sf:flex sf:h-full sf:w-full sf:items-center sf:justify-center sf:rounded-md sf:border sf:border-dashed sf:border-border sf:bg-muted/40 sf:text-muted-foreground"
        style={containerStyle}
      >
        {resizeControls}
        {handles}
        <button
          type="button"
          data-testid="linkflow-link-button"
          onClick={(e) => {
            e.stopPropagation();
            data.onOpenPicker?.('link');
          }}
          className="sf:inline-flex sf:items-center sf:gap-2 sf:rounded-md sf:px-3 sf:py-1.5 sf:text-sm sf:font-medium sf:text-foreground sf:hover:bg-muted/60"
        >
          <Link2 size={14} aria-hidden />
          <span>Link to a flow</span>
        </button>
      </div>
    );
  }

  if (state === 'broken') {
    // Target is set but the resolver couldn't find it (renamed / deleted /
    // project unregistered). Surface the last-known slug pair as the label —
    // the picker (opened on body click in US-004) lets the user re-pick.
    // Broken is a transient warning chrome — resize handles aren't useful
    // here, so we keep the semantic <button> wrapper for keyboard a11y
    // instead of swapping to a div + role="button".
    const lastKnown = data.target ? `${data.target.project} · ${data.target.flow}` : '';
    return (
      <button
        type="button"
        data-testid="linkflow-node"
        data-node-type="linkflow"
        data-linkflow-state="broken"
        onClick={(e) => {
          e.stopPropagation();
          data.onOpenPicker?.('edit');
        }}
        className="sf:group sf:relative sf:flex sf:w-full sf:flex-col sf:items-center sf:justify-center sf:gap-1.5 sf:rounded-md sf:border sf:border-dashed sf:border-amber-500/60 sf:bg-amber-500/10 sf:px-3 sf:py-2 sf:text-center sf:text-amber-700 sf:dark:text-amber-300"
        style={containerStyle}
      >
        {handles}
        <AlertTriangle size={16} aria-hidden />
        <div
          data-testid="linkflow-broken-label"
          className="sf:truncate sf:text-xs sf:text-muted-foreground"
        >
          {lastKnown}
        </div>
        <div className="sf:text-[11px] sf:text-muted-foreground">Linked flow missing</div>
      </button>
    );
  }

  // linked-healthy — outer wrapper is a plain <div> so React Flow's pointerdown
  // selection/drag/connect paths fire on body clicks. Navigation lives in a
  // dedicated Link <button> on the right (US-007); the pencil <button> next to
  // it opens the picker for re-targeting (US-004). Body taps select the node
  // for color/connection edits without navigating away. The chrome background
  // comes purely from `containerStyle.backgroundColor` (toolbar color picker
  // writes `data.backgroundColor`) so there's no class fallback to override.
  const resolved = data._resolvedTarget as { projectName: string; flowName: string };
  return (
    <div
      data-testid="linkflow-node"
      data-node-type="linkflow"
      data-linkflow-state="linked-healthy"
      className="sf:group sf:relative sf:flex sf:h-full sf:w-full sf:items-center sf:gap-3 sf:rounded-md sf:border sf:border-border sf:px-3 sf:py-2 sf:text-left sf:text-card-foreground"
      style={{ backgroundColor: 'hsl(var(--card))', ...containerStyle }}
    >
      {resizeControls}
      {handles}
      <span
        data-testid="linkflow-flow-name"
        className="sf:min-w-0 sf:flex-1 sf:truncate sf:font-medium sf:text-base sf:leading-tight"
      >
        {resolved.flowName}
      </span>
      <button
        type="button"
        data-testid="linkflow-edit-button"
        aria-label="Change linked flow"
        title="Change linked flow"
        onClick={(e) => {
          e.stopPropagation();
          data.onOpenPicker?.('edit');
        }}
        className="sf:absolute sf:top-1 sf:right-1 sf:flex sf:h-5 sf:w-5 sf:cursor-pointer sf:items-center sf:justify-center sf:rounded sf:bg-background/80 sf:text-muted-foreground sf:opacity-0 sf:transition-opacity sf:hover:text-foreground sf:group-hover:opacity-100 sf:focus:opacity-100"
      >
        <Pencil size={12} aria-hidden />
      </button>
      <button
        type="button"
        data-testid="linkflow-follow-button"
        aria-label={`Open ${resolved.flowName}`}
        title={`Open ${resolved.flowName}`}
        onClick={(e) => {
          e.stopPropagation();
          data.onFollow?.();
        }}
        className="sf:flex sf:h-11 sf:w-11 sf:shrink-0 sf:cursor-pointer sf:items-center sf:justify-center sf:rounded-md sf:border sf:border-border sf:bg-background sf:text-foreground sf:transition-colors sf:hover:bg-muted sf:hover:text-foreground"
      >
        <Link2 size={22} aria-hidden />
      </button>
      {/* The wrapped id is referenced in a data attribute so future debugging
          aids and integration tests can pin assertions to a specific node. */}
      <span hidden data-linkflow-node-id={id} />
    </div>
  );
}

function arePropsEqual(
  prev: NodeProps<LinkflowNodeType>,
  next: NodeProps<LinkflowNodeType>,
): boolean {
  return (
    prev.selected === next.selected &&
    prev.data === next.data &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

export const LinkflowNode = memo(LinkflowNodeImpl, arePropsEqual);
