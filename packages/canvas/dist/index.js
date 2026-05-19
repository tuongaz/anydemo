// src/lib/color-tokens.ts
var COLOR_TOKEN_MAP = {
  default: {
    border: "hsl(var(--border))",
    background: "hsl(var(--card))",
    edge: "hsl(var(--muted-foreground))",
    headerBackground: "hsl(var(--muted))"
  },
  slate: {
    border: "hsl(215, 20%, 40%)",
    background: "hsl(215, 15%, 15%)",
    edge: "hsl(215, 16%, 47%)",
    headerBackground: "hsl(215, 15%, 11%)"
  },
  blue: {
    border: "hsl(213, 70%, 55%)",
    background: "hsl(214, 30%, 14%)",
    edge: "hsl(217, 91%, 60%)",
    headerBackground: "hsl(214, 30%, 10%)"
  },
  green: {
    border: "hsl(142, 50%, 45%)",
    background: "hsl(142, 25%, 13%)",
    edge: "hsl(142, 71%, 45%)",
    headerBackground: "hsl(142, 25%, 9%)"
  },
  amber: {
    border: "hsl(43, 70%, 50%)",
    background: "hsl(43, 30%, 14%)",
    edge: "hsl(38, 92%, 50%)",
    headerBackground: "hsl(43, 30%, 10%)"
  },
  red: {
    border: "hsl(0, 70%, 55%)",
    background: "hsl(0, 25%, 14%)",
    edge: "hsl(0, 84%, 60%)",
    headerBackground: "hsl(0, 25%, 10%)"
  },
  purple: {
    border: "hsl(270, 60%, 60%)",
    background: "hsl(270, 20%, 15%)",
    edge: "hsl(271, 91%, 65%)",
    headerBackground: "hsl(270, 20%, 11%)"
  },
  pink: {
    border: "hsl(330, 60%, 60%)",
    background: "hsl(330, 20%, 14%)",
    edge: "hsl(330, 81%, 60%)",
    headerBackground: "hsl(330, 20%, 10%)"
  }
};
var COLOR_TOKENS = COLOR_TOKEN_MAP;
var NODE_DEFAULT_BG_WHITE = "hsl(var(--card))";
function colorTokenStyle(token, kind) {
  const resolved = token ?? "default";
  const entry = COLOR_TOKEN_MAP[resolved];
  if (kind === "edge") return { stroke: entry.edge };
  if (kind === "text") return resolved === "default" ? {} : { color: entry.edge };
  if (kind === "node-header") return { backgroundColor: entry.headerBackground };
  return { borderColor: entry.border, backgroundColor: entry.background };
}

// src/lib/icon-registry.ts
import * as Lucide from "lucide-react";
var NON_ICON_EXPORTS = /* @__PURE__ */ new Set(["createLucideIcon", "Icon", "icons", "default"]);
var FORWARD_REF_SYMBOL = /* @__PURE__ */ Symbol.for("react.forward_ref");
function isLucideIconComponent(value) {
  if (typeof value === "function") return true;
  if (value !== null && typeof value === "object") {
    const tag = value.$$typeof;
    return tag === FORWARD_REF_SYMBOL;
  }
  return false;
}
function pascalToKebab(name) {
  return name.replace(
    /[A-Z]/g,
    (char, index) => index === 0 ? char.toLowerCase() : `-${char.toLowerCase()}`
  );
}
function buildRegistry() {
  const registry = {};
  for (const [name, value] of Object.entries(Lucide)) {
    if (NON_ICON_EXPORTS.has(name)) continue;
    if (!isLucideIconComponent(value)) continue;
    registry[pascalToKebab(name)] = value;
  }
  return registry;
}
var ICON_REGISTRY = buildRegistry();
var ICON_FALLBACK_NAME = "help-circle";
var ICON_NAMES = Object.keys(ICON_REGISTRY).sort();

// src/lib/auto-layout.ts
import dagre from "dagre";
var DEFAULTS = { direction: "LR", nodesep: 60, ranksep: 140 };
var applyLayout = (nodes, edges, opts) => {
  const out = /* @__PURE__ */ new Map();
  if (nodes.length === 0) return out;
  if (nodes.length === 1) {
    const only = nodes[0];
    if (only) out.set(only.id, { x: only.position.x, y: only.position.y });
    return out;
  }
  const direction = opts?.direction ?? DEFAULTS.direction;
  const nodesep = opts?.nodesep ?? DEFAULTS.nodesep;
  const ranksep = opts?.ranksep ?? DEFAULTS.ranksep;
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: direction, nodesep, ranksep });
  g.setDefaultEdgeLabel(() => ({}));
  const ids = /* @__PURE__ */ new Set();
  for (const n of nodes) {
    g.setNode(n.id, { width: n.width, height: n.height });
    ids.add(n.id);
  }
  let edgeCounter = 0;
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    g.setEdge(e.source, e.target, {}, `e${edgeCounter++}`);
  }
  dagre.layout(g);
  for (const n of nodes) {
    const laid = g.node(n.id);
    if (!laid) continue;
    out.set(n.id, { x: laid.x - n.width / 2, y: laid.y - n.height / 2 });
  }
  return out;
};

// src/lib/canvas-drop.ts
var IMAGE_DROP_EXTS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg"
];
var IMAGE_DROP_MAX_LONGEST_SIDE = 400;
var IMAGE_DROP_SVG_FALLBACK = { width: 200, height: 200 };
var lowerExtOf = (name) => {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
};
var isAcceptableImageFile = (file) => {
  if (file.type.startsWith("image/")) {
    const subtype = file.type.slice("image/".length).toLowerCase();
    if (subtype === "png" || subtype === "jpeg" || subtype === "jpg" || subtype === "gif" || subtype === "webp" || subtype === "svg+xml") {
      return true;
    }
  }
  return IMAGE_DROP_EXTS.includes(lowerExtOf(file.name));
};
var extractImageFile = (dt) => {
  if (!dt) return null;
  const files = dt.files;
  if (!files || files.length === 0) return null;
  for (let i = 0; i < files.length; i++) {
    const f = files.item(i);
    if (f && isAcceptableImageFile(f)) return f;
  }
  return null;
};
var clampImageDims = (natural, max = IMAGE_DROP_MAX_LONGEST_SIDE) => {
  if (natural.width <= 0 || natural.height <= 0) {
    return { ...IMAGE_DROP_SVG_FALLBACK };
  }
  const longest = Math.max(natural.width, natural.height);
  if (longest <= max) {
    return { width: Math.round(natural.width), height: Math.round(natural.height) };
  }
  const scale = max / longest;
  return {
    width: Math.round(natural.width * scale),
    height: Math.round(natural.height * scale)
  };
};
var handleCanvasFileDrop = async (args) => {
  const file = extractImageFile(args.dataTransfer);
  if (!file) return false;
  if (!args.rfInstance) return false;
  const dropFlowOrigin = args.rfInstance.screenToFlowPosition(args.clientPos);
  const dims = await args.computeDims(file);
  args.dispatch({
    file,
    position: { x: dropFlowOrigin.x - dims.width / 2, y: dropFlowOrigin.y - dims.height / 2 },
    dims,
    originalFilename: file.name
  });
  return true;
};
var computeImageDims = (file) => {
  return new Promise((resolve) => {
    let url = null;
    const settle = (dims) => {
      if (url) URL.revokeObjectURL(url);
      resolve(dims);
    };
    try {
      url = URL.createObjectURL(file);
    } catch {
      resolve({ ...IMAGE_DROP_SVG_FALLBACK });
      return;
    }
    const img = new Image();
    img.onload = () => {
      settle(clampImageDims({ width: img.naturalWidth, height: img.naturalHeight }));
    };
    img.onerror = () => {
      settle({ ...IMAGE_DROP_SVG_FALLBACK });
    };
    img.src = url;
  });
};

// src/lib/cn.ts
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// src/lib/connector-to-edge.ts
import { MarkerType } from "@xyflow/react";
var EDGE_INTERACTION_WIDTH = 24;
var arrowMarker = (color) => ({
  type: MarkerType.ArrowClosed,
  width: 18,
  height: 18,
  ...color ? { color } : {}
});
var STYLE_BY_KIND = {
  http: {},
  event: { strokeDasharray: "6 4" },
  queue: { strokeDasharray: "2 4" },
  default: {}
};
var STYLE_BY_NAME = {
  solid: {},
  dashed: { strokeDasharray: "6 4" },
  dotted: { strokeDasharray: "2 4" }
};
var styleForKind = (kind) => STYLE_BY_KIND[kind];
var SELECTED_STROKE_WIDTH = 3;
var edgeCache = /* @__PURE__ */ new WeakMap();
var connectorToEdge = (connector, isAdjacentToRunning, selected = false) => {
  const cached = edgeCache.get(connector);
  if (cached && cached.isAdjacentToRunning === isAdjacentToRunning && cached.selected === selected) {
    return cached.edge;
  }
  const dashStyle = connector.style ? STYLE_BY_NAME[connector.style] : STYLE_BY_KIND[connector.kind];
  const colorStyle = colorTokenStyle(connector.color, "edge");
  const baseStrokeWidth = connector.borderSize ?? 2;
  const strokeWidth = selected ? Math.max(SELECTED_STROKE_WIDTH, baseStrokeWidth) : baseStrokeWidth;
  const sizeStyle = selected ? { strokeWidth, opacity: 1 } : { strokeWidth };
  const style = { ...dashStyle, ...colorStyle, ...sizeStyle };
  const direction = connector.direction ?? "forward";
  const markerColor = colorStyle.stroke;
  const arrow = arrowMarker(markerColor);
  const markerStart = direction === "backward" || direction === "both" ? arrow : void 0;
  const markerEnd = direction === "forward" || direction === "both" ? arrow : void 0;
  const edge = {
    id: connector.id,
    source: connector.source,
    target: connector.target,
    sourceHandle: connector.sourceHandle,
    targetHandle: connector.targetHandle,
    type: "editableEdge",
    label: connector.label,
    animated: isAdjacentToRunning,
    data: {
      kind: connector.kind,
      path: connector.path,
      sourceHandleAutoPicked: connector.sourceHandleAutoPicked,
      targetHandleAutoPicked: connector.targetHandleAutoPicked,
      sourcePin: connector.sourcePin,
      targetPin: connector.targetPin,
      fontSize: connector.fontSize
    },
    style,
    markerStart,
    markerEnd,
    interactionWidth: EDGE_INTERACTION_WIDTH
  };
  edgeCache.set(connector, { isAdjacentToRunning, selected, edge });
  return edge;
};

// src/lib/debounce.ts
var createDebouncer = (delayMs, options = {}) => {
  const setTimer = options.setTimer ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle2) => {
    globalThis.clearTimeout(handle2);
  });
  let handle = null;
  let nextRun = null;
  const cancel = () => {
    if (handle !== null) {
      clearTimer(handle);
      handle = null;
    }
    nextRun = null;
  };
  const flush = () => {
    if (handle !== null) {
      clearTimer(handle);
      handle = null;
    }
    const run = nextRun;
    nextRun = null;
    if (run) run();
  };
  const schedule = (run) => {
    if (handle !== null) clearTimer(handle);
    nextRun = run;
    handle = setTimer(() => {
      handle = null;
      const pending = nextRun;
      nextRun = null;
      if (pending) pending();
    }, delayMs);
  };
  return {
    schedule,
    flush,
    cancel,
    get pending() {
      return handle !== null;
    }
  };
};

// src/lib/detail-panel-width.ts
var DETAIL_PANEL_WIDTH_KEY = "seeflow:detail-panel-width";
var DETAIL_PANEL_WIDTH_DEFAULT = 380;
var DETAIL_PANEL_WIDTH_MIN = 320;
var DETAIL_PANEL_WIDTH_MAX = 800;
function clampDetailPanelWidth(value) {
  if (!Number.isFinite(value)) return DETAIL_PANEL_WIDTH_DEFAULT;
  if (value < DETAIL_PANEL_WIDTH_MIN) return DETAIL_PANEL_WIDTH_MIN;
  if (value > DETAIL_PANEL_WIDTH_MAX) return DETAIL_PANEL_WIDTH_MAX;
  return value;
}
function getStoredDetailPanelWidth() {
  if (typeof window === "undefined") return DETAIL_PANEL_WIDTH_DEFAULT;
  try {
    const raw = window.localStorage.getItem(DETAIL_PANEL_WIDTH_KEY);
    if (raw === null) return DETAIL_PANEL_WIDTH_DEFAULT;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DETAIL_PANEL_WIDTH_DEFAULT;
    if (parsed < DETAIL_PANEL_WIDTH_MIN || parsed > DETAIL_PANEL_WIDTH_MAX) {
      return DETAIL_PANEL_WIDTH_DEFAULT;
    }
    return parsed;
  } catch {
    return DETAIL_PANEL_WIDTH_DEFAULT;
  }
}
function setStoredDetailPanelWidth(width) {
  if (typeof window === "undefined") return;
  try {
    const clamped = clampDetailPanelWidth(width);
    window.localStorage.setItem(DETAIL_PANEL_WIDTH_KEY, String(clamped));
  } catch {
  }
}
function startResizeGesture(startWidth, startClientX, callbacks, target) {
  const win = target ?? (typeof window === "undefined" ? null : window);
  if (!win) return;
  let current = clampDetailPanelWidth(startWidth);
  const onMove = (e) => {
    current = clampDetailPanelWidth(startWidth + (startClientX - e.clientX));
    callbacks.onWidth(current);
  };
  const onUp = () => {
    win.removeEventListener("pointermove", onMove);
    win.removeEventListener("pointerup", onUp);
    win.removeEventListener("pointercancel", onUp);
    callbacks.onCommit(current);
  };
  win.addEventListener("pointermove", onMove);
  win.addEventListener("pointerup", onUp);
  win.addEventListener("pointercancel", onUp);
}

// src/lib/file-url.ts
function fileUrl(projectId, path) {
  return `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(path)}`;
}

// src/lib/floating-edge-geometry.ts
var getNodeIntersection = (rect, otherCenter) => {
  const halfW = rect.w / 2;
  const halfH = rect.h / 2;
  const cx = rect.x + halfW;
  const cy = rect.y + halfH;
  const dx = otherCenter.x - cx;
  const dy = otherCenter.y - cy;
  if (dx === 0 && dy === 0) {
    return { x: cx, y: cy, side: "right" };
  }
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const tx = absDx === 0 ? Number.POSITIVE_INFINITY : halfW / absDx;
  const ty = absDy === 0 ? Number.POSITIVE_INFINITY : halfH / absDy;
  const t = Math.min(tx, ty);
  const x = cx + dx * t;
  const y = cy + dy * t;
  const side = absDx * halfH >= absDy * halfW ? dx >= 0 ? "right" : "left" : dy >= 0 ? "bottom" : "top";
  return { x, y, side };
};
var projectCursorToPerimeter = (rect, cursor) => {
  const relX = Math.max(0, Math.min(rect.w, cursor.x - rect.x));
  const relY = Math.max(0, Math.min(rect.h, cursor.y - rect.y));
  const dLeft = relX;
  const dRight = rect.w - relX;
  const dTop = relY;
  const dBottom = rect.h - relY;
  const min = Math.min(dLeft, dRight, dTop, dBottom);
  const tVertical = rect.h === 0 ? 0 : relY / rect.h;
  const tHorizontal = rect.w === 0 ? 0 : relX / rect.w;
  if (min === dLeft) return { side: "left", t: tVertical };
  if (min === dRight) return { side: "right", t: tVertical };
  if (min === dTop) return { side: "top", t: tHorizontal };
  return { side: "bottom", t: tHorizontal };
};
var endpointFromPin = (rect, pin) => {
  const t = Math.min(1, Math.max(0, pin.t));
  let x;
  let y;
  switch (pin.side) {
    case "top":
      x = rect.x + t * rect.w;
      y = rect.y;
      break;
    case "bottom":
      x = rect.x + t * rect.w;
      y = rect.y + rect.h;
      break;
    case "left":
      x = rect.x;
      y = rect.y + t * rect.h;
      break;
    case "right":
      x = rect.x + rect.w;
      y = rect.y + t * rect.h;
      break;
  }
  return { x, y, side: pin.side };
};
var endpointToPin = (rect, endpoint) => {
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  switch (endpoint.side) {
    case "top":
    case "bottom":
      return {
        side: endpoint.side,
        t: rect.w === 0 ? 0 : clamp01((endpoint.x - rect.x) / rect.w)
      };
    case "left":
    case "right":
      return {
        side: endpoint.side,
        t: rect.h === 0 ? 0 : clamp01((endpoint.y - rect.y) / rect.h)
      };
  }
};
var resolveEdgeEndpoints = (source, target) => {
  const sourceFallback = source?.fallback ?? { x: 0, y: 0, side: "right" };
  const targetFallback = target?.fallback ?? { x: 0, y: 0, side: "left" };
  if (!source || !target) {
    return { source: sourceFallback, target: targetFallback };
  }
  const sCenter = { x: source.box.x + source.box.w / 2, y: source.box.y + source.box.h / 2 };
  const tCenter = { x: target.box.x + target.box.w / 2, y: target.box.y + target.box.h / 2 };
  const resolvedSource = source.pin ? endpointFromPin(source.box, source.pin) : source.autoPicked === false ? source.fallback : getNodeIntersection(source.box, tCenter);
  const resolvedTarget = target.pin ? endpointFromPin(target.box, target.pin) : target.autoPicked === false ? target.fallback : getNodeIntersection(target.box, sCenter);
  return { source: resolvedSource, target: resolvedTarget };
};

// src/nodes/icon-node.tsx
import { Handle, Position } from "@xyflow/react";
import { memo, useState as useState3 } from "react";

// src/components/inline-edit.tsx
import { useEffect, useRef, useState } from "react";
import { jsx } from "react/jsx-runtime";
function InlineEdit({
  initialValue,
  onCommit,
  onExit,
  multiline = false,
  commitMode = "enter-commits",
  required = false,
  field,
  className,
  style,
  placeholder
}) {
  const isMultiline = multiline || commitMode === "blur-only";
  const editorRef = useRef(null);
  const [shake, setShake] = useState(false);
  const [empty2, setEmpty] = useState(initialValue.length === 0);
  const debouncerRef = useRef(createDebouncer(400));
  const lastCommittedRef = useRef(initialValue);
  const skipBlurRef = useRef(false);
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.textContent = initialValue;
    el.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    const debouncer = debouncerRef.current;
    return () => {
      debouncer.cancel();
    };
  }, []);
  const readValue = () => {
    const el = editorRef.current;
    if (!el) return "";
    return isMultiline ? el.innerText : el.textContent ?? "";
  };
  const commitNow = (next) => {
    debouncerRef.current.cancel();
    if (next === lastCommittedRef.current) return;
    lastCommittedRef.current = next;
    onCommit(next);
  };
  const handleInput = () => {
    const next = readValue();
    setEmpty(next.length === 0);
    if (required && next.trim().length === 0) {
      debouncerRef.current.cancel();
      return;
    }
    debouncerRef.current.schedule(() => commitNow(next));
  };
  const finalize = () => {
    debouncerRef.current.cancel();
    const next = readValue();
    if (required && next.trim().length === 0) {
      const el = editorRef.current;
      if (el) el.textContent = initialValue;
      setShake(true);
      setTimeout(() => setShake(false), 320);
      onExit();
      return;
    }
    commitNow(next);
    onExit();
  };
  const cancel = () => {
    debouncerRef.current.cancel();
    const el = editorRef.current;
    if (el) el.textContent = initialValue;
    onExit();
  };
  const onKeyDown = (e) => {
    e.stopPropagation();
    e.nativeEvent.stopPropagation();
    if (e.key === "Enter") {
      const insertNewline = commitMode === "blur-only" || multiline && e.shiftKey;
      if (insertNewline) {
        e.preventDefault();
        document.execCommand("insertText", false, "\n");
        return;
      }
      e.preventDefault();
      skipBlurRef.current = true;
      finalize();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      skipBlurRef.current = true;
      cancel();
    }
  };
  const onPaste = (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  };
  const onBlur = () => {
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    finalize();
  };
  return /* @__PURE__ */ jsx(
    "div",
    {
      ref: editorRef,
      "data-testid": "inline-edit-input",
      "data-field": field,
      "data-placeholder": placeholder,
      role: "textbox",
      tabIndex: 0,
      contentEditable: true,
      suppressContentEditableWarning: true,
      spellCheck: false,
      onInput: handleInput,
      onKeyDown,
      onPaste,
      onBlur,
      onMouseDown: (e) => e.stopPropagation(),
      onClick: (e) => e.stopPropagation(),
      onDoubleClick: (e) => e.stopPropagation(),
      style,
      className: cn(
        "nodrag nopan nowheel block w-full bg-transparent p-0 text-inherit outline-none",
        "sf-whitespace-pre-wrap sf-break-words",
        empty2 && placeholder ? "inline-edit-empty" : "",
        shake ? "inline-edit-shake" : "",
        className
      )
    }
  );
}

// src/nodes/lock-badge.tsx
import { Lock } from "lucide-react";
import { jsx as jsx2 } from "react/jsx-runtime";
function LockBadge({ className }) {
  return /* @__PURE__ */ jsx2(
    "span",
    {
      "data-testid": "node-lock-badge",
      "aria-hidden": "true",
      className: cn(
        "sf-absolute -sf-top-2 -sf-right-2 sf-z-10 sf-inline-flex sf-h-4 sf-w-4 sf-items-center sf-justify-center sf-rounded-sm sf-bg-background/90 sf-text-muted-foreground sf-shadow-sm sf-ring-1 sf-ring-border",
        className
      ),
      children: /* @__PURE__ */ jsx2(Lock, { className: "sf-h-2.5 sf-w-2.5", strokeWidth: 2.5 })
    }
  );
}

// src/nodes/resize-controls.tsx
import {
  NodeResizeControl,
  ResizeControlVariant
} from "@xyflow/react";
import { Fragment, jsx as jsx3, jsxs } from "react/jsx-runtime";
var LINE_HIT = 8;
var CORNER_HIT = 12;
var HORIZONTAL_LINE_STYLE = {
  height: `${LINE_HIT}px`,
  borderColor: "transparent"
};
var VERTICAL_LINE_STYLE = {
  width: `${LINE_HIT}px`,
  borderColor: "transparent"
};
var CORNER_STYLE = {
  width: `${CORNER_HIT}px`,
  height: `${CORNER_HIT}px`,
  background: "transparent",
  border: "none"
};
var VISIBLE_CORNER_STYLE = {
  width: "calc(10px / var(--rf-zoom, 1))",
  height: "calc(10px / var(--rf-zoom, 1))",
  background: "hsl(var(--background))",
  border: "calc(1px / var(--rf-zoom, 1)) solid hsl(var(--primary) / 0.6)",
  borderRadius: "calc(2px / var(--rf-zoom, 1))",
  zIndex: 1
};
var LINE_POSITIONS = [
  { position: "top", style: HORIZONTAL_LINE_STYLE },
  { position: "bottom", style: HORIZONTAL_LINE_STYLE },
  { position: "left", style: VERTICAL_LINE_STYLE },
  { position: "right", style: VERTICAL_LINE_STYLE }
];
var CORNER_POSITIONS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right"
];
var HIDDEN_OVERRIDE = {
  pointerEvents: "none",
  cursor: "default"
};
function ResizeControls({
  visible,
  minWidth = 80,
  minHeight = 40,
  onResizeStart,
  onResize,
  onResizeEnd,
  cornerVariant = "invisible"
}) {
  const baseCornerStyle = cornerVariant === "visible" ? VISIBLE_CORNER_STYLE : CORNER_STYLE;
  const lineStyle = (style) => visible ? style : { ...style, ...HIDDEN_OVERRIDE };
  const cornerStyle = visible ? baseCornerStyle : { ...baseCornerStyle, opacity: 0, ...HIDDEN_OVERRIDE };
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    LINE_POSITIONS.map(({ position, style }) => /* @__PURE__ */ jsx3(
      NodeResizeControl,
      {
        position,
        variant: ResizeControlVariant.Line,
        minWidth,
        minHeight,
        style: lineStyle(style),
        onResizeStart,
        onResize,
        onResizeEnd,
        children: /* @__PURE__ */ jsx3("span", { "data-testid": "resize-control", "data-position": position })
      },
      position
    )),
    CORNER_POSITIONS.map((position) => /* @__PURE__ */ jsx3(
      NodeResizeControl,
      {
        position,
        variant: ResizeControlVariant.Handle,
        minWidth,
        minHeight,
        style: cornerStyle,
        autoScale: false,
        onResizeStart,
        onResize,
        onResizeEnd,
        children: /* @__PURE__ */ jsx3("span", { "data-testid": "resize-control", "data-position": position })
      },
      position
    ))
  ] });
}

// src/nodes/use-resize-gesture.ts
import { useCallback, useEffect as useEffect2, useRef as useRef2, useState as useState2 } from "react";
function useResizeGesture(args) {
  const { onResize, onResizeFinal, setResizing } = args;
  const [isResizing, setIsResizing] = useState2(false);
  const startRef = useRef2(null);
  const onResizeRef = useRef2(onResize);
  const onResizeFinalRef = useRef2(onResizeFinal);
  const setResizingRef = useRef2(setResizing);
  useEffect2(() => {
    onResizeRef.current = onResize;
  }, [onResize]);
  useEffect2(() => {
    onResizeFinalRef.current = onResizeFinal;
  }, [onResizeFinal]);
  useEffect2(() => {
    setResizingRef.current = setResizing;
  }, [setResizing]);
  const onResizeStart = useCallback((_e, params) => {
    setIsResizing(true);
    setResizingRef.current?.(true);
    startRef.current = params ? { x: params.x, y: params.y, width: params.width, height: params.height } : null;
  }, []);
  const onResizeEvent = useCallback((_e, params) => {
    onResizeRef.current?.({
      x: params.x,
      y: params.y,
      width: params.width,
      height: params.height
    });
  }, []);
  const onResizeEnd = useCallback((_e, params) => {
    setIsResizing(false);
    setResizingRef.current?.(false);
    const start = startRef.current;
    startRef.current = null;
    if (start && start.width === params.width && start.height === params.height) {
      return;
    }
    onResizeRef.current?.({
      x: params.x,
      y: params.y,
      width: params.width,
      height: params.height
    });
    if (start) {
      onResizeFinalRef.current?.(
        {
          x: params.x,
          y: params.y,
          width: params.width,
          height: params.height
        },
        start
      );
    }
  }, []);
  return { isResizing, onResizeStart, onResizeEvent, onResizeEnd };
}

// src/nodes/icon-node.tsx
import { jsx as jsx4, jsxs as jsxs2 } from "react/jsx-runtime";
var ICON_DEFAULT_SIZE = { width: 48, height: 48 };
var ICON_FALLBACK_NAME2 = "help-circle";
var MIN_W = 24;
var MIN_H = 24;
var HANDLE_CLASS = "sf-opacity-0 sf-transition-opacity";
function resolveIconColor(token) {
  return colorTokenStyle(token, "text").color ?? "currentColor";
}
var WARNED_NAMES = /* @__PURE__ */ new Set();
function IconNodeImpl({ id, data, selected, isConnectable }) {
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    setResizing: data.setResizing
  });
  const sized = data.width !== void 0 || data.height !== void 0;
  const nameEditable = !!data.onNameChange;
  const [isEditing, setIsEditing] = useState3(false);
  const requested = ICON_REGISTRY[data.icon];
  if (!requested && !WARNED_NAMES.has(data.icon)) {
    WARNED_NAMES.add(data.icon);
    console.warn(
      `[iconNode] Unknown icon "${data.icon}"; falling back to "${ICON_FALLBACK_NAME2}".`
    );
  }
  const IconComponent = requested ?? ICON_REGISTRY[ICON_FALLBACK_NAME2];
  const iconColor = resolveIconColor(data.color);
  const strokeWidth = data.strokeWidth ?? 2;
  const containerStyle = {
    ...sized ? {} : { width: ICON_DEFAULT_SIZE.width, height: ICON_DEFAULT_SIZE.height }
  };
  const handleDoubleClick = (e) => {
    if (!nameEditable || isEditing) return;
    e.stopPropagation();
    setIsEditing(true);
  };
  return /* @__PURE__ */ jsxs2(
    "div",
    {
      className: cn("sf-group sf-relative", sized ? "sf-h-full sf-w-full" : ""),
      style: containerStyle,
      "data-testid": "icon-node",
      onDoubleClick: handleDoubleClick,
      children: [
        /* @__PURE__ */ jsx4(
          ResizeControls,
          {
            visible: !!selected && !!data.onResize && !isEditing && !data.locked,
            cornerVariant: "visible",
            minWidth: MIN_W,
            minHeight: MIN_H,
            onResizeStart,
            onResize: onResizeEvent,
            onResizeEnd
          }
        ),
        data.locked ? /* @__PURE__ */ jsx4(LockBadge, {}) : null,
        /* @__PURE__ */ jsx4(
          Handle,
          {
            type: "target",
            position: Position.Top,
            id: "t",
            isConnectable,
            className: cn(HANDLE_CLASS, selected && "!sf-opacity-100")
          }
        ),
        /* @__PURE__ */ jsx4(
          Handle,
          {
            type: "target",
            position: Position.Left,
            id: "l",
            isConnectable,
            className: cn(HANDLE_CLASS, selected && "!sf-opacity-100")
          }
        ),
        IconComponent ? /* @__PURE__ */ jsx4(
          IconComponent,
          {
            color: iconColor,
            strokeWidth,
            absoluteStrokeWidth: true,
            "aria-label": data.alt,
            className: "sf-block sf-h-full sf-w-full sf-pointer-events-none sf-select-none"
          }
        ) : null,
        isEditing && nameEditable ? (
          // US-004: positioned where the read-mode caption would render (below
          // the icon, full node width, centered). Wrapped in an absolutely
          // positioned strip so the icon's bounding box (read by React Flow
          // for layout + edge geometry) stays identical to the read state.
          /* @__PURE__ */ jsx4("div", { className: "sf-absolute sf-left-0 sf-right-0 sf-top-full sf-mt-1 sf-text-center sf-text-xs sf-text-muted-foreground", children: /* @__PURE__ */ jsx4(
            InlineEdit,
            {
              initialValue: data.name ?? "",
              field: "icon-node-label",
              onCommit: (v) => data.onNameChange?.(id, v),
              onExit: () => setIsEditing(false),
              placeholder: "Label"
            }
          ) })
        ) : data.name ? (
          // US-002: caption below the icon. Absolutely positioned so the icon's
          // bounding box (read by React Flow for layout + edge geometry) is
          // identical whether or not a label is set. Width matches the node so
          // `truncate` clips overflow to an ellipsis at the node's edges.
          /* @__PURE__ */ jsx4(
            "span",
            {
              "data-testid": "icon-node-label",
              className: "sf-pointer-events-none sf-absolute sf-left-0 sf-right-0 sf-top-full sf-mt-1 sf-truncate sf-text-center sf-text-xs sf-text-muted-foreground sf-select-none",
              children: data.name
            }
          )
        ) : null,
        /* @__PURE__ */ jsx4(
          Handle,
          {
            type: "source",
            position: Position.Right,
            id: "r",
            isConnectable,
            className: cn(HANDLE_CLASS, selected && "!sf-opacity-100")
          }
        ),
        /* @__PURE__ */ jsx4(
          Handle,
          {
            type: "source",
            position: Position.Bottom,
            id: "b",
            isConnectable,
            className: cn(HANDLE_CLASS, selected && "!sf-opacity-100")
          }
        )
      ]
    }
  );
}
function arePropsEqual(prev, next) {
  return prev.selected === next.selected && prev.data === next.data && prev.width === next.width && prev.height === next.height;
}
var IconNode = memo(IconNodeImpl, arePropsEqual);

// src/lib/icon-insert.ts
function computeIconInsertPosition(rfInstance, viewport) {
  const center = rfInstance.screenToFlowPosition({
    x: viewport.width / 2,
    y: viewport.height / 2
  });
  return {
    x: center.x - ICON_DEFAULT_SIZE.width / 2,
    y: center.y - ICON_DEFAULT_SIZE.height / 2
  };
}
function buildIconInsertPayload(args) {
  const position = computeIconInsertPosition(args.rfInstance, args.viewport);
  return {
    type: "iconNode",
    position,
    data: {
      icon: args.iconName,
      width: ICON_DEFAULT_SIZE.width,
      height: ICON_DEFAULT_SIZE.height
    }
  };
}

