import {
  Background,
  type Connection,
  type ConnectionLineComponentProps,
  ControlButton,
  Controls,
  type Edge,
  type EdgeChange,
  type EdgeMarker,
  type FinalConnectionState,
  type HandleType,
  MiniMap,
  type Node,
  type NodeChange,
  Panel,
  Position,
  ReactFlow,
  type ReactFlowInstance,
  SelectionMode,
  ViewportPortal,
  applyEdgeChanges,
  applyNodeChanges,
  getBezierPath,
  getSmoothStepPath,
  useStore,
  useStoreApi,
} from '@xyflow/react';
import { LayoutDashboard, Link2, type LucideProps, Maximize2 } from 'lucide-react';
import {
  type ComponentType,
  type ForwardedRef,
  type PointerEvent,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CanvasAdapter, CanvasRuntime, ReorderOp } from '../adapter/types.ts';
import type { LayoutNodeInput } from '../adapter/types.ts';
import {
  AlignmentOverlay,
  type UseAlignmentGuidesApi,
  useAlignmentGuides,
} from '../alignment/index.ts';
import { EditableEdge, type EditableEdgeData } from '../edges/editable-edge.tsx';
import type { HistoryHandle } from '../history/types.ts';
import { useCanvasExport } from '../hooks/use-canvas-export.ts';
import { computeImageDims, extractImageFile, handleCanvasFileDrop } from '../lib/canvas-drop.ts';
import { CanvasStudioProvider } from '../lib/canvas-studio-context.tsx';
import { cn } from '../lib/cn.ts';
import { colorTokenStyle } from '../lib/color-tokens.ts';
import { STYLE_BY_NAME, connectorToEdge } from '../lib/connector-to-edge.ts';
import {
  type DrawSample,
  perfectDragBox,
  perfectShapeAspect,
  settleDrawRelease,
} from '../lib/draw-constrain.ts';
import {
  type Side,
  endpointFromPin,
  endpointToPin,
  getNodeIntersection,
  projectCursorToPerimeter,
  snapPinToStraight,
} from '../lib/floating-edge-geometry.ts';
import {
  LINE_DEFAULT_LENGTH,
  LINE_MIN_BOX,
  boxFromEndpoints,
  normalizePointsToBox,
} from '../lib/line-geometry.ts';
import { snapSegmentToStraight } from '../lib/snap-segment.ts';
import {
  type DraggedGroup,
  GROUP_BOX_PADDING,
  type GroupMoveUpdate,
  computeGroupMoveUpdates,
  isMemberOfGroup,
  planGroupShortcutAction,
  selectGroupSelection,
  selectGroupableSet,
} from '../lib/group-ops.ts';
import { applyPackSummaries } from '../lib/icon-registry.ts';
import { resolveGroupChord, resolveHistoryChord } from '../lib/keyboard-shortcuts.ts';
import { DEFAULT_STORAGE_PREFIX, getLastUsedStyle } from '../lib/last-used-style.ts';
import { NEW_NODE_BORDER_WIDTH } from '../lib/node-defaults.ts';
import { ComponentNode } from '../nodes/component-node.tsx';
import {
  type Point,
  boundingBox,
  isAccidentalStroke,
  normalizePoints,
  simplifyRDP,
  snapToStraightLine,
} from '../nodes/freehand-geometry.ts';
import { FreehandNode } from '../nodes/freehand-node.tsx';
import { LineNode } from '../nodes/line-node.tsx';
import {
  GeometricNode,
  SHAPE_DEFAULT_SIZE,
  resolveIllustrativeColors,
  shapeChromeClass,
  shapeChromeStyle,
} from '../nodes/geometric-node.tsx';
import { GROUP_NODE_Z_INDEX, GroupNode } from '../nodes/group-node.tsx';
import { HtmlNode } from '../nodes/html-node.tsx';
import { ICON_DEFAULT_SIZE, IconNode } from '../nodes/icon-node.tsx';
import { ImageNode } from '../nodes/image-node.tsx';
import { LINKFLOW_DEFAULT_SIZE, LINKFLOW_MIN_SIZE, LinkflowNode } from '../nodes/linkflow-node.tsx';
import { RectangleNode } from '../nodes/rectangle-node.tsx';
import { ILLUSTRATIVE_SHAPE_RENDERERS } from '../nodes/shapes/registry.ts';
import type { ResizeAlignmentHooks } from '../nodes/use-resize-gesture.ts';
import type {
  CanvasMode,
  Connector,
  DrawableNodeType,
  EdgePin,
  FlowNode,
  GeometricNodeType,
  NodeStatus,
  StatusReport,
} from '../types.ts';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '../ui/context-menu.tsx';
import { IconRegistryProvider } from '../ui/icon.tsx';
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover.tsx';
import { CanvasPortalContainerProvider } from './canvas-portal-container.tsx';
import { CanvasToolbar, HTML_BLOCK_DND_TYPE, TOOLBAR_SHAPES } from './canvas-toolbar.tsx';
import { DetailPanel } from './detail-panel.tsx';
import { GlowOverlay } from './glow-overlay.tsx';
import { IconRenderer } from './icon-renderer.tsx';
import { InspectorToggle } from './inspector-toggle.tsx';
import {
  type MultiResizeUpdate,
  type OverlayInputNode,
  SELECTION_OVERLAY_PADDING,
  SelectionResizeOverlay,
} from './selection-resize-overlay.tsx';
import { ShareMenu } from './share-menu.tsx';
import { type ConnectorStylePatch, type NodeStylePatch, StyleStrip } from './style-strip.tsx';

import '@xyflow/react/dist/style.css';

/**
 * US-027: canvas operating mode. `edit` is the studio default — every chrome
 * affordance renders and every mutation handler is live. `view` is the
 * embedder-facing read-only mode — chrome is suppressed, editing handlers
 * inert, but pan/zoom and SSE-driven status badges still work so the canvas
 * remains a useful presentation surface. `mini` is the static-preview mode
 * for thumbnails — every chrome affordance is off (incl. the bottom-left
 * Controls cluster), all input is inert (no pan, zoom, selection, or node
 * drag), and auto-fit defaults to ON so the flow frames itself.
 */
export type SeeflowCanvasMode = 'edit' | 'view' | 'mini';

/**
 * US-027: per-feature override flags. Each flag is optional; when unset the
 * effective value comes from the mode preset in {@link resolveFlags}. Use these
 * to surgically toggle a chrome affordance or interaction without flipping the
 * whole canvas into the other mode (e.g. a mostly-`view` canvas that still
 * lets the user pan but with status badges hidden).
 *
 * `storageKey` is a pass-through for future canvas-side persistence (e.g. a
 * future viewport memory). It is currently unused inside demo-canvas; the
 * studio's last-used-style namespace lives in `demo-view.tsx` via
 * `DEFAULT_STORAGE_PREFIX` and is unaffected by this prop.
 */
export interface CanvasFeatureOverrides {
  showToolbar?: boolean;
  showStyleStrip?: boolean;
  showDetailPanel?: boolean;
  showStatusBadges?: boolean;
  showResizeHandles?: boolean;
  /**
   * Gates the bottom-left zoom/fit/tidy `<Controls>` cluster. Default ON for
   * `edit` and `view`, OFF for `mini` (thumbnails want no chrome).
   */
  showControls?: boolean;
  /**
   * Gates the top-right `<ShareMenu>` dropdown (Download PDF / PNG / Embed /
   * Export to seeflow.dev). Default ON for `edit` and `view` (downloads and
   * embed are useful for both edit and read-only consumers), OFF for `mini`
   * (thumbnails want no chrome). The menu's own internal rules still filter
   * items by mode + the presence of each callback / `projectId`.
   */
  showShareMenu?: boolean;
  /**
   * Gates React Flow's bottom-right `<MiniMap>` overview (the outline / high-
   * level box). Default ON for `edit` and `view` — helps users orient
   * themselves in large flows. Default OFF for `mini` since the canvas IS the
   * thumbnail; nesting a minimap inside it would be redundant chrome.
   */
  showMiniMap?: boolean;
  /**
   * Gates the Embed item (and the inner EmbedDialog mount) inside the top-right
   * ShareMenu. Default OFF for every mode — Embed is a SeeFlow-studio-specific
   * affordance and most embedders of this package should not surface the
   * iframe-snippet dialog. Set to `true` to opt in (works in both `edit` and
   * `view` modes); the item still requires a `projectId` to actually render.
   */
  enableEmbed?: boolean;
  enableKeyboard?: boolean;
  enableContextMenu?: boolean;
  enableDragDrop?: boolean;
  enableImageDrop?: boolean;
  enableZoom?: boolean;
  enablePan?: boolean;
  /**
   * Gates `<ReactFlow>` `elementsSelectable` + `selectionOnDrag`. Default ON
   * for `edit` and `view` (clicking and marquee-selecting a node opens the
   * inspector / mirrors selection upward); OFF for `mini` so thumbnail
   * clicks are inert.
   */
  enableSelection?: boolean;
  /**
   * Gates `<ReactFlow>` `nodesDraggable`. Default ON for `edit` and `view`
   * (view-mode drag is local-state-only — no PATCH dispatched); OFF for
   * `mini` so the thumbnail is fully static.
   */
  enableNodeMove?: boolean;
  /**
   * Miro/Figma-style alignment guides + snap during node drag / resize. When
   * on, dragging (or resizing) a node renders colored guidelines as its
   * edges/centers align with other nodes and snaps into alignment within
   * {@link alignmentSnapThreshold} screen pixels. Default ON for `edit`, OFF
   * for `view` and `mini`. Holding Cmd/Ctrl suppresses both guides and snap
   * for a single gesture.
   */
  enableAlignmentGuides?: boolean;
  /**
   * Snap threshold in *screen* pixels for {@link enableAlignmentGuides}. No
   * mode preset — the alignment hook falls back to `6` when unset.
   */
  alignmentSnapThreshold?: number;
  storageKey?: string;
}

/**
 * US-027: every flag resolved to a concrete boolean. The render body of
 * {@link SeeflowCanvas} reads exclusively from this shape so the gating logic is
 * a single hop away from the mode preset + the overrides.
 */
export interface ResolvedCanvasFlags {
  showToolbar: boolean;
  showStyleStrip: boolean;
  showDetailPanel: boolean;
  showStatusBadges: boolean;
  showResizeHandles: boolean;
  showControls: boolean;
  showShareMenu: boolean;
  showMiniMap: boolean;
  enableKeyboard: boolean;
  enableContextMenu: boolean;
  enableDragDrop: boolean;
  enableImageDrop: boolean;
  enableZoom: boolean;
  enablePan: boolean;
  enableSelection: boolean;
  enableNodeMove: boolean;
  enableEmbed: boolean;
  enableAlignmentGuides: boolean;
  // No preset default — the alignment hook falls back to 6 when undefined.
  alignmentSnapThreshold?: number;
}

const EDIT_DEFAULTS: ResolvedCanvasFlags = {
  showToolbar: true,
  showStyleStrip: true,
  showDetailPanel: true,
  showStatusBadges: true,
  showResizeHandles: true,
  showControls: true,
  showShareMenu: true,
  showMiniMap: true,
  enableKeyboard: true,
  enableContextMenu: true,
  enableDragDrop: true,
  enableImageDrop: true,
  enableZoom: true,
  enablePan: true,
  enableSelection: true,
  enableNodeMove: true,
  // Embed is a SeeFlow-studio-specific affordance — opt-in even in edit mode.
  enableEmbed: false,
  // Alignment guides + snap are an editing affordance — on by default in edit.
  enableAlignmentGuides: true,
};

const VIEW_DEFAULTS: ResolvedCanvasFlags = {
  // View mode renders a slimmed-down toolbar with only the Select + Hand
  // navigation tools — no shape-creation affordances. The actual shape-tool
  // hiding happens via `showShapeTools` threaded into <CanvasToolbar> below;
  // this flag just gates the toolbar's outer Panel.
  showToolbar: true,
  showStyleStrip: false,
  showDetailPanel: false,
  // View mode keeps status badges (driven by SSE) so the canvas can serve as
  // a live monitoring surface — the AC excludes status badges from "chrome".
  showStatusBadges: true,
  showResizeHandles: false,
  // View mode keeps the Controls cluster so embedders get zoom-in/zoom-out/
  // fit-view buttons — they're navigation aids, not editing affordances.
  showControls: true,
  // View mode keeps ShareMenu so embedders can still download PDF/PNG; the
  // menu's own mode prop hides Embed + Export to seeflow.dev in view mode.
  showShareMenu: true,
  // View mode keeps the MiniMap — it's a navigation aid that pairs with the
  // pan/zoom that stays on in this mode.
  showMiniMap: true,
  enableKeyboard: false,
  enableContextMenu: false,
  enableDragDrop: false,
  enableImageDrop: false,
  // Pan/zoom remain on in view mode so embedders get a navigable canvas; the
  // gestures don't mutate persisted state.
  enableZoom: true,
  enablePan: true,
  // Selection + local-state drag remain on so view-mode embedders can still
  // click a node to mirror selection up to the host (e.g. open their own
  // inspector) and nudge nodes locally without persisting.
  enableSelection: true,
  enableNodeMove: true,
  // Embed is edit-mode-only inside ShareMenu, so view never surfaces it.
  enableEmbed: false,
  // View mode is read-only — no drag-snap affordances.
  enableAlignmentGuides: false,
};

/**
 * Mini mode preset: every chrome affordance off, every input inert. The
 * canvas renders as a static, auto-fit preview suitable for thumbnails.
 * Consumers can still surgically override via `CanvasFeatureOverrides`
 * (e.g. `showStatusBadges: true` to keep live state visible).
 */
const MINI_DEFAULTS: ResolvedCanvasFlags = {
  showToolbar: false,
  showStyleStrip: false,
  showDetailPanel: false,
  // Status badges off so thumbnails read visually neutral; flip on via
  // override for a live-state preview.
  showStatusBadges: false,
  showResizeHandles: false,
  showControls: false,
  showShareMenu: false,
  // Mini mode IS the thumbnail — nesting a MiniMap inside would be redundant.
  showMiniMap: false,
  enableKeyboard: false,
  enableContextMenu: false,
  enableDragDrop: false,
  enableImageDrop: false,
  enableZoom: false,
  enablePan: false,
  enableSelection: false,
  enableNodeMove: false,
  enableEmbed: false,
  // Thumbnails are static — no alignment guides.
  enableAlignmentGuides: false,
};

/**
 * US-027: resolve the effective flag set from the canvas mode + caller
 * overrides. Pure so it's trivially unit-testable. The function does NOT
 * inspect any SeeflowCanvas prop other than `mode` + the override fields — keeping
 * the contract narrow lets demo-canvas pass exactly the slice it needs and
 * makes the helper safe to import standalone.
 */
export function resolveFlags(
  input: { mode: SeeflowCanvasMode } & Omit<CanvasFeatureOverrides, 'storageKey'>,
): ResolvedCanvasFlags {
  const defaults =
    input.mode === 'edit' ? EDIT_DEFAULTS : input.mode === 'mini' ? MINI_DEFAULTS : VIEW_DEFAULTS;
  return {
    showToolbar: input.showToolbar ?? defaults.showToolbar,
    showStyleStrip: input.showStyleStrip ?? defaults.showStyleStrip,
    showDetailPanel: input.showDetailPanel ?? defaults.showDetailPanel,
    showStatusBadges: input.showStatusBadges ?? defaults.showStatusBadges,
    showResizeHandles: input.showResizeHandles ?? defaults.showResizeHandles,
    showControls: input.showControls ?? defaults.showControls,
    showShareMenu: input.showShareMenu ?? defaults.showShareMenu,
    showMiniMap: input.showMiniMap ?? defaults.showMiniMap,
    enableKeyboard: input.enableKeyboard ?? defaults.enableKeyboard,
    enableContextMenu: input.enableContextMenu ?? defaults.enableContextMenu,
    enableDragDrop: input.enableDragDrop ?? defaults.enableDragDrop,
    enableImageDrop: input.enableImageDrop ?? defaults.enableImageDrop,
    enableZoom: input.enableZoom ?? defaults.enableZoom,
    enablePan: input.enablePan ?? defaults.enablePan,
    enableSelection: input.enableSelection ?? defaults.enableSelection,
    enableNodeMove: input.enableNodeMove ?? defaults.enableNodeMove,
    enableEmbed: input.enableEmbed ?? defaults.enableEmbed,
    enableAlignmentGuides: input.enableAlignmentGuides ?? defaults.enableAlignmentGuides,
    // No preset — pass through verbatim; the hook defaults to 6 when undefined.
    alignmentSnapThreshold: input.alignmentSnapThreshold,
  };
}

/**
 * US-027: every demo-canvas prop OTHER than the discriminator (`mode`) and
 * `adapter` (whose required-ness flips with mode). Extracted so the
 * discriminated union below can attach the mode-specific shape without
 * duplicating ~50 prop definitions.
 */
interface SeeflowCanvasBaseProps extends CanvasFeatureOverrides {
  /**
   * US-037: optional content rendered inside the top-left Panel column ABOVE
   * the toolbar (and StyleStrip) so external floating affordances share the
   * same flex flex-col gap-2 layout as the canvas's own chrome. Used by the
   * studio to mount the FlowSwitcher without overlapping the toolbar. Absent
   * → the Panel renders only its built-in children.
   */
  topLeftSlot?: React.ReactNode;
  /**
   * Optional content rendered inside the top-right Panel to the LEFT of the
   * built-in ShareMenu. Shares the same flex row as ShareMenu (`flex items-
   * center gap-1`) so external affordances (e.g. the studio's FlowSwitcher)
   * sit alongside the share/download cluster. Renders even when
   * `showShareMenu` is off — the host gets a stable mount point for floating
   * chrome regardless of canvas mode.
   */
  topRightSlot?: React.ReactNode;
  /**
   * US-004: project id used by file-backed nodes (type:'image', type:'html')
   * to build project-scoped file URLs via `fileUrl(projectId, path)`. Threaded
   * into each node's runtime `data` so renderers can fetch from
   * `GET /api/projects/:id/files/:path`. Absent → file-backed nodes render
   * without a source URL (e.g. during pre-mount before the parent knows the
   * project id).
   */
  projectId?: string;
  /**
   * Flow slug for the currently-mounted flow. Threaded into each type:'component'
   * node's runtime `data.flowSlug` so script-kind actions can POST to
   * `/api/projects/:project/flows/:flow/nodes/:nodeId/actions/:name`. Absent →
   * the runtime no-ops script dispatches (set-kind actions still work).
   */
  flowSlug?: string;
  /**
   * Optional override for the file-serving URL prefix used by file-backed
   * nodes (type:'image', type:'html'). Default `/api/projects` is correct for the
   * studio (same-origin). Embedders that serve files from a different host
   * or route shape pass an absolute prefix here — e.g. the public viewer
   * passes `https://seeflow.dev/api/flows` so files resolve to
   * `https://seeflow.dev/api/flows/:id/files/:path` instead of falling back
   * to the viewer's own origin. Threaded into each node's runtime `data`
   * alongside `projectId`.
   */
  fileBaseUrl?: string;
  /**
   * Optional host hook that turns a file URL (the one `fileUrl()` builds for a
   * file-backed node) into a displayable src — e.g. fetching it with an auth
   * token and returning a blob URL. Needed in the cloud, where the file route
   * is token-gated and a native `<img>` GET can't carry the bearer header (so
   * it 401s and the image renders broken). Absent → file-backed nodes use the
   * URL directly (local/same-origin, unchanged). Threaded into each node's
   * runtime `data` alongside `projectId` / `fileBaseUrl`.
   */
  resolveFileSrc?: (url: string) => Promise<string>;
  /**
   * Base URL the component-node runtime uses to POST script-kind actions:
   * `${apiBaseUrl}/projects/:project/flows/:flow/nodes/:nodeId/actions/:name`.
   * Defaults to `/api` (correct for the studio, same-origin). Embedders that
   * mount the studio under a different prefix or proxy through another host
   * pass an absolute prefix here. Threaded into `data.apiBaseUrl` for every
   * `type:'component'` node alongside `data.projectSlug = projectId` and
   * `data.flowSlug = flowSlug`.
   */
  apiBaseUrl?: string;
  /**
   * US-013: studio origin used by IconRenderer's `kind:'svg-url'` branch when
   * resolving vendor-prefixed icon ids (`aws:lambda` → `${studioBaseUrl}/api/icons/aws/lambda.svg`).
   * Default `''` (same-origin) is correct when the canvas is hosted by the
   * studio. Embedders pointing the canvas at a remote studio pass that origin
   * here. Threaded through {@link CanvasStudioProvider} so descendants can
   * consume it via `useCanvasStudio()` without prop drilling.
   */
  studioBaseUrl?: string;
  nodes: FlowNode[];
  connectors: Connector[];
  /** Currently selected node ids (US-019: multi-select). */
  selectedNodeIds: readonly string[];
  /** Currently selected connector ids (US-019: multi-select). */
  selectedConnectorIds: readonly string[];
  /**
   * Fired whenever React Flow's internal selection changes (click, marquee,
   * Shift/Cmd-click toggle). The parent mirrors the arrays into its own state.
   */
  onSelectionChange?: (nodeIds: string[], connectorIds: string[]) => void;
  /**
   * US-026: read-only runtime state — per-node SSE `runs`, latest `statuses`,
   * and optimistic `pendingOverrides.{nodes,connectors}` that haven't been
   * reconciled by the server yet. Replaces the per-stream props (`runs`,
   * `statusByNode`, `nodeOverrides`, `connectorOverrides`) so demo-canvas
   * has a single seam for runtime data. Every field is optional; absent →
   * the canvas renders without dynamic chrome (no status badges / overlay
   * indicators), matching the view-mode default.
   */
  runtime?: CanvasRuntime;
  /** Click handler for a PlayNode's Play button. */
  onPlayNode?: (nodeId: string) => void;
  /** Fired once per drag-stop with the node's final position. */
  onNodePositionChange?: (nodeId: string, position: { x: number; y: number }) => void;
  /**
   * US-013: atomic multi-node drag-stop. Fired once per drag-stop with EVERY
   * moved node's final position when the gesture moves more than one node.
   * The parent commits the whole batch as a single undo entry so one Cmd+Z
   * reverts the entire group move. Wiring this is what enables the canvas to
   * route multi-node drags through the batch path; absent → the canvas falls
   * back to per-node `onNodePositionChange` calls (legacy single-undo-per-id
   * behavior).
   */
  onNodePositionsChange?: (updates: { id: string; position: { x: number; y: number } }[]) => void;
  /**
   * Fired on EVERY resize tick during the drag (per-tick). Use this for
   * optimistic local updates (e.g. setNodeOverride) that need to keep the
   * dragged dims in sync mid-gesture. Do NOT call the backend or push undo
   * entries from here — those belong in `onNodeResizeEnd` so one drag
   * produces one PATCH instead of one per tick.
   *
   * Wiring this enables NodeResizer's resize handles inside each custom node.
   * US-012: top/left handle drags shift x/y so the opposite corner stays
   * anchored — persistence must store both the new size and new position.
   */
  onNodeResize?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  /**
   * Fired ONCE at resize-stop (mouse release) with the final dimensions AND
   * position, only when the gesture actually moved (a click on the handle
   * with no movement is guarded out inside `useResizeGesture`). Host should
   * do persistence here: backend PATCH + undo push. Pairs with `onNodeResize`
   * (per-tick optimistic) — together they give live visual feedback during
   * the drag with a single round-trip at the end.
   */
  onNodeResizeEnd?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  /**
   * type:'html'-only: invoked when the user clicks the "Fit to content" button
   * on a user-sized html node. The host's handler typically PATCHes
   * { autoSize: true } through the adapter; the studio's mergeNodeUpdates
   * then strips width/height to maintain the autoSize invariant.
   */
  onHtmlNodeFitToContent?: (nodeId: string) => void;
  /**
   * type:'component'-only: invoked when the user clicks the "Fit to content"
   * button on a user-sized component node. Same shape and semantics as
   * onHtmlNodeFitToContent — the host's handler is type-agnostic, so this is
   * normally wired to the same callback. Kept as a separate prop to mirror
   * the html variant and keep the renderer's `data.onFitToContent` gated on
   * node type at injection time.
   */
  onComponentNodeFitToContent?: (nodeId: string) => void;
  /**
   * US-007: atomic multi-select bounding-box resize. Fired once per resize-stop
   * with EVERY scaled node's final position (and, for sized nodes, width/
   * height). The selection bounding overlay renders when ≥ 2 loose nodes are
   * selected and computes the scale via `scaleNodesWithinRect`; the parent
   * commits the batch as ONE undo entry so Cmd+Z reverts every scaled node
   * together. Locked nodes inside the selection are filtered out of the
   * dispatched updates (the helper passes them through unchanged, so they'd
   * be no-op PATCHes otherwise). When this prop is absent the overlay still
   * renders for visual feedback but resize gestures dispatch nothing —
   * legacy callers that haven't wired the batch path get a no-op gesture
   * (no per-node fallback because there's no defensible single-node
   * substitute for a multi-node scale).
   *
   * M5: the optional second arg flags a GROUP resize (selection is one group →
   * `updates` are its members + the group box). The host reuses the SAME commit
   * helper but labels the undo entry `group-resize` vs `multi-resize`.
   */
  onMultiResize?: (updates: MultiResizeUpdate[], opts?: { isGroup?: boolean }) => void;
  /**
   * Canvas grouping M4: create a group from a loose multi-selection. Fired by
   * the overlay's ＋ icon, the context-menu "Group" item, and ⌘G. The host
   * filters the ids via `selectGroupableSet`, computes the box, and commits ONE
   * `history.batch('group-create', …)` with a single `createNode` carrying the
   * final `childIds` (design §12.7). Absent → the create affordances are hidden.
   */
  onCreateGroup?: (nodeIds: string[]) => void;
  /**
   * Canvas grouping M4: dissolve a group. Fired by the overlay's ⊟ icon, the
   * context-menu "Ungroup" item, and ⌘⇧G. The host commits ONE
   * `history.batch('ungroup', () => adapter.deleteNode(groupId))`; children are
   * untouched (absolute positions) and reselected. Absent → ungroup hidden.
   */
  onUngroup?: (groupId: string) => void;
  /** Persist a new node name (PATCH /nodes/:id { name }). */
  onNodeNameChange?: (nodeId: string, name: string) => void;
  /** Persist a new node description (PATCH /nodes/:id { description }). */
  onNodeDescriptionChange?: (nodeId: string, description: string) => void;
  /** Persist a new image-node caption (PATCH /nodes/:id { data.caption }). */
  onNodeCaptionChange?: (nodeId: string, caption: string) => void;
  /** Persist a new connector label (PATCH /connectors/:id { label }). */
  onConnectorLabelChange?: (connId: string, label: string) => void;
  /**
   * Commit a new shape node from the bottom-toolbar draw flow. Wiring this
   * enables the toolbar; absent → toolbar is hidden.
   */
  onCreateShapeNode?: (
    shape: GeometricNodeType,
    position: { x: number; y: number },
    dims: { width: number; height: number },
  ) => void;
  /**
   * Commit a new `type:'icon'` node from the toolbar's draw-icon flow. The
   * Insert-icon popover no longer auto-inserts at viewport center — picking
   * an icon arms `canvasMode = { kind:'draw-icon', iconName }` and the next
   * click/drag on the pane commits here with the drawn rect (or a near-zero
   * tap falls back to the icon's default size). Wiring this enables the
   * draw-on-canvas behavior; absent → the canvas commits nothing on
   * pointer-up while in draw-icon mode (the picker can still be wired
   * standalone via `onPickIcon` for hosts that prefer the auto-insert path).
   */
  onCreateIconNode?: (
    iconName: string,
    position: { x: number; y: number },
    dims: { width: number; height: number },
  ) => void;
  /**
   * Commit a new `type:'freehand'` node from the pen tool. `position` is the
   * stroke's top-left in flow coords; `size` is its flow-space bounding box;
   * `points` are normalized to that box ([x, y, pressure] with x/y in 0..1).
   * Wiring this enables freehand capture while `canvasMode.kind === 'pen'`;
   * absent → strokes are captured + previewed but never committed.
   */
  onCreateFreehandNode?: (
    position: { x: number; y: number },
    size: { width: number; height: number },
    points: Point[],
  ) => void;
  /**
   * Commit a new `type:'line'` node from the toolbar's Line tile. `position` is
   * the line's bounding-box top-left in flow coords; `size` is the flow-space
   * box; `points` are the two endpoints normalized to that box ([x, y] with
   * x/y in 0..1). Wiring this enables the Line tile; absent → the tile commits
   * nothing on pointer-up.
   */
  onCreateLineNode?: (
    position: { x: number; y: number },
    size: { width: number; height: number },
    points: [[number, number], [number, number]],
  ) => void;
  /**
   * Commit a new `type:'linkflow'` node from the bottom-toolbar's Link node
   * tile. The parent owns id allocation, optimistic override, and the
   * createNode persistence; the canvas hands the final flow-space position
   * and dimensions (already clamped to {@link LINKFLOW_MIN_SIZE} for
   * meaningful drags, or {@link LINKFLOW_DEFAULT_SIZE} on a near-zero
   * tap). The parent is also responsible for surfacing the picker dialog
   * via the linkflow node's `data._autoOpenPickerOnMount` runtime hook
   * (see linkflow-node.tsx) — this callback is purely "make the node".
   *
   * Absent → the Link node tile in the toolbar still appears (the toolbar
   * is bound to {@link onCreateShapeNode}) but a commit no-ops.
   */
  onCreateLinkflowNode?: (
    position: { x: number; y: number },
    dims: { width: number; height: number },
  ) => void;
  /**
   * US-008: commit a new type:'image' node from an OS-image file drop. The canvas
   * detects the drop, computes the natural dims (capped at 400px longest side),
   * and projects the drop client-position into flow-space; the parent owns id
   * allocation, optimistic override, upload POST, and createNode persistence.
   * Wiring this enables the drop handler; absent → OS image drops are ignored.
   */
  onCreateImageFromFile?: (args: {
    file: File;
    position: { x: number; y: number };
    dims: { width: number; height: number };
    originalFilename: string;
  }) => void;
  /**
   * US-008: dispatched when the user clicks the 'Upload failed (click to
   * retry)' placeholder on a type:'image' node whose initial upload failed.
   * Receives the node id; the parent retries the upload using the file
   * reference stored in its retry map. Threaded into every image node's
   * runtime data so the renderer can call it on click.
   */
  onRetryImageUpload?: (nodeId: string) => void;
  /**
   * Replace the image on an EXISTING image node. Dispatched when the user
   * drops a new image directly onto an image node, or picks a file from the
   * "Replace image" control in the sidebar. The host uploads the file to the
   * same node id and repoints `data.path` (an undoable PATCH). Absent → the
   * replace affordances are suppressed.
   */
  onReplaceImage?: (nodeId: string, file: File) => void;
  /**
   * US-017: commit a new type:'html' node at the drop position from the
   * toolbar's HTML block tile (HTML5 drag-and-drop). The canvas detects the
   * {@link HTML_BLOCK_DND_TYPE} dataTransfer marker on the wrapper drop
   * handler, projects the drop clientX/Y into flow space, and dispatches
   * here. The parent owns id allocation, optimistic override, and the
   * createNode persistence (server fills `data.html` per US-015). Wiring
   * this enables the HTML block toolbar tile; absent → the section is
   * hidden and any stray drop is a no-op.
   */
  onCreateHtmlNode?: (args: { position: { x: number; y: number } }) => void;
  /**
   * Commit a new connector from a handle-drag gesture. Wiring this enables
   * `nodesConnectable` on the React Flow instance; absent → handles are
   * read-only. Self-connections (source === target) are rejected here so the
   * parent never sees them.
   *
   * `options.targetPin` (when set) anchors the new connector's target end at
   * a specific perimeter `(side, t)` on the target node — the body-drop
   * fallback fills it in by projecting the cursor onto the target node's
   * perimeter (user rule: "cursor over node → closest perimeter point"). The
   * source stays floating (no pin) since the source node was fixed by where
   * the drag started, not chosen by cursor position.
   */
  onCreateConnector?: (source: string, target: string, options?: { targetPin?: EdgePin }) => void;
  /**
   * Reattach an existing connector's source or target to a different node, or
   * to a different handle on the same node. Wired enables React Flow's edge
   * reconnect gesture: drag an edge endpoint onto another handle to call this
   * with the new source/target/handle ids. The patch only includes the fields
   * that changed; same-node handle changes surface as `sourceHandle`-only or
   * `targetHandle`-only patches (US-002).
   *
   * US-025: a precise-handle-dot drop pins the moved endpoint
   * (`sourceHandle`/`targetHandle` set, `*HandleAutoPicked: false`). A
   * body-drop reconnect keeps the endpoint floating
   * (`sourceHandle`/`targetHandle: null` to clear any prior pin,
   * `*HandleAutoPicked: true`). `null` is the wire-format signal to clear
   * the field on disk.
   */
  onReconnectConnector?: (
    connectorId: string,
    patch: {
      source?: string;
      target?: string;
      sourceHandle?: string | null;
      targetHandle?: string | null;
      sourceHandleAutoPicked?: boolean;
      targetHandleAutoPicked?: boolean;
      /**
       * Reattach-and-pin (endpoint-dot drag onto a different node): set
       * alongside `source`/`target` so the new perimeter pin lands in a
       * single PATCH + undo entry. `null` clears any prior pin on disk.
       */
      sourcePin?: EdgePin | null;
      targetPin?: EdgePin | null;
    },
  ) => void;
  /**
   * Reorder a node within demo.nodes[]. Wiring this enables the right-click
   * context-menu z-order actions (Bring to front, Bring forward, Send backward,
   * Send to back). The parent owns the optimistic + persistence wiring; the
   * canvas just translates the menu pick into this callback.
   */
  onReorderNode?: (nodeId: string, op: ReorderOp) => void;
  /**
   * Delete a node from the canvas. Wiring this enables the right-click
   * context menu's Delete entry; the same callback DetailPanel invokes for
   * keyboard-driven deletes.
   */
  onDeleteNode?: (nodeId: string) => void;
  /**
   * Copy a node into the in-app clipboard. Wiring this enables the
   * right-click context menu's Copy entry. The canvas hands the right-clicked
   * node id directly; multi-select copy is up to the parent (today's parent
   * supports single-select only).
   */
  onCopyNode?: (nodeId: string) => void;
  /**
   * Paste from the in-app clipboard at a specific flow-space position (cursor
   * location of the right-click). When the parent's clipboard is empty the
   * call is a no-op. Keyboard paste (Ctrl/Cmd+V) is owned by the parent and
   * doesn't go through this prop — the parent uses a +24,+24 offset there.
   */
  onPasteAt?: (flowPos: { x: number; y: number }) => void;
  /** True when the in-app clipboard has content (drives the Paste item's
   * disabled state). Snapshot-checked at menu-open time, not subscribed —
   * the menu re-renders on every open via `contextMenuPos` setState. */
  hasClipboard?: boolean;
  /**
   * US-022: copy every currently-selected node into the in-app clipboard.
   * Triggered by the Cmd/Ctrl+C keyboard handler owned by this canvas (the
   * right-click menu still uses the single-id `onCopyNode` above). Receives
   * the live `selectedNodeIds` array; absent → the shortcut is a no-op.
   */
  onCopySelection?: (nodeIds: string[]) => void;
  /**
   * US-022: paste the in-app clipboard at a +24,+24 offset (no flowPos —
   * keyboard pastes don't anchor on the cursor, unlike the right-click
   * `onPasteAt` above). Absent → the shortcut is a no-op.
   */
  onPasteSelection?: () => void;
  /**
   * Currently selected nodes (with optimistic overrides applied) — drives the
   * canvas style strip's controls and fan-out apply (US-019). Empty when no
   * node is selected.
   */
  selectedNodes?: FlowNode[];
  /**
   * Currently selected connectors (with optimistic overrides applied) — drives
   * the canvas style strip's controls and fan-out apply (US-019). Empty when
   * no connector is selected.
   */
  selectedConnectors?: Connector[];
  /** Apply a style patch to a node (border/background/font). */
  onStyleNode?: (nodeId: string, patch: NodeStylePatch) => void;
  /** Live preview override during a slider drag (no PATCH/undo). */
  onStyleNodePreview?: (nodeId: string, patch: NodeStylePatch) => void;
  /** US-008: atomic multi-node apply (single undo entry). */
  onStyleNodes?: (nodeIds: string[], patch: NodeStylePatch) => void;
  /** US-008: live preview for a multi-node selection. */
  onStyleNodesPreview?: (nodeIds: string[], patch: NodeStylePatch) => void;
  /** Apply a style patch to a connector (color/style/direction/path/width). */
  onStyleConnector?: (connId: string, patch: ConnectorStylePatch) => void;
  /** Live preview override during a slider drag (no PATCH/undo). */
  onStyleConnectorPreview?: (connId: string, patch: ConnectorStylePatch) => void;
  /**
   * Receive the React Flow instance once it has mounted (US-024). Lets the
   * page-level keyboard handler call zoom methods (`fitView`, `zoomIn`,
   * `zoomOut`) without owning the canvas itself. Called once per mount.
   */
  onRfInit?: (instance: ReactFlowInstance) => void;
  /**
   * Run the auto-layout (Tidy) action against the canvas (US-026). When
   * omitted, the toolbar's Tidy button renders disabled (no demo loaded).
   * Scope is decided by the caller (selection-aware in `demo-view`).
   */
  onTidy?: () => void;
  /**
   * US-003: fired on a real click on a node (mousedown + mouseup without
   * crossing the drag threshold). React Flow's `onNodeClick` fires only for
   * actual clicks — drags don't trigger it — so this is the channel parents
   * use to drive the detail panel without coupling it to selection.
   */
  onNodeClick?: (nodeId: string) => void;
  /**
   * US-003: fired on a real click on a connector. Mirrors `onNodeClick` for
   * edges — used by the parent to open the detail panel for an edge without
   * tying panel state to multi-select changes.
   */
  onConnectorClick?: (connectorId: string) => void;
  /**
   * US-003: fired on a click on the empty canvas pane. Used by the parent to
   * close the detail panel and clear the open-target.
   */
  onPaneClick?: () => void;
  /**
   * US-015: commit a new shape node at the drop position AND wire a connector
   * from the drag's source node to the new node, all as a single undo entry.
   * Wiring this enables the drop-on-pane popover; absent → drop on pane no-ops
   * (legacy behaviour). The parent owns id generation, optimistic overrides,
   * persistence, and the single undo-stack push. The canvas hands over the
   * drag's source node id, the drop position in flow space, and the picked
   * shape; the new node's id is owned by the parent so it can drive
   * `pendingEditNodeId` for the auto-edit-on-mount affordance.
   */
  onCreateAndConnectFromPane?: (args: {
    sourceNodeId: string;
    position: { x: number; y: number };
    shape: GeometricNodeType;
  }) => void;
  /**
   * US-015: id of the most recently created node that should mount directly in
   * inline label-edit mode (the drop-popover create flow). Injected into the
   * matching node's data as `autoEditOnMount: true`; consumed once on mount by
   * the node component. Subsequent renders are unaffected even if the parent
   * leaves the id pinned.
   */
  pendingEditNodeId?: string | null;
  /**
   * US-013/015 (icon picker): controlled-open state for the toolbar's Insert
   * icon popover. Wired through to `<CanvasToolbar>` unchanged. The parent
   * (demo-view) owns the state slice + pick handler so the detail panel,
   * the right-click "Change icon" menu item (US-003) can all dispatch into
   * the same picker.
   */
  iconPickerOpen?: boolean;
  /** Open the picker in insert mode (toolbar button click). */
  onOpenIconPicker?: () => void;
  /** Close the picker (Esc / outside click / post-pick). */
  onCloseIconPicker?: () => void;
  /** Handle a tile-pick from the popover (mode + viewport are owned upstream). */
  onPickIcon?: (name: string) => void;
  /**
   * US-003: dispatched by the right-click "Change icon" menu item on a
   * type:'icon' node. The canvas uses this from the menu's onSelect to
   * request the picker open in replace mode for that node. Same handler the
   * detail panel's "Change icon…" button uses (US-015), just a different
   * entry point. Absent → the menu item is hidden. (Previously US-016 also
   * wired this onto type:'icon' dblclick; US-004 replaced that path with
   * inline label edit and the picker is now reachable only via the
   * right-click menu and the StyleStrip button.)
   */
  onRequestIconReplace?: (nodeId: string) => void;
  /**
   * US-007: persist a new perimeter pin for the named endpoint. Called when
   * a reconnect drag releases the endpoint on its OWN node (the one the
   * endpoint was already attached to) — onReconnectEndCb projects the
   * cursor onto that node's perimeter and forwards the resulting `(side, t)`.
   * Parent owns the optimistic override, PATCH, and undo entry. Absent →
   * same-node releases are a no-op.
   */
  onPinEndpoint?: (
    connectorId: string,
    kind: 'source' | 'target',
    pin: { side: 'top' | 'right' | 'bottom' | 'left'; t: number },
  ) => void;
  /**
   * US-007: clear an existing pin for the named endpoint. Wired enables the
   * right-click "Unpin" context menu item on a pinned endpoint dot. Parent
   * owns the optimistic override, PATCH (with `null` to clear on disk), and
   * undo entry. Absent → the menu item is hidden.
   */
  onUnpinEndpoint?: (connectorId: string, kind: 'source' | 'target') => void;
  /**
   * Canvas interaction mode, lifted to the parent so the page-level keyboard
   * handler (`resolveToolShortcut` in demo-view.tsx) and the command palette
   * can drive tool switches without the canvas owning the state. Distinct from
   * the chrome `mode` prop above (`edit`/`view`/`mini`) — this controls
   * Select/Hand/Draw tool state. Modes: `select` (neutral default;
   * click/marquee selects, pane-drag pans), `hand` (locks node interaction;
   * left-drag pans), `draw` (carries the armed shape).
   */
  canvasMode: CanvasMode;
  onCanvasModeChange: (next: CanvasMode) => void;
  /**
   * US-007: hide the built-in DetailPanel sidebar entirely. View-mode embeds
   * and hosts that supply their own inspector set this to true. When false (or
   * unset) the canvas renders {@link DetailPanel} as part of its own layout,
   * driven by `selectedNodeIds[0]` / `selectedConnectorIds[0]`.
   */
  disableSidebar?: boolean;
  /**
   * US-007: latest StatusReport for the currently inspected node, forwarded to
   * the built-in DetailPanel's Status section. The host owns the per-node
   * status map and slices it down to the single selected entry. Undefined when
   * the selected node has no statusAction or hasn't emitted yet.
   */
  statusReport?: StatusReport & { ts: number };
  /**
   * US-007: persist a new node name from a DetailPanel edit. Mirrors
   * {@link onNodeNameChange} (the inline-on-canvas edit handler) — both share
   * the same coalesce key in the parent so a typing session across the canvas
   * and sidebar produces a single undo entry. Absent → the panel's name field
   * renders read-only.
   */
  onNameChange?: (nodeId: string, value: string) => void;
  /**
   * US-007: persist a new node description from a DetailPanel edit. Mirrors
   * {@link onNodeDescriptionChange}. Absent → the panel's description field
   * renders read-only.
   */
  onDescriptionChange?: (nodeId: string, value: string) => void;
  /**
   * US-007: persist a new node detail (long-form notes) from a DetailPanel
   * edit. No on-canvas equivalent today — the detail field is sidebar-only.
   * Absent → the panel's detail field renders read-only.
   */
  onDetailChange?: (nodeId: string, value: string) => void;
  /**
   * US-009: persist a new icon name from the DetailPanel icon picker. `null`
   * clears the field on disk. Absent → the panel's icon row is hidden
   * (mirrors the read-only treatment of onNameChange / onDescriptionChange).
   */
  onIconChange?: (nodeId: string, icon: string | null) => void;
  /**
   * US-008: opt-in viewport auto-fit. `undefined` / `false` → no auto-fit.
   * `true` → fit on initial mount (after rfInstance is ready and
   * `nodes.length > 0`); future stories extend this to also fit on external
   * node changes via `autoFitViewSignal`. Pass an object to enable each
   * trigger independently (e.g. `{ onMount: false }` to skip the mount-fit
   * but still react to the signal). See {@link resolveAutoFitView}.
   */
  autoFitView?: AutoFitView;
  /**
   * US-009: host-bumped counter that triggers an external-change fit. Bump
   * (any monotonic change) when an SSE / adapter update inserts or deletes
   * nodes so the viewport re-frames around the new graph. Only effective
   * when {@link autoFitView} resolves `onExternalNodeChange` to `true`. The
   * very first observed value is treated as the baseline and never fits
   * (so this doesn't double-fire with the mount-fit). If the signal bumps
   * while a node drag or resize is in flight, the fit is deferred and
   * flushed once the interaction ends.
   */
  autoFitViewSignal?: number;
  /**
   * US-004: host-registered custom icon components reachable by name from
   * JSON-defined demos. The map is exposed to every <Icon> descendant via
   * {@link IconRegistryProvider}; resolution order inside <Icon> is
   * `as` prop → this map → built-in {@link ICON_REGISTRY} → fallback. Absent
   * → only built-in lucide icons resolve.
   */
  customIcons?: Record<string, ComponentType<LucideProps>>;
  /**
   * US-014: opt-in callback that wires the "Export to seeflow.dev" item in
   * the canvas's built-in ShareMenu. Edit-mode-only (the ShareMenu enforces
   * the visibility rule internally) so view embedders never see the cloud
   * upload affordance. Absent → the item is hidden.
   */
  onExportToCloud?: () => void;
  /**
   * Open the host's "share with people" dialog. Generic opt-in: wired into the
   * canvas's built-in ShareMenu whenever this callback is set, in BOTH edit and
   * view mode (the cloud viewer mounts the canvas in view mode). The canvas
   * knows nothing about grants — it just fires the callback. Absent → the item
   * is hidden.
   */
  onShareWithMembers?: () => void;
  /**
   * Telemetry: fired once when any node drag begins. Pure passthrough — the
   * canvas's internal `draggingRef` bookkeeping runs regardless. Wired by the
   * MCP App so the host model receives a drag-in-progress signal via
   * `updateModelContext`. Absent → no telemetry, no behavioral change.
   */
  onNodeDragStart?: () => void;
  /**
   * Telemetry: fired once when any node drag ends. Pure passthrough — the
   * canvas's internal commit + flush logic runs regardless. Distinct from
   * `onNodePositionChange` (which carries the new position and may not fire
   * when the drag was a click without movement) — `onNodeDragStop` always
   * fires on drag release. Wired by the MCP App for drag-end telemetry.
   * Absent → no telemetry.
   */
  onNodeDragStop?: () => void;
  /**
   * Telemetry: fired on every React Flow `onMove` tick with the current
   * viewport. Pure passthrough — the canvas's internal pan/zoom side effects
   * (drop-popover dismiss, --rf-zoom CSS var) run regardless. Wired by the
   * MCP App so the host model receives debounced viewport updates via
   * `updateModelContext`. Absent → no telemetry.
   */
  onViewportChange?: (viewport: { x: number; y: number; zoom: number }) => void;
  /**
   * Internal undo/redo state, produced by `wrapAdapterWithHistory`. When
   * supplied, the canvas subscribes for `{canUndo, canRedo}` snapshots
   * (driving the toolbar + command palette enable predicates) and routes
   * Cmd+Z / Cmd+Shift+Z / Cmd+Y through `history.undo()` / `history.redo()`.
   * When absent, undo is unavailable — the keyboard chord falls through to
   * the host or browser. There is no host-owned fallback path.
   */
  history?: HistoryHandle;
}

