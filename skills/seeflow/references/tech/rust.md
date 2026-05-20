---
techId: rust
category: language
---

# Rust

> **General guidance only.** Check `<project>/.seeflow/WIKI.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- Languages don't drive node modelling; consult the tech-specific refs
  (`tech/postgres.md`, `tech/google-pubsub.md`, etc.) for resource node
  guidance.
- Interpreter wiring: **don't write `.rs` play/status scripts.** Use
  `interpreter: "bash"`, `args: []`. The bash wrapper calls `curl`/`jq`,
  or invokes a project-shipped CLI binary listed under
  `techAdaptations.helpers`.

## Play (trigger locally)

- `cargo build` per tick is unworkable (multi-second cold starts plus
  recompile churn). Skip native scripts entirely.
- `cargo script` / `rust-script` exist but are version-flaky — don't
  recommend.
- Default: bash + `curl`. If the project ships a release binary
  (`target/release/<app>` or an installed CLI), call that — it reuses
  real domain logic without recompiling.

```bash
#!/usr/bin/env bash
set -euo pipefail

raw=$(cat || true)
[ -z "$raw" ] && raw='{}'
id=$(printf '%s' "$raw" | jq -r '.id // "demo-1"')
total=$(printf '%s' "$raw" | jq -r '.total // 4200')

# Prefer a project CLI if it exists, e.g. ./target/release/app produce --id "$id"
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

- Same approach: bash + `curl` + `jq` in a `while true; do ... sleep 1; done`.
- One `StatusReport` JSON line per tick on stdout.
- On read failure emit `state: "warn"` — keep looping.

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

- `cargo run` per tick recompiles on every source change — never use it
  inside a status loop.
- A prebuilt `target/release/<bin>` is fine to call from bash; the
  studio just needs the binary to be present before the flow runs.
- `cargo script` / `rust-script` toolchains break between Rust releases;
  avoid pinning the demo to them.
- `jq` is a soft dependency. Note it in WIKI if a teammate is on a
  machine without it.

## Fixture shape

```json
{ "id": "demo-1", "total": 4200 }
```
