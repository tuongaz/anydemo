# Milestone 1 — Group data model + static renderer

**Status:** Not started · **Depends on:** `00-design.md` · **Risk:** Low–Medium

## Previous milestone — summary

None (first milestone). Baseline state: a complete group feature existed and was
removed in `8673a650`; there is **no** group/`parentId`/`childIds` concept in the
schema, canvas types, or renderers today. The multi-resize `SelectionResizeOverlay`
exists but is dead (`return null`). See `00-design.md` §2.

## Lessons carried forward

- **L0.3** Membership = `childIds[]` on the group + **absolute** child positions.
  Do NOT add `parentId`. Keep the canvas group-agnostic.
- **L0.5** Append any new `useState` to the END of `SeeflowCanvas`.
- **L0.6** `schema.ts` edits → `make sync-seeflow-schema` in the same change.
- **L0.7** A new persisted field needs schema + canvas type + parity sets.

## Goal

Introduce `type:'group'` with `data.childIds` end-to-end (schema → studio
persistence → canvas types) and a **static GroupNode renderer** that paints a
padded, titled container behind its members. No create/ungroup/resize/enter yet.

**User-testable outcome:** Hand-author a group node in a flow's `flow.json` (or
via the MCP/CLI add-node), reload the canvas, and SEE the group render as a
rounded container behind its children, with its title and background/border.

## Scope

**In:** schema variant + on-disk variant + merge routing + vendored sync;
canvas `NodeType`/`FlowNode`/`GroupNodeData`/parity sets; `group-node.tsx`
renderer; node-type registration; z-order-behind-children; `childIds` added to
`NodePatch` + studio patch body + `mergeNodeUpdates`.

**Out:** create/ungroup ops (M4), overlay chrome (M2), resize (M3/M5), enter/exit
(M6), styling UI wiring (M7 — but the renderer must *read* the style fields),
connectors (M8).

## Implementation steps

### A. Schema (`apps/studio/src/schema.ts`)
1. Add `'group'` to `NodeTypeSchema` (`:215`). Do **not** add to
   `GEOMETRIC_NODE_TYPES` (`:198`).
2. Define `GroupNodeDataSchema` = `NodeSemanticBaseShape` + `NodeVisualBaseShape`
   + `childIds: z.array(z.string()).default([])`. (`.strict()` on the on-disk
   side per existing pattern.)
3. Add a `group` member to the **resolved** union (near `:396`) and the
   **on-disk** union (near `:758`).
4. Add a `superRefine` clause: every id in `childIds` exists; no id is in two
   groups; no group id appears in any `childIds` (no nesting). Co-locate with the
   existing connector-existence `superRefine` (`:489`/`:807`).
5. `make sync-seeflow-schema` → verify `skills/seeflow/vendored/schema.ts` updated.

### B. Persistence (`apps/studio/src/merge.ts`, `operations.ts`)
6. Add `'childIds'` to `NODE_DATA_FLOW_KEYS` (`merge.ts:45`) — semantic, flow.json.
7. Add `childIds` to `NodePatchBodySchema` (`operations.ts:100-187`) and handle it
   in `mergeNodeUpdates` (`operations.ts:347`).

### C. Canvas types (`packages/canvas/src/types.ts`)
8. Add `'group'` to `NodeType` (`:118`); add a `FlowNode` union member
   `(NodeBase & { type:'group'; data: GroupNodeData })` (`:292`).
9. Define `GroupNodeData` (visual+semantic fields + `childIds: string[]`).
10. Add the new data fields to `CANVAS_NODE_DATA_FIELDS` (`:143`) so the
    `satisfies` check passes.
11. `types.test.ts` exhaustive switch (`:73-120`) handles `'group'`.

### D. Adapter (`packages/canvas/src/adapter/types.ts`, `history/wrap-adapter.ts`)
12. Add `childIds?: string[]` to `NodePatch` (`:40-97`) and `NodeCreateInput`
    `data`.
13. Add `'childIds'` to `NULL_CLEARS_NODE_KEY` (`wrap-adapter.ts:33-49`).

### E. Renderer (`packages/canvas/src/nodes/group-node.tsx` — NEW)
14. A node component drawing a rounded rect from `data.width/height` and the
    visual tokens (reuse the inline-style derivation from `rectangle-node.tsx` /
    `geometric-node.tsx` + `color-tokens.ts`).
15. Title band at top using `NodeHeader` (`nodes/lib/node-header.tsx`) — read-only
    in this milestone (wire `onNameChange` in M7).
16. Assign a low `zIndex` in `buildNode` for `type:'group'` so it paints behind
    members (§9.6). Document the chosen value. **De-risk (design §12.4):**
    `elevateNodesOnSelect={false}` is already set (`seeflow-canvas.tsx:5205`), so
    the group's low zIndex holds even when selected — v1's worst z-index landmine
    is structurally absent. Add a test asserting the group's zIndex < members'.
