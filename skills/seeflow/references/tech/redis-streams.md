---
techId: redis-streams
category: messaging
---

# Redis Streams (XADD / XREAD)

> **General guidance only.** Check the shared `<host>/.seeflow/LEARN.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- One `stateNode` per stream key, not per consumer or group.
- Consumer groups are separate consumer nodes — one node per group.
- Duplicate the stream node next to each consumer for readability
  (same `kind` + `name`, unique `id`).

## Play (trigger locally)

- Reuse the project's stream writer helper before a raw client.
- Use `XAdd` with `MAXLEN ~ N` so the stream doesn't grow forever in
  the local broker.
- Field/value pairs are flat strings — JSON-encode the payload into a
  single `data` field if the project does.

```go
package main

import (
	"context"
	"github.com/redis/go-redis/v9"
)

func main() {
	r := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	defer r.Close()
	id, _ := r.XAdd(context.Background(), &redis.XAddArgs{
		Stream: "orders",
		MaxLen: 1000, Approx: true,
		Values: map[string]any{"data": `{"id":"o_1","total":42}`, "source": "play"},
	}).Result()
	println("id", id)
}
```

## Status (read locally)

- `XRead` with `Count: 1, Block: 1s` from `$` for tail-only, or last id
  for resumable reads. Use `XReadGroup` + `XAck` only if the flow
  narrates a consumer group.
- Emit `StatusReport` per tick; no entries → `state: "warn"`.

```go
package main

import (
	"context"; "encoding/json"; "time"
	"github.com/redis/go-redis/v9"
)

func main() {
	r := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	defer r.Close()
	for {
		out, _ := r.XRead(context.Background(), &redis.XReadArgs{
			Streams: []string{"orders", "$"}, Count: 1, Block: 1 * time.Second,
		}).Result()
		state := "warn"; var v any
		if len(out) > 0 && len(out[0].Messages) > 0 { state = "ok"; v = out[0].Messages[0].Values }
		b, _ := json.Marshal(map[string]any{"state": state, "summary": "1 read", "data": v, "ts": time.Now().Unix()})
		println(string(b)); time.Sleep(2 * time.Second)
	}
}
```

## Gotchas

- `XRead` does not ACK or track offset — only `XReadGroup` + `XAck`
  does. Mixing the two in status confuses the consumer group's PEL.
- Streams grow unbounded without `MAXLEN`; `~` (approximate) trim is
  cheaper but doesn't hit the exact cap.
- `Block: 0` blocks forever; the status loop will hang silently.
- AOF / RDB persistence settings affect whether the stream survives a
  local Redis restart.

## Fixture shape

```json
{ "stream": "orders", "id": "1716200000000-0", "values": { "data": "{\"id\":\"o_1\"}", "source": "play" } }
```
