---
name: seeflow
description: Use when the user asks to "create a flow", "generate a flow", "scaffold a SeeFlow flow", "show how X works", "diagram our system", or "add a flow to this repo". Orchestrates five sub-agents and bun scripts to turn a natural-language prompt into a registered, validated SeeFlow flow under `<project>/.seeflow/<slug>/`.
---

# seeflow

Turn a natural-language prompt into a registered SeeFlow flow under `<project>/.seeflow/<slug>/`. Orchestrate five sub-agents and bun scripts; never read the codebase directly.

**Parallelism is the default — one message, N `Task` calls.** Phase 1's wrong/right block below is canonical; Phases 4, 5 retries, and Phase 7 fix-up follow it. Narrate each phase boundary with a one-line status (e.g. `Phase 3: registering skeleton flow…`) so silent waits don't feel broken.

## When NOT to invoke

- Editing nodes on an existing flow → use the canvas / `.seeflow/<slug>/flow.json` directly.
- Deleting or renaming a flow → `unregister.ts`.
- Re-laying out an existing flow without semantic changes → `refresh-layout.ts <id>`.
- Empty project (nothing to analyze) → ask the user first.
- Debugging a single broken Play/Status script → edit in-place, re-run Phase 7.

## Inputs

- User's prompt; project root (`$PWD`); `~/.seeflow/config.json` (optional studio host:port).
- Existing `<project>/.seeflow/<slug>/flow.json` files (multi-flow supported).
- `<project>/.seeflow/WIKI.md` — persistent crib sheet from prior runs. **Read before Phase 1.** Format: `references/wiki-format.md`.

## Conventions

| Variable | Resolution |
|---|---|
| `$SF` | `${CLAUDE_PLUGIN_ROOT}/skills/seeflow` — every script invocation uses this. |
| `$STUDIO_URL` | `SEEFLOW_STUDIO_URL` → `~/.seeflow/config.json` port → `http://localhost:4321`. |
| `$repoPath` | `$PWD`. |
| `$flowDir` | `$repoPath/.seeflow/<slug>`. |
| `$flowPath` | `.seeflow/<slug>/flow.json` (relative — `register.ts` resolves against `--path`). |
| `$stylePath` | `.seeflow/<slug>/style.json`. |

**The studio API is the only validator.** `bun "$SF/scripts/validate.ts"` POSTs `/api/validate`; there is no local validator. Layout is the same: `refresh-layout.ts` calls the studio. The skill never writes `style.json` directly.

## Pipeline

```
0+0.5  /health probe ‖ read WIKI.md
1      code-analyzer ‖ system-analyzer
2      node-planner (starts when code-analyzer returns; system-analyzer
       finishes in background → wikiUpdates merged into WIKI.md)
3      skeleton flow.json + style.json → validate → register → user reviews canvas
3.5    gate: continue with Play/Status (dynamic) or stop (static)?
4      play-designer ‖ status-designer
5      synthesize + validate (retry ≤ 3)
6      write script files + re-register
7      validate-end-to-end.ts (retry ≤ 2) → polish WIKI.md
```

Each phase gates on the previous (with the Phase 1 → Phase 2 overlap).

## Core rules

Full text in `references/core-rules.md`:

1. **No mocks.** Real services, real state. If something isn't running, stop and ask.
2. **Bigger picture before INSERTs.** Use the natural data-entry path (API, file-drop, producer, seed, webhook).
3. **Match the project's primary language.** Use `runtimeProfile.primaryLanguage` for every script.

## Common mistakes

- **Serial sub-agent dispatch** (N messages, one Task call each). One message, N Task calls — see Phase 1's wrong/right.
- **One sub-agent fixing multiple failing scripts in Phase 7.** Each needs isolated context.
- **Re-running `register.ts` inside the Phase 7 fix-up loop.** The flow is already registered.
- **Reading the codebase yourself.** Delegate to the analyzers.
- **Touching `style.json` directly, or putting `position` / visual fields at the node root of `flow.json`.** The studio owns layout; call `refresh-layout.ts`. The node root is `data`-only.
- **Mocking services or fake fixtures.** Use real triggers; copy fixtures from integration tests.
- **Asking "what's your codebase?".** Launch the analyzers — that is their job.
- **Skipping or simulating Phase 7.** Mandatory; the retry budget handles flakiness.

