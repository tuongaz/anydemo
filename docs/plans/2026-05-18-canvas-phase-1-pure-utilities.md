# Canvas Extraction — Phase 1: Pure Utilities Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move 5 pure (non-component) canvas utilities from `apps/web/src/lib/` into `packages/canvas/src/lib/`, plus shift the `dagre` runtime dep into `@seeflow/canvas`. After this PR, no behavior changes — `apps/web` imports the same functions from `@seeflow/canvas` instead.

**Architecture:** Each file is moved one at a time. Inside-file imports switch from `@/lib/api` and `@/lib/color-tokens` (apps/web aliases) to `@seeflow/canvas` (the package barrel — the moved file is reaching its own package, so it can either use the barrel or relative paths; relative is preferred to avoid circular-import surprises). Every `apps/web` import site updates to `@seeflow/canvas`. The existing tests are the verification gate — they move with each file and must pass at the new location. No re-export shims.

**Tech Stack:** Bun 1.3+, TypeScript, Vitest-style tests via `bun test`, Biome for lint/format, dagre 0.8.5, `@xyflow/react` types only (used by `connector-to-edge`).

**Files moving in this phase (with their tests):**

| Source | Destination |
|---|---|
| `apps/web/src/lib/floating-edge-geometry.ts` (+ `.test.ts`) | `packages/canvas/src/lib/floating-edge-geometry.ts` |
| `apps/web/src/lib/canvas-drop.ts` (+ `.test.ts`) | `packages/canvas/src/lib/canvas-drop.ts` |
| `apps/web/src/lib/keyboard-shortcuts.ts` (+ `.test.ts`) | `packages/canvas/src/lib/keyboard-shortcuts.ts` |
| `apps/web/src/lib/auto-layout.ts` (+ `.test.ts`) | `packages/canvas/src/lib/auto-layout.ts` |
| `apps/web/src/lib/connector-to-edge.ts` (+ `.test.ts`) | `packages/canvas/src/lib/connector-to-edge.ts` |

**Deferred to Phase 3:** `node-defaults.ts` and `last-used-style.ts` import types from `@/components/style-strip`. They move when `style-strip` moves.

---

## Task 0: Baseline + dependency move

