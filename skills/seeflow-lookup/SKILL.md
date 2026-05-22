---
name: seeflow-lookup
description: Read-only lookup over registered SeeFlow flows. Use when an agent or user needs to consult an existing flow as architectural ground truth — "how does X work", "show me the flow", "what already handles X", "where should this code go", "what depends on Y" — or when onboarding to a `.seeflow/`-equipped repo. Never creates or mutates flows; for that, use `/seeflow`.
---

# seeflow-lookup

Look up registered SeeFlow flows and consult them as architectural ground truth. Read-only counterpart to `/seeflow` — that skill *creates and edits* flows; this one *queries* them when an agent is writing code or making decisions.

## When NOT to invoke

- **Editing flows** → use `/seeflow` or the canvas.
- **Creating flows from scratch when you already know nothing is registered** → call `/seeflow` directly. (This skill will auto-hand-off to `/seeflow` if it discovers no match, but skip the hop when the gap is already obvious.)
- **Reading `.seeflow/LEARN.md`** → use `Read` directly (that file is `/seeflow`'s territory).
- **Mutating anything** — this skill is read-only. The auto-handoff above invokes `/seeflow`; it does not mutate state itself.

## Consent — silent check, top of every invocation

Before anything else, read `~/.seeflow/consent.json` silently. If missing, run the first-run prompt and write the file before continuing. If present + `enabled: false`, no feedback logging this session; otherwise log qualifying failures (`cli-error`, `subagent-fail`, `repeated-ask`, `user-complaint`) to `~/.seeflow/feedback.md`. The skill only writes locally — a `SessionEnd` hook handles transfer. **Format, prompt wording, kinds, and redaction rules live in `../seeflow/feedback.md`** — same cross-skill pattern this skill already uses for `../seeflow/references/schema.md`.

## Discover the CLI

Run `seeflow help` to list the available subcommands and their flags. If `seeflow` is not on `PATH`, fall back to `npx -y @tuongaz/seeflow@latest help`. **The CLI's help output is the source of truth for what you can call** — do not assume command names or flags from memory.

Cache the resolved binary (`seeflow` vs `npx -y @tuongaz/seeflow@latest`) for the rest of the conversation and reuse it for every subsequent call.

## First step — does a matching flow exist?

Before any deeper lookup, list the registered flows (use the catalog subcommand surfaced by `seeflow help`) and match the user's topic against it. Match generously: exact slug, fuzzy name, or topic keyword (e.g. "the cart" matches a flow named `shopping-cart`).

- **Match found** → continue with the cost ladder below.
- **No match** → **auto-switch to the `seeflow` skill to scaffold one.** Print a one-line handoff (`No flow registered for "<topic>" — invoking /seeflow to scaffold it.`), then invoke the `seeflow` skill via the `Skill` tool with the user's original topic as the prompt. Do **not** stop and ask first; do **not** answer by grepping the codebase yourself (that is `/seeflow`'s job — it dispatches the code-analyzer + system-analyzer sub-agents). Hand off and let `/seeflow` take over the rest of the turn.
- **Ambiguous match** (multiple plausible flows) → list them and ask the user which one.

## Output contract

- Every response is **JSON on stdout, passed through unchanged from the CLI**. No markdown wrappers, no synthetic fields.
- Errors are the CLI's structured errors (e.g. `flowNotFound`, `unknownNode`, `fileNotFound`, `badSchema`). Surface them as-is.

## Vocabulary (read the JSON intelligently)

- **Node types:** `playNode` (callable, has Play button), `stateNode` (observable, no Play), `shapeNode | iconNode | htmlNode | imageNode` (decorative — **skip for architectural reasoning** unless `htmlNode.html` carries meaningful content).
- **Kinds** (`data.kind`): `service`, `endpoint`, `worker`, `workflow`, `queue`, `topic`, `bus`, `db`, `store`, `cache`, `scheduler`, `external-api`, `trigger`.
- **Connector kinds:** `http` (with `method`, `url`), `event` (with `eventName`), `queue` (with `queueName`), `default` (label only).
- **`stateSource`:** `{ kind: "request" }` = triggered explicitly; `{ kind: "event" }` = reactive.
- **`file://` refs:** `data.detail` and `htmlNode.data.html` are auto-externalised on write. Whether they come back inlined depends on the subcommand — check `seeflow help` for the variant that returns full content.
- **`scriptPath`:** relative under `.seeflow/nodes/<nodeId>/` (e.g. `scripts/play.ts`). Read those files directly with `Read` if you need the source.

Deeper reference: `../seeflow/references/schema.md` in this plugin.

## Usage pattern (cost ladder)

Start with the cheapest lookup the CLI offers (a summary across flows), pick a flow, then ask for that flow's structure, and only fetch individual nodes when you need their content. Reserve any "full inline" variant for small flows or when you genuinely need every detail. Reading `play.ts` / `status.ts` directly is reserved for cases where the script source itself drives the decision.

## Common mistakes

- **Assuming subcommand names from memory** — always confirm with `seeflow help` first.
- **Reaching for the "full" variant first** on a large flow — burns context. Climb the ladder.
- **Treating decorative nodes as architecture** — `shapeNode`/`iconNode`/`imageNode` are visual only.
- **Re-emitting JSON as prose** — pass the CLI output through unchanged. Don't rewrite it as markdown.
- **Reading `file://` refs as filesystem paths** — let the CLI inline them; only fall back to direct `Read` for `scriptPath`.
