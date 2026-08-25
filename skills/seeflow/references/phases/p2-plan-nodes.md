# Phase 2 — plan nodes

Launch `seeflow-node-planner` with: the brief (carrying `inputClass`), the resolved tech-ref paths, the matching `techAdaptations`, a **sliced** view of the node schema, `$schemaCache.connector`, and `$componentCatalog` (required whenever the planner may emit `type:'component'` — i.e. always for `inputClass === "document"` flows, defensively for the other two classes). No tools — pure reasoning. The planner reads each ref's **Node modelling** section, treats `techAdaptations` as the project-specific override, and branches on `inputClass` for the type-picker default ladder.

**Don't forward `$schemaCache.node` whole.** The full payload is large — nineteen variants (~29 KB), most of which the brief never needs. Forward instead:

1. **The variant menu** — the node subname list from the schema index (`$SEEFLOW schema`, ~1.6 KB), so the planner sees every type it can pick.
2. **Per-variant slices for the working set** — `$SEEFLOW schema node <subname>` returns one variant (~2.5–4.5 KB each, vs ~29 KB for all nineteen). Forward the variants the brief actually needs. Defaults: a `code` / `conversation` flow → `rectangle, database, queue, cloud, server, user` (plus `component` whenever rich content is in play); a `document` flow → mostly `component` plus the decorative `sticky` / `text`.

(The CLI's `--jq` is a path-extraction subset — `.schemas.rectangle.properties.data.properties` works; transform filters like `map_values` / `keys` return `badJq`. So slim by drilling per subname, not by reshaping the whole payload.)

For any `component` node, also forward `$SEEFLOW schema node component` alongside `$componentCatalog`. If the planner reaches for a variant you didn't forward, the envelope-validation / `flow:add-bulk` retry catches it — under-forwarding costs at most one retry, where forwarding all nineteen costs ~29 KB on every single launch — and most of it is variants the brief will never reach for.

**Inline the planner examples** (`references/planner/examples.md`) into the launching prompt on **first calls only** — the planner is a no-tools agent and cannot read the file itself. On the retry path (envelope-validation failure or `flow:add-bulk badSchema`), skip the inline — feed the CLI's `issues[]` back instead so the planner focuses on the specific gap rather than re-reading calibration material it already had.

**Connectors conform to `$SEEFLOW schema connector` and nothing more.** If the planner emits any field the contract rejects, strip it before `flow:add-bulk`. Do not enumerate the legal fields here — re-run the schema command whenever in doubt.

## Abstraction rules

- **Resource nodes first** — every DB, queue, event bus, cache, file store, external SaaS gets its own node, typed with the matching illustrative shape (`database`, `queue`, `cloud`, `server`) or `rectangle` + a Lucide `icon` when no shape fits.
- **Abstraction** — one node per service / workflow / worker / queue / DB. Exceptions: independently-meaningful pipeline stages, fan-out consumers, branches, and services hosting multiple independent state machines.
- **Duplicate shared resources for clarity.** When a DB / queue / bus is referenced by many nodes and the lines tangle the canvas, split it into role-specific copies (`orders-db-read`, `orders-db-write`) sharing the same `type` + `data.icon` + `data.name` but distinct `id`s.

## Output envelope

Output: a single envelope carrying `name`, `slug`, `nodes`, `connectors`, and `rationales` (planner-only sibling map). The `nodes` and `connectors` arrays must conform to `$SEEFLOW schema node` and `$SEEFLOW schema connector` — they are forwarded verbatim in a single body to the `flow:add-bulk` subcommand in Phase 3. Any key the CLI rejects here is rejected at `flow:add-bulk` too. One retry on unparseable output, then surface and stop. Full contract: `../../agents/seeflow-node-planner.md`.

## Envelope validation

**Validate the envelope before continuing.** A parseable JSON blob is not the same as a complete envelope. After `JSON.parse`, assert every required key is present and non-empty:

- `typeof name === 'string' && name.length > 0`
- `typeof slug === 'string' && slug.length > 0`
- `Array.isArray(nodes) && nodes.length > 0`
- `Array.isArray(connectors)` (may be empty for single-node flows)
- `rationales && typeof rationales === 'object' && Object.keys(rationales).length === nodes.length` (one entry per node id)

If any assertion fails, **re-dispatch the planner once** with the specific gap echoed back in the prompt (`Your previous output was missing: name, rationales[3 of 5 nodes]. Re-emit the full envelope.`). On second failure, surface (`planner returned partial envelope after retry — missing <keys>`) and stop. **Never silently synthesise the missing fields** — losing the planner's own justifications at the Phase 3 review gate is a real loss of signal, and a fabricated `name`/`slug` ships under the planner's authority without its review.
