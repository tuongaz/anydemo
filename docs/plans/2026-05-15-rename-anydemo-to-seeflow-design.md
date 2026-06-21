# Rename anydemo → seeflow

## Scope

Full brand rename from `anydemo` / `SeeFlow` to `seeflow` / `SeeFlow`. The root directory rename is handled manually by the operator.

## Changes by category

### 1. Package names and binaries

| Location | Current | New |
|---|---|---|
| Root `package.json` name | `anydemo` | `seeflow` |
| Root `package.json` bin | `anyflow`, `anydemo` | `seeflow` |
| `apps/studio/package.json` name | `@tuongaz/anyflow` | `@tuongaz/seeflow` |
| `apps/studio/package.json` bin | `anyflow`, `anydemo`, `anydemo-mcp` | `seeflow`, `seeflow-mcp` |
| `apps/studio/bin/anydemo` | rename to `bin/seeflow` | |
| `apps/studio/bin/anydemo-mcp` | rename to `bin/seeflow-mcp` | |
| `apps/web/package.json` name | `@anydemo/web` | `@seeflow/web` |
| `packages/sdk/package.json` name | `@anydemo/sdk` | `@seeflow/sdk` |

`anyflow` alias is dropped — single clean `seeflow` binary.

### 2. Filesystem convention: `.seeflow/` → `.seeflow/`

Source files with path references to update:
- `apps/studio/src/cli.ts` — `DEFAULT_DEMO_PATH` constant
- `apps/studio/src/watcher.ts` — path join
- `apps/studio/src/runtime.ts` — `~/.seeflow/config.json` and `~/.seeflow/anydemo.pid`
- `apps/studio/src/sdk-writer.ts` — `.seeflow/sdk/` path
- `apps/studio/src/schema.ts` — validation error messages and comments
- `apps/studio/src/api.ts` — comment
- `apps/studio/src/mcp.ts` — comment
- `apps/web/src/components/empty-state.tsx` — user-visible text
- `apps/web/src/components/create-project-dialog.tsx` — user-visible text

Physical directories to rename:
- `examples/checkout-demo/.seeflow/` → `.seeflow/`
- `examples/order-pipeline/.seeflow/` → `.seeflow/`
- `examples/todo-demo-target/.seeflow/` → `.seeflow/`

### 3. CSS tokens, class names, and web UI text

In `apps/web/src/index.css`:
- `--anydemo-*` CSS custom properties → `--seeflow-*`
- `anydemo-*` keyframe names → `seeflow-*`
- `.anydemo-*` class selectors → `.seeflow-*`

In component source files (class names and CSS var references):
- `apps/web/src/components/demo-canvas.tsx`
- `apps/web/src/components/nodes/state-node.tsx`
- `apps/web/src/components/nodes/play-node.tsx`
- `apps/web/src/components/nodes/shape-node.tsx`
- `apps/web/src/components/nodes/shapes/types.ts`
- `apps/web/src/components/edges/editable-edge.tsx`
- `apps/web/src/components/command-palette.tsx`
- `apps/web/src/components/canvas-toolbar.tsx`

User-visible text:
- `header.tsx`: `"SeeFlow Studio"` → `"SeeFlow Studio"`
- `empty-state.tsx`: brand name and `npx anydemo register` → `npx seeflow register`
- DnD MIME type: `application/x-anydemo-create-html-block` → `application/x-seeflow-create-html-block`
- localStorage key: `anydemo:command-palette:recent` → `seeflow:command-palette:recent`

### 4. Agents, skills, plugin

Files to rename (and update content within):
- `agents/seeflow-discoverer.md` → `agents/seeflow-discoverer.md`
- `agents/seeflow-discoverer.smoke.md` → `agents/seeflow-discoverer.smoke.md`
- `agents/seeflow-node-planner.md` → `agents/seeflow-node-planner.md`
- `agents/seeflow-play-designer.md` → `agents/seeflow-play-designer.md`
- `agents/seeflow-status-designer.md` → `agents/seeflow-status-designer.md`
- `skills/create-seeflow/` → `skills/create-seeflow/` (all files within)

Plugin:
- `.claude-plugin/plugin.json`: name and description

### 5. Docs, READMEs, CLAUDE.md, ralph, test fixtures

Text search-and-replace pass on:
- `CLAUDE.md`
- `README.md`
- `apps/studio/README.md`
- `ralph/prd.json`, `ralph/CLAUDE.md`
- `docs/plans/` files (where brand name appears)
- All test files referencing `.seeflow/` path strings

## Out of scope

- Root directory rename (operator handles manually)
- GitHub remote URL update (separate step after dir rename)
- Memory system path migration (happens automatically after dir rename)