// src/lib/icon-recents.ts
var ICON_RECENTS_STORAGE_KEY = "seeflow:icon-recents";
var MAX_RECENTS = 16;
function getRecents() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ICON_RECENTS_STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    if (!parsed.every((entry) => typeof entry === "string")) return [];
    return parsed;
  } catch {
    return [];
  }
}
function pushRecent(name) {
  if (typeof window === "undefined") return;
  try {
    const current = getRecents();
    const deduped = current.filter((entry) => entry !== name);
    const next = [name, ...deduped].slice(0, MAX_RECENTS);
    window.localStorage.setItem(ICON_RECENTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
  }
}

// src/lib/keyboard-shortcuts.ts
var IS_MAC = typeof navigator !== "undefined" && typeof navigator.platform === "string" && navigator.platform.toLowerCase().includes("mac");
var formatKey = (key) => {
  if (key.length === 1) return key.toUpperCase();
  if (key === "Escape") return "Esc";
  return key;
};
var formatShortcut = (parts, isMac = IS_MAC) => {
  const keyLabel = formatKey(parts.key);
  if (isMac) {
    let out = "";
    if (parts.meta) out += "\u2318";
    if (parts.alt) out += "\u2325";
    if (parts.shift) out += "\u21E7";
    return `${out}${keyLabel}`;
  }
  const tokens = [];
  if (parts.meta) tokens.push("Ctrl");
  if (parts.shift) tokens.push("Shift");
  if (parts.alt) tokens.push("Alt");
  tokens.push(keyLabel);
  return tokens.join("+");
};
var COMMANDS = [
  {
    id: "tool.select",
    label: "Select tool",
    description: "Switch to the selection / pan tool",
    category: "Tools",
    shortcut: formatShortcut({ key: "V" })
  },
  {
    id: "tool.rectangle",
    label: "Rectangle",
    description: "Draw rectangle nodes",
    category: "Tools",
    shortcut: formatShortcut({ key: "R" })
  },
  {
    id: "tool.ellipse",
    label: "Ellipse",
    description: "Draw ellipse nodes",
    category: "Tools",
    shortcut: formatShortcut({ key: "O" })
  },
  {
    id: "tool.text",
    label: "Text",
    description: "Add a text node",
    category: "Tools",
    shortcut: formatShortcut({ key: "T" })
  },
  {
    id: "tool.sticky",
    label: "Sticky note",
    description: "Add a sticky note",
    category: "Tools",
    shortcut: formatShortcut({ key: "S" })
  },
  {
    id: "tool.database",
    label: "Database",
    description: "Add a database node",
    category: "Tools",
    shortcut: formatShortcut({ key: "D" })
  },
  // US-022: illustrative shapes added after Database (server, user, queue,
  // cloud) live behind the toolbar's Shape picker and don't claim a bare-key
  // shortcut — the single-letter pool was already tight (V/R/O/T/S/D taken)
  // and shadowing useful chords would cost more than it saves.
  {
    id: "tool.server",
    label: "Server",
    description: "Add a server node",
    category: "Tools"
  },
  {
    id: "tool.user",
    label: "User",
    description: "Add a user node",
    category: "Tools"
  },
  {
    id: "tool.queue",
    label: "Queue",
    description: "Add a queue node",
    category: "Tools"
  },
  {
    id: "tool.cloud",
    label: "Cloud",
    description: "Add a cloud node",
    category: "Tools"
  },
  {
    id: "edit.undo",
    label: "Undo",
    category: "Edit",
    shortcut: formatShortcut({ meta: true, key: "Z" }),
    enabled: (ctx) => ctx.canUndo
  },
  {
    id: "edit.redo",
    label: "Redo",
    category: "Edit",
    shortcut: formatShortcut({ meta: true, shift: true, key: "Z" }),
    enabled: (ctx) => ctx.canRedo
  },
  {
    id: "edit.copy",
    label: "Copy",
    category: "Edit",
    shortcut: formatShortcut({ meta: true, key: "C" }),
    enabled: (ctx) => ctx.hasSelection
  },
  {
    id: "edit.paste",
    label: "Paste",
    category: "Edit",
    shortcut: formatShortcut({ meta: true, key: "V" }),
    enabled: (ctx) => ctx.hasClipboard
  },
  {
    id: "edit.duplicate",
    label: "Duplicate",
    category: "Edit",
    shortcut: formatShortcut({ meta: true, key: "D" }),
    enabled: (ctx) => ctx.hasSelection
  },
  {
    id: "edit.delete",
    label: "Delete",
    category: "Edit",
    shortcut: formatShortcut({ key: "Delete" }),
    enabled: (ctx) => ctx.hasSelection
  },
  {
    id: "edit.selectAll",
    label: "Select all",
    category: "Edit",
    shortcut: formatShortcut({ meta: true, key: "A" })
  },
  {
    id: "view.fit",
    label: "Fit view",
    description: "Fit everything in the viewport",
    category: "View",
    shortcut: formatShortcut({ meta: true, key: "0" })
  },
  {
    id: "view.zoomIn",
    label: "Zoom in",
    category: "View",
    shortcut: formatShortcut({ meta: true, key: "=" })
  },
  {
    id: "view.zoomOut",
    label: "Zoom out",
    category: "View",
    shortcut: formatShortcut({ meta: true, key: "-" })
  },
  {
    id: "view.zoom100",
    label: "Zoom to 100%",
    category: "View",
    shortcut: formatShortcut({ key: "1" })
  },
  {
    id: "view.zoomToSelection",
    label: "Zoom to selection",
    category: "View",
    shortcut: formatShortcut({ key: "F" }),
    enabled: (ctx) => ctx.hasSelection
  },
  {
    id: "layout.tidy",
    label: "Tidy layout",
    description: "Auto-layout the canvas or current selection",
    category: "Layout",
    shortcut: formatShortcut({ meta: true, shift: true, key: "L" })
  },
  {
    id: "selection.deselect",
    label: "Deselect",
    description: "Clear selection and exit draw mode",
    category: "Selection",
    shortcut: formatShortcut({ key: "Escape" })
  },
  {
    id: "help.commandPalette",
    label: "Open command palette",
    category: "Help",
    shortcut: formatShortcut({ meta: true, key: "P" })
  },
  // File / session commands — surfaced via the palette so the keyboard-first
  // user can reach them without going to the top-right menu chrome. No
  // shortcuts assigned: the single-letter pool is exhausted and these aren't
  // hot enough to claim a chord (use the palette).
  {
    id: "export.pdf",
    label: "Export to PDF",
    description: "Download the current canvas as a PDF",
    category: "File",
    enabled: (ctx) => ctx.canExportDemo
  },
  {
    id: "export.png",
    label: "Export as image",
    description: "Download the current canvas as a PNG",
    category: "File",
    enabled: (ctx) => ctx.canExportDemo
  },
  {
    id: "session.reset",
    label: "Restart the demo",
    description: "Stop running scripts and re-run the reset script",
    category: "File",
    enabled: (ctx) => ctx.canResetSession
  }
];
var getCommandTooltip = (id) => {
  const cmd = COMMANDS.find((c) => c.id === id);
  if (!cmd) return "";
  return cmd.shortcut ? `${cmd.label} (${cmd.shortcut})` : cmd.label;
};
var NUDGE_STEP_DEFAULT = 1;
var NUDGE_STEP_SHIFT = 10;
var getNudgeDelta = (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const step = e.shiftKey ? NUDGE_STEP_SHIFT : NUDGE_STEP_DEFAULT;
  switch (e.key) {
    case "ArrowLeft":
      return { dx: -step, dy: 0 };
    case "ArrowRight":
      return { dx: step, dy: 0 };
    case "ArrowUp":
      return { dx: 0, dy: -step };
    case "ArrowDown":
      return { dx: 0, dy: step };
    default:
      return null;
  }
};
var getZoomChord = (e) => {
  if (!(e.metaKey || e.ctrlKey)) return null;
  if (e.altKey) return null;
  switch (e.key) {
    case "0":
      return "fit";
    // '=' is the bare key, '+' is Shift+= on most layouts. Both should map to
    // zoom in so Cmd+= and Cmd+Shift+= behave the same.
    case "=":
    case "+":
      return "in";
    // '-' is the bare key, '_' is Shift+- on most layouts. Pair them so
    // Cmd+- and Cmd+Shift+- both zoom out.
    case "-":
    case "_":
      return "out";
    default:
      return null;
  }
};
var applyNudge = (delta, selectedIds, nodes) => {
  if (selectedIds.length === 0) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = [];
  for (const id of selectedIds) {
    const n = byId.get(id);
    if (!n) continue;
    out.push({
      id,
      position: { x: n.position.x + delta.dx, y: n.position.y + delta.dy }
    });
  }
  return out;
};
var resolveClipboardChord = ({
  event,
  isEditableActive,
  hasNodes,
  hasConnectors,
  selectedIds,
  hasClipboard
}) => {
  if (!(event.metaKey || event.ctrlKey)) return { type: "noop" };
  if (event.shiftKey || event.altKey) return { type: "noop" };
  const key = event.key.toLowerCase();
  if (key !== "a" && key !== "c" && key !== "v" && key !== "d") return { type: "noop" };
  if (isEditableActive) return { type: "noop" };
  if (key === "a") {
    if (!hasNodes && !hasConnectors) return { type: "noop" };
    return { type: "selectAll" };
  }
  if (key === "c") {
    if (selectedIds.length === 0) return { type: "noop" };
    return { type: "copy", ids: selectedIds };
  }
  if (key === "d") {
    if (selectedIds.length === 0) return { type: "noop" };
    return { type: "duplicate", ids: selectedIds };
  }
  if (!hasClipboard) return { type: "noop" };
  return { type: "paste" };
};
var resolveToolShortcut = (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  switch (e.key.toLowerCase()) {
    case "v":
      return "select";
    case "r":
      return "rectangle";
    case "o":
      return "ellipse";
    case "t":
      return "text";
    case "s":
      return "sticky";
    case "d":
      return "database";
    default:
      return null;
  }
};

// src/lib/last-used-style.ts
var DEFAULT_STORAGE_PREFIX = "seeflow";
var storageKey = (prefix) => `${prefix}:last-used-style:v1`;
var empty = () => ({ node: {}, connector: {} });
var isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var readRaw = (prefix) => {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(prefix));
    if (!raw) return empty();
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) return empty();
    const node = isPlainObject(parsed.node) ? parsed.node : {};
    const connector = isPlainObject(parsed.connector) ? parsed.connector : {};
    return { node, connector };
  } catch {
    return empty();
  }
};
var writeRaw = (prefix, state) => {
  try {
    globalThis.localStorage?.setItem(storageKey(prefix), JSON.stringify(state));
  } catch {
  }
};
var getLastUsedStyle = (prefix) => readRaw(prefix);
var rememberNodeStyle = (prefix, patch) => {
  const { alt: _alt, ...rest } = patch;
  const next = { ...rest };
  if (next.borderSize !== void 0 && next.borderWidth === void 0) {
    next.borderWidth = next.borderSize;
  } else if (next.borderWidth !== void 0 && next.borderSize === void 0) {
    next.borderSize = next.borderWidth;
  }
  const current = readRaw(prefix);
  writeRaw(prefix, { ...current, node: { ...current.node, ...next } });
};
var rememberConnectorStyle = (prefix, patch) => {
  const current = readRaw(prefix);
  writeRaw(prefix, { ...current, connector: { ...current.connector, ...patch } });
};

// src/lib/node-defaults.ts
var NEW_NODE_BORDER_WIDTH = 3;
var NEW_NODE_FONT_SIZE = 17;
var pick = (patch, keys) => {
  if (!patch) return {};
  const out = {};
  for (const k of keys) {
    if (patch[k] !== void 0) out[k] = patch[k];
  }
  return out;
};
var SHAPE_RECT_FIELDS = [
  "borderColor",
  "backgroundColor",
  "borderSize",
  "borderStyle",
  "fontSize",
  "cornerRadius"
];
var SHAPE_ELLIPSE_FIELDS = [
  "borderColor",
  "backgroundColor",
  "borderSize",
  "borderStyle",
  "fontSize"
];
var SHAPE_TEXT_FIELDS = ["fontSize"];
var IMAGE_FIELDS = ["borderColor", "borderWidth", "borderStyle"];
function buildNewShapeData(shape, dims, lastUsed) {
  if (shape === "text") {
    return {
      shape,
      width: dims.width,
      height: dims.height,
      fontSize: NEW_NODE_FONT_SIZE,
      ...pick(lastUsed, SHAPE_TEXT_FIELDS)
    };
  }
  const fields = shape === "ellipse" ? SHAPE_ELLIPSE_FIELDS : SHAPE_RECT_FIELDS;
  return {
    shape,
    width: dims.width,
    height: dims.height,
    borderSize: NEW_NODE_BORDER_WIDTH,
    fontSize: NEW_NODE_FONT_SIZE,
    ...pick(lastUsed, fields)
  };
}
function buildNewImageData(path, dims, lastUsed) {
  return {
    path,
    width: dims.width,
    height: dims.height,
    borderWidth: NEW_NODE_BORDER_WIDTH,
    ...pick(lastUsed, IMAGE_FIELDS)
  };
}

// src/lib/scale-nodes.ts
function scaleNodesWithinRect(nodes, oldRect, newRect, options) {
  if (oldRect.width === 0 || oldRect.height === 0) {
    return nodes.map((n) => ({ ...n }));
  }
  let sx = newRect.width / oldRect.width;
  let sy = newRect.height / oldRect.height;
  if (options?.lockAspectRatio) {
    const uniform = Math.min(sx, sy);
    sx = uniform;
    sy = uniform;
  }
  return nodes.map((n) => {
    if (n.data?.locked === true) return { ...n };
    const x = newRect.x + (n.position.x - oldRect.x) * sx;
    const y = newRect.y + (n.position.y - oldRect.y) * sy;
    const next = {
      ...n,
      position: { x, y }
    };
    if (n.width !== void 0) next.width = n.width * sx;
    if (n.height !== void 0) next.height = n.height * sy;
    return next;
  });
}

// src/adapter/rest.ts
var requestJson = async (fetchImpl, method, url, body) => {
  const init = { method };
  if (body !== void 0) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetchImpl(url, init);
  if (!res.ok) {
    let errorBody = null;
    try {
      errorBody = await res.json();
    } catch {
    }
    throw new Error(errorBody?.error ?? `${method} ${url} \u2192 ${res.status}`);
  }
  return await res.json();
};
var createRestAdapter = (options) => {
  const { baseUrl, demoId } = options;
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const demoBase = `${baseUrl}/api/demos/${demoId}`;
  return {
    async createNode(input) {
      const data = await requestJson(
        fetchImpl,
        "POST",
        `${demoBase}/nodes`,
        input
      );
      return { id: data.id, node: data.node };
    },
    async updateNode(nodeId, patch) {
      await requestJson(fetchImpl, "PATCH", `${demoBase}/nodes/${nodeId}`, patch);
    },
    async updateNodePosition(nodeId, position) {
      return await requestJson(
        fetchImpl,
        "PATCH",
        `${demoBase}/nodes/${nodeId}/position`,
        position
      );
    },
    async deleteNode(nodeId) {
      await requestJson(fetchImpl, "DELETE", `${demoBase}/nodes/${nodeId}`);
    },
    async reorderNode(nodeId, op) {
      await requestJson(fetchImpl, "PATCH", `${demoBase}/nodes/${nodeId}/order`, op);
    },
    async createConnector(input) {
      const data = await requestJson(
        fetchImpl,
        "POST",
        `${demoBase}/connectors`,
        input
      );
      return { id: data.id };
    },
    async updateConnector(connectorId, patch) {
      await requestJson(
        fetchImpl,
        "PATCH",
        `${demoBase}/connectors/${connectorId}`,
        patch
      );
    },
    async deleteConnector(connectorId) {
      await requestJson(fetchImpl, "DELETE", `${demoBase}/connectors/${connectorId}`);
    },
    async uploadImage(file, filename) {
      const form = new FormData();
      form.append("file", file);
      form.append("filename", filename);
      const url = `${baseUrl}/api/projects/${encodeURIComponent(demoId)}/files/upload`;
      const res = await fetchImpl(url, { method: "POST", body: form });
      if (!res.ok) {
        let errorBody = null;
        try {
          errorBody = await res.json();
        } catch {
        }
        throw new Error(errorBody?.error ?? `POST ${url} \u2192 ${res.status}`);
      }
      return await res.json();
    },
    async playNode(nodeId) {
      return await requestJson(fetchImpl, "POST", `${demoBase}/play/${nodeId}`, {});
    },
    async openFile(path) {
      await requestJson(
        fetchImpl,
        "POST",
        `${baseUrl}/api/projects/${encodeURIComponent(demoId)}/files/open`,
        { path }
      );
    },
    async revealFile(path) {
      await requestJson(
        fetchImpl,
        "POST",
        `${baseUrl}/api/projects/${encodeURIComponent(demoId)}/files/reveal`,
        { path }
      );
    }
  };
};

// src/nodes/html-node.tsx
import { Handle as Handle2, Position as Position2 } from "@xyflow/react";
import { memo as memo2, useEffect as useEffect4 } from "react";

