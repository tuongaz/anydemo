# @seeflow/mcp-app

Single-file Vite bundle that mounts the SeeFlow canvas inside an MCP-Apps host
iframe (Claude Desktop). Built once, read at runtime by the studio MCP server,
and returned as the `ui://seeflow/canvas` resource.

## Rules

- **Single-file output:** `dist/index.html` MUST be one self-contained file. The
  Vite config (`assetsInlineLimit: 100_000_000`, `cssCodeSplit: false`,
  `rollupOptions.output.inlineDynamicImports: true` + `vite-plugin-singlefile`)
  is tuned for this. Don't introduce dynamic imports or asset references that
  would force the build to split chunks.
- **Canvas alias:** `@seeflow/canvas` resolves to `packages/canvas/src/index.ts`
  (regex alias in `vite.config.ts`). HMR + builds work against the in-repo source.
- **Style import:** `import '@seeflow/canvas/style.css'` pulls the built css from
  `packages/canvas/dist/style.css`. The package's `prebuild` script (`bun run
  --filter @seeflow/canvas build`) keeps that file in sync; don't drop it.
- **Bridge no-op contract:** `bridge.sendMessage` / `bridge.updateModelContext`
  silently no-op when `window.openai` (or the specific method) is missing — so
  the same bundle runs inside the host AND inside a plain browser tab (e2e
  harness, manual smoke test, `bun run preview`).
- **Widget state shim:** when `window.openai.widgetState` is absent, `App.tsx`
  falls back to parsing `?widgetState=<json>` from the URL. Keep both paths
  symmetric — any new field must flow through both.

## Workflow

- Dev: `bun run --filter @seeflow/mcp-app dev` (Vite at default port).
- Build: `bun run --filter @seeflow/mcp-app build` → `dist/index.html`.
- Preview built: `cd apps/mcp-app && bunx --bun vite preview --port 4444 --outDir dist`.
- Smoke test: visit `http://localhost:4444/` (fallback) and
  `http://localhost:4444/?widgetState=<urlencoded-json>` (mounted canvas).

## Mounting the canvas

`<SeeflowCanvas>` requires both `canvasMode` + `onCanvasModeChange` even when
the host has no toolbar UI — pass `{ kind: 'select' }` + a `useState` setter
to satisfy the typecheck. The Studio HTTP API has no slug → id shortcut: do
`GET /api/flows` → find by slug → `GET /api/flows/:id` for the merged flow.
