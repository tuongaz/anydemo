---
name: seeflow
description: Use when the user asks to create, generate, or scaffold a SeeFlow flow from a natural-language prompt — "create a flow", "show how X works", "diagram our checkout system", "add a flow to this repo". Orchestrates four sub-agents and bun scripts to write a registered, validated flow under <project>/.seeflow/<slug>/.
---

# seeflow

Turn a natural-language prompt into a registered, runnable SeeFlow flow under `<project>/.seeflow/<slug>/`. Orchestrate four sub-agents and bun scripts; never read the codebase directly.

## When to invoke

In any project, just run:

```
/seeflow Create a flow showing how the order pipeline works
/seeflow Show how checkout works end to end
/seeflow Diagram our event-driven notification system
/seeflow Add another flow to this repo
```

Ask for clarification only when the prompt is incoherent — never ask "what is your codebase?".

## Inputs you have

- The user's full natural-language prompt.
- The project root (`$PWD` at invocation).
- `~/.seeflow/config.json` (optional; studio host:port, default `http://localhost:4321`).
- Existing `<project>/.seeflow/<slug>/seeflow.json` files, if any (multi-flow per project supported).

## The pipeline

```
Phase 0 — pre-flight: studio reachable?
Phase 1 — seeflow-discoverer        → context brief (language + runtime + tests)
Phase 2 — seeflow-node-planner      → node draft
Phase 3 — write skeleton seeflow.json (nodes only) → register → user reviews canvas → approval
Phase 4 — seeflow-play-designer  ┐
          seeflow-status-designer├ parallel → overlays
                                 ┘
Phase 5 — synthesize → validate-schema
Phase 6 — write script files → re-register full flow
Phase 7 — validate-end-to-end.ts → trigger APIs → verify via SSE (retry up to 2x) → print URL on success / retry-or-stop on failure
```

Each phase is **gated** on the previous one.

---

## Core rule — no mocks, ever

**NEVER mock a service, fake a response, or simulate what a real service returns.**

Scripts have exactly two purposes:

1. **Trigger a real service** — call a real endpoint, drop a real file, publish a real event. Only invented content allowed is *input data* (fixture body, sample file); the service receiving it must be real.
2. **Read real resource state** — query a real DB, poll a real queue depth, call a real health endpoint. Never fabricate state.

If a required service is not running, **stop and ask the user**. A flow with one honest gap is better than one that silently lies.

---

## Core rule — see the bigger picture before inserting data

Before writing a play script that INSERTs into a DB, publishes to a queue, or writes to a store, check whether the system already has a natural data-entry path. Direct inserts bypass validation and the code paths the flow is meant to show.

**Check these patterns first (ask the discoverer):**

| Pattern | What to look for | Use instead |
|---|---|---|
| **API endpoint** | REST/gRPC/GraphQL endpoint that accepts the data | Call it |
| **File-drop processor** | File watcher / S3-event listener | Drop a fixture file into the watched path |
| **Event/message producer** | Publisher service or CLI that writes to the queue | Trigger the producer |
| **Seed / fixture command** | `make seed`, `bun run seed`, ORM factory | Run the seed command |
| **Webhook receiver** | `/webhooks/stripe`, `/events/github` | POST a synthetic webhook body |
| **Admin / backoffice API** | Internal endpoint for creating records | Use it |
| **File-based import** | CSV/JSON/NDJSON import endpoint or CLI | Drop a fixture or call the import endpoint |

**Examples:**

- Order pipeline needs an order in the DB → call `POST /api/orders`; the API validates, emits events, writes the row.
- Data-warehouse pipeline needs staging rows → drop a CSV into the watched S3 bucket; the file-processor picks it up.
- Notification system needs a queue message → call `POST /api/notify`; the producer publishes on your behalf.
- Recommendation engine needs user-event data → fire a `track` event at the analytics endpoint.

If no higher-level path exists, document the reason in `rationale` and resort to a direct INSERT/PUBLISH.

---

## Core rule — match the project's primary language

Use `runtimeProfile.primaryLanguage` from Phase 1 as the interpreter for every script. The project already has types, helpers, and clients in that language — reuse them.