17. **`group-node.tsx` MUST NOT mount `<ResizeControls>` (design §12.3)** — group
    resize is served by the overlay (M3/M5), not per-node handles. Mounting them
    would create two conflicting resize mechanisms.
18. Register `group: GroupNode` in the flat `nodeTypes` map
    (`seeflow-canvas.tsx:1396`) and `nodes/index.ts`.
19. `buildNew` default: add `buildNewGroupData` to `lib/node-defaults.ts`
    (default name `"Group"`, default chrome). Used later by M4.

### F. `node-defaults` / barrel
20. Export anything new from `src/index.ts` only if part of the public API
    (GroupNodeData type likely yes).

## Guardrails
- Group is its OWN variant — do not shoehorn into geometric.
- `childIds` semantic (flow.json), not visual.
- z-order behind children is a render concern this milestone OWNS — get it right
  now so later milestones build on a correct stack.

## Tests
- **Unit:** schema parses a valid group (resolved + on-disk); rejects a group
  with a non-existent child id, a doubly-membered child, and a nested group;
  round-trips through `mergeFlowAndStyle`/`splitFlow` (childIds → flow.json,
  position/visuals → style.json). `node-defaults` group builder.
- **Component:** `group-node.test.tsx` — renders box with correct size + tokens;
  title shows; z-order/zIndex applied.
- **Parity gates:** `types.test.ts`, `schema.test.ts` parity + `STRIPPED_VISUAL_FIELDS`.

## User Acceptance Test (manual)
1. In a scratch flow, add a `group` node whose `data.childIds` lists 2 existing
   nodes, positioned to enclose them, with `name:"My group"`,
   `backgroundColor:"slate"`, `borderColor:"blue"`.
2. `bun run dev`, open the flow. **Expect:** a slate rounded container titled
   "My group" painted *behind* the two nodes, blue border, padding around them.
3. Reload the page → group persists identically.

## Definition of Done
- All gates green: `bun run format && bun run lint && bun run typecheck && bun test`.
- `make verify-seeflow-schema-sync` passes.
- UAT steps pass.
- Lessons handoff filled in (below).

## Lessons-learned handoff (M1 — filled in on completion)

### Schema variant / parity gates
- **The `CANVAS_NODE_DATA_FIELDS` instruction in the plan (step C.10 / design
  §4.3) is WRONG for `childIds`.** That const carries a
  `satisfies Record<keyof GeometricNodeData, true>` clause, so it is bound to
  the GEOMETRIC data shape. `childIds` lives on the new `GroupNodeData` (a
  *separate* variant), NOT on `GeometricNodeData` — adding it to
  `CANVAS_NODE_DATA_FIELDS` would BREAK the satisfies-const compile. The
  studio↔disk parity test (`schema.test.ts` "canvas ↔ disk schema parity")
  only iterates `CANVAS_NODE_DATA_FIELDS` against `FlowRectangleNodeSchema`, so
  it never looks at group fields. **Correct move: leave `CANVAS_NODE_DATA_FIELDS`
  and `STRIPPED_VISUAL_FIELDS` untouched; `childIds` is covered by its own
  `FlowGroupNodeData` on-disk schema + dedicated group tests.** Later milestones
  that add fields to a *group-only* shape must not touch the geometric
  satisfies-const either.
- **Group is genuinely its own discriminated-union member** in BOTH unions
  (resolved `NodeSchema` + on-disk `FlowNodeSchema`), exactly like the plan said
  — no shoehorning into geometric. The on-disk `FlowGroupNodeData` is `.strict()`
  and holds ONLY semantic fields (`childIds` + the semantic base); the visual
  base is intentionally absent because `splitFlow` routes visuals to style.json.
- **`childIds: z.array(z.string()).default([])`** on BOTH the resolved and
  on-disk data schemas means a hand-authored group can omit `childIds` and it
  normalizes to `[]` on read — important for the "empty labeled zone" case
  (design §9.11) and for a `childIds`-clearing undo (the cleared key re-reads as
  `[]`).
- **`superRefine` is duplicated across the two unions, by design.** I factored a
  shared `addGroupMembershipIssues(nodes, ctx)` helper and call it from BOTH
  `ResolvedFlowSchema.superRefine` and `FlowSchema.superRefine` (mirrors how the
  connector-existence check already lives in both). The resolved check is the
  load-bearing one for the mutation path (`mutateMergedFlow` final parse), but
  the on-disk check is needed too because `getFlowGraphImpl`/`registerFlowImpl`
  parse raw against `FlowSchema` directly.
  - **Gotcha:** the helper's `nodes` param MUST type `data` as `unknown` (not
    `{ childIds?: string[] }`). The node-union variants are structurally
    exclusive — most have no `childIds` — so a narrow data type makes TS reject
    the whole `nodes` array as "no properties in common". Type `data?: unknown`
    and read `childIds` via a local cast.
