import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { NullAuthProvider } from './null-provider.ts';
import type { AuthProvider, AuthUserInfo, PublicAppConfig } from './types.ts';

/**
 * App-config context: lets any component branch on cloud-vs-local and read the
 * signed-in user without prop-drilling. Populated once at bootstrap from
 * `/api/config` + the resolved auth provider.
 */
export interface AppConfigValue {
  /** config.mode === 'cloud' — gates cloud-only UI. */
  isCloud: boolean;
  /** Signed-in user's display info, or null (local / signed out). */
  user: AuthUserInfo | null;
  /** The active auth provider (for signOut / openProfile). */
  provider: AuthProvider;
}

/**
 * Default used when a component renders outside the provider — local studio
 * paths that don't mount it, and unit tests. Keeps cloud-only branches off by
 * default, so existing component tests are unaffected.
 */
export const DEFAULT_APP_CONFIG: AppConfigValue = {
  isCloud: false,
  user: null,
  provider: NullAuthProvider,
};

const AppConfigContext = createContext<AppConfigValue | null>(null);

export function AppConfigProvider({
  config,
  provider,
  children,
}: {
  config: PublicAppConfig;
  provider: AuthProvider;
  children: ReactNode;
}) {
  const [user, setUser] = useState<AuthUserInfo | null>(() => provider.getUser?.() ?? null);

  // Re-read the user on every session change (login, logout, profile update).
  useEffect(() => {
    setUser(provider.getUser?.() ?? null);
    return provider.onChange(() => setUser(provider.getUser?.() ?? null));
  }, [provider]);

  const value = useMemo<AppConfigValue>(
    () => ({ isCloud: config.mode === 'cloud', user, provider }),
    [config.mode, user, provider],
  );

  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;
}

export function useAppConfig(): AppConfigValue {
  return useContext(AppConfigContext) ?? DEFAULT_APP_CONFIG;
}
