---
techId: mysql
category: storage
---

# MySQL

> **General guidance only.** Check `<project>/.seeflow/WIKI.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- One `stateNode` per database, not per table.
- Duplicate the DB node next to each consumer for readability
  (same `kind` + `name`, unique `id`).

## Play (trigger locally)

- **Prefer repository helpers over raw INSERT.** If
  `techAdaptations.mysql.helpers` lists `repo.InsertOrder(...)`, use it.
- Fall back to a parameterised INSERT only when no helper exists.
- Honour the project DSN env (`MYSQL_DSN` / `DATABASE_URL`).

```go
package main

import (
	"database/sql"; "fmt"; "os"; "time"
	_ "github.com/go-sql-driver/mysql"
)

func main() {
	db, _ := sql.Open("mysql", os.Getenv("MYSQL_DSN"))
	defer db.Close()
	id := fmt.Sprintf("o_%d", time.Now().UnixNano())
	_, err := db.Exec(
		`INSERT INTO orders (id, total, created_at) VALUES (?, ?, NOW())`,
		id, 4200)
	if err != nil { panic(err) }
	println("inserted", id)
}
```

## Status (read locally)

- `SELECT count(*)` and a tight `LIMIT` window — never unbounded.
- Emit `StatusReport` JSON per tick.
- Tolerate missing table as `state: "warn"`.

```go
package main

import (
	"database/sql"; "encoding/json"; "fmt"; "os"; "time"
	_ "github.com/go-sql-driver/mysql"
)

func main() {
	db, _ := sql.Open("mysql", os.Getenv("MYSQL_DSN"))
	for {
		var n int
		err := db.QueryRow(`SELECT count(*) FROM orders`).Scan(&n)
		state := "ok"; if err != nil { state = "warn" }
		b, _ := json.Marshal(map[string]any{"state":state,"summary":fmt.Sprintf("%d orders",n),"data":map[string]int{"count":n},"ts":time.Now().Unix()})
		println(string(b))
		time.Sleep(2 * time.Second)
	}
}
```

## Gotchas

- DSN must include `parseTime=true` or `time.Time` columns scan as
  `[]byte` — silently wrong, not an error.
- Default charset is `utf8` (3-byte) on older servers; use `utf8mb4` to
  store emoji and 4-byte chars.
- `LOCAL` keyword in `LOAD DATA` is disabled by default — emulator
  images may differ from prod.

## Fixture shape

```json
{ "id": "o_1716200000000", "total": 4200, "created_at": "2026-05-20 12:00:00" }
```
