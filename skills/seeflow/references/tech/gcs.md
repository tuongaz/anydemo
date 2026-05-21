---
techId: gcs
category: storage
---

# Google Cloud Storage

> **General guidance only.** Check `<project>/.seeflow/LEARN.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- One `stateNode` per bucket, not per object or prefix.
- Duplicate the bucket node next to each consumer for readability
  (same `kind` + `name`, unique `id`).
- Long-lived storage — model as `kind: state`, not `event`.

## Play (trigger locally)

- Reuse any project uploader/helper before instantiating a raw client.
- Honour `STORAGE_EMULATOR_HOST` so the script works against
  fake-gcs-server *and* real GCS without code changes.
- Pull payload shape from a real fixture if one ships.

```go
package main

import (
	"context"
	"strings"
	"time"
	"cloud.google.com/go/storage"
)

func main() {
	ctx := context.Background()
	c, _ := storage.NewClient(ctx)
	defer c.Close()
	key := time.Now().UTC().Format("20060102T150405") + ".json"
	w := c.Bucket("orders").Object(key).NewWriter(ctx)
	w.ContentType = "application/json"
	_, _ = w.Write([]byte(`{"id":"o_1","total":42}`))
	_ = w.Close()
	println(strings.Join([]string{"uploaded", key}, " "))
}
```

## Status (read locally)

- List under a tight prefix; never full-bucket scan.
- Emit `StatusReport` JSON per tick.
- Tolerate `storage.ErrObjectNotExist` — emit `state: "warn"`.

```go
package main

import (
	"context"; "encoding/json"; "fmt"; "time"
	"cloud.google.com/go/storage"
	"google.golang.org/api/iterator"
)

func main() {
	ctx := context.Background()
	c, _ := storage.NewClient(ctx)
	for {
		it := c.Bucket("orders").Objects(ctx, &storage.Query{Prefix: ""})
		keys := []string{}
		for { o, err := it.Next(); if err == iterator.Done { break }; if err != nil { break }; keys = append(keys, o.Name) }
		b, _ := json.Marshal(map[string]any{"state":"ok","summary":fmt.Sprintf("%d objects",len(keys)),"data":keys,"ts":time.Now().Unix()})
		println(string(b))
		time.Sleep(2 * time.Second)
	}
}
```

## Gotchas

- `STORAGE_EMULATOR_HOST` silently swaps real GCS for fake-gcs-server —
  set it in the play *and* status env, or one side hits prod.
- fake-gcs-server doesn't enforce IAM; code that "works locally" can
  401 against real GCS.
- Bucket names are global; emulator allows duplicates, real GCS doesn't.

## Fixture shape

```json
{ "bucket": "orders", "name": "20260520T120000.json", "contentType": "application/json", "size": 24, "generation": 1716200000000001 }
```
