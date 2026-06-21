# Toolbox color palette: +5 hues & contrast review

**Date:** 2026-05-28

## Goal

1. Add 5 more predefined node colors to the toolbox palette.
2. Verify every color's header text contrasts against its header bar so titles
   read well whether the node sits on a light or dark canvas.

## Background

The palette is fixed-HSL and theme-independent: each node paints as its own
pastel "island" regardless of light/dark mode. Source of truth is the `THEMES`
table in `packages/canvas/src/lib/color-tokens.ts`, a `(body, header, border,
text)` tuple per hue:

- `body` L≥90 (pastel) — node fill; dark/saturated text reads on it.
- `header` L≈40–58 (saturated mid) — title bar.
- `border` darker/more saturated — outline + connector + swatch chip.
- `text` flags the header's character: `'light'` header → dark title text;
  `'dark'` header → light (white) title text.

The grid (`ColorSwatchGrid`, 6-col) already anticipates an 18-slot palette.
Before this change: `none` + `white` + 11 hues = 13 slots. Adding 5 → 18 =
exactly 3 full rows.

No migration code exists for the previously-dropped `gray`/`rose`/`lime`/
`purple` tokens (commit 3dfc9f7: "old projects will be regenerated"). The
`color-tokens.test.ts` comment claiming a "Zod transform forward-migrates"
them is stale and gets corrected here. Re-adding `gray`/`lime` is safe.

## Part 1 — the 5 new hues

| token     | body HSL    | header HSL  | border HSL  | header text   |
| --------- | ----------- | ----------- | ----------- | ------------- |
| `yellow`  | `52 96 90`  | `50 95 52`  | `47 90 42`  | dark (`light`)|
| `lime`    | `90 70 90`  | `95 60 45`  | `98 65 35`  | dark (`light`)|
| `sky`     | `200 90 92` | `200 88 46` | `202 90 39` | white (`dark`)|
| `fuchsia` | `292 70 94` | `292 68 58` | `292 75 49` | dark (`light`)|
| `gray`    | `220 8 92`  | `220 7 46`  | `220 9 42`  | white (`dark`)|

Rationale: `yellow`+`lime` fill the 99° amber→green gap; `sky` sits between
cyan(189) and blue(217); `fuchsia` fills the 68° violet→pink gap; `gray` is a
true near-neutral (sat 7–9%) distinct from slate's blue-gray (sat 16–25%).

Ordering in every list places each new hue next to its neighbor: `yellow`
after `amber`, `lime` after `yellow`, `sky` between `cyan` and `blue`,
`fuchsia` between `violet` and `pink`, `gray` right after `slate`.

## Part 2 — contrast review (existing hues)

White-text contrast audited against each header:

| token    | header     | white ratio | action                              |
| -------- | ---------- | ----------- | ----------------------------------- |
| `amber`  | `38 85 50` | ~2.0:1 ❌   | flip to dark text (`text: 'light'`) |
| `cyan`   | `189 75 42`| ~3.0:1 ⚠️   | darken header → `189 80 38`         |
| `orange` | `25 85 50` | ~2.9:1      | nudge header → `25 85 46` for margin|
| rest     | —          | ≥4:1 ✓      | keep                                |

Headline fix: yellow-family hues (amber + new yellow/lime) are intrinsically
too luminous for white text → all use dark text. Everything else follows the
existing L-threshold rule. Static `text` flag retained — no runtime luminance
math (YAGNI).

Resulting `text`-flag groups:

- **Dark text** (`text: 'light'`): white, indigo, violet, pink, **amber**,
  yellow, lime, fuchsia
- **White text** (`text: 'dark'`): slate, red, orange, green, teal, cyan,
  blue, sky, gray

Out of scope: a `gray`/dark-hue *text-shape* or connector on a dark canvas is
dim, but that's a pre-existing property of the whole palette, not introduced
by these additions.

## Change surface

1. `packages/canvas/src/lib/color-tokens.ts` — `THEMES` + `ThemeToken` union;
   amber/cyan/orange tweaks.
2. `packages/canvas/src/types.ts` — `ColorToken` union.
3. `apps/studio/src/schema.ts` — `ColorTokenSchema` enum.
4. `packages/canvas/src/components/style-strip.tsx` — `PALETTE_TOKENS`.
5. `packages/canvas/src/lib/color-tokens.test.ts` — `ALL_TOKENS` (14→19), the
   two text-flag partition lists, and the stale migration comment.

Then: `bun run typecheck` + `bun test`, rebuild `dist/` via
`bun run --filter @seeflow/canvas build`. Visual baselines intentionally not
regenerated in this pass.
