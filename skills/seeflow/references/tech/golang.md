---
techId: golang
category: language
---

# Go

> **General guidance only.** Check the shared `<host>/.seeflow/LEARN.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- Languages don't drive node modelling; consult the tech-specific refs
  (`tech/postgres.md`, `tech/google-pubsub.md`, etc.) for resource node
  guidance.
- Interpreter wiring: `playAction.interpreter: "go"` with
  `args: ["run"]` — the studio appends the script path.

## Play (trigger locally)

- Single-file `package main`. Reuse the project's HTTP client / repo
  helpers if grep finds one inside the module.
- Read fixture from stdin with `io.ReadAll(os.Stdin)`; tolerate empty.
- Make it idempotent: derive the key from fixture or a stable hash, not
  `time.Now()` alone, so repeat runs collide cleanly.

```go
package main

import (
	"bytes"; "encoding/json"; "fmt"; "io"; "net/http"; "os"
)

func main() {
	raw, _ := io.ReadAll(os.Stdin)
	if len(raw) == 0 { raw = []byte("{}") }
	var in map[string]any
	_ = json.Unmarshal(raw, &in)
	id, _ := in["id"].(string)
	if id == "" { id = "demo-1" }
	body, _ := json.Marshal(map[string]any{"id": id, "total": 4200})
	resp, err := http.Post("http://localhost:8080/orders", "application/json", bytes.NewReader(body))
	if err != nil { fmt.Fprintln(os.Stderr, "post failed:", err); os.Exit(1) }
	defer resp.Body.Close()
	if resp.StatusCode >= 300 { fmt.Fprintln(os.Stderr, "http", resp.Status); os.Exit(1) }
	out, _ := json.Marshal(map[string]any{"ok": true, "id": id})
	fmt.Println(string(out))
}
```

## Status (read locally)

- Loop with `time.Sleep`; one HTTP/DB read per tick.
- Marshal a `StatusReport` and `fmt.Println` it (one JSON object per line).
- On read failure, emit `state: "warn"` and keep ticking — never `panic`.

```go
package main

import (
	"encoding/json"; "fmt"; "io"; "net/http"; "time"
)

func main() {
	for {
		state, summary := "ok", "0 orders"
		data := map[string]any{"count": 0}
		resp, err := http.Get("http://localhost:8080/orders/count")
		if err != nil {
			state, summary = "warn", err.Error()
		} else {
			b, _ := io.ReadAll(resp.Body); resp.Body.Close()
			var r struct{ Count int `json:"count"` }
			_ = json.Unmarshal(b, &r)
			data["count"] = r.Count
			summary = fmt.Sprintf("%d orders", r.Count)
		}
		out, _ := json.Marshal(map[string]any{"state": state, "summary": summary, "data": data, "ts": time.Now().Unix()})
		fmt.Println(string(out))
		time.Sleep(1 * time.Second)
	}
}
```

## Gotchas

- `go run` startup is ~200ms — fine for play, OK for status at 1s ticks
  but don't go sub-second.
- Module path quirks: if the script lives outside a `go.mod`, `go run`
  fails. Prefer putting scripts inside the project's module, or drop a
  tiny standalone `nodes/<nodeId>/scripts/go.mod`.
- `fmt.Println` to stdout is your JSON channel — never log to stdout from
  helper packages; route logs to `os.Stderr`.

## Fixture shape

```json
{ "id": "demo-1", "total": 4200 }
```
