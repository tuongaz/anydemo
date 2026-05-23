---
techId: docker-compose
category: local-infra
---

# Docker Compose

> **General guidance only.** Check the shared `<host>/.seeflow/LEARN.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- Compose itself is **not** a node. Model each compose **service** (postgres,
  localstack, kafka) as its own node (`type:'rectangle'`), named after the service.
- If a play script must start a service before another node fires, treat
  `docker compose up -d <svc>` as setup inside that node's play script,
  not as its own node.

## Play (trigger locally)

- Use `docker compose -f <file> up -d <svc>` for the smallest dependency.
- Wait for readiness via the service's own probe (`pg_isready`, `redis-cli ping`)
  through `docker compose exec`, not a blind sleep.
- Reuse the project's existing compose file — never invent ports.

```bash
#!/usr/bin/env bash
set -euo pipefail
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
SVC="${1:-postgres}"
docker compose -f "$COMPOSE_FILE" up -d "$SVC" >/dev/null
for _ in {1..30}; do
  if docker compose -f "$COMPOSE_FILE" exec -T "$SVC" pg_isready -U postgres >/dev/null 2>&1; then
    echo "{\"service\":\"$SVC\",\"state\":\"ready\"}"
    exit 0
  fi
  sleep 1
done
echo "{\"service\":\"$SVC\",\"state\":\"timeout\"}" >&2
exit 1
```

## Status (read locally)

- Poll `docker compose ps --format json` — one line per service.
- Map container `State` to `ok` (running) / `warn` (restarting) / `error` (exited).
- Tolerate missing services — emit `state: "warn"` with empty data.

```bash
#!/usr/bin/env bash
set -euo pipefail
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
while true; do
  ROWS=$(docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null || echo '[]')
  RUNNING=$(echo "$ROWS" | jq '[.[] | select(.State=="running")] | length')
  TOTAL=$(echo "$ROWS"   | jq 'length')
  STATE=$([ "$RUNNING" = "$TOTAL" ] && echo ok || echo warn)
  TS=$(date -u +%FT%TZ)
  printf '{"state":"%s","summary":"%s/%s running","data":%s,"ts":"%s"}\n' \
    "$STATE" "$RUNNING" "$TOTAL" "$ROWS" "$TS"
  sleep 2
done
```

## Gotchas

- `docker-compose` (v1, hyphenated) vs `docker compose` (v2 plugin) — prefer
  v2; v1 is missing `--format json` on `ps`.
- `ps --format json` returns one JSON object per line in older builds and a
  proper array in newer ones — `jq -s 'flatten'` smooths over it.
- `exec` fails without a TTY in CI — always pass `-T`.
- Project, network, and volume names are derived from the parent directory
  unless `COMPOSE_PROJECT_NAME` is set. Changing CWD silently orphans state.

## Fixture shape

```yaml
services:
  postgres:
    image: postgres:16
    ports: ["5432:5432"]
    environment: { POSTGRES_PASSWORD: postgres }
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 2s
```
