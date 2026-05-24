import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  memo,
  useState,
} from 'react';
import { InlineEdit } from '../components/inline-edit.tsx';
import { cn } from '../lib/cn.ts';
import { NODE_DEFAULT_BG_WHITE, colorTokenStyle } from '../lib/color-tokens.ts';
import type {
  ColorToken,
  GeometricNodeType as GeometricKind,
  GeometricNodeData,
  NodeStatus,
  StatusReport,
} from '../types.ts';
import { PlayButton } from './lib/play-button.tsx';
import { deriveVisualStatus } from './lib/visual-status.ts';
import { ResizeControls } from './resize-controls.tsx';
import { ILLUSTRATIVE_SHAPE_RENDERERS } from './shapes/registry.ts';
import { StatusBadge } from './status-badge.tsx';
import { useResizeGesture } from './use-resize-gesture.ts';

// Illustrative shapes own their visuals via inline-SVG components under
// ./shapes/. The wrapper's Tailwind chrome (border / bg / rotation) is
// suppressed for these so the SVG can draw the whole visual without fighting
// CSS borders.
const ILLUSTRATIVE_SHAPES: ReadonlySet<GeometricKind> = new Set(
  Object.keys(ILLUSTRATIVE_SHAPE_RENDERERS) as GeometricKind[],
);

export function isIllustrativeShape(shape: GeometricKind): boolean {
  return ILLUSTRATIVE_SHAPES.has(shape);
}

/**
 * Height in pixels of the capability-chrome skirt rendered below the
 * illustrative-shape SVG when `data.playAction` or `data.statusReport` is
 * present. The wrapper bounding box stays invariant — the SVG renderer's
 * `height` shrinks by this amount so connectors anchored at the wrapper's
 * bottom edge don't shift when status first arrives.
 */
export const SKIRT_HEIGHT = 32;

export type GeometricNodeRuntimeData = GeometricNodeData & {
  /**
   * Latest run status (from the runs map). Undefined when the node has
   * never been played. Threaded onto every node's data by seeflow-canvas;
   * the type catches up here so the skirt renderer derives the visual
   * status without a cast.
   */
  status?: NodeStatus;
  /** Filled when status === 'error' — surfaces as the PlayButton tooltip. */
  errorMessage?: string;
  /**
   * Latest StatusReport from this node's statusAction script (if any).
   * Presence drives the skirt's StatusBadge for illustrative shapes; the
   * field has always been on RectangleNodeData and was already threaded
   * canvas-wide. Carrying it on the GeometricNode type makes the skirt
   * conditional type-safe.
   */
  statusReport?: StatusReport & { ts: number };
  /** Invoked when the user clicks the inline PlayButton in the skirt. */
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
  /** Persist a new name (PATCH /nodes/:id { name }). */
  onNameChange?: (nodeId: string, name: string) => void;
  /** Persist a new description (PATCH /nodes/:id { description }). */
  onDescriptionChange?: (nodeId: string, description: string) => void;
  /**
   * When true on first mount, enter inline label-edit immediately. Used by the
   * drop-on-pane popover so the user can type a label right after creating
   * a node via drag-from-handle. Consumed once at mount.
   */
  autoEditOnMount?: boolean;
} & Record<string, unknown>;

export type GeometricNodeFlowNode = Node<GeometricNodeRuntimeData, GeometricKind>;

export const SHAPE_DEFAULT_SIZE: Record<GeometricKind, { width: number; height: number }> = {
  rectangle: { width: 200, height: 120 },
  ellipse: { width: 200, height: 120 },
  sticky: { width: 180, height: 180 },
  text: { width: 160, height: 40 },
  database: { width: 120, height: 140 },
  server: { width: 140, height: 120 },
  user: { width: 100, height: 140 },
  queue: { width: 220, height: 80 },
  cloud: { width: 180, height: 120 },
};

