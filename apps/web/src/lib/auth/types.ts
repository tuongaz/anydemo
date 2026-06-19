/**
 * Provider-agnostic auth seam.
 *
 * SeeFlow itself ships NO identity-provider code. A host (e.g. the cloud
 * deployment) advertises an auth requirement through `GET /api/config`; the SPA
 * then dynamically imports the named adapter module and drives it through this
 * interface. Local/standalone studio resolves to the built-in NullAuthProvider
 * and behaves exactly as before (no token, no gate).
 */

/** Display info for the signed-in user (e.g. the header avatar menu). */
export interface AuthUserInfo {
  name?: string;
  email?: string;
  imageUrl?: string;
}

/** An auth provider drives sign-in and hands the API client a bearer token. */
export interface AuthProvider {
  /** Boot the underlying SDK. Called once during bootstrap, before any gate. */
  init(): Promise<void>;
  /** Whether a valid session currently exists. */
  isAuthenticated(): boolean;
  /**
   * Return a fresh bearer token for the current session, or `null` when there
   * is no auth (local mode). Implementations should mint/refresh as needed so
   * each call yields a currently-valid token.
   */
  getToken(): Promise<string | null>;
  /** Begin the sign-in flow (typically a redirect). May never resolve. */
  signIn(): Promise<void>;
  /** End the current session. */
  signOut(): Promise<void>;
  /** Subscribe to session changes; returns an unsubscribe fn. */
  onChange(cb: () => void): () => void;
  /** Current user's display info, or null when signed out / no auth. */
  getUser?(): AuthUserInfo | null;
  /** Open the provider's account/profile UI (e.g. Clerk's profile modal). */
  openProfile?(): void;
}

/** Public auth descriptor carried by `GET /api/config` (no secrets). */
export interface PublicAuthConfig {
  /** When true, the SPA must hold a session before the studio renders. */
  required: boolean;
  /**
   * URL of an ESM module exporting `createAuthProvider(cfg)`. Same-origin,
   * named by the host's backend. Imported only when `required` is true.
   */
  adapterUrl?: string;
  /** Provider-specific public config, passed verbatim to the adapter. */
  publishableKey?: string;
  issuer?: string;
}

/** Public app descriptor carried by `GET /api/config` (no secrets). */
export interface PublicAppConfig {
  mode: 'local' | 'cloud';
  auth?: PublicAuthConfig;
}

/** The shape an adapter module must export. */
export interface AuthAdapterModule {
  createAuthProvider(cfg: PublicAuthConfig): AuthProvider | Promise<AuthProvider>;
}
