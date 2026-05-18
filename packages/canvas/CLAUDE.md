# @seeflow/canvas

Embeddable React Flow canvas. See `README.md` for the full public API.

## Rules

- **Public API:** `src/index.ts` only. Host apps must `import { ... } from '@seeflow/canvas'` — never deep-import from `packages/canvas/src/...`.
- **Internal imports:** relative paths (`'../lib/foo.ts'`). No `@/` aliases here — those belong to `apps/web`.
- **Peer deps** (`react`, `react-dom`, `@xyflow/react`, `lucide-react`, `react-markdown`, `remark-gfm`): the host provides them. Do not move them into `dependencies`. `react-markdown` + `remark-gfm` back the built-in sidebar's status section.
- **Tailwind:** package ships unstyled. Host JIT-scans this source — keep classes literal (no dynamic class strings).
- **Adapter seam:** edit mode requires a `CanvasAdapter` (`src/adapter/types.ts`). All mutations route through it — never call `fetch` from inside the canvas.

## Workflow

- Tests live beside sources (`foo.ts` + `foo.test.ts`). Run `bun test` from the repo root.
- Typecheck: `cd packages/canvas && bun run typecheck`, or `bun run typecheck` from root for all workspaces.
- When adding a public export, add it to `src/index.ts` in the matching numbered section and keep the barrel sorted within the section.
