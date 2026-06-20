import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeftRight,
  ArrowRight,
  Check,
  Circle,
  Diamond,
  Layers,
  Minus,
  MoveLeft,
  Squircle,
  Sticker,
  Type,
} from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { cn } from '../lib/cn.ts';
import { COLOR_TOKENS } from '../lib/color-tokens.ts';
import type {
  ColorToken,
  Connector,
  ConnectorDirection,
  ConnectorHeadShape,
  ConnectorPath,
  ConnectorStyle,
  FlowNode,
} from '../types.ts';
import { IconToggleGroup, type IconToggleOption } from '../ui/icon-toggle-group.tsx';
import {
  HeadManyIcon,
  HeadOneIcon,
  HeadOptionalManyIcon,
  LineDashedIcon,
  LineDottedIcon,
  LineSolidIcon,
  PathCurveIcon,
  PathStepIcon,
} from '../ui/line-style-icons.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx';
import { Slider } from '../ui/slider.tsx';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip.tsx';

export interface NodeStylePatch {
  borderColor?: ColorToken;
  backgroundColor?: ColorToken;
  borderSize?: number;
  /** Border thickness for image nodes (0–8; 0 = no border). Shape nodes use `borderSize`. */
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  fontSize?: number;
  /** Horizontal alignment for the node's text content. Defaults to `'center'`
   * at render time when unset. */
  textAlign?: 'left' | 'center' | 'right';
  cornerRadius?: number;
  /** Elevation level 0–5; maps to `var(--node-shadow-N)` at render time. */
  shadow?: number;
  /** type:'icon'-only: stroke color token. Lands at data.color. */
  color?: ColorToken;
  /** type:'icon'-only: glyph stroke width. Lands at data.strokeWidth. */
  strokeWidth?: number;
  /** type:'icon'-only: accessible alt text. Lands at data.alt. */
  alt?: string;
}

export interface ConnectorStylePatch {
  color?: ColorToken;
  style?: ConnectorStyle;
  direction?: ConnectorDirection;
  borderSize?: number;
  path?: ConnectorPath;
  /** Glyph at the target (head) end (per `direction`). */
  headShape?: ConnectorHeadShape;
  /** Glyph at the source (tail) end. Absent ⇒ falls back to `headShape`. */
  tailShape?: ConnectorHeadShape;
  /** US-018: per-connector label font size (mirrors NodeStylePatch.fontSize). */
  fontSize?: number;
}

export interface StyleStripProps {
  /** Currently selected nodes (with optimistic overrides applied). */
  nodes: FlowNode[];
  /** Currently selected connectors (with optimistic overrides applied). */
  connectors: Connector[];
  onStyleNode: (nodeId: string, patch: NodeStylePatch) => void;
  onStyleNodePreview?: (nodeId: string, patch: NodeStylePatch) => void;
  /**
   * US-008: atomic multi-node apply. When present and a multi-node selection is
   * active, the strip routes the user's pick through this single call so the
   * caller can commit the batch as one undo-stack entry. Falls back to a
   * per-node loop over `onStyleNode` when omitted (legacy behaviour).
   */
  onStyleNodes?: (nodeIds: string[], patch: NodeStylePatch) => void;
  /** US-008: atomic multi-node live preview during a slider drag. */
  onStyleNodesPreview?: (nodeIds: string[], patch: NodeStylePatch) => void;
  onStyleConnector: (connId: string, patch: ConnectorStylePatch) => void;
  onStyleConnectorPreview?: (connId: string, patch: ConnectorStylePatch) => void;
  /**
   * US-022: open the icon picker in replace mode against the selected
   * type:'icon' node. Same callback the icon node's double-click handler
   * invokes (US-016). Plumbed from demo-view via demo-canvas. Absent → the
   * Change-icon button hides.
   */
  onRequestIconReplace?: (nodeId: string) => void;
}

// Mirror detail-panel.tsx defaults so slider start positions stay consistent.
const NODE_FONT_SIZE_DEFAULT = 22;
// US-018: connector label baseline (matches editable-edge.tsx's text-[11px]
// fallback when data.fontSize is absent).
const CONNECTOR_FONT_SIZE_DEFAULT = 11;
const DEFAULT_BORDER_SIZE = 3;
const DEFAULT_STROKE_WIDTH = 2;
// US-005: opt-in default for the Corners slider when a node has no
// `cornerRadius` set yet — picked to feel like a soft rounded-rect rather
// than the harsher 0px the schema would imply.
const DEFAULT_CORNER_RADIUS = 8;
// Mid-elevation default the Shadow slider seeds with when a node has no
// `shadow` set — keeps the readout meaningful when the popover first opens.
const DEFAULT_SHADOW = 1;

// Pickable palette: `'none'` + `'white'` + the 16 curated themed tokens.
// `'default'` is intentionally omitted — it's a fallback for unset values,
// not a user-facing choice. `'none'` renders transparent border + fill —
// hidden from the connector-color picker via `<ColorSwatchGrid allowNone={false}>`.
const PALETTE_TOKENS: ColorToken[] = [
  'none',
  'white',
  'slate',
  'gray',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'fuchsia',
  'pink',
];

const BORDER_STYLE_OPTIONS: IconToggleOption<'solid' | 'dashed' | 'dotted'>[] = [
  { value: 'solid', icon: LineSolidIcon, label: 'Solid', testId: 'style-tab-border-style-solid' },
  {
    value: 'dashed',
    icon: LineDashedIcon,
    label: 'Dashed',
    testId: 'style-tab-border-style-dashed',
  },
  {
    value: 'dotted',
    icon: LineDottedIcon,
    label: 'Dotted',
    testId: 'style-tab-border-style-dotted',
  },
];

const CONNECTOR_STYLE_OPTIONS: IconToggleOption<ConnectorStyle>[] = [
  { value: 'solid', icon: LineSolidIcon, label: 'Solid', testId: 'style-tab-edge-style-solid' },
  { value: 'dashed', icon: LineDashedIcon, label: 'Dashed', testId: 'style-tab-edge-style-dashed' },
  { value: 'dotted', icon: LineDottedIcon, label: 'Dotted', testId: 'style-tab-edge-style-dotted' },
];