| `primaryLanguage` | `interpreter` | `args` |
|---|---|---|
| `typescript` / `javascript` | `bun` | `["run"]` |
| `go` | `go` | `["run"]` |
| `python` | `python3` | `["-u"]` |
| `ruby` | `ruby` | `[]` |
| `java` / `kotlin` | `kotlinc` or `java` | depends on build tool |
| `rust` | `cargo` | `["script"]` (if available) |

**Examples:**

*TypeScript:*
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

*Go:*
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

**Fallback:** Use `bash`/`python3` only when the project runtime can't execute scripts directly. Note the reason in `rationale`.

---

## Phase 0 — pre-flight (studio reachable)

Resolve `$STUDIO_URL`: `SEEFLOW_STUDIO_URL` env var → `~/.seeflow/config.json` port → `http://localhost:4321`. Then follow **`references/start-studio.md`** — it probes `/health`, offers a Docker auto-start (with user approval, shows the exact command), and falls back to the CLI path on Docker failure or refusal.

On success: continue to Phase 1.

---

## General rule — parallelise sub-agents

Whenever two or more tasks are independent, dispatch them as concurrent sub-agents in a single message. Serial execution is the exception, not the default.

---

## After Phase 0 — list tasks

Create a `TaskCreate` checklist before launching any sub-agent:

```
[ ] Phase 1 — Discover codebase (language, runtime, integration tests)
[ ] Phase 2 — Plan nodes & connectors
[ ] Phase 3 — Register skeleton flow (nodes only) — await user node review
[ ] Phase 4 — Design Play + Status scripts (parallel)
[ ] Phase 5 — Synthesize & validate schema
[ ] Phase 6 — Write script files & re-register full flow
[ ] Phase 7 — End-to-end validation (trigger APIs, verify via SSE)
```

Mark each complete via `TaskUpdate` immediately after it succeeds.

---

## Phase 1 — discover

Launch `seeflow-discoverer` with the user's prompt, project root, and any existing `seeflow.json` for the matching slug. Tools: `Read, Grep, Glob, LS, Bash` (read-only).

Discoverer must:
- Identify primary language + runtime (`runtimeProfile`)
- Find integration/e2e tests and extract their setup pattern (ports, base URLs, payload shapes)

Expected output (parseable JSON):

```json
{
  "userIntent": "…",
  "audienceFraming": "…",
  "scope": { "rootEntities": ["…"], "outOfScope": ["…"] },
  "codePointers": [{ "path": "…", "why": "…" }],
  "runtimeProfile": {
    "primaryLanguage": "typescript",
    "packageManager": "bun",
    "devCommand": "bun run dev",
    "testCommand": "bun test",
    "servicePort": 3001,
    "integrationTestDir": "tests/integration",
    "integrationTestCommand": "bun test tests/integration",
    "setupPattern": "Tests call http://localhost:3001 with JSON payloads after starting the server"
  },
  "existingFlow": null
}
```

On unparseable output: retry once with the validation error. If still failing, surface and stop.

---

## Phase 2 — plan nodes

Launch `seeflow-node-planner` with the context brief. No tools — pure reasoning. Two mandatory passes:

- **Resource nodes first** — every DB, queue, event bus, cache, file store, and external SaaS touched by the flow gets its own `stateNode`.
- **Abstraction rules** — one node per service / workflow / worker / queue / DB (exceptions: independently-meaningful pipeline stages, fan-out consumers, branches).
- **Connection limit** — max **4 total connections** (in + out) per node. When exceeded:
  - **Split** if the node has distinct responsibilities.
  - **Duplicate** a shared resource to break hub-and-spoke patterns.

**Duplication for clarity** — the "one node per service" default can be overridden when showing the same resource twice improves readability (e.g. a shared DB placed next to each service that uses it). Use same `kind` + `name`; unique `id` with a descriptive suffix (`"orders-db-read"`, `"orders-db-write"`).

Expected output:

```json
{
  "name": "…",
  "slug": "…",
  "nodes": [{ "id": "…", "type": "…", "data": {…}, "oneNodeRationale": "…" }],
  "connectors": [{ "id": "…", "kind": "…", "source": "…", "target": "…" }]
}
```

Retry budget: one retry on unparseable output, then surface and stop.

---

## Phase 3 — node review checkpoint

Register a **skeleton** flow (nodes + connectors only, no scripts) so the user can review the canvas before any scripts are written.

