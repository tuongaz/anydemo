# Canvas Toolbar: Select + Hand mode

## Problem

Users arming a shape tool (e.g. Rectangle) cannot tell how to return to neutral selection-and-pan behavior. Space-to-pan works today but is undiscoverable, and there is no visible "current mode" indicator on the toolbar. Miro and Figma solve this by exposing Select and Hand as first-class tools at the top of the toolbar, with `V` and `H` shortcuts and a clear active-mode chip.

## Goals

- Match Miro/Figma toolbar convention: Select + Hand at the top of the cluster.
- Always show *something* lit: Select is `aria-pressed` whenever no other tool is armed.
- Hand mode is a true exclusive mode (locks node interaction, pans on left-drag), not a cosmetic toggle.
- Shortcuts: `V` arms Select, `H` toggles Hand. Escape is hierarchical.
- Keep existing Space-to-pan untouched as a transient override.

## Non-goals (YAGNI)

- "Sticky" previous-tool memory after Select/Hand. Figma/Miro don't have it.
- Hand mode for `view` and `mini` chrome modes. Toolbar is hidden in both.
- Touch-specific tuning. Existing React Flow defaults are fine.

## Design

### State shape

New type in `packages/canvas/src/types.ts`:

```ts
export type CanvasMode =
  | { kind: 'select' }
  | { kind: 'hand' }
  | { kind: 'draw'; shape: ShapeKind };
```

State ownership stays in the host (`apps/web/src/pages/demo-view.tsx`). The current `useState<ShapeKind | null>(null)` becomes `useState<CanvasMode>({ kind: 'select' })`. The companion `activeShapeRef` becomes `modeRef: useRef<CanvasMode>`.

Prop renames (both `CanvasToolbar` and `SeeflowCanvas`):

| Before | After |
|---|---|
| `activeShape: ShapeKind \| null` | `mode: CanvasMode` |
| `onSelectShape: (s: ShapeKind \| null) => void` | `onModeChange: (next: CanvasMode) => void` |

Internal alias in `SeeflowCanvas`: `const drawShape = mode.kind === 'draw' ? mode.shape : null;` (replaces `const drawShape = activeShape;` at line 1894). Adds parallel `const handMode = mode.kind === 'hand';`.

No useState slot churn: `activeShape` lives in the host, not in the 12-slot hook-shim ordering inside `SeeflowCanvas`.

### Toolbar UI

New top group above the existing `TOP_PRIMARY_SHAPES` in `canvas-toolbar.tsx`:

```
┌─────┐
│  ⬚  │ ← Select (lucide MousePointer2) — always-lit when mode.kind === 'select'
│  ✋ │ ← Hand   (lucide Hand)           — lit when mode.kind === 'hand'
├─────┤   divider
│  ▢  │ Rectangle
│  ○  │ Ellipse
│  ▦  │ Shape picker
│  🏷  │ Insert icon
├─────┤
│  📝 │ Sticky
│  T  │ Text
└─────┘
```

New entry type alongside `ToolbarShapeEntry`:

```ts
interface ToolbarModeEntry {
  kind: 'select' | 'hand';
  label: string;
  commandId: CommandId;
  Icon: typeof MousePointer2;
}

const MODE_ENTRIES: ToolbarModeEntry[] = [
  { kind: 'select', label: 'Select', commandId: 'tool.select', Icon: MousePointer2 },
  { kind: 'hand',   label: 'Hand',   commandId: 'tool.hand',   Icon: Hand },
];
```

`renderModeButton` mirrors `renderShapeButton`'s chip styling. Active rule: `active = mode.kind === entry.kind`. Re-click semantics:

