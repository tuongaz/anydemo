import { NullAuthProvider } from './null-provider.ts';
import type { AuthAdapterModule, AuthProvider, PublicAppConfig } from './types.ts';

/**
 * Module-singleton "current provider". Defaults to NullAuthProvider so any code
 * path that reads a token before bootstrap completes (or in local mode) gets a
 * safe no-op. Bootstrap replaces it via `setAuthProvider` once the config is
 * resolved.
 */
let current: AuthProvider = NullAuthProvider;

export const getAuthProvider = (): AuthProvider => current;

export const setAuthProvider = (provider: AuthProvider): void => {
  current = provider;
};

/**
 * Resolve the provider for a given app config:
 *   - no auth required        → NullAuthProvider (local mode, inert)
 *   - required + adapterUrl    → dynamically import the adapter and build it
 *   - required without adapter → misconfiguration, throw loudly
 *
 * The dynamic import is intentionally a runtime URL (named by the backend), so
 * SeeFlow bundles no provider SDK. `@vite-ignore` stops Vite from trying to
 * resolve/bundle it at build time.
 */
export const resolveAuthProvider = async (config: PublicAppConfig): Promise<AuthProvider> => {
  const auth = config.auth;
  if (!auth?.required) return NullAuthProvider;
  if (!auth.adapterUrl) {
    throw new Error('Auth is required but no adapterUrl was provided by /api/config');
  }
  const mod = (await import(/* @vite-ignore */ auth.adapterUrl)) as AuthAdapterModule;
  if (typeof mod.createAuthProvider !== 'function') {
    throw new Error(`Auth adapter at ${auth.adapterUrl} does not export createAuthProvider`);
  }
  return mod.createAuthProvider(auth);
};
