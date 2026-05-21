---
name: seeflow
description: Use when the user asks to "create a flow", "generate a flow", "scaffold a SeeFlow flow", "show how X works", "diagram our system", or "add a flow to this repo". Orchestrates five sub-agents and the `seeflow` CLI to turn a natural-language prompt into a registered, validated SeeFlow flow under `<project>/.seeflow/<slug>/`.
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
- `<project>/.seeflow/WIKI.md` — persistent crib sheet from prior runs. **Read before Phase 1.** Format: `references/wiki-format.md`.

## Conventions

| Variable | Resolution |
|---|---|
| `$STUDIO_URL` | `SEEFLOW_STUDIO_URL` → `~/.seeflow/config.json` port → `http://localhost:4321`. |
| `$repoPath` | `$PWD`. |
| `seeflow` | Locally installed `seeflow` binary if `command -v seeflow >/dev/null 2>&1`; otherwise `npx -y @tuongaz/seeflow@latest`. Resolve once at session start (e.g. `SEEFLOW="$(command -v seeflow >/dev/null 2>&1 && echo seeflow || echo 'npx -y @tuongaz/seeflow@latest')"`). Every CLI invocation below is shorthand for that. |

**Every flow mutation goes through the CLI.** The studio's `ResolvedFlowSchema` validates every write server-side — there is no separate validation step. **Don't memorise CLI syntax** — run `$SEEFLOW help` to see every subcommand and `$SEEFLOW help <command>` for synopsis, body shape, output, and error kinds. Treat the help output as the source of truth and follow what it prints. See `references/cli.md` for the resolver snippet.

## Pipeline

```
P0    /health probe ‖ read WIKI.md
P1    code-analyzer ‖ system-analyzer
P2    node-planner (kicks off when code-analyzer returns;
                   system-analyzer continues in background)
P3    projects:create → nodes:add-bulk → connectors:add-bulk
      → flows:layout → USER REVIEW
P3.5  dynamic gate (continue with scripts, or stop static?)
P4    play-designer ‖ status-designer
P5    write scripts to .seeflow/nodes/<nodeId>/scripts/
      → nodes:patch (per node, with playAction / statusAction)
      → optional newTriggerNodes via nodes:add-bulk + connectors:add-bulk
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

## Phase 0 — pre-flight (parallel)

Create a `TaskCreate` checklist of the six phases (`Phase 1 — discover` … `Phase 6 — end-to-end validation`); `TaskUpdate` each as it finishes. Phases skipped at the dynamic gate get marked completed with a one-line note. (If `TaskCreate`/`TaskUpdate` aren't loaded, run `ToolSearch` with `select:TaskCreate,TaskUpdate` first.)

In a single message:

1. `curl --max-time 0.5 -fsS "$STUDIO_URL/health"`
2. Read `<project>/.seeflow/WIKI.md` if present → `wikiContext` (else `null`). Format: `references/wiki-format.md`.

- **200** → Phase 1.
- **!200** → tell the user the studio isn't running, warn the first launch can take a minute or two if it has to fall back to `npx`, then run the CLI's `start` subcommand. Re-probe `/health` once. If still unreachable, surface and stop.

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

- `seeflow-code-analyzer` — in: `userPrompt`, `projectRoot`, `existingDemo`, `wikiContext`. Out: `userIntent`, `audienceFraming`, `scope`, `codePointers`, `knownEndpoints`, `techStack`, `existingDemo`.
- `seeflow-system-analyzer` — in: `projectRoot`, `wikiContext`. Out: `runtimeProfile` + a `wikiUpdates` payload (`localDevSetup`, `integrationTests`, `fixtures`, `factories`, `seedCommands`, `dataEntryPaths`, `gotchas`, `techAdaptations`). **Every fact it learns about how to start / set up the local environment MUST land in `wikiUpdates`.**

Tools: `Read, Grep, Glob, LS, Bash` (read-only). Schemas: `agents/seeflow-code-analyzer.md`, `agents/seeflow-system-analyzer.md`, `references/wiki-format.md`. Unparseable output: retry that single agent once, then surface and stop.

### Phase 1 → Phase 2 overlap

Start `seeflow-node-planner` as soon as the code-analyzer returns — it only needs the code-analyzer's brief plus `techStack`. The system-analyzer continues in the background.

When the system-analyzer returns:

1. Merge `wikiUpdates` into `<project>/.seeflow/WIKI.md` (create `.seeflow/` if missing). Anything about boot, ports, env vars, fixtures, gotchas, or tech adaptations MUST land in the file.
2. Splice `runtimeProfile` + wiki facts into the in-memory context brief used by Phase 4.
3. Merge `knownEndpoints` / `techStack` from the code-analyzer into the same write.

**Resolve tech refs.** Map each `techId` in the merged `## Tech stack` to `references/tech/<techId>.md`. Forward those paths and the matching `## Tech stack adaptations` into Phase 2 / 4 prompts (~3–5 refs per flow). If the system-analyzer hasn't returned yet, forward whatever `techAdaptations` the wiki already had; the planner produces a first draft and the user reviews in Phase 3 anyway.