// src/lib/sanitize-html.ts
var DANGEROUS_TAGS = /* @__PURE__ */ new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK"]);
var URL_ATTRS = /* @__PURE__ */ new Set(["href", "src"]);
var isEventHandlerAttr = (name) => /^on/i.test(name);
var isJavaScriptUrl = (value) => {
  let i = 0;
  while (i < value.length && value.charCodeAt(i) <= 32) {
    i += 1;
  }
  return value.slice(i, i + 11).toLowerCase() === "javascript:";
};
function sanitizeHtml(raw) {
  if (typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><body>${raw}</body></html>`,
    "text/html"
  );
  const body = doc.body;
  const walker = doc.createTreeWalker(body, 1);
  const toRemove = [];
  let node = walker.nextNode();
  while (node) {
    const el = node;
    if (DANGEROUS_TAGS.has(el.tagName)) {
      toRemove.push(el);
    } else {
      for (const attr of Array.from(el.attributes)) {
        if (isEventHandlerAttr(attr.name)) {
          el.removeAttribute(attr.name);
          continue;
        }
        if (URL_ATTRS.has(attr.name.toLowerCase()) && isJavaScriptUrl(attr.value)) {
          el.removeAttribute(attr.name);
        }
      }
    }
    node = walker.nextNode();
  }
  for (const el of toRemove) {
    el.remove();
  }
  return body.innerHTML;
}

// src/lib/inject-sanitized-html.ts
function injectSanitizedHtml(raw) {
  return { dangerouslySetInnerHTML: { __html: sanitizeHtml(raw) } };
}

// src/lib/tailwind-runtime.ts
var TAILWIND_RUNTIME_SRC = "/runtime/tailwind.js";
var TAILWIND_RUNTIME_MARKER = "data-seeflow-tailwind-runtime";
function ensureTailwindLoaded() {
  if (typeof document === "undefined") return;
  if (document.querySelector(`script[${TAILWIND_RUNTIME_MARKER}]`)) return;
  const script = document.createElement("script");
  script.src = TAILWIND_RUNTIME_SRC;
  script.async = true;
  script.setAttribute(TAILWIND_RUNTIME_MARKER, "true");
  document.head.appendChild(script);
}

// src/lib/use-html-content.ts
import { useEffect as useEffect3, useState as useState4 } from "react";

// src/lib/file-watch-bus.ts
var defaultFactory = (url) => {
  if (typeof EventSource === "undefined") return null;
  return new EventSource(url);
};
var buses = /* @__PURE__ */ new Map();
var factoryOverride = null;
function subscribeFileChanged(projectId, listener) {
  let entry = buses.get(projectId);
  if (!entry) {
    const factory = factoryOverride ?? defaultFactory;
    const source = factory(`/api/events?demoId=${encodeURIComponent(projectId)}`);
    if (!source) {
      return () => {
      };
    }
    const newEntry = { source, listeners: /* @__PURE__ */ new Set(), refCount: 0 };
    source.addEventListener("file:changed", (e) => {
      let path = void 0;
      try {
        const parsed = JSON.parse(e.data);
        path = parsed.path;
      } catch {
        return;
      }
      if (typeof path !== "string") return;
      for (const l of newEntry.listeners) l(path);
    });
    buses.set(projectId, newEntry);
    entry = newEntry;
  }
  entry.listeners.add(listener);
  entry.refCount += 1;
  return () => {
    const current = buses.get(projectId);
    if (!current) return;
    current.listeners.delete(listener);
    current.refCount -= 1;
    if (current.refCount === 0) {
      current.source.close();
      buses.delete(projectId);
    }
  };
}

// src/lib/use-html-content.ts
var cache = /* @__PURE__ */ new Map();
var cacheKey = (projectId, htmlPath) => `${projectId}::${htmlPath}`;
function useHtmlContent(projectId, htmlPath) {
  const [state, setState] = useState4(() => {
    if (!projectId || !htmlPath) return { kind: "loading" };
    return cache.get(cacheKey(projectId, htmlPath)) ?? { kind: "loading" };
  });
  useEffect3(() => {
    if (!projectId || !htmlPath) {
      setState({ kind: "loading" });
      return;
    }
    const key = cacheKey(projectId, htmlPath);
    let cancelled = false;
    const cached = cache.get(key);
    if (cached) {
      setState(cached);
    } else {
      setState({ kind: "loading" });
    }
    const run = async () => {
      try {
        const res = await fetch(fileUrl(projectId, htmlPath));
        if (cancelled) return;
        if (res.status === 404) {
          const missing = { kind: "missing" };
          cache.set(key, missing);
          setState(missing);
          return;
        }
        if (!res.ok) {
          const err = {
            kind: "error",
            message: `GET ${htmlPath} \u2192 ${res.status}`
          };
          cache.set(key, err);
          setState(err);
          return;
        }
        const html = await res.text();
        if (cancelled) return;
        const loaded = { kind: "loaded", html };
        cache.set(key, loaded);
        setState(loaded);
      } catch (e) {
        if (cancelled) return;
        const err = {
          kind: "error",
          message: e instanceof Error ? e.message : String(e)
        };
        cache.set(key, err);
        setState(err);
      }
    };
    run();
    const unsubscribe = subscribeFileChanged(projectId, (changedPath) => {
      if (changedPath === htmlPath) run();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [projectId, htmlPath]);
  return state;
}

// src/ui/icon.tsx
import {
  createContext,
  useContext
} from "react";
import { jsx as jsx5 } from "react/jsx-runtime";
var IconRegistryContext = createContext({ custom: {} });
function IconRegistryProvider({ value, children }) {
  return /* @__PURE__ */ jsx5(IconRegistryContext.Provider, { value, children });
}
function useIconRegistry() {
  return useContext(IconRegistryContext);
}
function Icon({ name, as, size = 16, fallback = ICON_FALLBACK_NAME, ...rest }) {
  const registry = useIconRegistry();
  const Component = as ?? (name ? registry.custom[name] : void 0) ?? (name ? ICON_REGISTRY[name] : void 0) ?? ICON_REGISTRY[fallback];
  if (!Component) return null;
  return /* @__PURE__ */ jsx5(Component, { size, ...rest });
}

// src/nodes/placeholder-card.tsx
import { jsx as jsx6 } from "react/jsx-runtime";
function PlaceholderCard({
  message,
  variant = "muted",
  className
}) {
  return /* @__PURE__ */ jsx6(
    "div",
    {
      "data-testid": "placeholder-card",
      "data-placeholder-variant": variant,
      className: cn(
        "sf-pointer-events-none sf-flex sf-h-full sf-w-full sf-select-none sf-items-center sf-justify-center sf-px-2 sf-text-center sf-text-xs",
        variant === "destructive" ? "sf-text-destructive" : "sf-text-muted-foreground",
        className
      ),
      children: message
    }
  );
}

// src/nodes/html-node.tsx
import { jsx as jsx7, jsxs as jsxs3 } from "react/jsx-runtime";
var HTML_DEFAULT_SIZE = { width: 320, height: 200 };
var MIN_W2 = 80;
var MIN_H2 = 40;
var HANDLE_CLASS2 = "sf-opacity-0 sf-transition-opacity";
function HtmlNodeImpl({ id, data, selected, isConnectable }) {
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    setResizing: data.setResizing
  });
  const sized = data.width !== void 0 || data.height !== void 0;
  const containerStyle = {
    ...data.backgroundColor !== void 0 ? { backgroundColor: colorTokenStyle(data.backgroundColor, "node").backgroundColor } : {},
    ...data.borderColor !== void 0 ? { borderColor: colorTokenStyle(data.borderColor, "node").borderColor } : {},
    ...data.borderSize !== void 0 ? { borderWidth: data.borderSize } : {},
    ...data.borderStyle !== void 0 ? { borderStyle: data.borderStyle } : {},
    ...data.cornerRadius !== void 0 ? { borderRadius: data.cornerRadius } : {},
    ...data.fontSize !== void 0 ? { fontSize: `${data.fontSize}px` } : {},
    ...colorTokenStyle(data.textColor, "text"),
    ...sized ? {} : { width: HTML_DEFAULT_SIZE.width, height: HTML_DEFAULT_SIZE.height }
  };
  useEffect4(() => {
    ensureTailwindLoaded();
  }, []);
  const content = useHtmlContent(data.projectId, data.htmlPath);
  let body;
  if (content.kind === "loaded") {
    body = /* @__PURE__ */ jsx7(
      "div",
      {
        "data-testid": "html-node-content",
        className: "sf-h-full sf-w-full sf-overflow-auto",
        ...injectSanitizedHtml(content.html)
      }
    );
  } else if (content.kind === "missing") {
    body = /* @__PURE__ */ jsx7(PlaceholderCard, { message: `Missing: ${data.htmlPath}`, variant: "destructive" });
  } else if (content.kind === "error") {
    body = /* @__PURE__ */ jsx7(PlaceholderCard, { message: `Error: ${content.message}`, variant: "destructive" });
  } else {
    body = /* @__PURE__ */ jsx7(PlaceholderCard, { message: "Loading\u2026" });
  }
  return /* @__PURE__ */ jsxs3(
    "div",
    {
      className: cn("sf-group sf-relative sf-overflow-hidden", sized ? "sf-h-full sf-w-full" : ""),
      style: containerStyle,
      "data-testid": "html-node",
      children: [
        /* @__PURE__ */ jsx7(
          ResizeControls,
          {
            visible: !!selected && !!data.onResize && !data.locked,
            cornerVariant: "visible",
            minWidth: MIN_W2,
            minHeight: MIN_H2,
            onResizeStart,
            onResize: onResizeEvent,
            onResizeEnd
          }
        ),
        data.locked ? /* @__PURE__ */ jsx7(LockBadge, {}) : null,
        /* @__PURE__ */ jsx7(
          Handle2,
          {
            type: "target",
            position: Position2.Top,
            id: "t",
            isConnectable,
            className: cn(HANDLE_CLASS2, selected && "!sf-opacity-100")
          }
        ),
        /* @__PURE__ */ jsx7(
          Handle2,
          {
            type: "target",
            position: Position2.Left,
            id: "l",
            isConnectable,
            className: cn(HANDLE_CLASS2, selected && "!sf-opacity-100")
          }
        ),
        body,
        /* @__PURE__ */ jsx7(
          Handle2,
          {
            type: "source",
            position: Position2.Right,
            id: "r",
            isConnectable,
            className: cn(HANDLE_CLASS2, selected && "!sf-opacity-100")
          }
        ),
        /* @__PURE__ */ jsx7(
          Handle2,
          {
            type: "source",
            position: Position2.Bottom,
            id: "b",
            isConnectable,
            className: cn(HANDLE_CLASS2, selected && "!sf-opacity-100")
          }
        ),
        data.name !== void 0 && data.name !== "" ? /* @__PURE__ */ jsx7(
          "div",
          {
            "data-testid": "html-node-label",
            className: "-sf-bottom-5 sf-absolute sf-right-0 sf-left-0 sf-truncate sf-text-center sf-text-[11px] sf-text-muted-foreground",
            children: data.icon ? /* @__PURE__ */ jsxs3("div", { className: "sf-flex sf-items-center sf-justify-center sf-gap-1", children: [
              /* @__PURE__ */ jsx7(Icon, { name: data.icon, size: 12, "aria-hidden": true }),
              /* @__PURE__ */ jsx7("span", { className: "truncate", children: data.name })
            ] }) : data.name
          }
        ) : null
      ]
    }
  );
}
function arePropsEqual2(prev, next) {
  return prev.selected === next.selected && prev.data === next.data && prev.width === next.width && prev.height === next.height;
}
var HtmlNode = memo2(HtmlNodeImpl, arePropsEqual2);

// src/nodes/image-node.tsx
import { Handle as Handle3, Position as Position3 } from "@xyflow/react";
import { memo as memo3 } from "react";
import { jsx as jsx8, jsxs as jsxs4 } from "react/jsx-runtime";
var IMAGE_DEFAULT_SIZE = { width: 200, height: 150 };
var MIN_W3 = 40;
var MIN_H3 = 40;
var HANDLE_CLASS3 = "sf-opacity-0 sf-transition-opacity";
function ImageNodeImpl({ id, data, selected, isConnectable }) {
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    setResizing: data.setResizing
  });
  const sized = data.width !== void 0 || data.height !== void 0;
  const containerStyle = {
    backgroundColor: data.backgroundColor !== void 0 ? colorTokenStyle(data.backgroundColor, "node").backgroundColor : NODE_DEFAULT_BG_WHITE,
    ...data.borderColor !== void 0 ? { borderColor: colorTokenStyle(data.borderColor, "node").borderColor } : {},
    ...data.borderWidth !== void 0 ? { borderWidth: data.borderWidth } : {},
    ...data.borderStyle !== void 0 ? { borderStyle: data.borderStyle } : {},
    ...data.cornerRadius !== void 0 ? { borderRadius: data.cornerRadius } : {},
    ...sized ? {} : { width: IMAGE_DEFAULT_SIZE.width, height: IMAGE_DEFAULT_SIZE.height }
  };
  return /* @__PURE__ */ jsxs4(
    "div",
    {
      className: cn("sf-group sf-relative sf-overflow-hidden", sized ? "sf-h-full sf-w-full" : ""),
      style: containerStyle,
      "data-testid": "image-node",
      children: [
        /* @__PURE__ */ jsx8(
          ResizeControls,
          {
            visible: !!selected && !!data.onResize && !data.locked,
            cornerVariant: "visible",
            minWidth: MIN_W3,
            minHeight: MIN_H3,
            onResizeStart,
            onResize: onResizeEvent,
            onResizeEnd
          }
        ),
        data.locked ? /* @__PURE__ */ jsx8(LockBadge, {}) : null,
        /* @__PURE__ */ jsx8(
          Handle3,
          {
            type: "target",
            position: Position3.Top,
            id: "t",
            isConnectable,
            className: cn(HANDLE_CLASS3, selected && "!sf-opacity-100")
          }
        ),
        /* @__PURE__ */ jsx8(
          Handle3,
          {
            type: "target",
            position: Position3.Left,
            id: "l",
            isConnectable,
            className: cn(HANDLE_CLASS3, selected && "!sf-opacity-100")
          }
        ),
        data._uploading ? (
          // US-008: optimistic-placement loading state. The <img> is suppressed
          // because the file hasn't been uploaded yet (data.path is empty), so
          // we render a flat 'Loading…' tile sized to the dropped image dims.
          /* @__PURE__ */ jsx8(
            "div",
            {
              "data-testid": "image-node-placeholder",
              "data-placeholder": "loading",
              className: "sf-flex sf-h-full sf-w-full sf-select-none sf-items-center sf-justify-center sf-text-xs sf-text-muted-foreground sf-pointer-events-none",
              children: "Loading\u2026"
            }
          )
        ) : data._uploadError ? (
          // US-008: upload failed — the node stays on the canvas with a click-to-
          // retry affordance. Never auto-deletes; the user explicitly opts to
          // retry (or deletes the node themselves).
          /* @__PURE__ */ jsx8(
            "button",
            {
              type: "button",
              "data-testid": "image-node-placeholder",
              "data-placeholder": "failed",
              onClick: () => data.onRetryUpload?.(id),
              title: data._uploadError,
              className: "sf-flex sf-h-full sf-w-full sf-cursor-pointer sf-select-none sf-items-center sf-justify-center sf-px-2 sf-text-center sf-text-xs sf-text-destructive",
              children: "Upload failed (click to retry)"
            }
          )
        ) : /* @__PURE__ */ jsx8(
          "img",
          {
            src: data.projectId ? fileUrl(data.projectId, data.path) : "",
            alt: data.alt ?? "",
            className: "sf-block sf-h-full sf-w-full sf-select-none sf-object-contain sf-pointer-events-none",
            draggable: false
          }
        ),
        /* @__PURE__ */ jsx8(
          Handle3,
          {
            type: "source",
            position: Position3.Right,
            id: "r",
            isConnectable,
            className: cn(HANDLE_CLASS3, selected && "!sf-opacity-100")
          }
        ),
        /* @__PURE__ */ jsx8(
          Handle3,
          {
            type: "source",
            position: Position3.Bottom,
            id: "b",
            isConnectable,
            className: cn(HANDLE_CLASS3, selected && "!sf-opacity-100")
          }
        )
      ]
    }
  );
}
function arePropsEqual3(prev, next) {
  return prev.selected === next.selected && prev.data === next.data && prev.width === next.width && prev.height === next.height;
}
var ImageNode = memo3(ImageNodeImpl, arePropsEqual3);

// src/nodes/play-node.tsx
import { Handle as Handle4, Position as Position4 } from "@xyflow/react";
import { Loader2, Play } from "lucide-react";
import { memo as memo4, useState as useState5 } from "react";

// src/ui/button.tsx
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import * as React from "react";
import { jsx as jsx9 } from "react/jsx-runtime";
var buttonVariants = cva(
  "sf-inline-flex sf-items-center sf-justify-center sf-whitespace-nowrap sf-rounded-md sf-text-sm sf-font-medium sf-ring-offset-background sf-transition-colors focus-visible:sf-outline-none focus-visible:sf-ring-2 focus-visible:sf-ring-ring focus-visible:sf-ring-offset-2 disabled:sf-pointer-events-none disabled:sf-opacity-50",
  {
    variants: {
      variant: {
        default: "sf-bg-primary sf-text-primary-foreground sf-font-semibold hover:sf-bg-emerald-400",
        destructive: "sf-bg-destructive sf-text-destructive-foreground hover:sf-bg-destructive/90",
        outline: "sf-border sf-border-input sf-bg-background hover:sf-bg-secondary hover:sf-text-foreground",
        secondary: "sf-bg-secondary sf-text-secondary-foreground hover:sf-bg-secondary/80",
        ghost: "sf-text-muted-foreground hover:sf-bg-muted hover:sf-text-foreground",
        link: "sf-text-primary sf-underline-offset-4 hover:sf-underline"
      },
      size: {
        default: "sf-h-9 sf-px-4 sf-py-2",
        sm: "sf-h-8 sf-rounded-md sf-px-3",
        lg: "sf-h-11 sf-rounded-md sf-px-8",
        icon: "sf-h-9 sf-w-9"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);
var Button = React.forwardRef(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return /* @__PURE__ */ jsx9(Comp, { className: cn(buttonVariants({ variant, size, className })), ref, ...props });
  }
);
Button.displayName = "Button";

// src/nodes/status-badge.tsx
import { jsx as jsx10, jsxs as jsxs5 } from "react/jsx-runtime";
var DOT_STYLES = {
  ok: "sf-bg-emerald-400",
  warn: "sf-bg-amber-400",
  error: "sf-bg-rose-400",
  pending: "sf-bg-slate-400"
};
function StatusBadge({ state, summary, "data-testid": testId }) {
  return /* @__PURE__ */ jsxs5(
    "span",
    {
      "data-testid": testId,
      "data-state": state,
      className: "sf-inline-flex sf-max-w-full sf-items-center sf-gap-1.5 sf-text-[11px] sf-leading-tight sf-text-muted-foreground",
      children: [
        /* @__PURE__ */ jsx10(
          "span",
          {
            "aria-hidden": true,
            className: cn("sf-h-2 sf-w-2 sf-shrink-0 sf-rounded-full", DOT_STYLES[state])
          }
        ),
        summary ? /* @__PURE__ */ jsx10("span", { className: "sf-min-w-0 sf-flex-1 sf-truncate", title: summary, children: summary }) : null
      ]
    }
  );
}

// src/nodes/play-node.tsx
import { jsx as jsx11, jsxs as jsxs6 } from "react/jsx-runtime";
var MIN_W4 = 100;
var MIN_H4 = 44;
var DEFAULT_W = 200;
function PlayNodeImpl({ id, data, selected, isConnectable }) {
  const status = data.status;
  const action = data.playAction;
  const description = data.description ?? data.kind;
  const playable = !!action && !!data.onPlay;
  const isRunning = status === "running";
  const isError = status === "error";
  const buttonLabel = isRunning ? "Running\u2026" : isError ? data.errorMessage ? `Failed: ${data.errorMessage}` : "Failed" : "Play";
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    setResizing: data.setResizing
  });
  const [editing, setEditing] = useState5(null);
  const nameEditable = !!data.onNameChange;
  const descEditable = !!data.onDescriptionChange;
  const sized = data.width !== void 0 || data.height !== void 0;
  const labelFontStyle = {
    ...data.fontSize !== void 0 ? { fontSize: `${data.fontSize}px` } : {},
    ...colorTokenStyle(data.textColor, "text")
  };
  const descriptionFontStyle = labelFontStyle;
  const containerStyle = {
    borderColor: data.statusReport?.state === "error" ? colorTokenStyle("red", "node").borderColor : colorTokenStyle(data.borderColor, "node").borderColor,
    backgroundColor: data.backgroundColor !== void 0 ? colorTokenStyle(data.backgroundColor, "node").backgroundColor : NODE_DEFAULT_BG_WHITE,
    borderWidth: data.borderSize !== void 0 ? data.borderSize : void 0,
    borderStyle: data.borderStyle,
    borderRadius: data.cornerRadius !== void 0 ? data.cornerRadius : void 0,
    ...sized ? {} : { width: DEFAULT_W }
  };
  const handleWrapperDoubleClick = nameEditable || descEditable ? (e) => {
    if (editing !== null) return;
    const target = e.target;
    if (target?.closest(".react-flow__handle")) return;
    if (target?.closest(".react-flow__resize-control")) return;
    e.stopPropagation();
    if (target?.closest('[data-testid="node-header"]')) {
      if (nameEditable) setEditing("name");
      return;
    }
    if (target?.closest('[data-testid="node-content"]')) {
      if (descEditable) setEditing("description");
      else if (nameEditable) setEditing("name");
      return;
    }
    if (descEditable) setEditing("description");
    else if (nameEditable) setEditing("name");
  } : void 0;
  return /* @__PURE__ */ jsxs6(
    "div",
    {
      className: cn(
        "sf-group sf-flex sf-flex-col sf-justify-center sf-overflow-hidden sf-rounded-lg sf-border-[3px] sf-shadow-sm sf-transition-shadow",
        sized ? "sf-h-full sf-w-full" : "",
        isRunning ? "seeflow-node-pulse" : ""
      ),
      style: containerStyle,
      "data-status": status ?? "idle",
      "data-testid": "play-node",
      onDoubleClick: handleWrapperDoubleClick,
      children: [
        /* @__PURE__ */ jsx11(
          ResizeControls,
          {
            visible: !!selected && !!data.onResize && !data.locked,
            cornerVariant: "visible",
            minWidth: MIN_W4,
            minHeight: MIN_H4,
            onResizeStart,
            onResize: onResizeEvent,
            onResizeEnd
          }
        ),
        data.locked ? /* @__PURE__ */ jsx11(LockBadge, {}) : null,
        /* @__PURE__ */ jsx11(
          Handle4,
          {
            type: "target",
            position: Position4.Top,
            id: "t",
            isConnectable,
            className: cn("sf-opacity-0 sf-transition-opacity", selected && "!sf-opacity-100")
          }
        ),
        /* @__PURE__ */ jsx11(
          Handle4,
          {
            type: "target",
            position: Position4.Left,
            id: "l",
            isConnectable,
            className: cn("sf-opacity-0 sf-transition-opacity", selected && "!sf-opacity-100")
          }
        ),
        /* @__PURE__ */ jsxs6(
          "div",
          {
            className: "sf-flex sf-shrink-0 sf-items-center sf-justify-between sf-gap-2 sf-border-b sf-bg-muted/30 sf-px-2 sf-py-2",
            "data-testid": "node-header",
            children: [
              data.icon ? /* @__PURE__ */ jsx11(
                Icon,
                {
                  name: data.icon,
                  size: 16,
                  className: "shrink-0",
                  style: colorTokenStyle(data.textColor, "text"),
                  "aria-hidden": true
                }
              ) : null,
              /* @__PURE__ */ jsx11(
                "div",
                {
                  className: "sf-min-w-0 sf-flex-1 sf-text-[18px] sf-font-semibold sf-leading-tight",
                  style: labelFontStyle,
                  children: editing === "name" && nameEditable ? /* @__PURE__ */ jsx11(
                    InlineEdit,
                    {
                      initialValue: data.name,
                      field: "node-name",
                      required: true,
                      commitMode: "blur-only",
                      onCommit: (v) => data.onNameChange?.(id, v),
                      onExit: () => setEditing(null),
                      className: "sf-text-[18px] sf-font-semibold",
                      style: labelFontStyle
                    }
                  ) : /* @__PURE__ */ jsx11(
                    "button",
                    {
                      type: "button",
                      className: cn(
                        "sf-block sf-w-full sf-whitespace-pre-wrap sf-break-words sf-bg-transparent sf-p-0 sf-text-left sf-text-[18px] sf-font-semibold sf-leading-tight",
                        nameEditable ? "hover:sf-opacity-80" : ""
                      ),
                      style: labelFontStyle,
                      children: data.name
                    }
                  )
                }
              ),
              /* @__PURE__ */ jsx11("div", { className: "sf-flex sf-shrink-0 sf-items-center sf-gap-1", children: /* @__PURE__ */ jsx11(
                Button,
                {
                  type: "button",
                  size: "sm",
                  variant: "secondary",
                  disabled: !playable || isRunning,
                  className: cn(
                    "sf-h-8 sf-w-8 sf-rounded-full sf-p-0 hover:sf-bg-primary hover:sf-text-primary-foreground focus-visible:sf-bg-primary focus-visible:sf-text-primary-foreground",
                    isError && "sf-border-2 sf-border-rose-500"
                  ),
                  "data-testid": "play-button",
                  "data-status": status ?? "idle",
                  "aria-label": buttonLabel,
                  title: buttonLabel,
                  onClick: (e) => {
                    e.stopPropagation();
                    data.onPlay?.(id);
                  },
                  children: isRunning ? /* @__PURE__ */ jsx11(Loader2, { className: "sf-h-4 sf-w-4 sf-animate-spin", "aria-hidden": true }) : /* @__PURE__ */ jsx11(Play, { className: "sf-h-4 sf-w-4", "aria-hidden": true })
                }
              ) })
            ]
          }
        ),
        /* @__PURE__ */ jsx11(
          "div",
          {
            className: "sf-flex sf-min-h-0 sf-flex-1 sf-items-center sf-px-2 sf-py-1",
            "data-testid": "node-content",
            "data-resizing": isResizing ? "true" : void 0,
            children: editing === "description" && descEditable ? /* @__PURE__ */ jsx11(
              InlineEdit,
              {
                initialValue: data.description ?? "",
                field: "node-description",
                multiline: true,
                onCommit: (v) => data.onDescriptionChange?.(id, v),
                onExit: () => setEditing(null),
                className: "sf-w-full sf-text-[18px] sf-text-muted-foreground",
                style: descriptionFontStyle,
                placeholder: data.kind
              }
            ) : /* @__PURE__ */ jsx11(
              "button",
              {
                type: "button",
                className: cn(
                  "sf-block sf-w-full sf-whitespace-normal sf-break-words sf-bg-transparent sf-p-0 sf-text-left sf-text-[18px] sf-text-muted-foreground",
                  descEditable ? "hover:sf-opacity-80" : ""
                ),
                style: descriptionFontStyle,
                children: description
              }
            )
          }
        ),
        data.statusReport && /* @__PURE__ */ jsx11(
          "div",
          {
            className: "sf-flex sf-items-center sf-px-2 sf-pb-1",
            "data-testid": "play-node-status-badge",
            children: /* @__PURE__ */ jsx11(
              StatusBadge,
              {
                state: data.statusReport.state,
                summary: data.statusReport.summary,
                "data-testid": "status-badge"
              }
            )
          }
        ),
        /* @__PURE__ */ jsx11(
          Handle4,
          {
            type: "source",
            position: Position4.Right,
            id: "r",
            isConnectable,
            className: cn("sf-opacity-0 sf-transition-opacity", selected && "!sf-opacity-100")
          }
        ),
        /* @__PURE__ */ jsx11(
          Handle4,
          {
            type: "source",
            position: Position4.Bottom,
            id: "b",
            isConnectable,
            className: cn("sf-opacity-0 sf-transition-opacity", selected && "!sf-opacity-100")
          }
        )
      ]
    }
  );
}
function arePropsEqual4(prev, next) {
  return prev.selected === next.selected && prev.data === next.data && prev.width === next.width && prev.height === next.height;
}
var PlayNode = memo4(PlayNodeImpl, arePropsEqual4);

// src/nodes/shape-node.tsx
import { Handle as Handle5, Position as Position5 } from "@xyflow/react";
import {
  memo as memo5,
  useState as useState6
} from "react";

// src/nodes/shapes/types.ts
var BORDER_FALLBACK = "var(--seeflow-node-border)";
var BG_FALLBACK = "var(--seeflow-node-bg)";
var DEFAULT_STROKE_WIDTH = 2;
function dashFor(style) {
  if (style === "dashed") return "6 4";
  if (style === "dotted") return "2 4";
  return void 0;
}

// src/nodes/shapes/cloud.tsx
import { jsx as jsx12, jsxs as jsxs7 } from "react/jsx-runtime";
var SIDE_MARGIN = 5;
function CloudShape({
  width,
  height,
  borderColor,
  backgroundColor,
  borderSize,
  borderStyle
}) {
  const stroke = borderColor ?? BORDER_FALLBACK;
  const fill = backgroundColor ?? BG_FALLBACK;
  const strokeWidth = borderSize ?? DEFAULT_STROKE_WIDTH;
  const dash = dashFor(borderStyle);
  const usableW = width - 2 * SIDE_MARGIN;
  const r1 = usableW / 7;
  const r2 = usableW / 7 * 1.5;
  const r3 = r1;
  const xLeft = SIDE_MARGIN;
  const cx1 = xLeft + r1;
  const cx2 = cx1 + r1 + r2;
  const cx3 = cx2 + r2 + r3;
  const xRight = cx3 + r3;
  const baselineY = height * 0.85;
  const d = [
    `M ${xLeft} ${baselineY}`,
    `A ${r1} ${r1} 0 0 1 ${cx1 + r1} ${baselineY}`,
    `A ${r2} ${r2} 0 0 1 ${cx2 + r2} ${baselineY}`,
    `A ${r3} ${r3} 0 0 1 ${xRight} ${baselineY}`,
    `L ${xRight} ${height}`,
    `L ${xLeft} ${height}`,
    "Z"
  ].join(" ");
  return /* @__PURE__ */ jsxs7(
    "svg",
    {
      width: "100%",
      height: "100%",
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: "none",
      role: "img",
      "aria-label": "Cloud",
      "data-testid": "cloud-shape",
      children: [
        /* @__PURE__ */ jsx12("title", { children: "Cloud" }),
        /* @__PURE__ */ jsx12("path", { d, fill, stroke, strokeWidth, strokeDasharray: dash })
      ]
    }
  );
}

// src/nodes/shapes/database.tsx
import { jsx as jsx13, jsxs as jsxs8 } from "react/jsx-runtime";
function DatabaseShape({
  width,
  height,
  borderColor,
  backgroundColor,
  borderSize,
  borderStyle
}) {
  const ry = Math.max(6, Math.min(28, height * 0.12));
  const rx = width / 2;
  const cx = width / 2;
  const stroke = borderColor ?? BORDER_FALLBACK;
  const fill = backgroundColor ?? BG_FALLBACK;
  const strokeWidth = borderSize ?? DEFAULT_STROKE_WIDTH;
  const dash = dashFor(borderStyle);
  const bottomArcPath = `M 0 ${height - ry} A ${rx} ${ry} 0 0 0 ${width} ${height - ry}`;
  return /* @__PURE__ */ jsxs8(
    "svg",
    {
      width: "100%",
      height: "100%",
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: "none",
      role: "img",
      "aria-label": "Database",
      "data-testid": "database-shape",
      children: [
        /* @__PURE__ */ jsx13("title", { children: "Database" }),
        /* @__PURE__ */ jsx13("rect", { x: 0, y: ry, width, height: Math.max(0, height - 2 * ry), fill }),
        /* @__PURE__ */ jsx13(
          "line",
          {
            x1: 0,
            y1: ry,
            x2: 0,
            y2: height - ry,
            stroke,
            strokeWidth,
            strokeDasharray: dash
          }
        ),
        /* @__PURE__ */ jsx13(
          "line",
          {
            x1: width,
            y1: ry,
            x2: width,
            y2: height - ry,
            stroke,
            strokeWidth,
            strokeDasharray: dash
          }
        ),
        /* @__PURE__ */ jsx13(
          "path",
          {
            d: bottomArcPath,
            fill,
            stroke,
            strokeWidth,
            strokeDasharray: dash
          }
        ),
        /* @__PURE__ */ jsx13(
          "ellipse",
          {
            cx,
            cy: ry,
            rx,
            ry,
            fill,
            stroke,
            strokeWidth,
            strokeDasharray: dash
          }
        )
      ]
    }
  );
}

// src/nodes/shapes/queue.tsx
import { jsx as jsx14, jsxs as jsxs9 } from "react/jsx-runtime";
function QueueShape({
  width,
  height,
  borderColor,
  backgroundColor,
  borderSize,
  borderStyle
}) {
  const stroke = borderColor ?? BORDER_FALLBACK;
  const fill = backgroundColor ?? BG_FALLBACK;
  const strokeWidth = borderSize ?? DEFAULT_STROKE_WIDTH;
  const dash = dashFor(borderStyle);
  const rx = height / 2;
  const d1 = width * 0.25;
  const d2 = width * 0.5;
  const d3 = width * 0.75;
  return /* @__PURE__ */ jsxs9(
    "svg",
    {
      width: "100%",
      height: "100%",
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: "none",
      role: "img",
      "aria-label": "Queue",
      "data-testid": "queue-shape",
      children: [
        /* @__PURE__ */ jsx14("title", { children: "Queue" }),
        /* @__PURE__ */ jsx14(
          "rect",
          {
            x: 0,
            y: 0,
            width,
            height,
            rx,
            ry: rx,
            fill,
            stroke,
            strokeWidth,
            strokeDasharray: dash
          }
        ),
        /* @__PURE__ */ jsx14(
          "line",
          {
            x1: d1,
            y1: 0,
            x2: d1,
            y2: height,
            stroke,
            strokeWidth,
            strokeDasharray: dash
          }
        ),
        /* @__PURE__ */ jsx14(
          "line",
          {
            x1: d2,
            y1: 0,
            x2: d2,
            y2: height,
            stroke,
            strokeWidth,
            strokeDasharray: dash
          }
        ),
        /* @__PURE__ */ jsx14(
          "line",
          {
            x1: d3,
            y1: 0,
            x2: d3,
            y2: height,
            stroke,
            strokeWidth,
            strokeDasharray: dash
          }
        )
      ]
    }
  );
}

// src/nodes/shapes/server.tsx
import { jsx as jsx15, jsxs as jsxs10 } from "react/jsx-runtime";
var BAY_COUNT = 3;
function ServerShape({
  width,
  height,
  borderColor,
  backgroundColor,
  borderSize,
  borderStyle
}) {
  const stroke = borderColor ?? BORDER_FALLBACK;
  const fill = backgroundColor ?? BG_FALLBACK;
  const strokeWidth = borderSize ?? DEFAULT_STROKE_WIDTH;
  const dash = dashFor(borderStyle);
  const bayH = height / BAY_COUNT;
  const ledR = Math.max(3, Math.min(6, bayH * 0.18));
  const ledCX = width - Math.max(10, ledR * 3);
  const cornerR = Math.min(8, Math.min(width, height) * 0.06);
  return /* @__PURE__ */ jsxs10(
    "svg",
    {
      width: "100%",
      height: "100%",
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: "none",
      role: "img",
      "aria-label": "Server",
      "data-testid": "server-shape",
      children: [
        /* @__PURE__ */ jsx15("title", { children: "Server" }),
        /* @__PURE__ */ jsx15(
          "rect",
          {
            x: 0,
            y: 0,
            width,
            height,
            rx: cornerR,
            ry: cornerR,
            fill,
            stroke,
            strokeWidth,
            strokeDasharray: dash
          }
        ),
        /* @__PURE__ */ jsx15(
          "line",
          {
            x1: 0,
            y1: bayH,
            x2: width,
            y2: bayH,
            stroke,
            strokeWidth,
            strokeDasharray: dash
          }
        ),
        /* @__PURE__ */ jsx15(
          "line",
          {
            x1: 0,
            y1: bayH * 2,
            x2: width,
            y2: bayH * 2,
            stroke,
            strokeWidth,
            strokeDasharray: dash
          }
        ),
        /* @__PURE__ */ jsx15("circle", { cx: ledCX, cy: bayH / 2, r: ledR, fill: stroke }),
        /* @__PURE__ */ jsx15("circle", { cx: ledCX, cy: bayH + bayH / 2, r: ledR, fill: stroke }),
        /* @__PURE__ */ jsx15("circle", { cx: ledCX, cy: bayH * 2 + bayH / 2, r: ledR, fill: stroke })
      ]
    }
  );
}

// src/nodes/shapes/user.tsx
import { jsx as jsx16, jsxs as jsxs11 } from "react/jsx-runtime";
function UserShape({
  width,
  height,
  borderColor,
  backgroundColor,
  borderSize,
  borderStyle
}) {
  const stroke = borderColor ?? BORDER_FALLBACK;
  const fill = backgroundColor ?? BG_FALLBACK;
  const strokeWidth = borderSize ?? DEFAULT_STROKE_WIDTH;
  const dash = dashFor(borderStyle);
  const headCY = height * 0.22;
  const headR = Math.max(8, Math.min(28, Math.min(width, height) * 0.18));
  const bodyTop = headCY + headR + Math.max(4, height * 0.05);
  const bodySidePad = Math.max(6, width * 0.1);
  const bodyLeft = bodySidePad;
  const bodyRight = width - bodySidePad;
  const shoulderR = Math.min((bodyRight - bodyLeft) / 2, (height - bodyTop) / 2, 40);
  const bodyPath = [
    `M ${bodyLeft} ${height}`,
    `L ${bodyLeft} ${bodyTop + shoulderR}`,
    `A ${shoulderR} ${shoulderR} 0 0 1 ${bodyLeft + shoulderR} ${bodyTop}`,
    `L ${bodyRight - shoulderR} ${bodyTop}`,
    `A ${shoulderR} ${shoulderR} 0 0 1 ${bodyRight} ${bodyTop + shoulderR}`,
    `L ${bodyRight} ${height}`,
    "Z"
  ].join(" ");
  return /* @__PURE__ */ jsxs11(
    "svg",
    {
      width: "100%",
      height: "100%",
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: "none",
      role: "img",
      "aria-label": "User",
      "data-testid": "user-shape",
      children: [
        /* @__PURE__ */ jsx16("title", { children: "User" }),
        /* @__PURE__ */ jsx16(
          "circle",
          {
            cx: width / 2,
            cy: headCY,
            r: headR,
            fill,
            stroke,
            strokeWidth,
            strokeDasharray: dash
          }
        ),
        /* @__PURE__ */ jsx16(
          "path",
          {
            d: bodyPath,
            fill,
            stroke,
            strokeWidth,
            strokeDasharray: dash
          }
        )
      ]
    }
  );
}

// src/nodes/shapes/registry.ts
var ILLUSTRATIVE_SHAPE_RENDERERS = {
  database: DatabaseShape,
  server: ServerShape,
  user: UserShape,
  queue: QueueShape,
  cloud: CloudShape
};

// src/nodes/shape-node.tsx
import { Fragment as Fragment2, jsx as jsx17, jsxs as jsxs12 } from "react/jsx-runtime";
var ILLUSTRATIVE_SHAPES = new Set(
  Object.keys(ILLUSTRATIVE_SHAPE_RENDERERS)
);
function isIllustrativeShape(shape) {
  return ILLUSTRATIVE_SHAPES.has(shape);
}
var SHAPE_DEFAULT_SIZE = {
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
  cloud: { width: 180, height: 120 }
};
var SHAPE_CLASS = {
  rectangle: "sf-rounded-lg sf-border-[3px] sf-bg-transparent",
  ellipse: "sf-rounded-full sf-border-[3px] sf-bg-transparent",
  sticky: "sf-rounded-md sf-border-[3px] sf-shadow-md -sf-rotate-1",
  text: "sf-bg-transparent",
  // US-009: illustrative shapes have no wrapper chrome — the inline SVG owns
  // border + fill so the wrapper stays a transparent positioning host.
  database: "",
  server: "",
  user: "",
  queue: "",
  cloud: ""
};
function shapeChromeClass(shape) {
  return SHAPE_CLASS[shape];
}
function shapeChromeStyle(shape, data) {
  if (shape === "text") return {};
  if (isIllustrativeShape(shape)) return {};
  const explicitToken = data?.backgroundColor;
  let backgroundColor;
  if (explicitToken !== void 0) {
    backgroundColor = colorTokenStyle(explicitToken, "node").backgroundColor;
  } else if (shape === "sticky") {
    backgroundColor = colorTokenStyle("amber", "node").backgroundColor;
  } else if (shape === "rectangle" || shape === "ellipse") {
    backgroundColor = NODE_DEFAULT_BG_WHITE;
  }
  const supportsCornerRadius = shape === "rectangle" || shape === "sticky";
  return {
    borderColor: colorTokenStyle(data?.borderColor, "node").borderColor,
    backgroundColor,
    borderWidth: data?.borderSize !== void 0 ? data.borderSize : void 0,
    borderStyle: data?.borderStyle,
    borderRadius: supportsCornerRadius && data?.cornerRadius !== void 0 ? data.cornerRadius : void 0
  };
}
function resolveIllustrativeColors(data) {
  return {
    borderColor: colorTokenStyle(data.borderColor, "node").borderColor,
    backgroundColor: data.backgroundColor !== void 0 ? colorTokenStyle(data.backgroundColor, "node").backgroundColor : NODE_DEFAULT_BG_WHITE
  };
}
var HANDLE_CLASS4 = "sf-opacity-0 sf-transition-opacity";
function ShapeNodeImpl({ id, data, selected, isConnectable }) {
  const shape = data.shape;
  const size = SHAPE_DEFAULT_SIZE[shape];
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    setResizing: data.setResizing
  });
  const [editing, setEditing] = useState6(() => {
    if (!data.autoEditOnMount) return null;
    const startsAsDescription = data.shape === "ellipse" || data.shape === "sticky" || data.shape === "rectangle" && (data.name === void 0 || data.name === "");
    return startsAsDescription ? "description" : "name";
  });
  const isEditing = editing !== null;
  const nameEditable = !!data.onNameChange;
  const descEditable = !!data.onDescriptionChange;
  const isHeaderShape = shape === "rectangle";
  const isDescriptionLabel = shape === "ellipse" || shape === "sticky";
  const hasName = data.name !== void 0 && data.name !== "";
  const useHeaderLayout = isHeaderShape && hasName;
  const renderSingleLabelAsDescription = isDescriptionLabel || isHeaderShape && !hasName;
  const sized = data.width !== void 0 || data.height !== void 0;
  const isText = shape === "text";
  const explicitTextColor = data.textColor;
  const textColorStyle = explicitTextColor !== void 0 ? colorTokenStyle(explicitTextColor, "text") : isText ? colorTokenStyle(data.borderColor, "text") : {};
  const colorStyle = {
    ...shapeChromeStyle(shape, data),
    ...data.fontSize !== void 0 ? { fontSize: `${data.fontSize}px` } : {}
  };
  const labelFontStyle = {
    ...data.fontSize !== void 0 ? { fontSize: `${data.fontSize}px` } : {},
    ...textColorStyle
  };
  const style = sized ? colorStyle : { ...colorStyle, width: data.width ?? size.width, height: data.height ?? size.height };
  const handleWrapperDoubleClick = nameEditable || descEditable ? (e) => {
    if (isEditing) return;
    const target = e.target;
    if (target?.closest(".react-flow__handle")) return;
    if (target?.closest(".react-flow__resize-control")) return;
    e.stopPropagation();
    if (useHeaderLayout) {
      if (target?.closest('[data-testid="shape-node-header"]')) {
        if (nameEditable) setEditing("name");
        return;
      }
      if (descEditable) setEditing("description");
      else if (nameEditable) setEditing("name");
      return;
    }
    if (renderSingleLabelAsDescription) {
      if (descEditable) setEditing("description");
      else if (nameEditable) setEditing("name");
      return;
    }
    if (nameEditable) setEditing("name");
  } : void 0;
  let illustrativeOverlay = null;
  const Renderer = ILLUSTRATIVE_SHAPE_RENDERERS[shape];
  if (Renderer) {
    const w = data.width ?? size.width;
    const h = data.height ?? size.height;
    const { borderColor, backgroundColor } = resolveIllustrativeColors(data);
    illustrativeOverlay = /* @__PURE__ */ jsx17("div", { className: "sf-pointer-events-none sf-absolute sf-inset-0", children: /* @__PURE__ */ jsx17(
      Renderer,
      {
        width: w,
        height: h,
        borderColor,
        backgroundColor,
        borderSize: data.borderSize,
        borderStyle: data.borderStyle
      }
    ) });
  }
  const description = data.description ?? "";
  const hasDescription = description !== "";
  const descriptionFontStyle = {
    ...data.fontSize !== void 0 ? { fontSize: `${data.fontSize}px` } : {},
    ...textColorStyle
  };
  let singleLabelContent;
  if (renderSingleLabelAsDescription) {
    singleLabelContent = editing === "description" && descEditable ? /* @__PURE__ */ jsx17(
      InlineEdit,
      {
        initialValue: description,
        field: "node-description",
        commitMode: "blur-only",
        onCommit: (v) => data.onDescriptionChange?.(id, v),
        onExit: () => setEditing(null),
        className: "sf-relative sf-text-[22px]",
        style: descriptionFontStyle,
        placeholder: "Description"
      }
    ) : /* @__PURE__ */ jsx17(
      "button",
      {
        type: "button",
        className: cn(
          "sf-relative sf-block sf-whitespace-pre-wrap sf-bg-transparent sf-p-0 sf-font-medium sf-leading-tight",
          hasDescription ? "break-words" : "sf-italic sf-text-muted-foreground/40"
        ),
        style: descriptionFontStyle,
        children: hasDescription ? description : ""
      }
    );
  } else {
    singleLabelContent = editing === "name" && nameEditable ? /* @__PURE__ */ jsx17(
      InlineEdit,
      {
        initialValue: data.name ?? "",
        field: "node-label",
        commitMode: "blur-only",
        onCommit: (v) => data.onNameChange?.(id, v),
        onExit: () => setEditing(null),
        className: "sf-relative sf-text-[22px]",
        style: labelFontStyle,
        placeholder: isText ? "Text" : "Label"
      }
    ) : /* @__PURE__ */ jsx17(
      "button",
      {
        type: "button",
        className: cn(
          // US-009: `relative` — see the InlineEdit branch above.
          "sf-relative sf-block sf-whitespace-pre-wrap sf-bg-transparent sf-p-0 sf-font-medium sf-leading-tight",
          data.name ? "break-words" : "sf-text-muted-foreground/40 sf-italic"
        ),
        style: labelFontStyle,
        children: data.name ?? (isText && nameEditable ? "Text" : "")
      }
    );
  }
  const headerBodyContent = /* @__PURE__ */ jsxs12(Fragment2, { children: [
    /* @__PURE__ */ jsx17(
      "div",
      {
        className: "sf-relative sf-flex sf-shrink-0 sf-items-center sf-border-b sf-px-2 sf-py-1.5",
        style: colorTokenStyle(data.backgroundColor, "node-header"),
        "data-testid": "shape-node-header",
        children: /* @__PURE__ */ jsx17(
          "div",
          {
            className: "sf-min-w-0 sf-flex-1 sf-whitespace-pre-wrap sf-break-words sf-text-left sf-font-semibold sf-text-[18px] sf-leading-tight",
            style: labelFontStyle,
            children: editing === "name" && nameEditable ? /* @__PURE__ */ jsx17(
              InlineEdit,
              {
                initialValue: data.name ?? "",
                field: "node-label",
                commitMode: "blur-only",
                onCommit: (v) => data.onNameChange?.(id, v),
                onExit: () => setEditing(null),
                className: "sf-text-[18px] sf-font-semibold",
                style: labelFontStyle,
                placeholder: "Title"
              }
            ) : /* @__PURE__ */ jsx17(
              "button",
              {
                type: "button",
                className: cn(
                  "sf-block sf-w-full sf-whitespace-pre-wrap sf-break-words sf-bg-transparent sf-p-0 sf-text-left sf-font-semibold sf-text-[18px] sf-leading-tight",
                  nameEditable ? "hover:sf-opacity-80" : ""
                ),
                style: labelFontStyle,
                children: data.name
              }
            )
          }
        )
      }
    ),
    /* @__PURE__ */ jsx17(
      "div",
      {
        className: "sf-relative sf-flex sf-min-h-0 sf-flex-1 sf-items-center sf-px-2 sf-py-1.5",
        "data-testid": "shape-node-body",
        children: editing === "description" && descEditable ? /* @__PURE__ */ jsx17(
          InlineEdit,
          {
            initialValue: description,
            field: "node-description",
            commitMode: "blur-only",
            onCommit: (v) => data.onDescriptionChange?.(id, v),
            onExit: () => setEditing(null),
            className: "sf-w-full sf-text-[16px] sf-text-muted-foreground",
            style: descriptionFontStyle,
            placeholder: "Description"
          }
        ) : /* @__PURE__ */ jsx17(
          "button",
          {
            type: "button",
            className: cn(
              "sf-block sf-w-full sf-whitespace-pre-wrap sf-break-words sf-bg-transparent sf-p-0 sf-text-left sf-text-[16px] sf-leading-tight",
              hasDescription ? "text-muted-foreground" : "sf-italic sf-text-muted-foreground/40",
              descEditable ? "hover:sf-opacity-80" : ""
            ),
            style: descriptionFontStyle,
            children: hasDescription ? description : descEditable ? "Double-click to add description" : ""
          }
        )
      }
    )
  ] });
  return /* @__PURE__ */ jsxs12(
    "div",
    {
      className: cn(
        "group",
        // `relative` only on layouts that need a positioned inner div for
        // absolute children (illustrative SVG overlay, single-label edit
        // surface). The header layout deliberately stays `position: static`
        // so the outer React Flow wrapper acts as the containing block for
        // the absolutely-positioned handles + NodeResizeControl — otherwise
        // the inner div's `overflow-hidden` (needed for the header bg to
        // respect the rounded corners) clips them, matching the state-node
        // pattern.
        useHeaderLayout ? "" : "sf-relative",
        useHeaderLayout ? "sf-flex sf-flex-col sf-overflow-hidden sf-text-left" : "sf-flex sf-items-center sf-justify-center sf-p-2 sf-text-center sf-text-[22px]",
        sized ? "sf-h-full sf-w-full" : "",
        shapeChromeClass(shape)
      ),
      style,
      "data-testid": "shape-node",
      "data-shape": shape,
      onDoubleClick: handleWrapperDoubleClick,
      children: [
        illustrativeOverlay,
        /* @__PURE__ */ jsx17(
          ResizeControls,
          {
            visible: !!selected && !!data.onResize && !isEditing && !data.locked,
            cornerVariant: "visible",
            minWidth: 80,
            minHeight: 40,
            onResizeStart,
            onResize: onResizeEvent,
            onResizeEnd
          }
        ),
        data.locked ? /* @__PURE__ */ jsx17(LockBadge, {}) : null,
        !isText && /* @__PURE__ */ jsx17(
          Handle5,
          {
            type: "target",
            position: Position5.Top,
            id: "t",
            isConnectable,
            className: cn(HANDLE_CLASS4, selected && "!sf-opacity-100")
          }
        ),
        !isText && /* @__PURE__ */ jsx17(
          Handle5,
          {
            type: "target",
            position: Position5.Left,
            id: "l",
            isConnectable,
            className: cn(HANDLE_CLASS4, selected && "!sf-opacity-100")
          }
        ),
        useHeaderLayout ? headerBodyContent : singleLabelContent,
        !isText && /* @__PURE__ */ jsx17(
          Handle5,
          {
            type: "source",
            position: Position5.Right,
            id: "r",
            isConnectable,
            className: cn(HANDLE_CLASS4, selected && "!sf-opacity-100")
          }
        ),
        !isText && /* @__PURE__ */ jsx17(
          Handle5,
          {
            type: "source",
            position: Position5.Bottom,
            id: "b",
            isConnectable,
            className: cn(HANDLE_CLASS4, selected && "!sf-opacity-100")
          }
        )
      ]
    }
  );
}
function arePropsEqual5(prev, next) {
  return prev.selected === next.selected && prev.data === next.data && prev.width === next.width && prev.height === next.height;
}
var ShapeNode = memo5(ShapeNodeImpl, arePropsEqual5);

// src/nodes/state-node.tsx
import { Handle as Handle6, Position as Position6 } from "@xyflow/react";
import { memo as memo6, useState as useState7 } from "react";

// src/nodes/status-pill.tsx
import { jsx as jsx18 } from "react/jsx-runtime";
var STYLES = {
  running: "sf-bg-amber-950/50 sf-text-amber-300 sf-animate-pulse",
  done: "sf-bg-emerald-950/50 sf-text-emerald-300",
  error: "sf-bg-rose-950/50 sf-text-rose-300"
};
function StatusPill({
  status,
  "data-testid": dataTestId
}) {
  if (status === "idle") return null;
  return /* @__PURE__ */ jsx18(
    "span",
    {
      "data-status": status,
      "data-testid": dataTestId,
      className: cn(
        "sf-inline-flex sf-h-4 sf-items-center sf-rounded-full sf-px-1.5 sf-py-0 sf-font-normal sf-text-[9px] sf-uppercase sf-tracking-wide",
        STYLES[status]
      ),
      children: status
    }
  );
}

// src/nodes/state-node.tsx
import { jsx as jsx19, jsxs as jsxs13 } from "react/jsx-runtime";
var MIN_W5 = 100;
var MIN_H5 = 44;
var DEFAULT_W2 = 200;
function StateNodeImpl({ id, data, selected, isConnectable }) {
  const status = data.status ?? "idle";
  const description = data.description ?? data.kind;
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    setResizing: data.setResizing
  });
  const [editing, setEditing] = useState7(null);
  const nameEditable = !!data.onNameChange;
  const descEditable = !!data.onDescriptionChange;
  const sized = data.width !== void 0 || data.height !== void 0;
  const labelFontStyle = {
    ...data.fontSize !== void 0 ? { fontSize: `${data.fontSize}px` } : {},
    ...colorTokenStyle(data.textColor, "text")
  };
  const descriptionFontStyle = labelFontStyle;
  const containerStyle = {
    borderColor: data.statusReport?.state === "error" ? colorTokenStyle("red", "node").borderColor : colorTokenStyle(data.borderColor, "node").borderColor,
    backgroundColor: colorTokenStyle(data.backgroundColor, "node").backgroundColor,
    borderWidth: data.borderSize !== void 0 ? data.borderSize : void 0,
    borderStyle: data.borderStyle,
    borderRadius: data.cornerRadius !== void 0 ? data.cornerRadius : void 0,
    ...sized ? {} : { width: DEFAULT_W2 }
  };
  const handleWrapperDoubleClick = nameEditable || descEditable ? (e) => {
    if (editing !== null) return;
    const target = e.target;
    if (target?.closest(".react-flow__handle")) return;
    if (target?.closest(".react-flow__resize-control")) return;
    e.stopPropagation();
    if (target?.closest('[data-testid="node-header"]')) {
      if (nameEditable) setEditing("name");
      return;
    }
    if (target?.closest('[data-testid="node-content"]')) {
      if (descEditable) setEditing("description");
      else if (nameEditable) setEditing("name");
      return;
    }
    if (descEditable) setEditing("description");
    else if (nameEditable) setEditing("name");
  } : void 0;
  return /* @__PURE__ */ jsxs13(
    "div",
    {
      className: cn(
        "sf-group sf-flex sf-flex-col sf-justify-center sf-overflow-hidden sf-rounded-lg sf-border-[3px] sf-border-dashed sf-shadow-sm sf-transition-shadow",
        sized ? "sf-h-full sf-w-full" : "",
        status === "running" ? "seeflow-node-pulse" : ""
      ),
      style: containerStyle,
      "data-status": status,
      "data-testid": "state-node",
      onDoubleClick: handleWrapperDoubleClick,
      children: [
        /* @__PURE__ */ jsx19(
          ResizeControls,
          {
            visible: !!selected && !!data.onResize && !data.locked,
            cornerVariant: "visible",
            minWidth: MIN_W5,
            minHeight: MIN_H5,
            onResizeStart,
            onResize: onResizeEvent,
            onResizeEnd
          }
        ),
        data.locked ? /* @__PURE__ */ jsx19(LockBadge, {}) : null,
        /* @__PURE__ */ jsx19(
          Handle6,
          {
            type: "target",
            position: Position6.Top,
            id: "t",
            isConnectable,
            className: cn("sf-opacity-0 sf-transition-opacity", selected && "!sf-opacity-100")
          }
        ),
        /* @__PURE__ */ jsx19(
          Handle6,
          {
            type: "target",
            position: Position6.Left,
            id: "l",
            isConnectable,
            className: cn("sf-opacity-0 sf-transition-opacity", selected && "!sf-opacity-100")
          }
        ),
        /* @__PURE__ */ jsxs13(
          "div",
          {
            className: "sf-flex sf-shrink-0 sf-items-center sf-justify-between sf-gap-2 sf-border-b sf-px-2 sf-py-2",
            style: colorTokenStyle(data.backgroundColor, "node-header"),
            "data-testid": "node-header",
            children: [
              data.icon ? /* @__PURE__ */ jsx19(
                Icon,
                {
                  name: data.icon,
                  size: 16,
                  className: "shrink-0",
                  style: colorTokenStyle(data.textColor, "text"),
                  "aria-hidden": true
                }
              ) : null,
              /* @__PURE__ */ jsx19(
                "div",
                {
                  className: "sf-min-w-0 sf-flex-1 sf-text-[18px] sf-font-semibold sf-leading-tight",
                  style: labelFontStyle,
                  children: editing === "name" && nameEditable ? /* @__PURE__ */ jsx19(
                    InlineEdit,
                    {
                      initialValue: data.name,
                      field: "node-name",
                      required: true,
                      commitMode: "blur-only",
                      onCommit: (v) => data.onNameChange?.(id, v),
                      onExit: () => setEditing(null),
                      className: "sf-text-[18px] sf-font-semibold",
                      style: labelFontStyle
                    }
                  ) : /* @__PURE__ */ jsx19(
                    "button",
                    {
                      type: "button",
                      className: cn(
                        "sf-block sf-w-full sf-whitespace-pre-wrap sf-break-words sf-bg-transparent sf-p-0 sf-text-left sf-text-[18px] sf-font-semibold sf-leading-tight",
                        nameEditable ? "hover:sf-opacity-80" : ""
                      ),
                      style: labelFontStyle,
                      children: data.name
                    }
                  )
                }
              ),
              /* @__PURE__ */ jsx19("div", { className: "sf-flex sf-shrink-0 sf-items-center sf-gap-1", children: /* @__PURE__ */ jsx19(StatusPill, { status }) })
            ]
          }
        ),
        /* @__PURE__ */ jsx19(
          "div",
          {
            className: "sf-flex sf-min-h-0 sf-flex-1 sf-items-center sf-px-2 sf-py-1",
            "data-testid": "node-content",
            "data-resizing": isResizing ? "true" : void 0,
            children: editing === "description" && descEditable ? /* @__PURE__ */ jsx19(
              InlineEdit,
              {
                initialValue: data.description ?? "",
                field: "node-description",
                multiline: true,
                onCommit: (v) => data.onDescriptionChange?.(id, v),
                onExit: () => setEditing(null),
                className: "sf-w-full sf-text-[18px] sf-text-muted-foreground",
                style: descriptionFontStyle,
                placeholder: data.kind
              }
            ) : /* @__PURE__ */ jsx19(
              "button",
              {
                type: "button",
                className: cn(
                  "sf-block sf-w-full sf-whitespace-normal sf-break-words sf-bg-transparent sf-p-0 sf-text-left sf-text-[18px] sf-text-muted-foreground",
                  descEditable ? "hover:sf-opacity-80" : ""
                ),
                style: descriptionFontStyle,
                children: description
              }
            )
          }
        ),
        /* @__PURE__ */ jsx19(
          Handle6,
          {
            type: "source",
            position: Position6.Right,
            id: "r",
            isConnectable,
            className: cn("sf-opacity-0 sf-transition-opacity", selected && "!sf-opacity-100")
          }
        ),
        /* @__PURE__ */ jsx19(
          Handle6,
          {
            type: "source",
            position: Position6.Bottom,
            id: "b",
            isConnectable,
            className: cn("sf-opacity-0 sf-transition-opacity", selected && "!sf-opacity-100")
          }
        )
      ]
    }
  );
}
function arePropsEqual6(prev, next) {
  return prev.selected === next.selected && prev.data === next.data && prev.width === next.width && prev.height === next.height;
}
var StateNode = memo6(StateNodeImpl, arePropsEqual6);

// src/edges/editable-edge.tsx
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position as Position7,
  ViewportPortal,
  getBezierPath,
  getSmoothStepPath,
  useInternalNode
} from "@xyflow/react";
import { useEffect as useEffect5, useState as useState8 } from "react";
import { Fragment as Fragment3, jsx as jsx20, jsxs as jsxs14 } from "react/jsx-runtime";
var SMOOTHSTEP_BORDER_RADIUS = 8;
var RECONNECT_ANCHOR_SHIFT = 10;
var shiftAnchorForSide = (baseX, baseY, side) => {
  switch (side) {
    case "top":
      return { cx: baseX, cy: baseY - RECONNECT_ANCHOR_SHIFT };
    case "bottom":
      return { cx: baseX, cy: baseY + RECONNECT_ANCHOR_SHIFT };
    case "left":
      return { cx: baseX - RECONNECT_ANCHOR_SHIFT, cy: baseY };
    case "right":
      return { cx: baseX + RECONNECT_ANCHOR_SHIFT, cy: baseY };
  }
};
var POSITION_BY_SIDE = {
  top: Position7.Top,
  right: Position7.Right,
  bottom: Position7.Bottom,
  left: Position7.Left
};
var sideFromPosition = (p) => {
  switch (p) {
    case Position7.Top:
      return "top";
    case Position7.Right:
      return "right";
    case Position7.Bottom:
      return "bottom";
    case Position7.Left:
      return "left";
  }
};
function EditableEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  style,
  markerEnd,
  markerStart,
  interactionWidth,
  data
}) {
  const [editing, setEditing] = useState8(false);
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const sourceFallback = {
    x: sourceX,
    y: sourceY,
    side: sideFromPosition(sourcePosition)
  };
  const targetFallback = {
    x: targetX,
    y: targetY,
    side: sideFromPosition(targetPosition)
  };
  const endpoints = resolveEdgeEndpoints(
    sourceNode ? {
      box: {
        x: sourceNode.internals.positionAbsolute.x,
        y: sourceNode.internals.positionAbsolute.y,
        w: sourceNode.measured.width ?? sourceNode.width ?? 0,
        h: sourceNode.measured.height ?? sourceNode.height ?? 0
      },
      autoPicked: data?.sourceHandleAutoPicked,
      pin: data?.sourcePin,
      fallback: sourceFallback
    } : null,
    targetNode ? {
      box: {
        x: targetNode.internals.positionAbsolute.x,
        y: targetNode.internals.positionAbsolute.y,
        w: targetNode.measured.width ?? targetNode.width ?? 0,
        h: targetNode.measured.height ?? targetNode.height ?? 0
      },
      autoPicked: data?.targetHandleAutoPicked,
      pin: data?.targetPin,
      fallback: targetFallback
    } : null
  );
  const sX = endpoints.source.x;
  const sY = endpoints.source.y;
  const sPos = POSITION_BY_SIDE[endpoints.source.side];
  const tX = endpoints.target.x;
  const tY = endpoints.target.y;
  const tPos = POSITION_BY_SIDE[endpoints.target.side];
  const sourceSide = endpoints.source.side;
  const targetSide = endpoints.target.side;
  const sourceShift = shiftAnchorForSide(sX, sY, sourceSide);
  const targetShift = shiftAnchorForSide(tX, tY, targetSide);
  useEffect5(() => {
    const wrapper = document.querySelector(
      `.react-flow__edge[data-id="${CSS.escape(id)}"]`
    );
    if (!wrapper) return;
    const sourceAnchor = wrapper.querySelector(".react-flow__edgeupdater-source");
    const targetAnchor = wrapper.querySelector(".react-flow__edgeupdater-target");
    if (sourceAnchor) {
      sourceAnchor.setAttribute("cx", String(sourceShift.cx));
      sourceAnchor.setAttribute("cy", String(sourceShift.cy));
    }
    if (targetAnchor) {
      targetAnchor.setAttribute("cx", String(targetShift.cx));
      targetAnchor.setAttribute("cy", String(targetShift.cy));
    }
  }, [id, sourceShift.cx, sourceShift.cy, targetShift.cx, targetShift.cy]);
  const [edgePath, labelX, labelY] = data?.path === "step" ? getSmoothStepPath({
    sourceX: sX,
    sourceY: sY,
    sourcePosition: sPos,
    targetX: tX,
    targetY: tY,
    targetPosition: tPos,
    borderRadius: SMOOTHSTEP_BORDER_RADIUS
  }) : getBezierPath({
    sourceX: sX,
    sourceY: sY,
    sourcePosition: sPos,
    targetX: tX,
    targetY: tY,
    targetPosition: tPos
  });
  const onLabelChange = data?.onLabelChange;
  const labelText = typeof label === "string" ? label : "";
  const editable = !!onLabelChange;
  const fontSize = data?.fontSize;
  const fontSizeStyle = typeof fontSize === "number" ? { fontSize: `${fontSize}px` } : void 0;
  const registerEditHandle = data?.registerEditHandle;
  useEffect5(() => {
    if (!registerEditHandle || !editable) return;
    return registerEditHandle(id, () => setEditing(true));
  }, [id, registerEditHandle, editable]);
  const showEndpointDots = data?.reconnectable === true;
  const sourcePinned = data?.sourcePin !== void 0;
  const targetPinned = data?.targetPin !== void 0;
  return /* @__PURE__ */ jsxs14(Fragment3, { children: [
    /* @__PURE__ */ jsx20(
      BaseEdge,
      {
        id,
        path: edgePath,
        style,
        markerEnd,
        markerStart,
        interactionWidth
      }
    ),
    showEndpointDots ? /* @__PURE__ */ jsxs14(ViewportPortal, { children: [
      /* @__PURE__ */ jsx20(
        "div",
        {
          "data-testid": `edge-endpoint-source-${id}`,
          "data-pinned": sourcePinned ? "true" : "false",
          className: "seeflow-connector-endpoint-dot",
          style: {
            transform: `translate(-50%, -50%) translate(${sourceShift.cx}px, ${sourceShift.cy}px)`
          }
        }
      ),
      /* @__PURE__ */ jsx20(
        "div",
        {
          "data-testid": `edge-endpoint-target-${id}`,
          "data-pinned": targetPinned ? "true" : "false",
          className: "seeflow-connector-endpoint-dot",
          style: {
            transform: `translate(-50%, -50%) translate(${targetShift.cx}px, ${targetShift.cy}px)`
          }
        }
      )
    ] }) : null,
    /* @__PURE__ */ jsx20(EdgeLabelRenderer, { children: /* @__PURE__ */ jsx20(
      "div",
      {
        className: "nodrag nopan nowheel pointer-events-auto absolute",
        style: {
          transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`
        },
        children: editing && editable ? /* @__PURE__ */ jsx20(
          InlineEdit,
          {
            initialValue: labelText,
            field: "connector-label",
            onCommit: (v) => onLabelChange?.(id, v),
            onExit: () => setEditing(false),
            className: "sf-rounded sf-border sf-border-border/40 sf-bg-background sf-px-1.5 sf-py-0.5 sf-text-[11px] sf-text-foreground sf-shadow-sm",
            style: fontSizeStyle,
            placeholder: "Label"
          }
        ) : labelText ? /* @__PURE__ */ jsx20(
          "button",
          {
            type: "button",
            className: cn(
              "sf-rounded sf-border sf-border-border/40 sf-bg-background sf-px-1.5 sf-py-0.5 sf-text-[11px] sf-text-foreground sf-shadow-sm",
              editable ? "hover:bg-muted/60" : ""
            ),
            style: fontSizeStyle,
            onDoubleClick: editable ? (e) => {
              e.stopPropagation();
              setEditing(true);
            } : void 0,
            children: labelText
          }
        ) : editable ? /* @__PURE__ */ jsx20(
          "button",
          {
            type: "button",
            "aria-label": "Add connector label",
            className: "sf-rounded-full sf-border sf-border-dashed sf-border-muted-foreground/40 sf-bg-background sf-px-1 sf-text-[10px] sf-text-muted-foreground/60 sf-opacity-0 sf-transition-opacity hover:sf-opacity-100 group-hover/canvas:sf-opacity-50",
            onDoubleClick: (e) => {
              e.stopPropagation();
              setEditing(true);
            },
            children: "+"
          }
        ) : null
      }
    ) })
  ] });
}

