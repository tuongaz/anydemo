---
name: seeflow-wiki
description: 'Use when an AI agent or user needs to consult a SeeFlow flow as architectural ground truth — exploring how a system works ("how does X work", "show me the flow"), gathering context before implementation ("what already handles X", "where should this code go"), making scope/design decisions ("what depends on Y"), or onboarding to a `.seeflow/`-equipped repo. Read-only; never mutates flows. Sub-commands: `list`, `flow <id>`, `node <flowId> <nodeId>`, `flow <id> --full`, optional `--with-scripts`.'
---

# seeflow-wiki

Consult registered SeeFlow flows as architectural ground truth. Read-only counterpart to `/seeflow` — that skill *creates* flows from code; this one *reads* them when an agent is writing code or making decisions.

## When NOT to invoke

- **Editing flows** → use `/seeflow` or the canvas.
- **Creating flows** → use `/seeflow`.
- **Reading `.seeflow/WIKI.md`** → use `Read` directly (that file is `/seeflow`'s territory).
- **Mutating anything** — this skill is read-only.

## Preflight (once per session)

1. Resolve the CLI: try `command -v seeflow` first; fall back to `npx -y @tuongaz/seeflow@latest`. Use the resolved value as `$SEEFLOW` for every later call.
2. Run `$SEEFLOW help` once and parse the subcommand list.
3. If `flows:summary`, `flows:graph`, or `nodes:get` is missing, stop and return:

   ```json
   { "ok": false, "kind": "subcommandMissing", "missing": "<name>",
     "message": "Install seeflow >= 0.X.Y to use /seeflow-wiki <sub>." }
   ```

## Sub-commands

| Sub-command | CLI | Returns | When |
|---|---|---|---|
| `list` | `flows:summary` | `{ ok, flows: [{ id, name, description }] }` | Cheapest. Use first when the flow id is unknown. |
| `flow <id>` | `flows:graph <id>` | `{ ok, id, name, description, nodes, connectors }` (no `detail` / `html`) | Use to see structure before drilling into nodes. |
| `node <flowId> <nodeId>` | `nodes:get <flowId> <nodeId>` | `{ ok, id, node }` with `file://` inlined | Use for the semantic content of one node. |
| `flow <id> --full` | `flows:graph` + per-node `nodes:get` (parallel) | Same shape as `flow <id>`, every `data.detail` / `data.html` inlined | Convenience for "give me everything". Expensive on large flows. |

### `--with-scripts` flag

When passed to `node` or `flow --full`, the skill additionally reads `.seeflow/nodes/<nodeId>/scripts/play.ts` and `.seeflow/nodes/<nodeId>/scripts/status.ts` from disk and attaches them under `node.scripts = { play, status }`. Missing files render as `null`, not an error.

## Output contract

- Every response is **JSON on stdout, passed through unchanged from the CLI**. No markdown, no synthetic fields (except `node.scripts` when `--with-scripts` is used).
- Errors are the CLI's structured errors: `flowNotFound`, `unknownNode`, `fileNotFound`, `badSchema`, `subcommandMissing`.

## Vocabulary (read the JSON intelligently)

- **Node types:** `playNode` (callable, has Play button), `stateNode` (observable, no Play), `shapeNode | iconNode | htmlNode | imageNode` (decorative — **skip for architectural reasoning** unless `htmlNode.html` carries meaningful content).
- **Kinds** (`data.kind`): `service`, `endpoint`, `worker`, `workflow`, `queue`, `topic`, `bus`, `db`, `store`, `cache`, `scheduler`, `external-api`, `trigger`.
- **Connector kinds:** `http` (with `method`, `url`), `event` (with `eventName`), `queue` (with `queueName`), `default` (label only).
- **`stateSource`:** `{ kind: "request" }` = triggered explicitly; `{ kind: "event" }` = reactive.
- **`file://` refs:** `data.detail` and `htmlNode.data.html` are auto-externalised on write. In `node` / `flow --full` mode they are inlined back to the real string. In `flow <id>` mode they are stripped.
- **`scriptPath`:** relative under `.seeflow/nodes/<nodeId>/` (e.g. `scripts/play.ts`).

Deeper reference: `../seeflow/references/schema.md` in this plugin.

## Usage pattern (cost ladder)

- Start cheapest. `list` → pick a flow → `flow <id>` for structure → `node` only for the specific nodes whose `detail.md` you need.
- Reach for `flow <id> --full` only when the flow is small (< 10 nodes) or you genuinely need every detail.
- Reach for `--with-scripts` only when reading the actual `play.ts` / `status.ts` source matters for the decision you're making (e.g., reproducing the behavior in new code).