// `text` deliberately omits border + background so the shape reads as a free
// floating annotation. Selection still draws an outline via the unified
// outer-rect outline so text and chromed shapes share the exact same
// selection chrome.
//
// Sticky's `sf:shadow-md` baseline lives on `STICKY_BASELINE_SHADOW` so
// `shapeChromeStyle` can swap it for the elevation token when `data.shadow`
// is explicit — keeping the two shadow sources from compounding.
export const SHAPE_CLASS: Record<GeometricKind, string> = {
  rectangle: 'sf:rounded-lg sf:border-[3px] sf:bg-transparent',
  ellipse: 'sf:rounded-full sf:border-[3px] sf:bg-transparent',
  sticky: 'sf:rounded-md sf:border-[3px] sf:-rotate-2',
  text: 'sf:bg-transparent',
  // Illustrative shapes have no wrapper chrome — the inline SVG owns
  // border + fill so the wrapper stays a transparent positioning host.
  database: '',
  server: '',
  user: '',
  queue: '',
  cloud: '',
};

// Tailwind's `sf:shadow-md` resolved value — applied inline so an explicit
// `data.shadow` can override it without class fighting.
const STICKY_BASELINE_SHADOW = '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)';

/**
 * Tailwind class string for a shape's chrome. The pair of `shapeChromeClass` +
 * `shapeChromeStyle` is the single source of truth consumed by both
 * `GeometricNode` (live render) and the drag-create ghost so the preview shown
 * during drag matches the committed node exactly.
 */
export function shapeChromeClass(shape: GeometricKind): string {
  return SHAPE_CLASS[shape];
}

/**
 * Inline style for a shape's chrome. Mirrors the resolution rules in
 * `GeometricNode` so the ghost preview and the committed node share the same
 * values; pass an empty `data` to get the default-color look the drag-create
 * flow commits.
 */
export function shapeChromeStyle(
  shape: GeometricKind,
  data?: Pick<
    GeometricNodeData,
    'backgroundColor' | 'borderColor' | 'borderSize' | 'borderStyle' | 'cornerRadius' | 'shadow'
  >,
): CSSProperties {
  if (shape === 'text') return {};
  if (isIllustrativeShape(shape)) return {};
  const explicitToken = data?.backgroundColor;
  let backgroundColor: string | undefined;
  if (explicitToken !== undefined) {
    backgroundColor = colorTokenStyle(explicitToken, 'node').backgroundColor;
  } else if (shape === 'sticky') {
    backgroundColor = colorTokenStyle('amber', 'node').backgroundColor;
  } else if (shape === 'rectangle' || shape === 'ellipse') {
    backgroundColor = NODE_DEFAULT_BG_WHITE;
  }
  const supportsCornerRadius = shape === 'rectangle' || shape === 'sticky';
  // Shadow resolution: explicit `data.shadow` wins via the elevation token.
  // Sticky carries a baseline shadow when unset (its `sf:shadow-md` class
  // moved off the SHAPE_CLASS map for the same reason); other shapes have
  // no baseline so `undefined` leaves boxShadow off entirely.
  let boxShadow: string | undefined;
  if (data?.shadow !== undefined) {
    boxShadow = `var(--node-shadow-${data.shadow})`;
  } else if (shape === 'sticky') {
    boxShadow = STICKY_BASELINE_SHADOW;
  }
  return {
    borderColor: colorTokenStyle(data?.borderColor, 'node').borderColor,
    backgroundColor,
    borderWidth: data?.borderSize !== undefined ? data.borderSize : undefined,
    borderStyle: data?.borderStyle,
    borderRadius:
      supportsCornerRadius && data?.cornerRadius !== undefined ? data.cornerRadius : undefined,
    ...(boxShadow !== undefined ? { boxShadow } : {}),
  };
}

/**
 * Resolve the border + background colours an illustrative shape (`cloud`,
 * `server`, `database`, `user`, `queue`) paints. Shared by both the committed
 * node render (`GeometricNodeImpl` → `Renderer`) and the drag-create ghost in
 * `seeflow-canvas.tsx` so the two can't drift. Accepts any object exposing
 * `borderColor` / `backgroundColor` — `GeometricNodeData` and a last-used
 * `NodeStylePatch` snapshot both satisfy it.
 */
export function resolveIllustrativeColors(data?: {
  borderColor?: ColorToken;
  backgroundColor?: ColorToken;
}): {
  borderColor: string | undefined;
  backgroundColor: string | undefined;
} {
  return {
    borderColor: colorTokenStyle(data?.borderColor, 'node').borderColor,
    backgroundColor:
      data?.backgroundColor !== undefined
        ? colorTokenStyle(data.backgroundColor, 'node').backgroundColor
        : NODE_DEFAULT_BG_WHITE,
  };
}

const HANDLE_CLASS = 'sf:opacity-0 sf:transition-opacity';

