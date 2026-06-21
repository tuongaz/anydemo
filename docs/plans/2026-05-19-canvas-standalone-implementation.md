# @seeflow/canvas — Standalone Package Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn `packages/canvas` into a zero-config standalone React package — external consumers import one component and one CSS file and get pixel-identical styling.

**Architecture:** Tailwind compiled with `prefix: 'sf-'` for isolation, all non-Tailwind globals (tokens, React Flow overrides, keyframes, fonts) scoped under `.seeflow-canvas-root`, pre-built `dist/` committed to git via GitHub Action. `apps/web` (the studio) becomes a consumer of the compiled CSS via a Vite alias to source for HMR.

**Tech Stack:** Bun, TypeScript, React 18, Tailwind 3, tsup, PostCSS, Radix UI, xyflow/react.

**Design source of truth:** `docs/plans/2026-05-19-canvas-standalone-design.md`

---

## Pre-flight

Before starting, sanity-check the workspace:

```bash
cd /Users/tuongaz/dev/seeflow
bun install
bun run typecheck    # expect: clean across workspace
bun test             # expect: clean
```

If either fails, stop and surface the failure — the plan assumes a green
baseline.

---

## Phase 1 — Package build infrastructure

Goal: get `dist/index.js` and `dist/style.css` emitting from `packages/canvas`,
without changing any component source or visual behavior. The studio
continues to render identically because (a) the compiled CSS is still
empty of any scoped rules, and (b) apps/web's existing Tailwind scan over
`packages/canvas/src` is still active.

### Task 1.1 — Install build deps in the canvas package

**Files:** `packages/canvas/package.json` (modify)

**Step 1.** Add dev deps for the build toolchain.

```bash
cd /Users/tuongaz/dev/seeflow
bun add --dev --filter @seeflow/canvas tsup tailwindcss@^3.4.14 postcss@^8.4.49 autoprefixer@^10.4.20 tailwindcss-animate@^1.0.7
```

Expected: `packages/canvas/package.json` gets `devDependencies` entries
for `tsup`, `tailwindcss`, `postcss`, `autoprefixer`, `tailwindcss-animate`.

**Step 2.** Move runtime bundled deps (currently `dependencies`, but
peerDeps imply they belong to the consumer). No change needed — Radix /
cmdk / cva / clsx / tailwind-merge / dagre stay in `dependencies` and will
be bundled by tsup.

**Step 3.** Commit.

```bash
git add packages/canvas/package.json bun.lockb
git commit -m "build(canvas): add tsup + tailwindcss build toolchain"
```

### Task 1.2 — Tailwind config for the canvas package

**Files:** `packages/canvas/tailwind.config.cjs` (create)

**Step 1.** Write the config.

```js
// packages/canvas/tailwind.config.cjs
/** @type {import('tailwindcss').Config} */
module.exports = {
  prefix: 'sf-',
  darkMode: ['class'],
  content: ['src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
```

**Why CJS:** Tailwind CLI loads configs synchronously; ESM configs require
extra resolution hops that vary by Node version.

**Why this matches the studio's config exactly (minus the prefix):** we want
identical theme tokens so the only difference at the CSS level is the `sf-`
prefix on emitted utility classes.

**Step 2.** No commit yet — paired with Task 1.3.

### Task 1.3 — PostCSS config for the canvas package

**Files:** `packages/canvas/postcss.config.cjs` (create)

```js
// packages/canvas/postcss.config.cjs
module.exports = {
  plugins: {
    tailwindcss: { config: './tailwind.config.cjs' },
    autoprefixer: {},
  },
};
```

No commit yet — paired with Task 1.4.

### Task 1.4 — Canvas styles entrypoint

**Files:** `packages/canvas/src/styles/index.css` (create)

This is the file that becomes `dist/style.css`. In Phase 1 it's
minimal — just the `@tailwind` directives so we can verify the build
emits something. Phase 2 fills in the scoped globals.

