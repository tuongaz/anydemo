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
