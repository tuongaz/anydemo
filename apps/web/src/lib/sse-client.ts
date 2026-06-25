import { getAuthProvider } from './auth/provider.ts';
import { readBootConfig } from './boot-config.ts';

/**
 * Fetch-based Server-Sent Events client.
 *
 * Replaces the browser `EventSource` so the auth seam can carry a bearer token
 * in an `Authorization` header (EventSource cannot set headers — the only
 * alternative is a token in the URL, which leaks into logs and can't be
 * refreshed on reconnect). A FRESH token is minted on every (re)connect, so a
 * short-lived JWT survives long-lived streams.
 *
 * The surface intentionally mirrors the slice of EventSource the studio hooks
 * use — `addEventListener(type, cb)` and `close()` — so callers change minimally.
 */

export interface SseEvent {
  data: string;
  lastEventId: string;
}

export interface SseStream {
  addEventListener(type: string, listener: (event: SseEvent) => void): void;
  close(): void;
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export function apiEventStream(path: string): SseStream {
  const listeners = new Map<string, Set<(event: SseEvent) => void>>();
  let closed = false;
  let backoff = INITIAL_BACKOFF_MS;
  let controller: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const emit = (type: string, event: SseEvent) => {
    const set = listeners.get(type);
    if (!set) return;
    for (const cb of set) cb(event);
  };

  const scheduleReconnect = () => {
    if (closed) return;
    emit('error', { data: '', lastEventId: '' });
    reconnectTimer = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  };

  const connect = async () => {
    if (closed) return;
    controller = new AbortController();
    const parser = createSseParser((type, event) => emit(type, event));

    try {
      const token = await getAuthProvider().getToken();
      const headers = new Headers({ accept: 'text/event-stream' });
      if (token) headers.set('Authorization', `Bearer ${token}`);
      // Cloud shared-editing: tag the live stream with the booted cloud project
      // id (same seam as apiFetch) so the cloud resolves a shared editor's
      // /api/events to the OWNER's tenant bus — without it the editor only sees
      // their own tenant and misses the owner's live edits (owner→editor sync).
      // Absent in local/standalone studio → no header, behaviour unchanged.
      const sharedProjectId = readBootConfig()?.projectId;
      if (sharedProjectId) headers.set('X-Seeflow-Project-Id', sharedProjectId);

      const res = await fetch(path, { headers, signal: controller.signal });
      if (!res.ok || !res.body) {
        scheduleReconnect();
        return;
      }

      backoff = INITIAL_BACKOFF_MS; // healthy connection → reset backoff
      emit('open', { data: '', lastEventId: '' });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      // Stream ended cleanly (server closed / idle timeout) → reconnect.
      scheduleReconnect();
    } catch {
      if (!closed) scheduleReconnect();
    }
  };

  void connect();

  return {
    addEventListener(type, listener) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(listener);
    },
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      controller?.abort();
    },
  };
}

/**
 * Incremental SSE frame parser. Buffers partial chunks and dispatches a frame
 * on each blank-line boundary. Pure + synchronous so it can be unit-tested
 * without a network stream. The default event type is `message` (per the SSE
 * spec); `:`-prefixed comment lines (heartbeats) are ignored.
 */
export function createSseParser(dispatch: (type: string, event: SseEvent) => void) {
  let buffer = '';
  let lastEventId = '';

  const flush = (frame: string) => {
    let eventType = 'message';
    const dataLines: string[] = [];
    for (const rawLine of frame.split('\n')) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line === '' || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      // A single leading space after the colon is stripped (SSE spec).
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') eventType = value;
      else if (field === 'data') dataLines.push(value);
      else if (field === 'id') lastEventId = value;
    }
    if (dataLines.length === 0) return; // nothing to deliver (e.g. id-only frame)
    dispatch(eventType, { data: dataLines.join('\n'), lastEventId });
  };

  return {
    feed(chunk: string) {
      buffer += chunk;
      let sep = findFrameBoundary(buffer);
      while (sep !== -1) {
        const frame = buffer.slice(0, sep.index);
        buffer = buffer.slice(sep.index + sep.length);
        flush(frame);
        sep = findFrameBoundary(buffer);
      }
    },
  };
}

/** Find the first SSE frame separator (\n\n or \r\n\r\n). */
const findFrameBoundary = (buffer: string): { index: number; length: number } | -1 => {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf === -1 && crlf === -1) return -1;
  if (crlf === -1) return { index: lf, length: 2 };
  if (lf === -1) return { index: crlf, length: 4 };
  return lf < crlf ? { index: lf, length: 2 } : { index: crlf, length: 4 };
};
