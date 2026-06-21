# SeeFlow skill — feedback fixes design

Three issues raised against `skills/seeflow`. Each is independently
shippable; #7 and #8 also require studio (`apps/studio`) changes. No
data migration — flows are user-owned scratch directories, regenerated
on demand.

## #7 — All presentation lives in `style.json`

**Today.** `references/schema.md` lines 5-7 say `style.json` owns all
presentation end-to-end and the skill never authors it. The planner
contradicts that by emitting `borderSize`, `borderStyle`,
`borderColor` directly under `flow.json` `data`. Server accepts it,
docs lie.

**Decision.** Split cleanly. flow.json is semantic; style.json is
presentation. Renderer applies defaults when style.json has no entry.

### Field split

| File | Owns |
|---|---|
| `flow.json` | `id`, `type`, `data.name`, `data.kind`, `data.shape`, `data.icon`, `data.description`, `data.detail`, `data.stateSource`, `data.playAction`, `data.statusAction`, `data.html` (content), connector `kind/source/target/method/url/eventName/queueName/label` |
| `style.json` | `borderSize`, `borderStyle`, `borderColor`, `backgroundColor`, `textColor`, `cornerRadius`, `fontSize`, `width`, `height`, `position`, `sourceHandle`, `targetHandle`, connector `style/direction/path/color/borderSize/fontSize` |

Renderer defaults: `borderSize: 1`, `borderStyle: "solid"`,
`borderColor: "default"`. Nothing persisted unless overridden.

### Studio changes (`apps/studio/src/`)

1. `schema.ts` — tighten per-node `data` Zod schemas (`playNode`,
   `stateNode`, `shapeNode`, `htmlNode`) to **strict-reject** the
   visual keys listed above. Broaden `StyleSchema.nodes[id]` and
   `StyleSchema.connectors[id]` to accept them.
2. `operations.ts` `patchNode` — partition incoming body: semantic
   keys → flow.json mutation, visual keys → style.json mutation. One
   atomic transaction; both files written or neither.
3. `operations.ts` `nodes:add-bulk` / `connectors:add-bulk` — already
   should refuse visual keys once schema is tightened; add a
   defensive strip + warn just in case.
4. `api.ts` PATCH `/flows/:id/nodes/:nodeId` — uses the new partitioned
   `patchNode`; no caller change.
5. `apps/web/src/components/canvas.tsx` + node renderers — merge flow
   data + style entry at render time; apply renderer defaults for
   absent keys.
6. Canvas edit handlers (anywhere that today writes to flow.json
   data for a visual field) — re-target style.json. The
   `onStyleNode` / `onStyleNodes` undo entries already key on
   `node:<id>:style`, so the abstraction is in place.

### Skill changes

- `agents/seeflow-node-planner.md`
  - Delete the "Default node style (mandatory)" section.
  - Drop `borderSize/borderStyle/borderColor` from every example
    JSON block (lines 67-69, 218-220, 442-447).
  - Update line 90 to remove the three fields from the "only visual
    fields you emit" sentence — planner emits **no** visual fields.
  - Drop the constraint at lines 509-511.
- `references/schema.md`
  - Rewrite lines 5-7: `style.json` is "renderer overrides and
    canvas-edited presentation — positions, handles, colors, sizes.
    Skill never authors it."
  - Delete the "Default node style" section (lines 76-85).
  - Update htmlNode "Optional styling fields" — they are written by
    the canvas to style.json, never by the skill.

### Validation

- Studio unit tests on schema accept/reject for both files.
- Canvas visual edit round-trip: change a node's border in the UI,
  inspect on-disk files — change lands in style.json, flow.json
  unchanged.
- Skill smoke run: create a new flow end-to-end; confirm flow.json
  has zero visual keys.

## #8 — `nodes:patch` learns to change `type`

**Today.** Patch body is data/style-only. Demoting a `playNode` to
`stateNode` (a common edit when the trigger moves) requires
`nodes:delete` (cascades the per-node folder — scripts, detail.md,
view.html all gone) followed by `nodes:add-bulk`. Three commands,
destructive.

**Decision.** Extend `nodes:patch` with an optional top-level `type`
field. Server validates cross-type rules. Per-node folder
preserved (id unchanged).

### Cross-type rules

| From → To | Rule |
|---|---|
| `playNode → stateNode` | clear `data.playAction` (server) unless re-supplied; preserve `statusAction`, `stateSource` |
| `stateNode → playNode` | patch MUST include `data.playAction`; else `badSchema { kind: 'playActionRequired' }` |
| `playNode/stateNode → shapeNode` | clear `playAction`, `statusAction`, `stateSource`; patch MUST include `data.shape` |
| `shapeNode → playNode/stateNode` | patch MUST include `data.kind`, `data.stateSource` (+ `data.playAction` for play) |
| `* → iconNode` | patch MUST include `data.icon`; clear action/kind fields |
| `* → imageNode` | patch MUST include `data.path`; clear everything else semantic |
| `* → htmlNode` | clear actions; `data.html` may be empty |

