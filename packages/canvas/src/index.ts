// ============================================================================
// @seeflow/canvas — public barrel
//
// Sections (in order):
//   1. Schema types          — node / connector / demo shapes
//   2. Theming               — color tokens + styles
//   3. Icon registry         — built-in lucide icon set
//   4. Helpers               — pure functions / browser utilities
//   5. Adapter               — REST adapter + adapter contract types
//   6. Nodes                 — React Flow node components
//   7. Edges                 — React Flow edge components
//   8. UI primitives         — buttons, dialogs, popovers, etc.
//   9. Chrome                — toolbar, inline edit, style strip, overlays
//  10. Main entry            — <SeeflowCanvas /> (the canvas itself)
// ============================================================================

// ----------------------------------------------------------------------------
// 1. Schema types
// ----------------------------------------------------------------------------
export type {
  ColorToken,
  Connector,
  ConnectorBase,
  ConnectorDirection,
  ConnectorPath,
  ConnectorStyle,
  DefaultConnector,
  Demo,
  DemoNode,
  EdgePin,
  EdgePinSide,
  EventConnector,
  HtmlNodeData,
  HttpAction,
  HttpConnector,
  IconNodeData,
  ImageNodeData,
  NodeData,
  NodeDescription,
  NodeVisual,
  QueueConnector,
  RunResult,
  ShapeKind,
  ShapeNodeData,
  StatusReport,
  StatusReportState,
} from './types.ts';

// ----------------------------------------------------------------------------
// 2. Theming
// ----------------------------------------------------------------------------
export {
  COLOR_TOKENS,
  NODE_DEFAULT_BG_WHITE,
  colorTokenStyle,
} from './lib/color-tokens.ts';
export type {
  EdgeColorStyle,
  NodeColorStyle,
  NodeHeaderColorStyle,
  TextColorStyle,
} from './lib/color-tokens.ts';

// ----------------------------------------------------------------------------
// 3. Icon registry
// ----------------------------------------------------------------------------
export { ICON_FALLBACK_NAME, ICON_NAMES, ICON_REGISTRY } from './lib/icon-registry.ts';

// ----------------------------------------------------------------------------
// 4. Helpers
// ----------------------------------------------------------------------------
export { applyLayout } from './lib/auto-layout.ts';
export type {
  AutoLayoutEdge,
  AutoLayoutNode,
  AutoLayoutOptions,
  LayoutDirection,
} from './lib/auto-layout.ts';

export {
  clampImageDims,
  computeImageDims,
  extractImageFile,
  handleCanvasFileDrop,
  IMAGE_DROP_EXTS,
  IMAGE_DROP_MAX_LONGEST_SIDE,
  IMAGE_DROP_SVG_FALLBACK,
  isAcceptableImageFile,
} from './lib/canvas-drop.ts';
export type {
  CanvasDropDispatchArgs,
  HandleCanvasFileDropArgs,
} from './lib/canvas-drop.ts';

export { cn } from './lib/cn.ts';

export { connectorToEdge, styleForKind } from './lib/connector-to-edge.ts';
export type { DerivedEdge } from './lib/connector-to-edge.ts';

export { createDebouncer } from './lib/debounce.ts';
export type { Debouncer, DebouncerOptions } from './lib/debounce.ts';

export {
  clampDetailPanelWidth,
  DETAIL_PANEL_WIDTH_DEFAULT,
  DETAIL_PANEL_WIDTH_KEY,
  DETAIL_PANEL_WIDTH_MAX,
  DETAIL_PANEL_WIDTH_MIN,
  getStoredDetailPanelWidth,
  setStoredDetailPanelWidth,
  startResizeGesture,
} from './lib/detail-panel-width.ts';
export type { ResizeGestureCallbacks } from './lib/detail-panel-width.ts';

export { fileUrl } from './lib/file-url.ts';

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
  buildIconInsertPayload,
  computeIconInsertPosition,
} from './lib/icon-insert.ts';
export type {
  IconInsertPayload,
  IconInsertRfInstance,
  IconInsertViewport,
} from './lib/icon-insert.ts';

export { getRecents, ICON_RECENTS_STORAGE_KEY, pushRecent } from './lib/icon-recents.ts';