```css
/* packages/canvas/src/styles/index.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

No commit yet — paired with Task 1.5.

### Task 1.5 — tsup config for the JS build

**Files:** `packages/canvas/tsup.config.ts` (create)

```ts
// packages/canvas/tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: false, // CSS is emitted to dist/ first; don't wipe it
  external: [
    'react',
    'react-dom',
    '@xyflow/react',
    'lucide-react',
    'react-markdown',
    'remark-gfm',
  ],
  outDir: 'dist',
});
```

**Why `clean: false`:** the CSS build runs first and writes `dist/style.css`;
if tsup wipes the directory it'd nuke the CSS we just emitted.

No commit yet — paired with Task 1.6.

### Task 1.6 — Package.json scripts and metadata

**Files:** `packages/canvas/package.json` (modify)

**Step 1.** Update the file with the new scripts and metadata. Diff from
current state (do NOT flip `main` to `dist/` yet — the studio still
resolves from source via the workspace alias):

```jsonc
{
  "name": "@seeflow/canvas",
  "version": "0.1.0",
  // remove: "private": true
  "type": "module",
  "main": "./src/index.ts",                      // unchanged for now
  "exports": {
    ".": "./src/index.ts",                       // unchanged for now
    "./style.css": "./dist/style.css"            // new
  },
  "scripts": {
    "build": "rm -rf dist && bun run build:css && bun run build:js",
    "build:css": "tailwindcss -c tailwind.config.cjs -i src/styles/index.css -o dist/style.css --minify",
    "build:css:watch": "tailwindcss -c tailwind.config.cjs -i src/styles/index.css -o dist/style.css --watch",
    "build:js": "tsup",
    "typecheck": "tsc --noEmit"
  },
  "files": ["dist", "README.md"]
  // peerDependencies + dependencies + devDependencies as-is
}
```

**Step 2.** Run the build to verify scaffolding works.

```bash
cd /Users/tuongaz/dev/seeflow/packages/canvas
bun run build
ls dist/
```

Expected: `dist/index.js`, `dist/index.d.ts`, `dist/index.js.map`,
`dist/style.css`. The CSS will be ~10 KB (just Tailwind base reset).
No errors.

**Step 3.** Commit.

```bash
git add packages/canvas/{tailwind.config.cjs,postcss.config.cjs,tsup.config.ts,package.json,src/styles/index.css}
git commit -m "build(canvas): wire tailwind + tsup pipeline (no source changes)"
```

### Task 1.7 — Un-ignore canvas dist/

**Files:** `.gitignore` (modify)

The root `.gitignore` has `dist/` ignored with an allowlist exception for
`apps/studio/dist/web`. Add the same exception for `packages/canvas/dist`.

**Step 1.** Edit `.gitignore`. Find the existing `dist/` block:

```
node_modules/
dist/
!apps/studio/dist/
apps/studio/dist/*
!apps/studio/dist/web
```

Add two lines so the block becomes:

```
node_modules/
dist/
!apps/studio/dist/
apps/studio/dist/*
!apps/studio/dist/web
!packages/canvas/dist/
packages/canvas/dist/*
!packages/canvas/dist/index.js
!packages/canvas/dist/index.js.map
!packages/canvas/dist/index.d.ts
!packages/canvas/dist/style.css
!packages/canvas/dist/style.css.map
```

**Why this dance:** `dist/` is matched recursively; the exception
`!packages/canvas/dist/` un-ignores the directory but its children are
re-matched by the original pattern. The explicit allowlist for each
artifact filename is the only reliable way.

**Step 2.** Verify the artifacts get tracked.

```bash
git status packages/canvas/dist/
# expect: untracked files listed
git add packages/canvas/dist/
git status packages/canvas/dist/
# expect: new files staged
```

**Step 3.** Commit.

```bash
git add .gitignore packages/canvas/dist/
git commit -m "build(canvas): commit dist/ artifacts (mirrors apps/studio/dist/web pattern)"
```

### Task 1.8 — Studio imports the compiled CSS

**Files:** `apps/web/src/main.tsx` (modify)

**Step 1.** Read the current `apps/web/src/main.tsx`. Add the canvas CSS
import on the line BEFORE the existing `import './index.css'`:

```tsx
import '@seeflow/canvas/style.css';
import './index.css';
```

**Why order matters:** CSS files load in import order; later imports win
on equal-specificity rules. The studio's own `index.css` should win for
elements OUTSIDE the canvas wrapper (e.g. the header), so it loads last.

**Step 2.** Start the studio.

```bash
cd /Users/tuongaz/dev/seeflow
bun run --filter @seeflow/web dev
```

Expected: Vite starts at :5173; canvas renders pixel-identical to before
(only Tailwind base reset added so far, no scoped rules). Visually
inspect at http://localhost:5173 — no shifts.

**Step 3.** Commit.

```bash
git add apps/web/src/main.tsx
git commit -m "studio: import @seeflow/canvas/style.css (build pipeline live)"
```

### Task 1.9 — Concurrent dev script

**Files:** root `package.json` (modify)

**Step 1.** Add `concurrently`.

```bash
bun add --dev --workspace-root concurrently
```

**Step 2.** Update the root `dev` script. Find the existing entry:

```jsonc
"dev": "..."
```

Replace with:

```jsonc
"dev": "concurrently -n canvas-css,web,studio -c blue,green,magenta \"bun run --filter @seeflow/canvas build:css:watch\" \"bun run --filter @seeflow/web dev\" \"bun run --filter @seeflow/studio dev\""
```

(Adjust the third command to match whatever your existing `dev` was
running — read the file first and preserve any other processes.)

**Step 3.** Verify.

```bash
bun run dev
```

Expected: three labeled streams in the terminal. CSS watcher rebuilds
`dist/style.css` when a canvas file changes; Vite picks it up. Hit
Ctrl+C to stop.

**Step 4.** Commit.

```bash
git add package.json bun.lockb
git commit -m "dev: run canvas CSS watcher alongside vite + studio"
```

**Phase 1 done.** Build pipeline live, studio unchanged visually.

---

## Phase 2 — Move global CSS into the canvas package

Goal: cut every canvas-related rule out of `apps/web/src/index.css` and
into `packages/canvas/src/styles/index.css`, wrapped under
`.seeflow-canvas-root`. Wire `<SeeflowCanvas>` to apply the wrapper class
and thread Radix portal containers so popovers/dropdowns inherit the
scoped CSS.

### Task 2.1 — Inventory what to move

**Files:** read `apps/web/src/index.css`

**Step 1.** Read the file. Categorize each block:

| Stays in apps/web | Moves to canvas (scoped) |
|---|---|
| `@import` of Google Fonts | (moves) |
| `:root` shadcn tokens (`--background`, `--foreground`, etc.) | (moves) |
| `:root` seeflow tokens (`--seeflow-handle-*`, `--rf-zoom`, shadows) | (moves) |
| `:root` extended palette (`--amber`, `--danger`, `--font-mono`) | (moves) |
| `@layer base { body { ... } }` body background image | STAYS (studio chrome) |
| `@layer base { html, body, #root { height: 100% } }` | STAYS (studio chrome) |
| `@layer base { * { @apply border-border } }` | STAYS (studio chrome; canvas re-declares scoped) |
| `@layer utilities { seeflow-no-scrollbar, animate-ping-fast, ... }` | (moves) |
| `.react-flow__*` overrides (all of them) | (moves) |
| `button:not(:disabled) { cursor: pointer }` | (moves — applies inside canvas only) |
| `.react-flow__node, .react-flow__node *` cursor rules | (moves) |
| `.seeflow-connector-endpoint-dot` | (moves) |
| `.react-flow .react-flow__pane.X` cursor rules | (moves) |

No code change. Just confirm the split.

### Task 2.2 — Write the scoped canvas stylesheet

**Files:** `packages/canvas/src/styles/index.css` (modify)

**Step 1.** Replace the placeholder content with the full scoped
stylesheet. Structure:

```css
/* packages/canvas/src/styles/index.css */
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap");

@tailwind base;
@tailwind components;
@tailwind utilities;

