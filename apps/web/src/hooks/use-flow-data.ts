import { type FlowDetail, fetchFlowDetail } from '@/lib/api';
import { useCallback, useEffect, useState } from 'react';

export interface UseFlowDataResult {
  detail: FlowDetail | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /**
   * Push a freshly received detail into state without a GET. Wired to the
   * SSE `flow:reload` handler so mutation echoes apply the new snapshot
   * directly — the watcher already broadcast the validated state, so a
   * follow-up fetch would just duplicate that work.
   */
  applyDetail: (next: FlowDetail) => void;
}

export const useFlowData = (project: string | null, flow: string | null): UseFlowDataResult => {
  const enabled = project !== null && flow !== null;
  const [detail, setDetail] = useState<FlowDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!project || !flow) return;
    setLoading(true);
    fetchFlowDetail(project, flow)
      .then((data) => {
        setDetail(data);
        setError(null);
      })
      .catch((err) => {
        console.error('[useFlowData] failed', err);
        setError(String(err));
      })
      .finally(() => setLoading(false));
  }, [project, flow]);

  const applyDetail = useCallback((next: FlowDetail) => {
    setDetail(next);
    setError(null);
  }, []);

  useEffect(() => {
    if (!project || !flow) {
      setDetail(null);
      setLoading(false);
      return;
    }
    refresh();
  }, [project, flow, refresh]);

  return { detail, loading, error, refresh, applyDetail };
};
