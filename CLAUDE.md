# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# SeeFlow

Local studio that hosts file-defined demos as React Flow canvases wired to a running app via REST + SSE + Zod schema. Published as `@tuongaz/seeflow` with bin entrypoints `seeflow` (CLI / studio daemon) and `seeflow-mcp` (MCP server, also boots an embedded studio for MCP-Apps hosts).

## Workspace

Bun workspaces under `apps/*` and `packages/*`:

- `apps/studio/` — Bun + Hono backend, CLI, MCP server. Published package; source of truth for the Zod schema (`src/schema.ts`).
- `apps/web/` — Vite + React SPA. Embeds `@seeflow/canvas`; built into `apps/studio/dist/web/` at publish time.
- `apps/mcp-app/` — Single-file Vite bundle that mounts the canvas inside an MCP-Apps host iframe (Claude Desktop). See `apps/mcp-app/CLAUDE.md`.
- `packages/canvas/` (`@seeflow/canvas`) — Embeddable React Flow canvas with its own compiled CSS (`sf:` Tailwind v4 prefix). See `packages/canvas/CLAUDE.md` for the deep rules (public API, peer deps, modes, ref handle).
- `skills/`, `.claude-plugin/`, `.cursor-plugin/` — Claude Code / Cursor plugin shipping the `seeflow` + `seeflow-lookup` skills.

**Per-package CLAUDE.md files at `apps/mcp-app/CLAUDE.md` and `packages/canvas/CLAUDE.md` carry rules that override anything generic here.** Read them before editing those packages.

## Toolchain

- **Bun** (`>= 1.3`) — never node. Hono is imported via `hono/bun`, never `@hono/node-server`.
- **Zod schema** at `apps/studio/src/schema.ts` — single source of truth. The plugin's vendored copy at `skills/seeflow/vendored/schema.ts` MUST be kept in sync: run `make sync-seeflow-schema` after any schema edit (CI gates on `make verify-seeflow-schema-sync`).
- **Biome** for lint + format. Run `bun run format` BEFORE `bun run lint`. Style: 2-space indent, 100-char line width, single quotes, trailing commas, semicolons.
- **TypeScript strict + `noUncheckedIndexedAccess`** (`tsconfig.base.json`). `bun run typecheck` fans out across workspaces.

## Design system

`design/design.html` is the single source of truth for all UI/UX work — colors, typography, spacing, components, motion, copy voice. Reference it before any frontend change. Never deviate from its tokens or patterns.

## Commands

```bash
bun run dev         # Vite (5173) + Hono studio (4321), both hot-reloading
                    # `predev` builds @seeflow/canvas first; a separate watcher
                    # rebuilds the canvas Tailwind CSS in dev.
bun run typecheck   # tsc --noEmit across all workspaces
bun run lint        # biome check .
bun run format      # biome format --write . (run before lint)
bun test            # all *.test.ts unit tests (tests live beside sources)
bun test path/to/foo.test.ts   # single test file
```

`make help` lists Makefile wrappers (`make dev`, `make register DIR=…`, `make demo`, `make docker.build`, `make sync-seeflow-schema`, etc.).

## Tests

- **Unit:** `foo.ts` + `foo.test.ts` side-by-side throughout each workspace. `bun test` discovers them.
- **Integration:** `apps/studio/integration/*.it.ts` — bun-test files that spawn the studio via the harness in `integration/support/`. Run with `bun run test:it:bun` or via the orchestrator `bun run test:it` (which also runs e2e). Bun's directory discovery does NOT pick up `*.it.ts`, so use the npm script glob.
- **E2E:** `apps/studio/e2e/*.e2e.ts` — Playwright. `bun run test:it:e2e` dispatches to the official Playwright Docker image on non-Linux hosts so visual baselines stay pinned to chromium-linux pixels (Docker Desktop must be running).
- **Visual baselines:** pinned to **chromium-linux** to match CI. Regenerate via `bun run test:it:update-snapshots` and commit the resulting `*-chromium-linux.png` files. Never commit `*-darwin.png` or other host-specific snapshots.
- The integration orchestrator (`apps/studio/scripts/test-integration.ts`) checks freshness of `apps/studio/dist/web/index.html` AND `apps/mcp-app/dist/index.html` against their sources and rebuilds when stale — a canvas-source edit silently invalidates both bundles.
