---
techId: gcs
category: storage
---

# Google Cloud Storage

> **Check first.** Project conventions always win over the templates below.
> The snippets here are generic CLI fallbacks — reuse project wrappers,
> `Makefile` targets, `scripts/` helpers, and `bin/` CLIs first.
>
> 1. `<host>/.seeflow/LEARN.md` `## Tech stack adaptations` — recorded
>    helpers, fixtures, emulator wiring, conventions.
> 2. `Grep`/`Glob` the repo for wrappers when LEARN.md is silent —
>    uploader/repository symbols, test-harness helpers, `Makefile`/
>    `scripts/` boot targets, compose service names.
>
> Sub-agents port the bash recipes below into the project's primary
> language only when no CLI / wrapper covers the action.
>
> Append anything new you learn this run back into LEARN.md so the next
> flow reuses it.

## What it is

Object store for blobs keyed by bucket + name. In a typical flow it holds
uploads, exports, or report artefacts that other services produce and
consume asynchronously.

## How to run it

Locally GCS is faked by `fake-gcs-server` (see its own ref).

- Project script first: `make gcs-up` / `bun run gcs:up` / compose
  service named `fake-gcs-server` or `gcs`. Grep before inventing one.
- If compose already declares it: `docker compose up -d fake-gcs-server`.
- Fall back to the canonical recipe.

```bash
docker run -d --name fake-gcs -p 4443:4443 \
  fsouza/fake-gcs-server -scheme http -public-host localhost:4443
export STORAGE_EMULATOR_HOST=http://localhost:4443
echo "gcs ready on :4443"
```

## How to insert data

- Reuse any project uploader/helper or `bin/` CLI before raw curl.
- Honour the emulator endpoint in *this* shell (`STORAGE_EMULATOR_HOST`).
- Pull payload shape from a real fixture if one ships.

```bash
# Option A — gsutil against the emulator
gsutil -o "Credentials:gs_json_host=localhost" \
       -o "Credentials:gs_json_port=4443" \
  cp ./fixture.json gs://orders/$(date -u +%Y%m%dT%H%M%S).json

# Option B — raw JSON API (no gcloud required)
curl -fsS -X POST \
  "http://localhost:4443/upload/storage/v1/b/orders/o?uploadType=media&name=hello.json" \
  -H "Content-Type: application/json" --data-binary @./fixture.json

# Option C — exec into the project's compose container
docker compose exec app /app/bin/upload-order ./fixture.json
```

## How to verify run success

Cheapest one-shot confirmation that the object landed.

```bash
gsutil -o "Credentials:gs_json_host=localhost" -o "Credentials:gs_json_port=4443" \
  ls gs://orders/hello.json >/dev/null && echo ok
# or, no gsutil:
curl -fsS "http://localhost:4443/storage/v1/b/orders/o/hello.json" -o /dev/null && echo ok
```

## How to verify query data

Status loop — list with a tight prefix, emit `StatusReport` JSON each tick.

- Reuse project read helpers when present.
- Tolerate empty buckets → `state:"warn"`, never throw.
- Emit `state`, `summary`, `data`, `ts`.

```bash
while true; do
  curl -fsS "http://localhost:4443/storage/v1/b/orders/o?prefix=" \
    | jq -c '{state:"ok",
              summary:"\(.items|length) objects",
              data:[.items[].name],
              ts:(now|floor)}' \
    || echo '{"state":"warn","summary":"no bucket","data":[],"ts":'$(date +%s)'}'
  sleep 2
done
```

## Node modelling

- One node (`type:'cloud'`) per bucket, not per object or prefix. The
  cloud glyph conveys "external object store"; capability chrome
  renders in the skirt. (Use `type:'database'` instead if the project
  treats GCS as its primary persistence layer rather than as a remote
  bucket.)
- Duplicate the bucket node next to each consumer for readability (same
  `type` + `data.name`, unique `id`).

## Gotchas

- `STORAGE_EMULATOR_HOST` silently swaps real GCS for fake-gcs-server —
  set it in the Play *and* Status env, or one side hits prod.
- fake-gcs-server doesn't enforce IAM; code that "works locally" can
  401 against real GCS.
- Bucket names are global; emulator allows duplicates, real GCS doesn't.

## Fixture shape

```json
{ "bucket": "orders", "name": "20260520T120000.json", "contentType": "application/json", "size": 24, "generation": 1716200000000001 }
```
