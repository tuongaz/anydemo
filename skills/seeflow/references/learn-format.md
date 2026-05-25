# `LEARN.md` — project memory for flow authoring

`<host>/.seeflow/LEARN.md` is the persistent crib sheet the `seeflow`
skill writes for itself. It is **shared across every flow in the host
repo** — there is exactly one `LEARN.md` per host, living next to (not
inside) the per-flow project directories. Every `/seeflow` invocation
reads it before discovery and updates it at the end of discovery (and
again whenever later phases surface a non-obvious fact).

The file is **for the skill**, not for the user — keep it terse, keep it
factual, keep it scannable. Treat it like an internal handbook: a future
run should be able to skip a lot of grep work by reading it.

## Lifecycle

There are exactly **two disk writes per `/seeflow` run**, both silent
(no user-facing narration). Everything else is read-only or in-memory
staging. Writing outside these two points is the failure mode this file
exists to prevent — premature rows for flows that may never register,
or duplicate entries when a run aborts mid-flight.

- **Read** at the start of every `/seeflow` run (`phases/p0-preflight.md`).
- **Pass** the contents into both `seeflow-code-analyzer` and
  `seeflow-system-analyzer` launching prompts as `learnContext` so they
  can avoid re-discovering known facts.
- **Stage** each agent's `learnUpdates` in memory during Phase 1 →
  Phase 2 overlap as soon as that agent returns. The system-analyzer
  is the heavy contributor — every fact it learns about boot, setup,
  ports, env vars, fixtures, gotchas, and tech adaptations MUST land in
  the staged buffer. **Do not write to disk yet.**
- **Save #1 — Silent, Phase 3 step 7** (after `flows:layout`, before the
  canvas review). First disk hit. Merge the staged `learnUpdates` into
  the file AND upsert the "Flows already created" row by `slug` with
  today's date + a one-line purpose. The studio has already registered
  the flow by this point, so the row reflects a real entity.
- **Save #2 — Silent, at the final-flow announcement** (Phase 6
  `ok:true` exit, Phase 3 "Layout approved + static" exit, or the
  document-branch static exit). Re-upsert the same row (idempotent by
  slug) and append anything Phases 5–6 surfaced — a new gotcha, an
  emulator quirk, a working seed command, a tech-adaptation override.

The file always lives at `<host>/.seeflow/LEARN.md` — one shared
file per host repo, **never** inside a per-flow folder
(`<host>/.seeflow/<slug>/LEARN.md` is wrong; if you find one there
from an older run, move its contents into the shared file and delete
the stray copy). Create the `<host>/.seeflow/` directory if missing.
Never write outside that directory.

## File structure

A flat markdown file with the sections below. Omit a section when there
is genuinely nothing to write — never pad with `TBD`. New sections are
allowed at the bottom under a `## Notes` heading; do not invent new
top-level headings unless the existing ones don't fit.

```markdown
# SeeFlow project memory

> Auto-maintained by the `/seeflow` skill. Edit by hand only if you know
> what you are doing — the next run will merge new facts in.

_Last updated: <ISO-8601 date>_

## Runtime profile

- Primary language: <language>
- Package manager: <pm>
- Dev command: `<cmd>`
- Test command: `<cmd>`
- Default service port(s): <port(s)>
- Required env vars: `<VAR>=<example>` (only those needed to boot)
- External services the dev env depends on: <docker-compose services / cloud emulators / etc.>

## Local dev setup

How to bring the app up from a clean checkout. One short paragraph or a
numbered list. Include the canonical "is it up?" probe (health endpoint,
log line, etc.).

## Integration / e2e / blackbox tests

- Directory: `<path>`
- Run command: `<cmd>`
- Base URL the tests hit: `<http://...>`
- Test framework: <bun test / pytest / go test / playwright / ...>
- Setup pattern: <how tests start the app — TestMain, beforeAll, fixtures, etc.>
- Teardown pattern: <if any>

## Fixtures, mocks, and seed data

