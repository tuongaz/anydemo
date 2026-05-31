/**
 * Live Share controller. Owns the state machine for a host-side share session:
 * idle -> starting -> active -> stopping -> idle.
 *
 * This module is the local-API surface that the studio HTTP routes and toolbar
 * UI delegate to. start() drives the relay handshake (POST /api/share/sessions)
 * and boots a WebSocket transport; transport state events drive the controller
 * state machine. stop/kick/rotateUrl are stubbed until US-018.
 */

import type { Envelope } from './share-envelope.ts';
import {
  type ShareTransport,
  type ShareTransportOpts,
  type ShareTransportState,
  createShareTransport,
} from './share-transport.ts';

export interface PeerSummary {
  peerId: string;
  displayName: string;
  joinedAt: number;
}

export type ShareState =
  | { status: 'idle' }
  | { status: 'starting' }
  | {
      status: 'active';
      sessionId: string;
      token: string;
      url: string;
      peers: PeerSummary[];
      startedAt: number;
    }
  | { status: 'stopping' }
  | { status: 'error'; reason: string };

export interface ShareController {
  start(): Promise<{ url: string; sessionId: string }>;
  stop(): Promise<void>;
  kick(peerId: string): Promise<void>;
  rotateUrl(): Promise<{ url: string }>;
  state(): ShareState;
  subscribe(fn: (s: ShareState) => void): () => void;
}

export interface ShareDeps {
  relayHttpUrl: string;
  shareUrlBase: string;
  fetch?: typeof fetch;
  transportFactory?: (opts: ShareTransportOpts) => ShareTransport;
}

interface RelaySessionResponse {
  sessionId: string;
  token: string;
  hostKey: string;
  wsUrl: string;
}

const BOOT_TIMEOUT_MS = 10_000;

export function createShareController(deps: ShareDeps): ShareController {
  // current is mutated through setState() so subscribers fan-out on every
  // transition. hostKey + transport live in closure scope — hostKey is never
  // returned by state() or logged; future stories (stop/kick/rotate) read it
  // directly from here.
  let current: ShareState = { status: 'idle' };
  const subscribers = new Set<(s: ShareState) => void>();
  const fetchFn = deps.fetch ?? fetch;
  const transportFactory = deps.transportFactory ?? createShareTransport;

  let hostKey: string | null = null;
  let transport: ShareTransport | null = null;

  const setState = (next: ShareState) => {
    current = next;
    for (const fn of subscribers) {
      try {
        fn(next);
      } catch (err) {
        console.error('[share] subscriber threw on transition:', err);
      }
    }
  };

  return {
    async start() {
      if (current.status !== 'idle') {
        throw new Error('share-already-active');
      }
      const res = await fetchFn(`${deps.relayHttpUrl}/api/share/sessions`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`share-relay-http-${res.status}`);
      }
      const body = (await res.json()) as RelaySessionResponse;

      hostKey = body.hostKey;

      return await new Promise<{ url: string; sessionId: string }>((resolve, reject) => {
        let settled = false;
        let timeoutHandle: ReturnType<typeof setTimeout> | null = setTimeout(() => {
          if (settled) return;
          settled = true;
          timeoutHandle = null;
          const t = transport;
          transport = null;
          hostKey = null;
          if (t) {
            try {
              t.close('boot-timeout');
            } catch (err) {
              console.warn('[share] close failed during boot timeout:', err);
            }
          }
          setState({ status: 'idle' });
          reject(new Error('share-boot-timeout'));
        }, BOOT_TIMEOUT_MS);

        const onTransportState = (s: ShareTransportState) => {
          if (settled) return;
          if (s === 'connecting' || s === 'reconnecting') {
            if (current.status !== 'starting') setState({ status: 'starting' });
            return;
          }
          if (s === 'open') {
            settled = true;
            if (timeoutHandle !== null) {
              clearTimeout(timeoutHandle);
              timeoutHandle = null;
            }
            const url = `${deps.shareUrlBase}/${body.token}`;
            setState({
              status: 'active',
              sessionId: body.sessionId,
              token: body.token,
              url,
              peers: [],
              startedAt: Date.now(),
            });
            resolve({ url, sessionId: body.sessionId });
            return;
          }
          // s === 'closed' before reaching 'open' => boot failed.
          settled = true;
          if (timeoutHandle !== null) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }
          transport = null;
          hostKey = null;
          setState({ status: 'idle' });
          reject(new Error('share-transport-closed-during-boot'));
        };

        const onFrame = (_env: Envelope) => {
          // Frame routing lands in US-019+. Until then, valid frames are
          // dropped — the relay does not depend on host-side ack for boot.
        };

        transport = transportFactory({
          wsUrl: body.wsUrl,
          sessionId: body.sessionId,
          hostKey: body.hostKey,
          onFrame,
          onStateChange: onTransportState,
        });
      });
    },
    async stop() {
      throw new Error('not-implemented');
    },
    async kick(_peerId: string) {
      throw new Error('not-implemented');
    },
    async rotateUrl() {
      throw new Error('not-implemented');
    },
    state() {
      return current;
    },
    subscribe(fn) {
      subscribers.add(fn);
      try {
        fn(current);
      } catch (err) {
        console.error('[share] subscriber threw on initial deliver, dropping:', err);
      }
      return () => {
        subscribers.delete(fn);
      };
    },
  };
}
