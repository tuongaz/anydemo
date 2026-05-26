# Phase 4 — design Play + Status (parallel)

Launch `seeflow-play-designer` + `seeflow-status-designer` in parallel (`../../SKILL.md` §"Parallelism is the default"). Both receive: context brief, node draft, edit target, tech-ref paths, matching `techAdaptations`, and `$schemaCache.action` + `$schemaCache.node` forwarded verbatim (see `p0-preflight.md` §"Schema cache"). They read each ref's **Play** / **Status** section and treat `techAdaptations` as the project override. Tools: `Read, Grep, Glob, LS`.

## Output shape

Both designers emit `{ nodeId, patch, scriptFile: {path, body, chmod}, validationSafe?, rationale }` triples. `patch` is the exact body for `seeflow nodes:patch --project <projectSlug> --flow <flowSlug>`. `scriptFile.path` is flow-folder-relative (`flows/<flowSlug>/nodes/<nodeId>/scripts/<name>`, i.e. anchored at `<repoPath>`); `playAction.scriptPath` inside `patch` stays node-folder-relative (`scripts/play.ts`). Full contracts: `../../agents/seeflow-play-designer.md`, `../../agents/seeflow-status-designer.md`.

## Sample data priority

Integration/e2e fixtures (`runtimeProfile.integrationTestDir`, copy verbatim) → seed / migration / ORM factories → README / OpenAPI / Postman examples → invent last, note in `rationale`.

## `newTriggerNodes`

Play-designer only. May inject synthetic sources (file-drop, webhook receiver) when no natural trigger exists. Shape: `{nodes, connectors}` — same as the planner's output.
