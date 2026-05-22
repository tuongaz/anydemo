---
name: seeflow
description: Use when the user asks to *create* a new SeeFlow flow — "create a flow", "generate a flow", "scaffold a SeeFlow flow", "add a flow to this repo", or when a previous `/seeflow-lookup` reported no matching flow exists. For questions about an existing flow ("how does X work", "show me the flow", "diagram our system"), use `/seeflow-lookup` first — it will fall back to this skill if nothing is registered. Orchestrates five sub-agents and the `seeflow` CLI to turn a natural-language prompt into a registered, validated SeeFlow flow under `<project>/.seeflow/<slug>/`.
---

# seeflow

Turn a natural-language prompt into a registered SeeFlow flow under `<project>/.seeflow/<slug>/`. Orchestrate five sub-agents and the `seeflow` CLI; never read the codebase directly, never author `flow.json` by hand.

**Parallelism is the default — one message, N `Task` calls.** Phase 1's wrong/right block below is canonical; later parallel phases reference it. Narrate each phase boundary with a one-line status (e.g. `Phase 3: scaffolding skeleton flow…`) so silent waits don't feel broken.

## When NOT to invoke

- Editing nodes on an existing flow → use the canvas, or hit the CLI directly (`nodes:patch`).
- Deleting a flow → `flows:delete`.
- Re-laying out an existing flow without semantic changes → `flows:layout`.
- Empty project (nothing to analyze) → ask the user first.
- Debugging a single broken Play/Status script → edit in-place, re-run Phase 6.

## Inputs

- User's prompt; project root (`$PWD`); `~/.seeflow/config.json` (optional studio host:port).
- Existing `<project>/.seeflow/<slug>/flow.json` files (multi-flow supported).
- `<project>/.seeflow/LEARN.md` — persistent crib sheet from prior runs. **Read before Phase 1.** Format: `references/learn-format.md`.

## Conventions

| Variable | Resolution |
|---|---|
| `$STUDIO_URL` | `SEEFLOW_STUDIO_URL` → `~/.seeflow/config.json` port → `http://localhost:4321`. |
| `$repoPath` | `$PWD`. |
| `$SEEFLOW_TMP` | `$repoPath/.seeflow/.tmp/` — project-local scratch directory. Create on demand (`mkdir -p`), write all intermediate files here, **never** under system `/tmp`. Already inside the project tree, so no extra write permission is needed. Cleaned up at end of the run (see "Scratch files & cleanup"). |
| `seeflow` | Locally installed `seeflow` binary if `command -v seeflow >/dev/null 2>&1`; otherwise `npx -y @tuongaz/seeflow@latest`. Resolve once at session start (e.g. `SEEFLOW="$(command -v seeflow >/dev/null 2>&1 && echo seeflow || echo 'npx -y @tuongaz/seeflow@latest')"`). Every CLI invocation below is shorthand for that. |

### Scratch files & cleanup

Any intermediate file the orchestrator or a generated Play/Status script needs (curl output, jq scratch, downloaded fixtures, comparison snapshots, etc.) goes under `$SEEFLOW_TMP` — never `/tmp`, `/var/tmp`, or `$TMPDIR`. The project-local path requires no extra permission, survives the run for debugging, and is gitignored by convention (`.seeflow/.tmp/` is already covered by the `.seeflow/` listing in most repos; add it explicitly if not).

**Lifecycle:**

1. **Create on first use** — `mkdir -p "$SEEFLOW_TMP"` inside any script or wrapper that writes there. Idempotent, costs nothing.
2. **Generated scripts (Phase 5)** — Play / Status bodies that need scratch space should reference `"$SEEFLOW_TMP"` (or hardcode `.seeflow/.tmp/...` relative to `$repoPath` when running outside a wrapper that exports it).
3. **Cleanup at end of run** — after Phase 6 prints the final `Flow "..." registered ...` line, the orchestrator removes `$SEEFLOW_TMP` (`rm -rf "$SEEFLOW_TMP"`). On a failed/aborted run, leave it in place — the contents are the debugging trail.
4. **Never check in** — if `.seeflow/.tmp/` is not yet gitignored, add it before committing.

**Every flow mutation goes through the CLI.** The studio's `ResolvedFlowSchema` validates every write server-side — there is no separate validation step. **Don't memorise CLI syntax** — run `$SEEFLOW help` to see every subcommand and `$SEEFLOW help <command>` for synopsis, body shape, output, and error kinds. Treat the help output as the source of truth and follow what it prints. See `references/cli.md` for the resolver snippet.

