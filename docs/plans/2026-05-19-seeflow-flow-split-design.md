# SeeFlow Flow Split: `architecture.json` + `style.json`

**Status:** Design approved, ready to plan implementation.
**Date:** 2026-05-19

## Goal

Split today's single `seeflow.json` into two files on disk:

- **`architecture.json`** — pure semantic data (nodes, connectors, behavior). Cheap for an LLM to read.
- **`style.json`** — presentation (layout + visuals), keyed by node/connector id.

Plus: any string field in `architecture.json` may use a `file://` reference to offload content to a separate file (markdown, code blocks, etc.), keeping the architecture file compact and giving authors real files to edit.

Side benefit: retire the legacy `Demo*` vocabulary in favor of `Flow*` to match the product name and skill terminology.

## Non-goals

- No backwards compatibility. Existing demos will be wiped and re-authored.
- No multi-flow-per-project change. Each project still has one flow.
- No web/canvas UI change. The split is transparent over the API.

---

## 1. On-disk file shape

```
<project>/
  .seeflow/
    architecture.json          # nodes + connectors + data (LLM-readable)
    style.json                 # optional; layout + visuals, keyed by id
    details/                   # convention: file:// targets for prose
      post-orders.md
    blocks/                    # existing: htmlNode payloads
      <htmlNode-id>.html
    sdk-emit.ts                # unchanged
```

### `architecture.json`

```jsonc
{
  "version": 2,
  "name": "Order Pipeline",
  "resetAction": { ... },                // optional, unchanged shape
  "nodes": [
    {
      "id": "post-orders",
      "type": "playNode",                // discriminator unchanged
      "data": {
        "name": "POST /orders",          // identity
        "kind": "service",
        "stateSource": { "kind": "request" },
        "icon": "database-icon",         // semantic (which lucide glyph)
        "playAction": { ... },           // behavior
        "statusAction": { ... },
        "description": "Creates order.", // free text (file:// allowed)
        "detail": "file://details/post-orders.md"
      }
    }
  ],
  "connectors": [
    { "id": "c1", "source": "post-orders", "target": "inventory-service",
      "kind": "event", "eventName": "order.created", "label": "new order" }
  ]
}
```

### `style.json` (optional)

```jsonc
{
  "nodes": {
    "post-orders": {
      "position": { "x": -182, "y": 139 },
      "width": 201, "height": 118,
      "borderColor": "green", "borderSize": 1,
      "fontSize": 15,
      "locked": false
    }
  },
  "connectors": {
    "c1": {
      "sourceHandle": "r", "targetHandle": "l",
      "sourceHandleAutoPicked": true,
      "sourcePin": { "side": "right", "t": 0.5 },
      "style": "dashed", "color": "blue",
      "direction": "forward", "borderSize": 1, "path": "curve", "fontSize": 11
    }
  }
}
```

### Field placement

| Field | architecture.json | style.json |
|---|---|---|
| Node `id`, `type` | ✅ | — |
| Node `data.name`, `data.kind`, `data.stateSource`, `data.handlerModule`, `data.icon` | ✅ | — |
| Node `data.playAction`, `data.statusAction` | ✅ | — |
| Node `data.description`, `data.detail` | ✅ | — |
| Node `data.shape` (shapeNode), `data.htmlPath` (htmlNode), `data.path` (imageNode), `data.alt`, `data.icon` (iconNode) | ✅ | — |
| Node `position` | — | ✅ |
| Node `width`, `height`, `borderColor`, `backgroundColor`, `borderSize`, `borderStyle`, `fontSize`, `textColor`, `cornerRadius`, `locked` | — | ✅ |
| Node `borderWidth` (imageNode), `color`/`strokeWidth` (iconNode), `autoSize` (htmlNode) | — | ✅ |
| Connector `id`, `source`, `target`, `kind`, `eventName`, `queueName`, `method`, `url`, `label` | ✅ | — |
| Connector `sourceHandle`, `targetHandle`, `sourceHandleAutoPicked`, `targetHandleAutoPicked`, `sourcePin`, `targetPin` | — | ✅ |
| Connector `style`, `color`, `direction`, `borderSize`, `path`, `fontSize` | — | ✅ |

Rule: anything render-only goes to `style.json`. The `name`/`version`/`resetAction` envelope and all semantic content stay in `architecture.json`.

### `style.json` is optional

