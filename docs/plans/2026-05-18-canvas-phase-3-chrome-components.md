# Canvas Extraction — Phase 3: Chrome Components Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Prerequisite:** Phase 2 merged to `main`.

**Goal:** Move the editor chrome — toolbar, style strip, detail panel, selection-resize overlay — plus the two deferred helpers (`node-defaults`, `last-used-style`) into `@seeflow/canvas`.

**Architecture:** These components are larger and have more internal dependencies than nodes/edges, but the work is mechanical: rewrite `@/` imports, run tests, commit. The hard work was already done in Phase 2 (UI primitives in the package).

**Tech Stack:** Same as Phase 2.

**Files moving in this phase:**

| Source | Destination |
|---|---|
| `apps/web/src/components/canvas-toolbar.tsx` (+ test) | `packages/canvas/src/components/canvas-toolbar.tsx` |
| `apps/web/src/components/style-strip.tsx` (+ tests if any) | `packages/canvas/src/components/style-strip.tsx` |
| `apps/web/src/components/detail-panel.tsx` (+ test) | `packages/canvas/src/components/detail-panel.tsx` |
| `apps/web/src/components/selection-resize-overlay.tsx` (+ test) | `packages/canvas/src/components/selection-resize-overlay.tsx` |
| `apps/web/src/lib/scale-nodes.ts` (+ test) | `packages/canvas/src/lib/scale-nodes.ts` |
| `apps/web/src/lib/detail-panel-width.ts` (+ test) | `packages/canvas/src/lib/detail-panel-width.ts` |
| `apps/web/src/lib/node-defaults.ts` (+ test) | `packages/canvas/src/lib/node-defaults.ts` |
| `apps/web/src/lib/last-used-style.ts` (+ test) | `packages/canvas/src/lib/last-used-style.ts` |
| `apps/web/src/components/icon-picker-popover.tsx` (+ deps) | `packages/canvas/src/components/icon-picker-popover.tsx` |

**Pre-flight discovery (run before Task 1):**

```bash
grep -n "^import" apps/web/src/components/style-strip.tsx
grep -n "^import" apps/web/src/components/detail-panel.tsx
grep -n "^import" apps/web/src/components/icon-picker-popover.tsx
```

Document any `@/hooks/*` or `@/lib/api`-function (not type) imports — those signal a coupling to app state that you can't move. If a chrome component reads an app-only hook directly (rather than receiving its data via props), **stop and decide:** either refactor it to accept the data as a prop first (in `apps/web`, separate commit) or defer that specific component to Phase 4.

---

## Task 1: Move support helpers (`scale-nodes`, `detail-panel-width`)

**Why first:** Pure utilities, like Phase 1. Pulled forward so the chrome components find them already in place.

**Files:**
- Move: `apps/web/src/lib/scale-nodes.ts` (+ test) → `packages/canvas/src/lib/scale-nodes.ts`
- Move: `apps/web/src/lib/detail-panel-width.ts` (+ test) → `packages/canvas/src/lib/detail-panel-width.ts`

**Step 1: List exports**

```bash
grep -n "^export " apps/web/src/lib/scale-nodes.ts apps/web/src/lib/detail-panel-width.ts
```

**Step 2: Move both pairs**

```bash
git mv apps/web/src/lib/scale-nodes.ts packages/canvas/src/lib/scale-nodes.ts
git mv apps/web/src/lib/scale-nodes.test.ts packages/canvas/src/lib/scale-nodes.test.ts
git mv apps/web/src/lib/detail-panel-width.ts packages/canvas/src/lib/detail-panel-width.ts
git mv apps/web/src/lib/detail-panel-width.test.ts packages/canvas/src/lib/detail-panel-width.test.ts
```

**Step 3: Fix self-imports in tests + any internal `@/` imports**

```bash
grep -rln "from '@/" packages/canvas/src/lib/scale-nodes.ts packages/canvas/src/lib/detail-panel-width.ts packages/canvas/src/lib/scale-nodes.test.ts packages/canvas/src/lib/detail-panel-width.test.ts
```

Each hit: convert to relative import or `from '../types'` for canvas types.

**Step 4: Barrel exports**

Append to `packages/canvas/src/index.ts`:

```ts
export * from './lib/scale-nodes';
export * from './lib/detail-panel-width';
```

