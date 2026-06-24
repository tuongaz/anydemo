import { getAuthProvider } from './auth/provider.ts';
import { readBootConfig } from './boot-config.ts';

/**
 * Verbs that are safe to replay. seeflow PATCH bodies are value-idempotent
 * (re-applying the same patch yields the same on-disk state), so PATCH is
 * included. POST is NOT — a create/upload retried after a succeeded-but-lost
 * response would duplicate the entity.
 */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE']);

/**
 * Statuses that mean "the backend never gave a real answer" — a gateway/proxy
 * couldn't reach the app, the app was overloaded, or the client was throttled.
 * Retrying these is safe and is exactly the transient-failure class that, on
 * cloud.seeflow.dev (real network + LB in front of a single container), turns a
 * fire-and-forget optimistic edit into a silently-dropped save. 5xx app errors
 * (500) and 4xx client errors are NOT retried — they're deterministic.
 */
const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504]);

const MAX_RETRIES = 2; // 3 attempts total
const BASE_RETRY_DELAY_MS = 250;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Central client for same-origin `/api/*` calls. Every studio API request flows
 * through here so the auth seam can attach a bearer token in one place.
 *
 * In local mode the provider yields a null token and `init` is passed through
 * untouched — byte-identical to a bare `fetch`, so existing behaviour and tests
 * are unaffected. In an authenticated host, the current provider's fresh token
 * is added as `Authorization: Bearer …`, and a 401 triggers re-authentication.
 *
 * Idempotent requests are retried with exponential backoff on transient
 * network / gateway failures so a single dropped packet on a flaky cloud
 * connection doesn't silently lose a node edit or delete. A fresh token is
 * minted per attempt so a JWT that expires mid-retry is replaced, not reused.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const canRetry = IDEMPOTENT_METHODS.has(method);
  // The cloud injects a project id into the studio boot for owner/shared
  // projects; tag every studio API call with it so the cloud's shared-edit
  // middleware can resolve a shared editor's `/api/projects/*` writes to the
  // OWNER's tree. Absent in local/standalone studio → no header at all.
  const sharedProjectId = readBootConfig()?.projectId;

  for (let attempt = 0; ; attempt++) {
    const provider = getAuthProvider();
    const token = await provider.getToken();

    // Only touch headers when there's something to add — keeps the no-auth /
    // no-cloud path identical to a plain fetch (and header-asserting tests green).
    const finalInit = withCloudHeaders(init, token, sharedProjectId);

    let res: Response | undefined;
    let networkError: unknown;
    try {
      res = await fetch(input, finalInit);
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

    if (res.status === 401) {
      // Session is invalid/expired and could not be refreshed → re-auth.
      // Fire-and-forget: the provider typically redirects (page unloads). In
      // local mode this is a no-op and the caller handles the 401 as before.
      void provider.signIn();
    }

    return res;
  }
}

/**
 * Attach the cloud auth + routing headers, preserving a byte-identical
 * passthrough when there's nothing to add (local no-auth mode → tests asserting
 * referential `init` stay green). `X-Seeflow-Project-Id` is the cloud project id
 * the studio was booted with; the cloud's shared-edit middleware uses it to
 * resolve a shared editor's `/api/projects/*` calls to the OWNER's tree.
 */
const withCloudHeaders = (
  init: RequestInit,
  token: string | null,
  sharedProjectId: string | undefined,
): RequestInit => {
  if (!token && !sharedProjectId) return init;
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (sharedProjectId) headers.set('X-Seeflow-Project-Id', sharedProjectId);
  return { ...init, headers };
};
