# Canvas Extraction — Phase 2: Node & Edge Components Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Prerequisite:** Phase 1 merged to `main`.

**Goal:** Move all node component files, the edge component, and the small support helpers they import into `@seeflow/canvas`. After this PR, `apps/web` imports every node and edge component from `@seeflow/canvas`.

**Architecture:** Components move as a group rather than file-by-file, because they cross-reference each other inside `apps/web/src/components/nodes/`. Move the whole `nodes/` and `edges/` trees in one task, then patch the import edges. The thorny piece — UI primitive imports (`@/components/ui/button`) — is resolved in Task 0.

**Tech Stack:** Bun, React, `@xyflow/react`, `lucide-react`, `clsx` + `tailwind-merge` (for `cn`), Radix UI.

**Files moving in this phase:**

Components (with their tests):
- `apps/web/src/components/nodes/` (entire directory) — `play-node.tsx`, `state-node.tsx`, `shape-node.tsx`, `image-node.tsx`, `icon-node.tsx`, `html-node.tsx`, `placeholder-card.tsx`, `resize-controls.tsx`, `use-resize-gesture.ts`, `lock-badge.tsx`, `status-badge.tsx`, `status-pill.tsx`, `connection-limit.test.ts`, `shapes/{registry,cloud,database,server,user,queue}.tsx` (and `shapes/types.ts` if it exists)
- `apps/web/src/components/edges/` (entire directory) — `editable-edge.tsx`, `editable-edge.test.ts`

Support helpers that nodes import:
- `apps/web/src/lib/utils.ts` (the `cn` helper) → `packages/canvas/src/lib/cn.ts` (rename — `utils` is too vague for a package public API)
- `apps/web/src/lib/debounce.ts` (+ test) → `packages/canvas/src/lib/debounce.ts`
- `apps/web/src/lib/file-url.ts` → `packages/canvas/src/lib/file-url.ts`
- `apps/web/src/components/inline-edit.tsx` → `packages/canvas/src/components/inline-edit.tsx`

Then the UI primitives the nodes need (decided in Task 0).

---

## Task 0: Decide UI primitives strategy

**Why:** Node components import `Button` from `@/components/ui/button`. The `@/` alias doesn't resolve from inside `packages/canvas/`, so a moved node component can't reach the web app's Radix wrappers. This blocks every move.

**Three options:**

| Option | Description | Cost | Trade-off |
|---|---|---|---|
| **A. Move ui/ into canvas package** (recommended) | `packages/canvas/src/ui/` becomes the home for all Radix wrappers (`button.tsx`, `popover.tsx`, etc.). `apps/web` imports them from `@seeflow/canvas`. | Medium — touches a lot of `apps/web` imports but mechanical. | Canvas owns its primitives. Web depends on canvas for UI. Simpler than introducing a 3rd package. |
| **B. Extract `@seeflow/ui` workspace package** | New `packages/ui/` package holding Radix wrappers. Both `apps/web` and `packages/canvas` import from `@seeflow/ui`. | Higher — new package boilerplate (`package.json`, `tsconfig.json`), update workspaces config, update every web import. | Cleanest separation. Third consumer can pull UI without canvas. |
| **C. Vendor inside canvas** | Copy needed primitives (just `button` for Phase 2, more later) into `packages/canvas/src/ui/`. Web keeps its own copies. | Low up front. | DRY violation. Two divergent copies. Avoid. |

**Recommendation: Option A.** Lowest churn, no DRY violation. The "other services" that consume `@seeflow/canvas` get the UI primitives for free; if they object, we can split out a separate `@seeflow/ui` later.

**Step 1: Confirm the option with the user**

Before any moves, ask: "Phase 2 needs Radix UI primitives accessible from the canvas package. Recommended: move `apps/web/src/components/ui/*` into `packages/canvas/src/ui/`. OK?"

**Step 2: Inventory `apps/web/src/components/ui/`**

```bash
ls apps/web/src/components/ui/
grep -rln "from '@/components/ui/" apps/web/src | sort -u
```

Note every primitive and every import site. The move in Task 1 includes them all.

**Step 3: Commit nothing yet** — Task 1 does the move.

---

## Task 1: Move UI primitives into `@seeflow/canvas`

