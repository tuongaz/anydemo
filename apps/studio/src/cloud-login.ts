import { DEFAULT_CLOUD_ENDPOINT } from './credentials.ts';

export interface LoopbackLoginOptions {
  /** Cloud base URL. Defaults to https://cloud.seeflow.dev. */
  endpoint?: string;
  /** Fixed loopback port. Defaults to 0 (ephemeral). */
  port?: number;
}

export interface LoginResult {
  token: string;
  userId?: string;
  email?: string;
}

export interface LoopbackLoginSession {
  /** The URL to open in a browser to complete sign-in. */
  loginUrl: string;
  /** The bound loopback port. */
  port: number;
  /** The CSRF state echoed back by the callback. */
  state: string;
  /** Resolves once a valid callback delivers a token. */
  result: Promise<LoginResult>;
  /** Stop the loopback server (idempotent). */
  close(): void;
}

const DONE_PAGE =
  '<!doctype html><meta charset=utf-8><title>SeeFlow</title>' +
  '<body style="font-family:system-ui;padding:3rem;text-align:center">' +
  '<h1>You are logged in.</h1><p>You can close this window and return to the terminal.</p></body>';

/**
 * Start the local-loopback login flow (provider-agnostic). Spins a tiny HTTP
 * server on 127.0.0.1, returns the cloud /cli/login URL to open, and resolves
 * `result` when the cloud SPA redirects/POSTs the minted token back to
 * /callback with a matching state. Does NOT open a browser or persist — the
 * caller (CLI / studio) does that.
 */
export function startLoopbackLogin(
  options: LoopbackLoginOptions = {},
): Promise<LoopbackLoginSession> {
  const endpoint = (options.endpoint ?? DEFAULT_CLOUD_ENDPOINT).replace(/\/+$/, '');
  const state = crypto.randomUUID();

  let resolveResult!: (r: LoginResult) => void;
  const result = new Promise<LoginResult>((r) => {
    resolveResult = r;
  });

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: options.port ?? 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== '/callback') return new Response('not found', { status: 404 });
      if (url.searchParams.get('state') !== state) {
        return new Response('state mismatch', { status: 400 });
      }
      const token = url.searchParams.get('token');
      if (!token) return new Response('missing token', { status: 400 });
      resolveResult({
        token,
        userId: url.searchParams.get('userId') ?? undefined,
        email: url.searchParams.get('email') ?? undefined,
      });
      return new Response(DONE_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    },
  });

  const port = server.port ?? options.port ?? 0;
  const loginUrl = `${endpoint}/cli/login?port=${port}&state=${state}`;

  return Promise.resolve({
    loginUrl,
    port,
    state,
    result,
    close: () => server.stop(true),
  });
}
