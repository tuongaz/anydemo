---
techId: rabbitmq
category: messaging
---

# RabbitMQ (AMQP 0.9.1)

> **General guidance only.** Check `<project>/.seeflow/WIKI.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- One `stateNode` per queue (or per exchange-binding pair when the
  codebase emphasises routing). Don't model the exchange separately
  unless the topology fan-out is the story.
- Mirror the queue node next to each consumer for readability
  (same `kind` + `name`, unique `id`).
- Note `durable: true|false` in `data.note` — it changes status
  behaviour across restarts.

## Play (trigger locally)

- Reuse the project's publisher helper before a raw channel.
- Publish to an exchange + routing key — not directly to a queue.
- The compose broker usually exposes 5672 (AMQP) and 15672 (management
  UI). Honour any `AMQP_URL` env override.

```go
package main

import (
	"context"
	amqp "github.com/rabbitmq/amqp091-go"
)

func main() {
	conn, _ := amqp.Dial("amqp://guest:guest@localhost:5672/")
	defer conn.Close()
	ch, _ := conn.Channel()
	defer ch.Close()
	_ = ch.PublishWithContext(context.Background(), "orders", "created", false, false, amqp.Publishing{
		ContentType: "application/json",
		Body:        []byte(`{"id":"o_1","total":42}`),
	})
	println("published")
}
```

## Status (read locally)

- `channel.Get` with `autoAck=false`, then `Ack` once. Avoids spinning
  up a long-lived consumer just to peek.
- Treat `ok=false` (empty queue) as `state: "warn"`.
- Don't passive-declare with mismatched args — it errors the channel.

```go
package main

import (
	"encoding/json"; "time"
	amqp "github.com/rabbitmq/amqp091-go"
)

func main() {
	conn, _ := amqp.Dial("amqp://guest:guest@localhost:5672/")
	defer conn.Close()
	ch, _ := conn.Channel()
	for {
		msg, ok, _ := ch.Get("orders.sink", false)
		state := "warn"; var v string
		if ok { state = "ok"; v = string(msg.Body); _ = msg.Ack(false) }
		b, _ := json.Marshal(map[string]any{"state": state, "summary": "1 get", "data": v, "ts": time.Now().Unix()})
		println(string(b)); time.Sleep(2 * time.Second)
	}
}
```

## Gotchas

- Non-durable queues vanish after a broker restart — status against
  them looks empty for legitimate reasons.
- Consumer prefetch (`Qos`) of 0 means unlimited — one slow consumer
  hoards every message; status sees `0` even with load.
- Exchange types (`direct`, `topic`, `fanout`, `headers`) silently
  change routing; publishing to the wrong type drops the message.
- Default `guest` user only works on localhost connections.

## Fixture shape

```json
{ "exchange": "orders", "routingKey": "created", "properties": { "contentType": "application/json", "headers": { "source": "play" } }, "body": "{\"id\":\"o_1\"}" }
```
