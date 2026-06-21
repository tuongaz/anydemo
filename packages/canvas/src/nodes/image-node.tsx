import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  memo,
  useEffect,
  useState,
} from 'react';
import { InlineEdit } from '../components/inline-edit.tsx';
import { cn } from '../lib/cn.ts';
import { NODE_DEFAULT_BG_WHITE, colorTokenStyle } from '../lib/color-tokens.ts';
import { fileUrl } from '../lib/file-url.ts';
import type { ImageNodeData } from '../types.ts';
import { ResizeControls } from './resize-controls.tsx';
import { type ResizeAlignmentHooks, useResizeGesture } from './use-resize-gesture.ts';

export type ImageNodeRuntimeData = ImageNodeData & {
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
  /**
   * US-004: project id injected into every node's runtime data by demo-canvas
   * so the renderer can build a project-scoped file URL. Not persisted to disk
   * — `path` is the only on-disk field.
   */
  projectId?: string;
  /**
   * Optional override for the file-serving URL prefix. Threaded down from
   * `<SeeflowCanvas>` so embedders (e.g. the public viewer) can point file
   * fetches at a different host/route shape than the default `/api/projects`.
   * Not persisted to disk.
   */
  fileBaseUrl?: string;
  /**
   * Optional host hook (cloud/authed mode) that turns the computed file URL into
   * a displayable src — e.g. fetching it with an auth token and returning a blob
   * URL. A native `<img>` GET can't carry an `Authorization` header, so in the
   * cloud the token-gated `/api/projects/:id/files/:path` route 401s and the
   * image renders broken; routing through this resolver fixes that. Absent → the
   * URL is used directly (local/same-origin — byte-identical to before).
   * Threaded from `<SeeflowCanvas resolveFileSrc>`. Not persisted to disk.
   */
  resolveFileSrc?: (url: string) => Promise<string>;
  /**
   * US-008: click-to-retry callback dispatched when the user clicks the
   * 'Upload failed' placeholder. Injected by demo-canvas's `sourceNodes`
   * builder. Absent → the placeholder still renders, but clicking is inert.
   */
  onRetryUpload?: (nodeId: string) => void;
  /**
   * Persist a new caption for this image node. Injected by the canvas in edit
   * mode (gated like onDescriptionChange); absent → the caption is read-only
   * and the double-click-to-edit path is suppressed.
   */
  onCaptionChange?: (nodeId: string, value: string) => void;
  /**
   * US-008 (canvas extraction): transient upload-state flags. Mirrors the
   * apps/web `ImageNodeData` extension — set on optimistic placement, cleared
   * once the upload settles. Not persisted to disk.
   */
  _uploading?: boolean;
  _uploadError?: string;
} & Record<string, unknown>;
export type ImageNodeType = Node<ImageNodeRuntimeData, 'image'>;

export const IMAGE_DEFAULT_SIZE = { width: 200, height: 150 } as const;

const MIN_W = 40;
const MIN_H = 40;

const HANDLE_CLASS = 'sf:opacity-0 sf:transition-opacity';

