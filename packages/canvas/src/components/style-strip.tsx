import {
  ArrowLeftRight,
  ArrowRight,
  Check,
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
  ConnectorPath,
  ConnectorStyle,
  FlowNode,
} from '../types.ts';
import { IconToggleGroup, type IconToggleOption } from '../ui/icon-toggle-group.tsx';
import {
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
  /** Border thickness for image nodes (1–8). Shape nodes use `borderSize`. */
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  fontSize?: number;
  /** Optional explicit label/text color for the node. Falls back to theme
   * foreground when unset. Text shapes also fall back to `borderColor` for
   * backward compat with older demos that stored their text color there. */
  textColor?: ColorToken;
  cornerRadius?: number;
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

// 18-slot palette: 2 special tokens (`none`, `default`) + 16 named colors.
// `'none'` renders transparent border / fill — hidden from text-color and
// connector-color pickers via `<ColorSwatchGrid allowNone={false}>`.
const PALETTE_TOKENS: ColorToken[] = [
  'none',
  'default',
  'slate',
  'gray',
  'red',
  'rose',
  'orange',
  'amber',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'purple',
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
  // US-014: dedicated image branch. Image borders use `borderWidth` (1–8),
  // NOT the geometric nodes' open-ended `borderSize`.
  // Multi-image selections fan out across every selected node so the user can
  // restyle a batch of screenshots in one pass.
  const pureImageType = pureNode && nodes.every((n) => n.type === 'image');
  // Text-type simplification only applies to pure-node selections of a single
  // type:'text' node. Mixed selections (text + connector) still need the
  // shared border controls visible, so the guard is gated on `pureNode`.
  const isTextShape = pureNode && firstNode?.type === 'text';

  // Resolve current visual state. For pure-connector selections, the
  // border-color trigger reflects the connector's color; for pure-node
  // selections, the node's borderColor.
  const borderColorActive: ColorToken =
    (pureConnector ? firstConnector?.color : firstVisualNode?.data.borderColor) ?? 'default';
  const backgroundActive: ColorToken = firstVisualNode?.data.backgroundColor ?? 'default';
  const borderStyleActiveNode = (firstVisualNode?.data.borderStyle ?? 'solid') as
    | 'solid'
    | 'dashed'
    | 'dotted';
  const connectorStyleActive: ConnectorStyle = firstConnector?.style ?? 'solid';
  const directionActive = (firstConnector?.direction ?? 'forward') as ConnectorDirection;
  const pathActive = (firstConnector?.path ?? 'curve') as ConnectorPath;

  // Apply helpers — fan out a single user pick to every selected entity.
  // For "shared" properties on mixed selections, both fan-outs run.
  const applyBorderColor = (token: ColorToken) => {
    for (const n of nodes) onStyleNode(n.id, { borderColor: token });
    for (const c of connectors) onStyleConnector(c.id, { color: token });
  };
  const applyBackgroundColor = (token: ColorToken) => {
    for (const n of nodes) onStyleNode(n.id, { backgroundColor: token });
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
  // Text color: explicit `textColor` field on the first visual node; for text
  // shapes (no chrome) we fall back to `borderColor` since older demos stored
  // text color there. Mirrors the renderer fallback in shape-node.tsx.
  const applyTextColor = (token: ColorToken) => {
    if (nodes.length > 1 && onStyleNodes) {
      onStyleNodes(
        nodes.map((node) => node.id),
        { textColor: token },
      );
    } else {
      for (const node of nodes) onStyleNode(node.id, { textColor: token });
    }
  };
  const textColorActive: ColorToken =
    firstVisualNode?.data.textColor ??
    (isTextShape ? (firstVisualNode?.data.borderColor ?? 'default') : 'default');
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
  const applyConnectorPath = (path: ConnectorPath) => {
    for (const c of connectors) onStyleConnector(c.id, { path });
  };
  const applyConnectorDirection = (direction: ConnectorDirection) => {
    for (const c of connectors) onStyleConnector(c.id, { direction });
  };
  // US-014: type:'icon' stroke color writes to data.color via the same
  // onStyleNode path the geometric color picker uses — no new update plumbing.
  const applyIconColor = (token: ColorToken) => {
    for (const n of nodes) onStyleNode(n.id, { color: token });
  };
  const iconColorActive: ColorToken = firstIconNode?.data.color ?? 'default';

  // Width slider source value: connector borderSize for pure-connector,
  // node borderSize otherwise (mixed selections fall back to the node's
  // value since "border width" applies to both).
  const widthCurrent = pureConnector
    ? (firstConnector?.borderSize ?? DEFAULT_STROKE_WIDTH)
    : (firstVisualNode?.data.borderSize ?? DEFAULT_BORDER_SIZE);
  const widthDefault = pureConnector ? DEFAULT_STROKE_WIDTH : DEFAULT_BORDER_SIZE;

  const colorTriggerKind: SwatchPreviewKind = pureConnector ? 'edge' : 'border';
  const colorTooltip = pureConnector ? 'Connector color' : isTextShape ? 'Color' : 'Border color';
  const colorAriaLabel = pureConnector ? 'connector color' : isTextShape ? 'color' : 'border color';
  const colorInnerTestId = pureConnector
    ? 'style-tab-edge-color-trigger'
    : isTextShape
      ? 'style-tab-color-trigger'
      : 'style-tab-border-color-trigger';
  const colorTokenPrefix =
    pureConnector || isTextShape ? 'style-tab-color' : 'style-tab-border-color';

  if (pureIconType) {
    // US-022: Change-icon button reuses the same callback the icon node's
    // double-click handler invokes (US-016) — `firstIconNode.id` is the
    // representative target; for a multi-icon-node selection the button is
    // hidden because "change icon" is ambiguous across the set.
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
    // US-014: image border editor. Border color + style + width (1–8) — the
    // same three controls the group editor exposes. Edits dispatch via
    // onStyleNode (per-node fan-out for multi-image selections), reusing the
    // existing PATCH+undo path. Image nodes also keep their cornerRadius
    // control (already supported by the renderer's containerStyle).
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
    return (
      <TooltipProvider delayDuration={300}>
        <div
          data-testid="canvas-style-strip"
          className="sf:pointer-events-auto sf:flex sf:flex-col sf:items-center sf:gap-1 sf:rounded-lg sf:border sf:border-border sf:bg-background/95 sf:p-1 sf:shadow-md sf:backdrop-blur"
        >
          <SwatchButton
            testId="style-strip-image-border-color"
            tooltip="Border color"
            ariaLabel="image border color"
            activeToken={imageBorderColor}
            previewKind="border"
            tokenTestIdPrefix="style-tab-image-border-color"
            innerTestId="style-tab-image-border-color-trigger"
            onSelect={applyImageBorderColor}
          />
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
              min={1}
              max={8}
              suffix="px"
              onPreview={previewImageBorderWidth}
              onCommit={applyImageBorderWidth}
              testId="style-tab-image-border-width-slider"
            />
          </PopoverButton>
          <PopoverButton
            testId="style-strip-image-corner-radius"
            tooltip="Corners"
            ariaLabel="image corner radius"
            renderIcon={() => <Squircle className="sf:h-4 sf:w-4" />}
          >
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
          </PopoverButton>
        </div>
      </TooltipProvider>
    );
  }

  // Three consolidated popover triggers:
  //   • Colors: border color + fill (fill section hidden for text shapes and
  //     pure-connector selections where there's no fill concept).
  //   • Border: line style + width (hidden for text shapes — chromeless).
  //   • Text:   font size + text color (text color hidden for pure-connector,
  //     since a connector has no separate text color — its label tracks the
  //     edge color).
  const showFillSection = pureNode && !isTextShape;
  const showBorderSection = !isTextShape;
  const showTextColorSection = !pureConnector;
  // Trigger glyph for the Colors popover. For node selections that have a fill
  // section, render a small box showing both border + fill; otherwise (text
  // shape / pure connector) just show the current color as a filled circle so
  // the trigger conveys what the popover edits.
  const renderColorsTrigger = () => {
    if (pureConnector) {
      const edge = COLOR_TOKENS[borderColorActive].edge;
      return (
        <span
          className="sf:inline-block sf:h-5 sf:w-5 sf:rounded-full sf:ring-1 sf:ring-border"
          style={{ backgroundColor: edge }}
        />
      );
    }
    // `'none'` falls back to a muted dashed border / theme card fill so the
    // glyph stays visible even when both border + fill are transparent.
    const borderIsNone = borderColorActive === 'none';
    const fillIsNone = backgroundActive === 'none';
    const borderStyle = borderIsNone
      ? '2px dashed hsl(var(--muted-foreground))'
      : `2px solid ${COLOR_TOKENS[borderColorActive].border}`;
    const fillHex = fillIsNone ? 'hsl(var(--card))' : COLOR_TOKENS[backgroundActive].background;
    return (
      <span
        className="sf:inline-block sf:h-5 sf:w-5 sf:rounded-md sf:ring-1 sf:ring-border"
        style={{ backgroundColor: fillHex, border: borderStyle }}
      />
    );
  };

  // For text shapes the user request collapses everything into one Text tool
  // — there's no chrome to color or border-ify, so Colors + Border + Corners
  // buttons are hidden.
  return (
    <TooltipProvider delayDuration={300}>
      <div
        data-testid="canvas-style-strip"
        className="sf:pointer-events-auto sf:flex sf:flex-col sf:items-center sf:gap-1 sf:rounded-lg sf:border sf:border-border sf:bg-background/95 sf:p-1 sf:shadow-md sf:backdrop-blur"
      >
        {!isTextShape ? (
          <PopoverButton
            testId="style-strip-colors"
            tooltip="Colors"
            ariaLabel="colors"
            renderIcon={renderColorsTrigger}
          >
            <div className="sf:flex sf:w-56 sf:flex-col sf:gap-3">
              <PopoverSection label={colorTooltip}>
                <ColorSwatchGrid
                  testId="style-strip-border-color"
                  activeToken={borderColorActive}
                  previewKind={colorTriggerKind}
                  tokenTestIdPrefix={colorTokenPrefix}
                  innerTestId={colorInnerTestId}
                  ariaLabel={colorAriaLabel}
                  allowNone={!pureConnector}
                  onSelect={applyBorderColor}
                />
              </PopoverSection>
              {showFillSection ? (
                <PopoverSection label="Fill">
                  <ColorSwatchGrid
                    testId="style-strip-fill"
                    activeToken={backgroundActive}
                    previewKind="background"
                    tokenTestIdPrefix="style-tab-background-color"
                    innerTestId="style-tab-background-color-trigger"
                    ariaLabel="fill"
                    onSelect={applyBackgroundColor}
                  />
                </PopoverSection>
              ) : null}
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
                  min={1}
                  max={8}
                  suffix="px"
                  onPreview={previewBorderSize}
                  onCommit={applyBorderSize}
                  testId={
                    pureConnector ? 'style-tab-stroke-width-slider' : 'style-tab-border-size-slider'
                  }
                />
              </PopoverSection>
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
              {showTextColorSection ? (
                <PopoverSection label="Color">
                  <ColorSwatchGrid
                    testId="style-strip-text-color"
                    activeToken={textColorActive}
                    previewKind="edge"
                    tokenTestIdPrefix="style-tab-text-color"
                    innerTestId="style-tab-text-color-trigger"
                    ariaLabel="text color"
                    allowNone={false}
                    onSelect={applyTextColor}
                  />
                </PopoverSection>
              ) : null}
            </div>
          </PopoverButton>
        ) : null}

        {hasNodes && !isTextShape ? (
          <PopoverButton
            testId="style-strip-corner-radius"
            tooltip="Corners"
            ariaLabel="corner radius"
            renderIcon={() => <Squircle className="sf:h-4 sf:w-4" />}
          >
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
          </PopoverButton>
        ) : null}

        {pureConnector ? (
          <PopoverButton
            testId="style-strip-path"
            tooltip="Connector path"
            ariaLabel="connector path"
            renderIcon={() => {
              const Icon = PATH_OPTIONS.find((o) => o.value === pathActive)?.icon ?? PathCurveIcon;
              return <Icon className="sf:h-4 sf:w-4" />;
            }}
          >
            <IconToggleGroup<ConnectorPath>
              ariaLabel="Connector path"
              value={pathActive}
              onChange={applyConnectorPath}
              options={PATH_OPTIONS}
            />
          </PopoverButton>
        ) : null}

        {pureConnector ? (
          <PopoverButton
            testId="style-strip-direction"
            tooltip="Direction"
            ariaLabel="direction"
            renderIcon={() => {
              const Icon =
                DIRECTION_OPTIONS.find((o) => o.value === directionActive)?.icon ?? ArrowRight;
              return <Icon className="sf:h-4 sf:w-4" />;
            }}
          >
            <IconToggleGroup<ConnectorDirection>
              ariaLabel="Connector direction"
              value={directionActive}
              onChange={applyConnectorDirection}
              options={DIRECTION_OPTIONS}
            />
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
// Tokens render as a flat saturated tint (palette.edge); `'default'` shows a
// half-and-half split conveying "border + fill from theme"; `'none'` is
// rendered separately by SwatchCell (transparent body + diagonal slash).
function swatchFillStyle(token: ColorToken): CSSProperties {
  if (token === 'default') {
    return {
      backgroundImage:
        'linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) 50%, hsl(var(--card)) 50%, hsl(var(--card)) 100%)',
    };
  }
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
          style={{ color: 'hsl(var(--foreground))' }}
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
                className={cn(
                  'sf:relative sf:h-5 sf:w-5 sf:rounded-full sf:ring-1 sf:ring-border',
                  isNone && 'sf:bg-card',
                )}
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
      className="sf:grid sf:grid-cols-6 sf:gap-1"
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