Missing file or missing per-id entry → defaults apply. Lets an LLM emit a flow with just `architecture.json` and have the studio auto-lay-out and write `style.json` on first save.

---

## 2. `file://` resolution

### Substitution rules

- Applies to **any string value** in `architecture.json` after JSON-parse, **before** schema validation.
- A walker traverses every string leaf; values starting with `file://` are replaced with the file's UTF-8 contents.
- Path syntax: `file://<relative-path>` rooted at `<project>/.seeflow/`. Same `isCleanRelativePath` refine as `htmlPath` / `imageNode.path` (no leading `/`, no `..`, no drive prefix).
- Path safety: resolver rejects symlink escapes via `realpathSync` before reading (same defense the proxy/status-runner uses for `scriptPath`).
- Suggested convention (not enforced): studio writes prose to `details/<nodeId>.md`, mirroring the existing `blocks/<id>.html` pattern.

### Missing / invalid target

- Missing file → resolver substitutes a placeholder marker string: `[seeflow: missing file 'details/foo.md']`. Schema parse still succeeds; the sidebar renders this as a placeholder card (mirrors htmlNode US-014 behavior).
- Path-safety violations (absolute, `..`, drive prefix) → resolver substitutes `[seeflow: invalid file:// path '...']`. Schema parse still succeeds — author sees the error in the UI rather than the flow refusing to load.

### Watching

- Every successfully-resolved `file://` path is added to the existing `referencedPaths` set in `watcher.ts` (next to `htmlPath` / `imageNode.path`).
- A change to any referenced file → debounced re-resolve → broadcast `flow:reload` so the sidebar re-renders with fresh content. Same machinery as today.

### What it does NOT do

- No write-side rewriting. If the user PATCHes `detail` to a new string, it's written verbatim to architecture.json — the studio doesn't auto-create a file or replace inline content with a `file://` reference. That's an authoring choice.
- No recursion. `file://` content is treated as text, not further resolved.

---

## 3. Zod schemas + read merge

### Schemas (`apps/studio/src/schema.ts`)

```ts
// Architecture: pure data
const ArchitectureNodeDataBaseSchema = z.object({
  name: z.string().min(1),
  kind: z.string().min(1),
  stateSource: StateSourceSchema,
  handlerModule: z.string().optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
  detail: z.string().optional(),
  // NodeVisualBaseShape is GONE here.
});

// PlayNode / StateNode / ShapeNode / ImageNode / IconNode / HtmlNode keep
// their identity fields (shape, htmlPath, alt, name, etc.) and drop visual fields.

export const ArchitectureSchema = z.object({
  version: z.literal(2),
  name: z.string().min(1),
  resetAction: ResetActionSchema.optional(),
  nodes: z.array(ArchitectureNodeSchema),
  connectors: z.array(ArchitectureConnectorSchema),
}).superRefine(/* same connector→node referential check */);

// Style: keyed map, every field optional
const NodeStyleSchema = z.object({
  position: PositionSchema.optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  borderColor: ColorTokenSchema.optional(),
  // ... all NodeVisualBaseShape fields, plus
  // imageNode borderWidth, iconNode color/strokeWidth, htmlNode autoSize
}).strict();

const ConnectorStyleEntrySchema = z.object({
  sourceHandle: SourceHandleIdSchema.optional(),
  targetHandle: TargetHandleIdSchema.optional(),
  sourceHandleAutoPicked: z.boolean().optional(),
  targetHandleAutoPicked: z.boolean().optional(),
  sourcePin: EdgePinSchema.optional(),
  targetPin: EdgePinSchema.optional(),
  style: ConnectorStyleSchema.optional(),
  color: ColorTokenSchema.optional(),
  direction: ConnectorDirectionSchema.optional(),
  borderSize: z.number().positive().optional(),
  path: ConnectorPathSchema.optional(),
  fontSize: z.number().positive().optional(),
}).strict();

export const StyleSchema = z.object({
  nodes: z.record(z.string(), NodeStyleSchema).optional(),
  connectors: z.record(z.string(), ConnectorStyleEntrySchema).optional(),
}).strict();

// FlowSchema is the merged in-memory shape returned over the API to keep
// the web app's existing consumers (canvas, sidebar, export, undo) unchanged.
export const FlowSchema = /* same shape as today's DemoSchema, derived at merge time */;
export type Flow = z.infer<typeof FlowSchema>;
export type FlowNode = z.infer<...>;
```

### Read merge (`apps/studio/src/watcher.ts`)