## Phase 2 — plan nodes

Launch `seeflow-node-planner` with the brief, the resolved tech-ref paths, and the matching `techAdaptations`. No tools — pure reasoning. The planner reads each ref's **Node modelling** section and treats `techAdaptations` as the project-specific override.

- **Resource nodes first** — every DB, queue, event bus, cache, file store, external SaaS gets its own `stateNode`.
- **Abstraction** — one node per service / workflow / worker / queue / DB. Exceptions: independently-meaningful pipeline stages, fan-out consumers, branches.
- **Connection limit** — max 4 (in + out) per node. Exceeded → **split** distinct responsibilities, or **duplicate** a shared resource (same `kind` + `name`, unique `id` like `orders-db-read`).

Output: `{ name, slug, nodes:[{id,type,data}], connectors:[{id,kind,source,target,…}], rationales:{[nodeId]: string} }`. The `nodes` and `connectors` arrays are forwarded verbatim to the CLI bulk-add subcommands in Phase 3 — every key the schema rejects is rejected here. One retry on unparseable output, then surface and stop. Full schema: `agents/seeflow-node-planner.md`.

## Phase 3 — scaffold, populate, layout, review

The skeleton flow lands via four CLI calls, in order. No `flow.json` authoring. Run `$SEEFLOW help <command>` for each one's body shape and flags.

1. `projects:create` — scaffold + register the project; capture `id` and `slug` from the result.
2. `nodes:add-bulk` — bulk-seed nodes. Strip `rationales` from the planner output first; forward only the `nodes` array (re-wrapped per the body schema).
3. `connectors:add-bulk` — bulk-seed connectors.
4. `flows:layout` — run ELK and write `style.json`.

Each call validates server-side. A `badSchema` exit means feed the issues back to the planner and retry — no separate validation step.

Open the canvas and ask, surfacing the planner's `rationales` per node:

```bash
URL="$STUDIO_URL/d/$slug"
(open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || start "$URL" 2>/dev/null) &
```

> Opened the canvas at `<url>`. Layout look right? Any additions, removals, or
> renames?

**Wait.** Changes requested → re-run node-planner, repeat. Approved → dynamic gate.

### Phase 3.5 — dynamic gate

> Continue and make this flow **dynamic** (write Play scripts and Status probes so the canvas reacts to your running system) — or stop with the static layout?

- **Yes** → Phase 4. If the system-analyzer is still running, await it now; Phase 4 designers need its `runtimeProfile`, fixtures, data-entry paths, and tech adaptations. Re-merge any new `wikiUpdates` first.
- **No** → print `Flow "<name>" registered as <slug> (static). Open: $STUDIO_URL/d/<slug>` and stop. Still merge any pending `wikiUpdates`.
- **Unclear** → ask once more, default to static (dynamic writes executable scripts; opt-in).

## Phase 4 — design Play + Status (parallel)

Launch `seeflow-play-designer` + `seeflow-status-designer` in parallel (Phase 1 rule). Both receive: context brief, node draft, edit target, tech-ref paths, matching `techAdaptations`. They read each ref's **Play** / **Status** section and treat `techAdaptations` as the project override. Tools: `Read, Grep, Glob, LS`.

