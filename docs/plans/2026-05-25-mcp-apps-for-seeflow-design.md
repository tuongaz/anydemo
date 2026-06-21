# MCP Apps for SeeFlow — Design

**Date:** 2026-05-25
**Status:** Design, ready for implementation
**Scope:** Add MCP Apps support so SeeFlow's React Flow canvas renders inline in MCP-Apps-capable hosts (Claude Desktop first), with full in-chat authoring and bidirectional model awareness.

---

## Goals

- The 5 canvas-bearing tools open a live, editable React Flow canvas inline in the chat.
- Mutations from the model propagate to the open canvas without re-opening it.
- User edits inside the canvas (drag, add, delete, Play, Status) become model-aware via the right channel for each event class.
- No regressions for users on non-Apps hosts — existing `seeflow-mcp` behavior unchanged.
- One process, one install. Single `seeflow-mcp` binary, nothing else to run.

## Non-goals

- Multi-host parity beyond Claude Desktop (we follow the spec, but only verify there).
- State persistence across tool calls (`setWidgetState`/`getWidgetState`). Studio is the source of truth; SSE rehydrates.
- Auth beyond a per-process token on a loopback port.
- New canvas refactors — `@seeflow/canvas` is reused as-is.
- Attaching canvas to the 18 mutation tools. They stay JSON-only.

---

## Section 1 — Architecture & process model

One process, two transports.

`seeflow-mcp`, when launched by Claude Desktop over stdio, also calls `serve({ port: 0, fetch: app.fetch })` to start the Hono studio on an ephemeral loopback port. The MCP server side (`mcp.ts`) and the HTTP/SSE side share the same in-memory `Studio` instance, so file watchers, SSE subscribers, and tool calls all observe the same state.

The 5 canvas-bearing tools (`seeflow_get_flow`, `seeflow_get_flow_graph`, `seeflow_get_node`, `seeflow_register_flow`, `seeflow_create_project`) attach `_meta['openai/outputTemplate'] = 'ui://seeflow/canvas'` plus a per-tool `_meta['openai/widgetState']` carrying `{ kind, flowSlug, nodeId?, backendUrl, justCreated? }`. Other mutation tools (`seeflow_patch_node`, `seeflow_add_node`, etc.) stay JSON-only — their changes propagate to any open canvas via the studio's existing SSE channel.

The canvas resource itself is one HTML document registered under `resources/list` at `ui://seeflow/canvas`, returning `apps/mcp-app/dist/index.html` inlined.

```
Claude Desktop  ──stdio──▶  seeflow-mcp (one process)
       │                         │
       │                         ├── MCP stdio handler  (mcp.ts)
       │                         └── Hono on :ephemeral (existing studio)
       ▼                                       ▲
   <iframe ui://seeflow/canvas> ──fetch+SSE────┘
```

## Section 2 — The `apps/mcp-app/` bundle

New workspace, sibling to `studio` and `web`. Owns one deliverable: a self-contained `dist/index.html` that the MCP server reads at startup and serves as the `ui://seeflow/canvas` resource.

**Layout:**

```
apps/mcp-app/
  package.json          # @seeflow/mcp-app, private
  vite.config.ts        # build:single-file plugin, inline everything
  tsconfig.json
  src/
    main.tsx            # entry: reads window.openai.widgetState, mounts <App/>
    App.tsx             # branches on widgetState.kind → <NavigateView/> | <CreateView/>
    backend.ts          # createRestAdapter({ baseUrl: widgetState.backendUrl })
    bridge.ts           # window.openai wrappers: sendMessage, updateModelContext
    debounce.ts         # 250ms debounce for drag/select context updates
  index.html
```

**Dependencies:** `@seeflow/canvas` (workspace), `react`, `react-dom`, `@xyflow/react`, plus the canvas's non-tree-shakeable peer deps. Build target ES2022, single-file output, ~600KB gzipped budget (mermaid/shiki/recharts stay lazy via the canvas package's existing dynamic imports).