// src/ui/command.tsx
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import * as React3 from "react";

// src/ui/dialog.tsx
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React2 from "react";

// src/components/canvas-portal-container.tsx
import { createContext as createContext2, useContext as useContext2 } from "react";
import { jsx as jsx21 } from "react/jsx-runtime";
var PortalContainerContext = createContext2(null);
function CanvasPortalContainerProvider({
  containerRef,
  children
}) {
  return /* @__PURE__ */ jsx21(PortalContainerContext.Provider, { value: containerRef.current, children });
}
function useCanvasPortalContainer() {
  return useContext2(PortalContainerContext) ?? void 0;
}

// src/ui/dialog.tsx
import { jsx as jsx22, jsxs as jsxs15 } from "react/jsx-runtime";
var Dialog = DialogPrimitive.Root;
var DialogTrigger = DialogPrimitive.Trigger;
var DialogPortal = ({
  children,
  ...props
}) => {
  const portalContainer = useCanvasPortalContainer();
  return /* @__PURE__ */ jsx22(DialogPrimitive.Portal, { container: portalContainer, ...props, children });
};
var DialogClose = DialogPrimitive.Close;
var DialogOverlay = React2.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx22(
  DialogPrimitive.Overlay,
  {
    ref,
    className: cn(
      "sf-fixed sf-inset-0 sf-z-50 sf-bg-black/80 data-[state=open]:sf-animate-in data-[state=closed]:sf-animate-out data-[state=closed]:sf-fade-out-0 data-[state=open]:sf-fade-in-0",
      className
    ),
    ...props
  }
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;
var DialogContent = React2.forwardRef(({ className, children, ...props }, ref) => /* @__PURE__ */ jsxs15(DialogPortal, { children: [
  /* @__PURE__ */ jsx22(DialogOverlay, {}),
  /* @__PURE__ */ jsxs15(
    DialogPrimitive.Content,
    {
      ref,
      className: cn(
        "sf-fixed sf-left-[50%] sf-top-[50%] sf-z-50 sf-grid sf-w-full sf-max-w-lg sf-translate-x-[-50%] sf-translate-y-[-50%] sf-gap-4 sf-border sf-border-border sf-bg-card sf-p-6 sf-shadow-lg sf-duration-200 data-[state=open]:sf-animate-in data-[state=closed]:sf-animate-out data-[state=closed]:sf-fade-out-0 data-[state=open]:sf-fade-in-0 data-[state=closed]:sf-zoom-out-95 data-[state=open]:sf-zoom-in-95 data-[state=closed]:sf-slide-out-to-left-1/2 data-[state=closed]:sf-slide-out-to-top-[48%] data-[state=open]:sf-slide-in-from-left-1/2 data-[state=open]:sf-slide-in-from-top-[48%] sm:sf-rounded-lg",
        className
      ),
      ...props,
      children: [
        children,
        /* @__PURE__ */ jsxs15(DialogPrimitive.Close, { className: "sf-absolute sf-right-4 sf-top-4 sf-rounded-sm sf-opacity-70 sf-ring-offset-background sf-transition-opacity hover:sf-opacity-100 focus:sf-outline-none focus:sf-ring-2 focus:sf-ring-ring focus:sf-ring-offset-2 disabled:sf-pointer-events-none", children: [
          /* @__PURE__ */ jsx22(X, { className: "sf-h-4 sf-w-4" }),
          /* @__PURE__ */ jsx22("span", { className: "sr-only", children: "Close" })
        ] })
      ]
    }
  )
] }));
DialogContent.displayName = DialogPrimitive.Content.displayName;
var DialogHeader = ({ className, ...props }) => /* @__PURE__ */ jsx22(
  "div",
  {
    className: cn("sf-flex sf-flex-col sf-space-y-1.5 sf-text-center sm:sf-text-left", className),
    ...props
  }
);
DialogHeader.displayName = "DialogHeader";
var DialogFooter = ({ className, ...props }) => /* @__PURE__ */ jsx22(
  "div",
  {
    className: cn(
      "sf-flex sf-flex-col-reverse sm:sf-flex-row sm:sf-justify-end sm:sf-space-x-2",
      className
    ),
    ...props
  }
);
DialogFooter.displayName = "DialogFooter";
var DialogTitle = React2.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx22(
  DialogPrimitive.Title,
  {
    ref,
    className: cn("sf-text-lg sf-font-semibold sf-leading-none sf-tracking-tight", className),
    ...props
  }
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;
var DialogDescription = React2.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx22(
  DialogPrimitive.Description,
  {
    ref,
    className: cn("sf-text-sm sf-text-muted-foreground", className),
    ...props
  }
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

// src/ui/command.tsx
import { jsx as jsx23, jsxs as jsxs16 } from "react/jsx-runtime";
var Command = React3.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx23(
  CommandPrimitive,
  {
    ref,
    className: cn(
      "sf-flex sf-h-full sf-w-full sf-flex-col sf-overflow-hidden sf-rounded-md sf-bg-card sf-text-foreground",
      className
    ),
    ...props
  }
));
Command.displayName = CommandPrimitive.displayName;
var CommandDialog = ({ children, ...props }) => {
  return /* @__PURE__ */ jsx23(Dialog, { ...props, children: /* @__PURE__ */ jsx23(DialogContent, { className: "sf-overflow-hidden sf-p-0 sf-shadow-lg", children: /* @__PURE__ */ jsx23(Command, { className: "[&_[cmdk-group-heading]]:sf-px-2 [&_[cmdk-group-heading]]:sf-font-medium [&_[cmdk-group-heading]]:sf-text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:sf-pt-0 [&_[cmdk-group]]:sf-px-2 [&_[cmdk-input-wrapper]_svg]:sf-h-5 [&_[cmdk-input-wrapper]_svg]:sf-w-5 [&_[cmdk-input]]:sf-h-12 [&_[cmdk-item]]:sf-px-2 [&_[cmdk-item]]:sf-py-3 [&_[cmdk-item]_svg]:sf-h-5 [&_[cmdk-item]_svg]:sf-w-5", children }) }) });
};
var CommandInput = React3.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsxs16("div", { className: "sf-flex sf-items-center sf-border-b sf-px-3", "cmdk-input-wrapper": "", children: [
  /* @__PURE__ */ jsx23(Search, { className: "sf-mr-2 sf-h-4 sf-w-4 sf-shrink-0 sf-opacity-50" }),
  /* @__PURE__ */ jsx23(
    CommandPrimitive.Input,
    {
      ref,
      className: cn(
        "sf-flex sf-h-11 sf-w-full sf-rounded-md sf-bg-transparent sf-py-3 sf-text-sm sf-outline-none placeholder:sf-text-muted-foreground disabled:sf-cursor-not-allowed disabled:sf-opacity-50",
        className
      ),
      ...props
    }
  )
] }));
CommandInput.displayName = CommandPrimitive.Input.displayName;
var CommandList = React3.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx23(
  CommandPrimitive.List,
  {
    ref,
    className: cn("sf-max-h-[300px] sf-overflow-y-auto sf-overflow-x-hidden", className),
    ...props
  }
));
CommandList.displayName = CommandPrimitive.List.displayName;
var CommandEmpty = React3.forwardRef((props, ref) => /* @__PURE__ */ jsx23(CommandPrimitive.Empty, { ref, className: "sf-py-6 sf-text-center sf-text-sm", ...props }));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;
var CommandGroup = React3.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx23(
  CommandPrimitive.Group,
  {
    ref,
    className: cn(
      "sf-overflow-hidden sf-p-1 sf-text-foreground [&_[cmdk-group-heading]]:sf-px-2 [&_[cmdk-group-heading]]:sf-py-1.5 [&_[cmdk-group-heading]]:sf-text-xs [&_[cmdk-group-heading]]:sf-font-medium [&_[cmdk-group-heading]]:sf-text-muted-foreground",
      className
    ),
    ...props
  }
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;
var CommandSeparator = React3.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx23(
  CommandPrimitive.Separator,
  {
    ref,
    className: cn("-sf-mx-1 sf-h-px sf-bg-border", className),
    ...props
  }
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;
var CommandItem = React3.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx23(
  CommandPrimitive.Item,
  {
    ref,
    className: cn(
      "sf-relative sf-flex sf-cursor-default sf-select-none sf-items-center sf-rounded-sm sf-px-2 sf-py-1.5 sf-text-sm sf-outline-none aria-selected:sf-bg-muted aria-selected:sf-text-foreground data-[disabled='true']:sf-pointer-events-none data-[disabled='true']:sf-opacity-50",
      className
    ),
    ...props
  }
));
CommandItem.displayName = CommandPrimitive.Item.displayName;
var CommandShortcut = ({ className, ...props }) => {
  return /* @__PURE__ */ jsx23(
    "span",
    {
      className: cn("sf-ml-auto sf-text-xs sf-tracking-widest sf-text-muted-foreground", className),
      ...props
    }
  );
};
CommandShortcut.displayName = "CommandShortcut";

// src/ui/context-menu.tsx
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import * as React4 from "react";
import { jsx as jsx24 } from "react/jsx-runtime";
var ContextMenu = ContextMenuPrimitive.Root;
var ContextMenuTrigger = ContextMenuPrimitive.Trigger;
var ContextMenuContent = React4.forwardRef(({ className, ...props }, ref) => {
  const portalContainer = useCanvasPortalContainer();
  return /* @__PURE__ */ jsx24(ContextMenuPrimitive.Portal, { container: portalContainer, children: /* @__PURE__ */ jsx24(
    ContextMenuPrimitive.Content,
    {
      ref,
      className: cn(
        "sf-z-50 sf-min-w-[10rem] sf-overflow-hidden sf-rounded-md sf-border sf-bg-popover sf-p-1 sf-text-popover-foreground sf-shadow-md data-[state=open]:sf-animate-in data-[state=closed]:sf-animate-out data-[state=closed]:sf-fade-out-0 data-[state=open]:sf-fade-in-0 data-[state=closed]:sf-zoom-out-95 data-[state=open]:sf-zoom-in-95",
        className
      ),
      ...props
    }
  ) });
});
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;
var ContextMenuItem = React4.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx24(
  ContextMenuPrimitive.Item,
  {
    ref,
    className: cn(
      "sf-relative sf-flex sf-cursor-default sf-select-none sf-items-center sf-rounded-sm sf-px-2 sf-py-1.5 sf-text-sm sf-outline-none data-[disabled]:sf-pointer-events-none data-[highlighted]:sf-bg-accent data-[highlighted]:sf-text-accent-foreground data-[disabled]:sf-opacity-50",
      className
    ),
    ...props
  }
));
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;
var ContextMenuSeparator = React4.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx24(
  ContextMenuPrimitive.Separator,
  {
    ref,
    className: cn("-sf-mx-1 sf-my-1 sf-h-px sf-bg-border", className),
    ...props
  }
));
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName;
var ContextMenuShortcut = ({ className, ...props }) => /* @__PURE__ */ jsx24(
  "span",
  {
    className: cn(
      "sf-ml-auto sf-pl-4 sf-text-xs sf-tracking-widest sf-text-muted-foreground",
      className
    ),
    ...props
  }
);
ContextMenuShortcut.displayName = "ContextMenuShortcut";

// src/ui/dropdown-menu.tsx
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as React5 from "react";
import { jsx as jsx25 } from "react/jsx-runtime";
var DropdownMenu = DropdownMenuPrimitive.Root;
var DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
var DropdownMenuContent = React5.forwardRef(({ className, sideOffset = 4, ...props }, ref) => {
  const portalContainer = useCanvasPortalContainer();
  return /* @__PURE__ */ jsx25(DropdownMenuPrimitive.Portal, { container: portalContainer, children: /* @__PURE__ */ jsx25(
    DropdownMenuPrimitive.Content,
    {
      ref,
      sideOffset,
      className: cn(
        "sf-z-50 sf-min-w-[10rem] sf-overflow-hidden sf-rounded-md sf-border sf-bg-popover sf-p-1 sf-text-popover-foreground sf-shadow-md data-[state=open]:sf-animate-in data-[state=closed]:sf-animate-out data-[state=closed]:sf-fade-out-0 data-[state=open]:sf-fade-in-0 data-[state=closed]:sf-zoom-out-95 data-[state=open]:sf-zoom-in-95 data-[side=bottom]:sf-slide-in-from-top-2 data-[side=left]:sf-slide-in-from-right-2 data-[side=right]:sf-slide-in-from-left-2 data-[side=top]:sf-slide-in-from-bottom-2",
        className
      ),
      ...props
    }
  ) });
});
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;
var DropdownMenuItem = React5.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx25(
  DropdownMenuPrimitive.Item,
  {
    ref,
    className: cn(
      "sf-relative sf-flex sf-cursor-default sf-select-none sf-items-center sf-gap-2 sf-rounded-sm sf-px-2 sf-py-1.5 sf-text-sm sf-outline-none data-[disabled]:sf-pointer-events-none data-[highlighted]:sf-bg-accent data-[highlighted]:sf-text-accent-foreground data-[disabled]:sf-opacity-50",
      className
    ),
    ...props
  }
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;
var DropdownMenuSeparator = React5.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx25(
  DropdownMenuPrimitive.Separator,
  {
    ref,
    className: cn("-sf-mx-1 sf-my-1 sf-h-px sf-bg-border", className),
    ...props
  }
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

// src/ui/icon-toggle-group.tsx
import { Fragment as Fragment4 } from "react";

// src/ui/tooltip.tsx
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React6 from "react";
import { jsx as jsx26 } from "react/jsx-runtime";
var TooltipProvider = TooltipPrimitive.Provider;
var Tooltip = TooltipPrimitive.Root;
var TooltipTrigger = TooltipPrimitive.Trigger;
var TooltipContent = React6.forwardRef(({ className, sideOffset = 4, ...props }, ref) => {
  const portalContainer = useCanvasPortalContainer();
  return /* @__PURE__ */ jsx26(TooltipPrimitive.Portal, { container: portalContainer, children: /* @__PURE__ */ jsx26(
    TooltipPrimitive.Content,
    {
      ref,
      sideOffset,
      className: cn(
        "sf-z-50 sf-overflow-hidden sf-rounded-md sf-bg-foreground sf-px-3 sf-py-1.5 sf-text-sm sf-text-background sf-shadow-md sf-animate-in sf-fade-in-0 sf-zoom-in-95 data-[state=closed]:sf-animate-out data-[state=closed]:sf-fade-out-0 data-[state=closed]:sf-zoom-out-95 data-[side=bottom]:sf-slide-in-from-top-2 data-[side=left]:sf-slide-in-from-right-2 data-[side=right]:sf-slide-in-from-left-2 data-[side=top]:sf-slide-in-from-bottom-2",
        className
      ),
      ...props
    }
  ) });
});
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

// src/ui/icon-toggle-group.tsx
import { jsx as jsx27, jsxs as jsxs17 } from "react/jsx-runtime";
function IconToggleGroup({
  value,
  onChange,
  options,
  ariaLabel,
  className
}) {
  return /* @__PURE__ */ jsx27(TooltipProvider, { delayDuration: 300, children: /* @__PURE__ */ jsx27(
    "div",
    {
      "aria-label": ariaLabel,
      className: cn(
        "sf-inline-flex sf-h-9 sf-items-stretch sf-overflow-hidden sf-rounded-md sf-border sf-border-input sf-bg-background sf-p-0.5",
        className
      ),
      children: options.map((opt, idx) => {
        const isActive = value === opt.value;
        const Icon2 = opt.icon;
        return /* @__PURE__ */ jsxs17(Fragment4, { children: [
          idx > 0 ? /* @__PURE__ */ jsx27("div", { "aria-hidden": true, className: "sf-mx-0.5 sf-w-px sf-self-stretch sf-bg-border/70" }) : null,
          /* @__PURE__ */ jsxs17(Tooltip, { children: [
            /* @__PURE__ */ jsx27(TooltipTrigger, { asChild: true, children: /* @__PURE__ */ jsx27(
              "button",
              {
                type: "button",
                "aria-pressed": isActive,
                "aria-label": opt.label,
                "data-active": isActive,
                "data-testid": opt.testId,
                onClick: () => onChange(opt.value),
                className: cn(
                  "sf-flex sf-flex-1 sf-items-center sf-justify-center sf-rounded sf-px-2 sf-transition-colors focus-visible:sf-outline-none focus-visible:sf-ring-1 focus-visible:sf-ring-ring",
                  isActive ? "sf-bg-secondary sf-text-secondary-foreground sf-shadow-sm" : "sf-text-muted-foreground hover:sf-bg-accent hover:sf-text-accent-foreground"
                ),
                children: /* @__PURE__ */ jsx27(Icon2, { className: "sf-h-4 sf-w-4" })
              }
            ) }),
            /* @__PURE__ */ jsx27(TooltipContent, { side: "top", className: "sf-px-2 sf-py-1 sf-text-xs", children: opt.label })
          ] })
        ] }, opt.value);
      })
    }
  ) });
}

// src/ui/line-style-icons.tsx
import { jsx as jsx28 } from "react/jsx-runtime";
var baseProps = (props) => ({
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeWidth: 1.75,
  ...props
});
var LineSolidIcon = (props) => /* @__PURE__ */ jsx28("svg", { ...baseProps(props), "aria-hidden": "true", children: /* @__PURE__ */ jsx28("line", { x1: "2", y1: "8", x2: "14", y2: "8" }) });
var LineDashedIcon = (props) => /* @__PURE__ */ jsx28("svg", { ...baseProps(props), "aria-hidden": "true", children: /* @__PURE__ */ jsx28("line", { x1: "2", y1: "8", x2: "14", y2: "8", strokeDasharray: "3 2.5" }) });
var LineDottedIcon = (props) => /* @__PURE__ */ jsx28("svg", { ...baseProps(props), "aria-hidden": "true", children: /* @__PURE__ */ jsx28("line", { x1: "2", y1: "8", x2: "14", y2: "8", strokeDasharray: "0.1 2.6" }) });
var PathCurveIcon = (props) => /* @__PURE__ */ jsx28("svg", { ...baseProps(props), "aria-hidden": "true", children: /* @__PURE__ */ jsx28("path", { d: "M2 12 C 5 12, 5 4, 8 4 S 11 12, 14 12" }) });
var PathStepIcon = (props) => /* @__PURE__ */ jsx28("svg", { ...baseProps(props), "aria-hidden": "true", children: /* @__PURE__ */ jsx28("path", { d: "M2 12 H 6 V 4 H 14" }) });

// src/ui/popover.tsx
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React7 from "react";
import { jsx as jsx29 } from "react/jsx-runtime";
var Popover = PopoverPrimitive.Root;
var PopoverTrigger = PopoverPrimitive.Trigger;
var PopoverAnchor = PopoverPrimitive.Anchor;
var PopoverContent = React7.forwardRef(({ className, align = "center", sideOffset = 4, ...props }, ref) => {
  const portalContainer = useCanvasPortalContainer();
  return /* @__PURE__ */ jsx29(PopoverPrimitive.Portal, { container: portalContainer, children: /* @__PURE__ */ jsx29(
    PopoverPrimitive.Content,
    {
      ref,
      align,
      sideOffset,
      className: cn(
        "sf-z-50 sf-w-72 sf-rounded-md sf-border sf-bg-popover sf-p-4 sf-text-popover-foreground sf-shadow-md sf-outline-none data-[state=open]:sf-animate-in data-[state=closed]:sf-animate-out data-[state=closed]:sf-fade-out-0 data-[state=open]:sf-fade-in-0 data-[state=closed]:sf-zoom-out-95 data-[state=open]:sf-zoom-in-95 data-[side=bottom]:sf-slide-in-from-top-2 data-[side=left]:sf-slide-in-from-right-2 data-[side=right]:sf-slide-in-from-left-2 data-[side=top]:sf-slide-in-from-bottom-2",
        className
      ),
      ...props
    }
  ) });
});
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

// src/ui/sheet.tsx
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva as cva2 } from "class-variance-authority";
import { X as X2 } from "lucide-react";
import * as React8 from "react";
import { jsx as jsx30, jsxs as jsxs18 } from "react/jsx-runtime";
var Sheet = SheetPrimitive.Root;
var SheetTrigger = SheetPrimitive.Trigger;
var SheetClose = SheetPrimitive.Close;
var SheetPortal = ({
  children,
  ...props
}) => {
  const portalContainer = useCanvasPortalContainer();
  return /* @__PURE__ */ jsx30(SheetPrimitive.Portal, { container: portalContainer, ...props, children });
};
var SheetOverlay = React8.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx30(
  SheetPrimitive.Overlay,
  {
    className: cn(
      "sf-fixed sf-inset-0 sf-z-50 sf-bg-black/80 data-[state=open]:sf-animate-in data-[state=closed]:sf-animate-out data-[state=closed]:sf-fade-out-0 data-[state=open]:sf-fade-in-0",
      className
    ),
    ...props,
    ref
  }
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;
var sheetVariants = cva2(
  "sf-fixed sf-z-50 sf-gap-4 sf-bg-card sf-border-border sf-p-6 sf-shadow-lg sf-transition sf-ease-in-out data-[state=open]:sf-animate-in data-[state=closed]:sf-animate-out data-[state=closed]:sf-duration-300 data-[state=open]:sf-duration-500",
  {
    variants: {
      side: {
        top: "sf-inset-x-0 sf-top-0 sf-border-b data-[state=closed]:sf-slide-out-to-top data-[state=open]:sf-slide-in-from-top",
        bottom: "sf-inset-x-0 sf-bottom-0 sf-border-t data-[state=closed]:sf-slide-out-to-bottom data-[state=open]:sf-slide-in-from-bottom",
        left: "sf-inset-y-0 sf-left-0 sf-h-full sf-w-3/4 sf-border-r data-[state=closed]:sf-slide-out-to-left data-[state=open]:sf-slide-in-from-left sm:sf-max-w-sm",
        right: "sf-inset-y-0 sf-right-0 sf-h-full sf-w-3/4 sf-border-l data-[state=closed]:sf-slide-out-to-right data-[state=open]:sf-slide-in-from-right sm:sf-max-w-sm"
      }
    },
    defaultVariants: {
      side: "right"
    }
  }
);
var SheetContent = React8.forwardRef(({ side = "right", className, children, ...props }, ref) => /* @__PURE__ */ jsxs18(SheetPortal, { children: [
  /* @__PURE__ */ jsx30(SheetOverlay, {}),
  /* @__PURE__ */ jsxs18(SheetPrimitive.Content, { ref, className: cn(sheetVariants({ side }), className), ...props, children: [
    children,
    /* @__PURE__ */ jsxs18(SheetPrimitive.Close, { className: "sf-absolute sf-right-4 sf-top-4 sf-rounded-sm sf-opacity-70 sf-ring-offset-background sf-transition-opacity hover:sf-opacity-100 focus:sf-outline-none focus:sf-ring-2 focus:sf-ring-ring focus:sf-ring-offset-2 disabled:sf-pointer-events-none", children: [
      /* @__PURE__ */ jsx30(X2, { className: "sf-h-4 sf-w-4" }),
      /* @__PURE__ */ jsx30("span", { className: "sf-sr-only", children: "Close" })
    ] })
  ] })
] }));
SheetContent.displayName = SheetPrimitive.Content.displayName;
var SheetHeader = ({ className, ...props }) => /* @__PURE__ */ jsx30(
  "div",
  {
    className: cn("sf-flex sf-flex-col sf-space-y-2 sf-text-center sm:sf-text-left", className),
    ...props
  }
);
SheetHeader.displayName = "SheetHeader";
var SheetFooter = ({ className, ...props }) => /* @__PURE__ */ jsx30(
  "div",
  {
    className: cn(
      "sf-flex sf-flex-col-reverse sm:sf-flex-row sm:sf-justify-end sm:sf-space-x-2",
      className
    ),
    ...props
  }
);
SheetFooter.displayName = "SheetFooter";
var SheetTitle = React8.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx30(
  SheetPrimitive.Title,
  {
    ref,
    className: cn("sf-text-lg sf-font-semibold sf-text-foreground", className),
    ...props
  }
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;
var SheetDescription = React8.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx30(
  SheetPrimitive.Description,
  {
    ref,
    className: cn("sf-text-sm sf-text-muted-foreground", className),
    ...props
  }
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

// src/ui/slider.tsx
import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React9 from "react";
import { jsx as jsx31, jsxs as jsxs19 } from "react/jsx-runtime";
var Slider = React9.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsxs19(
  SliderPrimitive.Root,
  {
    ref,
    className: cn(
      "sf-relative sf-flex sf-w-full sf-touch-none sf-select-none sf-items-center",
      className
    ),
    ...props,
    children: [
      /* @__PURE__ */ jsx31(SliderPrimitive.Track, { className: "sf-relative sf-h-1.5 sf-w-full sf-grow sf-overflow-hidden sf-rounded-full sf-bg-secondary", children: /* @__PURE__ */ jsx31(SliderPrimitive.Range, { className: "sf-absolute sf-h-full sf-bg-primary" }) }),
      /* @__PURE__ */ jsx31(SliderPrimitive.Thumb, { className: "sf-block sf-h-4 sf-w-4 sf-rounded-full sf-border sf-border-primary/60 sf-bg-background sf-shadow-sm sf-transition-colors hover:sf-border-primary focus-visible:sf-outline-none focus-visible:sf-ring-2 focus-visible:sf-ring-ring disabled:sf-pointer-events-none disabled:sf-opacity-50" })
    ]
  }
));
Slider.displayName = SliderPrimitive.Root.displayName;

// src/ui/tabs.tsx
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React10 from "react";
import { jsx as jsx32 } from "react/jsx-runtime";
var Tabs = TabsPrimitive.Root;
var TabsList = React10.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx32(
  TabsPrimitive.List,
  {
    ref,
    className: cn(
      "sf-inline-flex sf-h-9 sf-items-center sf-justify-center sf-rounded-md sf-bg-muted sf-p-1 sf-text-muted-foreground",
      className
    ),
    ...props
  }
));
TabsList.displayName = TabsPrimitive.List.displayName;
var TabsTrigger = React10.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx32(
  TabsPrimitive.Trigger,
  {
    ref,
    className: cn(
      "sf-inline-flex sf-items-center sf-justify-center sf-whitespace-nowrap sf-rounded-sm sf-px-3 sf-py-1 sf-text-xs sf-font-medium sf-ring-offset-background sf-transition-all focus-visible:sf-outline-none focus-visible:sf-ring-2 focus-visible:sf-ring-ring focus-visible:sf-ring-offset-2 disabled:sf-pointer-events-none disabled:sf-opacity-50 data-[state=active]:sf-bg-background data-[state=active]:sf-text-foreground data-[state=active]:sf-shadow-sm",
      className
    ),
    ...props
  }
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;
var TabsContent = React10.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx32(
  TabsPrimitive.Content,
  {
    ref,
    className: cn(
      "sf-mt-2 sf-ring-offset-background focus-visible:sf-outline-none focus-visible:sf-ring-2 focus-visible:sf-ring-ring focus-visible:sf-ring-offset-2",
      className
    ),
    ...props
  }
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

// src/components/canvas-toolbar.tsx
import {
  Circle,
  Cloud,
  Columns3,
  Database,
  Server,
  Shapes,
  Square,
  Sticker,
  StickyNote,
  Type,
  User
} from "lucide-react";
import { useState as useState10 } from "react";

// src/components/icon-picker-popover.tsx
import { useEffect as useEffect6, useMemo, useState as useState9 } from "react";
import { jsx as jsx33, jsxs as jsxs20 } from "react/jsx-runtime";
var COLS = 8;
var ROW_HEIGHT = 32;
var LIST_HEIGHT = 256;
var OVERSCAN = 2;
function filterIcons(names, query) {
  const q = query.trim().toLowerCase();
  if (q === "") return names.slice();
  return names.filter((name) => name.toLowerCase().includes(q));
}
function IconPickerPopover({ open, onOpenChange, anchor, onPick }) {
  const [query, setQuery] = useState9("");
  const recents = useMemo(() => open ? getRecents() : [], [open]);
  useEffect6(() => {
    if (!open) setQuery("");
  }, [open]);
  return /* @__PURE__ */ jsxs20(Popover, { open, onOpenChange, children: [
    /* @__PURE__ */ jsx33(PopoverTrigger, { asChild: true, children: anchor }),
    /* @__PURE__ */ jsx33(
      PopoverContent,
      {
        align: "start",
        side: "bottom",
        sideOffset: 6,
        className: "sf-w-[340px] sf-p-0",
        "data-testid": "icon-picker-popover",
        children: /* @__PURE__ */ jsx33(IconPickerBody, { query, onQueryChange: setQuery, recents, onPick })
      }
    )
  ] });
}
function IconPickerBody({ query, onQueryChange, recents, onPick }) {
  const filtered = useMemo(() => filterIcons(ICON_NAMES, query), [query]);
  const showRecents = query.trim() === "" && recents.length > 0;
  const [scrollTop, setScrollTop] = useState9(0);
  const totalRows = Math.max(1, Math.ceil(filtered.length / COLS));
  const totalHeight = totalRows * ROW_HEIGHT;
  const visibleRowCount = Math.ceil(LIST_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2;
  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endRow = Math.min(totalRows, startRow + visibleRowCount);
  const startIndex = startRow * COLS;
  const endIndex = Math.min(filtered.length, endRow * COLS);
  const visible = filtered.slice(startIndex, endIndex);
  return /* @__PURE__ */ jsxs20("div", { className: "sf-flex sf-w-full sf-flex-col", children: [
    /* @__PURE__ */ jsx33("div", { className: "sf-border-b sf-border-border sf-p-2", children: /* @__PURE__ */ jsx33(
      "input",
      {
        type: "text",
        value: query,
        placeholder: "Search icons\u2026",
        "aria-label": "Search icons",
        "data-testid": "icon-picker-search",
        className: cn(
          "sf-flex sf-h-8 sf-w-full sf-rounded-md sf-border sf-border-input sf-bg-background sf-px-3 sf-text-sm",
          "placeholder:text-muted-foreground",
          "focus-visible:sf-outline-none focus-visible:sf-ring-2 focus-visible:sf-ring-ring focus-visible:sf-ring-offset-1"
        ),
        onChange: (e) => onQueryChange(e.target.value)
      }
    ) }),
    showRecents ? /* @__PURE__ */ jsxs20("div", { className: "sf-border-b sf-border-border sf-p-2", "data-testid": "icon-picker-recents", children: [
      /* @__PURE__ */ jsx33("div", { className: "sf-mb-1 sf-px-1 sf-text-[11px] sf-font-medium sf-uppercase sf-tracking-wide sf-text-muted-foreground", children: "Recent" }),
      /* @__PURE__ */ jsx33(
        "div",
        {
          className: "sf-grid sf-gap-1",
          style: { gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` },
          children: recents.map((name) => renderTile(name, onPick, `icon-picker-recent-${name}`))
        }
      )
    ] }) : null,
    /* @__PURE__ */ jsxs20("div", { className: "sf-p-2", children: [
      /* @__PURE__ */ jsx33("div", { className: "sf-mb-1 sf-px-1 sf-text-[11px] sf-font-medium sf-uppercase sf-tracking-wide sf-text-muted-foreground", children: "All icons" }),
      filtered.length === 0 ? /* @__PURE__ */ jsx33(
        "div",
        {
          className: "sf-flex sf-items-center sf-justify-center sf-text-xs sf-text-muted-foreground",
          style: { height: LIST_HEIGHT },
          "data-testid": "icon-picker-empty",
          children: "No icons match."
        }
      ) : /* @__PURE__ */ jsx33(
        "div",
        {
          "data-testid": "icon-picker-all",
          className: "overflow-y-auto",
          style: { height: LIST_HEIGHT },
          onScroll: (e) => setScrollTop(e.currentTarget.scrollTop),
          children: /* @__PURE__ */ jsx33("div", { style: { height: totalHeight, position: "relative" }, children: /* @__PURE__ */ jsx33(
            "div",
            {
              style: {
                position: "absolute",
                top: startRow * ROW_HEIGHT,
                left: 0,
                right: 0
              },
              children: /* @__PURE__ */ jsx33(
                "div",
                {
                  className: "sf-grid sf-gap-1",
                  style: { gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` },
                  children: visible.map((name) => renderTile(name, onPick, `icon-picker-tile-${name}`))
                }
              )
            }
          ) })
        }
      )
    ] })
  ] });
}
function renderTile(name, onPick, testId) {
  const Icon2 = ICON_REGISTRY[name];
  return /* @__PURE__ */ jsx33(
    "button",
    {
      type: "button",
      title: name,
      "aria-label": name,
      "data-testid": testId,
      "data-icon-name": name,
      onClick: () => onPick(name),
      className: cn(
        "sf-inline-flex sf-h-7 sf-w-7 sf-items-center sf-justify-center sf-rounded-md sf-text-muted-foreground sf-transition-colors",
        "hover:sf-bg-accent hover:sf-text-accent-foreground",
        "focus-visible:sf-outline-none focus-visible:sf-ring-2 focus-visible:sf-ring-ring focus-visible:sf-ring-offset-1"
      ),
      children: Icon2 ? /* @__PURE__ */ jsx33(Icon2, { className: "sf-h-4 sf-w-4", "aria-hidden": "true" }) : null
    },
    testId
  );
}

