import type { StatusReport } from '@/lib/api';
import { useCallback, useEffect, useReducer, useRef } from 'react';

/** Latest StatusReport per node, with the SSE-arrival ts always populated. */
export type NodeStatuses = Record<string, StatusReport & { ts: number }>;

export interface NodeStatusEvent {
  /** Any SSE event type — non-`node:status` events are ignored. */
  type: string;
  ts?: number;
  state?: unknown;
  summary?: unknown;
  detail?: unknown;
  data?: unknown;
  nodeId?: unknown;
  [key: string]: unknown;
}

const VALID_STATES = new Set(['ok', 'warn', 'error', 'pending']);

/**
 * Pure reducer step. Returns the new map with the entry for `nodeId` REPLACED
 * by the parsed report (latest wins). Returns the same `prev` reference when
 * the event is non-`node:status`, the nodeId is missing/non-string, or the
 * state field isn't one of the four valid values — so React's `useReducer`
 * can bail out of a re-render in those cases.
 */
export const applyNodeStatus = (prev: NodeStatuses, event: NodeStatusEvent): NodeStatuses => {
  if (event.type !== 'node:status') return prev;
  const nodeId = typeof event.nodeId === 'string' ? event.nodeId : null;
  if (!nodeId) return prev;
  if (typeof event.state !== 'string' || !VALID_STATES.has(event.state)) return prev;
  const summary = typeof event.summary === 'string' ? event.summary : undefined;
  const detail = typeof event.detail === 'string' ? event.detail : undefined;
  const data =
    event.data && typeof event.data === 'object' && !Array.isArray(event.data)
      ? (event.data as Record<string, unknown>)
      : undefined;
  const ts = typeof event.ts === 'number' ? event.ts : Date.now();
  return {
    ...prev,
    [nodeId]: {
      state: event.state as StatusReport['state'],
      summary,
      detail,
      data,
      ts,
    },
  };
};

type Action = { type: 'event'; event: NodeStatusEvent } | { type: 'reset' };

const reducer = (state: NodeStatuses, action: Action): NodeStatuses => {
  switch (action.type) {
    case 'reset':
      return {};
    case 'event':
      return applyNodeStatus(state, action.event);
  }
};

export interface UseNodeStatusesResult {
  statusByNode: NodeStatuses;
  /** Apply a single SSE event. Non-`node:status` events are ignored. */
  apply: (event: NodeStatusEvent) => void;
  /** Clear all node statuses (used when switching demos or after flow:reload). */
  reset: () => void;
}

/**
 * Per-node `StatusReport` map driven by SSE `node:status` events. Each
 * incoming event REPLACES the entry for its nodeId (latest wins). The studio
 * kills the previous status batch on every Play click + on demo file reloads,
 * so callers should `reset` on `flow:reload` to drop stale entries.
 */
export const useNodeStatuses = (flowId: string | null): UseNodeStatusesResult => {
  const [statusByNode, dispatch] = useReducer(reducer, {} as NodeStatuses);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  // biome-ignore lint/correctness/useExhaustiveDependencies: flowId is the trigger; the effect body intentionally doesn't reference it.
  useEffect(() => {
    dispatchRef.current({ type: 'reset' });
  }, [flowId]);

  const apply = useCallback((event: NodeStatusEvent) => {
    dispatchRef.current({ type: 'event', event });
  }, []);

  const reset = useCallback(() => {
    dispatchRef.current({ type: 'reset' });
  }, []);

  return { statusByNode, apply, reset };
};
