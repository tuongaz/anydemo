---
techId: python
category: language
---

# Python

> **General guidance only.** Check `<project>/.seeflow/WIKI.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- Languages don't drive node modelling; consult the tech-specific refs
  (`tech/postgres.md`, `tech/google-pubsub.md`, etc.) for resource node
  guidance.
- Interpreter wiring: `playAction.interpreter: "python3"` with
  `args: ["-u"]` — **`-u` (unbuffered) is mandatory** for status scripts;
  use it for play too for consistency.

## Play (trigger locally)

- Use `requests` if the project already imports it; otherwise stick to
  stdlib `urllib.request` — don't add a dependency for one POST.
- Read stdin with `json.loads(sys.stdin.read() or "{}")`.
- Call the project's resolved interpreter (from
  `runtimeProfile.devCommand`) — virtualenvs and `python` vs `python3`
  matter; on macOS bare `python` often doesn't exist.

```python
#!/usr/bin/env python3
import json, sys, urllib.request

try:
    raw = sys.stdin.read() or "{}"
    payload = json.loads(raw)
    order_id = payload.get("id") or "demo-1"
    body = json.dumps({"id": order_id, "total": 4200}).encode()
    req = urllib.request.Request(
        "http://localhost:8080/orders",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        if resp.status >= 300:
            print(f"http {resp.status}", file=sys.stderr)
            sys.exit(1)
    print(json.dumps({"ok": True, "id": order_id}), flush=True)
except Exception as e:
    print(f"play failed: {e}", file=sys.stderr)
    sys.exit(1)
```

## Status (read locally)

- Loop with `time.sleep(1)`; one read per tick.
- Always `flush=True` on the print (belt-and-braces alongside `-u`).
- Catch the read exception, emit `state: "warn"`, keep ticking.

```python
#!/usr/bin/env python3
import json, sys, time, urllib.request

while True:
    state, summary, data = "ok", "0 orders", {"count": 0}
    try:
        with urllib.request.urlopen("http://localhost:8080/orders/count", timeout=2) as resp:
            body = json.loads(resp.read() or b"{}")
            count = int(body.get("count", 0))
            data["count"] = count
            summary = f"{count} orders"
    except Exception as e:
        state, summary = "warn", str(e)
    report = {"state": state, "summary": summary, "data": data, "ts": int(time.time())}
    print(json.dumps(report), flush=True)
    time.sleep(1)
```

## Gotchas

- `-u` is non-negotiable for status scripts. Without it, stdout buffers
  and the UI hangs with no events for minutes.
- Virtualenv vs system Python: read `runtimeProfile.devCommand` to pick
  the right binary. Don't hardcode `/usr/bin/python3`.
- On macOS `python` may not resolve; always use `python3`.
- `requests` is not stdlib — only use it if the project already has it.

## Fixture shape

```json
{ "id": "demo-1", "total": 4200 }
```