/* All tokens live on the wrapper, NOT :root. Consumer's :root is untouched. */
.seeflow-canvas-root {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  --card: 240 5.9% 10.6%;
  --card-foreground: 0 0% 98%;
  --popover: 240 5.9% 10.6%;
  --popover-foreground: 0 0% 98%;
  --primary: 160 84% 39.4%;
  --primary-foreground: 162 89% 10%;
  --secondary: 240 6% 13%;
  --secondary-foreground: 0 0% 98%;
  --muted: 240 7% 12%;
  --muted-foreground: 240 4.4% 64.9%;
  --accent: 240 3.7% 15.9%;
  --accent-foreground: 0 0% 98%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 98%;
  --border: 240 3.7% 15.9%;
  --input: 240 3.7% 26.1%;
  --ring: 160 84% 39.4%;
  --radius: 0.5rem;

  --bg-canvas: #0a0a0c;
  --emerald-glow: rgba(16, 185, 129, 0.35);
  --shadow-card: 0 4px 12px -2px rgba(0, 0, 0, 0.5);
  --shadow-window: 0 30px 80px -20px rgba(0, 0, 0, 0.6), 0 0 60px -20px var(--emerald-glow);
  --shadow-glow-ok: 0 0 30px -4px rgba(16, 185, 129, 0.45);
  --shadow-glow-pending: 0 0 30px -4px rgba(245, 158, 11, 0.45);
  --ring-selected: 0 0 0 3px rgba(16, 185, 129, 0.22), 0 0 40px -6px rgba(16, 185, 129, 0.55);
  --amber: #f59e0b;
  --amber-hi: #fbbf24;
  --danger: #ef4444;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;

  --seeflow-handle-fill: hsl(var(--background));
  --seeflow-handle-border-color: hsl(var(--primary) / 0.6);
  --seeflow-handle-border-width: calc(1px / var(--rf-zoom, 1));
  --seeflow-handle-size: calc(17px / var(--rf-zoom, 1));

  /* Font + background scoped to the wrapper — outside, consumer rules win */
  font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
  color: hsl(var(--foreground));
}

/* Utilities scoped to the wrapper */
.seeflow-canvas-root .seeflow-no-scrollbar { scrollbar-width: none; }
.seeflow-canvas-root .seeflow-no-scrollbar::-webkit-scrollbar { display: none; }

@keyframes seeflow-ping-fast {
  0% { transform: scale(1); opacity: 1; }
  75%, 100% { transform: scale(1.6); opacity: 0; }
}
.seeflow-canvas-root .animate-ping-fast {
  animation: seeflow-ping-fast 0.7s cubic-bezier(0, 0, 0.2, 1);
}

@keyframes seeflow-node-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.4); }
  50% { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0); }
}
.seeflow-canvas-root .seeflow-node-pulse {
  animation: seeflow-node-pulse 1.4s ease-in-out infinite;
}

@keyframes inline-edit-shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-3px); }
  40%, 80% { transform: translateX(3px); }
}
.seeflow-canvas-root .inline-edit-shake {
  animation: inline-edit-shake 0.32s ease-in-out;
}

.seeflow-canvas-root .inline-edit-empty::before {
  content: attr(data-placeholder);
  color: hsl(var(--muted-foreground));
  opacity: 0.5;
  font-style: italic;
  pointer-events: none;
}

/* Cursor rules — all confined to the wrapper */
.seeflow-canvas-root .react-flow__node,
.seeflow-canvas-root .react-flow__node * { cursor: default; }
.seeflow-canvas-root .react-flow__node [contenteditable="true"] { cursor: text; }
.seeflow-canvas-root button:not(:disabled) { cursor: pointer; }
.seeflow-canvas-root button:disabled { cursor: not-allowed; }
.seeflow-canvas-root .react-flow__node button:not([data-testid="play-button"]) { cursor: default; }

/* Pane cursor */
.seeflow-canvas-root .react-flow .react-flow__pane.selection { cursor: default; }
.seeflow-canvas-root .react-flow .react-flow__pane.draggable { cursor: grab; }
.seeflow-canvas-root .react-flow .react-flow__pane.dragging { cursor: grabbing; }

/* React Flow visual tweaks */
.seeflow-canvas-root .react-flow__node.connectingfrom { opacity: 0.85; }

.seeflow-canvas-root .react-flow__node .react-flow__handle {
  background: var(--seeflow-handle-fill) !important;
  border: var(--seeflow-handle-border-width) solid var(--seeflow-handle-border-color) !important;
  width: var(--seeflow-handle-size) !important;
  height: var(--seeflow-handle-size) !important;
}

.seeflow-canvas-root .react-flow__handle::after {
  content: "";
  position: absolute;
  inset: -10px;
  border-radius: 50%;
}

.seeflow-canvas-root .react-flow__node.selected:not(.react-flow__node-group),
.seeflow-canvas-root .react-flow__node[data-connect-source="true"]:not(.react-flow__node-group) {
  z-index: 1000 !important;
}

.seeflow-canvas-root .react-flow__node .react-flow__handle,
.seeflow-canvas-root .react-flow__node .react-flow__handle::after {
  cursor: default;
}

.seeflow-canvas-root .react-flow__edgeupdater {
  fill: transparent;
  stroke: transparent;
  opacity: 1;
  pointer-events: all;
  cursor: default;
}

.seeflow-canvas-root .react-flow__edge,
.seeflow-canvas-root .react-flow__edge.selectable,
.seeflow-canvas-root .react-flow__edge .react-flow__edge-path {
  cursor: default;
}

.seeflow-canvas-root .seeflow-connector-endpoint-dot {
  position: absolute;
  width: var(--seeflow-handle-size);
  height: var(--seeflow-handle-size);
  background: var(--seeflow-handle-fill);
  border: var(--seeflow-handle-border-width) solid var(--seeflow-handle-border-color);
  border-radius: 50%;
  pointer-events: none;
  z-index: 2000;
}

.seeflow-canvas-root .react-flow.seeflow-connecting
  .react-flow__node:not([data-connect-source="true"])
  .react-flow__handle { opacity: 0 !important; }

.seeflow-canvas-root .react-flow.seeflow-connecting .react-flow__node[data-connect-target="true"] > div {
  border-color: hsl(var(--muted-foreground)) !important;
  border-style: dashed !important;
}
.seeflow-canvas-root .react-flow.seeflow-connecting .react-flow__node-group[data-connect-target="true"] {
  border-color: hsl(var(--muted-foreground)) !important;
  border-style: dashed !important;
}

.seeflow-canvas-root .react-flow__node.selected::after {
  content: "";
  position: absolute;
  inset: calc(-8px / var(--rf-zoom, 1));
  border: calc(1px / var(--rf-zoom, 1)) dashed hsl(var(--primary) / 0.6);
  border-radius: 0;
  pointer-events: none;
  z-index: -1;
}

