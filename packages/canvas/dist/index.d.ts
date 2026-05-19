import * as react_jsx_runtime from 'react/jsx-runtime';
import * as React from 'react';
import { CSSProperties, FC, SVGProps, ComponentType, ReactNode } from 'react';
import { LucideIcon, LucideProps, Square } from 'lucide-react';
import { ClassValue } from 'clsx';
import { EdgeMarker, NodeProps, Node, OnResizeStart, OnResize, OnResizeEnd, ResizeParams, EdgeProps, Edge, ReactFlowInstance } from '@xyflow/react';
import * as class_variance_authority_types from 'class-variance-authority/types';
import { VariantProps } from 'class-variance-authority';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { DialogProps } from '@radix-ui/react-dialog';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as SliderPrimitive from '@radix-ui/react-slider';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

type NodeStatus = 'idle' | 'running' | 'done' | 'error';
declare function StatusPill({ status, 'data-testid': dataTestId, }: {
    status: NodeStatus;
    'data-testid'?: string;
}): react_jsx_runtime.JSX.Element | null;

type ColorToken = 'default' | 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'pink';
interface NodeVisual {
    width?: number;
    height?: number;
    borderColor?: ColorToken;
    backgroundColor?: ColorToken;
    borderSize?: number;
    borderStyle?: 'solid' | 'dashed' | 'dotted';
    fontSize?: number;
    textColor?: ColorToken;
    cornerRadius?: number;
    locked?: boolean;
}
interface NodeDescription {
    description?: string;
    detail?: string;
}
interface NodeData extends NodeVisual, NodeDescription {
    name: string;
    kind: string;
    stateSource: {
        kind: 'request' | 'event';
    };
    playAction?: HttpAction;
    handlerModule?: string;
    icon?: string;
}
interface HttpAction {
    kind: 'http';
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    body?: unknown;
    bodySchema?: unknown;
}
type ShapeKind = 'rectangle' | 'ellipse' | 'sticky' | 'text' | 'database' | 'server' | 'user' | 'queue' | 'cloud';
interface ShapeNodeData extends NodeVisual, NodeDescription {
    shape: ShapeKind;
    name?: string;
}
interface ImageNodeData extends NodeVisual, NodeDescription {
    path: string;
    alt?: string;
    borderWidth?: number;
}
interface IconNodeData extends NodeDescription {
    icon: string;
    color?: ColorToken;
    strokeWidth?: number;
    width?: number;
    height?: number;
    alt?: string;
    name?: string;
    locked?: boolean;
}
interface HtmlNodeData extends NodeVisual, NodeDescription {
    htmlPath: string;
    name?: string;
    icon?: string;
}
interface NodeBase {
    id: string;
    position: {
        x: number;
        y: number;
    };
}
type DemoNode = (NodeBase & {
    type: 'playNode';
    data: NodeData;
}) | (NodeBase & {
    type: 'stateNode';
    data: NodeData;
}) | (NodeBase & {
    type: 'shapeNode';
    data: ShapeNodeData;
}) | (NodeBase & {
    type: 'imageNode';
    data: ImageNodeData;
}) | (NodeBase & {
    type: 'iconNode';
    data: IconNodeData;
}) | (NodeBase & {
    type: 'htmlNode';
    data: HtmlNodeData;
});
type ConnectorStyle = 'solid' | 'dashed' | 'dotted';
type ConnectorDirection = 'forward' | 'backward' | 'both' | 'none';
type ConnectorPath = 'curve' | 'step';
type EdgePinSide = 'top' | 'right' | 'bottom' | 'left';
interface EdgePin {
    side: EdgePinSide;
    t: number;
}
interface ConnectorBase {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    sourceHandleAutoPicked?: boolean;
    targetHandleAutoPicked?: boolean;
    sourcePin?: EdgePin;
    targetPin?: EdgePin;
    label?: string;
    style?: ConnectorStyle;
    color?: ColorToken;
    direction?: ConnectorDirection;
    borderSize?: number;
    path?: ConnectorPath;
    fontSize?: number;
}
interface HttpConnector extends ConnectorBase {
    kind: 'http';
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url?: string;
}
interface EventConnector extends ConnectorBase {
    kind: 'event';
    eventName: string;
}
interface QueueConnector extends ConnectorBase {
    kind: 'queue';
    queueName: string;
}
interface DefaultConnector extends ConnectorBase {
    kind: 'default';
}
type Connector = HttpConnector | EventConnector | QueueConnector | DefaultConnector;
type StatusReportState = 'ok' | 'warn' | 'error' | 'pending';
interface StatusReport {
    state: StatusReportState;
    summary?: string;
    detail?: string;
    data?: Record<string, unknown>;
    ts?: number;
}
interface RunResult {
    status: NodeStatus;
    runId?: string;
    /** Filled when status === 'done': upstream HTTP status. */
    responseStatus?: number;
    /** Filled when status === 'done': parsed JSON or text body. */
    body?: unknown;
    /** Filled when status === 'error': human-readable message. */
    error?: string;
    /** ms since epoch of the most recent transition. */
    ts?: number;
}
interface Demo {
    version: 1;
    name: string;
    nodes: DemoNode[];
    connectors: Connector[];
}

declare const COLOR_TOKENS: Record<ColorToken, {
    border: string;
    background: string;
    edge: string;
    headerBackground: string;
}>;
declare const NODE_DEFAULT_BG_WHITE = "hsl(var(--card))";
type NodeColorStyle = Pick<CSSProperties, 'borderColor' | 'backgroundColor'>;
type NodeHeaderColorStyle = Pick<CSSProperties, 'backgroundColor'>;
type EdgeColorStyle = Pick<CSSProperties, 'stroke'>;
type TextColorStyle = Pick<CSSProperties, 'color'>;
declare function colorTokenStyle(token: ColorToken | undefined, kind: 'node'): NodeColorStyle;
declare function colorTokenStyle(token: ColorToken | undefined, kind: 'node-header'): NodeHeaderColorStyle;
declare function colorTokenStyle(token: ColorToken | undefined, kind: 'edge'): EdgeColorStyle;
declare function colorTokenStyle(token: ColorToken | undefined, kind: 'text'): TextColorStyle;

declare const ICON_REGISTRY: Record<string, LucideIcon>;
declare const ICON_FALLBACK_NAME = "help-circle";
declare const ICON_NAMES: string[];

type LayoutDirection = 'LR' | 'TB' | 'RL' | 'BT';
interface AutoLayoutNode {
    id: string;
    width: number;
    height: number;
    position: {
        x: number;
        y: number;
    };
}
interface AutoLayoutEdge {
    source: string;
    target: string;
}
interface AutoLayoutOptions {
    direction?: LayoutDirection;
    nodesep?: number;
    ranksep?: number;
}
/**
 * Run dagre against the given nodes + edges and return a Map of new top-left
 * positions, keyed by node id. Single-node graphs short-circuit to the input
 * position so a degenerate selection-tidy is a no-op. dagre returns center
 * coords; we subtract width/2 and height/2 so the result lines up with React
 * Flow's top-left position model.
 */
declare const applyLayout: (nodes: readonly AutoLayoutNode[], edges: readonly AutoLayoutEdge[], opts?: AutoLayoutOptions) => Map<string, {
    x: number;
    y: number;
}>;

/**
 * US-008: OS-image drag-and-drop helpers. Pure functions consumed by the
 * demo-canvas drop handler. The orchestration of upload + optimistic placement
 * + persist + retry lives in `apps/web/src/pages/demo-view.tsx`; this module
 * stays free of API + React dependencies so the helpers are unit-testable
 * without a DOM.
 */
/**
 * Allowed image extensions for OS file drop. Must stay in sync with the
 * server-side `UPLOAD_ALLOWED_EXTS` in `apps/studio/src/api.ts` (US-007).
 */
declare const IMAGE_DROP_EXTS: readonly string[];
/** US-008: cap the LONGEST side of the dropped image at this many flow-units. */
declare const IMAGE_DROP_MAX_LONGEST_SIDE = 400;
/** US-008: SVG without intrinsic dimensions falls back to this square size. */
declare const IMAGE_DROP_SVG_FALLBACK: {
    readonly width: 200;
    readonly height: 200;
};
/**
 * True when the File has an allowed image extension OR an `image/*` MIME type.
 * Mirrors the server-side allowlist; the MIME check is defensive — Safari and
 * Firefox occasionally drop files without `.type` set.
 */
declare const isAcceptableImageFile: (file: File) => boolean;
/**
 * Scan a `DataTransfer.files` list for the first acceptable image file. Returns
 * null when none match (the caller leaves the drop to React Flow's default
 * handlers). Only one image is consumed per drop — multi-file drops keep only
 * the first match.
 */
declare const extractImageFile: (dt: DataTransfer | null) => File | null;
/**
 * Clamp the LONGEST side of `natural` to `max` (default 400px), preserving
 * aspect ratio. Returns integer dimensions so the canvas renders at clean
 * pixel boundaries.
 *
 * SVGs and other formats that report `naturalWidth === 0` (no intrinsic
 * dimensions) get the IMAGE_DROP_SVG_FALLBACK square instead — passes
 * naturalWidth=0 OR naturalHeight=0.
 */
declare const clampImageDims: (natural: {
    width: number;
    height: number;
}, max?: number) => {
    width: number;
    height: number;
};
interface CanvasDropDispatchArgs {
    file: File;
    position: {
        x: number;
        y: number;
    };
    dims: {
        width: number;
        height: number;
    };
    originalFilename: string;
}
interface HandleCanvasFileDropArgs {
    dataTransfer: DataTransfer | null;
    clientPos: {
        x: number;
        y: number;
    };
    rfInstance: {
        screenToFlowPosition: (p: {
            x: number;
            y: number;
        }) => {
            x: number;
            y: number;
        };
    } | null;
    computeDims: (file: File) => Promise<{
        width: number;
        height: number;
    }>;
    dispatch: (args: CanvasDropDispatchArgs) => void;
}
/**
 * Compose the OS-image drop flow from its primitives so the demo-canvas drop
 * handler stays a thin wiring layer over a unit-testable async pipeline.
 * Returns `false` when nothing was dispatched (no file, no rfInstance, etc.)
 * so the caller can decide whether to preventDefault. Promise resolves once
 * `dispatch` has been called (or short-circuited).
 *
 * Centers the drop on the cursor by subtracting half the computed dims from
 * the flow-space drop origin — the cursor lands inside the node body rather
 * than at its top-left.
 */
declare const handleCanvasFileDrop: (args: HandleCanvasFileDropArgs) => Promise<boolean>;
/**
 * Resolves with the file's intrinsic dimensions (capped via `clampImageDims`)
 * by loading it through an in-memory Image element backed by a Blob URL.
 * Returns the SVG fallback square when the image fails to decode (broken
 * payload, or SVG without intrinsic size).
 *
 * The Blob URL is revoked in `finally` so we don't leak object URLs across
 * many drops.
 */
declare const computeImageDims: (file: File) => Promise<{
    width: number;
    height: number;
}>;

declare function cn(...inputs: ClassValue[]): string;

interface DerivedEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    type: 'editableEdge';
    label?: string;
    animated: boolean;
    data: {
        kind: Connector['kind'];
        path?: ConnectorPath;
        sourceHandleAutoPicked?: boolean;
        targetHandleAutoPicked?: boolean;
        sourcePin?: EdgePin;
        targetPin?: EdgePin;
        /** US-018: per-connector label font size in px (undefined → 11px). */
        fontSize?: number;
    };
    style: {
        strokeDasharray?: string;
        stroke?: string;
        strokeWidth?: number;
        opacity?: number;
    };
    markerStart?: EdgeMarker;
    markerEnd?: EdgeMarker;
    selected?: boolean;
    interactionWidth?: number;
}
declare const styleForKind: (kind: Connector["kind"]) => {
    strokeDasharray?: string;
};
declare const connectorToEdge: (connector: Connector, isAdjacentToRunning: boolean, selected?: boolean) => DerivedEdge;

/**
 * Tiny trailing-edge debouncer. Calling `schedule(fn)` arms a timer; further
 * calls within the window replace the pending callback. `flush()` runs the
 * pending callback synchronously; `cancel()` drops it without running. Uses
 * injectable scheduling primitives so tests can drive it with fake timers
 * without monkey-patching globals.
 */
interface Debouncer {
    /** Arm or rearm the trailing-edge timer with the latest callback. */
    schedule: (run: () => void) => void;
    /** Run the pending callback immediately (no-op if none pending). */
    flush: () => void;
    /** Drop the pending callback without running it. */
    cancel: () => void;
    /** True while a callback is pending. */
    readonly pending: boolean;
}
interface DebouncerOptions {
    /** Defaults to globalThis.setTimeout. */
    setTimer?: (fn: () => void, ms: number) => unknown;
    /** Defaults to globalThis.clearTimeout. */
    clearTimer?: (handle: unknown) => void;
}
declare const createDebouncer: (delayMs: number, options?: DebouncerOptions) => Debouncer;

