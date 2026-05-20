---
name: seeflow
description: This skill should be used when the user asks to "create a flow", "generate a flow", "scaffold a SeeFlow flow", "show how X works", "diagram our system", or "add a flow to this repo". Orchestrates four sub-agents and bun scripts to turn a natural-language prompt into a registered, validated SeeFlow flow under `<project>/.seeflow/<slug>/`.
---

# seeflow

Turn a natural-language prompt into a registered, runnable SeeFlow flow under `<project>/.seeflow/<slug>/`. Orchestrate four sub-agents and bun scripts; never read the codebase directly.

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
- `<project>/.seeflow/WIKI.md` — persistent crib sheet from past `/seeflow` runs. **Always read this before invoking the discoverer**; it shortcuts most of Phase 1. Format: `references/wiki-format.md`.

## Pipeline

```
Phase 0   — pre-flight: studio reachable?
Phase 0.5 — read .seeflow/WIKI.md
Phase 1   — seeflow-discoverer        → context brief + wikiUpdates
            → merge wikiUpdates into .seeflow/WIKI.md
Phase 2   — seeflow-node-planner      → node draft
Phase 3   — write skeleton flow.json + style.json (nodes only)
            → POST /api/validate → register → user reviews canvas → approval
Phase 4   — seeflow-play-designer  ┐
            seeflow-status-designer├ parallel → overlays
                                   ┘
Phase 5   — synthesize → POST /api/validate (flow + style)
Phase 6   — write script files + flow.json + style.json → re-register full flow
Phase 7   — validate-end-to-end.ts → trigger APIs → verify via SSE
            (retry up to 2x) → print URL on success / retry-or-stop on failure
            → if anything new was learned, append it to .seeflow/WIKI.md
```

Each phase is **gated** on the previous one. **All schema validation runs through the studio API** (`POST /api/validate`) — there is no local validator script.

## Core rules

Three rules every flow must honour. Full text + examples in `references/core-rules.md`:

1. **No mocks, ever.** Scripts trigger real services or read real state. Never simulate. If a required service isn't running, stop and ask.
2. **See the bigger picture before inserting data.** Use the system's natural data-entry path (API, file-drop, producer, seed command, webhook) instead of direct INSERTs.
3. **Match the project's primary language.** Use `runtimeProfile.primaryLanguage` as the interpreter for every script.

## Phase 0 — pre-flight

Resolve `$STUDIO_URL`: `SEEFLOW_STUDIO_URL` env var → `~/.seeflow/config.json` port → `http://localhost:4321`. Probe:

```bash
curl --max-time 0.5 -fsS "$STUDIO_URL/health"
```

