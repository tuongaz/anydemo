// Studio CORS + per-process token gate.
//
// The MCP App iframe (Claude Desktop) lives in a sandboxed `Origin: null`
// frame. To prevent drive-by access from other localhost software, every
// `null`-origin request must carry the per-process token in the
// `X-Seeflow-Token` header. The token is delivered to the iframe via
// `_meta['openai/widgetState'].backendToken` from the MCP tool response —
// no other channel exists, so other localhost processes can't observe it.
//
// Other origins:
//   - Missing Origin (server-side fetches, integration tests, top-level
//     navigation): pass through with no CORS headers.
//   - Localhost / 127.0.0.1 / [::1] (any port, dev SPA): allow with CORS
//     headers so cross-origin XHR (Tailscale + multi-port dev) still works.
//   - Other origins: pass through with no CORS headers — the browser's
//     own CORS policy blocks cross-origin XHR. We don't 403 them because
//     the dev workflow runs over Tailscale hostnames and we don't want to
//     hard-code that allowlist server-side.
//
// Preflight rules: `OPTIONS` from a null origin is allowed unconditionally
// (the browser can't put `X-Seeflow-Token` on a preflight — it goes in
// `Access-Control-Request-Headers` instead). The browser will then issue
// the actual request carrying the token, and THAT one is gated.

import { timingSafeEqual } from 'node:crypto';
import type { Context, Next } from 'hono';

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const ALLOWED_HEADERS = 'Content-Type, X-Seeflow-Token';
const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const TOKEN_HEADER = 'x-seeflow-token';

const isLocalhostOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    return LOCALHOST_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
};

// Constant-time comparison to keep timing attacks off the table. 128-bit
// UUIDs make this overkill in practice, but `timingSafeEqual` is cheap and
// removes the question entirely.
const tokensMatch = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

const setAllowedHeaders = (c: Context, origin: string): void => {
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Vary', 'Origin');
  c.header('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  c.header('Access-Control-Allow-Methods', ALLOWED_METHODS);
};

export const createCorsMiddleware = (token: string | undefined) => {
  return async (c: Context, next: Next) => {
    const origin = c.req.header('origin');
    if (!origin) {
      await next();
      return;
    }

    if (origin === 'null') {
      if (c.req.method === 'OPTIONS') {
        setAllowedHeaders(c, origin);
        return c.body(null, 204);
      }
      const reqToken = c.req.header(TOKEN_HEADER);
      if (!token || !reqToken || !tokensMatch(reqToken, token)) {
        return c.text('Forbidden', 403);
      }
      setAllowedHeaders(c, origin);
      await next();
      return;
    }

    if (isLocalhostOrigin(origin)) {
      setAllowedHeaders(c, origin);
      if (c.req.method === 'OPTIONS') {
        return c.body(null, 204);
      }
      await next();
      return;
    }

    // Non-localhost, non-null origin: no CORS headers. Browser blocks the
    // cross-origin read; the request still reaches the route handler for
    // server-side / same-origin-by-port scenarios.
    await next();
  };
};
