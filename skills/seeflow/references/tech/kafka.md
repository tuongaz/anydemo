---
techId: kafka
category: messaging
---

# Apache Kafka

> **General guidance only.** Check the shared `<host>/.seeflow/LEARN.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- One node (`type:'rectangle'`) per topic, not per partition. Mention the partition
  count in `data.note` when ordering matters.
- Consumer groups are separate consumer nodes — one node per group, not
  per member.
- Duplicate the topic node next to each consumer group for readability
  (same `type` + `data.icon` + `data.name`, unique `id`).

## Play (trigger locally)

- Reuse the project's producer helper before a raw `Writer`.
- Ensure the topic exists before publish — auto-create is often off in
  prod and may be off in the local compose broker too.
- Use a `Key` when ordering per entity matters (same key → same
  partition).

```go
package main

import (
	"context"
	"github.com/segmentio/kafka-go"
)

func main() {
	w := &kafka.Writer{
		Addr:     kafka.TCP("localhost:9092"),
		Topic:    "orders",
		Balancer: &kafka.Hash{},
	}
	defer w.Close()
	_ = w.WriteMessages(context.Background(), kafka.Message{
		Key:   []byte("o_1"),
		Value: []byte(`{"id":"o_1","total":42}`),
	})
	println("written")
}
```

## Status (read locally)

- One-shot read with a deadline; never commit offsets in status.
- Use a unique `GroupID` per status run (or start from `LastOffset`) so
  the status script never silently consumes for a real consumer group.

```go
package main

import (
	"context"; "encoding/json"; "time"
	"github.com/segmentio/kafka-go"
)

func main() {
	r := kafka.NewReader(kafka.ReaderConfig{
		Brokers: []string{"localhost:9092"}, Topic: "orders",
		GroupID: "seeflow-status", MinBytes: 1, MaxBytes: 1e6,
	})
	defer r.Close()
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		m, err := r.ReadMessage(ctx); cancel()
		state := "warn"; var v string
		if err == nil { state = "ok"; v = string(m.Value) }
		b, _ := json.Marshal(map[string]any{"state": state, "summary": "1 read", "data": v, "ts": time.Now().Unix()})
		println(string(b)); time.Sleep(2 * time.Second)
	}
}
```

## Gotchas

- Auto-create topics is often disabled — publish to a non-existent
  topic silently buffers then errors after timeout.
- Sharing a `GroupID` between status and a real consumer steals
  messages from the real consumer. Always namespace.
- Partition count caps parallelism *and* per-key ordering scope;
  changing it later rebalances every key.
- Compose brokers often only advertise `localhost:9092` — from inside
  another container you need the service-name listener.

## Fixture shape

```json
{ "topic": "orders", "partition": 0, "offset": 17, "key": "o_1", "value": "{\"id\":\"o_1\"}", "headers": [{ "key": "source", "value": "play" }], "timestamp": "2026-05-20T12:00:00Z" }
```
