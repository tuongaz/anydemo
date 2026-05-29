# Operations — error handling, CLI subcommands, sub-agents

## Error-handling table

| Failure | Response |
|---|---|
| Studio `/health` fails | Ask the user to run the CLI's `start` subcommand in another terminal, then re-probe once. No silent retry, no self-start. |
| Sub-agent unparseable output | Retry that single agent once with parse error; if still failing, surface and stop. Do **not** restart its parallel sibling. |
| CLI exits with `badSchema` (any phase) | Feed `issues[]` back to the agent that produced the payload (planner in P3, designer in P5). Max 3 retries per node. |
| CLI exits with `idAlreadyExists` / `duplicateIdInBatch` | Dedupe / rename / delete the existing item; do not retry blind. |
| CLI exits with `project-not-found` / `flow-not-found` / `unknownNode` | Re-fetch via `projects:list` (for project slugs), `flows:list --project <p>` (for flow slugs in a project), or `flows:get --project <p> --flow <f>`; the slug is stale. |
| `e2e` reports `play.error` (Phase 6) | Edit script in-place; re-run `e2e` (max 2 retries). Do NOT re-register. |
| `e2e` status SSE timeout | Mark `no status received`; include in fix-up or ask retry/stop. |
| `e2e` exceeds its hard ceiling | `ok:false`; treat as failure → fix-up path. |

Retry caps: P5 per-node patch failure → **3** (re-dispatch that one designer). P6 e2e fix-up → **2**.

## CLI subcommands

Per-subcommand reference lives in the CLI itself — run `$SEEFLOW help` for the full list and `$SEEFLOW help <command>` for any one. Every flow-scoped verb takes `--project <projectSlug> --flow <flowSlug>` — explicit pair, no compound id. Quick lookup by phase:

| Phase | Subcommand | Purpose |
|---|---|---|
| P0 | (curl `/health`) | Studio probe — not a CLI call |
| P0 | `schema {flow,node,connector,action,componentCatalog,style}` | Fetch the live contract once; cache for the rest of the run. Phase 2/4 reuse the cache instead of re-fetching. The `componentCatalog` category's `subnames` feed `$componentCatalog` for the planner |
| P3 | `projects:create` | Scaffold + register a new project: writes BOTH `<repoPath>/seeflow.json` (manifest with a single `flows[]` entry `{ id: 'main', name: 'Main' }`) AND `<repoPath>/flows/main/flow.json` (empty envelope) in one shot — returns `{ ok, id, slug }` where `slug` is the combined `"<projectSlug>/<flowSlug>"` (split on `/` to recover each). Required before the canvas can open at `$STUDIO_URL/projects/<projectSlug>/flows/<flowSlug>` |
| P3 | `register` | Re-scan an existing `seeflow.json` and re-attach every declared flow when the user picks "Open the existing project" at the gate (`phases/p3-scaffold.md` §"Existing-project gate"). Never used as an automatic fallback from `projects:create alreadyExists` — the gate always asks the user first |
| any | `flows:create --project <p> --flow <id> --name <n> [--icon <i>]` | Add a new flow to an existing project — atomically writes `flows/<id>/flow.json`, appends to the manifest, upserts the registry entry |
| any | `flows:rename --project <p> --flow <id> [--new-id <x>] [--name <n>] [--icon <i>]` | Rename a flow's id (atomic folder rename + manifest edit) and/or its display name / icon |
| any | `flows:delete --project <p> --flow <id> [--new-default <other>]` | Delete a flow — refuses to leave the project empty or without a default |
| any | `projects:list` | List every registered project with `projectSlug`, name, `defaultFlow`, `flowCount` |
| P3 | `ids` | Mint canonical `node-<10>` / `conn-<10>` ids |
| P3 | `flow:add-bulk --project <p> --flow <f>` | Atomic seed of skeleton nodes + connectors in one transactional write (rollback covers both arrays) |
| P3 | `nodes:patch --project <p> --flow <f>` (detail-backfill) | Unconditional sweep after `flow:add-bulk` — fills `data.detail` for any non-decorative node whose planner output left it missing or empty |
| P3 | `flows:layout --project <p> --flow <f>` | Run ELK; rewrite style.json positions |
| P5 | `nodes:patch --project <p> --flow <f>` | Attach playAction / statusAction / stateSource per node — also accepts an optional `type` field for non-destructive retype (preserves the per-node folder under `<repoPath>/flows/<flowSlug>/nodes/<id>/`) |
| P5 | `flow:add-bulk --project <p> --flow <f>` | Inject synthetic trigger nodes + wire them, atomically |
| P5 | `flows:layout --project <p> --flow <f>` | Re-layout after Phase 5 changes |
| P6 | `e2e --project <p> --flow <f>` | End-to-end validation via SSE |
| any | `flows:list`, `flows:get --project <p> --flow <f>` | Discovery / id lookup |
| rollback | `flows:delete --project <p> --flow <f>`, `nodes:delete --project <p> --flow <f> <nodeId>`, `connectors:delete --project <p> --flow <f> <connId>` | Undo |

Every write is validated server-side by the studio. There is no standalone validation step — a `badSchema` exit from any mutation is the validation feedback.

## Sub-agent reference

| Agent | Tools | Used for |
|---|---|---|
| `seeflow-code-analyzer` | `Read, Grep, Glob, LS, Bash` (read-only) | P1 (parallel): user-prompt-specific brief — scope, code pointers, endpoints, tech stack, edit-case |
| `seeflow-system-analyzer` | `Read, Grep, Glob, LS, Bash` (read-only) | P1 (parallel): request-agnostic brief — runtime, dev setup, integration tests, fixtures, gotchas, tech adaptations; populates the shared `<host>/.seeflow/LEARN.md` |
| `seeflow-node-planner` | none (pure reasoning) | P2: pick nodes + connectors (starts as soon as code-analyzer returns) — emits a single payload in `flow:add-bulk` shape |
| `seeflow-play-designer` | `Read, Grep, Glob, LS` | P4: design playActions + script bodies — emits `{patch, scriptFile}` triples for P5 |
| `seeflow-status-designer` | `Read, Grep, Glob, LS` | P4: design statusActions + script bodies — same triple shape |

Full prompts + worked examples in `skills/seeflow/agents/<agent>.md`.

**Fallback when a named type isn't registered.** These five are shipped as plugin agent types (declared in `.claude-plugin/plugin.json`), but in some environments they aren't registered — `Agent(subagent_type: "seeflow-node-planner", …)` then errors with `Agent type '…' not found`. When that happens, **do not abandon the phase**: re-dispatch the SAME work as a `general-purpose` agent with the matching `skills/seeflow/agents/<agent>.md` contract inlined verbatim into the prompt (plus the cached schema slices and brief the named type would have received). Match the tool expectations in the table above — e.g. the planner is pure-reasoning, the analyzers/designers need read tools. The contract, not the registration, is what makes the output correct; the fallback is functionally identical, just more verbose to launch.

## General orchestration rule — parallelise sub-agents

Whenever two or more tasks are independent, dispatch them as concurrent sub-agents in a single message. Serial execution is the exception, not the default. The canonical wrong/right block lives in `SKILL.md` §"Parallelism is the default"; later phases reference it.
