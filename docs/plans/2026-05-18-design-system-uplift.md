# Design System Uplift

Apply the dark zinc/emerald visual design from `design/design.html` across the entire app, expressed using the existing shadcn HSL variable format.

## Goal

The app ships as a permanently dark, zinc-950 + emerald product. `design.html` is the canonical visual reference and is updated to use the same token format as the app.

---

## Part 1: Token Foundation

### `apps/web/src/index.css`

- Drop the light `:root` entirely. Dark zinc values become the single `:root`.
- Remove the `.dark` block — the app is always dark.
- Add Inter + JetBrains Mono font imports (Google Fonts).
- Add the dotted grid background pattern to `body` (`radial-gradient` at 32px).
- Keep all existing canvas-specific rules (handles, edges, z-index, cursors) untouched.

Token mapping (hex → shadcn HSL var):

| Design token | Hex | Shadcn var | HSL |
|---|---|---|---|
| `--bg` | `#09090b` | `--background` | `240 10% 3.9%` |
| `--surface` | `#18181b` | `--card` | `240 5.9% 10.6%` |
| `--border` | `#27272a` | `--border` | `240 3.7% 15.9%` |
| `--border-hi` | `#3f3f46` | `--input` | `240 3.7% 26.1%` |
| `--text` | `#fafafa` | `--foreground` | `0 0% 98%` |
| `--text-mute` | `#a1a1aa` | `--muted-foreground` | `240 4.4% 64.9%` |
| `--text-dim` | `#71717a` | `--muted-foreground` (secondary use) | custom var |
| `--emerald` | `#10b981` | `--primary` | `160 84% 39.4%` |
| `--emerald-hi` | `#34d399` | `--primary-foreground` (inverted) | `160 68% 60%` |

Custom vars without shadcn equivalents stay as named vars in `:root`:
`--emerald-glow`, `--shadow-card`, `--shadow-window`, `--shadow-glow-ok`, `--shadow-glow-pending`, `--ring-selected`, `--bg-canvas`, `--amber`, `--amber-hi`, `--danger`, `--font-mono`.

### `design/design.html`

- Rewrite internal `<style>` to reference `hsl(var(--background))`, `hsl(var(--primary))`, etc. instead of hex named vars.
- Becomes a live spec: opening it in a browser renders the same visual output as the running app.

---

## Part 2: Component Uplift

### App shell

**`header.tsx`**
- Remove hardcoded `color: '#0f172a'` inline style — inherits `--foreground`.
- `bg-background border-b border-border` already correct; gains dark meaning from token change.

**`App.tsx`**
- `bg-background text-foreground` stays; correct once tokens flip.

### Pages

**`studio-home.tsx`**
- Demo picker cards: `bg-card border border-border rounded-lg` + `hover:border-input` (border-hi on hover).
- Remove `hover:bg-accent hover:text-accent-foreground` — subtle border brighten instead.
- Add `box-shadow` via the `--shadow-card` custom var.

**`empty-state.tsx`**
- Dark surface inherits from `bg-background`; verify no hardcoded light colors.

### Canvas surface

**`canvas-toolbar.tsx`**
- Surface: `bg-card border border-border`.
- Active tool button: emerald pill pattern (`bg-primary/10 text-primary border border-primary/30`).

**`demo-canvas.tsx`**
- Canvas background: `--bg-canvas` via inline style or CSS var.

### Panels + overlays

**`detail-panel.tsx`**
- Matches design.html sidebar spec: `bg-card/94 backdrop-blur-sm border-border`.
- Section labels: mono 11px, `text-muted-foreground`, uppercase tracking.

**`command-palette.tsx`**
- Dark popup surface, `bg-card border border-border`, items use zinc hover.

### shadcn UI components

**`button.tsx`**
- Primary variant: `bg-primary text-black hover:bg-primary/90` (emerald fill, dark text).
- Ghost/outline: zinc surface treatment.

**`sheet.tsx`, `dialog.tsx`**
- Content: `bg-card border-border`.

**`command.tsx`**
- Input + list: zinc surfaces throughout.

### Node status

- Structurally unchanged; gains correct colors once `--primary` = emerald and amber/danger vars are in `:root`.

---

## Sequence

1. Token foundation — `index.css` dark-first rewrite + font imports.
2. `design.html` update — swap hex vars for shadcn HSL vars.
3. shadcn UI components — `button`, `sheet`, `dialog`, `command`.
4. App shell — `header`, `App`, loading state.
5. Pages — `studio-home`, `empty-state`.
6. Canvas + panels — `canvas-toolbar`, `detail-panel`, `command-palette`.
7. Verify node status colors render correctly.
