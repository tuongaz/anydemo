import { describe, expect, it } from 'bun:test';
import { type Envelope, makeEnvelope } from './share-envelope.ts';
import {
  type ShareTransportState,
  type WebSocketLike,
  createShareTransport,
} from './share-transport.ts';

type Listener = (ev: unknown) => void;

class FakeWebSocket implements WebSocketLike {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  readonly url: string;
  readonly sent: string[] = [];
  closedWith: { code?: number; reason?: string } | null = null;

  private listeners: Record<string, Listener[]> = {
    open: [],
    message: [],
    close: [],
    error: [],
  };

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: Listener): void {
    this.listeners[type]?.push(listener);
  }

  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: Listener): void {
    const arr = this.listeners[type];
    if (!arr) return;
    const idx = arr.indexOf(listener);
    if (idx >= 0) arr.splice(idx, 1);
  }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new Error('FakeWebSocket: send before open');
    }
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.closedWith = { code, reason };
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', { code: code ?? 1000, reason: reason ?? '' });
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
  }

  simulateMessage(data: string): void {
    this.emit('message', { data });
  }

  simulateClose(code: number): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', { code, reason: '' });
  }

  private emit(type: string, ev: unknown): void {
    for (const fn of this.listeners[type] ?? []) {
      try {
        fn(ev);
      } catch (err) {
        console.error(`FakeWebSocket listener for ${type} threw:`, err);
      }
    }
  }
}

interface Harness {
  sockets: FakeWebSocket[];
  states: ShareTransportState[];
  frames: Envelope[];
  /** Pop the most recently scheduled timer and run it synchronously. */
  runNextTimer(): number;
  hasPendingTimer(): boolean;
}

function makeHarness(): Harness & {
  wsFactory: (url: string) => WebSocketLike;
  setTimeoutFn: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn: (handle: unknown) => void;
  onFrame: (env: Envelope) => void;
  onStateChange: (s: ShareTransportState) => void;
} {
  const sockets: FakeWebSocket[] = [];
  const states: ShareTransportState[] = [];
  const frames: Envelope[] = [];
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];

  return {
    sockets,
    states,
    frames,
    wsFactory: (url) => {
      const s = new FakeWebSocket(url);
      sockets.push(s);
      return s;
    },
    setTimeoutFn: (fn, ms) => {
      const entry = { fn, ms, cancelled: false };
      timers.push(entry);
      return entry;
    },
    clearTimeoutFn: (h) => {
      const entry = h as { cancelled: boolean };
      if (entry) entry.cancelled = true;
    },
    onFrame: (env) => {
      frames.push(env);
    },
    onStateChange: (s) => {
      states.push(s);
    },
    runNextTimer() {
      const entry = timers.find((t) => !t.cancelled);
      if (!entry) throw new Error('no pending timer');
      entry.cancelled = true;
      entry.fn();
      return entry.ms;
    },
    hasPendingTimer() {
      return timers.some((t) => !t.cancelled);
    },
  };
}

const baseOpts = {
  wsUrl: 'ws://relay.example/host',
  sessionId: 'sess-1',
  hostKey: 'host-secret',
};