**Build:** `bun run --filter @seeflow/mcp-app build` runs Vite with `vite-plugin-singlefile` (or equivalent) to inline CSS/JS/assets into one HTML doc. The root build adds this as an upstream dependency so published tarballs contain the artifact. The MCP server reads it via `fs.readFileSync` resolved through `import.meta.resolve`.

**Why a separate workspace, not in `apps/web`:** `apps/web` is the full Vite SPA with router and dev server; the MCP App is a single-purpose iframe payload with a different build target and entry. Sharing would mean conditional builds and shared deps that aren't actually shared.

## Section 3 — Bidirectional communication

Three channels, each with a clear job. All go through `window.openai` (the MCP Apps host bridge).

**Inbound (host → iframe).** `window.openai.widgetState` on mount carries `{ kind, flowSlug, nodeId?, backendUrl, justCreated? }`. Read once at boot. Subsequent tool calls that re-render the resource arrive as fresh `widgetState` on remount — we don't try to preserve iframe state across calls. The studio backend is the source of truth; SSE rehydrates.

**Outbound, conversational (`sendMessage`).** For structural edits the model should react to. The canvas already emits these via `CanvasAdapter` callbacks:

- node added / deleted
- connector added / deleted
- node renamed
- "Play" pressed
- "Status" panel state change

Each fires `bridge.sendMessage({ event, flowSlug, payload })`. A 200ms coalescer collapses bursts ("user added 3 nodes and 2 connectors") so rapid edits don't spam the conversation.

**Outbound, silent (`updateModelContext`).** For navigation telemetry — selection changes, drag-in-progress, viewport pan/zoom, detail-panel focus. Debounced 250ms, throttled to at most 1/sec. Carries `{ selectedNodeId, hoveredNodeId, viewport }`.

**Inbound mutations from the model.** Already flow through existing mutation tools → studio → SSE → canvas updates. No new code path.

**Backpressure rule.** If `window.openai` isn't present (running outside an Apps host, e.g. e2e tests), all three channels no-op. Same bundle works in a plain browser tab pointed at a backend.

## Section 4 — MCP server changes

**New `apps/studio/src/mcp-ui.ts`:**

```ts
export const CANVAS_RESOURCE_URI = 'ui://seeflow/canvas';

export function readCanvasHtml(): string { /* cached read of mcp-app dist/index.html */ }

export function canvasMeta(state: {
  kind: 'navigate' | 'create';
  flowSlug?: string;
  nodeId?: string;
  projectSlug?: string;
  justCreated?: boolean;
  backendUrl: string;
}) {
  return {
    'openai/outputTemplate': CANVAS_RESOURCE_URI,
    'openai/widgetState': state,
    'openai/widgetAccessible': true,
  };
}
```

**Server registration:** the MCP server's `resources/list` and `resources/read` handlers gain `ui://seeflow/canvas` returning `{ mimeType: 'text/html+skybridge', text: readCanvasHtml() }`.

**Per-tool patches in `mcp.ts`** (line numbers from current 785-line file):

- `seeflow_get_flow` (L316) → `_meta: canvasMeta({ kind: 'navigate', flowSlug, backendUrl })`
- `seeflow_get_flow_graph` (L334) → same
- `seeflow_get_node` (L361) → pass `nodeId` through
- `seeflow_register_flow` (L405) → `kind: 'create', justCreated: true, flowSlug: result.slug`
- `seeflow_create_project` (L445) → `kind: 'create', projectSlug: result.slug`

All others (L176, 185, 197, 238, 289, 429, 466, 494, 532, 561, 590, 620, 656) stay untouched.

`studio.httpUrl` is filled in once `serve({ port: 0 })` resolves and plumbed down to tool registration via the existing `createMcpServer({ studio })` factory.

**Backwards compat:** `_meta` is additive and ignored by hosts that don't grok `openai/outputTemplate`. Existing integration tests pass without modification.

## Section 5 — CORS, lifecycle, port handling

**Ephemeral port pickup.** `serve({ port: 0, fetch: app.fetch })` returns the bound address. Capture into `studio.httpUrl = http://127.0.0.1:${server.port}` *before* the MCP server hands out tool results. If binding fails, surface a `notifications/message` error and the stdio server falls back to JSON-only — canvas just doesn't render. Don't crash.