.seeflow-canvas-root .react-flow__nodesselection-rect {
  background: transparent;
  border: none;
}

.seeflow-canvas-root .react-flow__node-group {
  border: 1px dashed hsl(var(--border));
  background: transparent;
  border-radius: 4px;
}
.seeflow-canvas-root .react-flow__node-group.selected { border-color: transparent; }
.seeflow-canvas-root .react-flow__node-group.selected::after { z-index: 0; }
.seeflow-canvas-root .react-flow__node[data-gated-child="true"] { pointer-events: none; }
.seeflow-canvas-root .react-flow__node-group:has(> [data-testid="group-node"][data-active="true"]) {
  border: 2px solid hsl(var(--primary));
  background: hsl(var(--primary) / 0.04);
}
.seeflow-canvas-root .react-flow__node-group .react-flow__node-group-label {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  background: transparent;
  pointer-events: auto;
  z-index: 2;
  user-select: none;
}
.seeflow-canvas-root .react-flow__node-group .react-flow__node-group-label[data-editing="true"] {
  user-select: text;
}

/* US-007 selected-node handle transforms */
.seeflow-canvas-root .react-flow__node.selected .react-flow__handle-top {
  transform: translate(-50%, -50%) translate(0, calc(-8px / var(--rf-zoom, 1)));
}
.seeflow-canvas-root .react-flow__node.selected .react-flow__handle-bottom {
  transform: translate(-50%, 50%) translate(0, calc(8px / var(--rf-zoom, 1)));
}
.seeflow-canvas-root .react-flow__node.selected .react-flow__handle-left {
  transform: translate(-50%, -50%) translate(calc(-8px / var(--rf-zoom, 1)), 0);
}
.seeflow-canvas-root .react-flow__node.selected .react-flow__handle-right {
  transform: translate(50%, -50%) translate(calc(8px / var(--rf-zoom, 1)), 0);
}

.seeflow-canvas-root .react-flow__node.selected .react-flow__resize-control.handle.top.left {
  transform: translate(calc(-8px / var(--rf-zoom, 1)), calc(-8px / var(--rf-zoom, 1)));
}
.seeflow-canvas-root .react-flow__node.selected .react-flow__resize-control.handle.top.right {
  transform: translate(calc(8px / var(--rf-zoom, 1)), calc(-8px / var(--rf-zoom, 1)));
}
.seeflow-canvas-root .react-flow__node.selected .react-flow__resize-control.handle.bottom.left {
  transform: translate(calc(-8px / var(--rf-zoom, 1)), calc(8px / var(--rf-zoom, 1)));
}
.seeflow-canvas-root .react-flow__node.selected .react-flow__resize-control.handle.bottom.right {
  transform: translate(calc(8px / var(--rf-zoom, 1)), calc(8px / var(--rf-zoom, 1)));
}

/* React Flow Controls panel theming */
.seeflow-canvas-root .react-flow__controls {
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  box-shadow: var(--shadow-card);
}
.seeflow-canvas-root .react-flow__controls-button {
  background: hsl(var(--secondary));
  color: hsl(var(--foreground));
  border-bottom: 1px solid hsl(var(--border));
}
.seeflow-canvas-root .react-flow__controls-button:hover { background: hsl(var(--accent)); }
.seeflow-canvas-root .react-flow__controls-button:disabled { opacity: 0.4; cursor: not-allowed; }
.seeflow-canvas-root .react-flow__controls-button svg { fill: currentColor; }
```

**Verification heuristic:** count of rules in the new file ≈ count of
canvas-related rules in `apps/web/src/index.css`. Diff against the
original.

**Step 2.** Rebuild and verify file size grows.

```bash
cd /Users/tuongaz/dev/seeflow/packages/canvas
bun run build:css
wc -c dist/style.css
```

Expected: `dist/style.css` grows to ~15–25 KB minified (was ~10 KB).

**Step 3.** Commit.

```bash
git add packages/canvas/src/styles/index.css packages/canvas/dist/style.css
git commit -m "canvas: move scoped global CSS into the package"
```

### Task 2.3 — Add wrapper className to <SeeflowCanvas>

**Files:** `packages/canvas/src/components/seeflow-canvas.tsx` (modify)

**Step 1.** Read the file to find the outermost JSX element. Add
`seeflow-canvas-root` to its `className`. Example diff:

```diff
- <div className="relative h-full w-full">
+ <div className="seeflow-canvas-root relative h-full w-full">
```

If the className uses `cn(...)`, add the literal token at the front:

```diff
- className={cn('relative h-full w-full', extraClasses)}
+ className={cn('seeflow-canvas-root relative h-full w-full', extraClasses)}
```

**Step 2.** Run tests.

```bash
cd /Users/tuongaz/dev/seeflow
bun test --filter @seeflow/canvas
```

Expected: green. If `seeflow-canvas.test.tsx` asserts on the wrapper's
className, update the assertion to include `seeflow-canvas-root`.

**Step 3.** Run the studio and visually verify nothing shifted.

```bash
bun run dev
# visit http://localhost:5173 and check the canvas
```

**Step 4.** Commit.

```bash
git add packages/canvas/src/components/seeflow-canvas.tsx
git commit -m "canvas: apply .seeflow-canvas-root wrapper class"
```

### Task 2.4 — Inventory Radix portal usages

**Files:** read-only audit

**Step 1.** Grep for every Radix portal usage inside the canvas package.

```bash
grep -rn "\.Portal\b\|Portal>" packages/canvas/src | grep -v test
```

Expect hits from `Popover`, `DropdownMenu`, `Dialog`, `ContextMenu`,
`Tooltip`, `Sheet` (Dialog-based), and `Command` (uses Dialog).

**Step 2.** Save the list of files to a scratch note for Task 2.5.

No commit.

### Task 2.5 — Add a portal-container hook and thread it

**Files:**
- Create: `packages/canvas/src/components/canvas-portal-container.tsx`
- Modify: `packages/canvas/src/components/seeflow-canvas.tsx`
- Modify: every file from Task 2.4's grep

**Step 1.** Write the hook + context.

```tsx
// packages/canvas/src/components/canvas-portal-container.tsx
import { createContext, useContext, type ReactNode, type RefObject } from 'react';

