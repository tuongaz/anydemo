---
techId: elasticsearch
category: storage
---

# Elasticsearch / OpenSearch

> **General guidance only.** Check `<project>/.seeflow/WIKI.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- One `stateNode` per index, not per shard or alias.
- Duplicate the index node next to each consumer (same `kind` +
  `name`, unique `id`) when it improves readability.
- If the project writes to an alias, model the alias as the node.

## Play (trigger locally)

- Reuse a project indexer/search-helper over a raw client.
- Honour `ELASTICSEARCH_URL` / `OPENSEARCH_URL`.
- For the play script *only*, pass `refresh=true` so the status loop
  sees the doc immediately — otherwise demos look broken.

```go
package main

import (
	"bytes"; "context"; "fmt"; "os"; "time"
	es "github.com/elastic/go-elasticsearch/v8"
)

func main() {
	c, _ := es.NewClient(es.Config{Addresses: []string{os.Getenv("ELASTICSEARCH_URL")}})
	id := fmt.Sprintf("o_%d", time.Now().UnixNano())
	body := bytes.NewReader([]byte(`{"total":4200,"created_at":"` + time.Now().UTC().Format(time.RFC3339) + `"}`))
	res, err := c.Index("orders", body, c.Index.WithDocumentID(id), c.Index.WithRefresh("true"), c.Index.WithContext(context.Background()))
	if err != nil { panic(err) }
	defer res.Body.Close()
	println("indexed", id)
}
```

## Status (read locally)

- `_count` + a top-N `_search` is plenty.
- Emit `StatusReport` JSON per tick.
- Treat 404 (index missing) as `state: "warn"`.

```go
package main

import (
	"context"; "encoding/json"; "fmt"; "os"; "time"
	es "github.com/elastic/go-elasticsearch/v8"
)

func main() {
	c, _ := es.NewClient(es.Config{Addresses: []string{os.Getenv("ELASTICSEARCH_URL")}})
	for {
		res, err := c.Count(c.Count.WithIndex("orders"), c.Count.WithContext(context.Background()))
		state := "ok"; if err != nil || res.IsError() { state = "warn" }
		var out struct{ Count int `json:"count"` }
		if res != nil { _ = json.NewDecoder(res.Body).Decode(&out); res.Body.Close() }
		b, _ := json.Marshal(map[string]any{"state":state,"summary":fmt.Sprintf("%d docs",out.Count),"data":map[string]int{"count":out.Count},"ts":time.Now().Unix()})
		println(string(b))
		time.Sleep(2 * time.Second)
	}
}
```

## Gotchas

- Default `refresh_interval` is 1s — indexed docs aren't searchable
  until refresh; demos appear empty without `refresh=true` on writes.
- `_count` reads against the searchable view, so it lags writes unless
  refreshed.
- OpenSearch and ES8 wire-compat: same client *mostly* works, but
  security plugin defaults differ (OpenSearch ships TLS-on by default).

## Fixture shape

```json
{ "_index": "orders", "_id": "o_1716200000000", "_source": { "total": 4200, "created_at": "2026-05-20T12:00:00Z" } }
```
