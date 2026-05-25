# Tech-specific best practices

Per-tech reference cards covering **how to use this tech locally from Play
and Status node scripts**. Refs are general guidance only — the project's
own helpers, fixtures, and conventions (captured in the shared
`<host>/.seeflow/LEARN.md` under `## Tech stack adaptations`) always win.

## How the catalog is used

1. **Discoverer** (Phase 1) reads this README, runs the signals in the
   table below against the repo, and emits matching `techId`s in
   `learnUpdates.techStack`. For each detected `techId`, it also searches
   the repo for project-specific helpers / wrappers / fixtures /
   conventions and emits them under `learnUpdates.techAdaptations.<techId>`.
2. **Orchestrator** maps each `techId` to `references/tech/<techId>.md`
   and forwards the file paths (plus the matching `techAdaptations`
   entries from the shared `<host>/.seeflow/LEARN.md`) into the launch
   prompts of:
   - `seeflow-node-planner` (Phase 2) — for node modelling guidance.
   - `seeflow-play-designer` (Phase 4) — for the canonical local trigger
     recipe.
   - `seeflow-status-designer` (Phase 4) — for the canonical local
     state-read recipe.
3. **Sub-agents** read only the forwarded refs (typically 3–5 per flow),
   then reconcile against the `techAdaptations` block. **Project
   conventions override the ref's templates.**
4. **Phase 6 polish** writes any new project-specific learnings back into
   `techAdaptations` so the next `/seeflow` run reuses them.

Stable `techId` = the ref's filename stem (e.g. `google-pubsub`,
`kafka`, `temporal`). One per ref file. The catalog is intentionally
narrow — only the techs below have refs today; everything else falls
back to whatever `<host>/.seeflow/LEARN.md` records about it.

## Signal → ref lookup

Run each signal against the repo (`Glob`/`Grep`/`Read`). When a signal
hits, emit the corresponding `techId` in `learnUpdates.techStack`. If a
detected tech has no row here, omit it from `techStack` — there is no
ref to forward.

### Cloud storage & DBs

| Signal in repo                                              | techId                | Ref                          |
|-------------------------------------------------------------|-----------------------|------------------------------|
| `cloud.google.com/go/storage` / `@google-cloud/storage` / `google-cloud-storage` (py) | `gcs`                 | `tech/gcs.md`                |
| `cloud.google.com/go/spanner` / `@google-cloud/spanner` / `google-cloud-spanner` (py) / `gcr.io/cloud-spanner-emulator/emulator` compose image | `spanner`             | `tech/spanner.md`            |

### Messaging & streaming

| Signal in repo                                              | techId                | Ref                          |
|-------------------------------------------------------------|-----------------------|------------------------------|
| `cloud.google.com/go/pubsub` / `@google-cloud/pubsub` / `google-cloud-pubsub` | `google-pubsub`       | `tech/google-pubsub.md`      |
| `segmentio/kafka-go` / `confluent-kafka` / `kafkajs` / `kafka` compose image | `kafka`               | `tech/kafka.md`              |

### Workflow engines

| Signal in repo                                              | techId                | Ref                          |
|-------------------------------------------------------------|-----------------------|------------------------------|
| `go.temporal.io/sdk` / `@temporalio/*` / `temporalio` (py) / `temporalio/temporal` or `temporalio/auto-setup` compose image | `temporal`            | `tech/temporal.md`           |

## Detection rules

- **Cheap before deep.** Prefer `Glob` for filenames, then `Grep -l` for
  import strings. Do not `Read` whole files just to confirm a tech.
- **Both signals can fire** for the same ref. If a compose file ships
  both Kafka and Pub/Sub, emit both `kafka` and `google-pubsub` — they
  are independent.
- **Unknown techs are silent.** If the repo uses something not in the
  table (Postgres, Redis, S3, etc.), don't invent a `techId` — just
  surface it in `learnUpdates.gotchas` or `techAdaptations` notes so the
  sub-agents still have project context to work with.
- **No evidence field needed.** `techStack` is a flat string array; the
  signal that matched is implicit in the ref.
- **Empty is fine.** If nothing matches, emit `techStack: []`. The
  orchestrator skips forwarding tech refs that run.

## Ref file shape

Every per-tech ref follows `_template.md` exactly:

1. Frontmatter (`techId`, `category`).
2. **Check first** banner — two pointers: `<host>/.seeflow/LEARN.md`
   `## Tech stack adaptations` *and* `Grep`/`Glob` the repo for existing
   wrappers. Both override the templates below.
3. **What it is** — one-to-two-sentence identity + role.
4. **How to run it** — start the local emulator / compose service / dev
   CLI. Project script first, then ≤ 5-line bash fallback.
5. **How to insert data** — Play-trigger guidance for
   `seeflow-play-designer`. Project helper first, then ≤ 15-line SDK/CLI
   example.
6. **How to verify run success** — cheapest one-shot confirmation that
   the insert landed (publish ack, write receipt, workflow start id).
   ≤ 5-line bash, exit 0 on success.
7. **How to verify query data** — Status-read guidance for
   `seeflow-status-designer`. Project helper first, then ≤ 15-line read
   loop emitting `StatusReport` JSON.
8. **Node modelling** — guidance for `seeflow-node-planner`.
9. **Gotchas** — bullet list.
10. **Fixture shape** — one short JSON / struct example.

Keep refs ≤ 300 words. One excellent example per ref, in the language
most natural for that tech — the sub-agent will port to the project's
`runtimeProfile.primaryLanguage`.

## Adding a new ref

1. Pick a `techId` (kebab-case, matches an obvious detection signal).
2. Copy `_template.md` to `references/tech/<techId>.md` and fill it in.
3. Add a row to the matching category table above with the signal that
   detects the tech.
4. No other wiring needed — the Phase 1 agents (`seeflow-code-analyzer`
   for detection, `seeflow-system-analyzer` for project-specific
   adaptations) and the orchestrator pick it up from the table
   automatically.