describe('createShareTransport', () => {
  it('sends auth-host envelope as the first frame after open', () => {
    const h = makeHarness();
    createShareTransport({
      ...baseOpts,
      onFrame: h.onFrame,
      onStateChange: h.onStateChange,
      wsFactory: h.wsFactory,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
    });

    expect(h.sockets).toHaveLength(1);
    expect(h.states).toEqual(['connecting']);

    const sock = h.sockets[0];
    if (!sock) throw new Error('no socket');
    sock.simulateOpen();

    expect(h.states).toEqual(['connecting', 'open']);
    expect(sock.sent).toHaveLength(1);
    const firstSent = sock.sent[0];
    if (!firstSent) throw new Error('no sent frame');
    const parsed = JSON.parse(firstSent);
    expect(parsed).toEqual({
      v: 1,
      type: 'auth-host',
      from: 'host',
      payload: { sessionId: 'sess-1', hostKey: 'host-secret' },
    });
  });

  it('invokes onFrame for a valid inbound envelope', () => {
    const h = makeHarness();
    createShareTransport({
      ...baseOpts,
      onFrame: h.onFrame,
      onStateChange: h.onStateChange,
      wsFactory: h.wsFactory,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
    });
    const sock = h.sockets[0];
    if (!sock) throw new Error('no socket');
    sock.simulateOpen();

    const incoming = makeEnvelope('presence', { kind: 'join', peerId: 'p1' }, { from: 'c-42' });
    sock.simulateMessage(JSON.stringify(incoming));

    expect(h.frames).toHaveLength(1);
    expect(h.frames[0]).toEqual(incoming);
  });

  it('drops invalid frames without invoking onFrame', () => {
    const h = makeHarness();
    createShareTransport({
      ...baseOpts,
      onFrame: h.onFrame,
      onStateChange: h.onStateChange,
      wsFactory: h.wsFactory,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
    });
    const sock = h.sockets[0];
    if (!sock) throw new Error('no socket');
    sock.simulateOpen();

    sock.simulateMessage('not-json{{');
    sock.simulateMessage(JSON.stringify({ v: 2, type: 'rpc', from: 'x', payload: {} }));
    sock.simulateMessage(JSON.stringify({ v: 1, type: 'totally-unknown', from: 'x', payload: {} }));

    expect(h.frames).toHaveLength(0);
  });

  it('reconnects on unexpected close after backoff and re-runs the wsFactory', () => {
    const h = makeHarness();
    createShareTransport({
      ...baseOpts,
      onFrame: h.onFrame,
      onStateChange: h.onStateChange,
      wsFactory: h.wsFactory,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
      random: () => 0.5, // zero jitter contribution
    });
    const first = h.sockets[0];
    if (!first) throw new Error('no socket');
    first.simulateOpen();

    // Abnormal close (e.g. relay restart).
    first.simulateClose(1006);

    expect(h.states).toContain('reconnecting');
    expect(h.hasPendingTimer()).toBe(true);

    // Run scheduled reconnect.
    const delay = h.runNextTimer();
    expect(delay).toBe(500); // initial backoff with zero jitter
    expect(h.sockets).toHaveLength(2);
    const second = h.sockets[1];
    if (!second) throw new Error('no second socket');
    second.simulateOpen();
    expect(second.sent).toHaveLength(1);
  });

  it("close('user') suppresses reconnect attempts", () => {
    const h = makeHarness();
    const t = createShareTransport({
      ...baseOpts,
      onFrame: h.onFrame,
      onStateChange: h.onStateChange,
      wsFactory: h.wsFactory,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
    });
    const sock = h.sockets[0];
    if (!sock) throw new Error('no socket');
    sock.simulateOpen();

    t.close('user');
    expect(h.sockets).toHaveLength(1);
    expect(h.hasPendingTimer()).toBe(false);
    expect(h.states).toContain('closed');
    expect(t.isOpen()).toBe(false);
  });

  it('send() throws when not open', () => {
    const h = makeHarness();
    const t = createShareTransport({
      ...baseOpts,
      onFrame: h.onFrame,
      onStateChange: h.onStateChange,
      wsFactory: h.wsFactory,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
    });
    // Before open
    expect(() => t.send(makeEnvelope('rpc', {}))).toThrow('share-transport-not-open');
    const sock = h.sockets[0];
    if (!sock) throw new Error('no socket');
    sock.simulateOpen();
    // Now it should work
    t.send(makeEnvelope('rpc', { method: 'noop' }, { to: 'all' }));
    expect(sock.sent).toHaveLength(2); // auth-host + rpc
  });

  it('backoff doubles on repeated reconnects', () => {
    const h = makeHarness();
    createShareTransport({
      ...baseOpts,
      onFrame: h.onFrame,
      onStateChange: h.onStateChange,
      wsFactory: h.wsFactory,
      setTimeoutFn: h.setTimeoutFn,
      clearTimeoutFn: h.clearTimeoutFn,
      random: () => 0.5,
    });
    const s1 = h.sockets[0];
    if (!s1) throw new Error('no socket');
    s1.simulateOpen();
    s1.simulateClose(1006);
    expect(h.runNextTimer()).toBe(500);
    const s2 = h.sockets[1];
    if (!s2) throw new Error('no s2');
    // Close before open succeeds (so backoff stays doubled, not reset).
    s2.simulateClose(1006);
    expect(h.runNextTimer()).toBe(1000);
  });
});