**Step 5: Update `apps/web` import sites**

```bash
grep -rln "from '@/lib/scale-nodes'\|from '@/lib/detail-panel-width'" apps/web/src
```

Each becomes `from '@seeflow/canvas'`.

**Step 6: Verify**

```bash
bun test packages/canvas/src/lib/scale-nodes.test.ts packages/canvas/src/lib/detail-panel-width.test.ts
bun run typecheck
```

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor(canvas): move scale-nodes and detail-panel-width into @seeflow/canvas"
```

---

## Task 2: Move `node-defaults` and `last-used-style`

**Files:**
- Move: `apps/web/src/lib/node-defaults.ts` (+ test) → `packages/canvas/src/lib/node-defaults.ts`
- Move: `apps/web/src/lib/last-used-style.ts` (+ test) → `packages/canvas/src/lib/last-used-style.ts`

**Note:** Both import `NodeStylePatch` and `ConnectorStylePatch` types from `@/components/style-strip`. Since `style-strip` moves later in this phase (Task 4), we need to either:

- **(a) Move style-strip's types out of `style-strip.tsx` first** into the canvas package (e.g., as `packages/canvas/src/types-style.ts`). The component itself moves later.
- **(b) Move `node-defaults` and `last-used-style` AFTER `style-strip`** — i.e., swap Task 2 and Task 4.

**Recommendation: (b)**. It's mechanical. Swap the task order: do Task 4 (style-strip) first, then return here.

If you've already started Task 2, switch to Task 4 now.

**Step 1: Pre-check — confirm `style-strip` is moved**

```bash
test -f packages/canvas/src/components/style-strip.tsx && echo OK || echo BLOCKED
```

If `BLOCKED`, jump to Task 4 first.

**Step 2: Move both pairs**

```bash
git mv apps/web/src/lib/node-defaults.ts packages/canvas/src/lib/node-defaults.ts
git mv apps/web/src/lib/node-defaults.test.ts packages/canvas/src/lib/node-defaults.test.ts
git mv apps/web/src/lib/last-used-style.ts packages/canvas/src/lib/last-used-style.ts
git mv apps/web/src/lib/last-used-style.test.ts packages/canvas/src/lib/last-used-style.test.ts
```

**Step 3: Rewrite imports**

In each moved file:
- `from '@/components/style-strip'` → `from '../components/style-strip'`
- `from '@/lib/api'` (types only) → `from '../types'`
- Self-imports in tests → relative

**Step 4: Parameterize the localStorage key**

Per the design doc, `last-used-style.ts` hardcodes `'seeflow:last-used-style:v1'`. Change the storage key to accept a prefix:

```ts
// Before:
const STORAGE_KEY = 'seeflow:last-used-style:v1';

// After:
export const DEFAULT_STORAGE_PREFIX = 'seeflow';
const storageKey = (prefix: string) => `${prefix}:last-used-style:v1`;
// Update every read/write to take a prefix arg
```

Adjust each exported function to take `(prefix: string, ...args)`. Update the test accordingly (it can pass `DEFAULT_STORAGE_PREFIX` to preserve existing behavior).

`apps/web` call sites pass `DEFAULT_STORAGE_PREFIX` for now; Phase 4 will thread the `storageKey` prop from `<SeeflowCanvas>` through.

**Step 5: Barrel + import-site updates**

```bash
# Barrel
echo "export * from './lib/node-defaults';" >> packages/canvas/src/index.ts
echo "export * from './lib/last-used-style';" >> packages/canvas/src/index.ts

# Update apps/web
grep -rln "from '@/lib/node-defaults'\|from '@/lib/last-used-style'" apps/web/src
```

Each becomes `from '@seeflow/canvas'`.

**Step 6: Verify**

```bash
bun test packages/canvas/src/lib/node-defaults.test.ts packages/canvas/src/lib/last-used-style.test.ts
bun run typecheck
```

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor(canvas): move node-defaults and last-used-style; parameterize storage key"
```

---

## Task 3: Move `icon-picker-popover` and its dependencies

**Why now:** `canvas-toolbar.tsx` imports `IconPickerPopover`. Moving it before the toolbar means the toolbar move is just a path rewrite.