// src/components/canvas-toolbar.tsx
import { jsx as jsx34, jsxs as jsxs21 } from "react/jsx-runtime";
var HTML_BLOCK_DND_TYPE = "application/x-seeflow-create-html-block";
var TOP_PRIMARY_SHAPES = [
  { shape: "rectangle", label: "Rectangle", commandId: "tool.rectangle", Icon: Square },
  { shape: "ellipse", label: "Ellipse", commandId: "tool.ellipse", Icon: Circle }
];
var SECONDARY_PRIMARY_SHAPES = [
  { shape: "sticky", label: "Sticky note", commandId: "tool.sticky", Icon: StickyNote },
  { shape: "text", label: "Text", commandId: "tool.text", Icon: Type }
];
var ILLUSTRATIVE_SHAPES2 = [
  // US-010: drag-create commits a shapeNode with `data.shape: 'database'`;
  // the ghost preview in demo-canvas.tsx renders <DatabaseShape> directly
  // (not the wrapper chrome) so the preview matches the committed visual.
  { shape: "database", label: "Database", commandId: "tool.database", Icon: Database },
  // US-022: rack-chassis illustrative shape, same ghost-dispatch contract as
  // Database — both consult `ILLUSTRATIVE_SHAPE_RENDERERS` for the SVG to draw.
  { shape: "server", label: "Server", commandId: "tool.server", Icon: Server },
  // US-023: person glyph for actors / end-users in architecture diagrams.
  { shape: "user", label: "User", commandId: "tool.user", Icon: User },
  // US-024: queue glyph for message brokers / FIFO pipelines. The lucide
  // Columns3 icon (3 vertical cells in a frame) is the closest match to the
  // 4-cell capsule rendered on the canvas.
  { shape: "queue", label: "Queue", commandId: "tool.queue", Icon: Columns3 },
  // US-025: cloud glyph for managed services / "the internet" / abstract
  // boundaries. lucide's Cloud icon mirrors the puffy SVG silhouette.
  { shape: "cloud", label: "Cloud", commandId: "tool.cloud", Icon: Cloud }
];
var TOOLBAR_SHAPES = [
  ...TOP_PRIMARY_SHAPES,
  ...SECONDARY_PRIMARY_SHAPES,
  ...ILLUSTRATIVE_SHAPES2
];
var INSERT_ICON_LABEL = "Insert icon";
var SHAPE_PICKER_LABEL = "Shape";
function CanvasToolbar({
  activeShape,
  onSelectShape,
  iconPickerOpen,
  onOpenIconPicker,
  onCloseIconPicker,
  onPickIcon
}) {
  const [shapePickerOpen, setShapePickerOpen] = useState10(false);
  const illustrativeActive = activeShape !== null && ILLUSTRATIVE_SHAPES2.some((s) => s.shape === activeShape);
  const renderShapeButton = ({ shape, commandId, Icon: Icon2 }) => {
    const active = activeShape === shape;
    const tooltip = getCommandTooltip(commandId);
    return /* @__PURE__ */ jsx34(
      "button",
      {
        type: "button",
        "data-testid": `toolbar-shape-${shape}`,
        "data-active": active ? "true" : "false",
        "aria-pressed": active,
        "aria-label": tooltip,
        title: tooltip,
        onClick: () => onSelectShape(active ? null : shape),
        className: cn(
          "sf-inline-flex sf-h-8 sf-w-8 sf-items-center sf-justify-center sf-rounded-md sf-text-muted-foreground sf-transition-colors",
          active ? "sf-bg-primary/10 sf-text-primary sf-border sf-border-primary/30" : "hover:sf-bg-muted"
        ),
        children: /* @__PURE__ */ jsx34(Icon2, { className: "sf-h-4 sf-w-4" })
      },
      shape
    );
  };
  return /* @__PURE__ */ jsxs21(
    "div",
    {
      "data-testid": "canvas-toolbar",
      className: "sf-pointer-events-auto sf-flex sf-flex-col sf-items-center sf-gap-1 sf-rounded-lg sf-border sf-border-border sf-bg-card sf-p-1 sf-shadow-md sf-backdrop-blur",
      children: [
        TOP_PRIMARY_SHAPES.map(renderShapeButton),
        /* @__PURE__ */ jsxs21(Popover, { open: shapePickerOpen, onOpenChange: setShapePickerOpen, children: [
          /* @__PURE__ */ jsx34(PopoverTrigger, { asChild: true, children: /* @__PURE__ */ jsx34(
            "button",
            {
              type: "button",
              "data-testid": "toolbar-shape-picker",
              "aria-label": SHAPE_PICKER_LABEL,
              "aria-pressed": shapePickerOpen || illustrativeActive,
              title: SHAPE_PICKER_LABEL,
              className: cn(
                "sf-inline-flex sf-h-8 sf-w-8 sf-items-center sf-justify-center sf-rounded-md sf-text-muted-foreground sf-transition-colors",
                shapePickerOpen || illustrativeActive ? "sf-bg-primary/10 sf-text-primary sf-border sf-border-primary/30" : "hover:sf-bg-muted"
              ),
              children: /* @__PURE__ */ jsx34(Shapes, { className: "sf-h-4 sf-w-4", "aria-hidden": "true" })
            }
          ) }),
          /* @__PURE__ */ jsx34(
            PopoverContent,
            {
              align: "start",
              side: "right",
              sideOffset: 6,
              className: "sf-w-auto sf-p-1",
              "data-testid": "shape-picker-popover",
              onOpenAutoFocus: (e) => {
                e.preventDefault();
              },
              children: /* @__PURE__ */ jsx34("div", { role: "menu", "aria-label": "More shapes", className: "sf-flex sf-flex-col sf-gap-0.5", children: ILLUSTRATIVE_SHAPES2.map(({ shape, label, commandId, Icon: Icon2 }) => {
                const active = activeShape === shape;
                const tooltip = getCommandTooltip(commandId);
                return /* @__PURE__ */ jsxs21(
                  "button",
                  {
                    type: "button",
                    role: "menuitem",
                    "data-testid": `shape-picker-${shape}`,
                    "data-active": active ? "true" : "false",
                    "aria-pressed": active,
                    "aria-label": tooltip,
                    title: tooltip,
                    onClick: () => {
                      onSelectShape(active ? null : shape);
                      setShapePickerOpen(false);
                    },
                    className: cn(
                      "sf-flex sf-items-center sf-gap-2 sf-rounded-sm sf-px-2 sf-py-1.5 sf-text-left sf-text-sm",
                      active ? "sf-bg-primary/10 sf-text-primary sf-border sf-border-primary/30" : "hover:sf-bg-muted focus:sf-bg-muted focus:sf-outline-none"
                    ),
                    children: [
                      /* @__PURE__ */ jsx34(Icon2, { className: "sf-h-4 sf-w-4 sf-text-muted-foreground", "aria-hidden": "true" }),
                      /* @__PURE__ */ jsx34("span", { children: label })
                    ]
                  },
                  shape
                );
              }) })
            }
          )
        ] }),
        onPickIcon ? /* @__PURE__ */ jsx34(
          IconPickerPopover,
          {
            open: iconPickerOpen ?? false,
            onOpenChange: (next) => {
              if (next) onOpenIconPicker?.();
              else onCloseIconPicker?.();
            },
            anchor: /* @__PURE__ */ jsx34(
              "button",
              {
                type: "button",
                "data-testid": "toolbar-insert-icon",
                "aria-label": INSERT_ICON_LABEL,
                "aria-pressed": iconPickerOpen ?? false,
                title: INSERT_ICON_LABEL,
                className: cn(
                  "sf-inline-flex sf-h-8 sf-w-8 sf-items-center sf-justify-center sf-rounded-md sf-text-muted-foreground sf-transition-colors",
                  iconPickerOpen ? "sf-bg-primary/10 sf-text-primary sf-border sf-border-primary/30" : "hover:sf-bg-muted"
                ),
                children: /* @__PURE__ */ jsx34(Sticker, { className: "sf-h-4 sf-w-4", "aria-hidden": "true" })
              }
            ),
            onPick: onPickIcon
          }
        ) : null,
        /* @__PURE__ */ jsx34("div", { className: "sf-my-1 sf-h-px sf-w-6 sf-bg-border", "aria-hidden": "true" }),
        SECONDARY_PRIMARY_SHAPES.map(renderShapeButton)
      ]
    }
  );
}

// src/components/detail-panel.tsx
import { FolderOpen, PencilLine, X as X3 } from "lucide-react";
import {
  useEffect as useEffect7,
  useRef as useRef3,
  useState as useState11
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Fragment as Fragment5, jsx as jsx35, jsxs as jsxs22 } from "react/jsx-runtime";
function DetailPanel({
  demoId,
  node,
  connector,
  adapter,
  onNameChange,
  onDescriptionChange,
  onDetailChange,
  onIconChange,
  statusReport,
  onClose
}) {
  const isTextShapeNode = node?.type === "shapeNode" && node.data.shape === "text";
  const shapeKind = node?.type === "shapeNode" ? node.data.shape : void 0;
  const isDescriptionLabelShapeNode = shapeKind === "ellipse" || shapeKind === "sticky";
  const inspectableNode = isTextShapeNode ? null : node;
  const open = inspectableNode !== null || connector !== null;
  const nodeName = inspectableNode && "name" in inspectableNode.data ? inspectableNode.data.name ?? "" : "";
  const description = inspectableNode?.data.description ?? "";
  const detail = inspectableNode?.data.detail ?? "";
  const showNameField = inspectableNode !== null && !isDescriptionLabelShapeNode;
  const supportsIconField = inspectableNode !== null && (inspectableNode.type === "playNode" || inspectableNode.type === "stateNode" || inspectableNode.type === "htmlNode");
  const showIconField = supportsIconField && typeof onIconChange === "function";
  const currentIcon = showIconField && "icon" in inspectableNode.data ? inspectableNode.data.icon ?? null : null;
  const [width, setWidth] = useState11(() => getStoredDetailPanelWidth());
  const onResizeHandlePointerDown = (e) => {
    e.preventDefault();
    startResizeGesture(width, e.clientX, {
      onWidth: setWidth,
      onCommit: setStoredDetailPanelWidth
    });
  };
  const widthStyle = { ["--detail-panel-w"]: `${width}px` };
  return /* @__PURE__ */ jsx35(
    Sheet,
    {
      open,
      modal: false,
      onOpenChange: (next) => {
        if (!next) onClose();
      },
      children: /* @__PURE__ */ jsxs22(
        SheetContent,
        {
          side: "right",
          className: "sf-overflow-y-auto sf-bg-card/94 sf-backdrop-blur-[14px] sf-border-border sm:!sf-w-[var(--detail-panel-w)] sm:!sf-max-w-[var(--detail-panel-w)]",
          style: widthStyle,
          "data-testid": "detail-panel",
          onEscapeKeyDown: (e) => {
            const active = document.activeElement;
            if (active?.getAttribute("data-testid")?.endsWith("-editor")) {
              e.preventDefault();
            }
          },
          onInteractOutside: (e) => {
            const active = document.activeElement;
            if (active?.getAttribute("data-testid")?.endsWith("-editor")) {
              active.blur();
            }
            const target = e.target;
            if (target?.closest(".react-flow__resize-control")) e.preventDefault();
            if (target?.closest("[data-radix-popper-content-wrapper]")) e.preventDefault();
            if (target?.closest('[data-testid="canvas-style-strip"]')) e.preventDefault();
            if (target?.closest(".react-flow__node")) e.preventDefault();
            if (target?.closest(".react-flow__edge")) e.preventDefault();
          },
          children: [
            /* @__PURE__ */ jsx35(
              "div",
              {
                "aria-label": "Resize detail panel",
                onPointerDown: onResizeHandlePointerDown,
                "data-testid": "detail-panel-resize-handle",
                className: "sf-absolute sf-inset-y-0 sf-left-0 sf-z-10 sf-hidden sf-w-1.5 sf-cursor-col-resize sf-bg-transparent sf-transition-colors hover:sf-bg-border sm:sf-block"
              }
            ),
            inspectableNode ? /* @__PURE__ */ jsxs22("div", { className: "sf-flex sf-flex-col sf-gap-3", children: [
              /* @__PURE__ */ jsxs22("div", { className: "sf-flex sf-flex-col sf-gap-1", children: [
                showNameField ? /* @__PURE__ */ jsx35(SheetTitle, { "data-testid": "detail-panel-title", children: /* @__PURE__ */ jsx35(
                  EditableField,
                  {
                    nodeId: inspectableNode.id,
                    value: nodeName,
                    placeholder: "Name",
                    multiline: false,
                    ariaLabel: "Name",
                    testIdBase: "detail-panel-name",
                    onSave: onNameChange,
                    textClassName: "sf-text-base sf-font-semibold"
                  }
                ) }) : (
                  // Radix requires a SheetTitle for a11y; keep it sr-only for
                  // ellipse so the panel stops rendering a Name row visually but
                  // still announces the entity to screen readers.
                  /* @__PURE__ */ jsx35(SheetTitle, { "data-testid": "detail-panel-title", className: "sr-only", children: inspectableNode.id })
                ),
                /* @__PURE__ */ jsxs22(SheetDescription, { className: "sr-only", children: [
                  inspectableNode.id,
                  " \xB7 ",
                  inspectableNode.type
                ] })
              ] }),
              /* @__PURE__ */ jsxs22("div", { className: "sf-mt-0 sf-flex sf-flex-col sf-gap-3", children: [
                statusReport ? /* @__PURE__ */ jsx35(StatusSection, { report: statusReport }) : null,
                showIconField && onIconChange ? /* @__PURE__ */ jsx35(IconRow, { nodeId: inspectableNode.id, icon: currentIcon, onChange: onIconChange }) : null,
                /* @__PURE__ */ jsx35(
                  EditableField,
                  {
                    nodeId: inspectableNode.id,
                    value: description,
                    placeholder: "Short description shown on the node body",
                    multiline: true,
                    ariaLabel: "Description",
                    testIdBase: "detail-panel-description",
                    onSave: onDescriptionChange,
                    textClassName: "sf-font-medium sf-text-muted-foreground"
                  }
                ),
                /* @__PURE__ */ jsx35(
                  EditableField,
                  {
                    nodeId: inspectableNode.id,
                    value: detail,
                    placeholder: "Long-form notes, context, anything\u2026",
                    multiline: true,
                    ariaLabel: "Detail",
                    testIdBase: "detail-panel-detail",
                    onSave: onDetailChange,
                    markdown: true
                  }
                ),
                inspectableNode.type === "htmlNode" && demoId ? /* @__PURE__ */ jsx35(HtmlNodeSection, { adapter, htmlPath: inspectableNode.data.htmlPath }) : null
              ] })
            ] }) : connector ? /* @__PURE__ */ jsxs22("div", { className: "sf-flex sf-flex-col sf-gap-3", children: [
              /* @__PURE__ */ jsxs22("div", { className: "sf-flex sf-flex-col sf-gap-1", children: [
                /* @__PURE__ */ jsx35(SheetTitle, { "data-testid": "detail-panel-title", children: connector.label ?? "Connector" }),
                /* @__PURE__ */ jsxs22(SheetDescription, { className: "sr-only", children: [
                  connector.id,
                  " \xB7 ",
                  connector.kind
                ] })
              ] }),
              /* @__PURE__ */ jsx35("div", { className: "sf-mt-0 sf-flex sf-flex-col sf-gap-3", children: /* @__PURE__ */ jsx35(ConnectorSummary, { connector }) })
            ] }) : null
          ]
        }
      )
    }
  );
}
function EditableField({
  nodeId,
  value,
  placeholder,
  multiline,
  ariaLabel,
  testIdBase,
  onSave,
  textClassName,
  markdown = false
}) {
  const [isEditing, setIsEditing] = useState11(false);
  const editorRef = useRef3(null);
  const cancelOnBlurRef = useRef3(false);
  useEffect7(() => {
    if (!isEditing) return;
    const el = editorRef.current;
    if (!el) return;
    el.textContent = value;
    el.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, [isEditing, value]);
  const isEmpty = value === "";
  if (!onSave) {
    return /* @__PURE__ */ jsx35(
      "div",
      {
        "data-testid": testIdBase,
        "aria-label": ariaLabel,
        className: cn(
          "sf-w-full sf-rounded-md sf-px-2 sf-py-1.5 sf-text-sm",
          isEmpty ? "sf-italic sf-text-muted-foreground/50" : "text-foreground",
          !markdown && "sf-whitespace-pre-wrap sf-break-words",
          textClassName
        ),
        children: isEmpty ? placeholder : markdown ? /* @__PURE__ */ jsx35(MarkdownContent, { value }) : value
      }
    );
  }
  const commit = () => {
    const text = editorRef.current?.textContent ?? value;
    onSave(nodeId, text);
    setIsEditing(false);
  };
  const cancel = () => {
    setIsEditing(false);
  };
  const onKeyDown = (e) => {
    e.stopPropagation();
    e.nativeEvent.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      cancelOnBlurRef.current = true;
      cancel();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey || !multiline) {
        commit();
        return;
      }
      document.execCommand("insertText", false, "\n");
    }
  };
  const onPaste = (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  };
  const onInput = (_e) => {
  };
  const onBlur = () => {
    if (cancelOnBlurRef.current) {
      cancelOnBlurRef.current = false;
      return;
    }
    commit();
  };
  const enterEdit = () => {
    if (isEditing) return;
    setIsEditing(true);
  };
  return /* @__PURE__ */ jsx35("div", { className: "relative", "data-testid": testIdBase, "data-editing": isEditing ? "true" : "false", children: isEditing ? /* @__PURE__ */ jsx35(
    "div",
    {
      ref: editorRef,
      contentEditable: "plaintext-only",
      suppressContentEditableWarning: true,
      spellCheck: false,
      tabIndex: 0,
      onKeyDown,
      onPaste,
      onInput,
      onBlur,
      "data-testid": `${testIdBase}-editor`,
      className: cn(
        // No ring on focus and no leading override — the edit surface
        // visually matches the rendered button surface exactly so toggling
        // edit mode doesn't shift the row's height. Caret + IME are the
        // only edit affordance.
        "sf-block sf-w-full sf-whitespace-pre-wrap sf-break-words sf-rounded-md sf-px-2 sf-py-1.5 sf-text-sm sf-outline-none",
        textClassName
      ),
      role: "textbox",
      "aria-multiline": multiline ? "true" : "false",
      "aria-label": ariaLabel
    }
  ) : /* @__PURE__ */ jsx35(
    "button",
    {
      type: "button",
      onClick: enterEdit,
      "aria-label": `Edit ${ariaLabel.toLowerCase()}`,
      className: cn(
        "sf-block sf-w-full sf-cursor-text sf-rounded-md sf-px-2 sf-py-1.5 sf-text-left sf-text-sm sf-transition-colors hover:sf-bg-muted/50",
        isEmpty ? "sf-italic sf-text-muted-foreground/50" : "text-foreground",
        !markdown && "sf-whitespace-pre-wrap sf-break-words",
        textClassName
      ),
      children: isEmpty ? placeholder : markdown ? /* @__PURE__ */ jsx35(MarkdownContent, { value }) : value
    }
  ) });
}
function IconRow({
  nodeId,
  icon,
  onChange
}) {
  const [open, setOpen] = useState11(false);
  return /* @__PURE__ */ jsxs22("div", { "data-testid": "detail-panel-icon", className: "sf-flex sf-items-center sf-gap-2 sf-px-2", children: [
    /* @__PURE__ */ jsx35("span", { className: "sf-text-xs sf-font-medium sf-uppercase sf-tracking-wide sf-text-muted-foreground sf-w-16 sf-shrink-0", children: "Icon" }),
    /* @__PURE__ */ jsx35(
      IconPickerPopover,
      {
        open,
        onOpenChange: setOpen,
        onPick: (name) => {
          onChange(nodeId, name);
          setOpen(false);
        },
        anchor: /* @__PURE__ */ jsx35(
          "button",
          {
            type: "button",
            "data-testid": "detail-panel-icon-trigger",
            "aria-label": "Choose icon",
            "aria-pressed": open,
            className: cn(
              "sf-inline-flex sf-h-8 sf-min-w-8 sf-items-center sf-gap-2 sf-rounded-md sf-border sf-border-input sf-bg-background sf-px-2 sf-text-sm sf-transition-colors",
              "hover:sf-bg-muted"
            ),
            children: icon ? /* @__PURE__ */ jsxs22(Fragment5, { children: [
              /* @__PURE__ */ jsx35(Icon, { name: icon, size: 16, "aria-hidden": true }),
              /* @__PURE__ */ jsx35("span", { className: "sf-font-mono sf-text-xs", children: icon })
            ] }) : /* @__PURE__ */ jsx35("span", { className: "sf-text-muted-foreground sf-italic", children: "None" })
          }
        )
      }
    ),
    icon ? /* @__PURE__ */ jsxs22(
      Button,
      {
        type: "button",
        size: "sm",
        variant: "ghost",
        "data-testid": "detail-panel-icon-clear",
        "aria-label": "Clear icon",
        className: "sf-h-8 sf-gap-1 sf-px-2 sf-text-xs",
        onClick: () => onChange(nodeId, null),
        children: [
          /* @__PURE__ */ jsx35(X3, { className: "sf-h-3.5 sf-w-3.5" }),
          "Clear"
        ]
      }
    ) : null
  ] });
}
function HtmlNodeSection({
  adapter,
  htmlPath
}) {
  const [status, setStatus] = useState11({ kind: "idle" });
  const canOpen = typeof adapter?.openFile === "function";
  const canReveal = typeof adapter?.revealFile === "function";
  const dispatch = async (action) => {
    setStatus({ kind: "pending" });
    try {
      if (action === "open") {
        await adapter?.openFile?.(htmlPath);
      } else {
        await adapter?.revealFile?.(htmlPath);
      }
      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err)
      });
    }
  };
  return /* @__PURE__ */ jsxs22(
    "div",
    {
      className: "sf-flex sf-flex-col sf-gap-2 sf-rounded-md sf-border sf-bg-card sf-px-3 sf-py-2 sf-text-xs",
      "data-testid": "detail-panel-html-node",
      children: [
        /* @__PURE__ */ jsxs22("div", { className: "sf-flex sf-flex-col sf-gap-1", children: [
          /* @__PURE__ */ jsx35("span", { className: "sf-font-mono sf-text-[11px] sf-text-muted-foreground sf-uppercase sf-tracking-widest", children: "Path" }),
          /* @__PURE__ */ jsx35(
            "code",
            {
              "data-testid": "detail-panel-html-path",
              className: "sf-block sf-break-all sf-rounded sf-bg-muted/40 sf-px-2 sf-py-1 sf-font-mono sf-text-[11px]",
              children: htmlPath
            }
          )
        ] }),
        canOpen || canReveal ? /* @__PURE__ */ jsxs22("div", { className: "sf-flex sf-flex-wrap sf-items-center sf-gap-2", children: [
          canOpen ? /* @__PURE__ */ jsxs22(
            Button,
            {
              type: "button",
              size: "sm",
              variant: "outline",
              className: "sf-h-7 sf-gap-1.5 sf-px-2",
              onClick: () => {
                void dispatch("open");
              },
              disabled: status.kind === "pending",
              "data-testid": "detail-panel-html-open",
              "aria-label": "Open in editor",
              children: [
                /* @__PURE__ */ jsx35(PencilLine, { className: "sf-h-3.5 sf-w-3.5" }),
                "Open in editor"
              ]
            }
          ) : null,
          canReveal ? /* @__PURE__ */ jsxs22(
            Button,
            {
              type: "button",
              size: "sm",
              variant: "outline",
              className: "sf-h-7 sf-gap-1.5 sf-px-2",
              onClick: () => {
                void dispatch("reveal");
              },
              disabled: status.kind === "pending",
              "data-testid": "detail-panel-html-reveal",
              "aria-label": "Reveal in Finder/Explorer",
              children: [
                /* @__PURE__ */ jsx35(FolderOpen, { className: "sf-h-3.5 sf-w-3.5" }),
                "Reveal"
              ]
            }
          ) : null
        ] }) : null,
        status.kind === "error" ? /* @__PURE__ */ jsx35(
          "div",
          {
            "data-testid": "detail-panel-html-status",
            "data-status": status.kind,
            className: cn("sf-text-[11px] sf-text-destructive"),
            children: status.message ?? ""
          }
        ) : null
      ]
    }
  );
}
function formatRelativeTime(ts, now) {
  const diffMs = Math.max(0, now - ts);
  if (diffMs < 1e3) return "just now";
  const seconds = Math.floor(diffMs / 1e3);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
function formatStatusValue(value) {
  if (value === null) return "null";
  if (value === void 0) return "undefined";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
function StatusSection({
  report,
  // Test seam: callers in tests can pin `now` so the relative-time string is
  // deterministic. Production renders ignore this and read Date.now() at the
  // call site so a re-render after an SSE tick recomputes the "Ns ago" label.
  now = Date.now()
}) {
  const entries = report.data ? Object.entries(report.data) : [];
  return /* @__PURE__ */ jsxs22(
    "section",
    {
      className: "sf-flex sf-flex-col sf-gap-2 sf-rounded-md sf-border sf-bg-card sf-px-3 sf-py-2 sf-text-xs",
      "data-testid": "detail-panel-status",
      "data-state": report.state,
      children: [
        /* @__PURE__ */ jsxs22("div", { className: "sf-flex sf-items-center sf-justify-between sf-gap-2", children: [
          /* @__PURE__ */ jsx35(
            StatusBadge,
            {
              state: report.state,
              summary: report.summary,
              "data-testid": "detail-panel-status-badge"
            }
          ),
          /* @__PURE__ */ jsx35(
            "span",
            {
              className: "sf-shrink-0 sf-text-[10px] sf-text-muted-foreground",
              "data-testid": "detail-panel-status-relative-time",
              children: `Last updated: ${formatRelativeTime(report.ts, now)}`
            }
          )
        ] }),
        report.detail ? /* @__PURE__ */ jsx35(
          "div",
          {
            "data-testid": "detail-panel-status-detail",
            className: "sf-whitespace-pre-wrap sf-break-words sf-rounded sf-bg-muted/40 sf-px-2 sf-py-1 sf-text-[11px] sf-text-foreground",
            children: report.detail
          }
        ) : null,
        entries.length > 0 ? /* @__PURE__ */ jsx35(
          "dl",
          {
            "data-testid": "detail-panel-status-data",
            className: "sf-grid sf-grid-cols-[auto_1fr] sf-gap-x-3 sf-gap-y-1 sf-text-[11px]",
            children: entries.map(([key, value]) => /* @__PURE__ */ jsxs22("div", { className: "contents", "data-testid": "detail-panel-status-data-row", children: [
              /* @__PURE__ */ jsx35("dt", { className: "sf-truncate sf-font-medium sf-text-muted-foreground", children: key }),
              /* @__PURE__ */ jsx35("dd", { className: "sf-break-all sf-font-mono sf-text-foreground", children: formatStatusValue(value) })
            ] }, key))
          }
        ) : null
      ]
    }
  );
}
function MarkdownContent({ value }) {
  return /* @__PURE__ */ jsx35(
    ReactMarkdown,
    {
      remarkPlugins: [remarkGfm],
      components: {
        h1: ({ children }) => /* @__PURE__ */ jsx35("h1", { className: "sf-mb-1 sf-text-base sf-font-bold sf-leading-snug", children }),
        h2: ({ children }) => /* @__PURE__ */ jsx35("h2", { className: "sf-mb-1 sf-text-sm sf-font-semibold sf-leading-snug", children }),
        h3: ({ children }) => /* @__PURE__ */ jsx35("h3", { className: "sf-mb-0.5 sf-text-sm sf-font-medium sf-leading-snug", children }),
        p: ({ children }) => /* @__PURE__ */ jsx35("p", { className: "sf-mb-2 last:sf-mb-0 sf-leading-relaxed", children }),
        ul: ({ children }) => /* @__PURE__ */ jsx35("ul", { className: "sf-mb-2 sf-list-disc sf-pl-4 last:sf-mb-0", children }),
        ol: ({ children }) => /* @__PURE__ */ jsx35("ol", { className: "sf-mb-2 sf-list-decimal sf-pl-4 last:sf-mb-0", children }),
        li: ({ children }) => /* @__PURE__ */ jsx35("li", { className: "mb-0.5", children }),
        code: ({ children, className }) => {
          const isBlock = className?.includes("language-");
          return isBlock ? /* @__PURE__ */ jsx35("code", { className: "sf-block sf-overflow-x-auto sf-rounded sf-bg-muted/60 sf-px-2 sf-py-1 sf-font-mono sf-text-xs", children }) : /* @__PURE__ */ jsx35("code", { className: "sf-rounded sf-bg-muted/60 sf-px-1 sf-py-0.5 sf-font-mono sf-text-xs", children });
        },
        pre: ({ children }) => /* @__PURE__ */ jsx35("pre", { className: "sf-mb-2 last:sf-mb-0", children }),
        blockquote: ({ children }) => /* @__PURE__ */ jsx35("blockquote", { className: "sf-mb-2 sf-border-l-2 sf-border-muted-foreground/30 sf-pl-3 sf-italic sf-text-muted-foreground last:sf-mb-0", children }),
        a: ({ href, children }) => /* @__PURE__ */ jsx35(
          "a",
          {
            href,
            target: "_blank",
            rel: "noreferrer",
            className: "sf-text-primary sf-underline sf-underline-offset-2",
            children
          }
        ),
        strong: ({ children }) => /* @__PURE__ */ jsx35("strong", { className: "font-semibold", children }),
        em: ({ children }) => /* @__PURE__ */ jsx35("em", { className: "italic", children }),
        hr: () => /* @__PURE__ */ jsx35("hr", { className: "sf-my-2 sf-border-border" }),
        table: ({ children }) => /* @__PURE__ */ jsx35("div", { className: "sf-mb-2 sf-overflow-x-auto last:sf-mb-0", children: /* @__PURE__ */ jsx35("table", { className: "sf-w-full sf-border-collapse sf-text-xs", children }) }),
        th: ({ children }) => /* @__PURE__ */ jsx35("th", { className: "sf-border sf-border-border sf-bg-muted/40 sf-px-2 sf-py-1 sf-text-left sf-font-medium", children }),
        td: ({ children }) => /* @__PURE__ */ jsx35("td", { className: "sf-border sf-border-border sf-px-2 sf-py-1", children })
      },
      children: value
    }
  );
}
function ConnectorSummary({ connector }) {
  return /* @__PURE__ */ jsx35("div", { className: "sf-rounded-md sf-border sf-bg-card sf-px-3 sf-py-2 sf-text-xs", children: /* @__PURE__ */ jsxs22("dl", { className: "divide-y", children: [
    /* @__PURE__ */ jsx35(SummaryRow, { label: "Source", value: connector.source }),
    /* @__PURE__ */ jsx35(SummaryRow, { label: "Target", value: connector.target }),
    /* @__PURE__ */ jsx35(SummaryRow, { label: "Kind", value: connector.kind }),
    connector.label ? /* @__PURE__ */ jsx35(SummaryRow, { label: "Label", value: connector.label }) : null,
    connector.style ? /* @__PURE__ */ jsx35(SummaryRow, { label: "Style", value: connector.style }) : null,
    connector.color ? /* @__PURE__ */ jsx35(SummaryRow, { label: "Color", value: connector.color }) : null,
    connector.direction ? /* @__PURE__ */ jsx35(SummaryRow, { label: "Direction", value: connector.direction }) : null,
    connector.kind === "http" && connector.url ? /* @__PURE__ */ jsx35(SummaryRow, { label: "URL", value: `${connector.method ?? "GET"} ${connector.url}` }) : null,
    connector.kind === "event" ? /* @__PURE__ */ jsx35(SummaryRow, { label: "Event", value: connector.eventName }) : null,
    connector.kind === "queue" ? /* @__PURE__ */ jsx35(SummaryRow, { label: "Queue", value: connector.queueName }) : null
  ] }) });
}
function SummaryRow({ label, value }) {
  return /* @__PURE__ */ jsxs22("div", { className: "sf-flex sf-items-start sf-gap-3 sf-py-2 first:sf-pt-0 last:sf-pb-0", children: [
    /* @__PURE__ */ jsx35("dt", { className: "sf-w-20 sf-shrink-0 sf-font-medium sf-text-muted-foreground", children: label }),
    /* @__PURE__ */ jsx35("dd", { className: "sf-flex-1 sf-break-all sf-font-mono", children: value })
  ] });
}

// src/components/selection-resize-overlay.tsx
import { useReactFlow } from "@xyflow/react";
import {
  useRef as useRef4,
  useState as useState12
} from "react";
var SELECTION_OVERLAY_PADDING = 8;
function computeUnionRect(nodes) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let saw = false;
  for (const n of nodes) {
    const w = n.data.width;
    const h = n.data.height;
    if (w === void 0 || h === void 0) continue;
    saw = true;
    if (n.position.x < minX) minX = n.position.x;
    if (n.position.y < minY) minY = n.position.y;
    if (n.position.x + w > maxX) maxX = n.position.x + w;
    if (n.position.y + h > maxY) maxY = n.position.y + h;
  }
  if (!saw) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
function selectionEligibleForOverlay(selected) {
  return selected.length >= 2;
}
function computeNewRectFromAnchorDrag(oldRect, anchor, dx, dy, lockAspectRatio) {
  const left = oldRect.x;
  const right = oldRect.x + oldRect.width;
  const top = oldRect.y;
  const bottom = oldRect.y + oldRect.height;
  let newLeft = left;
  let newRight = right;
  let newTop = top;
  let newBottom = bottom;
  if (anchor === "nw" || anchor === "w" || anchor === "sw") newLeft = left + dx;
  if (anchor === "ne" || anchor === "e" || anchor === "se") newRight = right + dx;
  if (anchor === "nw" || anchor === "n" || anchor === "ne") newTop = top + dy;
  if (anchor === "sw" || anchor === "s" || anchor === "se") newBottom = bottom + dy;
  if (newRight - newLeft < 1) {
    if (anchor === "nw" || anchor === "w" || anchor === "sw") newLeft = newRight - 1;
    else newRight = newLeft + 1;
  }
  if (newBottom - newTop < 1) {
    if (anchor === "nw" || anchor === "n" || anchor === "ne") newTop = newBottom - 1;
    else newBottom = newTop + 1;
  }
  if (lockAspectRatio && oldRect.width > 0 && oldRect.height > 0) {
    const sx = (newRight - newLeft) / oldRect.width;
    const sy = (newBottom - newTop) / oldRect.height;
    const scale = Math.min(sx, sy);
    const w = oldRect.width * scale;
    const h = oldRect.height * scale;
    const anchorX = anchor.includes("w") ? newRight : newLeft;
    const anchorY = anchor.includes("n") ? newBottom : newTop;
    if (anchor.includes("w")) {
      newLeft = anchorX - w;
      newRight = anchorX;
    } else {
      newRight = anchorX + w;
      newLeft = anchorX;
    }
    if (anchor.includes("n")) {
      newTop = anchorY - h;
      newBottom = anchorY;
    } else {
      newBottom = anchorY + h;
      newTop = anchorY;
    }
  }
  return {
    x: newLeft,
    y: newTop,
    width: newRight - newLeft,
    height: newBottom - newTop
  };
}
function computeSelectionResizeUpdates(nodes, oldRect, newRect, options) {
  const scalable = nodes.map((n) => ({
    id: n.id,
    position: { x: n.position.x, y: n.position.y },
    width: n.data.width,
    height: n.data.height,
    data: { locked: n.data.locked }
  }));
  const scaled = scaleNodesWithinRect(scalable, oldRect, newRect, options);
  const updates = [];
  for (let i = 0; i < scaled.length; i++) {
    const src = nodes[i];
    const out = scaled[i];
    if (!src || !out) continue;
    if (src.data.locked === true) continue;
    const u = { id: out.id, position: out.position };
    if (out.width !== void 0) u.width = out.width;
    if (out.height !== void 0) u.height = out.height;
    updates.push(u);
  }
  return updates;
}
function scheduleRaf(rafRef, fn) {
  if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  rafRef.current = requestAnimationFrame(() => {
    rafRef.current = null;
    fn();
  });
}
function SelectionResizeOverlay({
  selectedNodes,
  onMultiResize,
  paddingPx = SELECTION_OVERLAY_PADDING
}) {
  const reactFlow = useReactFlow();
  const [dragState, setDragState] = useState12(null);
  const [previewRect, setPreviewRect] = useState12(null);
  const shiftHeldRef = useRef4(false);
  const liveDispatchRafRef = useRef4(null);
  if (!selectionEligibleForOverlay(selectedNodes)) return null;
  const unionRect = computeUnionRect(selectedNodes);
  if (!unionRect) return null;
  const liveRect = previewRect ?? unionRect;
  const paddedRect = {
    x: liveRect.x - paddingPx,
    y: liveRect.y - paddingPx,
    width: liveRect.width + paddingPx * 2,
    height: liveRect.height + paddingPx * 2
  };
  const onHandlePointerDown = (anchor) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    const flowStart = reactFlow.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY
    });
    shiftHeldRef.current = event.shiftKey;
    setDragState({
      anchor,
      oldRect: unionRect,
      startCursor: flowStart,
      pointerId: event.pointerId
    });
    setPreviewRect(unionRect);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onHandlePointerMove = (event) => {
    if (!dragState) return;
    if (event.pointerId !== dragState.pointerId) return;
    shiftHeldRef.current = event.shiftKey;
    const flowCursor = reactFlow.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY
    });
    const dx = flowCursor.x - dragState.startCursor.x;
    const dy = flowCursor.y - dragState.startCursor.y;
    const newRect = computeNewRectFromAnchorDrag(
      dragState.oldRect,
      dragState.anchor,
      dx,
      dy,
      event.shiftKey
    );
    setPreviewRect(newRect);
    if (onMultiResize) {
      const lockAspect = event.shiftKey;
      const oldRectAtStart = dragState.oldRect;
      const nodesAtTick = selectedNodes;
      scheduleRaf(liveDispatchRafRef, () => {
        const updates = computeSelectionResizeUpdates(nodesAtTick, oldRectAtStart, newRect, {
          lockAspectRatio: lockAspect
        });
        if (updates.length > 0) onMultiResize(updates);
      });
    }
  };
  const onHandlePointerUp = (event) => {
    if (!dragState) return;
    if (event.pointerId !== dragState.pointerId) return;
    const flowCursor = reactFlow.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY
    });
    const dx = flowCursor.x - dragState.startCursor.x;
    const dy = flowCursor.y - dragState.startCursor.y;
    const newRect = computeNewRectFromAnchorDrag(
      dragState.oldRect,
      dragState.anchor,
      dx,
      dy,
      event.shiftKey
    );
    if (liveDispatchRafRef.current !== null) {
      cancelAnimationFrame(liveDispatchRafRef.current);
      liveDispatchRafRef.current = null;
    }
    setDragState(null);
    setPreviewRect(null);
    shiftHeldRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
    }
    if (!onMultiResize) return;
    if (newRect.x === dragState.oldRect.x && newRect.y === dragState.oldRect.y && newRect.width === dragState.oldRect.width && newRect.height === dragState.oldRect.height) {
      return;
    }
    const updates = computeSelectionResizeUpdates(selectedNodes, dragState.oldRect, newRect, {
      lockAspectRatio: event.shiftKey
    });
    if (updates.length > 0) onMultiResize(updates);
  };
  const onHandlePointerCancel = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    if (liveDispatchRafRef.current !== null) {
      cancelAnimationFrame(liveDispatchRafRef.current);
      liveDispatchRafRef.current = null;
    }
    setDragState(null);
    setPreviewRect(null);
    shiftHeldRef.current = false;
  };
  void paddedRect;
  void onHandlePointerDown;
  void onHandlePointerMove;
  void onHandlePointerUp;
  void onHandlePointerCancel;
  return null;
}

