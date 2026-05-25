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

`~/.seeflow/` (user-home) is a separate, unrelated directory that holds the studio's global registry / config / pid files; leave its paths verbatim wherever they appear.

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
| `$SEEFLOW_TMP` | `$projectPath/.tmp/` — project-local scratch directory. Full lifecycle in §"Scratch files & cleanup" below. |
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
P0    /health probe ‖ read $learnPath ‖ schema cache (5×)
      → schema-type diff (silent)
      → input-source gate ($inputClass: code | conversation | document)
P1    branches on $inputClass:
        code         → code-analyzer ‖ system-analyzer
        conversation → orchestrator builds brief inline; system-analyzer
                       runs only if runtime relevant
        document     → both analyzers skipped; brief built inline
      learnUpdates STAGED in memory only — no disk write yet
P2    node-planner (kicks off when brief ready; receives cached
                   schema + $componentCatalog + $inputClass)
P3    projects:create (path + name → empty flow.json registered)
      → flow:add-bulk (nodes + connectors, atomic)
      → detail-backfill (unconditional; missing data.detail → nodes:patch)
      → flows:layout
      → SILENT LEARN.md write #1 (merge staged learnUpdates + upsert flow row)
      → USER REVIEW + dynamic gate (one combined ask)
          static branch  → SILENT LEARN.md write #2 → final-flow line
P4    play-designer ‖ status-designer (cached schema forwarded)
P5    write scripts to nodes/<nodeId>/scripts/
      → nodes:patch (per node, with playAction / statusAction)
      → optional newTriggerNodes via flow:add-bulk
      → flows:layout
P6    e2e
      → SILENT LEARN.md write #2 (re-upsert flow row + append P5/P6 deltas)
      → final-flow line
