---
techId: google-pubsub
category: messaging
---

# Google Cloud Pub/Sub

> **Check first.** Project conventions always win over the templates below.
>
> 1. `<host>/.seeflow/LEARN.md` `## Tech stack adaptations` — recorded
>    helpers, fixtures, emulator wiring, conventions.
> 2. `Grep`/`Glob` the repo for wrappers when LEARN.md is silent —
>    publisher/subscriber symbols, test-harness helpers,
>    `Makefile`/`scripts/` boot targets, compose service names.
>
> Append anything new you learn this run back into LEARN.md so the next
> flow reuses it.

## What it is

Managed pub/sub messaging — topics fan messages to durable subscriptions.
Locally, the gcloud emulator stands in for the real service and speaks the
same REST API on `PUBSUB_EMULATOR_HOST`.

## How to run it

Project `make` target / `bun run` task / compose service wins. Grep first
(`docker compose config --services`, `Makefile`, `scripts/`). Otherwise
start the emulator directly or via the cloud-sdk image.

```bash
# Host install
gcloud beta emulators pubsub start --host-port=0.0.0.0:8085 --project=demo
# Compose equivalent (cloud-sdk image runs the same command)
docker compose exec pubsub gcloud beta emulators pubsub start \
  --host-port=0.0.0.0:8085 --project=demo
```

Export the env every script needs, then bootstrap the topic + subscription
(the emulator does **not** auto-create them):

```bash
export PUBSUB_EMULATOR_HOST=localhost:8085 PUBSUB_PROJECT_ID=demo
curl -fsS -X PUT http://$PUBSUB_EMULATOR_HOST/v1/projects/demo/topics/orders
curl -fsS -X PUT http://$PUBSUB_EMULATOR_HOST/v1/projects/demo/subscriptions/orders-sink \
  -H 'content-type: application/json' \
  -d '{"topic":"projects/demo/topics/orders"}'
```

## Node modelling

- One node (`type:'queue'`) per topic, not per publisher or subscriber.
  The `queue` shape's stacked-channel glyph reads as a topic.
- Duplicate the topic node next to each subscriber for readability
  (same `type` + `data.name`, unique `id`).

## Gotchas

- Emulator returns `INVALID_ARGUMENT` on ordering keys unless the
  subscription is created with `enableMessageOrdering: true`.
- ACK deadline defaults to 10s — slow processing redelivers silently.
- `PUBSUB_PROJECT_ID` is required for the emulator; without it the client
  may fall back to ADC and hit prod.
- Topics and subscriptions must be created before publish/receive; the
  emulator does not auto-create them.

## Fixture shape

```json
{ "messageId": "1", "data": "eyJpZCI6Im9fMSJ9", "attributes": { "source": "order-service" }, "publishTime": "2026-05-20T12:00:00Z", "orderingKey": "" }
```
