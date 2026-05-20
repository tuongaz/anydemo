---
name: seeflow
description: Use when the user asks to "create a flow", "generate a flow", "scaffold a SeeFlow flow", "show how X works", "diagram our system", or "add a flow to this repo". Orchestrates five sub-agents and bun scripts to turn a natural-language prompt into a registered, validated SeeFlow flow under `<project>/.seeflow/<slug>/`.
---

# seeflow

Turn a natural-language prompt into a registered, runnable SeeFlow flow under `<project>/.seeflow/<slug>/`. Orchestrate five sub-agents and bun scripts; never read the codebase directly.

**Parallelism is the default.** Independent work runs concurrently in a single message — never serially. Specifically: discovery splits into a code-analyzer and a system-analyzer that MUST run in parallel; node planning starts as soon as code analysis returns (while system analysis is still running); play and status designers run in parallel in Phase 4; Phase 5 retries dispatch both designers in parallel when issues span both; Phase 7 fix-up runs one sub-agent per failing script in parallel.

**Narrate phase boundaries.** Before each phase, print a single line so the user knows what's happening — e.g. `Phase 1: discovering codebase (2 agents in parallel)…`, `Phase 3: registering skeleton flow and opening canvas…`. Silent waits feel broken; one line per phase is enough.

## When to invoke

In any project, just run:

```
/seeflow Create a flow showing how the order pipeline works
/seeflow Show how checkout works end to end
/seeflow Diagram our event-driven notification system
/seeflow Add another flow to this repo
```

Ask for clarification only when the prompt is incoherent — never ask "what is your codebase?".

## Inputs

- User's full natural-language prompt.
- Project root (`$PWD` at invocation).
- `~/.seeflow/config.json` (optional; studio host:port, default `http://localhost:4321`).
- Existing `<project>/.seeflow/<slug>/flow.json` files, if any (multi-flow per project supported).
- `<project>/.seeflow/WIKI.md` — persistent crib sheet from past `/seeflow` runs. **Always read this before launching the Phase 1 agents**; it shortcuts most of their work. Format: `references/wiki-format.md`.

## Pipeline

```
Phase 0+0.5 — studio /health probe  ┐  parallel — single message
              read .seeflow/WIKI.md ┘
Phase 1   — seeflow-code-analyzer    ┐  parallel — single message,
            seeflow-system-analyzer  ┘  two Task calls (MANDATORY)
Phase 2   — seeflow-node-planner (starts as soon as code-analyzer returns;
            system-analyzer may still be running) → node draft
            → join system-analyzer result, merge into context brief +
              wikiUpdates → .seeflow/WIKI.md
Phase 3   — write skeleton flow.json + style.json (nodes only)
            → POST /api/validate → register → user reviews canvas → approval
            → ask user: continue with dynamic Play + Status scripts?
              (YES → Phase 4; NO → stop, ship the static flow)
Phase 4   — seeflow-play-designer  ┐
            seeflow-status-designer├ parallel → overlays
                                   ┘
Phase 5   — synthesize → POST /api/validate (flow + style)
Phase 6   — write script files + flow.json + style.json → re-register full flow
Phase 7   — validate-end-to-end.ts → trigger APIs → verify via SSE
            (retry up to 2x) → print URL on success / retry-or-stop on failure
            → if anything new was learned, append it to .seeflow/WIKI.md
```

Each phase is **gated** on the previous one (with the documented Phase 1 → Phase 2 overlap). **All schema validation runs through the studio API** (`POST /api/validate`) — `scripts/validate.ts` is just a thin wrapper that POSTs the payload and surfaces issues.

## Core rules

Three rules every flow must honour. Full text + examples in `references/core-rules.md`:

1. **No mocks, ever.** Scripts trigger real services or read real state. Never simulate. If a required service isn't running, stop and ask.
2. **See the bigger picture before inserting data.** Use the system's natural data-entry path (API, file-drop, producer, seed command, webhook) instead of direct INSERTs.
3. **Match the project's primary language.** Use `runtimeProfile.primaryLanguage` as the interpreter for every script.

## Phase 0 + 0.5 — pre-flight (parallel)

Resolve `$STUDIO_URL`: `SEEFLOW_STUDIO_URL` env var → `~/.seeflow/config.json` port → `http://localhost:4321`.

**Fire these two checks in a single message — they are independent:**

