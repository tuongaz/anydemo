# Design: Clipboard/image paste, Link-node header, and shape stroke fixes

Date: 2026-06-20

Four fixes to the SeeFlow canvas:

1. OS-clipboard copy/paste of nodes + paste image from the OS clipboard.
2. Link (linkflow) node shows a header bar with icon + title, like other nodes.
3. Triangle node's bottom edge renders thinner than its other two edges.
4. Hexagon node's top and bottom edges render thinner than its other edges.

---

## Item 1 — Clipboard: cross-tab node copy/paste + paste image

### Today

- Copy/paste is an **in-app clipboard only**: `clipboardRef` in `apps/web/src/pages/demo-view.tsx`, a JSON-cloned `{ nodes, connectors }`. Cmd+C/V/D work within one flow tab; nothing touches the OS clipboard.
- The trigger is a **keydown** listener in `packages/canvas/src/components/seeflow-canvas.tsx` (`handleClipboardShortcut`) that delegates to host callbacks `onCopySelection` / `onPasteSelection`.
- Images are added **only** by drag-and-drop of a file: `onCreateImageFromFile` → `runImageUpload` (downscale + upload + create node) in `demo-view.tsx`.

### Approach

Use **native `copy` / `paste` DOM events**, not the `navigator.clipboard` API. Native clipboard events are user-initiated, so they give permission-free read access to both image bytes and cross-tab text on paste; `navigator.clipboard.read()` triggers a permission prompt and has spotty image support. This is the Figma/tldraw/Excalidraw pattern.

The logic lives in the **host** (`demo-view.tsx`) — both the node data shape and the image-upload flow already live there; the canvas stays adapter-pure.

**On `copy` (host listener):**
- Editable surface focused, or empty selection → do nothing (browser default).
- Else `e.preventDefault()` and write a JSON envelope `{ __seeflow_clipboard__: 1, nodes, connectors }` to `clipboardData` as `text/plain`. Keep mirroring `clipboardRef` as a same-tab fast path / fallback.

**On `paste` (host listener):**
- Editable surface focused → browser default.
- Else inspect `e.clipboardData`:
  1. Image file (`items` entry with `type` starting `image/`) → existing `onCreateImageFromFile` at viewport center → new image node.
  2. Else `text/plain` parses as a seeflow envelope → existing `buildPastePayload` node paste (cross-tab safe; ids are regenerated, so cross-flow works).
  3. Else ignore.

**Consequences:**
- The canvas's Cmd+C/V keydown chord is superseded for C/V (native events own them). Cmd+D (duplicate) and Cmd+A (select-all) stay on the keydown path.
- **Known limitation (out of scope for v1):** pasting an *image node* into a *different project* leaves a broken `path` (the file lives in the source project). Same-project paste is unaffected.

---

## Item 2 — Link node header + icon

The linkflow data already carries `name` + `icon` via `NodeSemanticBase` — **no schema change**. The renderer (`packages/canvas/src/nodes/linkflow-node.tsx`) ignores them today.

Render the shared `<NodeHeader>` (the component every other node uses) at the **top of all three states**:

- **Header behavior (all states):** icon from `data.icon` (editable via icon picker when selected); title = `data.name`, **empty by default** → standard italic placeholder; inline-editable on double-click via `onNameChange`. **No fallback to the flow name.** Requires wiring `onNameChange` / `onIconChange` into the linkflow node's runtime data (host already has these handlers).
- **Unlinked:** header on top; the dashed "Link to a flow" pill moves into the body below.
- **Broken:** header on top; the amber warning + last-known slug stays in the body. Restructure the outer `<button>` to a div + inner click target so the header's icon picker / inline edit aren't swallowed by the button.
- **Linked-healthy:** header (icon + name) on top; the body keeps the resolved flow name as a secondary line plus the pencil (re-target) and "Open" (follow) buttons. The flow name moves out of the primary-label slot.

Bump `LINKFLOW_DEFAULT_SIZE` / `LINKFLOW_MIN_SIZE` height so all three states stay legible with the added header bar.

---

## Items 3 & 4 — Shape stroke clipping (triangle, hexagon, parallelogram)

### Root cause

The illustrative shapes use `viewBox="0 0 W H"` + `preserveAspectRatio="none"` and draw a single `<polygon>`. Any polygon edge lying **exactly on the viewBox boundary** has half its stroke width clipped by the SVG viewport, so it renders at half thickness:

- **Triangle** — base runs along `y=height` → bottom line thin.
- **Hexagon** — top edge along `y=0`, bottom along `y=height` → both thin.
- **Parallelogram** — top edge along `y=0`, bottom along `y=height` → **same latent bug**, unreported.
- **Diamond** — vertices only touch the boundary at points; no edge runs along it → unaffected.

### Fix

**Pad the viewBox** instead of insetting each polygon's points: `viewBox="-m -m W+2m H+2m"` with `m` ≈ stroke width. With `preserveAspectRatio="none"` the padded region maps onto the full box, so the full stroke and miter tips land inside the viewport — nothing clips. One-line, uniform per shape; the glyph shrinks ~1% (imperceptible).

Apply to `triangle.tsx`, `hexagon.tsx`, and `parallelogram.tsx`. Leave `diamond.tsx` as-is.

Each shape change gets a visual regression check against the chromium-linux e2e snapshots.

---

## Testing

- **Item 1:** unit-test the envelope encode/parse + paste-dispatch decision (image vs node vs ignore) as a pure function. Integration/e2e for the native copy/paste round-trip and image paste.
- **Item 2:** update `linkflow-node.test.tsx` for the header across all three states (icon, empty-name placeholder, name edit, flow-name secondary line). Update e2e visual baselines.
- **Items 3 & 4:** geometric-node / shape unit assertions on the viewBox; regenerate chromium-linux snapshots for triangle, hexagon, parallelogram.

## Out of scope

- Copying an image node's bytes *out* to the OS clipboard for other apps.
- Cross-project image-node paste (broken `path`).
- Normalizing the diamond viewBox for consistency.