Encode allowed transitions as an explicit table; default-reject.

### Studio changes

1. `schema.ts` — `NodePatchBodySchema` gets optional `type` field.
   When present, the merged node (current + patch) is revalidated
   against the new type's data schema.
2. `operations.ts` `patchNode` — detect type change, run the table
   above, mutate flow.json in place. Per-node folder
   (`.seeflow/nodes/<id>/`) untouched; id unchanged so connectors
   stay valid.
3. `operations.test.ts` — coverage of every transition cell + every
   required-field error.

### Skill changes

- `agents/seeflow-node-planner.md` "Edit case" — append: "If an
  entity's role changes (e.g. ex-trigger demoted from playNode to
  stateNode), emit it with its **existing id** but the new `type`.
  The orchestrator turns this into a non-destructive `nodes:patch`
  with type change; per-node files survive."
- `SKILL.md` Phase 5 — when the planner's edit-diff produces a
  same-id-different-type entry, route through `nodes:patch` (not
  `delete` + `add-bulk`).
- `references/operations.md` — add `nodes:patch` type-change row to
  the CLI table.

## #9 — Canonical `node-<shortId>` / `conn-<shortId>` via skill helper

**Today.** Studio runtime (canvas, `apps/studio/src/operations.ts`,
the upload endpoint at `apps/studio/src/api.ts:659`) generates ids as
`node-<10 base62>` / `conn-<10 base62>` via
`apps/studio/src/short-id.ts`. The skill planner instead emits
descriptive kebab-case (`checkout-api`, `c-order-server-event-bus`).
Two conventions in one project; the per-node upload endpoint actively
rejects the skill's shape.

**Decision.** Skill keeps descriptive ids during planning (good for
reasoning, keeps connectors/rationales aligned), orchestrator
rewrites to canonical form at the boundary to `nodes:add-bulk`.

### New file: `skills/seeflow/lib/short-id.js`

Node-compatible mirror of `apps/studio/src/short-id.ts`. Same
alphabet (62 base62 chars), same length (10), same rejection
sampling. No deps. CLI:

```bash
node skills/seeflow/lib/short-id.js <count> [prefix]
# prints `count` ids, one per line; prefix prepended if given.
```

### Orchestrator workflow

Insert step **2a** in Phase 3 (between "normalize planner output"
and `nodes:add-bulk`):

1. Count `planner.nodes.length` (N) and `planner.connectors.length`
   (M).
2. Run `node skills/seeflow/lib/short-id.js N node-` → array of
   canonical node ids. Same for `M conn-`.
3. Build `descriptiveId → canonicalId` map. For each
   `planner.nodes[i].id` that already matches
   `^node-[A-Za-z0-9]{10}$` (edit-case reuse from `editTarget`),
   keep it; only mint new canonical ids for net-new entries.
4. Rewrite:
   - `nodes[].id`
   - `connectors[].id`, `connectors[].source`, `connectors[].target`
   - `rationales` keys
5. Surface rationales in the Phase 3 user prompt as
   `<data.name> (<id>): <rationale>` so the human sees a readable
   anchor despite the opaque id.

### Skill doc changes

- `agents/seeflow-node-planner.md` `id` field rules (lines 124-128)
  — "Pick a descriptive kebab-case id (e.g. `checkout-api`); the
  orchestrator rewrites these to canonical `node-<shortId>` form
  before bulk-add. In edit-case, reuse the existing canonical id
  verbatim."
- `SKILL.md` Phase 3 — insert step 2a (rewrite ids via helper). Add
  `skills/seeflow/lib/short-id.js` to the Operations table at the
  end.
- `references/schema.md` per-node-folder section — note ids in
  flow.json are canonical `node-<10 base62>` form.

### Validation

- `skills/seeflow/lib/short-id.test.js` (or similar) — collision
  rate over 10 000 ids, length, alphabet (mirrors
  `apps/studio/src/short-id.test.ts`).
- Bash check: `node skills/seeflow/lib/short-id.js 5 node-` prints
  5 well-formed ids.
- Skill smoke run: create a new flow end-to-end; confirm every
  `id` in `flow.json` matches `^(node|conn)-[A-Za-z0-9]{10}$`.

## Execution order

#7 and #8 both touch `schema.ts` + `operations.ts`, so ship them
serially. #9 is independent and additive.

1. **#9** — purely additive, skill-only (plus the helper file). Ship
   first; lowest risk.
2. **#8** — server feature, additive optional field. Backward
   compatible with existing patch callers.
3. **#7** — schema hard-cut on both files, canvas writes
   re-targeted, renderer defaults applied. Ship together; no
   migration since flows are user-owned scratch dirs.

Each fix gets its own PR.
