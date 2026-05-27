# Canvas color overhaul

Goal: replace the canvas's alpha-tinted node bodies with a curated, fully-opaque palette of harmonized themes, and collapse the toolbar's three color affordances (border + fill + text) into a single "Color" picker.

Out of scope: abstract gradient backgrounds (deferred).

## Why

The current node body paints at `hsla(h, s, l, 0.12)` over the canvas surface — a faint hue that reads as a near-neutral fill. Combined with a fully saturated header and an independent border picker, the toolbar offers three color decisions per node (border, fill, text) and most users only want one. The result is muddy bodies, picker fatigue, and combinations that fight each other.

This redesign:

1. Drops the alpha trick — every theme is a hand-tuned (body, header, border, text) tuple at full opacity.
2. Trims the palette from 15 hues to 11 curated themes.
3. Replaces "Border color" / "Fill" / "Text color" with one "Color" popover. Picking a theme writes both `borderColor` and `backgroundColor` to the same token; text color derives automatically.

## Palette model

In `packages/canvas/src/lib/color-tokens.ts`:

```ts
type ThemeToken =
  | 'slate' | 'red' | 'orange' | 'amber'
  | 'green' | 'teal' | 'cyan' | 'blue'
  | 'indigo' | 'violet' | 'pink';

type Theme = { body: Hsl; header: Hsl; border: Hsl; text: 'light' | 'dark' };

const THEMES: Record<ThemeToken, Theme> = {
  slate:  { body: [215, 16, 92], header: [215, 20, 45], border: [215, 25, 35], text: 'light' },
  red:    { body: [  0, 84, 94], header: [  0, 70, 50], border: [  0, 70, 42], text: 'light' },
  orange: { body: [ 25, 95, 92], header: [ 25, 85, 50], border: [ 25, 80, 42], text: 'light' },
  amber:  { body: [ 43, 92, 90], header: [ 38, 85, 50], border: [ 38, 80, 42], text: 'light' },
  green:  { body: [142, 50, 92], header: [142, 60, 38], border: [142, 65, 30], text: 'light' },
  teal:   { body: [173, 60, 92], header: [173, 65, 38], border: [173, 70, 30], text: 'light' },
  cyan:   { body: [189, 70, 92], header: [189, 75, 42], border: [189, 80, 35], text: 'light' },
  blue:   { body: [217, 70, 93], header: [217, 80, 52], border: [217, 85, 45], text: 'light' },
  indigo: { body: [231, 60, 94], header: [231, 70, 58], border: [231, 75, 50], text: 'light' },
  violet: { body: [262, 60, 94], header: [262, 70, 60], border: [262, 75, 52], text: 'light' },
  pink:   { body: [330, 70, 94], header: [330, 70, 58], border: [330, 75, 50], text: 'light' },
};
```

Plus the existing specials:

- `'none'` → transparent body, transparent border (header falls back to `sf:bg-muted`).
- `'white'` → opaque white body and header.
- `'default'` → theme-driven `hsl(var(--card))` body and `hsl(var(--primary))` border (dark-mode adaptive). Stays the unset-value fallback.

Removed tokens: `gray`, `rose`, `lime`, `purple` (overlap with `slate` / `red` / `green` / `violet`). Existing flows storing dropped tokens forward-migrate to the nearest neighbor (see Migration below).

### `colorTokenStyle` math

- `'node'` → `{ borderColor: hsl(border), backgroundColor: hsl(body) }`. Both opaque.
- `'node-header'` → `{ backgroundColor: hsl(header) }`. Solid title bar.
- `'node-header-text'` → reads `THEMES[token].text` directly: `'light'` → dark text, `'dark'` → light text. Drops the old lightness threshold heuristic.
- `'edge'` → `hsl(border)` (saturated, matches connectors).
- `'text'` → `hsl(border)` (preserves the text-shape fallback that stores text color in `borderColor`).

The `BODY_ALPHA` constant and `paintedLightness` helper are deleted.

## Toolbar restructure

Edit `packages/canvas/src/components/style-strip.tsx`:

**Remove**:
- The "Fill" popover (current lines ~676–693).
- The "Color" sub-section inside the Text popover (current lines ~822–835) and its `applyTextColor`, `textColorActive`, `showTextColorSection` plumbing.

**Re-purpose** the "Border color" popover as the unified "Color" popover:
- Test id `style-strip-border-color-button` → `style-strip-color-button`.
- Tooltip "Border color" → "Color".
- Trigger swatch reads `backgroundColor` (body) — the dominant visual.

