---
techId: postgres
category: storage
---

# PostgreSQL

> **General guidance only.** Check `<project>/.seeflow/WIKI.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- One `stateNode` per database, not per table — table-level nodes
  fragment the canvas and hide the bigger picture.
- Duplicate the DB node next to each consumer (same `kind` + `name`,
  unique `id`) when it improves readability.

## Play (trigger locally)

- **Prefer repository helpers over raw INSERT.** If
  `techAdaptations.postgres.helpers` lists a `repo.InsertOrder(...)`,
  use it — that's the "see the bigger picture" rule.
- Fall back to a parameterised INSERT only when no helper exists.
- Honour `DATABASE_URL` / project DSN env over a hardcoded string.

```go
package main

import (
	"context"; "fmt"; "os"; "time"
	"github.com/jackc/pgx/v5"
)

func main() {
	conn, _ := pgx.Connect(context.Background(), os.Getenv("DATABASE_URL"))
	defer conn.Close(context.Background())
	id := fmt.Sprintf("o_%d", time.Now().UnixNano())
	_, err := conn.Exec(context.Background(),
		`INSERT INTO orders (id, total, created_at) VALUES ($1, $2, now())`,
		id, 4200)
	if err != nil { panic(err) }
	println("inserted", id)
}
```

## Status (read locally)

- `SELECT count(*)` plus a tiny window of recent rows — never `SELECT *`.
- Bound the read with a timestamp or `LIMIT`.
- Emit `StatusReport` JSON each tick; tolerate "relation does not exist"
  as `state: "warn"`.

```go
package main

import (
	"context"; "encoding/json"; "fmt"; "os"; "time"
	"github.com/jackc/pgx/v5"
)

func main() {
	conn, _ := pgx.Connect(context.Background(), os.Getenv("DATABASE_URL"))
	for {
		var n int
		err := conn.QueryRow(context.Background(), `SELECT count(*) FROM orders`).Scan(&n)
		state := "ok"; if err != nil { state = "warn" }
		b, _ := json.Marshal(map[string]any{"state":state,"summary":fmt.Sprintf("%d orders", n),"data":map[string]int{"count":n},"ts":time.Now().Unix()})
		println(string(b))
		time.Sleep(2 * time.Second)
	}
}
```

## Gotchas

- `pgx` connection pool vs single conn — `Connect` opens one; long-lived
  status loops want `pgxpool.New`.
- Default `search_path = public`; project may use a non-default schema.
- `now()` is transaction-time, not statement-time — surprising in batched
  inserts.

## Fixture shape

```json
{ "id": "o_1716200000000", "total": 4200, "created_at": "2026-05-20T12:00:00Z" }
```
