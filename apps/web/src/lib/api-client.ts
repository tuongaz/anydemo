import { getAuthProvider } from './auth/provider.ts';

/**
 * Central client for same-origin `/api/*` calls. Every studio API request flows
 * through here so the auth seam can attach a bearer token in one place.
 *
 * In local mode the provider yields a null token and `init` is passed through
 * untouched — byte-identical to a bare `fetch`, so existing behaviour and tests
 * are unaffected. In an authenticated host, the current provider's fresh token
 * is added as `Authorization: Bearer …`, and a 401 triggers re-authentication.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const provider = getAuthProvider();
  const token = await provider.getToken();

  // Only touch headers when there is a token — keeps the no-auth path identical
  // to a plain fetch (and keeps header-asserting tests green).
  const finalInit = token ? { ...init, headers: withBearer(init.headers, token) } : init;

  const res = await fetch(input, finalInit);

  if (res.status === 401) {
    // Session is invalid/expired and could not be refreshed → re-auth.
    // Fire-and-forget: the provider typically redirects (page unloads). In
    // local mode this is a no-op and the caller handles the 401 as before.
    void provider.signIn();
  }

  return res;
}

const withBearer = (headers: HeadersInit | undefined, token: string): Headers => {
  const merged = new Headers(headers);
  merged.set('Authorization', `Bearer ${token}`);
  return merged;
};
