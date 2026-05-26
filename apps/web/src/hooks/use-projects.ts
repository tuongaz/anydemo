import { type ProjectSummary, deleteFlow, fetchProjectFlows, fetchProjects } from '@/lib/api';
import { useCallback, useEffect, useState } from 'react';

export interface UseProjectsResult {
  projects: ProjectSummary[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /**
   * US-036: cascade-delete every flow in a project so the project disappears
   * from the registry. Fetches the project's flows then issues per-flow
   * DELETEs; when the project default is one of the entries, it is dropped
   * last with `?newDefault=__cascade__` skipped (no replacement needed because
   * the whole project is being removed — the studio's `last-flow` guard
   * intentionally requires the last DELETE to be the default).
   *
   * The implementation orders deletes as: non-default flows first, default
   * last. The final DELETE hits the singleton flow and so does not need
   * `?newDefault`; the studio's `last-flow` guard returns 409 only when there
   * are more entries still to come.
   */
  unregisterProject: (projectSlug: string) => Promise<void>;
}

/**
 * US-036: source the project switcher from `GET /api/projects` so a multi-flow
 * project surfaces as one row, not one row per flow. Mirrors the
 * useProjectFlows / useDemos shape: idle when `loading`, populated list
 * otherwise, `refresh()` to re-fetch, plus a cascade `unregisterProject`
 * mutation that loops the per-flow DELETE endpoint until the project is gone.
 */
export const useProjects = (): UseProjectsResult => {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback((): Promise<void> => {
    setLoading(true);
    return fetchProjects()
      .then((list) => {
        setProjects(list);
        setError(null);
      })
      .catch((err) => {
        console.error('[useProjects] failed', err);
        setProjects([]);
        setError(String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const unregisterProject = useCallback(
    async (projectSlug: string): Promise<void> => {
      const flows = await fetchProjectFlows(projectSlug);
      // Order: non-default flows first, default last. The studio rejects a
      // DELETE on the project default while siblings still exist; by the time
      // we hit the default it is the only entry, so the guard lets it through.
      const ordered = [...flows].sort((a, b) =>
        a.isDefault === b.isDefault ? 0 : a.isDefault ? 1 : -1,
      );
      for (const flow of ordered) {
        await deleteFlow(projectSlug, flow.flowSlug);
      }
      await refresh();
    },
    [refresh],
  );

  return { projects, loading, error, refresh, unregisterProject };
};
