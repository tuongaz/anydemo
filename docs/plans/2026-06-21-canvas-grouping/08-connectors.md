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

## Lessons-learned handoff (FILLED IN — M8 done)

**M8 was ~90% VERIFICATION, ~10% one targeted fix.** The entire
connect/preview/commit/geometry stack is **type-agnostic**: a group is a
`.react-flow__node` with `data-id`, a measured box, and `positionAbsolute`, so
every path treats it like any other node. The only node-type gate anywhere in
the connector machinery is the `text`-shape rejection in `isValidConnection`
(`seeflow-canvas.tsx`), which groups pass. **No schema change** (endpoints were
already legal). Steps below note VERIFIED vs CHANGED.

- **Step 1 — handles: VERIFIED (no change), tests strengthened.** `group-node.tsx`
  already renders the four handles (target `t`/`l`, source `r`/`b`) M1 added on
  the OUTER container border via xyflow's `Position` enum. **The 52px title band
  does NOT collide with the `Position.Top` handle**: xyflow anchors handles to
  the node's border (via xyflow CSS), while the band is purely INNER flex layout
  BELOW that border. The Top handle sits on the box's top edge; the band sits
  under it; members sit under the band. Added `group-node.test.tsx` asserts the
  full type+Position contract (t/l=target, r/b=source) and `isConnectable`
  forwarding (so view/mini gate it off).
- **Step 2 — floating geometry: VERIFIED (no production change), large-box tests
  ADDED.** `getNodeIntersection` is size-agnostic; `editable-edge.tsx` already
  feeds it the group's live box (`internals.positionAbsolute` +
  `measured.width/height ?? width/height`). The largest pre-existing test box was
  400×120, so M8 added a `group-sized (large) box anchoring` block and a
  `connector to a group … re-anchors on move/resize` block to
  `floating-edge-geometry.test.ts` (group box 600×400). They pin: anchor lands on
  the GROUP border (never a member), the anchor stays on the center-ray (so it
  can't snap to an inner member), and it re-resolves when the group box is
  translated (M5 move) or resized (M5 scale). **Re-anchoring uses live group
  geometry** because `useInternalNode(target)` subscribes the edge to the group
  node's position/dim changes — the same channel M5 writes through.
- **Step 3 — preview parity: ONE REAL FIX.** The genuine group-specific hazard:
  the connection-line **preview** path (b) scans every node for the nearest bbox
  with a `dist <= best` **last-wins** tie-break, while the **commit** body-drop
  uses `elementsFromPoint` (z-order). A member sits ABOVE its group (member z=0,
  group z=-1) and the group's bbox CONTAINS the member's, so when the cursor is
  inside both, BOTH have bbox distance 0 — and the old last-wins rule let
  iteration order decide, so the preview could snap to the group border while the
  drop landed on the member (a preview-vs-commit jump → violates the
  `project_connection_preview_mirrors_commit` memory). **Fix:** extracted a pure,
  exported `pickNearestSnapTarget(candidates, cursor, bufferFlow, excludeId)`
  with a **smaller-bbox-area-wins tie-break** (the innermost/on-top node = the
  member), gated so a farther-but-smaller node can never steal from a nearer
  larger one. Wired it into the preview path (b) AND mirrored the same area
  tie-break into the commit-side `nodeElNearPoint` buffer-scan fallback so the two
  agree even in the buffer zone (the in-bbox case was already correct via
  `elementsFromPoint`). The fixed-end float, raw-cursor projection, and
  reconnect-doesn't-exclude-own-node behavior were ALREADY correct and untouched.
- **Step 4 — child in isolation: VERIFIED (no change).** A child is an ordinary
  node → always a legal endpoint. M6's isolation makes the entered group's fill
  `pointer-events:none`, so a drop inside the group lands on the member underneath
  (members are top-level DOM siblings above the z=-1 group). When NOT entered, the
  group fill captures the drop → targets the group. No connector code is
  group-aware; this falls out of the existing hit-test + z model.
- **Step 5 — head shapes: VERIFIED (no change), source-fence tests ADDED.**
  `ConnectorHeadGlyph` draws at the resolved endpoint coords (`tX/tY`, `sX/sY`)
  inside the edge's own `<g>` for ANY node type — no group branch. Added
  `editable-edge.test.ts` fences that the glyph is drawn at those coords and that
  neither `editable-edge.tsx` nor `head-glyph.tsx` emits an SVG `<marker>` (the
  `project_xyflow_custom_edge_markers` contract: markers don't survive RF's
  edge-svg re-render).

**Answers to the seed questions:**
- *Did floating-edge-geometry need changes for the large box?* **No — tests only.**
  The math is size-independent; the change was adding large-box coverage.
- *Any preview-vs-commit mismatch for group endpoints? How fixed?* **Yes — the
  containing-group vs contained-member distance tie. Fixed via
  `pickNearestSnapTarget`'s smaller-area tie-break, mirrored on the commit side.**
- *Edge re-anchoring on group move/resize uses live geometry?* **Yes —
  `useInternalNode` subscribes the edge to the group's live position/dims; a
  move/resize test exercises it.**

- **➡ Copied into `09-integration-hardening.md` "Lessons carried forward".**