declare const DETAIL_PANEL_WIDTH_KEY = "seeflow:detail-panel-width";
declare const DETAIL_PANEL_WIDTH_DEFAULT = 380;
declare const DETAIL_PANEL_WIDTH_MIN = 320;
declare const DETAIL_PANEL_WIDTH_MAX = 800;
declare function clampDetailPanelWidth(value: number): number;
declare function getStoredDetailPanelWidth(): number;
declare function setStoredDetailPanelWidth(width: number): void;
interface ResizeGestureCallbacks {
    onWidth: (next: number) => void;
    onCommit: (final: number) => void;
}
interface ResizeGestureTarget {
    addEventListener: (event: string, cb: (e: {
        clientX: number;
    }) => void) => void;
    removeEventListener: (event: string, cb: (e: {
        clientX: number;
    }) => void) => void;
}
/**
 * Start a left-edge horizontal resize gesture. The panel sits on the right, so
 * dragging the handle LEFT widens it. Attaches pointermove/pointerup/cancel
 * listeners to `target` (defaults to `window`); on pointerup it removes the
 * listeners and calls `onCommit` with the final clamped width. The `target`
 * seam is for tests — production passes `window`.
 */
declare function startResizeGesture(startWidth: number, startClientX: number, callbacks: ResizeGestureCallbacks, target?: ResizeGestureTarget): void;

declare function fileUrl(projectId: string, path: string): string;

/**
 * Floating-edge geometry — given a source rectangle and the center of the
 * other endpoint's node, compute where a straight ray from the source center
 * to the other center crosses the source rectangle's perimeter, and which
 * side of the rectangle that crossing lies on.
 *
 * Used by `editable-edge.tsx` (US-025) to render an edge endpoint that
 * floats against the line-through-centers — the endpoint slides along the
 * node's perimeter in real time as either node moves, eliminating the
 * wrap-around artifacts the old facing-handle picker produced.
 */
type Side = 'top' | 'right' | 'bottom' | 'left';
interface FloatingRect {
    /** Top-left x of the node's bounding box. */
    x: number;
    /** Top-left y of the node's bounding box. */
    y: number;
    /** Width of the node's bounding box. */
    w: number;
    /** Height of the node's bounding box. */
    h: number;
}
interface XY {
    x: number;
    y: number;
}
/** A coordinate + side, ready to feed React Flow's path helpers. */
interface Endpoint {
    x: number;
    y: number;
    side: Side;
}
/**
 * Compute the perimeter intersection of the line from `rect`'s center toward
 * `otherCenter`, plus the side of the rectangle that contains the
 * intersection.
 *
 * Math: scale (dx, dy) by `min(halfW/|dx|, halfH/|dy|)` and add to the source
 * center. Side is decided by `|dx|*halfH` vs `|dy|*halfW`: when the
 * horizontal magnitude dominates the rectangle's aspect, the ray exits
 * left/right; otherwise top/bottom. A 45° tie (the two products equal) goes
 * to the x-axis so the result is deterministic and the side flips with the
 * sign of dx.
 *
 * Degenerate cases:
 * - same center (dx === 0 && dy === 0) → returns the rect's center with
 *   `side: 'right'` so callers never see NaN/Infinity.
 * - dx === 0 (purely vertical) → halfW/|dx| is Infinity, so the min picks
 *   halfH/|dy|; the intersection lies on top or bottom.
 * - dy === 0 (purely horizontal) → mirror of the above.
 */
declare const getNodeIntersection: (rect: FloatingRect, otherCenter: XY) => Endpoint;
/**
 * US-006: a pinned perimeter position. `t` is parameterized along `side`,
 * clamped to [0, 1]. Mirrors `EdgePinSchema` (apps/studio/src/schema.ts) and
 * `EdgePin` (apps/web/src/lib/api.ts).
 */
interface Pin {
    side: Side;
    t: number;
}
/**
 * Per-endpoint resolution input: the node's bounding box plus the
 * `autoPicked` flag and (optionally) an explicit `pin` for that side. `null`
 * means the live node geometry isn't available yet (e.g. the node hasn't
 * been measured) — the caller should hand back the React-Flow-supplied
 * fallback in that case.
 */
interface EndpointInput {
    box: FloatingRect;
    autoPicked: boolean | undefined;
    /**
     * US-006: when set, the endpoint is computed from `(side, t)` against
     * `box` and overrides both floating and `autoPicked === false`. Survives
     * node translation and resize because the position is parameterized.
     */
    pin?: Pin;
    /** React-Flow-supplied coords/side, used when the endpoint is pinned. */
    fallback: Endpoint;
}
/**
 * US-007: project a cursor point onto the nearest side of a node's bbox and
 * return the corresponding `(side, t)` pin. Used by the pin-drag UI: as the
 * user drags an endpoint dot, the cursor is mapped to the closest perimeter
 * point each frame so the endpoint clamps along the perimeter without
 * detaching off-node.
 *
 * Algorithm: clamp the cursor into the rect to get `(relX, relY)` in
 * `[0, w] × [0, h]`, then the four side-distances (`relX`, `w - relX`,
 * `relY`, `h - relY`) tell us which side the projection lies on. Tie-break
 * order is left → right → top → bottom so corner ties are deterministic.
 *
 * Edge cases: a zero-width rect collapses left/right to t=0 (avoids
 * NaN from division by zero); a zero-height rect collapses top/bottom the
 * same way. A degenerate 0×0 rect returns `{ side: 'left', t: 0 }`.
 *
 * Pure — used by both the live drag preview and the persistence path.
 */
declare const projectCursorToPerimeter: (rect: FloatingRect, cursor: XY) => Pin;
/**
 * Compute a perimeter point from a pin against a node's bbox. `t` is
 * clamped into [0, 1] so out-of-range values (e.g. from a future schema
 * widening) never produce off-perimeter coordinates.
 *
 * Top/bottom sides: `t` goes left → right.
 * Left/right sides: `t` goes top → bottom.
 *
 * Pure — depends only on the rect's current geometry. The same `(side, t)`
 * against a translated or resized rect produces a coordinate that tracks
 * the rect, which is the whole point of pinning.
 */
declare const endpointFromPin: (rect: FloatingRect, pin: Pin) => Endpoint;
/**
 * Convert a perimeter `Endpoint` back into a `Pin` against the same rect.
 * Pure inverse of `endpointFromPin` (round-trips when the endpoint actually
 * lies on the rect's perimeter, and clamps gracefully otherwise).
 *
 * Used to "freeze" a currently-floating endpoint at its visible position
 * before a reconnect on the other side: capture the floating intersection
 * via `getNodeIntersection`, convert via this helper, then persist as a pin
 * so the un-moved endpoint doesn't slide when the moved side changes the
 * line-through-centers.
 *
 * Edge case: a zero-width rect collapses t→0 on top/bottom (no horizontal
 * range to parameterize); a zero-height rect collapses t→0 on left/right.
 */
declare const endpointToPin: (rect: FloatingRect, endpoint: Endpoint) => Pin;
/**
 * Resolve a single edge endpoint. Precedence (highest first):
 *
 * 1. `pin` set (US-006) → compute from `(side, t)` against the node's bbox.
 *    The endpoint parameterizes with the node so it survives moves/resizes.
 * 2. `autoPicked === false` (US-025, user-pinned by an explicit handle drop)
 *    → return the React-Flow-supplied fallback unchanged so a pinned handle
 *    stays put even if it points the "wrong" way after the other node moves.
 * 3. Otherwise (floating; the default for new connectors): compute the
 *    perimeter intersection of the line through the two node centers via
 *    `getNodeIntersection`. Endpoint slides along the node's perimeter as
 *    either node moves.
 *
 * Pure function — extracted from `editable-edge.tsx` so the branch can be
 * unit-tested without mounting the component.
 */
declare const resolveEdgeEndpoints: (source: EndpointInput | null, target: EndpointInput | null) => {
    source: Endpoint;
    target: Endpoint;
};

interface IconInsertRfInstance {
    screenToFlowPosition: (p: {
        x: number;
        y: number;
    }) => {
        x: number;
        y: number;
    };
}
interface IconInsertViewport {
    width: number;
    height: number;
}
interface IconInsertPayload {
    type: 'iconNode';
    position: {
        x: number;
        y: number;
    };
    data: {
        icon: string;
        width: number;
        height: number;
    };
}
/**
 * Compute the flow-space position for a new iconNode that should land visually
 * centered on the viewport. The result is the node's top-left corner — already
 * offset by half the default icon size so the node's center matches the
 * viewport center after React Flow positions it.
 */
declare function computeIconInsertPosition(rfInstance: IconInsertRfInstance, viewport: IconInsertViewport): {
    x: number;
    y: number;
};
/**
 * Build the full iconNode create payload (type + position + data) for the
 * toolbar's insert-mode pick. Separates the math + shape construction from any
 * particular dispatcher, so the same payload is shared by demo-view's
 * onCreateIconNode call site and by the unit test.
 */
declare function buildIconInsertPayload(args: {
    iconName: string;
    rfInstance: IconInsertRfInstance;
    viewport: IconInsertViewport;
}): IconInsertPayload;

declare const ICON_RECENTS_STORAGE_KEY = "seeflow:icon-recents";
declare function getRecents(): string[];
declare function pushRecent(name: string): void;

type ModifierEvent = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'>;
declare const IS_MAC: boolean;
type ShortcutParts = {
    meta?: boolean;
    shift?: boolean;
    alt?: boolean;
    key: string;
};
/**
 * Render a keyboard shortcut for display. On macOS: ⌘⇧⌥ glyphs are
 * concatenated with the key (e.g. `⌘⇧L`). On Windows/Linux: `Ctrl+Shift+Alt+`
 * tokens joined with `+` (e.g. `Ctrl+Shift+L`). The `meta` flag maps to ⌘ on
 * mac and `Ctrl` elsewhere — callers pass the same shape regardless of OS.
 *
 * The optional `isMac` override exists for tests; production callers omit it
 * and pick up the module-level `IS_MAC` detection.
 */
declare const formatShortcut: (parts: ShortcutParts, isMac?: boolean) => string;
type CommandId = 'tool.select' | 'tool.rectangle' | 'tool.ellipse' | 'tool.text' | 'tool.sticky' | 'tool.database' | 'tool.server' | 'tool.user' | 'tool.queue' | 'tool.cloud' | 'edit.undo' | 'edit.redo' | 'edit.copy' | 'edit.paste' | 'edit.duplicate' | 'edit.delete' | 'edit.selectAll' | 'view.fit' | 'view.zoomIn' | 'view.zoomOut' | 'view.zoom100' | 'view.zoomToSelection' | 'layout.tidy' | 'selection.deselect' | 'help.commandPalette' | 'export.pdf' | 'export.png' | 'session.reset';
type CommandCategory = 'Edit' | 'View' | 'Tools' | 'Layout' | 'Selection' | 'File' | 'Help';
type CommandContext = {
    hasSelection: boolean;
    canUndo: boolean;
    canRedo: boolean;
    hasClipboard: boolean;
    canExportDemo: boolean;
    canResetSession: boolean;
};
type CommandDef = {
    id: CommandId;
    label: string;
    description?: string;
    category: CommandCategory;
    shortcut?: string;
    enabled?: (ctx: CommandContext) => boolean;
};
declare const COMMANDS: readonly CommandDef[];
/**
 * Tooltip text for a registered command — `"Label (Shortcut)"` when the
 * command defines a shortcut, just `Label` otherwise. Lets the toolbar drive
 * both `title` and `aria-label` from `COMMANDS` so a future label/shortcut
 * change in the registry propagates to every hover hint without re-edits.
 */
declare const getCommandTooltip: (id: CommandId) => string;
type NudgeDelta = {
    dx: number;
    dy: number;
};
/**
 * Resolve an arrow-key nudge from a KeyboardEvent. Returns null for any other
 * key, OR for arrows accompanied by a non-shift modifier (so Cmd+ArrowRight
 * etc. fall through to the browser's word-jump / line-jump behavior).
 *
 * Shift increases the step from 1px to 10px on the same axis. Up/Down map to
 * y±1 (canvas y grows downward); Left/Right map to x±1.
 */
declare const getNudgeDelta: (e: ModifierEvent) => NudgeDelta | null;
type ZoomAction = 'fit' | 'in' | 'out';
/**
 * Resolve a Cmd/Ctrl-prefixed zoom chord. Cmd+0 → fit, Cmd+= or Cmd+Plus → in,
 * Cmd+- → out. Returns null for unrelated keys or chords without the
 * Cmd/Ctrl modifier. Alt as an extra modifier disqualifies the chord (avoids
 * shadowing the browser's Cmd+Alt+= and similar developer shortcuts).
 */
