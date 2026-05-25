---
techId: temporal
category: workflow
---

# Temporal

> **Check first.** Project conventions always win over the templates below.
>
> 1. `<host>/.seeflow/LEARN.md` `## Tech stack adaptations` — recorded
>    helpers, worker registrations, TaskQueue + Namespace conventions.
> 2. `Grep`/`Glob` the repo for wrappers when LEARN.md is silent —
>    worker entrypoints, `temporal workflow start` invocations,
>    `Makefile`/`scripts/` boot targets, compose service names.
>
> Append anything new you learn this run back into LEARN.md so the next
> flow reuses it.

## What it is

Durable workflow engine — runs long-lived orchestrations as replay-safe
code. Workers poll task queues; the server persists every event.

## How to run it

- Project script first: `make <target>` / `bun run <task>` / project
  `docker compose up -d temporal` (`temporalio/auto-setup` matches prod).
- Fall back: `temporal server start-dev` — bundled with the `temporal`
  CLI, no Docker. Default frontend `:7233`, web UI `:8233`.

```bash
temporal server start-dev --db-filename ./.temporal.db
# persistent across restarts via the db file
```

## How to insert data

**The project's worker process must already be running.** The `temporal`
CLI only enqueues a start — workflow code lives in the project worker.
Wrong worker (or no worker) = the workflow sits at `RUNNING` forever.

- Project helper / script wins: grep for `temporal workflow start` in
  `Makefile` / `scripts/`, or a project seed command.
- Honour `TEMPORAL_ADDRESS=localhost:7233` and
  `TEMPORAL_NAMESPACE=default`. Create the namespace only if non-default:
  `temporal operator namespace create <name>`.
- Match `--task-queue` and `--type` exactly to what the worker registers.

```bash
temporal workflow start \
  --task-queue=orders --type=OrderWorkflow \
  --workflow-id=o_1 --input='{"id":"o_1","total":4200}'
```

## How to verify run success

```bash
temporal workflow describe -w o_1 -o json \
  | jq -e '.executionInfo.status as $s
           | $s=="WORKFLOW_EXECUTION_STATUS_RUNNING"
          or $s=="WORKFLOW_EXECUTION_STATUS_COMPLETED"'
# exit 0 on start/complete; non-zero on FAILED / TERMINATED / TIMED_OUT
```

## How to verify query data

- Project helper first when a describe wrapper exists.
- Map `executionInfo.status` → `state`: `RUNNING` / `COMPLETED` → `ok`,
  `CONTINUED_AS_NEW` → `warn`, `FAILED` / `TERMINATED` / `TIMED_OUT` →
  `error`. Missing execution → `warn`, not throw.
- For activity history: `temporal workflow show -w <id>` dumps events.
- Emit `StatusReport` JSON each tick: `state`, `summary`, `data`, `ts`.

```bash
while :; do
  raw=$(temporal workflow describe -w o_1 -o json 2>/dev/null || echo '{}')
  s=$(echo "$raw" | jq -r '.executionInfo.status // "MISSING"')
  case "$s" in
    *RUNNING|*COMPLETED) state=ok ;;
    *CONTINUED_AS_NEW)   state=warn ;;
    *FAILED|*TERMINATED|*TIMED_OUT) state=error ;;
    *) state=warn ;;
  esac
  jq -nc --arg s "$state" --arg sum "$s" \
    '{state:$s, summary:$sum, data:"o_1", ts:now|floor}'
  sleep 2
done
```

## Node modelling

- One node per workflow *type* (`OrderWorkflow`), not per execution.
  `type:'rectangle'`, `data.icon:'workflow'` or `'git-branch'`.
- Activities are implementation detail — only model them when they hit
  a meaningful external resource (separate DB, outbound HTTP service).

## Gotchas

- TaskQueue mismatch between the CLI start and the worker is invisible —
  start succeeds, no worker polls, status sits at `RUNNING` forever.
- `temporal server start-dev` is ephemeral; restart wipes history unless
  `--db-filename` is set.
- Namespace drift (`default` vs `<project>-dev`) lands the workflow
  elsewhere; UI defaults to `default` and shows nothing.
- `temporal` (modern, used here) and `tctl` (legacy) are different
  binaries with different flags — don't mix examples.

## Fixture shape

```json
{ "workflowId": "o_1", "workflowType": "OrderWorkflow", "taskQueue": "orders", "input": [{"id":"o_1","total":4200}], "status": "RUNNING", "startTime": "2026-05-20T12:00:00Z" }
```
