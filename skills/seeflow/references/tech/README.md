# Tech-specific best practices

Per-tech reference cards covering **how to use this tech locally from Play
and Status node scripts**. Refs are general guidance only — the project's
own helpers, fixtures, and conventions (captured in
`<project>/.seeflow/LEARN.md` under `## Tech stack adaptations`) always win.

## How the catalog is used

1. **Discoverer** (Phase 1) reads this README, runs the signals in the
   table below against the repo, and emits matching `techId`s in
   `learnUpdates.techStack`. For each detected `techId`, it also searches
   the repo for project-specific helpers / wrappers / fixtures /
   conventions and emits them under `learnUpdates.techAdaptations.<techId>`.
2. **Orchestrator** maps each `techId` to `references/tech/<techId>.md`
   and forwards the file paths (plus the matching `techAdaptations`
   entries from LEARN.md) into the launch prompts of:
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
`localstack`, `docker-compose`). One per ref file.

## Signal → ref lookup

Run each signal against the repo (`Glob`/`Grep`/`Read`). When a signal
hits, emit the corresponding `techId` in `learnUpdates.techStack`.

### Local infra & emulators

| Signal in repo                                              | techId                | Ref                          |
|-------------------------------------------------------------|-----------------------|------------------------------|
| `docker-compose.yml` / `compose.yaml` / `docker-compose.*.yml` | `docker-compose`      | `tech/docker-compose.md`     |
| Service `localstack/localstack` in compose                  | `localstack`          | `tech/localstack.md`         |
| `testcontainers-go` / `@testcontainers/*` / `testcontainers` (py) imports | `testcontainers`      | `tech/testcontainers.md`     |
| `PUBSUB_EMULATOR_HOST` env var or `gcr.io/google.com/cloudsdktool/cloud-sdk` compose service | `pubsub-emulator`     | `tech/pubsub-emulator.md`    |
| `FIRESTORE_EMULATOR_HOST` env var or emulator compose service | `firestore-emulator`  | `tech/firestore-emulator.md` |
| `fsouza/fake-gcs-server` compose image                      | `fake-gcs-server`     | `tech/fake-gcs-server.md`    |
| `minio/minio` compose image                                 | `minio`               | `tech/minio.md`              |

### Cloud storage & DBs

| Signal in repo                                              | techId                | Ref                          |
|-------------------------------------------------------------|-----------------------|------------------------------|
| `cloud.google.com/go/storage` / `@google-cloud/storage` / `google-cloud-storage` (py) | `gcs`                 | `tech/gcs.md`                |
| `aws-sdk-go-v2/service/s3` / `@aws-sdk/client-s3` / `boto3` `s3` client | `s3`                  | `tech/s3.md`                 |
| `lib/pq` / `pgx` / `pg` / `psycopg` / `postgres` compose image | `postgres`            | `tech/postgres.md`           |
| `go-sql-driver/mysql` / `mysql2` / `mysqlclient` / `mysql` compose image | `mysql`               | `tech/mysql.md`              |
| `go.mongodb.org/mongo-driver` / `mongodb` / `pymongo` / `mongo` compose image | `mongodb`             | `tech/mongodb.md`            |
| `aws-sdk-go-v2/service/dynamodb` / `@aws-sdk/client-dynamodb` / `boto3` `dynamodb` | `dynamodb`            | `tech/dynamodb.md`           |
| `go-redis/redis` / `ioredis` / `redis-py` / `redis` compose image | `redis`               | `tech/redis.md`              |
| `olivere/elastic` / `@elastic/elasticsearch` / `elasticsearch-py` / `opensearch` | `elasticsearch`       | `tech/elasticsearch.md`      |
| `cloud.google.com/go/bigquery` / `@google-cloud/bigquery` / `google-cloud-bigquery` | `bigquery`            | `tech/bigquery.md`           |

### Messaging & streaming

| Signal in repo                                              | techId                | Ref                          |
|-------------------------------------------------------------|-----------------------|------------------------------|
| `cloud.google.com/go/pubsub` / `@google-cloud/pubsub` / `google-cloud-pubsub` | `google-pubsub`       | `tech/google-pubsub.md`      |
| `aws-sdk-go-v2/service/sqs` / `@aws-sdk/client-sqs` / `boto3` `sqs` | `aws-sqs`             | `tech/aws-sqs.md`            |
| `aws-sdk-go-v2/service/sns` / `@aws-sdk/client-sns` / `boto3` `sns` | `aws-sns`             | `tech/aws-sns.md`            |
| `segmentio/kafka-go` / `confluent-kafka` / `kafkajs` / `kafka` compose image | `kafka`               | `tech/kafka.md`              |
| `amqp091-go` / `amqplib` / `pika` / `rabbitmq` compose image | `rabbitmq`            | `tech/rabbitmq.md`           |
| `nats-io/nats.go` / `nats` (npm/py) / `nats` compose image  | `nats`                | `tech/nats.md`               |
| `XADD` / `XREAD` calls or `redis.streams` usage             | `redis-streams`       | `tech/redis-streams.md`      |

### Languages & runtimes

| Signal in repo                                              | techId                | Ref                          |
|-------------------------------------------------------------|-----------------------|------------------------------|
| `go.mod`                                                    | `golang`              | `tech/golang.md`             |
| `pyproject.toml` / `requirements.txt` / `setup.py`          | `python`              | `tech/python.md`             |
| `package.json` (also covers Bun and Node)                   | `typescript`          | `tech/typescript.md`         |
| `pom.xml` / `build.gradle(.kts)` / `*.java` / `*.kt`        | `java`                | `tech/java.md`               |
| `Cargo.toml`                                                | `rust`                | `tech/rust.md`               |
| `Gemfile` / `*.rb`                                          | `ruby`                | `tech/ruby.md`               |

## Detection rules

- **Cheap before deep.** Prefer `Glob` for filenames, then `Grep -l` for
  import strings. Do not `Read` whole files just to confirm a tech.
- **Both signals can fire** for the same ref. If `docker-compose.yml`
  contains both `localstack` and `postgres`, emit both `localstack` and
  `postgres` — they are independent.
- **No evidence field needed.** `techStack` is a flat string array; the
  signal that matched is implicit in the ref.
- **Empty is fine.** If nothing matches, emit `techStack: []`. The
  orchestrator skips forwarding tech refs that run.

## Ref file shape

Every per-tech ref follows `_template.md` exactly:

1. Frontmatter (`techId`, `category`).
2. "General guidance only" banner pointing to LEARN.md adaptations.
3. **Node modelling** — guidance for `seeflow-node-planner`.
4. **Play (trigger locally)** — guidance + 1 short template for
   `seeflow-play-designer`.
5. **Status (read locally)** — guidance + 1 short template for
   `seeflow-status-designer`.
6. **Gotchas** — bullet list.
7. **Fixture shape** — one short JSON / struct example.

Keep refs ≤ 250 words. One excellent example per ref, in the language
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