declare const getZoomChord: (e: ModifierEvent) => ZoomAction | null;
/**
 * Compute the per-id position updates produced by an arrow-key nudge against
 * the current selection. Skips ids that aren't in `nodes` so a pure-connector
 * selection (no node ids supplied) collapses to a no-op the caller can detect
 * via `result.length === 0`.
 *
 * `nodes` carries the LIVE position the user sees (overrides merged) so a
 * burst of arrow taps within the undo coalesce window keeps stacking on the
 * already-shifted position rather than the stale server snapshot.
 */
declare const applyNudge: (delta: NudgeDelta, selectedIds: readonly string[], nodes: readonly {
    id: string;
    position: {
        x: number;
        y: number;
    };
}[]) => {
    id: string;
    position: {
        x: number;
        y: number;
    };
}[];
type ClipboardChord = {
    type: 'noop';
} | {
    type: 'selectAll';
} | {
    type: 'copy';
    ids: readonly string[];
} | {
    type: 'duplicate';
    ids: readonly string[];
} | {
    type: 'paste';
};
type ClipboardChordInput = {
    event: ModifierEvent;
    isEditableActive: boolean;
    hasNodes: boolean;
    hasConnectors: boolean;
    selectedIds: readonly string[];
    hasClipboard: boolean;
};
declare const resolveClipboardChord: ({ event, isEditableActive, hasNodes, hasConnectors, selectedIds, hasClipboard, }: ClipboardChordInput) => ClipboardChord;
type ToolShortcutResult = 'select' | ShapeKind | null;
declare const resolveToolShortcut: (e: ModifierEvent) => ToolShortcutResult;

interface NodeStylePatch {
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
    /** iconNode-only: stroke color token. Lands at data.color. */
    color?: ColorToken;
    /** iconNode-only: glyph stroke width. Lands at data.strokeWidth. */
    strokeWidth?: number;
    /** iconNode-only: accessible alt text. Lands at data.alt. */
    alt?: string;
}
interface ConnectorStylePatch {
    color?: ColorToken;
    style?: ConnectorStyle;
    direction?: ConnectorDirection;
    borderSize?: number;
    path?: ConnectorPath;
    /** US-018: per-connector label font size (mirrors NodeStylePatch.fontSize). */
    fontSize?: number;
}
interface StyleStripProps {
    /** Currently selected nodes (with optimistic overrides applied). */
    nodes: DemoNode[];
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
     * iconNode. Same callback the iconNode's double-click handler invokes
     * (US-016). Plumbed from demo-view via demo-canvas. Absent → the
     * Change-icon button hides.
     */
    onRequestIconReplace?: (nodeId: string) => void;
}
declare function StyleStrip({ nodes, connectors, onStyleNode, onStyleNodePreview, onStyleNodes, onStyleNodesPreview, onStyleConnector, onStyleConnectorPreview, onRequestIconReplace, }: StyleStripProps): react_jsx_runtime.JSX.Element | null;

/**
 * Last-used style memory (design doc: docs/plans/2026-05-13-last-used-style-design.md).
 *
 * When the user changes a style property on any node or connector, remember
 * that value and apply it to the next shape of the same family they create.
 * Two buckets — one shared across all node kinds, one for connectors — so a
 * connector-only field (e.g. `direction`) can't leak into a fresh rectangle.
 *
 * Persistence is best-effort `localStorage` under a versioned key. Corrupt
 * JSON, missing storage, or write failures all degrade silently to empty
 * buckets — last-used is convenience, never a correctness boundary.
 *
 * The storage key is `<prefix>:last-used-style:v1`. Callers pass the prefix
 * explicitly so embedders of `@seeflow/canvas` can scope their last-used
 * memory to their app namespace. Pass `DEFAULT_STORAGE_PREFIX` to reproduce
 * the legacy `seeflow:last-used-style:v1` key.
 */

/** Default storage prefix — produces the legacy `seeflow:last-used-style:v1`
 *  key when passed to the read/write helpers. */
declare const DEFAULT_STORAGE_PREFIX = "seeflow";
interface LastUsedStyle {
    node: Partial<NodeStylePatch>;
    connector: Partial<ConnectorStylePatch>;
}
/** Snapshot of the current last-used buckets. Safe to call on every create. */
declare const getLastUsedStyle: (prefix: string) => LastUsedStyle;
/**
 * Merge a node-style patch into the node bucket. `alt` (icon alt text) is
 * stripped because it's content, not style. `borderSize` and `borderWidth`
 * are mirrored at the write boundary so an `image`-driven `borderWidth` change
 * propagates to the next `rectangle`'s `borderSize` and vice-versa.
 */
declare const rememberNodeStyle: (prefix: string, patch: NodeStylePatch) => void;
/** Merge a connector-style patch into the connector bucket. */
declare const rememberConnectorStyle: (prefix: string, patch: ConnectorStylePatch) => void;

/**
 * US-024: defaults injected at brand-new-node creation time so the canvas
 * reads more like a wireframe diagram than a poster. The defaults apply ONLY
 * to fresh nodes (toolbar drag-create, drop-popover create, programmatic
 * insert). Pasted clones preserve their source data verbatim — defaults are
 * never backfilled. Existing demos on disk that lack these fields keep
 * rendering via the renderer's CSS / className fallbacks (per the optional
 * schema fields in `apps/studio/src/schema.ts`).
 *
 * Per-variant scope (see PRD AC):
 *   - shape rectangle/ellipse/sticky → borderSize + fontSize
 *   - shape text                      → fontSize only (text stays chromeless)
 *   - image                           → borderWidth (image has no label text)
 *   - icon                            → none (schema has no borderSize/
 *                                       fontSize fields; the `text-xs`
 *                                       className already renders the icon
 *                                       caption at 12px)
 *
 * Last-used overlay (docs/plans/2026-05-13-last-used-style-design.md): each
 * builder accepts an optional `lastUsed` patch and merges only the fields its
 * kind accepts on top of the hardcoded factory defaults. An empty patch
 * reproduces today's behavior exactly. Property irrelevant to a given kind
 * (e.g. `cornerRadius` on ellipse, `borderSize` on text) is silently dropped.
 */

/** Default border thickness for new nodes. */
declare const NEW_NODE_BORDER_WIDTH = 3;
/** Default label font size for new nodes. */
declare const NEW_NODE_FONT_SIZE = 17;
interface ShapeDataDefaults {
    [key: string]: unknown;
    shape: ShapeKind;
    width: number;
    height: number;
    borderSize?: number;
    fontSize: number;
}
/** Build the `data` object for a freshly-created shape node. Text variant
 * skips `borderSize` so text shapes stay chromeless (US-003). Optional
 * `lastUsed` overlays the user's most recently chosen style on top of the
 * factory defaults. */
declare function buildNewShapeData(shape: ShapeKind, dims: {
    width: number;
    height: number;
}, lastUsed?: Partial<NodeStylePatch>): ShapeDataDefaults;
interface ImageDataDefaults {
    [key: string]: unknown;
    path: string;
    width: number;
    height: number;
    borderWidth: number;
}
/** Build the `data` object for a freshly-created image node. Image uses
 * `borderWidth` (US-014), not `borderSize`. No `fontSize` — image renders
 * no body text. `path` is a relative path under `<project>/.seeflow/`
 * (US-004 hard-cut from base64 data URLs). */
declare function buildNewImageData(path: string, dims: {
    width: number;
    height: number;
}, lastUsed?: Partial<NodeStylePatch>): ImageDataDefaults;

/**
 * US-002: pure helper that scales N nodes' positions and sizes from an
 * old-rect → new-rect transformation. Used by both the multi-select bounding
 * overlay (US-007) and the inactive-group resize path (US-006) so a single
 * geometry implementation backs every "scale a group of nodes" gesture.
 *
 * The helper is intentionally O(n) and side-effect-free: callers pass the
 * filtered selection (group children, or marquee'd loose nodes), get back a
 * fresh array, and feed it into a single `setNodes` so React Flow batches the
 * mutation into one undo entry.
 */
interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}
interface ScalableNode {
    id: string;
    position: {
        x: number;
        y: number;
    };
    /** Optional rendered width; passes through unchanged when absent. */
    width?: number;
    /** Optional rendered height; passes through unchanged when absent. */
    height?: number;
    /**
     * Optional discriminator + payload — only `data.locked` is read here. The
     * helper preserves every other field via spread so callers can keep using
     * their concrete node type (e.g. React Flow's `Node<DemoNodeData>`).
     */
    data?: {
        locked?: boolean;
    };
}
interface ScaleNodesOptions {
    /**
     * When true, both axes use a single uniform scale = `Math.min(sx, sy)`. This
     * choice keeps the scaled content within the new-rect's smaller dimension —
     * never overflowing — which matches what users expect when shift-dragging a
     * corner of the multi-select overlay. The gesture caller is responsible for
     * snapping the new rect's dragged corner so the visible drag tracks the
     * cursor; here we just guarantee uniform scaling.
     */
    lockAspectRatio?: boolean;
}
/**
 * Scale `nodes` from `oldRect` into `newRect`.
 *
 * Per-axis scale: `sx = newRect.width / oldRect.width`, `sy = newRect.height /
 * oldRect.height`. Each node's position and (when present) width/height scale
 * relative to `oldRect`'s top-left origin:
 *
 *   x' = newRect.x + (x - oldRect.x) * sx
 *   y' = newRect.y + (y - oldRect.y) * sy
 *   w' = w * sx
 *   h' = h * sy
 *
 * Nodes with `data.locked === true` pass through unchanged so a single locked
 * child cannot be moved or resized by a group/multi-select scale. A zero-size
 * `oldRect` (either axis) returns the input nodes unchanged — there is no
 * meaningful "scale from a degenerate rect" so we avoid division by zero.
 */
declare function scaleNodesWithinRect<T extends ScalableNode>(nodes: readonly T[], oldRect: Rect, newRect: Rect, options?: ScaleNodesOptions): T[];

type NodeKind = 'playNode' | 'stateNode' | 'shapeNode' | 'imageNode' | 'iconNode' | 'htmlNode';
interface NodeCreateInput {
    /** Optional client-allocated id. When set, server uses it verbatim. */
    id?: string;
    type: NodeKind;
    position: {
        x: number;
        y: number;
    };
    /** Node-kind-specific data payload (ShapeNodeData / IconNodeData / …). */
    data: Record<string, unknown>;
}
interface NodePatch {
    position?: {
        x: number;
        y: number;
    };
    name?: string;
    borderColor?: ColorToken;
    backgroundColor?: ColorToken;
    borderSize?: number;
    /** Image node border-thickness (1–8). Distinct from shape nodes' `borderSize`. */
    borderWidth?: number;
    borderStyle?: 'solid' | 'dashed' | 'dotted';
    fontSize?: number;
    textColor?: ColorToken;
    cornerRadius?: number;
    width?: number;
    height?: number;
    shape?: ShapeKind;
    /** iconNode-only: stroke color token. Lands at data.color. */
    color?: ColorToken;
    /** iconNode-only: glyph stroke width in [0.5, 4]. Lands at data.strokeWidth. */
    strokeWidth?: number;
    /** iconNode-only: accessible alt text. Lands at data.alt. */
    alt?: string;
    /**
     * Kebab-case Lucide icon name. Lands at data.icon. On play/state/html
     * nodes the field is optional and `null` clears it (the studio strips the
     * key from disk). On iconNode the post-merge reparse keeps the field
     * required.
     */
    icon?: string | null;
    /** Lock state. true freezes the node; false unlocks. */
    locked?: boolean;
    /** Short body text rendered on the canvas and as light-bold in the sidebar. */
    description?: string;
    /** Long-form sidebar-only body text. */
    detail?: string;
}
type ReorderOp = {
    op: 'forward';
} | {
    op: 'backward';
} | {
    op: 'toFront';
} | {
    op: 'toBack';
} | {
    op: 'toIndex';
    index: number;
};
interface ConnectorCreateInput {
    id?: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    sourceHandleAutoPicked?: boolean;
    targetHandleAutoPicked?: boolean;
    sourcePin?: EdgePin;
    targetPin?: EdgePin;
    kind?: Connector['kind'];
    label?: string;
    style?: ConnectorStyle;
    color?: ColorToken;
    direction?: ConnectorDirection;
    eventName?: string;
    queueName?: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url?: string;
}
interface ConnectorPatch {
    label?: string;
    style?: ConnectorStyle;
    color?: ColorToken;
    direction?: ConnectorDirection;
    borderSize?: number;
    path?: ConnectorPath;
    /** Per-connector label font size in px. */
    fontSize?: number;
    kind?: Connector['kind'];
    eventName?: string;
    queueName?: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url?: string;
    /** Reconnect: retarget this edge to a different source node. */
    source?: string;
    /** Reconnect: retarget this edge to a different target node. */
    target?: string;
    /** Pin source endpoint to a specific handle id. `null` clears. */
    sourceHandle?: string | null;
    /** Pin target endpoint to a specific handle id. `null` clears. */
    targetHandle?: string | null;
    sourceHandleAutoPicked?: boolean;
    targetHandleAutoPicked?: boolean;
    /** Pin source endpoint at `(side, t)` on the source node's perimeter. `null` clears. */
    sourcePin?: EdgePin | null;
    /** Pin target endpoint at `(side, t)` on the target node's perimeter. `null` clears. */
    targetPin?: EdgePin | null;
}
interface UpdateNodePositionResult {
    ok: boolean;
    position: {
        x: number;
        y: number;
    };
}
interface UploadImageResult {
    path: string;
}
interface PlayNodeResult {
    runId: string;
    status?: number;
    body?: unknown;
    error?: string;
}
/**
 * US-026: read-only runtime state injected into the canvas. Bundles the three
 * data streams the canvas needs to render dynamic chrome — SSE-driven per-node
 * `runs`, latest `statuses`, and optimistic `pendingOverrides` for node /
 * connector edits in flight. The hooks that produce these values stay in
 * apps/web (`use-node-runs`, `use-node-statuses`, `use-pending-overrides`); the
 * canvas treats this as an opaque data prop.
 *
 * Every field is optional so view-mode embedders can omit the whole prop. Inside
 * demo-canvas, `runtime?.runs?.[id]` etc. is the canonical access pattern —
 * the helpers fall back to `'idle'` / `undefined` when the entries are absent.
 */
