// Shared canvas types — single source of truth lives in @seeflow/canvas.
// App-specific extensions (transient upload state, runtime API types) are
// defined below and re-exported alongside the shared types.
import type {
  ImageNodeData as BaseImageNodeData,
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
  NodeData,
  NodeDescription,
  NodeVisual,
  QueueConnector,
  ShapeKind,
  ShapeNodeData,
} from '@seeflow/canvas';

export type {
  ColorToken,
  NodeVisual,
  NodeDescription,
  NodeData,
  HttpAction,
  ShapeKind,
  ShapeNodeData,
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
} from '@seeflow/canvas';

export interface DemoSummary {
  id: string;
  slug: string;
  name: string;
  repoPath: string;
  lastModified: number;
  valid: boolean;
}

// Mirror of `StatusReportSchema` in apps/studio/src/schema.ts. One record per
// `node:status` SSE frame; the studio's StatusRunner parses each non-empty
// stdout line from a statusAction script via `StatusReportSchema.safeParse`
// before broadcasting. Keep this in lockstep with the studio schema.
export type StatusReportState = 'ok' | 'warn' | 'error' | 'pending';

export interface StatusReport {
  state: StatusReportState;
  summary?: string;
  detail?: string;
  data?: Record<string, unknown>;
  ts?: number;
}

// US-008: extends the shared ImageNodeData with transient upload-state flags.
// These fields are never serialized to disk — they live only in the in-memory
// nodeOverrides map and are cleared before createNode is called.
export interface ImageNodeData extends BaseImageNodeData {
  _uploading?: boolean;
  _uploadError?: string;
}

export interface DemoDetail {
  id: string;
  slug: string;
  name: string;
  filePath: string;
  demo: Demo | null;
  valid: boolean;
  error: string | null;
}

export const fetchDemos = async (): Promise<DemoSummary[]> => {
  const res = await fetch('/api/demos');
  if (!res.ok) throw new Error(`GET /api/demos failed: ${res.status}`);
  return (await res.json()) as DemoSummary[];
};

export const fetchDemoDetail = async (id: string): Promise<DemoDetail> => {
  const res = await fetch(`/api/demos/${id}`);
  if (!res.ok) throw new Error(`GET /api/demos/${id} failed: ${res.status}`);
  return (await res.json()) as DemoDetail;
};

export interface PlayResult {
  runId: string;
  status?: number;
  body?: unknown;
  error?: string;
}

export interface UpdatePositionResult {
  ok: boolean;
  position: { x: number; y: number };
}

export const updateNodePosition = async (
  demoId: string,
  nodeId: string,
  position: { x: number; y: number },
): Promise<UpdatePositionResult> => {
  const res = await fetch(`/api/demos/${demoId}/nodes/${nodeId}/position`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(position),
  });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(
      errorBody?.error ?? `PATCH /api/demos/${demoId}/nodes/${nodeId}/position → ${res.status}`,
    );
  }
  return (await res.json()) as UpdatePositionResult;
};

export interface UpdateNodeBody {
  position?: { x: number; y: number };
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
  /** iconNode-only: kebab-case Lucide icon name. Lands at data.icon. */
  icon?: string;
  /** US-019: lock state. true freezes the node; false unlocks. */
  locked?: boolean;
  /** Short body text rendered on the canvas and as light-bold in the sidebar.
   * Lands at data.description. Empty string clears the field on disk. */
  description?: string;
  /** Long-form sidebar-only body text. Lands at data.detail. Empty string
   * clears the field on disk. */
  detail?: string;
}

