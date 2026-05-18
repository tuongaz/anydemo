import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { type CSSProperties, type ReactNode, memo, useEffect } from 'react';
import { cn } from '../lib/cn.ts';
import { colorTokenStyle } from '../lib/color-tokens.ts';
import { injectSanitizedHtml } from '../lib/inject-sanitized-html.ts';
import { ensureTailwindLoaded } from '../lib/tailwind-runtime.ts';
import { useHtmlContent } from '../lib/use-html-content.ts';
import type { HtmlNodeData } from '../types.ts';
import { Icon } from '../ui/icon.tsx';
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
} & Record<string, unknown>;
export type HtmlNodeType = Node<HtmlNodeRuntimeData, 'htmlNode'>;

export const HTML_DEFAULT_SIZE = { width: 320, height: 200 } as const;

const MIN_W = 80;
const MIN_H = 40;

const HANDLE_CLASS = 'sf-opacity-0 sf-transition-opacity';

function HtmlNodeImpl({ id, data, selected, isConnectable }: NodeProps<HtmlNodeType>) {
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    setResizing: data.setResizing,
  });
  // Once user-resized (or pre-sized via authoring), the React Flow wrapper
  // owns dimensions and the inner fills via h-full w-full. Before any resize,
  // we pin the default size so the wrapper auto-sizes to it. `isResizing` is
  // NOT in this check: see state-node.tsx for the full rationale
  // (precreated-node click-shrink fix).
  const sized = data.width !== undefined || data.height !== undefined;

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
    ...(sized ? {} : { width: HTML_DEFAULT_SIZE.width, height: HTML_DEFAULT_SIZE.height }),
  };

  // US-012: load Tailwind Play CDN at mount so author HTML's utility classes
  // actually paint. Idempotent — only the first htmlNode on the page injects
  // the script; subsequent mounts are no-ops.
  useEffect(() => {
    ensureTailwindLoaded();
  }, []);

  const content = useHtmlContent(data.projectId, data.htmlPath);

  let body: ReactNode;
  if (content.kind === 'loaded') {
    // US-013 / US-014: the trust boundary lives in `injectSanitizedHtml` —
    // every site that mounts untrusted author HTML threads through that
    // helper. The sanitizer drops <script>, <style>, <iframe>, on*=
    // attributes, and javascript: URLs before the HTML is returned.
    body = (
      <div
        data-testid="html-node-content"
        className="sf-h-full sf-w-full sf-overflow-auto"
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

  return (
    <div
      className={cn('sf-group sf-relative sf-overflow-hidden', sized ? 'sf-h-full sf-w-full' : '')}
      style={containerStyle}
      data-testid="html-node"
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
        className={cn(HANDLE_CLASS, selected && '!sf-opacity-100')}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="l"
        isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && '!sf-opacity-100')}
      />
      {body}
      <Handle
        type="source"
        position={Position.Right}
        id="r"
        isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && '!sf-opacity-100')}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="b"
        isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && '!sf-opacity-100')}
      />
      {data.name !== undefined && data.name !== '' ? (
        <div
          data-testid="html-node-label"
          className="-sf-bottom-5 sf-absolute sf-right-0 sf-left-0 sf-truncate sf-text-center sf-text-[11px] sf-text-muted-foreground"
        >
          {data.icon ? (
            <div className="sf-flex sf-items-center sf-justify-center sf-gap-1">
              <Icon name={data.icon} size={12} aria-hidden />
              <span className="truncate">{data.name}</span>
            </div>
          ) : (
            data.name
          )}
        </div>
      ) : null}
    </div>
  );
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