interface CanvasRuntime {
    /** Per-node SSE run state, keyed by node id. */
    runs?: Record<string, RunResult>;
    /** Latest StatusReport per node, keyed by node id. */
    statuses?: Record<string, StatusReport>;
    /**
     * Optimistic edits that haven't yet been reconciled by the server. Nodes and
     * connectors are stored separately because their generic parameters differ —
     * a single map would lose type safety on the values.
     */
    pendingOverrides?: {
        nodes?: Record<string, Partial<DemoNode>>;
        connectors?: Record<string, Partial<Connector>>;
    };
}
/**
 * CanvasAdapter — the surface @seeflow/canvas calls when it needs to persist a
 * change. One adapter is bound to one demo/project at construction. Embedders
 * (the studio today, library consumers tomorrow) implement this against their
 * own backend; the canvas package never imports REST URLs directly.
 */
interface CanvasAdapter {
    createNode(input: NodeCreateInput): Promise<{
        id: string;
        node: Record<string, unknown>;
    }>;
    updateNode(nodeId: string, patch: NodePatch): Promise<void>;
    /**
     * Position-only fast path. Kept separate from `updateNode` so position drags
     * can hit the granular `/position` endpoint (preserved from the pre-adapter
     * REST surface). Embedders that don't need the granular split can route this
     * through their generic node-patch path.
     */
    updateNodePosition(nodeId: string, position: {
        x: number;
        y: number;
    }): Promise<UpdateNodePositionResult>;
    deleteNode(nodeId: string): Promise<void>;
    reorderNode(nodeId: string, op: ReorderOp): Promise<void>;
    createConnector(input: ConnectorCreateInput): Promise<{
        id: string;
    }>;
    updateConnector(connectorId: string, patch: ConnectorPatch): Promise<void>;
    deleteConnector(connectorId: string): Promise<void>;
    uploadImage(file: File, filename: string): Promise<UploadImageResult>;
    /** Optional: invoke the node's playAction. Adapters that don't support
     *  server-side execution can omit this — view-mode canvases never call it. */
    playNode?(nodeId: string): Promise<PlayNodeResult>;
    /** Optional: ask the host to open the given project-scoped file in its editor. */
    openFile?(path: string): Promise<void>;
    /** Optional: ask the host to reveal the given project-scoped file in its OS file manager. */
    revealFile?(path: string): Promise<void>;
}

interface RestAdapterOptions {
    /** URL prefix (e.g. '' in-studio, 'https://example.com' for cross-origin). */
    baseUrl: string;
    /** demoId (== projectId in the studio registry). Bound for the adapter's lifetime. */
    demoId: string;
    /** Optional fetch override — primarily for tests. Defaults to globalThis.fetch. */
    fetch?: typeof fetch;
}
declare const createRestAdapter: (options: RestAdapterOptions) => CanvasAdapter;

type HtmlNodeRuntimeData = HtmlNodeData & {
    onResize?: (nodeId: string, dims: {
        width: number;
        height: number;
        x: number;
        y: number;
    }) => void;
    setResizing?: (on: boolean) => void;
    /**
     * US-014: project id injected into every node's runtime data by demo-canvas
     * so the renderer can build a project-scoped file URL. Mirrors the same
     * field on `ImageNodeRuntimeData` (US-004). Not persisted to disk —
     * `htmlPath` is the only on-disk reference.
     */
    projectId?: string;
} & Record<string, unknown>;
type HtmlNodeType = Node<HtmlNodeRuntimeData, 'htmlNode'>;
declare const HTML_DEFAULT_SIZE: {
    readonly width: 320;
    readonly height: 200;
};
declare function HtmlNodeImpl({ id, data, selected, isConnectable }: NodeProps<HtmlNodeType>): react_jsx_runtime.JSX.Element;
declare const HtmlNode: React.MemoExoticComponent<typeof HtmlNodeImpl>;

type IconNodeRuntimeData = IconNodeData & {
    onResize?: (nodeId: string, dims: {
        width: number;
        height: number;
        x: number;
        y: number;
    }) => void;
    setResizing?: (on: boolean) => void;
    onNameChange?: (nodeId: string, name: string) => void;
} & Record<string, unknown>;
type IconNodeType = Node<IconNodeRuntimeData, 'iconNode'>;
declare const ICON_DEFAULT_SIZE: {
    readonly width: 48;
    readonly height: 48;
};
declare function IconNodeImpl({ id, data, selected, isConnectable }: NodeProps<IconNodeType>): react_jsx_runtime.JSX.Element;
declare const IconNode: React.MemoExoticComponent<typeof IconNodeImpl>;

type ImageNodeRuntimeData = ImageNodeData & {
    onResize?: (nodeId: string, dims: {
        width: number;
        height: number;
        x: number;
        y: number;
    }) => void;
    setResizing?: (on: boolean) => void;
    /**
     * US-004: project id injected into every node's runtime data by demo-canvas
     * so the renderer can build a project-scoped file URL. Not persisted to disk
     * — `path` is the only on-disk field.
     */
    projectId?: string;
    /**
     * US-008: click-to-retry callback dispatched when the user clicks the
     * 'Upload failed' placeholder. Injected by demo-canvas's `sourceNodes`
     * builder. Absent → the placeholder still renders, but clicking is inert.
     */
    onRetryUpload?: (nodeId: string) => void;
    /**
     * US-008 (canvas extraction): transient upload-state flags. Mirrors the
     * apps/web `ImageNodeData` extension — set on optimistic placement, cleared
     * once the upload settles. Not persisted to disk.
     */
    _uploading?: boolean;
    _uploadError?: string;
} & Record<string, unknown>;
type ImageNodeType = Node<ImageNodeRuntimeData, 'imageNode'>;
declare const IMAGE_DEFAULT_SIZE: {
    readonly width: 200;
    readonly height: 150;
};
declare function ImageNodeImpl({ id, data, selected, isConnectable }: NodeProps<ImageNodeType>): react_jsx_runtime.JSX.Element;
declare const ImageNode: React.MemoExoticComponent<typeof ImageNodeImpl>;

/**
 * US-019: small lock indicator rendered on a node's top-right corner when
 * the node is locked. Absolutely positioned outside the node's content flow
 * so it never affects the node's bounding box; offset above the top edge so
 * it doesn't overlap the top-middle connection handle. Every node renderer
 * (play, state, shape, image, icon, group) reads `data.locked` and renders
 * this badge directly — there is no shared wrapper layer in xyflow we can
 * inject chrome through.
 *
 * US-018: the badge keeps `pointer-events: auto` (default) so it is the
 * event target when the cursor is over its visible area. Because the badge
 * is offset at `-top-2 -right-2`, it sits OUTSIDE the xyflow `.react-flow__node`
 * wrapper's geometry — but it's still a DOM descendant of the wrapper. With
 * pointer-events enabled, contextmenu / click events on the badge fire on
 * the badge element and bubble through the DOM to the wrapper, where xyflow's
 * onContextMenu / onClick handlers correctly dispatch to onNodeContextMenu /
 * onNodeClick. Without this (with `pointer-events: none`), hit-testing
 * skips the badge and falls through to the React Flow pane underneath —
 * since the badge area is geometrically outside the wrapper — and the
 * right-click fires onPaneContextMenu (the canvas Paste menu) instead.
 */
declare function LockBadge({ className }: {
    className?: string;
}): react_jsx_runtime.JSX.Element;

/**
 * US-014: shared inline placeholder for file-backed renderers when the
 * underlying file is missing, loading, or failed to load. Used by the
 * htmlNode renderer for the missing-file state; future renderers (image-node
 * upload placeholder, etc.) can adopt the same component when their inlined
 * placeholders are extracted.
 */
declare function PlaceholderCard({ message, variant, className, }: {
    message: string;
    variant?: 'muted' | 'destructive';
    className?: string;
}): react_jsx_runtime.JSX.Element;

type PlayNodeData = NodeData & {
    /**
     * Undefined when this node has no entry in the runs map (i.e. the user has
     * never clicked Play on it). Once a run is dispatched, status becomes
     * 'running' → 'done'/'error'. Status is communicated visually via the Play
     * button itself (US-018) — no separate status chip.
     */
    status?: NodeStatus;
    /** Filled when status === 'error' — surfaced as the play-button tooltip. */
    errorMessage?: string;
    /**
     * US-007: latest StatusReport from this node's statusAction script (if any),
     * driven by `node:status` SSE events. Undefined when no entry exists in the
     * `statusByNode` map — the badge row is suppressed entirely so the no-status
     * path is byte-identical to legacy renders (no layout shift).
     */
    statusReport?: StatusReport & {
        ts: number;
    };
    onPlay?: (nodeId: string) => void;
    onResize?: (nodeId: string, dims: {
        width: number;
        height: number;
        x: number;
        y: number;
    }) => void;
    setResizing?: (on: boolean) => void;
    onNameChange?: (nodeId: string, name: string) => void;
    onDescriptionChange?: (nodeId: string, description: string) => void;
} & Record<string, unknown>;
type PlayNodeType = Node<PlayNodeData, 'playNode'>;
declare function PlayNodeImpl({ id, data, selected, isConnectable }: NodeProps<PlayNodeType>): react_jsx_runtime.JSX.Element;
declare const PlayNode: React.MemoExoticComponent<typeof PlayNodeImpl>;

interface ResizeControlsProps {
    /** Render the controls only when true (mirrors NodeResizer's isVisible). */
    visible: boolean;
    minWidth?: number;
    minHeight?: number;
    onResizeStart?: OnResizeStart;
    /**
     * US-016: per-tick callback fired on every xyflow `onResize` event during
     * the drag (NOT just at the end). Wiring this lets node renderers update
     * canvas state live as the user drags a resize handle.
     */
    onResize?: OnResize;
    onResizeEnd?: OnResizeEnd;
    /**
     * US-016: 'visible' renders the 4 corner handles as small white squares with
     * a 1px primary/60 border — the standard design-tool selection affordance.
     * The 4 edge lines stay invisible (only their cursor + hit-area survive) so
     * "only the corners" reads visually. 'invisible' (default) keeps every
     * control transparent — affordance is purely the cursor change.
     */
    cornerVariant?: 'invisible' | 'visible';
}
/**
 * Eight resize controls (4 edge lines + 4 corners). Edge lines are always
 * transparent — the affordance is the cursor change at the edge. Corners are
 * either transparent (default) or visible (US-016 selection rect handles).
 * Cursor wiring is via React Flow's existing CSS classes on
 * `.react-flow__resize-control.{position}`; the visible selection rect itself
 * is drawn by the parent node renderer via an offset outline.
 */
declare function ResizeControls({ visible, minWidth, minHeight, onResizeStart, onResize, onResizeEnd, cornerVariant, }: ResizeControlsProps): react_jsx_runtime.JSX.Element;

