/**
 * Thin typed wrapper around the MCP-Apps host bridge (`window.openai`).
 *
 * Two outbound channels:
 *  - `sendMessage(event)` — conversational notifications for structural edits.
 *    Calls are coalesced inside a 200ms window into ONE `window.openai.sendMessage`
 *    invocation carrying the merged list of events. Prevents rapid edits (e.g. a
 *    paste that adds 3 nodes + 2 connectors) from spamming the chat.
 *  - `updateModelContext(patch)` — silent navigation telemetry (selection,
 *    viewport, drag-in-progress, detail-panel focus). Trailing-edge debounce of
 *    250ms with a 1-call-per-second throttle. Patches accumulate via shallow
 *    merge so each fire carries the freshest view.
 *
 * When `window.openai` is absent (plain browser tab, e2e harness without host
 * shim), both functions no-op silently — no throws, no console noise. Same
 * bundle runs inside the MCP App host and outside it.
 */

export type WidgetStateKind = 'navigate' | 'create';

export type WidgetState = {
  kind: WidgetStateKind;
  flowSlug?: string;
  nodeId?: string;
  projectSlug?: string;
  backendUrl: string;
  backendToken: string;
  justCreated?: boolean;
};

export type SendMessageEvent = {
  event: string;
  flowSlug?: string;
  payload?: Record<string, unknown>;
};

export type ModelContextPatch = Record<string, unknown>;

type OpenAIHost = {
  sendMessage?: (payload: unknown) => unknown;
  updateModelContext?: (patch: unknown) => unknown;
  widgetState?: unknown;
};

declare global {
  interface Window {
    openai?: OpenAIHost;
  }
}

export const COALESCE_WINDOW_MS = 200;
export const CONTEXT_DEBOUNCE_MS = 250;
export const CONTEXT_THROTTLE_MS = 1000;

export interface BridgeDeps {
  /** Defaults to globalThis.setTimeout. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  /** Defaults to globalThis.clearTimeout. */
  clearTimer?: (handle: unknown) => void;
  /** Defaults to Date.now. */
  now?: () => number;
  /** Defaults to reading `window.openai`. Used by tests to inject a stub. */
  getHost?: () => OpenAIHost | undefined;
}

export interface Bridge {
  sendMessage: (event: SendMessageEvent) => void;
  updateModelContext: (patch: ModelContextPatch) => void;
}

const defaultGetHost = (): OpenAIHost | undefined =>
  typeof window === 'undefined' ? undefined : window.openai;

export const createBridge = (deps: BridgeDeps = {}): Bridge => {
  const setTimer =
    deps.setTimer ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms) as unknown);
  const clearTimer =
    deps.clearTimer ??
    ((handle: unknown) => {
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
    });
  const now = deps.now ?? (() => Date.now());
  const getHost = deps.getHost ?? defaultGetHost;

  // ---- sendMessage: 200ms coalescer ----
  let pendingEvents: SendMessageEvent[] = [];
  let coalesceHandle: unknown = null;

  const flushSendMessage = () => {
    coalesceHandle = null;
    if (pendingEvents.length === 0) return;
    const events = pendingEvents;
    pendingEvents = [];
    const host = getHost();
    if (!host || typeof host.sendMessage !== 'function') return;
    host.sendMessage({ events });
  };

  const sendMessage = (event: SendMessageEvent) => {
    const host = getHost();
    if (!host || typeof host.sendMessage !== 'function') return;
    pendingEvents.push(event);
    if (coalesceHandle === null) {
      coalesceHandle = setTimer(flushSendMessage, COALESCE_WINDOW_MS);
    }
  };

  // ---- updateModelContext: 250ms debounce + 1/sec throttle ----
  let pendingPatch: ModelContextPatch | null = null;
  let debounceHandle: unknown = null;
  let lastFireAt = Number.NEGATIVE_INFINITY;

  const fireContext = () => {
    debounceHandle = null;
    if (pendingPatch === null) return;
    const t = now();
    const sinceLast = t - lastFireAt;
    if (sinceLast < CONTEXT_THROTTLE_MS) {
      // Throttle says wait — re-arm for the remaining window.
      debounceHandle = setTimer(fireContext, CONTEXT_THROTTLE_MS - sinceLast);
      return;
    }
    const patch = pendingPatch;
    pendingPatch = null;
    lastFireAt = t;
    const host = getHost();
    if (!host || typeof host.updateModelContext !== 'function') return;
    host.updateModelContext(patch);
  };

  const updateModelContext = (patch: ModelContextPatch) => {
    const host = getHost();
    if (!host || typeof host.updateModelContext !== 'function') return;
    pendingPatch = { ...(pendingPatch ?? {}), ...patch };
    if (debounceHandle !== null) clearTimer(debounceHandle);
    const throttleWait = lastFireAt + CONTEXT_THROTTLE_MS - now();
    const wait = throttleWait > CONTEXT_DEBOUNCE_MS ? throttleWait : CONTEXT_DEBOUNCE_MS;
    debounceHandle = setTimer(fireContext, wait);
  };

  return { sendMessage, updateModelContext };
};

const defaultBridge = createBridge();

export const sendMessage = defaultBridge.sendMessage;
export const updateModelContext = defaultBridge.updateModelContext;