// src/components/style-strip.tsx
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  Minus,
  MoveLeft,
  Squircle,
  Sticker as Sticker2,
  Type as Type2
} from "lucide-react";
import { useEffect as useEffect8, useState as useState13 } from "react";
import { Fragment as Fragment6, jsx as jsx36, jsxs as jsxs23 } from "react/jsx-runtime";
var NODE_FONT_SIZE_DEFAULT = 22;
var CONNECTOR_FONT_SIZE_DEFAULT = 11;
var DEFAULT_BORDER_SIZE = 3;
var DEFAULT_STROKE_WIDTH2 = 2;
var DEFAULT_CORNER_RADIUS = 8;
var KIND_DEFAULT_STYLE = {
  http: "solid",
  event: "dashed",
  queue: "dotted",
  default: "solid"
};
var PALETTE_TOKENS = [
  "default",
  "slate",
  "blue",
  "green",
  "amber",
  "red",
  "purple",
  "pink"
];
var BORDER_STYLE_OPTIONS = [
  { value: "solid", icon: LineSolidIcon, label: "Solid", testId: "style-tab-border-style-solid" },
  {
    value: "dashed",
    icon: LineDashedIcon,
    label: "Dashed",
    testId: "style-tab-border-style-dashed"
  },
  {
    value: "dotted",
    icon: LineDottedIcon,
    label: "Dotted",
    testId: "style-tab-border-style-dotted"
  }
];
var CONNECTOR_STYLE_OPTIONS = [
  { value: "solid", icon: LineSolidIcon, label: "Solid", testId: "style-tab-edge-style-solid" },
  { value: "dashed", icon: LineDashedIcon, label: "Dashed", testId: "style-tab-edge-style-dashed" },
  { value: "dotted", icon: LineDottedIcon, label: "Dotted", testId: "style-tab-edge-style-dotted" }
];
var PATH_OPTIONS = [
  { value: "curve", icon: PathCurveIcon, label: "Curve", testId: "style-tab-edge-path-curve" },
  { value: "step", icon: PathStepIcon, label: "Zigzag", testId: "style-tab-edge-path-step" }
];
var DIRECTION_OPTIONS = [
  { value: "none", icon: Minus, label: "None", testId: "style-tab-direction-none" },
  { value: "backward", icon: MoveLeft, label: "Backward", testId: "style-tab-direction-backward" },
  { value: "forward", icon: ArrowRight, label: "Forward", testId: "style-tab-direction-forward" },
  { value: "both", icon: ArrowLeftRight, label: "Both", testId: "style-tab-direction-both" }
];
function StyleStrip({
  nodes,
  connectors,
  onStyleNode,
  onStyleNodePreview,
  onStyleNodes,
  onStyleNodesPreview,
  onStyleConnector,
  onStyleConnectorPreview,
  onRequestIconReplace
}) {
  const hasNodes = nodes.length > 0;
  const hasConnectors = connectors.length > 0;
  if (!hasNodes && !hasConnectors) return null;
  const pureNode = hasNodes && !hasConnectors;
  const pureConnector = !hasNodes && hasConnectors;
  const firstNode = nodes[0];
  const firstConnector = connectors[0];
  const visualNodes = nodes.filter(
    (n) => n.type !== "iconNode"
  );
  const firstVisualNode = visualNodes[0];
  const pureIconNode = pureNode && nodes.every((n) => n.type === "iconNode");
  const firstIconNode = pureIconNode ? nodes.find((n) => n.type === "iconNode") : void 0;
  const pureImageNode = pureNode && nodes.every((n) => n.type === "imageNode");
  const isTextShape = pureNode && firstNode?.type === "shapeNode" && firstNode.data.shape === "text";
  const borderColorActive = (pureConnector ? firstConnector?.color : firstVisualNode?.data.borderColor) ?? "default";
  const backgroundActive = firstVisualNode?.data.backgroundColor ?? "default";
  const borderStyleActiveNode = firstVisualNode?.data.borderStyle ?? "solid";
  const connectorStyleActive = firstConnector ? firstConnector.style ?? KIND_DEFAULT_STYLE[firstConnector.kind] : "solid";
  const directionActive = firstConnector?.direction ?? "forward";
  const pathActive = firstConnector?.path ?? "curve";
  const applyBorderColor = (token) => {
    for (const n of nodes) onStyleNode(n.id, { borderColor: token });
    for (const c of connectors) onStyleConnector(c.id, { color: token });
  };
  const applyBackgroundColor = (token) => {
    for (const n of nodes) onStyleNode(n.id, { backgroundColor: token });
  };
  const applyBorderStyle = (style) => {
    for (const n of nodes) onStyleNode(n.id, { borderStyle: style });
    for (const c of connectors) onStyleConnector(c.id, { style });
  };
  const applyBorderSize = (n) => {
    for (const node of nodes) onStyleNode(node.id, { borderSize: n });
    for (const c of connectors) onStyleConnector(c.id, { borderSize: n });
  };
  const previewBorderSize = (n) => {
    for (const node of nodes) onStyleNodePreview?.(node.id, { borderSize: n });
    for (const c of connectors) onStyleConnectorPreview?.(c.id, { borderSize: n });
  };
  const applyFontSize = (n) => {
    if (nodes.length > 1 && onStyleNodes) {
      onStyleNodes(
        nodes.map((node) => node.id),
        { fontSize: n }
      );
    } else {
      for (const node of nodes) onStyleNode(node.id, { fontSize: n });
    }
  };
  const previewFontSize = (n) => {
    if (nodes.length > 1 && onStyleNodesPreview) {
      onStyleNodesPreview(
        nodes.map((node) => node.id),
        { fontSize: n }
      );
    } else {
      for (const node of nodes) onStyleNodePreview?.(node.id, { fontSize: n });
    }
  };
  const fontSizeIndeterminate = visualNodes.length > 1 && new Set(visualNodes.map((n) => n.data.fontSize ?? NODE_FONT_SIZE_DEFAULT)).size > 1;
  const applyTextColor = (token) => {
    if (nodes.length > 1 && onStyleNodes) {
      onStyleNodes(
        nodes.map((node) => node.id),
        { textColor: token }
      );
    } else {
      for (const node of nodes) onStyleNode(node.id, { textColor: token });
    }
  };
  const textColorActive = firstVisualNode?.data.textColor ?? (isTextShape ? firstVisualNode?.data.borderColor ?? "default" : "default");
  const applyConnectorFontSize = (n) => {
    for (const c of connectors) onStyleConnector(c.id, { fontSize: n });
  };
  const previewConnectorFontSize = (n) => {
    for (const c of connectors) onStyleConnectorPreview?.(c.id, { fontSize: n });
  };
  const connectorFontSizeIndeterminate = connectors.length > 1 && new Set(connectors.map((c) => c.fontSize ?? CONNECTOR_FONT_SIZE_DEFAULT)).size > 1;
  const applyCornerRadius = (n) => {
    for (const node of nodes) onStyleNode(node.id, { cornerRadius: n });
  };
  const previewCornerRadius = (n) => {
    for (const node of nodes) onStyleNodePreview?.(node.id, { cornerRadius: n });
  };
  const cornerRadiusIndeterminate = visualNodes.length > 1 && new Set(visualNodes.map((n) => n.data.cornerRadius ?? DEFAULT_CORNER_RADIUS)).size > 1;
  const applyConnectorPath = (path) => {
    for (const c of connectors) onStyleConnector(c.id, { path });
  };
  const applyConnectorDirection = (direction) => {
    for (const c of connectors) onStyleConnector(c.id, { direction });
  };
  const applyIconColor = (token) => {
    for (const n of nodes) onStyleNode(n.id, { color: token });
  };
  const iconColorActive = firstIconNode?.data.color ?? "default";
  const widthCurrent = pureConnector ? firstConnector?.borderSize ?? DEFAULT_STROKE_WIDTH2 : firstVisualNode?.data.borderSize ?? DEFAULT_BORDER_SIZE;
  const widthDefault = pureConnector ? DEFAULT_STROKE_WIDTH2 : DEFAULT_BORDER_SIZE;
  const colorTriggerKind = pureConnector ? "edge" : "border";
  const colorTooltip = pureConnector ? "Connector color" : isTextShape ? "Color" : "Border color";
  const colorAriaLabel = pureConnector ? "connector color" : isTextShape ? "color" : "border color";
  const colorInnerTestId = pureConnector ? "style-tab-edge-color-trigger" : isTextShape ? "style-tab-color-trigger" : "style-tab-border-color-trigger";
  const colorTokenPrefix = pureConnector || isTextShape ? "style-tab-color" : "style-tab-border-color";
  if (pureIconNode) {
    const showChangeIcon = !!onRequestIconReplace && nodes.length === 1 && !!firstIconNode;
    const onChangeIconClick = () => {
      if (firstIconNode && onRequestIconReplace) onRequestIconReplace(firstIconNode.id);
    };
    return /* @__PURE__ */ jsx36(TooltipProvider, { delayDuration: 300, children: /* @__PURE__ */ jsxs23(
      "div",
      {
        "data-testid": "canvas-style-strip",
        className: "sf-pointer-events-auto sf-flex sf-flex-col sf-items-center sf-gap-1 sf-rounded-lg sf-border sf-border-border sf-bg-background/95 sf-p-1 sf-shadow-md sf-backdrop-blur",
        children: [
          /* @__PURE__ */ jsx36(
            SwatchButton,
            {
              testId: "style-strip-icon-color",
              tooltip: "Icon color",
              ariaLabel: "icon color",
              activeToken: iconColorActive,
              previewKind: "edge",
              tokenTestIdPrefix: "style-tab-icon-color",
              innerTestId: "style-tab-icon-color-trigger",
              onSelect: applyIconColor
            }
          ),
          showChangeIcon ? /* @__PURE__ */ jsxs23(Tooltip, { children: [
            /* @__PURE__ */ jsx36(TooltipTrigger, { asChild: true, children: /* @__PURE__ */ jsx36(
              "button",
              {
                type: "button",
                "data-testid": "style-strip-change-icon",
                "aria-label": "change icon",
                title: "Change icon",
                onClick: onChangeIconClick,
                className: cn(
                  "sf-inline-flex sf-h-8 sf-w-8 sf-items-center sf-justify-center sf-rounded-md sf-text-muted-foreground sf-transition-colors hover:sf-bg-accent hover:sf-text-accent-foreground",
                  "focus-visible:sf-outline-none focus-visible:sf-ring-2 focus-visible:sf-ring-ring focus-visible:sf-ring-offset-1"
                ),
                children: /* @__PURE__ */ jsx36(Sticker2, { className: "sf-h-4 sf-w-4" })
              }
            ) }),
            /* @__PURE__ */ jsx36(TooltipContent, { side: "right", className: "sf-px-2 sf-py-1 sf-text-xs", children: "Change icon" })
          ] }) : null
        ]
      }
    ) });
  }
  if (pureImageNode) {
    const firstImage = nodes[0];
    const imageBorderColor = firstImage?.data.borderColor ?? "default";
    const imageBorderStyle = firstImage?.data.borderStyle ?? "solid";
    const imageBorderWidth = firstImage?.data.borderWidth ?? 1;
    const applyImageBorderColor = (token) => {
      for (const n of nodes) onStyleNode(n.id, { borderColor: token });
    };
    const applyImageBorderStyle = (style) => {
      for (const n of nodes) onStyleNode(n.id, { borderStyle: style });
    };
    const applyImageBorderWidth = (n) => {
      for (const node of nodes) onStyleNode(node.id, { borderWidth: n });
    };
    const previewImageBorderWidth = (n) => {
      for (const node of nodes) onStyleNodePreview?.(node.id, { borderWidth: n });
    };
    const applyImageCornerRadius = (n) => {
      for (const node of nodes) onStyleNode(node.id, { cornerRadius: n });
    };
    const previewImageCornerRadius = (n) => {
      for (const node of nodes) onStyleNodePreview?.(node.id, { cornerRadius: n });
    };
    return /* @__PURE__ */ jsx36(TooltipProvider, { delayDuration: 300, children: /* @__PURE__ */ jsxs23(
      "div",
      {
        "data-testid": "canvas-style-strip",
        className: "sf-pointer-events-auto sf-flex sf-flex-col sf-items-center sf-gap-1 sf-rounded-lg sf-border sf-border-border sf-bg-background/95 sf-p-1 sf-shadow-md sf-backdrop-blur",
        children: [
          /* @__PURE__ */ jsx36(
            SwatchButton,
            {
              testId: "style-strip-image-border-color",
              tooltip: "Border color",
              ariaLabel: "image border color",
              activeToken: imageBorderColor,
              previewKind: "border",
              tokenTestIdPrefix: "style-tab-image-border-color",
              innerTestId: "style-tab-image-border-color-trigger",
              onSelect: applyImageBorderColor
            }
          ),
          /* @__PURE__ */ jsx36(
            PopoverButton,
            {
              testId: "style-strip-image-border-style",
              tooltip: "Border style",
              ariaLabel: "image border style",
              renderIcon: () => {
                const Icon2 = BORDER_STYLE_OPTIONS.find((o) => o.value === imageBorderStyle)?.icon ?? LineSolidIcon;
                return /* @__PURE__ */ jsx36(Icon2, { className: "sf-h-4 sf-w-4" });
              },
              children: /* @__PURE__ */ jsx36(
                IconToggleGroup,
                {
                  ariaLabel: "Border style",
                  value: imageBorderStyle,
                  onChange: applyImageBorderStyle,
                  options: BORDER_STYLE_OPTIONS
                }
              )
            }
          ),
          /* @__PURE__ */ jsx36(
            PopoverButton,
            {
              testId: "style-strip-image-border-width",
              tooltip: "Border width",
              ariaLabel: "image border width",
              renderIcon: () => /* @__PURE__ */ jsx36("span", { className: "sf-font-mono sf-text-[10px] sf-tabular-nums", children: imageBorderWidth }),
              children: /* @__PURE__ */ jsx36(
                SliderControl,
                {
                  value: firstImage?.data.borderWidth,
                  defaultValue: 1,
                  min: 1,
                  max: 8,
                  suffix: "px",
                  onPreview: previewImageBorderWidth,
                  onCommit: applyImageBorderWidth,
                  testId: "style-tab-image-border-width-slider"
                }
              )
            }
          ),
          /* @__PURE__ */ jsx36(
            PopoverButton,
            {
              testId: "style-strip-image-corner-radius",
              tooltip: "Corners",
              ariaLabel: "image corner radius",
              renderIcon: () => /* @__PURE__ */ jsx36(Squircle, { className: "sf-h-4 sf-w-4" }),
              children: /* @__PURE__ */ jsx36(
                SliderControl,
                {
                  value: firstImage?.data.cornerRadius,
                  defaultValue: DEFAULT_CORNER_RADIUS,
                  min: 0,
                  max: 32,
                  suffix: "px",
                  onPreview: previewImageCornerRadius,
                  onCommit: applyImageCornerRadius,
                  testId: "style-tab-image-corner-radius-slider"
                }
              )
            }
          )
        ]
      }
    ) });
  }
  const showFillSection = pureNode && !isTextShape;
  const showBorderSection = !isTextShape;
  const showTextColorSection = !pureConnector;
  const renderColorsTrigger = () => {
    if (pureConnector) {
      const edge = COLOR_TOKENS[borderColorActive].edge;
      return /* @__PURE__ */ jsx36(
        "span",
        {
          className: "sf-inline-block sf-h-5 sf-w-5 sf-rounded-full sf-ring-1 sf-ring-border",
          style: { backgroundColor: edge }
        }
      );
    }
    const borderHex = COLOR_TOKENS[borderColorActive].border;
    const fillHex = COLOR_TOKENS[backgroundActive].background;
    return /* @__PURE__ */ jsx36(
      "span",
      {
        className: "sf-inline-block sf-h-5 sf-w-5 sf-rounded-md sf-ring-1 sf-ring-border",
        style: { backgroundColor: fillHex, border: `2px solid ${borderHex}` }
      }
    );
  };
  return /* @__PURE__ */ jsx36(TooltipProvider, { delayDuration: 300, children: /* @__PURE__ */ jsxs23(
    "div",
    {
      "data-testid": "canvas-style-strip",
      className: "sf-pointer-events-auto sf-flex sf-flex-col sf-items-center sf-gap-1 sf-rounded-lg sf-border sf-border-border sf-bg-background/95 sf-p-1 sf-shadow-md sf-backdrop-blur",
      children: [
        !isTextShape ? /* @__PURE__ */ jsx36(
          PopoverButton,
          {
            testId: "style-strip-colors",
            tooltip: "Colors",
            ariaLabel: "colors",
            renderIcon: renderColorsTrigger,
            children: /* @__PURE__ */ jsxs23("div", { className: "sf-flex sf-w-56 sf-flex-col sf-gap-3", children: [
              /* @__PURE__ */ jsx36(PopoverSection, { label: colorTooltip, children: /* @__PURE__ */ jsx36(
                ColorSwatchGrid,
                {
                  testId: "style-strip-border-color",
                  activeToken: borderColorActive,
                  previewKind: colorTriggerKind,
                  tokenTestIdPrefix: colorTokenPrefix,
                  innerTestId: colorInnerTestId,
                  ariaLabel: colorAriaLabel,
                  onSelect: applyBorderColor
                }
              ) }),
              showFillSection ? /* @__PURE__ */ jsx36(PopoverSection, { label: "Fill", children: /* @__PURE__ */ jsx36(
                ColorSwatchGrid,
                {
                  testId: "style-strip-fill",
                  activeToken: backgroundActive,
                  previewKind: "background",
                  tokenTestIdPrefix: "style-tab-background-color",
                  innerTestId: "style-tab-background-color-trigger",
                  ariaLabel: "fill",
                  onSelect: applyBackgroundColor
                }
              ) }) : null
            ] })
          }
        ) : null,
        showBorderSection ? /* @__PURE__ */ jsx36(
          PopoverButton,
          {
            testId: "style-strip-border",
            tooltip: pureConnector ? "Connector" : "Border",
            ariaLabel: pureConnector ? "connector" : "border",
            renderIcon: () => {
              const Icon2 = (pureConnector ? CONNECTOR_STYLE_OPTIONS.find((o) => o.value === connectorStyleActive)?.icon : BORDER_STYLE_OPTIONS.find((o) => o.value === borderStyleActiveNode)?.icon) ?? LineSolidIcon;
              return /* @__PURE__ */ jsx36(Icon2, { className: "sf-h-4 sf-w-4" });
            },
            children: /* @__PURE__ */ jsxs23("div", { className: "sf-flex sf-w-56 sf-flex-col sf-gap-3", children: [
              /* @__PURE__ */ jsx36(PopoverSection, { label: "Style", testId: "style-strip-border-style", children: pureConnector ? /* @__PURE__ */ jsx36(
                IconToggleGroup,
                {
                  ariaLabel: "Connector style",
                  value: connectorStyleActive,
                  onChange: (s) => applyBorderStyle(s),
                  options: CONNECTOR_STYLE_OPTIONS
                }
              ) : /* @__PURE__ */ jsx36(
                IconToggleGroup,
                {
                  ariaLabel: "Border style",
                  value: borderStyleActiveNode,
                  onChange: (s) => applyBorderStyle(s),
                  options: BORDER_STYLE_OPTIONS
                }
              ) }),
              /* @__PURE__ */ jsx36(PopoverSection, { label: "Width", testId: "style-strip-border-size", children: /* @__PURE__ */ jsx36(
                SliderControl,
                {
                  value: widthCurrent,
                  defaultValue: widthDefault,
                  min: 1,
                  max: 8,
                  suffix: "px",
                  onPreview: previewBorderSize,
                  onCommit: applyBorderSize,
                  testId: pureConnector ? "style-tab-stroke-width-slider" : "style-tab-border-size-slider"
                }
              ) })
            ] })
          }
        ) : null,
        hasNodes || pureConnector ? /* @__PURE__ */ jsx36(
          PopoverButton,
          {
            testId: "style-strip-text",
            tooltip: "Text",
            ariaLabel: "text",
            renderIcon: () => /* @__PURE__ */ jsx36(Type2, { className: "sf-h-4 sf-w-4" }),
            children: /* @__PURE__ */ jsxs23("div", { className: "sf-flex sf-w-56 sf-flex-col sf-gap-3", children: [
              /* @__PURE__ */ jsx36(
                PopoverSection,
                {
                  label: "Size",
                  testId: pureConnector ? "style-strip-connector-font-size" : "style-strip-font-size",
                  children: /* @__PURE__ */ jsx36(
                    SliderControl,
                    {
                      value: pureConnector ? firstConnector?.fontSize : firstVisualNode?.data.fontSize,
                      defaultValue: pureConnector ? CONNECTOR_FONT_SIZE_DEFAULT : NODE_FONT_SIZE_DEFAULT,
                      min: pureConnector ? 8 : 10,
                      max: 32,
                      suffix: "px",
                      indeterminate: pureConnector ? connectorFontSizeIndeterminate : fontSizeIndeterminate,
                      onPreview: pureConnector ? previewConnectorFontSize : previewFontSize,
                      onCommit: pureConnector ? applyConnectorFontSize : applyFontSize,
                      testId: pureConnector ? "style-tab-connector-font-size-slider" : "style-tab-font-size-slider"
                    }
                  )
                }
              ),
              showTextColorSection ? /* @__PURE__ */ jsx36(PopoverSection, { label: "Color", children: /* @__PURE__ */ jsx36(
                ColorSwatchGrid,
                {
                  testId: "style-strip-text-color",
                  activeToken: textColorActive,
                  previewKind: "edge",
                  tokenTestIdPrefix: "style-tab-text-color",
                  innerTestId: "style-tab-text-color-trigger",
                  ariaLabel: "text color",
                  onSelect: applyTextColor
                }
              ) }) : null
            ] })
          }
        ) : null,
        hasNodes && !isTextShape ? /* @__PURE__ */ jsx36(
          PopoverButton,
          {
            testId: "style-strip-corner-radius",
            tooltip: "Corners",
            ariaLabel: "corner radius",
            renderIcon: () => /* @__PURE__ */ jsx36(Squircle, { className: "sf-h-4 sf-w-4" }),
            children: /* @__PURE__ */ jsx36(
              SliderControl,
              {
                value: firstVisualNode?.data.cornerRadius,
                defaultValue: DEFAULT_CORNER_RADIUS,
                min: 0,
                max: 32,
                suffix: "px",
                indeterminate: cornerRadiusIndeterminate,
                onPreview: previewCornerRadius,
                onCommit: applyCornerRadius,
                testId: "style-tab-corner-radius-slider"
              }
            )
          }
        ) : null,
        pureConnector ? /* @__PURE__ */ jsx36(
          PopoverButton,
          {
            testId: "style-strip-path",
            tooltip: "Connector path",
            ariaLabel: "connector path",
            renderIcon: () => {
              const Icon2 = PATH_OPTIONS.find((o) => o.value === pathActive)?.icon ?? PathCurveIcon;
              return /* @__PURE__ */ jsx36(Icon2, { className: "sf-h-4 sf-w-4" });
            },
            children: /* @__PURE__ */ jsx36(
              IconToggleGroup,
              {
                ariaLabel: "Connector path",
                value: pathActive,
                onChange: applyConnectorPath,
                options: PATH_OPTIONS
              }
            )
          }
        ) : null,
        pureConnector ? /* @__PURE__ */ jsx36(
          PopoverButton,
          {
            testId: "style-strip-direction",
            tooltip: "Direction",
            ariaLabel: "direction",
            renderIcon: () => {
              const Icon2 = DIRECTION_OPTIONS.find((o) => o.value === directionActive)?.icon ?? ArrowRight;
              return /* @__PURE__ */ jsx36(Icon2, { className: "sf-h-4 sf-w-4" });
            },
            children: /* @__PURE__ */ jsx36(
              IconToggleGroup,
              {
                ariaLabel: "Connector direction",
                value: directionActive,
                onChange: applyConnectorDirection,
                options: DIRECTION_OPTIONS
              }
            )
          }
        ) : null
      ]
    }
  ) });
}
function swatchPreviewStyle(token, kind) {
  const palette = COLOR_TOKENS[token];
  if (kind === "background")
    return { backgroundColor: palette.background, borderColor: palette.border };
  if (kind === "edge") return { backgroundColor: palette.edge, borderColor: palette.edge };
  return { borderColor: palette.border, backgroundColor: palette.background };
}
function swatchTriggerFillStyle(token, kind) {
  const palette = COLOR_TOKENS[token];
  if (kind === "background") return { backgroundColor: palette.background };
  if (kind === "edge") return { backgroundColor: palette.edge };
  return { backgroundColor: palette.border };
}
function SwatchButton({
  testId,
  tooltip,
  ariaLabel,
  activeToken,
  previewKind,
  tokenTestIdPrefix,
  innerTestId,
  onSelect
}) {
  const [open, setOpen] = useState13(false);
  const isUnset = activeToken === "default";
  return /* @__PURE__ */ jsxs23(Popover, { open, onOpenChange: setOpen, children: [
    /* @__PURE__ */ jsxs23(Tooltip, { children: [
      /* @__PURE__ */ jsx36(TooltipTrigger, { asChild: true, children: /* @__PURE__ */ jsx36(PopoverTrigger, { asChild: true, children: /* @__PURE__ */ jsx36(
        "button",
        {
          type: "button",
          "data-testid": testId,
          "data-active-token": activeToken,
          "aria-label": `${ariaLabel}: ${activeToken}`,
          title: tooltip,
          className: cn(
            "sf-group sf-relative sf-inline-flex sf-h-8 sf-w-8 sf-items-center sf-justify-center sf-rounded-md sf-text-muted-foreground sf-transition-colors hover:sf-bg-accent hover:sf-text-accent-foreground",
            "focus-visible:sf-outline-none focus-visible:sf-ring-2 focus-visible:sf-ring-ring focus-visible:sf-ring-offset-1"
          ),
          children: /* @__PURE__ */ jsx36(
            "span",
            {
              "data-testid": innerTestId,
              className: "sf-relative sf-h-5 sf-w-5 sf-rounded-full sf-ring-1 sf-ring-border",
              style: swatchTriggerFillStyle(activeToken, previewKind),
              children: isUnset ? /* @__PURE__ */ jsx36(
                "span",
                {
                  "aria-hidden": "true",
                  className: "sf-pointer-events-none sf-absolute sf-inset-0 sf-rounded-full",
                  style: {
                    backgroundImage: "linear-gradient(45deg, transparent 45%, currentColor 45%, currentColor 55%, transparent 55%)",
                    color: "hsl(var(--muted-foreground))",
                    opacity: 0.5
                  }
                }
              ) : null
            }
          )
        }
      ) }) }),
      /* @__PURE__ */ jsx36(TooltipContent, { side: "right", className: "sf-px-2 sf-py-1 sf-text-xs", children: tooltip })
    ] }),
    /* @__PURE__ */ jsx36(
      PopoverContent,
      {
        side: "right",
        align: "start",
        className: "sf-w-auto sf-p-2",
        "data-testid": `${innerTestId}-popover`,
        children: /* @__PURE__ */ jsx36("div", { className: "sf-grid sf-grid-cols-4 sf-gap-1.5", children: PALETTE_TOKENS.map((token) => {
          const isActive = activeToken === token;
          return /* @__PURE__ */ jsx36(
            "button",
            {
              type: "button",
              onClick: () => {
                onSelect(token);
                setOpen(false);
              },
              "data-testid": `${tokenTestIdPrefix}-${token}`,
              "data-active": isActive,
              "aria-label": `${ariaLabel} ${token}`,
              "aria-pressed": isActive,
              title: token,
              className: cn(
                "sf-relative sf-flex sf-h-7 sf-w-7 sf-items-center sf-justify-center sf-rounded-full sf-border-2 sf-transition-all",
                isActive ? "sf-ring-2 sf-ring-ring sf-ring-offset-2 sf-ring-offset-popover" : "hover:sf-scale-110"
              ),
              style: swatchPreviewStyle(token, previewKind),
              children: isActive ? /* @__PURE__ */ jsx36(
                Check,
                {
                  className: "sf-h-3 sf-w-3 sf-drop-shadow-sm",
                  style: { color: "hsl(var(--foreground))" }
                }
              ) : null
            },
            token
          );
        }) })
      }
    )
  ] });
}
function ColorSwatchGrid({
  testId,
  activeToken,
  previewKind,
  tokenTestIdPrefix,
  innerTestId,
  ariaLabel,
  onSelect
}) {
  return /* @__PURE__ */ jsx36(
    "div",
    {
      "data-testid": testId,
      "data-active-token": activeToken,
      "data-inner-testid": innerTestId,
      className: "sf-grid sf-grid-cols-4 sf-gap-1.5",
      children: PALETTE_TOKENS.map((token) => {
        const isActive = activeToken === token;
        return /* @__PURE__ */ jsx36(
          "button",
          {
            type: "button",
            onClick: () => onSelect(token),
            "data-testid": `${tokenTestIdPrefix}-${token}`,
            "data-active": isActive,
            "aria-label": `${ariaLabel} ${token}`,
            "aria-pressed": isActive,
            title: token,
            className: cn(
              "sf-relative sf-flex sf-h-7 sf-w-7 sf-items-center sf-justify-center sf-rounded-full sf-border-2 sf-transition-all",
              isActive ? "sf-ring-2 sf-ring-ring sf-ring-offset-2 sf-ring-offset-popover" : "hover:sf-scale-110"
            ),
            style: swatchPreviewStyle(token, previewKind),
            children: isActive ? /* @__PURE__ */ jsx36(
              Check,
              {
                className: "sf-h-3 sf-w-3 sf-drop-shadow-sm",
                style: { color: "hsl(var(--foreground))" }
              }
            ) : null
          },
          token
        );
      })
    }
  );
}
function PopoverSection({
  label,
  testId,
  children
}) {
  return /* @__PURE__ */ jsxs23("div", { className: "sf-flex sf-flex-col sf-gap-1.5", "data-testid": testId, children: [
    /* @__PURE__ */ jsx36("div", { className: "sf-text-[11px] sf-font-medium sf-uppercase sf-tracking-wide sf-text-muted-foreground", children: label }),
    children
  ] });
}
function PopoverButton({
  testId,
  tooltip,
  ariaLabel,
  renderIcon,
  children
}) {
  const [open, setOpen] = useState13(false);
  return /* @__PURE__ */ jsxs23(Popover, { open, onOpenChange: setOpen, children: [
    /* @__PURE__ */ jsxs23(Tooltip, { children: [
      /* @__PURE__ */ jsx36(TooltipTrigger, { asChild: true, children: /* @__PURE__ */ jsx36(PopoverTrigger, { asChild: true, children: /* @__PURE__ */ jsx36(
        "button",
        {
          type: "button",
          "data-testid": testId,
          "aria-label": ariaLabel,
          title: tooltip,
          className: cn(
            "sf-inline-flex sf-h-8 sf-w-8 sf-items-center sf-justify-center sf-rounded-md sf-text-muted-foreground sf-transition-colors hover:sf-bg-accent hover:sf-text-accent-foreground",
            "focus-visible:sf-outline-none focus-visible:sf-ring-2 focus-visible:sf-ring-ring focus-visible:sf-ring-offset-1"
          ),
          children: renderIcon()
        }
      ) }) }),
      /* @__PURE__ */ jsx36(TooltipContent, { side: "right", className: "sf-px-2 sf-py-1 sf-text-xs", children: tooltip })
    ] }),
    /* @__PURE__ */ jsx36(PopoverContent, { side: "right", align: "start", className: "sf-w-auto sf-p-3", children })
  ] });
}
function SliderControl({
  value,
  defaultValue,
  min,
  max,
  suffix,
  indeterminate,
  onPreview,
  onCommit,
  testId
}) {
  const upstream = value ?? defaultValue;
  const [local, setLocal] = useState13(upstream);
  const [picked, setPicked] = useState13(false);
  useEffect8(() => {
    setLocal(upstream);
    setPicked(false);
  }, [upstream]);
  const showPlaceholder = indeterminate && !picked;
  return /* @__PURE__ */ jsxs23("div", { className: "sf-flex sf-w-48 sf-items-center sf-gap-3", children: [
    /* @__PURE__ */ jsx36(
      Slider,
      {
        min,
        max,
        step: 1,
        value: [local],
        onValueChange: ([v]) => {
          const next = v ?? min;
          setLocal(next);
          setPicked(true);
          onPreview?.(next);
        },
        onValueCommit: ([v]) => onCommit(v ?? min),
        "data-testid": testId,
        "data-indeterminate": showPlaceholder ? "true" : void 0,
        className: cn("sf-flex-1", showPlaceholder && "sf-opacity-60")
      }
    ),
    /* @__PURE__ */ jsx36(
      "span",
      {
        "data-testid": `${testId}-value`,
        className: "sf-w-12 sf-shrink-0 sf-text-right sf-text-xs sf-tabular-nums sf-text-muted-foreground",
        children: showPlaceholder ? "Mixed" : /* @__PURE__ */ jsxs23(Fragment6, { children: [
          local,
          suffix
        ] })
      }
    )
  ] });
}