type ShapeNodeRuntimeData = ShapeNodeData & {
    onResize?: (nodeId: string, dims: {
        width: number;
        height: number;
        x: number;
        y: number;
    }) => void;
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
type ShapeNodeType = Node<ShapeNodeRuntimeData, 'shapeNode'>;
declare const SHAPE_DEFAULT_SIZE: Record<ShapeKind, {
    width: number;
    height: number;
}>;
declare const SHAPE_CLASS: Record<ShapeKind, string>;
/**
 * Tailwind class string for a shape's chrome (border-radius, default border
 * width, sticky tilt + shadow). The pair of `shapeChromeClass` +
 * `shapeChromeStyle` is the single source of truth consumed by both
 * `ShapeNode` (live render) and `demo-canvas.tsx`'s drag-create ghost
 * (`canvas-draw-ghost`, US-009) so the preview shown during drag matches the
 * committed node exactly.
 */
declare function shapeChromeClass(shape: ShapeKind): string;
/**
 * Inline style for a shape's chrome (borderColor / backgroundColor /
 * borderWidth / borderStyle / borderRadius). Mirrors the resolution rules in
 * `ShapeNode` so the ghost preview (US-009) and the committed node share the
 * same values; pass an empty `data` to get the default-color look the
 * drag-create flow commits via `onCreateShapeNode` (which sends only
 * `{ shape, width, height }` — no color overrides).
 */
declare function shapeChromeStyle(shape: ShapeKind, data?: Pick<ShapeNodeData, 'backgroundColor' | 'borderColor' | 'borderSize' | 'borderStyle' | 'cornerRadius'>): CSSProperties;
declare function ShapeNodeImpl({ id, data, selected, isConnectable }: NodeProps<ShapeNodeType>): react_jsx_runtime.JSX.Element;
declare const ShapeNode: React.MemoExoticComponent<typeof ShapeNodeImpl>;

interface ShapePartProps {
    width: number;
    height: number;
    borderColor?: string;
    backgroundColor?: string;
    borderSize?: number;
    borderStyle?: 'solid' | 'dashed' | 'dotted';
}
declare const BORDER_FALLBACK = "var(--seeflow-node-border)";
declare const BG_FALLBACK = "var(--seeflow-node-bg)";
declare const DEFAULT_STROKE_WIDTH = 2;
declare function dashFor(style: ShapePartProps['borderStyle']): string | undefined;

declare function CloudShape({ width, height, borderColor, backgroundColor, borderSize, borderStyle, }: ShapePartProps): react_jsx_runtime.JSX.Element;

declare function DatabaseShape({ width, height, borderColor, backgroundColor, borderSize, borderStyle, }: ShapePartProps): react_jsx_runtime.JSX.Element;

declare function QueueShape({ width, height, borderColor, backgroundColor, borderSize, borderStyle, }: ShapePartProps): react_jsx_runtime.JSX.Element;

declare const ILLUSTRATIVE_SHAPE_RENDERERS: Partial<Record<ShapeKind, FC<ShapePartProps>>>;

declare function ServerShape({ width, height, borderColor, backgroundColor, borderSize, borderStyle, }: ShapePartProps): react_jsx_runtime.JSX.Element;

declare function UserShape({ width, height, borderColor, backgroundColor, borderSize, borderStyle, }: ShapePartProps): react_jsx_runtime.JSX.Element;

type StateNodeData = NodeData & {
    /**
     * Undefined when no emit() event has landed for this node — treated as
     * 'idle' visually (the StatusPill renders nothing for 'idle').
     */
    status?: NodeStatus;
    /**
     * US-007: latest StatusReport from this node's statusAction script (if any),
     * driven by `node:status` SSE events. Undefined when no entry exists in the
     * `statusByNode` map — the badge row is suppressed entirely so the no-status
     * path is byte-identical to legacy renders (no layout shift).
     */
    statusReport?: StatusReport & {
        ts: number;
    };
    onResize?: (nodeId: string, dims: {
        width: number;
        height: number;
        x: number;
        y: number;
    }) => void;
    setResizing?: (on: boolean) => void;
    onNameChange?: (nodeId: string, name: string) => void;
    onDescriptionChange?: (nodeId: string, description: string) => void;
} & Record<string, unknown>;
type StateNodeType = Node<StateNodeData, 'stateNode'>;
declare function StateNodeImpl({ id, data, selected, isConnectable }: NodeProps<StateNodeType>): react_jsx_runtime.JSX.Element;
declare const StateNode: React.MemoExoticComponent<typeof StateNodeImpl>;

interface StatusBadgeProps {
    state: StatusReportState;
    summary?: string;
    /** Optional test id forwarded to the wrapper. */
    'data-testid'?: string;
}
/**
 * 8px colored dot + ellipsized one-line summary. Renders inline so the parent
 * can drop it into a flex row without extra layout. When `summary` is empty
 * the badge degrades to just the dot.
 */
declare function StatusBadge({ state, summary, 'data-testid': testId }: StatusBadgeProps): react_jsx_runtime.JSX.Element;

/**
 * Wraps a NodeResizeControl gesture so a click on a resize handle (mousedown
 * + mouseup with no movement) is a no-op. React Flow fires onResizeStart AND
 * onResizeEnd unconditionally — without this guard, a click would call
 * data.onResize with the current measured dims, promoting a previously
 * unsized node to a sized one and visibly expanding it.
 *
 * US-016: also exposes an `onResize` (per-tick) handler that fires the user's
 * `onResize` callback on every xyflow resize tick — so child nodes / overlay
 * payloads update LIVE during the drag, not just on release. The same
 * callback is invoked at `onResizeEnd` (back-compat: existing tests + the
 * click-guard branch still flow through there). The end-fired call carries
 * the SAME dims as the last per-tick call, so demo-view's optimistic
 * overrides + the coalesced undo key make the redundant dispatch a no-op
 * visually (one undo entry per gesture; PATCHes are idempotent on the
 * server).
 *
 * The returned callbacks are STABLE across renders (refs back the user-
 * provided callbacks). This is critical: xyflow's `NodeResizeControl` has an
 * effect that calls `resizer.update({ onResize, onResizeStart, onResizeEnd })`
 * whenever any of those props change, and `update()` resets the d3-drag
 * `startValues` to zeros. If our wrapper passed a fresh function reference
 * every render (which happened during a live drag because each tick's
 * setState re-rendered the canvas), `startValues` got wiped mid-gesture and
 * the next pointer-move computed `newWidth = startValues.width(=0) - distX`
 * — i.e. a wildly wrong absolute size keyed off cursor position alone. The
 * visible symptom was the resized node exponentially expanding/shrinking as
 * the mouse moved.
 */
declare function useResizeGesture(args: {
    onResize?: (dims: ResizeParams) => void;
    /**
     * End-only callback. Fires once at mouse release with the FINAL dims and the
     * ORIGINAL dims captured at resize-start. Use this for batched mutations
     * that shouldn't run on every tick (e.g. group child scaling, where the
     * per-tick path produced exponential expand/shrink as feedback from the
     * optimistic override mutated the next tick's baseline). Fires AFTER the
     * end-fired `onResize` call below.
     */
    onResizeFinal?: (dims: ResizeParams, start: ResizeParams) => void;
    setResizing?: (on: boolean) => void;
}): {
    isResizing: boolean;
    onResizeStart: OnResizeStart;
    onResizeEvent: OnResize;
    onResizeEnd: OnResizeEnd;
};

type EditableEdgeData = {
    /** Persist a new label (PATCH /connectors/:id { label }). */
    onLabelChange?: (id: string, label: string) => void;
    /** Path geometry — 'curve' (default bezier) or 'step' (smoothstep). */
    path?: ConnectorPath;
    /** US-018: per-connector label font size in px (undefined → 11px default). */
    fontSize?: number;
    /**
     * US-018: register a stable handle that enters inline label edit mode.
     * demo-canvas calls the registered `enter()` from its onEdgeDoubleClick
     * callback so double-click anywhere on the edge body opens the editor.
     */
    registerEditHandle?: (id: string, enter: () => void) => () => void;
    /** US-025: floating endpoints when !== false. */
    sourceHandleAutoPicked?: boolean;
    /** US-025: same as sourceHandleAutoPicked but for the target endpoint. */
    targetHandleAutoPicked?: boolean;
    /** US-007: perimeter pin for the source endpoint (if set, overrides float/auto-pick). */
    sourcePin?: EdgePin;
    /** US-007: same as sourcePin but for the target endpoint. */
    targetPin?: EdgePin;
    /**
     * US-024 / US-007: when true, render the visible endpoint dots above
     * every node and edge in the canvas. The dots are purely visual; React
     * Flow's native EdgeUpdateAnchors sit underneath them (`pointer-events:
     * none` on the dot lets clicks pass through) and drive the free-floating
     * reconnect drag.
     */
    reconnectable?: boolean;
} & Record<string, unknown>;
type EditableEdgeType = Edge<EditableEdgeData, 'editableEdge'>;
/**
 * Custom React Flow edge rendered as a smooth bezier (or smoothstep) curve.
 * Doubles up as an inline-editor for the connector label via double-click.
 *
 * US-025: when `data.sourceHandleAutoPicked !== false` the source endpoint
 * floats — we read the source node's live geometry via `useInternalNode`
 * and place the endpoint at the perimeter intersection of the line through
 * the two node centers, ignoring React Flow's stored handle coords. Same
 * for target.
 *
 * US-007: when `data.sourcePin` / `data.targetPin` is set, the endpoint is
 * anchored to a specific perimeter point that follows the node through
 * moves and resizes. (Pins are written by external tooling / data edits;
 * the visible endpoint dots are non-interactive — drag is handled by React
 * Flow's native reconnect anchors underneath.)
 */
declare function EditableEdge({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, style, markerEnd, markerStart, interactionWidth, data, }: EdgeProps<EditableEdgeType>): react_jsx_runtime.JSX.Element;

declare const buttonVariants: (props?: ({
    variant?: "link" | "default" | "outline" | "destructive" | "secondary" | "ghost" | null | undefined;
    size?: "default" | "icon" | "sm" | "lg" | null | undefined;
} & class_variance_authority_types.ClassProp) | undefined) => string;
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
    asChild?: boolean;
}
declare const Button: React.ForwardRefExoticComponent<ButtonProps & React.RefAttributes<HTMLButtonElement>>;

declare const Command: React.ForwardRefExoticComponent<Omit<{
    children?: React.ReactNode;
} & Pick<Pick<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "key" | keyof React.HTMLAttributes<HTMLDivElement>> & {
    ref?: React.Ref<HTMLDivElement>;
} & {
    asChild?: boolean;
}, "key" | keyof React.HTMLAttributes<HTMLDivElement> | "asChild"> & {
    label?: string;
    shouldFilter?: boolean;
    filter?: (value: string, search: string, keywords?: string[]) => number;
    defaultValue?: string;
    value?: string;
    onValueChange?: (value: string) => void;
    loop?: boolean;
    disablePointerSelection?: boolean;
    vimBindings?: boolean;
} & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
declare const CommandDialog: ({ children, ...props }: DialogProps) => react_jsx_runtime.JSX.Element;
declare const CommandInput: React.ForwardRefExoticComponent<Omit<Omit<Pick<Pick<React.DetailedHTMLProps<React.InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>, "key" | keyof React.InputHTMLAttributes<HTMLInputElement>> & {
    ref?: React.Ref<HTMLInputElement>;
} & {
    asChild?: boolean;
}, "key" | "asChild" | keyof React.InputHTMLAttributes<HTMLInputElement>>, "type" | "onChange" | "value"> & {
    value?: string;
    onValueChange?: (search: string) => void;
} & React.RefAttributes<HTMLInputElement>, "ref"> & React.RefAttributes<HTMLInputElement>>;
declare const CommandList: React.ForwardRefExoticComponent<Omit<{
    children?: React.ReactNode;
} & Pick<Pick<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "key" | keyof React.HTMLAttributes<HTMLDivElement>> & {
    ref?: React.Ref<HTMLDivElement>;
} & {
    asChild?: boolean;
}, "key" | keyof React.HTMLAttributes<HTMLDivElement> | "asChild"> & {
    label?: string;
} & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
declare const CommandEmpty: React.ForwardRefExoticComponent<Omit<{
    children?: React.ReactNode;
} & Pick<Pick<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "key" | keyof React.HTMLAttributes<HTMLDivElement>> & {
    ref?: React.Ref<HTMLDivElement>;
} & {
    asChild?: boolean;
}, "key" | keyof React.HTMLAttributes<HTMLDivElement> | "asChild"> & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
declare const CommandGroup: React.ForwardRefExoticComponent<Omit<{
    children?: React.ReactNode;
} & Omit<Pick<Pick<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "key" | keyof React.HTMLAttributes<HTMLDivElement>> & {
    ref?: React.Ref<HTMLDivElement>;
} & {
    asChild?: boolean;
}, "key" | keyof React.HTMLAttributes<HTMLDivElement> | "asChild">, "value" | "heading"> & {
    heading?: React.ReactNode;
    value?: string;
    forceMount?: boolean;
} & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
declare const CommandSeparator: React.ForwardRefExoticComponent<Omit<Pick<Pick<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "key" | keyof React.HTMLAttributes<HTMLDivElement>> & {
    ref?: React.Ref<HTMLDivElement>;
} & {
    asChild?: boolean;
}, "key" | keyof React.HTMLAttributes<HTMLDivElement> | "asChild"> & {
    alwaysRender?: boolean;
} & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
declare const CommandItem: React.ForwardRefExoticComponent<Omit<{
    children?: React.ReactNode;
} & Omit<Pick<Pick<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, "key" | keyof React.HTMLAttributes<HTMLDivElement>> & {
    ref?: React.Ref<HTMLDivElement>;
} & {
    asChild?: boolean;
}, "key" | keyof React.HTMLAttributes<HTMLDivElement> | "asChild">, "onSelect" | "value" | "disabled"> & {
    disabled?: boolean;
    onSelect?: (value: string) => void;
    value?: string;
    keywords?: string[];
    forceMount?: boolean;
} & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
declare const CommandShortcut: {
    ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>): react_jsx_runtime.JSX.Element;
    displayName: string;
};

