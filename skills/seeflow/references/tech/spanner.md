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
demos talk to the Spanner emulator over gRPC (`:9010`) with a REST
shim (`:9020`) that `gcloud spanner` drives.

## How to run it

Start the emulator so the Play and Status scripts have something to
talk to.

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

## How to insert data

Canonical way to make Spanner _do real work_ from a Play script.

- Project helper first: grep for repository / dao / migration / seed
  symbols and reuse them — they already honour the project's emulator
  env vars and DSN shape.
- Pull payload shape from real fixtures when present.
- Fall back to the `gcloud` template below.

```bash
gcloud spanner databases execute-sql test-db --instance=test-instance \
  --sql="INSERT INTO Orders (Id, Total, CreatedAt) VALUES ('o_1', 4200, PENDING_COMMIT_TIMESTAMP())"
```

## How to verify run success

`execute-sql` exits 0 on commit. Tighter check — confirm the row is
readable:

```bash
gcloud spanner databases execute-sql test-db --instance=test-instance \
  --sql="SELECT 1 FROM Orders WHERE Id='o_1'" >/dev/null && echo ok
```

## How to verify query data

Pull state back out — for the Status script and ad-hoc checks. Read
the smallest signal (one count), tolerate missing table as
`state:"warn"`, emit `StatusReport` JSON each tick.

```bash
while true; do
  gcloud spanner databases execute-sql test-db --instance=test-instance \
    --sql='SELECT COUNT(*) AS n FROM Orders' --format=json 2>/dev/null \
    | jq -c --arg ts "$(date +%s)" '
        (.rows[0][0] // "0" | tonumber) as $n
        | {state:"ok", summary:"\($n) orders", data:{count:$n}, ts:($ts|tonumber)}
      ' \
    || jq -nc --arg ts "$(date +%s)" '{state:"warn",summary:"Orders not ready",data:{},ts:($ts|tonumber)}'
  sleep 2
done
```

## Node modelling

Direct guidance for `seeflow-node-planner`. Two bullets max:

- One node per database (`type:'rectangle'`, `data.icon:'database'`),
  not per table or per repository.
- Duplicate the node next to each consumer when it improves
  readability (same `type` + `data.icon` + `data.name`, unique `id`).

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
