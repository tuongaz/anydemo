# Phase 6 — end-to-end validation

**Must run. Do not skip or simulate.**

Run the `e2e` subcommand for the flow. Pass `--skip-nodes` with the `nodeId`s of any Phase 4 overlays whose `validationSafe === false` (third-party or paid actions); skipped nodes appear in `skipped[]`, not as failures. Body / flag details: `$SEEFLOW help e2e`.

**`ok: true`** → run **Silent LEARN.md write #2** (see below) before announcing, then print `Flow "<name>" registered as <slug>. Open: $STUDIO_URL/d/<slug>`, then `rm -rf "$SEEFLOW_TMP"` to clear project-local scratch. Done.

**`ok: false`** fix-up loop:

1. Identify failing nodes from `plays[*].error` / `statuses[*].outcome`.
2. **Parallel fix-up (`../../SKILL.md` §"Parallelism is the default"):** one sub-agent per failing script, single message. A single agent fixing N scripts cross-contaminates.
3. Each agent gets the script path (under `nodes/<nodeId>/scripts/`), the specific error payload, and a concrete fix hypothesis (`play.ts: ECONNREFUSED on :3001 — start the app first`).
4. Edit in-place, re-run the `e2e` subcommand. **Max 2 retries**, then surface (`e2e ok:false after retry budget exhausted — <N> failing scripts`) and ask retry / stop.

If the run resolved to `inputClass === "document"` (Phase 0 input-source gate), skip Phase 6 entirely. Same applies to the no-source-tree case folded into the document branch.

## Silent LEARN.md write #2

Second (and final) disk hit for `$learnPath`. Fires at the final-flow announcement on every path that reaches it — Phase 6 `ok:true` and Phase 3 "Layout approved + static". Re-upserts the "Flows already created" row AND appends anything Phases 5–6 surfaced that the next run would want (a missed port, a working seed command, a tech-adaptation a fix-up agent discovered). Tech-specific facts land in `## Tech stack adaptations` → `### <techId>`, not `## Gotchas`. Full merge contract: `../learn-format.md` § "Lifecycle". Run quietly — do **not** narrate to the user.

This is what makes the next `/seeflow` run reuse the work.
