import { Handle, type Node, type NodeProps, Position, useUpdateNodeInternals } from '@xyflow/react';
import { Expand, Maximize2 } from 'lucide-react';
import { type CSSProperties, type RefObject, memo, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn.ts';
import { colorTokenStyle } from '../lib/color-tokens.ts';
import { debouncedResizeObserver } from '../lib/debounced-resize-observer.ts';
import type { ComponentNodeData } from '../types.ts';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog.tsx';
import { ComponentRuntime } from './component-runtime.tsx';
import { NodeHeader } from './lib/node-header.tsx';
import { ResizeControls } from './resize-controls.tsx';
import { type ResizeAlignmentHooks, useResizeGesture } from './use-resize-gesture.ts';

export type ComponentNodeRuntimeData = ComponentNodeData & {
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
  // Mirror of HtmlNodeRuntimeData.onFitToContent: when wired (edit mode only),
  // the renderer's "Fit to content" button calls this. The host's handler
  // PATCHes { autoSize: true } through the adapter, which strips width/height
  // server-side per the autoSize invariant.
  onFitToContent?: (nodeId: string) => void;
  /** When wired, double-clicking the header opens an inline name editor. */
  onNameChange?: (nodeId: string, name: string) => void;
  /** When wired (alongside selected + icon), the header icon becomes a picker trigger. */
  onIconChange?: (nodeId: string, name: string | null) => void;
  /**
   * Runtime-only flag (NOT persisted to flow.json): when true, a hover-revealed
   * "View fullscreen" button is shown that opens the component in a large modal.
   * The canvas injects this in buildNode for every `type:'component'` node;
   * other hosts may leave it unset to suppress the affordance.
   */
  enableFullscreen?: boolean;
} & Record<string, unknown>;
export type ComponentNodeType = Node<ComponentNodeRuntimeData, 'component'>;

export const COMPONENT_DEFAULT_SIZE = { width: 320, height: 240 } as const;

// Component text scales with the node's font-size control. The control's
// default position is 22 (NODE_FONT_SIZE_DEFAULT in the StyleStrip); at that
// value — and whenever data.fontSize is unset — each rendered component shows
// 30% larger than its natural Tailwind size. Larger/smaller fontSize scales
// the whole subtree proportionally.
const COMPONENT_FONT_SIZE_BASE = 22;
const COMPONENT_DEFAULT_FONT_SCALE = 1.3;

const MIN_W = 80;
const MIN_H = 40;

const HANDLE_CLASS = 'sf:opacity-0 sf:transition-opacity';

function ComponentNodeImpl({ id, data, selected, isConnectable }: NodeProps<ComponentNodeType>) {
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    onResizeEnd: (dims) => data.onResizeEnd?.(id, dims),
    setResizing: data.setResizing,
    nodeId: id,
    alignment: data.resizeAlignment,
  });
  // US: hover "View fullscreen" opens the same live runtime in a large modal.
  const [zoomOpen, setZoomOpen] = useState(false);
  // autoSize defaults to true so freshly created component nodes shrink-wrap
  // to their rendered spec — mirrors HtmlNodeData.autoSize. `isResizing`
  // temporarily forces user-sized layout so the drag has dimensions to grab
  // against from the first frame, before the autoSize: false write echoes back
  // from disk.
  const autoSize = data.autoSize ?? true;
  const userSized = isResizing || !autoSize;
  // The "Fit to content" affordance only applies to a selected, user-sized
  // node in edit mode (onFitToContent wired). Hoisted so the Zoom button can
  // offset itself when both controls share the top-right corner.
  const showFitButton =
    selected && !autoSize && !isResizing && typeof data.onFitToContent === 'function';

  // Chrome lives on the inner wrapper so its `overflow:hidden` clips body
  // content to the rounded corners without clipping connector handles + resize
  // corners on the outer wrapper (same split as HtmlNode).
  const chromeStyle: CSSProperties = {
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

  // The rendered components style their text with rem-based `sf:text-*`
  // utilities, which resolve `var(--sf-text-*)` and so ignore the chrome's
  // inherited font-size. Override those tokens on the body — scaled by the
  // node's font-size control — so the one control sizes every component's text.
  // rem-based (not em) so nested elements never compound the scale.
  const fontScale =
    Math.round(
      ((data.fontSize ?? COMPONENT_FONT_SIZE_BASE) / COMPONENT_FONT_SIZE_BASE) *
        COMPONENT_DEFAULT_FONT_SCALE *
        1000,
    ) / 1000;
  // CSSProperties dropped its index signature (see @types/react note); cast to
  // attach the CSS custom properties that drive the component text scale.
  const bodyFontStyle = {
    '--sf-component-font-scale': fontScale,
    '--sf-text-xs': 'calc(0.75rem * var(--sf-component-font-scale))',
    '--sf-text-sm': 'calc(0.875rem * var(--sf-component-font-scale))',
    '--sf-text-base': 'calc(1rem * var(--sf-component-font-scale))',
    '--sf-text-lg': 'calc(1.125rem * var(--sf-component-font-scale))',
    '--sf-text-xl': 'calc(1.25rem * var(--sf-component-font-scale))',
    '--sf-text-2xl': 'calc(1.5rem * var(--sf-component-font-scale))',
  } as CSSProperties;

  const outerStyle: CSSProperties = userSized
    ? {
        width: data.width ?? COMPONENT_DEFAULT_SIZE.width,
        height: data.height ?? COMPONENT_DEFAULT_SIZE.height,
      }
    : {};

  const measureRef = useRef<HTMLDivElement | null>(null);
  // Auto-size branch uses an inline-block measuring container so React Flow's
  // wrapper shrink-wraps the rendered spec's natural dimensions (capped at
  // 800×600 to match HtmlNode). User-sized branch fills the outer (which
  // carries explicit width/height) and scrolls inside.
  const body = userSized ? (
    // flex-1 + min-h-0 lets the body fill the chrome height that's left after
    // the header bar (when present) without forcing the body taller than the
    // chrome — keeps overflow-auto scrolling correctly inside flex column.
    <div
      data-testid="component-node-body"
      className="sf:min-h-0 sf:w-full sf:flex-1 sf:overflow-auto"
      style={bodyFontStyle}
    >
      <ComponentRuntime spec={data.spec} />
    </div>
  ) : (
    <div
      ref={measureRef}
      data-testid="component-node-body"
      className="sf:inline-block"
      style={{ ...bodyFontStyle, maxWidth: 800, maxHeight: 600, overflow: 'auto' }}
    >
      <ComponentRuntime spec={data.spec} />
    </div>
  );

  // Inner shrink-wraps to the body's natural size only when we're auto-sizing
  // (body is `inline-block` then). When user-sized, the outer has an explicit
  // size and the inner fills it.
  const innerShrinkWraps = !userSized;

  return (
    <div
      className={cn('sf:group sf:relative', userSized ? 'sf:h-full sf:w-full' : '')}
      style={outerStyle}
      data-testid="component-node"
      data-node-type="component"
    >
      {!userSized ? <AutoSizeObserver nodeId={id} measureRef={measureRef} /> : null}
      <ResizeControls
        visible={!!selected && !!data.onResize}
        cornerVariant="visible"
        minWidth={MIN_W}
        minHeight={MIN_H}
        onResizeStart={onResizeStart}
        onResize={onResizeEvent}
        onResizeEnd={onResizeEnd}
      />
      {showFitButton ? (
        <button
          type="button"
          data-testid="component-node-fit-to-content"
          title="Fit to content"
          aria-label="Fit to content"
          className="sf:absolute sf:top-1 sf:right-1 sf:z-10 sf:flex sf:h-5 sf:w-5 sf:cursor-pointer sf:items-center sf:justify-center sf:rounded sf:bg-background/80 sf:text-muted-foreground sf:opacity-0 sf:transition-opacity sf:hover:text-foreground sf:group-hover:opacity-100 sf:focus:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            data.onFitToContent?.(id);
          }}
        >
          <Maximize2 size={12} aria-hidden />
        </button>
      ) : null}
      {data.enableFullscreen ? (
        <button
          type="button"
          data-testid="component-node-zoom"
          title="View fullscreen"
          aria-label="View fullscreen"
          // Shares the top-right cluster with the Fit button: when both show,
          // Zoom sits to the LEFT of Fit (right:28) so they never overlap; when
          // Fit is hidden, Zoom takes the corner (right:4).
          style={{ right: showFitButton ? 28 : 4 }}
          className="sf:absolute sf:top-1 sf:z-10 sf:flex sf:h-5 sf:w-5 sf:cursor-pointer sf:items-center sf:justify-center sf:rounded sf:bg-background/80 sf:text-muted-foreground sf:opacity-0 sf:transition-opacity sf:hover:text-foreground sf:group-hover:opacity-100 sf:focus:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            setZoomOpen(true);
          }}
        >
          <Expand size={12} aria-hidden />
        </button>
      ) : null}
      <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
        <DialogContent className="sf:flex sf:h-[85vh] sf:max-h-[85vh] sf:w-[90vw] sf:max-w-[90vw] sf:flex-col sf:gap-0 sf:p-0">
          <DialogHeader className="sf:border-border sf:border-b sf:p-3 sf:text-left">
            <DialogTitle>{data.name || 'Component'}</DialogTitle>
          </DialogHeader>
          {/* Live runtime, same wiring as the node body. Mounts its own
              instance, so it starts at the spec's default state. */}
          <div
            data-testid="component-node-zoom-body"
            className="sf:min-h-0 sf:flex-1 sf:overflow-auto sf:p-4"
            style={bodyFontStyle}
          >
            <ComponentRuntime spec={data.spec} />
          </div>
        </DialogContent>
      </Dialog>
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
      <div
        data-testid="component-node-chrome"
        className={cn(
          'sf:overflow-hidden',
          innerShrinkWraps ? 'sf:inline-block' : 'sf:flex sf:h-full sf:w-full sf:flex-col',
        )}
        style={chromeStyle}
      >
        {data.name !== undefined && data.name !== '' ? (
          <NodeHeader
            nodeId={id}
            name={data.name}
            icon={data.icon}
            selected={selected}
            fontSize={data.fontSize}
            fontFamily={data.fontFamily}
            backgroundColor={data.backgroundColor}
            onNameChange={data.onNameChange}
            onIconChange={data.onIconChange}
            testId="component-node-header"
            titleTestId="component-node-title"
          />
        ) : null}
        {body}
      </div>
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

// Auto-size only: observe the measuring container and tell React Flow to
// re-read this node's bounding rect once size changes settle. The xyflow hook
// call lives here (not in ComponentNodeImpl) so the hook-shim renderer in
// tests never has to provide an xyflow StoreContext. Mirrors HtmlNode's
// AutoSizeObserver verbatim.
function AutoSizeObserver({
  nodeId,
  measureRef,
}: {
  nodeId: string;
  measureRef: RefObject<HTMLDivElement | null>;
}): null {
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    const el = measureRef.current;
    if (el === null) return;
    return debouncedResizeObserver(el, 150, () => {
      updateNodeInternals(nodeId);
    });
  }, [nodeId, updateNodeInternals, measureRef]);
  return null;
}

function arePropsEqual(
  prev: NodeProps<ComponentNodeType>,
  next: NodeProps<ComponentNodeType>,
): boolean {
  return (
    prev.selected === next.selected &&
    prev.data === next.data &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

export const ComponentNode = memo(ComponentNodeImpl, arePropsEqual);
