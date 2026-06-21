# Node color palette expansion — design

## Goal

Refresh the node color picker in the Style strip to:

1. Support an explicit "no color" option for border and background.
2. Expand the color palette from 8 to 18 swatches (single flat palette).
3. Drop the chunky border outline on each swatch, shrink the swatch
   size, and tighten the grid.

User-facing surface lives in `packages/canvas/src/components/style-strip.tsx`.
Schema lives in `apps/studio/src/schema.ts`. Color resolution lives in
`packages/canvas/src/lib/color-tokens.ts`.

## Section 1 — Schema and `'none'` semantics

Extend `ColorTokenSchema` (`apps/studio/src/schema.ts:15`):

```ts
export const ColorTokenSchema = z.enum([
  'none',     // NEW — explicit transparent
  'default',  // theme-aware brand color (unchanged)
  'slate', 'gray',
  'red', 'rose', 'orange', 'amber',
  'lime', 'green', 'teal', 'cyan',
  'blue', 'indigo', 'violet', 'purple', 'pink',
]);
```

Two special tokens (`none`, `default`) plus 16 colors = 18 swatches,
sized for a 6-column × 3-row grid.

### `'none'` behavior in `colorTokenStyle`

- **`node` kind** → `{ borderColor: 'transparent', backgroundColor: 'transparent' }`.
  Border-width slider still applies — the stroke is simply invisible.
- **`node-header` kind** → `{ backgroundColor: 'transparent' }`.
- **`text` / `edge` kinds** → never reached. The swatch grid hides
  the `'none'` cell for these kinds (invisible text/edges are not
  useful, and `'default'` already covers "inherit").

### Backwards compatibility

- Existing flows with `undefined` continue to resolve to `'default'`.
- Existing flows with one of the original 8 tokens are unchanged.
- `'none'` is purely additive — no migration needed.

## Section 2 — Swatch visual redesign

Drop the `border-2` outline. Today each swatch fills with the muted
`background` hex and uses the saturated tint as a thick border (dark
circle, bright outline). The new design shows a flat, saturated tint
circle — smaller and tighter.

|         | Today          | After                                              |
| ------- | -------------- | -------------------------------------------------- |
| Size    | `h-7 w-7`      | `h-5 w-5`                                          |
| Border  | `border-2`     | none                                               |
| Gap     | `gap-1.5`      | `gap-1`                                            |
| Grid    | 4 col × 2 row  | 6 col × 3 row                                      |
| Fill    | `background` hex | `edge` hex (single source across border/fill/text) |

### Trade-off

Background swatches no longer preview the actual node fill (dark
variant). All swatches show the same saturated tint regardless of
kind. We lose preview fidelity on the fill row in exchange for
visual clarity and a Figma/Linear feel. The selected node on the
canvas is the real preview.

### Special-slot rendering

- **`'none'`** — empty circle with a 45° diagonal red slash (Figma
  pattern). The only swatch that keeps a 1px border so the slot
  reads against the popover background.
- **`'default'`** — half-and-half split circle: theme primary green
  on the left, theme card color on the right. Conveys "border and
  fill from theme" at a glance.

### Interaction

- Active state unchanged: `ring-2 ring-ring ring-offset-2` with a
  small check mark.
- Hover scales the swatch (`hover:scale-110`) — same as today.
- Popover padding tightens (`p-2` → `p-1.5`) to match the denser grid.

## Section 3 — Files that change

### `apps/studio/src/schema.ts:15`

Extend `ColorTokenSchema` enum. Additive only.

### `packages/canvas/src/lib/color-tokens.ts`

- Add `none` and the 10 new color entries to `COLOR_TOKEN_MAP`.
- Special-case `'none'` in `colorTokenStyle`:

  ```ts
  if (resolved === 'none') {
    if (kind === 'node')
      return { borderColor: 'transparent', backgroundColor: 'transparent' };
    if (kind === 'node-header')
      return { backgroundColor: 'transparent' };
    // text / edge: 'none' should not reach here — grid hides the cell.
  }
  ```

### `packages/canvas/src/components/style-strip.tsx`

- `PALETTE_TOKENS` (line 104) expands to 18 entries.
- `swatchPreviewStyle` / `swatchTriggerFillStyle` (lines 737–750)
  collapse to one rule: return `{ backgroundColor: palette.edge }`
  for normal tokens; special-case `'none'` (slashed empty) and
  `'default'` (half-and-half split).
- `ColorSwatchGrid` and `SwatchButton` popover content:
  `grid-cols-6 gap-1`, swatch `h-5 w-5`, drop `border-2`.
- Add `allowNone?: boolean` prop to `ColorSwatchGrid`. Pass `false`
  from the text-color row (line 656) and the connector-color row;
  pass `true` (or omit) from border/fill rows.
- `SwatchButton` trigger swatch: keep the existing diagonal stripe
  for `isUnset` — that is the trigger's "no explicit color set"
  indicator, not the popover content.

### Tests

- `packages/canvas/src/lib/color-tokens.test.ts` — add cases for
  `'none'` across all kinds; assert text/edge raise or fall through
  cleanly.
- `packages/canvas/src/components/style-strip.test.tsx` — update
  swatch count from 8 to 18, update grid query selectors, add a case
  asserting the text-color grid omits the `'none'` cell.
- e2e snapshots: regenerate only if a baseline screenshot includes
  the open color popover. Run
  `bun run test:it:update-snapshots` and commit the
  `*-chromium-linux.png` files (per CLAUDE.md — never `*-darwin.png`).

### No-op

- `apps/web` — does not render the picker.
- The adapter and disk-side `style.json` writer.

## Rollout

One PR. Schema, color tokens, and Style strip move together since
the enum is the contract between them. The `@seeflow/canvas` package
CI on `main` re-commits `dist/` for external consumers
(per `packages/canvas/CLAUDE.md`).