```

Each phase gates on the previous (with the Phase 1 → Phase 2 overlap).

## Core rules

Full text in `references/core-rules.md`:

1. **No mocks.** Real services, real state. If something isn't running, stop and ask.
2. **Bigger picture before INSERTs.** Use the natural data-entry path (API, file-drop, producer, seed, webhook).
3. **Match the project's primary language.** Use `runtimeProfile.primaryLanguage` for every script.

## Common mistakes

- **Serial sub-agent dispatch.** One message, N Task calls — see Phase 1's wrong/right.
- **Authoring `flow.json` directly.** Every mutation is a CLI call.
- **Asking "what's your codebase?".** Launch the analyzers — that is their job. (Exception: `inputClass === "conversation" | "document"` — the brief comes from elsewhere.)
- **Skipping or simulating Phase 6.** Mandatory for `inputClass === "code"`; legitimately skipped for `"document"`.
- **Mocking services or fake fixtures.** Use real triggers; copy fixtures from integration tests.
- **Passing `<slug>/scripts/…` as `scriptPath`.** New anchor is the node folder — emit just `scripts/play.ts`.
- **Writing `LEARN.md` inside a per-flow folder.** `$learnPath = $PWD/.seeflow/LEARN.md` is **shared across every flow** in the host repo — never inside `<flow-name>/`.

## Phase 0 — pre-flight (parallel)

### Lookup-first gate — run before anything else

If the user's prompt reads as **inspection** rather than creation — any of "show me", "show the", "how does", "how do", "what does", "diagram", "explain", "where does", "what handles" — STOP and route through `/seeflow-lookup` instead. That skill catalogues registered flows and only hands back here if nothing matches. Going straight to creation when a flow already exists wastes the run and surfaces a duplicate. The same gate applies when the user names a flow by slug or title without an explicit verb ("the CRN Enhancement flow", "the checkout flow") — assume inspection unless they prefix it with "create / scaffold / generate / add".

Creation-only triggers (skip the gate): the prompt explicitly says "create / scaffold / generate / add a flow", or `/seeflow-lookup` has already run in this turn and reported no match.

### Task checklist

Create a `TaskCreate` checklist of the six phases (`Phase 1 — discover` … `Phase 6 — end-to-end validation`); `TaskUpdate` each as it finishes. Phases skipped at the dynamic gate get marked completed with a one-line note. (If `TaskCreate`/`TaskUpdate` aren't loaded, run `ToolSearch` with `select:TaskCreate,TaskUpdate` first.)

### Capability probe — run before anything else

Run `$SEEFLOW help` once and confirm every required subcommand is present: `projects:create`, `register`, `flow:add-bulk`, `flows:layout`, `nodes:patch`, `schema`, `ids`, `e2e`. (Older `@tuongaz/seeflow` versions on `npx` lack one or more — `ids` was added with the project-local scaffold flow; `projects:create` is the current new-project entry point.) For each missing subcommand, surface to the user and stop.

- Required missing → tell the user which subcommand is missing and that they should run `npm i -g @tuongaz/seeflow@latest` and retry. Then stop — do **not** start Phase 1.
- All present → continue.

If `$SEEFLOW help` itself fails (binary not on PATH, `npx` unavailable), surface the failure (`$SEEFLOW unresolved — neither local binary nor npx fallback available`) and stop.

### Schema cache — fetch once, reuse everywhere

In a single message, run the five schema calls in parallel and cache the outputs (`$schemaCache.flow`, `$schemaCache.node`, `$schemaCache.connector`, `$schemaCache.action`, `$schemaCache.style`):

```
$SEEFLOW schema flow  ‖  $SEEFLOW schema node  ‖  $SEEFLOW schema connector  ‖  $SEEFLOW schema action  ‖  $SEEFLOW schema style
```

Phase 2 (node-planner) and Phase 4 (play/status designers) read from this cache via their launching prompts — they never re-fetch. The designers have no shell, so what you don't forward, they don't know; skipping the forward lets them invent fields the CLI rejects on `flow:add-bulk` / `nodes:patch`, burning a retry. If any of the five calls fails, surface the failure (`$SEEFLOW schema <name> failed; downstream agents cannot author conforming JSON`) and stop.

**Extract the component catalog.** Pull the legal `spec.elements[].type` enum from `$schemaCache.node`'s `component` variant into `$componentCatalog`. Required input for the planner whenever it emits `type:'component'` nodes (default for `inputClass === "document"` flows).

### Schema-type surface diff — silent

Diff the skill-documented node-type list (codified in `references/schema.md` § "Skill-known node types" — 13 entries: `rectangle, ellipse, sticky, text, database, server, user, queue, cloud, icon, html, image, component`) against the actual discriminator values in `$schemaCache.node`:

- `missing = expectedTypes - actualTypes` — install omits a type the skill still references.
- `extra = actualTypes - expectedTypes` — install exposes a type the skill doesn't document.

If either set is non-empty, continue silently — this is a maintainer signal, not a runtime problem; the planner will still produce a flow using whatever types the CLI actually accepts. Do not surface to the user.

### Input-source gate — pick the brief's origin

Decide `$inputClass` before launching Phase 1. Three values:

| Class | Trigger | Phase 1 behaviour |
|---|---|---|
| `code` | Project root has a source tree AND the user's ask is about a running system ("show how X works", "diagram our pipeline", "add a flow for Y"). Default. | Launch code-analyzer + system-analyzer as today. |
| `conversation` | The current session already carries the brief's substance — ≥3 file references discussed, named entities, a tech stack mentioned — OR the user explicitly opts in ("use what we just discussed", "based on what we've been looking at"). | Skip the code-analyzer; the orchestrator builds the brief inline from the conversation. System-analyzer still runs when the flow touches a runtime; skip it too when the discussion already covered dev setup. |
| `document` | User's prompt anchors on a document to visualise rather than a system to diagram — gap analysis, comparison, status report, RFC, architectural narrative, checklist, audit — OR the project root has no source tree and the user wants the canvas to render structured information. (Folds in the old "empty-project / design-only" branch.) | Skip both analyzers. The orchestrator builds the brief inline from the prompt + any pasted / referenced document text and sets `inputClass: "document"`. The planner defaults to `component` nodes from `$componentCatalog`, falling back to `html` for content the catalog can't render. |

Heuristic ladder, applied in order:

1. **Explicit user phrase** — pick the matching class without asking. ("Use what we just discussed" → `conversation`; "render this gap analysis" → `document`.)
2. **No source tree** — default to `document`. The empty-project / design-only branch from the prior skill version is now the no-source-tree case of `document`.
3. **Document-anchored prompt** — verbs like "render", "show this", "lay out", "visualise" + a noun like "report", "analysis", "comparison", "spec", "checklist" → `document`.
4. **Rich conversation context** — heuristic counts: ≥3 distinct file paths quoted, named services / DBs / queues, an articulated `techStack` already in-thread → `conversation`.
5. **Default** — `code`.

When the heuristic is genuinely ambiguous (e.g. source tree present AND a document discussed), ask once via `AskUserQuestion` with three options (`code`, `conversation`, `document`) and a one-line description each. Debounce — never re-ask the same question in a single session.

### Studio probe + LEARN.md (parallel)

Then in a single message:

1. `curl --max-time 0.5 -fsS "$STUDIO_URL/health"`
2. Read `$learnPath` (`$PWD/.seeflow/LEARN.md`) if present → `learnContext` (else `null`). **This file is shared across every flow in this host** — do not look inside any `<flow-name>/` folder for it. Format: `references/learn-format.md`.

- **200** → Phase 1.
- **!200** → tell the user the studio isn't running, warn the first launch can take a minute or two if it has to fall back to `npx`, then run the CLI's `start` subcommand. Re-probe `/health` once. If still unreachable, surface the failure (`studio /health unreachable after start retry`) and stop.

## Phase 1 — discover (parallel)

The phase branches on `$inputClass` (set in Phase 0's input-source gate). Each branch yields a `contextBrief` with `inputClass` populated so downstream agents know how to interpret it.

### `inputClass === "code"` — launch both analyzers in parallel

**Single message, two `Task` calls.** Serial launch roughly doubles wall-clock for zero benefit.

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

- `seeflow-code-analyzer` — in: `userPrompt`, `projectRoot`, `existingDemo`, `learnContext`. Out: `inputClass: "code"`, `userIntent`, `audienceFraming`, `scope`, `codePointers`, `knownEndpoints`, `techStack`, `existingDemo`.
- `seeflow-system-analyzer` — in: `projectRoot`, `inputClass: "code"`, `learnContext`. Out: `runtimeProfile` + a `learnUpdates` payload (`localDevSetup`, `integrationTests`, `fixtures`, `factories`, `seedCommands`, `dataEntryPaths`, `gotchas`, `techAdaptations`). **Every fact it learns about how to start / set up the local environment MUST land in `learnUpdates`.**

Tools: `Read, Grep, Glob, LS, Bash` (read-only). Schemas: `agents/seeflow-code-analyzer.md`, `agents/seeflow-system-analyzer.md`, `references/learn-format.md`. Unparseable output: retry that single agent once, then surface (`<agent> returned unparseable JSON after retry`) and stop. The same rule applies to every sub-agent in Phases 2 and 4.

### `inputClass === "conversation"` — orchestrator builds brief inline

Skip the code-analyzer. Build the same envelope it would have produced from the in-session conversation: extract `userIntent`, `audienceFraming`, `scope.{rootEntities,outOfScope}`, `codePointers[]` (file paths discussed with one-line `why`), `knownEndpoints[]` (any HTTP / queue / event surfaces named), `techStack[]`, `existingDemo`. Set `inputClass: "conversation"` on the brief.

System-analyzer still runs when the flow touches a runtime AND the conversation hasn't already covered dev setup. Skip it (no Task call) when the conversation already named the dev command, ports, fixtures — those facts come into the brief from `$learnPath` and the conversation directly. When skipped, set `runtimeProfile: null` on the brief.

### `inputClass === "document"` — skip both analyzers

Build the brief inline from the user's prompt + any document text in the conversation:

```json
{
  "inputClass":     "document",
  "userIntent":     "<paraphrase of what the document depicts>",
  "audienceFraming":"information-display — the canvas IS the document",
  "scope":          { "rootEntities": [<sections / topics from the document>], "outOfScope": [] },
  "codePointers":   [],
  "knownEndpoints": [],
  "techStack":      [],
  "existingDemo":   null,
  "runtimeProfile": null
}
```

The planner branches on `inputClass === "document"` and defaults to `component` nodes (catalog-driven UI cards) per its §"Picking node `type` by input class". The orchestrator forwards `$componentCatalog` (from the Phase 0 schema cache) so the planner can pick legal `spec.elements[].type` values.

Downstream consequences (document branch):
- **Phase 3 dynamic gate:** default to **static** without re-asking. Document flows have no runtime to react to.
- **Phase 6 (e2e):** N/A — skip with a one-line note when summarising the run.
- **`$learnPath`:** at Save #1 and Save #2, the upserted flow row carries a `(document)` marker in the purpose column so the next run knows the canvas is not wired to a real system.

### Phase 1 → Phase 2 overlap

Applies to `inputClass === "code"` (and to `"conversation"` when the system-analyzer was launched). For `"document"` and the no-system-analyzer `"conversation"` path, the brief is complete the moment the orchestrator builds it inline — go straight to Phase 2.

For `"code"`: start `seeflow-node-planner` as soon as the code-analyzer returns — it only needs the code-analyzer's brief plus `techStack`. The system-analyzer continues in the background.

When the system-analyzer returns:

0. **Size-check the payload first.** Measure the JSON byte length. If > 16 KB (twice the agent's budget — see `agents/seeflow-system-analyzer.md` § "Output budget"), the analyzer drifted. Apply the per-field caps from that section before merging: truncate `gotchas[]` to 10, `fixtures[]`/`factories[]` to 8, prose fields to 400 chars, etc. Drop any inherited fact that already appears verbatim in `$learnPath` (the merger would keep it anyway). The trimmed payload is what feeds steps 1–3.
1. **Stage** `learnUpdates` in memory — DO NOT write `$learnPath` to disk yet. The first disk hit is Save #1 in Phase 3 step 7, after the studio has registered the flow. Writing earlier risks leaving stale rows behind if the run aborts.
2. Splice `runtimeProfile` + `$learnPath` facts (the existing on-disk content read at Phase 0, plus the staged updates) into the in-memory context brief used by Phase 4. **Forward the *trimmed* payload — never the raw analyzer output** — and only the fields each designer actually consumes (`runtimeProfile`, the matching `techAdaptations.<techId>` for techs in this flow, the relevant `dataEntryPaths`, top 5 `gotchas`).
3. Stage `knownEndpoints` / `techStack` from the code-analyzer alongside the system-analyzer's updates — same staged buffer, same Save #1 destination.

**Resolve tech refs.** Map each `techId` in the staged `techStack` (union of `$learnPath`'s existing `## Tech stack` and the analyzer updates) to `references/tech/<techId>.md`. Forward those paths and the matching staged `techAdaptations` into Phase 2 / 4 prompts (~3–5 refs per flow). If the system-analyzer hasn't returned yet, forward whatever `techAdaptations` `$learnPath` already had on read; the planner produces a first draft and the user reviews in Phase 3 anyway.