declare const ContextMenu: React.FC<ContextMenuPrimitive.ContextMenuProps>;
declare const ContextMenuTrigger: React.ForwardRefExoticComponent<ContextMenuPrimitive.ContextMenuTriggerProps & React.RefAttributes<HTMLSpanElement>>;
declare const ContextMenuContent: React.ForwardRefExoticComponent<Omit<ContextMenuPrimitive.ContextMenuContentProps & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
declare const ContextMenuItem: React.ForwardRefExoticComponent<Omit<ContextMenuPrimitive.ContextMenuItemProps & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
declare const ContextMenuSeparator: React.ForwardRefExoticComponent<Omit<ContextMenuPrimitive.ContextMenuSeparatorProps & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
declare const ContextMenuShortcut: {
    ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>): react_jsx_runtime.JSX.Element;
    displayName: string;
};

declare const Dialog: React.FC<DialogPrimitive.DialogProps>;
declare const DialogTrigger: React.ForwardRefExoticComponent<DialogPrimitive.DialogTriggerProps & React.RefAttributes<HTMLButtonElement>>;
declare const DialogPortal: ({ children, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Portal>) => react_jsx_runtime.JSX.Element;
declare const DialogClose: React.ForwardRefExoticComponent<DialogPrimitive.DialogCloseProps & React.RefAttributes<HTMLButtonElement>>;
declare const DialogOverlay: React.ForwardRefExoticComponent<Omit<DialogPrimitive.DialogOverlayProps & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
declare const DialogContent: React.ForwardRefExoticComponent<Omit<DialogPrimitive.DialogContentProps & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
declare const DialogHeader: {
    ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): react_jsx_runtime.JSX.Element;
    displayName: string;
};
declare const DialogFooter: {
    ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): react_jsx_runtime.JSX.Element;
    displayName: string;
};
declare const DialogTitle: React.ForwardRefExoticComponent<Omit<DialogPrimitive.DialogTitleProps & React.RefAttributes<HTMLHeadingElement>, "ref"> & React.RefAttributes<HTMLHeadingElement>>;
declare const DialogDescription: React.ForwardRefExoticComponent<Omit<DialogPrimitive.DialogDescriptionProps & React.RefAttributes<HTMLParagraphElement>, "ref"> & React.RefAttributes<HTMLParagraphElement>>;

declare const DropdownMenu: React.FC<DropdownMenuPrimitive.DropdownMenuProps>;
declare const DropdownMenuTrigger: React.ForwardRefExoticComponent<DropdownMenuPrimitive.DropdownMenuTriggerProps & React.RefAttributes<HTMLButtonElement>>;
declare const DropdownMenuContent: React.ForwardRefExoticComponent<Omit<DropdownMenuPrimitive.DropdownMenuContentProps & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
declare const DropdownMenuItem: React.ForwardRefExoticComponent<Omit<DropdownMenuPrimitive.DropdownMenuItemProps & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
declare const DropdownMenuSeparator: React.ForwardRefExoticComponent<Omit<DropdownMenuPrimitive.DropdownMenuSeparatorProps & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;

interface IconRegistryValue {
    custom: Record<string, ComponentType<LucideProps>>;
}
interface IconRegistryProviderProps {
    value: IconRegistryValue;
    children: ReactNode;
}
declare function IconRegistryProvider({ value, children }: IconRegistryProviderProps): react_jsx_runtime.JSX.Element;
declare function useIconRegistry(): IconRegistryValue;
interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
    name?: string;
    as?: ComponentType<LucideProps>;
    size?: number | string;
    fallback?: string;
}
declare function Icon({ name, as, size, fallback, ...rest }: IconProps): react_jsx_runtime.JSX.Element | null;

type IconToggleOption<V extends string> = {
    value: V;
    icon: ComponentType<{
        className?: string;
    }>;
    label: string;
    testId?: string;
};
interface IconToggleGroupProps<V extends string> {
    value: V;
    onChange: (value: V) => void;
    options: IconToggleOption<V>[];
    ariaLabel?: string;
    className?: string;
}
declare function IconToggleGroup<V extends string>({ value, onChange, options, ariaLabel, className, }: IconToggleGroupProps<V>): react_jsx_runtime.JSX.Element;

declare const LineSolidIcon: (props: SVGProps<SVGSVGElement>) => react_jsx_runtime.JSX.Element;
declare const LineDashedIcon: (props: SVGProps<SVGSVGElement>) => react_jsx_runtime.JSX.Element;
declare const LineDottedIcon: (props: SVGProps<SVGSVGElement>) => react_jsx_runtime.JSX.Element;
declare const PathCurveIcon: (props: SVGProps<SVGSVGElement>) => react_jsx_runtime.JSX.Element;
declare const PathStepIcon: (props: SVGProps<SVGSVGElement>) => react_jsx_runtime.JSX.Element;

declare const Popover: React.FC<PopoverPrimitive.PopoverProps>;
declare const PopoverTrigger: React.ForwardRefExoticComponent<PopoverPrimitive.PopoverTriggerProps & React.RefAttributes<HTMLButtonElement>>;
declare const PopoverAnchor: React.ForwardRefExoticComponent<PopoverPrimitive.PopoverAnchorProps & React.RefAttributes<HTMLDivElement>>;
declare const PopoverContent: React.ForwardRefExoticComponent<Omit<PopoverPrimitive.PopoverContentProps & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;

declare const Sheet: React.FC<DialogPrimitive.DialogProps>;
declare const SheetTrigger: React.ForwardRefExoticComponent<DialogPrimitive.DialogTriggerProps & React.RefAttributes<HTMLButtonElement>>;
declare const SheetClose: React.ForwardRefExoticComponent<DialogPrimitive.DialogCloseProps & React.RefAttributes<HTMLButtonElement>>;
declare const SheetPortal: ({ children, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Portal>) => react_jsx_runtime.JSX.Element;
declare const SheetOverlay: React.ForwardRefExoticComponent<Omit<DialogPrimitive.DialogOverlayProps & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
declare const sheetVariants: (props?: ({
    side?: "top" | "right" | "bottom" | "left" | null | undefined;
} & class_variance_authority_types.ClassProp) | undefined) => string;
interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, VariantProps<typeof sheetVariants> {
}
declare const SheetContent: React.ForwardRefExoticComponent<SheetContentProps & React.RefAttributes<HTMLDivElement>>;
declare const SheetHeader: {
    ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): react_jsx_runtime.JSX.Element;
    displayName: string;
};
declare const SheetFooter: {
    ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): react_jsx_runtime.JSX.Element;
    displayName: string;
};
declare const SheetTitle: React.ForwardRefExoticComponent<Omit<DialogPrimitive.DialogTitleProps & React.RefAttributes<HTMLHeadingElement>, "ref"> & React.RefAttributes<HTMLHeadingElement>>;
declare const SheetDescription: React.ForwardRefExoticComponent<Omit<DialogPrimitive.DialogDescriptionProps & React.RefAttributes<HTMLParagraphElement>, "ref"> & React.RefAttributes<HTMLParagraphElement>>;

declare const Slider: React.ForwardRefExoticComponent<Omit<SliderPrimitive.SliderProps & React.RefAttributes<HTMLSpanElement>, "ref"> & React.RefAttributes<HTMLSpanElement>>;

declare const Tabs: React.ForwardRefExoticComponent<TabsPrimitive.TabsProps & React.RefAttributes<HTMLDivElement>>;
declare const TabsList: React.ForwardRefExoticComponent<Omit<TabsPrimitive.TabsListProps & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
declare const TabsTrigger: React.ForwardRefExoticComponent<Omit<TabsPrimitive.TabsTriggerProps & React.RefAttributes<HTMLButtonElement>, "ref"> & React.RefAttributes<HTMLButtonElement>>;
declare const TabsContent: React.ForwardRefExoticComponent<Omit<TabsPrimitive.TabsContentProps & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;

declare const TooltipProvider: React.FC<TooltipPrimitive.TooltipProviderProps>;
declare const Tooltip: React.FC<TooltipPrimitive.TooltipProps>;
declare const TooltipTrigger: React.ForwardRefExoticComponent<TooltipPrimitive.TooltipTriggerProps & React.RefAttributes<HTMLButtonElement>>;
declare const TooltipContent: React.ForwardRefExoticComponent<Omit<TooltipPrimitive.TooltipContentProps & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;

/**
 * dataTransfer MIME-like type recognised by the canvas drop handler as an
 * htmlNode-create gesture (vs. an OS image-file drop). The toolbar no longer
 * surfaces a draggable tile for it — html nodes are now created via the
 * programmatic createNode REST endpoint (API/LLM path). Kept so the existing
 * drop branch in demo-canvas continues to compile against a single source of
 * truth for the marker literal.
 */
declare const HTML_BLOCK_DND_TYPE = "application/x-seeflow-create-html-block";
interface CanvasToolbarProps {
    /** Currently armed draw shape, or null when not in draw mode. */
    activeShape: ShapeKind | null;
    /** Toggles draw mode for the given shape; pass null to exit. */
    onSelectShape: (shape: ShapeKind | null) => void;
    /**
     * US-013 (icon picker): controlled-open state for the insert-icon popover.
     * The Insert icon button anchors the IconPickerPopover; the toolbar's parent
     * (demo-canvas) owns the open/close lifecycle so the same slice can serve
     * insert and replace modes from different call sites.
     */
    iconPickerOpen?: boolean;
    /** Open the picker in insert mode. Wired to the toolbar button's click. */
    onOpenIconPicker?: () => void;
    /** Close the picker (outside-click / ESC / programmatic). */
    onCloseIconPicker?: () => void;
    /**
     * Receive the picked icon name. When all four icon-picker props are omitted
     * the Insert icon button is hidden.
     */
    onPickIcon?: (name: string) => void;
}
interface ToolbarShapeEntry {
    shape: ShapeKind;
    label: string;
    /**
     * US-008: registry CommandId for the matching tool-switch entry. Drives
     * `title` / `aria-label` tooltips through `getCommandTooltip` so a label or
     * shortcut change in COMMANDS propagates without re-editing this file.
     */
    commandId: CommandId;
    Icon: typeof Square;
}
declare const TOOLBAR_SHAPES: ToolbarShapeEntry[];
declare function CanvasToolbar({ activeShape, onSelectShape, iconPickerOpen, onOpenIconPicker, onCloseIconPicker, onPickIcon, }: CanvasToolbarProps): react_jsx_runtime.JSX.Element;

interface DetailPanelProps {
    demoId: string | null;
    node: DemoNode | null;
    connector: Connector | null;
    /**
     * Optional canvas adapter used for project-scoped file actions on htmlNode
     * details (Open in editor / Reveal in OS file manager). When omitted or when
     * a method (`openFile` / `revealFile`) is undefined, the corresponding
     * button is hidden so embedders without filesystem support don't render
     * dead affordances.
     */
    adapter?: CanvasAdapter | null;
    onNameChange?: (nodeId: string, name: string) => void;
    onDescriptionChange?: (nodeId: string, value: string) => void;
    onDetailChange?: (nodeId: string, value: string) => void;
    /**
     * US-008: persist a new icon name (or clear it via `null`) from the
     * DetailPanel's Icon row. The row only renders for playNode / stateNode /
     * htmlNode selections; when this callback is undefined the row is hidden
     * (mirroring the read-only gate used by onNameChange / onDescriptionChange).
     */
    onIconChange?: (nodeId: string, icon: string | null) => void;
    /**
     * US-007: latest StatusReport for the selected node, when one exists in the
     * hook's `statusByNode` map. Renders the Status section above the editable
     * fields. Undefined → section is hidden so a node with no statusAction looks
     * identical to before.
     */
    statusReport?: StatusReport & {
        ts: number;
    };
    onClose: () => void;
}
declare function DetailPanel({ demoId, node, connector, adapter, onNameChange, onDescriptionChange, onDetailChange, onIconChange, statusReport, onClose, }: DetailPanelProps): react_jsx_runtime.JSX.Element;
declare function EditableField({ nodeId, value, placeholder, multiline, ariaLabel, testIdBase, onSave, textClassName, markdown, }: {
    nodeId: string;
    value: string;
    placeholder: string;
    multiline: boolean;
    ariaLabel: string;
    testIdBase: string;
    onSave?: (nodeId: string, value: string) => void;
    textClassName?: string;
    markdown?: boolean;
}): react_jsx_runtime.JSX.Element;
declare function HtmlNodeSection({ adapter, htmlPath, }: {
    adapter: CanvasAdapter | null | undefined;
    htmlPath: string;
}): react_jsx_runtime.JSX.Element;
/**
 * Format `ts` (ms epoch) as a coarse "Ns ago" / "Nm ago" / "Nh ago" string
 * relative to `now`. We don't need second-level precision — the section is a
 * heartbeat indicator, not a clock — so we floor each unit and clamp the
 * "just now" window to ≤1s to avoid showing "0s ago".
 */