function ImageNodeImpl({ id, data, selected, isConnectable }: NodeProps<ImageNodeType>) {
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    onResizeEnd: (dims) => data.onResizeEnd?.(id, dims),
    setResizing: data.setResizing,
    nodeId: id,
    alignment: data.resizeAlignment,
  });
  // Once user-resized (or pre-sized via authoring), the React Flow wrapper
  // owns dimensions and the inner fills via h-full w-full. Before any resize,
  // we pin a default 200x150 so the wrapper auto-sizes to it. `isResizing` is
  // NOT in this check: see state-node.tsx for the full rationale
  // (precreated-node click-shrink fix).
  const sized = data.width !== undefined || data.height !== undefined;

  // The on-disk `path` resolves to a project-scoped file URL. When the host
  // supplies `resolveFileSrc` (cloud/authed mode), that URL is token-gated and a
  // native <img> can't carry the bearer header — so we hand the URL to the host
  // to fetch (with a token) and swap in the returned blob URL. Without a
  // resolver the URL is used directly (local/same-origin), unchanged from before.
  const directUrl = data.projectId ? fileUrl(data.projectId, data.path, data.fileBaseUrl) : '';
  const resolver = data.resolveFileSrc;
  const [resolvedSrc, setResolvedSrc] = useState<string>(resolver ? '' : directUrl);
  useEffect(() => {
    if (!resolver) {
      setResolvedSrc(directUrl);
      return;
    }
    if (!directUrl) {
      setResolvedSrc('');
      return;
    }
    let active = true;
    resolver(directUrl)
      .then((src) => {
        if (active) setResolvedSrc(src);
      })
      // Resolver failure (e.g. a real fetch error after apiFetch's own 401
      // refresh) falls back to the direct URL so we never hang on the loading
      // tile — it may render broken, which is the correct signal for a true error.
      .catch(() => {
        if (active) setResolvedSrc(directUrl);
      });
    return () => {
      active = false;
    };
  }, [resolver, directUrl]);
  // Resolving = a resolver is wired, we have a URL to resolve, and no src yet.
  const resolving = !!resolver && !!directUrl && !resolvedSrc;

  // Optional caption rendered below the image. Double-clicking the image opens
  // the inline editor (edit mode only — gated on the injected callback, like
  // the rectangle's description). The caption row only takes space when there
  // IS a caption or the user is editing, so existing captionless images render
  // byte-identically to before.
  const [captionEditing, setCaptionEditing] = useState(false);
  const captionEditable = !!data.onCaptionChange;
  const caption = data.caption ?? '';
  const showCaptionRow = captionEditing || caption.length > 0;
  const handleWrapperDoubleClick = captionEditable
    ? (e: ReactMouseEvent<HTMLDivElement>) => {
        if (captionEditing) return;
        const target = e.target as HTMLElement | null;
        if (target?.closest('.react-flow__handle')) return;
        if (target?.closest('.react-flow__resize-control')) return;
        e.stopPropagation();
        setCaptionEditing(true);
      }
    : undefined;

  // US-010: selection outline moved to CSS (see play-node.tsx note).
  // US-014: render the optional image border from `borderColor` / `borderWidth`
  // / `borderStyle`. Each field is independently optional; only the keys whose
  // data value is defined land in the style object so the "chromeless image"
  // default is preserved when nothing is set.
  // US-021: image nodes default to a white fill when `backgroundColor` is
  // unset — so transparent PNGs / partial-alpha screenshots read as a clean
  // framed image on light AND dark canvases. Field stays unset on disk; this
  // is a render-time fallback only. An explicit token wins.
  //
  // Chrome (border / bg / radius / shadow) lives on the INNER wrapper so its
  // `overflow:hidden` clips the image to the rounded corners without also
  // clipping the connector handles + resize corners, which paint outside the
  // node's bounding box on selection (see styles/index.css handle/resize
  // transforms). Sizing stays on the OUTER wrapper so React Flow's positioned
  // children (Handle, NodeResizeControl) measure against the right box.
  const outerStyle: CSSProperties = sized
    ? {}
    : { width: IMAGE_DEFAULT_SIZE.width, height: IMAGE_DEFAULT_SIZE.height };
  const chromeStyle: CSSProperties = {
    backgroundColor:
      data.backgroundColor !== undefined
        ? colorTokenStyle(data.backgroundColor, 'node').backgroundColor
        : NODE_DEFAULT_BG_WHITE,
    ...(data.borderColor !== undefined
      ? { borderColor: colorTokenStyle(data.borderColor, 'node').borderColor }
      : {}),
    ...(data.borderWidth !== undefined ? { borderWidth: data.borderWidth } : {}),
    ...(data.borderStyle !== undefined ? { borderStyle: data.borderStyle } : {}),
    ...(data.cornerRadius !== undefined ? { borderRadius: data.cornerRadius } : {}),
    ...(data.shadow !== undefined ? { boxShadow: `var(--node-shadow-${data.shadow})` } : {}),
  };

  return (
    <div
      className={cn(
        'sf:group sf:relative sf:flex sf:flex-col',
        sized ? 'sf:h-full sf:w-full' : '',
      )}
      style={outerStyle}
      data-testid="image-node"
      data-node-type="image"
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
        data-testid="image-node-chrome"
        className={cn(
          'sf:w-full sf:overflow-hidden',
          // Fill the remaining space above the caption row. When no caption is
          // shown this is the only flex child, so it fills the node exactly as
          // before (h-full equivalent under flex-col).
          showCaptionRow ? 'sf:min-h-0 sf:flex-1' : 'sf:h-full',
        )}
        style={chromeStyle}
      >
        {data._uploading || resolving ? (
          // US-008: optimistic-placement loading state. The <img> is suppressed
          // because the file hasn't been uploaded yet (data.path is empty), so
          // we render a flat 'Loading…' tile sized to the dropped image dims.
          // The same tile covers the brief window while a `resolveFileSrc` host
          // hook fetches the token-gated asset and produces a blob URL.
          <div
            data-testid="image-node-placeholder"
            data-placeholder="loading"
            className="sf:flex sf:h-full sf:w-full sf:select-none sf:items-center sf:justify-center sf:text-xs sf:text-muted-foreground sf:pointer-events-none"
          >
            Loading…
          </div>
        ) : data._uploadError ? (
          // US-008: upload failed — the node stays on the canvas with a click-to-
          // retry affordance. Never auto-deletes; the user explicitly opts to
          // retry (or deletes the node themselves).
          <button
            type="button"
            data-testid="image-node-placeholder"
            data-placeholder="failed"
            onClick={() => data.onRetryUpload?.(id)}
            title={data._uploadError}
            className="sf:flex sf:h-full sf:w-full sf:cursor-pointer sf:select-none sf:items-center sf:justify-center sf:px-2 sf:text-center sf:text-xs sf:text-destructive"
          >
            Upload failed (click to retry)
          </button>
        ) : (
          <img
            src={resolvedSrc}
            alt={data.alt ?? ''}
            // `block` strips the inline-element baseline gap that would otherwise
            // leave a thin strip below the image inside the node container.
            // `pointer-events-none` ensures the React Flow wrapper still receives
            // drag/select gestures rather than the browser's native image drag.
            className="sf:block sf:h-full sf:w-full sf:select-none sf:object-contain sf:pointer-events-none"
            draggable={false}
          />
        )}
      </div>
      {showCaptionRow ? (
        <div
          data-testid="image-node-caption"
          className="sf:w-full sf:shrink-0 sf:px-1 sf:pt-1 sf:text-center"
        >
          {captionEditing && captionEditable ? (
            <InlineEdit
              initialValue={caption}
              field="image-caption"
              commitMode="blur-only"
              onCommit={(v) => data.onCaptionChange?.(id, v)}
              onExit={() => setCaptionEditing(false)}
              className="sf:w-full sf:text-center sf:text-xs sf:text-muted-foreground"
              placeholder="Caption"
            />
          ) : (
            <div className="sf:w-full sf:truncate sf:text-xs sf:text-muted-foreground">
              {caption}
            </div>
          )}
        </div>
      ) : null}
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

// US-010: see play-node.tsx — skip re-renders on xyflow's internal prop ticks.
function arePropsEqual(prev: NodeProps<ImageNodeType>, next: NodeProps<ImageNodeType>): boolean {
  return (
    prev.selected === next.selected &&
    prev.data === next.data &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

export const ImageNode = memo(ImageNodeImpl, arePropsEqual);