/**
 * US-014: imperative handle exposed through `forwardRef`. Lets a host call the
 * canvas's export actions and open the embed dialog without owning the
 * underlying state — useful for command palettes / keyboard shortcuts /
 * external menus where the in-canvas ShareMenu chrome is not the entry point.
 */
export interface SeeflowCanvasHandle {
  /** Capture the viewport and save a PDF. Errors surface inline in the canvas. */
  exportPdf(): Promise<void>;
  /** Capture the viewport and save a PNG. Errors surface inline in the canvas. */
  exportPng(): Promise<void>;
  /**
   * Open the embed-snippet dialog programmatically. No-op when the canvas is
   * not rendering its ShareMenu chrome (mini mode or `showShareMenu: false`)
   * OR when `enableEmbed` is false (Embed defaults to opt-in) — in either
   * case the dialog is not mounted, so toggling state has nothing to render.
   */
  openEmbedDialog(): void;
  /**
   * Capture the current viewport as a PNG data URL without triggering a
   * download. Resolves to `undefined` when the canvas is not fully mounted.
   * Hosts use this to feed a preview thumbnail into their own
   * "Export to seeflow.dev" dialog while keeping the capture path
   * (fit-view + snapshot + restore) co-located with the canvas.
   */
  capturePreview(): Promise<string | undefined>;
  /**
   * Paste image file(s) from a clipboard `DataTransfer` (e.g. a native
   * `paste` event's `clipboardData`) as image node(s). Reuses the same
   * drop pipeline as an OS image drop, dropping at the canvas wrapper's
   * center (a keyboard paste carries no cursor coordinates). No-op when
   * image-drop is unwired/disabled or the canvas isn't fully mounted.
   */
  pasteImageFromClipboard(dataTransfer: DataTransfer): void;
}

/**
 * US-027: discriminated union — edit mode requires `adapter` (REST
 * `CanvasAdapter`). View and mini modes accept it as optional — a view-mode
 * embedder has no mutations to persist and a thumbnail dispatches nothing.
 * All arms share {@link SeeflowCanvasBaseProps}; the discriminator + the
 * adapter-shape presence are the only differences.
 */
export type SeeflowCanvasProps =
  | (SeeflowCanvasBaseProps & { mode: 'edit'; adapter: CanvasAdapter })
  | (SeeflowCanvasBaseProps & { mode: 'view'; adapter?: CanvasAdapter })
  | (SeeflowCanvasBaseProps & { mode: 'mini'; adapter?: CanvasAdapter });

// Below this threshold we treat the gesture as an accidental click / tiny
// nudge and create the shape at SHAPE_DEFAULT_SIZE instead — a single click
// still produces a usable node rather than a 0×0 ghost.
const MIN_DRAW_SIZE = 40;

// The Shift-to-constrain draw gesture squares / aspect-locks the drag box via
// `perfectDragBox` + `perfectShapeAspect` (see ../lib/draw-constrain.ts): a
// rectangle draws a perfect square, an ellipse a perfect circle, and a triangle
// / hexagon their equilateral-/regular-proportioned forms.

// Event time (ms) for a draw sample. Real pointer events carry a monotonic
// `timeStamp`; the hook-shim synthetic events used in tests don't, so fall back
// to Date.now(). Only intra-gesture deltas matter, so the clock need only be
// consistent within a single gesture.
function drawSampleTime(e: { timeStamp?: number }): number {
  return typeof e.timeStamp === 'number' ? e.timeStamp : Date.now();
}

// Pen Shift-to-straighten grace window (ms). Releasing the mouse button often
// jerks the pointer and can lift Shift a hair before the button — the final
// pointer event then carries `shiftKey: false`, which would otherwise commit a
// curvy stroke even though the user drew (and saw) a straight line. As long as
// Shift was held within this window before release, the stroke still
// straightens. Tuned to absorb release jitter without making a deliberate
// "release Shift then keep drawing curvy" feel sticky.
const PEN_SHIFT_GRACE_MS = 200;

// Linkflow uses a tighter "is this a tap?" threshold than geometric shapes
// because its minimum legible size is already 160×80 — any drag below 4 screen
// px on either axis is effectively a click, and below that we drop the floor
// entirely in favour of LINKFLOW_DEFAULT_SIZE. Above the threshold the user
// gets the drag rectangle (clamped to LINKFLOW_MIN_SIZE).
const LINKFLOW_NEAR_ZERO_DRAG = 4;

/**
 * US-008: canonical options for every fitView call originating from inside
 * the canvas (manual Fit View button, auto-fit-view on mount, future
 * signal-driven external-change fit). Centralized so the manual and
 * automatic paths cannot drift apart.
 */
export const FIT_VIEW_OPTIONS = {
  padding: 0.15,
  duration: 300,
  includeHiddenNodes: false,
} as const;

/**
 * US-008: granular auto-fit-view config. Both flags default to `true` when the
 * parent value resolves to a truthy `autoFitView` (i.e. `true` or an object).
 * `onMount` fires once on initial mount after the React Flow instance is
 * available and `nodes.length > 0`. `onExternalNodeChange` (wired in US-009)
 * fires when the host bumps `autoFitViewSignal`.
 */
export type AutoFitViewConfig = {
  onMount?: boolean;
  onExternalNodeChange?: boolean;
};

/**
 * US-008: public `autoFitView` prop value. `undefined` / `false` → no
 * auto-fit. `true` → both flags default to `true`. An object lets callers
 * opt into / out of each trigger independently.
 */
export type AutoFitView = boolean | AutoFitViewConfig;

/**
 * US-008: pure resolver — collapse the optional `autoFitView` prop into the
 * concrete pair of booleans every downstream effect reads. Keeps the prop's
 * boolean / object / undefined union out of the rendering hot path and makes
 * the default behavior (both triggers ON when `autoFitView` is truthy)
 * trivially unit-testable.
 */
export function resolveAutoFitView(value: AutoFitView | undefined): {
  onMount: boolean;
  onExternalNodeChange: boolean;
} {
  if (value === undefined || value === false) {
    return { onMount: false, onExternalNodeChange: false };
  }
  if (value === true) {
    return { onMount: true, onExternalNodeChange: true };
  }
  return {
    onMount: value.onMount ?? true,
    onExternalNodeChange: value.onExternalNodeChange ?? true,
  };
}

/**
 * Resolve the cursor's screen-space coordinates from the mouse/touch event
 * union React Flow forwards into onConnectEnd / onReconnectEnd. Returns null
 * when neither branch carries a position (touch event with empty changedTouches
 * is the only practical case).
 */
const cursorFromConnectEvent = (
  e: MouseEvent | TouchEvent,
): { clientX: number; clientY: number } | null => {
  if ('clientX' in e) return { clientX: e.clientX, clientY: e.clientY };
  const touch = e.changedTouches[0] ?? e.touches[0];
  return touch ? { clientX: touch.clientX, clientY: touch.clientY } : null;
};

/**
 * Walk the elementsFromPoint stack and return the topmost `.react-flow__node`
 * wrapper under the cursor (or null if none). Used for body-drop fallbacks
 * where React Flow's `connectionRadius` was too small to snap to a handle.
 */
const nodeElAtPoint = (clientX: number, clientY: number): Element | null => {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const el of stack) {
    const nodeEl = (el as HTMLElement).closest?.('.react-flow__node');
    if (nodeEl) return nodeEl;
  }
  return null;
};

/**
 * Drop-buffer (in CSS pixels) for "near-miss" connect/reconnect releases.
 * The user originally asked for this ("give some buffer so that even if you
 * drop the mouse out of a node, if it is still close, then still connect to
 * it"), then later asked for a tighter zone. 24 px is wide enough to forgive
 * a trackpad overshoot while keeping the magnetism contained: it sits just
 * under xyflow's `connectionRadius={32}` (so handle-snap remains the wider
 * affordance) and is roughly one outlet-dot away from the node bbox, which
 * is the visual distance users perceive as "still close." Intentional empty-
 * space drops past that distance no longer get pulled toward a neighbour.
 */
const RECONNECT_BUFFER_PX = 15;

/**
 * Screen-px radius within which a dragged connector endpoint snaps to a
 * perfectly horizontal/vertical line with the fixed (un-moved) endpoint. Read
 * via `STRAIGHT_SNAP_PX / zoom` at every projection site so the snap radius is
 * zoom-independent (like RECONNECT_BUFFER_PX). Applied identically in the live
 * drag preview and both commit paths so what the user sees is what persists.
 */
const STRAIGHT_SNAP_PX = 8;

/**
 * Hit-test for connect/reconnect body drops. Returns the topmost
 * `.react-flow__node` directly under the cursor; if none, falls back to
 * the nearest `.react-flow__node` whose getBoundingClientRect lies within
 * `RECONNECT_BUFFER_PX` of the cursor in screen-space. Returns null if no
 * node is within range.
 *
 * Why screen pixels (not flow units): the buffer is a UX affordance about
 * what the user can see and aim at. Defining it in flow units would make
 * the forgiveness zone shrink at high zoom and balloon at low zoom — not
 * what the user means by "if it is still close."
 *
 * Why iterate `wrapper.querySelectorAll('.react-flow__node')` not
 * `rfInstance.getNodes()`: we need each node's CURRENT bounding rect in
 * screen space, which `getBoundingClientRect` gives us directly. Going
 * through the node lookup would require composing positionAbsolute +
 * measured + the viewport transform, all of which the DOM already does
 * for us.
 */
const nodeElNearPoint = (
  wrapper: HTMLElement | null,
  clientX: number,
  clientY: number,
): Element | null => {
  const direct = nodeElAtPoint(clientX, clientY);
  if (direct) return direct;
  if (!wrapper) return null;
  let nearest: Element | null = null;
  let nearestDist = RECONNECT_BUFFER_PX;
  let nearestArea = Number.POSITIVE_INFINITY;
  const nodes = wrapper.querySelectorAll('.react-flow__node');
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
    const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
    const dist = Math.hypot(dx, dy);
    if (dist > nearestDist) continue;
    const area = rect.width * rect.height;
    // Canvas grouping M8: on a (near-)distance tie in the buffer zone prefer the
    // smaller-area node so a member wins over its enclosing group, keeping this
    // commit-side fallback consistent with the preview's snap pick (the in-bbox
    // case is already handled by `nodeElAtPoint`'s z-order above). A
    // farther-but-smaller node can't steal — the area branch is tie-gated.
    const strictlyNearer = nearest === null || dist < nearestDist - 1e-6;
    const tieSmaller = Math.abs(dist - nearestDist) <= 1e-6 && area < nearestArea;
    if (strictlyNearer || tieSmaller) {
      nearest = node;
      nearestDist = dist;
      nearestArea = area;
    }
  }
  return nearest;
};

/**
 * Compute the lock-pin for the un-moved endpoint of a cross-node reconnect,
 * IF and ONLY IF that endpoint is currently floating. Returns `undefined`
 * when the un-moved side is already locked (has a pin OR autoPicked === false),
 * when either node hasn't been measured yet, or when an InternalNode lookup
 * fails. Shared by both the precise-handle (`onReconnect`) and body-drop
 * (`onReconnectEndCb`) reconnect paths so the "NEVER move the other outlet"
 * invariant holds regardless of how the user lands the drop.
 *
 * Math: the un-moved endpoint's CURRENT visible position is the perimeter
 * intersection of the line through OLD source/target centers, restricted
 * to the un-moved node's bbox (`getNodeIntersection`). We convert that
 * intersection back into a `(side, t)` pin (`endpointToPin`) so the
 * persisted state freezes the endpoint at its visible location.
 *
 * `rfGetInternalNode` is passed as a function rather than the React Flow
 * instance so this helper can be unit-tested with a stub map and stays
 * agnostic of the xyflow contract.
 */
export function computeUnmovedLockPin(
  movingSide: 'source' | 'target',
  oldEdgeSource: string,
  oldEdgeTarget: string,
  edgeData:
    | {
        sourcePin?: { side: 'top' | 'right' | 'bottom' | 'left'; t: number };
        targetPin?: { side: 'top' | 'right' | 'bottom' | 'left'; t: number };
        sourceHandleAutoPicked?: boolean;
        targetHandleAutoPicked?: boolean;
      }
    | undefined,
  rfGetInternalNode: (id: string) =>
    | {
        internals: { positionAbsolute: { x: number; y: number } };
        measured: { width?: number; height?: number };
        width?: number;
        height?: number;
      }
    | null
    | undefined,
): EdgePin | undefined {
  const unmovedAlreadyLocked =
    movingSide === 'source'
      ? edgeData?.targetPin !== undefined || edgeData?.targetHandleAutoPicked === false
      : edgeData?.sourcePin !== undefined || edgeData?.sourceHandleAutoPicked === false;
  if (unmovedAlreadyLocked) return undefined;
  const unmovedNodeId = movingSide === 'source' ? oldEdgeTarget : oldEdgeSource;
  const movedOldNodeId = movingSide === 'source' ? oldEdgeSource : oldEdgeTarget;
  const unmovedNode = rfGetInternalNode(unmovedNodeId);
  const movedOldNode = rfGetInternalNode(movedOldNodeId);
  if (!unmovedNode || !movedOldNode) return undefined;
  const uW = unmovedNode.measured.width ?? unmovedNode.width ?? 0;
  const uH = unmovedNode.measured.height ?? unmovedNode.height ?? 0;
  const mW = movedOldNode.measured.width ?? movedOldNode.width ?? 0;
  const mH = movedOldNode.measured.height ?? movedOldNode.height ?? 0;
  if (uW === 0 || uH === 0 || mW === 0 || mH === 0) return undefined;
  const unmovedBox = {
    x: unmovedNode.internals.positionAbsolute.x,
    y: unmovedNode.internals.positionAbsolute.y,
    w: uW,
    h: uH,
  };
  const movedOldCenter = {
    x: movedOldNode.internals.positionAbsolute.x + mW / 2,
    y: movedOldNode.internals.positionAbsolute.y + mH / 2,
  };
  return endpointToPin(unmovedBox, getNodeIntersection(unmovedBox, movedOldCenter));
}

/**
 * Decide what action a reconnect body-drop should commit, given the node the
 * cursor was released over (or null for empty space) and the edge's current
 * endpoints. Pure dispatch so the precedence rules are exhaustively unit-
 * testable.
 *
 *  • `'no-op'` — drop landed on empty space (no node under cursor). The
 *    gesture is abandoned and the edge restores. The user explicitly
 *    requested this UX: cursor outside any node + drop = nothing happens.
 *  • `'self-loop'` — drop landed on the OTHER endpoint's node. Connecting
 *    source-and-target to the same node would be a self-loop; bail.
 *  • `'pin-own'` — drop landed on the moving endpoint's OWN node. The user
 *    dragged the endpoint dot around its own node to choose a specific
 *    attachment point; the caller projects the cursor onto that node's
 *    perimeter (closest side + t) and commits via onPinEndpoint.
 *  • `'reconnect-and-pin'` — drop landed on a THIRD node. Per the "cursor
 *    over a node finds the closest perimeter point and uses that" rule,
 *    the caller reconnects to the new node AND pins at the projected
 *    perimeter point in a single onReconnectConnector patch so the new
 *    endpoint lands on the specific point the user aimed at.
 *
 * `movingSide` is the endpoint the user dragged. React Flow's onReconnectEnd
 * passes `handleType` as the FIXED end, so callers invert:
 * `movingSide = 'source' if handleType === 'target' else 'target'`.
 */
export function classifyReconnectBodyDrop(
  movingSide: 'source' | 'target',
  oldEdgeSource: string,
  oldEdgeTarget: string,
  droppedNodeId: string | null,
): 'no-op' | 'self-loop' | 'pin-own' | 'reconnect-and-pin' {
  if (droppedNodeId === null) return 'no-op';
  const ownNodeId = movingSide === 'source' ? oldEdgeSource : oldEdgeTarget;
  const otherNodeId = movingSide === 'source' ? oldEdgeTarget : oldEdgeSource;
  if (droppedNodeId === otherNodeId) return 'self-loop';
  if (droppedNodeId === ownNodeId) return 'pin-own';
  return 'reconnect-and-pin';
}

/**
 * Classify the outcome of a connection-drop's `isValid === false` state.
 *
 *  • `'fall-through'` — a handle was hit but xyflow refused the drop (either
 *    strict-mode type-direction mismatch, our isValidConnection callback
 *    rejected, or the node renders `connectable: false`). The caller MUST
 *    continue to the body-drop fallback, which hit-tests the node under the
 *    cursor and pins the endpoint at the closest perimeter point. User rule:
 *    "must allow to connect the outlet to any location on the border" — so
 *    a wrong-type handle dead-center on a border is not an error, it's a
 *    valid border-drop that the body-drop path will land correctly.
 *
 *  • `'no-flash-no-fall-through'` — there's no `toHandle` (cursor wasn't
 *    near any handle at drop) or `isValid` is null/true. Caller proceeds
 *    to the body-drop path normally.
 *
 * Pure function so the dispatch logic is testable without a DOM
 * (the production gate lives inside onConnectEndCb).
 */
export function classifyHandleDropFailure(
  toHandle: { nodeId: string } | null,
  isValid: boolean | null,
  _nodes: ReadonlyArray<{ id: string; connectable?: boolean }>,
): 'fall-through' | 'no-flash-no-fall-through' {
  if (!toHandle || isValid !== false) return 'no-flash-no-fall-through';
  return 'fall-through';
}

/** Minimal node shape the snap-target scan needs (matches xyflow InternalNode). */
interface SnapCandidate {
  id: string;
  internals: { positionAbsolute: { x: number; y: number } };
  measured: { width?: number; height?: number };
  width?: number;
  height?: number;
}

/**
 * Choose the nearest node to snap a connection-PREVIEW's moving endpoint to,
 * given the cursor in flow units. Returns the node whose bbox is closest to the
 * cursor within `bufferFlow`, or null when none is in range.
 *
 * Canvas grouping M8 (step 3 — preview parity): a member node sits ABOVE its
 * enclosing group (member zIndex 0, group zIndex -1) and the group's bbox
 * CONTAINS the member's. When the cursor is inside both, both bboxes have
 * distance 0. The COMMIT body-drop resolves this via `elementsFromPoint`, which
 * returns the topmost element → the member. So this preview scan must break a
 * distance tie by **smaller bbox area** (the innermost / on-top node) so the
 * previewed snap target matches what will commit. Without it the preview could
 * snap to the group border while the drop lands on the member — the exact
 * "preview must mirror the committed connector" regression the design guards
 * against. A non-tie (cursor over the group's padding band but outside every
 * member) still picks the group outright, which is the "connect to the group as
 * a whole" path (design §3 decision #4).
 *
 * `excludeId` skips the gesture's fixed/source node (a self-loop the commit
 * rejects). Pure — extracted so the tie-break is unit-testable without mounting
 * the connection-line component (whose `useStore` chain can't be shimmed; see
 * design §11 L3.3).
 */
export function pickNearestSnapTarget(
  candidates: Iterable<SnapCandidate>,
  cursor: { x: number; y: number },
  bufferFlow: number,
  excludeId: string | null,
): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  let bestDist = bufferFlow;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const node of candidates) {
    if (excludeId && node.id === excludeId) continue;
    const w = node.measured.width ?? node.width ?? 0;
    const h = node.measured.height ?? node.height ?? 0;
    if (w === 0 || h === 0) continue;
    const x = node.internals.positionAbsolute.x;
    const y = node.internals.positionAbsolute.y;
    const dx = Math.max(x - cursor.x, 0, cursor.x - (x + w));
    const dy = Math.max(y - cursor.y, 0, cursor.y - (y + h));
    const dist = Math.hypot(dx, dy);
    if (dist > bestDist) continue;
    const area = w * h;
    // Strictly-nearer always wins; on a (near-)distance tie prefer the smaller
    // area — the innermost node, matching the commit's z-order pick. The
    // area-tie branch is gated on `dist` being within float-epsilon of the
    // current best so a FARTHER-but-smaller node can never steal from a nearer
    // larger one.
    const strictlyNearer = best === null || dist < bestDist - 1e-6;
    const tieSmaller = Math.abs(dist - bestDist) <= 1e-6 && area < bestArea;
    if (strictlyNearer || tieSmaller) {
      best = node;
      bestDist = dist;
      bestArea = area;
    }
  }
  return best;
}

const mergeNodeOverride = (node: FlowNode, override: Partial<FlowNode> | undefined): FlowNode => {
  if (!override) return node;
  // The override is keyed by the node's id, so its `data` (when present) is
  // always a partial of the SAME variant as node.data. TS can't see this
  // through the discriminated union spread, so cast at the boundary.
  const data = override.data ? { ...node.data, ...override.data } : node.data;
  return { ...node, ...override, data } as FlowNode;
};

const mergeConnectorOverride = (
  conn: Connector,
  override: Partial<Connector> | undefined,
): Connector => {
  if (!override) return conn;
  // Style-tab edits never change kind, so the discriminator stays intact and
  // the cast is safe at runtime (TS can't see through the union spread).
  return { ...conn, ...override } as Connector;
};

// Flat-node-types routing: `rectangle` → RectangleNode (the only renderer that
// draws capability chrome — play button, status pill, header layout, icon
// trigger); the 8 other geometric tags → GeometricNode (shared SVG/box visual
// keyed by `type`); image/html/icon → their dedicated renderers. Non-rectangle
// renderers parse + persist capabilities but draw no chrome (Renderer
// phasing — see docs/plans/2026-05-23-flat-node-types-design.md).
const nodeTypes = {
  rectangle: RectangleNode,
  ellipse: GeometricNode,
  sticky: GeometricNode,
  text: GeometricNode,
  database: GeometricNode,
  server: GeometricNode,
  user: GeometricNode,
  queue: GeometricNode,
  cloud: GeometricNode,
  diamond: GeometricNode,
  hexagon: GeometricNode,
  triangle: GeometricNode,
  parallelogram: GeometricNode,
  document: GeometricNode,
  image: ImageNode,
  icon: IconNode,
  // US-014: file-backed escape-hatch node — fetches author HTML at
  // `<project>/<htmlPath>`, sanitizes (US-013), and renders with Tailwind
  // Play CDN (US-012). Missing files render PlaceholderCard.
  html: HtmlNode,
  // Component nodes carry a json-render spec inlined from
  // `<project>/nodes/<id>/spec.json` and render a reactive UI driven by
  // ComponentRuntime (state + set/script actions).
  component: ComponentNode,
  // Linkflow nodes navigate to another flow by slug pair. Three visual states
  // (unlinked, linked-healthy, broken) — see linkflow-node.tsx. Click handlers
  // are no-ops at this story; US-004 wires the picker, US-007 wires navigation.
  linkflow: LinkflowNode,
  freehand: FreehandNode,
  line: LineNode,
  // Group container: paints a titled box BEHIND its members (assigned
  // GROUP_NODE_Z_INDEX in buildNode). Static this milestone — create/ungroup
  // (M4), overlay resize (M3/M5), enter/exit (M6) build on top. Using the key
  // `group` also opts the wrapper into xyflow's `.react-flow__node-group` class
  // (see index.css carve-outs that keep its low zIndex stable on selection).
  group: GroupNode,
};
const edgeTypes = { editableEdge: EditableEdge };

// Edges render at zIndex 0 so the connector line ALWAYS paints below every
// node — nodes naturally win via DOM order (xyflow's NodeRenderer is wired
// after EdgeRenderer in the viewport, so equal-z-index siblings layer with
// the later one on top). Selected edges keep the same baseline; only the
// outlet endpoint dots (rendered via <ViewportPortal> at CSS z-index 2000)
// sit above nodes. Defined as a module-level constant — passing an inline
// object literal to ReactFlow's defaultEdgeOptions would change identity
// every render and force xyflow's edge merging to recompute.
const DEFAULT_EDGE_OPTIONS = { zIndex: 0 };

// Canvas grouping M2: last-resort size for the selection/group overlay union
// rect when a node has neither a measured footprint nor a `data.width/height`
// (design §12.1). Mirrors the layout fallback (`internalTidy`, 200×120) so a
// rect always draws rather than collapsing/excluding the node.
const OVERLAY_FALLBACK_DIM = { width: 200, height: 120 } as const;

// Same identity-stability rationale as DEFAULT_EDGE_OPTIONS: an inline
// `proOptions={{ hideAttribution: true }}` literal on <ReactFlow> would
// re-allocate every parent render and feed unnecessary work into xyflow's
// internal prop diffing on the pointer hot path.
const PRO_OPTIONS = { hideAttribution: true };

// US-010: walk up from `target` and return true when the closest
// `.react-flow__node` ancestor's `data-id` is set AND not equal to `nodeId`.
// In xyflow 12 each node renders as its own `.react-flow__node` wrapper at the
// `.react-flow__nodes` flat container — children of a group are siblings of
// their parent in the DOM, NOT nested. So when a user double-clicks (or
// mouse-downs) a child node inside a group's bounding rect, xyflow's
// per-wrapper event handlers dispatch to that child's wrapper only — never to
// the group's wrapper. This helper is the defensive guard the activate-group
// dblclick handler uses to make that invariant explicit in our code: even if
// the event somehow reaches the group's handler with a target inside a
// different node's wrapper (custom portal / future DOM nesting), we still
// refuse to activate the group. Returns false when target is missing, not an
// Element, or the closest `.react-flow__node` carries the same `data-id` as
// the group (i.e. the event truly originated on the group's own chrome).
export function eventTargetIsOtherNode(target: EventTarget | null, nodeId: string): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const closestNode = (target as Element).closest('.react-flow__node');
  if (!closestNode) return false;
  const dataId = closestNode.getAttribute('data-id');
  return dataId !== null && dataId !== nodeId;
}

// US-009: smoothstep corner radius — kept in sync with EditableEdge so the
// reconnect-time connection line traces the same zigzag profile as the
// committed edge.
const SMOOTHSTEP_BORDER_RADIUS = 8;

/**
 * Mirror of `@xyflow/system::getMarkerId` — the function isn't exposed in
 * the package's public types, so we reimplement the deterministic algorithm
 * to match xyflow's internal id format byte-for-byte. The id is consumed by
 * the in-flight reconnect connection line so its arrowhead points at the
 * same `<defs><marker /></defs>` the committed edge uses.
 */
const makeMarkerUrl = (
  marker: EdgeMarker | string | undefined,
  rfId: string | undefined,
): string | undefined => {
  if (!marker) return undefined;
  if (typeof marker === 'string') return `url('#${marker}')`;
  const prefix = rfId ? `${rfId}__` : '';
  const id = `${prefix}${Object.keys(marker)
    .sort()
    .map((key) => `${key}=${(marker as unknown as Record<string, unknown>)[key]}`)
    .join('&')}`;
  return `url('#${id}')`;
};

/**
 * US-009: custom connection-line component used while a reconnect drag is in
 * flight. xyflow unmounts the original edge for the duration of the gesture
 * (see EdgeWrapper: `!reconnecting && <EdgeComponent />`) and substitutes a
 * default thin grey bezier — visually disconnected from the edge being
 * modified. We mark the user-selected reconnectable edge with `reconnectable:
 * true` (in `rfEdges`), so during a reconnect drag it's the unique edge with
 * that flag. We mirror the edge's `style` (stroke color / width / dasharray)
 * and `data.path` (curve vs zigzag) onto the in-flight line so the drag looks
 * like the original edge sliding to follow the cursor.
 *
 * For NEW connection drags (onConnect, not onReconnect) the edge being
 * "reconnected" is null even when an unrelated edge happens to be selected:
 * we gate on a ref that's set in onReconnectStart and cleared in
 * onReconnectEnd, so a new-connection drag retains xyflow's default styling.
 */
