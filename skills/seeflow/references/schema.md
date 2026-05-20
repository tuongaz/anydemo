# Schema cheatsheet — `flow.json` + `style.json`

The on-disk format is split into **two files that are BOTH mandatory** for every flow:

- **`flow.json`** — pure semantic data. What the studio + LLM read. Strict schema, validated by `POST /api/validate`.
- **`style.json`** — keyed map of presentation overrides by node/connector id. **Required** for every flow this skill creates. At minimum it carries one `position` entry per functional node id so the canvas doesn't pile every node at `(0,0)`. Additional visual fields are optional per entry.

The merged ResolvedFlow over the API (`GET /api/flows/:id`) is the flow + style baked together (positions, visual fields all merged onto each node).

**RULE — never skip `style.json`.** A flow without `style.json` renders unusable. When creating a new flow, always emit both files in the same write step. When editing, refresh `style.json` to cover new node ids before re-registering.

## `file://` substitution

Any string in `flow.json` may use `file://<relative-path>` to offload content to a separate file under `<project>/.seeflow/`. Recommended for `detail` when it exceeds ~200 chars.

```json
// flow.json
{ "data": { "detail": "file://details/checkout-api.md" } }

// .seeflow/details/checkout-api.md
## POST /checkout

Validates the cart, reserves stock, publishes `order.created`.
```

Path syntax: relative under `.seeflow/`, no leading `/`, no `..`. Missing files render as a `[seeflow: missing file '…']` placeholder card; the flow still loads.

**RULE — prefer file refs for long detail.** When a node's `detail` would exceed ~200 chars, write it to `<slug>/details/<nodeId>.md` and set `"detail": "file://<slug>/details/<nodeId>.md"`. Keeps flow.json compact for LLM consumption.

## `flow.json` envelope

```json
{
  "version": 2,
  "name": "Checkout Flow",
  "nodes": [ …node data only… ],
  "connectors": [ …connector data only… ],
  "resetAction": { "kind": "script", "interpreter": "bun", "args": ["run"],
                   "scriptPath": "<slug>/scripts/reset.ts" }
}
```

`resetAction` is optional — include only if the app has a "wipe state" entrypoint.

## `style.json` envelope (mandatory)

```json
{
  "nodes": {
    "checkout-api": {
      "position": { "x": 100, "y": 200 },
      "width": 240, "height": 120,
      "borderColor": "blue", "fontSize": 14
    }
  },
  "connectors": {
    "c1": { "sourceHandle": "r", "targetHandle": "l", "style": "dashed", "color": "blue" }
  }
}
```

Every functional node id in `flow.json` MUST appear under `nodes` with at least a `position`. A missing connector entry → handle/style defaults apply. Do not delete `style.json` even if the only content is positions — the studio relies on it.

### Position + handle generation

Positions and connector handles come from `POST /api/flows/<id>/layout`. The studio reads `flow.json` from disk, runs ELK, and writes `style.json` adjacent to it — the skill never authors that file directly. The skill hits this endpoint after register (Phase 3), after each splice (Phase 5), and after the final Phase 7 dry-run. The endpoint runs ELK's layered Sugiyama algorithm with generous spacing for connector labels (220 px between layers, 140 px between siblings) and assigns handles geometrically — `sourceHandle: 'r' → targetHandle: 'l'` for forward edges, `'b' → 't'` for vertical or back-edges.

Do not author positions by hand. Manual entries in `style.json` are still honoured at render time if a user drags a node in the canvas, but the skill always overwrites them on the next `/seeflow` run for that slug.

## Node types

### `playNode`

Has a clickable Play button. Required: `name`, `kind`, `stateSource`, `playAction`. Optional: `statusAction`, `description` (≤ 15 words), `detail`.

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

```jsonc
// flow.json — semantic node data only (no position, no visual fields)
{
  "id": "checkout-api", "type": "playNode",
  "data": {
    "name": "POST /checkout", "kind": "service",
    "icon": "server",
    "stateSource": { "kind": "request" },
    "playAction": { "kind": "script", "interpreter": "bun", "args": ["run"],
                    "scriptPath": "checkout-flow/scripts/play-checkout.ts",
                    "input": { "items": [{"sku":"ABC","qty":1}] },
                    "timeoutMs": 30000 },
    "description": "Receives a cart, creates an order.",
    "detail": "file://details/checkout-api.md"
  }
}

// style.json
{ "nodes": { "checkout-api": { "position": { "x": 100, "y": 200 } } } }
```

### `stateNode`

No mandatory Play; audience watches but doesn't trigger. Same `kind` values as `playNode`.

