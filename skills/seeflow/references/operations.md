# Operations — error handling, studio API, sub-agents

## Error-handling table

| Failure | Response |
|---|---|
| Studio `/health` fails | Ask the user to run `npx tuongaz/seeflow start` in another terminal, then re-probe once. No silent retry, no self-start. |
| Sub-agent unparseable output | Retry that single agent once with parse error; if still failing, surface and stop. Do **not** restart its parallel sibling. |
| Schema validation fails (Phase 5) | Feed Zod issues back to relevant designer. Max 3 retries. |
| Register 400 (Phase 6) | Show body; ask "fix-and-retry / stop". |
| Register 4xx/5xx other | Show body; stop. |
| Play `{error: "…"}` (Phase 7) | Edit scripts in-place; re-run Phase 7 (max 2 retries). Do NOT re-register. |
| Status SSE timeout 10s | Mark `no status received`; include in fix-up or ask retry/stop. |
| Validation >2 min | `ok:false`; treat as failure → fix-up path. |

Retry caps: Phase 5 schema → **3**. Phase 7 fix-up → **2**.

## Studio API touchpoints

| Endpoint | Method | Phase | Body |
|---|---|---|---|
| `/health` | GET | 0 | — |
| `/api/validate` | POST | 3, 5 | `{flow, style}` |
| `/api/flows/register` | POST | 3, 6 | `{name, repoPath, flowPath}` |
| `/api/flows/:id` | GET | 7 | — |
| `/api/flows/:id/play/:nodeId` | POST | 7 | — |
| `/api/events?flowId=:id` | GET (SSE) | 7 | — |
| `/api/flows/:id` | DELETE | rollback only | — |

Never invent endpoints. Surface anything outside this table to the user.

## Sub-agent reference

| Agent | Tools | Used for |
|---|---|---|
| `seeflow-code-analyzer` | `Read, Grep, Glob, LS, Bash` (read-only) | Phase 1 (parallel): user-prompt-specific brief — scope, code pointers, endpoints, tech stack, edit-case |
| `seeflow-system-analyzer` | `Read, Grep, Glob, LS, Bash` (read-only) | Phase 1 (parallel): request-agnostic brief — runtime, dev setup, integration tests, fixtures, gotchas, tech adaptations; populates `WIKI.md` |
| `seeflow-node-planner` | none (pure reasoning) | Phase 2: pick nodes + connectors (starts as soon as code-analyzer returns) |
| `seeflow-play-designer` | `Read, Grep, Glob, LS` | Phase 4: design playActions + script bodies |
| `seeflow-status-designer` | `Read, Grep, Glob, LS` | Phase 4: design statusActions + script bodies |

Full prompts + worked examples in `skills/seeflow/agents/<agent>.md`.

## General orchestration rule — parallelise sub-agents

Whenever two or more tasks are independent, dispatch them as concurrent sub-agents in a single message. Serial execution is the exception, not the default.

## Helper scripts

Bun scripts shipped with the skill, invoked from phase steps:

| Script | Purpose | Invoked in |
|---|---|---|
| `scripts/register.ts` | POST to `/api/flows/register` with `{name, repoPath, flowPath}`. Prints `{id, slug}` on success | Phase 3, Phase 6 |
| `scripts/validate.ts` | POST `{flow, style?}` to `/api/validate`. Exits 1 + prints issues on failure | Phase 3, Phase 5 |
| `scripts/refresh-layout.ts` | POST to `/api/flows/<id>/layout` to rebuild `style.json` via ELK | Phase 3, Phase 5, Phase 7 |
| `scripts/validate-end-to-end.ts` | GET flow, open SSE, fire plays, await results | Phase 7 |
| `scripts/unregister.ts` | DELETE a registered flow (rollback) | rollback only |
| `scripts/studio-config.ts` | Resolve `$STUDIO_URL` from env + `~/.seeflow/config.json` | shared helper |
