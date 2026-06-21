# Milestone 8 — Connectors to/from groups (and children)

**Status:** Not started · **Depends on:** M1, M6 · **Risk:** Medium
(geometry — floating edges against the larger group box)

## Previous milestone — summary

M7 wired group styling (StyleStrip), title (inline + sidebar), and sidebar
content (DetailPanel detail markdown) — all reusing existing surfaces and
persisting normally.

## Lessons carried forward

- **From M7 handoff (actionable subset):**
  - **The group already renders four connection handles** (`group-node.tsx`: ids
    `t`/`l` target, `r`/`b` source, opacity-0 → `selected` opacity-100 pattern),
    placed on the OUTER container border. M1 added them; M7 left them intact.
    **M8 step 1 may already be satisfied** — verify before adding markup. They sit
    on the group's border, NOT over members (the group box is the larger
    perimeter), so floating-edge geometry should anchor to the group box.
  - **The group box top now reserves `GROUP_BOX_PADDING(12) + GROUP_TITLE_BAND_PX(40)`
    = 52px for the title band** (M7 bumped the band from 28). When M8 computes
    handle/edge anchor points or perimeter intersections against the group's
    `width/height`, remember the title occupies the top band — a `Position.Top`
    handle/edge anchor lands in the title band, not over a member. Pin geometry
    tests against the actual box dims, not member dims.
  - **`zIndex:-1` + members-as-top-level-siblings is the hit-testing model.** A
    connector drag that ENDS on the group's padding band (not a member) targets
    the group; ended on a member's handle, targets the member. When the group is
    ENTERED (M6 `data.active`), its fill is `pointer-events:none` so a drag falls
    through to members underneath — exactly the precondition for connecting an
    individual child. Do NOT add z-index carve-outs; reuse this model.
  - **Styling/title/sidebar for connectors already exists** — M8 is render/geometry
    only; do not fork connector tooling. A connector whose endpoint is a group is
    a normal connector in the schema (see next bullet).
- Research confirmed: the schema already allows **any node id** as a connector
  `source`/`target` (no type whitelist; fence test exists). So group-as-endpoint
  is schema-legal with no schema change — the work is **render/geometry only**.
- Children are connectable; M6's isolation is the precondition for connecting an
  individual child cleanly.

## Goal

Let connectors attach to a group as a whole, and to individual children (when the
group is entered). Floating-edge geometry must hug the group's (larger) box.
(Req #5 connectors + #4 children.)

**User-testable outcome:** Draw a connector from a node to a group → it anchors to
the group's perimeter and follows it on move/resize. Enter a group → draw a
connector to/from a child → it anchors to the child.

## Scope

**In:** ensure the group node exposes connection handles; verify/extend
`floating-edge-geometry.ts` so edges intersect the group's bounding box correctly;
connection-preview parity for group endpoints; child connections inside isolation.

**Out:** auto-routing around members (non-goal); connector styling is already
covered by existing connector tooling.

## Implementation steps

1. **Handles on the group:** the group renderer must render the same four
   source/target handles as other nodes (`SourceHandleIdSchema` r/b,
   `TargetHandleIdSchema` t/l) so a drag can start/end on the group. Reuse the
   handle markup from `rectangle-node.tsx` (opacity-0 → selected/hover pattern).
   Place handles on the group's outer border (not over members).
2. **Floating-edge geometry:** verify `lib/floating-edge-geometry.ts` computes the
   perimeter-intersection against the group's `width/height` box. Because the
   group is large and contains members, confirm the edge anchors to the group's
   border, not a member's. Add tests for a large box.
3. **Connection preview parity:** per the
   `project_connection_preview_mirrors_commit` memory, the drag preview to/from a
   group must mirror the committed connector (same path/face/style; reconnect must
   not exclude the moving end's own node; projection uses the raw cursor). Verify
   group endpoints honor this.
4. **Child connections in isolation:** when a group is entered (M6), the group
   body is click-through, so a connection drag lands on the child's handles
   normally. Verify a child remains a valid endpoint while grouped (it always is —
   it's a normal node). When NOT entered, connecting should target the group.
5. **Custom head shapes:** per `project_xyflow_custom_edge_markers`, head glyphs
   draw in the edge group, not SVG markers — unaffected, but verify a
   group-endpoint edge renders its head correctly.

## Guardrails
- No schema change for endpoints (already legal). If you find yourself editing the
  connector schema's endpoint validation, stop — that's a sign of a wrong turn.
- Group handles must sit on the group border and not block member interaction.
- Edge must re-anchor when the group moves/resizes (M5) — exercise that path.

## Tests
- **Unit:** `floating-edge-geometry` perimeter intersection for a large group box;
  anchor stays on the group border for various source positions.
- **Component:** group renders connection handles; handle visibility follows the
  hover/selected pattern.
- **Integration/E2E:** draw a connector to a group; move/resize the group → edge
  follows; enter a group, connect a child → edge anchors to the child; reload →
  connectors persist.

## User Acceptance Test (manual)
1. Draw a connector from a loose node to a group → it anchors to the group's
   border. Move the group → the edge follows and re-anchors. Resize the group →
   edge re-anchors.
2. The drag preview matches the committed edge (no jump on release).
3. Enter a group → draw a connector from a child to an outside node → anchors to
   the child. Exit.
4. Reload → all connectors (to group + to child) persist and render correctly.

## Definition of Done
- Gates green; geometry unit tests + e2e pass.
- Group is a connector endpoint; children connectable in isolation; edges
  re-anchor on group move/resize; previews mirror commits.
- Lessons handoff filled in.

## Lessons-learned handoff (FILL THIS IN BEFORE MARKING DONE)
- Did `floating-edge-geometry` need changes for the large box, or just tests?
- Any preview-vs-commit mismatch for group endpoints? How fixed?
- Edge re-anchoring on group move/resize — confirm it uses live group geometry.
- **➡ Copy into `09-...md`.**
