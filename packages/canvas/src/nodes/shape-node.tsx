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
import type { ShapeKind, ShapeNodeData } from '../types.ts';
import { ResizeControls } from './resize-controls.tsx';
import { ILLUSTRATIVE_SHAPE_RENDERERS } from './shapes/registry.ts';
import { useResizeGesture } from './use-resize-gesture.ts';

// US-009: illustrative shapes own their visuals via inline-SVG components
// under `apps/web/src/components/nodes/shapes/`. The wrapper's Tailwind chrome
// (border / bg / rotation) is suppressed for these shapes — see `SHAPE_CLASS`
// + `shapeChromeStyle` below — so the SVG can draw the whole visual without
// fighting CSS borders.
// US-022: the set is derived from `ILLUSTRATIVE_SHAPE_RENDERERS` so adding a
// new illustrative shape only touches the registry — chrome suppression and
// overlay dispatch stay in lockstep automatically.
const ILLUSTRATIVE_SHAPES: ReadonlySet<ShapeKind> = new Set(
  Object.keys(ILLUSTRATIVE_SHAPE_RENDERERS) as ShapeKind[],
);

function isIllustrativeShape(shape: ShapeKind): boolean {
  return ILLUSTRATIVE_SHAPES.has(shape);
}

export type ShapeNodeRuntimeData = ShapeNodeData & {
  onResize?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  onResizeEnd?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  setResizing?: (on: boolean) => void;
  /** Persist a new name (PATCH /nodes/:id { name }). Optional for shape nodes. */
  onNameChange?: (nodeId: string, name: string) => void;
  /**
   * Persist a new description (PATCH /nodes/:id { description }). When set on
   * rectangle/ellipse shapes, dblclick on the body region enters description
   * edit. Other shape kinds ignore it.
   */
  onDescriptionChange?: (nodeId: string, description: string) => void;
  /**
   * US-015: when true on the first mount, the node enters inline label-edit
   * mode automatically. Used by the drop-on-pane popover so the user can type
   * a label immediately after creating a node via drag-from-handle. The flag
   * is consumed once at mount and never re-read; flipping it later has no
   * effect (the local `isEditing` state is owned by the InlineEdit lifecycle).
   */
  autoEditOnMount?: boolean;
} & Record<string, unknown>;
export type ShapeNodeType = Node<ShapeNodeRuntimeData, 'shapeNode'>;

export const SHAPE_DEFAULT_SIZE: Record<ShapeKind, { width: number; height: number }> = {
  rectangle: { width: 200, height: 120 },
  ellipse: { width: 200, height: 120 },
  sticky: { width: 180, height: 180 },
  text: { width: 160, height: 40 },
  // US-009: cylinder reads best in portrait — the rim disc looks proportional
  // when the body is taller than wide.
  database: { width: 120, height: 140 },
  // US-022: rack reads best in landscape — 3 horizontal bays at a wider aspect
  // ratio so the dividers and status LEDs sit at familiar proportions.
  server: { width: 140, height: 120 },
  // US-023: person glyph reads best in portrait — head sits in the top quarter
  // and the half-pill torso fills the bottom three-quarters.
  user: { width: 100, height: 140 },
  // US-024: queue reads best as a wide horizontal pill — capsule ends + 4
  // cells make it look like "messages in line" at a glance.
  queue: { width: 220, height: 80 },
  // US-025: cloud reads best in landscape — three top bumps + short skirt.
  cloud: { width: 180, height: 120 },
};

// `text` deliberately omits border + background so the shape reads as a free
// floating annotation (no chrome). Selection still draws an outline (handled
// below by the `selected` branch on `colorStyle`).
//
// Exported (along with `shapeChromeClass` / `shapeChromeStyle` below) so the
// drag-create ghost in demo-canvas.tsx (US-009) can mirror the committed
// node's chrome byte-for-byte without duplicating literals. Any visual change
// to a shape's chrome MUST land here so both the node and the ghost update
// together.
export const SHAPE_CLASS: Record<ShapeKind, string> = {
  rectangle: 'sf:rounded-lg sf:border-[3px] sf:bg-transparent',
  ellipse: 'sf:rounded-full sf:border-[3px] sf:bg-transparent',
  sticky: 'sf:rounded-md sf:border-[3px] sf:shadow-md sf:-rotate-2',
  text: 'sf:bg-transparent',
  // US-009: illustrative shapes have no wrapper chrome — the inline SVG owns
  // border + fill so the wrapper stays a transparent positioning host.
  database: '',
  server: '',
  user: '',
  queue: '',
  cloud: '',
};

/**
 * Tailwind class string for a shape's chrome (border-radius, default border
 * width, sticky tilt + shadow). The pair of `shapeChromeClass` +
 * `shapeChromeStyle` is the single source of truth consumed by both
 * `ShapeNode` (live render) and `demo-canvas.tsx`'s drag-create ghost
 * (`canvas-draw-ghost`, US-009) so the preview shown during drag matches the
 * committed node exactly.
 */
