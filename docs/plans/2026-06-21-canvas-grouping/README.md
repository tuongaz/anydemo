# Canvas Grouping — Implementation Plan (index)

**Date:** 2026-06-21
**Owner:** Tuong Le
**Status:** Planning complete — ready to implement milestone by milestone.
**Package under change:** `@seeflow/canvas` (`packages/canvas`) + schema in `apps/studio` + wiring in `apps/web`.

> ⚠️ This feature **was built once before and removed wholesale** in commit
> `8673a650` ("refactor: remove group node type from SeeFlow") after ~17 US-###
> commits of fighting xyflow internals. Read **`00-design.md` §"Why v1 failed"**
> before writing any code. Every milestone below is shaped to avoid the specific
> traps that killed v1.

## How to read this plan

`00-design.md` is the **single source of truth** for the architecture, data
model, interaction model, coordinate math, and the two runaway-bug guardrails.
Read it first and in full.

The numbered files `01`…`09` are **sequential, independently testable
milestones**. Each one:

1. Opens with a **"Previous milestone — summary"** of what the prior milestone
   delivered and what was verified.
2. Carries a **"Lessons carried forward"** block — the accumulated, append-only
   log of mistakes discovered so far, so the next implementer never repeats one.
3. Ends with a **"Lessons-learned handoff (FILL THIS IN BEFORE MARKING DONE)"**
   section. The implementer of milestone *N* MUST, before closing it:
   - write what actually went wrong / what was surprising in milestone *N*, and
   - **copy those lessons into the "Lessons carried forward" block of milestone
     *N+1*** (and into `00-design.md` §"Lessons log" if it changes a contract).

This handoff requirement is mandatory — it is the mechanism that makes the chain
self-correcting. A milestone is not "done" until its lessons are propagated.

## Milestone map

| # | File | Deliverable | User-testable outcome |
|---|------|-------------|------------------------|
| — | `00-design.md` | Architecture, data model, interaction model, math, guardrails, lessons log | (reference doc) |
| 1 | `01-data-model-and-renderer.md` | `group` node type + `childIds` in schema (studio + vendored sync) + canvas types + a static **GroupNode renderer** | Hand-author a group in `flow.json` → it renders as a padded titled container *behind* its children |
| 2 | `02-multiselect-overlay-chrome.md` | Revive `SelectionResizeOverlay` **visual chrome**: padded rect (req #1) + 4 corner boxes, zoom/pan-correct, **inert** | Select 2+ nodes → padded rect + 4 corner handles appear and track zoom/pan; vanish on deselect |
| 3 | `03-proportional-resize.md` | Wire the 4 corners to **proportionally scale** the selected nodes (size + position) — the bug-prone milestone | Drag a corner → nodes scale smoothly & proportionally, **no runaway**; one Cmd+Z reverts all |
| 4 | `04-create-ungroup-ops.md` | Pure `group-ops.ts` (bbox/childIds/ordering/undo-batch) + **create/ungroup icon affordance** (req #3) + context-menu + Cmd+G / Cmd+Shift+G | Select 2+, click ＋ icon (or Cmd+G) → group appears; select group, click ⊟ icon → dissolves, children stay put; undo/redo atomic |
| 5 | `05-group-move-and-resize.md` | Group **move** fans out to children; group **resize** scales children (reuses M3 math) | Drag the group → children follow; resize the group corners → children scale; undo atomic |
| 6 | `06-enter-exit-isolation.md` | **Double-click to enter** a group (req #4): children individually selectable/editable; ESC / pane / outside-click exits | Double-click group → select/move/edit a child inside; ESC exits back to group-level |
| 7 | `07-styling-title-sidebar.md` | Group **title** (inline + sidebar), **background/border** via StyleStrip, **sidebar content** via DetailPanel (req #5) | Edit title inline & in sidebar; change bg/border/corner/shadow; add detail markdown → shows in sidebar |
| 8 | `08-connectors.md` | **Connectors** to/from the group as a whole + children connectable when entered (req #5, #4) | Draw a connector to a group; enter a group and connect a child; floating geometry hugs the group box |
| 9 | `09-integration-hardening.md` | Clipboard, delete-cascade, export (PNG/PDF), persistence round-trip, SSE/live reload, e2e + visual baselines | Copy/paste a group + members; delete a group; export; reload — all correct |

## The non-negotiable guardrails (full detail in `00-design.md`)

1. **Frozen baseline for any multi-node scale.** Capture BOTH the start rect AND
   a deep copy of the start node geometry at pointer-down. Every tick and the
   final commit scale the *frozen originals* against the *frozen old rect* →
   new rect. **Never** read the live (optimistically-overridden) node set during
   a resize gesture — that is the exact "order-of-magnitude" compounding bug
   (`selection-resize-overlay.tsx:328` reads `nodesAtTick = selectedNodes`, the
   live set — this is the bug, not a fix).
2. **Stable gesture callbacks.** Keep any xyflow `NodeResizeControl` callbacks
   reference-stable (`useCallback([])` + refs). A fresh reference mid-drag makes
   xyflow zero its d3-drag `startValues`, producing the *other* exponential
   resize bug (`use-resize-gesture.ts:115-129`).
3. **End-only commit by default.** Commit child scaling once, on pointer-up,
   from the frozen baseline. Live per-tick child mutation is an explicit,
   later, opt-in enhancement — never the first cut.
4. **Group stays decoupled.** Membership is the group's own `childIds[]`
   (absolute child positions). The rest of the canvas (clipboard, delete,
   edges, ordering, schema integrity) must NOT need to become group-aware. This
   is the antidote to v1's #1 removal reason.
5. **Schema sync gate.** Any `schema.ts` edit is followed by
   `make sync-seeflow-schema` in the same change (CI gates on
   `make verify-seeflow-schema-sync`).
6. **`childIds` mutation ordering.** Delete-a-member prunes the group's `childIds`
   BEFORE deleting the node — the server re-validates the whole flow per write and
   rejects a dangling reference (design §12.9).

## Verified technical challenges

`00-design.md §12` is a codebase-verified catalogue of the non-obvious
implementation hazards (dimension resolution for auto-sized nodes; live child
drag since `onNodeDrag` isn't wired; the group omitting its own ResizeControls;
`elevateNodesOnSelect={false}` already de-risking z-order; the overlay needing
node type + members for a group; freehand scaling; create-id atomicity; childIds
referential-integrity ordering). Read §12 before M2–M5 and M9 — each item is
cross-referenced from its milestone.
