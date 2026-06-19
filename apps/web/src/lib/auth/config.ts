import type { PublicAppConfig } from './types.ts';

/**
 * Fetch the host's public app config. SeeFlow's own backend serves a default
 * (`{ mode: 'local', auth: { required: false } }`); a host like the cloud
 * deployment overrides it with an auth requirement + adapter URL.
 *
 * Defensive: any failure (offline, non-JSON, 404 on an old backend) degrades to
 * local mode so the studio still renders rather than white-screening.
 */
export const DEFAULT_CONFIG: PublicAppConfig = { mode: 'local', auth: { required: false } };

export const loadConfig = async (fetchImpl: typeof fetch = fetch): Promise<PublicAppConfig> => {
  try {
    const res = await fetchImpl('/api/config');
    if (!res.ok) return DEFAULT_CONFIG;
    const body = (await res.json()) as Partial<PublicAppConfig>;
    return normalizeConfig(body);
  } catch {
    return DEFAULT_CONFIG;
  }
};

/** Narrow an untrusted config body into a well-formed PublicAppConfig. */
export const normalizeConfig = (
  body: Partial<PublicAppConfig> | null | undefined,
): PublicAppConfig => {
  const mode = body?.mode === 'cloud' ? 'cloud' : 'local';
  const auth = body?.auth;
  if (!auth || typeof auth !== 'object') {
    return { mode, auth: { required: false } };
  }
  return {
    mode,
    auth: {
      required: auth.required === true,
      adapterUrl: typeof auth.adapterUrl === 'string' ? auth.adapterUrl : undefined,
      publishableKey: typeof auth.publishableKey === 'string' ? auth.publishableKey : undefined,
      issuer: typeof auth.issuer === 'string' ? auth.issuer : undefined,
    },
  };
};