const PortalContainerContext = createContext<HTMLElement | null>(null);

export function CanvasPortalContainerProvider({
  containerRef,
  children,
}: {
  containerRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return (
    <PortalContainerContext.Provider value={containerRef.current}>
      {children}
    </PortalContainerContext.Provider>
  );
}

export function useCanvasPortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext) ?? undefined;
}
```

**Step 2.** In `seeflow-canvas.tsx`, attach a ref to the wrapper element
and wrap the tree in the provider.

```tsx
const rootRef = useRef<HTMLDivElement | null>(null);
// …
<div ref={rootRef} className={cn('seeflow-canvas-root relative h-full w-full')}>
  <CanvasPortalContainerProvider containerRef={rootRef}>
    {/* existing children */}
  </CanvasPortalContainerProvider>
</div>
```

**Step 3.** In each Radix-using file from Task 2.4's grep, import the
hook and pass the result to `Portal.container`. Example:

```tsx
// Before
<PopoverPrimitive.Portal>
  <PopoverPrimitive.Content {...props} />
</PopoverPrimitive.Portal>

// After
const portalContainer = useCanvasPortalContainer();
<PopoverPrimitive.Portal container={portalContainer}>
  <PopoverPrimitive.Content {...props} />
</PopoverPrimitive.Portal>
```

For the Radix wrappers under `packages/canvas/src/ui/`, prefer adding
this once at the wrapper layer so consumers of `<Popover>`,
`<DropdownMenu>`, etc. don't have to repeat it.

**Step 4.** Run tests.

```bash
bun test --filter @seeflow/canvas
```

Expected: green. Some tests may instantiate portals; the container being
null in tests is fine — Radix falls back to `document.body`.

**Step 5.** Manual studio check: open a popover (style strip, project
switcher), a dropdown (toolbar), a dialog (any modal). Inspect the DOM
in devtools; the portaled content should be a child of the
`.seeflow-canvas-root` element, not `document.body`.

**Step 6.** Commit.

```bash
git add packages/canvas/src/components/canvas-portal-container.tsx \
  packages/canvas/src/components/seeflow-canvas.tsx \
  packages/canvas/src/ui/*.tsx packages/canvas/src/components/*.tsx
git commit -m "canvas: portal Radix primitives into .seeflow-canvas-root"
```

### Task 2.6 — Strip canvas-related rules from apps/web/src/index.css

**Files:** `apps/web/src/index.css` (modify)

**Step 1.** Open the file and remove every block that now lives in the
canvas package (per the Task 2.1 inventory). Keep:

- `@import` of Google Fonts (the studio's own chrome uses Inter too)
- `@tailwind base/components/utilities`
- `@layer base { :root { --background, --foreground, --primary, --primary-foreground, --secondary, --secondary-foreground, --muted, --muted-foreground, --accent, --accent-foreground, --destructive, --destructive-foreground, --border, --input, --ring, --radius, --card, --card-foreground, --popover, --popover-foreground } }` — the studio header/project switcher use these
- `@layer base { * { @apply border-border }, body { @apply bg-background text-foreground; background-image: ... }, html/body/#root { height: 100% } }`

Remove:

- `--seeflow-handle-*`, `--rf-zoom`, `--bg-canvas`, `--emerald-glow`,
  `--shadow-*`, `--ring-selected`, `--amber*`, `--danger`, `--font-mono`
  (now scoped under `.seeflow-canvas-root` in the canvas)
- The `@layer utilities` block with `seeflow-no-scrollbar`,
  `animate-ping-fast`, `seeflow-node-pulse`, `inline-edit-shake`,
  `inline-edit-empty`
- Every `.react-flow__*` rule
- `button:not(:disabled) { cursor: pointer }` and its disabled/exception
  rules — they were canvas concerns
- `.seeflow-connector-endpoint-dot`

**Step 2.** Run the studio.

```bash
bun run dev
```

Visually verify:
- Canvas: identical to before
- Header / project switcher / non-canvas studio chrome: identical
- Popovers and dropdowns inside canvas: emerald accents intact

**Step 3.** Commit.

```bash
git add apps/web/src/index.css
git commit -m "studio: remove canvas-related CSS now owned by @seeflow/canvas"
```

**Phase 2 done.** Global CSS lives in the canvas package and is scoped to
the wrapper.

---

## Phase 3 — Tailwind prefix migration

Goal: prefix every Tailwind utility in `packages/canvas/src` with `sf-`,
in chunks small enough to typecheck + visual-diff between commits.

The canvas package files that contain Tailwind classes are roughly:
`lib/`, `ui/`, `nodes/`, `edges/`, `components/`. We do one directory
per task, with tests + visual check between.

### Task 3.1 — Codemod script

**Files:** `packages/canvas/scripts/prefix-tailwind.mjs` (create)

**Step 1.** Write the codemod. It walks `.tsx`/`.ts` files under a
target directory, finds `className=` attribute string literals (and a
few common helper invocations: `cn(...)`, `cva(...)`, `clsx(...)`), and
prefixes every Tailwind-utility-shaped token with `sf-`.

```js
// packages/canvas/scripts/prefix-tailwind.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { argv } from 'node:process';

// Token-shaped utility detection.
//
// A Tailwind class token looks like one of:
//   prefix-value           bg-primary, rounded-md, h-9, p-4
//   variant:prefix-value   hover:bg-emerald-400, sm:p-2, dark:bg-zinc-900
//   prefix-[arbitrary]     h-[17px], bg-[rgba(0,0,0,0.5)]
//   negative: -prefix-N    -mt-2
//   plain word utility     flex, grid, block, hidden, group, peer, sr-only,
//                          truncate, rounded, border, ring, etc.
//
// We DO NOT prefix:
//   - already prefixed: sf-bg-primary
//   - non-Tailwind class names: seeflow-no-scrollbar, react-flow__node, etc.
//   - test-only assertion strings (those live in *.test.tsx; we run the
//     codemod over test files too so the assertions stay in sync)
//   - user-provided className passthroughs from consumers — but those
//     enter our code as variables, not literals, so the codemod never
//     sees them.

const TARGET = argv[2];
if (!TARGET) {
  console.error('Usage: bun packages/canvas/scripts/prefix-tailwind.mjs <glob>');
  process.exit(1);
}

const KNOWN_NON_TAILWIND = new Set([
  // Project-scoped class names
  'seeflow-canvas-root',
  'seeflow-no-scrollbar',
  'animate-ping-fast',
  'seeflow-node-pulse',
  'inline-edit-shake',
  'inline-edit-empty',
  'seeflow-connector-endpoint-dot',
  'seeflow-connecting',
  // xyflow class names
  'react-flow',
  'react-flow__node',
  'react-flow__node-group',
  'react-flow__handle',
  'react-flow__edge',
  'react-flow__edge-path',
  'react-flow__edgeupdater',
  'react-flow__edgelabel-renderer',
  'react-flow__controls',
  'react-flow__controls-button',
  'react-flow__pane',
  'react-flow__viewport',
  'react-flow__nodes',
  'react-flow__edges',
  'react-flow__nodesselection-rect',
  'react-flow__resize-control',
]);

// Tailwind tokens follow this shape. Conservative on plain-word utilities —
// we maintain an allowlist to avoid prefixing unrelated words.
const TAILWIND_PLAIN_WORDS = new Set([
  'flex', 'inline-flex', 'grid', 'inline-grid', 'block', 'inline', 'inline-block',
  'hidden', 'table', 'contents', 'flow-root', 'list-item',
  'group', 'peer', 'sr-only', 'not-sr-only',
  'truncate', 'italic', 'not-italic', 'antialiased', 'subpixel-antialiased',
  'rounded', 'border', 'ring', 'shadow',
  'absolute', 'relative', 'fixed', 'sticky', 'static',
  'overflow-hidden', 'overflow-auto', 'overflow-visible', 'overflow-scroll',
  'cursor-pointer', 'cursor-default', 'cursor-text', 'cursor-not-allowed',
  'select-none', 'select-text', 'select-all', 'select-auto',
  'pointer-events-none', 'pointer-events-auto',
  'whitespace-nowrap', 'whitespace-pre', 'whitespace-normal',
  'uppercase', 'lowercase', 'capitalize', 'normal-case',
  'underline', 'line-through', 'no-underline',
  'transition', 'transform',
  'outline-none',
  'isolate', 'isolation-auto',
]);

const TAILWIND_PREFIX_PATTERN = /^[a-z]+(-[a-z0-9]+)*$/i;

function isTailwindToken(token) {
  if (!token || token.startsWith('sf-')) return false;
  if (KNOWN_NON_TAILWIND.has(token)) return false;
  // Strip variant prefixes: 'hover:focus:bg-red-500' -> ['hover', 'focus', 'bg-red-500']
  const parts = token.split(':');
  const base = parts[parts.length - 1];
  // Negative margin/padding: -mt-2
  const stripped = base.startsWith('-') ? base.slice(1) : base;
  // Arbitrary value: h-[17px]
  if (stripped.includes('[')) {
    const head = stripped.slice(0, stripped.indexOf('['));
    return /^-?[a-z]+(-[a-z]+)*-?$/i.test(head);
  }
  // Plain word allowlist
  if (TAILWIND_PLAIN_WORDS.has(stripped)) return true;
  // prefix-value pattern: contains a hyphen and looks like CSS shorthand
  return TAILWIND_PREFIX_PATTERN.test(stripped) && stripped.includes('-');
}

function prefixToken(token) {
  if (!isTailwindToken(token)) return token;
  const colonIdx = token.lastIndexOf(':');
  if (colonIdx === -1) {
    return token.startsWith('-') ? `-sf${token}` : `sf-${token}`;
  }
  const variants = token.slice(0, colonIdx);
  const base = token.slice(colonIdx + 1);
  const prefixed = base.startsWith('-') ? `-sf${base}` : `sf-${base}`;
  return `${variants}:${prefixed}`;
}

function prefixString(s) {
  return s
    .split(/(\s+)/)
    .map((part) => (/^\s+$/.test(part) ? part : prefixToken(part)))
    .join('');
}

// Match string literals inside className= attributes AND inside known
// helper calls (cn, cva, clsx). We match on string-literal contents only.
const STRING_LITERAL_RE = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

function transformFile(path) {
  const src = readFileSync(path, 'utf8');

  // Find regions where Tailwind classes appear:
  //   className="..." or className={...} or cn("...", "...")
  // Cheap heuristic: transform every string literal in the file that
  // looks like a Tailwind class list (≥1 token that matches isTailwindToken).
  const out = src.replace(STRING_LITERAL_RE, (full, quote, body) => {
    const tokens = body.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return full;
    if (!tokens.some(isTailwindToken)) return full;
    const replaced = prefixString(body);
    return `${quote}${replaced}${quote}`;
  });

  if (out !== src) writeFileSync(path, out);
  return out !== src;
}

const files = globSync(TARGET);
let changed = 0;
for (const f of files) {
  if (transformFile(f)) {
    console.log(`  prefixed: ${f}`);
    changed++;
  }
}
console.log(`done — ${changed}/${files.length} files modified`);
```

**Why heuristic over AST:** the AST approach (ts-morph, babel) is more
robust but adds dependencies and slows iteration. The heuristic catches
99% of cases; the typecheck + tests + visual diff catch the remaining
1% and we fix by hand.

**Why a dry-run isn't included:** the codemod is idempotent (it skips
already-prefixed tokens) and the change set is what `git diff` is for.

**Step 2.** Commit the script.

```bash
git add packages/canvas/scripts/prefix-tailwind.mjs
git commit -m "canvas: codemod script for sf- prefix migration"
```

### Task 3.2 — Prefix src/lib

**Files:** `packages/canvas/src/lib/**/*.{ts,tsx}`

**Step 1.** Inspect what's in `lib/` to estimate scope.

```bash
ls packages/canvas/src/lib/
grep -lE 'className' packages/canvas/src/lib/*.{ts,tsx} 2>/dev/null
```

**Step 2.** Run the codemod.

```bash
bun packages/canvas/scripts/prefix-tailwind.mjs 'packages/canvas/src/lib/**/*.{ts,tsx}'
```

**Step 3.** Inspect the diff. Look for false positives (non-Tailwind
strings that got prefixed) and false negatives (Tailwind classes still
unprefixed).

```bash
git diff packages/canvas/src/lib | head -100
```

**Step 4.** Typecheck and test.

```bash
bun run --filter @seeflow/canvas typecheck
bun test --filter @seeflow/canvas
```

Expected: both green.

**Step 5.** Rebuild CSS and visually verify the studio.

```bash
bun run --filter @seeflow/canvas build:css
# in another terminal: bun run --filter @seeflow/web dev
# visit :5173, look for visual regressions
```

**Step 6.** Commit.

```bash
git add packages/canvas/src/lib packages/canvas/dist/style.css
git commit -m "canvas: prefix Tailwind utilities under src/lib (sf-)"
```

### Task 3.3 — Prefix src/ui

Same procedure as Task 3.2 with `src/ui/**/*.{ts,tsx}`.

```bash
bun packages/canvas/scripts/prefix-tailwind.mjs 'packages/canvas/src/ui/**/*.{ts,tsx}'
bun run --filter @seeflow/canvas typecheck
bun test --filter @seeflow/canvas
bun run --filter @seeflow/canvas build:css
# visual check
git add packages/canvas/src/ui packages/canvas/dist/style.css
git commit -m "canvas: prefix Tailwind utilities under src/ui (sf-)"
```

Special attention: `button.tsx` and `tooltip.tsx` use `cva()` with long
class strings — verify those are correctly prefixed.

### Task 3.4 — Prefix src/nodes

```bash
bun packages/canvas/scripts/prefix-tailwind.mjs 'packages/canvas/src/nodes/**/*.{ts,tsx}'
bun run --filter @seeflow/canvas typecheck
bun test --filter @seeflow/canvas
bun run --filter @seeflow/canvas build:css
# visual check: shapes, play node, state node, group node, image node all
# look identical to pre-refactor
git add packages/canvas/src/nodes packages/canvas/dist/style.css
git commit -m "canvas: prefix Tailwind utilities under src/nodes (sf-)"
```

`placeholder-card.test.tsx` asserts on `text-muted-foreground` and
`text-destructive` — the codemod will update those assertions. Verify
they got the `sf-` prefix.

`placeholder-card.test.tsx` line 56 passes `'bg-red-100'` as a CONSUMER
className prop (user input). The codemod will prefix it (since the
string is in the file source). That's actually fine — the test is
about the component preserving an arbitrary className it was given, so
the assertion still validates that behavior whether the class is
`bg-red-100` or `sf-bg-red-100`.

### Task 3.5 — Prefix src/edges

```bash
bun packages/canvas/scripts/prefix-tailwind.mjs 'packages/canvas/src/edges/**/*.{ts,tsx}'
bun run --filter @seeflow/canvas typecheck
bun test --filter @seeflow/canvas
bun run --filter @seeflow/canvas build:css
# visual check: connectors, endpoint dots, edge labels
git add packages/canvas/src/edges packages/canvas/dist/style.css
git commit -m "canvas: prefix Tailwind utilities under src/edges (sf-)"
```

### Task 3.6 — Prefix src/components

```bash
bun packages/canvas/scripts/prefix-tailwind.mjs 'packages/canvas/src/components/**/*.{ts,tsx}'
bun run --filter @seeflow/canvas typecheck
bun test --filter @seeflow/canvas
bun run --filter @seeflow/canvas build:css
# visual check: toolbar, detail panel, style strip, inline edit, icon
# picker popover, selection resize overlay
git add packages/canvas/src/components packages/canvas/dist/style.css
git commit -m "canvas: prefix Tailwind utilities under src/components (sf-)"
```

### Task 3.7 — Sweep for missed utilities

**Files:** read-only audit

**Step 1.** Find any remaining unprefixed Tailwind-looking classes.

```bash
# Look for common utility prefixes that aren't sf-prefixed
grep -RnE 'className=["'"'"'`][^"'"'"'`]*\b(bg-|text-|rounded-|border-|p-|m-|h-|w-|flex|grid|gap-|space-|items-|justify-)' \
  packages/canvas/src --include='*.tsx' --include='*.ts' \
  | grep -v 'sf-' \
  | grep -v '\.test\.' \
  | head -50