## Pipeline

```
P0    /health probe ‖ read LEARN.md
P1    code-analyzer ‖ system-analyzer
P2    node-planner (kicks off when code-analyzer returns;
                   system-analyzer continues in background)
P3    projects:create → flow:add-bulk (nodes + connectors, atomic)
      → flows:layout → USER REVIEW + dynamic gate (one combined ask)
P4    play-designer ‖ status-designer
P5    write scripts to .seeflow/nodes/<nodeId>/scripts/
      → nodes:patch (per node, with playAction / statusAction)
      → optional newTriggerNodes via flow:add-bulk
      → flows:layout
P6    e2e
```

Each phase gates on the previous (with the Phase 1 → Phase 2 overlap).

## Core rules

Full text in `references/core-rules.md`:

1. **No mocks.** Real services, real state. If something isn't running, stop and ask.
2. **Bigger picture before INSERTs.** Use the natural data-entry path (API, file-drop, producer, seed, webhook).
3. **Match the project's primary language.** Use `runtimeProfile.primaryLanguage` for every script.

## Common mistakes

- **Serial sub-agent dispatch** (N messages, one Task call each). One message, N Task calls — see Phase 1's wrong/right.
- **One sub-agent fixing multiple failing scripts in Phase 6.** Each needs isolated context.
- **Authoring `flow.json` directly.** Every mutation is a CLI call.
- **Touching `style.json`.** The studio owns it via `flows:layout`.
- **Passing `<slug>/scripts/…` as `scriptPath`.** New anchor is the node folder — emit just `scripts/play.ts`.
- **Mocking services or fake fixtures.** Use real triggers; copy fixtures from integration tests.
- **Asking "what's your codebase?".** Launch the analyzers — that is their job.
- **Skipping or simulating Phase 6.** Mandatory; the retry budget handles flakiness.
- **Bypassing the Phase 0 consent check.** Never default to `enabled: true`; always read `~/.seeflow/consent.json` first.
- **Touching `status` after the initial `pending` write.** The `SessionEnd` hook owns that field — see `feedback.md`.
- **Logging without a redacted summary.** If the summary would leak a path, hostname, project name, or prompt text, **skip the entry** rather than emit a leaky one.
- **Writing scratch files to `/tmp` (or `$TMPDIR`).** Use `$SEEFLOW_TMP` (`<project>/.seeflow/.tmp/`) — project-local, no permission prompts, and cleaned up at end of run. Same rule applies to scripts the Phase 4 designers emit.
- **Forgetting to clean `$SEEFLOW_TMP` after a successful run.** Leave it in place on failure (debugging trail); `rm -rf "$SEEFLOW_TMP"` after Phase 6 prints the final `Flow registered` line on success.

## Phase 0 — pre-flight (parallel)

**First, silent consent check (see `feedback.md`).** Read `~/.seeflow/consent.json`. If absent, run the first-run prompt and write the file before continuing. The result governs whether qualifying events get logged to `~/.seeflow/feedback.jsonl` for the rest of the run — the skill only writes locally; a `SessionEnd` hook handles transfer.