type EditField = 'name' | 'description' | null;

function GeometricNodeImpl({
  id,
  type,
  data,
  selected,
  isConnectable,
}: NodeProps<GeometricNodeFlowNode>) {
  const shape = type as GeometricKind;
  const size = SHAPE_DEFAULT_SIZE[shape];
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    onResizeEnd: (dims) => data.onResizeEnd?.(id, dims),
    setResizing: data.setResizing,
  });
  const [editing, setEditing] = useState<EditField>(() => {
    if (!data.autoEditOnMount) return null;
    const startsAsDescription =
      shape === 'ellipse' ||
      shape === 'sticky' ||
      (shape === 'rectangle' && (data.name === undefined || data.name === ''));
    return startsAsDescription ? 'description' : 'name';
  });
  const isEditing = editing !== null;
  const nameEditable = !!data.onNameChange;
  const descEditable = !!data.onDescriptionChange;
  // Rectangle supports a two-region layout (header + body) so a title typed
  // in the panel surfaces as a header on the node. Ellipse and sticky
  // deliberately stay out of this layout — the rectangular header chrome reads
  // poorly inside an elliptical clip, and the sticky note metaphor is a single
  // body of text.
  const isHeaderShape = shape === 'rectangle';
  const isDescriptionLabel = shape === 'ellipse' || shape === 'sticky';
  const hasName = data.name !== undefined && data.name !== '';
  const useHeaderLayout = isHeaderShape && hasName;
  const renderSingleLabelAsDescription = isDescriptionLabel || (isHeaderShape && !hasName);
  const sized = data.width !== undefined || data.height !== undefined;

  const isText = shape === 'text';
  const explicitTextColor = data.textColor;
  const textColorStyle =
    explicitTextColor !== undefined
      ? colorTokenStyle(explicitTextColor, 'text')
      : isText
        ? colorTokenStyle(data.borderColor, 'text')
        : {};
  const colorStyle: CSSProperties = {
    ...shapeChromeStyle(shape, data),
    ...(data.fontSize !== undefined ? { fontSize: `${data.fontSize}px` } : {}),
  };
  const labelFontStyle: CSSProperties = {
    ...(data.fontSize !== undefined ? { fontSize: `${data.fontSize}px` } : {}),
    ...textColorStyle,
  };
  const style: CSSProperties = sized
    ? colorStyle
    : { ...colorStyle, width: data.width ?? size.width, height: data.height ?? size.height };

  const handleWrapperDoubleClick =
    nameEditable || descEditable
      ? (e: ReactMouseEvent<HTMLDivElement>) => {
          if (isEditing) return;
          const target = e.target as HTMLElement | null;
          if (target?.closest('.react-flow__handle')) return;
          if (target?.closest('.react-flow__resize-control')) return;
          e.stopPropagation();
          if (useHeaderLayout) {
            if (target?.closest('[data-testid="geometric-node-header"]')) {
              if (nameEditable) setEditing('name');
              return;
            }
            if (descEditable) setEditing('description');
            else if (nameEditable) setEditing('name');
            return;
          }
          if (renderSingleLabelAsDescription) {
            if (descEditable) setEditing('description');
            else if (nameEditable) setEditing('name');
            return;
          }
          if (nameEditable) setEditing('name');
        }
      : undefined;

  // Capability-chrome skirt: render the inline PlayButton + StatusBadge row
  // for illustrative shapes whenever the node has a play or status capability.
  // The wrapper's bounding box stays invariant — the SVG renderer's `height`
  // shrinks by SKIRT_HEIGHT so connectors anchored at the wrapper's bottom
  // edge (the Position.Bottom Handle) don't shift when status first arrives.
  // Derivation is pure — no useState slot — per the hook-shim positional rule.
  const hasPlayCapability = !!data.playAction && !!data.onPlay;
  const hasStatusReport = !!data.statusReport;
  const showSkirt = isIllustrativeShape(shape) && (hasPlayCapability || hasStatusReport);
  const skirtOffset = showSkirt ? SKIRT_HEIGHT : 0;
  const visualStatus = deriveVisualStatus(data.status, data.statusReport);
  const buttonLabel =
    visualStatus === 'active'
      ? 'Running…'
      : visualStatus === 'success'
        ? 'Succeeded, run again'
        : visualStatus === 'error'
          ? data.errorMessage
            ? `Failed: ${data.errorMessage}`
            : data.statusReport?.summary
              ? `Failed: ${data.statusReport.summary}`
              : 'Failed, run again'
          : 'Play';

  let illustrativeOverlay: ReactNode = null;
  const Renderer = ILLUSTRATIVE_SHAPE_RENDERERS[shape];
  if (Renderer) {
    const w = data.width ?? size.width;
    const h = data.height ?? size.height;
    const { borderColor, backgroundColor } = resolveIllustrativeColors(data);
    illustrativeOverlay = (
      <div
        className="sf:pointer-events-none sf:absolute sf:left-0 sf:right-0 sf:top-0"
        style={{ bottom: skirtOffset }}
      >
        <Renderer
          width={w}
          height={h - skirtOffset}
          borderColor={borderColor}
          backgroundColor={backgroundColor}
          borderSize={data.borderSize}
          borderStyle={data.borderStyle}
        />
      </div>
    );
  }

  const skirt: ReactNode = showSkirt ? (
    <div
      data-testid="geometric-node-skirt"
      className="sf:absolute sf:bottom-0 sf:left-0 sf:right-0 sf:flex sf:items-center sf:justify-between sf:gap-2 sf:px-2 sf:py-1"
      style={{ height: SKIRT_HEIGHT }}
    >
      {hasStatusReport && data.statusReport ? (
        <StatusBadge
          state={data.statusReport.state}
          summary={data.statusReport.summary}
          data-testid="geometric-node-status-badge"
        />
      ) : (
        <span aria-hidden />
      )}
      {hasPlayCapability ? (
        <PlayButton
          visualStatus={visualStatus}
          disabled={visualStatus === 'active'}
          buttonLabel={buttonLabel}
          isError={visualStatus === 'error'}
          onClick={(e) => {
            e.stopPropagation();
            data.onPlay?.(id);
          }}
        />
      ) : null}
    </div>
  ) : null;

  const description = data.description ?? '';
  const hasDescription = description !== '';
  const descriptionFontStyle: CSSProperties = {
    ...(data.fontSize !== undefined ? { fontSize: `${data.fontSize}px` } : {}),
    ...textColorStyle,
  };

  let singleLabelContent: ReactNode;
  if (renderSingleLabelAsDescription) {
    singleLabelContent =
      editing === 'description' && descEditable ? (
        <InlineEdit
          initialValue={description}
          field="node-description"
          commitMode="blur-only"
          onCommit={(v) => data.onDescriptionChange?.(id, v)}
          onExit={() => setEditing(null)}
          className="sf:relative sf:text-[22px]"
          style={descriptionFontStyle}
          placeholder="Description"
        />
      ) : (
        <button
          type="button"
          className={cn(
            'sf:relative sf:block sf:whitespace-pre-wrap sf:bg-transparent sf:p-0 sf:font-medium sf:leading-tight',
            hasDescription ? 'break-words' : 'sf:italic sf:text-muted-foreground/40',
          )}
          style={descriptionFontStyle}
        >
          {hasDescription ? description : ''}
        </button>
      );
  } else {
    singleLabelContent =
      editing === 'name' && nameEditable ? (
        <InlineEdit
          initialValue={data.name ?? ''}
          field="node-label"
          commitMode="blur-only"
          onCommit={(v) => data.onNameChange?.(id, v)}
          onExit={() => setEditing(null)}
          className="sf:relative sf:text-[22px]"
          style={labelFontStyle}
          placeholder={isText ? 'Text' : 'Label'}
        />
      ) : (
        <button
          type="button"
          className={cn(
            'sf:relative sf:block sf:whitespace-pre-wrap sf:bg-transparent sf:p-0 sf:font-medium sf:leading-tight',
            data.name ? 'break-words' : 'sf:text-muted-foreground/40 sf:italic',
          )}
          style={labelFontStyle}
        >
          {data.name ?? (isText && nameEditable ? 'Text' : '')}
        </button>
      );
  }

  const headerBodyContent = (
    <>
      <div
        className="sf:relative sf:flex sf:shrink-0 sf:items-center sf:border-b sf:border-border sf:px-3 sf:py-2.5"
        style={colorTokenStyle(data.backgroundColor, 'node-header')}
        data-testid="geometric-node-header"
      >
        <div
          className="sf:min-w-0 sf:flex-1 sf:whitespace-pre-wrap sf:wrap-break-word sf:text-left sf:font-semibold sf:text-[18px] sf:leading-tight"
          style={labelFontStyle}
        >
          {editing === 'name' && nameEditable ? (
            <InlineEdit
              initialValue={data.name ?? ''}
              field="node-label"
              commitMode="blur-only"
              onCommit={(v) => data.onNameChange?.(id, v)}
              onExit={() => setEditing(null)}
              className="sf:text-[18px] sf:font-semibold"
              style={labelFontStyle}
              placeholder="Title"
            />
          ) : (
            <button
              type="button"
              className={cn(
                'sf:block sf:w-full sf:whitespace-pre-wrap sf:wrap-break-word sf:bg-transparent sf:p-0 sf:text-left sf:font-semibold sf:text-[18px] sf:leading-tight',
                nameEditable ? 'sf:hover:opacity-80' : '',
              )}
              style={labelFontStyle}
            >
              {data.name}
            </button>
          )}
        </div>
      </div>
      <div
        className="sf:relative sf:flex sf:min-h-0 sf:flex-1 sf:items-center sf:px-3 sf:py-2.5"
        data-testid="geometric-node-body"
      >
        {editing === 'description' && descEditable ? (
          <InlineEdit
            initialValue={description}
            field="node-description"
            commitMode="blur-only"
            onCommit={(v) => data.onDescriptionChange?.(id, v)}
            onExit={() => setEditing(null)}
            className="sf:w-full sf:text-[16px] sf:text-muted-foreground"
            style={descriptionFontStyle}
            placeholder="Description"
          />
        ) : (
          <button
            type="button"
            className={cn(
              'sf:block sf:w-full sf:whitespace-pre-wrap sf:wrap-break-word sf:bg-transparent sf:p-0 sf:text-left sf:text-[16px] sf:leading-tight',
              hasDescription ? 'text-muted-foreground' : 'sf:italic sf:text-muted-foreground/40',
              descEditable ? 'sf:hover:opacity-80' : '',
            )}
            style={descriptionFontStyle}
          >
            {hasDescription ? description : descEditable ? 'Double-click to add description' : ''}
          </button>
        )}
      </div>
    </>
  );

  return (
    <div
      className={cn(
        'group',
        useHeaderLayout ? '' : 'sf:relative',
        useHeaderLayout
          ? 'sf:flex sf:flex-col sf:overflow-hidden sf:text-left'
          : 'sf:flex sf:items-center sf:justify-center sf:p-2 sf:text-center sf:text-[22px]',
        sized ? 'sf:h-full sf:w-full' : '',
        shapeChromeClass(shape),
      )}
      style={style}
      data-testid="geometric-node"
      data-node-type={shape}
      data-shape={shape}
      onDoubleClick={handleWrapperDoubleClick}
    >
      {illustrativeOverlay}
      <ResizeControls
        visible={!!selected && !!data.onResize && !isEditing}
        cornerVariant="visible"
        minWidth={80}
        // When the chrome skirt is active, lift the floor so the 32px skirt
        // can't be squashed into the SVG. Otherwise the default 40px floor.
        minHeight={showSkirt ? SKIRT_HEIGHT + 40 : 40}
        onResizeStart={onResizeStart}
        onResize={onResizeEvent}
        onResizeEnd={onResizeEnd}
      />
      {!isText && (
        <Handle
          type="target"
          position={Position.Top}
          id="t"
          isConnectable={isConnectable}
          className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')}
        />
      )}
      {!isText && (
        <Handle
          type="target"
          position={Position.Left}
          id="l"
          isConnectable={isConnectable}
          className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')}
        />
      )}
      {useHeaderLayout ? headerBodyContent : singleLabelContent}
      {skirt}
      {!isText && (
        <Handle
          type="source"
          position={Position.Right}
          id="r"
          isConnectable={isConnectable}
          className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')}
        />
      )}
      {!isText && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="b"
          isConnectable={isConnectable}
          className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')}
        />
      )}
    </div>
  );
}

function arePropsEqual(
  prev: NodeProps<GeometricNodeFlowNode>,
  next: NodeProps<GeometricNodeFlowNode>,
): boolean {
  return (
    prev.selected === next.selected &&
    prev.type === next.type &&
    prev.data === next.data &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

export const GeometricNode = memo(GeometricNodeImpl, arePropsEqual);
