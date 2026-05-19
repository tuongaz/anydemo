import { type FlowDetail, fetchFlowDetail } from '@/lib/api';
import { useCallback, useEffect, useState } from 'react';

export interface UseDemoDataResult {
  detail: FlowDetail | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
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

  useEffect(() => {
    if (!id) {
      setDetail(null);
      setLoading(false);
      return;
    }
    refresh();
  }, [id, refresh]);

  return { detail, loading, error, refresh };
};