declare function formatRelativeTime(ts: number, now: number): string;
declare function StatusSection({ report, now, }: {
    report: StatusReport & {
        ts: number;
    };
    now?: number;
}): react_jsx_runtime.JSX.Element;

interface EmbedDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectId: string;
}
/**
 * Modal that surfaces the iframe snippet for embedding a canvas. Mounts via
 * the canvas portal container (inherited from `src/ui/dialog.tsx`) so it lands
 * inside `.seeflow-canvas-root` and inherits the scoped CSS. ShareMenu (US-013)
 * owns the open state.
 */
declare function EmbedDialog({ open, onOpenChange, projectId }: EmbedDialogProps): react_jsx_runtime.JSX.Element;

declare function filterIcons(names: readonly string[], query: string): string[];
interface IconPickerPopoverProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    anchor: ReactNode;
    onPick: (name: string) => void;
}
declare function IconPickerPopover({ open, onOpenChange, anchor, onPick }: IconPickerPopoverProps): react_jsx_runtime.JSX.Element;
interface IconPickerBodyProps {
    query: string;
    onQueryChange: (q: string) => void;
    recents: string[];
    onPick: (name: string) => void;
}
declare function IconPickerBody({ query, onQueryChange, recents, onPick }: IconPickerBodyProps): react_jsx_runtime.JSX.Element;

interface InlineEditProps {
    initialValue: string;
    /** Persist a value (debounced 400ms during typing, immediate on blur/Enter). */
    onCommit: (value: string) => void;
    /** Exit edit mode (called on blur/Enter/Escape after any commit/revert). */
    onExit: () => void;
    /** Allow newlines (Shift+Enter inserts one; plain Enter still finalizes). */
    multiline?: boolean;
    /**
     * 'enter-commits' (default): plain Enter finalizes; Shift+Enter inserts a
     * newline when `multiline` is true. Used for short fields (connector label,
     * detail-panel inputs).
     *
     * 'blur-only': bare Enter inserts a newline (same as Shift+Enter); the only
     * commit path is blur (click-outside) or Escape-cancel. Implies multiline
     * reading semantics (`innerText`), so callers don't need to also pass
     * `multiline`. Used for node labels (US-013) where Enter is a typing key,
     * not a submit key.
     */
    commitMode?: 'enter-commits' | 'blur-only';
    /**
     * Empty value is rejected: revert to the previous value with a shake animation
     * and exit without firing onCommit. Used for fields that the schema mandates
     * (e.g. PlayNode/StateNode label).
     */
    required?: boolean;
    /** data-field attribute for tests; pairs with data-testid='inline-edit-input'. */
    field: string;
    className?: string;
    style?: CSSProperties;
    placeholder?: string;
}
/**
 * Local-state inline editor backed by a contenteditable `<div>` so the editor
 * blends visually with the surrounding text — no input/textarea chrome, no
 * form-field cursor change, no scrollbars on overflow. The component is
 * uncontrolled; `initialValue` seeds the editor on mount and the parent
 * receives changes via `onCommit`.
 *
 * Persistence cadence (per US-026):
 *   • 400ms debounced commit while the user is typing.
 *   • Immediate commit on blur / Enter (cancels any pending debounce).
 *   • Escape cancels both pending and exit-time commits.
 */
declare function InlineEdit({ initialValue, onCommit, onExit, multiline, commitMode, required, field, className, style, placeholder, }: InlineEditProps): react_jsx_runtime.JSX.Element;

type ShareMenuMode = 'edit' | 'view';
interface ShareMenuProps {
    /**
     * Drives view-mode visibility rules. Embed and Export-to-seeflow.dev are
     * force-hidden when `mode === 'view'`, even if their inputs are set. Mode is
     * required so the menu does not need to re-implement `resolveFlags`.
     */
    mode: ShareMenuMode;
    /**
     * Stable identifier the Embed dialog uses to construct the iframe URL. When
     * absent, the Embed menu item is hidden even in edit mode.
     */
    projectId?: string;
    /**
     * Download the current canvas as a PDF. When omitted, the "Download PDF"
     * menu item is hidden. Works in both `edit` and `view` modes.
     */
    onDownloadPdf?: () => Promise<unknown> | unknown;
    /**
     * Download the current canvas as a PNG. When omitted, the "Download PNG"
     * menu item is hidden. Works in both `edit` and `view` modes.
     */
    onDownloadPng?: () => Promise<unknown> | unknown;
    /**
     * Open the host's export-to-cloud dialog. Edit-mode-only opt-in: rendered
     * only when this callback is set AND `mode === 'edit'`.
     */
    onExportToCloud?: () => void;
    /**
     * Controlled `open` state for the inner EmbedDialog. When provided, the menu
     * defers entirely to the host for embed-state ownership (used by
     * SeeflowCanvas's imperative `openEmbedDialog()` handle in US-014). When
     * absent the menu falls back to its own internal state.
     */
    embedOpen?: boolean;
    /**
     * Controlled `onOpenChange` for the inner EmbedDialog. Pairs with
     * `embedOpen`; called both when the user clicks the Embed menu item and when
     * the dialog dismisses (outside-click / ESC / Close). Falls back to internal
     * state when absent.
     */
    onEmbedOpenChange?: (open: boolean) => void;
}
/**
 * Top-right share affordance for SeeflowCanvas. Surfaces Download PDF /
 * Download PNG / Embed / Export to seeflow.dev — each item gated on its own
 * input AND the mode-visibility rules from the design doc. The whole trigger
 * disappears when nothing is renderable.
 */
declare function ShareMenu({ mode, projectId, onDownloadPdf, onDownloadPng, onExportToCloud, embedOpen: embedOpenProp, onEmbedOpenChange, }: ShareMenuProps): react_jsx_runtime.JSX.Element | null;

/**
 * US-007: multi-select bounding-box resize overlay.
 *
 * Rendered when 2+ nodes are selected. Draws a dashed bounding rect around
 * the union of the selection with 8 resize handles (4 corners + 4 edges);
 * dragging a handle scales every selected node — and its size — via the
 * shared `scaleNodesWithinRect` helper (US-002). Shift held during the drag
 * locks the aspect ratio.
 *
 * Locked nodes within the selection pass through unchanged (handled inside
 * the helper, not here). The whole batch dispatches via `onMultiResize` as a
 * single update array so the parent commits one undo entry — Cmd+Z reverts
 * every scaled node together.
 */
/** Minimum shape every node passed to the overlay must satisfy. */
interface OverlayInputNode {
    id: string;
    position: {
        x: number;
        y: number;
    };
    data: {
        width?: number;
        height?: number;
        locked?: boolean;
    };
}
/** Per-node update emitted at resize-stop. */
interface MultiResizeUpdate {
    id: string;
    position: {
        x: number;
        y: number;
    };
    width?: number;
    height?: number;
}
declare const SELECTION_OVERLAY_PADDING = 8;
/** Eight resize anchors. Diagonal-corner names match the cursor wiring. */
type AnchorPos = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
/**
 * Union bounding rect (flow space) covering all input nodes. Reads each
 * node's position + data.width/height (the canonical persisted size — the
 * top-level React Flow `node.width/height` is only present mid-resize and
 * we resolve sizes from the demo data instead). Returns null when no node
 * has a measurable size — there's no rect to draw and no scale to apply.
 */
declare function computeUnionRect(nodes: readonly OverlayInputNode[]): Rect | null;
/** The overlay renders when ≥ 2 nodes are selected. */
declare function selectionEligibleForOverlay(selected: readonly OverlayInputNode[]): boolean;
/**
 * Compute the post-drag rect when the cursor moves by `(dx, dy)` (flow space)
 * while dragging the named anchor. The opposite corner / edge of the rect
 * stays fixed; non-anchored axes are unaffected. When `lockAspectRatio` is
 * true the rect's aspect matches `oldRect` — the scale factor is the smaller
 * of the two axes so the bounding rect never overflows the dragged corner.
 */
declare function computeNewRectFromAnchorDrag(oldRect: Rect, anchor: AnchorPos, dx: number, dy: number, lockAspectRatio: boolean): Rect;
/**
 * Pure resize-stop computation: scale `nodes` from `oldRect` → `newRect`
 * (via the shared helper) and return just the per-node fields the parent
 * needs to PATCH. Locked nodes are filtered out — the helper already passes
 * them through unchanged, so we drop them from the dispatched update set to
 * avoid no-op PATCHes and keep the parent's undo entry compact.
 */
declare function computeSelectionResizeUpdates(nodes: readonly OverlayInputNode[], oldRect: Rect, newRect: Rect, options?: {
    lockAspectRatio?: boolean;
}): MultiResizeUpdate[];
interface SelectionResizeOverlayProps {
    /**
     * Selected nodes the overlay scales. The parent (DemoCanvas) is responsible
     * for filtering: pass the live multi-selection in. The overlay decides
     * presence via `selectionEligibleForOverlay`, so callers can wire this
     * unconditionally.
     */
    selectedNodes: readonly OverlayInputNode[];
    /**
     * Atomic batch dispatch at resize-stop. The canvas hands the array to the
     * parent (demo-view), which fans out PATCHes + pushes one undo entry so
     * Cmd+Z reverts the whole scale. Locked nodes are filtered out before
     * dispatch (no-op PATCHes would just churn the undo log).
     */
    onMultiResize?: (updates: MultiResizeUpdate[]) => void;
    /** Padding around the union rect in flow units. Defaults to 8 per the AC. */
    paddingPx?: number;
}
/**
 * US-016: schedule a per-tick dispatch on the next animation frame, replacing
 * any previously scheduled one for the same gesture. Caps live multi-resize
 * updates at the browser's repaint cadence (~60fps) so a fast drag doesn't
 * spam the parent with more updates per second than it can repaint.
 *
 * The fn argument captures the latest pre-rAF state (closure over current
 * dragState + selectedNodes + newRect); it always represents the freshest
 * scheduled dispatch, not a stale one.
 *
 * Exported for testing — call sites should use it via the overlay's own
 * pointer-move handler.
 */
declare function scheduleRaf(rafRef: {
    current: number | null;
}, fn: () => void): void;
/**
 * Render-side test seam: when `selectionEligibleForOverlay` returns false the
 * component returns null so the parent canvas can wire the overlay
 * unconditionally and not worry about the gating logic.
 */
declare function SelectionResizeOverlay({ selectedNodes, onMultiResize, paddingPx, }: SelectionResizeOverlayProps): null;

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
type SeeflowCanvasMode = 'edit' | 'view' | 'mini';
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
interface CanvasFeatureOverrides {
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
    storageKey?: string;
}
/**
 * US-027: every flag resolved to a concrete boolean. The render body of
 * {@link SeeflowCanvas} reads exclusively from this shape so the gating logic is
 * a single hop away from the mode preset + the overrides.
 */
interface ResolvedCanvasFlags {
    showToolbar: boolean;
    showStyleStrip: boolean;
    showDetailPanel: boolean;
    showStatusBadges: boolean;
    showResizeHandles: boolean;
    showControls: boolean;
    showShareMenu: boolean;
    enableKeyboard: boolean;
    enableContextMenu: boolean;
    enableDragDrop: boolean;
    enableImageDrop: boolean;
    enableZoom: boolean;
    enablePan: boolean;
    enableSelection: boolean;
    enableNodeMove: boolean;
}
/**
 * US-027: resolve the effective flag set from the canvas mode + caller
 * overrides. Pure so it's trivially unit-testable. The function does NOT
 * inspect any SeeflowCanvas prop other than `mode` + the override fields — keeping
 * the contract narrow lets demo-canvas pass exactly the slice it needs and
 * makes the helper safe to import standalone.
 */
declare function resolveFlags(input: {
    mode: SeeflowCanvasMode;
} & Omit<CanvasFeatureOverrides, 'storageKey'>): ResolvedCanvasFlags;
/**
 * US-027: every demo-canvas prop OTHER than the discriminator (`mode`) and
 * `adapter` (whose required-ness flips with mode). Extracted so the
 * discriminated union below can attach the mode-specific shape without
 * duplicating ~50 prop definitions.
 */
