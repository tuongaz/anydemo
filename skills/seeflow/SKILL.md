---
name: seeflow
description: This skill should be used when the user explicitly asks to "create a flow", "generate a flow", "scaffold a SeeFlow flow", or "add a flow to this repo" — or when a previous /seeflow-lookup has already reported no matching flow exists. Inspection phrasing ("show me", "how does X work", "diagram our system", "explain the flow") routes to /seeflow-lookup first; that skill auto-hands off here only when nothing is registered. Orchestrates five sub-agents and the `seeflow` CLI to turn a natural-language prompt into a registered, validated SeeFlow flow at <project>/flow.json (node-attached files live under <projectPath>/nodes/<id>/).
---

# seeflow

Turn a natural-language prompt into a registered SeeFlow flow at `$repoPath/flows/<flowSlug>/flow.json` (skill-created projects default to `flowSlug: 'main'`), with node-attached content (scripts, detail.md, view.html) under `$repoPath/flows/<flowSlug>/nodes/<id>/`. Orchestrate five sub-agents and the `seeflow` CLI; never read the codebase directly, never author `seeflow.json` or `flow.json` by hand (`projects:create` writes both the manifest and the first flow envelope).

## When NOT to invoke

- Editing nodes on an existing flow → use the canvas, or hit the CLI directly (`nodes:patch`).
- Deleting a flow → `flows:delete`.
- Re-laying out an existing flow without semantic changes → `flows:layout`.
- Debugging a single broken Play/Status script → edit in-place, re-run Phase 6.

(A project with no source tree is **not** an exclusion — it routes to the `document` branch at the Phase 0 input-source gate without asking.)

## Project layout convention

A host repo opts into seeflow by creating a `<host>/.seeflow/` directory (the **only** place this skill introduces a `.seeflow` folder — the studio itself is path-agnostic). `LEARN.md` is shared across every project and flow in the host and lives at `<host>/.seeflow/LEARN.md`; each project lives in its own subdirectory beside it, with one folder per flow nested inside under `flows/`:

```
<host>/                                  ← the user's repo
  .seeflow/                              ← container, created by this skill
    LEARN.md                             ← shared crib for this skill (host-wide, used by every project + flow)
    <projectSlug>/                       ← seeflow project root — passed to projects:create --path
      seeflow.json                       ← manifest (project metadata + flow registry)
      flows/<flowSlug>/                  ← per-flow folder (one per flows[] entry)
        flow.json                        ← envelope + nodes/connectors
        style.json                       ← layout/visuals (managed by `flows:layout`)
        nodes/<id>/                      ← per-node sidecar files (detail.md, view.html, scripts/)
        .tmp/                            ← per-flow scratch ($SEEFLOW_TMP)
        state/                           ← per-flow runtime script state
```

Skill-created projects default to a single flow with `flowSlug: 'main'`; subsequent flows in the same project are added via `flows:create --project <projectSlug> --flow <flowSlug>`.

Always call `seeflow projects:create --path "$repoPath" --name "..."` — the CLI writes both `seeflow.json` and `flows/main/flow.json` in one shot. Inside `--path`, every CLI / file reference is relative to that project root — never re-prefix with `.seeflow/`.

`~/.seeflow/` (user-home) is a separate, unrelated directory that holds the studio's global registry / config / pid files; leave its paths verbatim wherever they appear.

## Inputs

- User's prompt; project root (`$PWD`); `~/.seeflow/config.json` (optional studio host:port).
- Existing `<project>/flow.json` (skip the creation path if already present — fall back to `register --flow flow.json`).
- `$learnPath` (`$PWD/.seeflow/LEARN.md`) — persistent crib sheet **shared across every project + flow in this host repo**, written by prior `/seeflow` runs. **Read before Phase 1.** Format: `references/learn-format.md`.

## Conventions

| Variable | Resolution |
|---|---|
| `$STUDIO_URL` | `SEEFLOW_STUDIO_URL` → `~/.seeflow/config.json` port → `http://localhost:4321`. |
| `$projectSlug` | slug of the project name passed to `projects:create --name` (e.g. `--name "Order Pipeline"` → `order-pipeline`). Skill-created projects always have at least one flow registered under this slug. |
| `$flowSlug` | the flow id within the project. Defaults to `'main'` for skill-created projects; subsequent `flows:create` calls take arbitrary lowercase-kebab ids matching `^[a-z0-9][a-z0-9-]*$`. |
| `$repoPath` | `$PWD/.seeflow/<projectSlug>` (the seeflow project root the skill creates and passes to `projects:create --path`). |
| `$learnPath` | `$PWD/.seeflow/LEARN.md` — **shared across every project + flow** in the host repo. Lives next to the project folders, never inside one. |
| `$SEEFLOW_TMP` | `$repoPath/flows/$flowSlug/.tmp/` — per-flow scratch directory. Full lifecycle in §"Scratch files & cleanup" below. |
| `seeflow` | Locally installed `seeflow` binary if `command -v seeflow >/dev/null 2>&1`; otherwise `npx -y @tuongaz/seeflow@latest`. Resolve once at session start (e.g. `SEEFLOW="$(command -v seeflow >/dev/null 2>&1 && echo seeflow || echo 'npx -y @tuongaz/seeflow@latest')"`). Every CLI invocation below is shorthand for that. |

