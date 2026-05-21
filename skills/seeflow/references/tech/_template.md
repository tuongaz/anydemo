---
techId: example-tech
category: local-infra | storage | messaging | language
---

# <Tech name>

> **General guidance only.** Check `<project>/.seeflow/LEARN.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

Direct guidance for `seeflow-node-planner`. Two bullets max:

- One `stateNode` per <thing> (bucket / topic / table / queue), not per
  producer or consumer.
- Duplicate the node next to each consumer when it improves readability
  (per Phase 2 abstraction rules: same `kind` + `name`, unique `id`).

## Play (trigger locally)

Canonical way to make this tech *do real work* from a play script.

- Use the official client in the project's `runtimeProfile.primaryLanguage`.
- Reuse any existing project helper (publisher, uploader, producer) over
  rolling your own client. Grep first.
- Honour the project's local-emulator wiring (compose service, env var,
  endpoint override).
- Inputs come from real fixtures when present — never invent payload
  shape if the project ships one.

```<lang>
// ~15-line example in the language most natural for this tech.
// Show: connect, do the one canonical action, exit 0 with JSON on stdout.
```

## Status (read locally)

Canonical way to *read real state* from a status script.

- Use the official client to read the smallest possible signal (one row,
  one object, one queue depth, one subscription pull).
- Loop with a sensible tick (see seeflow-status-designer "Tick cadence").
- Emit `StatusReport` JSON: `state`, `summary`, `data`, `ts`.
- Tolerate missing state — emit `state: "warn"` rather than throwing.

```<lang>
// ~15-line example. Show: connect, read, build StatusReport, sleep, repeat.
```

## Gotchas

- <Quirk 1 — emulator behaviour that differs from the real service.>
- <Quirk 2 — required env var that is silently ignored without explanation.>
- <Quirk 3 — auth / port / region default that bites.>

## Fixture shape

```json
{ "minimal": "realistic envelope or row shape for this tech" }
```
