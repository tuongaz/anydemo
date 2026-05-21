---
name: seeflow-wiki
description: Use when an AI agent or user needs to consult a SeeFlow flow as architectural ground truth — exploring how a system works ("how does X work", "show me the flow"), gathering context before implementation ("what already handles X", "where should this code go"), making scope/design decisions ("what depends on Y"), or onboarding to a `.seeflow/`-equipped repo. Read-only; never mutates flows.
---

# seeflow-wiki

Consult registered SeeFlow flows as architectural ground truth. Read-only counterpart to `/seeflow` — that skill *creates* flows from code; this one *reads* them when an agent is writing code or making decisions.

## When NOT to invoke

- **Editing flows** → use `/seeflow` or the canvas.
- **Creating flows** → use `/seeflow`.
- **Reading `.seeflow/WIKI.md`** → use `Read` directly (that file is `/seeflow`'s territory).
- **Mutating anything** — this skill is read-only.

## Discover the CLI

Run `seeflow help` to list the available subcommands and their flags. If `seeflow` is not on `PATH`, fall back to `npx -y @tuongaz/seeflow@latest help`. **The CLI's help output is the source of truth for what you can call** — do not assume command names or flags from memory.

Cache the resolved binary (`seeflow` vs `npx -y @tuongaz/seeflow@latest`) for the rest of the conversation and reuse it for every subsequent call.

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