**Every flow mutation goes through the CLI.** The studio validates every write server-side — there is no separate validation step. Don't memorise CLI syntax — run `$SEEFLOW help` to see every subcommand and `$SEEFLOW help <command>` for synopsis, body shape, output, and error kinds. Treat the help output as the source of truth and follow what it prints. See `references/cli.md` for the resolver snippet.

**Run `$SEEFLOW schema` BEFORE designing or authoring any node.** The CLI is the only source of truth for field shapes, and it's built for cheap progressive disclosure:

1. `$SEEFLOW schema` → catalog of categories with `subnames` inlined on each + a `usage` block.
2. `$SEEFLOW schema <category>` (e.g. `node`, `action`) → full schemas, `notes`, `subnames`, and a `jqHints` block listing concrete drill paths to try next.
3. `$SEEFLOW schema <category> <subname>` (e.g. `node rectangle`, `action playAction`) → one variant with `jqHints.dataFields` — the EXACT list of `data.<field>` names you can target with `--jq` on the next call.

Slice with `--jq` to pull a single field's contract instead of the whole schema, using a path from `jqHints.examples` or assembled from `jqHints.dataFields`:

```
$SEEFLOW schema node rectangle \
    --jq '.schemas.rectangle.properties.data.properties.playAction'
```

Phase 0 caches the categories; downstream sub-agents are expected to drill into single subnames (with `--jq`) as they compose patches. Full grammar + every response field in `references/schema.md` § "Look up the contract at runtime" and `references/cli.md` § "Schema cache — fetched once at Phase 0".

### Scratch files & cleanup

