// ============================================================================
// @seeflow/canvas — public barrel
//
// Sections (in order):
//   1. Schema types          — node / connector / demo shapes
//   2. Theming               — color tokens + styles
//   3. Icon registry         — built-in lucide icon set
//   4. Helpers               — pure functions / browser utilities
//   5. Adapter               — REST adapter + adapter contract types
//  5b. History               — undo/redo wrapper + handle types
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
  CanvasMode,
  ColorToken,
  ComponentAction,
  ComponentNodeData,
  ComponentSpec,
  ComponentSpecElement,
  Connector,
  ConnectorBase,
  ConnectorDirection,
  ConnectorHeadShape,
  ConnectorPath,
  ConnectorStyle,
  Flow,
  FlowNode,
  DrawableNodeType,
  EdgePin,
  EdgePinSide,
  FreehandNodeData,
  GeometricNodeData,
  GeometricNodeType,
  GroupNodeData,
  HtmlNodeData,
  IconNodeData,
  ImageNodeData,
  LinkflowNodeData,
  LinkflowTarget,
  NodeCapabilities,
  NodeDescription,
  NodeSemanticBase,
  NodeType,
  NodeVisual,
  SetComponentAction,
  TableColumn,
  TableNodeData,
  TableRow,
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
export {
  ICON_FALLBACK_NAME,
  ICON_NAMES,
  ICON_NAMES_BY_VENDOR,
  ICON_REGISTRY,
  applyPackSummaries,
} from './lib/icon-registry.ts';
export { formatIconId, parseIconId } from './lib/icon-id.ts';
export type { IconId, IconVendor } from './lib/icon-id.ts';
export { resolveIcon } from './lib/icon-resolve.ts';
export type { Resolved, ResolveOptions } from './lib/icon-resolve.ts';
export { IconRenderer } from './components/icon-renderer.tsx';
export type { IconRendererProps } from './components/icon-renderer.tsx';
export {
  CanvasStudioContext,
  CanvasStudioProvider,
  useCanvasStudio,
} from './lib/canvas-studio-context.tsx';
export type { CanvasStudioValue } from './lib/canvas-studio-context.tsx';

// ----------------------------------------------------------------------------
// 4. Helpers
// ----------------------------------------------------------------------------
export {
  clampImageDims,
  computeImageDims,
  downscaleImageFile,
  extractImageFile,
  extractImageFiles,
  handleCanvasFileDrop,
  IMAGE_DROP_EXTS,
  IMAGE_DROP_GRID_GAP,
  IMAGE_DROP_GRID_MAX_COLS,
  IMAGE_DROP_MAX_LONGEST_SIDE,
  IMAGE_DROP_SVG_FALLBACK,
  IMAGE_UPLOAD_MAX_PIXELS,
  isAcceptableImageFile,
  isRasterDownscalable,
  layoutImageGrid,
} from './lib/canvas-drop.ts';
export type {
  CanvasDropDispatchArgs,
  HandleCanvasFileDropArgs,
} from './lib/canvas-drop.ts';

export { cn } from './lib/cn.ts';

export { connectorToEdge } from './lib/connector-to-edge.ts';
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
  resolveGroupChord,
  resolveHistoryChord,
  resolveToolShortcut,
} from './lib/keyboard-shortcuts.ts';
export type {
  ClipboardChord,
  ClipboardChordInput,
  CommandCategory,
  CommandContext,
  CommandDef,
  CommandId,
  GroupChord,
  HistoryChord,
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
  buildNewGroupData,
  buildNewImageData,
  buildNewLineData,
  buildNewShapeData,
  buildNewTableData,
  NEW_GROUP_NAME,
  NEW_LINE_STROKE_WIDTH,
  NEW_NODE_BORDER_WIDTH,
  NEW_NODE_FONT_SIZE,
} from './lib/node-defaults.ts';
export type {
  GroupDataDefaults,
  ImageDataDefaults,
  LineDataDefaults,
  ShapeDataDefaults,
  TableDataDefaults,
} from './lib/node-defaults.ts';

export { scaleNodesWithinRect } from './lib/scale-nodes.ts';
export type { Rect, ScalableNode, ScaleNodesOptions } from './lib/scale-nodes.ts';

// Canvas grouping M4: pure group lifecycle ops (create/ungroup selection oracle
// + group-box geometry). The host (apps/web) composes these inside a
// history.batch to create/ungroup; the canvas uses them for the ⌘G shim.
export {
  computeGroupBox,
  computeGroupMoveUpdates,
  expandSelectionWithGroupMembers,
  GROUP_BOX_PADDING,
  planGroupAwareDeletion,
  planGroupShortcutAction,
  remapGroupChildIds,
  selectGroupSelection,
  selectGroupableSet,
} from './lib/group-ops.ts';
export type {
  ChildIdsPrune,
  DraggedGroup,
  GroupAwareDeletionPlan,
  GroupBoxMember,
  GroupMoveUpdate,
  GroupOpNode,
  GroupShortcutAction,
  RemapChildIdsNode,
} from './lib/group-ops.ts';

// ----------------------------------------------------------------------------
// 5. Adapter
// ----------------------------------------------------------------------------
export { createRestAdapter } from './adapter/rest.ts';
export type { RestAdapterOptions } from './adapter/rest.ts';
export type {
  CanvasAdapter,
  CanvasIconsAdapter,
  CanvasRuntime,
  ConnectorCreateInput,
  ConnectorPatch,
  IconLicenseInfo,
  IconPackVendor,
  InstallEvent,
  LayoutEdgeInput,
  LayoutNodeInput,
  LayoutResult,
  LayoutSourceHandle,
  LayoutTargetHandle,
  NodeCreateInput,
  NodeKind,
  NodePatch,
  PackSummary,
  ReorderOp,
  UpdateNodePositionResult,
  UploadImageResult,
} from './adapter/types.ts';

// ----------------------------------------------------------------------------
// 5b. History
// ----------------------------------------------------------------------------
export { wrapAdapterWithHistory } from './history/wrap-adapter.ts';
export {
  COALESCE_WINDOW_MS,
  MAX_HISTORY,
  STALE_MUTATION_WINDOW_MS,
} from './history/types.ts';
export type {
  FlowStateSnapshot,
  GetFlowState,
  HistoryEntry,
  HistoryHandle,
  HistoryState,
} from './history/types.ts';

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
  TOOLBAR_MODES,
  TOOLBAR_SHAPES,
} from './components/canvas-toolbar.tsx';
export type {
  CanvasToolbarProps,
  ToolbarModeEntry,
  ToolbarShapeEntry,
} from './components/canvas-toolbar.tsx';

export { DetailPanel, EditableField, HtmlNodeSection } from './components/detail-panel.tsx';
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

export { BrowsePacksPanel } from './components/browse-packs-panel.tsx';
export type { BrowsePacksPanelProps } from './components/browse-packs-panel.tsx';

export { InstallPackModal } from './components/install-pack-modal.tsx';
export type { InstallPackModalProps } from './components/install-pack-modal.tsx';

export { InstallProgressToast } from './components/install-progress-toast.tsx';
export type { InstallProgressToastProps } from './components/install-progress-toast.tsx';

export { InlineEdit } from './components/inline-edit.tsx';
export type { InlineEditProps } from './components/inline-edit.tsx';

export { ShareMenu } from './components/share-menu.tsx';
export type { ShareMenuMode, ShareMenuProps } from './components/share-menu.tsx';

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
  FIT_VIEW_OPTIONS,
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
