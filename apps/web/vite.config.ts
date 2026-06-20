import { readFileSync } from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const studioPkg = JSON.parse(
  readFileSync(path.resolve(__dirname, '../studio/package.json'), 'utf8'),
) as { version: string };

export default defineConfig(({ command }) => {
  const isDev = command === 'serve';
  const canvasStyleAlias = isDev
    ? [
        {
          find: '@seeflow/canvas/style.css',
          replacement: path.resolve(__dirname, '../../packages/canvas/dist/style.dev.css'),
        },
      ]
    : [];

  return {
    // Base public path. Defaults to '/' for the standalone studio; the cloud
    // build sets VITE_BASE=/app/ so absolute `/assets/...` URLs and the SPA's
    // custom history router resolve under cloud.seeflow.dev/app. Must keep the
    // trailing slash — Vite requires it and `import.meta.env.BASE_URL` echoes
    // it verbatim (router.ts strips the trailing slash itself).
    //
    // NOTE: when the cloud host serves this same /app build under a /p/<id> URL
    // it injects window.__SEEFLOW_BOOT__.base at runtime. That boot base drives
    // ROUTING ONLY (pushState URLs + path matching, via router.ts). Emitted
    // asset URLs stay pinned to THIS build-time base (/app/assets/...) — they
    // are not rebased per request — so CloudFront still routes them to the
    // studio's /app/* S3 prefix unchanged.
    base: process.env.VITE_BASE ?? '/',
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(studioPkg.version),
    },
    resolve: {
      alias: [
        { find: '@', replacement: path.resolve(__dirname, './src') },
        // In dev, redirect the canvas stylesheet to the watcher's dev output
        // (dist/style.dev.css) so the committed minified dist/style.css stays
        // untouched. Prod builds resolve via the package's exports map.
        ...canvasStyleAlias,
        // Alias the canvas package to its source for HMR in monorepo dev.
        // External consumers resolve to `dist/` via the package's exports map.
        // Exact-match regex so `@seeflow/canvas/style.css` falls through to the
        // package's `exports` map (which points to dist/style.css).
        {
          find: /^@seeflow\/canvas$/,
          replacement: path.resolve(__dirname, '../../packages/canvas/src/index.ts'),
        },
      ],
    },
    server: {
      port: 5173,
      strictPort: true,
      // Bind to all interfaces so Tailscale peers can reach Vite for HMR +
      // asset requests. Hono (on 4321) proxies the page itself, but the HMR
      // client connects to Vite directly.
      host: true,
      hmr: {
        // No `host`: Vite's HMR client defaults to location.hostname, so a
        // page loaded over Tailscale dials ws://<tailscale-host>:5173 instead
        // of ws://localhost:5173. clientPort pins the dialed port to 5173 so
        // the page's origin port (4321) doesn't leak into the WS URL.
        clientPort: 5173,
        protocol: 'ws',
      },
    },
    build: {
      outDir: '../studio/dist/web',
      emptyOutDir: true,
    },
  };
});