## Phase 0 + 0.5 — pre-flight (parallel)

In a single message:

1. `curl --max-time 0.5 -fsS "$STUDIO_URL/health"`
2. Read `<project>/.seeflow/WIKI.md` if present → `wikiContext` (else `null`). Format: `references/wiki-format.md`.

- **200** → Phase 1.
- **!200** → tell the user the studio isn't running, warn the first launch can take a minute or two while npx downloads, then:

  ```bash
  npx -y @tuongaz/seeflow@latest start
  ```

  Re-probe `/health` once. If still unreachable, surface and stop.

## Phase 1 — discover (parallel)

Create a `TaskCreate` checklist of the eight phases (`Phase 1 — discover` … `Phase 7 — end-to-end validation`); `TaskUpdate` each as it finishes. Phases skipped at the dynamic gate get marked completed with a one-line note.

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

Every later parallel phase (Phase 4 designers, Phase 5 retries spanning both overlay families, Phase 7 per-script fix-up) follows this pattern.

- `seeflow-code-analyzer` — in: `userPrompt`, `projectRoot`, `existingDemo`, `wikiContext`. Out: `userIntent`, `audienceFraming`, `scope`, `codePointers`, `knownEndpoints`, `techStack`, `existingDemo`.
- `seeflow-system-analyzer` — in: `projectRoot`, `wikiContext`. Out: `runtimeProfile` + a `wikiUpdates` payload (`localDevSetup`, `integrationTests`, `fixtures`, `factories`, `seedCommands`, `dataEntryPaths`, `gotchas`, `techAdaptations`). **Every fact it learns about how to start / set up the local environment MUST land in `wikiUpdates`** — that payload is what persists.

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

Output: `{ name, slug, nodes:[{id,type,data,oneNodeRationale}], connectors:[{id,kind,source,target}] }`. One retry on unparseable output, then surface and stop.

## Phase 3 — node review checkpoint

