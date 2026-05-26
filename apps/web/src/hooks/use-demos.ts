import { type FlowSummary, fetchFlows } from '@/lib/api';
import { useCallback, useEffect, useState } from 'react';

export interface UseDemosResult {
  demos: FlowSummary[] | null;
  error: string | null;
  refresh: () => Promise<void>;
}

export const useDemos = (): UseDemosResult => {
  const [demos, setDemos] = useState<FlowSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback((): Promise<void> => {
    return fetchFlows()
      .then((list) => {
        setDemos(list);
        setError(null);
      })
      .catch((err) => {
        console.error('[useDemos] failed', err);
        setDemos([]);
        setError(String(err));
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { demos, error, refresh };
};