Paths (used in this phase and Phase 6):
- `repoPath = $PWD`
- `flowDir = $PWD/.seeflow/<slug>`
- `flowPath = .seeflow/<slug>/seeflow.json`

1. Build skeleton JSON from node draft — omit `playAction`, `statusAction`, `resetAction`. Keep `version`, `name`, `nodes`, `connectors`.
2. `mkdir -p $flowDir` then write to `$flowDir/seeflow-nodes.json`.
3. Validate:
   ```bash
   bun skills/seeflow/scripts/validate-schema.ts "$flowDir/seeflow-nodes.json"
   ```
   On failure: fix field-level issues in-place (no re-run of node-planner), retry.
4. Write `$flowDir/seeflow.json` and register:
   ```bash
   bun skills/seeflow/scripts/register.ts --path "$repoPath" --flow "$flowPath"
   ```
   Stash the returned `id`.
5. Ask the user:
   > The nodes are live at `<url>`. Does the layout look right? Any additions, removals, or renames before I write the scripts?

**Wait** for response.
- **Approved** → Phase 4.
- **Changes requested** → re-run node-planner with feedback, repeat Phase 3.

---

## Phase 4 — design Play + Status (parallel)

Launch `seeflow-play-designer` and `seeflow-status-designer` **in parallel** (single message, two `Task` calls). Both receive: context brief + node draft + edit target. Tools: `Read, Grep, Glob, LS`.

`seeflow-play-designer` returns:

```json
{
  "playOverlays": [{
    "nodeId": "…",
    "playAction": { "kind": "script", "interpreter": "bun", "args": ["run"],
                    "scriptPath": "<slug>/scripts/<name>.ts",
                    "input": {…}, "timeoutMs": 30000 },
    "scriptBody": "…",
    "validationSafe": true,
    "rationale": "…"
  }],
  "newTriggerNodes": []
}
```

`seeflow-status-designer` returns:

```json
{
  "statusOverlays": [{
    "nodeId": "…",
    "statusAction": { "kind": "script", "interpreter": "bun", "args": ["run"],
                      "scriptPath": "<slug>/scripts/<name>.ts",
                      "maxLifetimeMs": 600000 },
    "scriptBody": "…",
    "rationale": "…"
  }]
}
```

**Sample data — look before inventing.** Priority:

1. Integration/e2e test fixtures (`runtimeProfile.integrationTestDir`) — copy verbatim.
2. Seed / migration fixtures (`seed.*`, `fixtures/`, `testdata/`, ORM factories).
3. README / OpenAPI / Postman examples.
4. Invent as last resort — note in `rationale`.

`newTriggerNodes` may inject synthetic source nodes (file-drop, webhook receiver) when no natural trigger exists.

---

## Phase 5 — synthesize + validate schema

1. **Splice** `newTriggerNodes` into `nodeDraft.nodes` (add any required connectors).
2. **Merge** each overlay onto its target node's `data`. Strip `validationSafe`, `rationale`, `scriptBody` — orchestrator metadata, not schema fields. Collect `nodeId`s where `validationSafe: false` into `unsafeNodeIds`.
3. **Write** merged flow to `$flowDir/seeflow-draft.json`.
4. **Validate:**

```bash
bun skills/seeflow/scripts/validate-schema.ts "$flowDir/seeflow-draft.json"
```

`{"ok":true}` → continue. `{"ok":false,"issues":[…]}` → feed issues back to the relevant designer, retry. **Max 3 retries**, then surface verbatim and stop.

5. Proceed to Phase 6 — node layout was approved in Phase 3.

---

## Phase 6 — write script files + re-register full flow

1. `mkdir -p $flowDir/scripts $flowDir/state`
2. Write files (overwriting the Phase 3 skeleton):
   - `$flowDir/seeflow.json` — validated flow JSON with all actions.
   - `$flowDir/scripts/<name>` — one file per overlay `scriptBody`. `chmod +x`.
   - `$flowDir/state/.gitignore` — `*`.
3. Re-register:

```bash
bun skills/seeflow/scripts/register.ts --path "$repoPath" --demo "$flowPath"
```

Prints `{id, slug}`. Use the new `id` for Phases 7 + 8.

