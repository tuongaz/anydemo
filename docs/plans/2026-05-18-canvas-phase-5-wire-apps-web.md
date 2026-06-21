# Canvas Extraction — Phase 5: Wire `apps/web` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Prerequisite:** Phase 4 merged to `main`.

**Goal:** Reduce `apps/web` to a thin consumer of `@seeflow/canvas`. Verify nothing regressed.

**Architecture:** Most of this work happened inside Phase 4 (sub-task 6). This phase exists to (a) catch anything that was left in `apps/web` because it wasn't strictly required to make Phase 4 land, (b) delete orphaned files, and (c) run an exhaustive smoke test before declaring the extraction complete.

**Tech Stack:** Bun, React, Vite, Tailwind.

---

## Task 1: Audit `apps/web/src/components` and `apps/web/src/lib` for orphans

**What:** After Phases 1–4, several files in `apps/web` may no longer be imported. Find them and delete them.

**Step 1: Run the unused-export detector**

If the project has `ts-prune` or `knip` configured, use it. Otherwise:

```bash
# Brute-force: find any .ts/.tsx in apps/web/src that has zero importers
for f in $(find apps/web/src -name '*.ts' -o -name '*.tsx' | grep -v '.test.' | grep -v 'main.tsx'); do
  base=$(basename "$f" | sed -E 's/\.(ts|tsx)$//')
  refs=$(grep -rln "from '@/.*${base}'\|from '\\./${base}'\|from '\\.\\./${base}'" apps/web/src | grep -v "$f" | wc -l)
  [ "$refs" -eq 0 ] && echo "ORPHAN: $f"
done
```

The script is heuristic — verify each hit manually before deleting.

**Step 2: For each confirmed orphan, delete and commit**

```bash
git rm <path>
git commit -m "chore(web): delete orphan after canvas extraction: <name>"
```

Expected orphans (best guess from the inventory):
- `apps/web/src/lib/api.ts` — if its types are fully consumed via `@seeflow/canvas` and its functions are fully replaced by the adapter, the whole file can go. If the API client is still used outside the canvas (e.g., for fetching demo lists, projects), keep the non-canvas functions.

**Step 3: Verify**

```bash
bun run typecheck
bun test
```

Expected: green.

---

## Task 2: Verify the Tailwind content path

**What:** Confirm that classes used inside `packages/canvas/src/**/*.{ts,tsx}` are picked up by Tailwind's JIT compilation in the web app.

**Step 1: Inspect `apps/web/tailwind.config.ts`**

```bash
cat apps/web/tailwind.config.ts
```

Look at the `content` array. It must include either an explicit glob to the canvas package OR be configured to auto-discover workspace packages.

**Step 2: If missing, add the glob**

```ts
// apps/web/tailwind.config.ts
content: [
  './src/**/*.{ts,tsx}',
  '../../packages/canvas/src/**/*.{ts,tsx}',
],
```

**Step 3: Verify in the running app**

```bash
bun run dev
```

Open the studio. Inspect a node in DevTools — check that its Tailwind classes have computed styles. If a class shows in the HTML but has no styles, the content path is wrong.

**Step 4: Commit (if changed)**

```bash
git add apps/web/tailwind.config.ts
git commit -m "build(web): include @seeflow/canvas in Tailwind content"
```

---

## Task 3: Update the package barrel for the public API

**What:** `packages/canvas/src/index.ts` grew organically across phases. Organize it into a clean public API.

**Files:**
- Modify: `packages/canvas/src/index.ts`

**Step 1: Group the exports**

Restructure into logical sections:

```ts
// ── Types (schema) ────────────────────────────────
export * from './types';

// ── Theming + Icons ───────────────────────────────
export * from './lib/color-tokens';
export * from './lib/icon-registry';
export { cn } from './lib/cn';

// ── Helpers (mostly internal but useful to advanced consumers) ─
export * from './lib/auto-layout';
export * from './lib/canvas-drop';
export * from './lib/connector-to-edge';
export * from './lib/floating-edge-geometry';
export * from './lib/keyboard-shortcuts';
export * from './lib/last-used-style';
export * from './lib/node-defaults';
export * from './lib/scale-nodes';
export * from './lib/detail-panel-width';

// ── Adapter contract + REST factory ───────────────
export * from './adapter/types';
export * from './adapter/rest';

// ── Node + edge components (advanced composition) ─
export * from './nodes';
export * from './edges';

// ── UI primitives (Radix wrappers, advanced) ──────
export * from './ui';

// ── Chrome components (advanced composition) ─────
export * from './components/canvas-toolbar';
export * from './components/style-strip';
export * from './components/detail-panel';
export * from './components/selection-resize-overlay';
export * from './components/icon-picker-popover';
export * from './components/inline-edit';

// ── Main entry point ──────────────────────────────
export * from './components/seeflow-canvas';
```

**Step 2: Verify nothing is double-exported**

```bash
bun run typecheck
```

Expected: clean. If TS complains about a duplicate export, two `export *` lines collide on a name — pick one as canonical.

**Step 3: Commit**