- **200** → continue to Phase 0.5.
- **Anything else** → tell the user the studio isn't running and that you'll start it for them. **Warn them the first launch can take a minute or two** while `npx` downloads the package and the studio installs its dependencies; subsequent starts are fast. Then run (background is the default since the CLI auto-detaches; `--yes` skips npx's "OK to proceed?" prompt):

  ```bash
  npx --yes tuongaz/seeflow start
  ```

  The command returns once the studio is up. Re-probe `/health` once to confirm. If still unreachable, surface the error and stop.

## Phase 0.5 — read the project wiki

Read `<project>/.seeflow/WIKI.md` if it exists; stash its contents to pass into the discoverer as `wikiContext`. If absent, pass `wikiContext: null` (the discoverer will build the file from scratch via `wikiUpdates`). Format and merging rules: `references/wiki-format.md`.

## Phase 1 — discover

Create a `TaskCreate` checklist for Phases 1-7 before launching any sub-agent. Mark each complete via `TaskUpdate` immediately after it succeeds.

Launch `seeflow-discoverer` with the user's prompt, project root, any existing `flow.json` for the matching slug, and the stashed wiki content. Tools: `Read, Grep, Glob, LS, Bash` (read-only).

Discoverer must:
- Identify primary language + runtime (`runtimeProfile`)
- Trace **local dev setup**: how the app boots, ports, docker-compose dependencies, the "is it up?" probe
- Find **integration / e2e tests** and extract their setup pattern
- Catalogue **fixtures, factories, mock-data helpers, seed commands, file-drop watchers** — anything that gives play-scripts a realistic payload without inventing one
- Map **data entry paths** for each major resource (preferred API vs avoid-direct-insert)
- Capture **gotchas** worth remembering across runs
- Detect **tech stack** via `references/tech/README.md` signal table and emit `wikiUpdates.techStack`; for each detected `techId`, search the repo for project-specific helpers / wrappers / fixtures / conventions and emit `wikiUpdates.techAdaptations.<techId>`
- Emit `wikiUpdates` so the orchestrator can refresh `.seeflow/WIKI.md`

Output schema and field list: `references/wiki-format.md` (the `wikiUpdates` contract section).

On unparseable output: retry once with the validation error. If still failing, surface and stop.

**At the end of Phase 1, merge `wikiUpdates` into `<project>/.seeflow/WIKI.md`** following the merging rules in `references/wiki-format.md`. Create the parent `.seeflow/` directory if missing.

**Resolve tech refs.** Map each `techId` in the merged `## Tech stack` to `references/tech/<techId>.md`. Stash the resolved paths plus the matching `## Tech stack adaptations` entries — both get forwarded into the Phase 2 / 4 launch prompts so sub-agents read only the relevant refs (~3–5 per flow).

## Phase 2 — plan nodes

Launch `seeflow-node-planner` with the context brief, the resolved tech-ref paths, and the matching `techAdaptations` entries. No tools — pure reasoning. The planner reads each ref's **Node modelling** section and treats `techAdaptations` as the project-specific override. Two mandatory passes:

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
   RESULT=$(curl -fsS -X POST "$STUDIO_URL/api/validate" \
     -H 'content-type: application/json' \
     -d "$(jq -n --slurpfile a "$flowDir/flow.json" '{flow: $a[0]}')")
   echo "$RESULT" | jq -e '.ok' >/dev/null \
     || { echo "$RESULT" | jq '.issues' >&2; exit 1; }
   ```
   On failure: fix field-level issues in-place (no re-run of node-planner), retry.
4. Register:
   ```bash
   bun skills/seeflow/scripts/register.ts --path "$repoPath" --flow "$flowPath"
   ```
   Stash the returned `id` and `slug`. The canvas URL is `$STUDIO_URL/d/<slug>`.
5. **Generate `style.json` via the studio.** POST to `/api/flows/<id>/layout`; the studio reads `flow.json` from disk, runs ELK, and writes `style.json` next to it. The skill never touches `style.json` directly — manual `position` fields on nodes in `flow.json` are still honoured but everything else comes from this call.
   ```bash
   curl -fsS -X POST "$STUDIO_URL/api/flows/$id/layout" \
     | jq -e '.ok' >/dev/null \
     || { echo "layout failed for $id" >&2; exit 1; }
   ```
6. Open the canvas in the user's browser, then ask for review:
   ```bash
   URL="$STUDIO_URL/d/<slug>"
   (open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || start "$URL" 2>/dev/null) &
   ```
   Then prompt:
   > Opened the canvas at `<url>`. Does the layout look right? Any additions, removals, or renames before I write the scripts?

**Wait** for response. **Approved** → Phase 4. **Changes requested** → re-run node-planner with feedback, repeat Phase 3.

## Phase 4 — design Play + Status (parallel)

Launch `seeflow-play-designer` and `seeflow-status-designer` **in parallel** (single message, two `Task` calls). Both receive: context brief + node draft + edit target + the resolved tech-ref paths + the matching `techAdaptations` entries. The designers read each ref's **Play** / **Status** section as a starting point and treat `techAdaptations` as the project-specific override (reuse the helper, follow the convention, copy the fixture). Tools: `Read, Grep, Glob, LS`.

`seeflow-play-designer` returns:

```json
{
  "playOverlays": [{
    "nodeId": "…",
    "playAction": { "kind": "script", "interpreter": "bun", "args": ["run"],
                    "scriptPath": "<slug>/scripts/<name>.ts",
                    "input": {…}, "timeoutMs": 30000 },
    "scriptBody": "…",
    "validationSafe": true,
    "rationale": "…"
  }],
  "newTriggerNodes": []
}
```

`seeflow-status-designer` returns:

```json
{
  "statusOverlays": [{
    "nodeId": "…",
    "statusAction": { "kind": "script", "interpreter": "bun", "args": ["run"],
                      "scriptPath": "<slug>/scripts/<name>.ts",
                      "maxLifetimeMs": 600000 },
    "scriptBody": "…",
    "rationale": "…"
  }]
}
```

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
3. **Write** merged flow to `$flowDir/flow.json` (data-only). **Refresh `style.json`** by POSTing to `/api/flows/<id>/layout` — the studio re-reads `flow.json`, runs a full ELK reflow over the post-splice graph, and overwrites `style.json` on disk. Existing positions are recomputed; never preserved across re-runs.

   ```bash
   curl -fsS -X POST "$STUDIO_URL/api/flows/$id/layout" \
     | jq -e '.ok' >/dev/null \
     || { echo "layout failed for $id" >&2; exit 1; }
   ```

   The style file is mandatory; the studio owns it.
4. **Validate via the studio API** (no local validator exists):

```bash
RESULT=$(curl -fsS -X POST "$STUDIO_URL/api/validate" \
  -H 'content-type: application/json' \
  -d "$(jq -n --slurpfile a "$flowDir/flow.json" \
              --slurpfile s "$flowDir/style.json" \
              '{flow: $a[0], style: $s[0]}')")
echo "$RESULT" | jq -e '.ok' >/dev/null || { echo "$RESULT" | jq '.issues' >&2; exit 1; }
```

`{"ok":true}` → continue. `{"ok":false,"issues":[…]}` → feed issues back to the relevant designer, retry. **Max 3 retries**, then surface verbatim and stop.

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

**Interpret the JSON.** On `ok: true` → **refresh layout one last time** so the canvas the user is told to open reflects the final, run-validated graph (any `newTriggerNodes` synthesized in Phase 4 are already in `flow.json`; this guarantees their positions are fresh):

```bash
curl -fsS -X POST "$STUDIO_URL/api/flows/$id/layout" \
  | jq -e '.ok' >/dev/null \
  || { echo "layout failed for $id" >&2; exit 1; }
```

Then print `Flow "<name>" registered as <slug>. Open: $STUDIO_URL/d/<slug>`. Done. On `ok: false`:

1. Identify failing nodes from `plays[*].error` / `statuses[*].outcome`.
2. Propose a concrete fix ("play-checkout.ts: `ECONNREFUSED` on port 3001 — start the app first").
3. Dispatch one sub-agent per failing script **in parallel**.
4. Edit scripts in-place, re-run Phase 7 against the same `<id>`. **Max 2 retries**, then ask `retry / stop`.

Never re-run `register.ts` in the fix-up loop.

### Polish `WIKI.md` with anything learned

When Phases 6-7 surfaced a fact the next run would want — a port mismatch, a fixture path you had to discover, a required env var the discoverer missed, a working seed command, a data-entry path you ended up using — append a `Gotchas` bullet or update the relevant section in `<project>/.seeflow/WIKI.md`. Also append the new flow to the "Flows already created" table with today's date and a one-line purpose. Follow `references/wiki-format.md`. If nothing new was learned, skip — empty updates are noise.

**If the learning is tech-specific** — a helper you discovered mid-flow (e.g. `pkg/eventbus/publish.go::Publish`), a convention you had to comply with (every message needs a `tenant_id` attribute), an emulator quirk, a fixture path that saved a play script from inventing — update the matching `## Tech stack adaptations` → `### <techId>` subsection, **not** just `## Gotchas`. This is what makes the next `/seeflow` run reuse the work seamlessly. If the discoverer missed a tech entirely, also append the `techId` to `## Tech stack`.

## Operations

| Topic | File |
|---|---|
| Error handling table, retry caps, studio API endpoints, sub-agent table | `references/operations.md` |
| `flow.json` + `style.json` schema, node types, connectors, actions, `StatusReport` | `references/schema.md` |
| Core rules — no mocks, bigger picture, match language | `references/core-rules.md` |
| `WIKI.md` format, lifecycle, merging rules, `wikiUpdates` contract | `references/wiki-format.md` |
| Tech-specific best practices (per-tech refs + signal table) | `references/tech/README.md` |
| Phase 4 plan-presentation template (`+/~/-` diff convention) | `references/plan-format.md` |
| Sub-agent prompts and worked examples | `agents/seeflow-discoverer.md`, `agents/seeflow-node-planner.md`, `agents/seeflow-play-designer.md`, `agents/seeflow-status-designer.md` |
