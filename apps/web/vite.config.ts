import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Alias the canvas package to its source for HMR in monorepo dev.
      // External consumers resolve to `dist/` via the package's exports map.
      '@seeflow/canvas': path.resolve(__dirname, '../../packages/canvas/src/index.ts'),
    },
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
});
