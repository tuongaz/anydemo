import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Bundles the MCP App as a single self-contained HTML file (CSS/JS/assets
// inlined). The output is read at runtime by apps/studio's MCP server and
// returned as the `ui://seeflow/canvas` resource for MCP-Apps-capable hosts.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  // The studio SPA at apps/web pins `server.port: 5173` with `strictPort:
  // true`. Without an explicit port here, Vite tries 5173, collides, and
  // on macOS ends up bound to `[::1]:5173` instead of failing — so Bun's
  // IPv6-preferring `fetch` in the studio dev proxy
  // (apps/studio/src/server.ts) lands on the wrong Vite when it forwards
  // `/`, breaking HMR and triggering a page-reload loop.
  server: { port: 5174, strictPort: true },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      // Resolve the canvas package to its source so we always build against
      // the in-repo version (mirrors the apps/web alias pattern).
      {
        find: /^@seeflow\/canvas$/,
        replacement: path.resolve(__dirname, '../../packages/canvas/src/index.ts'),
      },
    ],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
