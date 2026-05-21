# SeeFlow

Local studio that hosts file-defined demos as React Flow canvases wired to a running app via REST + SSE + Zod schema.

## Workspace

- `apps/studio/` — Bun + Hono backend + CLI (`seeflow`)
- `apps/web/` — Vite + React + React Flow SPA
- `skills/`, `commands/`, `.claude-plugin/` — Claude Code plugin (at repo root) that generates demos

## Toolchain

- **Bun** (`>= 1.3`) — never node.
- **Hono** via `hono/bun` — never `@hono/node-server`.
- **Zod** schema at `apps/studio/src/schema.ts` (single source of truth).
- **Biome** for lint/format. Run `bun run format` before `bun run lint`.

## Design System

**`design/design.html`** is the single source of truth for all UI/UX work. You MUST reference it before making any frontend changes — colors, typography, spacing, components, motion, and copy voice are all defined there. Never deviate from its tokens or patterns.

## Commands

```bash
bun run dev         # Vite (5173) + Hono studio (4321)
bun run typecheck
bun run lint
bun test
```

`make help` lists Makefile wrappers.

## Visual baselines

Playwright e2e tests in `apps/studio/e2e/` include pixel-level snapshot
assertions. Baselines are pinned to **chromium-linux** so they match CI.
`bun run test:it:e2e` (and the orchestrator under `bun run test:it`) auto-
routes through the official Playwright Docker image on non-Linux hosts —
Docker Desktop must be running. To regenerate baselines after an
intentional UI change, run `bun run test:it:update-snapshots` and commit
the resulting `*-chromium-linux.png` files. Never commit `*-darwin.png` or
other host-specific snapshots.
