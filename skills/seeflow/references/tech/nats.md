---
techId: nats
category: messaging
---

# NATS / JetStream

> **General guidance only.** Check the shared `<host>/.seeflow/LEARN.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- Core NATS: one node (`type:'rectangle'`) per subject. JetStream: one node (`type:'rectangle'`)
  per stream (a stream wraps one or more subjects).
- Durable consumers are separate consumer nodes; mention the durable
  name in `data.note`.
- Duplicate the stream node next to each consumer for readability
  (same `type` + `data.icon` + `data.name`, unique `id`).

## Play (trigger locally)

- Prefer JetStream `Publish` for anything narrated as persistent —
  core `nc.Publish` is at-most-once and leaves nothing for status to
  read.
- Reuse the project's publisher helper if it exists.
- The stream must exist before publish; create it once at compose-up
  or in a setup helper.

```go
package main

import (
	"github.com/nats-io/nats.go"
)

func main() {
	nc, _ := nats.Connect(nats.DefaultURL)
	defer nc.Drain()
	js, _ := nc.JetStream()
	ack, _ := js.Publish("orders.created", []byte(`{"id":"o_1","total":42}`))
	println("seq", ack.Sequence)
}
```

## Status (read locally)

- Pull-based JetStream consumer: `Fetch(1, MaxWait=2s)`, ACK, emit.
- Use a stable durable name so the script resumes where it left off
  *or* deliberately ephemeral with a fresh name per run (pick one,
  document in `data.note`).

```go
package main

import (
	"encoding/json"; "time"
	"github.com/nats-io/nats.go"
)

func main() {
	nc, _ := nats.Connect(nats.DefaultURL)
	defer nc.Drain()
	js, _ := nc.JetStream()
	sub, _ := js.PullSubscribe("orders.created", "seeflow-status", nats.BindStream("ORDERS"))
	for {
		msgs, _ := sub.Fetch(1, nats.MaxWait(2*time.Second))
		state := "warn"; var v string
		if len(msgs) > 0 { state = "ok"; v = string(msgs[0].Data); _ = msgs[0].Ack() }
		b, _ := json.Marshal(map[string]any{"state": state, "summary": "1 fetch", "data": v, "ts": time.Now().Unix()})
		println(string(b)); time.Sleep(2 * time.Second)
	}
}
```

## Gotchas

- Core NATS is at-most-once and has zero persistence — status against
  a core subject will almost always look empty.
- JetStream requires the stream to be created before publish; the
  server does not auto-create from a `Publish` call.
- Durable consumer names are sticky — reusing a name keeps the cursor;
  changing args on an existing durable errors silently in some clients.
- The compose container often exposes 4222 (client) and 8222 (monitor);
  only 4222 is the wire protocol.

## Fixture shape

```json
{ "subject": "orders.created", "stream": "ORDERS", "seq": 17, "data": "{\"id\":\"o_1\"}", "headers": { "source": "play" }, "ts": "2026-05-20T12:00:00Z" }
```