Create a `TaskCreate` checklist of the six phases (`Phase 1 — discover` … `Phase 6 — end-to-end validation`); `TaskUpdate` each as it finishes. Phases skipped at the dynamic gate get marked completed with a one-line note. (If `TaskCreate`/`TaskUpdate` aren't loaded, run `ToolSearch` with `select:TaskCreate,TaskUpdate` first.)

### Capability probe — run before anything else

Run `$SEEFLOW help` once and confirm every required subcommand is present: `projects:create`, `flow:add-bulk`, `flows:layout`, `nodes:patch`, `schema`, `e2e`. (Older `@tuongaz/seeflow` versions on `npx` lack one or more.) For each missing subcommand, log a feedback entry and surface to the user.

- Required missing → log `env-capability-mismatch` (`severity: blocker`, `phase: P0`, `details: missing <subcommand>[, <subcommand>...]`, `summary: $SEEFLOW lacks required subcommands; run `npm i -g @tuongaz/seeflow@latest` and retry`). Then stop — do **not** start Phase 1.
- All present → continue.

If `$SEEFLOW help` itself fails (binary not on PATH, `npx` unavailable), log `env-tool-missing` (`severity: blocker`, `phase: P0`, `summary: $SEEFLOW unresolved — neither local binary nor npx fallback available`) and stop.

### Studio probe + LEARN.md (parallel)

Then in a single message:

1. `curl --max-time 0.5 -fsS "$STUDIO_URL/health"`
2. Read `<project>/.seeflow/LEARN.md` if present → `learnContext` (else `null`). Format: `references/learn-format.md`.

- **200** → Phase 1.
- **!200** → tell the user the studio isn't running, warn the first launch can take a minute or two if it has to fall back to `npx`, then run the CLI's `start` subcommand. Re-probe `/health` once. If still unreachable, log `env-service-unreachable` (`severity: blocker`, `phase: P0`, `summary: studio /health unreachable after start retry`), surface and stop.

## Phase 1 — discover (parallel)

**Launch both analyzers in parallel — single message, two `Task` calls.** Serial launch roughly doubles wall-clock for zero benefit.

**Wrong:**

```
message 1: Task(seeflow-code-analyzer, …) → wait
message 2: Task(seeflow-system-analyzer, …)
```

**Right:**

```
message 1: Task(seeflow-code-analyzer, …)
           Task(seeflow-system-analyzer, …)
```

Every later parallel phase (Phase 4 designers, Phase 5 retries spanning both overlay families, Phase 6 per-script fix-up) follows this pattern.

- `seeflow-code-analyzer` — in: `userPrompt`, `projectRoot`, `existingDemo`, `learnContext`. Out: `userIntent`, `audienceFraming`, `scope`, `codePointers`, `knownEndpoints`, `techStack`, `existingDemo`.
- `seeflow-system-analyzer` — in: `projectRoot`, `learnContext`. Out: `runtimeProfile` + a `learnUpdates` payload (`localDevSetup`, `integrationTests`, `fixtures`, `factories`, `seedCommands`, `dataEntryPaths`, `gotchas`, `techAdaptations`). **Every fact it learns about how to start / set up the local environment MUST land in `learnUpdates`.**

Tools: `Read, Grep, Glob, LS, Bash` (read-only). Schemas: `agents/seeflow-code-analyzer.md`, `agents/seeflow-system-analyzer.md`, `references/learn-format.md`. Unparseable output: retry that single agent once, then log `agent-output-unparseable` (`severity: failure`, `agent: <slug>`, `summary: <agent> returned unparseable JSON after retry`), surface, and stop. The same `agent-output-unparseable` rule applies to every sub-agent in Phases 2 and 4.

### Empty-project / design-only mode

If the project root has no source tree (no `package.json`, no Go module, no Python project, no language source files), the "When NOT to invoke" rule kicks in: **ask the user first.** If they say "design anyway" (mockups, demo skeletons, architectural sketches), skip both analyzers and build a synthetic brief by hand from the user's prompt:

```json
{
  "userIntent":     "<extracted verbatim from the user's prompt>",
  "audienceFraming":"design-only sketch — no running system to observe",
  "scope":          { "rootEntities": [<inferred from prompt>], "outOfScope": [] },
  "codePointers":   [],
  "knownEndpoints": [],
  "techStack":      [<user-stated, or empty>],
  "existingDemo":   null,
  "runtimeProfile": null
}
```

Forward that brief to `seeflow-node-planner` (Phase 2) as-is — the planner already tolerates a sparse brief.

Log `mode-fallback` (`severity: degraded`, `phase: P1`, `details: design-only`, `summary: empty project — analyzers skipped, synthetic brief built from prompt`).

Downstream consequences:
- **Phase 3 dynamic gate:** default to **static** without re-asking. Without `runtimeProfile`, Phase 4 designers cannot pick a real interpreter or fixture; tell the user to populate code first if they later want dynamic.
- **Phase 6 (e2e):** N/A — skip with a one-line note when summarising the run.
- **LEARN.md:** still write the flow row, but mark it `(design-only)` in the purpose column so the next run knows the canvas is not wired to a real system.

### Phase 1 → Phase 2 overlap

Start `seeflow-node-planner` as soon as the code-analyzer returns — it only needs the code-analyzer's brief plus `techStack`. The system-analyzer continues in the background.

When the system-analyzer returns:

1. Merge `learnUpdates` into `<project>/.seeflow/LEARN.md` (create `.seeflow/` if missing). Anything about boot, ports, env vars, fixtures, gotchas, or tech adaptations MUST land in the file.
2. Splice `runtimeProfile` + LEARN.md facts into the in-memory context brief used by Phase 4.
3. Merge `knownEndpoints` / `techStack` from the code-analyzer into the same write.

**Resolve tech refs.** Map each `techId` in the merged `## Tech stack` to `references/tech/<techId>.md`. Forward those paths and the matching `## Tech stack adaptations` into Phase 2 / 4 prompts (~3–5 refs per flow). If the system-analyzer hasn't returned yet, forward whatever `techAdaptations` LEARN.md already had; the planner produces a first draft and the user reviews in Phase 3 anyway.

## Phase 2 — plan nodes

Launch `seeflow-node-planner` with the brief, the resolved tech-ref paths, and the matching `techAdaptations`. No tools — pure reasoning. The planner reads each ref's **Node modelling** section and treats `techAdaptations` as the project-specific override.

**Before launching the planner, run `$SEEFLOW schema node` and `$SEEFLOW schema connector`** (parallel; one message, two Bash calls) and capture the JSON payloads. Forward them in the launching prompt as `nodeSchemaPayload` and `connectorSchemaPayload`. The planner has no shell — it relies on these payloads as the authoritative contract; `references/schema.md` only covers conventions and when-to-use guidance, not field shapes. Missing forwarding = planner emits drift = `flow:add-bulk` rejects = wasted retry.

- **Resource nodes first** — every DB, queue, event bus, cache, file store, external SaaS gets its own `stateNode`.
- **Abstraction** — one node per service / workflow / worker / queue / DB. Exceptions: independently-meaningful pipeline stages, fan-out consumers, branches.
- **Connection limit** — max 4 (in + out) per node. Exceeded → **split** distinct responsibilities, or **duplicate** a shared resource (same `kind` + `name`, unique `id` like `orders-db-read`).

Output: `{ name, slug, nodes:[{id,type,data}], connectors:[{id,kind,source,target,…}], rationales:{[nodeId]: string} }`. The `nodes` and `connectors` arrays are forwarded verbatim — in a single body — to the `flow:add-bulk` subcommand in Phase 3. Every key the schema rejects is rejected here. One retry on unparseable output, then surface and stop. Full schema: `agents/seeflow-node-planner.md`.

## Phase 3 — scaffold, populate, layout, review

The skeleton flow lands via three CLI calls, in order. No `flow.json` authoring. Run `$SEEFLOW help <command>` for each one's body shape and flags.

1. `projects:create` — scaffold + register the project; capture `id` and `slug` from the result. **Use `id` (not `slug`) for every follow-up CLI call below.** Several commands document slug support in `help` but the server only resolves by id today.
2. **Normalize the planner output:** strip `rationales` (keep them in memory for the review prompt below), then for every `playNode` whose `data.playAction` is absent, inject a placeholder so the server's `ResolvedFlowSchema` (which requires `playAction` on every `playNode`) accepts the batch:
   ```json
   "playAction": {
     "kind": "script",
     "interpreter": "<runtimeProfile.primaryLanguage, or 'bun' if unknown>",
     "scriptPath": "scripts/play.ts",
     "timeoutMs": 15000
   }
   ```
   The Phase 4 play-designer overwrites this with the real action via `nodes:patch`. The script file does not need to exist yet — Phase 5 writes it, Phase 6 runs it.
2a. **Mint canonical ids.** Planner ids are descriptive (`checkout-api`, `c-order-server-event-bus`); the studio's id producers (canvas, server auto-assign, the upload endpoint regex) use `node-<10 base62>` / `conn-<10 base62>`. Rewrite at the boundary so flow.json matches:
   ```bash
   nodeIds=$(node skills/seeflow/lib/short-id.mjs "${#nodes[@]}" node-)
   connIds=$(node skills/seeflow/lib/short-id.mjs "${#connectors[@]}" conn-)
   ```
   For each `nodes[i].id` that already matches `^node-[A-Za-z0-9]{10}$` (edit-case reuse from `editTarget`), keep it; only mint new canonical ids for net-new nodes. Build a `descriptiveId → canonicalId` map and rewrite:
   - `nodes[].id`
   - `connectors[].id`, `connectors[].source`, `connectors[].target`
   - `rationales` keys (kept in memory for the review prompt)
2b. **Log any silent corrections** from steps 2 and 2a (see `feedback.md`). For each correction kind that fired (placeholder-`playAction` injection, descriptive→canonical id rewrite, unknown-type rename, unknown-field rename, bidir-connector strip, …), emit **one** `agent-output-corrected` entry with `severity: corrected`, `phase: P3`, `agent: seeflow-node-planner`, and `details: <correction-kind> (×N)` where N is the count. Aggregate across nodes — never one entry per node. If no corrections were needed, log nothing. This is the signal that the planner drifted from the schema; without it, the orchestrator's silent patching is invisible.
3. `flow:add-bulk` — atomic seed of nodes + connectors in one transactional write. Forward the normalized + id-rewritten `nodes` and `connectors` arrays as `{ nodes, connectors }`. Connectors may reference nodes from the same call — the server validates the merged graph as a whole, so a dangling source/target or a malformed node rolls back **both** arrays together. No two-phase commit to reason about; no orphan nodes if connectors fail.
4. `flows:layout` — run ELK and write `style.json`.

Each call validates server-side. A `badSchema` exit means feed the issues back to the planner and retry — no separate validation step.

Open the canvas, surface the planner's `rationales` per node — prefix each with `<data.name> (<canonical id>):` so the human sees a readable anchor despite the opaque id (`POST /orders (node-Ab12cd34Ef): Single HTTP service — internal routes are implementation detail.`) — and ask **one combined question** (layout review + dynamic gate in a single round-trip — two consecutive waits is interrogation):

```bash
URL="$STUDIO_URL/d/$slug"
(open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || start "$URL" 2>/dev/null) &
```

> Opened the canvas at `<url>`. Two quick questions:
> 1. **Layout** — any additions, removals, or renames?
> 2. **Dynamic or static** — continue with Play scripts + Status probes so the
>    canvas reacts to your running system, or stop with the static layout?

**Wait once.** Parse both answers from the reply.

- **Layout changes requested** → log `plan-revision` (`severity: friction`, `phase: P3`, `summary: user requested layout changes at canvas review gate`), re-run node-planner with the feedback, repeat the combined ask. The dynamic answer (if given) is remembered but not acted on until the layout is approved. Debounce — log once per session even if the user revises multiple times.
- **Layout approved + dynamic** → Phase 4. If the system-analyzer is still running, await it now; Phase 4 designers need its `runtimeProfile`, fixtures, data-entry paths, and tech adaptations. Re-merge any new `learnUpdates` first.
- **Layout approved + static** → print `Flow "<name>" registered as <slug> (static). Open: $STUDIO_URL/d/<slug>` and stop. Still merge any pending `learnUpdates`.
- **Dynamic answer unclear or absent** → default to static (dynamic writes executable scripts; opt-in). Log `mode-fallback` (`severity: degraded`, `phase: P3`, `details: dynamic-to-static`, `summary: dynamic gate unclear; auto-downgraded to static`).

(Design-only mode from Phase 1's empty-project branch defaults to static here without re-asking.)

## Phase 4 — design Play + Status (parallel)

Launch `seeflow-play-designer` + `seeflow-status-designer` in parallel (Phase 1 rule). Both receive: context brief, node draft, edit target, tech-ref paths, matching `techAdaptations`. They read each ref's **Play** / **Status** section and treat `techAdaptations` as the project override. Tools: `Read, Grep, Glob, LS`.

**Before launching either designer, run `$SEEFLOW schema action` and `$SEEFLOW schema node`** (parallel; one message, two Bash calls) and capture the JSON payloads. Forward them in each designer's launching prompt as `actionSchemaPayload` and `nodeSchemaPayload`. Designers have no shell — they rely on these payloads as the authoritative contract; `references/schema.md` only covers anchor rules and runtime budgets, not field shapes. The same payloads serve both designers; reuse them. Missing forwarding = designer emits drift = `nodes:patch` rejects = wasted retry.

Output shape (both): `{ nodeId, patch, scriptFile: {path, body, chmod}, validationSafe?, rationale }` triples. `patch` is the exact body for `seeflow nodes:patch`. `scriptFile.path` is project-root-relative (`.seeflow/nodes/<nodeId>/scripts/<name>`); `playAction.scriptPath` inside `patch` is node-folder-relative (`scripts/play.ts`). Full schemas: `agents/seeflow-play-designer.md`, `agents/seeflow-status-designer.md`.

**Sample data priority:** integration/e2e fixtures (`runtimeProfile.integrationTestDir`, copy verbatim) → seed / migration / ORM factories → README / OpenAPI / Postman examples → invent last, note in `rationale`.

`newTriggerNodes` (play-designer only) may inject synthetic sources (file-drop, webhook receiver) when no natural trigger exists. Shape: `{nodes, connectors}` — same as the planner's output.

## Phase 5 — patch overlays + layout

For each overlay returned by Phase 4 (parallelise the writes when the script bodies don't depend on each other):

1. Write `scriptFile.body` to `scriptFile.path` (Write tool).
2. `chmod` per `scriptFile.chmod` (default 755).
3. Call `nodes:patch` with the overlay's `patch` body. (Body shape: `$SEEFLOW help nodes:patch`.)

If the play-designer emitted `newTriggerNodes`, batch them via `flow:add-bulk` (one call, both arrays atomic), then re-run `flows:layout`. (Body shape: `$SEEFLOW help flow:add-bulk`.)

**Edit-case retype routing.** When the Phase 2 diff against `editTarget` flags a node whose `id` already exists but whose `type` changed (e.g. a former trigger demoted from `playNode` to `stateNode`), route it through `nodes:patch { type, ...required fields }` — **not** `nodes:delete` + `flow:add-bulk`. The patch path preserves the per-node folder under `.seeflow/nodes/<id>/`; the delete cascade destroys it. The server validates required fields for the new type via the post-merge reparse (e.g. `state → play` requires a `playAction` in the same patch); `badSchema` means feed the issues to the play-designer and retry.

**Retry budget:** per-node `nodes:patch` failure → re-dispatch *that one* designer with the Zod issues, retry, **max 3 per node**. Parallelise re-dispatches when more than one node failed (Phase 1 rule). When the budget is exhausted for a node, log `retry-exhausted` (`severity: failure`, `phase: P5`, `code: badSchema` (or the actual code), `summary: nodes:patch retries exhausted on <kind> (N nodes)`). Aggregate across nodes — one entry per (kind, code) pair, not one per node.

## Phase 6 — end-to-end validation

**Must run. Do not skip or simulate.**

Run the `e2e` subcommand for the flow. Pass `--skip-nodes` with the `nodeId`s of any Phase 4 overlays whose `validationSafe === false` (third-party or paid actions); skipped nodes appear in `skipped[]`, not as failures. Body / flag details: `$SEEFLOW help e2e`.

**`ok: true`** → print `Flow "<name>" registered as <slug>. Open: $STUDIO_URL/d/<slug>`, then `rm -rf "$SEEFLOW_TMP"` to clear project-local scratch. Done.

**`ok: false`** fix-up loop:

1. Identify failing nodes from `plays[*].error` / `statuses[*].outcome`.
2. **Parallel fix-up (Phase 1 rule):** one sub-agent per failing script, single message. A single agent fixing N scripts cross-contaminates.
3. Each agent gets the script path (under `.seeflow/nodes/<nodeId>/scripts/`), the specific error payload, and a concrete fix hypothesis (`play.ts: ECONNREFUSED on :3001 — start the app first`).
4. Edit in-place, re-run the `e2e` subcommand. **Max 2 retries**, then log `seeflow:e2e-fail` (`severity: failure`, `phase: P6`, `details: <N> failing scripts after fix-up`, `summary: e2e ok:false after retry budget exhausted`) and ask retry / stop.

If the run is design-only (Phase 1 fallback), skip Phase 6 entirely and log `phase-skipped` (`severity: degraded`, `phase: P6`, `details: design-only`, `summary: e2e skipped — no runtime to validate against`).

### Polish LEARN.md with anything learned

If Phases 5-6 surfaced something the next run would want — port mismatch, fixture path, missed env var, working seed command, useful data-entry path — append to `<project>/.seeflow/LEARN.md` (`Gotchas` bullet or the relevant section). Also append the flow to the "Flows already created" table with today's date and a one-line purpose. Skip if nothing new — empty updates are noise.

**Tech-specific learnings** (a helper, a required attribute, an emulator quirk, a fixture path) go in `## Tech stack adaptations` → `### <techId>`, not just `## Gotchas`. If the code-analyzer missed a tech entirely, also append the `techId` to `## Tech stack`. This is what makes the next `/seeflow` run reuse the work.

## Operations

| Topic | File |
|---|---|
| CLI resolver + discovery via `$SEEFLOW help` | `references/cli.md` |
| Error handling, retry caps, sub-agent table | `references/operations.md` |
| Schema, per-node file convention, action shapes | `references/schema.md` |
| Core rules | `references/core-rules.md` |
| `LEARN.md` format, lifecycle, merging, `learnUpdates` contract | `references/learn-format.md` |
| Tech-specific best practices | `references/tech/README.md` |
| Sub-agent prompts | `agents/seeflow-*.md` |
| Feedback collection — consent, kinds, format, redaction, hook handoff | `feedback.md` |
| Canonical id generator | `lib/short-id.mjs` |
