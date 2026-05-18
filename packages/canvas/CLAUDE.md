# @seeflow/canvas

Embeddable React Flow canvas. See `README.md` for the full public API.

## Rules

- **Public API:** `src/index.ts` only. Host apps must `import { ... } from '@seeflow/canvas'` — never deep-import from `packages/canvas/src/...`.
- **Internal imports:** relative paths (`'../lib/foo.ts'`). No `@/` aliases here — those belong to `apps/web`.
- **Peer deps** (`react`, `react-dom`, `@xyflow/react`, `lucide-react`, `react-markdown`, `remark-gfm`): the host provides them. Do not move them into `dependencies`. `react-markdown` + `remark-gfm` back the built-in sidebar's status section.
- **Tailwind:** package ships its own compiled CSS at `dist/style.css`. Internal classes use the `sf-` prefix (configured in `tailwind.config.cjs`); the codemod at `scripts/prefix-tailwind.mjs` keeps the source in sync. All non-utility globals (tokens, react-flow overrides, keyframes) live in `src/styles/index.css` scoped under `.seeflow-canvas-root` so the consumer's `:root` and global stylesheet stay untouched. Keep class strings literal (no dynamic `sf-${var}` interpolation) so the build picks them up. Re-run `bun run --filter @seeflow/canvas build` after edits; the GitHub Action commits `dist/` on `main` for external consumers.
- **Radix portals:** every Radix `Portal` in `src/ui/` and `src/components/` threads `container={useCanvasPortalContainer()}` so popovers/dropdowns/dialogs land INSIDE `.seeflow-canvas-root` and inherit the scoped CSS. New wrappers must do the same; otherwise their content gets portaled to `document.body` and loses the canvas's theme tokens.
- **Adapter seam:** edit mode requires a `CanvasAdapter` (`src/adapter/types.ts`). All mutations route through it — never call `fetch` from inside the canvas.
- **Built-in sidebar:** `<SeeflowCanvas>` renders `<DetailPanel>` internally — driven by `selectedNodeIds[0]` / `selectedConnectorIds[0]`. Hosts pass `onNameChange` / `onDescriptionChange` / `onDetailChange` field-edit callbacks and a single `statusReport` for the selected node directly into the canvas. `disableSidebar={true}` suppresses it (custom inspector). `CanvasAdapter` does NOT expose its bound demoId — use the existing `projectId` prop for the sidebar's `demoId` lookup.
- **Auto-fit-view:** opt-in via `autoFitView?: boolean | { onMount?: boolean; onExternalNodeChange?: boolean }`. `undefined` / `false` → no auto-fit. `true` → fit on mount once nodes load AND fit when `autoFitViewSignal` bumps. Every internal fitView call (manual button, mount-fit, signal-fit, deferred flush) goes through the module-level `FIT_VIEW_OPTIONS` constant — never inline literals. The mount-fit fires from BOTH the `<ReactFlow>` `onInit` callback (primary path) AND a late-nodes `useEffect`; both serialize through `didMountFitRef` so the fit fires exactly once.
- **External-change fit (`autoFitViewSignal`):** host bumps a monotonic counter when an SSE / adapter update changes the node set. The signal-watching effect (deps: `[autoFitViewSignal]`) skips its first run via `signalEffectMountedRef` so it doesn't double-fire with the mount-fit. While a node drag (`draggingRef`) or resize (`resizingRef`) is in flight, the would-be fit is stashed in `pendingFitRef` and flushed by `flushPendingFit()` from `setResizing(false)` / `onNodeDragStop` / `onSelectionDragStop`. The flag itself (`onExternalNodeChange`) is read from `resolvedAutoFitViewRef` inside the effect — listing it in the deps array would cause spurious fits when the host flips the flag without bumping the signal.

## Workflow

- Tests live beside sources (`foo.ts` + `foo.test.ts`). Run `bun test` from the repo root.
- Typecheck: `cd packages/canvas && bun run typecheck`, or `bun run typecheck` from root for all workspaces.
- When adding a public export, add it to `src/index.ts` in the matching numbered section and keep the barrel sorted within the section.