Output shape (both): `{ nodeId, patch, scriptFile: {path, body, chmod}, validationSafe?, rationale }` triples. `patch` is the exact body for `seeflow nodes:patch`. `scriptFile.path` is project-root-relative (`.seeflow/nodes/<nodeId>/scripts/<name>`); `playAction.scriptPath` inside `patch` is node-folder-relative (`scripts/play.ts`). Full schemas: `agents/seeflow-play-designer.md`, `agents/seeflow-status-designer.md`.

**Sample data priority:** integration/e2e fixtures (`runtimeProfile.integrationTestDir`, copy verbatim) → seed / migration / ORM factories → README / OpenAPI / Postman examples → invent last, note in `rationale`.

`newTriggerNodes` (play-designer only) may inject synthetic sources (file-drop, webhook receiver) when no natural trigger exists. Shape: `{nodes, connectors}` — same as the planner's output.

## Phase 5 — patch overlays + layout

For each overlay returned by Phase 4 (parallelise the writes when the script bodies don't depend on each other):

1. Write `scriptFile.body` to `scriptFile.path` (Write tool).
2. `chmod` per `scriptFile.chmod` (default 755).
3. Call `nodes:patch` with the overlay's `patch` body. (Body shape: `$SEEFLOW help nodes:patch`.)

If the play-designer emitted `newTriggerNodes`, batch them via `nodes:add-bulk` + `connectors:add-bulk`, then re-run `flows:layout`. (Body shapes: `$SEEFLOW help <command>`.)

**Retry budget:** per-node `nodes:patch` failure → re-dispatch *that one* designer with the Zod issues, retry, **max 3 per node**. Parallelise re-dispatches when more than one node failed (Phase 1 rule).

## Phase 6 — end-to-end validation

**Must run. Do not skip or simulate.**

Run the `e2e` subcommand for the flow. Pass `--skip-nodes` with the `nodeId`s of any Phase 4 overlays whose `validationSafe === false` (third-party or paid actions); skipped nodes appear in `skipped[]`, not as failures. Body / flag details: `$SEEFLOW help e2e`.

**`ok: true`** → print `Flow "<name>" registered as <slug>. Open: $STUDIO_URL/d/<slug>`. Done.

**`ok: false`** fix-up loop:

1. Identify failing nodes from `plays[*].error` / `statuses[*].outcome`.
2. **Parallel fix-up (Phase 1 rule):** one sub-agent per failing script, single message. A single agent fixing N scripts cross-contaminates.
3. Each agent gets the script path (under `.seeflow/nodes/<nodeId>/scripts/`), the specific error payload, and a concrete fix hypothesis (`play.ts: ECONNREFUSED on :3001 — start the app first`).
4. Edit in-place, re-run the `e2e` subcommand. **Max 2 retries**, then ask retry / stop.

### Polish WIKI.md with anything learned

If Phases 5-6 surfaced something the next run would want — port mismatch, fixture path, missed env var, working seed command, useful data-entry path — append to `<project>/.seeflow/WIKI.md` (`Gotchas` bullet or the relevant section). Also append the flow to the "Flows already created" table with today's date and a one-line purpose. Skip if nothing new — empty updates are noise.

**Tech-specific learnings** (a helper, a required attribute, an emulator quirk, a fixture path) go in `## Tech stack adaptations` → `### <techId>`, not just `## Gotchas`. If the code-analyzer missed a tech entirely, also append the `techId` to `## Tech stack`. This is what makes the next `/seeflow` run reuse the work.

## Operations

| Topic | File |
|---|---|
| CLI resolver + discovery via `$SEEFLOW help` | `references/cli.md` |
| Error handling, retry caps, sub-agent table | `references/operations.md` |
| Schema, per-node file convention, action shapes | `references/schema.md` |
| Core rules | `references/core-rules.md` |
| `WIKI.md` format, lifecycle, merging, `wikiUpdates` contract | `references/wiki-format.md` |
| Tech-specific best practices | `references/tech/README.md` |
| Sub-agent prompts | `agents/seeflow-*.md` |
