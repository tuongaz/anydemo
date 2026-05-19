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
      host: 'localhost',
      hmr: {
        host: 'localhost',
        port: 5173,
        protocol: 'ws',
      },
    },
    build: {
      outDir: '../studio/dist/web',
      emptyOutDir: true,
    },
  };
});
