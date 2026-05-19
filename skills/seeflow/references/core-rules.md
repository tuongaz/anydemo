# Core authoring rules

Three rules every flow must honour. Each is invariant — bend them and the flow either lies, looks wrong, or refuses to run.

## Rule 1 — no mocks, ever

**NEVER mock a service, fake a response, or simulate what a real service returns.**

Scripts have exactly two purposes:

1. **Trigger a real service** — call a real endpoint, drop a real file, publish a real event. Only invented content allowed is *input data* (fixture body, sample file); the service receiving it must be real.
2. **Read real resource state** — query a real DB, poll a real queue depth, call a real health endpoint. Never fabricate state.

If a required service is not running, **stop and ask the user**. A flow with one honest gap is better than one that silently lies.

## Rule 2 — see the bigger picture before inserting data

Before writing a play script that INSERTs into a DB, publishes to a queue, or writes to a store, check whether the system already has a natural data-entry path. Direct inserts bypass validation and the code paths the flow is meant to show.

Check these patterns first (ask the discoverer):

| Pattern | What to look for | Use instead |
|---|---|---|
| **API endpoint** | REST/gRPC/GraphQL endpoint that accepts the data | Call it |
| **File-drop processor** | File watcher / S3-event listener | Drop a fixture file into the watched path |
| **Event/message producer** | Publisher service or CLI that writes to the queue | Trigger the producer |
| **Seed / fixture command** | `make seed`, `bun run seed`, ORM factory | Run the seed command |
| **Webhook receiver** | `/webhooks/stripe`, `/events/github` | POST a synthetic webhook body |
| **Admin / backoffice API** | Internal endpoint for creating records | Use it |
| **File-based import** | CSV/JSON/NDJSON import endpoint or CLI | Drop a fixture or call the import endpoint |

Examples:

- Order pipeline needs an order in the DB → call `POST /api/orders`; the API validates, emits events, writes the row.
- Data-warehouse pipeline needs staging rows → drop a CSV into the watched S3 bucket; the file-processor picks it up.
- Notification system needs a queue message → call `POST /api/notify`; the producer publishes on your behalf.
- Recommendation engine needs user-event data → fire a `track` event at the analytics endpoint.

If no higher-level path exists, document the reason in `rationale` and resort to a direct INSERT/PUBLISH.

## Rule 3 — match the project's primary language

Use `runtimeProfile.primaryLanguage` from Phase 1 as the interpreter for every script. The project already has types, helpers, and clients in that language — reuse them.

| `primaryLanguage` | `interpreter` | `args` |
|---|---|---|
| `typescript` / `javascript` | `bun` | `["run"]` |
| `go` | `go` | `["run"]` |
| `python` | `python3` | `["-u"]` |
| `ruby` | `ruby` | `[]` |
| `java` / `kotlin` | `kotlinc` or `java` | depends on build tool |
| `rust` | `cargo` | `["script"]` (if available) |

### TypeScript example

```typescript
// .seeflow/checkout-flow/scripts/play-checkout.ts
import type { CartPayload } from "../../src/types";
const input: CartPayload = JSON.parse(await Bun.stdin.text());
const res = await fetch("http://localhost:3001/checkout", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify(input),
});
console.log(await res.json());
```

### Go example

```go
// .seeflow/order-flow/scripts/play-order.go
package main
import ("encoding/json"; "fmt"; "net/http"; "bytes"; "os")
func main() {
    var payload map[string]any
    json.NewDecoder(os.Stdin).Decode(&payload)
    body, _ := json.Marshal(payload)
    res, _ := http.Post("http://localhost:8080/orders", "application/json", bytes.NewReader(body))
    var out any; json.NewDecoder(res.Body).Decode(&out); fmt.Println(out)
}
```

**Fallback:** Use `bash` / `python3` only when the project runtime can't execute scripts directly. Note the reason in `rationale`.