**Pre-flight:** Option A confirmed in Task 0.

**Files:**
- Move: `apps/web/src/components/ui/*` → `packages/canvas/src/ui/*` (entire directory)
- Modify: every `apps/web` file that imports from `@/components/ui/*`
- Modify: `packages/canvas/src/index.ts` (export `./ui` barrel)
- Modify: `packages/canvas/package.json` (add Radix runtime deps + `clsx`, `tailwind-merge`, `class-variance-authority`, `tailwindcss-animate`)

**Step 1: List all UI primitives and their internal cross-imports**

```bash
ls apps/web/src/components/ui/
grep -rln "from '@/" apps/web/src/components/ui/
```

UI primitives may import from `@/lib/utils` (the `cn` helper). That move is part of this task — see Step 2.

**Step 2: Move `cn` first**

```bash
git mv apps/web/src/lib/utils.ts packages/canvas/src/lib/cn.ts
```

Rename the file from `utils` to `cn` (matches its only export). Update apps/web imports:

```bash
grep -rln "from '@/lib/utils'" apps/web/src
# Edit each: from '@/lib/utils' → from '@seeflow/canvas'
```

Add to `packages/canvas/src/index.ts`:

```ts
export * from './lib/cn';
```

**Step 3: Move every UI primitive**

```bash
git mv apps/web/src/components/ui packages/canvas/src/ui
```

**Step 4: Update internal imports inside the moved UI files**

Each moved file may import `cn` from `@/lib/utils` — change to relative path:

```bash
# In packages/canvas/src/ui/*.tsx
# from '@/lib/utils' → from '../lib/cn'
```

Sweep:

```bash
grep -rln "from '@/" packages/canvas/src/ui
```

Expected: no remaining `@/` imports. Each hit needs a manual fix.

**Step 5: Add a UI barrel and export it from the package**

Create `packages/canvas/src/ui/index.ts`:

```ts
export * from './button';
export * from './popover';
// ... one line per primitive
```

In `packages/canvas/src/index.ts`, append:

```ts
export * from './ui';
```