**CORS.** Existing Hono CORS middleware is permissive only for `localhost:5173` today. Extend to allow:

- `Origin: null` (sandboxed iframes)
- any origin when the request carries an `X-Seeflow-Token` header matching the per-process token

The token is generated at studio boot, kept in memory, never persisted. Without it, requests from `null` origin are rejected. The token is delivered to the iframe via `widgetState.backendToken` (added to the meta shape). Prevents drive-by access from other localhost software.

**Lifecycle.** Stdio close → `server.close()` → port released. Register `process.on('SIGINT' | 'SIGTERM' | 'beforeExit')` and bind to the stdio transport's `onclose` so a host killing the subprocess actually frees the port. Integration test boots, captures port, kills, asserts port is free.

**One-instance guard:** if `seeflow studio` is already running on 4321, no conflict — we're on `:0`. Two studios coexist; they don't share state. Acceptable for single-user reality.

## Section 6 — Testing strategy

**Unit (`apps/studio/src/mcp-ui.test.ts`, new).** Pure tests for `canvasMeta()`. Verify shape for each tool — `kind`, `justCreated`, `backendUrl` injection, `nodeId` only present when supplied.

**MCP parity (extend `apps/studio/src/mcp-parity.test.ts`).** Every canvas-bearing tool must include `_meta['openai/outputTemplate'] === CANVAS_RESOURCE_URI`. Every other tool must NOT. Catches the mistake of attaching canvas to a mutation tool.

**MCP integration (`apps/studio/integration/mcp-apps.it.ts`, new).** Spawn the real `seeflow-mcp` binary, drive it via `integration/support/mcp-client.ts`. Assert:

1. `resources/list` includes `ui://seeflow/canvas`.
2. `resources/read` returns `text/html+skybridge` and non-empty HTML.
3. `seeflow_register_flow` returns `_meta` with `kind: 'create'` and a `backendUrl` that responds 200 on `/api/flows`.
4. CORS: request from `Origin: null` with token succeeds; without token, fails.
5. Lifecycle: kill subprocess, port released within 2s.

**E2E (`apps/studio/e2e/mcp-app.spec.ts`, new).** Playwright loads `apps/mcp-app/dist/index.html` directly with a mocked `window.openai` shim. Asserts:

- create-mode renders edit affordances + "just created" highlight
- navigate-mode with `nodeId` opens the detail panel
- dragging a node fires a debounced `updateModelContext` (one call after 250ms, not per pixel)
- adding a node fires `sendMessage`

Visual baselines pinned to `chromium-linux` per repo convention.

## Section 7 — Scope cuts & rollout

**Out of scope (YAGNI):**

- Multi-host support beyond Claude Desktop.
- State persistence across tool calls.
- Auth beyond per-process token.
- Bundle code-splitting beyond what `@seeflow/canvas` already does.
- Custom resource per tool.
- Showing canvas on the 18 mutation tools.

**Rollout (six PRs, each shippable on its own):**

1. `apps/mcp-app/` workspace skeleton + build pipeline. Single inlined HTML; canvas renders against a manually-pointed `backendUrl`.
2. `mcp-ui.ts` + ephemeral HTTP boot in `seeflow-mcp` + CORS/token. No tool changes yet.
3. Patch the 5 tool handlers to attach `_meta`. Unit + parity + integration tests in the same PR.
4. `window.openai` bridge (`bridge.ts`) + e2e shim tests.
5. Manual verification in Claude Desktop. Screenshot for PR description.
6. `README.md` "MCP Apps" section.

## Open questions

None blocking. Implementation can start at step 1.

## References

- Existing MCP server: `apps/studio/src/mcp.ts` (785 lines)
- Existing MCP shim: `apps/studio/src/mcp-shim.ts`
- Canvas package: `packages/canvas/` (exports `createRestAdapter`, `CanvasAdapter`, edit-mode UI)
- Studio Hono entry: `apps/studio/src/` (existing CORS middleware)
- Repo CLAUDE.md: `/CLAUDE.md` (Bun + Hono/bun, Biome, Zod schema at `apps/studio/src/schema.ts`, `design/design.html` UI source of truth)
