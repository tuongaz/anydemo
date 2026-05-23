---
techId: google-pubsub
category: messaging
---

# Google Cloud Pub/Sub

> **General guidance only.** Check the shared `<host>/.seeflow/LEARN.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- One `stateNode` per topic, not per publisher or subscriber. Label the
  node with the topic; mention the subscription in `data.note`.
- A subscription that fans into N workers is one consumer node — not N.
- Duplicate the topic node next to each subscriber for readability
  (same `kind` + `name`, unique `id`).

## Play (trigger locally)

- Reuse the project's publisher helper before a raw client.
- Honour `PUBSUB_EMULATOR_HOST` and `PUBSUB_PROJECT_ID` so the script
  hits the emulator and never real Pub/Sub.
- Block on `Get` so the script exits non-zero on publish failure.

```go
package main

import (
	"context"
	"cloud.google.com/go/pubsub"
)

func main() {
	ctx := context.Background()
	c, _ := pubsub.NewClient(ctx, "demo")
	defer c.Close()
	r := c.Topic("orders").Publish(ctx, &pubsub.Message{
		Data:       []byte(`{"id":"o_1","total":42}`),
		Attributes: map[string]string{"source": "play"},
	})
	id, _ := r.Get(ctx)
	println("published", id)
}
```

## Status (read locally)

- Pull synchronously, one message at a time, ACK immediately.
- Emit `StatusReport` JSON per tick; sleep between iterations.
- Treat zero messages as `state: "warn"`, not failure.

```go
package main

import (
	"context"; "encoding/json"; "time"
	"cloud.google.com/go/pubsub"
)

func main() {
	ctx := context.Background()
	c, _ := pubsub.NewClient(ctx, "demo")
	sub := c.Subscription("orders-sink")
	sub.ReceiveSettings.MaxOutstandingMessages = 1
	sub.ReceiveSettings.Synchronous = true
	for {
		cctx, cancel := context.WithTimeout(ctx, 2*time.Second)
		_ = sub.Receive(cctx, func(_ context.Context, m *pubsub.Message) {
			b, _ := json.Marshal(map[string]any{"state": "ok", "summary": "1 msg", "data": string(m.Data), "ts": time.Now().Unix()})
			println(string(b)); m.Ack()
		})
		cancel(); time.Sleep(2 * time.Second)
	}
}
```

## Gotchas

- Emulator returns `INVALID_ARGUMENT` on ordering keys unless the
  subscription is created with `EnableMessageOrdering: true`.
- ACK deadline defaults to 10s — slow processing redelivers silently.
- `PUBSUB_PROJECT_ID` is required for the emulator; without it the
  client may fall back to ADC and hit prod.
- Topics and subscriptions must be created before publish/receive;
  the emulator does not auto-create them.

## Fixture shape

```json
{ "messageId": "1", "data": "eyJpZCI6Im9fMSJ9", "attributes": { "source": "play" }, "publishTime": "2026-05-20T12:00:00Z", "orderingKey": "" }
```
