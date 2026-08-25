---
techId: spanner
category: storage
---

# Google Cloud Spanner

> **Check first.** Project conventions always win over the templates below.
>
> 1. `<host>/.seeflow/LEARN.md` `## Tech stack adaptations` — recorded
>    helpers, fixtures, emulator wiring, conventions.
> 2. `Grep`/`Glob` the repo for wrappers when LEARN.md is silent —
>    repository/dao/migration symbols, test-harness helpers,
>    `Makefile`/`scripts/` boot targets, compose service names (e.g.
>    `spanner-emulator`).
>
> Append anything new you learn this run back into LEARN.md so the next
> flow reuses it.

## What it is

GCP's globally-distributed, strongly-consistent relational DB. Local
apps talk to the Spanner emulator over gRPC (`:9010`) with a REST
shim (`:9020`) that `gcloud spanner` drives.

## How to run it

How a developer brings the emulator up locally.

- Project compose first: `docker compose up -d spanner-emulator` (or
  the service name the repo defines). Grep `docker-compose*.yml` /
  `Makefile` before inventing one.
- Fall back to the canonical local recipe below.

```bash
docker run -d -p 9010:9010 -p 9020:9020 \
  gcr.io/cloud-spanner-emulator/emulator:1.5
echo "spanner emulator ready on :9010 (grpc) / :9020 (rest)"
```

One-time `gcloud` wiring so both the CLI and any SDK callers in the
host project hit the emulator:

```bash
gcloud config configurations create emulator \
  || gcloud config configurations activate emulator
gcloud config set auth/disable_credentials true
gcloud config set api_endpoint_overrides/spanner http://localhost:9020/
gcloud config set project demo-project
export SPANNER_EMULATOR_HOST=localhost:9010
```

Bootstrap instance + DB + schema:

```bash
gcloud spanner instances create test-instance \
  --config=emulator-config --nodes=1 --description=test
gcloud spanner databases create test-db --instance=test-instance \
  --ddl='CREATE TABLE Orders (Id STRING(36) NOT NULL, Total INT64, CreatedAt TIMESTAMP) PRIMARY KEY (Id)'
```

## Node modelling

Direct guidance for `seeflow-node-planner`. Two bullets max:

- One node per database (`type:'database'`), not per table or per
  repository. The cylinder glyph IS the database; no `data.icon`
  needed.
- Duplicate the node next to each consumer when it improves
  readability (same `type` + `data.name`, unique `id`).

## Gotchas

- Emulator is a *subset* (no backups, IAM, multi-instance). Code that
  passes locally can 4xx against real Spanner.
- State is in-memory; `docker restart` wipes every instance, DB, and
  row — re-run the bootstrap block after a restart.
- `SPANNER_EMULATOR_HOST` is read by SDKs but ignored by `gcloud
  spanner` unless `api_endpoint_overrides/spanner` points at `:9020`.
  Set both or one of them will silently hit prod.
- DDL is async — `databases create`/`ddl update` return immediately
  but the schema isn't visible until the operation completes; inserts
  fired straight after can race.

## Fixture shape

```json
{ "table": "Orders", "row": { "Id": "o_1", "Total": 4200, "CreatedAt": "2026-05-20T12:00:00Z" } }
```