```

**Step 2.** Manually inspect each hit. If a class was missed by the
codemod, prefix it by hand. Common cases:
- Classes inside template literals with interpolation that the codemod
  conservatively skipped
- Classes that were on string literals NOT inside a className attribute
  (e.g. constants used elsewhere)

**Step 3.** If anything was found and fixed, re-run typecheck + tests +
build + visual check, then commit.

```bash
git add packages/canvas/src
git commit -m "canvas: sweep for missed Tailwind classes (sf- prefix)"
```

### Task 3.8 — Drop apps/web's Tailwind scan of canvas src

**Files:** `apps/web/tailwind.config.js` (modify)

**Step 1.** Edit the file. Find:

```js
content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/canvas/src/**/*.{ts,tsx}'],
```

Change to:

```js
content: ['./index.html', './src/**/*.{ts,tsx}'],
```

**Step 2.** Rebuild and verify.

```bash
# Stop the dev server, restart so Tailwind picks up the config change
bun run dev
# visit :5173 — canvas should still render correctly because all its
# styles come from @seeflow/canvas/style.css now
```

**Why this is safe at this point:** every class in `packages/canvas/src`
is now `sf-prefixed`, and apps/web's Tailwind (no prefix) wouldn't
compile those anyway. The canvas's own Tailwind (with `prefix: 'sf-'`)
compiles them into `dist/style.css`, which apps/web imports.

**Step 3.** Commit.

```bash
git add apps/web/tailwind.config.js
git commit -m "studio: drop canvas content scan from tailwind config"
```

**Phase 3 done.** Tailwind prefix isolation complete.

---

## Phase 4 — Flip to dist for external consumers

Goal: `main`/`exports` in `packages/canvas/package.json` point to
`dist/`; the studio keeps using source via an explicit Vite alias.

### Task 4.1 — Add Vite alias in apps/web

**Files:** `apps/web/vite.config.ts` (modify)

**Step 1.** Read the current `vite.config.ts`. Add a `resolve.alias`
entry.

```ts
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@seeflow/canvas': path.resolve(__dirname, '../../packages/canvas/src/index.ts'),
    },
  },
});
```

(Preserve any other config that's already in the file.)

**Step 2.** Restart dev server, verify the studio runs and HMR still
works (edit a canvas component and confirm hot reload).

**Step 3.** Commit.

```bash
git add apps/web/vite.config.ts
git commit -m "studio: alias @seeflow/canvas to source for in-monorepo HMR"
```

### Task 4.2 — Flip main/exports to dist/

**Files:** `packages/canvas/package.json` (modify)

**Step 1.** Edit `package.json`:

```jsonc
{
  "name": "@seeflow/canvas",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./style.css": "./dist/style.css"
  },
  "files": ["dist", "README.md"]
  // …rest unchanged
}
```

**Step 2.** Run `bun run build` to ensure `dist/` is current.

```bash
bun run --filter @seeflow/canvas build
ls packages/canvas/dist
```

**Step 3.** Run typecheck on the studio specifically — the alias should
still resolve `@seeflow/canvas` for type lookups.

```bash
bun run --filter @seeflow/web typecheck
```

If types break: tsconfig in apps/web needs a `paths` entry mirroring the
Vite alias. Add it:

```jsonc
// apps/web/tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@seeflow/canvas": ["../../packages/canvas/src/index.ts"]
    }
    // …
  }
}
```

**Step 4.** Restart dev server, verify studio still runs.

**Step 5.** Commit.

```bash
git add packages/canvas/package.json packages/canvas/dist apps/web/tsconfig.json
git commit -m "canvas: flip main+exports to dist/ for external consumers"
```

**Phase 4 done.** Package presents as a built library externally,
source-aliased internally.

---

## Phase 5 — GitHub Action: build + commit dist

### Task 5.1 — Read the existing dist/web workflow

**Files:** read-only

**Step 1.** Find and read the workflow that produces commit `83e7c0f`
(`build: rebuild dist/web [skip ci]`).

```bash
ls .github/workflows/
cat .github/workflows/<the-file>.yml
```

Note its structure (triggers, steps, commit author, push permissions).

### Task 5.2 — Add the canvas workflow

**Files:** `.github/workflows/build-canvas.yml` (create)

**Step 1.** Write a workflow modeled on the dist/web one but scoped to
the canvas package.

```yaml
name: build-canvas

