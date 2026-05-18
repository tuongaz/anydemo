import type { NodeStatus } from '@seeflow/canvas';
import { useCallback, useEffect, useReducer, useRef } from 'react';

export interface NodeRunState {
  status: NodeStatus;
  runId?: string;
  /** Filled when status === 'done': upstream HTTP status. */
  responseStatus?: number;
  /** Filled when status === 'done': parsed JSON or text body. */
  body?: unknown;
  /** Filled when status === 'error': human-readable message. */
  error?: string;
  /** ms since epoch of the most recent transition. */
  ts?: number;
}

export type NodeRuns = Record<string, NodeRunState>;

type Action =
  | {
      type: 'running';
      nodeId: string;
      runId?: string;
      ts?: number;
    }
  | {
      type: 'done';
      nodeId: string;
      runId?: string;
      responseStatus?: number;
      body?: unknown;
      ts?: number;
    }
  | {
      type: 'error';
      nodeId: string;
      runId?: string;
      message?: string;
      ts?: number;
    }
  | { type: 'reset' };

const reducer = (state: NodeRuns, action: Action): NodeRuns => {
  switch (action.type) {
    case 'reset':
      return {};
    case 'running':
      return {
        ...state,
        [action.nodeId]: {
          status: 'running',
          runId: action.runId,
          ts: action.ts ?? Date.now(),
        },
      };
    case 'done':
      return {
        ...state,
        [action.nodeId]: {
          ...state[action.nodeId],
          status: 'done',
          runId: action.runId ?? state[action.nodeId]?.runId,
          responseStatus: action.responseStatus,
          body: action.body,
          ts: action.ts ?? Date.now(),
        },
      };
    case 'error':
      return {
        ...state,
        [action.nodeId]: {
          ...state[action.nodeId],
          status: 'error',
          runId: action.runId ?? state[action.nodeId]?.runId,
          error: action.message,
          ts: action.ts ?? Date.now(),
        },
      };
  }
};

export interface NodeRunEvent {
  /** Any SSE event type — `apply` only acts on `node:*`. */
  type: string;
  ts?: number;
  /** Payload fields that may or may not be present. */
  [key: string]: unknown;
}

export interface UseNodeRunsResult {
  runs: NodeRuns;
  /** Apply a single SSE event to the runs map. Non-`node:*` events are ignored. */
  apply: (event: NodeRunEvent) => void;
  /** Clear all node states (used when switching demos). */
  reset: () => void;
}

/**
 * Per-node status reducer driven by SSE `node:*` events. Caller is expected
 * to wire `apply` to `useStudioEvents.onEvent` and call `reset` when the
 * demo id changes.
 */
export const useNodeRuns = (demoId: string | null): UseNodeRunsResult => {
  const [runs, dispatch] = useReducer(reducer, {} as NodeRuns);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  // Reset whenever the demo id changes — switching demos shouldn't bleed
  // status state across canvases.
  // biome-ignore lint/correctness/useExhaustiveDependencies: demoId is the trigger; the effect body intentionally doesn't reference it.
  useEffect(() => {
    dispatchRef.current({ type: 'reset' });
  }, [demoId]);

  const apply = useCallback((event: NodeRunEvent) => {
    const nodeId = typeof event.nodeId === 'string' ? event.nodeId : null;
    if (!nodeId) return;
    const runId = typeof event.runId === 'string' ? event.runId : undefined;

    if (event.type === 'node:running') {
      dispatchRef.current({ type: 'running', nodeId, runId, ts: event.ts });
      return;
    }
    if (event.type === 'node:done') {
      const responseStatus = typeof event.status === 'number' ? event.status : undefined;
      dispatchRef.current({
        type: 'done',
        nodeId,
        runId,
        responseStatus,
        body: event.body,
        ts: event.ts,
      });
      return;
    }
    if (event.type === 'node:error') {
      const message = typeof event.message === 'string' ? event.message : undefined;
      dispatchRef.current({ type: 'error', nodeId, runId, message, ts: event.ts });
    }
  }, []);

  const reset = useCallback(() => {
    dispatchRef.current({ type: 'reset' });
  }, []);

  return { runs, apply, reset };
};
