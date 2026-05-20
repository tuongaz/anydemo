---
techId: firestore-emulator
category: local-infra
---

# Firestore Emulator

> **General guidance only.** Check `<project>/.seeflow/WIKI.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- One `stateNode` per **collection** the flow touches — keyed by collection
  path (`users`, `orders/{id}/items`).
- Subcollections that the demo reads independently get their own node;
  otherwise fold them into the parent collection's status view.

## Play (trigger locally)

- Set `FIRESTORE_EMULATOR_HOST=localhost:8080` before constructing the client.
- Any project id works (`demo`); auth is bypassed but the id is part of the
  document path so keep it consistent between play and status.
- Write one doc with a deterministic id so status can find it.

```go
package main

import (
	"context"
	"encoding/json"
	"os"
	"time"
	"cloud.google.com/go/firestore"
)

func main() {
	ctx := context.Background()
	cli, err := firestore.NewClient(ctx, "demo")
	if err != nil { panic(err) }
	defer cli.Close()
	_, err = cli.Collection("orders").Doc("ord-1").Set(ctx, map[string]any{
		"sku":     "abc-123",
		"qty":     1,
		"created": time.Now().UTC(),
	})
	if err != nil { panic(err) }
	_ = json.NewEncoder(os.Stdout).Encode(map[string]string{
		"collection": "orders", "docId": "ord-1",
	})
}
```

## Status (read locally)

- Read the smallest signal: `Collection(...).Limit(1).Documents(ctx)` or a
  single `Doc(...).Get(ctx)`.
- Report `count` of visible docs and the latest doc's id.
- `codes.NotFound` on the doc means warn, not error.

```go
package main

import (
	"context"
	"encoding/json"
	"os"
	"time"
	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

func main() {
	cli, _ := firestore.NewClient(context.Background(), "demo")
	defer cli.Close()
	enc := json.NewEncoder(os.Stdout)
	for {
		it := cli.Collection("orders").OrderBy("created", firestore.Desc).Limit(1).Documents(context.Background())
		var latest string
		if doc, err := it.Next(); err == nil { latest = doc.Ref.ID } else if err != iterator.Done {}
		_ = enc.Encode(map[string]any{"state": "ok", "summary": "polled",
			"data": map[string]string{"latestDoc": latest},
			"ts":   time.Now().UTC().Format(time.RFC3339)})
		time.Sleep(2 * time.Second)
	}
}
```

## Gotchas

- Without `FIRESTORE_EMULATOR_HOST` the client silently talks to real
  Firestore — and silently bills you. Always export it.
- Composite indexes that prod requires are auto-created in the emulator at
  query time, so queries that fail in prod will succeed locally — review
  `firestore.indexes.json` separately.
- Security rules are not enforced by the SDK path; use the REST endpoint plus
  `FIRESTORE_EMULATOR_HOST` if you need rules eval.
- State is in-memory by default; pass `--data-dir` to `gcloud emulators
  firestore start` to persist across restarts.

## Fixture shape

```json
{ "collection": "orders", "docId": "ord-1", "doc": { "sku": "abc-123", "qty": 1 } }
```
