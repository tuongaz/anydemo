import { type ProjectFlowSummary, fetchProjectFlows } from '@/lib/api';
import { useCallback, useEffect, useState } from 'react';

export interface UseProjectFlowsResult {
  flows: ProjectFlowSummary[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * US-024: lazy fetch of `GET /api/projects/:project/flows`. Re-fetches when
 * `project` changes; passing `null` parks the hook in a not-loading idle
 * state so the canvas page can mount the switcher before the URL params
 * resolve.
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

  return { flows, loading, error, refresh };
};