const buildReconnectAwareConnectionLine = (isReconnectingRef: {
  current: boolean;
}): ComponentType<ConnectionLineComponentProps> => {
  return function ReconnectAwareConnectionLine({
    fromX,
    fromY,
    toX,
    toY,
    fromPosition,
    toPosition,
    connectionLineStyle,
  }: ConnectionLineComponentProps) {
    // useStore subscribes the line to edge mutations so style edits to the
    // selected edge mid-drag (theoretical, not currently exposed) propagate.
    // The ref guard makes a new-connection drag fall through to the default
    // styling even when an unrelated edge is selected and `reconnectable: true`
    // — only a real reconnect gesture inherits the edge's style.
    const reconnectingEdge = useStore((s) =>
      isReconnectingRef.current ? (s.edges.find((e) => e.reconnectable === true) ?? null) : null,
    );
    const data = reconnectingEdge?.data as EditableEdgeData | undefined;
    // New-connection preview: the committed connector inherits the host's
    // last-used connector style — demo-view's onCreateConnector spreads the
    // SAME `getLastUsedStyle(DEFAULT_STORAGE_PREFIX).connector` over every new
    // connector. Read it here so the in-flight preview renders the SAME path
    // type (curve vs step), stroke color, dash, width, and arrow ends the
    // connector will land on. Without this the preview is hardcoded to a bezier
    // curve while a step-defaulted connector commits as a zigzag — the connector
    // visibly "re-renders"/jumps the moment the mouse is released. Null for a
    // reconnect drag, which already inherits the live edge's style/data below.
    const newConnectorDefaults = reconnectingEdge
      ? null
      : getLastUsedStyle(DEFAULT_STORAGE_PREFIX).connector;
    // "NEVER move the other outlet" — during the reconnect drag itself.
    // React Flow's stored `fromX, fromY` for the fixed end is the handle's
    // cardinal position (top/right/bottom/left center), not the floating-
    // perimeter intersection we render the static edge at. Without this
    // override the fixed end visually JUMPS from its rendered position to
    // the handle's center the moment the drag starts, then jumps back on
    // release — even though we lock the position in the patch.
    //
    // Critically, for a FLOATING fixed end, the override must use the OLD
    // line-through-centers (not the cursor). Using the cursor would make
    // the fixed endpoint orbit toward the moving cursor — exactly the "the
    // other outlet moves" bug the user reported. The fixed end must stay
    // at its pre-drag visible position throughout the gesture.
    //
    // Recompute the fixed end's true visible position from edge state:
    //   - If the fixed end has a `pin`, use that (pin position is static).
    //   - Else if `autoPicked === false`, the React-Flow-supplied fromX/Y
    //     IS the handle position — already correct, fall through.
    //   - Else (floating), compute the perimeter intersection of the line
    //     between the source center and target center (the OLD geometry
    //     before the drag); the result is independent of cursor position.
    const fixedNodeId = useStore((s) => {
      const conn = s.connection;
      // `connection.fromHandle.nodeId` is the FIXED end of the gesture:
      //   - reconnect drag → the anchored side of the edge
      //   - new connect drag → the source node where the drag started
      // When the drag isn't yet a real connection (initial mousedown
      // frame) fall back to null.
      return conn?.fromHandle?.nodeId ?? null;
    });
    const sourceNode = useStore((s) =>
      reconnectingEdge?.source ? (s.nodeLookup.get(reconnectingEdge.source) ?? null) : null,
    );
    const targetNode = useStore((s) =>
      reconnectingEdge?.target ? (s.nodeLookup.get(reconnectingEdge.target) ?? null) : null,
    );
    // Resolve the fixed-end node both for reconnect (via the edge's
    // source/target lookup above) AND for new-connect (directly from the
    // store via the fromHandle's nodeId). Either way the snap-target loop
    // below needs to know which node is "the source" so it doesn't snap
    // there.
    const fromNodeFromStore = useStore((s) =>
      fixedNodeId ? (s.nodeLookup.get(fixedNodeId) ?? null) : null,
    );
    const fixedNodeIsSource = reconnectingEdge?.source === fixedNodeId;
    const fixedNode = reconnectingEdge
      ? fixedNodeIsSource
        ? sourceNode
        : targetNode
      : fromNodeFromStore;
    const otherNode = fixedNodeIsSource ? targetNode : sourceNode;
    const fixedHasPin = fixedNodeIsSource ? data?.sourcePin : data?.targetPin;
    const fixedAutoPicked = fixedNodeIsSource
      ? data?.sourceHandleAutoPicked
      : data?.targetHandleAutoPicked;
    let effectiveFromX = fromX;
    let effectiveFromY = fromY;
    let effectiveFromPosition = fromPosition;
    // Hoisted so the moving-end block below can reuse the fixed (source) node's
    // bbox to render the EXACT committed floating geometry for a new-connection
    // preview (both endpoints via line-through-centers).
    let fixedBox: { x: number; y: number; w: number; h: number } | null = null;
    if (fixedNode) {
      const fW = fixedNode.measured.width ?? fixedNode.width ?? 0;
      const fH = fixedNode.measured.height ?? fixedNode.height ?? 0;
      if (fW > 0 && fH > 0) {
        fixedBox = {
          x: fixedNode.internals.positionAbsolute.x,
          y: fixedNode.internals.positionAbsolute.y,
          w: fW,
          h: fH,
        };
        let overrideEndpoint: { x: number; y: number; side: Side } | null = null;
        if (fixedHasPin) {
          overrideEndpoint = endpointFromPin(fixedBox, fixedHasPin);
        } else if (fixedAutoPicked !== false && otherNode) {
          // Floating fixed end + we have the other node's geometry → use
          // line-through-CENTERS (not the cursor). This keeps the fixed
          // endpoint visually anchored at its pre-drag perimeter position
          // for the entire duration of the gesture.
          const oW = otherNode.measured.width ?? otherNode.width ?? 0;
          const oH = otherNode.measured.height ?? otherNode.height ?? 0;
          if (oW > 0 && oH > 0) {
            const otherCenter = {
              x: otherNode.internals.positionAbsolute.x + oW / 2,
              y: otherNode.internals.positionAbsolute.y + oH / 2,
            };
            overrideEndpoint = getNodeIntersection(fixedBox, otherCenter);
          }
        }
        if (overrideEndpoint) {
          effectiveFromX = overrideEndpoint.x;
          effectiveFromY = overrideEndpoint.y;
          effectiveFromPosition = POSITION_BY_SIDE_LINE[overrideEndpoint.side];
        }
      }
    }
    // Live snap for the MOVING end. Two paths:
    //   (a) xyflow already snapped to a handle (cursor within
    //       `connectionRadius=32` of a handle) → `connection.toHandle.nodeId`
    //       is set in the store. The body-drop fallback prefers this over
    //       its own hit-test (see onReconnectEndCb), so the in-flight line
    //       must follow suit — otherwise the line previews "no snap" while
    //       release commits a snap, and the user sees the connector jump.
    //   (b) No xyflow handle hit → scan all nodes and find the nearest
    //       whose bbox is within `RECONNECT_BUFFER_PX / zoom` of the cursor
    //       in FLOW units (= `RECONNECT_BUFFER_PX` screen px). If found,
    //       snap to that node's perimeter so the user SEES the projection
    //       that will commit on release.
    //
    // Works for BOTH reconnect drags (when `reconnectingEdge` is set) and
    // NEW connection drags (no edge yet; we still want the moving end to
    // snap as the user approaches a target node).
    //
    // Exclusion rules:
    //   - In reconnect: skip the other-endpoint's node (a drop there
    //     would be a self-loop and the body-drop fallback bails).
    //   - In new connect: skip the source node (a node can't connect to
    //     itself).
    //   - In both: allow snap onto the fixed end's own node (the user
    //     dragged back to set a pin-own / a same-node connector). The
    //     fixed-end override above places `effectiveFromX/Y` at the fixed
    //     perimeter; the line's `to` should snap to the same node's
    //     perimeter at the cursor projection.
    const zoom = useStore((s) => s.transform[2]);
    const panX = useStore((s) => s.transform[0]);
    const panY = useStore((s) => s.transform[1]);
    const nodeMap = useStore((s) => s.nodeLookup);
    const xyflowToNodeId = useStore((s) => s.connection.toHandle?.nodeId ?? null);
    // Raw, UNSNAPPED cursor in screen (container-relative) coords. xyflow keeps
    // `connection.pointer` at the true pointer position even when it snaps
    // `connection.to` (delivered here as `toX/toY`) to a nearby handle's cardinal
    // center — which it does whenever the moving end hovers near the target
    // node's own handles (every reconnect/move drag). The committed connector
    // projects the raw cursor (`screenToFlowPosition` in onConnect/onReconnect
    // End), so the preview must project the raw cursor too or the previewed
    // target FACE (e.g. left handle center) diverges from the committed face
    // (raw cursor, e.g. bottom) — the connector visibly jumps on release.
    const pointerScreenX = useStore((s) => s.connection.pointer?.x ?? null);
    const pointerScreenY = useStore((s) => s.connection.pointer?.y ?? null);
    // Convert the screen-space pointer into flow space exactly as
    // `screenToFlowPosition` does: subtract the viewport translation, divide by
    // zoom. Equals `toX/toY` when xyflow didn't snap (new-connection drags),
    // and the true cursor (not the snapped handle) when it did (reconnects).
    const cursorFlowX = pointerScreenX !== null && zoom > 0 ? (pointerScreenX - panX) / zoom : null;
    const cursorFlowY = pointerScreenY !== null && zoom > 0 ? (pointerScreenY - panY) / zoom : null;
    let effectiveToX = toX;
    let effectiveToY = toY;
    let effectiveToPosition = toPosition;
    // True once a NEW connection's drag is over (or buffered-near) a commit
    // target. The committed connector paints its head(s) per `direction`; the
    // first connection has no edge marker in the DOM yet, so we draw the head(s)
    // inline (see the return) gated on this flag.
    let targetIdentified = false;
    if (zoom > 0) {
      const bufferFlow = RECONNECT_BUFFER_PX / zoom;
      // Node id to exclude from the snap targets — the ANCHORED (fixed) end's
      // node, because dropping the MOVING end there would make source === target
      // (a self-loop), which onReconnectEndCb rejects. Critically this is the
      // fixed end's node, NOT the moving end's own node: the user routinely
      // re-pins an endpoint to a different face of the SAME node it's already on
      // (onReconnectEndCb's 'pin-own' path), so the moving end's own node MUST
      // stay a valid snap target or the preview can't follow the cursor around
      // its perimeter while the commit does — the exact left-face-preview vs
      // bottom-face-commit jump this fixes. New connections exclude nothing
      // extra here; their source is skipped via the `fixedNode` guard below.
      const excludeNodeId = reconnectingEdge
        ? fixedNodeIsSource
          ? reconnectingEdge.source
          : reconnectingEdge.target
        : null;
      let bestNode: typeof fixedNode = null;
      // Path (a): xyflow's own handle-proximity snap. Takes precedence
      // over our bbox-buffer scan because the body-drop fallback also
      // gives `connectionState.toNode` precedence over its hit-test —
      // matching the two keeps the in-flight preview aligned with the
      // shape that will commit on release.
      if (xyflowToNodeId && xyflowToNodeId !== excludeNodeId) {
        const candidate = nodeMap.get(xyflowToNodeId) ?? null;
        if (candidate) bestNode = candidate;
      }
      // Path (b): bbox-buffer scan, only when xyflow didn't already pin a
      // target via handle proximity. `pickNearestSnapTarget` picks the nearest
      // node within the buffer, breaking a distance tie by smaller bbox area so
      // a member wins over its enclosing group — matching the commit's
      // elementsFromPoint z-order pick (canvas grouping M8: preview mirrors
      // commit). The scan still excludes the fixed/source node; the moving end's
      // own node stays a valid target (own-node re-pin). We feed it both the
      // explicit `excludeNodeId` and the fixed node id below.
      if (!bestNode) {
        const candidates: SnapCandidate[] = [];
        for (const node of nodeMap.values()) {
          if (fixedNode && node.id === fixedNode.id) continue;
          candidates.push(node);
        }
        bestNode = pickNearestSnapTarget(
          candidates,
          { x: toX, y: toY },
          bufferFlow,
          excludeNodeId,
        ) as typeof bestNode;
      }
      // (The moving end's OWN-node re-pin is now handled by the scan above —
      // its node is no longer excluded. We deliberately do NOT snap onto the
      // anchored `fixedNode`: that would preview a self-loop the commit rejects.)
      if (bestNode) {
        const w = bestNode.measured.width ?? bestNode.width ?? 0;
        const h = bestNode.measured.height ?? bestNode.height ?? 0;
        if (w > 0 && h > 0) {
          const targetBox = {
            x: bestNode.internals.positionAbsolute.x,
            y: bestNode.internals.positionAbsolute.y,
            w,
            h,
          };
          // Moving (target) end: project the RAW cursor onto the target
          // perimeter so the previewed face matches the committed pin exactly
          // (both project the same cursor via projectCursorToPerimeter). Prefer
          // the unsnapped `cursorFlow` (from connection.pointer) over xyflow's
          // `toX/toY`, which it snaps to a handle's cardinal center near the
          // target's handles — that snap is what made a reconnect preview land
          // on the LEFT face while the commit pinned the BOTTOM face.
          const cursorFlow =
            cursorFlowX !== null && cursorFlowY !== null
              ? { x: cursorFlowX, y: cursorFlowY }
              : { x: toX, y: toY };
          const projectedPinRaw = projectCursorToPerimeter(targetBox, cursorFlow);
          // Fixed (source) end of a NEW connection: the committed connector
          // floats the source (line-through-centers toward the target — see
          // resolveEdgeEndpoints / onCreateConnector), but xyflow's `fromX/Y`
          // points at the grabbed handle. Float it the moment a target node is
          // identified so the preview source sits at the SMART face (matching
          // the final), instead of jumping from the handle to that face on
          // release. Reconnect already anchors its fixed end above. Compute it
          // BEFORE the straight-snap below so the moving end can align to it.
          if (!reconnectingEdge && fixedBox) {
            const tCenter = { x: targetBox.x + targetBox.w / 2, y: targetBox.y + targetBox.h / 2 };
            const src = getNodeIntersection(fixedBox, tCenter);
            effectiveFromX = src.x;
            effectiveFromY = src.y;
            effectiveFromPosition = POSITION_BY_SIDE_LINE[src.side];
            targetIdentified = true;
          }
          // Near-straight snap: nudge the moving end to a perfectly H/V line
          // with the fixed endpoint when within STRAIGHT_SNAP_PX. Same helper +
          // fixed reference both commit paths use, so preview == commit.
          const projectedPin = snapPinToStraight(
            targetBox,
            projectedPinRaw,
            { x: effectiveFromX, y: effectiveFromY },
            STRAIGHT_SNAP_PX / zoom,
          );
          const projectedEndpoint = endpointFromPin(targetBox, projectedPin);
          effectiveToX = projectedEndpoint.x;
          effectiveToY = projectedEndpoint.y;
          effectiveToPosition = POSITION_BY_SIDE_LINE[projectedEndpoint.side];
        }
      }
    }
    const isStep = reconnectingEdge ? data?.path === 'step' : newConnectorDefaults?.path === 'step';
    const [path] = isStep
      ? getSmoothStepPath({
          sourceX: effectiveFromX,
          sourceY: effectiveFromY,
          sourcePosition: effectiveFromPosition,
          targetX: effectiveToX,
          targetY: effectiveToY,
          targetPosition: effectiveToPosition,
          borderRadius: SMOOTHSTEP_BORDER_RADIUS,
        })
      : getBezierPath({
          sourceX: effectiveFromX,
          sourceY: effectiveFromY,
          sourcePosition: effectiveFromPosition,
          targetX: effectiveToX,
          targetY: effectiveToY,
          targetPosition: effectiveToPosition,
        });
    // Style precedence: a reconnect drag inherits the live edge's style; a new
    // connection mirrors the committed connector's style EXACTLY by running the
    // same derivation `connectorToEdge` applies to the last-used connector —
    // dash pattern (`style`), stroke color token (`color`), and width
    // (`borderSize ?? 2`). Mirroring all three means the preview doesn't
    // re-style on release even when the user's last connector was, say, a thick
    // dashed orange step edge. Fall back to xyflow's default only when neither
    // applies (e.g. the first mousedown frame before a source is resolved).
    const newConnectStyle =
      !reconnectingEdge && fixedNode
        ? {
            ...(newConnectorDefaults?.style ? STYLE_BY_NAME[newConnectorDefaults.style] : {}),
            ...colorTokenStyle(newConnectorDefaults?.color, 'edge'),
            strokeWidth: newConnectorDefaults?.borderSize ?? 2,
          }
        : undefined;
    const style = reconnectingEdge?.style ?? newConnectStyle ?? connectionLineStyle ?? undefined;
    // Mirror the committed edge's arrow markers onto the in-flight line so
    // the connector keeps its arrowhead while the user drags an outlet.
    // xyflow generates the marker URL as `url('#${markerId}')` where
    // `markerId` follows the deterministic algorithm in
    // `@xyflow/system::getMarkerId` (sort marker object keys alphabetically,
    // join as `key=value&...`, optionally prefixed with `${rfId}__`). The
    // <defs> are registered from the live edges array, so the original
    // edge's marker is already in the DOM during the reconnect drag — we
    // just need to re-derive the same id to point at it.
    //
    // Direction swap: xyflow's connection line always draws from the FIXED
    // end (`fromX/Y`) to the MOVING end (`toX/Y`). For an edge with
    // direction='forward' (markerEnd at the target), this matches the
    // committed shape only when the user is dragging the TARGET endpoint
    // (fixed = source, path goes source → cursor). When the user is
    // dragging the SOURCE endpoint instead, the in-flight path runs target
    // → cursor — i.e. reversed relative to the committed source→target
    // direction — so what `connectorToEdge` stamped as markerEnd (target
    // side, head of arrow) must paint at the path's `markerStart` end, and
    // vice versa. `fixedNodeIsSource` already captures this: it's true iff
    // the fixed end of the gesture is the edge's source.
    const rfId = useStore((s) => s.rfId);
    const orientedMarkerStart = fixedNodeIsSource
      ? reconnectingEdge?.markerStart
      : reconnectingEdge?.markerEnd;
    const orientedMarkerEnd = fixedNodeIsSource
      ? reconnectingEdge?.markerEnd
      : reconnectingEdge?.markerStart;
    const markerStartUrl = makeMarkerUrl(orientedMarkerStart, rfId);
    const markerEndUrl = makeMarkerUrl(orientedMarkerEnd, rfId);
    // Inline closed-arrow head(s) for a NEW connection — the committed connector
    // stamps native ArrowClosed markers, but the first connection has no edge
    // marker in the DOM yet, so we draw equivalent triangles pointing into the
    // node(s) along the attach side. Which ends carry a head, and whether they
    // do at all, mirror `connectorToEdge`'s `direction`/`headShape` rules:
    //   forward (default) → target end · backward → source end · both → both ·
    //   none → neither. Custom (non-arrow) head shapes are drawn as glyphs by
    //   EditableEdge on the committed edge; the preview omits them (the glyph
    //   pops in on release) rather than draw a wrong-shaped arrow.
    const arrowFill = (style as { stroke?: string } | undefined)?.stroke;
    const newDirection = newConnectorDefaults?.direction ?? 'forward';
    // Resolve each end's arrow-ness independently: the target (head) reads
    // `headShape`; the source (tail) reads `tailShape` and falls back to
    // `headShape`. Only arrow ends draw a preview triangle — custom glyphs pop
    // in via EditableEdge on release rather than draw a wrong-shaped arrow.
    const newEndIsArrow = (newConnectorDefaults?.headShape ?? 'arrow') === 'arrow';
    const newStartIsArrow =
      (newConnectorDefaults?.tailShape ?? newConnectorDefaults?.headShape ?? 'arrow') === 'arrow';
    const canDrawHeads = targetIdentified && Boolean(arrowFill);
    const targetArrowPoints =
      canDrawHeads && newEndIsArrow && (newDirection === 'forward' || newDirection === 'both')
        ? buildConnectionArrowPoints(effectiveToX, effectiveToY, effectiveToPosition)
        : null;
    const sourceArrowPoints =
      canDrawHeads && newStartIsArrow && (newDirection === 'backward' || newDirection === 'both')
        ? buildConnectionArrowPoints(effectiveFromX, effectiveFromY, effectiveFromPosition)
        : null;
    return (
      <>
        <path
          d={path}
          fill="none"
          className="react-flow__connection-path"
          style={style}
          markerStart={markerStartUrl}
          markerEnd={markerEndUrl}
        />
        {targetArrowPoints ? (
          <polygon points={targetArrowPoints} fill={arrowFill ?? undefined} />
        ) : null}
        {sourceArrowPoints ? (
          <polygon points={sourceArrowPoints} fill={arrowFill ?? undefined} />
        ) : null}
      </>
    );
  };
};

// Closed-arrow triangle pointing INTO the node along `position` (the side of
// the target the line attaches to). Tip at the endpoint, base trailing back
// along the outward normal. Sized to read like `arrowMarker`'s 18px head.
const ARROW_LEN = 11;
const ARROW_HALF = 5.5;
function buildConnectionArrowPoints(x: number, y: number, position: Position): string {
  // Inward unit vector (where the arrow points) per attach side.
  const inward =
    position === Position.Left
      ? { x: 1, y: 0 }
      : position === Position.Right
        ? { x: -1, y: 0 }
        : position === Position.Top
          ? { x: 0, y: 1 }
          : { x: 0, y: -1 };
  const perp = { x: -inward.y, y: inward.x };
  const baseX = x - inward.x * ARROW_LEN;
  const baseY = y - inward.y * ARROW_LEN;
  const b1x = baseX + perp.x * ARROW_HALF;
  const b1y = baseY + perp.y * ARROW_HALF;
  const b2x = baseX - perp.x * ARROW_HALF;
  const b2y = baseY - perp.y * ARROW_HALF;
  return `${x},${y} ${b1x},${b1y} ${b2x},${b2y}`;
}

// Map from our floating-edge Side type to React Flow's Position enum,
// local to the connection-line component so it doesn't have to import
// editable-edge's symbol. Kept tiny — the runtime values match xyflow's
// Position enum verbatim ('top' | 'right' | 'bottom' | 'left').
const POSITION_BY_SIDE_LINE: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

/**
 * US-006: bridge for ESC cancellation of in-flight connection drags. xyflow
 * exposes `cancelConnection` only via the internal store, which is reachable
 * through `useStoreApi` — and that hook only resolves inside
 * `<ReactFlowProvider>`. Rendering this tiny child as a `<ReactFlow>`
 * descendant lets the outer component grab the store handle through a ref
 * without restructuring the wrapper.
 */
type StoreApi = ReturnType<typeof useStoreApi>;
function StoreApiBridge({ storeApiRef }: { storeApiRef: { current: StoreApi | null } }) {
  const storeApi = useStoreApi();
  useEffect(() => {
    storeApiRef.current = storeApi;
    return () => {
      if (storeApiRef.current === storeApi) storeApiRef.current = null;
    };
  }, [storeApi, storeApiRef]);
  return null;
}

/**
 * Mirror the React Flow viewport zoom to a `--rf-zoom` CSS variable on the
 * canvas wrapper so zoom-invariant chrome (selection rectangle width/offset,
 * outlet handle size, resize corner squares) can compensate via
 * `calc(... / var(--rf-zoom))`.
 *
 * Why a store subscription, not `<ReactFlow onMove>`: `onMove` fires reliably
 * for user pan/zoom, but it misses zoom changes triggered programmatically
 * (FitView, zoom-to-fit on init for an already-mounted instance, future
 * keyboard shortcuts). Subscribing to `s.transform[2]` via `useStore` updates
 * on EVERY viewport mutation regardless of source, so the visual size of
 * outlets / resize corners stays truly constant under every zoom path.
 */
function ZoomBridge({ wrapperRef }: { wrapperRef: { current: HTMLElement | null } }) {
  const zoom = useStore((s) => s.transform[2]);
  // Apply during render (not in useEffect) so the CSS variable update lands
  // in the SAME commit as React's re-render triggered by the store change —
  // no one-frame gap between xyflow's viewport.scale change and the chrome
  // sizes recomputing. useEffect would defer the write to after paint, which
  // visibly flickers the outlet/resize squares mid-zoom.
  const wrapper = wrapperRef.current;
  if (wrapper) wrapper.style.setProperty('--rf-zoom', String(zoom));
  return null;
}

/**
 * True when the element is a form control or contentEditable surface — used to
 * skip canvas-level keyboard handlers while focus is in an editor (InlineEdit,
 * detail-panel inputs, etc.). Lives here so the canvas's ESC priority chain
 * can defer to InlineEdit's own ESC handler (priority 1: inline edit cancels
 * before drag-create / connection / selection).
 */
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const isEditableTarget = (el: Element | null): boolean => {
  if (!el) return false;
  if (EDITABLE_TAGS.has(el.tagName)) return true;
  return el instanceof HTMLElement && el.isContentEditable;
};

/**
 * US-022: Cmd/Ctrl + C and Cmd/Ctrl + V keyboard handler. Pure function that
 * consumes a KeyboardEvent-shape, decides on a copy / paste action, and
 * dispatches to the provided callbacks. Exported so demo-canvas.test.tsx can
 * drive the gesture without a real DOM, and the production wiring is a thin
 * `useEffect` whose body forwards into this helper. Returns `true` when the
 * event was handled (preventDefault called + a callback fired), `false` for
 * pass-through (wrong chord, no-op selection, focus in an editor, etc.).
 *
 * Selection-empty (Cmd+C) and clipboard-empty (Cmd+V) cases are no-ops so the
 * browser's native chord handling can fall through if relevant (e.g. inside
 * a future paste-on-empty-canvas behavior).
 */
export interface ClipboardShortcutEventLike {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  key: string;
  preventDefault: () => void;
}

export interface ClipboardShortcutDeps {
  event: ClipboardShortcutEventLike;
  selectedNodeIds: readonly string[];
  hasClipboard: boolean;
  activeElement: Element | null;
  onCopySelection?: (nodeIds: string[]) => void;
  onPasteSelection?: () => void;
}

export function handleClipboardShortcut(deps: ClipboardShortcutDeps): boolean {
  const { event, selectedNodeIds, hasClipboard, activeElement, onCopySelection, onPasteSelection } =
    deps;
  // Pre-filter: only Cmd/Ctrl chords are candidates. Shift+Cmd+C (devtools)
  // and Cmd+Alt+V are intentionally NOT synonyms so they fall through to
  // their native bindings.
  if (!(event.metaKey || event.ctrlKey)) return false;
  if (event.shiftKey || event.altKey) return false;
  const key = event.key.toLowerCase();
  if (key !== 'c' && key !== 'v') return false;
  // Skip when focus is in an editable surface so the browser's native
  // copy/paste of selected text keeps working inside InlineEdit / inputs /
  // textareas / contentEditable.
  if (isEditableTarget(activeElement)) return false;
  if (key === 'c') {
    if (selectedNodeIds.length === 0) return false;
    if (!onCopySelection) return false;
    event.preventDefault();
    onCopySelection([...selectedNodeIds]);
    return true;
  }
  // key === 'v'
  if (!hasClipboard) return false;
  if (!onPasteSelection) return false;
  event.preventDefault();
  onPasteSelection();
  return true;
}

type RunsMap = CanvasRuntime['runs'];

const statusFor = (runs: RunsMap, id: string): NodeStatus => runs?.[id]?.status ?? 'idle';

/**
 * Per-node `status` injected into a node's `data` slot. PlayNode (US-030)
 * needs to distinguish "never run" (undefined → hide pill) from "ran-then-idle"
 * (the runs reducer doesn't actually produce idle entries — the only way
 * status is undefined is no-entry-in-map). StateNode falls back to 'idle' on
 * its own; passing undefined upstream lets PlayNode see the difference
 * without affecting StateNode.
 */
const dataStatusFor = (runs: RunsMap, id: string): NodeStatus | undefined => runs?.[id]?.status;

/**
 * Per-node error message injected into a node's `data` slot when the most
 * recent run failed. PlayNode (US-018) surfaces it as the play-button
 * tooltip in place of the removed status chip.
 */
const dataErrorMessageFor = (runs: RunsMap, id: string): string | undefined =>
  runs?.[id]?.status === 'error' ? runs[id]?.error : undefined;