`reparse(flowId)` becomes:

1. Read & JSON-parse `architecture.json`. Bail on bad JSON (snapshot: invalid).
2. Walk the parsed object and resolve every `file://` string (substitute or placeholder). Collect resolved paths for the watcher set.
3. `ArchitectureSchema.safeParse(resolvedRaw)`. Bail on schema error.
4. Read & JSON-parse `style.json` if present (else `{}`).
5. `StyleSchema.safeParse(style)`. Bail on schema error (style errors are real errors, not silently ignored).
6. Merge into the `Flow` shape the rest of the app expects:
   - For each architecture node, look up `style.nodes[id]`. Spread `style.position` onto the node root; spread other style fields into `node.data` (matching today's shape). For iconNode, spread `color`/`strokeWidth` at `data` root.
   - For each connector, look up `style.connectors[id]`. Spread all style fields onto the connector.
7. Snapshot stores `flow: <merged>` plus back-references to the raw architecture/style for write routing.

The watcher now watches both files (`architecture.json` and `style.json`) in the same dir, plus the referenced-files set. A `style.json` change broadcasts `flow:reload` exactly like an architecture change.

---

## 4. Write routing

### Routing table per operation (`apps/studio/src/operations.ts`)

| Operation | architecture.json | style.json |
|---|---|---|
| `addNode` | append to `nodes[]` (data-only fields) | write `nodes[<id>]` with `position` (+ any visual fields in body) |
| `deleteNode` | splice from `nodes[]`, cascade-delete from `connectors[]` | delete `nodes[<id>]`, cascade-delete style entries for any connector referencing the node |
| `moveNode` | — | write `nodes[<id>].position` |
| `reorderNode` | mutate `nodes[]` order | — (order is purely structural) |
| `patchNode` | merge data-only fields (name, kind, icon, description, detail, alt, etc.) | merge visual fields (width/height/border*/font*/color tokens/locked/strokeWidth/autoSize) |
| `addConnector` | append architectural fields | write style entry if body has any style fields |
| `deleteConnector` | splice from `connectors[]` | delete `connectors[<id>]` |
| `patchConnector` | merge label, kind/eventName/queueName/method/url, source/target | merge handles/pins/autoPicked, style, color, direction, borderSize, path, fontSize |

### Implementation

- Single helper `splitPatch(body)` returns `{ archUpdates, styleUpdates }` by routing each key through a static lookup table.
- `mergeNodeUpdates` becomes two helpers — one mutates the on-disk architecture node, one mutates the style entry.
- The `htmlNode` invariant (`autoSize === true` ⊻ persisted `width`+`height`) moves into the style-side helper since both fields live there.

### Atomicity & order

Both files share a single `withFlowWriteLock(flowId, ...)` to keep concurrent PATCHes serial. Within one PATCH:

1. Read both files (architecture mandatory, style optional → default `{}`).
2. Apply architecture mutation, run `ArchitectureSchema.safeParse` on full architecture.
3. Apply style mutation, run `StyleSchema.safeParse`.
4. Write `architecture.json` atomically (only if it changed).
5. Write `style.json` atomically (only if it changed; create file if needed; **delete the file** if it became `{}` to keep the disk clean).
6. On any schema failure between 2-3, bail without writing either file.

Order matters: architecture first, then style. If the post-write watcher fires for architecture before style, the merge sees fresh arch + stale style — fine, all style fields are optional. The reverse (style first) would briefly show stale arch with fresh style, which can dangle a style entry for a node that doesn't yet exist.

### Empty-style cleanup

When a node has all visual fields cleared, its style entry becomes `{}`. We strip empty entries from `style.json` on write so it stays compact — matches the existing "empty string clears the field" convention for `description`/`detail`.

---

## 5. API surface

Over the wire: **no shape change for the merged read**. The server reads architecture + style + resolves `file://` refs and returns a single `Flow` object, identical to today's `Demo` shape that the web app already understands.

```jsonc
// GET /api/flows/:id
{
  "id": "...",
  "slug": "...",
  "name": "...",
  "filePath": "/abs/path/to/.seeflow/architecture.json",
  "flow": {
    "version": 2,
    "name": "...",
    "nodes": [{
      "id": "post-orders",
      "type": "playNode",
      "position": { "x": -182, "y": 139 },  // merged from style.json
      "data": {
        "name": "POST /orders",
        "kind": "service",
        "detail": "## POST /orders\n\n...",   // resolved file://
        "borderColor": "green",                // merged from style.json
        "fontSize": 15
      }
    }],
    "connectors": [ ... ]
  }
}
```

### Endpoint rename (`Demo` → `Flow`)

| Old | New |
|---|---|
| `GET /api/demos` | `GET /api/flows` |
| `GET /api/demos/:id` | `GET /api/flows/:id` |
| `POST /api/demos/register` | `POST /api/flows/register` |
| `POST /api/demos/:id/play/:nodeId` | `POST /api/flows/:id/play/:nodeId` |
| `DELETE /api/demos/:id` | `DELETE /api/flows/:id` |
| `GET /api/events?demoId=:id` | `GET /api/events?flowId=:id` |
| `PATCH` / `POST` node + connector endpoints under `/api/demos/:id/...` | Same paths under `/api/flows/:id/...` |

Register body now uses `architecturePath` instead of `demoPath`:

```jsonc
// POST /api/flows/register
{ "name": "...", "repoPath": "/abs/path", "architecturePath": ".seeflow/architecture.json" }
```

### New endpoint: `POST /api/validate`

Stateless schema validator. No flow id, no registry side-effects, no `file://` resolution (validation is structural only).

**Request:**

```jsonc
{
  "architecture": { "version": 2, "name": "...", "nodes": [...], "connectors": [...] },
  "style": { "nodes": {...}, "connectors": {...} }   // optional
}
```

**Response:**

```jsonc
{ "ok": true }
// or
{
  "ok": false,
  "issues": [
    { "scope": "architecture", "path": ["nodes", 0, "data", "kind"], "message": "Required", "code": "invalid_type" },
    { "scope": "style", "path": ["nodes", "post-orders", "fontSize"], "message": "Number must be positive", "code": "too_small" }
  ]
}
```

The `scope` field disambiguates which file each issue lives in, since architecture and style schemas don't share a top-level shape.

Cross-checks performed inside `validateImpl`:
- Every node id keyed in `style.nodes` must exist in `architecture.nodes`.
- Every connector id keyed in `style.connectors` must exist in `architecture.connectors`.

200 in both ok and bad-schema cases (it's a validation result, not an HTTP error). 400 only for malformed request bodies.

### MCP tool surface

All MCP tools rename `demo*` → `flow*` (`register_demo` → `register_flow`, etc.). New tool `validate_seeflow` wraps `validateImpl`. Parity test extended to cover validate.

---

## 6. Vocabulary rename: `Demo*` → `Flow*`

The split is a natural moment to retire the legacy `Demo*` vocabulary. The product is SeeFlow, the skill calls them flows, the slug folder is `.seeflow/<slug>/` — `Flow` is right everywhere.

### Schemas + types

| Old | New |
|---|---|
| `DemoSchema` | `FlowSchema` (the merged in-memory shape) |
| — | `ArchitectureSchema`, `StyleSchema` (the two on-disk schemas) |
| `Demo` | `Flow` |
| `DemoNode` | `FlowNode` |
| `DemoSnapshot` | `FlowSnapshot` |
| `DemoWatcher` | `FlowWatcher` |
| `DemoListItem` | `FlowListItem` |
| `DemoGetResponse` | `FlowGetResponse` |

### Identifiers & variables

| Old | New |
|---|---|
| `demoId`, `demoPath` (var + registry field) | `flowId`, `architecturePath` (path now points at architecture.json) |
| `withDemoWriteLock` | `withFlowWriteLock` |
| `getDemoImpl`, `registerDemoImpl`, `deleteDemoImpl`, `addNodeImpl`-style helpers in `operations.ts` | `getFlowImpl`, `registerFlowImpl`, `deleteFlowImpl`, etc. |
| `demo:reload` event | `flow:reload` event |
| `demoWriteChains` map | `flowWriteChains` map |

`createProjectImpl` stays — it creates a project, not a flow.

The `Demo` token is well-isolated (no overlap with React Flow's `Node` / `Edge` types). The plan-execution doc will list every affected file.

---

## 7. Skill updates (`skills/seeflow/`)

### Deletions

- **Delete `skills/seeflow/scripts/validate-schema.ts` and `validate-schema.test.ts`.** Replaced by `POST /api/validate`.
- **Delete `skills/seeflow/vendored/schema.ts` and the entire `vendored/` directory.** The skill no longer carries any schema knowledge; drift risk between studio schema and vendored schema is eliminated.

### `skills/seeflow/scripts/register.ts`

`--flow` flag still points at the architecture file. Update help text and `readNameFromDemoFile` (now `readNameFromArchitectureFile`) to read from the path passed in. The existing implementation just reads `.name` from a JSON file, which lives in `architecture.json` — works unchanged once the path is right.

### `skills/seeflow/SKILL.md`

- **Phase 3 (write skeleton):** write `architecture.json` (no `style.json` needed for the skeleton). Validate via API:

  ```bash
  RESULT=$(curl -fsS -X POST "$STUDIO_URL/api/validate" \
    -H 'content-type: application/json' \
    -d "$(jq -n --slurpfile a "$flowDir/architecture.json" \
                 '{architecture: $a[0]}')")
  echo "$RESULT" | jq -e '.ok' >/dev/null \
    || { echo "$RESULT" | jq '.issues' >&2; exit 1; }
  ```

- **Phase 5 (synthesize):** merge overlays into `architecture.json` data; any visual fields go to `style.json` side-table. Validate both via API.

- **Phase 6 (write scripts + re-register):** writes `architecture.json` (plus any `style.json`) — paths in the cheatsheet updated.

- **Schema cheatsheet (lines 396-589):** every example splits into architecture+style. Drop visual fields from node `data` examples. Move `position`, `fontSize`, `borderColor`, `borderStyle`, etc. into a style-side example block. Add a new **"file:// substitution"** sub-section showing the `"detail": "file://details/<id>.md"` pattern and the suggested `details/` folder.

- **Studio API touchpoints table:** all paths rename to `/api/flows/...`; add `POST /api/validate`.

### `skills/seeflow/agents/seeflow-node-planner.md`

- JSON output shape: nodes carry only data (no `position`, no visual fields).
- Add an optional `style` block in the output schema for layout hints (`position`, color tokens). The orchestrator routes that block to `style.json`.
- Connector output drops visual fields.

### `skills/seeflow/agents/seeflow-play-designer.md` + `seeflow-status-designer.md`

- Read-target renamed: existing `architecture.json` (not `seeflow.json`).
- Overlays only touch `data.playAction` / `data.statusAction`; no visual field exposure.

### `skills/seeflow/references/plan-format.md`

- File-tree examples replace `<slug>/seeflow.json` with `<slug>/architecture.json` + `<slug>/style.json` + `<slug>/details/`.

### New planner rule: `prefer-file-references`

Add a guideline in `seeflow-node-planner.md` and the designers: when a node's `detail` would exceed ~200 chars (typical for the example flows' detail bodies), write it to `<slug>/details/<nodeId>.md` and set `"detail": "file://<slug>/details/<nodeId>.md"` in architecture.json. Keeps architecture.json compact and LLM-cheap, gives authors a real markdown file to edit, and lights up the `file://` watcher.

---

## 8. Files to modify

### `apps/studio/src/`

- **`schema.ts`** — full rewrite as described. Exports `ArchitectureSchema`, `StyleSchema`, `FlowSchema`, plus all renamed types.
- **`file-ref.ts`** (NEW) — `resolveFileRefs(rawArchitecture, seeflowRoot): { resolved, refs }`. Walker + path-safety + realpath check + placeholder strings.
- **`watcher.ts`** — `reparse()` now reads two files + resolves `file://` + merges. `referencedPaths` set extended to include `file://` targets. fs.watch added for `style.json` basename. All `Demo*` types renamed `Flow*`.
- **`operations.ts`** — every `*Impl` reads both files, splits the patch body via `splitPatch`, writes both files. `withFlowWriteLock` covers the pair. New helpers: `mergeArchitectureNode`, `mergeStyleNode`, `mergeArchitectureConnector`, `mergeStyleConnector`, `splitPatch`. `DEFAULT_ARCHITECTURE_RELATIVE_PATH = '.seeflow/architecture.json'`. New `validateImpl`. Project scaffolding writes just `architecture.json`.
- **`api.ts`** — route renames `/api/demos/*` → `/api/flows/*`. New route `POST /api/validate`. Response field `demo` → `flow`.
- **`mcp.ts` / `mcp-shim.ts`** — tool names renamed `demo*` → `flow*`. New tool `validate_seeflow`.
- **`cli.ts`** — `DEFAULT_ARCHITECTURE_PATH = '.seeflow/architecture.json'`. Flag `--demo` renamed `--architecture` (with backward-compat alias removed since there's no migration).
- **`registry.ts`** — field `demoPath` renamed `architecturePath`. Comments updated.
- **`sdk-writer.ts`** — reads from the merged `Flow` shape (already does), only type-name updates.
- **`demo.ts`** — example flow bytes used by tests: replace with split form.
- **`events.ts`** — event type `demo:reload` renamed `flow:reload`.

### `apps/web/src/`

- No structural changes (the merged API response is unchanged).
- Type imports renamed: `Demo` → `Flow`, etc. (the canvas package may also need a parallel rename; out of scope for the first pass unless trivial).
- Event listener strings updated: `demo:reload` → `flow:reload`.

### Examples & fixtures

- **`apps/studio/examples/order-pipeline/.seeflow/`** — replace `seeflow.json` with `architecture.json` + `style.json` + `details/*.md` for the existing long detail strings (shows `file://` in practice).
- **`apps/studio/examples/ecommerce-platform/.seeflow/`** — same.
- **`.seeflow/flow-share/seeflow.json`** — replace with `architecture.json` (this is the dogfood flow for the studio itself).

### Plugin (`skills/seeflow/`, `commands/`, `.claude-plugin/`)

- `skills/seeflow/SKILL.md` — extensive cheatsheet + phase rewrite.
- `skills/seeflow/scripts/register.ts` — minor path-flag rename.
- `skills/seeflow/scripts/validate-schema.ts` + `.test.ts` — **delete**.
- `skills/seeflow/vendored/schema.ts` — **delete**.
- `skills/seeflow/agents/*.md` — output-shape updates.
- `skills/seeflow/references/plan-format.md` — file-tree examples.
- `commands/` — if any command file references `seeflow.json` or `/api/demos`, update.

---

## 9. Tests

- **`schema.test.ts`** — split into `architecture-schema.test.ts` + `style-schema.test.ts` files. Covers per-variant required/optional fields.
- **`file-ref.test.ts`** (NEW) — resolver: substitution, missing → placeholder, path traversal → placeholder, symlink escape → placeholder, watching list correctness.
- **`watcher.test.ts`** — exercises both files: style change → reload; `file://` target change → reload; style missing → still loads; cascading reloads after architecture write.
- **`operations.test.ts`** — every CRUD test split-aware: PATCH visual field touches only `style.json`; PATCH semantic field touches only `architecture.json`; delete cascades both files; concurrent PATCH serialization across both files.
- **`api.test.ts`** — wire shape unchanged; add cases for resolved `file://` in the merged response; new test suite for `POST /api/validate` (ok, architecture-only, both files, cross-check failure, bad request).
- **`mcp.test.ts`** + **`mcp-parity.test.ts`** — renamed tool surface, behavior unchanged; new validate tool.
- **`cli.test.ts`** — `seeflow register` accepts a project with `architecture.json` (no `seeflow.json` present).
- **`demo.ts` fixtures** updated.
- **`skills/seeflow/scripts/register.test.ts`** — flag-name updates; otherwise behavior unchanged.

---

## 10. Build order

1. **Schema + file-ref resolver** — pure code changes in `schema.ts` and new `file-ref.ts`. No runtime wiring yet. Land with unit tests for both.
2. **Watcher + read merge** — `reparse()` reads both files, resolves `file://`, merges into `FlowSchema`. Existing API consumers see the merged shape unchanged. Land with `watcher.test.ts` updates.
3. **Operations write routing** — every `*Impl` splits patches and writes both files. Land with `operations.test.ts` updates. This is the largest single PR.
4. **API rename + validate endpoint** — `/api/demos/*` → `/api/flows/*`, new `/api/validate`, response field rename. Land with `api.test.ts` updates. Web app updated in the same PR to track the API rename.
5. **MCP rename + validate tool** — same pattern; parity test extended.
6. **Vocabulary rename across registry / events / variables / types** — bulk rename PR. Mostly mechanical.
7. **Skill updates** — `SKILL.md`, agents, references, delete `validate-schema.ts` + `vendored/`. Replace example flows.
8. **Dogfood + example flow rewrites** — `apps/studio/examples/*` and `.seeflow/flow-share/` written in the split form by hand (or via the updated skill against the new studio).

Each step is independently shippable. Step 3 and step 6 are the biggest; steps 1-2 are foundational and unblock everything else.

---

## 11. Open questions

None outstanding. Ready to write the execution plan.