## Phase 2 — plan nodes

Launch `seeflow-node-planner` with: the brief (carrying `inputClass`), the resolved tech-ref paths, the matching `techAdaptations`, `$schemaCache.node`, `$schemaCache.connector` (forward verbatim — see Phase 0 §"Schema cache"), and `$componentCatalog` (required whenever the planner may emit `type:'component'` — i.e. always for `inputClass === "document"` flows, defensively for the other two classes). No tools — pure reasoning. The planner reads each ref's **Node modelling** section, treats `techAdaptations` as the project-specific override, and branches on `inputClass` for the type-picker default ladder.

**Connectors conform to `$SEEFLOW schema connector` and nothing more.** If the planner emits any field the contract rejects, strip it before `flow:add-bulk`. Do not enumerate the legal fields here — re-run the schema command whenever in doubt.

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

If any assertion fails, **re-dispatch the planner once** with the specific gap echoed back in the prompt (`Your previous output was missing: name, rationales[3 of 5 nodes]. Re-emit the full envelope.`). On second failure, surface (`planner returned partial envelope after retry — missing <keys>`) and stop. **Never silently synthesise the missing fields** — losing the planner's own justifications at the Phase 3 review gate is a real loss of signal, and a fabricated `name`/`slug` ships under the planner's authority without its review.

