# Canvas Extraction — Plan Index

> Sibling design doc: `2026-05-18-canvas-package-extraction-design.md`

Five phases. Each is a separate PR. Move bottom-up; each phase compiles and tests green before the next begins.

| Phase | Plan | What ships |
|---|---|---|
| 1 | `2026-05-18-canvas-phase-1-pure-utilities.md` | 5 pure utilities + `dagre` dep |
| 2 | `2026-05-18-canvas-phase-2-nodes-and-edges.md` | All node/edge components + supporting helpers (`cn`, `inline-edit`, `file-url`, etc.) |
| 3 | `2026-05-18-canvas-phase-3-chrome-components.md` | Toolbar, style-strip, detail-panel, selection-resize-overlay, deferred `node-defaults` + `last-used-style` |
| 4 | `2026-05-18-canvas-phase-4-orchestrator.md` | `demo-canvas.tsx` → `seeflow-canvas.tsx`, adapter interface, `mode` flag |
| 5 | `2026-05-18-canvas-phase-5-wire-apps-web.md` | `apps/web` becomes a thin consumer of `<SeeflowCanvas>` |

## Decisions deferred to specific phases

- **Phase 2 / Task 0:** UI primitives strategy — `apps/web/src/components/ui/*` (Radix wrappers) must be accessible from `@seeflow/canvas`. Options listed in the Phase 2 plan; pick before starting.
- **Phase 4 / Task 0:** Whether to refactor in place (in `apps/web`, then move to the package) or move first (cosmetic move, then refactor). Plan recommends refactor-in-place because `@/` aliases don't resolve from `packages/canvas`.

## Out of scope across all phases

- Storybook / isolated demo environment for the package.
- Publishing to npm (package stays `private: true`).
- Schema tightening on `NodeData.kind`.
- A non-React canvas binding.

## Working agreement

- One commit per task. No batching.
- No re-export shims in `apps/web/src/lib/`. Imports update in the same commit as the move.
- Format BEFORE lint (`bun run format` → `bun run lint`), per `CLAUDE.md`.
- After each phase: `bun run typecheck`, `bun test`, `bun run lint`, `bun run dev` smoke test.
