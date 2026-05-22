---
techId: pubsub-emulator
category: local-infra
---

# Pub/Sub Emulator

> **General guidance only.** Check `<projectPath>/LEARN.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- Model exactly as the real `google-pubsub` ref: one `stateNode` per **topic**
  (and optionally one per **subscription** if the demo needs to show fan-out).
- Producers and consumers stay as their own nodes; the emulator endpoint is a
  scripting concern, not a topology concern.

## Play (trigger locally)

- Set `PUBSUB_EMULATOR_HOST=localhost:8085` and `PUBSUB_PROJECT_ID=demo`
  before constructing the client.
- The emulator starts empty — create the topic and subscription if missing
  before publishing.
- Publish one message; flush with `result.Get(ctx)` so the script exits only
  after the broker acks.

```go
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"cloud.google.com/go/pubsub"
)

func main() {
	ctx := context.Background()
	cli, err := pubsub.NewClient(ctx, "demo")
	if err != nil { panic(err) }
	defer cli.Close()
	topic := cli.Topic("orders")
	if ok, _ := topic.Exists(ctx); !ok { topic, _ = cli.CreateTopic(ctx, "orders") }
	if ok, _ := cli.Subscription("orders-sub").Exists(ctx); !ok {
		_, _ = cli.CreateSubscription(ctx, "orders-sub", pubsub.SubscriptionConfig{Topic: topic})
	}
	id, err := topic.Publish(ctx, &pubsub.Message{Data: []byte(`{"id":1}`)}).Get(ctx)
	if err != nil { panic(err) }
	_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"topic": "orders", "msgId": id})
	fmt.Fprintln(os.Stderr, "published")
}
```

## Status (read locally)

- Pull synchronously with `MaxOutstandingMessages: 1` and a short receive
  timeout. Ack the message so depth changes are visible across ticks.
- Report subscription backlog as the headline number.

```go
package main

import (
	"context"
	"encoding/json"
	"os"
	"time"
	"cloud.google.com/go/pubsub"
)

func main() {
	cli, _ := pubsub.NewClient(context.Background(), "demo")
	defer cli.Close()
	sub := cli.Subscription("orders-sub")
	sub.ReceiveSettings.Synchronous = true
	sub.ReceiveSettings.MaxOutstandingMessages = 1
	enc := json.NewEncoder(os.Stdout)
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)
		got := 0
		_ = sub.Receive(ctx, func(_ context.Context, m *pubsub.Message) { got++; m.Ack() })
		cancel()
		_ = enc.Encode(map[string]any{"state": "ok", "summary": "polled",
			"data": map[string]int{"received": got}, "ts": time.Now().UTC().Format(time.RFC3339)})
		time.Sleep(2 * time.Second)
	}
}
```

## Gotchas

- Without `PUBSUB_EMULATOR_HOST` the client silently calls the real GCP —
  always set it before `pubsub.NewClient`, never after.
- The emulator ignores the project id for auth but **the topic path must
  still match it** (`projects/demo/topics/orders`).
- IAM, schemas, ordering keys, and snapshots are partial or unimplemented —
  do not rely on `OrderingKey` for deterministic delivery.
- All state lives in memory; restart wipes topics, subs, and backlog.

## Fixture shape

```json
{ "topic": "orders", "subscription": "orders-sub", "message": { "id": 1, "sku": "abc" } }
```
