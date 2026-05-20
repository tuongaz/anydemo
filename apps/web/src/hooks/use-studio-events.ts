import type { Flow } from '@seeflow/canvas';
import { useEffect, useRef, useState } from 'react';

export type StudioEventType =
  | 'flow:reload'
  | 'node:running'
  | 'node:done'
  | 'node:error'
  | 'node:status';

export interface StudioEvent {
  type: StudioEventType;
  ts: number;
  valid?: boolean;
  error?: string;
  /** Other payload data passed through. */
  [key: string]: unknown;
}

/**
 * Parsed payload carried by every `flow:reload` SSE event. The server emits
 * the full validated snapshot inline so the client can apply it without a
 * follow-up GET — see `apps/studio/src/watcher.ts:broadcastReload`.
 */
export type FlowReloadPayload = { valid: true; flow: Flow } | { valid: false; error: string };

export interface UseStudioEventsOptions {
  /**
   * Catch-up signal. Fires on the initial `hello` event and on every
   * reconnect. Use this to refetch the flow detail + demos list — anything
   * that might have gone stale during a disconnect window.
   */
  onHello?: () => void;
  /**
   * Fires on every `flow:reload` event. The payload is the new snapshot —
   * apply it directly to state instead of triggering a refetch. On
   * malformed/empty payloads the callback is skipped (e.g. the legacy
   * layout-endpoint path that emits an empty payload).
   */
  onFlowReload?: (payload: FlowReloadPayload) => void;
  /** All node:* events flow through here, unchanged from the original API. */
  onEvent?: (event: StudioEvent) => void;
}

export interface UseStudioEventsResult {
  connected: boolean;
}

/**
 * Subscribes to /api/events?flowId=:id. Splits the legacy `onReload` signal
 * into a catch-up trigger (`onHello`) and a snapshot-push trigger
 * (`onFlowReload`) so steady-state mutations don't force a GET round trip.
 */
export const useStudioEvents = (
  flowId: string | null,
  options: UseStudioEventsOptions = {},
): UseStudioEventsResult => {
  const [connected, setConnected] = useState(false);
  const { onHello, onFlowReload, onEvent } = options;

  // Mirror the callbacks into refs so the EventSource setup effect can read
  // the latest closure without listing them in its dep array. Without this,
  // every callback identity change (e.g. when applyDetail updates `detail`,
  // which is captured by onFlowReload's closure) would close + reopen the
  // EventSource, fire a fresh hello, trigger a refetch, update detail, and
  // loop. Only flowId belongs in the effect's deps.
  const onHelloRef = useRef(onHello);
  const onFlowReloadRef = useRef(onFlowReload);
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onHelloRef.current = onHello;
    onFlowReloadRef.current = onFlowReload;
    onEventRef.current = onEvent;
  }, [onHello, onFlowReload, onEvent]);

  useEffect(() => {
    if (!flowId) {
      setConnected(false);
      return;
    }

    const url = `/api/events?flowId=${encodeURIComponent(flowId)}`;
    const source = new EventSource(url);

    source.addEventListener('open', () => setConnected(true));
    source.addEventListener('error', () => setConnected(false));

    source.addEventListener('hello', () => {
      onHelloRef.current?.();
    });

    source.addEventListener('flow:reload', (e) => {
      const event = parsePayload(e, 'flow:reload');
      onEventRef.current?.(event);
      const payload = toFlowReloadPayload(event);
      if (payload) onFlowReloadRef.current?.(payload);
    });

    for (const type of ['node:running', 'node:done', 'node:error', 'node:status'] as const) {
      source.addEventListener(type, (e) => {
        onEventRef.current?.(parsePayload(e, type));
      });
    }

    return () => {
      source.close();
    };
  }, [flowId]);

  return { connected };
};

const parsePayload = (e: MessageEvent, type: StudioEventType): StudioEvent => {
  try {
    const parsed = JSON.parse(e.data) as Record<string, unknown>;
    return { type, ts: Date.now(), ...parsed };
  } catch {
    return { type, ts: Date.now() };
  }
};

/**
 * Narrow the raw SSE event into a typed FlowReloadPayload. The legacy
 * layout endpoint can emit `{ payload: {} }` — that's neither valid:true nor
 * valid:false, so we return null and the caller skips applying. Exported so
 * unit tests can exercise the boundary without spinning up an EventSource.
 */
export const toFlowReloadPayload = (event: StudioEvent): FlowReloadPayload | null => {
  if (event.valid === true && event.flow && typeof event.flow === 'object') {
    return { valid: true, flow: event.flow as Flow };
  }
  if (event.valid === false && typeof event.error === 'string') {
    return { valid: false, error: event.error };
  }
  return null;
};
