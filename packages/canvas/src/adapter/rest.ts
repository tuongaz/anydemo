// REST implementation of CanvasAdapter. Mirrors the canonical studio endpoints
// so embedders that don't override `fetch` get the same wire-level behavior as
// the in-app studio (POST/PATCH/DELETE on /api/flows/:flowId/{nodes,connectors}
// + POST /api/projects/:flowId/nodes/:nodeId/files/upload). The error shape
// (JSON body with optional `error` field, falling back to a `METHOD URL →
// status` string) lets embedder rollback paths use a single catch handler.

import type {
  CanvasAdapter,
  ConnectorCreateInput,
  ConnectorPatch,
  LayoutEdgeInput,
  LayoutNodeInput,
  LayoutResult,
  NodeCreateInput,
  NodePatch,
  PlayActionResult,
  ReorderOp,
  UpdateNodePositionResult,
  UploadImageResult,
} from './types.ts';

export interface RestAdapterOptions {
  /** URL prefix (e.g. '' in-studio, 'https://example.com' for cross-origin). */
  baseUrl: string;
  /** flowId (== projectId in the studio registry). Bound for the adapter's lifetime. */
  flowId: string;
  /** Optional fetch override — primarily for tests. Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /**
   * Optional extra headers attached to every request the adapter issues. Used
   * by cross-origin embedders (e.g. the MCP App iframe in Claude Desktop) to
   * forward a per-process auth token via `X-Seeflow-Token`. Merged into both
   * JSON requests (`content-type` set by the adapter) and the multipart
   * upload (where the browser sets the boundary).
   */
  headers?: Record<string, string>;
}

const requestJson = async <T>(
  fetchImpl: typeof fetch,
  method: string,
  url: string,
  extraHeaders: Record<string, string> | undefined,
  body?: unknown,
): Promise<T> => {
  const init: RequestInit = { method };
  const headers: Record<string, string> = { ...(extraHeaders ?? {}) };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (Object.keys(headers).length > 0) {
    init.headers = headers;
  }
  const res = await fetchImpl(url, init);
  if (!res.ok) {
    let errorBody: { error?: string } | null = null;
    try {
      errorBody = (await res.json()) as { error?: string };
    } catch {
      // ignore
    }
    throw new Error(errorBody?.error ?? `${method} ${url} → ${res.status}`);
  }
  return (await res.json()) as T;
};

export const createRestAdapter = (options: RestAdapterOptions): CanvasAdapter => {
  const { baseUrl, flowId } = options;
  const fetchImpl: typeof fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const headers = options.headers;
  const demoBase = `${baseUrl}/api/flows/${flowId}`;

  return {
    async createNode(input: NodeCreateInput) {
      const data = await requestJson<{ ok: true; id: string; node: Record<string, unknown> }>(
        fetchImpl,
        'POST',
        `${demoBase}/nodes`,
        headers,
        input,
      );
      return { id: data.id, node: data.node };
    },

    async updateNode(nodeId: string, patch: NodePatch): Promise<void> {
      await requestJson<{ ok: true }>(
        fetchImpl,
        'PATCH',
        `${demoBase}/nodes/${nodeId}`,
        headers,
        patch,
      );
    },

    async updateNodePosition(
      nodeId: string,
      position: { x: number; y: number },
    ): Promise<UpdateNodePositionResult> {
      return await requestJson<UpdateNodePositionResult>(
        fetchImpl,
        'PATCH',
        `${demoBase}/nodes/${nodeId}/position`,
        headers,
        position,
      );
    },

    async deleteNode(nodeId: string): Promise<void> {
      await requestJson<{ ok: true }>(fetchImpl, 'DELETE', `${demoBase}/nodes/${nodeId}`, headers);
    },

    async reorderNode(nodeId: string, op: ReorderOp): Promise<void> {
      await requestJson<{ ok: true }>(
        fetchImpl,
        'PATCH',
        `${demoBase}/nodes/${nodeId}/order`,
        headers,
        op,
      );
    },

    async createConnector(input: ConnectorCreateInput) {
      const data = await requestJson<{ ok: true; id: string }>(
        fetchImpl,
        'POST',
        `${demoBase}/connectors`,
        headers,
        input,
      );
      return { id: data.id };
    },

    async updateConnector(connectorId: string, patch: ConnectorPatch): Promise<void> {
      await requestJson<{ ok: true }>(
        fetchImpl,
        'PATCH',
        `${demoBase}/connectors/${connectorId}`,
        headers,
        patch,
      );
    },

    async deleteConnector(connectorId: string): Promise<void> {
      await requestJson<{ ok: true }>(
        fetchImpl,
        'DELETE',
        `${demoBase}/connectors/${connectorId}`,
        headers,
      );
    },

    async uploadImage(nodeId: string, file: File, filename: string): Promise<UploadImageResult> {
      const form = new FormData();
      form.append('file', file);
      form.append('filename', filename);
      // Browser sets the multipart boundary automatically — never pass an
      // explicit `content-type` header. Scoped to the node so the per-node
      // folder convention (and delete_node cascade) covers the upload too.
      const url = `${baseUrl}/api/projects/${encodeURIComponent(
        flowId,
      )}/nodes/${encodeURIComponent(nodeId)}/files/upload`;
      const init: RequestInit = { method: 'POST', body: form };
      if (headers) init.headers = { ...headers };
      const res = await fetchImpl(url, init);
      if (!res.ok) {
        let errorBody: { error?: string } | null = null;
        try {
          errorBody = (await res.json()) as { error?: string };
        } catch {
          // ignore
        }
        throw new Error(errorBody?.error ?? `POST ${url} → ${res.status}`);
      }
      return (await res.json()) as UploadImageResult;
    },

    async playAction(nodeId: string): Promise<PlayActionResult> {
      return await requestJson<PlayActionResult>(
        fetchImpl,
        'POST',
        `${demoBase}/play/${nodeId}`,
        headers,
        {},
      );
    },

    async openFile(path: string): Promise<void> {
      await requestJson<unknown>(
        fetchImpl,
        'POST',
        `${baseUrl}/api/projects/${encodeURIComponent(flowId)}/files/open`,
        headers,
        { path },
      );
    },

    async revealFile(path: string): Promise<void> {
      await requestJson<unknown>(
        fetchImpl,
        'POST',
        `${baseUrl}/api/projects/${encodeURIComponent(flowId)}/files/reveal`,
        headers,
        { path },
      );
    },

    async computeLayout(
      nodes: readonly LayoutNodeInput[],
      edges: readonly LayoutEdgeInput[],
    ): Promise<LayoutResult> {
      const res = await requestJson<{
        ok: true;
        nodes: LayoutResult['nodes'];
        connectors: LayoutResult['connectors'];
      }>(fetchImpl, 'POST', `${baseUrl}/api/layout`, headers, { nodes, edges });
      return { nodes: res.nodes, connectors: res.connectors };
    },
  };
};
