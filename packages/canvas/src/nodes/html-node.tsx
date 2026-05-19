import { Handle, type Node, type NodeProps, Position, useUpdateNodeInternals } from '@xyflow/react';
import { type CSSProperties, type ReactNode, type RefObject, memo, useEffect, useRef } from 'react';
import { cn } from '../lib/cn.ts';
import { colorTokenStyle } from '../lib/color-tokens.ts';
import { debouncedResizeObserver } from '../lib/debounced-resize-observer.ts';
import { injectSanitizedHtml } from '../lib/inject-sanitized-html.ts';
import { ensureTailwindLoaded } from '../lib/tailwind-runtime.ts';
import { useHtmlContent } from '../lib/use-html-content.ts';
import type { HtmlNodeData } from '../types.ts';
import { LockBadge } from './lock-badge.tsx';
import { PlaceholderCard } from './placeholder-card.tsx';
import { ResizeControls } from './resize-controls.tsx';
import { useResizeGesture } from './use-resize-gesture.ts';

export type HtmlNodeRuntimeData = HtmlNodeData & {
  onResize?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  setResizing?: (on: boolean) => void;
  /**
   * US-014: project id injected into every node's runtime data by demo-canvas
   * so the renderer can build a project-scoped file URL. Mirrors the same
   * field on `ImageNodeRuntimeData` (US-004). Not persisted to disk —
   * `htmlPath` is the only on-disk reference.
   */
  projectId?: string;
  // When wired (edit mode only), the renderer's "Fit to content" button calls
  // this. The host's handler PATCHes { autoSize: true } through the adapter,
  // which strips width/height server-side per the autoSize invariant.
  onFitToContent?: (nodeId: string) => void;
} & Record<string, unknown>;
export type HtmlNodeType = Node<HtmlNodeRuntimeData, 'htmlNode'>;

export const HTML_DEFAULT_SIZE = { width: 320, height: 200 } as const;

const MIN_W = 80;
const MIN_H = 40;

const HANDLE_CLASS = 'sf:opacity-0 sf:transition-opacity';

function HtmlNodeImpl({ id, data, selected, isConnectable }: NodeProps<HtmlNodeType>) {
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    setResizing: data.setResizing,
  });
  // autoSize defaults to true (field absent → auto-size is the default for
  // new htmlNodes per the studio adapter invariant). `isResizing` temporarily
  // forces user-sized layout so the drag has dimensions to grab against from
  // the first frame, before the autoSize: false write echoes back from disk.
  const autoSize = data.autoSize ?? true;
  const userSized = isResizing || !autoSize;

  // US-014: htmlNode defaults to a transparent / borderless wrapper so author
  // HTML can paint edge-to-edge. Only fields the author has SET land in the
  // style object — `colorTokenStyle` is used so theming stays consistent with
  // every other visual node.
  const containerStyle: CSSProperties = {
    ...(data.backgroundColor !== undefined
      ? { backgroundColor: colorTokenStyle(data.backgroundColor, 'node').backgroundColor }
      : {}),
    ...(data.borderColor !== undefined
      ? { borderColor: colorTokenStyle(data.borderColor, 'node').borderColor }
      : {}),
    ...(data.borderSize !== undefined ? { borderWidth: data.borderSize } : {}),
    ...(data.borderStyle !== undefined ? { borderStyle: data.borderStyle } : {}),
    ...(data.cornerRadius !== undefined ? { borderRadius: data.cornerRadius } : {}),
    ...(data.fontSize !== undefined ? { fontSize: `${data.fontSize}px` } : {}),
    ...colorTokenStyle(data.textColor, 'text'),
    ...(userSized ? { width: data.width, height: data.height } : {}),
  };

  // US-012: load Tailwind Play CDN at mount so author HTML's utility classes
  // actually paint. Idempotent — only the first htmlNode on the page injects
  // the script; subsequent mounts are no-ops.
  useEffect(() => {
    ensureTailwindLoaded();
  }, []);

  const measureRef = useRef<HTMLDivElement | null>(null);
  const content = useHtmlContent(data.projectId, data.htmlPath);
  // Observer is mounted only when auto-sizing + content is loaded. Keeping
  // the `useReactFlow()` call inside a sub-component (rather than at the top
  // of HtmlNodeImpl) lets the hook-shim renderer in tests avoid touching
  // xyflow's StoreContext — the sub-component appears as a React element in
  // the tree but is never actually rendered by the shim.
  const observerActive = autoSize && content.kind === 'loaded';

  let body: ReactNode;
  if (content.kind === 'loaded') {
    // US-013 / US-014: the trust boundary lives in `injectSanitizedHtml` —
    // every site that mounts untrusted author HTML threads through that
    // helper. The sanitizer drops <script>, <style>, <iframe>, on*=
    // attributes, and javascript: URLs before the HTML is returned.
    //
    // Auto-size branch uses an inline-block measuring container so React
    // Flow's wrapper shrink-wraps the content's natural dimensions (capped
    // at 800×600). User-sized branch fills the outer (which carries explicit
    // width/height) and scrolls inside.
    body = userSized ? (
      <div
        data-testid="html-node-content"
        className="sf:h-full sf:w-full sf:overflow-auto"
        {...injectSanitizedHtml(content.html)}
      />
    ) : (
      <div
        ref={measureRef}
        data-testid="html-node-content"
        className="sf:inline-block"
        style={{ maxWidth: 800, maxHeight: 600, overflow: 'auto' }}
        {...injectSanitizedHtml(content.html)}
      />
    );
  } else if (content.kind === 'missing') {
    body = <PlaceholderCard message={`Missing: ${data.htmlPath}`} variant="destructive" />;
  } else if (content.kind === 'error') {
    body = <PlaceholderCard message={`Error: ${content.message}`} variant="destructive" />;
  } else {
    body = <PlaceholderCard message="Loading…" />;
  }

  // While auto-size content hasn't loaded yet, the measuring container isn't
  // present, so React Flow has nothing to size to. Fall back to
  // HTML_DEFAULT_SIZE for the placeholder card's bounding box.
  const placeholderFallback =
    !userSized && content.kind !== 'loaded'
      ? { width: HTML_DEFAULT_SIZE.width, height: HTML_DEFAULT_SIZE.height }
      : {};

  const outerStyle: CSSProperties = { ...containerStyle, ...placeholderFallback };

  return (
    <div
      className={cn(
        'sf:group sf:relative sf:overflow-hidden',
        userSized ? 'sf:h-full sf:w-full' : '',
      )}
      style={outerStyle}
      data-testid="html-node"
    >
      {observerActive ? <AutoSizeObserver nodeId={id} measureRef={measureRef} /> : null}
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
        className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="l"
        isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')}
      />
      {body}
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
      {data.name !== undefined && data.name !== '' ? (
        <div
          data-testid="html-node-label"
          className="sf:-bottom-5 sf:absolute sf:right-0 sf:left-0 sf:truncate sf:text-center sf:text-[11px] sf:text-muted-foreground"
        >
          {data.name}
        </div>
      ) : null}
    </div>
  );
}

// Auto-size only: observe the measuring container and tell React Flow to
// re-read this node's bounding rect once size changes settle. The xyflow hook
// call lives here (not in HtmlNodeImpl) so the hook-shim renderer in tests
// never has to provide an xyflow StoreContext.
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

function arePropsEqual(prev: NodeProps<HtmlNodeType>, next: NodeProps<HtmlNodeType>): boolean {
  return (
    prev.selected === next.selected &&
    prev.data === next.data &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

export const HtmlNode = memo(HtmlNodeImpl, arePropsEqual);
