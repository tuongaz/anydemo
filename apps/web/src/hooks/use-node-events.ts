import { useCallback, useEffect, useReducer, useRef } from 'react';

export type NodeEventStatus = 'running' | 'done' | 'error';

export interface NodeEventLogEntry {
  status: NodeEventStatus;
  ts: number;
  runId?: string;
}

export type NodeEventLog = Record<string, NodeEventLogEntry[]>;

const HISTORY_LIMIT = 5;

const TYPE_TO_STATUS: Record<string, NodeEventStatus | undefined> = {
  'node:running': 'running',
  'node:done': 'done',
  'node:error': 'error',
};

type Action = { type: 'append'; entry: NodeEventLogEntry; nodeId: string } | { type: 'reset' };

const reducer = (state: NodeEventLog, action: Action): NodeEventLog => {
  if (action.type === 'reset') return {};
  const prev = state[action.nodeId] ?? [];
  const next = [action.entry, ...prev].slice(0, HISTORY_LIMIT);
  return { ...state, [action.nodeId]: next };
};

export interface NodeEventInput {
  type: string;
  ts?: number;
  [key: string]: unknown;
}

export interface UseNodeEventsResult {
  events: NodeEventLog;
  /** Apply a single SSE event. Non-`node:*` events are ignored. */
  apply: (event: NodeEventInput) => void;
  reset: () => void;
}

/**
 * Per-node ring buffer (last 5 events) keyed by nodeId. Driven by `node:*`
 * SSE events. Used by the detail panel's "Recent events" list.
 */
export const useNodeEvents = (flowId: string | null): UseNodeEventsResult => {
  const [events, dispatch] = useReducer(reducer, {} as NodeEventLog);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  // biome-ignore lint/correctness/useExhaustiveDependencies: flowId is the trigger; effect body intentionally doesn't reference it.
  useEffect(() => {
    dispatchRef.current({ type: 'reset' });
  }, [flowId]);

  const apply = useCallback((event: NodeEventInput) => {
    const status = TYPE_TO_STATUS[event.type];
    if (!status) return;
    const nodeId = typeof event.nodeId === 'string' ? event.nodeId : null;
    if (!nodeId) return;
    const runId = typeof event.runId === 'string' ? event.runId : undefined;
    const ts = typeof event.ts === 'number' ? event.ts : Date.now();
    dispatchRef.current({ type: 'append', nodeId, entry: { status, ts, runId } });
  }, []);

  const reset = useCallback(() => {
    dispatchRef.current({ type: 'reset' });
  }, []);

  return { events, apply, reset };
};