interface SeeflowCanvasBaseProps extends CanvasFeatureOverrides {
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
    onNodePositionChange?: (nodeId: string, position: {
        x: number;
        y: number;
    }) => void;
    /**
     * US-013: atomic multi-node drag-stop. Fired once per drag-stop with EVERY
     * moved node's final position when the gesture moves more than one node.
     * The parent commits the whole batch as a single undo entry so one Cmd+Z
     * reverts the entire group move. Wiring this is what enables the canvas to
     * route multi-node drags through the batch path; absent → the canvas falls
     * back to per-node `onNodePositionChange` calls (legacy single-undo-per-id
     * behavior).
     */
    onNodePositionsChange?: (updates: {
        id: string;
        position: {
            x: number;
            y: number;
        };
    }[]) => void;
    /**
     * Fired once per resize-stop with the node's final dimensions AND position.
     * Wiring this enables NodeResizer's resize handles inside each custom node.
     * US-012: top/left handle drags shift x/y so the opposite corner stays
     * anchored — persistence must store both the new size and new position.
     */
    onNodeResize?: (nodeId: string, dims: {
        width: number;
        height: number;
        x: number;
        y: number;
    }) => void;
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
    onCreateShapeNode?: (shape: ShapeKind, position: {
        x: number;
        y: number;
    }, dims: {
        width: number;
        height: number;
    }) => void;
    /**
     * US-008: commit a new imageNode from an OS-image file drop. The canvas
     * detects the drop, computes the natural dims (capped at 400px longest side),
     * and projects the drop client-position into flow-space; the parent owns id
     * allocation, optimistic override, upload POST, and createNode persistence.
     * Wiring this enables the drop handler; absent → OS image drops are ignored.
     */
    onCreateImageFromFile?: (args: {
        file: File;
        position: {
            x: number;
            y: number;
        };
        dims: {
            width: number;
            height: number;
        };
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
    onCreateHtmlNode?: (args: {
        position: {
            x: number;
            y: number;
        };
    }) => void;
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
    onCreateConnector?: (source: string, target: string, options?: {
        targetPin?: EdgePin;
    }) => void;
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
    onReconnectConnector?: (connectorId: string, patch: {
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
    }) => void;
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
    onPasteAt?: (flowPos: {
        x: number;
        y: number;
    }) => void;
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
        position: {
            x: number;
            y: number;
        };
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
    onPinEndpoint?: (connectorId: string, kind: 'source' | 'target', pin: {
        side: 'top' | 'right' | 'bottom' | 'left';
        t: number;
    }) => void;
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
    statusReport?: StatusReport & {
        ts: number;
    };
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
}
/**
 * US-014: imperative handle exposed through `forwardRef`. Lets a host call the
 * canvas's export actions and open the embed dialog without owning the
 * underlying state — useful for command palettes / keyboard shortcuts /
 * external menus where the in-canvas ShareMenu chrome is not the entry point.
 */
interface SeeflowCanvasHandle {
    /** Capture the viewport and save a PDF. Errors surface inline in the canvas. */
    exportPdf(): Promise<void>;
    /** Capture the viewport and save a PNG. Errors surface inline in the canvas. */
    exportPng(): Promise<void>;
    /**
     * Open the embed-snippet dialog programmatically. No-op when the canvas is
     * not rendering its ShareMenu chrome (e.g. mini mode or
     * `showShareMenu: false`) since the dialog is mounted through the menu.
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
}
/**
 * US-027: discriminated union — `adapter` is required in edit mode, optional
 * in view mode (a view-mode embedder has no mutations to persist) and in
 * mini mode (thumbnails dispatch nothing). All three arms share
 * {@link SeeflowCanvasBaseProps}; the discriminator + adapter shape are the
 * only difference. TypeScript narrows `props.adapter` to `CanvasAdapter` in
 * the edit branch without callers having to assert.
 */
type SeeflowCanvasProps = (SeeflowCanvasBaseProps & {
    mode: 'edit';
    adapter: CanvasAdapter;
}) | (SeeflowCanvasBaseProps & {
    mode: 'view';
    adapter?: CanvasAdapter;
}) | (SeeflowCanvasBaseProps & {
    mode: 'mini';
    adapter?: CanvasAdapter;
});
/**
 * US-008: granular auto-fit-view config. Both flags default to `true` when the
 * parent value resolves to a truthy `autoFitView` (i.e. `true` or an object).
 * `onMount` fires once on initial mount after the React Flow instance is
 * available and `nodes.length > 0`. `onExternalNodeChange` (wired in US-009)
 * fires when the host bumps `autoFitViewSignal`.
 */
type AutoFitViewConfig = {
    onMount?: boolean;
    onExternalNodeChange?: boolean;
};
/**
 * US-008: public `autoFitView` prop value. `undefined` / `false` → no
 * auto-fit. `true` → both flags default to `true`. An object lets callers
 * opt into / out of each trigger independently.
 */
type AutoFitView = boolean | AutoFitViewConfig;
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
declare function computeUnmovedLockPin(movingSide: 'source' | 'target', oldEdgeSource: string, oldEdgeTarget: string, edgeData: {
    sourcePin?: {
        side: 'top' | 'right' | 'bottom' | 'left';
        t: number;
    };
    targetPin?: {
        side: 'top' | 'right' | 'bottom' | 'left';
        t: number;
    };
    sourceHandleAutoPicked?: boolean;
    targetHandleAutoPicked?: boolean;
} | undefined, rfGetInternalNode: (id: string) => {
    internals: {
        positionAbsolute: {
            x: number;
            y: number;
        };
    };
    measured: {
        width?: number;
        height?: number;
    };
    width?: number;
    height?: number;
} | null | undefined): EdgePin | undefined;
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
declare function classifyReconnectBodyDrop(movingSide: 'source' | 'target', oldEdgeSource: string, oldEdgeTarget: string, droppedNodeId: string | null): 'no-op' | 'self-loop' | 'pin-own' | 'reconnect-and-pin';
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
declare function classifyHandleDropFailure(toHandle: {
    nodeId: string;
} | null, isValid: boolean | null, _nodes: ReadonlyArray<{
    id: string;
    connectable?: boolean;
}>): 'fall-through' | 'no-flash-no-fall-through';
declare function eventTargetIsOtherNode(target: EventTarget | null, nodeId: string): boolean;
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
interface ClipboardShortcutEventLike {
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    key: string;
    preventDefault: () => void;
}
interface ClipboardShortcutDeps {
    event: ClipboardShortcutEventLike;
    selectedNodeIds: readonly string[];
    hasClipboard: boolean;
    activeElement: Element | null;
    onCopySelection?: (nodeIds: string[]) => void;
    onPasteSelection?: () => void;
}
declare function handleClipboardShortcut(deps: ClipboardShortcutDeps): boolean;
/**
 * US-014: ref-aware wrapper. Hosts use `useRef<SeeflowCanvasHandle>()` +
 * `ref={canvasRef}` to call `exportPdf` / `exportPng` / `openEmbedDialog`
 * from a command palette or keyboard shortcut without owning the underlying
 * state.
 */
declare const SeeflowCanvas: React.ForwardRefExoticComponent<SeeflowCanvasProps & React.RefAttributes<SeeflowCanvasHandle>>;

export { type AutoLayoutEdge, type AutoLayoutNode, type AutoLayoutOptions, BG_FALLBACK, BORDER_FALLBACK, Button, type ButtonProps, COLOR_TOKENS, COMMANDS, type CanvasAdapter, type CanvasDropDispatchArgs, type CanvasFeatureOverrides, type CanvasRuntime, CanvasToolbar, type CanvasToolbarProps, type ClipboardChord, type ClipboardChordInput, type ClipboardShortcutDeps, type ClipboardShortcutEventLike, CloudShape, type ColorToken, Command, type CommandCategory, type CommandContext, type CommandDef, CommandDialog, CommandEmpty, CommandGroup, type CommandId, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut, type Connector, type ConnectorBase, type ConnectorCreateInput, type ConnectorDirection, type ConnectorPatch, type ConnectorPath, type ConnectorStyle, type ConnectorStylePatch, ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger, DEFAULT_STORAGE_PREFIX, DEFAULT_STROKE_WIDTH, DETAIL_PANEL_WIDTH_DEFAULT, DETAIL_PANEL_WIDTH_KEY, DETAIL_PANEL_WIDTH_MAX, DETAIL_PANEL_WIDTH_MIN, DatabaseShape, type Debouncer, type DebouncerOptions, type DefaultConnector, type Demo, type DemoNode, type DerivedEdge, DetailPanel, type DetailPanelProps, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, type EdgeColorStyle, type EdgePin, type EdgePinSide, EditableEdge, type EditableEdgeData, type EditableEdgeType, EditableField, EmbedDialog, type EmbedDialogProps, type Endpoint, type EndpointInput, type EventConnector, type FloatingRect, HTML_BLOCK_DND_TYPE, HTML_DEFAULT_SIZE, type HandleCanvasFileDropArgs, HtmlNode, type HtmlNodeData, type HtmlNodeRuntimeData, HtmlNodeSection, type HtmlNodeType, type HttpAction, type HttpConnector, ICON_DEFAULT_SIZE, ICON_FALLBACK_NAME, ICON_NAMES, ICON_RECENTS_STORAGE_KEY, ICON_REGISTRY, ILLUSTRATIVE_SHAPE_RENDERERS, IMAGE_DEFAULT_SIZE, IMAGE_DROP_EXTS, IMAGE_DROP_MAX_LONGEST_SIDE, IMAGE_DROP_SVG_FALLBACK, IS_MAC, Icon, type IconInsertPayload, type IconInsertRfInstance, type IconInsertViewport, IconNode, type IconNodeData, type IconNodeRuntimeData, type IconNodeType, IconPickerBody, type IconPickerBodyProps, IconPickerPopover, type IconPickerPopoverProps, type IconProps, IconRegistryProvider, type IconRegistryProviderProps, type IconRegistryValue, IconToggleGroup, type IconToggleGroupProps, type IconToggleOption, type ImageDataDefaults, ImageNode, type ImageNodeData, type ImageNodeRuntimeData, type ImageNodeType, InlineEdit, type InlineEditProps, type LastUsedStyle, type LayoutDirection, LineDashedIcon, LineDottedIcon, LineSolidIcon, LockBadge, type ModifierEvent, type MultiResizeUpdate, NEW_NODE_BORDER_WIDTH, NEW_NODE_FONT_SIZE, NODE_DEFAULT_BG_WHITE, type NodeColorStyle, type NodeCreateInput, type NodeData, type NodeDescription, type NodeHeaderColorStyle, type NodeKind, type NodePatch, type NodeStatus, type NodeStylePatch, type NodeVisual, type NudgeDelta, type OverlayInputNode, PathCurveIcon, PathStepIcon, type Pin, PlaceholderCard, PlayNode, type PlayNodeData, type PlayNodeResult, type PlayNodeType, Popover, PopoverAnchor, PopoverContent, PopoverTrigger, type QueueConnector, QueueShape, type Rect, type ReorderOp, ResizeControls, type ResizeControlsProps, type ResizeGestureCallbacks, type ResolvedCanvasFlags, type RestAdapterOptions, type RunResult, SELECTION_OVERLAY_PADDING, SHAPE_CLASS, SHAPE_DEFAULT_SIZE, type ScalableNode, type ScaleNodesOptions, SeeflowCanvas, type SeeflowCanvasHandle, type SeeflowCanvasMode, type SeeflowCanvasProps, SelectionResizeOverlay, type SelectionResizeOverlayProps, ServerShape, type ShapeDataDefaults, type ShapeKind, ShapeNode, type ShapeNodeData, type ShapeNodeRuntimeData, type ShapeNodeType, type ShapePartProps, ShareMenu, type ShareMenuMode, type ShareMenuProps, Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetOverlay, SheetPortal, SheetTitle, SheetTrigger, type ShortcutParts, type Side, Slider, StateNode, type StateNodeData, type StateNodeType, StatusBadge, type StatusBadgeProps, StatusPill, type StatusReport, type StatusReportState, StatusSection, StyleStrip, type StyleStripProps, TOOLBAR_SHAPES, Tabs, TabsContent, TabsList, TabsTrigger, type TextColorStyle, type ToolShortcutResult, type ToolbarShapeEntry, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, type UpdateNodePositionResult, type UploadImageResult, UserShape, type XY, type ZoomAction, applyLayout, applyNudge, buildIconInsertPayload, buildNewImageData, buildNewShapeData, buttonVariants, clampDetailPanelWidth, clampImageDims, classifyHandleDropFailure, classifyReconnectBodyDrop, cn, colorTokenStyle, computeIconInsertPosition, computeImageDims, computeNewRectFromAnchorDrag, computeSelectionResizeUpdates, computeUnionRect, computeUnmovedLockPin, connectorToEdge, createDebouncer, createRestAdapter, dashFor, endpointFromPin, endpointToPin, eventTargetIsOtherNode, extractImageFile, fileUrl, filterIcons, formatRelativeTime, formatShortcut, getCommandTooltip, getLastUsedStyle, getNodeIntersection, getNudgeDelta, getRecents, getStoredDetailPanelWidth, getZoomChord, handleCanvasFileDrop, handleClipboardShortcut, isAcceptableImageFile, projectCursorToPerimeter, pushRecent, rememberConnectorStyle, rememberNodeStyle, resolveClipboardChord, resolveEdgeEndpoints, resolveFlags, resolveToolShortcut, scaleNodesWithinRect, scheduleRaf, selectionEligibleForOverlay, setStoredDetailPanelWidth, shapeChromeClass, shapeChromeStyle, startResizeGesture, styleForKind, useIconRegistry, useResizeGesture };