Where existing realistic payloads live, plus how the project usually
seeds data. Examples:

- Fixture dir: `tests/fixtures/`
- Factory module: `tests/factories/orders.ts`
- Seed command: `bun run seed`
- File-drop watchers: `<path>` (watches for *.json)
- Sample payloads to reuse for play scripts:
  - `POST /orders` body — `tests/fixtures/orders/create-min.json`
  - Webhook envelope — `tests/fixtures/webhooks/payment-succeeded.json`

## Data entry paths

For each major resource the system owns, what is the recommended way to
get data into it? (See `core-rules.md` Rule 2.)

| Resource | Preferred entry | Don't |
|---|---|---|
| orders DB | `POST /api/orders` (validates + emits event) | direct INSERT |
| uploads bucket | drop file in `./incoming/` (watcher picks it up) | curl PUT to S3 |
| shipments queue | `POST /api/notify` (producer) | direct enqueue |

## Known endpoints

Short list, only those a flow is likely to play. Don't dump the whole
OpenAPI surface.

| Method | Path | Body shape | Auth |
|---|---|---|---|
| POST | /api/orders | `{ cart: [...] }` | none in dev |
| POST | /webhooks/stripe | Stripe payment_intent.succeeded | signature header |

## Gotchas

Free-form bullets. Things that bit the skill last time:

- Port 3001 is hardcoded in `src/server.ts`; the env var override is
  ignored on macOS Sonoma.
- The `orders` factory truncates `sku` to 8 chars — longer skus 500.
- `bun test` fails on a cold `node_modules` — run `bun install` first.

## Tech stack

Flat bullet list of detected `techId`s. Stable identifiers from
`references/tech/README.md` — one per ref file.

- docker-compose
- google-pubsub
- gcs
- golang

## Tech stack adaptations

Per-`techId` project-specific overrides. **Always wins over the general
guidance in `references/tech/<techId>.md`**. Populate only what is
genuinely project-specific — empty subsections are noise.

### google-pubsub

- Helpers: `pkg/eventbus/publish.go::Publish(ctx, topic, msg)`,
  `pkg/eventbus/consume.go::Subscribe(ctx, sub, fn)`
- Local emulator: docker-compose service `pubsub-emulator` on `:8085`
- Conventions:
  - Every message carries attribute `tenant_id` (middleware-validated).
  - Topic naming: `<env>.<domain>.<event>` e.g. `dev.orders.created`.
- Fixtures: `tests/fixtures/pubsub/order-created.json`

### postgres

- Helpers: repository pattern in `internal/db/repo/*` — never INSERT directly.
- Migrations: `db/migrations/*.sql`, applied by `make db-migrate`.
- Fixtures: `tests/fixtures/db/*.sql` loaded by `tests/setup.ts`.

## Flows already created

| Slug | Purpose | Last updated |
|---|---|---|
| `checkout-flow` | end-to-end /checkout demo | 2026-04-12 |
| `order-pipeline` | event-driven order lifecycle | 2026-05-01 |
```

## Merging rules

When updating LEARN.md, follow these rules — they protect against
re-running drift:

1. **Replace** the `_Last updated:_` line with today's ISO date.
2. **Append** rows to the "Flows already created" table; never drop a
   row.
3. **Merge** bullet lists by union — keep prior bullets unless they are
   contradicted by a new discovery, in which case replace the bullet
   and note the date in parens (`port is 3001 (updated 2026-05-19)`).
   `## Tech stack` is a pure union of `techId`s — never drop one.
   `## Tech stack adaptations` is merged per-`techId`: union the bullet
   lists under each `techId`, replace a bullet only when contradicted
   (date the change in parens).
4. **Reuse** existing wording when re-stating the same fact; do not
   rewrite paragraphs purely for stylistic reasons.
5. **Cap** total file size at ~6KB. If it grows past that, push the
   oldest "Gotchas" bullets into a collapsed `<details>` block dated
   with the year they were captured.

