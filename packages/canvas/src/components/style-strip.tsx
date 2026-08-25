import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeftRight,
  ArrowRight,
  Check,
  ChevronDown,
  Circle,
  Diamond,
  Layers,
  Minus,
  MoveLeft,
  Squircle,
  Sticker,
  Type,
} from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn.ts';
import { COLOR_TOKENS } from '../lib/color-tokens.ts';
import { FONT_FAMILY_OPTIONS, FONT_STACKS } from '../lib/font-stacks.ts';
import { GROUP_DEFAULT_BORDER_COLOR, GROUP_DEFAULT_BORDER_SIZE } from '../nodes/group-node.tsx';
import type {
  ColorToken,
  Connector,
  ConnectorDirection,
  ConnectorHeadShape,
  ConnectorPath,
  ConnectorStyle,
  FlowNode,
  FontFamilyToken,
} from '../types.ts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.tsx';
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
  /** Curated font-family token; resolves to a CSS stack at render via FONT_STACKS. */
  fontFamily?: FontFamilyToken;
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
  /** Curated font-family token for the connector label (mirrors NodeStylePatch.fontFamily). */
  fontFamily?: FontFamilyToken;
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
   * invokes (US-016). Plumbed from flow-view via seeflow-canvas. Absent → the
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
// Freehand ink default stroke width (data.strokeWidth) — matches the pen
// tool's seed so the slider readout is meaningful before the first drag.
const FREEHAND_STROKE_WIDTH_DEFAULT = 1;
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
  // A decorative line carries no text, so the Text popover (size / font / align)
  // is suppressed for a pure-line selection — its stroke colour / width / style
  // are driven by the shared border controls instead.
  const pureLineType = pureNode && nodes.every((n) => n.type === 'line');
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
  // Canvas grouping: a pure group selection collapses to a focused border
  // editor (color + width). A group is a chrome-less container — it has no
  // fill / corners / shadow / text to style, only its stylable border.
  const pureGroupType = pureNode && nodes.every((n) => n.type === 'group');
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
  // US-018: per-connector label font size. Fan-out mirrors the node fontSize
  // fan-out above.
  const applyConnectorFontSize = (n: number) => {
    for (const c of connectors) onStyleConnector(c.id, { fontSize: n });
  };
  const previewConnectorFontSize = (n: number) => {
    for (const c of connectors) onStyleConnectorPreview?.(c.id, { fontSize: n });
  };
  // Unified text font-size fan-out: one control drives node text AND connector
  // labels. Each underlying helper is a no-op when its collection is empty, so
  // this is correct for nodes-only, connectors-only, and mixed selections.
  const applyTextFontSize = (n: number) => {
    applyFontSize(n);
    applyConnectorFontSize(n);
  };
  const previewTextFontSize = (n: number) => {
    previewFontSize(n);
    previewConnectorFontSize(n);
  };
  // Font-family fan-out. Mirrors the unified font-size path so one picker drives
  // node text AND connector labels; commits through the atomic batch API for
  // multi-node selections, per-node / per-connector loop otherwise.
  const applyNodeFontFamily = (token: FontFamilyToken) => {
    if (nodes.length > 1 && onStyleNodes) {
      onStyleNodes(
        nodes.map((node) => node.id),
        { fontFamily: token },
      );
    } else {
      for (const node of nodes) onStyleNode(node.id, { fontFamily: token });
    }
  };
  const applyTextFontFamily = (token: FontFamilyToken) => {
    applyNodeFontFamily(token);
    for (const c of connectors) onStyleConnector(c.id, { fontFamily: token });
  };
  // Active token: first visual node's, else first connector's, else 'sans'.
  // Indeterminate when the selection mixes tokens (reads "Mixed").
  const textFontFamilyActive: FontFamilyToken =
    firstVisualNode?.data.fontFamily ?? firstConnector?.fontFamily ?? 'sans';
  const textFontFamilyIndeterminate = (() => {
    const vals = new Set<FontFamilyToken>();
    for (const n of visualNodes) vals.add(n.data.fontFamily ?? 'sans');
    for (const c of connectors) vals.add(c.fontFamily ?? 'sans');
    return vals.size > 1;
  })();
  // Indeterminate across the WHOLE selection: nodes default to 22, connectors to
  // 11, so a genuine mix of node+connector text reads "Mixed" — which is honest,
  // they ARE different sizes until the user picks one.
  const textFontSizeIndeterminate = (() => {
    const vals = new Set<number>();
    for (const n of visualNodes) vals.add(n.data.fontSize ?? NODE_FONT_SIZE_DEFAULT);
    for (const c of connectors) vals.add(c.fontSize ?? CONNECTOR_FONT_SIZE_DEFAULT);
    return vals.size > 1;
  })();
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
    // Freehand ink exposes a stroke-width slider (data.strokeWidth, 0.5–4) that
    // icons don't — so it only renders when the selection contains a freehand
    // node. The pick fans out to every freehand node in the selection (icons in
    // a mixed ink selection have no stroke-width control and are skipped).
    const freehandNodes = nodes.filter((n) => n.type === 'freehand');
    const hasFreehand = freehandNodes.length > 0;
    const freehandWidth = freehandNodes[0]?.data.strokeWidth ?? FREEHAND_STROKE_WIDTH_DEFAULT;
    // US-008-style indeterminate: a multi-freehand selection with divergent
    // stroke widths (treating unset as the default) shows the "Mixed"
    // placeholder until the user picks a value. Mirrors the shadow/corner
    // indeterminate computation above.
    const freehandWidthIndeterminate =
      freehandNodes.length > 1 &&
      new Set(freehandNodes.map((n) => n.data.strokeWidth ?? FREEHAND_STROKE_WIDTH_DEFAULT)).size >
        1;
    const applyFreehandWidth = (n: number) => {
      for (const node of freehandNodes) onStyleNode(node.id, { strokeWidth: n });
    };
    const previewFreehandWidth = (n: number) => {
      for (const node of freehandNodes) onStyleNodePreview?.(node.id, { strokeWidth: n });
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
          {hasFreehand ? (
            <PopoverButton
              testId="style-strip-freehand-width"
              tooltip="Stroke width"
              ariaLabel="stroke width"
              renderIcon={() => (
                <span className="sf:font-mono sf:text-[10px] sf:tabular-nums">{freehandWidth}</span>
              )}
            >
              <SliderControl
                value={freehandWidth}
                defaultValue={FREEHAND_STROKE_WIDTH_DEFAULT}
                min={0.5}
                max={4}
                step={0.5}
                indeterminate={freehandWidthIndeterminate}
                onPreview={previewFreehandWidth}
                onCommit={applyFreehandWidth}
                testId="style-tab-freehand-width-slider"
              />
            </PopoverButton>
          ) : null}
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

  if (pureGroupType) {
    // Group border editor: color + width. The group renderer reads
    // borderColor/borderSize/borderStyle. `allowNone` is TRUE so the swatch
    // offers a "no color" option; the group renderer treats `'none'` as NO
    // border (it does NOT fall back to the neutral-gray outline a normal node's
    // `'none'` paints). Dragging width to 0 removes the border too.
    const firstGroup = nodes[0] as Extract<FlowNode, { type: 'group' }> | undefined;
    const groupBorderColor: ColorToken = firstGroup?.data.borderColor ?? GROUP_DEFAULT_BORDER_COLOR;
    const applyGroupBorderColor = (token: ColorToken) => {
      for (const n of nodes) onStyleNode(n.id, { borderColor: token });
    };
    const applyGroupBorderSize = (n: number) => {
      for (const node of nodes) onStyleNode(node.id, { borderSize: n });
    };
    const previewGroupBorderSize = (n: number) => {
      for (const node of nodes) onStyleNodePreview?.(node.id, { borderSize: n });
    };
    return (
      <TooltipProvider delayDuration={300}>
        <div
          data-testid="canvas-style-strip"
          className="sf:pointer-events-auto sf:flex sf:flex-col sf:items-center sf:gap-1 sf:rounded-lg sf:border sf:border-border sf:bg-background/95 sf:p-1 sf:shadow-md sf:backdrop-blur"
        >
          <SwatchButton
            testId="style-strip-group-border-color"
            tooltip="Border color"
            ariaLabel="group border color"
            activeToken={groupBorderColor}
            previewKind="border"
            tokenTestIdPrefix="style-tab-group-border-color"
            innerTestId="style-tab-group-border-color-trigger"
            allowNone={true}
            onSelect={applyGroupBorderColor}
          />
          <PopoverButton
            testId="style-strip-group-border-width"
            tooltip="Border width"
            ariaLabel="group border width"
            renderIcon={() => (
              <span className="sf:font-mono sf:text-[10px] sf:tabular-nums">
                {firstGroup?.data.borderSize ?? GROUP_DEFAULT_BORDER_SIZE}
              </span>
            )}
          >
            <SliderControl
              value={firstGroup?.data.borderSize}
              defaultValue={GROUP_DEFAULT_BORDER_SIZE}
              min={0}
              max={8}
              suffix="px"
              onPreview={previewGroupBorderSize}
              onCommit={applyGroupBorderSize}
              testId="style-tab-group-border-width-slider"
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

        {(hasNodes && !pureLineType) || pureConnector ? (
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
                  value={hasNodes ? firstVisualNode?.data.fontSize : firstConnector?.fontSize}
                  defaultValue={hasNodes ? NODE_FONT_SIZE_DEFAULT : CONNECTOR_FONT_SIZE_DEFAULT}
                  min={8}
                  max={64}
                  suffix="px"
                  editable
                  inputMax={200}
                  indeterminate={textFontSizeIndeterminate}
                  onPreview={previewTextFontSize}
                  onCommit={applyTextFontSize}
                  testId={
                    pureConnector
                      ? 'style-tab-connector-font-size-slider'
                      : 'style-tab-font-size-slider'
                  }
                />
              </PopoverSection>
              <PopoverSection label="Font" testId="style-strip-font-family">
                {/* modal=false: this menu is nested inside the Text popover; a
                    modal menu would scroll-lock + steal dismissal and collapse
                    the parent popover on open/close. */}
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      data-testid="style-tab-font-family-trigger"
                      aria-label="Font family"
                      className={cn(
                        'sf:flex sf:w-full sf:items-center sf:justify-between sf:gap-2 sf:rounded-md sf:border sf:border-input sf:bg-transparent sf:px-2 sf:py-1.5 sf:text-sm sf:transition-colors sf:hover:bg-accent',
                        'sf:focus-visible:outline-hidden sf:focus-visible:ring-2 sf:focus-visible:ring-ring',
                      )}
                    >
                      <span
                        className="sf:truncate"
                        style={{ fontFamily: FONT_STACKS[textFontFamilyActive] }}
                      >
                        {textFontFamilyIndeterminate
                          ? 'Mixed'
                          : (FONT_FAMILY_OPTIONS.find((o) => o.token === textFontFamilyActive)
                              ?.label ?? textFontFamilyActive)}
                      </span>
                      <ChevronDown className="sf:h-3.5 sf:w-3.5 sf:shrink-0 sf:opacity-60" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="sf:w-[var(--radix-dropdown-menu-trigger-width)]"
                  >
                    <DropdownMenuRadioGroup
                      value={textFontFamilyIndeterminate ? '' : textFontFamilyActive}
                      onValueChange={(v) => applyTextFontFamily(v as FontFamilyToken)}
                    >
                      {FONT_FAMILY_OPTIONS.map((opt) => (
                        <DropdownMenuRadioItem
                          key={opt.token}
                          value={opt.token}
                          data-testid={`style-tab-font-family-${opt.token}`}
                          style={{ fontFamily: FONT_STACKS[opt.token] }}
                        >
                          {opt.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
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
export function SliderControl({
  value,
  defaultValue,
  min,
  max,
  step = 1,
  suffix,
  indeterminate,
  editable,
  inputMax,
  onPreview,
  onCommit,
  testId,
}: {
  value: number | undefined;
  defaultValue: number;
  min: number;
  max: number;
  /** Slider granularity. Defaults to 1 (integer widths); freehand ink uses 0.5. */
  step?: number;
  suffix?: string;
  indeterminate?: boolean;
  /** Render an editable number input instead of a read-only readout. */
  editable?: boolean;
  /** Hard cap for typed input (defaults to `max`). Lets the input exceed the
   *  slider's max while the thumb pins at `max`. */
  inputMax?: number;
  onPreview?: (n: number) => void;
  onCommit: (n: number) => void;
  testId: string;
}) {
  const hardMax = inputMax ?? max;
  const upstream = value ?? defaultValue;
  const [local, setLocal] = useState<number>(upstream);
  // Tracks whether the user has touched the slider in the current open cycle.
  // Indeterminate mode resets this back to false when the upstream selection
  // changes (different mixed set → re-show the placeholder).
  const [picked, setPicked] = useState<boolean>(false);
  // Last value the user typed/dragged this cycle. We commit from this ref (not
  // the `local` state) so blur/Enter commit the freshly typed value even before
  // React flushes the `setLocal` re-render.
  const lastValueRef = useRef<number>(upstream);
  // Raw editable string for the optional number input. Lets the field render
  // empty mid-edit (clear-and-retype) without snapping to `min`; the committed
  // numeric value still flows through `lastValueRef` / `local`. Appended last
  // per the append-only useState rule for shim-tested components.
  const [rawInput, setRawInput] = useState<string>(String(upstream));
  useEffect(() => {
    setLocal(upstream);
    setPicked(false);
    lastValueRef.current = upstream;
    setRawInput(String(upstream));
  }, [upstream]);
  const showPlaceholder = indeterminate && !picked;
  const clampInput = (n: number) => Math.min(hardMax, Math.max(min, n));
  return (
    <div className="sf:flex sf:w-48 sf:items-center sf:gap-3">
      <Slider
        min={min}
        max={max}
        step={step}
        // Pin the thumb at `max` so a typed value above the slider's max (e.g.
        // 120 with max 64) doesn't push the thumb past the track.
        value={[Math.min(local, max)]}
        onValueChange={([v]) => {
          const next = v ?? min;
          setLocal(next);
          setPicked(true);
          lastValueRef.current = next;
          onPreview?.(next);
        }}
        onValueCommit={([v]) => onCommit(v ?? min)}
        data-testid={testId}
        data-indeterminate={showPlaceholder ? 'true' : undefined}
        className={cn('sf:flex-1', showPlaceholder && 'sf:opacity-60')}
      />
      {editable ? (
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={hardMax}
          step={step}
          data-testid={`${testId}-input`}
          aria-label="Font size"
          value={showPlaceholder ? '' : rawInput}
          placeholder={showPlaceholder ? 'Mixed' : undefined}
          onChange={(e) => {
            const text = e.target.value;
            setRawInput(text);
            // Empty (or whitespace) is an in-progress edit: let the field clear
            // so the user can retype, but don't commit/clamp/preview yet. Blur
            // or Enter will commit the last valid value.
            if (text.trim() === '') return;
            const raw = Number(text);
            if (Number.isNaN(raw)) return;
            const next = clampInput(raw);
            setLocal(next);
            setPicked(true);
            lastValueRef.current = next;
            onPreview?.(next);
          }}
          onBlur={() => onCommit(clampInput(lastValueRef.current))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onCommit(clampInput(lastValueRef.current));
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="sf:w-12 sf:shrink-0 sf:rounded sf:border sf:border-input sf:bg-background sf:px-1.5 sf:py-0.5 sf:text-right sf:text-xs sf:tabular-nums"
        />
      ) : (
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
      )}
    </div>
  );
}
