// Shared canvas types — single source of truth lives in @seeflow/canvas.
// App-specific extensions (transient upload state, runtime API types) are
// defined below and re-exported alongside the shared types.
import type { ImageNodeData as BaseImageNodeData, Flow } from '@seeflow/canvas';

export type {
  ColorToken,
  Connector,
  ConnectorBase,
  ConnectorDirection,
  ConnectorPath,
  ConnectorStyle,
  DefaultConnector,
  Flow,
  FlowNode,
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
  StatusReport,
  StatusReportState,
} from '@seeflow/canvas';

export interface FlowSummary {
  id: string;
  slug: string;
  name: string;
  repoPath: string;
  lastModified: number;
  valid: boolean;
}

// US-008: extends the shared ImageNodeData with transient upload-state flags.
// These fields are never serialized to disk — they live only in the in-memory
// nodeOverrides map and are cleared before the canvas adapter's createNode is
// called.
export interface ImageNodeData extends BaseImageNodeData {
  _uploading?: boolean;
  _uploadError?: string;
}

export interface FlowDetail {
  id: string;
  slug: string;
  name: string;
  filePath: string;
  flow: Flow | null;
  valid: boolean;
  error: string | null;
}

export const fetchFlows = async (): Promise<FlowSummary[]> => {
  const res = await fetch('/api/flows');
  if (!res.ok) throw new Error(`GET /api/flows failed: ${res.status}`);
  return (await res.json()) as FlowSummary[];
};

export const fetchFlowDetail = async (id: string): Promise<FlowDetail> => {
  const res = await fetch(`/api/flows/${id}`);
  if (!res.ok) throw new Error(`GET /api/flows/${id} failed: ${res.status}`);
  return (await res.json()) as FlowDetail;
};

export interface PlayResult {
  runId: string;
  status?: number;
  body?: unknown;
  error?: string;
}

export interface CreateProjectBody {
  name: string;
}

export interface CreateProjectResult {
  id: string;
  slug: string;
  scaffolded: boolean;
}

export const deleteFlow = async (id: string): Promise<{ ok: true }> => {
  const res = await fetch(`/api/flows/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(errorBody?.error ?? `DELETE /api/flows/${id} → ${res.status}`);
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

export interface RestartFlowResult {
  ok: true;
  calledResetAction: boolean;
}

export const restartFlow = async (flowId: string): Promise<RestartFlowResult> => {
  const res = await fetch(`/api/flows/${flowId}/reset`, {
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
    throw new Error(errorBody?.error ?? `POST /api/flows/${flowId}/reset → ${res.status}`);
  }
  return (await res.json()) as RestartFlowResult;
};

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

export const playNode = async (flowId: string, nodeId: string): Promise<PlayResult> => {
  const res = await fetch(`/api/flows/${flowId}/play/${nodeId}`, {
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
    throw new Error(errorBody?.error ?? `POST /api/flows/${flowId}/play/${nodeId} → ${res.status}`);
  }
  return (await res.json()) as PlayResult;
};
