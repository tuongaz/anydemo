import { CanvasToolbar, HTML_BLOCK_DND_TYPE, TOOLBAR_SHAPES } from '@/components/canvas-toolbar';
import { EditableEdge, type EditableEdgeData } from '@/components/edges/editable-edge';
import { HtmlNode } from '@/components/nodes/html-node';
import { IconNode } from '@/components/nodes/icon-node';
import { ImageNode } from '@/components/nodes/image-node';
import { PlayNode } from '@/components/nodes/play-node';
import {
  SHAPE_DEFAULT_SIZE,
  ShapeNode,
  shapeChromeClass,
  shapeChromeStyle,
} from '@/components/nodes/shape-node';
import { StateNode } from '@/components/nodes/state-node';
import {
  type MultiResizeUpdate,
  type OverlayInputNode,
  SelectionResizeOverlay,
} from '@/components/selection-resize-overlay';
import {
  type ConnectorStylePatch,
  type NodeStylePatch,
  StyleStrip,
} from '@/components/style-strip';
import type { NodeRuns } from '@/hooks/use-node-runs';
import type { NodeStatuses } from '@/hooks/use-node-statuses';
import type { OverrideMap } from '@/hooks/use-pending-overrides';
import type { Connector, DemoNode, EdgePin, ReorderOp, ShapeKind } from '@/lib/api';
import { NODE_DEFAULT_BG_WHITE, colorTokenStyle } from '@/lib/color-tokens';
import { NEW_NODE_BORDER_WIDTH } from '@/lib/node-defaults';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
  ILLUSTRATIVE_SHAPE_RENDERERS,
  type NodeStatus,
  Popover,
  PopoverAnchor,
  PopoverContent,
  type Side,
  cn,
  computeImageDims,
  connectorToEdge,
  endpointFromPin,
  endpointToPin,
  getNodeIntersection,
  handleCanvasFileDrop,
  projectCursorToPerimeter,
} from '@seeflow/canvas';
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
  type Node,
  type NodeChange,
  Panel,
  Position,
  ReactFlow,
  type ReactFlowInstance,
  SelectionMode,
  applyEdgeChanges,
  applyNodeChanges,
  getBezierPath,
  getSmoothStepPath,
  useStore,
  useStoreApi,
} from '@xyflow/react';
import { LayoutDashboard, Maximize2 } from 'lucide-react';
import {
  type ComponentType,
  type PointerEvent,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import '@xyflow/react/dist/style.css';

export interface DemoCanvasProps {
  /**
   * US-004: project id used by file-backed nodes (imageNode, future htmlNode)
   * to build project-scoped file URLs via `fileUrl(projectId, path)`. Threaded
   * into each node's runtime `data` so renderers can fetch from
   * `GET /api/projects/:id/files/:path`. Absent → file-backed nodes render
   * without a source URL (e.g. during pre-mount before the parent knows the
   * project id).
   */
  projectId?: string;
  nodes: DemoNode[];
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
  /** Per-node run state from SSE events. */
  runs?: NodeRuns;
  /**
   * US-007: latest StatusReport per node, driven by `node:status` SSE events.
   * Injected into each play/state node's `data.statusReport` so the renderer
   * can show a colored dot + ellipsized summary below the header. Empty / no
   * entry → no badge row (no layout shift vs. legacy renders).
   */
  statusByNode?: NodeStatuses;
  /** Click handler for a PlayNode's Play button. */
  onPlayNode?: (nodeId: string) => void;
  /**
   * Optimistic per-node overrides. When present, they shallow-merge over the
   * server `nodes` (with `data` shallow-merged one level deeper). Used by the
   * parent to keep an edit visually pinned while the PATCH round-trips.
   */
  nodeOverrides?: OverrideMap<DemoNode>;
  /**
   * Optimistic per-connector overrides. Shallow-merged over the server
   * `connectors` so style/color/direction edits are visible immediately
   * (without waiting for the SSE echo of the file rewrite).
   */
  connectorOverrides?: OverrideMap<Connector>;
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
   * Fired once per resize-stop with the node's final dimensions AND position.
   * Wiring this enables NodeResizer's resize handles inside each custom node.
   * US-012: top/left handle drags shift x/y so the opposite corner stays
   * anchored — persistence must store both the new size and new position.
   */
  onNodeResize?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
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
   */
  onMultiResize?: (updates: MultiResizeUpdate[]) => void;
  /** Persist a new node name (PATCH /nodes/:id { name }). */
  onNodeNameChange?: (nodeId: string, name: string) => void;
  /** Persist a new node description (PATCH /nodes/:id { description }). */
  onNodeDescriptionChange?: (nodeId: string, description: string) => void;
  /** Persist a new connector label (PATCH /connectors/:id { label }). */
  onConnectorLabelChange?: (connId: string, label: string) => void;
  /**
   * Commit a new shape node from the bottom-toolbar draw flow. Wiring this
   * enables the toolbar; absent → toolbar is hidden.
   */
  onCreateShapeNode?: (
    shape: ShapeKind,
    position: { x: number; y: number },
    dims: { width: number; height: number },
  ) => void;
  /**
   * US-008: commit a new imageNode from an OS-image file drop. The canvas
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
   * retry)' placeholder on an imageNode whose initial upload failed. Receives
   * the node id; the parent retries the upload using the file reference stored
   * in its retry map. Threaded into every imageNode's runtime data so the
   * renderer can call it on click.
   */
  onRetryImageUpload?: (nodeId: string) => void;
  /**
   * US-017: commit a new htmlNode at the drop position from the toolbar's
   * HTML block tile (HTML5 drag-and-drop). The canvas detects the
   * {@link HTML_BLOCK_DND_TYPE} dataTransfer marker on the wrapper drop
   * handler, projects the drop clientX/Y into flow space, and dispatches
   * here. The parent owns id allocation, optimistic override, and the
   * createNode persistence (server fills `data.htmlPath` per US-015).
   * Wiring this enables the HTML block toolbar tile; absent → the section
   * is hidden and any stray drop is a no-op.
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
  selectedNodes?: DemoNode[];
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
    shape: ShapeKind;
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
   * US-003: dispatched by the right-click "Change icon" menu item on an
   * iconNode. The canvas uses this from the menu's onSelect to request the
   * picker open in replace mode for that node. Same handler the detail
   * panel's "Change icon…" button uses (US-015), just a different entry
   * point. Absent → the menu item is hidden. (Previously US-016 also wired
   * this onto iconNode dblclick; US-004 replaced that path with inline
   * label edit and the picker is now reachable only via the right-click
   * menu and the StyleStrip button.)
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
   * US-019: flip the lock state for a batch of nodes as one undo entry.
   * Wiring this enables the right-click "Lock"/"Unlock" menu item. The
   * parent's existing mixed-selection convention applies: if ANY id is
   * unlocked the batch locks all; only when ALL are already locked does
   * the batch unlock. Absent → the menu item is hidden.
   */
  onToggleNodeLock?: (nodeIds: string[]) => void;
  /**
   * US-003: bottom-toolbar draw-mode state, lifted to the parent so the page-
   * level keyboard handler (`resolveToolShortcut` in demo-view.tsx) and the
   * future command palette can drive tool switches without the canvas owning
   * the state. The toolbar inside the canvas still reads `activeShape` and
   * calls `onSelectShape` exactly like before — only the source-of-truth
   * moved up one level.
   */
  activeShape: ShapeKind | null;
  onSelectShape: (shape: ShapeKind | null) => void;
}

// Below this threshold we treat the gesture as an accidental click / tiny
// nudge and create the shape at SHAPE_DEFAULT_SIZE instead — a single click
// still produces a usable node rather than a 0×0 ghost.
const MIN_DRAW_SIZE = 40;

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
  const nodes = wrapper.querySelectorAll('.react-flow__node');
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
    const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
    const dist = Math.hypot(dx, dy);
    if (dist <= nearestDist) {
      nearest = node;
      nearestDist = dist;
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

const mergeNodeOverride = (node: DemoNode, override: Partial<DemoNode> | undefined): DemoNode => {
  if (!override) return node;
  // The override is keyed by the node's id, so its `data` (when present) is
  // always a partial of the SAME variant as node.data. TS can't see this
  // through the discriminated union spread, so cast at the boundary.
  const data = override.data ? { ...node.data, ...override.data } : node.data;
  return { ...node, ...override, data } as DemoNode;
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

const nodeTypes = {
  playNode: PlayNode,
  stateNode: StateNode,
  shapeNode: ShapeNode,
  imageNode: ImageNode,
  iconNode: IconNode,
  // US-014: file-backed escape-hatch node — fetches author HTML at
  // `<project>/.seeflow/<htmlPath>`, sanitizes (US-013), and renders with
  // Tailwind Play CDN (US-012). Missing files render PlaceholderCard.
  htmlNode: HtmlNode,
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
    if (fixedNode) {
      const fW = fixedNode.measured.width ?? fixedNode.width ?? 0;
      const fH = fixedNode.measured.height ?? fixedNode.height ?? 0;
      if (fW > 0 && fH > 0) {
        const fixedBox = {
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
    const nodeMap = useStore((s) => s.nodeLookup);
    const xyflowToNodeId = useStore((s) => s.connection.toHandle?.nodeId ?? null);
    let effectiveToX = toX;
    let effectiveToY = toY;
    let effectiveToPosition = toPosition;
    if (zoom > 0) {
      const bufferFlow = RECONNECT_BUFFER_PX / zoom;
      // Node id to exclude from the snap targets:
      //   - reconnect: the other endpoint's node (self-loop guard)
      //   - new connect: nothing extra beyond the source itself, which is
      //     fixedNode (handled by the snap-onto-own-fixed branch below)
      const excludeNodeId = reconnectingEdge
        ? fixedNodeIsSource
          ? reconnectingEdge.target
          : reconnectingEdge.source
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
      // target via handle proximity.
      if (!bestNode) {
        let bestDist = bufferFlow;
        for (const node of nodeMap.values()) {
          if (excludeNodeId && node.id === excludeNodeId) continue;
          if (fixedNode && node.id === fixedNode.id) continue;
          const w = node.measured.width ?? node.width ?? 0;
          const h = node.measured.height ?? node.height ?? 0;
          if (w === 0 || h === 0) continue;
          const x = node.internals.positionAbsolute.x;
          const y = node.internals.positionAbsolute.y;
          const dx = Math.max(x - toX, 0, toX - (x + w));
          const dy = Math.max(y - toY, 0, toY - (y + h));
          const dist = Math.hypot(dx, dy);
          if (dist <= bestDist) {
            bestDist = dist;
            bestNode = node;
          }
        }
      }
      // Snap onto fixed-end's own node is allowed for reconnect drag
      // (pin-own gesture). For new connect, dropping back on the source
      // is rejected by onConnectEndCb so we deliberately don't preview
      // such a snap.
      if (!bestNode && reconnectingEdge && fixedNode) {
        const w = fixedNode.measured.width ?? fixedNode.width ?? 0;
        const h = fixedNode.measured.height ?? fixedNode.height ?? 0;
        if (w > 0 && h > 0) {
          const x = fixedNode.internals.positionAbsolute.x;
          const y = fixedNode.internals.positionAbsolute.y;
          const dx = Math.max(x - toX, 0, toX - (x + w));
          const dy = Math.max(y - toY, 0, toY - (y + h));
          const dist = Math.hypot(dx, dy);
          if (dist <= bufferFlow) bestNode = fixedNode;
        }
      }
      if (bestNode) {
        const w = bestNode.measured.width ?? bestNode.width ?? 0;
        const h = bestNode.measured.height ?? bestNode.height ?? 0;
        if (w > 0 && h > 0) {
          const projectedPin = projectCursorToPerimeter(
            {
              x: bestNode.internals.positionAbsolute.x,
              y: bestNode.internals.positionAbsolute.y,
              w,
              h,
            },
            { x: toX, y: toY },
          );
          const projectedEndpoint = endpointFromPin(
            {
              x: bestNode.internals.positionAbsolute.x,
              y: bestNode.internals.positionAbsolute.y,
              w,
              h,
            },
            projectedPin,
          );
          effectiveToX = projectedEndpoint.x;
          effectiveToY = projectedEndpoint.y;
          effectiveToPosition = POSITION_BY_SIDE_LINE[projectedEndpoint.side];
        }
      }
    }
    const isStep = data?.path === 'step';
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
    const style = reconnectingEdge?.style ?? connectionLineStyle ?? undefined;
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
    return (
      <path
        d={path}
        fill="none"
        className="react-flow__connection-path"
        style={style}
        markerStart={markerStartUrl}
        markerEnd={markerEndUrl}
      />
    );
  };
};

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

const statusFor = (runs: NodeRuns | undefined, id: string): NodeStatus =>
  runs?.[id]?.status ?? 'idle';

/**
 * Per-node `status` injected into a node's `data` slot. PlayNode (US-030)
 * needs to distinguish "never run" (undefined → hide pill) from "ran-then-idle"
 * (the runs reducer doesn't actually produce idle entries — the only way
 * status is undefined is no-entry-in-map). StateNode falls back to 'idle' on
 * its own; passing undefined upstream lets PlayNode see the difference
 * without affecting StateNode.
 */
const dataStatusFor = (runs: NodeRuns | undefined, id: string): NodeStatus | undefined =>
  runs?.[id]?.status;

/**
 * Per-node error message injected into a node's `data` slot when the most
 * recent run failed. PlayNode (US-018) surfaces it as the play-button
 * tooltip in place of the removed status chip.
 */
const dataErrorMessageFor = (runs: NodeRuns | undefined, id: string): string | undefined =>
  runs?.[id]?.status === 'error' ? runs[id]?.error : undefined;

export function DemoCanvas({
  projectId,
  nodes,
  connectors,
  selectedNodeIds,
  selectedConnectorIds,
  onSelectionChange,
  runs,
  statusByNode,
  onPlayNode,
  nodeOverrides,
  connectorOverrides,
  onNodePositionChange,
  onNodePositionsChange,
  onNodeResize,
  onMultiResize,
  onNodeNameChange,
  onNodeDescriptionChange,
  onConnectorLabelChange,
  onCreateShapeNode,
  onCreateImageFromFile,
  onRetryImageUpload,
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
  onToggleNodeLock,
  activeShape,
  onSelectShape,
}: DemoCanvasProps) {
  // Bottom-toolbar draw mode (US-028). When `drawShape` is set, the wrapper
  // shows a crosshair cursor and a pointer-down on the React Flow pane begins
  // an Excalidraw-style drag. We track the start + current pointer position in
  // CLIENT coordinates and only convert to flow coordinates at commit time
  // (mouse-up); the ghost preview overlay renders relative to the wrapper's
  // bounding rect, so it stays accurate even if the canvas pans during the
  // gesture (the underlying flow conversion handles the transform).
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  // US-006: handle to the React Flow store (registered by <StoreApiBridge>).
  // Used to call `cancelConnection` when ESC cancels an in-flight connection.
  const storeApiRef = useRef<StoreApi | null>(null);
  // US-003: draw-mode state is owned by the parent (demo-view.tsx) so the
  // page-level keyboard handler and command palette can drive tool switches.
  // We alias the props inside this file to preserve the existing `drawShape` /
  // `setDrawShape` naming used throughout — minimal diff against the prior
  // local `useState` implementation.
  const drawShape = activeShape;
  const setDrawShape = onSelectShape;
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
  // so the detail panel's "Change icon…" button (US-015) and the iconNode
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
    const onMove = (e: globalThis.PointerEvent) => {
      // Buffer-aware: a node within RECONNECT_BUFFER_PX of the cursor
      // counts as the candidate target, mirroring the snap behavior of
      // the connection line. Direct-hit cursor-over-node still wins (the
      // buffered helper falls back to nearest-in-buffer only when no
      // node is directly under the cursor).
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
    document.addEventListener('pointermove', onMove);
    return () => {
      document.removeEventListener('pointermove', onMove);
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
  const drawShapeRef = useRef<ShapeKind | null>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const drawCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const drawingRef = useRef(false);

  // Mirror drawShape state into a ref so handlers see the live value without
  // depending on closure identity (handler refs need to stay stable so React
  // event delegation keeps working across renders mid-gesture).
  useEffect(() => {
    drawShapeRef.current = drawShape;
  }, [drawShape]);

  const exitDrawMode = useCallback(() => {
    setDrawShape(null);
    setDrawStart(null);
    setDrawCurrent(null);
    drawShapeRef.current = null;
    drawStartRef.current = null;
    drawCurrentRef.current = null;
    drawingRef.current = false;
  }, [setDrawShape]);

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
  //   4. Selection — clear node + connector selections.
  //
  // (Marquee cancellation was removed in US-022 — the marquee gesture is no
  //  longer wired; primary-mouse drag on empty canvas is a no-op.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 1. Inline label edit — defer to InlineEdit's own handler.
      if (isEditableTarget(document.activeElement)) return;
      // 2. Drag-create.
      if (drawShapeRef.current) {
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
  }, [exitDrawMode]);

  // US-022: Cmd/Ctrl + C / Cmd/Ctrl + V — copy/paste the current selection.
  // Mirrors the US-017 pattern: pure helper drives the dispatch, the listener
  // body is a thin shim. Delegates to `onCopySelection` / `onPasteSelection`
  // (the same paths the right-click menu's Copy / Paste items use, modulo the
  // multi-id signature for keyboard copy), so undo plumbing + single-undo-step
  // + edge filtering come for free from the parent's existing implementation.
  useEffect(() => {
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
  }, [selectedNodeIds, hasClipboard, onCopySelection, onPasteSelection]);

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!drawShapeRef.current) return;
    const target = e.target as HTMLElement | null;
    if (!target?.classList.contains('react-flow__pane')) return;
    const client = { x: e.clientX, y: e.clientY };
    drawingRef.current = true;
    drawStartRef.current = client;
    drawCurrentRef.current = client;
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
    if (!drawingRef.current) return;
    const client = { x: e.clientX, y: e.clientY };
    drawCurrentRef.current = client;
    setDrawCurrent(client);
  }, []);

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
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
      const rfInstance = rfInstanceRef.current;
      // Always exit draw mode after a gesture, even if the commit short-circuits
      // (too small, missing references). The PRD spec: "After commit (or ESC),
      // draw mode exits automatically and the cursor returns to default."
      exitDrawMode();
      if (!start || !current || !shape || !rfInstance) return;
      const minX = Math.min(start.x, current.x);
      const minY = Math.min(start.y, current.y);
      const maxX = Math.max(start.x, current.x);
      const maxY = Math.max(start.y, current.y);
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
    [exitDrawMode, onCreateShapeNode],
  );
  // Block upstream sync while a node is mid-drag or mid-resize. NodeResizer
  // dispatches dimension changes into rfNodes during the gesture; if we then
  // overwrite rfNodes with sourceNodes (from server, which still has the old
  // dimensions until the PATCH echoes back), the node snaps back. The
  // resizingRef is set/cleared by node components via data.setResizing.
  const draggingRef = useRef(false);
  const resizingRef = useRef(false);
  const setResizing = useCallback((on: boolean) => {
    resizingRef.current = on;
  }, []);

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
    !!onReorderNode || !!onDeleteNode || !!onCopyNode || !!onPasteAt || !!onUnpinEndpoint;
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  // Whether the most recent right-click landed on a node (true) vs. the empty
  // pane (false). Used to gate per-node items (Copy / reorder / Delete) which
  // don't make sense for an empty-canvas right-click. State (not just a ref)
  // because the menu's children are read on render — and the menu re-renders
  // when contextMenuPos changes, so this stays in sync via the same setState
  // pair below.
  const [contextOnNode, setContextOnNode] = useState(false);
  // US-003: track the right-clicked node's type so icon-node-specific items
  // (currently just 'Change icon') render only when the cursor landed on an
  // iconNode. Cleared whenever the menu closes or the right-click hit the pane.
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

  // US-019: flip the lock state from the right-click menu. Single-node
  // right-click acts on the right-clicked id; multi-selection right-click
  // (contextNodeIdRef cleared by `onWrapperContextMenuCapture`) acts on the
  // whole selection — same as the old Cmd/Ctrl+Shift+L shortcut used to.
  const handleToggleLockPick = useCallback(() => {
    if (!onToggleNodeLock) return;
    const single = contextNodeIdRef.current;
    const ids = single ? [single] : [...selectedNodeIds];
    if (ids.length === 0) return;
    onToggleNodeLock(ids);
  }, [onToggleNodeLock, selectedNodeIds]);

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

  // Show ⌘ on macOS, Ctrl elsewhere. Read once per render (cheap) — Radix
  // re-mounts the menu on every open so the value is captured at the right
  // moment. navigator may be undefined in non-browser contexts (SSR), but
  // this component is purely client-side so the access is safe.
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
  const copyShortcut = isMac ? '⌘C' : 'Ctrl+C';
  const pasteShortcut = isMac ? '⌘V' : 'Ctrl+V';

  // Set lookups for the controlled selection. React Flow's internal selection
  // is mirrored back via onSelectionChange so the parent's arrays remain the
  // source of truth — sourceNodes/rfEdges are recomputed off these sets.
  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  // US-013: how many of the currently-selected nodes are groups (eligible
  // US-019: lock-aware predicates the right-click menu consumes. A single
  // node right-click checks the right-clicked id; a multi-selection
  // right-click checks every selected id and switches the menu label:
  // "Lock" when ANY is unlocked, "Unlock" only when ALL are locked.
  const lockedNodeIdSet = useMemo(() => {
    const s = new Set<string>();
    for (const n of nodes) {
      if ((n.data as { locked?: boolean }).locked === true) s.add(n.id);
    }
    return s;
  }, [nodes]);
  const selectedConnectorIdSet = useMemo(
    () => new Set(selectedConnectorIds),
    [selectedConnectorIds],
  );

  // US-007: payload for the multi-select bounding-box resize overlay. Reduces
  // the canvas's `nodes` prop down to the minimum shape `<SelectionResizeOverlay>`
  // needs (id + position + parentId + width/height/locked) and applies any
  // optimistic position/data overrides so the overlay rect tracks the live
  // canvas, not the server snapshot. The overlay decides presence internally
  // (≥ 2 selected AND not all sharing a single parent) so we pass through
  // unconditionally — empty / ineligible selections render nothing.
  const selectionOverlayNodes = useMemo<OverlayInputNode[]>(() => {
    if (selectedNodeIds.length < 2) return [];
    const overrides = nodeOverrides;
    const overlayInputs: OverlayInputNode[] = [];
    for (const id of selectedNodeIds) {
      const base = nodes.find((n) => n.id === id);
      if (!base) continue;
      const override = overrides?.[id];
      const oData = (override?.data ?? {}) as {
        width?: number;
        height?: number;
        locked?: boolean;
      };
      const bData = base.data as { width?: number; height?: number; locked?: boolean };
      overlayInputs.push({
        id,
        position: override?.position ?? base.position,
        data: {
          width: oData.width ?? bData.width,
          height: oData.height ?? bData.height,
          locked: oData.locked ?? bData.locked,
        },
      });
    }
    return overlayInputs;
  }, [nodes, nodeOverrides, selectedNodeIds]);

  const selectedNodesForStyleStrip = selectedNodes ?? [];

  const sourceNodes = useMemo<Node[]>(() => {
    const buildNode = (merged: DemoNode): Node => {
      const node: Node = {
        id: merged.id,
        type: merged.type,
        position: merged.position,
        data: {
          ...merged.data,
          // US-004: file-backed renderers (imageNode, future htmlNode) read
          // `projectId` to construct project-scoped file URLs.
          projectId,
          // US-008: imageNode placeholder uses this callback when the user
          // clicks the 'Upload failed (click to retry)' state. Injected here so
          // every imageNode picks it up uniformly; non-imageNodes ignore it.
          onRetryUpload: onRetryImageUpload,
          status: dataStatusFor(runs, merged.id),
          errorMessage: dataErrorMessageFor(runs, merged.id),
          // US-007: latest StatusReport for this node (if any). play-node /
          // state-node read this to render their badge row. Undefined → row
          // is suppressed and the node renders byte-identical to legacy.
          statusReport: statusByNode?.[merged.id],
          onPlay: onPlayNode,
          onResize: onNodeResize,
          setResizing,
          onNameChange: (() => {
            // Ellipse drops the Name concept entirely — its centered label
            // renders `description`, and the detail panel hides the Name
            // field. Suppressing the callback also makes
            // `data.onNameChange === undefined`, which the shape-node uses to
            // skip the dblclick-to-edit-name path.
            if (merged.type === 'shapeNode') {
              const shapeKind = (merged.data as { shape?: ShapeKind }).shape;
              if (shapeKind === 'ellipse') return undefined;
            }
            return onNodeNameChange;
          })(),
          onDescriptionChange: (() => {
            // Rectangle, ellipse, and sticky shapes render a description body — wire
            // the canvas-side inline edit so dblclick on the body lands an
            // edit. Other shape kinds (text/database) and imageNode /
            // iconNode have no on-canvas body text, so the inline-edit
            // callback stays undefined.
            if (merged.type === 'shapeNode') {
              const shapeKind = (merged.data as { shape?: ShapeKind }).shape;
              return shapeKind === 'rectangle' || shapeKind === 'ellipse' || shapeKind === 'sticky'
                ? onNodeDescriptionChange
                : undefined;
            }
            if (merged.type === 'imageNode' || merged.type === 'iconNode') return undefined;
            return onNodeDescriptionChange;
          })(),
          // US-015: inject autoEditOnMount on the freshly drop-popover-created
          // node so it opens in label-edit mode. The flag is consumed once at
          // mount by the node component (lazy useState initializer); leaving
          // it set on later renders is harmless.
          autoEditOnMount: pendingEditNodeId === merged.id ? true : undefined,
        },
        selected: selectedNodeIdSet.has(merged.id),
      };
      // Pass explicit width/height to the React Flow node wrapper when set
      // in data. NodeResizer dispatches dimension changes that update these
      // during a gesture; we only persist (and hence sync them back into
      // data) on resize-stop.
      if (merged.data.width !== undefined) node.width = merged.data.width;
      if (merged.data.height !== undefined) node.height = merged.data.height;
      // US-025: only the selected node may originate a new connection. Setting
      // `connectable: false` on unselected nodes makes their Handles ignore
      // connection-start gestures (xyflow's per-node `connectable` overrides
      // the global `nodesConnectable`). Selected nodes leave the field
      // undefined so the global gate (read-only mode, drawShape) still
      // applies. Reconnect drops onto unselected nodes are unaffected —
      // xyflow's reconnect path snaps via the always-present `.source`/
      // `.target` DOM classes, not the Handle's `isConnectable` prop.
      if (!selectedNodeIdSet.has(merged.id)) node.connectable = false;
      // US-019: locked nodes cannot be dragged. xyflow's per-node
      // `draggable: false` overrides the global `nodesDraggable` so the
      // node body (and any group children) ignore pointer-down → drag
      // gestures. Selection, right-click, and hover affordances keep
      // working — only the drag is gated.
      if ((merged.data as { locked?: boolean }).locked === true) node.draggable = false;
      return node;
    };
    const fromServer = nodes.map((n) => buildNode(mergeNodeOverride(n, nodeOverrides?.[n.id])));
    // Override-only entries represent optimistic/pending creations (US-007):
    // a shape node has been drawn locally and the override carries a full
    // DemoNode whose id is not yet on the server. Once the SSE echo of the
    // POST resolves, the entry shows up in `nodes` and `pruneAgainst` drops
    // the override (per US-021) — until then we render the candidate so the
    // node appears at the dragged size with no flicker from default→dragged.
    const serverIds = new Set(nodes.map((n) => n.id));
    const fromOverrides: Node[] = [];
    if (nodeOverrides) {
      for (const [id, partial] of Object.entries(nodeOverrides)) {
        if (serverIds.has(id)) continue;
        const cand = partial as Partial<DemoNode>;
        if (typeof cand.type !== 'string' || !cand.position || !cand.data) continue;
        fromOverrides.push(buildNode({ ...cand, id } as DemoNode));
      }
    }
    return [...fromServer, ...fromOverrides];
  }, [
    projectId,
    nodes,
    selectedNodeIdSet,
    runs,
    statusByNode,
    onPlayNode,
    onNodeResize,
    setResizing,
    nodeOverrides,
    onNodeNameChange,
    onNodeDescriptionChange,
    onRetryImageUpload,
    pendingEditNodeId,
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

  const onNodesChange = useCallback((changes: NodeChange[]) => {
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
    const pinned = selectedIdSetRef.current;
    // Resize/dimension changes can transiently drop the `selected` flag —
    // restore it for nodes in `pinned` that the user didn't explicitly toggle
    // (US-019). US-010: skip the repin logic during a marquee gesture —
    // `pinned` reflects the parent's (stale) controlled selection prop, but
    // the marquee is actively changing selection; re-pinning previously-
    // selected nodes would fight the user's new marquee selection.
    const repinned = marqueeActiveRef.current
      ? next
      : pinned.size === 0
        ? next
        : next.map((n) => {
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
      const acceptImage = hasFiles && !!onCreateImageFromFile;
      const acceptHtmlBlock = hasHtmlBlock && !!onCreateHtmlNode;
      if (!acceptImage && !acceptHtmlBlock) return;
      e.preventDefault();
      try {
        dt.dropEffect = 'copy';
      } catch {
        // Safari can throw if dropEffect is set when DataTransfer is
        // read-only mid-dispatch — ignore; the preventDefault is what counts.
      }
    },
    [onCreateImageFromFile, onCreateHtmlNode],
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
      if (isHtmlBlockDrop && onCreateHtmlNode) {
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
      if (!onCreateImageFromFile) return;
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
    [onCreateImageFromFile, onCreateHtmlNode],
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
          onLabelChange: onConnectorLabelChange,
          reconnectable: enableReconnect,
          // US-018: stable callback (useCallback with empty deps) so the
          // memoized edge cache key doesn't churn.
          registerEditHandle,
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
        if (
          typeof candidate.source !== 'string' ||
          typeof candidate.target !== 'string' ||
          typeof candidate.kind !== 'string'
        ) {
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
  ]);

  // Mirror rfEdges into a ref so onEdgesChange (declared earlier) reads the
  // latest value without recreating the callback on every render.
  useEffect(() => {
    rfEdgesRef.current = rfEdges;
  }, [rfEdges]);

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
    [onCreateConnector],
  );

  // US-004: text-shape nodes (data.shape === 'text') are pure annotations and
  // must never be a connection endpoint. xyflow already prevents drag-start
  // from a text node — US-003 removed every <Handle> on the text variant —
  // but `isValidConnection` is the defensive net for any path that bypasses
  // the no-handles invariant: a malformed seeflow.json that seeded an edge into
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
  // sees the fresh node and rejects-or-accepts based on its real
  // data.shape, not on a (stale) "id not found → fall through to valid"
  // path that would let a fresh TEXT node bypass the gate.
  const isValidConnection = useCallback((conn: Connection | Edge) => {
    const isTextShape = (id: string | null | undefined): boolean => {
      if (!id) return false;
      const node = rfNodesRef.current.find((n) => n.id === id);
      if (!node) return false;
      return node.type === 'shapeNode' && (node.data as { shape?: ShapeKind }).shape === 'text';
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
            targetPin = projectCursorToPerimeter(
              {
                x: targetNode.internals.positionAbsolute.x,
                y: targetNode.internals.positionAbsolute.y,
                w,
                h,
              },
              flow,
            );
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
      const pin = projectCursorToPerimeter(
        {
          x: projectNode.internals.positionAbsolute.x,
          y: projectNode.internals.positionAbsolute.y,
          w,
          h,
        },
        flow,
      );
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
    const minX = Math.min(drawStart.x, drawCurrent.x);
    const minY = Math.min(drawStart.y, drawCurrent.y);
    const w = Math.abs(drawCurrent.x - drawStart.x);
    const h = Math.abs(drawCurrent.y - drawStart.y);
    // Coords are stored in client space; subtract the wrapper offset to paint
    // the ghost via absolute positioning inside the wrapper.
    return { left: minX - offsetX, top: minY - offsetY, width: w, height: h };
  }, [drawStart, drawCurrent]);

  // US-009: WYSIWYG ghost — mirror the committed shape's chrome via the same
  // helpers `ShapeNode` uses so background/border/radius/tilt match exactly.
  // Approach: reuse the node's style module (shapeChromeClass/shapeChromeStyle
  // from shape-node.tsx) with no `data` so we get the exact default look the
  // drag-create flow commits via `onCreateShapeNode` (which sends only
  // `{ shape, width, height }`). Text is intentionally chromeless on commit;
  // we add a faint dashed outline ONLY for the ghost so the user can see
  // what they're drawing — the placed text node still has no chrome.
  const ghostShapeClass = drawShape ? shapeChromeClass(drawShape) : '';
  const ghostShapeStyle = drawShape ? shapeChromeStyle(drawShape) : undefined;
  const ghostTextOutline = drawShape === 'text';

  // Space-held pan mode (US-019). React Flow's panActivationKeyCode='Space'
  // toggles the pane into pan-on-drag mode for the duration of the keypress;
  // we mirror that into local state purely so the wrapper can show a
  // grab/grabbing cursor (the rest of the behavior is owned by React Flow).
  // Suppress the keydown when focus is in an editable element so InlineEdit's
  // own space input still types a literal space.
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);
  useEffect(() => {
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
  }, []);

  // Multi-node drag-stop: React Flow passes the full set of nodes that moved
  // (the active drag plus every other selected node, since selected items
  // drag together). US-013: when more than one node moved, route the whole
  // batch through `onNodePositionsChange` so the parent commits a single
  // undo entry; one Cmd+Z reverts every node back to its pre-drag position.
  // Single-node drags still flow through `onNodePositionChange` to preserve
  // the per-id coalesce key (collapses repeated drags of the same node).
  const commitDraggedNodes = useCallback(
    (draggedNodes: Node[]) => {
      if (draggedNodes.length === 0) return;
      if (draggedNodes.length === 1) {
        const moved = draggedNodes[0];
        if (moved && onNodePositionChange) {
          onNodePositionChange(moved.id, { x: moved.position.x, y: moved.position.y });
        }
        return;
      }
      if (onNodePositionsChange) {
        onNodePositionsChange(
          draggedNodes.map((n) => ({ id: n.id, position: { x: n.position.x, y: n.position.y } })),
        );
        return;
      }
      // Fallback: parent didn't wire the batch path → emit per-node calls so
      // the legacy behavior (N undo entries) still works.
      if (!onNodePositionChange) return;
      for (const moved of draggedNodes) {
        onNodePositionChange(moved.id, { x: moved.position.x, y: moved.position.y });
      }
    },
    [onNodePositionChange, onNodePositionsChange],
  );

  const onNodeDragStopCb = useCallback(
    (_e: unknown, _node: Node, draggedNodes: Node[]) => {
      draggingRef.current = false;
      commitDraggedNodes(draggedNodes);
    },
    [commitDraggedNodes],
  );

  const onSelectionDragStartCb = useCallback(() => {
    draggingRef.current = true;
  }, []);
  const onSelectionDragStopCb = useCallback(
    (_e: unknown, draggedNodes: Node[]) => {
      draggingRef.current = false;
      commitDraggedNodes(draggedNodes);
    },
    [commitDraggedNodes],
  );

  const handleNodeClickWithGroupGate = useCallback(
    (_e: ReactMouseEvent, node: Node) => {
      onNodeClick?.(node.id);
    },
    [onNodeClick],
  );
  const handlePaneClickWithGroupExit = useCallback(
    (e: ReactMouseEvent) => {
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

  // Cursor for the wrapper. Draw mode → crosshair (own gesture). Space-held →
  // grab while idle, grabbing while a Space-pan drag is in flight. Else
  // default arrow — US-010 made primary-mouse drag a marquee gesture, but the
  // default cursor is the design-tool norm for the rubber-band so we don't
  // override it.
  const wrapperCursor = drawShape
    ? 'crosshair'
    : spaceHeld
      ? spaceDragging
        ? 'grabbing'
        : 'grab'
      : undefined;

  return (
    <div
      data-testid="seeflow-canvas"
      ref={wrapperRef}
      className="relative h-full w-full"
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
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        proOptions={{ hideAttribution: true }}
        fitView
        nodesDraggable={!!onNodePositionChange && !drawShape}
        nodesConnectable={!!onCreateConnector && !drawShape}
        className={connecting ? 'seeflow-connecting' : undefined}
        onConnect={onConnect}
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
        onReconnect={onReconnectConnector ? onReconnect : undefined}
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
        elementsSelectable={!drawShape}
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
        selectionOnDrag={!drawShape}
        panOnDrag={drawShape ? false : [1, 2]}
        selectionMode={SelectionMode.Partial}
        selectionKeyCode={null}
        multiSelectionKeyCode={drawShape ? null : ['Meta', 'Shift']}
        panActivationKeyCode={drawShape ? null : 'Space'}
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
          onRfInit?.(instance);
        }}
        onMove={(_e, viewport) => {
          // US-015: panning or zooming the canvas dismisses the drop-popover —
          // the anchor's flow-space coordinates would otherwise drift away
          // from the viewport translation. Read from the ref to avoid
          // re-binding on every popover open/close (onMove fires every frame
          // while the user pans/zooms).
          if (dropPopoverRef.current) setDropPopover(null);
          // Mirror the viewport zoom to a CSS variable so the selection
          // outline can scale its width/offset inversely (calc(1px /
          // var(--rf-zoom))) — the outline keeps the same VISUAL thickness
          // regardless of zoom level. Setting via inline style avoids a
          // React re-render every frame of pan/zoom.
          const wrapper = wrapperRef.current;
          if (wrapper) wrapper.style.setProperty('--rf-zoom', String(viewport.zoom));
        }}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={() => {
          draggingRef.current = true;
        }}
        onNodeDragStop={onNodeDragStopCb}
        onSelectionDragStart={onSelectionDragStartCb}
        onSelectionDragStop={onSelectionDragStopCb}
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
        onEdgeDoubleClick={(_e, edge) => {
          editHandlesRef.current.get(edge.id)?.();
        }}
        onPaneClick={handlePaneClickWithGroupExit}
        onNodeContextMenu={
          contextEnabled
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
          onPasteAt
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
        {/* US-020: bottom-left canvas-view cluster. xyflow's default Fit View
            is hidden so we can render a Lucide-styled button that calls
            fitView with the documented options (padding 0.15, duration 300).
            Auto Align (Tidy) moved here from CanvasToolbar so all canvas-view
            actions live in the same place. Order: zoom-in, zoom-out (from
            <Controls>), Fit View, Auto Align. */}
        <Controls showInteractive={false} showFitView={false}>
          <ControlButton
            data-testid="controls-fit-view"
            aria-label="Fit view"
            title="Fit view"
            disabled={nodes.length === 0}
            onClick={() => {
              rfInstanceRef.current?.fitView({
                padding: 0.15,
                duration: 300,
                includeHiddenNodes: false,
              });
            }}
          >
            <Maximize2 className="h-3 w-3" aria-hidden="true" />
          </ControlButton>
          <ControlButton
            data-testid="controls-tidy"
            aria-label="Tidy layout (⌘⇧L)"
            title="Tidy layout (⌘⇧L)"
            disabled={!onTidy}
            onClick={() => onTidy?.()}
          >
            <LayoutDashboard className="h-3 w-3" aria-hidden="true" />
          </ControlButton>
        </Controls>
        {/* US-007: multi-select bounding-box resize overlay. Renders only when
            ≥ 2 selected nodes are NOT all children of the same group; the
            internal check is in `<SelectionResizeOverlay>`. We pass through
            unconditionally — empty / ineligible selections render nothing. */}
        <SelectionResizeOverlay
          selectedNodes={selectionOverlayNodes}
          onMultiResize={onMultiResize}
        />
        {onCreateShapeNode || onStyleNode || onStyleConnector ? (
          <Panel position="top-left">
            <div className="flex flex-col gap-2">
              {onCreateShapeNode ? (
                <CanvasToolbar
                  activeShape={drawShape}
                  onSelectShape={setDrawShape}
                  iconPickerOpen={iconPickerOpen ?? false}
                  onOpenIconPicker={onOpenIconPicker}
                  onCloseIconPicker={onCloseIconPicker}
                  onPickIcon={onPickIcon}
                />
              ) : null}
              {onStyleNode && onStyleConnector ? (
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
      </ReactFlow>
      {ghostRect ? (
        <div
          data-testid="canvas-draw-ghost"
          data-ghost-shape={drawShape ?? undefined}
          aria-hidden
          className={cn(
            'pointer-events-none absolute z-10',
            ghostShapeClass,
            ghostTextOutline ? 'rounded-sm border border-dashed border-muted-foreground/40' : '',
          )}
          style={{
            ...ghostShapeStyle,
            left: ghostRect.left,
            top: ghostRect.top,
            width: ghostRect.width,
            height: ghostRect.height,
          }}
        >
          {/* US-010: illustrative shapes have no wrapper chrome — the SVG owns
              the visuals. Render the per-shape SVG directly inside the ghost
              so the drag preview matches the committed visual byte-for-byte.
              The committed node (ShapeNodeImpl) calls `resolveIllustrativeColors`
              on its `data` to fill defaults; the ghost has no `data`, so we
              inline the same default resolution here: `borderColor` →
              `colorTokenStyle(undefined, 'node').borderColor` (theme-aware
              border via `hsl(var(--border))`), `backgroundColor` →
              `NODE_DEFAULT_BG_WHITE` (US-021 dark card surface fallback).
              US-022: dispatch through `ILLUSTRATIVE_SHAPE_RENDERERS` so adding
              a new illustrative shape only touches the registry. */}
          {(() => {
            const GhostRenderer = drawShape ? ILLUSTRATIVE_SHAPE_RENDERERS[drawShape] : undefined;
            if (!GhostRenderer) return null;
            return (
              <GhostRenderer
                width={ghostRect.width}
                height={ghostRect.height}
                borderColor={colorTokenStyle(undefined, 'node').borderColor}
                backgroundColor={NODE_DEFAULT_BG_WHITE}
                borderSize={NEW_NODE_BORDER_WIDTH}
              />
            );
          })()}
        </div>
      ) : null}
      {contextEnabled ? (
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
              className="pointer-events-none fixed"
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
            {contextOnNode && onCopyNode ? (
              <ContextMenuItem data-testid="node-context-menu-copy" onSelect={handleCopyPick}>
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
            ((contextNodeType === 'iconNode' && !!onRequestIconReplace) ||
              onReorderNode ||
              onDeleteNode) ? (
              <ContextMenuSeparator />
            ) : null}
            {contextOnNode && contextNodeType === 'iconNode' && onRequestIconReplace ? (
              <ContextMenuItem
                data-testid="node-context-menu-change-icon"
                onSelect={handleChangeIconPick}
              >
                Change icon
              </ContextMenuItem>
            ) : null}
            {contextOnNode &&
            contextNodeType === 'iconNode' &&
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
            {contextOnNode && onReorderNode && (onToggleNodeLock || onDeleteNode) ? (
              <ContextMenuSeparator />
            ) : null}
            {contextOnNode && onToggleNodeLock
              ? (() => {
                  // Label echoes the keyboard-shortcut's mixed-selection rule
                  // (see onToggleNodeLock JSDoc): "Unlock" only when EVERY
                  // target id is already locked; otherwise "Lock".
                  const single = contextNodeIdRef.current;
                  const targetIds = single ? [single] : selectedNodeIds;
                  const label =
                    targetIds.length > 0 && targetIds.every((id) => lockedNodeIdSet.has(id))
                      ? 'Unlock'
                      : 'Lock';
                  return (
                    <ContextMenuItem
                      data-testid="node-context-menu-toggle-lock"
                      onSelect={handleToggleLockPick}
                      disabled={targetIds.length === 0}
                    >
                      {label}
                    </ContextMenuItem>
                  );
                })()
              : null}
            {contextOnNode && onToggleNodeLock && onDeleteNode ? <ContextMenuSeparator /> : null}
            {contextOnNode && onDeleteNode ? (
              <ContextMenuItem
                data-testid="node-context-menu-delete"
                onSelect={handleDeletePick}
                disabled={
                  contextNodeIdRef.current ? lockedNodeIdSet.has(contextNodeIdRef.current) : false
                }
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
              className="pointer-events-none fixed"
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
            className="w-auto p-1"
            onOpenAutoFocus={(e) => {
              // Don't pull focus into the popover — keep it on the canvas so
              // the wrapper-level ESC handler still receives keypresses.
              e.preventDefault();
            }}
          >
            <div role="menu" aria-label="Create connected node" className="flex flex-col gap-0.5">
              {TOOLBAR_SHAPES.map(({ shape, label, Icon }) => (
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
                    'flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                    'hover:bg-accent hover:text-accent-foreground',
                    'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                  )}
                >
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