export {
  applyNudge,
  COMMANDS,
  formatShortcut,
  getCommandTooltip,
  getNudgeDelta,
  getZoomChord,
  IS_MAC,
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

export {
  DEFAULT_STORAGE_PREFIX,
  getLastUsedStyle,
  rememberConnectorStyle,
  rememberNodeStyle,
} from './lib/last-used-style.ts';
export type { LastUsedStyle } from './lib/last-used-style.ts';

export {
  buildNewImageData,
  buildNewShapeData,
  NEW_NODE_BORDER_WIDTH,
  NEW_NODE_FONT_SIZE,
} from './lib/node-defaults.ts';
export type { ImageDataDefaults, ShapeDataDefaults } from './lib/node-defaults.ts';

export { scaleNodesWithinRect } from './lib/scale-nodes.ts';
export type { Rect, ScalableNode, ScaleNodesOptions } from './lib/scale-nodes.ts';

// ----------------------------------------------------------------------------
// 5. Adapter
// ----------------------------------------------------------------------------
export { createRestAdapter } from './adapter/rest.ts';
export type { RestAdapterOptions } from './adapter/rest.ts';
export type {
  CanvasAdapter,
  CanvasRuntime,
  ConnectorCreateInput,
  ConnectorPatch,
  NodeCreateInput,
  NodeKind,
  NodePatch,
  PlayNodeResult,
  ReorderOp,
  UpdateNodePositionResult,
  UploadImageResult,
} from './adapter/types.ts';

// ----------------------------------------------------------------------------
// 6. Nodes (re-exports from ./nodes/index.ts)
// ----------------------------------------------------------------------------
export * from './nodes/index.ts';

// ----------------------------------------------------------------------------
// 7. Edges (re-exports from ./edges/index.ts)
// ----------------------------------------------------------------------------
export * from './edges/index.ts';

// ----------------------------------------------------------------------------
// 8. UI primitives (re-exports from ./ui/index.ts)
// ----------------------------------------------------------------------------
export * from './ui/index.ts';

// ----------------------------------------------------------------------------
// 9. Chrome
// ----------------------------------------------------------------------------
export {
  CanvasToolbar,
  HTML_BLOCK_DND_TYPE,
  TOOLBAR_SHAPES,
} from './components/canvas-toolbar.tsx';
export type {
  CanvasToolbarProps,
  ToolbarShapeEntry,
} from './components/canvas-toolbar.tsx';

export {
  DetailPanel,
  EditableField,
  formatRelativeTime,
  HtmlNodeSection,
  StatusSection,
} from './components/detail-panel.tsx';
export type { DetailPanelProps } from './components/detail-panel.tsx';

export { EmbedDialog } from './components/embed-dialog.tsx';
export type { EmbedDialogProps } from './components/embed-dialog.tsx';

export {
  filterIcons,
  IconPickerBody,
  IconPickerPopover,
} from './components/icon-picker-popover.tsx';
export type {
  IconPickerBodyProps,
  IconPickerPopoverProps,
} from './components/icon-picker-popover.tsx';

export { InlineEdit } from './components/inline-edit.tsx';
export type { InlineEditProps } from './components/inline-edit.tsx';

export { ShareMenu } from './components/share-menu.tsx';
export type { ShareMenuMode, ShareMenuProps } from './components/share-menu.tsx';

export { RestartDemoButton } from './components/restart-demo-button.tsx';
export type { RestartDemoButtonProps } from './components/restart-demo-button.tsx';

export {
  computeNewRectFromAnchorDrag,
  computeSelectionResizeUpdates,
  computeUnionRect,
  scheduleRaf,
  SELECTION_OVERLAY_PADDING,
  SelectionResizeOverlay,
  selectionEligibleForOverlay,
} from './components/selection-resize-overlay.tsx';
export type {
  MultiResizeUpdate,
  OverlayInputNode,
  SelectionResizeOverlayProps,
} from './components/selection-resize-overlay.tsx';

export { StyleStrip } from './components/style-strip.tsx';
export type {
  ConnectorStylePatch,
  NodeStylePatch,
  StyleStripProps,
} from './components/style-strip.tsx';

// ----------------------------------------------------------------------------
// 10. Main entry — <SeeflowCanvas />
// ----------------------------------------------------------------------------
export {
  classifyHandleDropFailure,
  classifyReconnectBodyDrop,
  computeUnmovedLockPin,
  eventTargetIsOtherNode,
  handleClipboardShortcut,
  resolveFlags,
  SeeflowCanvas,
} from './components/seeflow-canvas.tsx';
export type {
  CanvasFeatureOverrides,
  ClipboardShortcutDeps,
  ClipboardShortcutEventLike,
  ResolvedCanvasFlags,
  SeeflowCanvasHandle,
  SeeflowCanvasMode,
  SeeflowCanvasProps,
} from './components/seeflow-canvas.tsx';
