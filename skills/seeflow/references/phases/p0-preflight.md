# Phase 0 — pre-flight (parallel)

Pre-flight does six things in order: route through the lookup-first gate, set up a task checklist, probe CLI capability, cache the schema, run the silent type-surface diff, decide the input class, and probe the studio.

## Lookup-first gate — run before anything else

If the user's prompt reads as **inspection** rather than creation — any of "show me", "show the", "how does", "how do", "what does", "diagram", "explain", "where does", "what handles" — STOP and route through `/seeflow-lookup` instead. That skill catalogues registered flows and only hands back here if nothing matches. Going straight to creation when a flow already exists wastes the run and surfaces a duplicate. The same gate applies when the user names a flow by slug or title without an explicit verb ("the CRN Enhancement flow", "the checkout flow") — treat the prompt as inspection unless prefixed with "create / scaffold / generate / add".

Creation-only triggers (skip the gate): the prompt explicitly says "create / scaffold / generate / add a flow", or `/seeflow-lookup` has already run in this turn and reported no match.

## Task checklist

Create a `TaskCreate` checklist of the six phases (`Phase 1 — discover` … `Phase 6 — end-to-end validation`); `TaskUpdate` each as it finishes. Phases skipped at the dynamic gate get marked completed with a one-line note. (If `TaskCreate`/`TaskUpdate` aren't loaded, run `ToolSearch` with `select:TaskCreate,TaskUpdate` first.)

## Capability probe — run before anything else

Run `$SEEFLOW help` once and confirm every required subcommand is present: `projects:create`, `register`, `flow:add-bulk`, `flows:layout`, `nodes:patch`, `schema`, `ids`, `e2e`. (Older `@tuongaz/seeflow` versions on `npx` lack one or more — `ids` was added with the project-local scaffold flow; `projects:create` is the current new-project entry point.) For each missing subcommand, surface to the user and stop.

- Required missing → tell the user which subcommand is missing and that the fix is `npm i -g @tuongaz/seeflow@latest`. Then stop — do **not** start Phase 1.
- All present → continue.

If `$SEEFLOW help` itself fails (binary not on PATH, `npx` unavailable), surface the failure (`$SEEFLOW unresolved — neither local binary nor npx fallback available`) and stop.

## Schema cache — fetch once, reuse everywhere

In a single message, run the five schema calls in parallel and cache the outputs (`$schemaCache.flow`, `$schemaCache.node`, `$schemaCache.connector`, `$schemaCache.action`, `$schemaCache.style`):

```
$SEEFLOW schema flow  ‖  $SEEFLOW schema node  ‖  $SEEFLOW schema connector  ‖  $SEEFLOW schema action  ‖  $SEEFLOW schema style
```

Phase 2 (node-planner) and Phase 4 (play/status designers) read from this cache via their launching prompts — they never re-fetch. The designers have no shell, so unforwarded fields are invisible to them; skipping the forward lets them invent fields the CLI rejects on `flow:add-bulk` / `nodes:patch`, burning a retry. If any of the five calls fails, surface the failure (`$SEEFLOW schema <name> failed; downstream agents cannot author conforming JSON`) and stop.

> **Drilling further.** When a downstream agent only needs one variant (e.g. forwarding just the `component` node contract to the status-designer), the orchestrator can either slice the cached payload or re-fetch a narrow slice with `$SEEFLOW schema <category> <subname>` — for example `$SEEFLOW schema node component`, `$SEEFLOW schema action playAction`. Same shape, same `notes`, just one schema. Prefer slicing the cache when it's already in hand; reach for the sub-lookup when re-running mid-session or when stitching launching prompts from MCP/REST (`seeflow_schema { name, subname }` / `GET /api/schema/:name/:subname`).

**Extract the component catalog.** Pull the legal `spec.elements[].type` enum from `$schemaCache.node`'s `component` variant into `$componentCatalog`. Use the schema command's `--jq` flag for the slice — do **not** parse `$schemaCache.node` in-process (Python, JS, hand-rolled walkers):

```
$SEEFLOW schema node component --jq '<jq path to the spec.elements[].type enum>'
```

Run `$SEEFLOW help schema` once this session before reaching for `--jq` — it documents the supported jq-path subset (identity `.`, field access `.foo`, brackets `.["foo"]` / `.[3]`, iteration `.foo[]`, optional `?`, pipe `|`) and the `badJq` error kind (exit 2). Resolve the exact path against the live schema output, not from memory — node-component's shape evolves and `--jq` errors fast on bad paths.

If `--jq` returns exit 2 (`badJq`): the path is wrong — the schema evolved. Run `$SEEFLOW schema node component` **without** `--jq` to inspect the live structure, derive the correct path from the output, then retry with the corrected expression. Never fall back to Python, JS, or any in-process parser. Treat `badJq` as a path-debugging signal, not a tool-capability gap.

Required input for the planner whenever it emits `type:'component'` nodes (default for `inputClass === "document"` flows).

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
