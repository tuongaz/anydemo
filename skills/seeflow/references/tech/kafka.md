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

How a developer brings the broker up locally.

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

## Node modelling

- One `type:'queue'` per topic, not per partition or producer. The
  `queue` shape's stacked-channel glyph reads as a Kafka topic.
  Surface partition count in `data.detail` (the schema rejects
  `data.note`).
- Duplicate the topic node next to each consumer group (same `type` +
  `data.name`, unique `id`).

## Gotchas

- Auto-create topics is often disabled — publishing to a non-existent
  topic silently buffers then errors after timeout.
- Partition count caps parallelism *and* per-key ordering scope;
  changing it later rebalances every key.
- Compose brokers often only advertise `localhost:9092` — from inside
  another container you need the service-name listener.

## Fixture shape

```json
{ "topic": "orders", "partition": 0, "offset": 17, "key": "o_1", "value": "{\"id\":\"o_1\"}", "headers": [{ "key": "source", "value": "order-service" }], "timestamp": "2026-05-20T12:00:00Z" }
```
