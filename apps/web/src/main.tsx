import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App.tsx';
import { loadConfig } from './lib/auth/config.ts';
import { resolveAuthProvider, setAuthProvider } from './lib/auth/provider.ts';
import '@seeflow/canvas/style.css';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

const root = ReactDOM.createRoot(rootEl);

const splash = (message: string) => (
  <div className="flex h-full w-full items-center justify-center bg-background text-sm text-muted-foreground">
    {message}
  </div>
);

/**
 * Auth bootstrap runs before the studio renders. In local mode this resolves to
 * the inert NullAuthProvider and the app renders immediately (unchanged). When a
 * host requires auth (via `GET /api/config`), we load its adapter, and if there
 * is no session we redirect to sign-in BEFORE painting — no flash of
 * unauthenticated UI. The auth provider is stored in a module singleton that the
 * API + SSE clients read for tokens.
 */
async function bootstrap() {
  root.render(<React.StrictMode>{splash('Loading…')}</React.StrictMode>);

  const config = await loadConfig();
  const provider = await resolveAuthProvider(config);
  await provider.init();
  setAuthProvider(provider);

  if (config.auth?.required && !provider.isAuthenticated()) {
    // Redirect to the provider's sign-in. Typically navigates away (never
    // resolves); keep the splash up meanwhile.
    root.render(<React.StrictMode>{splash('Redirecting to sign in…')}</React.StrictMode>);
    await provider.signIn();
    return;
  }

  // Reload if the session is lost while the app is open (e.g. sign-out in
  // another tab) so the gate re-runs instead of leaving a tokenless session.
  if (config.auth?.required) {
    provider.onChange(() => {
      if (!provider.isAuthenticated()) window.location.reload();
    });
  }

  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap().catch((err) => {
  // Never white-screen on an auth/config failure — surface it.
  console.error('[seeflow] auth bootstrap failed', err);
  root.render(
    <React.StrictMode>
      {splash('Failed to start. Check the console for details.')}
    </React.StrictMode>,
  );
});
