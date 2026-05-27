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
  Flow,
  FlowNode,
  EdgePin,
  EdgePinSide,
  GeometricNodeData,
  GeometricNodeType,
  HtmlNodeData,
  IconNodeData,
  NodeCapabilities,
  NodeDescription,
  NodeSemanticBase,
  NodeType,
  NodeVisual,
  ScriptAction,
  StateSource,
  StatusAction,
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

/**
 * US-024: per-project flow listing returned by `GET /api/projects/:project/flows`.
 * Matches the on-the-wire response shape and the `FlowSwitcherEntry` type used
 * by the FlowSwitcher popover (apps/web/src/components/flow-switcher.tsx).
 */
export interface ProjectFlowSummary {
  id: string;
  flowSlug: string;
  name: string;
  icon?: string;
  isDefault: boolean;
}

/**
 * US-036: project-tier listing returned by `GET /api/projects`. One row per
 * project (deduped from registry.list() by `projectSlug` server-side) powers
 * the top-right project switcher so a multi-flow project appears once, not
 * once per flow.
 */
export interface ProjectSummary {
  projectSlug: string;
  name: string;
  description?: string;
  defaultFlow: string;
  flowCount: number;
  repoPath?: string;
}

export const fetchProjects = async (): Promise<ProjectSummary[]> => {
  const res = await fetch('/api/projects');
  if (!res.ok) throw new Error(`GET /api/projects failed: ${res.status}`);
  const body = (await res.json()) as { projects: ProjectSummary[] };
  return body.projects;
};

export const fetchProjectFlows = async (project: string): Promise<ProjectFlowSummary[]> => {
  const url = `/api/projects/${encodeURIComponent(project)}/flows`;
  const res = await fetch(url);
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(errorBody?.error ?? `GET ${url} → ${res.status}`);
  }
  const body = (await res.json()) as { flows: ProjectFlowSummary[] };
  return body.flows;
};

// US-010: each flow-scoped builder accepts the (project, flow) slug pair and
// composes the new nested API URL. The studio resolves the pair to a
// `FlowEntry` server-side via `resolveProjectFlow` (US-006).
const flowApiBase = (project: string, flow: string): string =>
  `/api/projects/${encodeURIComponent(project)}/flows/${encodeURIComponent(flow)}`;

export const fetchFlowDetail = async (project: string, flow: string): Promise<FlowDetail> => {
  const url = flowApiBase(project, flow);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return (await res.json()) as FlowDetail;
};

export interface PlayResult {
  runId: string;
  status?: number;
  body?: unknown;
  error?: string;
}

export interface CreateProjectBody {
  path: string;
  name: string;
  description?: string;
}

export interface CreateProjectResult {
  id: string;
  slug: string;
}

export const deleteFlow = async (
  project: string,
  flow: string,
  opts?: { newDefault?: string },
): Promise<{ ok: true }> => {
  const base = flowApiBase(project, flow);
  const url =
    opts?.newDefault !== undefined
      ? `${base}?newDefault=${encodeURIComponent(opts.newDefault)}`
      : base;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(errorBody?.error ?? `DELETE ${url} → ${res.status}`);
  }
  return (await res.json()) as { ok: true };
};

/**
 * US-025: POST /api/projects/:project/flows — create a new flow within an
 * existing project. The body matches the schema enforced by the studio
 * (CreateFlowBodySchema in apps/studio/src/api.ts) so the client-side
 * validation in the create dialog must mirror FlowIdPattern.
 */
export interface CreateFlowBody {
  id: string;
  name: string;
  icon?: string;
}

/**
 * US-025: PATCH /api/projects/:project/flows/:flow — at least one of the
 * three fields must be set; the dialog enforces that before invoking.
 */
export interface PatchFlowBody {
  id?: string;
  name?: string;
  icon?: string;
}

/**
 * US-025: returned by POST and PATCH — matches the FlowEntry registry shape
 * the studio echoes (registry.upsert result). Only the fields the switcher
 * needs are typed here; everything else is best-effort optional.
 */
export interface MutateFlowResult {
  id: string;
  projectSlug: string;
  flowSlug: string;
  name: string;
  icon?: string;
  isDefault: boolean;
}

const throwApiError = async (res: Response, fallback: string): Promise<never> => {
  let errorBody: { error?: string } | null = null;
  try {
    errorBody = (await res.json()) as { error?: string };
  } catch {
    // ignore
  }
  throw new Error(errorBody?.error ?? fallback);
};

export const createFlow = async (
  project: string,
  body: CreateFlowBody,
): Promise<MutateFlowResult> => {
  const url = `/api/projects/${encodeURIComponent(project)}/flows`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    await throwApiError(res, `POST ${url} → ${res.status}`);
  }
  return (await res.json()) as MutateFlowResult;
};

export const updateFlow = async (
  project: string,
  flow: string,
  body: PatchFlowBody,
): Promise<MutateFlowResult> => {
  const url = flowApiBase(project, flow);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    await throwApiError(res, `PATCH ${url} → ${res.status}`);
  }
  return (await res.json()) as MutateFlowResult;
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

export const playFlowNode = async (
  project: string,
  flow: string,
  nodeId: string,
): Promise<PlayResult> => {
  const url = `${flowApiBase(project, flow)}/play/${encodeURIComponent(nodeId)}`;
  const res = await fetch(url, {
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
    throw new Error(errorBody?.error ?? `POST ${url} → ${res.status}`);
  }
  return (await res.json()) as PlayResult;
};