## Phase 3 — scaffold, populate, layout, review

The skeleton flow lands via seven steps, in order. No `flow.json` authoring by hand — `projects:create` writes the empty envelope for you. Run `$SEEFLOW help <command>` for each subcommand's body shape and flags.

1. **Scaffold + register inside the project via `projects:create`.** This is the entry point for a new project: the CLI writes the empty `flow.json` at `<repoPath>/flow.json` (project root) and registers it in one shot.

   **Existing-flow gate — check before the CLI write.** Test `test -f "$repoPath/flow.json"`. If the file exists (or `projects:create` later returns `alreadyExists` exit code 4 because the pre-check raced), STOP and ask via `AskUserQuestion` — **never silently overwrite, never silently fall back**:

   > A SeeFlow flow is already registered at this path. What do you want to do?
   >
   > 1. **Open the existing flow** *(Recommended)* — skip creation; run `$SEEFLOW register --path "$repoPath"` to re-attach the existing envelope, surface `$STUDIO_URL/d/<slug>`, then stop. If the user wanted to inspect rather than edit, hand off to `/seeflow-lookup`.
   > 2. **Create a new flow with a different name** — ask the user for a new flow name, recompute `$repoPath = $PWD/.seeflow/<new-slug>`, then retry this step (Phase 1/2 only rerun if the user's intent also changed).
   > 3. **Overwrite the existing flow** — destructive. Confirm once more, then `$SEEFLOW flows:delete --path "$repoPath"` (and `rm -rf "$repoPath"` for any sidecar leftovers), then retry this step.

   Gate clear → forward the planner-supplied `name` (and `description` if the planner provided one):

   ```bash
   $SEEFLOW projects:create --path "$repoPath" --name "$plannerName" [--description "$plannerDescription"]
   ```

   The studio writes the envelope, adds a registry entry under `~/.seeflow/registry.json`, and returns `{ id, slug }` (slug is derived from `name`). **Capture `id` from the response and use it (not `slug`) for every follow-up CLI call below** — several commands document slug support in `help` but the server only resolves by id today. **Registration is a precondition for opening the canvas:** the `$STUDIO_URL/d/<slug>` route only works after this step succeeds, so never surface the canvas URL to the user before this step.

   If `projects:create` returns `alreadyExists` (code 4) after the pre-check passed (filesystem race), loop back to the gate above and let the user decide — do not auto-fall-back. Do not hardcode the envelope shape from memory; if you need to inspect what `projects:create` writes, run `$SEEFLOW schema flow`.

2. **Normalize the planner output:** strip `rationales` (keep them in memory for the review prompt below), then for the planner's designated trigger node (the one whose `data.playAction` is set even as a placeholder), inject the minimum `playAction` payload the contract requires so the server accepts the batch. Use `$schemaCache.action` and `$schemaCache.node` (Phase 0) to look up the `PlayAction` shape's required keys — do not hardcode the shape from memory. Pick the interpreter from `runtimeProfile.primaryLanguage` (falling back to `bun`) and point `scriptPath` at `scripts/play.ts`. The Phase 4 play-designer overwrites the placeholder with the real action via `nodes:patch`. The script file does not need to exist yet — Phase 5 writes it, Phase 6 runs it. **Skip this normalisation entirely for `inputClass === "document"` flows** — document flows usually carry no trigger, and the planner deliberately omits `playAction` per its input-class rules.
3. **Mint canonical ids.** Planner ids are descriptive (`checkout-api`, `c-order-server-event-bus`); the studio's id producers (canvas, server auto-assign, the upload endpoint regex) use `node-<10 base62>` / `conn-<10 base62>`. Rewrite at the boundary so flow.json matches. Use the CLI — it shares the exact alphabet and rejection-sampling logic with every other id producer in the studio:
   ```bash
   mapfile -t nodeIds < <($SEEFLOW ids node "${#nodes[@]}")
   mapfile -t connIds < <($SEEFLOW ids connector "${#connectors[@]}")
   ```
   For each `nodes[i].id` that already matches `^node-[A-Za-z0-9]{10}$` (edit-case reuse from `editTarget`), keep it; only mint new canonical ids for net-new nodes. Build a `descriptiveId → canonicalId` map and rewrite:
   - `nodes[].id`
   - `connectors[].id`, `connectors[].source`, `connectors[].target`
   - `rationales` keys (kept in memory for the review prompt)
   **`user-to-system-rectangle` retype rule.** If the planner shipped `type:'user'` for a node whose `data.name` is clearly a software system (`Web UI`, `Mobile App`, `Browser`, `SPA`, `Desktop Client`, `CLI`, `SDK`, anything ending in `Client`/`App`/`UI`/`Frontend`/`Service`), silently retype to `rectangle` with `data.icon` inferred from the name (`monitor` for web/UI/frontend, `smartphone` for mobile, `terminal` for CLI, `plug` for SDK/Client). Keep `type:'user'` only when `data.name` is a human role (`Customer`, `Support Agent`, `Reviewer`, `Approver`, `Operator`). The Phase 3 canvas review surfaces the result to the user — they see the correction.
4. `flow:add-bulk` — atomic seed of nodes + connectors in one transactional write. Forward the normalized + id-rewritten `nodes` and `connectors` arrays as `{ nodes, connectors }`. Connectors may reference nodes from the same call — the server validates the merged graph as a whole, so a dangling source/target or a malformed node rolls back **both** arrays together. No two-phase commit to reason about; no orphan nodes if connectors fail.
5. **Detail backfill — runs unconditionally** (every input class, every dynamic gate outcome; the static path used to ship with blank `nodes/<id>/detail.md` because Phase 4–5 were skipped). Walk the planner's `nodes[]` (post-id-rewrite). For each non-decorative node — `rectangle`, `database`, `queue`, `cloud`, `server`, `user` (skip `sticky`, `text`, `icon`, `ellipse`, `image`, `component`, `html`; those carry content in other fields) — check whether `data.detail` was set in the planner output:
   - **Present** — already externalised by `flow:add-bulk` to `nodes/<id>/detail.md`. Nothing to do.
   - **Missing or empty** — synthesise 1–3 short markdown paragraphs from `data.name` + `data.description` + the matching `rationales[id]` + any relevant `codePointers[].why`. Push via `nodes:patch <flowId> <nodeId> --json '{"data":{"detail":"<markdown>"}}'`. The studio writes `nodes/<id>/detail.md` and stores a `file://` ref.
   Parallelise the patches across nodes — single message, N Bash calls. This is the static-flow safety net described in `seeflow-node-planner.md` § "Semantic requirements".
6. `flows:layout` — run ELK and write `style.json`.
7. **Silent LEARN.md write #1.** First disk hit for `$learnPath`. Merges staged `learnUpdates` from Phase 1 → 2 overlap AND upserts the "Flows already created" row by `slug`. Full merge contract, field list, and ~6 KB cap rule live in `references/learn-format.md` § "Lifecycle" + § "Merging rules". Run quietly — do **not** narrate to the user. Create `$PWD/.seeflow/` if missing.

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

- **Layout changes requested** → re-run node-planner with the feedback, repeat the combined ask. The dynamic answer (if given) is remembered but not acted on until the layout is approved.
- **Layout approved + dynamic** → Phase 4. If the system-analyzer is still running, await it now; Phase 4 designers need its `runtimeProfile`, fixtures, data-entry paths, and tech adaptations.
- **Layout approved + static** → **Silent LEARN.md write #2** (merge contract under Phase 6 → "Silent LEARN.md write #2"), then print `Flow "<name>" registered as <slug> (static). Open: $STUDIO_URL/d/<slug>` and stop.
- **Dynamic answer unclear or absent** → default to static (dynamic writes executable scripts; opt-in).

(`inputClass === "document"` defaults to static here without re-asking — document flows have no runtime to react to. Same applies to the no-source-tree case folded into the document branch.)

## Phase 4 — design Play + Status (parallel)

Launch `seeflow-play-designer` + `seeflow-status-designer` in parallel (Phase 1 rule). Both receive: context brief, node draft, edit target, tech-ref paths, matching `techAdaptations`, and `$schemaCache.action` + `$schemaCache.node` forwarded verbatim (see Phase 0 §"Schema cache"). They read each ref's **Play** / **Status** section and treat `techAdaptations` as the project override. Tools: `Read, Grep, Glob, LS`.

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

**Retry budget:** per-node `nodes:patch` failure → re-dispatch *that one* designer with the CLI's reported issues, retry, **max 3 per node**. Parallelise re-dispatches when more than one node failed (Phase 1 rule). When the budget is exhausted for a node, surface (`nodes:patch retries exhausted on <kind> (N nodes)`) and stop.

## Phase 6 — end-to-end validation

**Must run. Do not skip or simulate.**

Run the `e2e` subcommand for the flow. Pass `--skip-nodes` with the `nodeId`s of any Phase 4 overlays whose `validationSafe === false` (third-party or paid actions); skipped nodes appear in `skipped[]`, not as failures. Body / flag details: `$SEEFLOW help e2e`.

**`ok: true`** → run **Silent LEARN.md write #2** (see below) before announcing, then print `Flow "<name>" registered as <slug>. Open: $STUDIO_URL/d/<slug>`, then `rm -rf "$SEEFLOW_TMP"` to clear project-local scratch. Done.

**`ok: false`** fix-up loop:

1. Identify failing nodes from `plays[*].error` / `statuses[*].outcome`.
2. **Parallel fix-up (Phase 1 rule):** one sub-agent per failing script, single message. A single agent fixing N scripts cross-contaminates.
3. Each agent gets the script path (under `nodes/<nodeId>/scripts/`), the specific error payload, and a concrete fix hypothesis (`play.ts: ECONNREFUSED on :3001 — start the app first`).
4. Edit in-place, re-run the `e2e` subcommand. **Max 2 retries**, then surface (`e2e ok:false after retry budget exhausted — <N> failing scripts`) and ask retry / stop.

If the run resolved to `inputClass === "document"` (Phase 0 input-source gate), skip Phase 6 entirely. Same applies to the no-source-tree case folded into the document branch.

### Silent LEARN.md write #2

Second (and final) disk hit for `$learnPath`. Fires at the final-flow announcement on every path that reaches it — Phase 6 `ok:true` and Phase 3 "Layout approved + static". Re-upserts the "Flows already created" row AND appends anything Phases 5–6 surfaced that the next run would want (a missed port, a working seed command, a tech-adaptation a fix-up agent discovered). Tech-specific facts land in `## Tech stack adaptations` → `### <techId>`, not `## Gotchas`. Full merge contract: `references/learn-format.md` § "Lifecycle". Run quietly — do **not** narrate to the user.

This is what makes the next `/seeflow` run reuse the work.

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
| Canonical id generator | `$SEEFLOW ids <node\|connector> <count>` |