export function shapeChromeClass(shape: ShapeKind): string {
  return SHAPE_CLASS[shape];
}

/**
 * Inline style for a shape's chrome (borderColor / backgroundColor /
 * borderWidth / borderStyle / borderRadius). Mirrors the resolution rules in
 * `ShapeNode` so the ghost preview (US-009) and the committed node share the
 * same values; pass an empty `data` to get the default-color look the
 * drag-create flow commits via `onCreateShapeNode` (which sends only
 * `{ shape, width, height }` — no color overrides).
 */
export function shapeChromeStyle(
  shape: ShapeKind,
  data?: Pick<
    ShapeNodeData,
    'backgroundColor' | 'borderColor' | 'borderSize' | 'borderStyle' | 'cornerRadius'
  >,
): CSSProperties {
  if (shape === 'text') return {};
  // US-009: illustrative shapes draw their own border + fill inside the SVG
  // (see `apps/web/src/components/nodes/shapes/`), so the wrapper must stay
  // chrome-free — otherwise CSS borders would overlap the SVG strokes and
  // backgrounds would clip the rim.
  if (isIllustrativeShape(shape)) return {};
  // US-021: rectangle + ellipse fall back to NODE_DEFAULT_BG_WHITE (dark card
  // surface) when the author hasn't set `backgroundColor`. The field stays
  // unset on disk — this is a render-time fallback only. Sticky keeps its
  // pre-existing amber default; text is excluded (chromeless per US-003).
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
  return {
    borderColor: colorTokenStyle(data?.borderColor, 'node').borderColor,
    backgroundColor,
    borderWidth: data?.borderSize !== undefined ? data.borderSize : undefined,
    borderStyle: data?.borderStyle,
    borderRadius:
      supportsCornerRadius && data?.cornerRadius !== undefined ? data.cornerRadius : undefined,
  };
}

// US-009: resolve a shapeNode's ColorToken `borderColor` / `backgroundColor`
// into concrete CSS values for the per-shape SVG. Unset `backgroundColor`
// falls through to NODE_DEFAULT_BG_WHITE (dark card surface), mirroring the
// US-021 fallback already applied to rectangle / ellipse. Inline in
// `ShapeNodeImpl` (vs a nested component) so the test suite's hook-shim
// renderer sees the per-shape SVG element directly in the returned tree.
function resolveIllustrativeColors(data: ShapeNodeData): {
  borderColor: string | undefined;
  backgroundColor: string | undefined;
} {
  return {
    borderColor: colorTokenStyle(data.borderColor, 'node').borderColor,
    backgroundColor:
      data.backgroundColor !== undefined
        ? colorTokenStyle(data.backgroundColor, 'node').backgroundColor
        : NODE_DEFAULT_BG_WHITE,
  };
}

// Handles stay hidden by default and only render on the active (selected) node
// — the `selected && '!sf-opacity-100'` branch in each <Handle>'s className. While
// a connection is in progress, `.react-flow.seeflow-connecting .react-flow__handle`
// (apps/web/src/index.css) globally forces `opacity: 1` so drop targets light
// up across all nodes during the drag, preserving the US-014 auto-snap UX.
const HANDLE_CLASS = 'sf:opacity-0 sf:transition-opacity';

type EditField = 'name' | 'description' | null;

