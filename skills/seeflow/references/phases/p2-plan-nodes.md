# Phase 2 — plan nodes

Launch `seeflow-node-planner` with: the brief (carrying `inputClass`), the resolved tech-ref paths, the matching `techAdaptations`, `$schemaCache.node`, `$schemaCache.connector` (forward verbatim — see `p0-preflight.md` §"Schema cache"), and `$componentCatalog` (required whenever the planner may emit `type:'component'` — i.e. always for `inputClass === "document"` flows, defensively for the other two classes). No tools — pure reasoning. The planner reads each ref's **Node modelling** section, treats `techAdaptations` as the project-specific override, and branches on `inputClass` for the type-picker default ladder.

**Connectors conform to `$SEEFLOW schema connector` and nothing more.** If the planner emits any field the contract rejects, strip it before `flow:add-bulk`. Do not enumerate the legal fields here — re-run the schema command whenever in doubt.

## Abstraction rules

- **Resource nodes first** — every DB, queue, event bus, cache, file store, external SaaS gets its own node, typed `rectangle` with a matching Lucide `icon` (`database`, `list-ordered`, `radio-tower`, `cloud`, `server`) and a `statusAction` capability when state is worth probing.
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
