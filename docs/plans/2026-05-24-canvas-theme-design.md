# Light/Dark Theme Support — Canvas + Studio

**Status:** Design approved 2026-05-24
**Scope:** `packages/canvas/` + `apps/web/`
**Driver:** Embedder demand — external consumers of `@seeflow/canvas` need light-theme support to match their host app chrome.

## Problem

`@seeflow/canvas` is dark-only today. Token values on `.seeflow-canvas-root` are a single dark palette; `apps/web` mirrors them at `:root`. Both packages already declare `@custom-variant dark (&:is(.dark *))` but no `.dark` class is applied anywhere — today's dark look comes from those being the only token values, not from any toggle.

Embedders integrating the canvas into light-themed host apps have no way to make it match.

## Goals

- External consumers of `@seeflow/canvas` can theme the canvas by putting `.dark` on any ancestor — zero new props required.
- `apps/web` exposes a user-facing theme toggle (Cog menu in header) with three states: Light / Dark / System.
- Designed light palette (neutral zinc/slate + emerald primary), not a mechanical inversion.
- Iframe embed (no shared ancestor with host) supports `?theme=` query param.
- No flash-of-wrong-theme on first paint.

## Non-goals

- Per-component light variants beyond what the token split provides.
- Brand colors other than emerald in the light palette.
- Customizable user palettes / theme builder.
- Dark mode for the embed dialog content itself when the canvas is light (always matches canvas).

---

## Architecture

**One source of truth:** the `.dark` class on `<html>`. The web app's Cog menu owns the toggle and writes it; `localStorage['seeflow:theme']` persists the choice. Two CSS surfaces respond:

1. **Tailwind utilities** (already declared in both packages via `@custom-variant dark (&:is(.dark *))`). Every `sf:dark:bg-foo` / `dark:bg-foo` class flips automatically.
2. **Token blocks** — currently single-palette, split into light default + `.dark { ... }` override.

External embedders apply the same contract: they put `.dark` on any ancestor of `<SeeflowCanvas>` and inheritance does the rest. The component signature stays the same — no new props.

**Default is light** in both packages. The web app's mount-time `localStorage` read plus `prefers-color-scheme` fallback means today's users see no visual change. Fresh users get their OS preference.

---

## 1. Token splits

### `packages/canvas/src/styles/index.css:62-104`

Split into light-default + dark override:

```css
/* light default */
.seeflow-canvas-root {
  --background: 0 0% 98%;
  --foreground: 240 10% 10%;
  --card: 0 0% 100%;
  --card-foreground: 240 10% 10%;
  --popover: 0 0% 100%;
  --popover-foreground: 240 10% 10%;
  --primary: 160 84% 39.4%;          /* emerald — brand, unchanged */
  --primary-foreground: 0 0% 100%;
  --secondary: 240 5% 96%;
  --secondary-foreground: 240 10% 10%;
  --muted: 240 5% 96%;
  --muted-foreground: 240 4% 46%;    /* 4.6:1 against --background, WCAG AA */
  --accent: 240 5% 94%;
  --accent-foreground: 240 10% 10%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 0 0% 100%;
  --border: 240 6% 90%;
  --input: 240 6% 86%;
  --ring: 160 84% 39.4%;
  --radius: 0.5rem;
  /* font + color: hsl(var(--foreground)) declarations unchanged */
}

/* dark override — verbatim current values */
.dark .seeflow-canvas-root {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  /* ...rest of today's dark block, unchanged... */
}
```

### `apps/web/src/index.css:93-132`

Same treatment: light tokens stay at `:root`, dark tokens move into `.dark { ... }`. Verbatim current values become the dark block.

---

## 2. Non-token fixes in `packages/canvas/`

These reference colors directly and don't respond to tokens. Each needs a light variant.

| Item | Location | Today | Light variant |
|---|---|---|---|
| `--bg-canvas` | `styles/index.css:84` | `#0a0a0c` | `#fafafa` |
| `--emerald-glow` | `:85` | `rgba(16,185,129,0.35)` | `rgba(16,185,129,0.18)` |
| `--shadow-card` | `:86` | `rgba(0,0,0,0.5)` | `rgba(15,23,42,0.08)` |
| `--shadow-window` | `:87` | heavy black + emerald | softened alphas |
| `--shadow-glow-ok` | `:88` | emerald 0.45 | emerald 0.30 |
| `--shadow-glow-pending` | `:89` | amber 0.45 | amber 0.30 |
| `--ring-selected` | `:90` | bright emerald rings | outer halo alpha trimmed |
| Glow overlay dot color | `:477` | `rgba(255,255,255,0.55)` | promote to new `--glow-dot-color` token; light = `rgba(0,0,0,0.18)`, dark = current |
| `CANVAS_BACKGROUND_FALLBACK` | `lib/export-image.ts:17` | hardcoded `#0a0a0c` | read computed style of `--bg-canvas` at capture time |

