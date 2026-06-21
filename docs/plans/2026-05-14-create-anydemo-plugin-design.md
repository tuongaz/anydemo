# `create-seeflow` Claude Code plugin

Date: 2026-05-14
Status: Design

## Summary

A Claude Code plugin co-located in this repo that turns "make me a flow of the
checkout system" into a registered, runnable, validated SeeFlow flow without
the author hand-writing `demo.json` or wiring scripts. The plugin ships one
skill — `create-seeflow` — that orchestrates four specialised sub-agents and
a small pile of bun scripts. The skill is description-triggered (no slash
command file) and lives at the repo root alongside `apps/` and `examples/`.

The plugin assumes the SeeFlow studio is already running locally; if it
isn't, the skill stops and tells the user the start command. It NEVER
auto-starts the studio.

The design depends on **one studio prerequisite** — `US-009` (registry dedup
key changes from `repoPath` to `(repoPath, demoPath)`) — so a single project
can hold multiple demos. The plugin is not built until `US-009` lands.

## Goals

- A natural-language flow author for SeeFlow. The user says "show how
  checkout works"; the plugin reads the codebase, picks the right nodes,
  writes Play and status scripts, registers, validates end-to-end, opens.
- One project, many demos. Each lives at
  `<project>/.seeflow/<slug>/{demo.json,scripts/,state/}` and is registered
  as its own entry in `~/.seeflow/registry.json`.
- Strong abstraction discipline. The plugin's audience is engineers AND
  business: nodes represent features, not implementation. A Temporal
  workflow is ONE node — never its activities.
- Always runnable. Every flow the plugin creates has at least one Play
  trigger the audience can press, and at least one observable status badge
  where the system state can change.
- Idempotent and safe to re-run. Plan-first interaction means the user sees
  what's about to change BEFORE any file is written. Validation re-runs
  Play actions; they must be safe to call repeatedly.

## Non-goals

