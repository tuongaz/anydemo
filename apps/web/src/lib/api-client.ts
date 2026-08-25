/**
 * Verbs that are safe to replay. seeflow PATCH bodies are value-idempotent
 * (re-applying the same patch yields the same on-disk state), so PATCH is
 * included. POST is NOT — a create/upload retried after a succeeded-but-lost
 * response would duplicate the entity.
 */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE']);

/**
 * Statuses that mean "the backend never gave a real answer" — the app was
 * overloaded, or the client was throttled. Retrying these is safe and is
 * exactly the transient-failure class that turns a fire-and-forget optimistic
 * edit into a silently-dropped save. 5xx app errors (500) and 4xx client errors
 * are NOT retried — they're deterministic.
 */
const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504]);

const MAX_RETRIES = 2; // 3 attempts total
const BASE_RETRY_DELAY_MS = 250;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Central client for same-origin `/api/*` calls. Every studio API request flows
 * through here so retry policy lives in one place.
 *
 * Idempotent requests are retried with exponential backoff on transient
 * network / gateway failures so a single dropped packet doesn't silently lose a
 * node edit or delete.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const canRetry = IDEMPOTENT_METHODS.has(method);

  for (let attempt = 0; ; attempt++) {
    let res: Response | undefined;
    let networkError: unknown;
    try {
      res = await fetch(input, init);
    } catch (err) {
      networkError = err;
    }

    const transient =
      networkError !== undefined || (res !== undefined && RETRYABLE_STATUS.has(res.status));
    if (canRetry && transient && attempt < MAX_RETRIES) {
      // Exponential backoff + jitter so a fleet of clients doesn't retry in
      // lockstep against a recovering backend.
      await sleep(BASE_RETRY_DELAY_MS * 2 ** attempt + Math.random() * 100);
      continue;
    }

    // Retries exhausted (or non-retryable): surface the outcome unchanged.
    if (res === undefined) throw networkError;

    return res;
  }
}
