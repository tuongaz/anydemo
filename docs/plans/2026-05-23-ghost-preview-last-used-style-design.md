# Ghost preview honours last-used style

Date: 2026-05-23
Status: Design — accepted, ready to implement

## Problem

When the user drags out a new shape on the canvas, the dashed "ghost" preview
follows the cursor. The committed node has, since the last-used-style work,
pulled border colour / background / border size / corner radius from
`getLastUsedStyle(DEFAULT_STORAGE_PREFIX).node`, but the ghost still renders
hardcoded factory defaults. Result: the preview lies. Drag out a rectangle
after switching the last selected node's border to amber and you see a
default-colour box that snaps to an amber-bordered box on release.

Two ghost render paths are affected:

- Wrapper-chrome shapes (`rectangle`, `ellipse`, `sticky`) at
  `packages/canvas/src/components/seeflow-canvas.tsx:3764-3765`. The ghost
  calls `shapeChromeStyle(drawShape)` with no `data` argument, so every
  field its body reads (`borderColor`, `backgroundColor`, `borderSize`,
  `borderStyle`, `cornerRadius`) falls back to its default branch.
- Illustrative shapes (`cloud`, `server`, `database`, `user`, `queue`) at
  `packages/canvas/src/components/seeflow-canvas.tsx:4399-4405`. The ghost
  passes hardcoded `borderColor` / `backgroundColor` / `borderSize` to the
  per-shape SVG renderer. Visually less obvious than the wrapper case, but
  the bug is identical.

Text is intentionally excluded: the placed text node is chromeless, the ghost
only shows a dashed outline as a "you're drawing here" affordance, and
`fontSize` (the only last-used field a text node would honour) is not
rendered in the ghost anyway.

## Decision

Wiring: the canvas reads `getLastUsedStyle(DEFAULT_STORAGE_PREFIX).node`
directly at ghost-render time. No new prop, no host change.

Why direct read over a prop: a `lastUsedNodeStyle` prop is staleness-prone —
a `rememberNodeStyle` write inside `onStyleNode` only flips the prop if the
host happens to re-render or bumps a memo dep. Reading directly removes the
window entirely. localStorage `get` + `JSON.parse` of the tiny bucket is on
the order of microseconds; the read is gated on `drawShape !== null`, so it
only fires during an active draw gesture (a few times during the drag, not
60Hz). The `last-used-style.ts` module already lives inside the canvas
package and is already exported, so the canvas using its own helper for its
own ghost is consistent with the existing surface.

Prefix: hardcoded to `DEFAULT_STORAGE_PREFIX`. The existing
`CanvasFeatureOverrides.storageKey` field at `seeflow-canvas.tsx:180` is
still a documented-but-unused pass-through; wire it through to
`getLastUsedStyle` only if/when a host actually sets it. YAGNI.

Rejected alternatives:

- *`lastUsedNodeStyle` prop from host.* Staleness window described above;
  also makes the host responsible for re-snapshotting after every
  `rememberNodeStyle` call, which is a footgun.
- *Function-prop callback.* Adds indirection without solving the staleness
  problem (callback closure can still be stale).

## Canvas changes

`packages/canvas/src/components/seeflow-canvas.tsx`:

```tsx
// At the ghost render block — single read, gated on draw mode
const ghostLastUsedNodeStyle = drawShape
  ? getLastUsedStyle(DEFAULT_STORAGE_PREFIX).node
  : undefined;

// Wrapper-chrome shapes (rectangle / ellipse / sticky):
const ghostShapeStyle = drawShape
  ? shapeChromeStyle(drawShape, ghostLastUsedNodeStyle)
  : undefined;

// Illustrative shapes (cloud / server / database / user / queue):
const colors = resolveIllustrativeColors(ghostLastUsedNodeStyle);
<GhostRenderer
  width={ghostRect.width}
  height={ghostRect.height}
  borderColor={colors.borderColor}
  backgroundColor={colors.backgroundColor}
  borderSize={ghostLastUsedNodeStyle?.borderSize ?? NEW_NODE_BORDER_WIDTH}
  borderStyle={ghostLastUsedNodeStyle?.borderStyle}
/>;
```

`shapeChromeStyle` already accepts a `data` argument — its body resolves
the same five fields the committed node does. The illustrative path now
shares `resolveIllustrativeColors` (extracted out of `GeometricNodeImpl`)
so both call sites cannot drift the next time a field is added.

The stale comment at the old ghost-style block (claiming the ghost passes
"no `data` because `onCreateShapeNode` only sends `{ shape, width, height }`")
is rewritten to reflect the new contract: the ghost reads the same bucket
the commit path overlays via `buildNewShapeData`.

## Demo-view wiring

None. The commit-side read at `demo-view.tsx:1424` stays as-is. No new
state, memos, or props in the host.

## Tests

`packages/canvas/src/components/seeflow-canvas.test.tsx`:

- Rectangle ghost: render with
  `lastUsedNodeStyle={{ borderColor: 'amber', backgroundColor: 'slate',
  borderSize: 4 }}`, enter draw mode, simulate pointer-down + pointer-move,
  assert the ghost div's inline style resolves to the amber border and slate
  background and `borderWidth: 4`.
- Ellipse ghost: same assertion with `'ellipse'`.
- Illustrative ghost (cloud): assert the `GhostRenderer` receives the
  resolved `borderColor` / `backgroundColor` / `borderSize` from the snapshot.
- Text ghost: assert the dashed outline still paints and the snapshot is
  ignored.
- No-prop case: omitting `lastUsedNodeStyle` reproduces today's defaults
  byte-for-byte — pins the no-regression contract.

The existing hook-shim test suite (see canvas CLAUDE.md, `useStateOverrides`
ordering rule) is unaffected: no new `useState` calls are added.

## Out of scope

- Last-used `fontSize` in the text ghost. Would require painting actual
  text in the dashed outline, which is a UX change, not a bug fix.
- Connector ghost. This design only covers shape creation.
- Last-used `borderStyle` for illustrative shapes. The illustrative SVG
  renderers don't currently consume `borderStyle`; widening their API is
  separate work.