on:
  push:
    branches: [main]
    paths:
      - 'packages/canvas/src/**'
      - 'packages/canvas/tailwind.config.cjs'
      - 'packages/canvas/postcss.config.cjs'
      - 'packages/canvas/tsup.config.ts'
      - 'packages/canvas/package.json'
      - 'bun.lockb'
      - '.github/workflows/build-canvas.yml'

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: '>=1.3'

      - run: bun install --frozen-lockfile

      - run: bun run --filter @seeflow/canvas build

      - name: Commit dist if changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add packages/canvas/dist
          if git diff --cached --quiet; then
            echo "No changes to dist/"
          else
            git commit -m "build: rebuild canvas dist [skip ci]"
            git push
          fi
```

**Why `[skip ci]`:** prevents the workflow from re-firing on its own
commit and looping forever.

**Step 2.** Commit (do NOT push yet — push the whole branch at the
end after smoke tests).

```bash
git add .github/workflows/build-canvas.yml
git commit -m "ci: rebuild canvas dist on source changes"
```

---

## Phase 6 — External smoke test

Goal: confirm a fresh React app outside this repo can consume the
package and render the canvas with zero config.

### Task 6.1 — Scaffold throwaway consumer

**Files:** outside the repo

**Step 1.** Create a new Vite + React app outside the seeflow repo.

```bash
cd /tmp
bun create vite@latest seeflow-canvas-smoke -- --template react-ts
cd seeflow-canvas-smoke
bun install
```

**Step 2.** Add the canvas package via file path.

```bash
bun add file:/Users/tuongaz/dev/seeflow/packages/canvas
bun add @xyflow/react lucide-react react-markdown remark-gfm
```

**Step 3.** Edit `src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@seeflow/canvas/style.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

