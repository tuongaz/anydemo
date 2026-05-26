import {
  type CreateFlowBody,
  type MutateFlowResult,
  type PatchFlowBody,
  type ProjectFlowSummary,
  createFlow,
  deleteFlow,
  fetchProjectFlows,
  updateFlow,
} from '@/lib/api';
import { useCallback, useEffect, useState } from 'react';

export interface UseProjectFlowsResult {
  flows: ProjectFlowSummary[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /**
   * US-025: POST /api/projects/:project/flows. Resolves with the new FlowEntry
   * and re-fetches the list so the popover reflects the addition.
   */
  createFlow: (body: CreateFlowBody) => Promise<MutateFlowResult>;
  /**
   * US-025: PATCH /api/projects/:project/flows/:flow. Used by the rename
   * dialog; the caller is responsible for navigating to the new URL when the
   * id changes (the hook deliberately doesn't pull `navigate` in — keeps it
   * test-friendly).
   */
  renameFlow: (flowSlug: string, body: PatchFlowBody) => Promise<MutateFlowResult>;
  /**
   * US-025: DELETE /api/projects/:project/flows/:flow. Passes
   * ?newDefault=<other> when the target is the project default. The studio
   * enforces the rest of the guards (last-flow, invalid-new-default, etc.).
   */
  deleteFlow: (flowSlug: string, opts?: { newDefault?: string }) => Promise<{ ok: true }>;
}

/**
 * US-024 / US-025: per-project flow list + mutation surface for the Figma
 * popover. `flows`/`loading`/`error`/`refresh` are the read path (US-024).
 * `createFlow`/`renameFlow`/`deleteFlow` are the mutation path (US-025) and
 * each refreshes the local cache on success so the popover stays in sync
 * without forcing the caller to call `refresh()` manually.
 *
 * Passing `null` for `project` parks the hook in an idle state — no fetch,
 * `flows: null`, `loading: false` — and the mutation functions reject with
 * `no-project` so callers don't have to null-check before binding handlers.
 */
export const useProjectFlows = (project: string | null): UseProjectFlowsResult => {
  const enabled = project !== null;
  const [flows, setFlows] = useState<ProjectFlowSummary[] | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!project) return;
    setLoading(true);
    fetchProjectFlows(project)
      .then((list) => {
        setFlows(list);
        setError(null);
      })
      .catch((err) => {
        console.error('[useProjectFlows] failed', err);
        setFlows([]);
        setError(String(err));
      })
      .finally(() => setLoading(false));
  }, [project]);

  useEffect(() => {
    if (!project) {
      setFlows(null);
      setLoading(false);
      return;
    }
    refresh();
  }, [project, refresh]);

  const create = useCallback(
    async (body: CreateFlowBody): Promise<MutateFlowResult> => {
      if (!project) throw new Error('no-project');
      const result = await createFlow(project, body);
      refresh();
      return result;
    },
    [project, refresh],
  );

  const rename = useCallback(
    async (flowSlug: string, body: PatchFlowBody): Promise<MutateFlowResult> => {
      if (!project) throw new Error('no-project');
      const result = await updateFlow(project, flowSlug, body);
      refresh();
      return result;
    },
    [project, refresh],
  );

  const remove = useCallback(
    async (flowSlug: string, opts?: { newDefault?: string }): Promise<{ ok: true }> => {
      if (!project) throw new Error('no-project');
      const result = await deleteFlow(project, flowSlug, opts);
      refresh();
      return result;
    },
    [project, refresh],
  );

  return {
    flows,
    loading,
    error,
    refresh,
    createFlow: create,
    renameFlow: rename,
    deleteFlow: remove,
  };
};
