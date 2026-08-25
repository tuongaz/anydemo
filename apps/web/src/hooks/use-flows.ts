import { type FlowSummary, fetchFlows } from '@/lib/api';
import { useCallback, useEffect, useState } from 'react';

export interface UseFlowsResult {
  flows: FlowSummary[] | null;
  error: string | null;
  refresh: () => Promise<void>;
}

export const useFlows = (): UseFlowsResult => {
  const [flows, setFlows] = useState<FlowSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback((): Promise<void> => {
    return fetchFlows()
      .then((list) => {
        setFlows(list);
        setError(null);
      })
      .catch((err) => {
        console.error('[useFlows] failed', err);
        setFlows([]);
        setError(String(err));
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { flows, error, refresh };
};
