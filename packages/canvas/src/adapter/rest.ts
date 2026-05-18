// REST implementation of CanvasAdapter. Mirrors the canonical studio endpoints
// so embedders that don't override `fetch` get the same wire-level behavior as
// the in-app studio (POST/PATCH/DELETE on /api/demos/:demoId/{nodes,connectors}
// + POST /api/projects/:demoId/files/upload). The error shape (JSON body with
// optional `error` field, falling back to a `METHOD URL → status` string) lets
// embedder rollback paths use a single catch handler.

import type {
  CanvasAdapter,
  ConnectorCreateInput,
  ConnectorPatch,
  NodeCreateInput,
  NodePatch,
  PlayNodeResult,
  ReorderOp,
  UpdateNodePositionResult,
  UploadImageResult,
} from './types.ts';

export interface RestAdapterOptions {
  /** URL prefix (e.g. '' in-studio, 'https://example.com' for cross-origin). */
  baseUrl: string;
  /** demoId (== projectId in the studio registry). Bound for the adapter's lifetime. */
  demoId: string;
  /** Optional fetch override — primarily for tests. Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
}

const requestJson = async <T>(
  fetchImpl: typeof fetch,
  method: string,
  url: string,
  body?: unknown,
): Promise<T> => {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
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
  const { baseUrl, demoId } = options;
  const fetchImpl: typeof fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const demoBase = `${baseUrl}/api/demos/${demoId}`;

  return {
    async createNode(input: NodeCreateInput) {
      const data = await requestJson<{ ok: true; id: string; node: Record<string, unknown> }>(
        fetchImpl,
        'POST',
        `${demoBase}/nodes`,
        input,
      );
      return { id: data.id, node: data.node };
    },

    async updateNode(nodeId: string, patch: NodePatch): Promise<void> {
      await requestJson<{ ok: true }>(fetchImpl, 'PATCH', `${demoBase}/nodes/${nodeId}`, patch);
    },

    async updateNodePosition(
      nodeId: string,
      position: { x: number; y: number },
    ): Promise<UpdateNodePositionResult> {
      return await requestJson<UpdateNodePositionResult>(
        fetchImpl,
        'PATCH',
        `${demoBase}/nodes/${nodeId}/position`,
        position,
      );
    },

    async deleteNode(nodeId: string): Promise<void> {
      await requestJson<{ ok: true }>(fetchImpl, 'DELETE', `${demoBase}/nodes/${nodeId}`);
    },

    async reorderNode(nodeId: string, op: ReorderOp): Promise<void> {
      await requestJson<{ ok: true }>(fetchImpl, 'PATCH', `${demoBase}/nodes/${nodeId}/order`, op);
    },

    async createConnector(input: ConnectorCreateInput) {
      const data = await requestJson<{ ok: true; id: string }>(
        fetchImpl,
        'POST',
        `${demoBase}/connectors`,
        input,
      );
      return { id: data.id };
    },

    async updateConnector(connectorId: string, patch: ConnectorPatch): Promise<void> {
      await requestJson<{ ok: true }>(
        fetchImpl,
        'PATCH',
        `${demoBase}/connectors/${connectorId}`,
        patch,
      );
    },

    async deleteConnector(connectorId: string): Promise<void> {
      await requestJson<{ ok: true }>(fetchImpl, 'DELETE', `${demoBase}/connectors/${connectorId}`);
    },

    async uploadImage(file: File, filename: string): Promise<UploadImageResult> {
      const form = new FormData();
      form.append('file', file);
      form.append('filename', filename);
      // Browser sets the multipart boundary automatically — never pass an
      // explicit `content-type` header (matches `uploadImageFile` in api.ts).
      const url = `${baseUrl}/api/projects/${encodeURIComponent(demoId)}/files/upload`;
      const res = await fetchImpl(url, { method: 'POST', body: form });
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

    async playNode(nodeId: string): Promise<PlayNodeResult> {
      return await requestJson<PlayNodeResult>(fetchImpl, 'POST', `${demoBase}/play/${nodeId}`, {});
    },

    async openFile(path: string): Promise<void> {
      await requestJson<unknown>(
        fetchImpl,
        'POST',
        `${baseUrl}/api/projects/${encodeURIComponent(demoId)}/files/open`,
        { path },
      );
    },

    async revealFile(path: string): Promise<void> {
      await requestJson<unknown>(
        fetchImpl,
        'POST',
        `${baseUrl}/api/projects/${encodeURIComponent(demoId)}/files/reveal`,
        { path },
      );
    },
  };
};