**Single apply path** writes both fields atomically per undo entry:

```ts
const applyColor = (token: ColorToken) => {
  if (nodes.length > 1 && onStyleNodes) {
    onStyleNodes(nodes.map(n => n.id), { borderColor: token, backgroundColor: token });
  } else {
    for (const n of nodes) onStyleNode(n.id, { borderColor: token, backgroundColor: token });
  }
  for (const c of connectors) onStyleConnector(c.id, { color: token });
};
```

**Mixed-selection rule**: when selected nodes have mismatched `borderColor` vs `backgroundColor` (legacy data), the trigger reads `backgroundColor`. The picker overwrites both on click, reconciling legacy split values on first edit. No standalone migration script.

**Image branch** keeps its dedicated "Border color" popover (image nodes have no body fill to bundle with). It pulls from the same curated palette via `COLOR_TOKENS`.

**Icon branch** unchanged.

## Renderer cleanup

Drop `textColor` from `NodeVisual` in `packages/canvas/src/types.ts` and from `NodeStylePatch` in `style-strip.tsx`.

**`rectangle-node.tsx`** (lines 74–78, 156): description text and `<NodeHeader>` no longer receive `textColor`. Description text falls back to `sf:text-muted-foreground` — readable on every body L≥90 pastel. Header text auto-adapts via `'node-header-text'`.

**`geometric-node.tsx`** (lines 254–287): drop `explicitTextColor`; keep the text-shape fallback to `borderColor`:

```ts
const textColorStyle = isText ? colorTokenStyle(data.borderColor, 'text') : {};
```

Text shapes have no body or header chrome, so the unified "Color" pick writes both fields but only `borderColor` is consumed by the renderer. The `backgroundColor` write is harmless dead data on text shapes — accepted in exchange for a single apply path.

**`node-header.tsx`**: drop the `textColor` prop and its plumbing. The auto-adapt branch reads `THEMES[backgroundColor].text` via `'node-header-text'`.

## Migration

Existing `flow.json` files may carry:
- `textColor` keys → strip via a Zod `.transform()` on `NodeVisual` at the studio boundary (`apps/studio/src/schema.ts`). Silent forward-migration.
- Dropped palette tokens (`gray`, `rose`, `lime`, `purple`) on `borderColor` / `backgroundColor` / connector `color` → map to nearest neighbor in the same transform:
  - `gray` → `slate`
  - `rose` → `red`
  - `lime` → `green`
  - `purple` → `violet`

No flag, no breaking error; old files load and re-save in the new shape.

## Edge cases

- **Status pulse error border**: `rectangle-node.tsx:85–88` overrides border to `'red'` on `statusReport.state === 'error'`. Continues working under the new `THEMES.red.border`.
- **Connectors**: connector color reads `THEMES[token].border` (saturated). Edges stay punchy.
- **`'none'`** body: header still falls back to `sf:bg-muted` via the existing `headerColored` guard in `node-header.tsx:65–66`.
- **`'default'`**: omitted from the picker grid (it's an unset fallback, not a user-facing choice — matches today's behavior in `style-strip.tsx:117–121`).

## Build order

Single PR; cosmetic change, no flags.

1. Rewrite `color-tokens.ts` with `THEMES` + new `colorTokenStyle` math; drop `BODY_ALPHA` and `paintedLightness`.
2. Drop `textColor` from `NodeVisual` in `types.ts` and from the Zod schema; add the `.transform()` that strips stale keys and remaps dropped tokens.
3. Remove `textColor` reads from `geometric-node.tsx`, `rectangle-node.tsx`, `node-header.tsx`.
4. Refactor `style-strip.tsx`: rename Border-color popover → "Color"; merge apply to write both fields; delete Fill popover and Text-color section; update palette list to the 11 curated tokens.
5. Update tests; delete obsolete ones (text-color swatch, fill swatch). Add a test that picking a swatch writes both `borderColor` and `backgroundColor` in one undo entry.
6. `bun run --filter @seeflow/canvas build` to refresh `dist/`.
7. `bun run test:it:update-snapshots` and commit the regenerated `*-chromium-linux.png` baselines.

## Reality-check

`design/design.html` is the studio's source of truth per `packages/canvas/CLAUDE.md`. The L≥90 pastel bodies and L≈38–60 headers proposed here are an opinion — worth visually cross-checking against the design doc's swatches before locking the L values. Iteration after a first pass is a constants tweak in `THEMES`, no architecture change.