Any intermediate file the orchestrator or a generated Play/Status script needs (curl output, jq scratch, downloaded fixtures, comparison snapshots, etc.) goes under `$SEEFLOW_TMP` — never `/tmp`, `/var/tmp`, or `$TMPDIR`. The per-flow path requires no extra permission, survives the run for debugging, and is gitignored by convention (the project lives inside the host's `.seeflow/` container, which is gitignored — add `flows/*/.tmp/` explicitly if not).

**Lifecycle:**

1. **Create on first use** — `mkdir -p "$SEEFLOW_TMP"` inside any script or wrapper that writes there. Idempotent, costs nothing.
2. **Generated scripts (Phase 5)** — Play / Status bodies that need scratch space should reference `"$SEEFLOW_TMP"` (or hardcode `flows/$flowSlug/.tmp/...` relative to `$repoPath` when running outside a wrapper that exports it).
3. **Cleanup at end of run** — after Phase 6 prints the final `Flow "..." registered ...` line, the orchestrator removes `$SEEFLOW_TMP` (`rm -rf "$SEEFLOW_TMP"`). On a failed/aborted run, leave it in place — the contents are the debugging trail.
4. **Never check in** — if `flows/*/.tmp/` is not yet gitignored, add it before committing.

## Parallelism is the default

**One message, N `Task` calls.** Narrate each phase boundary with a one-line status (e.g. `Phase 3: scaffolding skeleton flow…`) so silent waits don't feel broken. The canonical wrong/right block:

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
P3    projects:create (path + name → seeflow.json + flows/main/flow.json registered in one shot)
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

## Phase guides

Each phase has its mechanics, contracts, and edge cases in a dedicated reference file. Open the matching file at the phase boundary; the orchestrator does not need to load every phase reference up front.

| Phase | Purpose | Reference |
|---|---|---|
| P0 | Lookup-first gate, capability probe, schema cache, input-source gate, studio probe | `references/phases/p0-preflight.md` |
| P1 | Discover — three input-class branches (`code`, `conversation`, `document`) and Phase 1→2 overlap | `references/phases/p1-discover.md` |
| P2 | Plan nodes — launch `seeflow-node-planner`, validate envelope, retry once on partial output | `references/phases/p2-plan-nodes.md` |
| P3 | Scaffold via `projects:create`, normalize, mint canonical ids, `flow:add-bulk`, detail-backfill, layout, LEARN.md save #1, user review + dynamic gate | `references/phases/p3-scaffold.md` |
| P4 | Design Play + Status (parallel) — launch `seeflow-play-designer` ‖ `seeflow-status-designer` | `references/phases/p4-design-overlays.md` |
| P5 | Patch overlays + layout — write scripts, `nodes:patch`, edit-case retype routing, retry budget | `references/phases/p5-patch-overlays.md` |
| P6 | End-to-end validation — `e2e` subcommand, fix-up loop, LEARN.md save #2, cleanup | `references/phases/p6-validation.md` |

## Core rules

Full text in `references/core-rules.md`:

1. **No mocks.** Real services, real state. If something isn't running, stop and ask.
2. **Bigger picture before INSERTs.** Use the natural data-entry path (API, file-drop, producer, seed, webhook).
3. **Match the project's primary language.** Use `runtimeProfile.primaryLanguage` for every script.

## Common mistakes

- **Serial sub-agent dispatch.** One message, N Task calls — see §"Parallelism is the default" above.
- **Authoring `flow.json` directly.** Every mutation is a CLI call.
- **Asking "what's your codebase?".** Launch the analyzers — that is their job. (Exception: `inputClass === "conversation" | "document"` — the brief comes from elsewhere.)
- **Skipping or simulating Phase 6.** Mandatory for `inputClass === "code"`; legitimately skipped for `"document"`.
- **Mocking services or fake fixtures.** Use real triggers; copy fixtures from integration tests.
- **Ignoring the project's existing setup.** Inspect how the project boots local services and runs integration tests (Makefile / `scripts/` / compose / test harness / factory modules) and reuse those wrappers, helpers, and packages. Don't write a raw client when a project module already does the job — the system-analyzer surfaces these in `learnUpdates.dataEntryPaths`, `factories`, and `techAdaptations.<techId>.helpers[]`; Play/Status designers must consult them before inventing new code.
- **Calling `flows:create` instead of `projects:create` for a brand-new project.** `flows:create --project <p> --flow <f>` adds a flow to an *existing* project's manifest; a brand-new project always starts with `projects:create`, which writes both `seeflow.json` and the first `flows/main/flow.json` in one shot.
- **Passing `<slug>/scripts/…` as `scriptPath`.** The anchor is the node folder under `flows/<flowSlug>/nodes/<id>/` — emit just `scripts/play.ts`.
- **Writing `LEARN.md` inside a per-project or per-flow folder.** `$learnPath = $PWD/.seeflow/LEARN.md` is **shared across every project + flow** in the host repo — never inside `<projectSlug>/` or `<projectSlug>/flows/<flowSlug>/`.
- **Reaching for `type:'html'` before trying `type:'component'`.** The component catalog is the typed, theme-aware way to render rich node content (status cards, comparison tables, checklists, KPI tiles, gap rows) — and the rule is universal across every `inputClass`, not just `document`. `html` is a last-resort escape hatch, only legitimate once `$SEEFLOW schema componentCatalog` is confirmed not to cover the content, with the gap cited in `rationales[nodeId]`. See `references/schema.md` §"When to use which node type" and `agents/seeflow-node-planner.md` §"Picking node `type`".

## Red flags — stop and reconsider

If you catch yourself thinking any of the following, you are rationalising — stop and re-read the relevant rule.

- "I'll mock this one service so the script runs." → Rule 1 in `references/core-rules.md`. Stop and ask the user.
- "I'll write the empty envelope by hand — it's only two lines." → use `projects:create`. The CLI writes the manifest and the first flow envelope atomically; hand-authoring desyncs the two.
- "`projects:create` returned `alreadyExists` — I'll quietly run `register` and continue." → no. Surface the existing-project gate in `phases/p3-scaffold.md` § 1; auto-fallback is data-loss-adjacent.
- "Serial sub-agent dispatch is fine — parallelism is just an optimisation." → it is the contract (see §"Parallelism is the default"). One message, N `Task` calls.
- "Direct INSERT into the DB is faster than going through the API." → Rule 2. The natural data-entry path is what the flow exists to show.
- "Phase 6 e2e looks fine from the scripts — I'll skip the run." → mandatory for `inputClass === "code"`. Only `"document"` flows legitimately skip it.
- "I'll narrate the LEARN.md write so the user knows it happened." → both writes are silent by contract; narration is noise.
- "I'll just drop in an `html` node — it's only a small comparison table / status card / checklist." → no. `type:'component'` is the first choice for complex node content (any `inputClass`); `html` is only legitimate after `$SEEFLOW schema componentCatalog` is confirmed not to cover it, with the gap cited in `rationales[nodeId]`.
- "Schema output is just JSON — I'll parse `$schemaCache.node` myself (Python / hand-rolled walker / inline JS)." → no. The "don't memorise CLI syntax — run `$SEEFLOW help`" rule in §"Conventions" applies to every subcommand, schema included. Run `$SEEFLOW help schema` once: it documents the `<subname>` positional for per-variant drill-down AND the `--jq <filter>` flag for path extraction (jq-subset grammar, `badJq` exit 2). Reach for those before in-process JSON parsing.
- "My `--jq` got `badJq` — I'll parse the JSON with Python/JS instead." → no. `badJq` = wrong path, not a tool failure. Re-run the parent call (`$SEEFLOW schema node rectangle`) WITHOUT `--jq`, read `jqHints.examples` (and `jqHints.dataFields` for node variants — that's the exact `data.<field>` list you can target), then retry `--jq` with one of those paths. Never switch tools.
- "I'll design the node first and look up the schema when I'm ready to patch." → no. `$SEEFLOW schema` runs in milliseconds and tells you exactly which fields each variant accepts; designing before checking burns sub-agent iterations on shapes the CLI would have rejected. Run `$SEEFLOW schema <category>` (then `<subname>` for the variant you're about to author) before you draft a single `nodes:add` / `nodes:patch` body.

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
