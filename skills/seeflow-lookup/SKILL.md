---
name: seeflow-lookup
description: This skill should be used before `/seeflow` whenever the user phrases the request as inspection rather than creation — "show me", "show the", "how does X work", "what does X do", "diagram our system", "explain the flow", "where does X live", "what handles Y", "what depends on Z", or names a flow by slug/title without an explicit "create / scaffold / generate / add" verb. Also use when onboarding to a repo that already has seeflow flows registered. Read-only — never mutates flows; auto-hands off to `/seeflow` only when no matching flow is registered.
---

# seeflow-lookup

Look up registered SeeFlow flows and consult them as architectural ground truth. Read-only counterpart to `/seeflow` — that skill *creates and edits* flows; this one *queries* them while writing code or making decisions.

## Routing gate — run before deciding

Inspection phrasing **always** lands here first, even when no flow is yet registered — the auto-handoff below covers the empty case. The trigger words are: `show me`, `show the`, `how does`, `how do`, `what does`, `what handles`, `where does`, `where is`, `diagram`, `explain`, `walk me through`, plus any reference to a flow by slug or title without an explicit creation verb (`create`, `scaffold`, `generate`, `add a flow`). When in doubt, route here — a no-match handoff to `/seeflow` is cheap; a duplicate creation run from skipping the gate is not.

## When NOT to invoke

- **Editing flows** → use `/seeflow` or the canvas.
- **Creating flows from scratch when the user explicitly said "create / scaffold / generate / add a flow"** → call `/seeflow` directly. (This skill auto-hands off to `/seeflow` if it discovers no match for an inspection prompt; skip the hop only when the user's verb is unambiguously creation.)
- **Reading `LEARN.md`** → use `Read` directly (that file is `/seeflow`'s territory).
- **Mutating anything** — this skill is read-only. The auto-handoff above invokes `/seeflow`; it does not mutate state itself.

## Discover the CLI

Run `seeflow help` to list the available subcommands and their flags. If `seeflow` is not on `PATH`, fall back to `npx -y @tuongaz/seeflow@latest help`. **The CLI's help output is the source of truth for the callable surface** — do not assume command names or flags from memory.

Cache the resolved binary (`seeflow` vs `npx -y @tuongaz/seeflow@latest`) for the rest of the conversation and reuse it for every subsequent call.

## First step — does a matching flow exist?

Before any deeper lookup, list the registered flows (use the catalog subcommand surfaced by `seeflow help`) and match the user's topic against it. Match generously: exact slug, fuzzy name, or topic keyword (e.g. "the cart" matches a flow named `shopping-cart`).

- **Match found** → **surface the canvas URL first** (`$STUDIO_URL/d/<slug>`) so the user can open it, then continue with the cost ladder below for whatever deeper question they asked. Never re-scaffold an existing flow — `/seeflow` is the wrong tool here even if the existing flow looks stale; editing belongs on the canvas or `nodes:patch`.
- **No match** → **auto-switch to the `seeflow` skill to scaffold one.** Print a one-line handoff (`No flow registered for "<topic>" — invoking /seeflow to scaffold it.`), then invoke the `seeflow` skill via the `Skill` tool with the user's original topic as the prompt. Do **not** stop and ask first; do **not** answer by grepping the codebase yourself (that is `/seeflow`'s job — it dispatches the code-analyzer + system-analyzer sub-agents). Hand off and let `/seeflow` take over the rest of the turn.
- **Ambiguous match** (multiple plausible flows) → list them with their canvas URLs and ask the user which one.

## Output contract

- Every response is **JSON on stdout, passed through unchanged from the CLI**. No markdown wrappers, no synthetic fields.
- Errors are the CLI's structured errors (e.g. `flowNotFound`, `unknownNode`, `fileNotFound`, `badSchema`). Surface them as-is.

## Vocabulary (read the JSON intelligently)

For node / connector / action field shapes, run `seeflow schema` (then `seeflow schema node`, `seeflow schema connector`, `seeflow schema action` as needed). Don't infer field names, enum values, or required-lists from memory — re-fetch them. The schema covers what each variant looks like on disk and which values are legal.

To pluck a slice out of a large schema payload, pass a jq path filter via `--jq`: e.g. `seeflow schema node --jq .schemas.rectangle`, `seeflow schema node --jq '.schemas.image.properties.data.properties.path'`, or `seeflow schema node --jq '.schemas[]'`. Supported subset: identity (`.`), field (`.foo.bar`), bracket (`.["k"]`, `.[3]`, negative indices), iteration (`.foo[]`), optional `?`, and pipe (`|`). The CLI returns the value under `result` (single output) or `result: [...]` (multiple). Bad filters exit with code 2 / `badJq`.

Runtime behavior the CLI assumes — not encoded in the schema:

- **Decorative node types** — `sticky`, `text`, `icon`, `image`, `html` with empty content, and geometric shapes (`ellipse`, `database`, `queue`, `cloud`, `server`, `user`) carrying no capabilities — are visual only. **Skip them for architectural reasoning.** Treat any node as architectural when its `data.playAction` or `data.statusAction` is set, regardless of `type`.
- **Semantics live on the nodes, not the connectors.** Read the source / target node's `data.name` (and `codePointers` from the brief) to understand what an edge means.
- **`file://` content fields** (e.g. `detail`, `html`) are auto-externalised on write. Whether they come back inlined depends on the subcommand — check `seeflow help` for the variant that returns full content.
- **Action `scriptPath` values** are relative under `nodes/<nodeId>/`. Read those files directly with `Read` to inspect the script source.

Deeper reference: `../seeflow/references/schema.md` in this plugin (conventions only — no field shapes).

## Usage pattern (cost ladder)

Start with the cheapest lookup the CLI offers (a summary across flows), pick a flow, then ask for that flow's structure, and only fetch individual nodes when their content is needed. Reserve any "full inline" variant for small flows or when every detail is genuinely required. Reading `play.ts` / `status.ts` directly is reserved for cases where the script source itself drives the decision.

## Common mistakes

- **Assuming subcommand names from memory** — always confirm with `seeflow help` first.
- **Reaching for the "full" variant first** on a large flow — burns context. Climb the ladder.
- **Treating decorative nodes as architecture** — geometric shapes without capabilities, plus `sticky` / `text` / `icon` / `image` / empty `html`, are visual only.
- **Re-emitting JSON as prose** — pass the CLI output through unchanged. Don't rewrite it as markdown.
- **Reading `file://` refs as filesystem paths** — let the CLI inline them; only fall back to direct `Read` for `scriptPath`.