function SeeflowCanvasImpl(props: SeeflowCanvasProps, ref: ForwardedRef<SeeflowCanvasHandle>) {
  const {
    mode,
    // US-007: `adapter` is forwarded to the built-in DetailPanel so its
    // type:'html' file-action buttons (Open in editor / Reveal in OS file
    // manager) route through `adapter.openFile` / `adapter.revealFile`. Every
    // other mutation site still goes through the explicit callback props the
    // parent supplies.
    adapter,
    topLeftSlot,
    topRightSlot,
    projectId,
    flowSlug,
    fileBaseUrl,
    resolveFileSrc,
    apiBaseUrl = '/api',
    studioBaseUrl = '',
    nodes,
    connectors,
    selectedNodeIds,
    selectedConnectorIds,
    onSelectionChange,
    // US-026: single bundled runtime prop replacing runs/statusByNode/
    // nodeOverrides/connectorOverrides. Destructured below into local aliases so
    // the existing read sites keep the same shape; the parent now owns the seam.
    runtime,
    onPlayNode,
    onNodePositionChange,
    onNodePositionsChange,
    onNodeResize,
    onNodeResizeEnd,
    onHtmlNodeFitToContent,
    onComponentNodeFitToContent,
    onMultiResize,
    onCreateGroup,
    onUngroup,
    onNodeNameChange,
    onNodeDescriptionChange,
    onNodeCaptionChange,
    onConnectorLabelChange,
    onCreateShapeNode,
    onCreateIconNode,
    onCreateFreehandNode,
    onCreateLinkflowNode,
    onCreateLineNode,
    onCreateImageFromFile,
    onRetryImageUpload,
    onReplaceImage,
    onCreateHtmlNode,
    onCreateConnector,
    onReconnectConnector,
    onReorderNode,
    onDeleteNode,
    onCopyNode,
    onPasteAt,
    hasClipboard,
    onCopySelection,
    onPasteSelection,
    selectedNodes,
    selectedConnectors,
    onStyleNode,
    onStyleNodePreview,
    onStyleNodes,
    onStyleNodesPreview,
    onStyleConnector,
    onStyleConnectorPreview,
    onRfInit,
    onTidy,
    onNodeClick,
    onConnectorClick,
    onPaneClick,
    onCreateAndConnectFromPane,
    pendingEditNodeId,
    iconPickerOpen,
    onOpenIconPicker,
    onCloseIconPicker,
    onPickIcon,
    onRequestIconReplace,
    onPinEndpoint,
    onUnpinEndpoint,
    canvasMode,
    onCanvasModeChange,
    disableSidebar,
    statusReport,
    onNameChange,
    onDescriptionChange,
    onDetailChange,
    onIconChange,
    autoFitView,
    autoFitViewSignal,
    customIcons,
    onExportToCloud,
    onShareWithMembers,
    onNodeDragStart,
    onNodeDragStop,
    onViewportChange,
    history,
    showToolbar,
    showStyleStrip,
    showDetailPanel,
    showStatusBadges,
    showResizeHandles,
    showControls,
    showShareMenu,
    showMiniMap,
    enableKeyboard,
    enableContextMenu,
    enableDragDrop,
    enableImageDrop,
    enableZoom,
    enablePan,
    enableSelection,
    enableNodeMove,
    enableEmbed,
    enableAlignmentGuides,
    alignmentSnapThreshold,
  } = props;
  // US-027: collapse mode + feature overrides into the concrete flag set every
  // gate below reads from. `isEditMode` is the discriminator-derived boolean
  // used for behaviors that aren't purely chrome (node drag persistence,
  // connector mutations, edges deletable, etc.) — they always follow the mode
  // and aren't individually overridable since they encode the read/write
  // semantics of the canvas.
  const flags = useMemo(
    () =>
      resolveFlags({
        mode,
        showToolbar,
        showStyleStrip,
        showDetailPanel,
        showStatusBadges,
        showResizeHandles,
        showControls,
        showShareMenu,
        showMiniMap,
        enableKeyboard,
        enableContextMenu,
        enableDragDrop,
        enableImageDrop,
        enableZoom,
        enablePan,
        enableSelection,
        enableNodeMove,
        enableEmbed,
        enableAlignmentGuides,
        alignmentSnapThreshold,
      }),
    [
      mode,
      showToolbar,
      showStyleStrip,
      showDetailPanel,
      showStatusBadges,
      showResizeHandles,
      showControls,
      showShareMenu,
      showMiniMap,
      enableKeyboard,
      enableContextMenu,
      enableDragDrop,
      enableImageDrop,
      enableZoom,
      enablePan,
      enableSelection,
      enableNodeMove,
      enableEmbed,
      enableAlignmentGuides,
      alignmentSnapThreshold,
    ],
  );
  const isEditMode = mode === 'edit';
  // US-027: mirror `flags` into a ref so empty-deps useCallback bodies (like
  // `onWrapperContextMenuCapture` below) can read the live value without
  // having to be redeclared every render.
  const flagsRef = useRef(flags);
  useEffect(() => {
    flagsRef.current = flags;
  }, [flags]);
  // US-008: collapse the public `autoFitView` prop (boolean | object |
  // undefined) into a stable pair of booleans every downstream effect reads.
  // Memoized on the raw prop reference so callers passing the same value
  // (or its object form) don't re-trigger the effects below on every render.
  //
  // Mini mode treats `autoFitView` as `true` by default — thumbnails need
  // self-framing without callers having to remember the flag. Explicit
  // `autoFitView={false}` (or an object) still wins; the default only fills
  // in `undefined`.
  const effectiveAutoFitView = autoFitView ?? (mode === 'mini' ? true : undefined);
  const resolvedAutoFitView = useMemo(
    () => resolveAutoFitView(effectiveAutoFitView),
    [effectiveAutoFitView],
  );
  // US-026: destructure the bundled `runtime` prop into the legacy per-stream
  // names every downstream call site already uses. Keeps the diff focused on
  // the prop API while preserving the existing memo/dependency wiring.
  const runs = runtime?.runs;
  const statusByNode = runtime?.statuses;
  const nodeOverrides = runtime?.pendingOverrides?.nodes;
  const connectorOverrides = runtime?.pendingOverrides?.connectors;
  // Bottom-toolbar draw mode (US-028). When `drawShape` is set, the wrapper
  // shows a crosshair cursor and a pointer-down on the React Flow pane begins
  // an Excalidraw-style drag. We track the start + current pointer position in
  // CLIENT coordinates and only convert to flow coordinates at commit time
  // (mouse-up); the ghost preview overlay renders relative to the wrapper's
  // bounding rect, so it stays accurate even if the canvas pans during the
  // gesture (the underlying flow conversion handles the transform).
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  // US-008: one-shot guard for the auto-fit-view mount effect. Flipped to
  // `true` the first time the canvas calls `fitView` from the mount path so
  // re-renders (selection changes, prop churn) don't re-fit the viewport.
  const didMountFitRef = useRef(false);
  // US-009: deferred-fit slot for the signal-driven external-change fit.
  // When the signal bumps mid-drag / mid-resize, the would-be `fitView` call
  // is stashed here and flushed by {@link flushPendingFit} once the
  // interaction ends. Storing the intent (not the options) keeps the flush
  // path tied to {@link FIT_VIEW_OPTIONS} so the manual and auto paths can't
  // drift.
  const pendingFitRef = useRef(false);
  // US-009: one-shot guard so the signal-watching effect's initial run (any
  // mount of the canvas always invokes a useEffect once with the seed deps)
  // skips firing fitView. Without this, a host that mounts the canvas with
  // an `autoFitViewSignal` already set would double-fire with the mount-fit
  // path.
  const signalEffectMountedRef = useRef(false);
  // US-009: mirror `resolvedAutoFitView` into a ref so the signal-watching
  // effect (deps: only `[autoFitViewSignal]`) reads the latest flag without
  // re-running when the flag flips. Inline assignment instead of a useEffect
  // so the test renderer (which no-ops effects) still sees the live value.
  const resolvedAutoFitViewRef = useRef(resolvedAutoFitView);
  resolvedAutoFitViewRef.current = resolvedAutoFitView;
  // US-008: late-nodes mount-fit. The primary mount-fit path lives inside
  // <ReactFlow>'s `onInit` callback (so the fit happens the same tick the
  // instance becomes available), but hosts that mount the canvas with an
  // empty `nodes` prop and populate it asynchronously (e.g. an SSE-driven
  // initial load) need this effect to catch up — it re-runs when `nodes` or
  // the resolved `onMount` flag changes and fits the viewport on the first
  // render where every guard is satisfied. `didMountFitRef` ensures the two
  // paths can't double-fire.
  useEffect(() => {
    if (didMountFitRef.current) return;
    if (!resolvedAutoFitView.onMount) return;
    if (nodes.length === 0) return;
    const rfInstance = rfInstanceRef.current;
    if (!rfInstance) return;
    rfInstance.fitView(FIT_VIEW_OPTIONS);
    didMountFitRef.current = true;
  }, [nodes, resolvedAutoFitView.onMount]);
  // US-006: handle to the React Flow store (registered by <StoreApiBridge>).
  // Used to call `cancelConnection` when ESC cancels an in-flight connection.
  const storeApiRef = useRef<StoreApi | null>(null);
  // Canvas mode is owned by the parent (demo-view.tsx) so the page-level
  // keyboard handler and command palette can drive tool switches. Derive the
  // legacy `drawShape` view (the armed shape, or null when not drawing) so
  // existing gesture/cursor code keeps reading the same value. `handMode` is
  // the new flag for the four React Flow lock-down props.
  const drawShape: DrawableNodeType | null = canvasMode.kind === 'draw' ? canvasMode.shape : null;
  // Draw-icon mirrors `drawShape` for the icon-insert flow: a non-null
  // `iconName` arms the same click/drag-to-place gesture used for shapes,
  // so the Insert-icon popover commits via the canvas (not at viewport center).
  const drawIcon: string | null = canvasMode.kind === 'draw-icon' ? canvasMode.iconName : null;
  // True when either draw flow is armed — gates cursor, RF lock-downs,
  // selection, and pan activation identically for both.
  const drawArmed = drawShape !== null || drawIcon !== null;
  // Pen tool arms freehand stroke capture. Like drawArmed it locks down the RF
  // interaction props (pan/marquee/select/connect/drag — every `<ReactFlow>`
  // gate below ORs in `penMode`) and switches the cursor, but unlike the
  // shape/icon draw flows it records a full path and stays armed across
  // multiple strokes. The prop-level lock-down is load-bearing: xyflow's
  // pan/marquee run on NATIVE pane listeners, so the pen handler's
  // stopPropagation alone can't keep them from firing during a stroke.
  const penMode = canvasMode.kind === 'pen';
  const handMode = canvasMode.kind === 'hand';
  // Mid-connect (or mid-reconnect) flag drives a wrapper class so handles on
  // every node stay visible until the gesture releases — the source has
  // US-018: per-edge imperative handle map. Each EditableEdge registers its
  // `enter inline-edit` callback on mount; demo-canvas calls the registered
  // handle from onEdgeDoubleClick so a double-click anywhere on the edge body
  // (not just the label button) opens the inline editor. Map (not React
  // state) so registering/unregistering doesn't churn re-renders.
  const editHandlesRef = useRef<Map<string, () => void>>(new Map());
  const registerEditHandle = useCallback((id: string, enter: () => void) => {
    editHandlesRef.current.set(id, enter);
    return () => {
      const current = editHandlesRef.current.get(id);
      // Only delete if it's the same handle — guards against stale unregisters
      // racing a remount.
      if (current === enter) editHandlesRef.current.delete(id);
    };
  }, []);

  // Which connector (if any) currently has its label open for inline edit.
  // Lives in a ref — NOT EditableEdge's local state — because an SSE
  // `flow:reload` echo (every label commit triggers one) makes React Flow
  // transiently re-resolve edge positions; for one frame the edge's positions
  // read null, so xyflow's EdgeWrapper renders null and tears down + remounts
  // the EditableEdge. Local `editing` state would be lost in that remount,
  // collapsing the editor and stealing focus mid-typing. A canvas-owned ref
  // survives the remount: the freshly-mounted EditableEdge reads it back and
  // re-enters edit mode. A ref (not state) avoids a re-render of every edge and
  // keeps the hook-shim test's useState slot indices stable.
  const editingConnectorIdRef = useRef<string | null>(null);
  const getEditingConnectorId = useCallback(() => editingConnectorIdRef.current, []);
  const setEditingConnectorId = useCallback((id: string | null) => {
    editingConnectorIdRef.current = id;
  }, []);

  // already left hover and the user needs to discover drop targets without
  // hover-then-aim. Toggled via onConnectStart/End + onReconnectStart/End.
  const [connecting, setConnecting] = useState(false);
  // Mirror `connecting` into a ref so the global ESC handler (single window
  // listener) reads the live value without re-binding on every render.
  const connectingRef = useRef(false);
  useEffect(() => {
    connectingRef.current = connecting;
  }, [connecting]);
  // US-006: ESC during a connection/reconnect drag flips these flags so the
  // body-drop fallback inside onConnectEndCb / onReconnectEndCb early-exits
  // without persisting a connector. The synthesized mouseup we dispatch to
  // end xyflow's document-level pointer listeners would otherwise fall
  // through to the body-drop hit-test and create a stray edge.
  const connectCancelledRef = useRef(false);
  const reconnectCancelledRef = useRef(false);
  // US-009: true while a RECONNECT drag is in flight (set in onReconnectStart,
  // cleared in onReconnectEnd). Read by the custom connection-line component
  // so a NEW-connection drag (onConnectStart) doesn't accidentally inherit the
  // styling of an unrelated selected edge — only a real reconnect gesture does.
  const isReconnectingRef = useRef(false);
  // US-015: drop-on-pane popover state. Set in onConnectEndCb when a new
  // connection drag releases over empty canvas (not on a node body, not on a
  // handle). The popover anchors at the cursor's screen position and offers
  // the canvas-toolbar's shape set; picking one fans out to the parent's
  // create-and-connect callback. Null when no popover is open.
  const [dropPopover, setDropPopover] = useState<{
    /** Cursor screen position the popover anchors to (client px). */
    clientX: number;
    clientY: number;
    /** Drop position in flow space — feeds the new node's position. */
    flowX: number;
    flowY: number;
    /** Source node id for the connector wired into the new node. */
    sourceNodeId: string;
  } | null>(null);
  // US-013/015 (icon picker): the state slice + pick handlers live in demo-view
  // so the detail panel's "Change icon…" button (US-015) and the type:'icon'
  // double-click (US-016) can dispatch openIconPicker('replace', nodeId)
  // without going through this component. demo-canvas is a transparent
  // pass-through for the toolbar's controlled-open chrome only.
  // Mirror into a ref so cross-handler closures (ESC chain, viewport-change
  // dismissal) read the live value without re-binding.
  const dropPopoverRef = useRef<typeof dropPopover>(null);
  useEffect(() => {
    dropPopoverRef.current = dropPopover;
  }, [dropPopover]);
  const closeDropPopover = useCallback(() => {
    setDropPopover(null);
  }, []);
  // US-009: memoize the connection-line component so React Flow doesn't see a
  // new identity each render and remount the line mid-drag. The component
  // closes over `isReconnectingRef`; the ref itself is stable across renders.
  const connectionLineComponent = useMemo(
    () => buildReconnectAwareConnectionLine(isReconnectingRef),
    [],
  );
  // US-017: imperative DOM markers driven by pointermove tracking during a
  // connection / reconnect drag. `data-connect-source` is set on the source
  // node so its outlets stay visible (other nodes' outlets are hidden via
  // CSS). `data-connect-target` is set on whichever node is currently under
  // the cursor (excluding the source) so the candidate-target highlight
  // tracks the user's aim. Both are cleared in `clearConnectMarkers` on
  // gesture end (drop/cancel). Refs back the markers so the cleanup function
  // doesn't have to re-walk every node element.
  const connectSourceNodeIdRef = useRef<string | null>(null);
  const connectTargetNodeIdRef = useRef<string | null>(null);
  const setConnectSource = useCallback((nodeId: string | null) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      connectSourceNodeIdRef.current = nodeId;
      return;
    }
    const prev = connectSourceNodeIdRef.current;
    if (prev && prev !== nodeId) {
      const prevEl = wrapper.querySelector(`.react-flow__node[data-id="${CSS.escape(prev)}"]`);
      prevEl?.removeAttribute('data-connect-source');
    }
    if (nodeId) {
      const el = wrapper.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`);
      el?.setAttribute('data-connect-source', 'true');
    }
    connectSourceNodeIdRef.current = nodeId;
  }, []);
  const setConnectTarget = useCallback((nodeId: string | null) => {
    const wrapper = wrapperRef.current;
    const prev = connectTargetNodeIdRef.current;
    if (prev === nodeId) return;
    if (wrapper && prev) {
      const prevEl = wrapper.querySelector(`.react-flow__node[data-id="${CSS.escape(prev)}"]`);
      prevEl?.removeAttribute('data-connect-target');
    }
    if (wrapper && nodeId) {
      const el = wrapper.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`);
      el?.setAttribute('data-connect-target', 'true');
    }
    connectTargetNodeIdRef.current = nodeId;
  }, []);
  const clearConnectMarkers = useCallback(() => {
    setConnectSource(null);
    setConnectTarget(null);
  }, [setConnectSource, setConnectTarget]);
  // Track the cursor's hovered node while a connect or reconnect drag is in
  // flight. xyflow's connection line is owned by document-level pointer
  // listeners inside `@xyflow/system` XYHandle, so we ride the same channel
  // (pointermove on document) to stay in sync without fighting React Flow
  // for ownership of the gesture. Listener mounts only while `connecting`
  // is true and unmounts on end / cancel — no idle-time cost.
  useEffect(() => {
    if (!connecting) {
      setConnectTarget(null);
      return;
    }
    // Coalesce the hit-test through rAF: a fast pointer stream (240+ Hz) was
    // running `nodeElNearPoint` — which falls back to `querySelectorAll('.react-flow__node')`
    // + `getBoundingClientRect()` PER node when the cursor is in empty space —
    // on every event. At many-node densities the buffered fallback forces a
    // synchronous layout per event; capping at one hit-test per frame keeps
    // the connection-drag main-thread cost bounded regardless of node count.
    let rafId: number | null = null;
    let lastEvent: { clientX: number; clientY: number } | null = null;
    const flush = () => {
      rafId = null;
      const e = lastEvent;
      lastEvent = null;
      if (!e) return;
      const nodeEl = nodeElNearPoint(wrapperRef.current, e.clientX, e.clientY);
      const id = nodeEl?.getAttribute('data-id') ?? null;
      // The source node should not also be highlighted as a target — dropping
      // back on the source is rejected by both onConnect (same-node guard at
      // demo-canvas:1241) and the body-drop fallback (lines 1307, 1452, 1465),
      // so showing it as a candidate would mislead the user.
      if (id && id === connectSourceNodeIdRef.current) {
        setConnectTarget(null);
        return;
      }
      setConnectTarget(id);
    };
    const onMove = (e: globalThis.PointerEvent) => {
      lastEvent = { clientX: e.clientX, clientY: e.clientY };
      if (rafId !== null) return;
      rafId = requestAnimationFrame(flush);
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [connecting, setConnectTarget]);
  // State drives the ghost preview render; refs back the handlers so a single
  // synchronous gesture (pointerdown→move→up in one task) reads up-to-date
  // values without waiting for a React re-render to refresh useCallback
  // closures.
  //
  // Coordinates are stored in CLIENT space (window-relative) — converting
  // to wrapper-local at down-time and back at up-time would drift if the
  // wrapper moves between events (e.g. error banner appears, header expands,
  // etc.). Ghost render uses the current wrapper rect to compute local
  // offsets just for paint.
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const drawShapeRef = useRef<DrawableNodeType | null>(null);
  const drawIconRef = useRef<string | null>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const drawCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const drawingRef = useRef(false);
  // Pen-tool (freehand) capture. `penPointsRef` accumulates raw CLIENT-space
  // [x, y, pressure] samples for the in-progress stroke; `penDrawingRef` gates
  // the pointer-move/up handlers. Both are appended AFTER the existing draw
  // refs so the hook-shim ref-index map (drawShape..drawing) stays stable —
  // never insert a useRef above drawShapeRef. The live preview re-render is
  // driven by reusing the existing drawStart/drawCurrent state slots (set in
  // the pen pointer-down/move branches), so no new useState is introduced.
  const penPointsRef = useRef<Point[]>([]);
  const penDrawingRef = useRef(false);
  const penModeRef = useRef(penMode);
  // Tracks whether Shift was held on the most recent pen pointer event, so the
  // live preview and the commit can straighten the stroke. A ref (not state) so
  // it never adds a useStateOverrides slot.
  const penShiftRef = useRef(false);
  // Timestamp (ms) of the most recent pen pointer event where Shift was held.
  // The straighten decision and the live preview both treat Shift as still
  // engaged for PEN_SHIFT_GRACE_MS after this, so release-time jitter (or Shift
  // lifting a hair before the button) doesn't drop the straight line. Reset to 0
  // at stroke start so a previous stroke's Shift never bleeds into the next one.
  const penShiftHeldAtRef = useRef(0);
  // Shape/icon drag-create: tracks whether Shift was held on the most recent
  // draw pointer event, so the gesture constrains to a perfect square (1:1
  // bounding box) — a perfect circle for ellipse, a square for rectangle, etc.
  // Refs (not state) so they never add a useStateOverrides slot, and declared
  // AFTER the pen refs so the hook-shim ref-index map (drawShape..penMode)
  // stays stable. Mirrors the pen-tool straighten pattern incl. the grace clock
  // so release-time Shift jitter doesn't drop the constraint.
  const drawShiftRef = useRef(false);
  const drawShiftHeldAtRef = useRef(0);
  // Timestamped client-space samples for the in-progress draw gesture. On
  // commit `settleDrawRelease` reads these to discard an accidental
  // end-of-gesture flick (the pointer yanked away as the button is released)
  // so a too-quick "mouse leave" doesn't become the shape's final corner.
  // Appended AFTER the existing draw refs so the hook-shim ref-index map
  // (drawShape..penMode) stays stable.
  const drawSamplesRef = useRef<DrawSample[]>([]);

  // Mirror drawShape/drawIcon state into refs so handlers see the live value
  // without depending on closure identity (handler refs need to stay stable so
  // React event delegation keeps working across renders mid-gesture).
  useEffect(() => {
    drawShapeRef.current = drawShape;
  }, [drawShape]);
  useEffect(() => {
    drawIconRef.current = drawIcon;
  }, [drawIcon]);
  useEffect(() => {
    penModeRef.current = penMode;
  }, [penMode]);

  const exitDrawMode = useCallback(() => {
    onCanvasModeChange({ kind: 'select' });
    setDrawStart(null);
    setDrawCurrent(null);
    drawShapeRef.current = null;
    drawIconRef.current = null;
    drawStartRef.current = null;
    drawCurrentRef.current = null;
    drawingRef.current = false;
    // Also tear down any in-progress freehand stroke so an Esc mid-draw (pen
    // mode also funnels through here) leaves no orphaned path.
    penDrawingRef.current = false;
    penPointsRef.current = [];
    penShiftRef.current = false;
    penShiftHeldAtRef.current = 0;
    drawShiftRef.current = false;
    drawShiftHeldAtRef.current = 0;
    drawSamplesRef.current = [];
  }, [onCanvasModeChange]);

  // US-006: ESC priority chain. A single window-level keydown listener handles
  // all in-progress cancellations in most-specific-first order, with early
  // returns so a single keypress triggers exactly one cancellation.
  //
  //   1. Inline label edit — handled by InlineEdit's own onKeyDown (cancel +
  //      stopPropagation). We additionally bail when focus is in an editable
  //      element so a future inline editor that forgets stopPropagation still
  //      gets the right behaviour.
  //   2. Drag-create (toolbar shape placement) — exit draw mode, no node added.
  //   3. Connection drag (mid edge-draw, before drop) — flag the cancel so
  //      the body-drop fallback in onConnectEndCb is skipped, then dispatch a
  //      synthetic mouseup so xyflow's document-level pointer listeners stop
  //      tracking the gesture.
  //   3a. Drop-on-pane popover — close it (see inline note below).
  //   3b. Group isolation (M6) — exit the entered group. Ranked ABOVE the
  //      selection-clear so the first Esc exits isolation and a second Esc clears
  //      selection (the design §5.3 ranking).
  //   4. Selection — clear node + connector selections.
  //
  // (Marquee cancellation was removed in US-022 — the marquee gesture is no
  //  longer wired; primary-mouse drag on empty canvas is a no-op.)
  useEffect(() => {
    // US-027: in view mode the canvas is read-only — no draw/connection/
    // selection gestures can be in flight, and there's no edit chrome whose
    // ESC chain we'd need to drive. Skip wiring the listener entirely.
    if (!flags.enableKeyboard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 1. Inline label edit — defer to InlineEdit's own handler.
      if (isEditableTarget(document.activeElement)) return;
      // 2. Drag-create (shape or icon) or pen mode. exitDrawMode also tears
      //    down any in-progress freehand stroke and disarms the pen.
      if (drawShapeRef.current || drawIconRef.current || penModeRef.current) {
        e.preventDefault();
        exitDrawMode();
        return;
      }
      // 3. Connection drag (or reconnect).
      if (connectingRef.current) {
        e.preventDefault();
        connectCancelledRef.current = true;
        reconnectCancelledRef.current = true;
        // Clear xyflow's connection-store immediately so the in-flight
        // connection line stops rendering, and end the gesture by
        // synthesizing a mouseup on document — xyflow's onPointerUp inside
        // XYHandle is bound to document, so this is what unwinds its
        // closure listeners. Coords default to (0,0); the cancel flag
        // makes onConnectEndCb early-exit before any hit-test.
        try {
          storeApiRef.current?.getState().cancelConnection();
        } catch {
          // store may not be available (test harness without provider) — fall
          // through to mouseup dispatch which still ends the gesture.
        }
        document.dispatchEvent(
          new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }),
        );
        setConnecting(false);
        return;
      }
      // 3a. US-015: drop-on-pane popover. Closing here (rather than relying
      //     solely on Radix's onEscapeKeyDown) handles the case where focus is
      //     still on the canvas after the drag — Radix only intercepts ESC
      //     when focus is inside the popover content.
      if (dropPopoverRef.current) {
        e.preventDefault();
        setDropPopover(null);
        return;
      }
      // 3b. Canvas grouping M6 — EXIT isolation (design §5.3 exit path a). Ranked
      //     ABOVE selection-clear ON PURPOSE: the FIRST Esc exits an entered
      //     group (members stay selected); a SECOND Esc then falls through to the
      //     selection-clear below. Read from the ref so this stable listener sees
      //     the latest value.
      if (activeGroupIdRef.current !== null) {
        e.preventDefault();
        setActiveGroupId(null);
        return;
      }
      // 4. Selection clear.
      const hadNodeSel = selectedIdSetRef.current.size > 0;
      const hadConnSel = selectedConnIdSetRef.current.size > 0;
      if (hadNodeSel || hadConnSel) {
        e.preventDefault();
        onSelectionChangeRef.current?.([], []);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exitDrawMode, flags.enableKeyboard]);

  // Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z / Cmd/Ctrl+Y — undo/redo. Wired ABOVE the
  // clipboard chord on purpose: history is the single most-used shortcut, so
  // the matching listener fires first. Editable-surface detection mirrors the
  // clipboard handler's path (`isEditableTarget`) so native browser undo keeps
  // working inside inputs/textareas/InlineEdit. When `history` is absent the
  // event passes through so the host or browser can handle it.
  useEffect(() => {
    if (!flags.enableKeyboard) return;
    const onKey = (e: KeyboardEvent) => {
      const histChord = resolveHistoryChord(e, {
        isEditableActive: isEditableTarget(document.activeElement),
      });
      if (!histChord) return;
      if (history) {
        e.preventDefault();
        e.stopPropagation();
        if (histChord === 'undo') {
          void history.undo();
        } else {
          void history.redo();
        }
      }
      // No `history` supplied — let the event fall through to the host or
      // browser.
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, flags.enableKeyboard]);

  // US-022: Cmd/Ctrl + C / Cmd/Ctrl + V — copy/paste the current selection.
  // Mirrors the US-017 pattern: pure helper drives the dispatch, the listener
  // body is a thin shim. Delegates to `onCopySelection` / `onPasteSelection`
  // (the same paths the right-click menu's Copy / Paste items use, modulo the
  // multi-id signature for keyboard copy), so undo plumbing + single-undo-step
  // + edge filtering come for free from the parent's existing implementation.
  useEffect(() => {
    // US-027: keyboard chord wiring is gated together with the ESC chain. In
    // view mode the canvas surfaces nothing for the user to copy and nothing
    // to paste into.
    if (!flags.enableKeyboard) return;
    const onKey = (e: KeyboardEvent) => {
      handleClipboardShortcut({
        event: e,
        selectedNodeIds,
        hasClipboard: !!hasClipboard,
        activeElement: document.activeElement,
        onCopySelection,
        onPasteSelection,
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeIds, hasClipboard, onCopySelection, onPasteSelection, flags.enableKeyboard]);

  // Canvas grouping M4: ⌘G / ⌘⇧G keyboard chords. Mirrors the clipboard shim —
  // a pure resolver (`resolveGroupChord`) gates the chord, then the pure oracle
  // (`planGroupShortcutAction`) maps the live selection to create / ungroup / a
  // reasoned no-op. Gated on `flags.enableKeyboard` (off in view/mini). The
  // chord deliberately ignores ⌘D (Duplicate, design §5.4). A no-op result
  // still preventDefault()s only when we acted, so ⌘G over a non-groupable
  // selection falls through harmlessly.
  useEffect(() => {
    if (!flags.enableKeyboard) return;
    const onKey = (e: KeyboardEvent) => {
      const chord = resolveGroupChord(e, {
        isEditableActive: isEditableTarget(document.activeElement),
      });
      if (!chord) return;
      // Nothing to do if neither host callback is wired.
      if (!onCreateGroup && !onUngroup) return;
      const action = planGroupShortcutAction(nodes, selectedNodeIds);
      if (typeof action !== 'string') return; // reasoned no-op (empty/single/mixed/…)
      // The pressed chord must match the resolved action so ⌘G never ungroups
      // and ⌘⇧G never creates — if they disagree (e.g. ⌘⇧G over a loose
      // selection), do nothing rather than surprise the user.
      if (action !== chord) return;
      if (action === 'group') {
        if (!onCreateGroup) return;
        const ids = selectGroupableSet(nodes, selectedNodeIds);
        if (ids.length < 2) return;
        e.preventDefault();
        e.stopPropagation();
        onCreateGroup(ids);
        return;
      }
      // action === 'ungroup'
      if (!onUngroup) return;
      const groupIds = selectGroupSelection(nodes, selectedNodeIds);
      if (groupIds.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      // Common case is a single group; ungroup each selected group (each its
      // own atomic undo entry — multi-group ungroup is rare and not part of the
      // single-undo contract for one group).
      for (const gid of groupIds) onUngroup(gid);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nodes, selectedNodeIds, onCreateGroup, onUngroup, flags.enableKeyboard]);

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    // Pen tool: start a freehand stroke. Like the shape/icon draw flows, we
    // require the press to land on the pane (not a node) and capture client-
    // space samples. Reuses the drawStart/drawCurrent state slots purely to
    // force a re-render so the live preview overlay mounts — the actual path
    // lives in penPointsRef.
    if (penModeRef.current) {
      const target = e.target as HTMLElement | null;
      if (!target?.classList.contains('react-flow__pane')) return;
      penDrawingRef.current = true;
      penPointsRef.current = [[e.clientX, e.clientY, e.pressure || 0.5]];
      penShiftRef.current = e.shiftKey;
      // Reset the grace clock so a previous stroke's Shift never bleeds in.
      penShiftHeldAtRef.current = e.shiftKey ? Date.now() : 0;
      setDrawStart({ x: e.clientX, y: e.clientY });
      setDrawCurrent({ x: e.clientX, y: e.clientY });
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // ignore — gesture still works without explicit capture
      }
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!drawShapeRef.current && !drawIconRef.current) return;
    const target = e.target as HTMLElement | null;
    if (!target?.classList.contains('react-flow__pane')) return;
    const client = { x: e.clientX, y: e.clientY };
    drawingRef.current = true;
    drawStartRef.current = client;
    drawCurrentRef.current = client;
    drawShiftRef.current = e.shiftKey;
    // Reset the grace clock so a previous gesture's Shift never bleeds in.
    drawShiftHeldAtRef.current = e.shiftKey ? Date.now() : 0;
    // Seed the settle buffer with the anchor sample (fresh array per gesture).
    drawSamplesRef.current = [{ x: client.x, y: client.y, t: drawSampleTime(e) }];
    setDrawStart(client);
    setDrawCurrent(client);
    // Capture the pointer so move/up land here even if the cursor leaves
    // the React Flow pane (e.g. drags up onto the toolbar). Wrapped because
    // setPointerCapture throws on synthetic (non-trusted) events used in tests.
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // ignore — gesture still works without explicit capture
    }
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    // Pen tool: accumulate the stroke sample and re-render the live preview.
    if (penDrawingRef.current) {
      penShiftRef.current = e.shiftKey;
      // Stamp the grace clock whenever Shift is held so a brief lift/jitter at
      // release stays inside the straighten window (PEN_SHIFT_GRACE_MS).
      if (e.shiftKey) penShiftHeldAtRef.current = Date.now();
      penPointsRef.current.push([e.clientX, e.clientY, e.pressure || 0.5]);
      setDrawCurrent({ x: e.clientX, y: e.clientY });
      return;
    }
    if (!drawingRef.current) return;
    const client = { x: e.clientX, y: e.clientY };
    drawCurrentRef.current = client;
    drawShiftRef.current = e.shiftKey;
    // Stamp the grace clock whenever Shift is held so a brief lift/jitter at
    // release stays inside the constrain window (PEN_SHIFT_GRACE_MS).
    if (e.shiftKey) drawShiftHeldAtRef.current = Date.now();
    drawSamplesRef.current.push({ x: client.x, y: client.y, t: drawSampleTime(e) });
    setDrawCurrent(client);
  }, []);

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      // Pen tool: end the freehand stroke and commit it as a freehand node.
      // We deliberately do NOT exitDrawMode() here — the pen stays armed so the
      // user can draw multiple strokes in a row (Esc / toolbar toggle exits).
      if (penDrawingRef.current) {
        penDrawingRef.current = false;
        try {
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        } catch {
          // capture may not have been granted; ignore.
        }
        // Append the pointer-up position as the final sample. pointermove stops
        // firing a frame before release, so without this the stroke ends at the
        // last MOVE, not where the button actually came up — the straightened
        // line (and a free curve) would stop short of the release point.
        const raw: Point[] = [...penPointsRef.current, [e.clientX, e.clientY, e.pressure || 0.5]];
        penPointsRef.current = [];
        // Straighten when Shift is engaged — read from the pointer-up event, the
        // last pointermove (`penShiftRef`), OR the grace window. Releasing the
        // button often jerks the pointer and can lift Shift a hair early, so the
        // final event may carry `shiftKey: false` even though the user drew (and
        // saw) a straight line. The grace keeps "what you see is what commits"
        // across that release jitter. Both refs reset AFTER the decision reads
        // them (and on the early-return below).
        const straighten =
          e.shiftKey ||
          penShiftRef.current ||
          Date.now() - penShiftHeldAtRef.current <= PEN_SHIFT_GRACE_MS;
        setDrawStart(null);
        setDrawCurrent(null);
        const rfInstance = rfInstanceRef.current;
        // < 2 points (a tap) or no RF instance → nothing to commit; stay armed.
        if (!rfInstance || raw.length < 2) {
          penShiftRef.current = false;
          penShiftHeldAtRef.current = 0;
          return;
        }
        // Hold Shift → straighten the stroke to a 2-point segment snapped to the
        // nearest 45° direction, BEFORE the normalize→RDP pipeline. The
        // accidental-click guard below still runs on the original `raw` screen
        // extent so a true tap never commits, while a deliberate short straight
        // line does.
        const first = raw[0];
        const last = raw[raw.length - 1];
        const samples: Point[] =
          straighten && first && last ? [first, snapToStraightLine(first, last)] : raw;
        penShiftRef.current = false;
        penShiftHeldAtRef.current = 0;
        // Project each client sample into flow coords for the committed box.
        const flowPts: Point[] = samples.map((p) => {
          const f = rfInstance.screenToFlowPosition({ x: p[0], y: p[1] });
          return [f.x, f.y, p[2]];
        });
        const box = boundingBox(flowPts);
        // Accidental-click guard uses SCREEN extent — it's a UX threshold the
        // user perceives in screen px, independent of zoom (mirrors the shape
        // MIN_DRAW_SIZE rule). Always measured on the ORIGINAL raw samples.
        const screenBox = boundingBox(raw);
        if (isAccidentalStroke(screenBox)) return;
        const normalized = simplifyRDP(normalizePoints(flowPts, box), 0.005);
        onCreateFreehandNode?.(
          { x: box.x, y: box.y },
          { width: box.width, height: box.height },
          normalized,
        );
        return;
      }
      if (!drawingRef.current) return;
      drawingRef.current = false;
      try {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      } catch {
        // capture may not have been granted (synthetic events, browsers
        // without pointer capture support); ignore.
      }
      const start = drawStartRef.current;
      const current = drawCurrentRef.current;
      const shape = drawShapeRef.current;
      const iconName = drawIconRef.current;
      const rfInstance = rfInstanceRef.current;
      // Capture BOTH the settled release point AND the Shift-constrain decision
      // BEFORE exitDrawMode() — it resets drawShiftRef/drawShiftHeldAtRef (and
      // clears the sample buffer), so reading them afterwards would always see
      // the reset values and silently drop the constraint at commit (the ghost
      // previews a perfect shape but the placed node would be free-aspect).
      //
      // settleDrawRelease finalizes the buffer with the release position and
      // discards an accidental end-of-gesture flick (the pointer yanked away as
      // the button releases) so a too-quick "mouse leave" doesn't become the
      // shape's final corner; a deliberate drag commits exactly where released.
      drawSamplesRef.current.push({ x: e.clientX, y: e.clientY, t: drawSampleTime(e) });
      const release = settleDrawRelease(drawSamplesRef.current);
      // Shift constrains the drag to the shape's perfect form (square/circle for
      // rect/ellipse, equilateral triangle / regular hexagon, etc). Mirror the
      // pen straighten gate: honor Shift held on the last pointer event OR
      // within the grace window so release-time jitter doesn't drop the
      // constraint. Geometric shapes + icons constrain; linkflow keeps free aspect.
      const constrain =
        drawShiftRef.current || Date.now() - drawShiftHeldAtRef.current <= PEN_SHIFT_GRACE_MS;
      // Always exit draw mode after a gesture, even if the commit short-circuits
      // (too small, missing references). The PRD spec: "After commit (or ESC),
      // draw mode exits automatically and the cursor returns to default."
      // exitDrawMode also resets the gesture refs (drawShift*, samples).
      exitDrawMode();
      if (!start || !current || !rfInstance) return;
      if (!shape && !iconName) return;
      // Aspect-lock the (settled) drag box in SCREEN px (zoom-independent,
      // matches the ghost) around the start anchor, preserving drag direction.
      // Done before the screenToFlowPosition projection so the committed node
      // paints exactly where the ghost previewed it.
      const squared =
        constrain && shape !== 'linkflow' && shape !== 'line'
          ? perfectDragBox(start, release, perfectShapeAspect(shape))
          : release;
      const minX = Math.min(start.x, squared.x);
      const minY = Math.min(start.y, squared.y);
      const maxX = Math.max(start.x, squared.x);
      const maxY = Math.max(start.y, squared.y);
      const dragScreenWidth = maxX - minX;
      const dragScreenHeight = maxY - minY;
      // US-010: convert both corners through screenToFlowPosition so the
      // committed width/height are in FLOW units. The ghost preview is drawn
      // in client px (`canvas-draw-ghost`), and React Flow renders the node
      // at `width × zoom` client px — passing the raw screen-px drag would
      // make the placed node visually larger (or smaller) than the ghost
      // whenever zoom ≠ 1. With both corners projected, the committed
      // logical size is exactly the ghost's screen extent ÷ zoom, so the
      // result paints at the same client-pixel size as the ghost. This is
      // the standard React Flow drag-create pattern (RF docs:
      // https://reactflow.dev/examples/interaction/drag-and-drop).
      const flowMin = rfInstance.screenToFlowPosition({ x: minX, y: minY });
      const flowMax = rfInstance.screenToFlowPosition({ x: maxX, y: maxY });
      const dragFlowWidth = flowMax.x - flowMin.x;
      const dragFlowHeight = flowMax.y - flowMin.y;
      // Linkflow has its own commit branch: it's not a geometric primitive (no
      // SHAPE_DEFAULT_SIZE entry) and the readable-floor is larger than the
      // geometric MIN_DRAW_SIZE — 160×80 keeps the unlinked pill + linked-
      // healthy card legible. A near-zero drag (< 4×4 screen px) is a "tap"
      // and falls back to LINKFLOW_DEFAULT_SIZE (240×100) so a single click
      // still produces a usable node.
      if (shape === 'linkflow') {
        const isNearZeroDrag =
          dragScreenWidth < LINKFLOW_NEAR_ZERO_DRAG && dragScreenHeight < LINKFLOW_NEAR_ZERO_DRAG;
        const width = isNearZeroDrag
          ? LINKFLOW_DEFAULT_SIZE.width
          : Math.max(dragFlowWidth, LINKFLOW_MIN_SIZE.width);
        const height = isNearZeroDrag
          ? LINKFLOW_DEFAULT_SIZE.height
          : Math.max(dragFlowHeight, LINKFLOW_MIN_SIZE.height);
        onCreateLinkflowNode?.(flowMin, { width, height });
        return;
      }
      // Line commit: a decorative line is defined by its two directional
      // endpoints (NOT a sorted bbox), so we project the raw press + release
      // points to flow space, snap a near-straight segment to exactly H/V, and
      // store the endpoints normalized to their bounding box. A near-zero drag
      // (tap) falls back to a default-length horizontal line so a single click
      // still produces a usable line.
      if (shape === 'line') {
        const aFlow = rfInstance.screenToFlowPosition(start);
        const isTap = dragScreenWidth < MIN_DRAW_SIZE && dragScreenHeight < MIN_DRAW_SIZE;
        const bRaw = isTap
          ? { x: aFlow.x + LINE_DEFAULT_LENGTH, y: aFlow.y }
          : rfInstance.screenToFlowPosition(release);
        const lineZoom = rfInstance.getViewport().zoom;
        const bFlow = snapSegmentToStraight(aFlow, bRaw, STRAIGHT_SNAP_PX / lineZoom);
        const box = boxFromEndpoints(aFlow, bFlow, LINE_MIN_BOX);
        const points = normalizePointsToBox(aFlow, bFlow, box);
        onCreateLineNode?.(
          { x: box.x, y: box.y },
          { width: box.width, height: box.height },
          points,
        );
        return;
      }
      // Icon commit: same MIN_DRAW_SIZE "intentional drag" threshold as
      // geometric shapes, but the floor is ICON_DEFAULT_SIZE so a near-zero
      // tap still produces a usable node at the picker's expected size.
      if (iconName) {
        const tooSmall = dragScreenWidth < MIN_DRAW_SIZE || dragScreenHeight < MIN_DRAW_SIZE;
        const width = tooSmall ? ICON_DEFAULT_SIZE.width : dragFlowWidth;
        const height = tooSmall ? ICON_DEFAULT_SIZE.height : dragFlowHeight;
        onCreateIconNode?.(iconName, flowMin, { width, height });
        return;
      }
      if (!shape) return;
      // MIN_DRAW_SIZE stays in screen pixels — it's a UX threshold for
      // distinguishing "intentional drag" from "accidental click", which the
      // user perceives in screen-space, not flow-space. Below the threshold
      // on either axis we fall back to SHAPE_DEFAULT_SIZE (already in flow
      // units) so single-clicks still produce a usable node.
      const tooSmall = dragScreenWidth < MIN_DRAW_SIZE || dragScreenHeight < MIN_DRAW_SIZE;
      const width = tooSmall ? SHAPE_DEFAULT_SIZE[shape].width : dragFlowWidth;
      const height = tooSmall ? SHAPE_DEFAULT_SIZE[shape].height : dragFlowHeight;
      onCreateShapeNode?.(shape, flowMin, { width, height });
    },
    [
      exitDrawMode,
      onCreateShapeNode,
      onCreateIconNode,
      onCreateFreehandNode,
      onCreateLinkflowNode,
      onCreateLineNode,
    ],
  );
  // Block upstream sync while a node is mid-drag or mid-resize. NodeResizer
  // dispatches dimension changes into rfNodes during the gesture; if we then
  // overwrite rfNodes with sourceNodes (from server, which still has the old
  // dimensions until the PATCH echoes back), the node snaps back. The
  // resizingRef is set/cleared by node components via data.setResizing.
  const draggingRef = useRef(false);
  const resizingRef = useRef(false);
  // US-004 alignment guides: the hook's API (assigned at render below, after
  // the last useState slot so it doesn't shift the hook-shim test indices) and
  // the latest drag-event modifier state (Cmd/Ctrl). `onNodesChange` and the
  // drag handlers read these refs so their useCallbacks stay dependency-stable.
  // Declared AFTER drawingRef (REF index 19 in the hook-shim test) so the
  // index-coupled ref assertions don't drift; refs never affect useState slots.
  const alignmentApiRef = useRef<UseAlignmentGuidesApi | null>(null);
  const lastDragModifierRef = useRef<{ metaKey?: boolean; ctrlKey?: boolean }>({});
  // Canvas grouping M5 (design §9.1, §12.2): frozen drag-START snapshot for a
  // group drag. Children have absolute positions, so xyflow won't move them when
  // the group node is dragged — the canvas fans the group's delta out to its
  // members both LIVE (per-frame optimistic overrides) and on COMMIT (one
  // batched move). Captured once in the drag-start handler when the dragged set
  // contains a group:
  //   - `groups`: each dragged group's id + its member ids (from data.childIds).
  //   - `startPositions`: absolute start position of every group AND member, the
  //     non-negotiable frozen baseline. The per-frame delta is read against THIS
  //     (group's live position − its start), never the previous frame, so the
  //     additive fan-out can't drift or compound (unlike the resize bug).
  //   - `directIds`: ids xyflow itself is dragging (the group + any independently
  //     selected nodes) — excluded from the LIVE fan-out so a selected member
  //     isn't translated twice (dedupe, §9.1 step 2).
  // Null whenever the active drag has no group involved (the common case → zero
  // overhead on ordinary node drags). Cleared on drag-stop/cancel.
  const groupDragRef = useRef<{
    groups: DraggedGroup[];
    childIdsByGroup: Map<string, readonly string[]>;
    startPositions: Map<string, { x: number; y: number }>;
    directIds: Set<string>;
  } | null>(null);
  // Latest `nodes` prop mirrored into a ref so the drag handlers (stable
  // useCallbacks) read the current node list (for `data.childIds`) without
  // re-allocating every render (same pattern as the other drag refs).
  const nodesRef = useRef<FlowNode[]>(nodes);
  nodesRef.current = nodes;
  // View-mode drag override: in view mode, commitDraggedNodes skips the
  // parent dispatch (no adapter PATCH), so a moved node's new position lives
  // only in `rfNodes`. Any sourceNodes rebuild (selection change, SSE tick,
  // etc.) would then re-sync rfNodes back to the server position and snap
  // the node home. Stash the final drag position here and merge it into
  // `sourceNodes` so view-mode moves stick for the canvas's lifetime.
  // Edit mode never writes to this ref (commitDraggedNodes guards on
  // `!isEditMode`) and the merge in `sourceNodes` also gates on
  // `!isEditMode`, so edit-mode rendering is byte-identical to before.
  const viewModePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  // US-009: flush a deferred external-change fit once any in-flight node
  // drag / resize finishes. Idempotent: a second call after the first
  // consume is a no-op (pendingFitRef is back to false). Re-checks the
  // interaction refs in case the user chained drag → resize and the first
  // gesture ended but a different one is still live.
  const flushPendingFit = useCallback(() => {
    if (!pendingFitRef.current) return;
    if (resizingRef.current || draggingRef.current) return;
    pendingFitRef.current = false;
    rfInstanceRef.current?.fitView(FIT_VIEW_OPTIONS);
  }, []);
  const setResizing = useCallback(
    (on: boolean) => {
      resizingRef.current = on;
      // US-009: once a resize gesture ends, flush any deferred external-change
      // fit so the viewport re-frames around the new graph without yanking the
      // user mid-gesture.
      if (!on) flushPendingFit();
    },
    [flushPendingFit],
  );
  // US-005: stable resize-alignment delegate injected into every node's runtime
  // data (`data.resizeAlignment`) so `useResizeGesture` can snap the moving
  // edge(s) and surface live guides. It reads through `alignmentApiRef` (the
  // hook's API is assigned there at render below) so this object's identity
  // never changes — node `data` stays referentially stable across renders.
  // useMemo (not useState) keeps the hook-shim test slot ordering intact.
  const resizeAlignment = useMemo<ResizeAlignmentHooks>(
    () => ({
      beginResize: (nodeId, edges) => alignmentApiRef.current?.beginResize(nodeId, edges),
      applyResizeSnap: (rawRect, event) =>
        alignmentApiRef.current?.applyResizeSnap(rawRect, event) ?? {
          snappedRect: rawRect,
          guides: [],
        },
      endResize: () => alignmentApiRef.current?.endResize(),
    }),
    [],
  );
  // US-009: signal-driven external-change fit. Bumping `autoFitViewSignal`
  // re-runs this effect; the first run (initial mount tick) flips
  // `signalEffectMountedRef` and skips so the signal path doesn't double-fire
  // with the mount-fit. When an interaction is in flight, the fit is
  // deferred to `pendingFitRef` and flushed by {@link flushPendingFit}.
  // The `onExternalNodeChange` flag is read via a ref so flipping it alone
  // (without a signal bump) does NOT yank the viewport. `autoFitViewSignal`
  // is intentionally the SOLE dep: the cb doesn't consume its value, only
  // the change event itself triggers the re-run (per the US-009 spec).
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger-only dep
  useEffect(() => {
    if (!signalEffectMountedRef.current) {
      signalEffectMountedRef.current = true;
      return;
    }
    if (!resolvedAutoFitViewRef.current.onExternalNodeChange) return;
    if (resizingRef.current || draggingRef.current) {
      pendingFitRef.current = true;
      return;
    }
    rfInstanceRef.current?.fitView(FIT_VIEW_OPTIONS);
  }, [autoFitViewSignal]);

  // Right-click context menu state. Radix's <ContextMenu.Root> is event-driven
  // (its <Trigger> opens the menu on its own contextmenu event) and has no
  // controlled `open` prop. To open the menu at the cursor position from
  // React Flow's onNodeContextMenu — which runs BEFORE the trigger's listener
  // would fire (and we preventDefault to suppress browser's default menu) —
  // we render an invisible 0×0 trigger element pinned to the cursor and
  // dispatch a synthetic contextmenu event on it. The same trigger ref is
  // re-positioned for every right-click; one ContextMenu instance handles
  // every node. The menu items read `contextNodeIdRef` so callbacks dispatch
  // to the right node even if state hasn't re-rendered yet.
  const contextEnabled =
    !!onReorderNode ||
    !!onDeleteNode ||
    !!onCopyNode ||
    !!onPasteAt ||
    !!onUnpinEndpoint ||
    !!onCreateGroup ||
    !!onUngroup;
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  // Whether the most recent right-click landed on a node (true) vs. the empty
  // pane (false). Used to gate per-node items (Copy / reorder / Delete) which
  // don't make sense for an empty-canvas right-click. State (not just a ref)
  // because the menu's children are read on render — and the menu re-renders
  // when contextMenuPos changes, so this stays in sync via the same setState
  // pair below.
  const [contextOnNode, setContextOnNode] = useState(false);
  // US-003: track the right-clicked node's type so icon-node-specific items
  // (currently just 'Change icon') render only when the cursor landed on a
  // type:'icon' node. Cleared whenever the menu closes or the right-click hit the pane.
  const [contextNodeType, setContextNodeType] = useState<string | null>(null);
  // US-007: track an endpoint right-click so the menu shows an "Unpin" item
  // tied to a specific connector + endpoint. `pinned` mirrors the dot's data-
  // attribute at the moment of right-click so the item is only visible for
  // already-pinned endpoints (the only ones where "Unpin" is meaningful).
  const [contextEndpoint, setContextEndpoint] = useState<{
    connectorId: string;
    kind: 'source' | 'target';
    pinned: boolean;
  } | null>(null);
  const contextNodeIdRef = useRef<string | null>(null);
  const contextTriggerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!contextMenuPos) return;
    const trigger = contextTriggerRef.current;
    if (!trigger) return;
    // Dispatch a synthetic contextmenu event so Radix's Trigger opens at the
    // cursor. The Trigger reads clientX/clientY off the event for positioning.
    const evt = new MouseEvent('contextmenu', {
      clientX: contextMenuPos.x,
      clientY: contextMenuPos.y,
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
    });
    trigger.dispatchEvent(evt);
  }, [contextMenuPos]);

  const handleReorderPick = useCallback(
    (op: ReorderOp) => {
      const id = contextNodeIdRef.current;
      if (!id || !onReorderNode) return;
      onReorderNode(id, op);
    },
    [onReorderNode],
  );

  const handleDeletePick = useCallback(() => {
    const id = contextNodeIdRef.current;
    if (!id || !onDeleteNode) return;
    onDeleteNode(id);
  }, [onDeleteNode]);

  const handleCopyPick = useCallback(() => {
    const id = contextNodeIdRef.current;
    if (!id || !onCopyNode) return;
    onCopyNode(id);
  }, [onCopyNode]);

  // US-003: dispatch the icon-replace flow (same path as US-016 dblclick and
  // US-022 StyleStrip button) so the picker opens for the right-clicked node
  // and a single undo entry is pushed when an icon is selected.
  const handleChangeIconPick = useCallback(() => {
    const id = contextNodeIdRef.current;
    if (!id || !onRequestIconReplace) return;
    onRequestIconReplace(id);
  }, [onRequestIconReplace]);

  // US-007: right-click on a visible endpoint dot opens the canvas's
  // context menu in "endpoint mode". The dot calls into this from its own
  // onContextMenu, which we route through edge.data so editable-edge can
  // stay free of canvas state. `pinned` is captured at right-click time so
  // the Unpin item only shows for already-pinned endpoints.
  const handleEndpointContextMenu = useCallback(
    (
      connId: string,
      kind: 'source' | 'target',
      pinned: boolean,
      clientX: number,
      clientY: number,
    ) => {
      // US-027: gate endpoint context menu on the same flag as the rest of
      // the context-menu chain.
      if (!flagsRef.current.enableContextMenu) return;
      contextNodeIdRef.current = null;
      setContextOnNode(false);
      setContextNodeType(null);
      setContextEndpoint({ connectorId: connId, kind, pinned });
      setContextMenuPos({ x: clientX, y: clientY });
    },
    [],
  );

  // US-007: invoke onUnpinEndpoint with the captured endpoint. Same one-undo-
  // entry contract as the pin path (parent owns the undo push).
  const handleUnpinPick = useCallback(() => {
    const ep = contextEndpoint;
    if (!ep || !onUnpinEndpoint) return;
    onUnpinEndpoint(ep.connectorId, ep.kind);
  }, [contextEndpoint, onUnpinEndpoint]);

  const handlePastePick = useCallback(() => {
    if (!onPasteAt) return;
    const pos = contextMenuPos;
    const rfInstance = rfInstanceRef.current;
    if (!pos || !rfInstance) return;
    // Convert the right-click's client coords to flow space so the parent
    // anchors the pasted node(s) at the cursor regardless of pan/zoom.
    const flowPos = rfInstance.screenToFlowPosition({ x: pos.x, y: pos.y });
    onPasteAt(flowPos);
  }, [contextMenuPos, onPasteAt]);

  // Canvas grouping M4: context-menu "Group" — create a group from the current
  // loose multi-selection (the same `selectGroupableSet` filter the keyboard +
  // host paths use). Reads the live selection, not the right-clicked node.
  const handleGroupPick = useCallback(() => {
    if (!onCreateGroup) return;
    const ids = selectGroupableSet(nodes, selectedNodeIds);
    if (ids.length < 2) return;
    onCreateGroup(ids);
  }, [onCreateGroup, nodes, selectedNodeIds]);

  // Canvas grouping M4: context-menu "Ungroup" — dissolve the right-clicked
  // group. Reads `contextNodeIdRef` (the right-clicked node) like Copy/Delete.
  const handleUngroupPick = useCallback(() => {
    const id = contextNodeIdRef.current;
    if (!id || !onUngroup) return;
    onUngroup(id);
  }, [onUngroup]);

  // Show ⌘ on macOS, Ctrl elsewhere. Read once per render (cheap) — Radix
  // re-mounts the menu on every open so the value is captured at the right
  // moment. navigator may be undefined in non-browser contexts (SSR), but
  // this component is purely client-side so the access is safe.
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
  const copyShortcut = isMac ? '⌘C' : 'Ctrl+C';
  const pasteShortcut = isMac ? '⌘V' : 'Ctrl+V';
  const groupShortcut = isMac ? '⌘G' : 'Ctrl+G';
  const ungroupShortcut = isMac ? '⌘⇧G' : 'Ctrl+Shift+G';
  // Canvas grouping M4: does the live selection support "Group"? Drives the
  // context-menu item's visibility so it appears precisely when ⌘G would create
  // a group (≥2 loose, groupable). Independent of which right-click path opened
  // the menu (single-node vs marquee), so a right-click on one of several
  // selected loose nodes still offers Group.
  const contextCanGroup = useMemo(
    () => !!onCreateGroup && planGroupShortcutAction(nodes, selectedNodeIds) === 'group',
    [onCreateGroup, nodes, selectedNodeIds],
  );

  // Set lookups for the controlled selection. React Flow's internal selection
  // is mirrored back via onSelectionChange so the parent's arrays remain the
  // source of truth — sourceNodes/rfEdges are recomputed off these sets.
  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const selectedConnectorIdSet = useMemo(
    () => new Set(selectedConnectorIds),
    [selectedConnectorIds],
  );

  // Canvas grouping M2: is the selection exactly one group? Drives the overlay's
  // gating (a one-member group still gets chrome) and, later, the ＋/⊟ icon (M4).
  const selectedGroupId = useMemo<string | null>(() => {
    if (selectedNodeIds.length !== 1) return null;
    const only = nodes.find((n) => n.id === selectedNodeIds[0]);
    return only?.type === 'group' ? only.id : null;
  }, [nodes, selectedNodeIds]);
  const isGroupSelection = selectedGroupId !== null;

  // Canvas grouping M4: the bound action for the overlay's ＋/⊟ icon + the
  // context-menu items. Dispatches CREATE for a loose multi-selection or UNGROUP
  // for a single selected group, threading the host callbacks. `null` when the
  // current selection has no group action available OR the host didn't wire the
  // matching callback — the overlay then hides the icon (no dead affordance).
  // The keyboard path does NOT use this (it runs `planGroupShortcutAction`
  // directly so ambiguous selections no-op with a reason, not silently).
  const onGroupAction = useMemo<(() => void) | undefined>(() => {
    if (selectedGroupId !== null) {
      if (!onUngroup) return undefined;
      const gid = selectedGroupId;
      return () => onUngroup(gid);
    }
    if (selectedNodeIds.length >= 2) {
      if (!onCreateGroup) return undefined;
      const ids = [...selectedNodeIds];
      return () => onCreateGroup(ids);
    }
    return undefined;
  }, [selectedGroupId, selectedNodeIds, onCreateGroup, onUngroup]);

  // US-007 + grouping M2: payload for the selection/group bounding-box overlay.
  // Reduces the canvas's `nodes` to the minimum shape `<SelectionResizeOverlay>`
  // needs and applies optimistic position/data overrides so the rect tracks the
  // live canvas, not the server snapshot.
  //
  // Two selection shapes (design §12.5):
  //  - loose multi-selection (≥2): the selected nodes themselves.
  //  - a single group: the group's MEMBERS (resolved from `childIds`) PLUS the
  //    group box, so the rect hugs the right geometry and M5 can scale members
  //    from this set.
  //
  // Each node's size is resolved measured ?? data ?? fallback (design §12.1) so
  // auto-sized html/component members (no `data.width/height`) still enclose.
  // The overlay decides presence internally so we pass through unconditionally.
  const selectionOverlayNodes = useMemo<OverlayInputNode[]>(() => {
    const overrides = nodeOverrides;
    const rfInstance = rfInstanceRef.current;
    const toInput = (base: FlowNode): OverlayInputNode => {
      const override = overrides?.[base.id];
      const oData = (override?.data ?? {}) as { width?: number; height?: number };
      const bData = base.data as { width?: number; height?: number };
      // measured ?? (optimistic) data ?? data ?? fallback (§12.1). Measured is
      // the rendered footprint of auto-sized nodes; an explicit data width (e.g.
      // a live resize override) takes precedence when present.
      const measured = rfInstance?.getInternalNode(base.id)?.measured;
      const dataW = oData.width ?? bData.width;
      const dataH = oData.height ?? bData.height;
      return {
        id: base.id,
        type: base.type,
        position: override?.position ?? base.position,
        width: dataW ?? measured?.width ?? OVERLAY_FALLBACK_DIM.width,
        height: dataH ?? measured?.height ?? OVERLAY_FALLBACK_DIM.height,
        data: { width: dataW, height: dataH },
      };
    };

    // Single group: members (from childIds) + the group box.
    if (selectedGroupId !== null) {
      const group = nodes.find((n) => n.id === selectedGroupId);
      if (!group || group.type !== 'group') return [];
      const memberIds = new Set(group.data.childIds);
      const inputs: OverlayInputNode[] = [];
      for (const n of nodes) {
        if (memberIds.has(n.id)) inputs.push(toInput(n));
      }
      // Include the group box so an empty/sparse group still has a rect to hug.
      inputs.push(toInput(group));
      return inputs;
    }

    // Loose multi-selection.
    if (selectedNodeIds.length < 2) return [];
    const inputs: OverlayInputNode[] = [];
    for (const id of selectedNodeIds) {
      const base = nodes.find((n) => n.id === id);
      if (base) inputs.push(toInput(base));
    }
    return inputs;
  }, [nodes, nodeOverrides, selectedNodeIds, selectedGroupId]);

  // A group's ONLY stylable surface is its border (no background/corner/shadow/
  // text). A pure single-group selection routes straight through so the
  // StyleStrip's group branch shows the border color + width editor; in any
  // OTHER (multi / mixed) selection the group is filtered out so the strip
  // styles only the loose nodes (a group's border is edited when it's selected
  // on its own). Uses the existing isGroupSelection signal.
  const selectedNodesForStyleStrip = isGroupSelection
    ? (selectedNodes ?? [])
    : (selectedNodes ?? []).filter((n) => n.type !== 'group');

  const sourceNodes = useMemo<Node[]>(() => {
    const buildNode = (merged: FlowNode): Node => {
      // View-mode local drag override: see viewModePositionsRef declaration.
      // Gated on !isEditMode so edit-mode renders byte-identical to before;
      // the ref is never written in edit mode but the guard is also load-
      // bearing if mode flips mid-life (an entry from a previous view-mode
      // session must not leak into edit-mode rendering).
      const viewOverridePos = !isEditMode ? viewModePositionsRef.current.get(merged.id) : undefined;
      const node: Node = {
        id: merged.id,
        type: merged.type,
        position: viewOverridePos ?? merged.position,
        data: {
          ...merged.data,
          // US-004: file-backed renderers (type:'image', type:'html') read
          // `projectId` to construct project-scoped file URLs. `fileBaseUrl`
          // (optional) lets embedders override the URL prefix so file fetches
          // resolve against a non-studio host — see SeeflowCanvasBaseProps.
          projectId,
          fileBaseUrl,
          // Cloud/authed mode: lets type:'image' resolve its token-gated asset
          // through the host (blob URL) instead of a header-less native <img>.
          resolveFileSrc,
          // US-031: component-node runtime POSTs script-kind actions to
          // `${apiBaseUrl}/projects/:project/flows/:flow/nodes/:nodeId/actions/:name`.
          // Gated on type so non-component nodes don't carry stray fields they'd
          // ignore. `projectSlug` mirrors the canvas's `projectId` prop (the
          // file-route addressing uses project slug); `flowSlug` is the active
          // flow's slug threaded from the host (apps/web/demo-view.tsx).
          projectSlug: merged.type === 'component' ? projectId : undefined,
          flowSlug: merged.type === 'component' ? flowSlug : undefined,
          apiBaseUrl: merged.type === 'component' ? apiBaseUrl : undefined,
          // US-008: type:'image' placeholder uses this callback when the user
          // clicks the 'Upload failed (click to retry)' state. Injected here so
          // every image node picks it up uniformly; non-image types ignore it.
          onRetryUpload: onRetryImageUpload,
          status: dataStatusFor(runs, merged.id),
          errorMessage: dataErrorMessageFor(runs, merged.id),
          // US-007: latest StatusReport for this node (if any). The rectangle
          // renderer reads this to draw its status badge row when a
          // statusAction capability is set. Undefined → row is suppressed
          // and the node renders byte-identical to legacy.
          statusReport: statusByNode?.[merged.id],
          onPlay: onPlayNode,
          onResize: onNodeResize,
          onResizeEnd: onNodeResizeEnd,
          setResizing,
          // US-005: alignment-guide resize integration. Only injected when the
          // feature is enabled (edit mode); view/mini get undefined so the
          // resize gesture stays byte-identical to legacy there. The renderer
          // forwards it to useResizeGesture as `alignment`.
          resizeAlignment: flags.enableAlignmentGuides ? resizeAlignment : undefined,
          // type:'html' + type:'component': routed through to the renderer's
          // fit-to-content button. Gated on type so other node variants don't
          // pick up an unused callback in their runtime data.
          onFitToContent:
            merged.type === 'html'
              ? onHtmlNodeFitToContent
              : merged.type === 'component'
                ? onComponentNodeFitToContent
                : undefined,
          onNameChange: (() => {
            // US-027: view mode → inline name edit is suppressed (the node's
            // dblclick-to-edit path gates on this callback being wired).
            if (!isEditMode) return undefined;
            // Ellipse drops the Name concept entirely — its centered label
            // renders `description`, and the detail panel hides the Name
            // field. Suppressing the callback also makes
            // `data.onNameChange === undefined`, which the geometric-node uses
            // to skip the dblclick-to-edit-name path.
            if (merged.type === 'ellipse') return undefined;
            return onNodeNameChange;
          })(),
          onDescriptionChange: (() => {
            // US-027: same read-only gate as onNameChange above.
            if (!isEditMode) return undefined;
            // Rectangle, ellipse, and sticky render a description body — wire
            // the canvas-side inline edit so dblclick on the body lands an
            // edit. Text + the illustrative-shape tags (database/server/
            // user/queue/cloud) and type:'image' / type:'icon' have no
            // on-canvas body text, so the inline-edit callback stays
            // undefined.
            if (
              merged.type === 'rectangle' ||
              merged.type === 'ellipse' ||
              merged.type === 'sticky'
            ) {
              return onNodeDescriptionChange;
            }
            return undefined;
          })(),
          onCaptionChange: (() => {
            // Image nodes render an optional caption below the image; wire the
            // canvas-side inline edit so a dblclick on the image lands a caption
            // edit. Same edit-mode gate as the other inline-edit callbacks.
            if (!isEditMode) return undefined;
            if (merged.type === 'image') return onNodeCaptionChange;
            return undefined;
          })(),
          onIconChange: (() => {
            // Same edit-mode + node-type gate as the inline-edit callbacks.
            // type:'rectangle', type:'component', and type:'linkflow' render a
            // header icon trigger next to the title — every other node type
            // either suppresses the icon affordance (geometric illustrative
            // shapes don't draw header chrome; text/sticky/ellipse have no
            // header) or owns the icon presentation differently (type:'icon',
            // type:'image'). type:'group' is chrome-less (no header/title), so it
            // carries no icon affordance.
            if (!isEditMode) return undefined;
            if (
              merged.type !== 'rectangle' &&
              merged.type !== 'component' &&
              merged.type !== 'linkflow'
            )
              return undefined;
            return onIconChange;
          })(),
          // US-015: inject autoEditOnMount on the freshly drop-popover-created
          // node so it opens in label-edit mode. The flag is consumed once at
          // mount by the node component (lazy useState initializer); leaving
          // it set on later renders is harmless.
          autoEditOnMount: pendingEditNodeId === merged.id ? true : undefined,
        },
        selected: selectedNodeIdSet.has(merged.id),
      };
      // Z-order (design §9.6, §12.4): a group MUST paint BEHIND its members and
      // behind the connector edges (pinned at zIndex 0 via DEFAULT_EDGE_OPTIONS).
      // Every other node leaves zIndex undefined (xyflow → 0), so the group
      // needs an explicit NEGATIVE value or DOM order would let a group authored
      // last paint over its members. `elevateNodesOnSelect={false}` + the
      // `.react-flow__node-group` z-index carve-out in index.css keep this stable
      // even when the group is selected. See GROUP_NODE_Z_INDEX in group-node.tsx.
      if (merged.type === 'group') node.zIndex = GROUP_NODE_Z_INDEX;
      // Pass explicit width/height to the React Flow node wrapper when set
      // in data. NodeResizer dispatches dimension changes that update these
      // during a gesture; we only persist (and hence sync them back into
      // data) on resize-stop.
      //
      // Skip when the node is in auto-size mode so the wrapper shrink-wraps
      // to the rendered chrome — otherwise the wrapper stays pinned to stale
      // defaults (e.g. component nodes' 320×240) while the inline-block body
      // grows to its natural size, and the `.react-flow__node.selected::after`
      // selection ring (anchored to the wrapper) no longer covers the visible
      // card. The resize gesture flips `resizingRef` via `setResizing(true)`
      // BEFORE the first per-tick onResize fires, so live drags still pin the
      // wrapper to the dragged dims even while data.autoSize is still true.
      const isAutoSize = (merged.data as { autoSize?: boolean }).autoSize === true;
      if (!isAutoSize || resizingRef.current) {
        if (merged.data.width !== undefined) node.width = merged.data.width;
        if (merged.data.height !== undefined) node.height = merged.data.height;
      }
      // US-025: only the selected node may originate a new connection. Setting
      // `connectable: false` on unselected nodes makes their Handles ignore
      // connection-start gestures (xyflow's per-node `connectable` overrides
      // the global `nodesConnectable`). Selected nodes leave the field
      // undefined so the global gate (read-only mode, drawShape) still
      // applies. Reconnect drops onto unselected nodes are unaffected —
      // xyflow's reconnect path snaps via the always-present `.source`/
      // `.target` DOM classes, not the Handle's `isConnectable` prop.
      if (!selectedNodeIdSet.has(merged.id)) node.connectable = false;
      return node;
    };
    const fromServer = nodes.map((n) => buildNode(mergeNodeOverride(n, nodeOverrides?.[n.id])));
    // Override-only entries represent optimistic/pending creations (US-007):
    // a shape node has been drawn locally and the override carries a full
    // FlowNode whose id is not yet on the server. Once the SSE echo of the
    // POST resolves, the entry shows up in `nodes` and `pruneAgainst` drops
    // the override (per US-021) — until then we render the candidate so the
    // node appears at the dragged size with no flicker from default→dragged.
    const serverIds = new Set(nodes.map((n) => n.id));
    const fromOverrides: Node[] = [];
    if (nodeOverrides) {
      for (const [id, partial] of Object.entries(nodeOverrides)) {
        if (serverIds.has(id)) continue;
        const cand = partial as Partial<FlowNode>;
        if (typeof cand.type !== 'string' || !cand.position || !cand.data) continue;
        fromOverrides.push(buildNode({ ...cand, id } as FlowNode));
      }
    }
    return [...fromServer, ...fromOverrides];
  }, [
    projectId,
    flowSlug,
    fileBaseUrl,
    resolveFileSrc,
    apiBaseUrl,
    nodes,
    selectedNodeIdSet,
    runs,
    statusByNode,
    onPlayNode,
    onNodeResize,
    onNodeResizeEnd,
    onHtmlNodeFitToContent,
    onComponentNodeFitToContent,
    setResizing,
    resizeAlignment,
    flags.enableAlignmentGuides,
    nodeOverrides,
    onNodeNameChange,
    onNodeDescriptionChange,
    onNodeCaptionChange,
    onIconChange,
    onRetryImageUpload,
    pendingEditNodeId,
    isEditMode,
  ]);

  // React Flow needs internal node state + onNodesChange to render drag
  // motion smoothly. Without it, the controlled `nodes` prop overrides the
  // drag position on every parent re-render (SSE `runs` ticks etc.) and the
  // node snaps back mid-drag. We freeze upstream sync while a drag is in
  // flight; the parent's positionOverrides take over after drag-stop.
  const [rfNodes, setRfNodes] = useState<Node[]>(sourceNodes);

  useEffect(() => {
    if (draggingRef.current || resizingRef.current) return;
    setRfNodes(sourceNodes);
  }, [sourceNodes]);

  // Mirror rfNodes into a ref so onNodesChange can compute the post-change
  // selection without waiting for setState to commit. Also kept in sync
  // synchronously inside onNodesChange — xyflow can fire that handler twice
  // in one synchronous task (resetSelectedElements + getSelectionChanges at
  // marquee start) and the second call must operate on the first call's
  // result, not on the pre-commit ref value (US-005).
  useEffect(() => {
    rfNodesRef.current = rfNodes;
  }, [rfNodes]);

  // selectedNodeIds is the source of truth for the selection rings. React Flow
  // dispatches its own `select` changes during resize/drag (and sometimes on
  // dimension changes) that would briefly drop the ring. Mirror the prop into
  // a ref and re-pin selected:true on every change so the visual stays
  // anchored to the parent's selection state — no flicker mid-resize. We
  // skip re-pinning ids that the user explicitly toggled in this batch
  // (Shift/Cmd-click), so deselect-via-multi-key still works (US-019).
  const selectedIdSetRef = useRef<Set<string>>(selectedNodeIdSet);
  useEffect(() => {
    selectedIdSetRef.current = selectedNodeIdSet;
  }, [selectedNodeIdSet]);

  // Stable handle for the parent's selection callback — the closure inside
  // onNodesChange/onEdgesChange would otherwise capture stale arrays. Using a
  // ref means user-driven selection changes always read the LATEST callback
  // without retriggering the React Flow listener wiring.
  const onSelectionChangeRef = useRef(onSelectionChange);
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  // Mirror connector-id state into a ref for the same reason as
  // selectedIdSetRef — the edge change handler reads the latest set without
  // re-binding.
  const selectedConnIdSetRef = useRef<Set<string>>(selectedConnectorIdSet);
  useEffect(() => {
    selectedConnIdSetRef.current = selectedConnectorIdSet;
  }, [selectedConnectorIdSet]);

  // rfNodes is also mirrored into a ref so the change handler can compute the
  // post-applyNodeChanges selection synchronously (the setRfNodes updater
  // function runs later and can't drive a side effect).
  //
  // Initialised to `sourceNodes` so synchronous render-time consumers
  // (US-023: isValidConnection + the onConnectEndCb non-connectable-target
  // distinguisher) see the live merged node list on the FIRST render,
  // before the mirror-useEffect below has had a chance to fire. Without
  // this seed the ref would be empty until after first paint — fine in
  // production (drags can't fire that fast) but inaccurate under test, and
  // also a subtle correctness window in production for any future code
  // that reads the ref synchronously during render.
  const rfNodesRef = useRef<Node[]>(sourceNodes);

  // US-010: marquee gesture state. While a marquee drag is in flight,
  // `marqueeActiveRef` flips true and the per-frame select changes accumulate
  // into the two id sets below. `onSelectionChange` is NOT called up to the
  // parent during the drag — only once at `onSelectionEnd`. The rfNodes
  // local state keeps applying the changes so the canvas still visually
  // reflects the live marquee (selection rings track the rubber-band) — but
  // the parent's controlled props (`selectedNodeIds` / `selectedConnectorIds`)
  // stay frozen, which is what eliminates the per-frame sourceNodes recompute
  // + buildNode churn that caused the flashing in earlier attempts.
  //
  // additiveBase{Node,Edge}IdsRef holds the pre-marquee selection when the
  // user holds Shift/Meta at marquee start. xyflow always dispatches
  // `resetSelectedElements` at the first pointermove past the click threshold,
  // so the additive base would normally get deselected mid-drag. We filter
  // those deselects for ids in the additive base so the existing selection is
  // preserved through the gesture (visible + final).
  const marqueeActiveRef = useRef(false);
  const marqueeSelectedNodeIdsRef = useRef<Set<string>>(new Set());
  const marqueeSelectedEdgeIdsRef = useRef<Set<string>>(new Set());
  const additiveBaseNodeIdsRef = useRef<Set<string>>(new Set());
  const additiveBaseEdgeIdsRef = useRef<Set<string>>(new Set());
  // US-010: tentative additive snapshot captured at pane pointer-down BEFORE
  // xyflow's resetSelectedElements runs (which lands in onPointerMove right
  // before onSelectionStart). Without this snapshot the prior selection is
  // already gone by the time onSelectionStart can read it. When the user holds
  // Shift/Meta/Ctrl at pointer-down on the pane, the snapshot becomes the
  // additive base; otherwise it's `{ shift: false }` and the marquee replaces.
  const tentativeAdditiveBaseRef = useRef<{
    shift: boolean;
    nodeIds: Set<string>;
    edgeIds: Set<string>;
  } | null>(null);

  const onNodesChange = useCallback((rawChanges: NodeChange[]) => {
    // US-004: alignment snap interception. Before any other processing, let the
    // alignment hook rewrite dragging position changes with the snap offset
    // (and commit the active guide lines to its own state). When disabled, no
    // gesture is active, or Cmd/Ctrl is held, this returns the changes
    // untouched. The modifier state is captured per-frame from onNodeDrag /
    // onSelectionDrag into `lastDragModifierRef`.
    const align = alignmentApiRef.current;
    const changes = align
      ? (align.interceptChanges(rawChanges, lastDragModifierRef.current) as NodeChange[])
      : rawChanges;
    // US-010: during an additive (Shift/Meta) marquee, skip xyflow's reset-
    // deselect for ids in the additive base — they should stay selected
    // through the gesture so the user sees the existing selection preserved.
    // xyflow's `resetSelectedElements` runs in onPointerMove BEFORE
    // onSelectionStart, so the additive base lives in tentativeAdditiveBaseRef
    // until onSelectionStart copies it into additiveBaseNodeIdsRef.
    const activeAdditiveBase = marqueeActiveRef.current
      ? additiveBaseNodeIdsRef.current
      : tentativeAdditiveBaseRef.current?.shift
        ? tentativeAdditiveBaseRef.current.nodeIds
        : null;
    const filteredChanges =
      activeAdditiveBase && activeAdditiveBase.size > 0
        ? changes.filter((c) => {
            if (c.type !== 'select') return true;
            if (c.selected === false && activeAdditiveBase.has(c.id)) return false;
            return true;
          })
        : changes;
    const explicitlyToggled = new Set<string>();
    for (const c of filteredChanges) {
      if (c.type === 'select') explicitlyToggled.add(c.id);
    }
    // applyNodeChanges on the current snapshot. We feed the same result to
    // setRfNodes below so the rendered nodes match what we're propagating.
    const next = applyNodeChanges(filteredChanges, rfNodesRef.current);
    // Live body resize: applyNodeChanges updates n.width/n.height on the
    // outer wrapper but leaves n.data alone. Renderers (state-node, shape-
    // node, ...) read data.width/data.height to compute `sized` — without it
    // a previously-unsized node's inner stays at DEFAULT_W mid-drag (only the
    // wrapper grows). Mirror n.width/n.height into data ONLY while a user-
    // driven resize is in flight; xyflow's measurement-driven dimension ticks
    // outside a gesture must NOT promote an auto-sized node to a fixed one.
    const dimensionTouched = new Set<string>();
    if (resizingRef.current) {
      for (const c of filteredChanges) {
        if (c.type === 'dimensions') dimensionTouched.add(c.id);
      }
    }
    const sized =
      dimensionTouched.size === 0
        ? next
        : next.map((n) => {
            if (!dimensionTouched.has(n.id)) return n;
            if (n.width === undefined && n.height === undefined) return n;
            return {
              ...n,
              data: {
                ...n.data,
                ...(n.width !== undefined ? { width: n.width } : {}),
                ...(n.height !== undefined ? { height: n.height } : {}),
              },
            };
          });
    const pinned = selectedIdSetRef.current;
    // Resize/dimension changes can transiently drop the `selected` flag —
    // restore it for nodes in `pinned` that the user didn't explicitly toggle
    // (US-019). US-010: skip the repin logic during a marquee gesture —
    // `pinned` reflects the parent's (stale) controlled selection prop, but
    // the marquee is actively changing selection; re-pinning previously-
    // selected nodes would fight the user's new marquee selection.
    const repinned = marqueeActiveRef.current
      ? sized
      : pinned.size === 0
        ? sized
        : sized.map((n) => {
            if (pinned.has(n.id) && !explicitlyToggled.has(n.id) && !n.selected) {
              return { ...n, selected: true };
            }
            return n;
          });
    rfNodesRef.current = repinned;
    setRfNodes(repinned);
    // Propagate user-driven selection changes up to the parent. Programmatic
    // prop updates bypass this — ReactFlow's StoreUpdater applies them
    // directly to the store without dispatching changes.
    if (explicitlyToggled.size === 0) return;
    // US-010: during marquee, accumulate into the local ref and SKIP the
    // parent callback so `selectedNodeIds` doesn't churn on every frame.
    // `onSelectionEnd` fires the cb once with the final set.
    if (marqueeActiveRef.current) {
      for (const c of filteredChanges) {
        if (c.type !== 'select') continue;
        if (c.selected) marqueeSelectedNodeIdsRef.current.add(c.id);
        else marqueeSelectedNodeIdsRef.current.delete(c.id);
      }
      return;
    }
    const cb = onSelectionChangeRef.current;
    if (!cb) return;
    const sel = repinned.filter((n) => n.selected).map((n) => n.id);
    const prev = selectedIdSetRef.current;
    const sameLen = prev.size === sel.length;
    const sameAll = sameLen && sel.every((id) => prev.has(id));
    if (sameAll) return;
    // US-025: sync the ref alongside the parent setState. xyflow's
    // `addSelectedEdges` / `addSelectedNodes` fire BOTH onEdgesChange and
    // onNodesChange synchronously when a click swaps selection across types
    // (e.g. node selected → click edge → edge selection + node deselection
    // dispatched in one task). The ref-syncing useEffect runs on commit, so
    // the second handler in the same task would otherwise read a stale set
    // and overwrite the first handler's cb result with empty data — a single
    // click would effectively clear both selections.
    selectedIdSetRef.current = new Set(sel);
    cb(sel, [...selectedConnIdSetRef.current]);
  }, []);

  // Edge changes — wired so user-driven edge selection (marquee, click,
  // multi-key toggle) propagates up the same way node selection does. Without
  // this, edges would be uncontrolled in the React Flow store and the
  // controlled `selected` flag from props could get out of sync.
  // rfEdges is declared further below; keep the latest reference in a ref so
  // this callback doesn't have to wait on the declaration order.
  const rfEdgesRef = useRef<Edge[]>([]);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    // US-010: filter reset-deselects on the additive base — same reasoning as
    // onNodesChange above.
    const activeAdditiveBase = marqueeActiveRef.current
      ? additiveBaseEdgeIdsRef.current
      : tentativeAdditiveBaseRef.current?.shift
        ? tentativeAdditiveBaseRef.current.edgeIds
        : null;
    const filteredChanges =
      activeAdditiveBase && activeAdditiveBase.size > 0
        ? changes.filter((c) => {
            if (c.type !== 'select') return true;
            if (c.selected === false && activeAdditiveBase.has(c.id)) return false;
            return true;
          })
        : changes;
    const explicitlyToggled = new Set<string>();
    for (const c of filteredChanges) {
      if (c.type === 'select') explicitlyToggled.add(c.id);
    }
    if (explicitlyToggled.size === 0) return;
    // US-010: same accumulator pattern as onNodesChange — during marquee,
    // collect the explicit toggles into the local ref and bail before firing
    // the parent callback.
    if (marqueeActiveRef.current) {
      for (const c of filteredChanges) {
        if (c.type !== 'select') continue;
        if (c.selected) marqueeSelectedEdgeIdsRef.current.add(c.id);
        else marqueeSelectedEdgeIdsRef.current.delete(c.id);
      }
      return;
    }
    const cb = onSelectionChangeRef.current;
    if (!cb) return;
    const next = applyEdgeChanges(filteredChanges, rfEdgesRef.current);
    const sel = next.filter((e) => e.selected).map((e) => e.id);
    const prev = selectedConnIdSetRef.current;
    const sameLen = prev.size === sel.length;
    const sameAll = sameLen && sel.every((id) => prev.has(id));
    if (sameAll) return;
    // US-025: see onNodesChange — sync the ref so the paired onNodesChange
    // call later in the same task reads up-to-date connector selection.
    selectedConnIdSetRef.current = new Set(sel);
    cb([...selectedIdSetRef.current], sel);
  }, []);

  // US-010: marquee gesture lifecycle. xyflow fires onSelectionStart when a
  // primary-button drag begins on the empty pane (or when modifier-marquee is
  // dispatched). onSelectionEnd fires on pointer-up. We snapshot the current
  // controlled selection into the marquee accumulator at start, then layer in
  // each per-frame select-change while the drag runs (see onNodesChange /
  // onEdgesChange above). At end we apply the xyflow #5451 workaround and
  // call the parent's onSelectionChange exactly once with the final set.
  //
  // Shift/Meta held at start → additive marquee: the pre-existing selection is
  // captured into additiveBase{Node,Edge}IdsRef and the change filters above
  // shield those ids from xyflow's `resetSelectedElements()`.
  const onSelectionStartCb = useCallback((event: ReactMouseEvent) => {
    marqueeActiveRef.current = true;
    const tentative = tentativeAdditiveBaseRef.current;
    // Prefer the tentative (captured at pointer-down before xyflow's reset);
    // fall back to event modifiers in case the pointer-down handler missed.
    const additive = tentative?.shift ?? (event.shiftKey || event.metaKey || event.ctrlKey);
    additiveBaseNodeIdsRef.current = additive
      ? new Set(tentative?.nodeIds ?? selectedIdSetRef.current)
      : new Set();
    additiveBaseEdgeIdsRef.current = additive
      ? new Set(tentative?.edgeIds ?? selectedConnIdSetRef.current)
      : new Set();
    marqueeSelectedNodeIdsRef.current = new Set(additiveBaseNodeIdsRef.current);
    marqueeSelectedEdgeIdsRef.current = new Set(additiveBaseEdgeIdsRef.current);
  }, []);
  const onSelectionEndCb = useCallback(() => {
    marqueeActiveRef.current = false;
    tentativeAdditiveBaseRef.current = null;
    const cb = onSelectionChangeRef.current;
    if (!cb) return;
    const finalNodeIds = [...marqueeSelectedNodeIdsRef.current];
    const finalNodeIdSet = new Set(finalNodeIds);
    const finalEdgeIds = new Set(marqueeSelectedEdgeIdsRef.current);
    // xyflow #5451 workaround: when the marquee covers both endpoints of an
    // edge, xyflow only marks a single edge between any node pair — parallel
    // edges (same source/target) get dropped from the selection. Sweep the
    // edge list and force-add any whose endpoints are both in the final
    // node-id set.
    for (const edge of rfEdgesRef.current) {
      if (finalNodeIdSet.has(edge.source) && finalNodeIdSet.has(edge.target)) {
        finalEdgeIds.add(edge.id);
      }
    }
    const prevNodeIds = selectedIdSetRef.current;
    const prevEdgeIds = selectedConnIdSetRef.current;
    const sameNodeSet =
      prevNodeIds.size === finalNodeIdSet.size && finalNodeIds.every((id) => prevNodeIds.has(id));
    const sameEdgeSet =
      prevEdgeIds.size === finalEdgeIds.size &&
      [...finalEdgeIds].every((id) => prevEdgeIds.has(id));
    if (sameNodeSet && sameEdgeSet) return;
    selectedIdSetRef.current = new Set(finalNodeIds);
    selectedConnIdSetRef.current = new Set(finalEdgeIds);
    cb(finalNodeIds, [...finalEdgeIds]);
  }, []);

  // US-010: capture-phase pointer-down on the wrapper fires BEFORE xyflow's
  // own onPointerDownCapture on `.react-flow__pane`. We use this to stash a
  // tentative additive-base snapshot (the pre-marquee selection) and the
  // shift/meta key state. xyflow's `resetSelectedElements()` then fires
  // synchronously inside onPointerMove past the click threshold — by then our
  // change-filter (see onNodesChange / onEdgesChange) can shield the additive
  // base from being deselected. Without this, the additive base is gone by
  // the time onSelectionStart runs.
  const onWrapperPointerDownCapture = useCallback((e: PointerEvent<HTMLDivElement>) => {
    tentativeAdditiveBaseRef.current = null;
    if (drawShapeRef.current) return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    // Only the pane itself is a marquee starting surface — handles, nodes,
    // edges, and the toolbar each have their own gestures.
    if (!target?.classList.contains('react-flow__pane')) return;
    tentativeAdditiveBaseRef.current = {
      shift: e.shiftKey || e.metaKey || e.ctrlKey,
      nodeIds: new Set(selectedIdSetRef.current),
      edgeIds: new Set(selectedConnIdSetRef.current),
    };
  }, []);

  // US-010: xyflow #2733 workaround. When ≥ 2 nodes are selected (or any
  // group node — placeholder for US-011+), a right-click on any of them
  // ought to open OUR Radix context menu so the user can act on the whole
  // selection. xyflow's onNodeContextMenu only fires for the single node
  // under the cursor (and clears multi-selection in the process). Wiring a
  // capture-phase listener on the wrapper lets us pre-empt the native menu
  // and open Radix BEFORE xyflow gets the event.
  const onWrapperContextMenuCapture = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    // US-027: view mode disables every context-menu pathway. Skip so the
    // browser's native right-click menu surfaces normally if the embedder
    // wants it.
    if (!flagsRef.current.enableContextMenu) return;
    // Only intervene when there's a multi-selection. Single-node and pane
    // right-clicks still flow through xyflow's onNodeContextMenu /
    // onPaneContextMenu paths (which handle their own preventDefault).
    const sel = selectedIdSetRef.current;
    if (sel.size < 2) return;
    const target = e.target as HTMLElement | null;
    // The synthetic contextmenu event we dispatch into the Radix trigger (via
    // the contextMenuPos useEffect below) bubbles back through this listener
    // — bail on the trigger element so we don't re-enter and loop.
    if (target === contextTriggerRef.current) return;
    // Verify the right-click landed inside the canvas (not on a popover,
    // menu, etc. that escaped through a Radix portal). Endpoint dots have
    // their own right-click handler (US-007) — let those through too.
    if (target?.closest('.seeflow-connector-endpoint-dot')) return;
    e.preventDefault();
    e.stopPropagation();
    contextNodeIdRef.current = null;
    setContextOnNode(true);
    setContextNodeType(null);
    setContextEndpoint(null);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  }, []);

  // US-008 + US-017: drag-enter on the canvas wrapper. Two payload kinds:
  // (1) OS image-file drag (US-008) — `DataTransfer.types` contains 'Files';
  // (2) HTML block toolbar tile (US-017) — `DataTransfer.types` contains the
  // {@link HTML_BLOCK_DND_TYPE} marker. The branch only opts-in to a drop
  // when the corresponding callback is wired, so a read-only canvas keeps
  // native file-drop affordances and never accepts a stray HTML block tile.
  // Setting `dropEffect = 'copy'` gives the OS cursor the canonical "drop a
  // copy here" affordance.
  const onWrapperDragOver = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      const types = dt.types ? Array.from(dt.types) : [];
      const hasFiles = types.includes('Files');
      const hasHtmlBlock = types.includes(HTML_BLOCK_DND_TYPE);
      // US-027: gate image drops on enableImageDrop, html-block drops on
      // enableDragDrop. Either flag can be flipped off independently of mode
      // for a partially-read-only canvas.
      const acceptImage = hasFiles && !!onCreateImageFromFile && flags.enableImageDrop;
      const acceptHtmlBlock = hasHtmlBlock && !!onCreateHtmlNode && flags.enableDragDrop;
      if (!acceptImage && !acceptHtmlBlock) return;
      e.preventDefault();
      try {
        dt.dropEffect = 'copy';
      } catch {
        // Safari can throw if dropEffect is set when DataTransfer is
        // read-only mid-dispatch — ignore; the preventDefault is what counts.
      }
    },
    [onCreateImageFromFile, onCreateHtmlNode, flags.enableImageDrop, flags.enableDragDrop],
  );

  // US-008 + US-017: drop on the canvas wrapper. Two payload kinds, same
  // priority order as `onWrapperDragOver`:
  // (1) HTML block toolbar tile (US-017) — projects the drop clientX/Y into
  //     flow space and dispatches `onCreateHtmlNode`. Checked first because
  //     the marker is unambiguous; an OS-image drop will never carry it.
  // (2) OS image file (US-008) — falls through to `handleCanvasFileDrop`,
  //     which walks the dropped files for the first acceptable image and
  //     dispatches `onCreateImageFromFile`. The parent owns id allocation,
  //     upload POST, and createNode persistence. No-op when the handler is
  //     unwired, when the drop has no image, or when React Flow's instance
  //     isn't initialized (drop on a not-yet-mounted canvas).
  const onWrapperDrop = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      const dataTransfer = e.dataTransfer;
      const types = dataTransfer?.types ? Array.from(dataTransfer.types) : [];
      const isHtmlBlockDrop = types.includes(HTML_BLOCK_DND_TYPE);
      // Only honor the HTML block drop when the parent wired the handler;
      // otherwise fall through (the marker on its own shouldn't enable
      // creation on a read-only canvas).
      if (isHtmlBlockDrop && onCreateHtmlNode && flags.enableDragDrop) {
        e.preventDefault();
        const rfInstance = rfInstanceRef.current;
        if (!rfInstance) return;
        const flowPos = rfInstance.screenToFlowPosition({
          x: e.clientX,
          y: e.clientY,
        });
        onCreateHtmlNode({ position: flowPos });
        return;
      }
      // US-027: image drop gated on enableImageDrop.
      if (!onCreateImageFromFile || !flags.enableImageDrop) return;
      // Replace-on-drop: if the drop landed ON an existing image node, swap that
      // node's image instead of creating a new one. Hit-test the drop target's
      // enclosing React Flow node and confirm it renders an image body.
      if (onReplaceImage) {
        const targetEl = e.target as HTMLElement | null;
        const nodeEl = targetEl?.closest('.react-flow__node') ?? null;
        const overImageId = nodeEl?.querySelector('[data-node-type="image"]')
          ? nodeEl.getAttribute('data-id')
          : null;
        if (overImageId) {
          const file = extractImageFile(e.dataTransfer);
          if (file) {
            e.preventDefault();
            onReplaceImage(overImageId, file);
            return;
          }
        }
      }
      // Capture clientX/Y synchronously — the synthetic event is recycled by
      // React once the handler returns, so the awaited dims read would see
      // stale coordinates.
      const clientPos = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      void handleCanvasFileDrop({
        dataTransfer,
        clientPos,
        rfInstance: rfInstanceRef.current,
        computeDims: computeImageDims,
        dispatch: onCreateImageFromFile,
      });
    },
    [
      onCreateImageFromFile,
      onReplaceImage,
      onCreateHtmlNode,
      flags.enableImageDrop,
      flags.enableDragDrop,
    ],
  );

  const reconnectableEdges = !!onReconnectConnector;
  // Reconnect endpoint handles are only useful when EXACTLY one connector is
  // selected — multi-select disables endpoint-drag (drag would re-route just
  // one of the selection, which is confusing). Mirrors single-select behavior.
  const onlySelectedConnectorId =
    selectedConnectorIdSet.size === 1 ? [...selectedConnectorIdSet][0] : null;
  const rfEdges = useMemo<Edge[]>(() => {
    const decorate = (c: Connector): Edge => {
      const adjacentRunning =
        statusFor(runs, c.source) === 'running' || statusFor(runs, c.target) === 'running';
      const isSelected = selectedConnectorIdSet.has(c.id);
      const edge = connectorToEdge(c, adjacentRunning, isSelected);
      if (isSelected) edge.selected = true;
      // `reconnectable: true` enables the endpoint-drag gesture for the edge;
      // React Flow shows reconnect handles on hover. Wired only when the
      // parent provided an onReconnectConnector callback AND this edge is the
      // sole selected connector — multi-select disables reconnect to avoid
      // ambiguous gestures.
      const enableReconnect = reconnectableEdges && c.id === onlySelectedConnectorId;
      // Selected edges share the DEFAULT_EDGE_OPTIONS zIndex (0) — the
      // connector line stays under nodes whether selected or not; only the
      // visible endpoint-dot portal (CSS z-index 2000) sits on top.
      const next: Edge = enableReconnect ? { ...edge, reconnectable: true } : edge;
      // Inject the runtime label-change callback into edge.data — same
      // channel the custom node components use for `onPlay` / `onResize`.
      // US-024: `reconnectable` tells the edge component to render the
      // visible (non-interactive) endpoint dots above other nodes; React
      // Flow's native EdgeUpdateAnchors handle the actual drag.
      return {
        ...next,
        data: {
          ...next.data,
          // US-027: view mode → suppress the inline label-edit handler so the
          // connector label renders read-only (EditableEdge gates on whether
          // this prop is wired).
          onLabelChange: isEditMode ? onConnectorLabelChange : undefined,
          reconnectable: enableReconnect,
          // Selection feedback for ANY selected connector (single OR multi).
          // Drives the non-interactive endpoint dots in EditableEdge; unlike
          // `reconnectable` it is not gated to the sole-selected connector.
          selectedMarker: isSelected,
          // US-018: stable callback (useCallback with empty deps) so the
          // memoized edge cache key doesn't churn.
          registerEditHandle,
          // Inline-edit session state lives on the canvas (see
          // editingConnectorIdRef) so it survives the edge remount an SSE echo
          // triggers mid-edit. Both are stable refs/callbacks → no cache churn.
          getEditingConnectorId,
          setEditingConnectorId,
        },
      };
    };
    const serverIds = new Set(connectors.map((c) => c.id));
    const fromServer = connectors.map((c) =>
      decorate(mergeConnectorOverride(c, connectorOverrides?.[c.id])),
    );
    // Override-only entries represent optimistic/pending creations (US-029):
    // the parent has set a full-Connector override BEFORE the POST round-trip
    // completes. Once the server echo arrives, the entry is also in
    // `connectors` and the prune drops the override (per US-021).
    const fromOverrides: Edge[] = [];
    if (connectorOverrides) {
      for (const [id, partial] of Object.entries(connectorOverrides)) {
        if (serverIds.has(id)) continue;
        const candidate = partial as Partial<Connector>;
        if (typeof candidate.source !== 'string' || typeof candidate.target !== 'string') {
          continue;
        }
        fromOverrides.push(decorate({ ...candidate, id } as Connector));
      }
    }
    const all = [...fromServer, ...fromOverrides];
    // Reorder so selected edges render LAST in xyflow's EdgeRenderer (DOM
    // last). When two unselected edges share zIndex 0, DOM order decides
    // hit-testing — and the EdgeUpdateAnchor circles that drive the outlet
    // drag live inside the edge SVG. Without reordering, a sibling edge
    // whose path crosses the selected edge's endpoint can swallow the click
    // (its path has `pointer-events: visibleStroke` and renders later), so
    // the user can't grab the outlet to reroute. Pushing the selected edge
    // to the back of the array makes its SVG paint last among edges and
    // catches the click first — while every edge stays at zIndex 0, so
    // connectors still sit under every node (only the outlet-dot portal
    // at z-index 2000 sits on top of nodes).
    const unselected: Edge[] = [];
    const selected: Edge[] = [];
    for (const e of all) {
      if (selectedConnectorIdSet.has(e.id)) selected.push(e);
      else unselected.push(e);
    }
    return [...unselected, ...selected];
  }, [
    connectors,
    runs,
    selectedConnectorIdSet,
    onlySelectedConnectorId,
    connectorOverrides,
    onConnectorLabelChange,
    reconnectableEdges,
    registerEditHandle,
    getEditingConnectorId,
    setEditingConnectorId,
    isEditMode,
  ]);

  // Mirror rfEdges into a ref so onEdgesChange (declared earlier) reads the
  // latest value without recreating the callback on every render.
  useEffect(() => {
    rfEdgesRef.current = rfEdges;
  }, [rfEdges]);

  // Local-only Tidy fallback for non-edit modes. View-mode embedders don't
  // own an adapter and typically don't wire `onTidy`, so the Controls cluster
  // would otherwise render the button disabled. When an adapter IS supplied
  // (view-mode with a server-backed embedder), delegate to its computeLayout;
  // otherwise the button stays disabled — the canvas can't do layered layout
  // without server help since elkjs would balloon the bundle. Move is
  // visual-only, not persisted (same philosophy as view-mode drags in US-027).
  // Anchors the laid-out cluster to its current top-left so the canvas
  // doesn't teleport on click, mirroring the host's onTidy convention.
  const adapterMaybe = (adapter ?? null) as CanvasAdapter | null;
  const internalTidy = useMemo(() => {
    if (!adapterMaybe?.computeLayout) return undefined;
    return async () => {
      const inst = rfInstanceRef.current;
      const current = rfNodesRef.current;
      if (current.length < 2) return;
      const layoutNodes: LayoutNodeInput[] = current.map((n) => {
        const measured = inst?.getInternalNode(n.id)?.measured;
        const dataAny = n.data as { width?: number; height?: number };
        const width = measured?.width ?? dataAny.width ?? 200;
        const height = measured?.height ?? dataAny.height ?? 120;
        return { id: n.id, type: n.type as LayoutNodeInput['type'], width, height };
      });
      const livePositions = new Map<string, { x: number; y: number }>();
      for (const n of current) livePositions.set(n.id, n.position);
      const layoutEdges = rfEdgesRef.current.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
      }));
      const compute = adapterMaybe.computeLayout;
      if (!compute) return;
      const result = await compute(layoutNodes, layoutEdges);
      const next = new Map<string, { x: number; y: number }>();
      for (const [id, entry] of Object.entries(result.nodes)) next.set(id, entry.position);

      let prevMinX = Number.POSITIVE_INFINITY;
      let prevMinY = Number.POSITIVE_INFINITY;
      let nextMinX = Number.POSITIVE_INFINITY;
      let nextMinY = Number.POSITIVE_INFINITY;
      for (const ln of layoutNodes) {
        const prev = livePositions.get(ln.id);
        if (!prev) continue;
        if (prev.x < prevMinX) prevMinX = prev.x;
        if (prev.y < prevMinY) prevMinY = prev.y;
        const np = next.get(ln.id);
        if (!np) continue;
        if (np.x < nextMinX) nextMinX = np.x;
        if (np.y < nextMinY) nextMinY = np.y;
      }
      const offsetX =
        Number.isFinite(prevMinX) && Number.isFinite(nextMinX) ? prevMinX - nextMinX : 0;
      const offsetY =
        Number.isFinite(prevMinY) && Number.isFinite(nextMinY) ? prevMinY - nextMinY : 0;

      setRfNodes((prev) =>
        prev.map((n) => {
          const np = next.get(n.id);
          if (!np) return n;
          return { ...n, position: { x: np.x + offsetX, y: np.y + offsetY } };
        }),
      );
    };
  }, [adapterMaybe]);
  // Non-edit modes (view) fall back to `internalTidy` when the host hasn't
  // wired `onTidy`. Edit mode preserves the legacy `disabled={!onTidy}` shape
  // ("no demo loaded" → disabled) so existing studio behavior is unchanged.
  const effectiveTidy = onTidy ?? (!isEditMode ? internalTidy : undefined);

  // `connectSucceededRef` lets onConnectEnd skip the body-drop fallback when
  // onConnect already fired (precise handle drop). Same pattern as
  // `reconnectSucceededRef` below.
  const connectSucceededRef = useRef(false);
  // US-023: drag-direction wins over React Flow's handle-type normalization.
  // RF's Connection payload places the source-type handle's node in `source`,
  // regardless of which node the user actually started dragging from. We
  // capture the drag origin in onConnectStart and re-swap downstream so the
  // persisted connector reflects the user's gesture, not RF's handle pairing.
  const connectStartRef = useRef<{ nodeId: string | null; handleType: HandleType | null } | null>(
    null,
  );
  // US-025: every new connector via onConnect is floating — drag-direction
  // determines source/target, but neither endpoint is pinned to a handle.
  // The user can later pin either side by reconnecting the endpoint onto a
  // specific handle dot.
  const onConnect = useCallback(
    (conn: Connection) => {
      // US-027: view mode → new connector creation is suppressed even when a
      // caller mistakenly passes onCreateConnector. nodesConnectable is also
      // gated below so the gesture can't start in the first place; this is the
      // defensive second gate at commit time.
      if (!isEditMode) return;
      if (!onCreateConnector) return;
      const { source, target } = conn;
      if (!source || !target) return;
      // Reject same-node connections client-side — the schema would also
      // accept them but they're never useful (a node referencing itself).
      if (source === target) return;
      connectSucceededRef.current = true;
      // US-023: drag-direction wins. When RF normalized source ↔ target
      // (user dragged from a target-type handle to a source-type handle),
      // re-swap so source = drag-start and target = drag-end. With floating
      // (US-025), no handle ids are persisted so the swap is purely about
      // which node owns the source/target slot.
      const dragStartNodeId = connectStartRef.current?.nodeId ?? null;
      const reversed =
        dragStartNodeId !== null && dragStartNodeId === target && dragStartNodeId !== source;
      const persistSource = reversed ? target : source;
      const persistTarget = reversed ? source : target;
      onCreateConnector(persistSource, persistTarget);
    },
    [onCreateConnector, isEditMode],
  );

  // US-004: text-shape nodes (data.shape === 'text') are pure annotations and
  // must never be a connection endpoint. xyflow already prevents drag-start
  // from a text node — US-003 removed every <Handle> on the text variant —
  // but `isValidConnection` is the defensive net for any path that bypasses
  // the no-handles invariant: a malformed flow.json that seeded an edge into
  // a text node, or a future feature exposing a text-type source. Returning
  // false here also makes xyflow flash the candidate handle red during a
  // drag (the `connectionState.isValid === false` branch in onConnectEnd)
  // for visible user feedback. NOT a per-handle count gate — that would
  // defeat US-015; see connection-limit.test.ts for the static-text fence.
  //
  // US-023: read from `rfNodesRef.current` (the post-merge xyflow node list
  // including optimistic overrides) rather than the `nodes` PROP. Freshly-
  // created nodes live in `nodeOverrides` until the SSE echo lands — they
  // appear in `rfNodes` immediately but only flow into the `nodes` prop
  // after the server round-trip. Reading from the ref means the validator
  // sees the fresh node and rejects-or-accepts based on its real `type`,
  // not on a (stale) "id not found → fall through to valid" path that
  // would let a fresh TEXT node bypass the gate.
  const isValidConnection = useCallback((conn: Connection | Edge) => {
    const isTextShape = (id: string | null | undefined): boolean => {
      if (!id) return false;
      const node = rfNodesRef.current.find((n) => n.id === id);
      if (!node) return false;
      return node.type === 'text';
    };
    return !isTextShape(conn.source) && !isTextShape(conn.target);
  }, []);

  // Body-drop fallback for NEW connections. When the user drags from a
  // source handle and releases over a node's BODY (not precisely on one of
  // its four handles), React Flow's connectionRadius isn't enough to snap
  // and onConnect doesn't fire. We catch that here, hit-test
  // elementsFromPoint for the topmost `.react-flow__node`, and either:
  //
  //   - cursor over a node (not the source) → call onCreateConnector with
  //     the target node id AND a perimeter pin computed from the cursor
  //     (user rule: "cursor over a node → find closest point on the
  //     perimeter and use that")
  //   - cursor in empty space → no-op (user rule: "cursor outside any
  //     node + drop → won't do anything"). The previous US-015 create-and-
  //     connect popover is no longer triggered from this fallback.
  const onConnectEndCb = useCallback(
    (e: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      setConnecting(false);
      // US-017: clear the source/target DOM markers once the gesture ends so
      // the candidate-target highlight and outlet-hiding rule stop applying.
      // The pointermove tracker also clears its own state via the
      // `[connecting]` effect, but we clear here too so the markers go away
      // synchronously even if React batches the `setConnecting(false)` render.
      clearConnectMarkers();
      const succeeded = connectSucceededRef.current;
      connectSucceededRef.current = false;
      if (succeeded) return;
      // US-011: xyflow calls BOTH onConnectEnd AND onReconnectEnd at the end of
      // a reconnect drag (see @xyflow/system index.js: lines 2522-2525). For
      // empty-pane drops both fallbacks no-op (no node under cursor). But for
      // body-drops, this onConnectEndCb's hit-test would create a NEW connector
      // alongside the reconnect — producing a duplicate edge. Bail here so the
      // dedicated onReconnectEndCb handles the gesture exclusively.
      // `isReconnectingRef.current` is set in onReconnectStart and only cleared
      // at the top of onReconnectEndCb, which fires AFTER this callback per
      // xyflow's order — so reading it here reliably identifies reconnect
      // drags.
      if (isReconnectingRef.current) return;
      // US-006: ESC mid-drag cancels the connect — skip the body-drop fallback
      // entirely so the synthesized mouseup that ended the gesture doesn't
      // fall through and hit-test a stray edge into existence.
      if (connectCancelledRef.current) {
        connectCancelledRef.current = false;
        return;
      }
      if (!onCreateConnector) return;
      // User rule: "must allow to connect the outlet to any location on the
      // border." When the cursor lands on a wrong-type handle dead-center on
      // a border, xyflow sets `connectionState.isValid === false` and skips
      // onConnect — but the user's intent is clearly a border-drop, so we
      // fall through to the body-drop fallback below, which hit-tests the
      // node under the cursor and pins the endpoint at the closest perimeter
      // point. Same path handles freshly-created (unselected) nodes whose
      // handles render `connectable: false`.
      const fromNodeId = connectionState.fromNode?.id;
      const fromHandle = connectionState.fromHandle;
      if (!fromNodeId || !fromHandle) return;
      const cursor = cursorFromConnectEvent(e);
      if (!cursor) return;
      // Buffered hit-test: cursor directly over a node, OR within
      // `RECONNECT_BUFFER_PX` of a node's bbox in screen space. The buffer
      // forgives near-miss drops the user clearly aimed at a node.
      const targetEl = nodeElNearPoint(wrapperRef.current, cursor.clientX, cursor.clientY);
      // User rule: "cursor outside any node + drop → won't do anything."
      // Empty-pane drops no longer open the US-015 create-and-connect
      // popover; the connection drag simply dissolves. The popover-bound
      // `onCreateAndConnectFromPane` prop and `setDropPopover` state stay
      // wired in case a future explicit invocation re-introduces the flow,
      // but the body-drop fallback never triggers them anymore.
      if (!targetEl) return;
      const targetNodeId = targetEl.getAttribute('data-id');
      if (!targetNodeId || targetNodeId === fromNodeId) return;
      // US-023: re-run isValidConnection on the body-drop fallback path to
      // preserve US-004's text-shape rejection invariant — without this,
      // dropping onto a text node's body would create a connector that
      // bypassed the validator (xyflow only calls isValidConnection on the
      // handle-drop path, never on a body drop). The connection shape
      // matches xyflow's strict-mode Connection: floating drops have null
      // handle ids per US-025.
      if (
        !isValidConnection({
          source: fromNodeId,
          target: targetNodeId,
          sourceHandle: null,
          targetHandle: null,
        })
      ) {
        return;
      }
      // User rule: "cursor over a node → find closest point on the
      // perimeter and use that." Compute the perimeter projection on the
      // target node and pass it as `targetPin` so the new connector lands
      // at the specific point the user aimed at instead of floating
      // between centers.
      let targetPin: EdgePin | undefined;
      const rfInstance = rfInstanceRef.current;
      if (rfInstance) {
        const targetNode = rfInstance.getInternalNode(targetNodeId);
        if (targetNode) {
          const w = targetNode.measured.width ?? targetNode.width ?? 0;
          const h = targetNode.measured.height ?? targetNode.height ?? 0;
          if (w > 0 && h > 0) {
            const flow = rfInstance.screenToFlowPosition({
              x: cursor.clientX,
              y: cursor.clientY,
            });
            const targetBox = {
              x: targetNode.internals.positionAbsolute.x,
              y: targetNode.internals.positionAbsolute.y,
              w,
              h,
            };
            targetPin = projectCursorToPerimeter(targetBox, flow);
            // Near-straight snap to match the preview: align the pinned target
            // to a perfectly H/V line with the floating source endpoint (which
            // resolveEdgeEndpoints computes as line-through-centers toward this
            // target) when it's within STRAIGHT_SNAP_PX.
            const sourceNode = rfInstance.getInternalNode(fromNodeId);
            const zoom = rfInstance.getViewport().zoom;
            if (sourceNode && zoom > 0) {
              const sw = sourceNode.measured.width ?? sourceNode.width ?? 0;
              const sh = sourceNode.measured.height ?? sourceNode.height ?? 0;
              if (sw > 0 && sh > 0) {
                const sourceEndpoint = getNodeIntersection(
                  {
                    x: sourceNode.internals.positionAbsolute.x,
                    y: sourceNode.internals.positionAbsolute.y,
                    w: sw,
                    h: sh,
                  },
                  { x: targetBox.x + targetBox.w / 2, y: targetBox.y + targetBox.h / 2 },
                );
                targetPin = snapPinToStraight(
                  targetBox,
                  targetPin,
                  sourceEndpoint,
                  STRAIGHT_SNAP_PX / zoom,
                );
              }
            }
          }
        }
      }
      // US-023 + US-025: drag-from is always source, drop-node is always
      // target — including when the user drags from a target-type handle.
      // No handle ids are persisted; only the target end is pinned (the
      // source stays floating since the source node was fixed by where the
      // drag started, not chosen by cursor position).
      onCreateConnector(fromNodeId, targetNodeId, targetPin ? { targetPin } : undefined);
    },
    [onCreateConnector, clearConnectMarkers, isValidConnection],
  );

  // Drag an edge endpoint onto another handle to reattach it. React Flow
  // computes the new connection from the gesture; we forward the diff
  // (source or target) to the parent for persistence. The parent applies
  // an optimistic override so the edge snaps immediately; the SSE echo of
  // the file rewrite reconciles any drift.
  //
  // `reconnectSucceededRef` lets onReconnectEnd skip the body-drop fallback
  // when onReconnect already fired for this gesture (precise handle drop).
  const reconnectSucceededRef = useRef(false);
  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      if (!onReconnectConnector) return;
      const { source, target, sourceHandle, targetHandle } = newConnection;
      if (!source || !target || source === target) return;
      const patch: {
        source?: string;
        target?: string;
        sourceHandle?: string | null;
        targetHandle?: string | null;
        sourceHandleAutoPicked?: boolean;
        targetHandleAutoPicked?: boolean;
        sourcePin?: EdgePin | null;
        targetPin?: EdgePin | null;
      } = {};
      if (source !== oldEdge.source) patch.source = source;
      if (target !== oldEdge.target) patch.target = target;
      // Forward handle changes too — same-node reconnect (e.g. dragging the
      // source endpoint from the right handle to the bottom handle on the
      // SAME node) only surfaces as a sourceHandle/targetHandle diff.
      if (typeof sourceHandle === 'string' && sourceHandle !== oldEdge.sourceHandle) {
        patch.sourceHandle = sourceHandle;
      }
      if (typeof targetHandle === 'string' && targetHandle !== oldEdge.targetHandle) {
        patch.targetHandle = targetHandle;
      }
      if (
        patch.source === undefined &&
        patch.target === undefined &&
        patch.sourceHandle === undefined &&
        patch.targetHandle === undefined
      ) {
        return;
      }
      // US-025: a precise handle drop pins the moved endpoint. Setting
      // *HandleAutoPicked: false flips the edge from floating to pinned at
      // render time. The unmoved side keeps its existing flag (no key set
      // in patch → server leaves it alone).
      if (patch.source !== undefined || patch.sourceHandle !== undefined) {
        patch.sourceHandleAutoPicked = false;
      }
      if (patch.target !== undefined || patch.targetHandle !== undefined) {
        patch.targetHandleAutoPicked = false;
      }
      // "NEVER move the other outlet": when the moved side jumps to a new
      // node, the un-moved side's floating perimeter intersection would
      // swing because the line-through-centers changed. Lock the un-moved
      // side at its current visible position. The helper returns undefined
      // for handle-only changes (no node id changed) since the un-moved
      // floating endpoint depends on node centers, not handle positions —
      // so a same-node handle reattach doesn't shift the other end.
      const rfInstance = rfInstanceRef.current;
      const onlyHandleChanged = patch.source === undefined && patch.target === undefined;
      if (!onlyHandleChanged && rfInstance) {
        const movingSide: 'source' | 'target' = patch.source !== undefined ? 'source' : 'target';
        const lockPin = computeUnmovedLockPin(
          movingSide,
          oldEdge.source,
          oldEdge.target,
          oldEdge.data as EditableEdgeData | undefined,
          (id) => rfInstance.getInternalNode(id) ?? null,
        );
        if (lockPin) {
          if (movingSide === 'source') {
            patch.targetPin = lockPin;
          } else {
            patch.sourcePin = lockPin;
          }
        }
      }
      reconnectSucceededRef.current = true;
      onReconnectConnector(oldEdge.id, patch);
    },
    [onReconnectConnector],
  );

  // Body-drop fallback: when the user releases the reconnect drag on a node's
  // body (rather than precisely on one of its four handles), React Flow's
  // connectionRadius isn't enough to snap to a handle and onReconnect doesn't
  // fire. We catch that here, look at the cursor's screen-space pointer, and
  // dispatch via classifyReconnectBodyDrop:
  //
  //   - drop on EMPTY SPACE (no node under cursor) → no-op; bail
  //   - drop on the OTHER endpoint's node → self-loop; bail
  //   - drop on the OWN node → perimeter pin on the OWN node (closest
  //     side + t under the cursor)
  //   - drop on a THIRD node → reconnect to that node AND pin at the
  //     projected perimeter point in a single onReconnectConnector patch,
  //     so the new endpoint lands on the specific point the user aimed at
  //     instead of floating between centers.
  //
  // We use elementsFromPoint(pointer) rather than connectionState.toNode
  // because React Flow only populates toNode when a handle is within
  // connectionRadius — so a drop on the node's body itself reports null.
  const onReconnectEndCb = useCallback(
    (
      e: MouseEvent | TouchEvent,
      oldEdge: Edge,
      handleType: HandleType,
      connectionState: FinalConnectionState,
    ) => {
      setConnecting(false);
      // US-017: same reasoning as onConnectEndCb — clear markers immediately
      // on gesture end so a successful reconnect doesn't leave a stale
      // candidate-target outline behind.
      clearConnectMarkers();
      // US-009: clear reconnect-in-flight flag so a follow-on new-connection
      // drag (a real onConnectStart, not a reconnect) sees a default-styled
      // connection line.
      isReconnectingRef.current = false;
      const succeeded = reconnectSucceededRef.current;
      reconnectSucceededRef.current = false;
      if (succeeded) return;
      // US-006: ESC cancellation parallel of onConnectEndCb above — skip the
      // body-drop reconnect fallback when the gesture was cancelled.
      if (reconnectCancelledRef.current) {
        reconnectCancelledRef.current = false;
        return;
      }
      if (!onReconnectConnector) return;
      // User rule: "must allow to connect the outlet to any location on the
      // border." A wrong-type handle hit (xyflow's `isValid === false`) used
      // to bail with a red flash here; now it falls through to the body-drop
      // dispatch below so the perimeter pin lands wherever the user aimed
      // on the border, regardless of which handle their cursor coincided
      // with.
      // Resolve the cursor's screen coordinates from either branch of the
      // event union (mouse vs. final touch). FinalConnectionState.pointer
      // would be nice but it's in flow space and it's also null when toHandle
      // is null — so the event's own coords are the durable source.
      const cursor = cursorFromConnectEvent(e);
      let droppedNodeId: string | null = connectionState.toNode?.id ?? null;
      if (!droppedNodeId && cursor) {
        // Buffered hit-test: prefer cursor directly over a node, but also
        // catch near-miss drops within `RECONNECT_BUFFER_PX`. User rule:
        // "give some buffer, so that even you drop the mouse out of a
        // node, if it is still close, then still connect to it."
        const nodeEl = nodeElNearPoint(wrapperRef.current, cursor.clientX, cursor.clientY);
        droppedNodeId = nodeEl?.getAttribute('data-id') ?? null;
      }
      // React Flow passes the type of the FIXED (anchored) end, not the
      // moving one — e.g. dragging the target endpoint anchors the source,
      // so handleType === 'source'. Invert to determine which side moved.
      const movingSide: 'source' | 'target' = handleType === 'source' ? 'target' : 'source';
      const action = classifyReconnectBodyDrop(
        movingSide,
        oldEdge.source,
        oldEdge.target,
        droppedNodeId,
      );
      if (action === 'no-op' || action === 'self-loop') return;
      if (!cursor) return;
      const rfInstance = rfInstanceRef.current;
      if (!rfInstance) return;
      // The node we project the cursor onto: own node for 'pin-own',
      // dropped node for 'reconnect-and-pin'. droppedNodeId is non-null
      // here (null routes to 'no-op' above).
      const projectNodeId =
        action === 'pin-own'
          ? movingSide === 'source'
            ? oldEdge.source
            : oldEdge.target
          : (droppedNodeId as string);
      const projectNode = rfInstance.getInternalNode(projectNodeId);
      if (!projectNode) return;
      const w = projectNode.measured.width ?? projectNode.width ?? 0;
      const h = projectNode.measured.height ?? projectNode.height ?? 0;
      if (w === 0 || h === 0) return;
      const flow = rfInstance.screenToFlowPosition({
        x: cursor.clientX,
        y: cursor.clientY,
      });
      const projectBox = {
        x: projectNode.internals.positionAbsolute.x,
        y: projectNode.internals.positionAbsolute.y,
        w,
        h,
      };
      let pin = projectCursorToPerimeter(projectBox, flow);
      // Near-straight snap (matches the live preview): align the pinned moving
      // endpoint to a perfectly H/V line with the un-moved (other) endpoint
      // when within STRAIGHT_SNAP_PX. The snap preserves the pin's side, so it
      // can only nudge `t` — never flip the face — keeping commit == preview.
      {
        const otherNodeId = movingSide === 'source' ? oldEdge.target : oldEdge.source;
        const otherNode = rfInstance.getInternalNode(otherNodeId);
        const zoom = rfInstance.getViewport().zoom;
        if (otherNode && zoom > 0) {
          const ow = otherNode.measured.width ?? otherNode.width ?? 0;
          const oh = otherNode.measured.height ?? otherNode.height ?? 0;
          if (ow > 0 && oh > 0) {
            const otherBox = {
              x: otherNode.internals.positionAbsolute.x,
              y: otherNode.internals.positionAbsolute.y,
              w: ow,
              h: oh,
            };
            const edgeData = oldEdge.data as EditableEdgeData | undefined;
            const otherPin = movingSide === 'source' ? edgeData?.targetPin : edgeData?.sourcePin;
            const otherEndpoint = otherPin
              ? endpointFromPin(otherBox, otherPin)
              : getNodeIntersection(otherBox, {
                  x: projectBox.x + projectBox.w / 2,
                  y: projectBox.y + projectBox.h / 2,
                });
            pin = snapPinToStraight(projectBox, pin, otherEndpoint, STRAIGHT_SNAP_PX / zoom);
          }
        }
      }
      if (action === 'pin-own') {
        // Same-node drop → onPinEndpoint owns optimistic override + PATCH
        // + undo for the single-field pin write. The un-moved endpoint
        // doesn't need locking here: its position is computed from
        // line-through-CENTERS (not endpoints), and pinning the moved
        // side at a perimeter point doesn't change either node's center.
        if (!onPinEndpoint) return;
        onPinEndpoint(oldEdge.id, movingSide, pin);
        return;
      }
      // action === 'reconnect-and-pin': cross-node drop. Bundle source/
      // target swap + handle clear + autoPicked false + pin into a single
      // onReconnectConnector patch so the new endpoint lands on the
      // specific perimeter point the user aimed at, in one undo entry.
      //
      // User rule: "When moving outlet and drop to another location,
      // NEVER move the other outlet." If the un-moved endpoint is
      // currently floating, capture its CURRENT position (against the OLD
      // line-through-centers) and include it as a pin in the same patch
      // so it doesn't slide when the moved side switches nodes. See
      // computeUnmovedLockPin for the math + precedence.
      const unmovedLockPin = computeUnmovedLockPin(
        movingSide,
        oldEdge.source,
        oldEdge.target,
        oldEdge.data as EditableEdgeData | undefined,
        (id) => rfInstance.getInternalNode(id) ?? null,
      );
      if (movingSide === 'source') {
        onReconnectConnector(oldEdge.id, {
          source: droppedNodeId as string,
          sourceHandle: null,
          sourceHandleAutoPicked: false,
          sourcePin: pin,
          ...(unmovedLockPin ? { targetPin: unmovedLockPin } : {}),
        });
      } else {
        onReconnectConnector(oldEdge.id, {
          target: droppedNodeId as string,
          targetHandle: null,
          targetHandleAutoPicked: false,
          targetPin: pin,
          ...(unmovedLockPin ? { sourcePin: unmovedLockPin } : {}),
        });
      }
    },
    [onReconnectConnector, clearConnectMarkers, onPinEndpoint],
  );

  const ghostRect = useMemo(() => {
    if (!drawStart || !drawCurrent) return null;
    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
    const offsetX = wrapperRect?.left ?? 0;
    const offsetY = wrapperRect?.top ?? 0;
    // Mirror the commit-path Shift constraint so the ghost previews exactly the
    // squared box the gesture will commit (geometric shapes + icons; linkflow
    // keeps its free aspect). The refs are re-read on every drawCurrent change
    // (set in onPointerMove just before setDrawCurrent), so this stays in sync.
    const constrain =
      drawShiftRef.current || Date.now() - drawShiftHeldAtRef.current <= PEN_SHIFT_GRACE_MS;
    const end =
      constrain && drawShape !== 'linkflow' && drawShape !== 'line'
        ? perfectDragBox(drawStart, drawCurrent, perfectShapeAspect(drawShape))
        : drawCurrent;
    const minX = Math.min(drawStart.x, end.x);
    const minY = Math.min(drawStart.y, end.y);
    const w = Math.abs(end.x - drawStart.x);
    const h = Math.abs(end.y - drawStart.y);
    // Coords are stored in client space; subtract the wrapper offset to paint
    // the ghost via absolute positioning inside the wrapper.
    return { left: minX - offsetX, top: minY - offsetY, width: w, height: h };
  }, [drawStart, drawCurrent, drawShape]);

  // US-009: WYSIWYG ghost — mirror the committed shape's chrome via the same
  // helpers `ShapeNode` uses so background/border/radius/tilt match exactly.
  // The commit path (`onCreateShapeNode` → `buildNewShapeData`) overlays the
  // last-used node-style bucket on the factory defaults; we read the SAME
  // bucket here so the ghost paints what the committed node will paint. Read
  // direct from storage (rather than caching) so the very first draw of a
  // session and any draw following a style-strip edit both see the fresh
  // value — no prop-staleness window. Empty bucket → factory defaults (the
  // historical behaviour). Text is intentionally chromeless on commit; we add
  // a faint dashed outline ONLY for the ghost so the user can see what
  // they're drawing — the placed text node still has no chrome.
  const ghostLastUsedNodeStyle = drawShape
    ? getLastUsedStyle(DEFAULT_STORAGE_PREFIX).node
    : undefined;
  // Linkflow paints its own chrome (dashed border + Link2 + label) rather
  // than the geometric shape-chrome helpers — its committed visual matches the
  // unlinked state from `linkflow-node.tsx`, not any geometric primitive.
  const isLinkflowGhost = drawShape === 'linkflow';
  // A line ghost is a thin segment, not a filled box — it paints its own preview
  // below and opts out of the geometric shape-chrome helpers (like linkflow).
  const isLineGhost = drawShape === 'line';
  const isNonGeometricGhost = isLinkflowGhost || isLineGhost;
  const ghostShapeClass = drawShape && !isNonGeometricGhost ? shapeChromeClass(drawShape) : '';
  const ghostShapeStyle =
    drawShape && !isNonGeometricGhost
      ? shapeChromeStyle(drawShape, ghostLastUsedNodeStyle)
      : undefined;
  const ghostTextOutline = drawShape === 'text';

  // Space-held pan mode (US-019). React Flow's panActivationKeyCode='Space'
  // toggles the pane into pan-on-drag mode for the duration of the keypress;
  // we mirror that into local state purely so the wrapper can show a
  // grab/grabbing cursor (the rest of the behavior is owned by React Flow).
  // Suppress the keydown when focus is in an editable element so InlineEdit's
  // own space input still types a literal space.
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);
  // US-014: open state for the ShareMenu's EmbedDialog, hoisted so the
  // imperative ref handle (`openEmbedDialog`) can flip it programmatically
  // even when the host invokes from a command palette / keyboard shortcut. The
  // ShareMenu still falls back to its own internal state when these props are
  // absent, so the controlled lift is opt-in.
  const [shareEmbedDialogOpen, setShareEmbedDialogOpen] = useState(false);
  // SLOT 13 — must remain at end per CLAUDE.md hook-shim rule. Mirrors the
  // optional `history` prop's `{canUndo, canRedo}` snapshots into React
  // state so the toolbar + command palette can resolve effective values
  // (via `effectiveCanUndo` / `effectiveCanRedo` below) without subscribing
  // to the handle themselves. When `history` is absent the seed values
  // default to false and undo is unavailable.
  const [historyState, setHistoryState] = useState<{ canUndo: boolean; canRedo: boolean }>(() => ({
    canUndo: history?.canUndo ?? false,
    canRedo: history?.canRedo ?? false,
  }));
  useEffect(() => {
    if (!history) return;
    const off = history.subscribe(setHistoryState);
    return off;
  }, [history]);
  // SLOT 14 — built-in DetailPanel sidebar's visibility. Decoupled from
  // selection: node clicks no longer auto-open the sidebar; the new top-right
  // InspectorToggle flips this, and clicking the empty pane closes it (see
  // handlePaneClickWithGroupExit). Connector selection never opens it (the
  // DetailPanel's connector prop is wired to null).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // SLOT 15 — Canvas grouping M6: double-click-to-enter isolation. `activeGroupId`
  // is the id of the group the user has ENTERED (so its members are individually
  // addressable and the group body is click-through), or null when not in
  // isolation. It is RUNTIME-ONLY UI state — never persisted, never patched —
  // and is dropped the moment its group vanishes (see the cleanup effect below).
  // Appended at the END of the useState block per the hook-shim rule in
  // packages/canvas/CLAUDE.md (so no existing `useStateOverrides[N]` shifts);
  // it is the 15th useState → `useStateOverrides[14]`.
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  // Mirror into a ref so the window-level keydown (ESC) listener and the
  // memoized click handlers read the latest value without re-binding every time
  // it changes (same pattern as selectedIdSetRef / onSelectionChangeRef). Refs
  // never occupy a useState slot, so this doesn't affect the index map.
  const activeGroupIdRef = useRef<string | null>(activeGroupId);
  activeGroupIdRef.current = activeGroupId;
  // M6 — EXIT path (d): drop the active group the instant it stops being a
  // `type:'group'` node in `nodes` (ungrouped, deleted, or swapped out by a
  // flow:reload / project switch). `activeGroupId` is runtime-only UI state, so a
  // stale id must never linger — it would leave the canvas in a phantom isolation
  // with no group to render the affordance. Guard the setState behind the
  // existence check so the effect is a no-op on every unrelated `nodes` change.
  useEffect(() => {
    if (activeGroupId === null) return;
    const stillAGroup = nodes.some((n) => n.id === activeGroupId && n.type === 'group');
    if (!stillAGroup) setActiveGroupId(null);
  }, [activeGroupId, nodes]);
  // Canvas grouping M6 — the ISOLATION overlay. `buildNode`/`sourceNodes` (the
  // rebuild-from-props memo) lives high in the body, BEFORE the `activeGroupId`
  // useState (which the hook-shim rule pins to the END of the state block), so it
  // cannot read isolation state directly. Instead, overlay the per-group
  // isolation render props onto the already-built `rfNodes` HERE — after the
  // state is in scope. This keeps `sourceNodes` isolation-agnostic AND lag-free
  // (recomputes synchronously on `[rfNodes, activeGroupId]`). When no group is
  // entered the memo returns `rfNodes` unchanged (identity stable → xyflow sees
  // no churn). For the active group it:
  //   - sets `data.active = true` → the renderer makes the fill click-through
  //     (`pointer-events:none`) + paints the "entered" ring + stamps
  //     `data-active="true"` (the stable test hook);
  //   - sets `draggable = false` → group-move is disabled while entered (step 7);
  //     no drag → no M5 `groupDragRef` snapshot → children never fan out.
  // Members sit ABOVE the group (group z = -1) and remain individually
  // selectable + draggable, so nothing else needs to change.
  const displayNodes = useMemo<Node[]>(() => {
    if (activeGroupId === null) return rfNodes;
    let touched = false;
    const next = rfNodes.map((n) => {
      if (n.id !== activeGroupId || n.type !== 'group') return n;
      touched = true;
      return {
        ...n,
        draggable: false,
        data: { ...n.data, active: true },
      };
    });
    // If the active id isn't in the rendered list (e.g. mid-swap), don't allocate
    // a new array — keeps xyflow from re-diffing every node for nothing.
    return touched ? next : rfNodes;
  }, [rfNodes, activeGroupId]);

  // Live-track the selection/group marquee DURING a drag. `selectionOverlayNodes`
  // reads positions from `nodes` + `nodeOverrides` (the committed snapshot), but
  // both are FROZEN mid-drag — only `rfNodes` carries the live per-frame position
  // (xyflow moves the dragged node there; `liveGroupDrag` fans group members into
  // it). So without this swap the overlay box stays at the pre-drag spot and only
  // jumps to the new position on mouse-release. Re-derive each overlay node's
  // position from the live `rfNodes` (keyed by id) so the marquee hugs the group/
  // selection in real time, matching Miro. `rfNodes` changes every drag frame →
  // this memo recomputes → the overlay re-renders in lockstep. Sizes are NOT
  // remapped (a move never changes them; a corner-resize is previewed locally in
  // the overlay and doesn't touch rfNodes). Identity is preserved when nothing
  // moved so non-drag renders stay churn-free.
  const liveSelectionOverlayNodes = useMemo<OverlayInputNode[]>(() => {
    if (selectionOverlayNodes.length === 0) return selectionOverlayNodes;
    const liveById = new Map(rfNodes.map((n) => [n.id, n.position]));
    let changed = false;
    const mapped = selectionOverlayNodes.map((n) => {
      const live = liveById.get(n.id);
      if (!live || (live.x === n.position.x && live.y === n.position.y)) return n;
      changed = true;
      return { ...n, position: { x: live.x, y: live.y } };
    });
    return changed ? mapped : selectionOverlayNodes;
  }, [selectionOverlayNodes, rfNodes]);
  // US-004: alignment-guides gesture hook. CRITICAL — this call sits AFTER the
  // last component-level `useState` (activeGroupId, slot 15) so the hook's own
  // internal `useState` lands in a slot beyond every index the hook-shim tests
  // reference (0–13); the existing `useStateOverrides[N]` assertions stay
  // valid. The returned API is published into `alignmentApiRef` (read by
  // onNodesChange + the drag handlers) and `alignment.guides` drives the
  // overlay below. `viewport.zoom` converts the screen-px threshold to world
  // units; rfInstance is unavailable on the very first render and under the
  // hook-shim tests, so we fall back to an identity viewport (zoom 1).
  const alignmentViewport = rfInstanceRef.current?.getViewport() ?? { x: 0, y: 0, zoom: 1 };
  const alignment = useAlignmentGuides({
    enabled: flags.enableAlignmentGuides,
    thresholdPx: flags.alignmentSnapThreshold ?? 6,
    viewport: alignmentViewport,
    rfNodesRef,
  });
  alignmentApiRef.current = alignment;
  // Effective enable state: subscribed values when `history` is supplied,
  // false otherwise. Undo is available iff the host wires a HistoryHandle.
  const effectiveCanUndo = history ? historyState.canUndo : false;
  const effectiveCanRedo = history ? historyState.canRedo : false;
  // US-014: shared export workflow — fit-view + viewport capture + filename
  // derivation + dynamic-import of jspdf — exposed both through the ShareMenu
  // wired below and the imperative ref handle. The hook owns `lastError`
  // internally so we don't leak the failure state into the canvas's render
  // path (the ShareMenu surfaces issues inline if/when we wire that later).
  const exportApi = useCanvasExport({
    projectId,
    getReactFlow: () => rfInstanceRef.current,
  });
  // US-008: host-facing entry for "paste image from clipboard". Mirrors the
  // guards in `onWrapperDrop` and reuses `handleCanvasFileDrop`, but drops at
  // the wrapper center since a keyboard paste carries no cursor position.
  const pasteImageFromClipboard = useCallback(
    (dataTransfer: DataTransfer) => {
      if (!onCreateImageFromFile || !flags.enableImageDrop) return;
      const rfInstance = rfInstanceRef.current;
      const wrapper = wrapperRef.current;
      if (!rfInstance || !wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const clientPos = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      void handleCanvasFileDrop({
        dataTransfer,
        clientPos,
        rfInstance,
        computeDims: computeImageDims,
        dispatch: onCreateImageFromFile,
      });
    },
    [onCreateImageFromFile, flags.enableImageDrop],
  );
  useImperativeHandle(
    ref,
    () => ({
      exportPdf: exportApi.exportPdf,
      exportPng: exportApi.exportPng,
      openEmbedDialog: () => setShareEmbedDialogOpen(true),
      capturePreview: exportApi.capturePreview,
      pasteImageFromClipboard,
    }),
    [exportApi.exportPdf, exportApi.exportPng, exportApi.capturePreview, pasteImageFromClipboard],
  );
  useEffect(() => {
    // US-027: Space-held pan is a keyboard affordance — gate on the same flag
    // as the ESC chain and the Cmd+C/V handlers above.
    if (!flags.enableKeyboard) return;
    const isEditable = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return el instanceof HTMLElement && el.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (isEditable(document.activeElement)) return;
      // Only flip the cursor — React Flow owns the actual pan gesture wiring.
      // preventDefault stops the browser from scrolling the page on Space.
      e.preventDefault();
      setSpaceHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      setSpaceHeld(false);
      setSpaceDragging(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [flags.enableKeyboard]);

  // Multi-node drag-stop: React Flow passes the full set of nodes that moved
  // (the active drag plus every other selected node, since selected items
  // drag together). US-013: when more than one node moved, route the whole
  // batch through `onNodePositionsChange` so the parent commits a single
  // undo entry; one Cmd+Z reverts every node back to its pre-drag position.
  // Single-node drags still flow through `onNodePositionChange` to preserve
  // the per-id coalesce key (collapses repeated drags of the same node).
  // Canvas grouping M5 (design §9.1, §12.2): at drag START, if any dragged node
  // is a group, freeze the baseline the live + commit fan-out both read. Builds
  // `groupDragRef` = { groups (id + childIds), startPositions (group + every
  // member, the FROZEN baseline), directIds (ids xyflow drags itself) }. Reads
  // start positions from `rfNodesRef` (the live rendered list, override-merged)
  // so the snapshot reflects exactly what the user sees, and member positions
  // from the same source so the math stays in one coordinate space. No group in
  // the drag → ref stays null (zero overhead on ordinary drags).
  const beginGroupDrag = useCallback((draggedNodes: Node[]) => {
    const allNodes = nodesRef.current;
    const draggedGroupNodes = draggedNodes.filter(
      (n) => allNodes.find((m) => m.id === n.id)?.type === 'group',
    );
    if (draggedGroupNodes.length === 0) {
      groupDragRef.current = null;
      return;
    }
    const posOf = (id: string): { x: number; y: number } | null => {
      const live = rfNodesRef.current.find((r) => r.id === id);
      if (live) return { x: live.position.x, y: live.position.y };
      const base = allNodes.find((m) => m.id === id);
      return base ? { x: base.position.x, y: base.position.y } : null;
    };
    const groups: DraggedGroup[] = [];
    const childIdsByGroup = new Map<string, readonly string[]>();
    const startPositions = new Map<string, { x: number; y: number }>();
    // directIds = every node xyflow is dragging itself (the group(s) + any
    // independently-selected nodes). Members in this set are moved by xyflow
    // already, so the live fan-out must skip them (dedupe §9.1 step 2).
    const directIds = new Set(draggedNodes.map((n) => n.id));
    for (const g of draggedGroupNodes) {
      const groupNode = allNodes.find((m) => m.id === g.id);
      if (!groupNode || groupNode.type !== 'group') continue;
      const childIds = [...groupNode.data.childIds];
      childIdsByGroup.set(g.id, childIds);
      groups.push({ groupId: g.id, delta: { x: 0, y: 0 } });
      const gStart = posOf(g.id);
      if (gStart) startPositions.set(g.id, gStart);
      for (const childId of childIds) {
        const cStart = posOf(childId);
        if (cStart) startPositions.set(childId, cStart);
      }
    }
    groupDragRef.current =
      groups.length > 0 ? { groups, childIdsByGroup, startPositions, directIds } : null;
  }, []);

  // M5 live per-frame fan-out (design §12.2). Children have ABSOLUTE positions,
  // so xyflow does NOT move them when the group node is dragged. The
  // upstream-sync effect (`setRfNodes(sourceNodes)`) is ALSO frozen during a
  // drag (it early-returns while `draggingRef` is true) so a host optimistic
  // override would not render mid-gesture either. The reliable channel is the
  // SAME one xyflow uses for the dragged node: write the members' new positions
  // straight into the rendered `rfNodes` list. So children track the group live.
  //
  // The delta is ADDITIVE against the FROZEN drag-start position (the group's
  // current rendered position − its start), NEVER the previous frame, so every
  // frame recomputes member positions from the frozen baseline + current delta
  // — repeated frames can't drift or compound (unlike the multiplicative resize
  // bug). The group itself is in `directIds` (xyflow already moves it), so the
  // fan-out excludes it and repositions only the members. The real persisted
  // move (PATCH + override + one undo entry) fans out on drag-stop via
  // `commitDraggedNodes` → `onNodePositionsChange`.
  const liveGroupDrag = useCallback(() => {
    const snap = groupDragRef.current;
    if (!snap) return;
    const groupsWithDelta: DraggedGroup[] = [];
    for (const g of snap.groups) {
      const start = snap.startPositions.get(g.groupId);
      if (!start) continue;
      const live = rfNodesRef.current.find((r) => r.id === g.groupId);
      const cur = live ? live.position : start;
      groupsWithDelta.push({
        groupId: g.groupId,
        delta: { x: cur.x - start.x, y: cur.y - start.y },
      });
    }
    const updates: GroupMoveUpdate[] = computeGroupMoveUpdates(
      groupsWithDelta,
      snap.childIdsByGroup,
      snap.startPositions,
      snap.directIds,
    );
    if (updates.length === 0) return;
    const byId = new Map(updates.map((u) => [u.id, u.position]));
    // Apply the member positions to the rendered list. New array + new node
    // objects for touched members so xyflow's renderer re-reads them; untouched
    // nodes keep their identity (no needless re-render).
    const nextRf = rfNodesRef.current.map((n) => {
      const pos = byId.get(n.id);
      if (!pos) return n;
      return { ...n, position: { x: pos.x, y: pos.y } };
    });
    rfNodesRef.current = nextRf;
    setRfNodes(nextRf);
  }, []);

  const commitDraggedNodes = useCallback(
    (draggedNodes: Node[]) => {
      if (draggedNodes.length === 0) return;
      // US-004: xyflow's drag-event payload carries the RAW pointer-derived
      // position (`dragItem.position`), NOT the alignment-snapped position the
      // hook wrote into rfNodes during the drag — `@xyflow/system`'s
      // `getEventHandlerParams` spreads the store node then overrides
      // `position: dragItem.position`. Persisting that raw value lets the
      // adapter echo yank the node back off the guide by the snap delta (~1px
      // when dropped near-aligned) the instant the mouse is released. Resolve
      // every dragged node's position from the controlled rfNodes ref instead —
      // the single source of truth for what was actually rendered. Falls back
      // to the event position when a node isn't found (defensive; identical to
      // the event value on any drag where no snap was applied).
      const committedPositionOf = (n: Node): { x: number; y: number } => {
        const live = rfNodesRef.current.find((r) => r.id === n.id);
        const pos = live ? live.position : n.position;
        return { x: pos.x, y: pos.y };
      };
      // US-027: view mode — React Flow's internal applyNodeChanges has already
      // updated the local rfNodes during the drag, so the visual move stuck.
      // We skip the parent dispatches that would have persisted via the
      // adapter — no PATCH fires, no undo entry is pushed. We DO record the
      // final position in `viewModePositionsRef` so the next sourceNodes
      // rebuild (selection change, etc.) doesn't re-sync rfNodes back to the
      // server position and snap the node home (the sourceNodes useMemo
      // merges this ref before yielding the node list).
      if (!isEditMode) {
        const map = viewModePositionsRef.current;
        for (const n of draggedNodes) {
          map.set(n.id, committedPositionOf(n));
        }
        return;
      }
      // Canvas grouping M5 (design §9.1): if a group was dragged, fan its
      // committed translation out to every member so the whole container moves
      // as one. The COMMIT delta is read from `rfNodesRef` (the rendered list),
      // NOT the raw drag event — same ~1px snap-drift guard as `committedPositionOf`
      // (project_xyflow_dragstop_reports_raw_position). The members' updates are
      // MERGED with the directly-dragged nodes into ONE `onNodePositionsChange`
      // batch → one `history.batch('move-nodes')` → one undo entry reverts the
      // group + all members together. Dedupe: `computeGroupMoveUpdates` skips ids
      // in `directIds` (a member that is ALSO independently selected is moved by
      // the direct path below, not twice).
      const snap = groupDragRef.current;
      if (snap) {
        const directUpdates = draggedNodes.map((n) => ({
          id: n.id,
          position: committedPositionOf(n),
        }));
        const directIds = new Set(directUpdates.map((u) => u.id));
        const groupsWithDelta: DraggedGroup[] = [];
        for (const g of snap.groups) {
          const start = snap.startPositions.get(g.groupId);
          if (!start) continue;
          const live = rfNodesRef.current.find((r) => r.id === g.groupId);
          const cur = live ? live.position : start;
          groupsWithDelta.push({
            groupId: g.groupId,
            delta: { x: cur.x - start.x, y: cur.y - start.y },
          });
        }
        // Members only (groups themselves are already in `directUpdates`): pass
        // the group ids + every directly-moved id as the exclude set so we don't
        // re-emit a position the direct path already carries.
        const memberUpdates = computeGroupMoveUpdates(
          groupsWithDelta,
          snap.childIdsByGroup,
          snap.startPositions,
          directIds,
        );
        const merged = [...directUpdates, ...memberUpdates];
        if (onNodePositionsChange) {
          onNodePositionsChange(merged);
        } else if (onNodePositionChange) {
          for (const u of merged) onNodePositionChange(u.id, u.position);
        }
        return;
      }
      if (draggedNodes.length === 1) {
        const moved = draggedNodes[0];
        if (moved && onNodePositionChange) {
          onNodePositionChange(moved.id, committedPositionOf(moved));
        }
        return;
      }
      if (onNodePositionsChange) {
        onNodePositionsChange(
          draggedNodes.map((n) => ({ id: n.id, position: committedPositionOf(n) })),
        );
        return;
      }
      // Fallback: parent didn't wire the batch path → emit per-node calls so
      // the legacy behavior (N undo entries) still works.
      if (!onNodePositionChange) return;
      for (const moved of draggedNodes) {
        onNodePositionChange(moved.id, committedPositionOf(moved));
      }
    },
    [onNodePositionChange, onNodePositionsChange, isEditMode],
  );

  const onNodeDragStopCb = useCallback(
    (_e: unknown, _node: Node, draggedNodes: Node[]) => {
      draggingRef.current = false;
      commitDraggedNodes(draggedNodes);
      // M5: the group fan-out has been committed — drop the frozen snapshot so a
      // subsequent ordinary drag doesn't see a stale group baseline.
      groupDragRef.current = null;
      // US-009: flush any deferred external-change fit now that the drag is
      // complete (mirrors the resize-end flush wired in setResizing).
      flushPendingFit();
    },
    [commitDraggedNodes, flushPendingFit],
  );

  const onSelectionDragStartCb = useCallback(() => {
    draggingRef.current = true;
  }, []);
  const onSelectionDragStopCb = useCallback(
    (_e: unknown, draggedNodes: Node[]) => {
      draggingRef.current = false;
      commitDraggedNodes(draggedNodes);
      // M5: drop the frozen group snapshot after the commit (see onNodeDragStopCb).
      groupDragRef.current = null;
      // US-009: flush any deferred external-change fit (same channel as
      // single-node drag stop above).
      flushPendingFit();
    },
    [commitDraggedNodes, flushPendingFit],
  );

  // Memoized xyflow handlers. Inline closures on <ReactFlow> would re-allocate
  // on every parent render, adding GC pressure during pan/zoom (each pointer
  // frame triggers a re-render via the viewport store). The bodies stay
  // identical to the previous inline versions.
  const handleMove = useCallback(
    (_e: unknown, viewport: { x: number; y: number; zoom: number }) => {
      // US-015: panning or zooming dismisses the drop-popover — its
      // flow-space anchor would otherwise drift away from the viewport
      // translation. Read from the ref to avoid re-binding on popover
      // open/close (handleMove fires every frame of pan/zoom).
      if (dropPopoverRef.current) setDropPopover(null);
      // Mirror the viewport zoom to a CSS variable so the selection outline
      // can scale its width/offset inversely (calc(1px / var(--rf-zoom))).
      // Setting via inline style avoids a React re-render every frame.
      const wrapper = wrapperRef.current;
      if (wrapper) wrapper.style.setProperty('--rf-zoom', String(viewport.zoom));
      onViewportChange?.(viewport);
    },
    [onViewportChange],
  );
  const handleNodeDragStart = useCallback(
    (e: ReactMouseEvent, _node: Node, draggedNodes: Node[]) => {
      draggingRef.current = true;
      // US-004: capture the gesture's modifier state and freeze the alignment
      // reference snapshot of the non-dragged nodes. xyflow always passes the
      // event + dragged-node list; the optional access keeps the legacy
      // no-arg test callers (and any future bare invocation) from throwing.
      lastDragModifierRef.current = { metaKey: e?.metaKey, ctrlKey: e?.ctrlKey };
      alignmentApiRef.current?.beginGesture((draggedNodes ?? []).map((n) => n.id));
      // M5: freeze the group-drag baseline if a group is in the dragged set.
      beginGroupDrag(draggedNodes ?? []);
      onNodeDragStart?.();
    },
    [onNodeDragStart, beginGroupDrag],
  );
  // US-004: per-frame modifier refresh. xyflow fires onNodeDrag alongside the
  // position changes, so `lastDragModifierRef` is current when onNodesChange
  // calls interceptChanges. A mid-drag Cmd/Ctrl press therefore suppresses the
  // snap on the very next frame. M5: also fan a dragged group's per-frame delta
  // out to its members so children track the group LIVE (not just on release).
  const handleNodeDrag = useCallback(
    (e: ReactMouseEvent) => {
      lastDragModifierRef.current = { metaKey: e.metaKey, ctrlKey: e.ctrlKey };
      liveGroupDrag();
    },
    [liveGroupDrag],
  );
  const handleNodeDragStop = useCallback(
    (e: unknown, node: Node, draggedNodes: Node[]) => {
      onNodeDragStopCb(e, node, draggedNodes);
      // US-004: clear guides + drop the snapshot.
      alignmentApiRef.current?.endGesture();
      onNodeDragStop?.();
    },
    [onNodeDragStopCb, onNodeDragStop],
  );
  const handleSelectionDragStart = useCallback(
    (e: ReactMouseEvent, draggedNodes: Node[]) => {
      onSelectionDragStartCb();
      lastDragModifierRef.current = { metaKey: e?.metaKey, ctrlKey: e?.ctrlKey };
      alignmentApiRef.current?.beginGesture((draggedNodes ?? []).map((n) => n.id));
      // M5: a multi-selection drag can include a group — freeze its baseline too.
      beginGroupDrag(draggedNodes ?? []);
      onNodeDragStart?.();
    },
    [onSelectionDragStartCb, onNodeDragStart, beginGroupDrag],
  );
  const handleSelectionDrag = useCallback(
    (e: ReactMouseEvent) => {
      lastDragModifierRef.current = { metaKey: e.metaKey, ctrlKey: e.ctrlKey };
      liveGroupDrag();
    },
    [liveGroupDrag],
  );
  const handleSelectionDragStop = useCallback(
    (e: unknown, draggedNodes: Node[]) => {
      onSelectionDragStopCb(e, draggedNodes);
      alignmentApiRef.current?.endGesture();
      onNodeDragStop?.();
    },
    [onSelectionDragStopCb, onNodeDragStop],
  );
  const handleEdgeDoubleClick = useCallback((_e: ReactMouseEvent, edge: Edge) => {
    editHandlesRef.current.get(edge.id)?.();
  }, []);

  // Canvas grouping M6 — ENTER isolation (design §5.3, §12.10). `onNodeDoubleClick`
  // is NOT otherwise wired (only `onEdgeDoubleClick`), and `zoomOnDoubleClick` is
  // already false, so a group dblclick has no competing handler. Double-clicking a
  // group enters it; double-clicking any other node is a no-op here (its own
  // renderer owns dblclick-to-edit). The title-band's own dblclick-to-rename
  // (wired in M7) will stopPropagation so it never reaches this enter path.
  // M9 (design §9.9): entering isolation is an EDIT-ONLY affordance (it makes
  // members individually editable). Gate on `flags.showResizeHandles` — the one
  // flag that is true ONLY in edit mode (and the same gate the group ＋/⊟ overlay
  // uses) — so a group double-click in view/mini (where selection/pan stay on)
  // does NOT enter isolation. A group still RENDERS read-only in those modes.
  const handleNodeDoubleClick = useCallback(
    (_e: ReactMouseEvent, node: Node) => {
      if (!flags.showResizeHandles) return; // edit-only
      if (node.type !== 'group') return;
      setActiveGroupId(node.id);
    },
    [flags.showResizeHandles],
  );

  const handleNodeClickWithGroupGate = useCallback(
    (_e: ReactMouseEvent, node: Node) => {
      // M6 — EXIT path (c): a click on a node that is NOT a member of the active
      // group leaves isolation, then lets the click select that node normally
      // (xyflow drives selection via onSelectionChange; we only drop the active
      // group). A click on a member keeps us inside so the member can be selected
      // / dragged individually. The active group's own chrome is "not a member",
      // but clicking it while entered shouldn't exit — guard that explicitly.
      const active = activeGroupIdRef.current;
      if (
        active !== null &&
        node.id !== active &&
        !isMemberOfGroup(nodesRef.current, active, node.id)
      ) {
        setActiveGroupId(null);
      }
      onNodeClick?.(node.id);
    },
    [onNodeClick],
  );
  const handlePaneClickWithGroupExit = useCallback(
    (e: ReactMouseEvent) => {
      // M6 — EXIT path (b): clicking the empty pane leaves isolation. Runs
      // unconditionally (cheap, idempotent when already null) before forwarding
      // the host's onPaneClick (which the host uses to close the sidebar, etc.).
      if (activeGroupIdRef.current !== null) setActiveGroupId(null);
      onPaneClick?.();
      void e;
    },
    [onPaneClick],
  );
  const handleEdgeClickWithGroupGate = useCallback(
    (_e: ReactMouseEvent, edge: Edge) => {
      onConnectorClick?.(edge.id);
    },
    [onConnectorClick],
  );

  // Cursor for the wrapper. Draw mode → crosshair (own gesture). Hand mode →
  // grab while idle, grabbing while a pan drag is in flight. Space-held has
  // the same grab/grabbing pair as Hand. Else default arrow — US-010 made
  // primary-mouse drag a marquee gesture, but the default cursor is the
  // design-tool norm for the rubber-band so we don't override it.
  const wrapperCursor =
    drawArmed || penMode
      ? 'crosshair'
      : handMode || spaceHeld
        ? spaceDragging
          ? 'grabbing'
          : 'grab'
        : undefined;

  // US-007: derive the built-in sidebar's target entity from the sole selected
  // node / connector. The panel opens ONLY for a single-entity selection — one
  // node OR one connector, nothing else. Any multi-selection (marquee, Cmd+A,
  // Cmd+Click — all funnel through `onSelectionChange` and grow these arrays)
  // collapses the target to `undefined`, so the Sheet stays closed and the
  // selected nodes instead drive the multi-select style strip / resize overlay
  // via `selectedNodes` / `selectedConnectors`. Reads from the canvas's
  // existing `nodes` / `connectors` props — the parent applies its pending
  // overrides upstream so the lookup here already sees the optimistic edits.
  const isSingleSelection = selectedNodeIds.length + selectedConnectorIds.length === 1;
  const sidebarNodeId = isSingleSelection ? selectedNodeIds[0] : undefined;
  const sidebarConnectorId = isSingleSelection ? selectedConnectorIds[0] : undefined;
  const sidebarNode = sidebarNodeId ? (nodes.find((n) => n.id === sidebarNodeId) ?? null) : null;
  const sidebarConnector = sidebarConnectorId
    ? (connectors.find((c) => c.id === sidebarConnectorId) ?? null)
    : null;
  // The DetailPanel only reads `flowId` to gate type:'html' file-action visibility;
  // CanvasAdapter doesn't expose its bound flowId on the type, so we route via
  // the existing `projectId` prop (which the studio already passes — identical
  // value, no new wiring at the host).
  const sidebarDemoId = projectId ?? null;
  const sidebarEnabled = flags.showDetailPanel && !disableSidebar;
  // Keep DetailPanel mounted while the sidebar feature is enabled and let
  // its `open` prop drive the Radix Sheet's slide-in / slide-out animation.
  // Gating the mount on `sidebarOpen` would cut the exit animation off
  // because Radix needs the component in the tree until `data-state=closed`
  // has finished its `animate-out` keyframes.
  const shouldRenderSidebar = sidebarEnabled;
  // US-004: memoize the icon registry value so the IconRegistryProvider's
  // context object identity is stable across re-renders when the host's
  // `customIcons` reference is stable (or undefined). Prevents every <Icon>
  // descendant from re-rendering on unrelated canvas state churn.
  const iconRegistryValue = useMemo(() => ({ custom: customIcons ?? {} }), [customIcons]);
  // US-013: memoized so the CanvasStudioContext consumer (currently
  // <IconRenderer> via <IconNode>) only re-renders when studioBaseUrl
  // actually changes, not on every host render with a fresh prop ref.
  const studioContextValue = useMemo(() => ({ studioBaseUrl }), [studioBaseUrl]);

  // US-015: on mount, ask the host's icon adapter (if wired) for the latest
  // installed-pack summaries so the picker's vendor tabs (US-016) can populate
  // their grids. Silent when `adapter.icons` is missing or the call rejects —
  // the picker falls back to the bundled lucide list either way. Appended at
  // the END of the body to preserve dispatcher-shim hook ordering (see the
  // useState-placement rule in packages/canvas/CLAUDE.md).
  const iconsAdapter = adapter?.icons;
  useEffect(() => {
    if (!iconsAdapter) return;
    let cancelled = false;
    void (async () => {
      try {
        const packs = await iconsAdapter.listPacks();
        if (cancelled) return;
        applyPackSummaries(packs);
      } catch {
        // Silent — adapter failures must not break canvas mount.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [iconsAdapter]);

  return (
    <IconRegistryProvider value={iconRegistryValue}>
      <CanvasStudioProvider value={studioContextValue}>
        <div
          data-testid="seeflow-canvas"
          data-mode={mode}
          data-canvas-mode={canvasMode.kind}
          data-can-undo={effectiveCanUndo ? 'true' : 'false'}
          data-can-redo={effectiveCanRedo ? 'true' : 'false'}
          ref={wrapperRef}
          className={cn(
            'seeflow-canvas-root sf:relative sf:flex sf:h-full sf:w-full',
            // While a draw/pen gesture is armed, suppress browser touch panning
            // so a stylus/finger draws instead of scrolling the pane.
            drawArmed || penMode ? 'sf:touch-none' : '',
          )}
          style={wrapperCursor ? { cursor: wrapperCursor } : undefined}
          // US-010: capture-phase listener fires before xyflow's pane handlers.
          // Snapshots the additive base + shift state for a pending marquee so
          // the existing selection survives xyflow's reset (see the change-filter
          // in onNodesChange / onEdgesChange above).
          onPointerDownCapture={onWrapperPointerDownCapture}
          onPointerDown={(e) => {
            if (spaceHeld) setSpaceDragging(true);
            onPointerDown(e);
          }}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => {
            setSpaceDragging(false);
            onPointerUp(e);
          }}
          onPointerCancel={() => {
            drawingRef.current = false;
            drawStartRef.current = null;
            drawCurrentRef.current = null;
            drawSamplesRef.current = [];
            // Tear down any in-progress freehand stroke too — without this an
            // interrupted stroke (touch interruption, OS gesture, pointer loss)
            // leaves penDrawingRef armed and welds into the next gesture.
            penDrawingRef.current = false;
            penPointsRef.current = [];
            penShiftRef.current = false;
            penShiftHeldAtRef.current = 0;
            setDrawStart(null);
            setDrawCurrent(null);
            setSpaceDragging(false);
          }}
          // US-010: capture-phase right-click handler so a multi-selection
          // right-click opens OUR Radix menu instead of xyflow's single-node
          // menu (which would also clear the multi-selection en route).
          onContextMenuCapture={onWrapperContextMenuCapture}
          // US-008: OS-image drop. Both handlers are no-ops unless
          // `onCreateImageFromFile` is wired.
          onDragOver={onWrapperDragOver}
          onDrop={onWrapperDrop}
        >
          <CanvasPortalContainerProvider containerRef={wrapperRef}>
            {/* Canvas area: shrinks when the DetailPanel sidebar mounts as a
                flex sibling, so the panel no longer overlays the canvas. The
                `sf:min-w-0` is critical — without it the ReactFlow viewport's
                intrinsic min-width wins over `flex-1` and the panel can't
                claim its share of the row. */}
            <div className="sf:relative sf:flex-1 sf:min-w-0 sf:h-full">
              <ReactFlow
                nodes={displayNodes}
                edges={rfEdges}
                onNodesChange={onNodesChange}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                proOptions={PRO_OPTIONS}
                fitView
                minZoom={mode === 'mini' ? 0.05 : 0.5}
                // US-027: nodes remain draggable in view mode so the canvas feels
                // alive (local-state-only repositioning). commitDraggedNodes above
                // gates the actual PATCH dispatch.
                nodesDraggable={
                  (isEditMode ? !!onNodePositionChange : true) &&
                  !(drawArmed || penMode) &&
                  !handMode &&
                  flags.enableNodeMove
                }
                // US-027: view mode → handles are never connectable. Both the global
                // and per-node connectable flags are gated; combined with the onConnect
                // early return this is a triple-gate against stray edge creation.
                // Hand mode locks connection-drag too — any pane click pans instead.
                nodesConnectable={
                  isEditMode && !!onCreateConnector && !(drawArmed || penMode) && !handMode
                }
                // US-027: in view mode we disable keyboard-driven deletion entirely
                // (Backspace/Delete chord). xyflow has no global `edgesDeletable`
                // flag — the per-edge `deletable` defaults to true and only the
                // delete-key path opt-outs at the top level. Combined with the
                // context-menu gate above, this leaves no UI path for the user to
                // delete a node or connector in view mode.
                deleteKeyCode={isEditMode ? ['Backspace', 'Delete'] : null}
                // US-027: zoom and pan are explicit so view-mode embedders that
                // disable them via flag overrides get the expected behavior. The
                // default for both is true to match the legacy edit-mode behavior.
                zoomOnScroll={flags.enableZoom}
                zoomOnPinch={flags.enableZoom}
                className={connecting ? 'seeflow-connecting' : undefined}
                onConnect={isEditMode ? onConnect : undefined}
                // US-004: reject any connection where either endpoint is a text-shape
                // node — pure annotations are never connectable. See the
                // `isValidConnection` definition above for the full rationale.
                isValidConnection={isValidConnection}
                onConnectStart={(_e, params) => {
                  setConnecting(true);
                  connectSucceededRef.current = false;
                  // US-023: capture the drag origin so onConnect / onConnectEnd can
                  // tell which end the user actually started from, regardless of
                  // React Flow's source-type-handle-first normalization.
                  connectStartRef.current = {
                    nodeId: params.nodeId ?? null,
                    handleType: params.handleType ?? null,
                  };
                  // US-017: mark the source node so its own outlets stay visible
                  // (others get hidden via CSS) for the duration of the drag.
                  setConnectSource(params.nodeId ?? null);
                }}
                onConnectEnd={onConnectEndCb}
                onReconnect={isEditMode && onReconnectConnector ? onReconnect : undefined}
                onReconnectStart={(_e, edge, handleType) => {
                  setConnecting(true);
                  reconnectSucceededRef.current = false;
                  // US-009: mark that this drag is a reconnect (vs new connection) so
                  // the custom connection-line component mirrors the reconnecting
                  // edge's style. Cleared in onReconnectEnd.
                  isReconnectingRef.current = true;
                  // US-017: the anchored end of the edge plays the "source" role for
                  // outlet visibility — its outlets stay visible, others are hidden
                  // via CSS. xyflow passes `handleType` as the type of the FIXED
                  // (anchored) end, so the anchored node id is the matching side.
                  const anchoredNodeId = handleType === 'source' ? edge.source : edge.target;
                  setConnectSource(anchoredNodeId);
                }}
                onReconnectEnd={onReconnectEndCb}
                connectionLineComponent={connectionLineComponent}
                connectionLineStyle={{ strokeWidth: 2 }}
                // Generous connection radius so the user can release a connect or
                // reconnect drag near a handle without pixel-perfect aim. React Flow
                // snaps to the closest handle within this radius.
                connectionRadius={32}
                // US-024: SVG EdgeAnchor circle r=10 → 20px hit-region diameter, kept
                // intentionally larger than the visible portal-rendered endpoint dot
                // (sized via the shared --seeflow-handle-size token, also driving
                // outlet handle size) so the user gets a generous click target. The
                // SVG circle itself is rendered transparent via
                // `.react-flow__edgeupdater` CSS — only the portal dot is visible.
                reconnectRadius={10}
                // US-011: by default xyflow's `edgesReconnectable` is true, which makes
                // EVERY edge render EdgeAnchor circles regardless of selection.
                // Previously this was masked by `.react-flow__edgeupdater { opacity: 0 }`,
                // but now that we paint EdgeAnchor visibly, we need to restrict it to
                // the single-selected edge — disable the global default and let the
                // explicit `reconnectable: true` on the selected edge (set in `rfEdges`)
                // be the only switch that turns EdgeAnchor on.
                edgesReconnectable={false}
                // Keep selected nodes at the same z-stack level as their siblings
                // (US-014). React Flow's default would bump a selected node to
                // z-index 1000+, but selection is already conveyed by the outline
                // (US-005) and US-014 pins every node above every edge regardless
                // of selection — no extra node-vs-node elevation needed.
                elevateNodesOnSelect={false}
                elementsSelectable={!(drawArmed || penMode) && !handMode && flags.enableSelection}
                // US-018: dragging an unselected node moves it WITHOUT auto-selecting
                // (and therefore without opening the detail panel). React Flow defaults
                // this to true; an explicit click (mousedown + mouseup without
                // movement) still selects via onNodeClick.
                selectNodesOnDrag={false}
                // xyflow defaults `nodeClickDistance` to 0, which combined with
                // `selectNodesOnDrag={false}` means ANY sub-pixel pointer jitter
                // between mousedown and mouseup makes xyflow treat the gesture as a
                // drag (no selection) instead of a click — the user perceives this as
                // "clicking a node sometimes doesn't select it, takes a few tries".
                // 5px matches the marquee/drag threshold most design tools use and
                // gives mouse/trackpad input enough tolerance to land a click cleanly.
                nodeClickDistance={5}
                // US-010 selection model: primary-mouse drag on empty pane draws a
                // marquee (rubber-band) that multi-selects nodes + edges. Middle and
                // right-mouse drags pan. Space-held primary drag also pans (via
                // panActivationKeyCode below). Draw mode disables marquee + pan so the
                // toolbar's shape gesture owns primary-drag.
                //
                // SelectionMode.Partial: an edge / node selects if ANY part is inside
                // the marquee (matches the design-tool norm — strict-Full would only
                // select fully-contained shapes, which feels finicky).
                //
                // selectionKeyCode=null suppresses xyflow's modifier-marquee fallback
                // (default would be 'Shift') since selectionOnDrag already covers
                // marquee — keeping shift free for additive multi-select via click.
                selectionOnDrag={!(drawArmed || penMode) && !handMode && flags.enableSelection}
                // US-027: panning gated on the resolved flag. Draw mode still wins
                // (toolbar shape gesture owns primary-drag). Hand mode promotes
                // left-click to pan ([0,1,2]) so the cursor matches the affordance.
                panOnDrag={
                  drawArmed || penMode
                    ? false
                    : handMode
                      ? [0, 1, 2]
                      : flags.enablePan
                        ? [1, 2]
                        : false
                }
                selectionMode={SelectionMode.Partial}
                selectionKeyCode={null}
                multiSelectionKeyCode={drawArmed || penMode ? null : ['Meta', 'Shift']}
                panActivationKeyCode={drawArmed || penMode ? null : 'Space'}
                // US-010: lift the marquee end to a single onSelectionChange call so
                // the parent's `selectedNodeIds` / `selectedConnectorIds` props don't
                // churn per frame. The onNodesChange / onEdgesChange handlers above
                // accumulate the live changes into local refs; this fires once on
                // pointer-up.
                onSelectionStart={onSelectionStartCb}
                onSelectionEnd={onSelectionEndCb}
                // Pin every edge at zIndex 0 so the connector line ALWAYS paints
                // under nodes (only the outlet endpoint dots, drawn via
                // <ViewportPortal> at CSS z-index 2000, sit on top). Setting via
                // defaultEdgeOptions is preferred to a per-edge zIndex because it
                // doesn't churn edge identity through connectorToEdge — the option
                // propagates through xyflow's default edge merging.
                defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
                zoomOnDoubleClick={false}
                onInit={(instance) => {
                  rfInstanceRef.current = instance;
                  // Seed `--rf-zoom` to the initial viewport zoom so the selection
                  // outline reads a sensible value before the first onMove fires.
                  const wrapper = wrapperRef.current;
                  if (wrapper) wrapper.style.setProperty('--rf-zoom', String(instance.getZoom()));
                  // US-011: signal that React Flow has mounted and laid out so
                  // Playwright / a11y tooling can wait on a stable readiness gate
                  // before interacting with the canvas. Set imperatively on the
                  // canvas root so test selectors stay decoupled from internal
                  // state ordering.
                  if (wrapper) wrapper.setAttribute('data-canvas-ready', 'true');
                  // US-008: mount-fit. Reuses the same guard the late-nodes useEffect
                  // checks (`didMountFitRef`) so whichever path fires first wins and
                  // the other no-ops — preventing double-fit when nodes are already
                  // present at onInit time.
                  if (!didMountFitRef.current && resolvedAutoFitView.onMount && nodes.length > 0) {
                    instance.fitView(FIT_VIEW_OPTIONS);
                    didMountFitRef.current = true;
                  }
                  onRfInit?.(instance);
                }}
                onMove={handleMove}
                onEdgesChange={onEdgesChange}
                onNodeDragStart={handleNodeDragStart}
                onNodeDrag={handleNodeDrag}
                onNodeDragStop={handleNodeDragStop}
                onSelectionDragStart={handleSelectionDragStart}
                onSelectionDrag={handleSelectionDrag}
                onSelectionDragStop={handleSelectionDragStop}
                // US-003: route React Flow's click-only events to the parent so the
                // detail panel can be driven by explicit clicks instead of selection
                // changes. xyflow's `onNodeClick`/`onEdgeClick` fire only for real
                // clicks (mousedown + mouseup without crossing the drag threshold);
                // node-drag gestures don't trigger them, so a drag no longer opens
                // the panel as a side effect.
                onNodeClick={handleNodeClickWithGroupGate}
                onEdgeClick={handleEdgeClickWithGroupGate}
                // US-018: double-click anywhere on the edge body opens the inline
                // label editor (not just the existing label-button onDoubleClick). The
                // per-edge `registerEditHandle` map gives us O(1) dispatch without
                // forcing edge identity to change when editing state flips.
                onEdgeDoubleClick={handleEdgeDoubleClick}
                // Canvas grouping M6: double-click a group to ENTER isolation.
                // No zoom conflict (zoomOnDoubleClick is false above).
                onNodeDoubleClick={handleNodeDoubleClick}
                onPaneClick={handlePaneClickWithGroupExit}
                onNodeContextMenu={
                  flags.enableContextMenu && contextEnabled
                    ? (e, node) => {
                        // Suppress the browser's default menu and open our own at the
                        // cursor. The id sticks in a ref (read by item callbacks); the
                        // position state drives the trigger-position effect that
                        // dispatches the synthetic contextmenu event.
                        e.preventDefault();
                        contextNodeIdRef.current = node.id;
                        setContextOnNode(true);
                        setContextNodeType(node.type ?? null);
                        setContextEndpoint(null);
                        setContextMenuPos({ x: e.clientX, y: e.clientY });
                      }
                    : undefined
                }
                onPaneContextMenu={
                  flags.enableContextMenu && onPasteAt
                    ? (e) => {
                        // Right-click on empty canvas opens the same menu but with
                        // only the pane-applicable items (Paste). The "ContextMenu"
                        // event delivered here is either a synthetic ReactMouseEvent
                        // (from React Flow's wrapper) OR a native MouseEvent — both
                        // expose preventDefault + clientX/clientY.
                        e.preventDefault();
                        contextNodeIdRef.current = null;
                        setContextOnNode(false);
                        setContextNodeType(null);
                        setContextEndpoint(null);
                        setContextMenuPos({ x: e.clientX, y: e.clientY });
                      }
                    : undefined
                }
              >
                <StoreApiBridge storeApiRef={storeApiRef} />
                <ZoomBridge wrapperRef={wrapperRef} />
                <Background gap={12} size={0.6} />
                {/* US-004: alignment guides overlay. Mounted inside
                <ViewportPortal> so its SVG lines render in world coordinates
                and pan/zoom with the canvas (`vector-effect=non-scaling-stroke`
                keeps the stroke 1 screen px). Gated on the resolved flag so
                view/mini never mount an empty portal; the overlay itself
                returns null while `guides` is empty. */}
                {flags.enableAlignmentGuides ? (
                  <ViewportPortal>
                    <AlignmentOverlay guides={alignment.guides} />
                  </ViewportPortal>
                ) : null}
                {mode !== 'mini' && <GlowOverlay />}
                {/* US-020: bottom-left canvas-view cluster. xyflow's default Fit View
            is hidden so we can render a Lucide-styled button that calls
            fitView with the documented options (padding 0.15, duration 300).
            Auto Align (Tidy) moved here from CanvasToolbar so all canvas-view
            actions live in the same place. Order: zoom-in, zoom-out (from
            <Controls>), Fit View, Auto Align. Gated on flags.showControls so
            mini-mode thumbnails render chrome-free. */}
                {flags.showControls ? (
                  <Controls showInteractive={false} showFitView={false}>
                    <ControlButton
                      data-testid="controls-fit-view"
                      aria-label="Fit view"
                      title="Fit view"
                      disabled={nodes.length === 0}
                      onClick={() => {
                        rfInstanceRef.current?.fitView(FIT_VIEW_OPTIONS);
                      }}
                    >
                      <Maximize2 className="sf:h-3 sf:w-3" aria-hidden="true" />
                    </ControlButton>
                    <ControlButton
                      data-testid="controls-tidy"
                      aria-label="Tidy layout (⌘⇧L)"
                      title="Tidy layout (⌘⇧L)"
                      disabled={!effectiveTidy}
                      onClick={() => effectiveTidy?.()}
                    >
                      <LayoutDashboard className="sf:h-3 sf:w-3" aria-hidden="true" />
                    </ControlButton>
                  </Controls>
                ) : null}
                {/* React Flow's bottom-right MiniMap (the outline / high-level
            box). Gated on flags.showMiniMap so mini-mode thumbnails don't
            render a minimap inside themselves. Position defaults to
            bottom-right which doesn't collide with the bottom-left
            <Controls> cluster. The Radix-style scoped class lets
            `src/styles/index.css` retheme it under `.seeflow-canvas-root`. */}
                {flags.showMiniMap ? <MiniMap className="sf-canvas-minimap" /> : null}
                {/* US-007 + grouping M2/M3: selection/group bounding-box overlay.
            Renders chrome for a 2+ loose-node selection OR a single selected
            group (the internal check is in `<SelectionResizeOverlay>`; we pass
            through unconditionally — ineligible selections render nothing).
            M3 wires `onMultiResize`: dragging a corner proportionally scales the
            selection from a frozen baseline and commits ONCE on pointer-up as a
            single batched undo entry (design §6). US-027: gated on
            flags.showResizeHandles so view-mode embedders skip the overlay
            machinery entirely. */}
                {flags.showResizeHandles ? (
                  <SelectionResizeOverlay
                    selectedNodes={liveSelectionOverlayNodes}
                    isGroupSelection={isGroupSelection}
                    // Temp/final marquee PARITY: a loose multi-selection chromes
                    // `members + SELECTION_OVERLAY_PADDING`. A group selection
                    // chromes the group BOX, which already carries its own
                    // GROUP_BOX_PADDING around the members — so the overlay must
                    // add only the DIFFERENCE (0 when the two constants match) to
                    // land the marquee the same distance from the members as a
                    // temp selection. (A deliberately resized "labeled zone" box
                    // is larger than members+padding; clamping at 0 keeps the
                    // marquee on the real box bounds there.)
                    paddingPx={
                      isGroupSelection
                        ? Math.max(0, SELECTION_OVERLAY_PADDING - GROUP_BOX_PADDING)
                        : SELECTION_OVERLAY_PADDING
                    }
                    onMultiResize={onMultiResize}
                    onGroupAction={onGroupAction}
                  />
                ) : null}
                {topLeftSlot ||
                flags.showToolbar ||
                (flags.showStyleStrip && onStyleNode && onStyleConnector) ? (
                  <Panel position="top-left">
                    <div className="sf:flex sf:flex-col sf:items-start sf:gap-2">
                      {/* US-037: external content (e.g. the studio's FlowSwitcher)
                  stacks first so it sits above the toolbar / StyleStrip in the
                  same absolutely-positioned Panel column — no more overlap. */}
                      {topLeftSlot}
                      {flags.showToolbar ? (
                        // View mode renders the toolbar with only Select + Hand
                        // (no shape-creation affordances). Edit mode threads in the
                        // shape-creation tiles + icon picker by also providing
                        // onCreateShapeNode, which is the same prop that gates the
                        // drag-create flow lower down. Mini mode has showToolbar
                        // false in VIEW_DEFAULTS' sibling MINI_DEFAULTS — no toolbar.
                        <CanvasToolbar
                          mode={canvasMode}
                          onModeChange={onCanvasModeChange}
                          iconPickerOpen={iconPickerOpen ?? false}
                          onOpenIconPicker={onOpenIconPicker}
                          onCloseIconPicker={onCloseIconPicker}
                          onPickIcon={onPickIcon}
                          // Hide shape buttons + icon picker outside edit mode (or
                          // when the host can't create shapes anyway). The Select +
                          // Hand navigation tools always remain so view-mode embeds
                          // get a Miro/Figma-style tool toggle.
                          showShapeTools={isEditMode && !!onCreateShapeNode}
                          iconsAdapter={iconsAdapter}
                        />
                      ) : null}
                      {flags.showStyleStrip && onStyleNode && onStyleConnector ? (
                        <StyleStrip
                          nodes={selectedNodesForStyleStrip}
                          connectors={selectedConnectors ?? []}
                          onStyleNode={onStyleNode}
                          onStyleNodePreview={onStyleNodePreview}
                          onStyleNodes={onStyleNodes}
                          onStyleNodesPreview={onStyleNodesPreview}
                          onStyleConnector={onStyleConnector}
                          onStyleConnectorPreview={onStyleConnectorPreview}
                          onRequestIconReplace={onRequestIconReplace}
                        />
                      ) : null}
                    </div>
                  </Panel>
                ) : null}
                {/* Top-right action cluster: host-provided topRightSlot + ShareMenu.
            Sharing one Panel keeps them side-by-side so they never overlap.
            ShareMenu mode is mapped to 'view' for mini defensively (the Panel
            itself is gated below). EmbedDialog state is hoisted into this
            component so the imperative ref handle can open it without going
            through the menu. */}
                {flags.showShareMenu || topRightSlot || sidebarEnabled ? (
                  <Panel position="top-right">
                    <div className="sf:flex sf:items-center sf:gap-1">
                      {topRightSlot}
                      {sidebarEnabled && !sidebarOpen ? (
                        <InspectorToggle
                          open={sidebarOpen}
                          onToggle={() => setSidebarOpen((v) => !v)}
                        />
                      ) : null}
                      {flags.showShareMenu ? (
                        <ShareMenu
                          mode={mode === 'mini' ? 'view' : mode}
                          projectId={projectId}
                          enableEmbed={flags.enableEmbed}
                          onDownloadPdf={exportApi.exportPdf}
                          onDownloadPng={exportApi.exportPng}
                          onExportToCloud={onExportToCloud}
                          onShareWithMembers={onShareWithMembers}
                          embedOpen={shareEmbedDialogOpen}
                          onEmbedOpenChange={setShareEmbedDialogOpen}
                        />
                      ) : null}
                    </div>
                  </Panel>
                ) : null}
              </ReactFlow>
              {ghostRect ? (
                <div
                  data-testid="canvas-draw-ghost"
                  data-ghost-shape={drawShape ?? undefined}
                  data-ghost-icon={drawIcon ?? undefined}
                  aria-hidden
                  className={cn(
                    'sf:pointer-events-none sf:absolute sf:z-10',
                    ghostShapeClass,
                    ghostTextOutline
                      ? 'sf:rounded-sm sf:border sf:border-dashed sf:border-muted-foreground/40'
                      : '',
                    isLinkflowGhost
                      ? 'sf:flex sf:items-center sf:justify-center sf:rounded-md sf:border sf:border-dashed sf:border-border sf:bg-muted/40 sf:text-muted-foreground sf:text-sm'
                      : '',
                    drawIcon ? 'sf:flex sf:items-center sf:justify-center' : '',
                  )}
                  style={{
                    ...ghostShapeStyle,
                    left: ghostRect.left,
                    top: ghostRect.top,
                    width: ghostRect.width,
                    height: ghostRect.height,
                  }}
                >
                  {drawIcon ? (
                    // Mirror the committed icon node's IconRenderer so the
                    // drag preview matches what mouse-up will paint. The
                    // overlay div is sized to the literal drag rect; the
                    // commit step enforces ICON_DEFAULT_SIZE only on near-zero
                    // taps (mirrors the shape MIN_DRAW_SIZE rule above).
                    <IconRenderer
                      iconId={drawIcon}
                      studioBaseUrl={studioBaseUrl}
                      className="sf:block sf:h-full sf:w-full sf:select-none"
                    />
                  ) : null}
                  {isLinkflowGhost ? (
                    // Mirror the unlinked-state pill from linkflow-node.tsx so the
                    // drag preview matches what the commit will paint until the
                    // picker auto-opens. No drag-size clamp here — the ghost
                    // honours the literal cursor rect; the commit step is the
                    // one that enforces LINKFLOW_MIN_SIZE.
                    <span className="sf:inline-flex sf:items-center sf:gap-2">
                      <Link2 size={14} aria-hidden />
                      <span>Link to a flow</span>
                    </span>
                  ) : null}
                  {/* US-010: illustrative shapes have no wrapper chrome — the SVG owns
              the visuals. Render the per-shape SVG directly inside the ghost
              so the drag preview matches the committed visual byte-for-byte.
              The committed node (`GeometricNodeImpl`) calls `resolveIllustrativeColors`
              on its `data`; we call the same helper here with the last-used
              snapshot read above, so the ghost matches what
              `buildNewShapeData` will commit. `borderSize` and `borderStyle`
              pull from the same snapshot, falling back to `NEW_NODE_BORDER_WIDTH`
              / the renderer's default when unset. US-022: dispatch through
              `ILLUSTRATIVE_SHAPE_RENDERERS` so adding a new illustrative shape
              only touches the registry. Linkflow is handled above. */}
                  {(() => {
                    if (isNonGeometricGhost) return null;
                    // Excluding linkflow + line narrows `drawShape` to the
                    // geometric union below; no redundant guard needed.
                    const GhostRenderer = drawShape
                      ? ILLUSTRATIVE_SHAPE_RENDERERS[drawShape]
                      : undefined;
                    if (!GhostRenderer) return null;
                    const illustrativeColors = resolveIllustrativeColors(ghostLastUsedNodeStyle);
                    return (
                      <GhostRenderer
                        width={ghostRect.width}
                        height={ghostRect.height}
                        borderColor={illustrativeColors.borderColor}
                        backgroundColor={illustrativeColors.backgroundColor}
                        borderSize={ghostLastUsedNodeStyle?.borderSize ?? NEW_NODE_BORDER_WIDTH}
                        borderStyle={ghostLastUsedNodeStyle?.borderStyle}
                      />
                    );
                  })()}
                </div>
              ) : null}
              {/* US-Freehand: live pen-stroke preview. While penMode capture is
                  active and the path has >= 2 samples, draw the in-progress
                  stroke as a simple <polyline> through the raw client-space
                  points (offset into wrapper-local coords, mirroring the ghost).
                  NOTE: the preview is a polyline, but the COMMITTED node renders
                  via perfect-freehand (variable-width ink) — the committed node
                  is the source of truth. The slight preview/commit fidelity gap
                  (no pressure taper on the preview) is acceptable for v1 and
                  avoids wiring the optional peer dep into the overlay. The
                  drawStart/drawCurrent state gate the re-render; the actual path
                  lives in penPointsRef. */}
              {penMode && drawStart && drawCurrent && penPointsRef.current.length >= 2
                ? (() => {
                    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
                    const offsetX = wrapperRect?.left ?? 0;
                    const offsetY = wrapperRect?.top ?? 0;
                    // Hold Shift → preview the straightened 2-point segment so the
                    // live overlay matches what will commit. Mirror the commit's
                    // grace window (PEN_SHIFT_GRACE_MS) so a brief Shift lift at
                    // release doesn't flash the preview back to a curve.
                    const penPoints = penPointsRef.current;
                    const previewFirst = penPoints[0];
                    const previewLast = penPoints[penPoints.length - 1];
                    const previewStraighten =
                      penShiftRef.current ||
                      Date.now() - penShiftHeldAtRef.current <= PEN_SHIFT_GRACE_MS;
                    const source: Point[] =
                      previewStraighten && previewFirst && previewLast
                        ? [previewFirst, snapToStraightLine(previewFirst, previewLast)]
                        : penPoints;
                    const pts = source.map(([x, y]) => `${x - offsetX},${y - offsetY}`).join(' ');
                    return (
                      <svg
                        data-testid="canvas-freehand-preview"
                        aria-hidden
                        className="sf:pointer-events-none sf:absolute sf:inset-0 sf:z-10 sf:h-full sf:w-full"
                      >
                        <title>Freehand stroke preview</title>
                        <polyline
                          points={pts}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    );
                  })()
                : null}
              {/* Line tool: live preview of the segment being drawn. Mirrors the
                  commit's straight-snap (in client px here, STRAIGHT_SNAP_PX) so
                  the preview lands exactly where mouse-up commits. */}
              {drawShape === 'line' && drawStart && drawCurrent
                ? (() => {
                    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
                    const ox = wrapperRect?.left ?? 0;
                    const oy = wrapperRect?.top ?? 0;
                    const snapped = snapSegmentToStraight(drawStart, drawCurrent, STRAIGHT_SNAP_PX);
                    return (
                      <svg
                        data-testid="canvas-line-preview"
                        aria-hidden
                        className="sf:pointer-events-none sf:absolute sf:inset-0 sf:z-10 sf:h-full sf:w-full"
                      >
                        <title>Line preview</title>
                        <line
                          x1={drawStart.x - ox}
                          y1={drawStart.y - oy}
                          x2={snapped.x - ox}
                          y2={snapped.y - oy}
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                        />
                      </svg>
                    );
                  })()
                : null}
              {flags.enableContextMenu && contextEnabled ? (
                <ContextMenu
                  onOpenChange={(open) => {
                    if (!open) {
                      setContextMenuPos(null);
                      contextNodeIdRef.current = null;
                      setContextNodeType(null);
                      setContextEndpoint(null);
                    }
                  }}
                >
                  <ContextMenuTrigger asChild>
                    <div
                      ref={contextTriggerRef}
                      data-testid="node-context-menu-trigger"
                      aria-hidden
                      className="sf:pointer-events-none sf:fixed"
                      style={{
                        left: contextMenuPos?.x ?? 0,
                        top: contextMenuPos?.y ?? 0,
                        width: 0,
                        height: 0,
                      }}
                    />
                  </ContextMenuTrigger>
                  <ContextMenuContent data-testid="node-context-menu">
                    {contextEndpoint?.pinned && onUnpinEndpoint ? (
                      <ContextMenuItem
                        data-testid="connector-endpoint-context-menu-unpin"
                        onSelect={handleUnpinPick}
                      >
                        Unpin
                      </ContextMenuItem>
                    ) : null}
                    {/* Canvas grouping M4: Group (≥2 loose selected) / Ungroup
                        (right-clicked a group). Mirrors the Copy/Delete item
                        pattern with a shortcut hint. */}
                    {contextCanGroup ? (
                      <ContextMenuItem
                        data-testid="node-context-menu-group"
                        onSelect={handleGroupPick}
                      >
                        Group
                        <ContextMenuShortcut>{groupShortcut}</ContextMenuShortcut>
                      </ContextMenuItem>
                    ) : null}
                    {contextOnNode && contextNodeType === 'group' && onUngroup ? (
                      <ContextMenuItem
                        data-testid="node-context-menu-ungroup"
                        onSelect={handleUngroupPick}
                      >
                        Ungroup
                        <ContextMenuShortcut>{ungroupShortcut}</ContextMenuShortcut>
                      </ContextMenuItem>
                    ) : null}
                    {(contextCanGroup ||
                      (contextOnNode && contextNodeType === 'group' && onUngroup)) &&
                    (onCopyNode || onPasteAt || onReorderNode || onDeleteNode) ? (
                      <ContextMenuSeparator />
                    ) : null}
                    {contextOnNode && onCopyNode ? (
                      <ContextMenuItem
                        data-testid="node-context-menu-copy"
                        onSelect={handleCopyPick}
                      >
                        Copy
                        <ContextMenuShortcut>{copyShortcut}</ContextMenuShortcut>
                      </ContextMenuItem>
                    ) : null}
                    {onPasteAt ? (
                      <ContextMenuItem
                        data-testid="node-context-menu-paste"
                        disabled={!hasClipboard}
                        onSelect={handlePastePick}
                      >
                        Paste
                        <ContextMenuShortcut>{pasteShortcut}</ContextMenuShortcut>
                      </ContextMenuItem>
                    ) : null}
                    {contextOnNode &&
                    (onCopyNode || onPasteAt) &&
                    ((contextNodeType === 'icon' && !!onRequestIconReplace) ||
                      onReorderNode ||
                      onDeleteNode) ? (
                      <ContextMenuSeparator />
                    ) : null}
                    {contextOnNode && contextNodeType === 'icon' && onRequestIconReplace ? (
                      <ContextMenuItem
                        data-testid="node-context-menu-change-icon"
                        onSelect={handleChangeIconPick}
                      >
                        Change icon
                      </ContextMenuItem>
                    ) : null}
                    {contextOnNode &&
                    contextNodeType === 'icon' &&
                    onRequestIconReplace &&
                    (onReorderNode || onDeleteNode) ? (
                      <ContextMenuSeparator />
                    ) : null}
                    {contextOnNode && onReorderNode ? (
                      <>
                        <ContextMenuItem
                          data-testid="node-context-menu-to-front"
                          onSelect={() => handleReorderPick({ op: 'toFront' })}
                        >
                          Bring to front
                        </ContextMenuItem>
                        <ContextMenuItem
                          data-testid="node-context-menu-forward"
                          onSelect={() => handleReorderPick({ op: 'forward' })}
                        >
                          Bring forward
                        </ContextMenuItem>
                        <ContextMenuItem
                          data-testid="node-context-menu-backward"
                          onSelect={() => handleReorderPick({ op: 'backward' })}
                        >
                          Send backward
                        </ContextMenuItem>
                        <ContextMenuItem
                          data-testid="node-context-menu-to-back"
                          onSelect={() => handleReorderPick({ op: 'toBack' })}
                        >
                          Send to back
                        </ContextMenuItem>
                      </>
                    ) : null}
                    {contextOnNode && onReorderNode && onDeleteNode ? (
                      <ContextMenuSeparator />
                    ) : null}
                    {contextOnNode && onDeleteNode ? (
                      <ContextMenuItem
                        data-testid="node-context-menu-delete"
                        onSelect={handleDeletePick}
                      >
                        Delete
                      </ContextMenuItem>
                    ) : null}
                  </ContextMenuContent>
                </ContextMenu>
              ) : null}
              {onCreateAndConnectFromPane ? (
                <Popover
                  open={!!dropPopover}
                  onOpenChange={(open) => {
                    // Radix-driven dismissals (outside-click, ESC inside the popover,
                    // programmatic close on commit) all funnel through here. Map the
                    // close back to clearing our state so the next drop can re-anchor.
                    if (!open) setDropPopover(null);
                  }}
                >
                  {/* PopoverAnchor is a 0×0 fixed-position element pinned to the cursor
              at drop time; the Popover content positions relative to it. */}
                  <PopoverAnchor asChild>
                    <div
                      data-testid="drop-popover-anchor"
                      aria-hidden
                      className="sf:pointer-events-none sf:fixed"
                      style={{
                        left: dropPopover?.clientX ?? 0,
                        top: dropPopover?.clientY ?? 0,
                        width: 0,
                        height: 0,
                      }}
                    />
                  </PopoverAnchor>
                  <PopoverContent
                    data-testid="drop-popover"
                    align="start"
                    side="bottom"
                    sideOffset={4}
                    className="sf:w-auto sf:p-1"
                    onOpenAutoFocus={(e) => {
                      // Don't pull focus into the popover — keep it on the canvas so
                      // the wrapper-level ESC handler still receives keypresses.
                      e.preventDefault();
                    }}
                  >
                    <div
                      role="menu"
                      aria-label="Create connected node"
                      className="sf:flex sf:flex-col sf:gap-0.5"
                    >
                      {TOOLBAR_SHAPES.map(({ shape, label, Icon }) => {
                        // Linkflow is omitted from the drop-on-pane popover —
                        // "create-and-connect-from-source" semantics don't
                        // compose with the linkflow's pick-a-target step. The
                        // toolbar tile remains the path for creating linkflow
                        // nodes.
                        if (shape === 'linkflow' || shape === 'line') return null;
                        return (
                          <button
                            key={shape}
                            type="button"
                            role="menuitem"
                            data-testid={`drop-popover-shape-${shape}`}
                            onClick={() => {
                              const dp = dropPopover;
                              if (!dp) return;
                              onCreateAndConnectFromPane({
                                sourceNodeId: dp.sourceNodeId,
                                position: { x: dp.flowX, y: dp.flowY },
                                shape,
                              });
                              setDropPopover(null);
                            }}
                            className={cn(
                              'sf:flex sf:items-center sf:gap-2 sf:rounded-sm sf:px-2 sf:py-1.5 sf:text-left sf:text-sm',
                              'sf:hover:bg-accent sf:hover:text-accent-foreground',
                              'sf:focus:bg-accent sf:focus:text-accent-foreground sf:focus:outline-hidden',
                            )}
                          >
                            <Icon
                              className="sf:h-4 sf:w-4 sf:text-muted-foreground"
                              aria-hidden="true"
                            />
                            <span>{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              ) : null}
            </div>
            {shouldRenderSidebar ? (
              <DetailPanel
                flowId={sidebarDemoId}
                node={sidebarNode}
                connector={null}
                adapter={adapter ?? null}
                statusReport={statusReport}
                onNameChange={onNameChange}
                onDescriptionChange={onDescriptionChange}
                onDetailChange={onDetailChange}
                onIconChange={onIconChange}
                onReplaceImage={isEditMode ? onReplaceImage : undefined}
                open={sidebarOpen}
                onClose={() => {
                  // Dismiss the sidebar (X button, Escape) AND clear selection
                  // so the X/Esc gestures behave like the pane-click dismissal:
                  // panel closes, nothing stays selected.
                  setSidebarOpen(false);
                  onSelectionChangeRef.current?.([], []);
                }}
              />
            ) : null}
          </CanvasPortalContainerProvider>
        </div>
      </CanvasStudioProvider>
    </IconRegistryProvider>
  );
}

/**
 * US-014: ref-aware wrapper. Hosts use `useRef<SeeflowCanvasHandle>()` +
 * `ref={canvasRef}` to call `exportPdf` / `exportPng` / `openEmbedDialog`
 * from a command palette or keyboard shortcut without owning the underlying
 * state.
 */
export const SeeflowCanvas = forwardRef<SeeflowCanvasHandle, SeeflowCanvasProps>(SeeflowCanvasImpl);