**Files:**
- Move: `apps/web/src/components/icon-picker-popover.tsx` (+ test if exists) → `packages/canvas/src/components/icon-picker-popover.tsx`
- Move: `apps/web/src/lib/icon-insert.ts` (+ test) → `packages/canvas/src/lib/icon-insert.ts`
- Move: `apps/web/src/lib/icon-recents.ts` (+ test) → `packages/canvas/src/lib/icon-recents.ts`

**Step 1: Inventory**

```bash
grep -n "^import" apps/web/src/components/icon-picker-popover.tsx
grep -rln "from '@/components/icon-picker-popover'\|from '@/lib/icon-insert'\|from '@/lib/icon-recents'" apps/web/src
```

**Step 2: Move the three files (+ tests)**

```bash
git mv apps/web/src/components/icon-picker-popover.tsx packages/canvas/src/components/icon-picker-popover.tsx
git mv apps/web/src/lib/icon-insert.ts packages/canvas/src/lib/icon-insert.ts
git mv apps/web/src/lib/icon-insert.test.ts packages/canvas/src/lib/icon-insert.test.ts
git mv apps/web/src/lib/icon-recents.ts packages/canvas/src/lib/icon-recents.ts
git mv apps/web/src/lib/icon-recents.test.ts packages/canvas/src/lib/icon-recents.test.ts
```

**Step 3: Rewrite imports** inside moved files (same pattern as Phase 2 Task 3).

**Step 4: Barrel + import-site updates**

Append three lines to `packages/canvas/src/index.ts`. Update `apps/web` import sites.

**Step 5: Verify + commit**

```bash
bun test packages/canvas/src/lib/icon-insert.test.ts packages/canvas/src/lib/icon-recents.test.ts
bun run typecheck
git add -A
git commit -m "refactor(canvas): move icon picker and helpers into @seeflow/canvas"
```

---

## Task 4: Move `style-strip.tsx`

**Files:**
- Move: `apps/web/src/components/style-strip.tsx` (+ any test) → `packages/canvas/src/components/style-strip.tsx`
- Modify: every import site

**Step 1: Inventory**

```bash
grep -rln "from '@/components/style-strip'" apps/web/src
```

