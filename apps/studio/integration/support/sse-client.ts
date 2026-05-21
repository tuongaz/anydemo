export interface SseEvent {
  /** The `event:` line, or 'message' per SSE spec when omitted. */
  event: string;
  /** The `data:` payload (multi-line `data:` fields are joined with '\n'). */
  data: string;
  /** Optional `id:` line, if the server emitted one. */
  id?: string;
}

export interface SseClient {
  /** Live array of parsed events — pushed in arrival order as frames arrive. */
  events: SseEvent[];
  /**
   * Wait for an event matching `predicate`. Polls `events.find(predicate)`
   * every 25ms up to `timeoutMs` (default 5000). Throws with the last 3
   * events seen on timeout.
   */
  waitFor: (predicate: (e: SseEvent) => boolean, timeoutMs?: number) => Promise<SseEvent>;
  /** Aborts the underlying fetch and stops draining the body. Safe to call twice. */
  close: () => void;
}

const POLL_INTERVAL_MS = 25;
const DEFAULT_WAIT_TIMEOUT_MS = 5_000;
const DEFAULT_PATH = '/api/events';

/**
 * Connect to a Server-Sent Events stream at `baseURL + path`. Bun has no
 * built-in EventSource, so this wraps fetch + a ReadableStream reader and
 * parses SSE frames (event:/data:/id:, blank-line delimited). The returned
 * client exposes a live `events` array and a `waitFor(predicate)` helper.
 *
 * The returned promise resolves once the HTTP response headers are received
 * (i.e. the server has accepted the stream); body drain runs in the background.
 */
export async function connectSse(baseURL: string, path: string = DEFAULT_PATH): Promise<SseClient> {
  const url = `${baseURL}${path}`;
  const controller = new AbortController();

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(
      `connectSse failed to open ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok || !res.body) {
    throw new Error(`connectSse: ${url} returned ${res.status} (expected 2xx with body)`);
  }

  const events: SseEvent[] = [];
  void drain(res.body, events, controller);

  return {
    events,
    waitFor: (predicate, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS) =>
      waitForEvent(events, predicate, timeoutMs),
    close: () => {
      try {
        controller.abort();
      } catch {
        /* already aborted */
      }
    },
  };
}

async function drain(
  body: ReadableStream<Uint8Array>,
  events: SseEvent[],
  controller: AbortController,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!controller.signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      // Normalize \r\n → \n so frame-boundary detection is single-style.
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let sepIdx = buffer.indexOf('\n\n');
      while (sepIdx !== -1) {
        const raw = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const frame = parseFrame(raw);
        if (frame) events.push(frame);
        sepIdx = buffer.indexOf('\n\n');
      }
    }
  } catch {
    /* aborted or socket torn — close is the documented exit path */
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

function parseFrame(raw: string): SseEvent | null {
  let event = 'message';
  let id: string | undefined;
  const dataLines: string[] = [];
  let hasData = false;
  let hasFields = false;

  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    if (line.startsWith(':')) continue;
    const colonIdx = line.indexOf(':');
    const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
    let val = colonIdx === -1 ? '' : line.slice(colonIdx + 1);
    if (val.startsWith(' ')) val = val.slice(1);
    hasFields = true;
    if (field === 'event') event = val;
    else if (field === 'data') {
      dataLines.push(val);
      hasData = true;
    } else if (field === 'id') id = val;
  }

  if (!hasFields) return null;
  return { event, data: hasData ? dataLines.join('\n') : '', id };
}

async function waitForEvent(
  events: SseEvent[],
  predicate: (e: SseEvent) => boolean,
  timeoutMs: number,
): Promise<SseEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = events.find(predicate);
    if (found) return found;
    await Bun.sleep(POLL_INTERVAL_MS);
  }
  const found = events.find(predicate);
  if (found) return found;
  const tail = events
    .slice(-3)
    .map((e) => `${e.event}:${e.data}`)
    .join(' | ');
  throw new Error(
    `SseClient.waitFor timed out after ${timeoutMs}ms. Last 3 events: ${tail || '(none)'}`,
  );
}