const PATH_OPTIONS: IconToggleOption<ConnectorPath>[] = [
  { value: 'curve', icon: PathCurveIcon, label: 'Curve', testId: 'style-tab-edge-path-curve' },
  { value: 'step', icon: PathStepIcon, label: 'Zigzag', testId: 'style-tab-edge-path-step' },
];

const HEAD_SHAPE_OPTIONS: IconToggleOption<ConnectorHeadShape>[] = [
  { value: 'arrow', icon: ArrowRight, label: 'Arrow', testId: 'style-tab-head-shape-arrow' },
  { value: 'one', icon: HeadOneIcon, label: 'One', testId: 'style-tab-head-shape-one' },
  { value: 'many', icon: HeadManyIcon, label: 'Many', testId: 'style-tab-head-shape-many' },
  {
    value: 'optional-many',
    icon: HeadOptionalManyIcon,
    label: 'Optional many',
    testId: 'style-tab-head-shape-optional-many',
  },
  { value: 'diamond', icon: Diamond, label: 'Diamond', testId: 'style-tab-head-shape-diamond' },
  { value: 'circle', icon: Circle, label: 'Circle', testId: 'style-tab-head-shape-circle' },
];

type TextAlign = 'left' | 'center' | 'right';

// Default alignment when a node has no explicit `textAlign` set yet. Most
// node labels read better centered (the canvas's text shape, sticky body,
// rectangle single-label layout all sit in a centered flex container), so
// `'center'` is the friendlier seed for the toolbar toggle.
const DEFAULT_TEXT_ALIGN: TextAlign = 'center';

const TEXT_ALIGN_OPTIONS: IconToggleOption<TextAlign>[] = [
  { value: 'left', icon: AlignLeft, label: 'Left', testId: 'style-tab-text-align-left' },
  { value: 'center', icon: AlignCenter, label: 'Center', testId: 'style-tab-text-align-center' },
  { value: 'right', icon: AlignRight, label: 'Right', testId: 'style-tab-text-align-right' },
];

const DIRECTION_OPTIONS: IconToggleOption<ConnectorDirection>[] = [
  { value: 'none', icon: Minus, label: 'None', testId: 'style-tab-direction-none' },
  { value: 'backward', icon: MoveLeft, label: 'Backward', testId: 'style-tab-direction-backward' },
  { value: 'forward', icon: ArrowRight, label: 'Forward', testId: 'style-tab-direction-forward' },
  { value: 'both', icon: ArrowLeftRight, label: 'Both', testId: 'style-tab-direction-both' },
];

