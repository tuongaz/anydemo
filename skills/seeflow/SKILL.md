---
name: seeflow
description: Use ONLY when the user explicitly asks to *create* a new SeeFlow flow — "create a flow", "generate a flow", "scaffold a SeeFlow flow", "add a flow to this repo" — or when a previous `/seeflow-lookup` already reported no matching flow exists. **Do NOT invoke for inspection phrasing** ("show me", "how does X work", "diagram our system", "explain the flow") — those route to `/seeflow-lookup` first; it will auto-hand off here only when nothing is registered. Orchestrates five sub-agents and the `seeflow` CLI to turn a natural-language prompt into a registered, validated SeeFlow flow at `<project>/flow.json` (node-attached files live under `<projectPath>/nodes/<id>/`).
---

# seeflow

Turn a natural-language prompt into a registered SeeFlow flow at `<projectPath>/flow.json`, with node-attached content (scripts, detail.md, view.html) under `<projectPath>/nodes/<id>/`. Orchestrate five sub-agents and the `seeflow` CLI; never read the codebase directly, never author `flow.json` by hand (`projects:create` writes the envelope for you).

## Project layout convention

A host repo opts into seeflow by creating a `<host>/.seeflow/` directory (the **only** place this skill introduces a `.seeflow` folder — the studio itself is path-agnostic). `LEARN.md` is shared across every flow in the host and lives at `<host>/.seeflow/LEARN.md`; each flow lives in its own subdirectory beside it:

```
<host>/                          ← the user's repo
  .seeflow/                      ← container, created by this skill
    LEARN.md                     ← shared crib for this skill (project-wide, used by every flow)
    <flow-name>/                 ← seeflow project root — passed to projects:create --path
      flow.json                  ← envelope + nodes/connectors
      style.json                 ← layout/visuals (managed by `flows:layout`)
      nodes/<id>/                ← per-node sidecar files (detail.md, view.html, scripts/)
      .tmp/                      ← per-flow scratch ($SEEFLOW_TMP)
      state/                     ← per-flow runtime script state
```

Always call `seeflow projects:create --path "$repoPath/.seeflow/<flow-name>" --name "..."`. Inside `--path`, every CLI / file reference is relative to that project root — never re-prefix with `.seeflow/`.

`~/.seeflow/` (user-home) is a separate, unrelated directory that holds the studio's global registry / config / pid / consent / feedback files; leave its paths verbatim wherever they appear.

**Parallelism is the default — one message, N `Task` calls.** Phase 1's wrong/right block below is canonical; later parallel phases reference it. Narrate each phase boundary with a one-line status (e.g. `Phase 3: scaffolding skeleton flow…`) so silent waits don't feel broken.

## When NOT to invoke

- Editing nodes on an existing flow → use the canvas, or hit the CLI directly (`nodes:patch`).
- Deleting a flow → `flows:delete`.
- Re-laying out an existing flow without semantic changes → `flows:layout`.
- Empty project (nothing to analyze) → ask the user first.
- Debugging a single broken Play/Status script → edit in-place, re-run Phase 6.

## Inputs

- User's prompt; project root (`$PWD`); `~/.seeflow/config.json` (optional studio host:port).
- Existing `<project>/flow.json` (skip the creation path if already present — fall back to `register --flow flow.json`).
- `$learnPath` (`$PWD/.seeflow/LEARN.md`) — persistent crib sheet **shared across every flow in this host repo**, written by prior `/seeflow` runs. **Read before Phase 1.** Format: `references/learn-format.md`.

## Conventions

| Variable | Resolution |
|---|---|
| `$STUDIO_URL` | `SEEFLOW_STUDIO_URL` → `~/.seeflow/config.json` port → `http://localhost:4321`. |
| `$repoPath` | `$PWD/.seeflow/<flow-name>` (the seeflow project root the skill creates and passes to `projects:create --path`). |
| `$learnPath` | `$PWD/.seeflow/LEARN.md` — **shared across every flow** in the host repo. Lives next to the flow folders, never inside one. |
| `$SEEFLOW_TMP` | `$projectPath/.tmp/` — project-local scratch directory. Create on demand (`mkdir -p`), write all intermediate files here, **never** under system `/tmp`. Already inside the project tree, so no extra write permission is needed. Cleaned up at end of the run (see "Scratch files & cleanup"). |
| `seeflow` | Locally installed `seeflow` binary if `command -v seeflow >/dev/null 2>&1`; otherwise `npx -y @tuongaz/seeflow@latest`. Resolve once at session start (e.g. `SEEFLOW="$(command -v seeflow >/dev/null 2>&1 && echo seeflow || echo 'npx -y @tuongaz/seeflow@latest')"`). Every CLI invocation below is shorthand for that. |

