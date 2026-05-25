---
techId: kafka
category: messaging
---

# Apache Kafka

> **Check first.** Project conventions always win over the templates below.
>
> 1. `<host>/.seeflow/LEARN.md` `## Tech stack adaptations` — recorded
>    helpers, fixtures, compose service names, conventions.
> 2. `Grep`/`Glob` the repo for wrappers when LEARN.md is silent —
>    publisher/producer/consumer symbols, test-harness helpers,
>    `Makefile`/`scripts/` boot targets, compose service names, the path
>    to `kafka-*.sh` inside the broker image.
>
> Append anything new you learn this run back into LEARN.md so the next
> flow reuses it.

## What it is

Distributed append-only log — partitioned topics fan messages to
consumer groups with replayable offsets.

## How to run it

Start the broker so Play and Status scripts have something to talk to.

- Project script first: `make kafka` / `bun run kafka` / project
  `docker compose up -d <kafka-svc>`. Grep compose files and `Makefile`
  before inventing one.
- Fall back to the single-node KRaft recipe below.

```bash
docker run -d --name kafka -p 9092:9092 \
  -e KAFKA_CFG_NODE_ID=1 -e KAFKA_CFG_PROCESS_ROLES=broker,controller \
  -e KAFKA_CFG_CONTROLLER_QUORUM_VOTERS=1@localhost:9093 \
  -e KAFKA_CFG_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093 \
  -e KAFKA_CFG_ADVERTISED_LISTENERS=PLAINTEXT://localhost:9092 \
  -e KAFKA_CFG_CONTROLLER_LISTENER_NAMES=CONTROLLER \
  -e KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP=PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT \
  bitnami/kafka:3
until docker exec kafka kafka-topics.sh --bootstrap-server localhost:9092 --list >/dev/null 2>&1; do sleep 1; done
```

`kafka-*.sh` lives at `/opt/bitnami/kafka/bin/` (Bitnami) or `/usr/bin/`
(Confluent) — both are on `$PATH` inside the container.

## How to insert data

Project producer helper wins. Create the topic explicitly (auto-create
is usually off), then publish via `kafka-console-producer.sh`. Use a key
for per-entity ordering.

```bash
docker exec kafka kafka-topics.sh --bootstrap-server localhost:9092 \
  --create --topic orders --partitions 3 --if-not-exists

echo 'o_1:{"id":"o_1","total":42}' | docker exec -i kafka \
  kafka-console-producer.sh --bootstrap-server localhost:9092 --topic orders \
  --property "parse.key=true" --property "key.separator=:"
```

Drop the two `--property` flags (and the `o_1:` prefix) for unkeyed
publishes.

## How to verify run success

One-shot read — exits 0 if any message has landed since topic creation.

```bash
docker exec kafka kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic orders --from-beginning --max-messages 1 --timeout-ms 2000
```

## How to verify query data

Project reader helper first. Otherwise loop `kafka-console-consumer.sh`
with a **unique group per run** (`seeflow-status-$$`) so status never
steals from real consumers. Empty read → `state: "warn"`.

```bash
while true; do
  out=$(docker exec kafka kafka-console-consumer.sh --bootstrap-server localhost:9092 \
    --topic orders --from-beginning --max-messages 1 --timeout-ms 2000 \
    --group "seeflow-status-$$" 2>/dev/null)
  state=ok; [ -z "$out" ] && state=warn
  jq -n --arg s "$state" --arg d "$out" --argjson t "$(date +%s)" \
    '{state:$s, summary:"1 read", data:$d, ts:$t}'
  sleep 2
done
```

## Node modelling

- One `type:'queue'` per topic, not per partition or producer. The
  `queue` shape's stacked-channel glyph reads as a Kafka topic;
  capability chrome renders in the skirt. Surface partition count in
  `data.detail` (the schema rejects `data.note`).
- Duplicate the topic node next to each consumer group (same `type` +
  `data.name`, unique `id`).

## Gotchas

- Auto-create topics is often disabled — publish to a non-existent
  topic silently buffers then errors after timeout.
- Sharing a `GroupID` between status and a real consumer steals
  messages from the real consumer. Always namespace (`seeflow-status-$$`).
- Partition count caps parallelism *and* per-key ordering scope;
  changing it later rebalances every key.
- Compose brokers often only advertise `localhost:9092` — from inside
  another container you need the service-name listener.

## Fixture shape

```json
{ "topic": "orders", "partition": 0, "offset": 17, "key": "o_1", "value": "{\"id\":\"o_1\"}", "headers": [{ "key": "source", "value": "play" }], "timestamp": "2026-05-20T12:00:00Z" }
```
