export type {
  ColorToken,
  NodeVisual,
  NodeDescription,
  NodeData,
  HttpAction,
  ShapeKind,
  ShapeNodeData,
  ImageNodeData,
  IconNodeData,
  HtmlNodeData,
  DemoNode,
  ConnectorStyle,
  ConnectorDirection,
  ConnectorPath,
  EdgePinSide,
  EdgePin,
  ConnectorBase,
  HttpConnector,
  EventConnector,
  QueueConnector,
  DefaultConnector,
  Connector,
  Demo,
  StatusReport,
  StatusReportState,
} from './types.ts';

export {
  COLOR_TOKENS,
  NODE_DEFAULT_BG_WHITE,
  colorTokenStyle,
} from './lib/color-tokens.ts';
export type { NodeColorStyle, EdgeColorStyle, TextColorStyle } from './lib/color-tokens.ts';

export { ICON_REGISTRY, ICON_FALLBACK_NAME, ICON_NAMES } from './lib/icon-registry.ts';

export {
  endpointFromPin,
  endpointToPin,
  getNodeIntersection,
  projectCursorToPerimeter,
  resolveEdgeEndpoints,
} from './lib/floating-edge-geometry.ts';
export type {
  Endpoint,
  EndpointInput,
  FloatingRect,
  Pin,
  Side,
  XY,
} from './lib/floating-edge-geometry.ts';

export {
  IMAGE_DROP_EXTS,
  IMAGE_DROP_MAX_LONGEST_SIDE,
  IMAGE_DROP_SVG_FALLBACK,
  clampImageDims,
  computeImageDims,
  extractImageFile,
  handleCanvasFileDrop,
  isAcceptableImageFile,
} from './lib/canvas-drop.ts';
export type {
  CanvasDropDispatchArgs,
  HandleCanvasFileDropArgs,
} from './lib/canvas-drop.ts';

export {
  COMMANDS,
  IS_MAC,
  applyNudge,
  formatShortcut,
  getCommandTooltip,
  getNudgeDelta,
  getZoomChord,
  resolveClipboardChord,
  resolveToolShortcut,
} from './lib/keyboard-shortcuts.ts';
export type {
  ClipboardChord,
  ClipboardChordInput,
  CommandCategory,
  CommandContext,
  CommandDef,
  CommandId,
  ModifierEvent,
  NudgeDelta,
  ShortcutParts,
  ToolShortcutResult,
  ZoomAction,
} from './lib/keyboard-shortcuts.ts';

export { applyLayout } from './lib/auto-layout.ts';
export type {
  AutoLayoutEdge,
  AutoLayoutNode,
  AutoLayoutOptions,
  LayoutDirection,
} from './lib/auto-layout.ts';

export { connectorToEdge, styleForKind } from './lib/connector-to-edge.ts';
export type { DerivedEdge } from './lib/connector-to-edge.ts';

export { cn } from './lib/cn.ts';

export { createDebouncer } from './lib/debounce.ts';
export type { Debouncer, DebouncerOptions } from './lib/debounce.ts';

export { fileUrl } from './lib/file-url.ts';

export { InlineEdit } from './components/inline-edit.tsx';
export type { InlineEditProps } from './components/inline-edit.tsx';

export * from './nodes/index.ts';
export * from './ui/index.ts';