### Scratch files & cleanup

Any intermediate file the orchestrator or a generated Play/Status script needs (curl output, jq scratch, downloaded fixtures, comparison snapshots, etc.) goes under `$SEEFLOW_TMP` — never `/tmp`, `/var/tmp`, or `$TMPDIR`. The project-local path requires no extra permission, survives the run for debugging, and is gitignored by convention (the project lives inside the host's `.seeflow/` container, which is gitignored — add `.tmp/` explicitly if not).

**Lifecycle:**

1. **Create on first use** — `mkdir -p "$SEEFLOW_TMP"` inside any script or wrapper that writes there. Idempotent, costs nothing.
2. **Generated scripts (Phase 5)** — Play / Status bodies that need scratch space should reference `"$SEEFLOW_TMP"` (or hardcode `.tmp/...` relative to `$repoPath` when running outside a wrapper that exports it).
3. **Cleanup at end of run** — after Phase 6 prints the final `Flow "..." registered ...` line, the orchestrator removes `$SEEFLOW_TMP` (`rm -rf "$SEEFLOW_TMP"`). On a failed/aborted run, leave it in place — the contents are the debugging trail.
4. **Never check in** — if `.tmp/` is not yet gitignored, add it before committing.

**Every flow mutation goes through the CLI.** The studio validates every write server-side — there is no separate validation step. **Don't memorise CLI syntax** — run `$SEEFLOW help` to see every subcommand and `$SEEFLOW help <command>` for synopsis, body shape, output, and error kinds. Treat the help output as the source of truth and follow what it prints. See `references/cli.md` for the resolver snippet.

## Pipeline

```
P0    /health probe ‖ read $learnPath
P1    code-analyzer ‖ system-analyzer
P2    node-planner (kicks off when code-analyzer returns;
                   system-analyzer continues in background)
P3    projects:create (path + name → empty flow.json registered)
      → flow:add-bulk (nodes + connectors, atomic) → flows:layout
      → USER REVIEW + dynamic gate (one combined ask)
P4    play-designer ‖ status-designer
P5    write scripts to nodes/<nodeId>/scripts/
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
- **Silently overwriting (or silently falling back from) an existing flow at the target path.** Phase 3 step 1's existing-flow gate is mandatory — open / rename / overwrite, the user decides. The old "fall back to `register`" behavior was data-loss-adjacent.
- **Touching `style.json`.** The studio owns it via `flows:layout`.
- **Passing `<slug>/scripts/…` as `scriptPath`.** New anchor is the node folder — emit just `scripts/play.ts`.
- **Mocking services or fake fixtures.** Use real triggers; copy fixtures from integration tests.
- **Asking "what's your codebase?".** Launch the analyzers — that is their job.
- **Skipping or simulating Phase 6.** Mandatory; the retry budget handles flakiness.
- **Bypassing the Phase 0 consent check.** Never default to `enabled: true`; always read `~/.seeflow/consent.json` first.
- **Writing `LEARN.md` inside a flow folder (`<host>/.seeflow/<flow-name>/LEARN.md`).** It is **shared across every flow** in the host repo — always read/write `$learnPath` = `$PWD/.seeflow/LEARN.md`, never anywhere else.
- **Touching `status` after the initial `pending` write.** The `SessionEnd` hook owns that field — see `feedback.md`.
- **Logging without a redacted summary.** If the summary would leak a path, hostname, project name, or prompt text, **skip the entry** rather than emit a leaky one.
- **Writing scratch files to `/tmp` (or `$TMPDIR`).** Use `$SEEFLOW_TMP` (`<projectPath>/.tmp/`) — project-local, no permission prompts, and cleaned up at end of run. Same rule applies to scripts the Phase 4 designers emit.
- **Forgetting to clean `$SEEFLOW_TMP` after a successful run.** Leave it in place on failure (debugging trail); `rm -rf "$SEEFLOW_TMP"` after Phase 6 prints the final `Flow registered` line on success.

## Phase 0 — pre-flight (parallel)

### Lookup-first gate — run before anything else

If the user's prompt reads as **inspection** rather than creation — any of "show me", "show the", "how does", "how do", "what does", "diagram", "explain", "where does", "what handles" — STOP and route through `/seeflow-lookup` instead. That skill catalogues registered flows and only hands back here if nothing matches. Going straight to creation when a flow already exists wastes the run and surfaces a duplicate. The same gate applies when the user names a flow by slug or title without an explicit verb ("the CRN Enhancement flow", "the checkout flow") — assume inspection unless they prefix it with "create / scaffold / generate / add".

Creation-only triggers (skip the gate): the prompt explicitly says "create / scaffold / generate / add a flow", or `/seeflow-lookup` has already run in this turn and reported no match.

### Silent consent check (see `feedback.md`)

Read `~/.seeflow/consent.json`. If absent, run the first-run prompt and write the file before continuing. The result governs whether qualifying events get logged to `~/.seeflow/feedback.jsonl` for the rest of the run — the skill only writes locally; a `SessionEnd` hook handles transfer.

Create a `TaskCreate` checklist of the six phases (`Phase 1 — discover` … `Phase 6 — end-to-end validation`); `TaskUpdate` each as it finishes. Phases skipped at the dynamic gate get marked completed with a one-line note. (If `TaskCreate`/`TaskUpdate` aren't loaded, run `ToolSearch` with `select:TaskCreate,TaskUpdate` first.)

### Capability probe — run before anything else

Run `$SEEFLOW help` once and confirm every required subcommand is present: `projects:create`, `register`, `flow:add-bulk`, `flows:layout`, `nodes:patch`, `schema`, `ids`, `e2e`. (Older `@tuongaz/seeflow` versions on `npx` lack one or more — `ids` was added with the project-local scaffold flow; `projects:create` is the current new-project entry point.) For each missing subcommand, log a feedback entry and surface to the user.

- Required missing → log `env-capability-mismatch` (`severity: blocker`, `phase: P0`, `details: missing <subcommand>[, <subcommand>...]`, `summary: $SEEFLOW lacks required subcommands; run `npm i -g @tuongaz/seeflow@latest` and retry`). Then stop — do **not** start Phase 1.
- All present → continue.

If `$SEEFLOW help` itself fails (binary not on PATH, `npx` unavailable), log `env-tool-missing` (`severity: blocker`, `phase: P0`, `summary: $SEEFLOW unresolved — neither local binary nor npx fallback available`) and stop.

### Studio probe + LEARN.md (parallel)

Then in a single message:

1. `curl --max-time 0.5 -fsS "$STUDIO_URL/health"`
2. Read `$learnPath` (`$PWD/.seeflow/LEARN.md`) if present → `learnContext` (else `null`). **This file is shared across every flow in this host** — do not look inside any `<flow-name>/` folder for it. Format: `references/learn-format.md`.

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
- **`$learnPath`:** still write the flow row, but mark it `(design-only)` in the purpose column so the next run knows the canvas is not wired to a real system.

### Phase 1 → Phase 2 overlap

Start `seeflow-node-planner` as soon as the code-analyzer returns — it only needs the code-analyzer's brief plus `techStack`. The system-analyzer continues in the background.

When the system-analyzer returns:

0. **Size-check the payload first.** Measure the JSON byte length. If > 16 KB (twice the agent's budget — see `agents/seeflow-system-analyzer.md` § "Output budget"), the analyzer drifted. Apply the per-field caps from that section before merging: truncate `gotchas[]` to 10, `fixtures[]`/`factories[]` to 8, prose fields to 400 chars, etc. Drop any inherited fact that already appears verbatim in `$learnPath` (the merger would keep it anyway). Log `agent-output-corrected` once with `agent: seeflow-system-analyzer, details: oversize-learnupdates-truncated (Nb → Mb)`. The trimmed payload is what feeds steps 1–3.
1. Merge `learnUpdates` into `$learnPath` (`$PWD/.seeflow/LEARN.md` — create `$PWD/.seeflow/` if missing; the file is shared across every flow in this host). Anything about boot, ports, env vars, fixtures, gotchas, or tech adaptations MUST land in the file. Re-cap `$learnPath` to ~6 KB after the merge per `references/learn-format.md` § "Merging rules" (push oldest gotchas into a collapsed `<details>` block).
2. Splice `runtimeProfile` + `$learnPath` facts into the in-memory context brief used by Phase 4. **Forward the *trimmed* payload — never the raw analyzer output** — and only the fields each designer actually consumes (`runtimeProfile`, the matching `techAdaptations.<techId>` for techs in this flow, the relevant `dataEntryPaths`, top 5 `gotchas`). The rest stays in `$learnPath` for the next run; it doesn't need to ride along in every designer prompt.
3. Merge `knownEndpoints` / `techStack` from the code-analyzer into the same write.

**Resolve tech refs.** Map each `techId` in the merged `## Tech stack` to `references/tech/<techId>.md`. Forward those paths and the matching `## Tech stack adaptations` into Phase 2 / 4 prompts (~3–5 refs per flow). If the system-analyzer hasn't returned yet, forward whatever `techAdaptations` `$learnPath` already had; the planner produces a first draft and the user reviews in Phase 3 anyway.

## Phase 2 — plan nodes

**Look up the current node + connector contract from the CLI first.** Before drafting anything, run `$SEEFLOW schema node` and `$SEEFLOW schema connector` (parallel; one message, two Bash calls) and capture both outputs. Pass them to the planner alongside the brief — the planner has no shell, so what you don't forward, it doesn't know. Skipping this step lets the planner invent fields the CLI rejects on `flow:add-bulk`, burning a retry.

Launch `seeflow-node-planner` with: the brief, the resolved tech-ref paths, the matching `techAdaptations`, and the two CLI outputs above. No tools — pure reasoning. The planner reads each ref's **Node modelling** section and treats `techAdaptations` as the project-specific override.

**Connectors conform to `$SEEFLOW schema connector` and nothing more.** If the planner emits any field the contract rejects, strip it before `flow:add-bulk` and log `agent-output-corrected` with `details: connector-extras-stripped (×N)`. Do not enumerate the legal fields here — re-run the schema command whenever in doubt.

- **Resource nodes first** — every DB, queue, event bus, cache, file store, external SaaS gets its own node, typed `rectangle` with a matching Lucide `icon` (`database`, `list-ordered`, `radio-tower`, `cloud`, `server`) and a `statusAction` capability when state is worth probing.
- **Abstraction** — one node per service / workflow / worker / queue / DB. Exceptions: independently-meaningful pipeline stages, fan-out consumers, branches, and services hosting multiple independent state machines.
- **Duplicate shared resources for clarity.** When a DB / queue / bus is referenced by many nodes and the lines tangle the canvas, split it into role-specific copies (`orders-db-read`, `orders-db-write`) sharing the same `type` + `data.icon` + `data.name` but distinct `id`s.

Output: a single envelope carrying `name`, `slug`, `nodes`, `connectors`, and `rationales` (planner-only sibling map). The `nodes` and `connectors` arrays must conform to `$SEEFLOW schema node` and `$SEEFLOW schema connector` — they are forwarded verbatim in a single body to the `flow:add-bulk` subcommand in Phase 3. Any key the CLI rejects here is rejected at `flow:add-bulk` too. One retry on unparseable output, then surface and stop. Full contract: `agents/seeflow-node-planner.md`.

**Validate the envelope before continuing.** A parseable JSON blob is not the same as a complete envelope. After `JSON.parse`, assert every required key is present and non-empty:

- `typeof name === 'string' && name.length > 0`
- `typeof slug === 'string' && slug.length > 0`
- `Array.isArray(nodes) && nodes.length > 0`
- `Array.isArray(connectors)` (may be empty for single-node flows)
- `rationales && typeof rationales === 'object' && Object.keys(rationales).length === nodes.length` (one entry per node id)

If any assertion fails, **re-dispatch the planner once** with the specific gap echoed back in the prompt (`Your previous output was missing: name, rationales[3 of 5 nodes]. Re-emit the full envelope.`). On second failure, log `agent-output-incomplete` (`severity: failure`, `phase: P2`, `agent: seeflow-node-planner`, `details: <missing-keys>`, `summary: planner returned partial envelope after retry`), surface, and stop. **Never silently synthesise the missing fields** — losing the planner's own justifications at the Phase 3 review gate is a real loss of signal, and a fabricated `name`/`slug` ships under the planner's authority without its review.

## Phase 3 — scaffold, populate, layout, review

The skeleton flow lands via four steps, in order. No `flow.json` authoring by hand — `projects:create` writes the empty envelope for you. Run `$SEEFLOW help <command>` for each subcommand's body shape and flags.

1. **Scaffold + register inside the project via `projects:create`.** This is the entry point for a new project: the CLI writes the empty `flow.json` at `<repoPath>/flow.json` (project root) and registers it in one shot.

   **Existing-flow gate — check before the CLI write.** Test `test -f "$repoPath/flow.json"`. If the file exists (or `projects:create` later returns `alreadyExists` exit code 4 because the pre-check raced), STOP and ask via `AskUserQuestion` — **never silently overwrite, never silently fall back**:

   > A SeeFlow flow is already registered at this path. What do you want to do?
   >
   > 1. **Open the existing flow** *(Recommended)* — skip creation; run `$SEEFLOW register --path "$repoPath"` to re-attach the existing envelope, surface `$STUDIO_URL/d/<slug>`, then stop. If the user wanted to inspect rather than edit, hand off to `/seeflow-lookup`.
   > 2. **Create a new flow with a different name** — ask the user for a new flow name, recompute `$repoPath = $PWD/.seeflow/<new-slug>`, then retry this step (Phase 1/2 only rerun if the user's intent also changed).
   > 3. **Overwrite the existing flow** — destructive. Confirm once more, then `$SEEFLOW flows:delete --path "$repoPath"` (and `rm -rf "$repoPath"` for any sidecar leftovers), then retry this step.

   Log one `plan-revision` per session (`severity: friction`, `phase: P3`, `summary: existing flow at target path; user picked <open|rename|overwrite>`). Debounce — even if the user toggles between options, the entry is written once.

   Gate clear → forward the planner-supplied `name` (and `description` if the planner provided one):

   ```bash
   $SEEFLOW projects:create --path "$repoPath" --name "$plannerName" [--description "$plannerDescription"]
   ```

   The studio writes the envelope, adds a registry entry under `~/.seeflow/registry.json`, and returns `{ id, slug }` (slug is derived from `name`). **Capture `id` from the response and use it (not `slug`) for every follow-up CLI call below** — several commands document slug support in `help` but the server only resolves by id today. **Registration is a precondition for opening the canvas:** the `$STUDIO_URL/d/<slug>` route only works after this step succeeds, so never surface the canvas URL to the user before this step.

   If `projects:create` returns `alreadyExists` (code 4) after the pre-check passed (filesystem race), loop back to the gate above and let the user decide — do not auto-fall-back. Do not hardcode the envelope shape from memory; if you need to inspect what `projects:create` writes, run `$SEEFLOW schema flow`.

2. **Normalize the planner output:** strip `rationales` (keep them in memory for the review prompt below), then for the planner's designated trigger node (the one whose `data.playAction` is set even as a placeholder), inject the minimum `playAction` payload the contract requires so the server accepts the batch. Look up the exact required fields by running `$SEEFLOW schema action` and `$SEEFLOW schema node` (the `PlayAction` shape's required keys) — do not hardcode the shape from memory. Pick the interpreter from `runtimeProfile.primaryLanguage` (falling back to `bun`) and point `scriptPath` at `scripts/play.ts`. The Phase 4 play-designer overwrites the placeholder with the real action via `nodes:patch`. The script file does not need to exist yet — Phase 5 writes it, Phase 6 runs it.
2a. **Mint canonical ids.** Planner ids are descriptive (`checkout-api`, `c-order-server-event-bus`); the studio's id producers (canvas, server auto-assign, the upload endpoint regex) use `node-<10 base62>` / `conn-<10 base62>`. Rewrite at the boundary so flow.json matches. Use the CLI — it shares the exact alphabet and rejection-sampling logic with every other id producer in the studio:
   ```bash
   mapfile -t nodeIds < <($SEEFLOW ids node "${#nodes[@]}")
   mapfile -t connIds < <($SEEFLOW ids connector "${#connectors[@]}")
   ```
   For each `nodes[i].id` that already matches `^node-[A-Za-z0-9]{10}$` (edit-case reuse from `editTarget`), keep it; only mint new canonical ids for net-new nodes. Build a `descriptiveId → canonicalId` map and rewrite:
   - `nodes[].id`
   - `connectors[].id`, `connectors[].source`, `connectors[].target`
   - `rationales` keys (kept in memory for the review prompt)
2b. **Log any silent corrections** from steps 2 and 2a (see `feedback.md`). For each correction kind that fired (placeholder-`playAction` injection, descriptive→canonical id rewrite, unknown-type rename, unknown-field rename, bidir-connector strip, user-to-system-rectangle retype, …), emit **one** `agent-output-corrected` entry with `severity: corrected`, `phase: P3`, `agent: seeflow-node-planner`, and `details: <correction-kind> (×N)` where N is the count. Aggregate across nodes — never one entry per node. If no corrections were needed, log nothing. This is the signal that the planner drifted from the contract; without it, the orchestrator's silent patching is invisible.

   **`user-to-system-rectangle` retype rule.** If the planner shipped `type:'user'` for a node whose `data.name` is clearly a software system (`Web UI`, `Mobile App`, `Browser`, `SPA`, `Desktop Client`, `CLI`, `SDK`, anything ending in `Client`/`App`/`UI`/`Frontend`/`Service`), silently retype to `rectangle` with `data.icon` inferred from the name (`monitor` for web/UI/frontend, `smartphone` for mobile, `terminal` for CLI, `plug` for SDK/Client). Keep `type:'user'` only when `data.name` is a human role (`Customer`, `Support Agent`, `Reviewer`, `Approver`, `Operator`). Log one aggregate `agent-output-corrected` entry with `details: user-to-system-rectangle (×N)`. The Phase 3 canvas review surfaces the result to the user — they see the correction.
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

**Look up the action + node contract from the CLI first.** Run `$SEEFLOW schema action` and `$SEEFLOW schema node` (parallel; one message, two Bash calls) and capture both outputs. Pass them to each designer alongside the brief — designers have no shell, so what you don't forward, they don't know. The same outputs serve both designers; reuse them. Skipping this step lets the designer invent fields the CLI rejects on `nodes:patch`, burning a retry.

Output shape (both): `{ nodeId, patch, scriptFile: {path, body, chmod}, validationSafe?, rationale }` triples. `patch` is the exact body for `seeflow nodes:patch`. `scriptFile.path` is project-root-relative (`nodes/<nodeId>/scripts/<name>`); `playAction.scriptPath` inside `patch` is node-folder-relative (`scripts/play.ts`). Full contracts: `agents/seeflow-play-designer.md`, `agents/seeflow-status-designer.md`.

**Sample data priority:** integration/e2e fixtures (`runtimeProfile.integrationTestDir`, copy verbatim) → seed / migration / ORM factories → README / OpenAPI / Postman examples → invent last, note in `rationale`.

`newTriggerNodes` (play-designer only) may inject synthetic sources (file-drop, webhook receiver) when no natural trigger exists. Shape: `{nodes, connectors}` — same as the planner's output.

## Phase 5 — patch overlays + layout

For each overlay returned by Phase 4 (parallelise the writes when the script bodies don't depend on each other):

1. Write `scriptFile.body` to `scriptFile.path` (Write tool).
2. `chmod` per `scriptFile.chmod` (default 755).
3. Call `nodes:patch` with the overlay's `patch` body. (Body shape: `$SEEFLOW help nodes:patch`.)

If the play-designer emitted `newTriggerNodes`, batch them via `flow:add-bulk` (one call, both arrays atomic), then re-run `flows:layout`. (Body shape: `$SEEFLOW help flow:add-bulk`.)

**Edit-case retype routing.** When the Phase 2 diff against `editTarget` flags a node whose `id` already exists but whose `type` changed (e.g. a former trigger `rectangle` reshaped to a decorative `database`), route it through `nodes:patch { type, ...required fields }` — **not** `nodes:delete` + `flow:add-bulk`. The patch path preserves the per-node folder under `nodes/<id>/`; the delete cascade destroys it. The server validates required fields for the new type after the merge (e.g. `* → image` needs `path`, `* → icon` needs `icon`, `* → html` accepts an optional `html` string); a `badSchema` exit means feed the issues to the play-designer and retry.

**Retry budget:** per-node `nodes:patch` failure → re-dispatch *that one* designer with the CLI's reported issues, retry, **max 3 per node**. Parallelise re-dispatches when more than one node failed (Phase 1 rule). When the budget is exhausted for a node, log `retry-exhausted` (`severity: failure`, `phase: P5`, `code: badSchema` (or the actual code), `summary: nodes:patch retries exhausted on <kind> (N nodes)`). Aggregate across nodes — one entry per (kind, code) pair, not one per node.

## Phase 6 — end-to-end validation

**Must run. Do not skip or simulate.**

Run the `e2e` subcommand for the flow. Pass `--skip-nodes` with the `nodeId`s of any Phase 4 overlays whose `validationSafe === false` (third-party or paid actions); skipped nodes appear in `skipped[]`, not as failures. Body / flag details: `$SEEFLOW help e2e`.

**`ok: true`** → print `Flow "<name>" registered as <slug>. Open: $STUDIO_URL/d/<slug>`, then `rm -rf "$SEEFLOW_TMP"` to clear project-local scratch. Done.

**`ok: false`** fix-up loop:

1. Identify failing nodes from `plays[*].error` / `statuses[*].outcome`.
2. **Parallel fix-up (Phase 1 rule):** one sub-agent per failing script, single message. A single agent fixing N scripts cross-contaminates.
3. Each agent gets the script path (under `nodes/<nodeId>/scripts/`), the specific error payload, and a concrete fix hypothesis (`play.ts: ECONNREFUSED on :3001 — start the app first`).
4. Edit in-place, re-run the `e2e` subcommand. **Max 2 retries**, then log `seeflow:e2e-fail` (`severity: failure`, `phase: P6`, `details: <N> failing scripts after fix-up`, `summary: e2e ok:false after retry budget exhausted`) and ask retry / stop.

If the run is design-only (Phase 1 fallback), skip Phase 6 entirely and log `phase-skipped` (`severity: degraded`, `phase: P6`, `details: design-only`, `summary: e2e skipped — no runtime to validate against`).

### Polish LEARN.md with anything learned

If Phases 5-6 surfaced something the next run would want — port mismatch, fixture path, missed env var, working seed command, useful data-entry path — append to `$learnPath` (`Gotchas` bullet or the relevant section). Also append the flow to the "Flows already created" table with today's date and a one-line purpose. Skip if nothing new — empty updates are noise. The file is shared across every flow in this host, so the table accumulates every flow the skill has ever scaffolded here.

**Tech-specific learnings** (a helper, a required attribute, an emulator quirk, a fixture path) go in `## Tech stack adaptations` → `### <techId>`, not just `## Gotchas`. If the code-analyzer missed a tech entirely, also append the `techId` to `## Tech stack`. This is what makes the next `/seeflow` run reuse the work.

## Operations

| Topic | File |
|---|---|
| CLI resolver + discovery via `$SEEFLOW help` | `references/cli.md` |
| Error handling, retry caps, sub-agent table | `references/operations.md` |
| Per-node file convention, action runtime budgets, when-to-use guidance | `references/schema.md` |
| Core rules | `references/core-rules.md` |
| `$learnPath` format, lifecycle, merging, `learnUpdates` contract | `references/learn-format.md` |
| Tech-specific best practices | `references/tech/README.md` |
| Sub-agent prompts | `agents/seeflow-*.md` |
| Feedback collection — consent, kinds, format, redaction, hook handoff | `feedback.md` |
| Canonical id generator | `$SEEFLOW ids <node\|connector> <count>` |
