# Operations — error handling, CLI subcommands, sub-agents

## Error-handling table

| Failure | Response |
|---|---|
| Studio `/health` fails | Ask the user to run `seeflow start` (resolved per the Conventions table in `SKILL.md` — installed binary if present, else `npx -y @tuongaz/seeflow@latest start`) in another terminal, then re-probe once. No silent retry, no self-start. |
| Sub-agent unparseable output | Retry that single agent once with parse error; if still failing, surface and stop. Do **not** restart its parallel sibling. |
| CLI exits with `badSchema` (any phase) | Feed `issues[]` back to the agent that produced the payload (planner in P3, designer in P5). Max 3 retries per node. |
| CLI exits with `idAlreadyExists` / `duplicateIdInBatch` | Dedupe / rename / delete the existing item; do not retry blind. |
| CLI exits with `flowNotFound` / `unknownNode` | Re-fetch via `seeflow flows:list` or `seeflow flows:get <id>`; the id is stale. |
| `seeflow e2e` reports `play.error` (Phase 6) | Edit script in-place; re-run `seeflow e2e` (max 2 retries). Do NOT re-register. |
| `seeflow e2e` status SSE timeout 10s | Mark `no status received`; include in fix-up or ask retry/stop. |
| `seeflow e2e` exceeds ~2 min hard ceiling | `ok:false`; treat as failure → fix-up path. |

Retry caps: P5 per-node patch failure → **3** (re-dispatch that one designer). P6 e2e fix-up → **2**.

## CLI subcommands

Full per-subcommand reference: `references/cli.md`. Quick lookup by phase:

| Phase | Subcommand | Purpose |
|---|---|---|
| P0 | (curl `/health`) | Studio probe — not a CLI call |
| P3 | `projects:create` | Scaffold + register new project |
| P3 | `nodes:add-bulk` | Atomic seed of skeleton nodes |
| P3 | `connectors:add-bulk` | Atomic seed of skeleton connectors |
| P3 | `flows:layout` | Run ELK; rewrite style.json positions |
| P5 | `nodes:patch` | Attach playAction / statusAction / stateSource per node |
| P5 | `nodes:add-bulk` | Inject synthetic trigger nodes |
| P5 | `connectors:add-bulk` | Wire trigger nodes |
| P5 | `flows:layout` | Re-layout after Phase 5 changes |
| P6 | `e2e` | End-to-end validation via SSE |
| any | `flows:list`, `flows:get` | Discovery / id lookup |
| rollback | `flows:delete`, `nodes:delete`, `connectors:delete` | Undo |

Every write is validated server-side by the studio's post-merge `ResolvedFlowSchema` reparse. There is no standalone validation step — a `badSchema` exit from any mutation is the validation feedback.

## Sub-agent reference

| Agent | Tools | Used for |
|---|---|---|
| `seeflow-code-analyzer` | `Read, Grep, Glob, LS, Bash` (read-only) | P1 (parallel): user-prompt-specific brief — scope, code pointers, endpoints, tech stack, edit-case |
| `seeflow-system-analyzer` | `Read, Grep, Glob, LS, Bash` (read-only) | P1 (parallel): request-agnostic brief — runtime, dev setup, integration tests, fixtures, gotchas, tech adaptations; populates `WIKI.md` |
| `seeflow-node-planner` | none (pure reasoning) | P2: pick nodes + connectors (starts as soon as code-analyzer returns) — emits payloads in `nodes:add-bulk` / `connectors:add-bulk` shape |
| `seeflow-play-designer` | `Read, Grep, Glob, LS` | P4: design playActions + script bodies — emits `{patch, scriptFile}` triples for P5 |
| `seeflow-status-designer` | `Read, Grep, Glob, LS` | P4: design statusActions + script bodies — same triple shape |

Full prompts + worked examples in `skills/seeflow/agents/<agent>.md`.

## General orchestration rule — parallelise sub-agents

Whenever two or more tasks are independent, dispatch them as concurrent sub-agents in a single message. Serial execution is the exception, not the default. The canonical wrong/right block lives in `SKILL.md` Phase 1; later phases reference it.
