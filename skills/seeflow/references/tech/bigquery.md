---
techId: bigquery
category: storage
---

# Google BigQuery

> **General guidance only.** Check `<projectPath>/LEARN.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- One `stateNode` per dataset. Table is too fine; project is too coarse.
- Duplicate the dataset node next to each consumer (same `kind` +
  `name`, unique `id`) when readability benefits.

## Play (trigger locally)

- Reuse a project loader / ingest helper over a raw client.
- Honour `GOOGLE_APPLICATION_CREDENTIALS` and project id env.
- `insert_rows_json` is the canonical streaming write; batch loads use
  `load_table_from_*` instead — pick streaming for demos.

```python
import json, os, time, uuid
from google.cloud import bigquery

client = bigquery.Client(project=os.environ["GCP_PROJECT"])
table = f"{client.project}.shop.orders"
row = {
    "id": f"o_{uuid.uuid4().hex[:8]}",
    "total": 4200,
    "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}
errors = client.insert_rows_json(table, [row])
if errors:
    raise SystemExit(json.dumps(errors))
print(json.dumps({"inserted": row["id"]}))
```

## Status (read locally)

- `SELECT count(*) ... WHERE created_at > TIMESTAMP_SUB(...)` — never
  unbounded scans (cost!).
- Emit `StatusReport` per tick on a slow cadence (5–10s) — BigQuery
  query latency is not Redis.
- Tolerate missing table → `state: "warn"`.

```python
import json, os, time
from google.cloud import bigquery

client = bigquery.Client(project=os.environ["GCP_PROJECT"])
sql = """
SELECT count(*) AS n
FROM `shop.orders`
WHERE created_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
"""
while True:
    try:
        n = next(iter(client.query(sql).result())).n
        state = "ok"
    except Exception:
        n, state = 0, "warn"
    print(json.dumps({"state": state, "summary": f"{n} orders/1h",
                      "data": {"count": n}, "ts": int(time.time())}))
    time.sleep(5)
```

## Gotchas

- Streaming inserts have an availability lag (seconds to ~1 min) —
  status queries right after a play insert may show 0 rows. Re-tick.
- Streaming-inserted rows can't be `UPDATE`/`DELETE`d for ~30 min.
- Each `SELECT` is billed by bytes scanned; without a partition filter
  on a real dataset a status loop can be expensive — always bound by
  partition column.

## Fixture shape

```json
{ "id": "o_a1b2c3d4", "total": 4200, "created_at": "2026-05-20T12:00:00Z" }
```
