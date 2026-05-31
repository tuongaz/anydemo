/**
 * Outbound WebSocket transport for the Live Share host.
 *
 * Connects to the relay's host WebSocket, sends the auth-host envelope as the
 * very first frame, parses inbound frames through the envelope schema, and
 * automatically reconnects with exponential backoff on unexpected close.
 *
 * The WebSocket implementation is injected via `wsFactory` (defaulting to
 * Bun's global `WebSocket`) so tests can drive the transport with a fake.
 * Inbound frames that fail Zod validation are dropped with a `console.warn`
 * carrying only the parser reason — never the payload — per the design doc's
 * "logs only `{ type, from, to, sizeBytes }`" rule.
 */

import { type Envelope, makeEnvelope, parseEnvelope } from './share-envelope.ts';

export type ShareTransportState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface WebSocketLike {
  readyState: number;
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (ev: unknown) => void,
  ): void;
  removeEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (ev: unknown) => void,
  ): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface ShareTransport {
  send(frame: Envelope): void;
  close(reason?: string): void;
  isOpen(): boolean;
}

export interface ShareTransportOpts {
  wsUrl: string;
  sessionId: string;
  hostKey: string;
  onFrame: (env: Envelope) => void;
  onStateChange: (s: ShareTransportState) => void;
  wsFactory?: (url: string) => WebSocketLike;
  /** Override for tests; defaults to setTimeout. */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  /** Override for tests; defaults to clearTimeout. */
  clearTimeoutFn?: (handle: unknown) => void;
  /** Override jitter source for deterministic tests. Returns a value in [0, 1). */
  random?: () => number;
}

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
const JITTER_FRACTION = 0.2;
const USER_CLOSE_CODE = 1000;

const defaultWsFactory = (url: string): WebSocketLike => {
  // Bun's global WebSocket satisfies WebSocketLike (the DOM-style interface).
  return new WebSocket(url) as unknown as WebSocketLike;
};

export function createShareTransport(opts: ShareTransportOpts): ShareTransport {
  const wsFactory = opts.wsFactory ?? defaultWsFactory;
  const schedule = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = opts.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const random = opts.random ?? Math.random;

  let ws: WebSocketLike | null = null;
  let stopped = false;
  let backoffMs = INITIAL_BACKOFF_MS;
  let reconnectHandle: unknown = null;
  let currentState: ShareTransportState | null = null;

  const setState = (s: ShareTransportState) => {
    if (currentState === s) return;
    currentState = s;
    try {
      opts.onStateChange(s);
    } catch (err) {
      console.error('[share-transport] onStateChange threw:', err);
    }
  };

  const handleOpen = () => {
    backoffMs = INITIAL_BACKOFF_MS;
    setState('open');
    // First frame after connect MUST be auth-host. Relay closes us (1008) if
    // it disagrees, which falls through the close handler into reconnect.
    const auth = makeEnvelope(
      'auth-host',
      { sessionId: opts.sessionId, hostKey: opts.hostKey },
      { from: 'host' },
    );
    try {
      ws?.send(JSON.stringify(auth));
    } catch (err) {
      console.warn('[share-transport] auth-host send failed:', err);
    }
  };

  const handleMessage = (ev: unknown) => {
    const data = (ev as { data?: unknown }).data;
    if (typeof data !== 'string') {
      console.warn('[share-transport] dropped non-text frame');
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      console.warn('[share-transport] dropped frame: invalid JSON');
      return;
    }
    const result = parseEnvelope(raw);
    if (!result.ok) {
      console.warn('[share-transport] dropped frame:', result.reason);
      return;
    }
    try {
      opts.onFrame(result.envelope);
    } catch (err) {
      console.error('[share-transport] onFrame threw:', err);
    }
  };

  const computeBackoff = (): number => {
    const base = backoffMs;
    const jitter = base * JITTER_FRACTION * (random() * 2 - 1);
    const next = Math.max(0, Math.round(base + jitter));
    backoffMs = Math.min(MAX_BACKOFF_MS, base * 2);
    return next;
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    setState('reconnecting');
    const delay = computeBackoff();
    reconnectHandle = schedule(() => {
      reconnectHandle = null;
      if (stopped) return;
      connect();
    }, delay);
  };

  const handleClose = (ev: unknown) => {
    const code = (ev as { code?: number }).code;
    ws = null;
    if (stopped || code === USER_CLOSE_CODE) {
      setState('closed');
      return;
    }
    scheduleReconnect();
  };

  const handleError = () => {
    // The browser/Bun WS contract is that 'error' is followed by 'close'; we
    // let handleClose drive the reconnect to avoid double-scheduling.
  };

  const connect = () => {
    if (stopped) return;
    setState(currentState === 'reconnecting' ? 'reconnecting' : 'connecting');
    const sock = wsFactory(opts.wsUrl);
    ws = sock;
    sock.addEventListener('open', handleOpen);
    sock.addEventListener('message', handleMessage);
    sock.addEventListener('close', handleClose);
    sock.addEventListener('error', handleError);
  };

  // Fire initial connect synchronously so callers see state='connecting' immediately.
  setState('connecting');
  connect();

  return {
    send(frame) {
      if (!ws || ws.readyState !== 1) {
        throw new Error('share-transport-not-open');
      }
      ws.send(JSON.stringify(frame));
    },
    close(_reason) {
      stopped = true;
      if (reconnectHandle !== null) {
        cancel(reconnectHandle);
        reconnectHandle = null;
      }
      const sock = ws;
      ws = null;
      if (sock) {
        try {
          sock.close(USER_CLOSE_CODE, 'user');
        } catch (err) {
          console.warn('[share-transport] close failed:', err);
        }
      }
      setState('closed');
    },
    isOpen() {
      return ws !== null && ws.readyState === 1;
    },
  };
}
