# Folded-corner Note + HTML node demo

Two small, scoped updates:

1. **Note (`sticky` shape) corner fold** — add a top-right dog-ear so a sticky reads unmistakably as a paper note on the canvas.
2. **HTML node demo** — drop a Platform Health dashboard `htmlNode` into the `ecommerce-platform` example so the htmlNode type has a first-class demo.

## 1. Note corner fold

### Scope

Only the `sticky` ShapeKind in `packages/canvas/src/nodes/shape-node.tsx`. Rectangle, ellipse, text, illustrative shapes are untouched.

### Visual

A small triangular dog-ear in the top-right corner, **20×20 px fixed** (does not scale with node size — a real folded paper corner reads the same regardless of page size).

Two-part SVG overlay:

1. **Filled triangle** covering the top-right corner, colored slightly darker than the sticky's background (~12% black mixed over via `color-mix(in srgb, <bg> 88%, black)`). This shows the "underneath" of the fold.
2. **Diagonal stroke** along the hypotenuse — 1px, `rgb(0 0 0 / 0.18)` — the crease shadow. The shadow line is the difference between "dog-ear" and "chamfered card".

### Color resolution

Reads from the same logic already in `shapeChromeStyle`:

- If `data.backgroundColor` is set → derive darker shade from that token.
- Otherwise → fall back to amber default → derive darker amber.

The derivation uses CSS `color-mix` so it works against any ColorToken without us pre-computing a darker pair per token.

### Border + clip-path

The sticky has `border-[3px]`. The fold sits *above* the border in the top-right corner — the wrapper applies a `clip-path: polygon(...)` that removes the top-right corner, so the border naturally terminates at the fold edges and we then paint the SVG fold into the cleared corner via an absolutely-positioned 20×20 overlay at `top: 0; right: 0`.

### Rotation

The sticky's `-rotate-1` wrapper rotation applies to the fold too (it's a DOM child of the wrapper) — the dog-ear tilts with the note. Correct: a tilted note's fold tilts with it.

### Resize

Fold stays 20×20 even if the user resizes the node — fixed pixel size via the SVG's intrinsic dimensions, not percentage. Authors get a stable fold that doesn't grow distorted on a large sticky.

### Selection / chrome

Selection outline (CSS rule, US-010) draws around the outer rect; the fold sits inside that outline. No special handling.

### Tests

In `packages/canvas/src/nodes/shape-node.test.tsx`:

- Sticky renders a `[data-testid="sticky-fold"]` SVG element.
- Other shapes (rectangle, ellipse, text) do NOT render the fold.
- Fold's fill color responds to `backgroundColor` token override (e.g. an explicit `"sky"` token produces a sky-derived darker shade, not amber).

### Files touched

- `packages/canvas/src/nodes/shape-node.tsx` — add fold overlay + clip-path
- `packages/canvas/src/nodes/shape-node.test.tsx` — three new test cases
- `packages/canvas/dist/*` rebuilt via `bun run --filter @seeflow/canvas build`

## 2. HTML node demo in ecommerce-platform

### Scope

Add one `htmlNode` to the existing example, plus the HTML file it references. No schema, renderer, or registry changes — htmlNode is already a first-class type.

### Files added

- `apps/studio/examples/ecommerce-platform/.seeflow/scripts/platform-health.html` — dashboard markup (Tailwind utility classes only, no `<script>` / `<style>` / `<iframe>` per `injectSanitizedHtml` sanitizer).
- One entry appended to `apps/studio/examples/ecommerce-platform/.seeflow/seeflow.json` `"nodes"` array.

### Node JSON

```json
{
  "id": "platform-health",
  "type": "htmlNode",
  "position": { "x": 1340, "y": 50 },
  "data": {
    "name": "Platform Health",
    "htmlPath": "scripts/platform-health.html",
    "autoSize": false,
    "width": 380,
    "height": 220,
    "borderColor": "green",
    "borderSize": 1,
    "cornerRadius": 8,
    "backgroundColor": "slate"
  }
}
```

`autoSize: false` + explicit `width/height` gives the card a stable, predictable footprint. Border + slate background match the green-ringed service nodes already in the diagram. No `connectors` entry — the dashboard floats as ambient context above the payment / notification row.

### HTML content

A grid of 4 KPI tiles using Tailwind classes:

- **Orders/sec** — `142` with `↑ +12%` green badge
- **Success rate** — `99.4%` green tick
- **p95 latency** — `87ms` amber badge (warning)
- **Active carts** — `3,210` neutral

Header row: small "PLATFORM HEALTH" eyebrow + a service-status dot. Body uses `text-slate-200`, `bg-slate-900/40`, `border-emerald-500/30` accents — reads as a real ops dashboard inside the canvas's dark theme.

Static markup only — the sanitizer strips `<script>` anyway. Numbers are hard-coded; this is a demonstration, not a live feed.

### Position

`(1340, 50)` — sits above Payment Service at `(1340, 349)`. Top-right ambient placement matches the chosen design.

### Tests

None. The example is pure data + a static HTML file; the canvas's existing htmlNode renderer and the studio's schema validator already cover behavior. Invalid JSON would fail at load via `apps/studio/src/schema.ts`.

## Out of scope

- A new dedicated `note` node type (the existing `sticky` shape is already labeled "Sticky note" in the toolbar; no need for a parallel type).
- Theming the fold per ColorToken family with bespoke darker pairs (the `color-mix` derivation is enough).
- Live data in the HTML demo (hard-coded numbers are sufficient — and any JS would be stripped by the sanitizer).
- A sticky-note callout in the ecommerce example (kept the example focused on the htmlNode demo per the user's brief).
