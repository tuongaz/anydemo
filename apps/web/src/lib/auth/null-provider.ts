import type { AuthProvider } from './types.ts';

/**
 * The default provider for local/standalone studio: there is no auth, so the
 * session is always "present", the token is always null (the API client adds no
 * Authorization header), and sign-in/out are no-ops. This keeps the seam inert
 * unless a host opts in via `GET /api/config`.
 */
export const NullAuthProvider: AuthProvider = {
  init: async () => {},
  isAuthenticated: () => true,
  getToken: async () => null,
  signIn: async () => {},
  signOut: async () => {},
  onChange: () => () => {},
};