On 400: show body, ask "fix-and-retry / stop". On other 4xx/5xx: show body, stop.

---

## Phase 7 — end-to-end validation

**Must run. Do not skip or simulate.**

```bash
bun skills/seeflow/scripts/validate-end-to-end.ts <id> [--skip-nodes <id1>,<id2>]
```

Pass `--skip-nodes` when `unsafeNodeIds` is non-empty (nodes that hit third-party services or charge money). Skipped nodes appear in `skipped[]` and are not counted as failures.

The script:
- GETs `/api/demos/<id>` (expects 200, `valid: true`).
- Opens SSE at `/api/events?demoId=<id>` before triggering plays.
- POSTs `/api/demos/<id>/play/<nodeId>` for each safe play node; awaits response.
- Drains SSE for `node:done` / `node:error` / `node:status` events. SSE outcome takes precedence.
- Hard ceiling: ~2 minutes. Emits `{ok, plays, statuses, skipped}`.

**Interpret the JSON.** On `ok: true` → print `Flow "<name>" registered as <slug>. Open: $STUDIO_URL/d/<slug>`. Done. On `ok: false`:

1. Identify failing nodes from `plays[*].error` / `statuses[*].outcome`.
2. Propose a concrete fix ("play-checkout.ts: `ECONNREFUSED` on port 3001 — start the app first").
3. Dispatch one sub-agent per failing script **in parallel**.
4. Edit scripts in-place, re-run Phase 7 against the same `<id>`. **Max 2 retries**, then ask `retry / stop`.

Never re-run `register.ts` in the fix-up loop.

---

## Error-handling table

| Failure | Response |
|---|---|
| Studio `/health` fails | Follow `references/start-studio.md`: ask user about Docker auto-start, fall back to CLI on Docker refusal/failure. No silent retry. |
| Sub-agent unparseable output | Retry once with parse error; if still failing, surface and stop. |
| Schema validation fails (Phase 5) | Feed Zod issues back to relevant designer. Max 3 retries. |
| Register 400 (Phase 6) | Show body; ask "fix-and-retry / stop". |
| Register 4xx/5xx other | Show body; stop. |
| Play `{error: "…"}` (Phase 7) | Edit scripts in-place; re-run Phase 7 (max 2 retries). Do NOT re-register. |
| Status SSE timeout 10s | Mark `no status received`; include in fix-up or ask retry/stop. |
| Validation >2 min | `ok:false`; treat as failure → fix-up path. |

Retry caps: Phase 5 schema → **3**. Phase 7 fix-up → **2**.

---

## Schema cheatsheet

Full schema: `skills/seeflow/vendored/schema.ts`. Below covers ~95% of cases.

### Flow envelope

```json
{
  "version": 1,
  "name": "Checkout Flow",
  "nodes": [ …NodeSchema… ],
  "connectors": [ …ConnectorSchema… ],
  "resetAction": { "kind": "script", "interpreter": "bun", "args": ["run"],
                   "scriptPath": "<slug>/scripts/reset.ts" }
}
```

`resetAction` is optional — include only if the app has a "wipe state" entrypoint.

### Node types

**playNode** — has a clickable Play button. Required: `name`, `kind`, `stateSource`, `playAction`. Optional: `statusAction`, `description` (≤ 15 words), `detail`.

**RULE — detail on important nodes:** Every `playNode` and `stateNode` that carries meaningful behaviour MUST include a `detail` field. `detail` renders as **markdown** — use it to explain what the node does, what it emits, why it matters, sample payloads, links to source files, or anything an audience member would ask. Decorative `shapeNode`/`iconNode` entries are exempt.

**RULE — icon on important nodes:** Every `playNode` and `stateNode` SHOULD include an `icon` field — a kebab-case Lucide icon name that visually echoes the kind. Renders left of the name. Decorative; not a status indicator.

`kind`: `service`, `endpoint`, `worker`, `workflow`, `queue`, `topic`, `bus`, `db`, `store`, `cache`, `scheduler`, `external-api`, `trigger`.

| `kind` | suggested `icon` |
|---|---|
| `service` | `server` |
| `endpoint` | `plug` |
| `worker` | `cog` |
| `workflow` | `git-branch` |
| `queue` | `list-ordered` |
| `topic` / `bus` | `radio-tower` |
| `db` | `database` |
| `store` | `archive` |
| `cache` | `zap` |
| `scheduler` | `clock` |
| `external-api` | `cloud` |
| `trigger` | `play` |

