# @seeflow/canvas — Standalone Package Design

**Date:** 2026-05-19
**Status:** Approved, ready for implementation plan

## Goal

Turn `packages/canvas` into a truly standalone React package: any external
consumer can drop in `<SeeflowCanvas>` and get pixel-identical styling with
zero configuration. The consumer imports two things — the component and a
single CSS file — and they're done.

## Target consumer

External React apps that link the package via filesystem path (git submodule,
yarn link, npm `file:` dep). Not npm-published. The consumer is free to use
their own Tailwind, their own design tokens, their own fonts — none of it
should affect the canvas, and the canvas should not affect them.

## Design decisions

1. **Isolation: Tailwind prefix.** Configure the package's Tailwind with
   `prefix: 'sf-'`. Every utility class in every component file becomes
   `sf-bg-primary`, `sf-rounded-md`, etc. Zero collision risk with the
   consumer's Tailwind, no runtime overhead, no specificity tricks.

2. **Globals scoped under `.seeflow-canvas-root`.** Every non-Tailwind rule
   (design tokens, React Flow overrides, keyframes, font declarations, the
   global `button:not(:disabled)` cursor rule) nests under the wrapper class.
   `<SeeflowCanvas>` puts that class on its outermost element. Outside the
   wrapper, the consumer's CSS is untouched.

3. **Theme is fully locked.** No CSS variables exposed for consumer
   overrides. Canvas always looks emerald-on-zinc, current shadows, current
   fonts. Tokens become constants in the compiled CSS.

4. **Pre-built `dist/` committed to git.** `dist/index.js`, `dist/index.d.ts`,
   `dist/style.css`. Consumers don't run a build. GitHub Action rebuilds
   `dist/` on every push that touches the package source and commits with
   `[skip ci]`.

5. **`apps/web` becomes a consumer.** Drops the Tailwind content scan for
   the canvas package, drops canvas-specific tokens from its own
   `index.css`, imports `@seeflow/canvas/style.css` once. The studio acts
   as the live integration test for the source; an external repo acts as
   the integration test for `dist/`.

## Package shape & public API

```jsonc
{
  "name": "@seeflow/canvas",
  "version": "0.1.0",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./style.css": "./dist/style.css"
  },
  "files": ["dist", "README.md"]
}
```

Consumers:

```tsx
import '@seeflow/canvas/style.css';        // once, at app entry
import { SeeflowCanvas } from '@seeflow/canvas';

<SeeflowCanvas mode="view" nodes={…} connectors={…} />
```

Peer deps unchanged: `react`, `react-dom`, `@xyflow/react`, `lucide-react`,
`react-markdown`, `remark-gfm`. Everything else (Radix, cmdk, cva, clsx,
tailwind-merge, dagre, tailwindcss-animate) moves to `dependencies` and is
bundled by tsup.

## Build pipeline

| File | Producer | Contents |
|---|---|---|
| `dist/index.js` | tsup (esm) | Bundled TS components + JS-only deps |
| `dist/index.d.ts` | tsup (dts rollup) | Type declarations for the public barrel |
| `dist/style.css` | tailwindcss CLI + postcss | Compiled utilities + scoped globals, minified |
| `dist/style.css.map` | postcss | CSS sourcemap |

Scripts on `packages/canvas/package.json`:

```jsonc
"scripts": {
  "build": "bun run build:css && bun run build:js",
  "build:css": "tailwindcss -c tailwind.config.cjs -i src/styles/index.css -o dist/style.css --minify",
  "build:css:watch": "tailwindcss -c tailwind.config.cjs -i src/styles/index.css -o dist/style.css --watch",
  "build:js":  "tsup src/index.ts --format esm --dts --external react --external react-dom --external @xyflow/react --external lucide-react --external react-markdown --external remark-gfm",
  "typecheck": "tsc --noEmit"
}
```

Tailwind config (`packages/canvas/tailwind.config.cjs`): `prefix: 'sf-'`,
`darkMode: 'class'`, `content: ['src/**/*.{ts,tsx}']`, the same `theme.extend`
the studio currently carries, plus the `tailwindcss-animate` plugin.

GitHub Action `.github/workflows/build-canvas.yml`: triggers on pushes that
touch `packages/canvas/src/**` or its config files. Steps: checkout →
setup-bun → `bun install` → `bun run --filter @seeflow/canvas build` → if
`dist/` changed, commit `build: rebuild canvas dist [skip ci]` and push.
Mirrors the existing `dist/web` workflow.

## Local dev: skip the build

The studio shouldn't pay for the `dist/` step during development.

**JS** — `apps/web/vite.config.ts` aliases `@seeflow/canvas` to
`packages/canvas/src/index.ts`. Vite resolves directly to source, full HMR
on every component edit. Production studio builds use the same alias.
`dist/index.js` exists for external consumers only.

```ts
resolve: {
  alias: {
    '@seeflow/canvas': path.resolve(__dirname, '../../packages/canvas/src/index.ts'),
  },
},
```

**CSS** — root `bun run dev` script runs Vite and `tailwindcss --watch`
concurrently. JIT keeps rebuilds under 100ms; most edits never touch class
names so the watcher rarely fires.

