# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# SeeFlow

Localhost studio that renders file-defined, Zod-validated flows as React Flow canvases and keeps every open canvas in sync over REST + SSE. Published as `@tuongaz/seeflow` with bin entrypoints `seeflow` (CLI / studio daemon) and `seeflow-mcp` (MCP server, also boots an embedded studio for MCP-Apps hosts).

## Workspace

Bun workspaces under `apps/*` and `packages/*`:

- `apps/studio/` — Bun + Hono backend, CLI, MCP server. Published package; source of truth for the Zod schema (`src/schema.ts`).
- `apps/web/` — Vite + React SPA. Embeds `@seeflow/canvas`; built into `apps/studio/dist/web/` at publish time.
- `apps/mcp-app/` — Single-file Vite bundle that mounts the canvas inside an MCP-Apps host iframe (Claude Desktop). See `apps/mcp-app/CLAUDE.md`.
- `packages/canvas/` (`@seeflow/canvas`) — Embeddable React Flow canvas with its own compiled CSS (`sf:` Tailwind v4 prefix). See `packages/canvas/CLAUDE.md` for the deep rules (public API, peer deps, feature flags, ref handle).
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

## Icon packs

- Cloud vendor icons (AWS and Azure — the only vendors with installable packs) install into `~/.seeflow/icons/<vendor>/<version>/` with a shared `index.json`. Same root regardless of CLI vs studio entrypoint — both share the registry via `apps/studio/src/icons/jobs.ts`.
- Vendor-prefixed icon ids (`aws:lambda`, `gcp:cloud-run`, `azure:functions`, `iconify:logos:google-cloud`) round-trip through the schema; unprefixed names default to Lucide.
- CLI: `seeflow icons list | add <vendor> [--accept-terms] [--pack-url <url>] | update <vendor> | remove <vendor>`. Each subcommand is in `COMMAND_MANIFEST` and surfaces under `seeflow help icons:*`.
- HTTP: `/api/icons/*` mounted in `apps/studio/src/api.ts`. Install jobs serialize per vendor via an in-process `JobRegistry`; a parallel install of the same vendor returns 409 with the in-flight `jobId`. SSE replays buffered events for late subscribers.
- Azure carries `requiresAcceptance: true` in `apps/studio/src/icons/vendors.ts` — the installer yields `terms-required` and returns early unless `acceptTerms` is set.
- Add a new vendor: create `normalize-<vendor>.ts`, register a `VendorDescriptor` entry, extend `IconVendor` in `packages/canvas/src/lib/icon-id.ts` AND `apps/studio/src/icons/paths.ts`, mirror the new vendor in `ICON_NAMES_BY_VENDOR` + `summarizePacks` + the picker's tab list, then add an integration test under `apps/studio/integration/icons-install.it.ts`.

## Tests

- **Unit:** `foo.ts` + `foo.test.ts` side-by-side throughout each workspace. `bun test` discovers them.
- **Integration:** `apps/studio/integration/*.it.ts` — bun-test files that spawn the studio via the harness in `integration/support/`. Run with `bun run test:it:bun` or via the orchestrator `bun run test:it` (which also runs e2e). Bun's directory discovery does NOT pick up `*.it.ts`, so use the npm script glob.
- **E2E:** `apps/studio/e2e/*.e2e.ts` — Playwright. `bun run test:it:e2e` dispatches to the official Playwright Docker image on non-Linux hosts so visual baselines stay pinned to chromium-linux pixels (Docker Desktop must be running).
- **Visual baselines:** pinned to **chromium-linux** to match CI. Regenerate via `bun run test:it:update-snapshots` and commit the resulting `*-chromium-linux.png` files. Never commit `*-darwin.png` or other host-specific snapshots.
- The integration orchestrator (`apps/studio/scripts/test-integration.ts`) checks freshness of `apps/studio/dist/web/index.html` AND `apps/mcp-app/dist/index.html` against their sources and rebuilds when stale — a canvas-source edit silently invalidates both bundles.
