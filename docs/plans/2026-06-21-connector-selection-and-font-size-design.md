# Connector selection feedback + font-size slider/input — design

Date: 2026-06-21
Area: `packages/canvas/` (with host wiring in `apps/web/src/pages/demo-view.tsx`)

## Motivation

Three reported issues, which collapse into two coherent changes once the code is
understood:

1. "When selecting multiple connectors, the connector circles don't show up."
2. "Make font size a slider + input box. Slider max 64px."
3. "When Cmd+A / box-select, connectors aren't selected. Changing text/color on
   select-all doesn't update connectors."

### Root-cause reframing of #1 and #3

The exploration showed the selection plumbing already includes connectors:

- Cmd+A sets both `selectedIds` and `selectedConnectorIds`
  (`demo-view.tsx` ~1857 and ~2300).
- Marquee uses `SelectionMode.Partial` (`seeflow-canvas.tsx:5242`), which selects
  edges as well as nodes.
- `applyColor` already fans out to every selected connector
  (`style-strip.tsx`), so bulk color *does* reach connectors.

The real problem is **no visual feedback**: the endpoint "circles" only render
when exactly one connector is selected, because they double as reconnect
drag-handles (gate: `selectedConnectorIdSet.size === 1`,
`seeflow-canvas.tsx:3945`). A multi-connector selection therefore looks
unselected — and because font size was node-only, bulk edits *felt* like they
skipped connectors. So #1 and #3 are mostly one fix: show selection markers on
selected connectors, plus extend font size to connectors.

## Decisions (from brainstorming)

- Multi-select circles = **selection markers only** (non-interactive feedback).
  Reconnect-by-drag stays a single-connector action.
- Font size = **slider + number input**; **slider max 64px**; **input may exceed
  64** (slider pins at max; hard cap 200).
- Font size **applies to both** nodes and connector labels in a mixed selection.

## Section 1 — Connector selection feedback

Split the endpoint circles into two roles:

- **Selection markers** — non-interactive dots (`pointer-events: none`) on the
  endpoints of *every* selected connector. Pure feedback.
- **Reconnect handles** — the existing draggable native anchors, still gated to
  the single-selection case.

Implementation:

- `seeflow-canvas.tsx` (~3941–3987): set a new marker flag in `edge.data` (e.g.
  `data.selectedMarker`) for every edge whose id is in `selectedConnectorIdSet`
  (any count). Keep `reconnectable` gated on `size === 1`.
- `editable-edge.tsx`: render the marker dots when `data.selectedMarker` is set
  (currently the `showEndpointDots` gate keys on `data.reconnectable`). Keep the
  draggable native anchors gated on `reconnectable`. When exactly one connector
  is selected it shows both markers + draggable handles, which is fine.

No change to Cmd+A or marquee — they already include connectors.

## Section 2 — Font-size control

In `style-strip.tsx`, under the "Text" popover (`SliderControl`, ~1258):

1. **Slider + number input** that stay in sync. Drag/typing previews via the
   existing `onPreview`; release/blur/Enter commits via `onCommit`.
2. **Range:** slider `8 → 64` (8 = current connector min, the lower bound so one
   control serves both node and connector). Input accepts values above 64 (hard
   cap 200); slider pins at max when value > 64; values < 8 clamp to 8.
3. **Applies to both:** in a mixed selection, the single control patches
   `node.data.fontSize` for nodes AND `connector.fontSize` for connector labels,
   extending the existing fan-out pattern used by `applyColor`. Nodes-only and
   connectors-only cases keep working; this unifies the mixed case.
4. **"Mixed" state preserved:** divergent sizes still show the indeterminate
   placeholder in both slider and input.

### Out of scope

- `text-align` stays node-only (no meaningful connector-label equivalent).
- Reconnect-by-drag stays a single-connector action.

## Data model (unchanged shapes)

- `NodeVisual.fontSize?: number` — `types.ts:36`, default `NODE_FONT_SIZE_DEFAULT = 22`.
- `ConnectorBase.fontSize?: number` — `types.ts:349`, default `CONNECTOR_FONT_SIZE_DEFAULT = 11`.

## Test coverage

- Unit: marker flag is set for all selected connectors but `reconnectable` only
  for single selection; font-size apply fans out to both nodes and connectors;
  input clamps (>64 keeps value, slider pins; <8 clamps; >200 caps).
- E2E/visual: multi-connector selection shows markers; mixed-selection font-size
  drag updates both node text and connector labels.
