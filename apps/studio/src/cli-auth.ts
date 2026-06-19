import {
  DEFAULT_CLOUD_ENDPOINT,
  clearCredential,
  loadCredential,
  saveCredential,
} from './credentials.ts';
import { startLoopbackLogin } from './cloud-login.ts';

export interface LoginOptions {
  endpoint?: string;
  /** Injectable browser-opener (tests drive the loopback callback here). */
  openBrowser?: (loginUrl: string) => void | Promise<void>;
}

export interface LoginOutcome {
  ok: true;
  endpoint: string;
  userId?: string;
  email?: string;
}

function defaultOpenBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url];
  try {
    Bun.spawn({ cmd, stdout: 'ignore', stderr: 'ignore' }).unref();
  } catch {
    // Headless box: the caller still prints the URL to copy/paste.
  }
}

/** `seeflow login` — loopback browser flow, persists the cloud token. */
export async function runLogin(options: LoginOptions = {}): Promise<LoginOutcome> {
  const endpoint = options.endpoint ?? DEFAULT_CLOUD_ENDPOINT;
  const session = await startLoopbackLogin({ endpoint });
  try {
    const open = options.openBrowser ?? defaultOpenBrowser;
    await open(session.loginUrl);
    const result = await session.result;
    saveCredential({
      endpoint,
      token: result.token,
      userId: result.userId,
      email: result.email,
    });
    return { ok: true, endpoint, userId: result.userId, email: result.email };
  } finally {
    session.close();
  }
}

/** `seeflow logout` — clears the stored credential for the endpoint. */
export function runLogout(endpoint: string = DEFAULT_CLOUD_ENDPOINT): void {
  clearCredential(endpoint);
}

export type WhoamiResult =
  | { loggedIn: false }
  | { loggedIn: true; endpoint: string; userId?: string; email?: string };

/** `seeflow whoami` — reports the stored identity for the endpoint. */
export function runWhoami(endpoint: string = DEFAULT_CLOUD_ENDPOINT): WhoamiResult {
  const cred = loadCredential(endpoint);
  if (!cred) return { loggedIn: false };
  return { loggedIn: true, endpoint, userId: cred.userId, email: cred.email };
}