Expect `demo-canvas.tsx`, plus `node-defaults.ts` / `last-used-style.ts` (the deferred helpers — they're still in `apps/web` until Task 2).

**Step 2: Move**

```bash
git mv apps/web/src/components/style-strip.tsx packages/canvas/src/components/style-strip.tsx
# Move any sibling test files
```

**Step 3: Rewrite internal imports**

The style-strip imports many UI primitives — these are already in `@seeflow/canvas/ui` from Phase 2. The simplest path is to rewrite to relative paths within the package:

| Old | New |
|---|---|
| `from '@/components/ui/icon-toggle-group'` | `from '../ui/icon-toggle-group'` |
| `from '@/components/ui/popover'` | `from '../ui/popover'` |
| `from '@/components/ui/slider'` | `from '../ui/slider'` |
| `from '@/components/ui/tooltip'` | `from '../ui/tooltip'` |
| `from '@/lib/color-tokens'` | `from '../lib/color-tokens'` |
| `from '@/lib/utils'` | `from '../lib/cn'` |
| `from '@/lib/api'` (types only) | `from '../types'` |

```bash
grep -n "from '@/" packages/canvas/src/components/style-strip.tsx
```

Expected: no output after fixes.

**Step 4: Barrel**

Append to `packages/canvas/src/index.ts`:

```ts
export * from './components/style-strip';
```

**Step 5: Update `apps/web/src/components/demo-canvas.tsx`**

Change `from '@/components/style-strip'` → `from '@seeflow/canvas'`. Merge with existing import block.

**Step 6: Verify + commit**

```bash
bun run typecheck
git add -A
git commit -m "refactor(canvas): move style-strip into @seeflow/canvas"
```

**Step 7: Now do Task 2** (node-defaults + last-used-style).

---

## Task 5: Move `selection-resize-overlay`

**Files:**
- Move: `apps/web/src/components/selection-resize-overlay.tsx` (+ test) → `packages/canvas/src/components/selection-resize-overlay.tsx`

**Step 1: Inventory imports + sites**

```bash
grep -n "^import" apps/web/src/components/selection-resize-overlay.tsx
grep -rln "from '@/components/selection-resize-overlay'" apps/web/src
```

**Step 2: Move + rewrite + barrel + verify + commit** — same pattern.

```bash
git mv apps/web/src/components/selection-resize-overlay.tsx packages/canvas/src/components/selection-resize-overlay.tsx
git mv apps/web/src/components/selection-resize-overlay.test.tsx packages/canvas/src/components/selection-resize-overlay.test.tsx 2>/dev/null
```

Rewrite `from '@/lib/scale-nodes'` → `from '../lib/scale-nodes'`. Append barrel. Update import sites. Test. Commit.

```bash
git commit -m "refactor(canvas): move selection-resize-overlay into @seeflow/canvas"
```

---

## Task 6: Move `canvas-toolbar.tsx`

**Files:**
- Move: `apps/web/src/components/canvas-toolbar.tsx` (+ test) → `packages/canvas/src/components/canvas-toolbar.tsx`

**Step 1–7:** Same pattern as Tasks 4 and 5. The toolbar imports `IconPickerPopover` (already in package from Task 3), UI primitives, color tokens, `cn`, and `keyboard-shortcuts` (already in package from Phase 1). All rewrites are to relative paths.

```bash
git mv apps/web/src/components/canvas-toolbar.tsx packages/canvas/src/components/canvas-toolbar.tsx
git mv apps/web/src/components/canvas-toolbar.test.tsx packages/canvas/src/components/canvas-toolbar.test.tsx 2>/dev/null
# rewrite imports, barrel, update sites, test, commit
git commit -m "refactor(canvas): move canvas-toolbar into @seeflow/canvas"
```

---

## Task 7: Move `detail-panel.tsx`

**Caution:** Detail panel may pull in a lot of app-specific concerns (data fetching, form state). Read it carefully first.

**Step 1: Inventory**

```bash
grep -n "^import" apps/web/src/components/detail-panel.tsx | head -40
```

If it reads `@/hooks/*` (e.g. for node history) or `@/lib/api` *functions* (REST clients), **stop**: the detail panel can't move cleanly yet. Either:

- (a) Refactor it to accept data + callbacks as props (a separate commit, still in `apps/web`), then move it.
- (b) Defer detail-panel to Phase 4 (alongside the orchestrator).

If it only imports types + UI primitives + canvas helpers, proceed.

**Step 2–7:** Same move pattern.

```bash
git mv apps/web/src/components/detail-panel.tsx packages/canvas/src/components/detail-panel.tsx
git mv apps/web/src/components/detail-panel.test.tsx packages/canvas/src/components/detail-panel.test.tsx 2>/dev/null
# rewrite imports, barrel, update sites, test, commit
git commit -m "refactor(canvas): move detail-panel into @seeflow/canvas"
```

---

## Task 8: Final sweep + smoke test + PR

**Step 1: Verify**

```bash
grep -rln "from '@/" packages/canvas/src
```

Expected: no output.

**Step 2: Full suite**

```bash
bun test
bun run typecheck
bun run format
bun run lint
```

**Step 3: Smoke test**

```bash
bun run dev
```

Manual checks (in addition to Phase 2's):
- Toolbar opens, icon picker works, color tokens render correctly in the picker.
- Style strip appears when a node is selected; changing a color persists to last-used-style; creating a new node picks up that style.
- Detail panel opens for a selected node and shows expected fields.
- Multi-select with marquee shows the bounding-box resize overlay; dragging it scales all selected nodes.

**Step 4: PR**

```bash
gh pr create --title "refactor(canvas): phase 3 — move chrome components" ...
```

---

## Notes for the executor

- **Task ordering matters in this phase.** Tasks 1 → 3 → 4 → 2 → 5 → 6 → 7 is the dependency-correct order. The plan groups them logically; if you hit a blocker, swap.
- **A single chrome component may touch ~10 files.** Each move is a single commit even though it's a wide blast radius.
- **If `detail-panel.tsx` has REST coupling**, defer it to Phase 4 and document the deferral in the PR.
- **The package `index.ts` is growing.** Consider reorganizing exports into thematic barrels (`./nodes`, `./edges`, `./ui`, `./components`) at the end of this phase — a small Task 9 if you want.
