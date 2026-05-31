/**
 * Live Share controller. Owns the state machine for a host-side share session:
 * idle -> starting -> active -> stopping -> idle.
 *
 * This module is the local-API surface that the studio HTTP routes and toolbar
 * UI delegate to. Transport, relay handshake, peer routing, audit, and event
 * fan-out are layered on top in subsequent stories; this scaffold defines the
 * stable interface and an in-memory host-key store.
 */

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
}

export function createShareController(_deps: ShareDeps): ShareController {
  // State and hostKey live inside this closure so the hostKey never escapes:
  // not written to disk, not exposed by state(), not logged. Future stories
  // (US-017+) mutate `current` through internal helpers and assign the
  // hostKey after the relay handshake.
  const current: ShareState = { status: 'idle' };
  const subscribers = new Set<(s: ShareState) => void>();

  return {
    async start() {
      throw new Error('not-implemented');
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