```json
{
  "id": "checkout-api", "type": "playNode", "position": { "x": 100, "y": 200 },
  "data": {
    "name": "POST /checkout", "kind": "service",
    "icon": "server", // kind=service → server (see kind→icon table above)
    "stateSource": { "kind": "request" },
    "playAction": { "kind": "script", "interpreter": "bun", "args": ["run"],
                    "scriptPath": "checkout-flow/scripts/play-checkout.ts",
                    "input": { "items": [{"sku":"ABC","qty":1}] },
                    "timeoutMs": 30000 },
    "description": "Receives a cart, creates an order.",
    "detail": "Validates the cart, reserves stock, and publishes an `order.created` event.\n\n**Emits:** `order.created` → Order Worker\n\n**Source:** `src/routes/checkout.ts`"
  }
}
```

**stateNode** — no mandatory Play; audience watches but doesn't trigger. Same `kind` values.

```json
{
  "id": "order-db", "type": "stateNode", "position": { "x": 600, "y": 200 },
  "data": {
    "name": "Orders DB", "kind": "db",
    "icon": "database",
    "stateSource": { "kind": "event" },
    "statusAction": { "kind": "script", "interpreter": "bun", "args": ["run"],
                      "scriptPath": "checkout-flow/scripts/status-orders.ts",
                      "maxLifetimeMs": 600000 },
    "detail": "Postgres table `orders`. Rows land here after `order.created` is processed.\n\n**Schema:** `id`, `status`, `total`, `created_at`\n\n**Source:** `src/db/migrations/001_orders.sql`"
  }
}
```

**shapeNode** — decorative / illustrative. No actions or live state.

| `shape` | Renders as | Best for |
|---|---|---|
| `database` | Cylinder | DB label (use `stateNode` when monitoring) |
| `server` | Server rack | On-premise server or compute |
| `user` | Person silhouette | Human actor / customer |
| `queue` | Stack | Queue label (decorative) |
| `cloud` | Cloud outline | External SaaS |
| `rectangle` | Box | Grouping boundary |
| `ellipse` | Oval | Annotation |
| `sticky` | Sticky note | Callout |
| `text` | Plain text | Canvas label |

```json
{ "id": "customer", "type": "shapeNode", "position": { "x": 0, "y": 200 },
  "data": { "shape": "user", "name": "Customer" } }

{ "id": "stripe", "type": "shapeNode", "position": { "x": 800, "y": 200 },
  "data": { "shape": "cloud", "name": "Stripe", "borderStyle": "dashed" } }

{ "id": "boundary", "type": "shapeNode", "position": { "x": 50, "y": 50 },
  "data": { "shape": "rectangle", "name": "Internal services", "borderStyle": "dashed" } }
```

**iconNode** — single Lucide glyph. Decorative only.

```json
{ "id": "user-icon", "type": "iconNode", "position": { "x": 0, "y": 200 },
  "data": { "icon": "User", "name": "Customer", "width": 64, "height": 64 } }
```

**htmlNode** — escape-hatch for content no curated node covers: legends, data tables, rich annotations, custom UI widgets. Renderer fetches the HTML file, injects Tailwind Play CDN (utility classes work), then **sanitises before painting** (strips `<script>`, `<style>`, `<iframe>`, `on*=` attributes, `javascript:` URLs).

**Required fields:**
- `htmlPath` — relative path under `.seeflow/`. No leading `/`, no `..`. E.g. `checkout-flow/legend.html`.

**Optional styling fields (same as shapeNode):**
`width`, `height`, `backgroundColor`, `borderColor`, `borderSize`, `borderStyle`, `cornerRadius`, `fontSize`, `textColor`, `name` (caption below node), `description`, `detail`, `icon`

**Default size:** 320 × 200 px. Set `width`/`height` to override.

```json
{ "id": "legend", "type": "htmlNode", "position": { "x": 50, "y": 600 },
  "data": {
    "htmlPath": "checkout-flow/legend.html",
    "width": 400, "height": 120,
    "backgroundColor": "slate",
    "cornerRadius": 8,
    "name": "Legend"
  }
}
```