// src/components/seeflow-canvas.tsx
import {
  Background,
  ControlButton,
  Controls,
  Panel,
  Position as Position8,
  ReactFlow,
  SelectionMode,
  applyEdgeChanges,
  applyNodeChanges,
  getBezierPath as getBezierPath2,
  getSmoothStepPath as getSmoothStepPath2,
  useStore,
  useStoreApi
} from "@xyflow/react";
import { LayoutDashboard, Maximize2 } from "lucide-react";
import {
  useCallback as useCallback2,
  useEffect as useEffect9,
  useMemo as useMemo2,
  useRef as useRef5,
  useState as useState14
} from "react";
import "@xyflow/react/dist/style.css";
import { Fragment as Fragment7, jsx as jsx37, jsxs as jsxs24 } from "react/jsx-runtime";
var EDIT_DEFAULTS = {
  showToolbar: true,
  showStyleStrip: true,
  showDetailPanel: true,
  showStatusBadges: true,
  showResizeHandles: true,
  showControls: true,
  enableKeyboard: true,
  enableContextMenu: true,
  enableDragDrop: true,
  enableImageDrop: true,
  enableZoom: true,
  enablePan: true,
  enableSelection: true,
  enableNodeMove: true
};
var VIEW_DEFAULTS = {
  showToolbar: false,
  showStyleStrip: false,
  showDetailPanel: false,
  // View mode keeps status badges (driven by SSE) so the canvas can serve as
  // a live monitoring surface — the AC excludes status badges from "chrome".
  showStatusBadges: true,
  showResizeHandles: false,
  // View mode keeps the Controls cluster so embedders get zoom-in/zoom-out/
  // fit-view buttons — they're navigation aids, not editing affordances.
  showControls: true,
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
  enableNodeMove: true
};
var MINI_DEFAULTS = {
  showToolbar: false,
  showStyleStrip: false,
  showDetailPanel: false,
  // Status badges off so thumbnails read visually neutral; flip on via
  // override for a live-state preview.
  showStatusBadges: false,
  showResizeHandles: false,
  showControls: false,
  enableKeyboard: false,
  enableContextMenu: false,
  enableDragDrop: false,
  enableImageDrop: false,
  enableZoom: false,
  enablePan: false,
  enableSelection: false,
  enableNodeMove: false
};
function resolveFlags(input) {
  const defaults = input.mode === "edit" ? EDIT_DEFAULTS : input.mode === "mini" ? MINI_DEFAULTS : VIEW_DEFAULTS;
  return {
    showToolbar: input.showToolbar ?? defaults.showToolbar,
    showStyleStrip: input.showStyleStrip ?? defaults.showStyleStrip,
    showDetailPanel: input.showDetailPanel ?? defaults.showDetailPanel,
    showStatusBadges: input.showStatusBadges ?? defaults.showStatusBadges,
    showResizeHandles: input.showResizeHandles ?? defaults.showResizeHandles,
    showControls: input.showControls ?? defaults.showControls,
    enableKeyboard: input.enableKeyboard ?? defaults.enableKeyboard,
    enableContextMenu: input.enableContextMenu ?? defaults.enableContextMenu,
    enableDragDrop: input.enableDragDrop ?? defaults.enableDragDrop,
    enableImageDrop: input.enableImageDrop ?? defaults.enableImageDrop,
    enableZoom: input.enableZoom ?? defaults.enableZoom,
    enablePan: input.enablePan ?? defaults.enablePan,
    enableSelection: input.enableSelection ?? defaults.enableSelection,
    enableNodeMove: input.enableNodeMove ?? defaults.enableNodeMove
  };
}
var MIN_DRAW_SIZE = 40;
var FIT_VIEW_OPTIONS = {
  padding: 0.15,
  duration: 300,
  includeHiddenNodes: false
};
function resolveAutoFitView(value) {
  if (value === void 0 || value === false) {
    return { onMount: false, onExternalNodeChange: false };
  }
  if (value === true) {
    return { onMount: true, onExternalNodeChange: true };
  }
  return {
    onMount: value.onMount ?? true,
    onExternalNodeChange: value.onExternalNodeChange ?? true
  };
}
var cursorFromConnectEvent = (e) => {
  if ("clientX" in e) return { clientX: e.clientX, clientY: e.clientY };
  const touch = e.changedTouches[0] ?? e.touches[0];
  return touch ? { clientX: touch.clientX, clientY: touch.clientY } : null;
};
var nodeElAtPoint = (clientX, clientY) => {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const el of stack) {
    const nodeEl = el.closest?.(".react-flow__node");
    if (nodeEl) return nodeEl;
  }
  return null;
};
var RECONNECT_BUFFER_PX = 15;
var nodeElNearPoint = (wrapper, clientX, clientY) => {
  const direct = nodeElAtPoint(clientX, clientY);
  if (direct) return direct;
  if (!wrapper) return null;
  let nearest = null;
  let nearestDist = RECONNECT_BUFFER_PX;
  const nodes = wrapper.querySelectorAll(".react-flow__node");
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
function computeUnmovedLockPin(movingSide, oldEdgeSource, oldEdgeTarget, edgeData, rfGetInternalNode) {
  const unmovedAlreadyLocked = movingSide === "source" ? edgeData?.targetPin !== void 0 || edgeData?.targetHandleAutoPicked === false : edgeData?.sourcePin !== void 0 || edgeData?.sourceHandleAutoPicked === false;
  if (unmovedAlreadyLocked) return void 0;
  const unmovedNodeId = movingSide === "source" ? oldEdgeTarget : oldEdgeSource;
  const movedOldNodeId = movingSide === "source" ? oldEdgeSource : oldEdgeTarget;
  const unmovedNode = rfGetInternalNode(unmovedNodeId);
  const movedOldNode = rfGetInternalNode(movedOldNodeId);
  if (!unmovedNode || !movedOldNode) return void 0;
  const uW = unmovedNode.measured.width ?? unmovedNode.width ?? 0;
  const uH = unmovedNode.measured.height ?? unmovedNode.height ?? 0;
  const mW = movedOldNode.measured.width ?? movedOldNode.width ?? 0;
  const mH = movedOldNode.measured.height ?? movedOldNode.height ?? 0;
  if (uW === 0 || uH === 0 || mW === 0 || mH === 0) return void 0;
  const unmovedBox = {
    x: unmovedNode.internals.positionAbsolute.x,
    y: unmovedNode.internals.positionAbsolute.y,
    w: uW,
    h: uH
  };
  const movedOldCenter = {
    x: movedOldNode.internals.positionAbsolute.x + mW / 2,
    y: movedOldNode.internals.positionAbsolute.y + mH / 2
  };
  return endpointToPin(unmovedBox, getNodeIntersection(unmovedBox, movedOldCenter));
}
function classifyReconnectBodyDrop(movingSide, oldEdgeSource, oldEdgeTarget, droppedNodeId) {
  if (droppedNodeId === null) return "no-op";
  const ownNodeId = movingSide === "source" ? oldEdgeSource : oldEdgeTarget;
  const otherNodeId = movingSide === "source" ? oldEdgeTarget : oldEdgeSource;
  if (droppedNodeId === otherNodeId) return "self-loop";
  if (droppedNodeId === ownNodeId) return "pin-own";
  return "reconnect-and-pin";
}
function classifyHandleDropFailure(toHandle, isValid, _nodes) {
  if (!toHandle || isValid !== false) return "no-flash-no-fall-through";
  return "fall-through";
}
var mergeNodeOverride = (node, override) => {
  if (!override) return node;
  const data = override.data ? { ...node.data, ...override.data } : node.data;
  return { ...node, ...override, data };
};
var mergeConnectorOverride = (conn, override) => {
  if (!override) return conn;
  return { ...conn, ...override };
};
var nodeTypes = {
  playNode: PlayNode,
  stateNode: StateNode,
  shapeNode: ShapeNode,
  imageNode: ImageNode,
  iconNode: IconNode,
  // US-014: file-backed escape-hatch node — fetches author HTML at
  // `<project>/.seeflow/<htmlPath>`, sanitizes (US-013), and renders with
  // Tailwind Play CDN (US-012). Missing files render PlaceholderCard.
  htmlNode: HtmlNode
};
var edgeTypes = { editableEdge: EditableEdge };
var DEFAULT_EDGE_OPTIONS = { zIndex: 0 };
function eventTargetIsOtherNode(target, nodeId) {
  if (!target || typeof target.closest !== "function") return false;
  const closestNode = target.closest(".react-flow__node");
  if (!closestNode) return false;
  const dataId = closestNode.getAttribute("data-id");
  return dataId !== null && dataId !== nodeId;
}
var SMOOTHSTEP_BORDER_RADIUS2 = 8;
var makeMarkerUrl = (marker, rfId) => {
  if (!marker) return void 0;
  if (typeof marker === "string") return `url('#${marker}')`;
  const prefix = rfId ? `${rfId}__` : "";
  const id = `${prefix}${Object.keys(marker).sort().map((key) => `${key}=${marker[key]}`).join("&")}`;
  return `url('#${id}')`;
};
var buildReconnectAwareConnectionLine = (isReconnectingRef) => {
  return function ReconnectAwareConnectionLine({
    fromX,
    fromY,
    toX,
    toY,
    fromPosition,
    toPosition,
    connectionLineStyle
  }) {
    const reconnectingEdge = useStore(
      (s) => isReconnectingRef.current ? s.edges.find((e) => e.reconnectable === true) ?? null : null
    );
    const data = reconnectingEdge?.data;
    const fixedNodeId = useStore((s) => {
      const conn = s.connection;
      return conn?.fromHandle?.nodeId ?? null;
    });
    const sourceNode = useStore(
      (s) => reconnectingEdge?.source ? s.nodeLookup.get(reconnectingEdge.source) ?? null : null
    );
    const targetNode = useStore(
      (s) => reconnectingEdge?.target ? s.nodeLookup.get(reconnectingEdge.target) ?? null : null
    );
    const fromNodeFromStore = useStore(
      (s) => fixedNodeId ? s.nodeLookup.get(fixedNodeId) ?? null : null
    );
    const fixedNodeIsSource = reconnectingEdge?.source === fixedNodeId;
    const fixedNode = reconnectingEdge ? fixedNodeIsSource ? sourceNode : targetNode : fromNodeFromStore;
    const otherNode = fixedNodeIsSource ? targetNode : sourceNode;
    const fixedHasPin = fixedNodeIsSource ? data?.sourcePin : data?.targetPin;
    const fixedAutoPicked = fixedNodeIsSource ? data?.sourceHandleAutoPicked : data?.targetHandleAutoPicked;
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
          h: fH
        };
        let overrideEndpoint = null;
        if (fixedHasPin) {
          overrideEndpoint = endpointFromPin(fixedBox, fixedHasPin);
        } else if (fixedAutoPicked !== false && otherNode) {
          const oW = otherNode.measured.width ?? otherNode.width ?? 0;
          const oH = otherNode.measured.height ?? otherNode.height ?? 0;
          if (oW > 0 && oH > 0) {
            const otherCenter = {
              x: otherNode.internals.positionAbsolute.x + oW / 2,
              y: otherNode.internals.positionAbsolute.y + oH / 2
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
    const zoom = useStore((s) => s.transform[2]);
    const nodeMap = useStore((s) => s.nodeLookup);
    const xyflowToNodeId = useStore((s) => s.connection.toHandle?.nodeId ?? null);
    let effectiveToX = toX;
    let effectiveToY = toY;
    let effectiveToPosition = toPosition;
    if (zoom > 0) {
      const bufferFlow = RECONNECT_BUFFER_PX / zoom;
      const excludeNodeId = reconnectingEdge ? fixedNodeIsSource ? reconnectingEdge.target : reconnectingEdge.source : null;
      let bestNode = null;
      if (xyflowToNodeId && xyflowToNodeId !== excludeNodeId) {
        const candidate = nodeMap.get(xyflowToNodeId) ?? null;
        if (candidate) bestNode = candidate;
      }
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
              h
            },
            { x: toX, y: toY }
          );
          const projectedEndpoint = endpointFromPin(
            {
              x: bestNode.internals.positionAbsolute.x,
              y: bestNode.internals.positionAbsolute.y,
              w,
              h
            },
            projectedPin
          );
          effectiveToX = projectedEndpoint.x;
          effectiveToY = projectedEndpoint.y;
          effectiveToPosition = POSITION_BY_SIDE_LINE[projectedEndpoint.side];
        }
      }
    }
    const isStep = data?.path === "step";
    const [path] = isStep ? getSmoothStepPath2({
      sourceX: effectiveFromX,
      sourceY: effectiveFromY,
      sourcePosition: effectiveFromPosition,
      targetX: effectiveToX,
      targetY: effectiveToY,
      targetPosition: effectiveToPosition,
      borderRadius: SMOOTHSTEP_BORDER_RADIUS2
    }) : getBezierPath2({
      sourceX: effectiveFromX,
      sourceY: effectiveFromY,
      sourcePosition: effectiveFromPosition,
      targetX: effectiveToX,
      targetY: effectiveToY,
      targetPosition: effectiveToPosition
    });
    const style = reconnectingEdge?.style ?? connectionLineStyle ?? void 0;
    const rfId = useStore((s) => s.rfId);
    const orientedMarkerStart = fixedNodeIsSource ? reconnectingEdge?.markerStart : reconnectingEdge?.markerEnd;
    const orientedMarkerEnd = fixedNodeIsSource ? reconnectingEdge?.markerEnd : reconnectingEdge?.markerStart;
    const markerStartUrl = makeMarkerUrl(orientedMarkerStart, rfId);
    const markerEndUrl = makeMarkerUrl(orientedMarkerEnd, rfId);
    return /* @__PURE__ */ jsx37(
      "path",
      {
        d: path,
        fill: "none",
        className: "react-flow__connection-path",
        style,
        markerStart: markerStartUrl,
        markerEnd: markerEndUrl
      }
    );
  };
};
var POSITION_BY_SIDE_LINE = {
  top: Position8.Top,
  right: Position8.Right,
  bottom: Position8.Bottom,
  left: Position8.Left
};
function StoreApiBridge({ storeApiRef }) {
  const storeApi = useStoreApi();
  useEffect9(() => {
    storeApiRef.current = storeApi;
    return () => {
      if (storeApiRef.current === storeApi) storeApiRef.current = null;
    };
  }, [storeApi, storeApiRef]);
  return null;
}
function ZoomBridge({ wrapperRef }) {
  const zoom = useStore((s) => s.transform[2]);
  const wrapper = wrapperRef.current;
  if (wrapper) wrapper.style.setProperty("--rf-zoom", String(zoom));
  return null;
}
var EDITABLE_TAGS = /* @__PURE__ */ new Set(["INPUT", "TEXTAREA", "SELECT"]);
var isEditableTarget = (el) => {
  if (!el) return false;
  if (EDITABLE_TAGS.has(el.tagName)) return true;
  return el instanceof HTMLElement && el.isContentEditable;
};
function handleClipboardShortcut(deps) {
  const { event, selectedNodeIds, hasClipboard, activeElement, onCopySelection, onPasteSelection } = deps;
  if (!(event.metaKey || event.ctrlKey)) return false;
  if (event.shiftKey || event.altKey) return false;
  const key = event.key.toLowerCase();
  if (key !== "c" && key !== "v") return false;
  if (isEditableTarget(activeElement)) return false;
  if (key === "c") {
    if (selectedNodeIds.length === 0) return false;
    if (!onCopySelection) return false;
    event.preventDefault();
    onCopySelection([...selectedNodeIds]);
    return true;
  }
  if (!hasClipboard) return false;
  if (!onPasteSelection) return false;
  event.preventDefault();
  onPasteSelection();
  return true;
}
var statusFor = (runs, id) => runs?.[id]?.status ?? "idle";
var dataStatusFor = (runs, id) => runs?.[id]?.status;
var dataErrorMessageFor = (runs, id) => runs?.[id]?.status === "error" ? runs[id]?.error : void 0;
function SeeflowCanvas(props) {
  const {
    mode,
    // US-007: `adapter` is forwarded to the built-in DetailPanel so its
    // htmlNode file-action buttons (Open in editor / Reveal in OS file
    // manager) route through `adapter.openFile` / `adapter.revealFile`. Every
    // other mutation site still goes through the explicit callback props the
    // parent supplies.
    adapter,
    projectId,
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
    disableSidebar,
    statusReport,
    onNameChange,
    onDescriptionChange,
    onDetailChange,
    onIconChange,
    autoFitView,
    autoFitViewSignal,
    customIcons,
    showToolbar,
    showStyleStrip,
    showDetailPanel,
    showStatusBadges,
    showResizeHandles,
    showControls,
    enableKeyboard,
    enableContextMenu,
    enableDragDrop,
    enableImageDrop,
    enableZoom,
    enablePan,
    enableSelection,
    enableNodeMove
  } = props;
  const flags = useMemo2(
    () => resolveFlags({
      mode,
      showToolbar,
      showStyleStrip,
      showDetailPanel,
      showStatusBadges,
      showResizeHandles,
      showControls,
      enableKeyboard,
      enableContextMenu,
      enableDragDrop,
      enableImageDrop,
      enableZoom,
      enablePan,
      enableSelection,
      enableNodeMove
    }),
    [
      mode,
      showToolbar,
      showStyleStrip,
      showDetailPanel,
      showStatusBadges,
      showResizeHandles,
      showControls,
      enableKeyboard,
      enableContextMenu,
      enableDragDrop,
      enableImageDrop,
      enableZoom,
      enablePan,
      enableSelection,
      enableNodeMove
    ]
  );
  const isEditMode = mode === "edit";
  const flagsRef = useRef5(flags);
  useEffect9(() => {
    flagsRef.current = flags;
  }, [flags]);
  const effectiveAutoFitView = autoFitView ?? (mode === "mini" ? true : void 0);
  const resolvedAutoFitView = useMemo2(
    () => resolveAutoFitView(effectiveAutoFitView),
    [effectiveAutoFitView]
  );
  const runs = runtime?.runs;
  const statusByNode = runtime?.statuses;
  const nodeOverrides = runtime?.pendingOverrides?.nodes;
  const connectorOverrides = runtime?.pendingOverrides?.connectors;
  const wrapperRef = useRef5(null);
  const rfInstanceRef = useRef5(null);
  const didMountFitRef = useRef5(false);
  const pendingFitRef = useRef5(false);
  const signalEffectMountedRef = useRef5(false);
  const resolvedAutoFitViewRef = useRef5(resolvedAutoFitView);
  resolvedAutoFitViewRef.current = resolvedAutoFitView;
  useEffect9(() => {
    if (didMountFitRef.current) return;
    if (!resolvedAutoFitView.onMount) return;
    if (nodes.length === 0) return;
    const rfInstance = rfInstanceRef.current;
    if (!rfInstance) return;
    rfInstance.fitView(FIT_VIEW_OPTIONS);
    didMountFitRef.current = true;
  }, [nodes, resolvedAutoFitView.onMount]);
  const storeApiRef = useRef5(null);
  const drawShape = activeShape;
  const setDrawShape = onSelectShape;
  const editHandlesRef = useRef5(/* @__PURE__ */ new Map());
  const registerEditHandle = useCallback2((id, enter) => {
    editHandlesRef.current.set(id, enter);
    return () => {
      const current = editHandlesRef.current.get(id);
      if (current === enter) editHandlesRef.current.delete(id);
    };
  }, []);
  const [connecting, setConnecting] = useState14(false);
  const connectingRef = useRef5(false);
  useEffect9(() => {
    connectingRef.current = connecting;
  }, [connecting]);
  const connectCancelledRef = useRef5(false);
  const reconnectCancelledRef = useRef5(false);
  const isReconnectingRef = useRef5(false);
  const [dropPopover, setDropPopover] = useState14(null);
  const dropPopoverRef = useRef5(null);
  useEffect9(() => {
    dropPopoverRef.current = dropPopover;
  }, [dropPopover]);
  const closeDropPopover = useCallback2(() => {
    setDropPopover(null);
  }, []);
  const connectionLineComponent = useMemo2(
    () => buildReconnectAwareConnectionLine(isReconnectingRef),
    []
  );
  const connectSourceNodeIdRef = useRef5(null);
  const connectTargetNodeIdRef = useRef5(null);
  const setConnectSource = useCallback2((nodeId) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      connectSourceNodeIdRef.current = nodeId;
      return;
    }
    const prev = connectSourceNodeIdRef.current;
    if (prev && prev !== nodeId) {
      const prevEl = wrapper.querySelector(`.react-flow__node[data-id="${CSS.escape(prev)}"]`);
      prevEl?.removeAttribute("data-connect-source");
    }
    if (nodeId) {
      const el = wrapper.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`);
      el?.setAttribute("data-connect-source", "true");
    }
    connectSourceNodeIdRef.current = nodeId;
  }, []);
  const setConnectTarget = useCallback2((nodeId) => {
    const wrapper = wrapperRef.current;
    const prev = connectTargetNodeIdRef.current;
    if (prev === nodeId) return;
    if (wrapper && prev) {
      const prevEl = wrapper.querySelector(`.react-flow__node[data-id="${CSS.escape(prev)}"]`);
      prevEl?.removeAttribute("data-connect-target");
    }
    if (wrapper && nodeId) {
      const el = wrapper.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`);
      el?.setAttribute("data-connect-target", "true");
    }
    connectTargetNodeIdRef.current = nodeId;
  }, []);
  const clearConnectMarkers = useCallback2(() => {
    setConnectSource(null);
    setConnectTarget(null);
  }, [setConnectSource, setConnectTarget]);
  useEffect9(() => {
    if (!connecting) {
      setConnectTarget(null);
      return;
    }
    const onMove = (e) => {
      const nodeEl = nodeElNearPoint(wrapperRef.current, e.clientX, e.clientY);
      const id = nodeEl?.getAttribute("data-id") ?? null;
      if (id && id === connectSourceNodeIdRef.current) {
        setConnectTarget(null);
        return;
      }
      setConnectTarget(id);
    };
    document.addEventListener("pointermove", onMove);
    return () => {
      document.removeEventListener("pointermove", onMove);
    };
  }, [connecting, setConnectTarget]);
  const [drawStart, setDrawStart] = useState14(null);
  const [drawCurrent, setDrawCurrent] = useState14(null);
  const drawShapeRef = useRef5(null);
  const drawStartRef = useRef5(null);
  const drawCurrentRef = useRef5(null);
  const drawingRef = useRef5(false);
  useEffect9(() => {
    drawShapeRef.current = drawShape;
  }, [drawShape]);
  const exitDrawMode = useCallback2(() => {
    setDrawShape(null);
    setDrawStart(null);
    setDrawCurrent(null);
    drawShapeRef.current = null;
    drawStartRef.current = null;
    drawCurrentRef.current = null;
    drawingRef.current = false;
  }, [setDrawShape]);
  useEffect9(() => {
    if (!flags.enableKeyboard) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (isEditableTarget(document.activeElement)) return;
      if (drawShapeRef.current) {
        e.preventDefault();
        exitDrawMode();
        return;
      }
      if (connectingRef.current) {
        e.preventDefault();
        connectCancelledRef.current = true;
        reconnectCancelledRef.current = true;
        try {
          storeApiRef.current?.getState().cancelConnection();
        } catch {
        }
        document.dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 })
        );
        setConnecting(false);
        return;
      }
      if (dropPopoverRef.current) {
        e.preventDefault();
        setDropPopover(null);
        return;
      }
      const hadNodeSel = selectedIdSetRef.current.size > 0;
      const hadConnSel = selectedConnIdSetRef.current.size > 0;
      if (hadNodeSel || hadConnSel) {
        e.preventDefault();
        onSelectionChangeRef.current?.([], []);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exitDrawMode, flags.enableKeyboard]);
  useEffect9(() => {
    if (!flags.enableKeyboard) return;
    const onKey = (e) => {
      handleClipboardShortcut({
        event: e,
        selectedNodeIds,
        hasClipboard: !!hasClipboard,
        activeElement: document.activeElement,
        onCopySelection,
        onPasteSelection
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedNodeIds, hasClipboard, onCopySelection, onPasteSelection, flags.enableKeyboard]);
  const onPointerDown = useCallback2((e) => {
    if (!drawShapeRef.current) return;
    const target = e.target;
    if (!target?.classList.contains("react-flow__pane")) return;
    const client = { x: e.clientX, y: e.clientY };
    drawingRef.current = true;
    drawStartRef.current = client;
    drawCurrentRef.current = client;
    setDrawStart(client);
    setDrawCurrent(client);
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
    }
    e.preventDefault();
    e.stopPropagation();
  }, []);
  const onPointerMove = useCallback2((e) => {
    if (!drawingRef.current) return;
    const client = { x: e.clientX, y: e.clientY };
    drawCurrentRef.current = client;
    setDrawCurrent(client);
  }, []);
  const onPointerUp = useCallback2(
    (e) => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      try {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      } catch {
      }
      const start = drawStartRef.current;
      const current = drawCurrentRef.current;
      const shape = drawShapeRef.current;
      const rfInstance = rfInstanceRef.current;
      exitDrawMode();
      if (!start || !current || !shape || !rfInstance) return;
      const minX = Math.min(start.x, current.x);
      const minY = Math.min(start.y, current.y);
      const maxX = Math.max(start.x, current.x);
      const maxY = Math.max(start.y, current.y);
      const dragScreenWidth = maxX - minX;
      const dragScreenHeight = maxY - minY;
      const flowMin = rfInstance.screenToFlowPosition({ x: minX, y: minY });
      const flowMax = rfInstance.screenToFlowPosition({ x: maxX, y: maxY });
      const dragFlowWidth = flowMax.x - flowMin.x;
      const dragFlowHeight = flowMax.y - flowMin.y;
      const tooSmall = dragScreenWidth < MIN_DRAW_SIZE || dragScreenHeight < MIN_DRAW_SIZE;
      const width = tooSmall ? SHAPE_DEFAULT_SIZE[shape].width : dragFlowWidth;
      const height = tooSmall ? SHAPE_DEFAULT_SIZE[shape].height : dragFlowHeight;
      onCreateShapeNode?.(shape, flowMin, { width, height });
    },
    [exitDrawMode, onCreateShapeNode]
  );
  const draggingRef = useRef5(false);
  const resizingRef = useRef5(false);
  const flushPendingFit = useCallback2(() => {
    if (!pendingFitRef.current) return;
    if (resizingRef.current || draggingRef.current) return;
    pendingFitRef.current = false;
    rfInstanceRef.current?.fitView(FIT_VIEW_OPTIONS);
  }, []);
  const setResizing = useCallback2(
    (on) => {
      resizingRef.current = on;
      if (!on) flushPendingFit();
    },
    [flushPendingFit]
  );
  useEffect9(() => {
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
  const contextEnabled = !!onReorderNode || !!onDeleteNode || !!onCopyNode || !!onPasteAt || !!onUnpinEndpoint;
  const [contextMenuPos, setContextMenuPos] = useState14(null);
  const [contextOnNode, setContextOnNode] = useState14(false);
  const [contextNodeType, setContextNodeType] = useState14(null);
  const [contextEndpoint, setContextEndpoint] = useState14(null);
  const contextNodeIdRef = useRef5(null);
  const contextTriggerRef = useRef5(null);
  useEffect9(() => {
    if (!contextMenuPos) return;
    const trigger = contextTriggerRef.current;
    if (!trigger) return;
    const evt = new MouseEvent("contextmenu", {
      clientX: contextMenuPos.x,
      clientY: contextMenuPos.y,
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2
    });
    trigger.dispatchEvent(evt);
  }, [contextMenuPos]);
  const handleReorderPick = useCallback2(
    (op) => {
      const id = contextNodeIdRef.current;
      if (!id || !onReorderNode) return;
      onReorderNode(id, op);
    },
    [onReorderNode]
  );
  const handleDeletePick = useCallback2(() => {
    const id = contextNodeIdRef.current;
    if (!id || !onDeleteNode) return;
    onDeleteNode(id);
  }, [onDeleteNode]);
  const handleCopyPick = useCallback2(() => {
    const id = contextNodeIdRef.current;
    if (!id || !onCopyNode) return;
    onCopyNode(id);
  }, [onCopyNode]);
  const handleChangeIconPick = useCallback2(() => {
    const id = contextNodeIdRef.current;
    if (!id || !onRequestIconReplace) return;
    onRequestIconReplace(id);
  }, [onRequestIconReplace]);
  const handleToggleLockPick = useCallback2(() => {
    if (!onToggleNodeLock) return;
    const single = contextNodeIdRef.current;
    const ids = single ? [single] : [...selectedNodeIds];
    if (ids.length === 0) return;
    onToggleNodeLock(ids);
  }, [onToggleNodeLock, selectedNodeIds]);
  const handleEndpointContextMenu = useCallback2(
    (connId, kind, pinned, clientX, clientY) => {
      if (!flagsRef.current.enableContextMenu) return;
      contextNodeIdRef.current = null;
      setContextOnNode(false);
      setContextNodeType(null);
      setContextEndpoint({ connectorId: connId, kind, pinned });
      setContextMenuPos({ x: clientX, y: clientY });
    },
    []
  );
  const handleUnpinPick = useCallback2(() => {
    const ep = contextEndpoint;
    if (!ep || !onUnpinEndpoint) return;
    onUnpinEndpoint(ep.connectorId, ep.kind);
  }, [contextEndpoint, onUnpinEndpoint]);
  const handlePastePick = useCallback2(() => {
    if (!onPasteAt) return;
    const pos = contextMenuPos;
    const rfInstance = rfInstanceRef.current;
    if (!pos || !rfInstance) return;
    const flowPos = rfInstance.screenToFlowPosition({ x: pos.x, y: pos.y });
    onPasteAt(flowPos);
  }, [contextMenuPos, onPasteAt]);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
  const copyShortcut = isMac ? "\u2318C" : "Ctrl+C";
  const pasteShortcut = isMac ? "\u2318V" : "Ctrl+V";
  const selectedNodeIdSet = useMemo2(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const lockedNodeIdSet = useMemo2(() => {
    const s = /* @__PURE__ */ new Set();
    for (const n of nodes) {
      if (n.data.locked === true) s.add(n.id);
    }
    return s;
  }, [nodes]);
  const selectedConnectorIdSet = useMemo2(
    () => new Set(selectedConnectorIds),
    [selectedConnectorIds]
  );
  const selectionOverlayNodes = useMemo2(() => {
    if (selectedNodeIds.length < 2) return [];
    const overrides = nodeOverrides;
    const overlayInputs = [];
    for (const id of selectedNodeIds) {
      const base = nodes.find((n) => n.id === id);
      if (!base) continue;
      const override = overrides?.[id];
      const oData = override?.data ?? {};
      const bData = base.data;
      overlayInputs.push({
        id,
        position: override?.position ?? base.position,
        data: {
          width: oData.width ?? bData.width,
          height: oData.height ?? bData.height,
          locked: oData.locked ?? bData.locked
        }
      });
    }
    return overlayInputs;
  }, [nodes, nodeOverrides, selectedNodeIds]);
  const selectedNodesForStyleStrip = selectedNodes ?? [];
  const sourceNodes = useMemo2(() => {
    const buildNode = (merged) => {
      const node = {
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
            if (!isEditMode) return void 0;
            if (merged.type === "shapeNode") {
              const shapeKind = merged.data.shape;
              if (shapeKind === "ellipse") return void 0;
            }
            return onNodeNameChange;
          })(),
          onDescriptionChange: (() => {
            if (!isEditMode) return void 0;
            if (merged.type === "shapeNode") {
              const shapeKind = merged.data.shape;
              return shapeKind === "rectangle" || shapeKind === "ellipse" || shapeKind === "sticky" ? onNodeDescriptionChange : void 0;
            }
            if (merged.type === "imageNode" || merged.type === "iconNode") return void 0;
            return onNodeDescriptionChange;
          })(),
          // US-015: inject autoEditOnMount on the freshly drop-popover-created
          // node so it opens in label-edit mode. The flag is consumed once at
          // mount by the node component (lazy useState initializer); leaving
          // it set on later renders is harmless.
          autoEditOnMount: pendingEditNodeId === merged.id ? true : void 0
        },
        selected: selectedNodeIdSet.has(merged.id)
      };
      if (merged.data.width !== void 0) node.width = merged.data.width;
      if (merged.data.height !== void 0) node.height = merged.data.height;
      if (!selectedNodeIdSet.has(merged.id)) node.connectable = false;
      if (merged.data.locked === true) node.draggable = false;
      return node;
    };
    const fromServer = nodes.map((n) => buildNode(mergeNodeOverride(n, nodeOverrides?.[n.id])));
    const serverIds = new Set(nodes.map((n) => n.id));
    const fromOverrides = [];
    if (nodeOverrides) {
      for (const [id, partial] of Object.entries(nodeOverrides)) {
        if (serverIds.has(id)) continue;
        const cand = partial;
        if (typeof cand.type !== "string" || !cand.position || !cand.data) continue;
        fromOverrides.push(buildNode({ ...cand, id }));
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
    isEditMode
  ]);
  const [rfNodes, setRfNodes] = useState14(sourceNodes);
  useEffect9(() => {
    if (draggingRef.current || resizingRef.current) return;
    setRfNodes(sourceNodes);
  }, [sourceNodes]);
  useEffect9(() => {
    rfNodesRef.current = rfNodes;
  }, [rfNodes]);
  const selectedIdSetRef = useRef5(selectedNodeIdSet);
  useEffect9(() => {
    selectedIdSetRef.current = selectedNodeIdSet;
  }, [selectedNodeIdSet]);
  const onSelectionChangeRef = useRef5(onSelectionChange);
  useEffect9(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);
  const selectedConnIdSetRef = useRef5(selectedConnectorIdSet);
  useEffect9(() => {
    selectedConnIdSetRef.current = selectedConnectorIdSet;
  }, [selectedConnectorIdSet]);
  const rfNodesRef = useRef5(sourceNodes);
  const marqueeActiveRef = useRef5(false);
  const marqueeSelectedNodeIdsRef = useRef5(/* @__PURE__ */ new Set());
  const marqueeSelectedEdgeIdsRef = useRef5(/* @__PURE__ */ new Set());
  const additiveBaseNodeIdsRef = useRef5(/* @__PURE__ */ new Set());
  const additiveBaseEdgeIdsRef = useRef5(/* @__PURE__ */ new Set());
  const tentativeAdditiveBaseRef = useRef5(null);
  const onNodesChange = useCallback2((changes) => {
    const activeAdditiveBase = marqueeActiveRef.current ? additiveBaseNodeIdsRef.current : tentativeAdditiveBaseRef.current?.shift ? tentativeAdditiveBaseRef.current.nodeIds : null;
    const filteredChanges = activeAdditiveBase && activeAdditiveBase.size > 0 ? changes.filter((c) => {
      if (c.type !== "select") return true;
      if (c.selected === false && activeAdditiveBase.has(c.id)) return false;
      return true;
    }) : changes;
    const explicitlyToggled = /* @__PURE__ */ new Set();
    for (const c of filteredChanges) {
      if (c.type === "select") explicitlyToggled.add(c.id);
    }
    const next = applyNodeChanges(filteredChanges, rfNodesRef.current);
    const pinned = selectedIdSetRef.current;
    const repinned = marqueeActiveRef.current ? next : pinned.size === 0 ? next : next.map((n) => {
      if (pinned.has(n.id) && !explicitlyToggled.has(n.id) && !n.selected) {
        return { ...n, selected: true };
      }
      return n;
    });
    rfNodesRef.current = repinned;
    setRfNodes(repinned);
    if (explicitlyToggled.size === 0) return;
    if (marqueeActiveRef.current) {
      for (const c of filteredChanges) {
        if (c.type !== "select") continue;
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
    selectedIdSetRef.current = new Set(sel);
    cb(sel, [...selectedConnIdSetRef.current]);
  }, []);
  const rfEdgesRef = useRef5([]);
  const onEdgesChange = useCallback2((changes) => {
    const activeAdditiveBase = marqueeActiveRef.current ? additiveBaseEdgeIdsRef.current : tentativeAdditiveBaseRef.current?.shift ? tentativeAdditiveBaseRef.current.edgeIds : null;
    const filteredChanges = activeAdditiveBase && activeAdditiveBase.size > 0 ? changes.filter((c) => {
      if (c.type !== "select") return true;
      if (c.selected === false && activeAdditiveBase.has(c.id)) return false;
      return true;
    }) : changes;
    const explicitlyToggled = /* @__PURE__ */ new Set();
    for (const c of filteredChanges) {
      if (c.type === "select") explicitlyToggled.add(c.id);
    }
    if (explicitlyToggled.size === 0) return;
    if (marqueeActiveRef.current) {
      for (const c of filteredChanges) {
        if (c.type !== "select") continue;
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
    selectedConnIdSetRef.current = new Set(sel);
    cb([...selectedIdSetRef.current], sel);
  }, []);
  const onSelectionStartCb = useCallback2((event) => {
    marqueeActiveRef.current = true;
    const tentative = tentativeAdditiveBaseRef.current;
    const additive = tentative?.shift ?? (event.shiftKey || event.metaKey || event.ctrlKey);
    additiveBaseNodeIdsRef.current = additive ? new Set(tentative?.nodeIds ?? selectedIdSetRef.current) : /* @__PURE__ */ new Set();
    additiveBaseEdgeIdsRef.current = additive ? new Set(tentative?.edgeIds ?? selectedConnIdSetRef.current) : /* @__PURE__ */ new Set();
    marqueeSelectedNodeIdsRef.current = new Set(additiveBaseNodeIdsRef.current);
    marqueeSelectedEdgeIdsRef.current = new Set(additiveBaseEdgeIdsRef.current);
  }, []);
  const onSelectionEndCb = useCallback2(() => {
    marqueeActiveRef.current = false;
    tentativeAdditiveBaseRef.current = null;
    const cb = onSelectionChangeRef.current;
    if (!cb) return;
    const finalNodeIds = [...marqueeSelectedNodeIdsRef.current];
    const finalNodeIdSet = new Set(finalNodeIds);
    const finalEdgeIds = new Set(marqueeSelectedEdgeIdsRef.current);
    for (const edge of rfEdgesRef.current) {
      if (finalNodeIdSet.has(edge.source) && finalNodeIdSet.has(edge.target)) {
        finalEdgeIds.add(edge.id);
      }
    }
    const prevNodeIds = selectedIdSetRef.current;
    const prevEdgeIds = selectedConnIdSetRef.current;
    const sameNodeSet = prevNodeIds.size === finalNodeIdSet.size && finalNodeIds.every((id) => prevNodeIds.has(id));
    const sameEdgeSet = prevEdgeIds.size === finalEdgeIds.size && [...finalEdgeIds].every((id) => prevEdgeIds.has(id));
    if (sameNodeSet && sameEdgeSet) return;
    selectedIdSetRef.current = new Set(finalNodeIds);
    selectedConnIdSetRef.current = new Set(finalEdgeIds);
    cb(finalNodeIds, [...finalEdgeIds]);
  }, []);
  const onWrapperPointerDownCapture = useCallback2((e) => {
    tentativeAdditiveBaseRef.current = null;
    if (drawShapeRef.current) return;
    if (e.button !== 0) return;
    const target = e.target;
    if (!target?.classList.contains("react-flow__pane")) return;
    tentativeAdditiveBaseRef.current = {
      shift: e.shiftKey || e.metaKey || e.ctrlKey,
      nodeIds: new Set(selectedIdSetRef.current),
      edgeIds: new Set(selectedConnIdSetRef.current)
    };
  }, []);
  const onWrapperContextMenuCapture = useCallback2((e) => {
    if (!flagsRef.current.enableContextMenu) return;
    const sel = selectedIdSetRef.current;
    if (sel.size < 2) return;
    const target = e.target;
    if (target === contextTriggerRef.current) return;
    if (target?.closest(".seeflow-connector-endpoint-dot")) return;
    e.preventDefault();
    e.stopPropagation();
    contextNodeIdRef.current = null;
    setContextOnNode(true);
    setContextNodeType(null);
    setContextEndpoint(null);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  }, []);
  const onWrapperDragOver = useCallback2(
    (e) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      const types = dt.types ? Array.from(dt.types) : [];
      const hasFiles = types.includes("Files");
      const hasHtmlBlock = types.includes(HTML_BLOCK_DND_TYPE);
      const acceptImage = hasFiles && !!onCreateImageFromFile && flags.enableImageDrop;
      const acceptHtmlBlock = hasHtmlBlock && !!onCreateHtmlNode && flags.enableDragDrop;
      if (!acceptImage && !acceptHtmlBlock) return;
      e.preventDefault();
      try {
        dt.dropEffect = "copy";
      } catch {
      }
    },
    [onCreateImageFromFile, onCreateHtmlNode, flags.enableImageDrop, flags.enableDragDrop]
  );
  const onWrapperDrop = useCallback2(
    (e) => {
      const dataTransfer = e.dataTransfer;
      const types = dataTransfer?.types ? Array.from(dataTransfer.types) : [];
      const isHtmlBlockDrop = types.includes(HTML_BLOCK_DND_TYPE);
      if (isHtmlBlockDrop && onCreateHtmlNode && flags.enableDragDrop) {
        e.preventDefault();
        const rfInstance = rfInstanceRef.current;
        if (!rfInstance) return;
        const flowPos = rfInstance.screenToFlowPosition({
          x: e.clientX,
          y: e.clientY
        });
        onCreateHtmlNode({ position: flowPos });
        return;
      }
      if (!onCreateImageFromFile || !flags.enableImageDrop) return;
      const clientPos = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      void handleCanvasFileDrop({
        dataTransfer,
        clientPos,
        rfInstance: rfInstanceRef.current,
        computeDims: computeImageDims,
        dispatch: onCreateImageFromFile
      });
    },
    [onCreateImageFromFile, onCreateHtmlNode, flags.enableImageDrop, flags.enableDragDrop]
  );
  const reconnectableEdges = !!onReconnectConnector;
  const onlySelectedConnectorId = selectedConnectorIdSet.size === 1 ? [...selectedConnectorIdSet][0] : null;
  const rfEdges = useMemo2(() => {
    const decorate = (c) => {
      const adjacentRunning = statusFor(runs, c.source) === "running" || statusFor(runs, c.target) === "running";
      const isSelected = selectedConnectorIdSet.has(c.id);
      const edge = connectorToEdge(c, adjacentRunning, isSelected);
      if (isSelected) edge.selected = true;
      const enableReconnect = reconnectableEdges && c.id === onlySelectedConnectorId;
      const next = enableReconnect ? { ...edge, reconnectable: true } : edge;
      return {
        ...next,
        data: {
          ...next.data,
          // US-027: view mode → suppress the inline label-edit handler so the
          // connector label renders read-only (EditableEdge gates on whether
          // this prop is wired).
          onLabelChange: isEditMode ? onConnectorLabelChange : void 0,
          reconnectable: enableReconnect,
          // US-018: stable callback (useCallback with empty deps) so the
          // memoized edge cache key doesn't churn.
          registerEditHandle
        }
      };
    };
    const serverIds = new Set(connectors.map((c) => c.id));
    const fromServer = connectors.map(
      (c) => decorate(mergeConnectorOverride(c, connectorOverrides?.[c.id]))
    );
    const fromOverrides = [];
    if (connectorOverrides) {
      for (const [id, partial] of Object.entries(connectorOverrides)) {
        if (serverIds.has(id)) continue;
        const candidate = partial;
        if (typeof candidate.source !== "string" || typeof candidate.target !== "string" || typeof candidate.kind !== "string") {
          continue;
        }
        fromOverrides.push(decorate({ ...candidate, id }));
      }
    }
    const all = [...fromServer, ...fromOverrides];
    const unselected = [];
    const selected = [];
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
    isEditMode
  ]);
  useEffect9(() => {
    rfEdgesRef.current = rfEdges;
  }, [rfEdges]);
  const internalTidy = useCallback2(() => {
    const inst = rfInstanceRef.current;
    const current = rfNodesRef.current;
    if (current.length < 2) return;
    const layoutNodes = current.map((n) => {
      const measured = inst?.getInternalNode(n.id)?.measured;
      const dataAny = n.data;
      const width = measured?.width ?? dataAny.width ?? 200;
      const height = measured?.height ?? dataAny.height ?? 120;
      return { id: n.id, width, height, position: n.position };
    });
    const layoutEdges = rfEdgesRef.current.map((e) => ({ source: e.source, target: e.target }));
    const next = applyLayout(layoutNodes, layoutEdges);
    let prevMinX = Number.POSITIVE_INFINITY;
    let prevMinY = Number.POSITIVE_INFINITY;
    let nextMinX = Number.POSITIVE_INFINITY;
    let nextMinY = Number.POSITIVE_INFINITY;
    for (const ln of layoutNodes) {
      if (ln.position.x < prevMinX) prevMinX = ln.position.x;
      if (ln.position.y < prevMinY) prevMinY = ln.position.y;
      const np = next.get(ln.id);
      if (!np) continue;
      if (np.x < nextMinX) nextMinX = np.x;
      if (np.y < nextMinY) nextMinY = np.y;
    }
    const offsetX = Number.isFinite(prevMinX) && Number.isFinite(nextMinX) ? prevMinX - nextMinX : 0;
    const offsetY = Number.isFinite(prevMinY) && Number.isFinite(nextMinY) ? prevMinY - nextMinY : 0;
    setRfNodes(
      (prev) => prev.map((n) => {
        const np = next.get(n.id);
        if (!np) return n;
        return { ...n, position: { x: np.x + offsetX, y: np.y + offsetY } };
      })
    );
  }, []);
  const effectiveTidy = onTidy ?? (!isEditMode ? internalTidy : void 0);
  const connectSucceededRef = useRef5(false);
  const connectStartRef = useRef5(
    null
  );
  const onConnect = useCallback2(
    (conn) => {
      if (!isEditMode) return;
      if (!onCreateConnector) return;
      const { source, target } = conn;
      if (!source || !target) return;
      if (source === target) return;
      connectSucceededRef.current = true;
      const dragStartNodeId = connectStartRef.current?.nodeId ?? null;
      const reversed = dragStartNodeId !== null && dragStartNodeId === target && dragStartNodeId !== source;
      const persistSource = reversed ? target : source;
      const persistTarget = reversed ? source : target;
      onCreateConnector(persistSource, persistTarget);
    },
    [onCreateConnector, isEditMode]
  );
  const isValidConnection = useCallback2((conn) => {
    const isTextShape = (id) => {
      if (!id) return false;
      const node = rfNodesRef.current.find((n) => n.id === id);
      if (!node) return false;
      return node.type === "shapeNode" && node.data.shape === "text";
    };
    return !isTextShape(conn.source) && !isTextShape(conn.target);
  }, []);
  const onConnectEndCb = useCallback2(
    (e, connectionState) => {
      setConnecting(false);
      clearConnectMarkers();
      const succeeded = connectSucceededRef.current;
      connectSucceededRef.current = false;
      if (succeeded) return;
      if (isReconnectingRef.current) return;
      if (connectCancelledRef.current) {
        connectCancelledRef.current = false;
        return;
      }
      if (!onCreateConnector) return;
      const fromNodeId = connectionState.fromNode?.id;
      const fromHandle = connectionState.fromHandle;
      if (!fromNodeId || !fromHandle) return;
      const cursor = cursorFromConnectEvent(e);
      if (!cursor) return;
      const targetEl = nodeElNearPoint(wrapperRef.current, cursor.clientX, cursor.clientY);
      if (!targetEl) return;
      const targetNodeId = targetEl.getAttribute("data-id");
      if (!targetNodeId || targetNodeId === fromNodeId) return;
      if (!isValidConnection({
        source: fromNodeId,
        target: targetNodeId,
        sourceHandle: null,
        targetHandle: null
      })) {
        return;
      }
      let targetPin;
      const rfInstance = rfInstanceRef.current;
      if (rfInstance) {
        const targetNode = rfInstance.getInternalNode(targetNodeId);
        if (targetNode) {
          const w = targetNode.measured.width ?? targetNode.width ?? 0;
          const h = targetNode.measured.height ?? targetNode.height ?? 0;
          if (w > 0 && h > 0) {
            const flow = rfInstance.screenToFlowPosition({
              x: cursor.clientX,
              y: cursor.clientY
            });
            targetPin = projectCursorToPerimeter(
              {
                x: targetNode.internals.positionAbsolute.x,
                y: targetNode.internals.positionAbsolute.y,
                w,
                h
              },
              flow
            );
          }
        }
      }
      onCreateConnector(fromNodeId, targetNodeId, targetPin ? { targetPin } : void 0);
    },
    [onCreateConnector, clearConnectMarkers, isValidConnection]
  );
  const reconnectSucceededRef = useRef5(false);
  const onReconnect = useCallback2(
    (oldEdge, newConnection) => {
      if (!onReconnectConnector) return;
      const { source, target, sourceHandle, targetHandle } = newConnection;
      if (!source || !target || source === target) return;
      const patch = {};
      if (source !== oldEdge.source) patch.source = source;
      if (target !== oldEdge.target) patch.target = target;
      if (typeof sourceHandle === "string" && sourceHandle !== oldEdge.sourceHandle) {
        patch.sourceHandle = sourceHandle;
      }
      if (typeof targetHandle === "string" && targetHandle !== oldEdge.targetHandle) {
        patch.targetHandle = targetHandle;
      }
      if (patch.source === void 0 && patch.target === void 0 && patch.sourceHandle === void 0 && patch.targetHandle === void 0) {
        return;
      }
      if (patch.source !== void 0 || patch.sourceHandle !== void 0) {
        patch.sourceHandleAutoPicked = false;
      }
      if (patch.target !== void 0 || patch.targetHandle !== void 0) {
        patch.targetHandleAutoPicked = false;
      }
      const rfInstance = rfInstanceRef.current;
      const onlyHandleChanged = patch.source === void 0 && patch.target === void 0;
      if (!onlyHandleChanged && rfInstance) {
        const movingSide = patch.source !== void 0 ? "source" : "target";
        const lockPin = computeUnmovedLockPin(
          movingSide,
          oldEdge.source,
          oldEdge.target,
          oldEdge.data,
          (id) => rfInstance.getInternalNode(id) ?? null
        );
        if (lockPin) {
          if (movingSide === "source") {
            patch.targetPin = lockPin;
          } else {
            patch.sourcePin = lockPin;
          }
        }
      }
      reconnectSucceededRef.current = true;
      onReconnectConnector(oldEdge.id, patch);
    },
    [onReconnectConnector]
  );
  const onReconnectEndCb = useCallback2(
    (e, oldEdge, handleType, connectionState) => {
      setConnecting(false);
      clearConnectMarkers();
      isReconnectingRef.current = false;
      const succeeded = reconnectSucceededRef.current;
      reconnectSucceededRef.current = false;
      if (succeeded) return;
      if (reconnectCancelledRef.current) {
        reconnectCancelledRef.current = false;
        return;
      }
      if (!onReconnectConnector) return;
      const cursor = cursorFromConnectEvent(e);
      let droppedNodeId = connectionState.toNode?.id ?? null;
      if (!droppedNodeId && cursor) {
        const nodeEl = nodeElNearPoint(wrapperRef.current, cursor.clientX, cursor.clientY);
        droppedNodeId = nodeEl?.getAttribute("data-id") ?? null;
      }
      const movingSide = handleType === "source" ? "target" : "source";
      const action = classifyReconnectBodyDrop(
        movingSide,
        oldEdge.source,
        oldEdge.target,
        droppedNodeId
      );
      if (action === "no-op" || action === "self-loop") return;
      if (!cursor) return;
      const rfInstance = rfInstanceRef.current;
      if (!rfInstance) return;
      const projectNodeId = action === "pin-own" ? movingSide === "source" ? oldEdge.source : oldEdge.target : droppedNodeId;
      const projectNode = rfInstance.getInternalNode(projectNodeId);
      if (!projectNode) return;
      const w = projectNode.measured.width ?? projectNode.width ?? 0;
      const h = projectNode.measured.height ?? projectNode.height ?? 0;
      if (w === 0 || h === 0) return;
      const flow = rfInstance.screenToFlowPosition({
        x: cursor.clientX,
        y: cursor.clientY
      });
      const pin = projectCursorToPerimeter(
        {
          x: projectNode.internals.positionAbsolute.x,
          y: projectNode.internals.positionAbsolute.y,
          w,
          h
        },
        flow
      );
      if (action === "pin-own") {
        if (!onPinEndpoint) return;
        onPinEndpoint(oldEdge.id, movingSide, pin);
        return;
      }
      const unmovedLockPin = computeUnmovedLockPin(
        movingSide,
        oldEdge.source,
        oldEdge.target,
        oldEdge.data,
        (id) => rfInstance.getInternalNode(id) ?? null
      );
      if (movingSide === "source") {
        onReconnectConnector(oldEdge.id, {
          source: droppedNodeId,
          sourceHandle: null,
          sourceHandleAutoPicked: false,
          sourcePin: pin,
          ...unmovedLockPin ? { targetPin: unmovedLockPin } : {}
        });
      } else {
        onReconnectConnector(oldEdge.id, {
          target: droppedNodeId,
          targetHandle: null,
          targetHandleAutoPicked: false,
          targetPin: pin,
          ...unmovedLockPin ? { sourcePin: unmovedLockPin } : {}
        });
      }
    },
    [onReconnectConnector, clearConnectMarkers, onPinEndpoint]
  );
  const ghostRect = useMemo2(() => {
    if (!drawStart || !drawCurrent) return null;
    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
    const offsetX = wrapperRect?.left ?? 0;
    const offsetY = wrapperRect?.top ?? 0;
    const minX = Math.min(drawStart.x, drawCurrent.x);
    const minY = Math.min(drawStart.y, drawCurrent.y);
    const w = Math.abs(drawCurrent.x - drawStart.x);
    const h = Math.abs(drawCurrent.y - drawStart.y);
    return { left: minX - offsetX, top: minY - offsetY, width: w, height: h };
  }, [drawStart, drawCurrent]);
  const ghostShapeClass = drawShape ? shapeChromeClass(drawShape) : "";
  const ghostShapeStyle = drawShape ? shapeChromeStyle(drawShape) : void 0;
  const ghostTextOutline = drawShape === "text";
  const [spaceHeld, setSpaceHeld] = useState14(false);
  const [spaceDragging, setSpaceDragging] = useState14(false);
  useEffect9(() => {
    if (!flags.enableKeyboard) return;
    const isEditable = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      return el instanceof HTMLElement && el.isContentEditable;
    };
    const onKeyDown = (e) => {
      if (e.code !== "Space") return;
      if (isEditable(document.activeElement)) return;
      e.preventDefault();
      setSpaceHeld(true);
    };
    const onKeyUp = (e) => {
      if (e.code !== "Space") return;
      setSpaceHeld(false);
      setSpaceDragging(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [flags.enableKeyboard]);
  const commitDraggedNodes = useCallback2(
    (draggedNodes) => {
      if (draggedNodes.length === 0) return;
      if (!isEditMode) return;
      if (draggedNodes.length === 1) {
        const moved = draggedNodes[0];
        if (moved && onNodePositionChange) {
          onNodePositionChange(moved.id, { x: moved.position.x, y: moved.position.y });
        }
        return;
      }
      if (onNodePositionsChange) {
        onNodePositionsChange(
          draggedNodes.map((n) => ({ id: n.id, position: { x: n.position.x, y: n.position.y } }))
        );
        return;
      }
      if (!onNodePositionChange) return;
      for (const moved of draggedNodes) {
        onNodePositionChange(moved.id, { x: moved.position.x, y: moved.position.y });
      }
    },
    [onNodePositionChange, onNodePositionsChange, isEditMode]
  );
  const onNodeDragStopCb = useCallback2(
    (_e, _node, draggedNodes) => {
      draggingRef.current = false;
      commitDraggedNodes(draggedNodes);
      flushPendingFit();
    },
    [commitDraggedNodes, flushPendingFit]
  );
  const onSelectionDragStartCb = useCallback2(() => {
    draggingRef.current = true;
  }, []);
  const onSelectionDragStopCb = useCallback2(
    (_e, draggedNodes) => {
      draggingRef.current = false;
      commitDraggedNodes(draggedNodes);
      flushPendingFit();
    },
    [commitDraggedNodes, flushPendingFit]
  );
  const handleNodeClickWithGroupGate = useCallback2(
    (_e, node) => {
      onNodeClick?.(node.id);
    },
    [onNodeClick]
  );
  const handlePaneClickWithGroupExit = useCallback2(
    (e) => {
      onPaneClick?.();
      void e;
    },
    [onPaneClick]
  );
  const handleEdgeClickWithGroupGate = useCallback2(
    (_e, edge) => {
      onConnectorClick?.(edge.id);
    },
    [onConnectorClick]
  );
  const wrapperCursor = drawShape ? "crosshair" : spaceHeld ? spaceDragging ? "grabbing" : "grab" : void 0;
  const sidebarNodeId = selectedNodeIds[0];
  const sidebarConnectorId = selectedConnectorIds[0];
  const sidebarNode = sidebarNodeId ? nodes.find((n) => n.id === sidebarNodeId) ?? null : null;
  const sidebarConnector = sidebarConnectorId ? connectors.find((c) => c.id === sidebarConnectorId) ?? null : null;
  const sidebarDemoId = projectId ?? null;
  const shouldRenderSidebar = flags.showDetailPanel && !disableSidebar;
  const iconRegistryValue = useMemo2(() => ({ custom: customIcons ?? {} }), [customIcons]);
  return /* @__PURE__ */ jsx37(IconRegistryProvider, { value: iconRegistryValue, children: /* @__PURE__ */ jsx37(
    "div",
    {
      "data-testid": "seeflow-canvas",
      ref: wrapperRef,
      className: "seeflow-canvas-root sf-relative sf-h-full sf-w-full",
      style: wrapperCursor ? { cursor: wrapperCursor } : void 0,
      onPointerDownCapture: onWrapperPointerDownCapture,
      onPointerDown: (e) => {
        if (spaceHeld) setSpaceDragging(true);
        onPointerDown(e);
      },
      onPointerMove,
      onPointerUp: (e) => {
        setSpaceDragging(false);
        onPointerUp(e);
      },
      onPointerCancel: () => {
        drawingRef.current = false;
        drawStartRef.current = null;
        drawCurrentRef.current = null;
        setDrawStart(null);
        setDrawCurrent(null);
        setSpaceDragging(false);
      },
      onContextMenuCapture: onWrapperContextMenuCapture,
      onDragOver: onWrapperDragOver,
      onDrop: onWrapperDrop,
      children: /* @__PURE__ */ jsxs24(CanvasPortalContainerProvider, { containerRef: wrapperRef, children: [
        /* @__PURE__ */ jsxs24(
          ReactFlow,
          {
            nodes: rfNodes,
            edges: rfEdges,
            onNodesChange,
            nodeTypes,
            edgeTypes,
            proOptions: { hideAttribution: true },
            fitView: true,
            minZoom: mode === "mini" ? 0.05 : 0.5,
            nodesDraggable: (isEditMode ? !!onNodePositionChange : true) && !drawShape && flags.enableNodeMove,
            nodesConnectable: isEditMode && !!onCreateConnector && !drawShape,
            deleteKeyCode: isEditMode ? ["Backspace", "Delete"] : null,
            zoomOnScroll: flags.enableZoom,
            zoomOnPinch: flags.enableZoom,
            className: connecting ? "seeflow-connecting" : void 0,
            onConnect: isEditMode ? onConnect : void 0,
            isValidConnection,
            onConnectStart: (_e, params) => {
              setConnecting(true);
              connectSucceededRef.current = false;
              connectStartRef.current = {
                nodeId: params.nodeId ?? null,
                handleType: params.handleType ?? null
              };
              setConnectSource(params.nodeId ?? null);
            },
            onConnectEnd: onConnectEndCb,
            onReconnect: isEditMode && onReconnectConnector ? onReconnect : void 0,
            onReconnectStart: (_e, edge, handleType) => {
              setConnecting(true);
              reconnectSucceededRef.current = false;
              isReconnectingRef.current = true;
              const anchoredNodeId = handleType === "source" ? edge.source : edge.target;
              setConnectSource(anchoredNodeId);
            },
            onReconnectEnd: onReconnectEndCb,
            connectionLineComponent,
            connectionLineStyle: { strokeWidth: 2 },
            connectionRadius: 32,
            reconnectRadius: 10,
            edgesReconnectable: false,
            elevateNodesOnSelect: false,
            elementsSelectable: !drawShape && flags.enableSelection,
            selectNodesOnDrag: false,
            nodeClickDistance: 5,
            selectionOnDrag: !drawShape && flags.enableSelection,
            panOnDrag: drawShape ? false : flags.enablePan ? [1, 2] : false,
            selectionMode: SelectionMode.Partial,
            selectionKeyCode: null,
            multiSelectionKeyCode: drawShape ? null : ["Meta", "Shift"],
            panActivationKeyCode: drawShape ? null : "Space",
            onSelectionStart: onSelectionStartCb,
            onSelectionEnd: onSelectionEndCb,
            defaultEdgeOptions: DEFAULT_EDGE_OPTIONS,
            zoomOnDoubleClick: false,
            onInit: (instance) => {
              rfInstanceRef.current = instance;
              const wrapper = wrapperRef.current;
              if (wrapper) wrapper.style.setProperty("--rf-zoom", String(instance.getZoom()));
              if (!didMountFitRef.current && resolvedAutoFitView.onMount && nodes.length > 0) {
                instance.fitView(FIT_VIEW_OPTIONS);
                didMountFitRef.current = true;
              }
              onRfInit?.(instance);
            },
            onMove: (_e, viewport) => {
              if (dropPopoverRef.current) setDropPopover(null);
              const wrapper = wrapperRef.current;
              if (wrapper) wrapper.style.setProperty("--rf-zoom", String(viewport.zoom));
            },
            onEdgesChange,
            onNodeDragStart: () => {
              draggingRef.current = true;
            },
            onNodeDragStop: onNodeDragStopCb,
            onSelectionDragStart: onSelectionDragStartCb,
            onSelectionDragStop: onSelectionDragStopCb,
            onNodeClick: handleNodeClickWithGroupGate,
            onEdgeClick: handleEdgeClickWithGroupGate,
            onEdgeDoubleClick: (_e, edge) => {
              editHandlesRef.current.get(edge.id)?.();
            },
            onPaneClick: handlePaneClickWithGroupExit,
            onNodeContextMenu: flags.enableContextMenu && contextEnabled ? (e, node) => {
              e.preventDefault();
              contextNodeIdRef.current = node.id;
              setContextOnNode(true);
              setContextNodeType(node.type ?? null);
              setContextEndpoint(null);
              setContextMenuPos({ x: e.clientX, y: e.clientY });
            } : void 0,
            onPaneContextMenu: flags.enableContextMenu && onPasteAt ? (e) => {
              e.preventDefault();
              contextNodeIdRef.current = null;
              setContextOnNode(false);
              setContextNodeType(null);
              setContextEndpoint(null);
              setContextMenuPos({ x: e.clientX, y: e.clientY });
            } : void 0,
            children: [
              /* @__PURE__ */ jsx37(StoreApiBridge, { storeApiRef }),
              /* @__PURE__ */ jsx37(ZoomBridge, { wrapperRef }),
              /* @__PURE__ */ jsx37(Background, { gap: 12, size: 0.6 }),
              flags.showControls ? /* @__PURE__ */ jsxs24(Controls, { showInteractive: false, showFitView: false, children: [
                /* @__PURE__ */ jsx37(
                  ControlButton,
                  {
                    "data-testid": "controls-fit-view",
                    "aria-label": "Fit view",
                    title: "Fit view",
                    disabled: nodes.length === 0,
                    onClick: () => {
                      rfInstanceRef.current?.fitView(FIT_VIEW_OPTIONS);
                    },
                    children: /* @__PURE__ */ jsx37(Maximize2, { className: "sf-h-3 sf-w-3", "aria-hidden": "true" })
                  }
                ),
                /* @__PURE__ */ jsx37(
                  ControlButton,
                  {
                    "data-testid": "controls-tidy",
                    "aria-label": "Tidy layout (\u2318\u21E7L)",
                    title: "Tidy layout (\u2318\u21E7L)",
                    disabled: !effectiveTidy,
                    onClick: () => effectiveTidy?.(),
                    children: /* @__PURE__ */ jsx37(LayoutDashboard, { className: "sf-h-3 sf-w-3", "aria-hidden": "true" })
                  }
                )
              ] }) : null,
              flags.showResizeHandles ? /* @__PURE__ */ jsx37(
                SelectionResizeOverlay,
                {
                  selectedNodes: selectionOverlayNodes,
                  onMultiResize
                }
              ) : null,
              flags.showToolbar && onCreateShapeNode || flags.showStyleStrip && onStyleNode && onStyleConnector ? /* @__PURE__ */ jsx37(Panel, { position: "top-left", children: /* @__PURE__ */ jsxs24("div", { className: "sf-flex sf-flex-col sf-gap-2", children: [
                flags.showToolbar && onCreateShapeNode ? /* @__PURE__ */ jsx37(
                  CanvasToolbar,
                  {
                    activeShape: drawShape,
                    onSelectShape: setDrawShape,
                    iconPickerOpen: iconPickerOpen ?? false,
                    onOpenIconPicker,
                    onCloseIconPicker,
                    onPickIcon
                  }
                ) : null,
                flags.showStyleStrip && onStyleNode && onStyleConnector ? /* @__PURE__ */ jsx37(
                  StyleStrip,
                  {
                    nodes: selectedNodesForStyleStrip,
                    connectors: selectedConnectors ?? [],
                    onStyleNode,
                    onStyleNodePreview,
                    onStyleNodes,
                    onStyleNodesPreview,
                    onStyleConnector,
                    onStyleConnectorPreview,
                    onRequestIconReplace
                  }
                ) : null
              ] }) }) : null
            ]
          }
        ),
        ghostRect ? /* @__PURE__ */ jsx37(
          "div",
          {
            "data-testid": "canvas-draw-ghost",
            "data-ghost-shape": drawShape ?? void 0,
            "aria-hidden": true,
            className: cn(
              "sf-pointer-events-none sf-absolute sf-z-10",
              ghostShapeClass,
              ghostTextOutline ? "sf-rounded-sm sf-border sf-border-dashed sf-border-muted-foreground/40" : ""
            ),
            style: {
              ...ghostShapeStyle,
              left: ghostRect.left,
              top: ghostRect.top,
              width: ghostRect.width,
              height: ghostRect.height
            },
            children: (() => {
              const GhostRenderer = drawShape ? ILLUSTRATIVE_SHAPE_RENDERERS[drawShape] : void 0;
              if (!GhostRenderer) return null;
              return /* @__PURE__ */ jsx37(
                GhostRenderer,
                {
                  width: ghostRect.width,
                  height: ghostRect.height,
                  borderColor: colorTokenStyle(void 0, "node").borderColor,
                  backgroundColor: NODE_DEFAULT_BG_WHITE,
                  borderSize: NEW_NODE_BORDER_WIDTH
                }
              );
            })()
          }
        ) : null,
        flags.enableContextMenu && contextEnabled ? /* @__PURE__ */ jsxs24(
          ContextMenu,
          {
            onOpenChange: (open) => {
              if (!open) {
                setContextMenuPos(null);
                contextNodeIdRef.current = null;
                setContextNodeType(null);
                setContextEndpoint(null);
              }
            },
            children: [
              /* @__PURE__ */ jsx37(ContextMenuTrigger, { asChild: true, children: /* @__PURE__ */ jsx37(
                "div",
                {
                  ref: contextTriggerRef,
                  "data-testid": "node-context-menu-trigger",
                  "aria-hidden": true,
                  className: "sf-pointer-events-none sf-fixed",
                  style: {
                    left: contextMenuPos?.x ?? 0,
                    top: contextMenuPos?.y ?? 0,
                    width: 0,
                    height: 0
                  }
                }
              ) }),
              /* @__PURE__ */ jsxs24(ContextMenuContent, { "data-testid": "node-context-menu", children: [
                contextEndpoint?.pinned && onUnpinEndpoint ? /* @__PURE__ */ jsx37(
                  ContextMenuItem,
                  {
                    "data-testid": "connector-endpoint-context-menu-unpin",
                    onSelect: handleUnpinPick,
                    children: "Unpin"
                  }
                ) : null,
                contextOnNode && onCopyNode ? /* @__PURE__ */ jsxs24(ContextMenuItem, { "data-testid": "node-context-menu-copy", onSelect: handleCopyPick, children: [
                  "Copy",
                  /* @__PURE__ */ jsx37(ContextMenuShortcut, { children: copyShortcut })
                ] }) : null,
                onPasteAt ? /* @__PURE__ */ jsxs24(
                  ContextMenuItem,
                  {
                    "data-testid": "node-context-menu-paste",
                    disabled: !hasClipboard,
                    onSelect: handlePastePick,
                    children: [
                      "Paste",
                      /* @__PURE__ */ jsx37(ContextMenuShortcut, { children: pasteShortcut })
                    ]
                  }
                ) : null,
                contextOnNode && (onCopyNode || onPasteAt) && (contextNodeType === "iconNode" && !!onRequestIconReplace || onReorderNode || onDeleteNode) ? /* @__PURE__ */ jsx37(ContextMenuSeparator, {}) : null,
                contextOnNode && contextNodeType === "iconNode" && onRequestIconReplace ? /* @__PURE__ */ jsx37(
                  ContextMenuItem,
                  {
                    "data-testid": "node-context-menu-change-icon",
                    onSelect: handleChangeIconPick,
                    children: "Change icon"
                  }
                ) : null,
                contextOnNode && contextNodeType === "iconNode" && onRequestIconReplace && (onReorderNode || onDeleteNode) ? /* @__PURE__ */ jsx37(ContextMenuSeparator, {}) : null,
                contextOnNode && onReorderNode ? /* @__PURE__ */ jsxs24(Fragment7, { children: [
                  /* @__PURE__ */ jsx37(
                    ContextMenuItem,
                    {
                      "data-testid": "node-context-menu-to-front",
                      onSelect: () => handleReorderPick({ op: "toFront" }),
                      children: "Bring to front"
                    }
                  ),
                  /* @__PURE__ */ jsx37(
                    ContextMenuItem,
                    {
                      "data-testid": "node-context-menu-forward",
                      onSelect: () => handleReorderPick({ op: "forward" }),
                      children: "Bring forward"
                    }
                  ),
                  /* @__PURE__ */ jsx37(
                    ContextMenuItem,
                    {
                      "data-testid": "node-context-menu-backward",
                      onSelect: () => handleReorderPick({ op: "backward" }),
                      children: "Send backward"
                    }
                  ),
                  /* @__PURE__ */ jsx37(
                    ContextMenuItem,
                    {
                      "data-testid": "node-context-menu-to-back",
                      onSelect: () => handleReorderPick({ op: "toBack" }),
                      children: "Send to back"
                    }
                  )
                ] }) : null,
                contextOnNode && onReorderNode && (onToggleNodeLock || onDeleteNode) ? /* @__PURE__ */ jsx37(ContextMenuSeparator, {}) : null,
                contextOnNode && onToggleNodeLock ? (() => {
                  const single = contextNodeIdRef.current;
                  const targetIds = single ? [single] : selectedNodeIds;
                  const label = targetIds.length > 0 && targetIds.every((id) => lockedNodeIdSet.has(id)) ? "Unlock" : "Lock";
                  return /* @__PURE__ */ jsx37(
                    ContextMenuItem,
                    {
                      "data-testid": "node-context-menu-toggle-lock",
                      onSelect: handleToggleLockPick,
                      disabled: targetIds.length === 0,
                      children: label
                    }
                  );
                })() : null,
                contextOnNode && onToggleNodeLock && onDeleteNode ? /* @__PURE__ */ jsx37(ContextMenuSeparator, {}) : null,
                contextOnNode && onDeleteNode ? /* @__PURE__ */ jsx37(
                  ContextMenuItem,
                  {
                    "data-testid": "node-context-menu-delete",
                    onSelect: handleDeletePick,
                    disabled: contextNodeIdRef.current ? lockedNodeIdSet.has(contextNodeIdRef.current) : false,
                    children: "Delete"
                  }
                ) : null
              ] })
            ]
          }
        ) : null,
        onCreateAndConnectFromPane ? /* @__PURE__ */ jsxs24(
          Popover,
          {
            open: !!dropPopover,
            onOpenChange: (open) => {
              if (!open) setDropPopover(null);
            },
            children: [
              /* @__PURE__ */ jsx37(PopoverAnchor, { asChild: true, children: /* @__PURE__ */ jsx37(
                "div",
                {
                  "data-testid": "drop-popover-anchor",
                  "aria-hidden": true,
                  className: "sf-pointer-events-none sf-fixed",
                  style: {
                    left: dropPopover?.clientX ?? 0,
                    top: dropPopover?.clientY ?? 0,
                    width: 0,
                    height: 0
                  }
                }
              ) }),
              /* @__PURE__ */ jsx37(
                PopoverContent,
                {
                  "data-testid": "drop-popover",
                  align: "start",
                  side: "bottom",
                  sideOffset: 4,
                  className: "sf-w-auto sf-p-1",
                  onOpenAutoFocus: (e) => {
                    e.preventDefault();
                  },
                  children: /* @__PURE__ */ jsx37(
                    "div",
                    {
                      role: "menu",
                      "aria-label": "Create connected node",
                      className: "sf-flex sf-flex-col sf-gap-0.5",
                      children: TOOLBAR_SHAPES.map(({ shape, label, Icon: Icon2 }) => /* @__PURE__ */ jsxs24(
                        "button",
                        {
                          type: "button",
                          role: "menuitem",
                          "data-testid": `drop-popover-shape-${shape}`,
                          onClick: () => {
                            const dp = dropPopover;
                            if (!dp) return;
                            onCreateAndConnectFromPane({
                              sourceNodeId: dp.sourceNodeId,
                              position: { x: dp.flowX, y: dp.flowY },
                              shape
                            });
                            setDropPopover(null);
                          },
                          className: cn(
                            "sf-flex sf-items-center sf-gap-2 sf-rounded-sm sf-px-2 sf-py-1.5 sf-text-left sf-text-sm",
                            "hover:sf-bg-accent hover:sf-text-accent-foreground",
                            "focus:sf-bg-accent focus:sf-text-accent-foreground focus:sf-outline-none"
                          ),
                          children: [
                            /* @__PURE__ */ jsx37(Icon2, { className: "sf-h-4 sf-w-4 sf-text-muted-foreground", "aria-hidden": "true" }),
                            /* @__PURE__ */ jsx37("span", { children: label })
                          ]
                        },
                        shape
                      ))
                    }
                  )
                }
              )
            ]
          }
        ) : null,
        shouldRenderSidebar ? /* @__PURE__ */ jsx37(
          DetailPanel,
          {
            demoId: sidebarDemoId,
            node: sidebarNode,
            connector: sidebarConnector,
            adapter: adapter ?? null,
            statusReport,
            onNameChange,
            onDescriptionChange,
            onDetailChange,
            onIconChange,
            onClose: () => {
              onSelectionChangeRef.current?.([], []);
            }
          }
        ) : null
      ] })
    }
  ) });
}
export {
  BG_FALLBACK,
  BORDER_FALLBACK,
  Button,
  COLOR_TOKENS,
  COMMANDS,
  CanvasToolbar,
  CloudShape,
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
  DEFAULT_STORAGE_PREFIX,
  DEFAULT_STROKE_WIDTH,
  DETAIL_PANEL_WIDTH_DEFAULT,
  DETAIL_PANEL_WIDTH_KEY,
  DETAIL_PANEL_WIDTH_MAX,
  DETAIL_PANEL_WIDTH_MIN,
  DatabaseShape,
  DetailPanel,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EditableEdge,
  EditableField,
  HTML_BLOCK_DND_TYPE,
  HTML_DEFAULT_SIZE,
  HtmlNode,
  HtmlNodeSection,
  ICON_DEFAULT_SIZE,
  ICON_FALLBACK_NAME,
  ICON_NAMES,
  ICON_RECENTS_STORAGE_KEY,
  ICON_REGISTRY,
  ILLUSTRATIVE_SHAPE_RENDERERS,
  IMAGE_DEFAULT_SIZE,
  IMAGE_DROP_EXTS,
  IMAGE_DROP_MAX_LONGEST_SIDE,
  IMAGE_DROP_SVG_FALLBACK,
  IS_MAC,
  Icon,
  IconNode,
  IconPickerBody,
  IconPickerPopover,
  IconRegistryProvider,
  IconToggleGroup,
  ImageNode,
  InlineEdit,
  LineDashedIcon,
  LineDottedIcon,
  LineSolidIcon,
  LockBadge,
  NEW_NODE_BORDER_WIDTH,
  NEW_NODE_FONT_SIZE,
  NODE_DEFAULT_BG_WHITE,
  PathCurveIcon,
  PathStepIcon,
  PlaceholderCard,
  PlayNode,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  QueueShape,
  ResizeControls,
  SELECTION_OVERLAY_PADDING,
  SHAPE_CLASS,
  SHAPE_DEFAULT_SIZE,
  SeeflowCanvas,
  SelectionResizeOverlay,
  ServerShape,
  ShapeNode,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
  Slider,
  StateNode,
  StatusBadge,
  StatusPill,
  StatusSection,
  StyleStrip,
  TOOLBAR_SHAPES,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  UserShape,
  applyLayout,
  applyNudge,
  buildIconInsertPayload,
  buildNewImageData,
  buildNewShapeData,
  buttonVariants,
  clampDetailPanelWidth,
  clampImageDims,
  classifyHandleDropFailure,
  classifyReconnectBodyDrop,
  cn,
  colorTokenStyle,
  computeIconInsertPosition,
  computeImageDims,
  computeNewRectFromAnchorDrag,
  computeSelectionResizeUpdates,
  computeUnionRect,
  computeUnmovedLockPin,
  connectorToEdge,
  createDebouncer,
  createRestAdapter,
  dashFor,
  endpointFromPin,
  endpointToPin,
  eventTargetIsOtherNode,
  extractImageFile,
  fileUrl,
  filterIcons,
  formatRelativeTime,
  formatShortcut,
  getCommandTooltip,
  getLastUsedStyle,
  getNodeIntersection,
  getNudgeDelta,
  getRecents,
  getStoredDetailPanelWidth,
  getZoomChord,
  handleCanvasFileDrop,
  handleClipboardShortcut,
  isAcceptableImageFile,
  projectCursorToPerimeter,
  pushRecent,
  rememberConnectorStyle,
  rememberNodeStyle,
  resolveClipboardChord,
  resolveEdgeEndpoints,
  resolveFlags,
  resolveToolShortcut,
  scaleNodesWithinRect,
  scheduleRaf,
  selectionEligibleForOverlay,
  setStoredDetailPanelWidth,
  shapeChromeClass,
  shapeChromeStyle,
  startResizeGesture,
  styleForKind,
  useIconRegistry,
  useResizeGesture
};
//# sourceMappingURL=index.js.map