function ShapeNodeImpl({ id, data, selected, isConnectable }: NodeProps<ShapeNodeType>) {
  const shape = data.shape;
  const size = SHAPE_DEFAULT_SIZE[shape];
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    onResizeEnd: (dims) => data.onResizeEnd?.(id, dims),
    setResizing: data.setResizing,
  });
  // US-015: a freshly drop-popover-created node opens directly in label-edit
  // mode so the user can type a label without an extra dblclick. The flag is
  // read ONCE at mount via the lazy initializer; subsequent renders keep the
  // local state regardless of whether the upstream injection clears the flag
  // (e.g. because the parent's pendingEditNodeId moved to a different node).
  //
  // Untitled rectangle starts in description edit (matching the dblclick
  // routing fix below) so a freshly-drawn rect's first keystrokes land in
  // the body field — without this, typing would silently populate the title
  // and the header strip would appear mid-edit.
  const [editing, setEditing] = useState<EditField>(() => {
    if (!data.autoEditOnMount) return null;
    const startsAsDescription =
      data.shape === 'ellipse' ||
      data.shape === 'sticky' ||
      (data.shape === 'rectangle' && (data.name === undefined || data.name === ''));
    return startsAsDescription ? 'description' : 'name';
  });
  const isEditing = editing !== null;
  const nameEditable = !!data.onNameChange;
  const descEditable = !!data.onDescriptionChange;
  // Rectangle supports a two-region layout (header + body) so a title typed
  // in the panel surfaces as a header on the node. Ellipse and sticky
  // deliberately stay out of this layout — the rectangular header chrome reads
  // poorly inside an elliptical clip, and the sticky note metaphor is a single
  // body of text. Both drop the Name concept entirely and render `description`
  // as the centered label. The DetailPanel mirrors this: the Name field is
  // hidden for ellipse and sticky shapes.
  const isHeaderShape = shape === 'rectangle';
  const isDescriptionLabel = shape === 'ellipse' || shape === 'sticky';
  const hasName = data.name !== undefined && data.name !== '';
  const useHeaderLayout = isHeaderShape && hasName;
  // A rectangle with no name is in single-label mode and used to route
  // dblclick to NAME — the user types body content thinking it's the body,
  // hasName flips true mid-typing, useHeaderLayout activates, and the header
  // strip "suddenly appears" with the typed text. Treat the no-title
  // rectangle the same way ellipse/sticky already work: dblclick edits
  // description and the centered label renders description. The user only
  // surfaces a header when they explicitly set Name via the detail panel.
  const renderSingleLabelAsDescription = isDescriptionLabel || (isHeaderShape && !hasName);
  // Once data.width/height are set, the React Flow wrapper owns the
  // dimensions; the inner fills via h-full w-full. Before any resize, we still
  // need an explicit size so the wrapper auto-sizes to it. `isResizing` is NOT
  // in this check: see state-node.tsx for the full rationale (precreated-node
  // click-shrink fix).
  const sized = data.width !== undefined || data.height !== undefined;

  // Text shapes are chromeless: no border, no background. Selection still
  // needs a visible affordance — handled below by the unified outer-rect
  // outline so text and chromed shapes share the exact same selection chrome.
  const isText = shape === 'text';
  // Text color: explicit `textColor` field wins for every shape variant.
  // For text shapes (no border to draw), `borderColor` is the legacy text-color
  // field — kept as a fallback so older demo files still render with their
  // chosen text color. `colorTokenStyle(_, 'text')` returns {} for the default
  // token so unset values fall through to the theme foreground.
  const explicitTextColor = data.textColor;
  const textColorStyle =
    explicitTextColor !== undefined
      ? colorTokenStyle(explicitTextColor, 'text')
      : isText
        ? colorTokenStyle(data.borderColor, 'text')
        : {};
  // US-010: selection outline moved to CSS (`.react-flow__node.selected > div`
  // in index.css) so the inline style is stable across renders — necessary
  // for `React.memo`'s prop-equality on this renderer. Text shapes (no
  // border or background of their own) still get the outline via the same
  // CSS rule, matching the pre-US-010 behaviour where the selection box was
  // the only affordance on text.
  // US-004: cornerRadius only applies to shapes that have a square-ish border
  // we can round — rectangle and sticky. Ellipse keeps its rounded-full (50%)
  // and text has no border to round, so we leave them alone.
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

  // US-012: dblclick anywhere on the node body enters label-edit mode. The
  // wrapper handler bails out for handles + resize controls so connect/resize
  // gestures keep their drag semantics, and is a no-op when already editing or
  // when the node doesn't expose a label-change callback.
  // For rectangle/ellipse with header layout: dblclick on the header routes to
  // name edit, dblclick on the body routes to description edit. Other shapes
  // and the no-header fallback keep the original "anywhere → name edit" path.
  const handleWrapperDoubleClick =
    nameEditable || descEditable
      ? (e: ReactMouseEvent<HTMLDivElement>) => {
          if (isEditing) return;
          const target = e.target as HTMLElement | null;
          if (target?.closest('.react-flow__handle')) return;
          if (target?.closest('.react-flow__resize-control')) return;
          e.stopPropagation();
          if (useHeaderLayout) {
            if (target?.closest('[data-testid="shape-node-header"]')) {
              if (nameEditable) setEditing('name');
              return;
            }
            // Body click OR border click (target is the outer wrapper itself) — always
            // route to description. Without this return, clicking the 3px border would
            // fall through to `setEditing('name')` below, opening the title editor.
            if (descEditable) setEditing('description');
            else if (nameEditable) setEditing('name');
            return;
          }
          // Ellipse + sticky render description as their centered label and
          // have no Name concept; an empty rectangle (single-label mode)
          // joins them so typing into the body doesn't accidentally
          // populate the title and flip the layout into header+body.
          if (renderSingleLabelAsDescription) {
            if (descEditable) setEditing('description');
            else if (nameEditable) setEditing('name');
            return;
          }
          if (nameEditable) setEditing('name');
        }
      : undefined;

  // US-009: illustrative shape overlay. Renders BEFORE the label JSX so the
  // label (positioned via the `relative` class below) stacks above by DOM
  // order — no z-index gymnastics needed. The overlay is `pointer-events-none`
  // so the label, handles, and resize controls keep their hit targets.
  // US-022: dispatch through `ILLUSTRATIVE_SHAPE_RENDERERS` so the registry is
  // the only place that learns about a new illustrative shape — the per-shape
  // SVG still sits directly in the returned tree so the hook-shim test
  // renderer in `shape-node.test.tsx` can find it by element type.
  let illustrativeOverlay: ReactNode = null;
  const Renderer = ILLUSTRATIVE_SHAPE_RENDERERS[shape];
  if (Renderer) {
    const w = data.width ?? size.width;
    const h = data.height ?? size.height;
    const { borderColor, backgroundColor } = resolveIllustrativeColors(data);
    illustrativeOverlay = (
      <div className="sf:pointer-events-none sf:absolute sf:inset-0">
        <Renderer
          width={w}
          height={h}
          borderColor={borderColor}
          backgroundColor={backgroundColor}
          borderSize={data.borderSize}
          borderStyle={data.borderStyle}
        />
      </div>
    );
  }

  const description = data.description ?? '';
  const hasDescription = description !== '';
  const descriptionFontStyle: CSSProperties = {
    ...(data.fontSize !== undefined ? { fontSize: `${data.fontSize}px` } : {}),
    ...textColorStyle,
  };

  // Single-label content variants:
  //   - Ellipse + sticky + untitled rectangle: render `description` as the
  //     centered label. No Name concept on canvas; dblclick enters
  //     description edit directly.
  //   - Other shapes (text/database): keep the `name`-based label so the
  //     auto-edit-on-mount flow types into it.
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
          // US-009: `relative` keeps the label as a positioned sibling of the
          // illustrative overlay above, so DOM order alone is enough to stack
          // it over the SVG without juggling explicit z-index values.
          className="sf:relative sf:text-[22px]"
          style={labelFontStyle}
          placeholder={isText ? 'Text' : 'Label'}
        />
      ) : (
        <button
          type="button"
          className={cn(
            // US-009: `relative` — see the InlineEdit branch above.
            'sf:relative sf:block sf:whitespace-pre-wrap sf:bg-transparent sf:p-0 sf:font-medium sf:leading-tight',
            data.name ? 'break-words' : 'sf:text-muted-foreground/40 sf:italic',
          )}
          style={labelFontStyle}
        >
          {data.name ?? (isText && nameEditable ? 'Text' : '')}
        </button>
      );
  }

  // Header + body layout for rectangle/ellipse with a title set. The header
  // hosts the name (bold, bordered) and the body hosts the description so a
  // title typed in the detail panel surfaces as a header on the canvas, and
  // the body always reflects `description`.
  const headerBodyContent = (
    <>
      <div
        className="sf:relative sf:flex sf:shrink-0 sf:items-center sf:border-b sf:border-border sf:px-3 sf:py-2.5"
        style={colorTokenStyle(data.backgroundColor, 'node-header')}
        data-testid="shape-node-header"
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
        data-testid="shape-node-body"
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
        // `relative` only on layouts that need a positioned inner div for
        // absolute children (illustrative SVG overlay, single-label edit
        // surface). The header layout deliberately stays `position: static`
        // so the outer React Flow wrapper acts as the containing block for
        // the absolutely-positioned handles + NodeResizeControl — otherwise
        // the inner div's `overflow-hidden` (needed for the header bg to
        // respect the rounded corners) clips them, matching the state-node
        // pattern.
        useHeaderLayout ? '' : 'sf:relative',
        useHeaderLayout
          ? 'sf:flex sf:flex-col sf:overflow-hidden sf:text-left'
          : 'sf:flex sf:items-center sf:justify-center sf:p-2 sf:text-center sf:text-[22px]',
        sized ? 'sf:h-full sf:w-full' : '',
        shapeChromeClass(shape),
      )}
      style={style}
      data-testid="shape-node"
      data-node-type="shapeNode"
      data-shape={shape}
      onDoubleClick={handleWrapperDoubleClick}
    >
      {illustrativeOverlay}
      <ResizeControls
        visible={!!selected && !!data.onResize && !isEditing}
        cornerVariant="visible"
        minWidth={80}
        minHeight={40}
        onResizeStart={onResizeStart}
        onResize={onResizeEvent}
        onResizeEnd={onResizeEnd}
      />
      {/* US-003: text shapes are pure annotations — no connect handles. */}
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

// US-010: see play-node.tsx — skip re-renders on xyflow's internal prop ticks.
function arePropsEqual(prev: NodeProps<ShapeNodeType>, next: NodeProps<ShapeNodeType>): boolean {
  return (
    prev.selected === next.selected &&
    prev.data === next.data &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

export const ShapeNode = memo(ShapeNodeImpl, arePropsEqual);
