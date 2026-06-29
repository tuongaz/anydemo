# Phase 0 — pre-flight (parallel)

Pre-flight does these things in order: route through the lookup-first gate, set up a task checklist, probe CLI capability, cache the schema, run the silent type-surface diff, decide the input class, and probe the studio.

## Lookup-first gate — run before anything else

If the user's prompt reads as **inspection** rather than creation — any of "show me", "show the", "how does", "how do", "what does", "diagram", "explain", "where does", "what handles" — STOP and route through `/seeflow-lookup` instead. That skill catalogues registered flows and only hands back here if nothing matches. Going straight to creation when a flow already exists wastes the run and surfaces a duplicate. The same gate applies when the user names a flow by slug or title without an explicit verb ("the CRN Enhancement flow", "the checkout flow") — treat the prompt as inspection unless prefixed with "create / scaffold / generate / add".

Creation-only triggers (skip the gate): the prompt explicitly says "create / scaffold / generate / add a flow", or `/seeflow-lookup` has already run in this turn and reported no match.

## Task checklist

Create a `TaskCreate` checklist of the four phases (`Phase 0 — pre-flight` … `Phase 3 — scaffold, populate, layout, review`); `TaskUpdate` each as it finishes. (If `TaskCreate`/`TaskUpdate` aren't loaded, run `ToolSearch` with `select:TaskCreate,TaskUpdate` first.)

## Capability probe — run before anything else

Run `$SEEFLOW help` once and confirm every required subcommand is present: `projects:create`, `register`, `flow:add-bulk`, `flows:layout`, `nodes:patch`, `schema`, `ids`. (Older `@tuongaz/seeflow` versions on `npx` lack one or more — `ids` was added with the project-local scaffold flow; `projects:create` is the current new-project entry point.) For each missing subcommand, surface to the user and stop.

- Required missing → tell the user which subcommand is missing and that the fix is `npm i -g @tuongaz/seeflow@latest`. Then stop — do **not** start Phase 1.
- All present → continue.

If `$SEEFLOW help` itself fails (binary not on PATH, `npx` unavailable), surface the failure (`$SEEFLOW unresolved — neither local binary nor npx fallback available`) and stop.

### componentCatalog support — set `$hasComponentCatalog` here

The `componentCatalog` schema category (the discoverable element-type catalog the planner needs for `type:'component'` nodes) was added in `@tuongaz/seeflow` **0.1.94**. Older binaries lack it. Determine support **now**, with the always-safe schema-index call — it lists whatever categories the installed binary actually has and never errors on version:

```
$SEEFLOW schema   # → { categories:[{name:'flow',…},…], usage:{…} }
$hasComponentCatalog = .categories[].name contains "componentCatalog"
```

- `$hasComponentCatalog === true` → the catalog is discoverable; the schema cache below fetches it and `$componentCatalog` feeds the planner as documented.
- `$hasComponentCatalog === false` → the binary predates 0.1.94. **Do not** add `componentCatalog` to the parallel cache batch below (a `notFound` error in a parallel batch cancels its sibling fetches — that is how a single bad call takes out the `style` fetch too). Carry `$componentCatalog = null`. Component-node authoring degrades: the planner falls back to `html` for rich content, and you surface once — `component-node catalog unavailable: your seeflow predates 0.1.94; run 'npm i -g @tuongaz/seeflow@latest' for typed component nodes` — without stopping the run.

## Schema cache — fetch once, reuse everywhere

In a single message, run the **five always-present** schema calls in parallel and cache the outputs (`$schemaCache.flow`, `$schemaCache.node`, `$schemaCache.connector`, `$schemaCache.action`, `$schemaCache.style`):

```
$SEEFLOW schema flow  ‖  $SEEFLOW schema node  ‖  $SEEFLOW schema connector  ‖  $SEEFLOW schema action  ‖  $SEEFLOW schema style
```

Then **only if `$hasComponentCatalog === true`** (set in the capability probe above), add one more call — `$SEEFLOW schema componentCatalog` → `$schemaCache.componentCatalog`. Keep it **out** of the five-way batch: bundling a category that may not exist into a parallel batch lets its `notFound` cancel the sibling fetches. Run it on its own (or in a second batch) so a version miss never collateral-damages `style`.

Phase 2 (node-planner) reads from this cache via its launching prompt — it never re-fetches. The planner has no shell, so unforwarded fields are invisible to it; skipping the forward lets it invent fields the CLI rejects on `flow:add-bulk` / `nodes:patch`, burning a retry. If any of the five stable calls fails, surface the failure (`$SEEFLOW schema <name> failed; downstream agents cannot author conforming JSON`) and stop. A failed `componentCatalog` call does **not** stop the run — treat it as `$hasComponentCatalog === false` and degrade per the capability probe.

> **Drilling further.** When the planner only needs one variant (e.g. forwarding just the `component` node contract), the orchestrator can either slice the cached payload or re-fetch a narrow slice with `$SEEFLOW schema <category> <subname>` — for example `$SEEFLOW schema node component`, `$SEEFLOW schema node rectangle`. Same shape, same `notes`, just one schema. Prefer slicing the cache when it's already in hand; reach for the sub-lookup when re-running mid-session or when stitching launching prompts from MCP/REST (`seeflow_schema { name, subname }` / `GET /api/schema/:name/:subname`).

**Extract the component catalog (only when `$hasComponentCatalog`).** The `componentCatalog` schema category IS the catalog — one subname per legal `componentSpec.elements[].type`, each carrying that element's props schema. When the conditional fetch above ran, cache `$schemaCache.componentCatalog.subnames` as `$componentCatalog` (the list of legal element-type names) — no in-process parsing:

```
# $schemaCache.componentCatalog holds:
#   { name:'componentCatalog', schemas:{ Card:{…}, Chart:{…}, … },
#     subnames:[Card, Chart, Table, Button, …], notes:[…], jqHints:{…} }
$componentCatalog = $schemaCache.componentCatalog.subnames
```

When `$hasComponentCatalog === false`, `$componentCatalog = null` — the planner has no runtime element-type list and falls back to `html` for rich content (see the capability-probe degradation note). Never substitute a hand-typed list or read the canvas catalog source; the absence is a version signal, not a lookup to work around.

When the planner needs the props one element type accepts, drill: `$SEEFLOW schema componentCatalog <Name>` (e.g. `$SEEFLOW schema componentCatalog Chart`) returns just that component's props JSON Schema. Pair with `--jq` (e.g. `--jq '.schemas.Chart.required'`) when you want a single slice — every response carries `jqHints.rootPath` so you never guess the filter prefix.

`$componentCatalog` is required input for the planner whenever it emits `type:'component'` nodes (default for `inputClass === "document"` flows) — forward both the name list and, for any element type the planner commits to, the drilled props schema, since the planner has no shell. If `$componentCatalog` is null, tell the planner so up front so it routes rich content to `html` instead of inventing element types.

## Schema-type surface diff — silent

Diff the skill-documented node-type list (codified in `../schema.md` § "Skill-known node types" — 13 entries: `rectangle, ellipse, sticky, text, database, server, user, queue, cloud, icon, html, image, component`) against the actual discriminator values in `$schemaCache.node`:

- `missing = expectedTypes - actualTypes` — install omits a type the skill still references.
- `extra = actualTypes - expectedTypes` — install exposes a type the skill doesn't document.

If either set is non-empty, continue silently — this is a maintainer signal, not a runtime problem; the planner will still produce a flow using whatever types the CLI actually accepts. Do not surface to the user.

## Input-source gate — pick the brief's origin

Decide `$inputClass` before launching Phase 1. Three values:

| Class | Trigger | Phase 1 behaviour |
|---|---|---|
| `code` | Project root has a source tree AND the user's ask is about a running system ("show how X works", "diagram our pipeline", "add a flow for Y"). Default. | Launch code-analyzer + system-analyzer as today. |
| `conversation` | The current session already carries the brief's substance — ≥3 file references discussed, named entities, a tech stack mentioned — OR the user explicitly opts in ("use what we just discussed", "based on what we've been looking at"). | Skip the code-analyzer; the orchestrator builds the brief inline from the conversation. System-analyzer still runs when the flow touches a runtime; skip it too when the discussion already covered dev setup. |
| `document` | The user's prompt anchors on a document to visualise rather than a system to diagram — gap analysis, comparison, status report, RFC, architectural narrative, checklist, audit — OR the project root has no source tree and the user wants the canvas to render structured information. (Folds in the old "empty-project / design-only" branch.) | Skip both analyzers. The orchestrator builds the brief inline from the prompt + any pasted / referenced document text and sets `inputClass: "document"`. The planner defaults to `component` nodes from `$componentCatalog`, falling back to `html` for content the catalog can't render. |

Heuristic ladder, applied in order:

1. **Explicit user phrase** — pick the matching class without asking. ("Use what we just discussed" → `conversation`; "render this gap analysis" → `document`.)
2. **No source tree** — default to `document`. The empty-project / design-only branch from the prior skill version is now the no-source-tree case of `document`.
3. **Document-anchored prompt** — verbs like "render", "show this", "lay out", "visualise" + a noun like "report", "analysis", "comparison", "spec", "checklist" → `document`.
4. **Rich conversation context** — heuristic counts: ≥3 distinct file paths quoted, named services / DBs / queues, an articulated `techStack` already in-thread → `conversation`.
5. **Default** — `code`.

When the heuristic is genuinely ambiguous (e.g. source tree present AND a document discussed), ask once via `AskUserQuestion` with three options (`code`, `conversation`, `document`) and a one-line description each. Debounce — never re-ask the same question in a single session.

## Studio probe + LEARN.md (parallel)

Then in a single message:

1. `curl --max-time 0.5 -fsS "$STUDIO_URL/health"`
2. Read `$learnPath` (`$PWD/.seeflow/LEARN.md`) if present → `learnContext` (else `null`). **This file is shared across every flow in this host** — never look inside any `<flow-name>/` folder for it. Format: `../learn-format.md`.

- **200** → Phase 1.
- **!200** → tell the user the studio isn't running, warn the first launch can take a minute or two if it has to fall back to `npx`, then run the CLI's `start` subcommand. Re-probe `/health` once. If still unreachable, surface the failure (`studio /health unreachable after start retry`) and stop.