export function StyleStrip({
  nodes,
  connectors,
  onStyleNode,
  onStyleNodePreview,
  onStyleNodes,
  onStyleNodesPreview,
  onStyleConnector,
  onStyleConnectorPreview,
  onRequestIconReplace,
}: StyleStripProps) {
  const hasNodes = nodes.length > 0;
  const hasConnectors = connectors.length > 0;
  if (!hasNodes && !hasConnectors) return null;

  const pureNode = hasNodes && !hasConnectors;
  const pureConnector = !hasNodes && hasConnectors;

  // Single-item helpers — for previewing the active state on each strip
  // trigger. Multi-item selections (US-019) collapse to the first item's
  // value; the value is purely cosmetic for the trigger swatch/icon.
  const firstNode = nodes[0];
  const firstConnector = connectors[0];
  // type:'icon' is unboxed (no border/background/cornerRadius/fontSize).
  // Filter it out for the shared border/font/corner controls — the icon-only
  // color picker handled below writes `data.color` via a dedicated apply.
  const visualNodes = nodes.filter(
    (n): n is Exclude<FlowNode, { type: 'icon' }> => n.type !== 'icon',
  );
  const firstVisualNode = visualNodes[0];
  // US-014: when every selected node is type:'icon' the strip collapses to
  // a single icon-color swatch (icons have no border/background/font/corner
  // to control). Mixed selections (icon + other) hide the icon picker and
  // let the shared controls drive the non-icon nodes only.
  const pureIconType = pureNode && nodes.every((n) => n.type === 'icon');
  const firstIconNode = pureIconType
    ? (nodes.find((n) => n.type === 'icon') as Extract<FlowNode, { type: 'icon' }>)
    : undefined;
  // Freehand ink shares the icon strip's collapsed color swatch: both are
  // chromeless "ink" nodes restyled via the stroke-color trigger (data.color).
  // strokeWidth (data.strokeWidth) has no strip control yet — only the color
  // swatch renders. The Change-icon affordance below stays icon-only.
  const pureInkType = pureNode && nodes.every((n) => n.type === 'icon' || n.type === 'freehand');
  const firstInkNode = pureInkType
    ? (nodes.find((n) => n.type === 'icon' || n.type === 'freehand') as Extract<
        FlowNode,
        { type: 'icon' | 'freehand' }
      >)
    : undefined;
  // US-014: dedicated image branch. Image borders use `borderWidth` (0–8),
  // NOT the geometric nodes' open-ended `borderSize`.
  // Multi-image selections fan out across every selected node so the user can
  // restyle a batch of screenshots in one pass.
  const pureImageType = pureNode && nodes.every((n) => n.type === 'image');
  // Text-type simplification only applies to pure-node selections of a single
  // type:'text' node. Mixed selections (text + connector) still need the
  // shared border controls visible, so the guard is gated on `pureNode`.
  const isTextShape = pureNode && firstNode?.type === 'text';

  // Resolve current visual state. The unified "Color" trigger reads the
  // node's dominant visual:
  //  - pure-connector → firstConnector.color
  //  - text shape → firstNode.borderColor (chromeless shapes carry their
  //    label color on borderColor; the unified pick still writes both fields
  //    but the renderer only consumes borderColor on text)
  //  - else (rectangle/sticky/illustrative) → firstNode.backgroundColor (the
  //    body fill — the dominant visual). Mixed selections with a mismatched
  //    borderColor vs backgroundColor (legacy data) read backgroundColor and
  //    the picker overwrites both on click, reconciling on first edit.
  const colorActive: ColorToken =
    (pureConnector
      ? firstConnector?.color
      : isTextShape
        ? firstVisualNode?.data.borderColor
        : firstVisualNode?.data.backgroundColor) ?? 'default';
  const borderStyleActiveNode = (firstVisualNode?.data.borderStyle ?? 'solid') as
    | 'solid'
    | 'dashed'
    | 'dotted';
  const connectorStyleActive: ConnectorStyle = firstConnector?.style ?? 'solid';
  const directionActive = (firstConnector?.direction ?? 'forward') as ConnectorDirection;
  const pathActive = (firstConnector?.path ?? 'curve') as ConnectorPath;
  const headShapeActive = (firstConnector?.headShape ?? 'arrow') as ConnectorHeadShape;
  // Tail (source end) falls back to the head shape when unset — matches the
  // connector-to-edge rendering rule so the toggle reflects what's drawn.
  const tailShapeActive = (firstConnector?.tailShape ??
    firstConnector?.headShape ??
    'arrow') as ConnectorHeadShape;
  // Each end only carries a glyph when `direction` points through it: the head
  // (target) for forward/both, the tail (source) for backward/both.
  const headEndActive = directionActive === 'forward' || directionActive === 'both';
  const tailEndActive = directionActive === 'backward' || directionActive === 'both';

  // Apply helpers — fan out a single user pick to every selected entity.
  // For "shared" properties on mixed selections, both fan-outs run.
  //
  // The unified "Color" picker writes BOTH `borderColor` and `backgroundColor`
  // atomically per undo entry. Multi-node selections route through the batched
  // `onStyleNodes` API so the apply commits as a single undo-stack entry;
  // single-node selections still go through `onStyleNode` (behaviour unchanged
  // for the per-node case, which is already atomic).
  const applyColor = (token: ColorToken) => {
    if (nodes.length > 1 && onStyleNodes) {
      onStyleNodes(
        nodes.map((n) => n.id),
        { borderColor: token, backgroundColor: token },
      );
    } else {
      for (const n of nodes) onStyleNode(n.id, { borderColor: token, backgroundColor: token });
    }
    for (const c of connectors) onStyleConnector(c.id, { color: token });
  };
  const applyBorderStyle = (style: 'solid' | 'dashed' | 'dotted') => {
    for (const n of nodes) onStyleNode(n.id, { borderStyle: style });
    for (const c of connectors) onStyleConnector(c.id, { style });
  };
  const applyBorderSize = (n: number) => {
    for (const node of nodes) onStyleNode(node.id, { borderSize: n });
    for (const c of connectors) onStyleConnector(c.id, { borderSize: n });
  };
  const previewBorderSize = (n: number) => {
    for (const node of nodes) onStyleNodePreview?.(node.id, { borderSize: n });
    for (const c of connectors) onStyleConnectorPreview?.(c.id, { borderSize: n });
  };
  // US-008: prefer the atomic batch API for multi-node selections so the apply
  // commits as a single undo-stack entry. Single-node selections still go
  // through the per-node API (behaviour unchanged).
  const applyFontSize = (n: number) => {
    if (nodes.length > 1 && onStyleNodes) {
      onStyleNodes(
        nodes.map((node) => node.id),
        { fontSize: n },
      );
    } else {
      for (const node of nodes) onStyleNode(node.id, { fontSize: n });
    }
  };
  const previewFontSize = (n: number) => {
    if (nodes.length > 1 && onStyleNodesPreview) {
      onStyleNodesPreview(
        nodes.map((node) => node.id),
        { fontSize: n },
      );
    } else {
      for (const node of nodes) onStyleNodePreview?.(node.id, { fontSize: n });
    }
  };
  // US-008: detect mixed font sizes across the selection so the slider can
  // render an indeterminate placeholder until the user picks a value. Treat
  // unset (undefined) as the default so a node with explicit 22 and one
  // without are considered equal.
  const fontSizeIndeterminate =
    visualNodes.length > 1 &&
    new Set(visualNodes.map((n) => n.data.fontSize ?? NODE_FONT_SIZE_DEFAULT)).size > 1;
  // Text alignment fan-out. Mirrors the unified color apply path so multi-node
  // selections commit through the atomic batch API when available, falling
  // back to the per-node loop otherwise. Active value defaults to
  // DEFAULT_TEXT_ALIGN (center) when unset so the toggle reads "Center" out
  // of the box rather than the browser's left-aligned native default.
  const applyTextAlign = (align: TextAlign) => {
    if (nodes.length > 1 && onStyleNodes) {
      onStyleNodes(
        nodes.map((node) => node.id),
        { textAlign: align },
      );
    } else {
      for (const node of nodes) onStyleNode(node.id, { textAlign: align });
    }
  };
  const textAlignActive: TextAlign = firstVisualNode?.data.textAlign ?? DEFAULT_TEXT_ALIGN;
  // US-018: per-connector label font size. Fan-out + indeterminate handling
  // mirror the node fontSize fan-out above.
  const applyConnectorFontSize = (n: number) => {
    for (const c of connectors) onStyleConnector(c.id, { fontSize: n });
  };
  const previewConnectorFontSize = (n: number) => {
    for (const c of connectors) onStyleConnectorPreview?.(c.id, { fontSize: n });
  };
  const connectorFontSizeIndeterminate =
    connectors.length > 1 &&
    new Set(connectors.map((c) => c.fontSize ?? CONNECTOR_FONT_SIZE_DEFAULT)).size > 1;
  // US-005: corner-radius apply/preview. Mirrors the borderSize fan-out
  // (per-node loop) so multi-select drags update every selected node and
  // the live preview surfaces optimistic overrides during the drag.
  const applyCornerRadius = (n: number) => {
    for (const node of nodes) onStyleNode(node.id, { cornerRadius: n });
  };
  const previewCornerRadius = (n: number) => {
    for (const node of nodes) onStyleNodePreview?.(node.id, { cornerRadius: n });
  };
  const cornerRadiusIndeterminate =
    visualNodes.length > 1 &&
    new Set(visualNodes.map((n) => n.data.cornerRadius ?? DEFAULT_CORNER_RADIUS)).size > 1;
  // Shadow apply/preview mirrors corner-radius fan-out so multi-select drags
  // update every selected node and the live preview surfaces optimistic
  // overrides during the drag.
  const applyShadow = (n: number) => {
    for (const node of nodes) onStyleNode(node.id, { shadow: n });
  };
  const previewShadow = (n: number) => {
    for (const node of nodes) onStyleNodePreview?.(node.id, { shadow: n });
  };
  const shadowIndeterminate =
    visualNodes.length > 1 &&
    new Set(visualNodes.map((n) => n.data.shadow ?? DEFAULT_SHADOW)).size > 1;
  const applyConnectorPath = (path: ConnectorPath) => {
    for (const c of connectors) onStyleConnector(c.id, { path });
  };
  const applyConnectorDirection = (direction: ConnectorDirection) => {
    for (const c of connectors) onStyleConnector(c.id, { direction });
  };
  const applyConnectorHeadShape = (headShape: ConnectorHeadShape) => {
    for (const c of connectors) onStyleConnector(c.id, { headShape });
  };
  const applyConnectorTailShape = (tailShape: ConnectorHeadShape) => {
    for (const c of connectors) onStyleConnector(c.id, { tailShape });
  };
  // US-014: type:'icon' stroke color writes to data.color via the same
  // onStyleNode path the geometric color picker uses — no new update plumbing.
  const applyIconColor = (token: ColorToken) => {
    for (const n of nodes) onStyleNode(n.id, { color: token });
  };
  const iconColorActive: ColorToken = firstInkNode?.data.color ?? 'default';

  // Width slider source value: connector borderSize for pure-connector,
  // node borderSize otherwise (mixed selections fall back to the node's
  // value since "border width" applies to both).
  const widthCurrent = pureConnector
    ? (firstConnector?.borderSize ?? DEFAULT_STROKE_WIDTH)
    : (firstVisualNode?.data.borderSize ?? DEFAULT_BORDER_SIZE);
  const widthDefault = pureConnector ? DEFAULT_STROKE_WIDTH : DEFAULT_BORDER_SIZE;

  const colorTriggerKind: SwatchPreviewKind = pureConnector ? 'edge' : 'border';
  const colorTooltip = pureConnector ? 'Connector color' : 'Color';
  const colorAriaLabel = pureConnector ? 'connector color' : 'color';
  const colorInnerTestId = 'style-tab-color-trigger';
  const colorTokenPrefix = 'style-tab-color';

  if (pureInkType) {
    // US-022: Change-icon button reuses the same callback the icon node's
    // double-click handler invokes (US-016) — `firstIconNode.id` is the
    // representative target; for a multi-icon-node selection the button is
    // hidden because "change icon" is ambiguous across the set. Freehand ink
    // shares the color swatch but NOT the Change-icon button (gated on
    // firstIconNode, which is undefined for a pure-freehand selection).
    const showChangeIcon = !!onRequestIconReplace && nodes.length === 1 && !!firstIconNode;
    const onChangeIconClick = () => {
      if (firstIconNode && onRequestIconReplace) onRequestIconReplace(firstIconNode.id);
    };
    return (
      <TooltipProvider delayDuration={300}>
        <div
          data-testid="canvas-style-strip"
          className="sf:pointer-events-auto sf:flex sf:flex-col sf:items-center sf:gap-1 sf:rounded-lg sf:border sf:border-border sf:bg-background/95 sf:p-1 sf:shadow-md sf:backdrop-blur"
        >
          <SwatchButton
            testId="style-strip-icon-color"
            tooltip="Icon color"
            ariaLabel="icon color"
            activeToken={iconColorActive}
            previewKind="edge"
            tokenTestIdPrefix="style-tab-icon-color"
            innerTestId="style-tab-icon-color-trigger"
            allowNone={false}
            onSelect={applyIconColor}
          />
          {showChangeIcon ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-testid="style-strip-change-icon"
                  aria-label="change icon"
                  title="Change icon"
                  onClick={onChangeIconClick}
                  className={cn(
                    'sf:inline-flex sf:h-8 sf:w-8 sf:items-center sf:justify-center sf:rounded-md sf:text-muted-foreground sf:transition-colors sf:hover:bg-accent sf:hover:text-accent-foreground',
                    'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring sf:focus-visible:ring-offset-1',
                  )}
                >
                  <Sticker className="sf:h-4 sf:w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="sf:px-2 sf:py-1 sf:text-xs">
                Change icon
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </TooltipProvider>
    );
  }

  if (pureImageType) {
    // US-014: image border editor. The Colors popover owns border-color +
    // corners + shadow (parallel to the geometric branch's merge); border
    // style and width keep their own popovers because they describe line
    // shape, not depth/color. Edits dispatch via onStyleNode (per-node
    // fan-out for multi-image selections), reusing the existing PATCH+undo
    // path. Image nodes have no fill section — the image itself IS the fill.
    const firstImage = nodes[0] as Extract<FlowNode, { type: 'image' }> | undefined;
    const imageBorderColor: ColorToken = firstImage?.data.borderColor ?? 'default';
    const imageBorderStyle = (firstImage?.data.borderStyle ?? 'solid') as
      | 'solid'
      | 'dashed'
      | 'dotted';
    const imageBorderWidth = firstImage?.data.borderWidth ?? 1;
    const applyImageBorderColor = (token: ColorToken) => {
      for (const n of nodes) onStyleNode(n.id, { borderColor: token });
    };
    const applyImageBorderStyle = (style: 'solid' | 'dashed' | 'dotted') => {
      for (const n of nodes) onStyleNode(n.id, { borderStyle: style });
    };
    const applyImageBorderWidth = (n: number) => {
      for (const node of nodes) onStyleNode(node.id, { borderWidth: n });
    };
    const previewImageBorderWidth = (n: number) => {
      for (const node of nodes) onStyleNodePreview?.(node.id, { borderWidth: n });
    };
    const applyImageCornerRadius = (n: number) => {
      for (const node of nodes) onStyleNode(node.id, { cornerRadius: n });
    };
    const previewImageCornerRadius = (n: number) => {
      for (const node of nodes) onStyleNodePreview?.(node.id, { cornerRadius: n });
    };
    const applyImageShadow = (n: number) => {
      for (const node of nodes) onStyleNode(node.id, { shadow: n });
    };
    const previewImageShadow = (n: number) => {
      for (const node of nodes) onStyleNodePreview?.(node.id, { shadow: n });
    };
    const renderImageBorderColorTrigger = () => {
      const isNone = imageBorderColor === 'none';
      return (
        <span
          className={cn('sf:relative sf:h-5 sf:w-5 sf:rounded-full', isNone && 'sf:bg-card')}
          style={!isNone ? swatchFillStyle(imageBorderColor) : undefined}
        >
          {isNone ? <NoColorSlash /> : null}
        </span>
      );
    };
    return (
      <TooltipProvider delayDuration={300}>
        <div
          data-testid="canvas-style-strip"
          className="sf:pointer-events-auto sf:flex sf:flex-col sf:items-center sf:gap-1 sf:rounded-lg sf:border sf:border-border sf:bg-background/95 sf:p-1 sf:shadow-md sf:backdrop-blur"
        >
          <PopoverButton
            testId="style-strip-image-border-color-button"
            tooltip="Border color"
            ariaLabel="image border color"
            renderIcon={renderImageBorderColorTrigger}
          >
            <ColorSwatchGrid
              testId="style-strip-image-border-color"
              activeToken={imageBorderColor}
              previewKind="border"
              tokenTestIdPrefix="style-tab-image-border-color"
              innerTestId="style-tab-image-border-color-trigger"
              ariaLabel="image border color"
              onSelect={applyImageBorderColor}
            />
          </PopoverButton>
          <PopoverButton
            testId="style-strip-image-corner-radius-button"
            tooltip="Corners"
            ariaLabel="image corners"
            renderIcon={() => <Squircle className="sf:h-4 sf:w-4" />}
          >
            <div data-testid="style-strip-image-corner-radius">
              <SliderControl
                value={firstImage?.data.cornerRadius}
                defaultValue={DEFAULT_CORNER_RADIUS}
                min={0}
                max={32}
                suffix="px"
                onPreview={previewImageCornerRadius}
                onCommit={applyImageCornerRadius}
                testId="style-tab-image-corner-radius-slider"
              />
            </div>
          </PopoverButton>
          <PopoverButton
            testId="style-strip-image-shadow-button"
            tooltip="Shadow"
            ariaLabel="image shadow"
            renderIcon={() => <Layers className="sf:h-4 sf:w-4" />}
          >
            <div data-testid="style-strip-image-shadow">
              <SliderControl
                value={firstImage?.data.shadow}
                defaultValue={DEFAULT_SHADOW}
                min={0}
                max={5}
                onPreview={previewImageShadow}
                onCommit={applyImageShadow}
                testId="style-tab-image-shadow-slider"
              />
            </div>
          </PopoverButton>
          <PopoverButton
            testId="style-strip-image-border-style"
            tooltip="Border style"
            ariaLabel="image border style"
            renderIcon={() => {
              const Icon =
                BORDER_STYLE_OPTIONS.find((o) => o.value === imageBorderStyle)?.icon ??
                LineSolidIcon;
              return <Icon className="sf:h-4 sf:w-4" />;
            }}
          >
            <IconToggleGroup<'solid' | 'dashed' | 'dotted'>
              ariaLabel="Border style"
              value={imageBorderStyle}
              onChange={applyImageBorderStyle}
              options={BORDER_STYLE_OPTIONS}
            />
          </PopoverButton>
          <PopoverButton
            testId="style-strip-image-border-width"
            tooltip="Border width"
            ariaLabel="image border width"
            renderIcon={() => (
              <span className="sf:font-mono sf:text-[10px] sf:tabular-nums">
                {imageBorderWidth}
              </span>
            )}
          >
            <SliderControl
              value={firstImage?.data.borderWidth}
              defaultValue={1}
              min={0}
              max={8}
              suffix="px"
              onPreview={previewImageBorderWidth}
              onCommit={applyImageBorderWidth}
              testId="style-tab-image-border-width-slider"
            />
          </PopoverButton>
        </div>
      </TooltipProvider>
    );
  }

  // Per-control popover triggers. Each styling control gets its own icon
  // button so users can land on it in one click:
  //   • Color:        unified swatch grid — writes both borderColor and
  //                   backgroundColor atomically per undo entry; also serves
  //                   connector color when only connectors are selected.
  //   • Corners:      slider; only when `hasNodes`.
  //   • Shadow:       slider; only when `hasNodes`.
  //   • Border:       line style + width (hidden for text shapes — chromeless).
  //   • Text:         font size + alignment (text color collapsed into the
  //                   unified Color picker; connectors keep just size).
  const showBorderSection = !isTextShape;
  // Single-swatch trigger for the unified Color popover button. Reads
  // `colorActive` (the dominant visual — body fill for chromed nodes,
  // connector/border color for connectors / text shapes). `'none'` renders
  // the diagonal-slash affordance.
  const renderColorTrigger = () => {
    const isNone = colorActive === 'none';
    return (
      <span
        className={cn('sf:relative sf:h-5 sf:w-5 sf:rounded-full', isNone && 'sf:bg-card')}
        style={!isNone ? swatchFillStyle(colorActive) : undefined}
      >
        {isNone ? <NoColorSlash /> : null}
      </span>
    );
  };

  // For text shapes there's no chrome to color or border-ify, so the
  // border-color / fill / corners / shadow / border buttons are hidden.
  return (
    <TooltipProvider delayDuration={300}>
      <div
        data-testid="canvas-style-strip"
        className="sf:pointer-events-auto sf:flex sf:flex-col sf:items-center sf:gap-1 sf:rounded-lg sf:border sf:border-border sf:bg-background/95 sf:p-1 sf:shadow-md sf:backdrop-blur"
      >
        <PopoverButton
          testId="style-strip-color-button"
          tooltip={colorTooltip}
          ariaLabel={colorAriaLabel}
          renderIcon={renderColorTrigger}
        >
          <ColorSwatchGrid
            testId="style-strip-color"
            activeToken={colorActive}
            previewKind={colorTriggerKind}
            tokenTestIdPrefix={colorTokenPrefix}
            innerTestId={colorInnerTestId}
            ariaLabel={colorAriaLabel}
            allowNone={!pureConnector}
            onSelect={applyColor}
          />
        </PopoverButton>

        {hasNodes ? (
          <PopoverButton
            testId="style-strip-corner-radius-button"
            tooltip="Corners"
            ariaLabel="corners"
            renderIcon={() => <Squircle className="sf:h-4 sf:w-4" />}
          >
            <div data-testid="style-strip-corner-radius">
              <SliderControl
                value={firstVisualNode?.data.cornerRadius}
                defaultValue={DEFAULT_CORNER_RADIUS}
                min={0}
                max={32}
                suffix="px"
                indeterminate={cornerRadiusIndeterminate}
                onPreview={previewCornerRadius}
                onCommit={applyCornerRadius}
                testId="style-tab-corner-radius-slider"
              />
            </div>
          </PopoverButton>
        ) : null}

        {hasNodes ? (
          <PopoverButton
            testId="style-strip-shadow-button"
            tooltip="Shadow"
            ariaLabel="shadow"
            renderIcon={() => <Layers className="sf:h-4 sf:w-4" />}
          >
            <div data-testid="style-strip-shadow">
              <SliderControl
                value={firstVisualNode?.data.shadow}
                defaultValue={DEFAULT_SHADOW}
                min={0}
                max={5}
                indeterminate={shadowIndeterminate}
                onPreview={previewShadow}
                onCommit={applyShadow}
                testId="style-tab-shadow-slider"
              />
            </div>
          </PopoverButton>
        ) : null}

        {showBorderSection ? (
          <PopoverButton
            testId="style-strip-border"
            tooltip={pureConnector ? 'Connector' : 'Border'}
            ariaLabel={pureConnector ? 'connector' : 'border'}
            renderIcon={() => {
              const Icon =
                (pureConnector
                  ? CONNECTOR_STYLE_OPTIONS.find((o) => o.value === connectorStyleActive)?.icon
                  : BORDER_STYLE_OPTIONS.find((o) => o.value === borderStyleActiveNode)?.icon) ??
                LineSolidIcon;
              return <Icon className="sf:h-4 sf:w-4" />;
            }}
          >
            <div className="sf:flex sf:w-56 sf:flex-col sf:gap-3">
              <PopoverSection label="Style" testId="style-strip-border-style">
                {pureConnector ? (
                  <IconToggleGroup<ConnectorStyle>
                    ariaLabel="Connector style"
                    value={connectorStyleActive}
                    onChange={(s) => applyBorderStyle(s)}
                    options={CONNECTOR_STYLE_OPTIONS}
                  />
                ) : (
                  <IconToggleGroup<'solid' | 'dashed' | 'dotted'>
                    ariaLabel="Border style"
                    value={borderStyleActiveNode}
                    onChange={(s) => applyBorderStyle(s)}
                    options={BORDER_STYLE_OPTIONS}
                  />
                )}
              </PopoverSection>
              <PopoverSection label="Width" testId="style-strip-border-size">
                <SliderControl
                  value={widthCurrent}
                  defaultValue={widthDefault}
                  min={0}
                  max={8}
                  suffix="px"
                  onPreview={previewBorderSize}
                  onCommit={applyBorderSize}
                  testId={
                    pureConnector ? 'style-tab-stroke-width-slider' : 'style-tab-border-size-slider'
                  }
                />
              </PopoverSection>
              {pureConnector ? (
                <PopoverSection label="Path" testId="style-strip-path">
                  <IconToggleGroup<ConnectorPath>
                    ariaLabel="Connector path"
                    value={pathActive}
                    onChange={applyConnectorPath}
                    options={PATH_OPTIONS}
                  />
                </PopoverSection>
              ) : null}
              {pureConnector ? (
                <PopoverSection label="Direction" testId="style-strip-direction-section">
                  <IconToggleGroup<ConnectorDirection>
                    ariaLabel="Connector direction"
                    value={directionActive}
                    onChange={applyConnectorDirection}
                    options={DIRECTION_OPTIONS}
                  />
                </PopoverSection>
              ) : null}
              {pureConnector ? (
                // Head shape styles the TARGET end — only carried when the
                // direction points at it (forward/both).
                <PopoverSection label="Head shape" testId="style-strip-head-shape">
                  <div
                    className={cn(!headEndActive && 'sf:pointer-events-none sf:opacity-40')}
                    aria-disabled={!headEndActive}
                  >
                    <IconToggleGroup<ConnectorHeadShape>
                      ariaLabel="Connector head shape"
                      value={headShapeActive}
                      onChange={applyConnectorHeadShape}
                      options={HEAD_SHAPE_OPTIONS}
                    />
                  </div>
                  {!headEndActive ? (
                    <p className="sf:mt-2 sf:text-[11px] sf:text-muted-foreground">
                      Point the direction forward to show a head.
                    </p>
                  ) : null}
                </PopoverSection>
              ) : null}
              {pureConnector ? (
                // Tail shape styles the SOURCE end — only carried when the
                // direction points back at it (backward/both).
                <PopoverSection label="Tail shape" testId="style-strip-tail-shape">
                  <div
                    className={cn(!tailEndActive && 'sf:pointer-events-none sf:opacity-40')}
                    aria-disabled={!tailEndActive}
                  >
                    <IconToggleGroup<ConnectorHeadShape>
                      ariaLabel="Connector tail shape"
                      value={tailShapeActive}
                      onChange={applyConnectorTailShape}
                      options={HEAD_SHAPE_OPTIONS}
                    />
                  </div>
                  {!tailEndActive ? (
                    <p className="sf:mt-2 sf:text-[11px] sf:text-muted-foreground">
                      Point the direction backward (or both) to show a tail.
                    </p>
                  ) : null}
                </PopoverSection>
              ) : null}
            </div>
          </PopoverButton>
        ) : null}

        {hasNodes || pureConnector ? (
          <PopoverButton
            testId="style-strip-text"
            tooltip="Text"
            ariaLabel="text"
            renderIcon={() => <Type className="sf:h-4 sf:w-4" />}
          >
            <div className="sf:flex sf:w-56 sf:flex-col sf:gap-3">
              <PopoverSection
                label="Size"
                testId={pureConnector ? 'style-strip-connector-font-size' : 'style-strip-font-size'}
              >
                <SliderControl
                  value={pureConnector ? firstConnector?.fontSize : firstVisualNode?.data.fontSize}
                  defaultValue={
                    pureConnector ? CONNECTOR_FONT_SIZE_DEFAULT : NODE_FONT_SIZE_DEFAULT
                  }
                  min={pureConnector ? 8 : 10}
                  max={32}
                  suffix="px"
                  indeterminate={
                    pureConnector ? connectorFontSizeIndeterminate : fontSizeIndeterminate
                  }
                  onPreview={pureConnector ? previewConnectorFontSize : previewFontSize}
                  onCommit={pureConnector ? applyConnectorFontSize : applyFontSize}
                  testId={
                    pureConnector
                      ? 'style-tab-connector-font-size-slider'
                      : 'style-tab-font-size-slider'
                  }
                />
              </PopoverSection>
              {hasNodes ? (
                <PopoverSection label="Align" testId="style-strip-text-align">
                  <IconToggleGroup<TextAlign>
                    ariaLabel="Text alignment"
                    value={textAlignActive}
                    onChange={applyTextAlign}
                    options={TEXT_ALIGN_OPTIONS}
                  />
                </PopoverSection>
              ) : null}
            </div>
          </PopoverButton>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

// Retained for back-compat with existing call sites that still thread a
// preview kind through. With the unified swatch design every kind renders
// the same saturated tint (palette.edge), so the value is effectively
// cosmetic — kept on the SwatchButton/ColorSwatchGrid prop surfaces so any
// host instrumentation that inspected it keeps working.
type SwatchPreviewKind = 'border' | 'background' | 'edge';

// Single source of truth for swatch fill across triggers and grid cells.
// Tokens render as a flat saturated tint (palette.edge). `'default'` is no
// longer pickable, but a node whose stored value is still `'default'` shows
// the neutral card color (matches the rendered "theme default" surface,
// avoids the half/half visual that confused users). `'none'` is rendered
// separately by SwatchCell (transparent body + diagonal slash). `'white'`
// is also rendered separately by SwatchCell (needs a 1px ring to stay
// visible against the popover background).
function swatchFillStyle(token: ColorToken): CSSProperties {
  if (token === 'default') return { backgroundColor: 'hsl(var(--card))' };
  return { backgroundColor: COLOR_TOKENS[token].edge };
}

// Diagonal-slash overlay used for the `'none'` swatch (Figma-style "no fill"
// affordance). Exported as a render helper so both the popover swatch and
// the SwatchButton trigger share the same look.
function NoColorSlash() {
  return (
    <span
      aria-hidden="true"
      className="sf:pointer-events-none sf:absolute sf:inset-0 sf:rounded-full"
      style={{
        backgroundImage:
          'linear-gradient(45deg, transparent 45%, hsl(0, 75%, 55%) 45%, hsl(0, 75%, 55%) 55%, transparent 55%)',
      }}
    />
  );
}

// One swatch cell. Renders three visual variants based on token:
//   - 'none'     → empty circle + diagonal slash + 1px border (visibility)
//   - 'default'  → half-and-half split (theme primary / theme card)
//   - others     → flat saturated tint (palette.edge)
// Active state surfaces as a focus-style ring; the check glyph is hidden on
// the 'none' variant (the slash would obscure it — the ring conveys state).
function SwatchCell({
  token,
  isActive,
  onClick,
  testId,
  ariaLabel,
}: {
  token: ColorToken;
  isActive: boolean;
  onClick: () => void;
  testId: string;
  ariaLabel: string;
}) {
  const isNone = token === 'none';
  const isWhite = token === 'white';
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      data-active={isActive}
      aria-label={ariaLabel}
      aria-pressed={isActive}
      title={token}
      className={cn(
        'sf:relative sf:flex sf:h-5 sf:w-5 sf:items-center sf:justify-center sf:rounded-full sf:transition-all',
        isNone && 'sf:border sf:border-border sf:bg-card',
        // White needs a 1px border to read against the popover background;
        // without it the swatch would look like an empty slot.
        isWhite && 'sf:border sf:border-border',
        isActive
          ? 'sf:ring-2 sf:ring-ring sf:ring-offset-1 sf:ring-offset-popover'
          : 'sf:hover:scale-110',
      )}
      style={!isNone ? swatchFillStyle(token) : undefined}
    >
      {isNone ? <NoColorSlash /> : null}
      {isActive && !isNone ? (
        <Check
          className="sf:h-2.5 sf:w-2.5 sf:drop-shadow-sm"
          style={{ color: isWhite ? 'hsl(0, 0%, 30%)' : 'hsl(var(--foreground))' }}
        />
      ) : null}
    </button>
  );
}

// One strip button that opens a swatch palette in a popover. Mirrors the
// SwatchPicker in detail-panel.tsx but with the strip-friendly h-8 w-8 chrome
// and a right-side tooltip / popover anchor (the strip is a left-edge column).
function SwatchButton({
  testId,
  tooltip,
  ariaLabel,
  activeToken,
  // `previewKind` is retained for back-compat with call sites that still
  // pass it; the unified swatch design makes it cosmetic. See SwatchPreviewKind.
  previewKind: _previewKind,
  tokenTestIdPrefix,
  innerTestId,
  allowNone,
  onSelect,
}: {
  testId: string;
  tooltip: string;
  ariaLabel: string;
  activeToken: ColorToken;
  previewKind: SwatchPreviewKind;
  tokenTestIdPrefix: string;
  innerTestId: string;
  /** Hide the `'none'` swatch — used by text/edge pickers where invisible has no use. */
  allowNone?: boolean;
  onSelect: (token: ColorToken) => void;
}) {
  const [open, setOpen] = useState(false);
  const isNone = activeToken === 'none';
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid={testId}
              data-active-token={activeToken}
              aria-label={`${ariaLabel}: ${activeToken}`}
              title={tooltip}
              className={cn(
                'sf:group sf:relative sf:inline-flex sf:h-8 sf:w-8 sf:items-center sf:justify-center sf:rounded-md sf:text-muted-foreground sf:transition-colors sf:hover:bg-accent sf:hover:text-accent-foreground',
                'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring sf:focus-visible:ring-offset-1',
              )}
            >
              {/*
                Inner test id mirrors the previous panel's swatch trigger so
                older Playwright snapshots that target it still resolve.
              */}
              <span
                data-testid={innerTestId}
                className={cn('sf:relative sf:h-5 sf:w-5 sf:rounded-full', isNone && 'sf:bg-card')}
                style={!isNone ? swatchFillStyle(activeToken) : undefined}
              >
                {isNone ? <NoColorSlash /> : null}
              </span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right" className="sf:px-2 sf:py-1 sf:text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="right"
        align="start"
        className="sf:w-auto sf:p-1.5"
        data-testid={`${innerTestId}-popover`}
      >
        <ColorSwatchGrid
          testId={`${tokenTestIdPrefix}-grid`}
          activeToken={activeToken}
          previewKind={_previewKind}
          tokenTestIdPrefix={tokenTestIdPrefix}
          innerTestId={innerTestId}
          ariaLabel={ariaLabel}
          allowNone={allowNone}
          onSelect={(t) => {
            onSelect(t);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

// Color swatch grid — used inside SwatchButton's popover and the consolidated
// Colors / Text popovers. 6-col × 3-row layout for the 18-slot palette;
// `allowNone={false}` hides the `'none'` slot for text- and edge-color rows.
function ColorSwatchGrid({
  testId,
  activeToken,
  // Retained for back-compat; see SwatchPreviewKind.
  previewKind: _previewKind,
  tokenTestIdPrefix,
  innerTestId,
  ariaLabel,
  allowNone,
  onSelect,
}: {
  testId: string;
  activeToken: ColorToken;
  previewKind: SwatchPreviewKind;
  tokenTestIdPrefix: string;
  innerTestId: string;
  ariaLabel: string;
  allowNone?: boolean;
  onSelect: (token: ColorToken) => void;
}) {
  const tokens = allowNone === false ? PALETTE_TOKENS.filter((t) => t !== 'none') : PALETTE_TOKENS;
  return (
    <div
      data-testid={testId}
      data-active-token={activeToken}
      data-inner-testid={innerTestId}
      className="sf:grid sf:grid-cols-6 sf:gap-2 sf:p-1"
    >
      {tokens.map((token) => (
        <SwatchCell
          key={token}
          token={token}
          isActive={activeToken === token}
          onClick={() => onSelect(token)}
          testId={`${tokenTestIdPrefix}-${token}`}
          ariaLabel={`${ariaLabel} ${token}`}
        />
      ))}
    </div>
  );
}

// Labelled subsection inside a consolidated popover. Accepts an optional
// `testId` so legacy element-tree lookups (e.g. style-strip-border-style) still
// resolve when their controls move under a parent popover.
function PopoverSection({
  label,
  testId,
  children,
}: {
  label: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div className="sf:flex sf:flex-col sf:gap-1.5" data-testid={testId}>
      <div className="sf:text-[11px] sf:font-medium sf:uppercase sf:tracking-wide sf:text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

// Generic icon button that opens a popover containing the full picker control.
function PopoverButton({
  testId,
  tooltip,
  ariaLabel,
  renderIcon,
  children,
}: {
  testId: string;
  tooltip: string;
  ariaLabel: string;
  renderIcon: () => ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid={testId}
              aria-label={ariaLabel}
              title={tooltip}
              className={cn(
                'sf:inline-flex sf:h-8 sf:w-8 sf:items-center sf:justify-center sf:rounded-md sf:text-muted-foreground sf:transition-colors sf:hover:bg-accent sf:hover:text-accent-foreground',
                'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring sf:focus-visible:ring-offset-1',
              )}
            >
              {renderIcon()}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right" className="sf:px-2 sf:py-1 sf:text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="right" align="start" className="sf:w-auto sf:p-3">
        {children}
      </PopoverContent>
    </Popover>
  );
}

// Mirrors detail-panel.tsx SliderControl so the strip's slider behaves
// identically (live optimistic preview + commit on release). Same testIds on
// the slider element so older Playwright snapshots keep working.
//
// US-008: when `indeterminate` is true (mixed values across a multi-node
// selection), the readout shows "Mixed" until the user moves the slider, at
// which point the slider transitions to determinate and fans out the picked
// value to every selected node.
function SliderControl({
  value,
  defaultValue,
  min,
  max,
  suffix,
  indeterminate,
  onPreview,
  onCommit,
  testId,
}: {
  value: number | undefined;
  defaultValue: number;
  min: number;
  max: number;
  suffix?: string;
  indeterminate?: boolean;
  onPreview?: (n: number) => void;
  onCommit: (n: number) => void;
  testId: string;
}) {
  const upstream = value ?? defaultValue;
  const [local, setLocal] = useState<number>(upstream);
  // Tracks whether the user has touched the slider in the current open cycle.
  // Indeterminate mode resets this back to false when the upstream selection
  // changes (different mixed set → re-show the placeholder).
  const [picked, setPicked] = useState<boolean>(false);
  useEffect(() => {
    setLocal(upstream);
    setPicked(false);
  }, [upstream]);
  const showPlaceholder = indeterminate && !picked;
  return (
    <div className="sf:flex sf:w-48 sf:items-center sf:gap-3">
      <Slider
        min={min}
        max={max}
        step={1}
        value={[local]}
        onValueChange={([v]) => {
          const next = v ?? min;
          setLocal(next);
          setPicked(true);
          onPreview?.(next);
        }}
        onValueCommit={([v]) => onCommit(v ?? min)}
        data-testid={testId}
        data-indeterminate={showPlaceholder ? 'true' : undefined}
        className={cn('sf:flex-1', showPlaceholder && 'sf:opacity-60')}
      />
      <span
        data-testid={`${testId}-value`}
        className="sf:w-12 sf:shrink-0 sf:text-right sf:text-xs sf:tabular-nums sf:text-muted-foreground"
      >
        {showPlaceholder ? (
          'Mixed'
        ) : (
          <>
            {local}
            {suffix}
          </>
        )}
      </span>
    </div>
  );
}
