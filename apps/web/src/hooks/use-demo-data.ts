import { type FlowDetail, fetchFlowDetail } from '@/lib/api';
import { useCallback, useEffect, useState } from 'react';

export interface UseDemoDataResult {
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

export const useDemoData = (id: string | null): UseDemoDataResult => {
  const [detail, setDetail] = useState<FlowDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(id !== null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!id) return;
    setLoading(true);
    fetchFlowDetail(id)
      .then((data) => {
        setDetail(data);
        setError(null);
      })
      .catch((err) => {
        console.error('[useDemoData] failed', err);
        setError(String(err));
      })
      .finally(() => setLoading(false));
  }, [id]);

  const applyDetail = useCallback((next: FlowDetail) => {
    setDetail(next);
    setError(null);
  }, []);

  useEffect(() => {
    if (!id) {
      setDetail(null);
      setLoading(false);
      return;
    }
    refresh();
  }, [id, refresh]);

  return { detail, loading, error, refresh, applyDetail };
};
