---
name: seeflow
description: This skill should be used when the user explicitly asks to "create a flow", "generate a flow", "scaffold a SeeFlow flow", or "add a flow to this repo" — or when a previous /seeflow-lookup has already reported no matching flow exists. Inspection phrasing ("show me", "how does X work", "diagram our system", "explain the flow") routes to /seeflow-lookup first; that skill auto-hands off here only when nothing is registered. Orchestrates three sub-agents and the `seeflow` CLI to turn a natural-language prompt into a registered, validated SeeFlow flow at <project>/flow.json (node-attached files live under <projectPath>/nodes/<id>/).
---

# seeflow

Turn a natural-language prompt into a registered SeeFlow flow at `$repoPath/flows/<flowSlug>/flow.json` (skill-created projects default to `flowSlug: 'main'`), with node-attached content (detail.md, view.html) under `$repoPath/flows/<flowSlug>/nodes/<id>/`. Orchestrate three sub-agents and the `seeflow` CLI; never read the codebase directly, never author `seeflow.json` or `flow.json` by hand (`projects:create` writes both the manifest and the first flow envelope).

## When NOT to invoke

- Editing nodes on an existing flow → use the canvas, or hit the CLI directly (`nodes:patch`).
- Deleting a flow → `flows:delete`.
- Re-laying out an existing flow without semantic changes → `flows:layout`.

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
        nodes/<id>/                      ← per-node sidecar files (detail.md, view.html)
        .tmp/                            ← per-flow scratch ($SEEFLOW_TMP)
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
| `$projectSlug` | **The first segment of the combined `slug` in the `projects:create` response.** The response is `{ ok, id, slug }` where `slug` is `"<projectSlug>/<flowSlug>"` (e.g. `"order-pipeline/main"`) — split on `/` and take `[0]`. Authoritative for every follow-up `--project` call. The studio derives it as `slugify(--name)` (e.g. `--name "Order Pipeline"` → `order-pipeline`) — **not** from the planner's `slug` field, which may differ. Never reuse the planner's `slug` as `--project`; always reassign `$projectSlug` from the response slug (see `phases/p3-scaffold.md` § 1). |
| `$flowSlug` | the flow id within the project — the **second segment** of the `projects:create` response `slug` (`slug.split('/')[1]`). Defaults to `'main'` for skill-created projects; subsequent `flows:create` calls take arbitrary lowercase-kebab ids matching `^[a-z0-9][a-z0-9-]*$`. |
| `$repoPath` | `$PWD/.seeflow/<planner-slug>` — the directory passed to `projects:create --path`. This is just a path; the planner's `slug` names the folder. It does **not** have to equal `$projectSlug` (the registry resolves `--project` calls by slug, and stores `repoPath` independently). |
| `$learnPath` | `$PWD/.seeflow/LEARN.md` — **shared across every project + flow** in the host repo. Lives next to the project folders, never inside one. |
| `$SEEFLOW_TMP` | `$repoPath/flows/$flowSlug/.tmp/` — per-flow scratch directory. Full lifecycle in §"Scratch files & cleanup" below. |
| `seeflow` | Locally installed `seeflow` binary if `command -v seeflow >/dev/null 2>&1`; otherwise `npx -y @tuongaz/seeflow@latest`. Resolve once at session start (e.g. `SEEFLOW="$(command -v seeflow >/dev/null 2>&1 && echo seeflow || echo 'npx -y @tuongaz/seeflow@latest')"`). Every CLI invocation below is shorthand for that. |

**Every flow mutation goes through the CLI.** The studio validates every write server-side — there is no separate validation step. Don't memorise CLI syntax — run `$SEEFLOW help` to see every subcommand and `$SEEFLOW help <command>` for synopsis, body shape, output, and error kinds. Treat the help output as the source of truth and follow what it prints. See `references/cli.md` for the resolver snippet.

**Run `$SEEFLOW schema` BEFORE designing or authoring any node.** The CLI is the only source of truth for field shapes, and it's built for cheap progressive disclosure:

1. `$SEEFLOW schema` → catalog of categories with `subnames` inlined on each + a `usage` block.
2. `$SEEFLOW schema <category>` (e.g. `node`, `connector`) → full schemas, `notes`, `subnames`, and a `jqHints` block listing concrete drill paths to try next.
3. `$SEEFLOW schema <category> <subname>` (e.g. `node rectangle`, `node component`) → one variant with `jqHints.dataFields` — the EXACT list of `data.<field>` names you can target with `--jq` on the next call.

Slice with `--jq` to pull a single field's contract instead of the whole schema, using a path from `jqHints.examples` or assembled from `jqHints.dataFields`:

```
$SEEFLOW schema node rectangle \
    --jq '.schemas.rectangle.properties.data.properties.icon'
```