Register a **skeleton** (nodes + connectors, no scripts) so the user reviews the canvas before any scripts are written. Path vars in [Conventions](#conventions).

1. Build `flow.json` — omit `playAction` / `statusAction` / `resetAction`; keep `version: 2`, `name`, `nodes` (data-only), `connectors`. **No `position` or visual fields** at the node root.
2. `mkdir -p $flowDir` then write `flow.json`.
3. Validate, register, lay out:
   ```bash
   bun "$SF/scripts/validate.ts" --flow "$flowDir/flow.json"
   bun "$SF/scripts/register.ts" --path "$repoPath" --flow "$flowPath"
   bun "$SF/scripts/refresh-layout.ts" "$id"
   ```
   ELK is fast — finish layout before opening the canvas. On validate failure: fix in-place, retry (no node-planner re-run).
4. Open and prompt:
   ```bash
   URL="$STUDIO_URL/d/<slug>"
   (open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || start "$URL" 2>/dev/null) &
   ```
   > Opened the canvas at `<url>`. Layout look right? Any additions, removals, or renames?

**Wait.** Changes requested → re-run node-planner, repeat. Approved → dynamic gate.

### Phase 3.5 — dynamic gate

> Continue and make this flow **dynamic** (write Play scripts and Status probes so the canvas reacts to your running system) — or stop with the static layout?

- **Yes** → Phase 4. If the system-analyzer is still running, await it now; Phase 4 designers need its `runtimeProfile`, fixtures, data-entry paths, and tech adaptations. Re-merge any new `wikiUpdates` first.
- **No** → print `Flow "<name>" registered as <slug> (static). Open: $STUDIO_URL/d/<slug>` and stop. Still merge any pending `wikiUpdates`.
- **Unclear** → ask once more, default to static (dynamic writes executable scripts; opt-in).

## Phase 4 — design Play + Status (parallel)

Launch `seeflow-play-designer` + `seeflow-status-designer` in parallel (Phase 1 rule). Both receive: context brief, node draft, edit target, tech-ref paths, matching `techAdaptations`. They read each ref's **Play** / **Status** section and treat `techAdaptations` as the project override. Tools: `Read, Grep, Glob, LS`. Schemas (do not duplicate): `agents/seeflow-play-designer.md` (`playOverlays[]` + `newTriggerNodes[]`), `agents/seeflow-status-designer.md` (`statusOverlays[]`).

**Sample data priority:** integration/e2e fixtures (`runtimeProfile.integrationTestDir`, copy verbatim) → seed / migration / ORM factories → README / OpenAPI / Postman examples → invent last, note in `rationale`.

`newTriggerNodes` may inject synthetic sources (file-drop, webhook receiver) when no natural trigger exists.

## Phase 5 — synthesize + validate

1. Splice `newTriggerNodes` into `nodeDraft.nodes` (add required connectors).
2. Merge each overlay onto its target node's `data`. Strip `validationSafe`, `rationale`, `scriptBody`. Collect `nodeId`s with `validationSafe: false` into `unsafeNodeIds`.
3. Write merged flow to `$flowDir/flow.json` (data-only), then refresh layout — the studio re-runs ELK and overwrites `style.json` (positions are never preserved across re-runs):
   ```bash
   bun "$SF/scripts/refresh-layout.ts" "$id"
   ```
4. Validate:
   ```bash
   bun "$SF/scripts/validate.ts" --flow "$flowDir/flow.json" --style "$flowDir/style.json"
   ```
   0 → continue. Non-zero → feed issues back to the relevant designer(s), retry. **Max 3 retries.** If issues span both overlay families, re-dispatch both designers in parallel (Phase 1 rule); otherwise just the one.

## Phase 6 — write script files + re-register

```bash
mkdir -p "$flowDir/scripts" "$flowDir/state"
# Write: flow.json, style.json (mandatory), scripts/<name> (chmod +x), state/.gitignore (`*`)
bun "$SF/scripts/register.ts" --path "$repoPath" --flow "$flowPath"
```

Prints `{id, slug}`; use the new `id` for Phase 7. On 400: show body, ask fix-and-retry / stop. On other 4xx/5xx: show body, stop.

## Phase 7 — end-to-end validation

**Must run. Do not skip or simulate.**

```bash
bun "$SF/scripts/validate-end-to-end.ts" <id> [--skip-nodes <id1>,<id2>]
```

Pass `--skip-nodes` when `unsafeNodeIds` is non-empty (third-party / paid). Skipped nodes appear in `skipped[]`, not as failures.

The script GETs `/api/flows/<id>`, opens SSE at `/api/events?flowId=<id>`, POSTs each safe play, then drains `node:done|error|status` events (SSE outcome wins). Hard ceiling ~2 min. Emits `{ok, plays, statuses, skipped}`.

**`ok: true`** → refresh layout once more (positions for any new trigger nodes get a fresh ELK pass), then print `Flow "<name>" registered as <slug>. Open: $STUDIO_URL/d/<slug>`. Done.

**`ok: false`** fix-up loop:

1. Identify failing nodes from `plays[*].error` / `statuses[*].outcome`.
2. **Parallel fix-up (Phase 1 rule):** one sub-agent per failing script, single message. A single agent fixing N scripts cross-contaminates.
3. Each agent gets the script path, the specific error payload, and a concrete fix hypothesis (`play-checkout.ts: ECONNREFUSED on :3001 — start the app first`).
4. Edit in-place, re-run Phase 7. **Max 2 retries**, then ask retry / stop.

### Polish WIKI.md with anything learned

If Phases 6-7 surfaced something the next run would want — port mismatch, fixture path, missed env var, working seed command, useful data-entry path — append to `<project>/.seeflow/WIKI.md` (`Gotchas` bullet or the relevant section). Also append the flow to the "Flows already created" table with today's date and a one-line purpose. Skip if nothing new — empty updates are noise.

**Tech-specific learnings** (a helper, a required attribute, an emulator quirk, a fixture path) go in `## Tech stack adaptations` → `### <techId>`, not just `## Gotchas`. If the code-analyzer missed a tech entirely, also append the `techId` to `## Tech stack`. This is what makes the next `/seeflow` run reuse the work.

## Operations

| Topic | File |
|---|---|
| Error handling, retry caps, studio API endpoints, sub-agent table | `references/operations.md` |
| `flow.json` + `style.json` schema, node types, connectors, actions, `StatusReport` | `references/schema.md` |
| Core rules | `references/core-rules.md` |
| `WIKI.md` format, lifecycle, merging, `wikiUpdates` contract | `references/wiki-format.md` |
| Tech-specific best practices | `references/tech/README.md` |
| Phase 5 plan-presentation template | `references/plan-format.md` |
| Sub-agent prompts | `agents/seeflow-*.md` |