**Files:**
- Modify: `packages/canvas/package.json`
- Modify: `apps/web/package.json`
- Modify: `apps/web/tsconfig.json` (if a path alias to `packages/canvas` needs adjusting — verify, don't change preemptively)

**Step 1: Confirm baseline is green**

Run from repo root:

```bash
bun install
bun run typecheck
bun test
```

Expected: all green. If anything is already failing, **stop and tell the user** — do not start moves on a red baseline.

**Step 2: Move `dagre` and `@types/dagre` into `@seeflow/canvas`**

Edit `packages/canvas/package.json`. Add to the existing manifest:

```json
{
  "name": "@seeflow/canvas",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "lucide-react": "*",
    "react": "*"
  },
  "dependencies": {
    "dagre": "^0.8.5"
  },
  "devDependencies": {
    "@types/dagre": "^0.7.54",
    "@types/react": "^18.3.12",
    "typescript": "^5.6.3"
  }
}
```

Edit `apps/web/package.json` — remove the `dagre` line from `dependencies` and `@types/dagre` from wherever it lives (`dependencies` per the inventory; double-check before removing).

**Step 3: Reinstall and verify**

```bash
bun install
bun run typecheck
```

Expected: clean. `dagre` resolves through `@seeflow/canvas` for any file that ends up there; `apps/web` will lose access to `dagre` directly. **Note:** `apps/web/src/lib/auto-layout.ts` still exists and imports `dagre` at this point. After `bun install`, that import may still resolve via hoisting in the workspace's root `node_modules`. If it doesn't, Task 4 (which moves `auto-layout.ts`) will fix it; if `bun run typecheck` fails on `auto-layout.ts` here, move ahead to Task 4 immediately rather than adding `dagre` back to `apps/web`.

**Step 4: Commit**

```bash
git add packages/canvas/package.json apps/web/package.json bun.lockb
git commit -m "chore(canvas): move dagre dep into @seeflow/canvas"
```

---

## Task 1: Move `floating-edge-geometry.ts`

**Why this file first:** It has zero canvas-internal imports — pure geometry math. Lowest-risk move.

**Files:**
- Move: `apps/web/src/lib/floating-edge-geometry.ts` → `packages/canvas/src/lib/floating-edge-geometry.ts`
- Move: `apps/web/src/lib/floating-edge-geometry.test.ts` → `packages/canvas/src/lib/floating-edge-geometry.test.ts`
- Modify: `apps/web/src/components/demo-canvas.tsx` (import path)
- Modify: `apps/web/src/components/edges/editable-edge.tsx` (import path)
- Modify: `packages/canvas/src/index.ts` (add exports)

**Step 1: List the public symbols to export**

Run:

```bash
grep -n "^export " apps/web/src/lib/floating-edge-geometry.ts
```

Note the full list — every `export` keyword. You'll add each of these to the package barrel in Step 5.

**Step 2: Move the files with git**

```bash
git mv apps/web/src/lib/floating-edge-geometry.ts packages/canvas/src/lib/floating-edge-geometry.ts
git mv apps/web/src/lib/floating-edge-geometry.test.ts packages/canvas/src/lib/floating-edge-geometry.test.ts
```

**Step 3: Fix the test's import to a relative path**

Edit `packages/canvas/src/lib/floating-edge-geometry.test.ts`. Change:

```ts
} from '@/lib/floating-edge-geometry';
```

to:

```ts
} from './floating-edge-geometry';
```

(Search the test for any other `@/` imports and convert each to a relative path within the package. For Task 1 there should be only the one self-import.)

**Step 4: Add to the package barrel**

Edit `packages/canvas/src/index.ts`. Append a re-export for every symbol from Step 1. Use a star export to avoid drift:

```ts
export * from './lib/floating-edge-geometry';
```

**Step 5: Update apps/web import sites**

Edit `apps/web/src/components/demo-canvas.tsx`. The import block referencing `@/lib/floating-edge-geometry` (around line 42–48) changes its source:

```ts
} from '@seeflow/canvas';
```

If the existing import is already pulling other symbols from `@seeflow/canvas`, **merge into the existing block** rather than adding a new one. Same edit in `apps/web/src/components/edges/editable-edge.tsx` (around line 8).

**Step 6: Run the moved test from the package**

```bash
bun test packages/canvas/src/lib/floating-edge-geometry.test.ts
```

Expected: all assertions pass. If you get module-resolution errors, re-verify Step 3.

**Step 7: Run package + web typecheck**

```bash
bun run typecheck
```

Expected: clean. If `apps/web` complains about a missing `@seeflow/canvas` export, you missed Step 4.

**Step 8: Commit**

```bash
git add packages/canvas/src/lib/floating-edge-geometry.ts \
        packages/canvas/src/lib/floating-edge-geometry.test.ts \
        packages/canvas/src/index.ts \
        apps/web/src/components/demo-canvas.tsx \
        apps/web/src/components/edges/editable-edge.tsx
git commit -m "refactor(canvas): move floating-edge-geometry into @seeflow/canvas"
```

---

## Task 2: Move `canvas-drop.ts`

**Why next:** Like Task 1, no canvas-internal imports. Pure helpers, well-isolated.

**Files:**
- Move: `apps/web/src/lib/canvas-drop.ts` → `packages/canvas/src/lib/canvas-drop.ts`
- Move: `apps/web/src/lib/canvas-drop.test.ts` → `packages/canvas/src/lib/canvas-drop.test.ts`
- Modify: `apps/web/src/components/demo-canvas.tsx`
- Modify: `packages/canvas/src/index.ts`

**Step 1: List exports**

```bash
grep -n "^export " apps/web/src/lib/canvas-drop.ts
```

**Step 2: Git move**

```bash
git mv apps/web/src/lib/canvas-drop.ts packages/canvas/src/lib/canvas-drop.ts
git mv apps/web/src/lib/canvas-drop.test.ts packages/canvas/src/lib/canvas-drop.test.ts
```

**Step 3: Fix the test's self-import**

In `packages/canvas/src/lib/canvas-drop.test.ts`, change `from '@/lib/canvas-drop'` to `from './canvas-drop'`.

**Step 4: Barrel export**

Append to `packages/canvas/src/index.ts`:

```ts
export * from './lib/canvas-drop';
```

**Step 5: Update apps/web**

In `apps/web/src/components/demo-canvas.tsx` (around line 39), the `from '@/lib/canvas-drop'` becomes `from '@seeflow/canvas'`. Merge with the existing `@seeflow/canvas` import block.

**Step 6: Test + typecheck**

```bash
bun test packages/canvas/src/lib/canvas-drop.test.ts
bun run typecheck
```

Expected: both green.

**Step 7: Commit**

```bash
git add packages/canvas/src/lib/canvas-drop.ts \
        packages/canvas/src/lib/canvas-drop.test.ts \
        packages/canvas/src/index.ts \
        apps/web/src/components/demo-canvas.tsx
git commit -m "refactor(canvas): move canvas-drop into @seeflow/canvas"
```

---

## Task 3: Move `keyboard-shortcuts.ts`

**Why next:** Type-only import of `ShapeKind`, no UI deps. More import sites to update than Tasks 1–2.

**Files:**
- Move: `apps/web/src/lib/keyboard-shortcuts.ts` → `packages/canvas/src/lib/keyboard-shortcuts.ts`
- Move: `apps/web/src/lib/keyboard-shortcuts.test.ts` → `packages/canvas/src/lib/keyboard-shortcuts.test.ts`
- Modify: `apps/web/src/components/canvas-toolbar.tsx`
- Modify: `apps/web/src/components/command-palette.tsx`
- Modify: `apps/web/src/components/command-palette.test.tsx`
- Modify: `apps/web/src/pages/demo-view.tsx`
- Modify: `packages/canvas/src/index.ts`

**Step 1: List exports**

```bash
grep -n "^export " apps/web/src/lib/keyboard-shortcuts.ts
```

This file is the largest of the five; expect ~15-20 exports (types, constants, COMMANDS array, helpers).

**Step 2: Git move**

```bash
git mv apps/web/src/lib/keyboard-shortcuts.ts packages/canvas/src/lib/keyboard-shortcuts.ts
git mv apps/web/src/lib/keyboard-shortcuts.test.ts packages/canvas/src/lib/keyboard-shortcuts.test.ts
```

**Step 3: Fix internal imports of the moved file**

Open `packages/canvas/src/lib/keyboard-shortcuts.ts`. Change:

```ts
import type { ShapeKind } from '@/lib/api';
```

to a relative import from the package's own types module:

```ts
import type { ShapeKind } from '../types';
```

(Verify `ShapeKind` is exported from `packages/canvas/src/types.ts` — per the inventory, it is.)

**Step 4: Fix the test's self-import**

In `packages/canvas/src/lib/keyboard-shortcuts.test.ts`, change `from '@/lib/keyboard-shortcuts'` to `from './keyboard-shortcuts'`.

**Step 5: Barrel export**

Append to `packages/canvas/src/index.ts`:

```ts
export * from './lib/keyboard-shortcuts';
```

**Step 6: Update apps/web — four sites**

For each of:
- `apps/web/src/components/canvas-toolbar.tsx:4`
- `apps/web/src/components/command-palette.tsx:7`
- `apps/web/src/components/command-palette.test.tsx:3`
- `apps/web/src/pages/demo-view.tsx:48`

Change `from '@/lib/keyboard-shortcuts'` to `from '@seeflow/canvas'`. Merge with existing `@seeflow/canvas` import blocks where they exist.

**Step 7: Verify no straggler imports**

```bash
grep -rn "from '@/lib/keyboard-shortcuts'" apps/web/src
```

Expected: no output.

**Step 8: Test + typecheck**

```bash
bun test packages/canvas/src/lib/keyboard-shortcuts.test.ts
bun run typecheck
```

Expected: green.

**Step 9: Commit**

```bash
git add packages/canvas/src/lib/keyboard-shortcuts.ts \
        packages/canvas/src/lib/keyboard-shortcuts.test.ts \
        packages/canvas/src/index.ts \
        apps/web/src/components/canvas-toolbar.tsx \
        apps/web/src/components/command-palette.tsx \
        apps/web/src/components/command-palette.test.tsx \
        apps/web/src/pages/demo-view.tsx
git commit -m "refactor(canvas): move keyboard-shortcuts into @seeflow/canvas"
```

---

## Task 4: Move `auto-layout.ts`

**Why now:** Needs the `dagre` dep already in `@seeflow/canvas` (from Task 0). Only one import site (`demo-view.tsx`).

**Files:**
- Move: `apps/web/src/lib/auto-layout.ts` → `packages/canvas/src/lib/auto-layout.ts`
- Move: `apps/web/src/lib/auto-layout.test.ts` → `packages/canvas/src/lib/auto-layout.test.ts`
- Modify: `apps/web/src/pages/demo-view.tsx`
- Modify: `packages/canvas/src/index.ts`

**Step 1: List exports**

```bash
grep -n "^export " apps/web/src/lib/auto-layout.ts
```

Note: types like `LayoutDirection`, `AutoLayoutNode`, `AutoLayoutEdge`, `AutoLayoutOptions`, plus `applyLayout`.

**Step 2: Git move**

```bash
git mv apps/web/src/lib/auto-layout.ts packages/canvas/src/lib/auto-layout.ts
git mv apps/web/src/lib/auto-layout.test.ts packages/canvas/src/lib/auto-layout.test.ts
```

**Step 3: Fix the test's self-import**

In `packages/canvas/src/lib/auto-layout.test.ts`, change `from '@/lib/auto-layout'` to `from './auto-layout'`.

(The implementation file imports `dagre` directly — no internal canvas imports — so no edits there.)

**Step 4: Barrel export**

Append to `packages/canvas/src/index.ts`:

```ts
export * from './lib/auto-layout';
```

**Step 5: Update apps/web**

In `apps/web/src/pages/demo-view.tsx:35`, change `from '@/lib/auto-layout'` to `from '@seeflow/canvas'`. Merge with the existing `@seeflow/canvas` import block.

**Step 6: Verify dagre resolves from the package**

```bash
bun run typecheck
```

Expected: green. If TypeScript complains about `dagre` not being resolvable from `packages/canvas`, double-check Task 0 added it to `packages/canvas/package.json` and ran `bun install`.

**Step 7: Run the moved test**

```bash
bun test packages/canvas/src/lib/auto-layout.test.ts
```

Expected: green.

**Step 8: Commit**

```bash
git add packages/canvas/src/lib/auto-layout.ts \
        packages/canvas/src/lib/auto-layout.test.ts \
        packages/canvas/src/index.ts \
        apps/web/src/pages/demo-view.tsx
git commit -m "refactor(canvas): move auto-layout into @seeflow/canvas"
```

---

## Task 5: Move `connector-to-edge.ts`

**Why last:** Most internal-canvas dependencies — pulls types from `@/lib/api` AND `colorTokenStyle` from `@/lib/color-tokens`. Both are already in `@seeflow/canvas`, but the import path conversion is multi-line. Save it for when you've gotten the rhythm.

**Files:**
- Move: `apps/web/src/lib/connector-to-edge.ts` → `packages/canvas/src/lib/connector-to-edge.ts`
- Move: `apps/web/src/lib/connector-to-edge.test.ts` → `packages/canvas/src/lib/connector-to-edge.test.ts`
- Modify: `apps/web/src/components/demo-canvas.tsx`
- Modify: `packages/canvas/src/index.ts`

**Step 1: List exports**

```bash
grep -n "^export " apps/web/src/lib/connector-to-edge.ts
```

Look for `connectorToEdge`, `styleForKind`, and the `DerivedEdge` type (per the test imports).

**Step 2: Git move**

```bash
git mv apps/web/src/lib/connector-to-edge.ts packages/canvas/src/lib/connector-to-edge.ts
git mv apps/web/src/lib/connector-to-edge.test.ts packages/canvas/src/lib/connector-to-edge.test.ts
```

**Step 3: Fix imports inside the moved file**

Open `packages/canvas/src/lib/connector-to-edge.ts`. Change:

```ts
import type { Connector, ConnectorPath, ConnectorStyle, EdgePin } from '@/lib/api';
import { colorTokenStyle } from '@/lib/color-tokens';
```

to relative imports within the package:

```ts
import type { Connector, ConnectorPath, ConnectorStyle, EdgePin } from '../types';
import { colorTokenStyle } from './color-tokens';
```

(Verify each named import exists at the new location:
- `Connector`, `ConnectorPath`, `ConnectorStyle`, `EdgePin` from `packages/canvas/src/types.ts`
- `colorTokenStyle` from `packages/canvas/src/lib/color-tokens.ts` — yes per inventory.)

**Step 4: Fix the test's self-import**

In `packages/canvas/src/lib/connector-to-edge.test.ts`, change `from '@/lib/connector-to-edge'` to `from './connector-to-edge'`. Check for any other `@/` imports in that test file — convert each to a relative import (look especially for `@/lib/api` type imports, which become `../types`).

**Step 5: Barrel export**

Append to `packages/canvas/src/index.ts`:

```ts
export * from './lib/connector-to-edge';
```

**Step 6: Update apps/web**

In `apps/web/src/components/demo-canvas.tsx:41`, change `from '@/lib/connector-to-edge'` to `from '@seeflow/canvas'`. Merge with the existing `@seeflow/canvas` import block.

**Step 7: Verify no straggler imports**

```bash
grep -rn "from '@/lib/connector-to-edge'\|from '@/lib/floating-edge-geometry'\|from '@/lib/canvas-drop'\|from '@/lib/auto-layout'\|from '@/lib/keyboard-shortcuts'" apps/web/src
```

Expected: no output. Any hits mean a Phase 1 import was missed; go back and fix.

**Step 8: Test + typecheck**

```bash
bun test packages/canvas/src/lib/connector-to-edge.test.ts
bun run typecheck
```

Expected: green.

**Step 9: Commit**

```bash
git add packages/canvas/src/lib/connector-to-edge.ts \
        packages/canvas/src/lib/connector-to-edge.test.ts \
        packages/canvas/src/index.ts \
        apps/web/src/components/demo-canvas.tsx
git commit -m "refactor(canvas): move connector-to-edge into @seeflow/canvas"
```

---

## Task 6: Final verification sweep

**Files:** none modified; just running the suite.

**Step 1: Full test suite**

```bash
bun test
```

Expected: every test in the monorepo passes. Pay attention to count vs. the baseline you noted in Task 0 — should match.

**Step 2: Typecheck both projects**

```bash
bun run typecheck
```

Expected: clean.

**Step 3: Format + lint**

Per CLAUDE.md, format BEFORE lint:

```bash
bun run format
bun run lint
```

Expected: clean. If `format` makes changes, stage and amend them into the last commit, OR add a small follow-up commit `chore: biome format` — your call.

**Step 4: Smoke test the studio**

```bash
bun run dev
```

Open `http://localhost:5173`, load a demo, drag a node, drop an image, run a keyboard shortcut (e.g. `R` to add a rectangle), auto-layout from the toolbar, draw an edge. Verify nothing regressed visually or behaviorally.

If anything's broken — **stop and report**; don't push a half-working PR.

**Step 5: Final commit (if format-only changes)**

```bash
git status                      # confirm what's outstanding
git add -p                      # be selective
git commit -m "chore: biome format pass after canvas phase 1"
```

**Step 6: Push and open PR**

```bash
git push -u origin <branch>
gh pr create --title "refactor(canvas): phase 1 — move pure utilities to @seeflow/canvas" \
  --body "$(cat <<'EOF'
## Summary
- Moves 5 pure utilities (`floating-edge-geometry`, `canvas-drop`, `keyboard-shortcuts`, `auto-layout`, `connector-to-edge`) plus their tests from `apps/web/src/lib/` into `packages/canvas/src/lib/`.
- Shifts `dagre` and `@types/dagre` from `apps/web` to `@seeflow/canvas`.
- All `apps/web` import sites updated to `@seeflow/canvas`. No re-export shims.
- Zero behavior change — existing tests are the gate.

Phase 1 of the canvas-extraction plan: `docs/plans/2026-05-18-canvas-package-extraction-design.md`.

`node-defaults.ts` and `last-used-style.ts` are deferred to Phase 3 because they import types from `@/components/style-strip`, which moves alongside them.

## Test plan
- [ ] `bun test` — full suite green
- [ ] `bun run typecheck` — clean
- [ ] `bun run lint` — clean
- [ ] `bun run dev` — manual smoke: drag node, drop image, keyboard shortcut, auto-layout, draw edge

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the executor

- **One commit per task.** Don't batch. If you need to revert, you want a clean undo per file move.
- **Don't add re-export shims** in `apps/web/src/lib/`. The plan deletes the old locations and switches consumers directly. Shims accumulate cleanup debt.
- **Tailwind / CSS:** None of the Phase 1 files have styling, so no Tailwind concerns this phase.
- **If a test fails after a move:** the cause is almost always a missed import path. Run `grep -rn "@/lib/<filename>"` to find stragglers. If imports look right and the test still fails, the test was relying on apps/web-specific behavior that doesn't apply at the package level — **stop and report** rather than rewriting the test.
- **Path aliases:** The package has no `@/` alias. Use relative paths inside `packages/canvas/src/`.
- **Bun lockfile:** `bun.lockb` will change after Task 0's `bun install`. Commit it with Task 0.