## `learnUpdates` contract (Phase 1 agents → orchestrator)

Both `seeflow-code-analyzer` and `seeflow-system-analyzer` surface
structured updates the orchestrator merges into the file. The
system-analyzer owns the bulk of the payload (`runtimeProfile`,
`localDevSetup`, `integrationTests`, `fixtures`, `factories`,
`seedCommands`, `dataEntryPaths`, `gotchas`, `techAdaptations`); the
code-analyzer contributes `techStack` and the `knownEndpoints` array.
Combined shape:

```json
{
  "learnUpdates": {
    "runtimeProfile": {
      "primaryLanguage": "typescript",
      "packageManager": "bun",
      "devCommand": "bun run dev",
      "testCommand": "bun test",
      "servicePorts": [3001],
      "requiredEnv": ["DATABASE_URL", "STRIPE_API_KEY"]
    },
    "localDevSetup": "Run `docker compose up -d db` then `bun run dev`; server is up when `GET /health` returns 200.",
    "integrationTests": {
      "dir": "tests/integration",
      "command": "bun test tests/integration",
      "baseUrl": "http://localhost:3001",
      "framework": "bun:test",
      "setupPattern": "Start() in beforeAll spins the server in-process; fetch() against http://localhost:3001."
    },
    "fixtures": [
      { "path": "tests/fixtures/orders/create-min.json", "describes": "POST /orders body" }
    ],
    "factories": [
      { "module": "tests/factories/orders.ts", "exports": ["makeOrder", "makeCart"] }
    ],
    "seedCommands": ["bun run seed"],
    "dataEntryPaths": [
      { "resource": "orders DB", "preferred": "POST /api/orders", "avoid": "direct INSERT" }
    ],
    "knownEndpoints": [
      { "method": "POST", "path": "/api/orders", "bodyShape": "{ cart: [...] }", "auth": "none in dev" }
    ],
    "gotchas": [
      "Port 3001 hardcoded in src/server.ts; env override ignored on macOS Sonoma."
    ],
    "techStack": ["docker-compose", "google-pubsub", "gcs", "golang"],
    "techAdaptations": {
      "google-pubsub": {
        "helpers": [
          "pkg/eventbus/publish.go::Publish(ctx, topic, msg)",
          "pkg/eventbus/consume.go::Subscribe(ctx, sub, fn)"
        ],
        "emulator": "docker-compose service `pubsub-emulator` on :8085",
        "conventions": [
          "every message carries attribute `tenant_id` (middleware-validated)",
          "topic naming: <env>.<domain>.<event> e.g. dev.orders.created"
        ],
        "fixtures": ["tests/fixtures/pubsub/order-created.json"]
      }
    }
  }
}
```

Every field is optional — emit only what you learned. The orchestrator
applies the merging rules above.

### `techStack` and `techAdaptations` contract

- **`techStack`** *(string[])* — stable `techId`s from
  `references/tech/README.md`. One entry per detected tech. No
  `evidence` field — the matching signal is implicit in the ref.
- **`techAdaptations`** *(object, keyed by `techId`)* — project-specific
  overrides the orchestrator forwards to play/status/node-planner so
  they prefer project conventions over the ref's general templates.
  Every child field is optional; emit only what you actually found:
  - `helpers` *(string[])* — file paths or symbol references to
    existing publisher/consumer/uploader/repository helpers the play
    or status script should reuse.
  - `emulator` *(string)* — one-line how-to: which compose service or
    env var wires up local mode for this tech.
  - `conventions` *(string[])* — naming patterns, required attributes,
    validation rules that scripts must comply with.
  - `fixtures` *(string[])* — paths to realistic payloads the scripts
    should copy from instead of inventing.
  - `gotchas` *(string[])* — tech-specific quirks discovered this run.
  Omit a `techId` entirely if no adaptation was found — empty entries
  are noise. **Save #2 updates this section** whenever a play or status
  script (in Phase 5 or 6) discovers a new project-specific fact about
  a detected tech.