```bash
git add packages/canvas/src/index.ts
git commit -m "refactor(canvas): organize package barrel into themed sections"
```

---

## Task 4: Add a `README.md` to `packages/canvas/`

**Files:**
- Create: `packages/canvas/README.md`

**Step 1: Write a short README**

Cover only what a consumer needs:
- Install: `bun add @seeflow/canvas` (workspace consumers use `"workspace:*"`).
- Peer deps that consumers must install themselves: `react`, `react-dom`, `@xyflow/react`, `lucide-react`.
- Tailwind: add `packages/canvas/src/**/*.{ts,tsx}` to content array.
- Quickstart example: minimal `<SeeflowCanvas mode='view' demo={demo} />` and `mode='edit'` variant with a REST adapter.
- Adapter contract: link to `CanvasAdapter` in the source.

Keep it ~80 lines. Don't duplicate the design doc — link to it.

**Step 2: Commit**

```bash
git add packages/canvas/README.md
git commit -m "docs(canvas): add README"
```

---

## Task 5: Exhaustive smoke test

**Step 1: Run the full toolchain**

```bash
bun install              # pick up any lockfile drift
bun run typecheck
bun test
bun run format
bun run lint
```

Expected: all green.

**Step 2: Smoke test in the studio**

```bash
bun run dev
```

Run through every interaction:

| Area | What to verify |
|---|---|
| Render | All node kinds (play, state, shape rect/ellipse/sticky/text/database/server/user/queue/cloud, image, icon, html). Edges with arrows, labels, styles. |
| Edit | Inline-edit a node name. Inline-edit an edge label. Change a node color via style-strip — verify last-used-style picks up the choice on next create. |
| Drag | Drag a node. Drag a selection. Drop a new shape from the toolbar. Drop an image file from the OS. |
| Resize | Resize a single node. Multi-select + bounding-box scale via selection-resize-overlay. |
| Connect | Create an edge by dragging from a handle. Float-attach via the auto-pick endpoint. User-pin an endpoint via the editable-edge. |
| Delete | Delete a node. Delete a connector. Keyboard `Backspace`. |
| Keyboard | `R` for rectangle, `E` for ellipse, etc. Zoom shortcuts. Undo/redo. |
| Auto-layout | Trigger from the toolbar. Verify dagre lays out cleanly. |
| Detail panel | Open detail panel for a selected node. Edit a field — change persists. |
| Run | Trigger a play. Status badge updates via SSE. |
| Reload | Hard-refresh page mid-edit — state restores from server. |

If any interaction misbehaves, **stop and triage** before declaring done.

**Step 3: Try `mode='view'`**

In `apps/web/src/components/canvas.tsx`, temporarily change `mode="edit"` → `mode="view"`:

```tsx
return <SeeflowCanvas mode="view" demo={demo} runtime={...} />;
```

Verify:
- Toolbar, style-strip, detail-panel are hidden.
- Nodes still draggable but no network PATCH calls in the network tab.
- Connectors immovable, no edge create.
- Zoom, pan, status badges work.

**Revert** the change after the test. The default in the app is `mode='edit'`.

**Step 4: Commit the (unchanged) revert**

The revert is just confirming the canvas.tsx file is back to `mode="edit"`. Nothing to commit if no diff remains.

---

## Task 6: Open the PR

```bash
gh pr create --title "feat(canvas): phase 5 — finalize @seeflow/canvas extraction" \
  --body "$(cat <<'EOF'
## Summary
- Deletes orphaned files in `apps/web` after the canvas moved out.
- Adds Tailwind content path for `@seeflow/canvas`.
- Organizes the package's public barrel into thematic sections.
- Adds a `README.md` to the package.

Final phase of the canvas-extraction plan: `docs/plans/2026-05-18-canvas-package-extraction-design.md`.

After this PR, `@seeflow/canvas` is a standalone, embeddable canvas. A new consumer needs:
- `@xyflow/react`, `react`, `react-dom`, `lucide-react` as peer deps.
- A `CanvasAdapter` implementation (or `createRestAdapter` for SeeFlow-shaped backends).
- Tailwind with the canvas package in `content`.

## Test plan
- [ ] `bun test` — full suite green
- [ ] `bun run typecheck` — clean
- [ ] `bun run lint` — clean
- [ ] Exhaustive manual smoke test (per the Phase 5 plan, Task 5)
- [ ] Verified `mode='view'` works locally

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the executor

- **This phase is a cleanup pass.** Don't introduce new features here. If the smoke test surfaces a regression, fix it in a precursor commit on the same branch — don't pile it into the cleanup PR's mental model.
- **The orphan-finder script is heuristic.** Trust your eyes more than the script. A file with zero `from` references could still be the entry point of a lazy-loaded route.
- **Don't delete `apps/web/src/lib/api.ts` blindly.** Check what's still imported (project listing, demo CRUD, etc.) and keep those. Delete only the canvas-mutating exports.
- **The README is the canvas's public face.** Spend the 30 minutes to make it actually useful for an external consumer. A bad README undoes a lot of the extraction work's value.