export const updateNode = async (
  demoId: string,
  nodeId: string,
  patch: UpdateNodeBody,
): Promise<{ ok: true }> => {
  const res = await fetch(`/api/demos/${demoId}/nodes/${nodeId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(
      errorBody?.error ?? `PATCH /api/demos/${demoId}/nodes/${nodeId} → ${res.status}`,
    );
  }
  return (await res.json()) as { ok: true };
};

export interface UpdateConnectorBody {
  label?: string;
  style?: ConnectorStyle;
  color?: ColorToken;
  direction?: ConnectorDirection;
  borderSize?: number;
  path?: ConnectorPath;
  /** US-018: per-connector label font size in px. */
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
  /**
   * Reconnect: pin the source endpoint to a specific source handle. `null`
   * (US-025) clears the field on disk — used by reconnect-to-body to drop a
   * previously-pinned handle id when the endpoint flips back to floating.
   */
  sourceHandle?: string | null;
  /** Reconnect: pin the target endpoint to a specific target handle. `null` clears. */
  targetHandle?: string | null;
  /**
   * US-025: `true`/absent means "render floating" against the line through
   * the two node centers; `false` means "render pinned to the stored handle
   * id". (Pre-US-025: `true` meant "rerouter-managed".)
   */
  sourceHandleAutoPicked?: boolean;
  /** US-025: same as sourceHandleAutoPicked but for the target endpoint. */
  targetHandleAutoPicked?: boolean;
  /**
   * US-007: pin the source endpoint at `(side, t)` along the source node's
   * perimeter. `null` (wire-format) clears any stored pin so the endpoint
   * reverts to floating/handle-pinned behavior; `undefined` leaves the field
   * untouched.
   */
  sourcePin?: EdgePin | null;
  /** US-007: same as sourcePin but for the target endpoint. */
  targetPin?: EdgePin | null;
}

export const updateConnector = async (
  demoId: string,
  connId: string,
  patch: UpdateConnectorBody,
): Promise<{ ok: true }> => {
  const res = await fetch(`/api/demos/${demoId}/connectors/${connId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(
      errorBody?.error ?? `PATCH /api/demos/${demoId}/connectors/${connId} → ${res.status}`,
    );
  }
  return (await res.json()) as { ok: true };
};

export interface CreateNodeBody {
  id?: string;
  type: 'playNode' | 'stateNode' | 'shapeNode' | 'imageNode' | 'iconNode' | 'htmlNode';
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export const createNode = async (
  demoId: string,
  node: CreateNodeBody,
): Promise<{ ok: true; id: string; node: Record<string, unknown> }> => {
  const res = await fetch(`/api/demos/${demoId}/nodes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(node),
  });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(errorBody?.error ?? `POST /api/demos/${demoId}/nodes → ${res.status}`);
  }
  return (await res.json()) as { ok: true; id: string; node: Record<string, unknown> };
};

export interface CreateConnectorBody {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  sourceHandleAutoPicked?: boolean;
  targetHandleAutoPicked?: boolean;
  // Per-endpoint perimeter pin. When set, the connector's endpoint is
  // anchored at `(side, t)` on the connected node's bbox. Used when a
  // create-from-body-drop fallback projects the cursor onto the target
  // node's perimeter (user rule: "cursor over node → closest perimeter
  // point and use that").
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

export const createConnector = async (
  demoId: string,
  body: CreateConnectorBody,
): Promise<{ ok: true; id: string }> => {
  const res = await fetch(`/api/demos/${demoId}/connectors`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(errorBody?.error ?? `POST /api/demos/${demoId}/connectors → ${res.status}`);
  }
  return (await res.json()) as { ok: true; id: string };
};

export type ReorderOp =
  | { op: 'forward' }
  | { op: 'backward' }
  | { op: 'toFront' }
  | { op: 'toBack' }
  | { op: 'toIndex'; index: number };

export const reorderNode = async (
  demoId: string,
  nodeId: string,
  body: ReorderOp,
): Promise<{ ok: true }> => {
  const res = await fetch(`/api/demos/${demoId}/nodes/${nodeId}/order`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(
      errorBody?.error ?? `PATCH /api/demos/${demoId}/nodes/${nodeId}/order → ${res.status}`,
    );
  }
  return (await res.json()) as { ok: true };
};

export const deleteNode = async (demoId: string, nodeId: string): Promise<{ ok: true }> => {
  const res = await fetch(`/api/demos/${demoId}/nodes/${nodeId}`, { method: 'DELETE' });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(
      errorBody?.error ?? `DELETE /api/demos/${demoId}/nodes/${nodeId} → ${res.status}`,
    );
  }
  return (await res.json()) as { ok: true };
};

export const deleteConnector = async (demoId: string, connId: string): Promise<{ ok: true }> => {
  const res = await fetch(`/api/demos/${demoId}/connectors/${connId}`, { method: 'DELETE' });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(
      errorBody?.error ?? `DELETE /api/demos/${demoId}/connectors/${connId} → ${res.status}`,
    );
  }
  return (await res.json()) as { ok: true };
};

export interface CreateProjectBody {
  name: string;
}

export interface CreateProjectResult {
  id: string;
  slug: string;
  scaffolded: boolean;
}

export const deleteDemo = async (id: string): Promise<{ ok: true }> => {
  const res = await fetch(`/api/demos/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(errorBody?.error ?? `DELETE /api/demos/${id} → ${res.status}`);
  }
  return (await res.json()) as { ok: true };
};

export const createProject = async (body: CreateProjectBody): Promise<CreateProjectResult> => {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(errorBody?.error ?? `POST /api/projects → ${res.status}`);
  }
  return (await res.json()) as CreateProjectResult;
};

export interface RestartDemoResult {
  ok: true;
  calledResetAction: boolean;
}

export const restartDemo = async (demoId: string): Promise<RestartDemoResult> => {
  const res = await fetch(`/api/demos/${demoId}/reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(errorBody?.error ?? `POST /api/demos/${demoId}/reset → ${res.status}`);
  }
  return (await res.json()) as RestartDemoResult;
};

export interface UploadImageResult {
  path: string;
}

/**
 * US-018: response shape for the two project-file shell-out endpoints
 * (`/files/open` and `/files/reveal`). The backend always returns the
 * resolved absolute path so the frontend can copy-to-clipboard when the
 * spawn failed or `$EDITOR` is unset — both success and soft-fail include
 * `absPath`. `ok: false` is NOT thrown; the helper resolves with the
 * envelope so the caller can branch on the fallback.
 */
export interface FileActionResult {
  ok: boolean;
  absPath: string;
  error?: string;
}

const requestFileAction = async (
  projectId: string,
  action: 'open' | 'reveal',
  path: string,
): Promise<FileActionResult> => {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  // 200 OK with `ok: false` is the spawn-failure / EDITOR-unset fallback —
  // resolve so the caller can show the clipboard-copy affordance. 404 is the
  // file-missing soft-fail which also includes `absPath`; resolve as
  // `{ ok: false }` so the UI can surface the same fallback. Anything else
  // (400 traversal/absolute reject, 404 unknown project, 500) throws.
  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // ignore
  }
  if (res.ok) {
    return {
      ok: body?.ok === true,
      absPath: typeof body?.absPath === 'string' ? body.absPath : '',
      error: typeof body?.error === 'string' ? body.error : undefined,
    };
  }
  if (res.status === 404 && typeof body?.absPath === 'string') {
    return {
      ok: false,
      absPath: body.absPath,
      error: typeof body?.error === 'string' ? body.error : 'file not found',
    };
  }
  const errMsg = typeof body?.error === 'string' ? body.error : undefined;
  throw new Error(errMsg ?? `POST /api/projects/${projectId}/files/${action} → ${res.status}`);
};

/**
 * US-018: ask the backend to open the given project-scoped file in `$EDITOR`.
 * Always resolves with the absolute path so the caller can copy-to-clipboard
 * on the fallback case (ok:false). Throws only on transport / path-validation
 * errors.
 */
export const openProjectFile = async (projectId: string, path: string): Promise<FileActionResult> =>
  requestFileAction(projectId, 'open', path);

/**
 * US-018: ask the backend to reveal the given project-scoped file in the OS
 * file manager (Finder on macOS, Explorer on Windows, xdg-open on Linux).
 * Same fallback shape as `openProjectFile`.
 */
export const revealProjectFile = async (
  projectId: string,
  path: string,
): Promise<FileActionResult> => requestFileAction(projectId, 'reveal', path);

/**
 * US-008: POST a single image File to the project's upload endpoint (US-007).
 * `filename` overrides the File's own `.name` for the server-side slugging.
 * The browser sets the multipart boundary automatically — never pass an
 * explicit `content-type` header.
 */
export const uploadImageFile = async (
  projectId: string,
  file: File,
  filename: string,
): Promise<UploadImageResult> => {
  const form = new FormData();
  form.append('file', file);
  form.append('filename', filename);
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files/upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(
      errorBody?.error ?? `POST /api/projects/${projectId}/files/upload → ${res.status}`,
    );
  }
  return (await res.json()) as UploadImageResult;
};

export const playNode = async (demoId: string, nodeId: string): Promise<PlayResult> => {
  const res = await fetch(`/api/demos/${demoId}/play/${nodeId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(errorBody?.error ?? `POST /api/demos/${demoId}/play/${nodeId} → ${res.status}`);
  }
  return (await res.json()) as PlayResult;
};