(Keep nodes/edges importing primitives via the barrel — not direct file paths — so consumers don't need to know the internal layout.)

**Step 6: Move runtime deps**

Edit `packages/canvas/package.json` — add the Radix packages, `class-variance-authority`, `clsx`, `tailwind-merge`, `cmdk`, `tailwindcss-animate` (anything referenced by the UI primitives). Remove the same from `apps/web/package.json`. Run `bun install`.

A reliable way to enumerate: `grep -h "^import" packages/canvas/src/ui/*.tsx | grep "from '" | grep -v "'\\./\\|'\\.\\.\\/" | sort -u` shows every external dep.

**Step 7: Update every `apps/web` import site**

```bash
grep -rln "from '@/components/ui/" apps/web/src
```

For each hit, change `from '@/components/ui/<name>'` to `from '@seeflow/canvas'`. Merge with existing `@seeflow/canvas` import blocks.

**Step 8: Verify**

```bash
bun run typecheck
bun test
```

Expected: green. UI primitives have no tests of their own (per the inventory), so the gate is integration tests + typecheck.

**Step 9: Commit**

```bash
git add -A
git commit -m "refactor(canvas): move UI primitives + cn into @seeflow/canvas"
```

---

## Task 2: Move support helpers (`debounce`, `file-url`, `inline-edit`)

**Files:**
- Move: `apps/web/src/lib/debounce.ts` (+ test) → `packages/canvas/src/lib/debounce.ts`
- Move: `apps/web/src/lib/file-url.ts` → `packages/canvas/src/lib/file-url.ts`
- Move: `apps/web/src/components/inline-edit.tsx` → `packages/canvas/src/components/inline-edit.tsx`
- Modify: all `apps/web` import sites
- Modify: `packages/canvas/src/index.ts`

**Step 1: Inventory import sites**

```bash
grep -rln "from '@/lib/debounce'\|from '@/lib/file-url'\|from '@/components/inline-edit'" apps/web/src
```

**Step 2: Move debounce**

```bash
git mv apps/web/src/lib/debounce.ts packages/canvas/src/lib/debounce.ts
git mv apps/web/src/lib/debounce.test.ts packages/canvas/src/lib/debounce.test.ts
```

Fix test self-import (`from '@/lib/debounce'` → `from './debounce'`). Append barrel export.

**Step 3: Move file-url**

```bash
git mv apps/web/src/lib/file-url.ts packages/canvas/src/lib/file-url.ts
```

Append barrel export.

**Step 4: Move inline-edit**

```bash
git mv apps/web/src/components/inline-edit.tsx packages/canvas/src/components/inline-edit.tsx
```

Fix its internal imports:
- `from '@/lib/debounce'` → `from '../lib/debounce'`
- `from '@/lib/utils'` → `from '../lib/cn'` (renamed in Task 1)

Append barrel export (`export * from './components/inline-edit';`).

**Step 5: Update every `apps/web` import site**

Each `from '@/lib/debounce'` / `from '@/lib/file-url'` / `from '@/components/inline-edit'` becomes `from '@seeflow/canvas'`.

**Step 6: Verify**

```bash
bun run typecheck
bun test
```

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor(canvas): move debounce, file-url, inline-edit into @seeflow/canvas"
```

---

## Task 3: Move `nodes/` directory

**Files:**
- Move: `apps/web/src/components/nodes/` → `packages/canvas/src/nodes/` (entire directory)
- Modify: every internal import inside moved files (switch `@/` to relative or `@seeflow/canvas`)
- Modify: `apps/web` import sites
- Modify: `packages/canvas/src/index.ts`

**Step 1: Inventory cross-directory imports**

```bash
grep -rln "from '@/" apps/web/src/components/nodes/ | sort -u
```

Note every distinct `@/` import path. These all need rewriting after the move.

**Step 2: Move the directory**

```bash
git mv apps/web/src/components/nodes packages/canvas/src/nodes
```

**Step 3: Rewrite imports inside the moved tree**

Common rewrites (run as careful sed or manual edit per file):

| Old | New |
|---|---|
| `from '@/components/nodes/...'` | `from './...'` (relative, since they're siblings now) |
| `from '@/components/inline-edit'` | `from '../components/inline-edit'` |
| `from '@/components/ui/<x>'` | `from '../ui/<x>'` OR `from '../ui'` (via barrel) |
| `from '@/lib/utils'` | `from '../lib/cn'` |
| `from '@/lib/color-tokens'` | `from '../lib/color-tokens'` |
| `from '@/lib/icon-registry'` | `from '../lib/icon-registry'` |
| `from '@/lib/api'` (types only) | `from '../types'` |
| `from '@/lib/file-url'` | `from '../lib/file-url'` |

Verification sweep:

```bash
grep -rln "from '@/" packages/canvas/src/nodes
```

Expected: no output. Any hit is an unfixed import.

**Step 4: Add barrel exports**

Create `packages/canvas/src/nodes/index.ts`:

```ts
export * from './play-node';
export * from './state-node';
export * from './shape-node';
export * from './image-node';
export * from './icon-node';
export * from './html-node';
export * from './placeholder-card';
export * from './resize-controls';
export * from './use-resize-gesture';
export * from './lock-badge';
export * from './status-badge';
export * from './status-pill';
export * from './shapes/registry';
// shape SVGs probably stay internal — export them only if a test needs them
```

In `packages/canvas/src/index.ts`, append:

```ts
export * from './nodes';
```

**Step 5: Update `apps/web` import sites**

```bash
grep -rln "from '@/components/nodes" apps/web/src
```

Each hit becomes `from '@seeflow/canvas'`.

**Step 6: Run the moved tests**

```bash
bun test packages/canvas/src/nodes
```

Expected: every node test passes. If any test fails on module resolution, re-check Step 3.

**Step 7: Typecheck**

```bash
bun run typecheck
```

**Step 8: Commit**

```bash
git add -A
git commit -m "refactor(canvas): move node components into @seeflow/canvas"
```

---

## Task 4: Move `edges/` directory

**Files:**
- Move: `apps/web/src/components/edges/` → `packages/canvas/src/edges/`
- Modify: imports inside moved files
- Modify: `apps/web/src/components/demo-canvas.tsx` (the only consumer)
- Modify: `packages/canvas/src/index.ts`

**Step 1: Inventory**

```bash
grep -rln "from '@/" apps/web/src/components/edges/
grep -rln "from '@/components/edges/" apps/web/src
```

**Step 2: Move**

```bash
git mv apps/web/src/components/edges packages/canvas/src/edges
```

**Step 3: Rewrite imports inside moved files**

- `from '@/lib/floating-edge-geometry'` → `from '../lib/floating-edge-geometry'` (already in package from Phase 1)
- `from '@/lib/api'` types → `from '../types'`
- `from '@/lib/color-tokens'` → `from '../lib/color-tokens'`

Verification:

```bash
grep -rln "from '@/" packages/canvas/src/edges
```

Expected: no output.

**Step 4: Fix test self-imports**

In `packages/canvas/src/edges/editable-edge.test.ts`, change `from '@/components/edges/editable-edge'` → `from './editable-edge'`.

**Step 5: Barrel export**

Create `packages/canvas/src/edges/index.ts`:

```ts
export * from './editable-edge';
```

Append to package barrel: `export * from './edges';`.

**Step 6: Update `demo-canvas.tsx`**

Change `from '@/components/edges/editable-edge'` → `from '@seeflow/canvas'`.

**Step 7: Test + typecheck**

```bash
bun test packages/canvas/src/edges
bun run typecheck
```

**Step 8: Commit**

```bash
git add -A
git commit -m "refactor(canvas): move editable-edge into @seeflow/canvas"
```

---

## Task 5: Final sweep + smoke test

**Step 1: Verify no straggler `@/` imports from canvas to web**

```bash
grep -rln "from '@/" packages/canvas/src
```

Expected: no output.

**Step 2: Verify all relevant `apps/web` imports resolved via the package**

```bash
grep -rln "from '@/components/nodes\|from '@/components/edges\|from '@/components/inline-edit\|from '@/components/ui\|from '@/lib/utils\|from '@/lib/debounce\|from '@/lib/file-url'" apps/web/src
```

Expected: no output.

**Step 3: Full suite**

```bash
bun test
bun run typecheck
bun run format
bun run lint
```

Expected: green.

**Step 4: Smoke test**

```bash
bun run dev
```

Manually verify in the studio:
- A demo loads and renders all node kinds (play, state, shape variants, image, icon, html).
- Inline-edit a node name — debounce works.
- Drag a node — resize handles appear; resize a node.
- An edge connects two nodes with arrow/style.
- Toolbar opens (the popover comes from the moved `ui/popover`).
- Context menu opens on a node.

**Step 5: PR**

```bash
gh pr create --title "refactor(canvas): phase 2 — move nodes, edges, UI primitives" \
  --body "$(cat <<'EOF'
## Summary
- Moves `nodes/` and `edges/` component trees into `@seeflow/canvas`.
- Moves UI primitives (Radix wrappers + `cn`) into `@seeflow/canvas/ui` (Option A from the plan).
- Moves support helpers (`debounce`, `file-url`, `inline-edit`).
- Shifts ~10 runtime deps (Radix packages, `class-variance-authority`, `clsx`, `tailwind-merge`, `cmdk`, `tailwindcss-animate`) into the canvas package.

Phase 2 of the canvas-extraction plan: `docs/plans/2026-05-18-canvas-package-extraction-design.md`.

## Test plan
- [ ] `bun test` — full suite green
- [ ] `bun run typecheck` — clean
- [ ] `bun run lint` — clean
- [ ] `bun run dev` — manual smoke: render every node kind, inline-edit name, resize, draw edge, open toolbar popover, open context menu

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the executor

- **Cross-tree moves stay in one commit per task.** The whole `nodes/` move is a single commit even though it touches dozens of files. Splitting per-node-file is worse: tests rely on sibling imports that wouldn't yet resolve.
- **Run the moved tests, not the whole suite, between sub-steps.** The full suite runs at the end.
- **If a UI primitive has app-specific behavior** (e.g. analytics, app-level toasts), strip those out — the canvas package should not depend on app-level concerns. None were obvious in the inventory; flag any you find.
- **Tailwind classes carry over verbatim.** Consumers will add `packages/canvas/src/**/*.{ts,tsx}` to their Tailwind content array (covered in Phase 5).
