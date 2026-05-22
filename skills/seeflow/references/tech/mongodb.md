---
techId: mongodb
category: storage
---

# MongoDB

> **General guidance only.** Check `<projectPath>/LEARN.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- One `stateNode` per database — collection-level is too fine-grained
  and clutters the canvas.
- Duplicate the DB node next to each consumer for readability
  (same `kind` + `name`, unique `id`).

## Play (trigger locally)

- Reuse a project repository/store helper over a raw `mongo.Client`.
- Honour the project URI env (`MONGO_URI` / `MONGODB_URL`).
- `InsertOne` is the canonical write; let the driver generate `_id`
  unless the project uses a deterministic id helper.

```go
package main

import (
	"context"; "os"; "time"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func main() {
	ctx := context.Background()
	c, _ := mongo.Connect(ctx, options.Client().ApplyURI(os.Getenv("MONGO_URI")))
	defer c.Disconnect(ctx)
	r, err := c.Database("shop").Collection("orders").InsertOne(ctx, bson.M{
		"total": 4200, "created_at": time.Now().UTC(),
	})
	if err != nil { panic(err) }
	println("inserted", r.InsertedID.(interface{ Hex() string }).Hex())
}
```

## Status (read locally)

- `Find` with `SetLimit` + `SetSort` on `_id` desc — never unbounded.
- Emit `StatusReport` JSON per tick.
- Tolerate missing collection as `state: "warn"`.

```go
package main

import (
	"context"; "encoding/json"; "fmt"; "os"; "time"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func main() {
	ctx := context.Background()
	c, _ := mongo.Connect(ctx, options.Client().ApplyURI(os.Getenv("MONGO_URI")))
	col := c.Database("shop").Collection("orders")
	for {
		n, err := col.CountDocuments(ctx, bson.M{})
		state := "ok"; if err != nil { state = "warn" }
		_, _ = col.Find(ctx, bson.M{}, options.Find().SetLimit(5).SetSort(bson.M{"_id": -1}))
		b, _ := json.Marshal(map[string]any{"state":state,"summary":fmt.Sprintf("%d orders",n),"data":map[string]int64{"count":n},"ts":time.Now().Unix()})
		println(string(b))
		time.Sleep(2 * time.Second)
	}
}
```

## Gotchas

- Default write concern is `w: 1` with no journaling on some emulators —
  inserts may "succeed" but vanish on restart.
- Collection is created on first insert; `Find` against a missing
  collection returns empty, not an error — easy to miss bad DB name.
- `time.Time` round-trips as BSON `Date` (ms precision); nanoseconds
  are silently truncated.

## Fixture shape

```json
{ "_id": "664bce0011223344aabbccdd", "total": 4200, "created_at": "2026-05-20T12:00:00.000Z" }
```