- A standalone CLI (the existing `seeflow` CLI stays — the plugin POSTs to
  the running studio's HTTP API).
- Cross-platform parity beyond macOS + Linux for the `open` step.
- A separate plugin repo / marketplace distribution. v1 is co-located.
- Sandboxing of generated scripts (they inherit the studio's privileges,
  same as hand-written Play scripts).
- Authoring of new node types or schema extensions — the plugin generates
  data conforming to today's `apps/studio/src/schema.ts`.

## Prerequisite — studio change (US-009)

The studio's registry currently dedups on `repoPath` alone
(`apps/studio/src/registry.ts:73-122`), which means a second
`POST /api/demos/register` with the same `repoPath` overwrites the first
entry. The plugin needs multi-demo-per-repo, so we need:

```json
{
  "id": "US-009",
  "title": "Registry: dedup by (repoPath, demoPath) to support multi-demo-per-repo",
  "description": "As a demo author, I need multiple demos to coexist in one project (each under a separate slug subdirectory) so authoring tooling can write per-flow demos without overwriting each other.",
  "acceptanceCriteria": [
    "apps/studio/src/registry.ts: dedup key for upsert changes from repoPath alone to the (repoPath, demoPath) tuple",
    "findByRepoPath retained and a new findByRepoPathAndDemoPath helper added (upsert switches to the latter)",
    "Re-registering (repoPath=X, demoPath=Y/demo.json) updates ONLY that entry; entries with same X but different demoPath are untouched",
    "Slug uniqueness still enforced across the WHOLE registry (two demos named 'foo' in the same repo become 'foo' and 'foo-2')",
    "registry.test.ts extended: two entries with same repoPath and distinct demoPath coexist; updating one leaves the other unchanged; delete by id is surgical",
    "api.test.ts extended: POST /api/demos/register twice with same repoPath + different demoPath returns two distinct ids and slugs; both queryable via GET /api/demos",
    "CLI (apps/studio/src/cli.ts) unchanged — already forwards both fields; add a CLI-level integration test confirming two registers from the same repo produce two distinct studio entries",
    "bun run typecheck passes",
    "bun test apps/studio/src/registry.test.ts passes",
    "bun test apps/studio/src/api.test.ts passes"
  ],
  "priority": 9,
  "passes": false
}
```

The watcher and SSE pipeline already route by registry `id`, not `repoPath`,
so they need no change.

## File layout — plugin

```
/Users/tuongaz/dev/seeflow/
  .claude-plugin/
    plugin.json                  # name, version, entry points
  skills/
    create-seeflow/
      SKILL.md                   # orchestration + cheatsheet
      scripts/
        register.ts              # POST /api/demos/register
        unregister.ts            # DELETE /api/demos/:id
        validate-schema.ts       # local Zod check against vendored schema
        validate-end-to-end.ts   # Phase-6 runtime checks
      vendored/
        schema.ts                # snapshot of apps/studio/src/schema.ts
      references/
        plan-format.md           # canonical Phase-4 plan template
        examples/
          checkout-flow-plan.md  # worked example
  agents/
    seeflow-discoverer.md
    seeflow-node-planner.md
    seeflow-play-designer.md
    seeflow-status-designer.md
  Makefile                       # + sync-seeflow-schema target
```

## File layout — generated per project

For a user project at `<project>` running the skill against the prompt
"show how checkout works":

```
<project>/
  .seeflow/
    checkout-flow/                # slug subdirectory
      demo.json                   # Zod-valid demo, single source of truth
      scripts/
        play-checkout.ts          # one per playAction
        status-orders.ts          # one per statusAction
      state/
        .gitignore                # ignores runtime state files
```

`demo.json`'s scriptPath values include the slug prefix
(`checkout-flow/scripts/play-checkout.ts`) because the studio resolves
scriptPaths relative to `<repoPath>/.seeflow/` (per US-003 acceptance).
`repoPath` in the registry is `<project>` (not the slug subdir); `demoPath`
is `.seeflow/checkout-flow/demo.json`. This is exactly the shape `US-009`
unlocks.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ MAIN SKILL THREAD (orchestrates, never reads codebase directly)      │
│                                                                      │
│  Phase 0 ── pre-flight: GET /health on the studio. Stop on failure.  │
│                                                                      │
│  Phase 1 ── seeflow-discoverer (sub-agent, sequential)               │
│             → context brief                                          │
│                                                                      │
│  Phase 2 ── seeflow-node-planner (sub-agent, sequential)             │
│             → node draft                                             │
│                                                                      │
│  Phase 3 ── seeflow-play-designer  ┐                                 │
│             seeflow-status-designer├ parallel sub-agents             │
│                                    ┘ → play plan + status plan       │
│                                                                      │
│  Phase 4 ── main thread: synthesize → schema-validate → present plan │
│             → wait for "go"                                          │
│                                                                      │
│  Phase 5 ── main thread: write files → POST /api/demos/register      │
│                                                                      │
│  Phase 6 ── main thread: spawn validate-end-to-end.ts                │
│             → POST each Play, watch SSE for status events            │
│             → compile result                                         │
│                                                                      │
│  Phase 7 ── on success: open browser at /d/<slug>                    │
│             on failure: ask user "retry or stop"                     │
└──────────────────────────────────────────────────────────────────────┘
```

### Phase 0 — pre-flight

The skill reads `~/.seeflow/config.json` for the studio port (default 4321),
then `GET http://<host>:<port>/health` with a 500ms timeout. On failure it
emits a single user-facing message — `Studio not reachable at <url>. Start
it with: seeflow start` — and stops. No retry, no auto-spawn.

### Phase 1 — discoverer

Sub-agent `seeflow-discoverer` is launched with:

- The user's full natural-language prompt.
- The project root path (`pwd` at skill invocation).
- The existing `<project>/.seeflow/<slug>/demo.json` content if any (the
  skill scans for slug subdirs first; if the prompt names an existing slug,
  the existing demo is treated as the edit target).

Tools allowed: `Read`, `Grep`, `Glob`, `LS`, `Bash` (read-only commands only).

Output (returned as structured JSON in the agent's final message):

```json
{
  "userIntent": "Short paraphrase of what the user wants shown.",
  "audienceFraming": "Engineer-AND-business: what the audience needs to walk away knowing.",
  "scope": {
    "rootEntities": ["checkout API", "payments service", "fulfillment worker", ...],
    "outOfScope": ["admin dashboard", "marketing site", ...]
  },
  "codePointers": [
    {"path": "src/checkout/api.ts", "why": "POST /checkout handler — primary trigger"},
    {"path": "src/payments/service.ts", "why": "external Stripe leg"},
    ...
  ],
  "existingDemo": null | { "slug": "checkout-flow", "nodeCount": 5, "diffTarget": true }
}
```

### Phase 2 — node-planner

Sub-agent `seeflow-node-planner` consumes the context brief + the
abstraction rules embedded in its system prompt (see "Node abstraction
rules" below). Output:

```json
{
  "name": "Checkout Flow",
  "slug": "checkout-flow",
  "nodes": [
    {
      "id": "checkout-api",
      "type": "playNode",
      "data": {
        "name": "POST /checkout",
        "kind": "service",
        "stateSource": {"kind": "request"},
        "description": "Receives a cart, creates an order, kicks off the payment leg."
      },
      "oneNodeRationale": "Single endpoint, not its internal middleware."
    },
    ...
  ],
  "connectors": [
    {"id": "c1", "kind": "http", "source": "checkout-api", "target": "payments-service", "method": "POST", "url": "/charge"}
  ]
}
```

No actions yet — those are layered on in Phase 3.

### Phase 3 — play-designer + status-designer (parallel)

Both sub-agents receive the same input (context brief + node draft) and run
concurrently because they have no inter-dependence at this phase. Each
returns a partial overlay against the node draft.

`seeflow-play-designer` output:

```json
{
  "playOverlays": [
    {
      "nodeId": "checkout-api",
      "playAction": {
        "kind": "script",
        "interpreter": "bun",
        "args": ["run"],
        "scriptPath": "checkout-flow/scripts/play-checkout.ts",
        "input": { "items": [{"sku": "ABC", "qty": 1}] },
        "timeoutMs": 15000
      },
      "scriptBody": "// bun script source as a string",
      "validationSafe": true,
      "rationale": "Synchronous API trigger — Play sits on the endpoint."
    }
  ],
  "newTriggerNodes": []
}
```

`newTriggerNodes` lets the play-designer INJECT additional nodes that
node-planner didn't see — typically synthetic "drop file" / "send webhook"
triggers in front of async chains.

`seeflow-status-designer` output:

```json
{
  "statusOverlays": [
    {
      "nodeId": "order-db",
      "statusAction": {
        "kind": "script",
        "interpreter": "bun",
        "args": ["run"],
        "scriptPath": "checkout-flow/scripts/status-orders.ts",
        "maxLifetimeMs": 600000
      },
      "scriptBody": "// bun script source",
      "rationale": "Polls orders table — audience sees row state evolve per Play click."
    }
  ]
}
```

### Phase 4 — synthesis, validation, plan presentation

The main thread:

1. Merges node draft + play overlays + status overlays + `newTriggerNodes`
   into a full `Demo` object.
2. Runs `bun skills/create-seeflow/scripts/validate-schema.ts <demo.json>`
   against the vendored schema. On failure, loops back to Phase 3 with the
   issue list (max 3 iterations; then surfaces the error to the user).
3. Renders the plan in the template at `references/plan-format.md` and
   prints it to the user. Plan format:

```
## Plan for "<user prompt>"

Nodes (N)
 + checkout-api       [playNode]    Play: POST /checkout (new cart fixture)
 + payments-service   [stateNode]   status: Stripe charge state
 + order-db           [stateNode]   status: order row state polling
 ~ fulfillment-worker [stateNode]   (no play, no status) -- UNCHANGED
 - email-sent         [stateNode]   REMOVED (was in existing demo)

Connectors (M)
   checkout-api  --http→ payments-service
   ...

Files to write:
  M .seeflow/checkout-flow/demo.json
  + .seeflow/checkout-flow/scripts/play-checkout.ts
  + .seeflow/checkout-flow/scripts/status-orders.ts
  + .seeflow/checkout-flow/state/.gitignore

Reply 'go' to write, or describe what to change.
```

When an existing demo is the edit target, `+ / ~ / -` annotate
added/modified/removed nodes — the plan IS the diff.

### Phase 5 — write & register

On "go":

1. `mkdir -p <project>/.seeflow/<slug>/scripts <project>/.seeflow/<slug>/state`.
2. Write `demo.json`, each script, `state/.gitignore`.
3. `bun skills/create-seeflow/scripts/register.ts --path <project> --demo .seeflow/<slug>/demo.json`.
   `register.ts` POSTs to `/api/demos/register` and prints the resulting
   slug + ID.
4. Stash the returned `id` for Phases 6 and 7.

### Phase 6 — end-to-end validation

Main thread invokes `bun skills/create-seeflow/scripts/validate-end-to-end.ts <id>`.
The script:

1. `GET /api/demos/<id>` — expect 200, `valid: true`.
2. Read the demo's node list. For each `playNode` (and any `stateNode`
   carrying a `playAction`):
   - If `validationSafe === false` → log skip, continue.
   - Otherwise: `POST /api/demos/<id>/play/<nodeId>`.
   - Expect HTTP 200 and the response body's `error` field to be absent.
   - Capture the `runId` for the final report.
3. Open SSE at `/api/events?demoId=<id>`. For each node carrying a
   `statusAction`, wait up to 10s for at least one `node:status` event
   whose payload's `state !== 'error'`.
4. Hard ceiling: ~2 min total. SIGTERM stragglers.
5. Emit JSON result to stdout:

```json
{
  "ok": true,
  "plays": [
    {"nodeId": "checkout-api", "outcome": "passed", "runId": "...", "body": {...}}
  ],
  "statuses": [
    {"nodeId": "order-db", "outcome": "passed", "firstReport": {...}}
  ],
  "skipped": []
}
```

On `ok: false`, the JSON enumerates per-node failures and the main thread
interprets them. The LLM either (a) generates a fix-up plan and loops back
to Phase 4 (max 2 retries), or (b) presents the failures to the user and
asks `retry / stop`.

### Phase 7 — open

On validation success:

```bash
case "$(uname)" in
  Darwin) open "http://localhost:<port>/d/<slug>" ;;
  Linux)  xdg-open "http://localhost:<port>/d/<slug>" ;;
  *)      echo "Open http://localhost:<port>/d/<slug>" ;;
esac
```

On validation failure: never open. User decides retry-or-stop.

## Sub-agent contracts

Each sub-agent lives at `agents/<name>.md` with frontmatter and a system
prompt. Tools are restricted to what the agent actually needs.

| Agent | Tools | Purpose |
|---|---|---|
| `seeflow-discoverer` | `Read`, `Grep`, `Glob`, `LS`, `Bash` (read-only) | Codebase exploration; returns structured context brief |
| `seeflow-node-planner` | (none — pure reasoning) | Picks nodes + connectors from context brief; enforces abstraction rules |
| `seeflow-play-designer` | `Read`, `Grep`, `Glob`, `LS` | Designs Play actions + scripts; may inject new trigger nodes |
| `seeflow-status-designer` | `Read`, `Grep`, `Glob`, `LS` | Designs statusAction scripts |

Sub-agent system prompts are short — the abstraction rules and schema
cheatsheet live in `SKILL.md` and are passed in via the launcher prompt.

## Node abstraction rules (lifted into SKILL.md)

**ONE node per concept** — never decompose these:

| Concept | Why one node |
|---|---|
| Temporal / Cadence workflow | The workflow is the unit of business meaning |
| Airflow DAG / Step Functions / GitHub Actions workflow | Same |
| Background worker / consumer | One job from the audience's view |
| Microservice (HTTP/gRPC) | Single black box |
| Database (Postgres, Mongo, Redis) | One dependency |
| External SaaS API (Stripe, SendGrid, Twilio, S3, OpenAI) | Black box you don't own |
| Message queue / topic (SQS, Kafka, RabbitMQ) | One channel |
| Cache (Redis, Memcached) | One thing the system depends on |
| Scheduler / cron | One source of time-based triggers |
| File store / bucket | One storage dependency |
| Search engine (ES, Algolia) | One thing |

**Exceptions that earn multiple nodes**:

- Pipelines whose stages are independently meaningful (`validate → score → rank → publish`).
- Fan-outs where each consumer is its own business concept
  (`order.created → notify customer + update inventory + trigger shipping`).
- Choices/branches the audience must understand
  (`paid → fulfill / failed → refund`).

## Play-button placement rules

1. **Sync API → Play on the endpoint node.** The endpoint *is* the trigger.
2. **Async chain → Play on the SOURCE, not the consumer.**
   - File-drop → Play on a "drop file" node that writes the fixture.
   - Webhook → Play on an "incoming webhook" node that POSTs a fake payload.
   - Cron → Play on a "tick" node that invokes the handler manually.
   - User action → Play on the action node ("click checkout").
3. **Long async wait → "fast-forward" Play.** Add a node like
   "shipment delivered" with a Play that simulates the completion event.
4. **No natural trigger? Create one.** Inject a fixture-producer node.
5. **Idempotency is mandatory.** Play scripts MUST be safe to re-run —
   validation calls them once, the user will call them again.
6. **One chain can have multiple Plays** at distinct legitimate entry points.
7. **No Play on pure observers.** Databases, caches, downstream workers
   have no trigger semantics.

## statusAction placement rules

Put statusAction on nodes where the audience can see "the system has
changed" between Play clicks:

- **DB / store node** → row count, queue depth, specific row state.
- **Workflow engine node** → current run state.
- **Queue / topic node** → depth or last-message age.
- **Worker node** → "idle / busy / N processed".
- **Cache node** → key count or hit rate, only when relevant.
- **External API node** → `/health` ping, only when relevant.

Don't put statusAction on:

- Pure trigger nodes (the click is the event; no continuous state).
- Decorative / grouping nodes.
- Nodes whose state just repeats the playAction return.

## Schema delivery + sync

`SKILL.md` contains a **cheatsheet**: one-page node-type recap with 1-2 line
example snippets per type (`playNode`, `stateNode`, `iconNode`, `groupNode`,
`htmlNode`, `imageNode`, `shapeNode`, `Connector`). Total ~200 LOC.

The full Zod source lives at
`skills/create-seeflow/vendored/schema.ts` — a verbatim snapshot of
`apps/studio/src/schema.ts`. Sub-agents `Read` it on demand when they need
exact field-level truth.

Sync mechanism:

- Maintainer: `make sync-seeflow-schema` copies the canonical file in.
- CI: `make verify-seeflow-schema-sync` diffs the vendored copy against
  the source; fails the build on drift.

## Studio API touchpoints

| Endpoint | Method | When | Body |
|---|---|---|---|
| `/health` | GET | Phase 0 | — |
| `/api/demos/register` | POST | Phase 5 | `{name, repoPath, demoPath}` |
| `/api/demos/:id` | GET | Phase 6 | — |
| `/api/demos/:id/play/:nodeId` | POST | Phase 6 | — |
| `/api/events?demoId=:id` | GET (SSE) | Phase 6 | — |
| `/api/demos/:id` | DELETE | rollback / unregister script | — |

No new studio endpoints needed.

## Error handling

| Failure | Behaviour |
|---|---|
| Studio `/health` fails | Stop, print start command |
| Sub-agent returns unparseable output | Retry once with the validation issue; then surface |
| Schema validation fails after 3 sub-agent retries | Surface issues to user verbatim |
| Register POST returns 400 | Show response body; offer to fix-and-retry |
| Register POST returns 4xx/5xx other | Print response body, stop |
| Play POST returns error | Capture; let LLM interpret + propose fix |
| Status SSE timeout (10s) | Mark node as "no status received"; user decides retry/stop |
| Validation phase exceeds 2 min | SIGTERM in-flight checks, treat as failure |

## Testing strategy

- **Schema sync test** (CI): `make verify-seeflow-schema-sync` runs as a
  CI step.
- **Plugin script unit tests**: `scripts/register.ts`,
  `scripts/unregister.ts`, `scripts/validate-schema.ts`,
  `scripts/validate-end-to-end.ts` each have `*.test.ts` siblings using a
  fake `fetch` implementation. Run under `bun test`.
- **Sub-agent prompts**: documented at the head of each `agents/*.md`
  with example inputs + expected output shapes; manually tested against
  `examples/todo-demo-target` and `examples/order-pipeline` to confirm the
  plugin reproduces the existing example flows.
- **Smoke test**: a make target `make smoke-create-seeflow` that
  programmatically invokes the skill against a fresh fixture project,
  verifies the demo registers, plays, and emits status — green/red signal
  for the whole pipeline.

## Implementation order (proposed PRD)

1. **US-009** — registry dedup change (studio) — PREREQ.
2. **PLUGIN-001** — scaffold `.claude-plugin/plugin.json`, `skills/create-seeflow/SKILL.md` stub, `agents/*.md` stubs, `Makefile` sync target.
3. **PLUGIN-002** — vendored schema + `validate-schema.ts` + tests.
4. **PLUGIN-003** — `register.ts` + `unregister.ts` + tests.
5. **PLUGIN-004** — `validate-end-to-end.ts` + tests.
6. **PLUGIN-005** — `seeflow-discoverer` sub-agent prompt + smoke test
   against `examples/order-pipeline`.
7. **PLUGIN-006** — `seeflow-node-planner` sub-agent prompt + abstraction
   rule unit tests (synthetic context briefs → expected node lists).
8. **PLUGIN-007** — `seeflow-play-designer` + `seeflow-status-designer`
   sub-agent prompts.
9. **PLUGIN-008** — `SKILL.md` orchestration body, cheatsheet, plan
   format, error-handling text.
10. **PLUGIN-009** — End-to-end smoke: invoke the skill on a fresh copy
    of `examples/todo-demo-target` and verify a second demo coexists
    alongside the existing one.

## Open questions (for follow-up, not blocking)

- **Schema cheatsheet length** — 200 LOC is a guess; first version may
  reveal the LLM needs less (or more). Iterate after first smoke test.
- **Sub-agent retry budget** — Phase 4's "max 3 sub-agent retries" and
  Phase 6's "max 2 fix-up retries" are gut numbers; tune from real runs.
- **Slug collision handling** — if the LLM proposes slug `checkout-flow`
  and the studio rejects it (clash with another project), the plugin
  should fall back to `checkout-flow-2`. Mechanism: register accepts
  whatever slug the studio returns; the slug subdir is renamed
  on-the-fly before the second registration attempt. Detail to settle
  in `PLUGIN-003`.
- **Edit detection** — heuristic for "user means an edit, not a new
  flow": if the prompt names an existing slug or describes a flow whose
  scope obviously overlaps with an existing one, the discoverer treats
  the existing demo as the diff target. Refine on real prompts.

## Future work

- A separate `unregister-seeflow` skill (if explicit unregister becomes a
  frequent ask). `scripts/unregister.ts` is built either way and can be
  exposed as a `Bash` invocation in v1.
- A schema-version bump path so the plugin can target newer node types
  as they land.
- Pre-commit hook for schema-sync drift, if manual `make` + CI proves
  insufficient.
- Migrating distribution from co-located to a standalone Claude Code
  plugin marketplace entry, once the plugin stabilises.
