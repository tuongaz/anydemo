---
techId: example-tech
category: local-infra | storage | messaging | workflow | language
---

# <Tech name>

> **Check first.** Project conventions always win over the templates below.
>
> 1. `<host>/.seeflow/LEARN.md` `## Tech stack adaptations` — recorded
>    helpers, fixtures, emulator wiring, conventions.
> 2. `Grep`/`Glob` the repo for wrappers when LEARN.md is silent —
>    publisher/uploader/repository symbols, test-harness helpers,
>    `Makefile`/`scripts/` boot targets, compose service names.
>
> Append anything new you learn this run back into LEARN.md so the next
> flow reuses it.

## What it is

One-to-two-sentence identity. What it is and the role it plays in a
typical system (e.g. "Durable workflow engine — runs long-lived
orchestrations as code with replay-safe state").

## How to run it

Start the local service so the Play and Status scripts have something to
talk to.

- Project script first: `make <target>` / `bun run <task>` / project
  `docker compose` service, `any shell scripts`. Grep the repo before inventing one.
- Fall back to the canonical local recipe below.

```bash
# ≤ 5 lines. Start the emulator/CLI/compose service and print a ready signal.
```

## How to insert data

Canonical way to make this tech _do real work_ from a Play script.

- Project helper first: grep for publisher / uploader / repo / producer
  symbols; reuse one if present (the "see the bigger picture" rule).
- Honour the project's emulator env vars (endpoint override, project id).
- Pull payload shape from real fixtures when present.
- Fall back to the SDK / CLI template below.

```<lang>
// ≤ 15 lines, in the language most natural for this tech.
// Show: connect, do the one canonical action, exit 0 with JSON on stdout.
```

## How to verify run success

Cheapest one-shot confirmation that the insert above actually landed —
publish ack, write receipt, workflow start id, exit code, returned id.

```bash
# ≤ 5 lines. Exit 0 on success, non-zero otherwise.
```

## How to verify query data

Pull state back out — for the Status script and for ad-hoc checks.

- Project helper first when a read wrapper exists.
- Read the smallest signal: one row, one object, one queue depth, one
  subscription pull.
- Tolerate missing state — emit `state: "warn"` rather than throwing.
- Emit `StatusReport` JSON: `state`, `summary`, `data`, `ts`.

```<lang>
// ≤ 15 lines. Connect, read, build StatusReport, sleep, repeat.
```

## Node modelling

Direct guidance for `seeflow-node-planner`. Two bullets max:

- One node per <thing> (bucket / topic / table / queue / workflow),
  not per producer or consumer. Pick the SEMANTIC shape that matches
  the resource: `type:'database'` for stores, `type:'queue'` for
  queues / topics / event buses, `type:'cloud'` for object stores
  and external SaaS, `type:'server'` for infrastructure boxes,
  `type:'rectangle'` (+ Lucide `data.icon`) only when no illustrative
  shape fits. Capability chrome renders on all of these.
- Duplicate the node next to each consumer when it improves readability
  (same `type` + `data.name`, unique `id`).

## Gotchas

- <Quirk 1 — emulator behaviour that differs from the real service.>
- <Quirk 2 — required env var silently ignored without explanation.>
- <Quirk 3 — auth / port / region default that bites.>

## Fixture shape

```json
{ "minimal": "realistic envelope or row shape for this tech" }
```