**Step 4.** Edit `src/App.tsx`:

```tsx
import { SeeflowCanvas } from '@seeflow/canvas';

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <SeeflowCanvas
        mode="view"
        nodes={[
          { id: '1', kind: 'shape', shape: 'rectangle', x: 100, y: 100,
            width: 200, height: 80, label: 'Hello, canvas' },
        ]}
        connectors={[]}
        selectedNodeIds={[]}
        selectedConnectorIds={[]}
      />
    </div>
  );
}
```

(Adjust the node shape to whatever the actual `DemoNode` type requires —
read `packages/canvas/src/types.ts` if needed.)

**Step 5.** Run.

```bash
bun run dev
```

Expected: emerald-on-zinc canvas with a single rectangle node, fully
styled, looking identical to the studio.

**Step 6.** If anything is broken, debug and fix back in the canvas
package. Re-run `bun run build` after each fix.

**Step 7.** Document the result in `packages/canvas/README.md`. The
README's "Tailwind setup" section gets replaced with:

```markdown
## Usage

Two imports — that's the whole setup.

```tsx
import '@seeflow/canvas/style.css';
import { SeeflowCanvas } from '@seeflow/canvas';
```

No Tailwind configuration, no CSS variables, no font setup.
```

Drop the existing "Tailwind setup" section entirely.

**Step 8.** Commit the README update.

```bash
cd /Users/tuongaz/dev/seeflow
git add packages/canvas/README.md
git commit -m "docs(canvas): update README for zero-config standalone usage"
```

### Task 6.2 — Verify final state

**Step 1.** Run the full workspace check.

```bash
bun run typecheck    # clean
bun test             # clean
bun run --filter @seeflow/canvas build   # clean
bun run --filter @seeflow/web dev        # studio looks identical
```

**Step 2.** Stop. The branch is ready for review.

---

## Plan complete — execution handoff

**Plan saved to:** `docs/plans/2026-05-19-canvas-standalone-implementation.md`
(local; `docs/` is gitignored).

**Note on docs/ being gitignored:** the design and implementation plan
both live locally only. Code commits during execution will land in git
normally; the plan files won't.

Two execution options:

1. **Subagent-Driven (this session)** — I dispatch a fresh subagent per
   task, review between tasks, fast iteration. Best for catching
   regressions early.
2. **Parallel Session (separate)** — Open a new session that uses
   `superpowers:executing-plans` to batch through tasks with checkpoints
   at phase boundaries.

Which approach?