- Select-on-Select → no-op (you can't unselect the neutral state).
- Hand-on-Hand → `{ kind: 'select' }`.
- Shape-on-same-shape → `{ kind: 'select' }` (semantically identical to today's `null` exit).

### Keyboard shortcuts and Escape

`keyboard-shortcuts.ts` edits:

- Add `'tool.hand'` to the `CommandId` union.
- Add a `COMMANDS` entry for `tool.hand` (`label: 'Hand tool'`, `shortcut: 'H'`).
- Update `tool.select` description from "Switch to the selection / pan tool" to "Switch to the selection tool".
- Widen `ToolShortcutResult` to `'select' | 'hand' | ShapeKind | null`.
- Add an `H` branch to `resolveToolShortcut` alongside the existing `V` branch.

`runCommand` dispatcher in `demo-view.tsx`:

```ts
case 'tool.select': setMode({ kind: 'select' }); return;
case 'tool.hand':   setMode({ kind: 'hand' });   return;
case 'tool.rectangle': setMode({ kind: 'draw', shape: 'rectangle' }); return;
// ...same for ellipse/text/sticky/database
```

Hierarchical Escape, added to the existing keydown listener:

```ts
if (e.key === 'Escape' && !isTypingTarget(e.target)) {
  if (modeRef.current.kind !== 'select') {
    setMode({ kind: 'select' });
    e.preventDefault();
    return;
  }
  if (selectedIdsRef.current.length > 0 || selectedConnectorIdsRef.current.length > 0) {
    setSelectedIds([]);
    setSelectedConnectorIds([]);
    e.preventDefault();
    return;
  }
  // Select + empty selection → no-op, let other handlers see it
}
```

Reuse the existing `isTypingTarget` guard. Do not duplicate.

Space-to-pan stays untouched. Releasing Space returns to whatever `mode` was — including Hand (no visible change since Hand was already panning).

### Hand-mode React Flow plumbing

Extend the existing `!drawShape && ...` expressions in `seeflow-canvas.tsx`:

| Prop | Before | After |
|---|---|---|
| `nodesDraggable` | `…&& !drawShape` | `…&& !drawShape && !handMode` |
| `nodesConnectable` | `…&& !drawShape` | `…&& !drawShape && !handMode` |
| `elementsSelectable` | `!drawShape && flags.enableSelection` | `!drawShape && !handMode && flags.enableSelection` |
| `selectionOnDrag` | `!drawShape && flags.enableSelection` | `!drawShape && !handMode && flags.enableSelection` |
| `panOnDrag` | `drawShape ? false : flags.enablePan ? [1, 2] : false` | `drawShape ? false : handMode ? [0, 1, 2] : flags.enablePan ? [1, 2] : false` |

`[0, 1, 2]` = left + middle + right mouse buttons all pan when Hand is armed. Matches Figma/Miro.

### Cursor

Add `data-canvas-mode={mode.kind}` to the existing `.seeflow-canvas-root` wrapper via the same imperative `setAttribute` site that handles `data-canvas-ready`. Do not introduce a new `useState` slot (would shift hook-shim test indices per the CLAUDE.md rule).

CSS rules in `src/styles/index.css`:

```css
.seeflow-canvas-root[data-canvas-mode="hand"] .react-flow__pane { cursor: grab; }
.seeflow-canvas-root[data-canvas-mode="hand"] .react-flow__pane:active { cursor: grabbing; }
```

## Test plan

TDD per `superpowers:test-driven-development`. Write each test first, watch it fail, then implement.

1. **`canvas-toolbar.test.tsx`** — Select/Hand buttons render with correct `aria-pressed`, `aria-label`, tooltip text. Re-click semantics (Select no-op, Hand exit). Existing shape-button tests get their fixture renamed `activeShape` → `mode`.
2. **`keyboard-shortcuts.test.ts`** — `resolveToolShortcut` returns `'hand'` for `H`, `'select'` for `V`. `COMMANDS` includes `tool.hand` with `H` shortcut.
3. **`seeflow-canvas.test.tsx`** — Hand mode flips the four React Flow flags; verify hook-shim slot order is unchanged.
4. **Dispatcher / integration test** — `V` from any mode sets `{kind:'select'}`. `H` toggles Hand on then off. Escape: from Draw → Select; from Select-with-selection → clears; from Select-empty → no-op (no `preventDefault`).
5. **Playwright e2e (`apps/studio/e2e/`)** — Regenerate visual baselines for the toolbar (`bun run test:it:update-snapshots`). Commit only `*-chromium-linux.png` — never host-specific snapshots.

## Migration checklist

- [ ] Add `CanvasMode` to `packages/canvas/src/types.ts`.
- [ ] Rename `activeShape` → `mode` in `CanvasToolbar` props + `SeeflowCanvas` props.
- [ ] Update `keyboard-shortcuts.ts` (`CommandId`, `COMMANDS`, `ToolShortcutResult`, `resolveToolShortcut`).
- [ ] Update `runCommand` dispatcher in `demo-view.tsx`.
- [ ] Replace `activeShape` / `activeShapeRef` in `demo-view.tsx` with `mode` / `modeRef` (~20 sites, mechanical).
- [ ] Update `drawShape` derivation in `seeflow-canvas.tsx`. Add `handMode`.
- [ ] Update the five React Flow flag expressions.
- [ ] Add `data-canvas-mode` attribute via imperative `setAttribute` in the existing `onInit` site.
- [ ] Add Hand cursor CSS in `src/styles/index.css`.
- [ ] Add hierarchical Escape handler in the existing keydown listener.
- [ ] Tests (per Test plan above).
- [ ] Regenerate Playwright snapshots.
- [ ] Run `bun run format && bun run lint && bun run typecheck && bun test`.
- [ ] Rebuild canvas package: `bun run --filter @seeflow/canvas build`.
