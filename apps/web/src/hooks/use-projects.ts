import { type ProjectSummary, deleteProject, fetchProjects } from '@/lib/api';
import { useCallback, useEffect, useState } from 'react';

export interface UnregisterProjectOpts {
  /** When true, also rm-rf the project's repoPath on disk. */
  deleteSource?: boolean;
}

export interface UseProjectsResult {
  projects: ProjectSummary[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /**
   * Atomic project unregister via `DELETE /api/projects/:project`. The
   * per-flow DELETE can't be looped because the studio's last-flow and
   * default-flow-no-replacement guards reject the final entry — the
   * dedicated endpoint clears all registry entries in one shot. When
   * `opts.deleteSource` is set, the studio also rm-rf's the repoPath
   * after the registry is cleaned.
   */
  unregisterProject: (projectSlug: string, opts?: UnregisterProjectOpts) => Promise<void>;
}

/**
 * US-036: source the project switcher from `GET /api/projects` so a multi-flow
 * project surfaces as one row, not one row per flow. Mirrors the
 * useProjectFlows / useDemos shape: idle when `loading`, populated list
 * otherwise, `refresh()` to re-fetch, plus an `unregisterProject` mutation
 * that calls the project-level DELETE endpoint.
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
    async (projectSlug: string, opts?: UnregisterProjectOpts): Promise<void> => {
      await deleteProject(projectSlug, opts);
      await refresh();
    },
    [refresh],
  );

  return { projects, loading, error, refresh, unregisterProject };
};