```jsonc
// flow.json
{
  "id": "order-db", "type": "stateNode",
  "data": {
    "name": "Orders DB", "kind": "db",
    "icon": "database",
    "stateSource": { "kind": "event" },
    "statusAction": { "kind": "script", "interpreter": "bun", "args": ["run"],
                      "scriptPath": "checkout-flow/scripts/status-orders.ts",
                      "maxLifetimeMs": 600000 },
    "detail": "file://details/order-db.md"
  }
}

// style.json
{ "nodes": { "order-db": { "position": { "x": 600, "y": 200 } } } }
```

### `shapeNode`

Decorative / illustrative. No actions or live state.

| `shape` | Renders as | Best for |
|---|---|---|
| `database` | Cylinder | DB label (use `stateNode` when monitoring) |
| `server` | Server rack | On-premise server or compute |
| `user` | Person silhouette | Human actor — **only when the human action is itself part of the demo** (UX click-through, support-agent workflow). Never as a generic "start" for backend / pipeline flows. |
| `queue` | Stack | Queue label (decorative) |
| `cloud` | Cloud outline | External SaaS |
| `rectangle` | Box | Grouping boundary |
| `ellipse` | Oval | Annotation |
| `sticky` | Sticky note | Callout |
| `text` | Plain text | Canvas label |

```jsonc
// flow.json
{ "id": "customer", "type": "shapeNode",
  "data": { "shape": "user", "name": "Customer" } }
{ "id": "stripe", "type": "shapeNode",
  "data": { "shape": "cloud", "name": "Stripe" } }

// style.json
{
  "nodes": {
    "customer": { "position": { "x": 0, "y": 200 } },
    "stripe":   { "position": { "x": 800, "y": 200 }, "borderStyle": "dashed" }
  }
}
```

### `iconNode`

Single Lucide glyph. Decorative only.

```json
{ "id": "user-icon", "type": "iconNode", "position": { "x": 0, "y": 200 },
  "data": { "icon": "User", "name": "Customer", "width": 64, "height": 64 } }
```

### `htmlNode`

Escape-hatch for content no curated node covers: legends, data tables, rich annotations, custom UI widgets. The studio externalizes the content to `<project>/.seeflow/nodes/<id>/view.html` and stores a `file://` ref in `flow.json`; the renderer injects Tailwind Play CDN (utility classes work) and **sanitises before painting** (strips `<script>`, `<style>`, `<iframe>`, `on*=` attributes, `javascript:` URLs).

**Fields:**
- `html` (optional) — inline HTML content. Pass the markup as a string when calling `seeflow_add_node` / `seeflow_patch_node`; the studio writes it to `nodes/<id>/view.html` and persists `data.html = "file://nodes/<id>/view.html"`. On read the value is inlined back to the actual HTML string. Omitting `html` writes an empty file.

**Optional styling fields (same as shapeNode):**
`width`, `height`, `backgroundColor`, `borderColor`, `borderSize`, `borderStyle`, `cornerRadius`, `fontSize`, `textColor`, `name` (caption below node), `description`, `detail`, `icon`

**Default size:** 320 × 200 px.

```json
{ "id": "legend", "type": "htmlNode", "position": { "x": 50, "y": 600 },
  "data": {
    "html": "<div class=\"p-4\">…legend markup…</div>",
    "width": 400, "height": 120,
    "backgroundColor": "slate",
    "cornerRadius": 8,
    "name": "Legend"
  }
}
```

Tailwind classes work; no `<script>` or `<style>` (stripped by sanitiser). Inline styles for anything Tailwind can't cover. To edit the markup outside Claude, open `<project>/.seeflow/nodes/<id>/view.html` directly — saves trigger a live reload.

**When NOT to use:** If a `shapeNode` with a label, an `iconNode`, or a `stateNode` covers the content, prefer those — they participate in theming and status updates automatically.

### `imageNode`

Decorative image. Uploads land in the node's own folder: `<project>/.seeflow/nodes/<id>/<filename>`, and `data.path` must start with that folder. The studio's per-node upload endpoint enforces this; `delete_node` cascades the folder cleanup.

```json
{ "id": "node-Logo01abcd", "type": "imageNode", "position": { "x": 0, "y": 0 },
  "data": { "path": "nodes/node-Logo01abcd/logo.png", "alt": "Stripe logo" } }
```

## Connectors

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

## `stateSource`

```json
{ "kind": "request" }   // triggered by an explicit click/call
{ "kind": "event" }     // fires reactively (consumer, worker, DB, watcher)
```

## `playAction` / `statusAction` / `resetAction`

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

## `StatusReport` (stdout line shape)

```json
{ "state": "ok|warn|error|pending", "summary": "…(≤120)…",
  "detail": "…(≤2000)…", "data": {…free…}, "ts": 1700000000000 }
```

Malformed lines are silently dropped. Emit one full JSON object per line.
