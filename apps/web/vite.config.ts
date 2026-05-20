import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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
    plugins: [react()],
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
