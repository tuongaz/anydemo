---
techId: testcontainers
category: local-infra
---

# Testcontainers

> **General guidance only.** Check the shared `<host>/.seeflow/LEARN.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- Testcontainers is the **launcher, not a node**. The started container
  (postgres, redis, kafka) IS the `stateNode` — use the matching `kind`.
- Prefer reuse mode (`Reuse: true` / `with_reuse=True`) so the SeeFlow play and
  status scripts hit the same long-lived container across ticks.
- One node per container; do **not** model the testcontainers wrapper itself.

## Play (trigger locally)

- Start (or attach to) the container, expose its mapped host:port, then do the
  one real action (insert row, publish message).
- Reuse mode requires `TESTCONTAINERS_REUSE_ENABLE=true` in the environment.
- Print the host:port on stdout so downstream scripts can read it.

```go
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	_ "github.com/jackc/pgx/v5/stdlib"
	tc "github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

func main() {
	ctx := context.Background()
	pg, err := postgres.Run(ctx, "postgres:16",
		postgres.WithDatabase("demo"), postgres.WithUsername("u"),
		postgres.WithPassword("p"), tc.WithReuseByName("seeflow-pg"))
	if err != nil { panic(err) }
	dsn, _ := pg.ConnectionString(ctx, "sslmode=disable")
	db, _ := sql.Open("pgx", dsn)
	_, _ = db.Exec(`CREATE TABLE IF NOT EXISTS events(id serial, body text)`)
	_, err = db.Exec(`INSERT INTO events(body) VALUES($1)`, "hello")
	if err != nil { panic(err) }
	_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"dsn": dsn})
}
```

## Status (read locally)

- Re-attach to the reused container, run the smallest read (`SELECT count(*)`,
  `LLEN`, queue depth) and report.
- If the container is gone, emit `state: "warn"` and exit-loop — do not try to
  recreate it from a status script.

```go
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"time"
	_ "github.com/jackc/pgx/v5/stdlib"
	tc "github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

func main() {
	ctx := context.Background()
	pg, _ := postgres.Run(ctx, "postgres:16", tc.WithReuseByName("seeflow-pg"))
	dsn, _ := pg.ConnectionString(ctx, "sslmode=disable")
	db, _ := sql.Open("pgx", dsn)
	enc := json.NewEncoder(os.Stdout)
	for {
		var n int
		st := "ok"
		if err := db.QueryRow(`SELECT count(*) FROM events`).Scan(&n); err != nil { st = "warn" }
		_ = enc.Encode(map[string]any{"state": st, "summary": fmt.Sprintf("%d rows", n),
			"data": map[string]int{"rows": n}, "ts": time.Now().UTC().Format(time.RFC3339)})
		time.Sleep(2 * time.Second)
	}
}
```

## Gotchas

- Reuse requires `~/.testcontainers.properties` containing
  `testcontainers.reuse.enable=true` **and** an identical container hash —
  changing any option (env, port, mount) makes a fresh container.
- Ryuk (the reaper) kills containers ~10s after the JVM/Go process exits
  unless reuse is on or `TESTCONTAINERS_RYUK_DISABLED=true`.
- On Colima / podman / Rancher, set `DOCKER_HOST` and
  `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`.
- The mapped host port changes every fresh start — always read it from the
  container, never hardcode.

## Fixture shape

```json
{ "container": "seeflow-pg", "image": "postgres:16", "host": "127.0.0.1", "port": 54321 }
```
