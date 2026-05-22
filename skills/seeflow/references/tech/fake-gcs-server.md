---
techId: fake-gcs-server
category: local-infra
---

# fake-gcs-server

> **General guidance only.** Check `<projectPath>/LEARN.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- One `stateNode` per **bucket** the flow uses (`uploads`, `reports`). Same
  shape as the real `gcs` ref — only the endpoint differs.
- Group objects under one bucket node unless the demo specifically contrasts
  two buckets; do not model individual objects as nodes.

## Play (trigger locally)

- Point the GCS client at fake-gcs-server with `STORAGE_EMULATOR_HOST=
  http://localhost:4443` **or** `option.WithEndpoint("http://localhost:4443/storage/v1/")`
  plus `option.WithoutAuthentication()`.
- Pre-create buckets via the compose `-scheme http -data /storage` volume and
  a seed file — fake-gcs auto-creates buckets from the folder layout on start.
- Upload one object so status can see it.

```go
package main

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"cloud.google.com/go/storage"
	"google.golang.org/api/option"
)

func main() {
	ctx := context.Background()
	cli, err := storage.NewClient(ctx,
		option.WithEndpoint("http://localhost:4443/storage/v1/"),
		option.WithoutAuthentication())
	if err != nil { panic(err) }
	defer cli.Close()
	w := cli.Bucket("uploads").Object("hello.txt").NewWriter(ctx)
	if _, err := w.Write([]byte("hi")); err != nil { panic(err) }
	if err := w.Close(); err != nil { panic(err) }
	_ = json.NewEncoder(os.Stdout).Encode(map[string]string{
		"bucket": "uploads", "object": "hello.txt",
		"etag":   strings.Trim(w.Attrs().Etag, `"`),
	})
}
```

## Status (read locally)

- List objects with a `Prefix` and a `Query{Versions: false}` — cheapest read.
- Report object count and newest object's name.
- Missing bucket: emit `state: "warn"` and keep polling.

```go
package main

import (
	"context"
	"encoding/json"
	"os"
	"time"
	"cloud.google.com/go/storage"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
)

func main() {
	cli, _ := storage.NewClient(context.Background(),
		option.WithEndpoint("http://localhost:4443/storage/v1/"),
		option.WithoutAuthentication())
	defer cli.Close()
	enc := json.NewEncoder(os.Stdout)
	for {
		it := cli.Bucket("uploads").Objects(context.Background(), &storage.Query{})
		n := 0; var last string
		for { o, err := it.Next(); if err == iterator.Done { break }; if err != nil { break }; n++; last = o.Name }
		_ = enc.Encode(map[string]any{"state": "ok", "summary": "polled",
			"data": map[string]any{"count": n, "newest": last},
			"ts":   time.Now().UTC().Format(time.RFC3339)})
		time.Sleep(2 * time.Second)
	}
}
```

## Gotchas

- The trailing `/storage/v1/` on the endpoint is required for `WithEndpoint`;
  omit it and uploads return 404 with no helpful message.
- `STORAGE_EMULATOR_HOST` is honoured by the Go client but **ignored** by the
  Python and Node SDKs — those need explicit `api_endpoint` / `apiEndpoint`.
- Resumable uploads need `-public-host localhost:4443` on the server or the
  client retries against the container's internal hostname.
- Signed URLs are accepted but signatures are not verified — never assume
  the auth path matches prod.

## Fixture shape

```json
{ "bucket": "uploads", "object": "hello.txt", "size": 2, "contentType": "text/plain" }
```