1. Probe the studio: `curl --max-time 0.5 -fsS "$STUDIO_URL/health"`
2. Read `<project>/.seeflow/WIKI.md` if it exists; stash for Phase 1's `wikiContext`. If absent, `wikiContext: null`. Format + merging rules: `references/wiki-format.md`.

After both return:

- **Studio 200** → continue to Phase 1.
- **Studio !200** → tell the user the studio isn't running and that you'll start it. **Warn that the first launch can take a minute or two** while `npx` downloads the package; subsequent starts are fast. Then run (background is the default — the CLI auto-detaches; `--yes` skips npx's prompt):

  ```bash
  npx --yes tuongaz/seeflow start
  ```

  Re-probe `/health` once to confirm. If still unreachable, surface the error and stop. The `WIKI.md` read already completed in parallel — no need to repeat it.

## Phase 1 — discover (parallel)

Create a `TaskCreate` checklist before launching any sub-agent — use these exact items in this order so the orchestrator's progress display is consistent across runs:

1. `Phase 1 — discover (code + system analyzers, parallel)`
2. `Phase 2 — plan nodes`
3. `Phase 3 — register skeleton + open canvas`
4. `Phase 3.5 — dynamic gate (ask user)`
5. `Phase 4 — design Play + Status overlays (parallel)`
6. `Phase 5 — synthesize + validate`
7. `Phase 6 — write script files + re-register`
8. `Phase 7 — end-to-end validation`

Mark each complete via `TaskUpdate` immediately after it succeeds. Phases skipped by user choice (e.g. static-only at Phase 3.5) get marked completed too, with a one-line note.

**You MUST launch both discovery sub-agents in parallel — single message, two `Task` calls. Serial launch is a bug.** They are independent: one looks at code (request-specific), the other looks at the local system (request-agnostic). Doing them sequentially roughly doubles wall-clock time for zero benefit.

**Wrong (do not do this):**

```
message 1: Task(seeflow-code-analyzer, …)
            ↓ wait for return
message 2: Task(seeflow-system-analyzer, …)
```

**Right:**

```
message 1: Task(seeflow-code-analyzer, …)
           Task(seeflow-system-analyzer, …)
            ↓ both running concurrently
```

The same rule applies in Phase 4 (play + status designers), in Phase 5 retries when issues span both designers, and in Phase 7 fix-up across N failing scripts. One message, N `Task` calls — never N messages each with one call.

Launch in a single message:

- `seeflow-code-analyzer` — inputs: `userPrompt`, `projectRoot`, `existingDemo`, `wikiContext`. Returns the user-prompt-specific half of the brief: `userIntent`, `audienceFraming`, `scope`, `codePointers`, `knownEndpoints`, `techStack`, `existingDemo`.
- `seeflow-system-analyzer` — inputs: `projectRoot`, `wikiContext`. Returns the request-agnostic half: `runtimeProfile` plus a `wikiUpdates` payload covering `localDevSetup`, `integrationTests`, `fixtures`, `factories`, `seedCommands`, `dataEntryPaths`, `gotchas`, and `techAdaptations`. **It MUST surface every fact it learns about how to start / set up / run the local environment in `wikiUpdates`** — that payload is what gets persisted to `WIKI.md`, so anything it discovers and doesn't return is permanently lost.

Tools for both: `Read, Grep, Glob, LS, Bash` (read-only). Output schema details: `agents/seeflow-code-analyzer.md`, `agents/seeflow-system-analyzer.md`, and the `wikiUpdates` contract in `references/wiki-format.md`.

On unparseable output from either agent: retry that single agent once with the parse error. If still failing, surface and stop.

### Phase 1 → Phase 2 overlap

The orchestrator may **start `seeflow-node-planner` as soon as `seeflow-code-analyzer` returns** — do not wait on `seeflow-system-analyzer`. The node-planner only needs the code-analyzer's brief plus `techStack` (which the code-analyzer emits). System-analyzer continues running in the background.

When `seeflow-system-analyzer` returns:

1. **Merge `wikiUpdates` into `<project>/.seeflow/WIKI.md` immediately** following the merging rules in `references/wiki-format.md`. Create the parent `.seeflow/` directory if missing. Anything the system-analyzer learned about boot, setup, ports, env vars, fixtures, gotchas, or tech adaptations MUST land in the file on this step — it is the persistent memory for the next run.
2. Splice `runtimeProfile` and the system-analyzer's wiki facts into the in-memory context brief alongside the code-analyzer's output. The combined brief is what Phase 4 designers consume.
3. Also merge any `knownEndpoints` / `techStack` from the code-analyzer into the same `WIKI.md` write.

**Resolve tech refs.** Map each `techId` in the merged `## Tech stack` to `references/tech/<techId>.md`. Stash the resolved paths plus the matching `## Tech stack adaptations` entries — both get forwarded into the Phase 2 / 4 launch prompts so sub-agents read only the relevant refs (~3–5 per flow). If `seeflow-system-analyzer` has not returned yet when you launch the node-planner, forward whatever `techAdaptations` the wiki already had (from `wikiContext`); the planner can produce a first draft without project-specific adaptations and the user reviews the canvas in Phase 3 anyway.

## Phase 2 — plan nodes

Launch `seeflow-node-planner` with the (possibly partial) context brief, the resolved tech-ref paths, and the matching `techAdaptations` entries available so far. No tools — pure reasoning. The planner reads each ref's **Node modelling** section and treats `techAdaptations` as the project-specific override. Two mandatory passes:

- **Resource nodes first** — every DB, queue, event bus, cache, file store, and external SaaS touched by the flow gets its own `stateNode`.
- **Abstraction rules** — one node per service / workflow / worker / queue / DB (exceptions: independently-meaningful pipeline stages, fan-out consumers, branches).
- **Connection limit** — max **4 total connections** (in + out) per node. When exceeded:
  - **Split** if the node has distinct responsibilities.
  - **Duplicate** a shared resource to break hub-and-spoke patterns.

**Duplication for clarity** — the "one node per service" default can be overridden when showing the same resource twice improves readability (e.g. a shared DB next to each service that uses it). Use same `kind` + `name`; unique `id` with a descriptive suffix (`"orders-db-read"`, `"orders-db-write"`).

Output shape:

```json
{
  "name": "…",
  "slug": "…",
  "nodes": [{ "id": "…", "type": "…", "data": {…}, "oneNodeRationale": "…" }],
  "connectors": [{ "id": "…", "kind": "…", "source": "…", "target": "…" }]
}
```

Retry budget: one retry on unparseable output, then surface and stop.

## Phase 3 — node review checkpoint

Register a **skeleton** flow (nodes + connectors only, no scripts) so the user can review the canvas before any scripts are written.

Paths:
- `repoPath = $PWD`
- `flowDir = $PWD/.seeflow/<slug>`
- `flowPath = .seeflow/<slug>/flow.json`
- `stylePath = .seeflow/<slug>/style.json`

1. Build **`flow.json`** from the node draft — omit `playAction`, `statusAction`, `resetAction`. Keep `version: 2`, `name`, `nodes` (data-only), `connectors`. **No `position` or visual fields** at the node root — those live in `style.json`.
2. `mkdir -p $flowDir` then write `flow.json`.
3. Validate via the studio API (the **only** validator):
   ```bash
   bun skills/seeflow/scripts/validate.ts --flow "$flowDir/flow.json"
   ```
   On failure: fix field-level issues in-place (no re-run of node-planner), retry.
4. Register and stash the returned `id` and `slug`:
   ```bash
   bun skills/seeflow/scripts/register.ts --path "$repoPath" --flow "$flowPath"
   ```
5. **Generate `style.json` via the studio.** ELK is fast — finish layout before opening the canvas so the user sees the laid-out graph, not an empty one that snaps into shape:
   ```bash
   bun skills/seeflow/scripts/refresh-layout.ts "$id"
   ```
   The skill never touches `style.json` directly — manual `position` fields on nodes in `flow.json` are still honoured but everything else comes from this call.
6. Open the canvas in the user's browser, then ask for review:
   ```bash
   URL="$STUDIO_URL/d/<slug>"
   (open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || start "$URL" 2>/dev/null) &
   ```
   Then prompt:
   > Opened the canvas at `<url>`. Does the layout look right? Any additions, removals, or renames before I move on?

**Wait** for response. **Changes requested** → re-run node-planner with feedback, repeat Phase 3. **Approved** → proceed to the dynamic gate below.

### Phase 3.5 — dynamic gate (ask before Phase 4)

Once the canvas layout is approved, ask the user a second question before launching the play/status designers:

> Do you want me to continue and make this flow **dynamic** — i.e. write the Play scripts (real triggers that drive each node) and Status scripts (live state probes) so the canvas reacts to your running system? Or stop here with the static layout?

**Wait** for response.

- **Yes / continue / make it dynamic** → Phase 4. If `seeflow-system-analyzer` has not finished yet, await it now — the play/status designers need its `runtimeProfile`, fixtures, data-entry paths, and tech adaptations to write faithful scripts. Re-merge any new `wikiUpdates` into `WIKI.md` before launching Phase 4 designers.
- **No / stop / static is enough** → Print `Flow "<name>" registered as <slug> (static — no Play/Status). Open: $STUDIO_URL/d/<slug>` and stop. Skip Phases 4–7 entirely. Still merge `seeflow-system-analyzer`'s `wikiUpdates` into `WIKI.md` if it hasn't been merged yet — the setup/run knowledge it learned is valuable to keep regardless.
- **Unclear** → ask once more, default to static if still unclear (the dynamic phases write executable scripts and the user should opt in explicitly).

## Phase 4 — design Play + Status (parallel)

Launch `seeflow-play-designer` and `seeflow-status-designer` **in parallel** (single message, two `Task` calls). Both receive: context brief + node draft + edit target + the resolved tech-ref paths + the matching `techAdaptations` entries. The designers read each ref's **Play** / **Status** section as a starting point and treat `techAdaptations` as the project-specific override (reuse the helper, follow the convention, copy the fixture). Tools: `Read, Grep, Glob, LS`.

Each designer returns overlays per its agent contract — see `agents/seeflow-play-designer.md` for `playOverlays[] + newTriggerNodes[]` and `agents/seeflow-status-designer.md` for `statusOverlays[]`. Do not duplicate those schemas here; consult the agent file when interpreting the return.

**Sample data — look before inventing.** Priority:

1. Integration/e2e test fixtures (`runtimeProfile.integrationTestDir`) — copy verbatim.
2. Seed / migration fixtures (`seed.*`, `fixtures/`, `testdata/`, ORM factories).
3. README / OpenAPI / Postman examples.
4. Invent as last resort — note in `rationale`.

`newTriggerNodes` may inject synthetic source nodes (file-drop, webhook receiver) when no natural trigger exists.

Full agent prompts: `agents/seeflow-play-designer.md`, `agents/seeflow-status-designer.md`.

## Phase 5 — synthesize + validate

1. **Splice** `newTriggerNodes` into `nodeDraft.nodes` (add any required connectors).
2. **Merge** each overlay onto its target node's `data`. Strip `validationSafe`, `rationale`, `scriptBody` — orchestrator metadata, not schema fields. Collect `nodeId`s where `validationSafe: false` into `unsafeNodeIds`.
3. **Write** merged flow to `$flowDir/flow.json` (data-only), then refresh layout — the studio re-reads `flow.json`, runs ELK over the post-splice graph, and overwrites `style.json` on disk. Existing positions are recomputed; never preserved across re-runs. The style file is mandatory; the studio owns it.

   ```bash
   bun skills/seeflow/scripts/refresh-layout.ts "$id"
   ```
4. **Validate via the studio API** (no local validator exists):

   ```bash
   bun skills/seeflow/scripts/validate.ts --flow "$flowDir/flow.json" --style "$flowDir/style.json"
   ```

   Exit 0 → continue. Exit 1 (issues printed to stderr) → feed issues back to the relevant designer(s), retry. **Max 3 retries**, then surface verbatim and stop.

   **Retry parallelism rule:** if the issues touch both `playOverlays[*]` and `statusOverlays[*]`, re-dispatch `seeflow-play-designer` AND `seeflow-status-designer` in a single message (two `Task` calls), each scoped to its own issues. Serial re-dispatch when both have issues is a bug — it doubles wall-clock for zero benefit. Only run one designer when issues touch exactly one designer's overlays.

5. Proceed to Phase 6 — node layout was approved in Phase 3.

## Phase 6 — write script files + re-register

1. `mkdir -p $flowDir/scripts $flowDir/state`
2. Write files (overwriting the Phase 3 skeleton):
   - `$flowDir/flow.json` — validated semantic flow JSON with all actions.
   - `$flowDir/style.json` — keyed map of `position` + visual overrides. **Mandatory**, even when only positions are populated.
   - `$flowDir/scripts/<name>` — one file per overlay `scriptBody`. `chmod +x`.
   - `$flowDir/state/.gitignore` — `*`.
3. Re-register:

```bash
bun skills/seeflow/scripts/register.ts --path "$repoPath" --flow "$flowPath"
```

Prints `{id, slug}`. Use the new `id` for Phase 7.

On 400: show body, ask "fix-and-retry / stop". On other 4xx/5xx: show body, stop.

## Phase 7 — end-to-end validation

**Must run. Do not skip or simulate.**

```bash
bun skills/seeflow/scripts/validate-end-to-end.ts <id> [--skip-nodes <id1>,<id2>]
```

Pass `--skip-nodes` when `unsafeNodeIds` is non-empty (nodes that hit third-party services or charge money). Skipped nodes appear in `skipped[]` and are not counted as failures.

The script:
- GETs `/api/flows/<id>` (expects 200, `valid: true`).
- Opens SSE at `/api/events?flowId=<id>` before triggering plays.
- POSTs `/api/flows/<id>/play/<nodeId>` for each safe play node; awaits response.
- Drains SSE for `node:done` / `node:error` / `node:status` events. SSE outcome takes precedence.
- Hard ceiling: ~2 minutes. Emits `{ok, plays, statuses, skipped}`.

**Interpret the JSON.** On `ok: true` → refresh layout one last time so the canvas reflects the final, run-validated graph (positions for any Phase-4 `newTriggerNodes` get a fresh ELK pass):

```bash
bun skills/seeflow/scripts/refresh-layout.ts "$id"
```

Then print `Flow "<name>" registered as <slug>. Open: $STUDIO_URL/d/<slug>`. Done.

On `ok: false`, follow this fix-up loop:

1. Identify failing nodes from `plays[*].error` / `statuses[*].outcome`.
2. **Mandatory parallel dispatch.** Dispatch ONE sub-agent per failing script in a single message — N failing scripts means N `Task` calls in one block. Serial dispatch is a bug. A single sub-agent fixing N scripts is also wrong: each fix needs isolated context to avoid cross-contamination.
3. Each sub-agent gets the failing script's path, the specific `error` / `outcome` payload, and a concrete fix hypothesis ("play-checkout.ts: `ECONNREFUSED` on port 3001 — start the app first") drawn from the validate output.
4. Edit scripts in-place, then re-run Phase 7 against the same `<id>`. **Max 2 retries**, then ask `retry / stop`.

Never re-run `register.ts` in the fix-up loop.

### Polish `WIKI.md` with anything learned

When Phases 6-7 surfaced a fact the next run would want — a port mismatch, a fixture path you had to discover, a required env var the system-analyzer missed, a working seed command, a data-entry path you ended up using — append a `Gotchas` bullet or update the relevant section in `<project>/.seeflow/WIKI.md`. Also append the new flow to the "Flows already created" table with today's date and a one-line purpose. Follow `references/wiki-format.md`. If nothing new was learned, skip — empty updates are noise.

**If the learning is tech-specific** — a helper you discovered mid-flow (e.g. `pkg/eventbus/publish.go::Publish`), a convention you had to comply with (every message needs a `tenant_id` attribute), an emulator quirk, a fixture path that saved a play script from inventing — update the matching `## Tech stack adaptations` → `### <techId>` subsection, **not** just `## Gotchas`. This is what makes the next `/seeflow` run reuse the work seamlessly. If the code-analyzer missed a tech entirely, also append the `techId` to `## Tech stack`.

## Operations

| Topic | File |
|---|---|
| Error handling table, retry caps, studio API endpoints, sub-agent table | `references/operations.md` |
| `flow.json` + `style.json` schema, node types, connectors, actions, `StatusReport` | `references/schema.md` |
| Core rules — no mocks, bigger picture, match language | `references/core-rules.md` |
| `WIKI.md` format, lifecycle, merging rules, `wikiUpdates` contract | `references/wiki-format.md` |
| Tech-specific best practices (per-tech refs + signal table) | `references/tech/README.md` |
| Phase 5 plan-presentation template (`+/~/-` diff convention) | `references/plan-format.md` |
| Sub-agent prompts and worked examples | `agents/seeflow-code-analyzer.md`, `agents/seeflow-system-analyzer.md`, `agents/seeflow-node-planner.md`, `agents/seeflow-play-designer.md`, `agents/seeflow-status-designer.md` |