- **`'group'` ripples into two exhaustive `Record<NodeType, …>` maps the plan
  did NOT mention:** `apps/studio/src/operations.ts` `SEMANTIC_KEYS_BY_TYPE`
  (retype-allowed semantic keys) and `apps/studio/src/layout.ts`
  `DEFAULT_DIMENSIONS`. Both fail typecheck until a `group` entry is added.
  Whenever a future milestone adds a node type, grep for
  `Record<...NodeType...>` / `Record<FlowNode['type'], …>` maps.

### Z-order — mechanism chosen (load-bearing for M5/M9)
- **Mechanism: an explicit NEGATIVE per-node `zIndex` (`GROUP_NODE_Z_INDEX =
  -1`), set in `buildNode` (`seeflow-canvas.tsx`) via
  `if (merged.type === 'group') node.zIndex = GROUP_NODE_Z_INDEX;`. Exported
  from `group-node.tsx` so renderer + `buildNode` + the z-order test share one
  constant.** Array-order was rejected (design §9.6 option b) — it's fragile
  against bring-to-front/back reordering.
- **Why negative, not "just lower":** every other node leaves `zIndex`
  undefined, which xyflow treats as **0**, and edges are pinned at **0** via
  `DEFAULT_EDGE_OPTIONS`. An equal 0 on the group would let DOM order decide, so
  a group authored *after* its members would paint ON TOP. `-1` puts the group
  strictly below both members and edges. The stack is `group(-1) < edges(0) =
  members(0) < selection chrome`.
- **De-risk confirmed (design §12.4):** `elevateNodesOnSelect={false}` is set,
  AND there is a pre-existing `.react-flow__node.selected:not(.react-flow__node-group)`
  carve-out in `index.css` that already excludes group wrappers from the
  `z-index:1000 !important` selection bump. So the group's `-1` holds even when
  selected. M5/M9: do NOT add a selection-time z bump for groups, and clamp any
  bring-to-front/back so a group can't rise to ≥ a member's z.
- **xyflow auto-tags `type:'group'` nodes with `.react-flow__node-group`.** This
  is free (the carve-out above keys off it) but also a hazard — see CSS gotcha.

### CSS gotcha (the big surprise — "xyflow CSS leak" pattern)
- **v1's group CSS was NOT fully removed when the feature was deleted in
  `8673a650`.** `packages/canvas/src/styles/index.css` still carried a dead
  `.react-flow__node-group { border:1px dashed; background:transparent;
  border-radius:4px }` block plus `.selected`, `data-active`, `data-gated-child`,
  and `.react-flow__node-group-label` rules — and the `data-active` rule
  referenced the EXACT `data-testid="group-node"` this milestone introduces.
  Because xyflow applies `.react-flow__node-group` to any `type:'group'` node,
  that dead base rule would have painted a faint dashed border + transparent
  bg OVER the renderer's inline box. **I removed the dead v1 group CSS block**
  (kept the helpful selection-elevation carve-out, which is a separate rule) and
  left a comment documenting the z-order contract. M6/M7 will add their own
  scoped CSS for isolation/title when they wire `data-active`/the title band.
- Lesson for later milestones: before adding group CSS, `rg "react-flow__node-group"`
  — assume nothing is there, but verify you're not colliding with a leftover.

### merge.ts routing / vendored-sync
- **`childIds` is SEMANTIC → flow.json.** Added to `NODE_DATA_FLOW_KEYS` in
  `merge.ts`. No surprises: visual base fields already route to style.json via
  the existing `NODE_STYLE_KEYS`, so a group's width/colors/position split out
  correctly and `childIds` + name stay in flow.json. Verified by the round-trip
  test.
- **Patch plumbing needs FOUR touch-points for `childIds`, not one** (the L0.7
  rule, confirmed): `NodePatchBodySchema` (nullable+optional),
  `NODE_DATA_PATCH_KEYS` (so `mergeNodeUpdates` writes it), canvas-side
  `NodePatch` (`string[] | null`), and `NULL_CLEARS_NODE_KEY` in
  `wrap-adapter.ts` (so an undo that empties membership sends `null`, not a
  dropped `undefined`). `mergeNodeUpdates`' generic null-clear path handles the
  array fine — `=== null` distinguishes "clear" from `[]` "write empty".
- **`make sync-seeflow-schema` must run after EVERY schema edit, including the
  follow-up type-only fix.** I edited `schema.ts` twice (once for the variant,
  once to widen the helper's `data` param) and had to re-sync after the second
  edit too. CI's `verify-seeflow-schema-sync` compares byte-for-byte.

### Canvas build gotcha (re-confirmed)
- The studio typechecks/tests against the BUILT `@seeflow/canvas` dist. After
  every canvas src edit, `bun run --filter @seeflow/canvas build:js` BEFORE
  studio gates, or `GroupNodeData`/the new exports are invisible and gates fail
  confusingly. CSS edits need the full `build` (not `build:js`) to land in
  `dist/style.css` for the UAT.