**HTML file** — write to `$flowDir/<name>.html`. Tailwind classes work; no `<script>` or `<style>` (stripped by sanitiser). Use inline styles for anything Tailwind can't cover. See `references/examples/html-node-example.html`.

**When NOT to use:** If a `shapeNode` with a label, an `iconNode`, or a `stateNode` covers the content, prefer those — they participate in theming and status updates automatically.

**imageNode** — decorative image under `.seeflow/`.

```json
{ "id": "logo", "type": "imageNode", "position": { "x": 0, "y": 0 },
  "data": { "path": "checkout-flow/logo.png", "alt": "Stripe logo" } }
```

### Connectors

Required: `id`, `source`, `target`, `kind`.

```json
{ "id": "c1", "kind": "http",    "source": "checkout-api", "target": "payments",
  "method": "POST", "url": "/charge", "label": "POST /charge" }
{ "id": "c2", "kind": "event",   "source": "checkout-api", "target": "shipping-worker",
  "eventName": "order.created" }
{ "id": "c3", "kind": "queue",   "source": "checkout-api", "target": "fulfil-queue",
  "queueName": "fulfilment-jobs" }
{ "id": "c4", "kind": "default", "source": "user-icon",    "target": "checkout-api",
  "label": "clicks checkout" }
```

Optional visual fields (all kinds): `style` (`solid|dashed|dotted`), `direction` (`forward|backward|both|none`), `path` (`curve|step`), `color`, `borderSize`, `fontSize`, `label`, `sourceHandle`/`targetHandle` (`r|b` / `t|l`).

### `stateSource`

```json
{ "kind": "request" }   // triggered by an explicit click/call
{ "kind": "event" }     // fires reactively (consumer, worker, DB, watcher)
```

### `playAction` / `statusAction` / `resetAction`

```json
{ "kind": "script", "interpreter": "bun", "args": ["run"],
  "scriptPath": "<slug>/scripts/<file>.ts", "input": {…optional…},
  "timeoutMs": 30000 }
```

- `scriptPath` — relative under `.seeflow/`. No leading slash, no `..`.
- `interpreter` — must match `runtimeProfile.primaryLanguage`. Values: `bun`, `go`, `python3`, `node`, `bash`.
- `input` (playAction) — JSON-serialised, piped to stdin.
- `timeoutMs` (playAction; max 600 000) — **be generous:**
  - Simple HTTP call → 15 000 ms.
  - Go / Rust (compile on first run) → 60 000–120 000 ms.
  - Java / Kotlin (JVM startup) → 120 000 ms minimum.
  - DB seeding / migrations → 60 000 ms minimum.
- `maxLifetimeMs` (statusAction; max 3 600 000) — default 600 000; bump to 1 800 000 for long async flows.

### `StatusReport` (stdout line shape)

```json
{ "state": "ok|warn|error|pending", "summary": "…(≤120)…",
  "detail": "…(≤2000)…", "data": {…free…}, "ts": 1700000000000 }
```

Malformed lines are silently dropped. Emit one full JSON object per line.

---

## Sub-agent reference

| Agent | Tools | Used for |
|---|---|---|
| `seeflow-discoverer` | `Read, Grep, Glob, LS, Bash` (read-only) | Phase 1: explore codebase, return context brief |
| `seeflow-node-planner` | none (pure reasoning) | Phase 2: pick nodes + connectors |
| `seeflow-play-designer` | `Read, Grep, Glob, LS` | Phase 4: design playActions + script bodies |
| `seeflow-status-designer` | `Read, Grep, Glob, LS` | Phase 4: design statusActions + script bodies |

Full prompts + worked examples in `skills/seeflow/agents/<agent>.md`.

## Studio API touchpoints

| Endpoint | Method | Phase | Body |
|---|---|---|---|
| `/health` | GET | 0 | — |
| `/api/demos/register` | POST | 3, 6 | `{name, repoPath, demoPath}` |
| `/api/demos/:id` | GET | 7 | — |
| `/api/demos/:id/play/:nodeId` | POST | 7 | — |
| `/api/events?demoId=:id` | GET (SSE) | 7 | — |
| `/api/demos/:id` | DELETE | rollback only | — |

Never invent endpoints. Surface anything outside this table to the user.
