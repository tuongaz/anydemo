import { apiEventStream } from '@/lib/sse-client';
import { useEffect, useRef, useState } from 'react';

export interface UseRegistryEventsOptions {
  /**
   * Fires whenever the studio detects an external write to the registry —
   * e.g. when the CLI calls `seeflow register` in another terminal. Use this
   * to refresh the flow list.
   */
  onRegistryReload?: () => void;
  /**
   * Fires on the initial `hello` event and on every reconnect. Useful as a
   * catch-up trigger for changes that might have happened during a disconnect.
   */
  onHello?: () => void;
}

export interface UseRegistryEventsResult {
  connected: boolean;
}

/**
 * Subscribes to /api/registry/events. The connection lasts the lifetime of
 * the SPA — there is no flowId scoping; the channel is global.
 */
export const useRegistryEvents = (
  options: UseRegistryEventsOptions = {},
): UseRegistryEventsResult => {
  const [connected, setConnected] = useState(false);
  const { onRegistryReload, onHello } = options;

  const onRegistryReloadRef = useRef(onRegistryReload);
  const onHelloRef = useRef(onHello);
  useEffect(() => {
    onRegistryReloadRef.current = onRegistryReload;
    onHelloRef.current = onHello;
  }, [onRegistryReload, onHello]);

  useEffect(() => {
    const source = apiEventStream('/api/registry/events');

    source.addEventListener('open', () => setConnected(true));
    source.addEventListener('error', () => setConnected(false));

    source.addEventListener('hello', () => {
      onHelloRef.current?.();
    });

    source.addEventListener('registry:reload', () => {
      onRegistryReloadRef.current?.();
    });

    return () => {
      source.close();
    };
  }, []);

  return { connected };
};
