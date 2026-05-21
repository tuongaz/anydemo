---
techId: java
category: language
---

# Java / Kotlin

> **General guidance only.** Check `<project>/.seeflow/LEARN.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- Languages don't drive node modelling; consult the tech-specific refs
  (`tech/postgres.md`, `tech/google-pubsub.md`, etc.) for resource node
  guidance.
- Interpreter wiring: **don't run `.java` files as scripts.** Use
  `interpreter: "bash"`, `args: []`. The bash wrapper calls `curl` / `jq`,
  or invokes a project-shipped CLI / `mvn exec:java` / `./gradlew run`
  named in `techAdaptations.helpers`.

## Play (trigger locally)

- JVM startup (1–3s) plus compile cost makes per-script Java impractical.
- Default: bash wrapper hitting the project's REST surface with `curl`.
- If the project ships a CLI (e.g. `bin/app produce-order`) or a Gradle
  task, prefer that — it reuses real domain code.
- Read stdin JSON with `jq`; on failure, `echo` to stderr and `exit 1`.

```bash
#!/usr/bin/env bash
set -euo pipefail

raw=$(cat || true)
[ -z "$raw" ] && raw='{}'
id=$(printf '%s' "$raw" | jq -r '.id // "demo-1"')
total=$(printf '%s' "$raw" | jq -r '.total // 4200')

# Prefer a project helper if one exists, e.g. ./gradlew :app:produceOrder -Pid="$id"
http=$(curl -sS -o /tmp/seeflow-play.out -w '%{http_code}' \
  -H 'content-type: application/json' \
  -d "{\"id\":\"$id\",\"total\":$total}" \
  http://localhost:8080/orders) || { echo "curl failed" >&2; exit 1; }

if [ "$http" -ge 300 ]; then
  echo "http $http" >&2
  exit 1
fi
jq -nc --arg id "$id" '{ok:true, id:$id}'
```

## Status (read locally)

- Same posture: bash + `curl` + `jq` in an infinite loop with `sleep 1`.
- One JSON line per tick on stdout.
- On non-2xx or curl failure, emit `state: "warn"` — don't `exit`.

```bash
#!/usr/bin/env bash
set -u

while true; do
  state="ok"; summary="0 orders"; count=0
  if body=$(curl -sS --max-time 2 http://localhost:8080/orders/count); then
    count=$(printf '%s' "$body" | jq -r '.count // 0')
    summary="$count orders"
  else
    state="warn"; summary="read failed"
  fi
  jq -nc --arg state "$state" --arg summary "$summary" --argjson count "$count" \
    '{state:$state, summary:$summary, data:{count:$count}, ts:(now|floor)}'
  sleep 1
done
```

## Gotchas

- Never invoke `java SomeClass.java` per tick — JVM warm-up alone blows
  the 1s budget and floods the studio with cold-start noise.
- `mvn` / `gradle` calls inherit massive classpath resolution; cache by
  invoking the wrapper once and looping inside bash, not the other way.
- `jq` is a soft dependency — assume it's installed on dev machines, but
  note it in LEARN if the project lacks it.
- Kotlin scripts (`.kts`) have the same JVM startup penalty — same rule.

## Fixture shape

```json
{ "id": "demo-1", "total": 4200 }
```
