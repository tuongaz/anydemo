---
techId: redis
category: storage
---

# Redis

> **General guidance only.** Check the shared `<host>/.seeflow/LEARN.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- One node (`type:'rectangle'`) per Redis instance. Only split per DB index
  (0, 1, ...) if the project uses indexes as logical namespaces.
- Duplicate the node next to each consumer for readability
  (same `type` + `data.icon` + `data.name`, unique `id`).
- For Streams usage, use the separate `redis-streams` ref instead.

## Play (trigger locally)

- Reuse a project cache/store helper over a raw `redis.Client`.
- Honour `REDIS_URL` / `REDIS_ADDR`.
- Use the project's key prefix convention if `techAdaptations.redis`
  documents one — never invent `app:foo`.

```go
package main

import (
	"context"; "fmt"; "os"; "time"
	"github.com/redis/go-redis/v9"
)

func main() {
	ctx := context.Background()
	opt, _ := redis.ParseURL(os.Getenv("REDIS_URL"))
	c := redis.NewClient(opt)
	defer c.Close()
	key := fmt.Sprintf("order:%d", time.Now().UnixNano())
	if err := c.Set(ctx, key, `{"total":4200}`, 10*time.Minute).Err(); err != nil { panic(err) }
	println("set", key)
}
```

## Status (read locally)

- Use `SCAN` with `MATCH` + `COUNT`, never `KEYS` — `KEYS` blocks the
  whole server.
- `GET` one sample key to prove the value shape.
- Emit `StatusReport` per tick.

```go
package main

import (
	"context"; "encoding/json"; "fmt"; "os"; "time"
	"github.com/redis/go-redis/v9"
)

func main() {
	ctx := context.Background()
	opt, _ := redis.ParseURL(os.Getenv("REDIS_URL"))
	c := redis.NewClient(opt)
	for {
		var cursor uint64; keys := []string{}
		for { var batch []string; batch, cursor, _ = c.Scan(ctx, cursor, "order:*", 50).Result(); keys = append(keys, batch...); if cursor == 0 { break } }
		sample := ""; if len(keys) > 0 { sample, _ = c.Get(ctx, keys[0]).Result() }
		b, _ := json.Marshal(map[string]any{"state":"ok","summary":fmt.Sprintf("%d keys",len(keys)),"data":map[string]any{"count":len(keys),"sample":sample},"ts":time.Now().Unix()})
		println(string(b))
		time.Sleep(2 * time.Second)
	}
}
```

## Gotchas

- `KEYS *` in status loops will take down a real Redis under load —
  always use `SCAN`.
- `redis:alpine` ships with no persistence; restarts wipe state.
- `Set` with `0` TTL means *no expiry*, not "expire immediately" — a
  common source of accidental forever-keys.

## Fixture shape

```json
{ "key": "order:1716200000000", "value": "{\"total\":4200}", "ttl_seconds": 600 }
```