**Unchanged** (status colors / gesture pulses keep impact in both themes):
- `--amber`, `--amber-hi`, `--danger` (status colors)
- Keyframe rgbas at lines 145, 148, 200, 203 (gesture animations)

---

## 3. Cog menu in `apps/web` header

### Placement

Right of `<ProjectSwitcher>` in `apps/web/src/components/header.tsx`. Button uses `lucide-react`'s `Settings` icon. Opens a `DropdownMenu` re-exported from `@seeflow/canvas` (already themed, portal handling solved).

### Initial content

One menu group — "Theme" — with three radio items: **Light**, **Dark**, **System**. Built as a list so future settings append in one line.

### `useTheme` hook

New file `apps/web/src/hooks/use-theme.ts`:

- On mount, read `localStorage['seeflow:theme']` (default `'system'`).
- Resolve `'system'` to `'light' | 'dark'` via `window.matchMedia('(prefers-color-scheme: dark)')`.
- Subscribe to the media query so OS-level theme changes propagate while the app is open.
- Imperatively toggle `document.documentElement.classList` between `'light'` and `'dark'`.
- Write changes back to `localStorage`.
- Return `{ theme, setTheme, resolvedTheme }`.

### FOUC prevention

Inline script in `apps/web/index.html` (before React boots):

```html
<script>
  (function () {
    var stored = localStorage.getItem('seeflow:theme');
    var resolved = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.classList.add(resolved);
  })();
</script>
```

Zero flash. Standard practice (Next.js, Linear, Vercel use the same shape).

---

## 4. Iframe embed `?theme=`

The embed dialog (`packages/canvas/src/components/embed-dialog.tsx`) generates an iframe URL for the hosted viewer. Iframes don't share an ancestor with the host page, so `.dark` inheritance doesn't carry.

**Embed URL builder** appends `?theme=<value>` based on the calling canvas's current resolved theme. New toggle in the embed dialog: "Match my theme / Light / Dark".

**Viewer page** reads `URLSearchParams`, applies `.dark` to `<html>` via the same FOUC-prevention inline script. Missing `?theme=` defaults to `light` (matches the new package default — safer for unknown host contexts).

Backwards compatibility: existing embed URLs in the wild fall through to light. No breakage; just a visual delta for embeds that previously rendered dark by accident.

---

## 5. Testing & rollout

### Unit tests (Bun)

- `apps/web/src/hooks/use-theme.test.ts` — new. Covers localStorage roundtrip, `'system'` → matchMedia resolution, OS-preference change subscription, `<html>` class application.
- Canvas component tests unchanged (they don't assert on color values).

### Playwright e2e (`apps/studio/e2e/`)

Existing baselines are dark, pinned chromium-linux. Problem: the inline FOUC script would set `.dark` based on the test browser's empty `localStorage` → `'system'` → CI Linux container default (light), breaking every existing baseline.

**Mitigation:** test setup writes `localStorage['seeflow:theme'] = 'dark'` before navigation. All existing snapshots stay valid.

**New e2e spec:** one test that opens the Cog menu, cycles through all three theme states, asserts on `document.documentElement.classList`, and captures one new light-mode baseline of a representative canvas. ~1 new `*-chromium-linux.png` file.

### Rollout order

1. **PR 1** — Canvas package: token split + non-token fixes. Dark-only behavior preserved (no `.dark` class anywhere yet). Embedders can opt in immediately by putting `.dark` on their app shell.
2. **PR 2** — Web app: `useTheme` hook + inline FOUC script + Cog menu + token split. User-visible toggle ships.
3. **PR 3** — Embed `?theme=`. Lower priority, can wait.

---

## Effort

| Block | Effort |
|---|---|
| Canvas token split + non-token fixes | ~½ day |
| Web token split | ~1 hour |
| `useTheme` hook + inline FOUC script | ~3 hours |
| Cog `DropdownMenu` in header | ~2 hours |
| Embed `?theme=` end-to-end | ~3 hours |
| Playwright `localStorage` write + new light baseline | ~2 hours |
| README / CLAUDE.md docs in both packages | ~1 hour |
| **Total** | **~2 focused days, ~3 calendar days with reviews** |

## Open questions

None — design is locked at the solid tier (embedder demand bar). Polish (per-component visual audit, light brand variants, both-theme snapshot doubling) deferred to a follow-up if usage data warrants it.

## Out of scope

- Updating `design/design.html` to be a dual-theme source of truth. The light palette lives in code only for now; if a designer wants to formalize it, `/design-consultation` is the route.
- Theming the Claude Code plugin output (`skills/`, `commands/`).
- Customizing the emerald brand color per-embedder.
