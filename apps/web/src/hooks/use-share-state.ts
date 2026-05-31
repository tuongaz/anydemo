import { useEffect, useState } from 'react';

export interface ShareStatePeerSummary {
  peerId: string;
  displayName: string;
  joinedAt: number;
  color?: string;
}

export type ShareState =
  | { status: 'idle' }
  | { status: 'starting' }
  | {
      status: 'active';
      sessionId: string;
      token: string;
      url: string;
      peers: ShareStatePeerSummary[];
      startedAt: number;
      hostDisplayName: string;
      /**
       * US-082: count of sessions the studio is currently tracking in
       * `active.json`. Used by the LiveShareDialog kill-switch affordance
       * to disable the button when no live sessions exist and to render
       * "Active sessions: N". `undefined` while older studios are still
       * deployed; readers must default to 0.
       */
      recentSessionCount?: number;
    }
  | { status: 'stopping' }
  | { status: 'error'; reason: string };

const IDLE_FALLBACK: ShareState = { status: 'idle' };

/**
 * Subscribes to /api/share/state. Mirrors the studio's `ShareController.state()`
 * shape; the initial frame is the current snapshot, subsequent frames each
 * transition. Returns `{ status: 'idle' }` while the SSE channel is connecting.
 */
export function useShareState(): ShareState {
  const [state, setState] = useState<ShareState>(IDLE_FALLBACK);

  useEffect(() => {
    const source = new EventSource('/api/share/state');
    source.addEventListener('state', (e) => {
      const ev = e as MessageEvent<string>;
      try {
        const parsed = JSON.parse(ev.data) as ShareState;
        if (parsed && typeof parsed === 'object' && typeof parsed.status === 'string') {
          setState(parsed);
        }
      } catch {
        // bad JSON — ignore, keep current state
      }
    });
    return () => source.close();
  }, []);

  return state;
}