Phase 0 caches the categories; downstream sub-agents are expected to drill into single subnames (with `--jq`) as they compose patches. Full grammar + every response field in `references/schema.md` § "Look up the contract at runtime" and `references/cli.md` § "Schema cache — fetched once at Phase 0".

### Scratch files & cleanup

Any intermediate file the orchestrator needs (curl output, jq scratch, downloaded fixtures, comparison snapshots, etc.) goes under `$SEEFLOW_TMP` — never `/tmp`, `/var/tmp`, or `$TMPDIR`. The per-flow path requires no extra permission, survives the run for debugging, and is gitignored by convention (the project lives inside the host's `.seeflow/` container, which is gitignored — add `flows/*/.tmp/` explicitly if not).

**Lifecycle:**

1. **Create on first use** — `mkdir -p "$SEEFLOW_TMP"` inside any wrapper that writes there. Idempotent, costs nothing.
2. **Cleanup at end of run** — after Phase 3 prints the final `Flow "..." registered ...` line, the orchestrator removes `$SEEFLOW_TMP` (`rm -rf "$SEEFLOW_TMP"`). On a failed/aborted run, leave it in place — the contents are the debugging trail.
3. **Never check in** — if `flows/*/.tmp/` is not yet gitignored, add it before committing.

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

Every parallel step (the Phase 1 analyzers, the Phase 3 detail-backfill patches across nodes) follows this pattern.

**If `Agent(subagent_type: "seeflow-…")` errors with `Agent type '…' not found`,** the plugin's agent types aren't registered in this environment — fall back to dispatching `general-purpose` with the matching `agents/seeflow-*.md` contract inlined into the prompt. Same parallelism rule, same contracts; see `references/operations.md` §"Sub-agent reference". Never serialise or skip a phase just because the named type is missing.

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
      → SILENT LEARN.md write (merge staged learnUpdates + upsert flow row)
      → USER REVIEW (layout review; apply edits directly or re-run planner)
      → final-flow line → rm -rf "$SEEFLOW_TMP"
```

Each phase gates on the previous (with the Phase 1 → Phase 2 overlap).

## Phase guides

Each phase has its mechanics, contracts, and edge cases in a dedicated reference file. Open the matching file at the phase boundary; the orchestrator does not need to load every phase reference up front.

| Phase | Purpose | Reference |
|---|---|---|
| P0 | Lookup-first gate, capability probe, schema cache, input-source gate, studio probe | `references/phases/p0-preflight.md` |
| P1 | Discover — three input-class branches (`code`, `conversation`, `document`) and Phase 1→2 overlap | `references/phases/p1-discover.md` |
| P2 | Plan nodes — launch `seeflow-node-planner`, validate envelope, retry once on partial output | `references/phases/p2-plan-nodes.md` |
| P3 | Scaffold via `projects:create`, normalize, mint canonical ids, `flow:add-bulk`, detail-backfill, layout, LEARN.md save, user review, final-flow line + cleanup | `references/phases/p3-scaffold.md` |

## Core rules

Full text in `references/core-rules.md`:

1. **Model the real system, not a guess.** Every node maps to an entity the analyzers actually found; never invent topology to fill the canvas.
2. **One node per concept.** One service / workflow / queue / DB / external API per node — collapse unless an explicit exception earns the split.
3. **Resources are mandatory.** Every DB, queue, bus, cache, file store, and external SaaS the brief touches gets its own node — that's where the audience sees state land.

## Common mistakes

- **Serial sub-agent dispatch.** One message, N Task calls — see §"Parallelism is the default" above.
- **Authoring `flow.json` directly.** Every mutation is a CLI call.
- **Asking "what's your codebase?".** Launch the analyzers — that is their job. (Exception: `inputClass === "conversation" | "document"` — the brief comes from elsewhere.)
- **Ignoring the project's existing setup.** Inspect how the project boots local services and runs integration tests (Makefile / `scripts/` / compose / test harness / factory modules) so the brief reflects how the system actually runs. The system-analyzer surfaces these in `learnUpdates.dataEntryPaths`, `factories`, and `techAdaptations.<techId>.helpers[]`; they enrich the node detail the planner writes.
- **Calling `flows:create` instead of `projects:create` for a brand-new project.** `flows:create --project <p> --flow <f>` adds a flow to an *existing* project's manifest; a brand-new project always starts with `projects:create`, which writes both `seeflow.json` and the first `flows/main/flow.json` in one shot.
- **Using the planner's `slug` as `--project`.** The registry slug is `slugify(--name)`, returned by `projects:create` — capture it from the response and reassign `$projectSlug`. The planner's `slug` field only names the `--path` directory and may differ; carrying it into `--project` makes `flow:add-bulk` / `flows:layout` fail with `projectNotFound`.
- **Writing `LEARN.md` inside a per-project or per-flow folder.** `$learnPath = $PWD/.seeflow/LEARN.md` is **shared across every project + flow** in the host repo — never inside `<projectSlug>/` or `<projectSlug>/flows/<flowSlug>/`.
- **Reaching for `type:'html'` before trying `type:'component'`.** The component catalog is the typed, theme-aware way to render rich node content (status cards, comparison tables, checklists, KPI tiles, gap rows) — and the rule is universal across every `inputClass`, not just `document`. `html` is a last-resort escape hatch, only legitimate once `$SEEFLOW schema componentCatalog` is confirmed not to cover the content (gap cited in `rationales[nodeId]`) **or** when the catalog is unavailable on the installed binary (`$hasComponentCatalog === false`, i.e. seeflow predates 0.1.94 — see `phases/p0-preflight.md`). See `references/schema.md` §"When to use which node type" and `agents/seeflow-node-planner.md` §"Picking node `type`".

## Red flags — stop and reconsider

If you catch yourself thinking any of the following, you are rationalising — stop and re-read the relevant rule.

- "I'll add a node for an entity the analyzers didn't find — it rounds out the diagram." → Rule 1 in `references/core-rules.md`. Model only what the brief actually surfaces; mark unfound entities out of scope.
- "I'll write the empty envelope by hand — it's only two lines." → use `projects:create`. The CLI writes the manifest and the first flow envelope atomically; hand-authoring desyncs the two.
- "`projects:create` returned `alreadyExists` — I'll quietly run `register` and continue." → no. Surface the existing-project gate in `phases/p3-scaffold.md` § 1; auto-fallback is data-loss-adjacent.
- "The planner gave me a `slug`, so I'll use it for `--project`." → no. The addressing slug is `slugify(--name)`, returned by `projects:create`. Reassign `$projectSlug` from the response; the planner's `slug` only names the `--path` directory. Mismatch → `projectNotFound` on `flow:add-bulk` / `flows:layout`.
- "Serial sub-agent dispatch is fine — parallelism is just an optimisation." → it is the contract (see §"Parallelism is the default"). One message, N `Task` calls.
- "The service writes to a DB, but I'll skip the DB node — the service node is enough." → Rule 3. The resource is where the audience sees state land; every store / queue / bus / cache the brief touches earns its own node.
- "I'll narrate the LEARN.md write so the user knows it happened." → the write is silent by contract; narration is noise.
- "I'll just drop in an `html` node — it's only a small comparison table / status card / checklist." → no. `type:'component'` is the first choice for complex node content (any `inputClass`); `html` is only legitimate after `$SEEFLOW schema componentCatalog` is confirmed not to cover it (gap cited in `rationales[nodeId]`) or when `$hasComponentCatalog === false` on the installed binary.
- "Schema output is just JSON — I'll parse `$schemaCache.node` myself (Python / hand-rolled walker / inline JS)." → no. The "don't memorise CLI syntax — run `$SEEFLOW help`" rule in §"Conventions" applies to every subcommand, schema included. Run `$SEEFLOW help schema` once: it documents the `<subname>` positional for per-variant drill-down AND the `--jq <filter>` flag for path extraction (jq-subset grammar, `badJq` exit 2). Reach for those before in-process JSON parsing.
- "My `--jq` got `badJq` — I'll parse the JSON with Python/JS instead." → no. `badJq` = wrong path, not a tool failure. Re-run the parent call (`$SEEFLOW schema node rectangle`) WITHOUT `--jq`, read `jqHints.examples` (and `jqHints.dataFields` for node variants — that's the exact `data.<field>` list you can target), then retry `--jq` with one of those paths. Never switch tools.
- "The user approved the layout, then asked to add two nodes — I'll re-run the full node-planner." → no, for a small fully-specified edit. Apply it directly: `flow:add-bulk` for new nodes/connectors, `nodes:patch` for field edits, `nodes:delete` for removals, then `flows:layout`. The planner is for turning an open-ended brief into a graph, not for relaying a tweak the user already spelled out. Re-run the planner only for substantive/structural changes. See `phases/p3-scaffold.md` §"User review".
- "I'll design the node first and look up the schema when I'm ready to patch." → no. `$SEEFLOW schema` runs in milliseconds and tells you exactly which fields each variant accepts; designing before checking burns sub-agent iterations on shapes the CLI would have rejected. Run `$SEEFLOW schema <category>` (then `<subname>` for the variant you're about to author) before you draft a single `nodes:add` / `nodes:patch` body.

## Operations

| Topic | File |
|---|---|
| CLI resolver + discovery via `$SEEFLOW help` | `references/cli.md` |
| Error handling, retry caps, sub-agent table | `references/operations.md` |
| Per-node file convention, when-to-use guidance | `references/schema.md` |
| Core rules | `references/core-rules.md` |
| `$learnPath` format, lifecycle, merging, `learnUpdates` contract | `references/learn-format.md` |
| Tech-specific best practices | `references/tech/README.md` |
| Sub-agent prompts | `agents/seeflow-*.md` |
| Canonical id generator | `$SEEFLOW ids <node\|connector> <count>` |