```jsonc
// package.json (root)
"scripts": {
  "dev": "concurrently \"bun run --filter @seeflow/canvas build:css:watch\" \"bun run --filter @seeflow/web dev\""
}
```

## Source refactor

**Pass 1 — Tailwind prefix.** Every Tailwind utility in every `.tsx`/`.ts`
under `packages/canvas/src` gets `sf-` prepended:

- `'bg-primary text-foreground rounded-md'` → `'sf-bg-primary sf-text-foreground sf-rounded-md'`
- `'hover:bg-emerald-400'` → `'sf-hover:bg-emerald-400'`
- `'h-[17px]'` → `'sf-h-[17px]'`
- `'animate-in fade-in-0'` → `'sf-animate-in sf-fade-in-0'`

Untouched: non-Tailwind globals (`seeflow-no-scrollbar`,
`seeflow-connector-endpoint-dot`), xyflow's own classes
(`react-flow__node`, `react-flow__handle`), test fixtures, schema enums.

**Pass 2 — Move global CSS into the package.** Create
`packages/canvas/src/styles/index.css`. Cut everything canvas-related from
`apps/web/src/index.css` into this file. Wrap every rule under
`.seeflow-canvas-root`:

```css
@import url("https://fonts.googleapis.com/css2?family=Inter…");

@tailwind base;
@tailwind components;
@tailwind utilities;

.seeflow-canvas-root {
  --background: 240 10% 3.9%;
  --primary: 160 84% 39.4%;
  --seeflow-handle-fill: hsl(var(--background));
  /* …all tokens… */
}

.seeflow-canvas-root .react-flow__node .react-flow__handle { … }
.seeflow-canvas-root .react-flow__node.selected::after { … }
.seeflow-canvas-root button:not(:disabled) { cursor: pointer; }
```

The `@import` for Google Fonts stays at file top per CSS spec; the font
loads globally but `font-family` is only applied to elements inside the
wrapper.

`<SeeflowCanvas>` (`components/seeflow-canvas.tsx`) puts
`className="seeflow-canvas-root"` on its outermost wrapper and threads a
ref to that element into every Radix primitive's `Portal.container` so
popovers, dropdowns, dialogs, and tooltips render inside the wrapper and
inherit the scoped CSS.

## apps/web migration

- Drop `'../../packages/canvas/src/**/*.{ts,tsx}'` from
  `apps/web/tailwind.config.js` content.
- Strip all canvas-specific tokens, keyframes, React Flow overrides, and
  global cursor rules from `apps/web/src/index.css`. Keep only studio chrome
  tokens, the body background gradient, and the html/body reset.
- Add `import '@seeflow/canvas/style.css'` to `apps/web/src/main.tsx`
  above the existing `import './index.css'`.
- Add the Vite alias above.

## File plan

**Created**

- `packages/canvas/tailwind.config.cjs`
- `packages/canvas/postcss.config.cjs`
- `packages/canvas/src/styles/index.css`
- `packages/canvas/tsup.config.ts`
- `.github/workflows/build-canvas.yml`
- `packages/canvas/dist/.gitkeep`

**Modified**

- `packages/canvas/package.json` (exports, deps shuffle, scripts)
- `packages/canvas/src/components/seeflow-canvas.tsx` (wrapper class + Radix portal containers)
- Every Tailwind-using `.tsx`/`.ts` under `packages/canvas/src` (prefix migration)
- `apps/web/src/index.css` (strip canvas-related CSS)
- `apps/web/src/main.tsx` (import canvas style.css)
- `apps/web/tailwind.config.js` (drop canvas content scan)
- `apps/web/vite.config.ts` (alias)
- Root `package.json` (concurrently dep, combined dev script)

## Verification

1. `bun run typecheck` clean.
2. `bun test` clean (canvas tests assert on `className` substrings; the
   prefix migration must reach them).
3. `bun run --filter @seeflow/canvas build` produces all four `dist/`
   artifacts. CSS minified+gzip target: ~30 KB.
4. `bun run dev` — studio at :5173 pixel-identical to pre-refactor. Diff
   via `git stash` + screenshot.
5. **External smoke test.** Throwaway Vite + React app, install canvas via
   `file:` path, render `<SeeflowCanvas mode="view" nodes={[demo]} connectors={[]} />`,
   confirm visuals match the studio. The real acceptance test.

## Open risks

- **Radix portal container.** Every Radix `<*.Portal>` inside the canvas
  must receive `container={ref.current}` or it renders outside the wrapper
  and loses all scoped CSS. Mitigation: a `useCanvasPortalContainer()` hook
  plus a grep audit during the refactor.
- **Font `@import` placement.** Must precede every rule in the CSS file.
  Lives at file top, outside the wrapper. Font loads globally; `font-family`
  is only applied inside the wrapper.
- **`tailwindcss-animate` utility names.** Plugin emits `animate-in`,
  `slide-in-from-top`. Tailwind v3 prefixes plugin utilities by default;
  verify on a Radix dialog before declaring victory.
- **xyflow internal class names.** `react-flow__*` classes are injected by
  the library at runtime and stay unprefixed. Our overrides for them live
  under `.seeflow-canvas-root` so they only affect xyflow instances inside
  the canvas — good.
