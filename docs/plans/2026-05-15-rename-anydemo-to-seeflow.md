# Rename anydemo → seeflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename the entire app from `anydemo`/`SeeFlow` to `seeflow`/`SeeFlow`, including package names, CLI binaries, the `.seeflow/` directory convention, CSS tokens, UI text, agents, skills, and plugin.

**Architecture:** Pure search-and-replace + file renames across the monorepo. No logic changes — this is a brand rename only. The `.seeflow/` hidden directory convention in demo projects changes to `.seeflow/`. Root directory rename is handled by the operator separately.

**Tech Stack:** Bun, TypeScript, React, Hono, Biome (lint/format)

---

### Task 1: Root package.json

**Files:**
- Modify: `package.json`

**Step 1: Apply changes**

In `package.json`, make these replacements:
- Line 2: `"name": "anydemo"` → `"name": "seeflow"`
- Line 8: `"anyflow": "apps/studio/bin/anydemo"` → `"seeflow": "apps/studio/bin/seeflow"`
- Line 9: `"anydemo": "apps/studio/bin/anydemo"` → remove this line entirely (keeping only the single `seeflow` entry)

**Step 2: Verify**

```bash
cat package.json
```
Expected: `"name": "seeflow"`, one bin entry `"seeflow": "apps/studio/bin/seeflow"`.

**Step 3: Commit**

```bash
git add package.json
git commit -m "rename: root package name and bin to seeflow"
```

---

### Task 2: apps/studio/package.json

**Files:**
- Modify: `apps/studio/package.json`

**Step 1: Apply changes**

- Line 2: `"name": "@tuongaz/anyflow"` → `"name": "@tuongaz/seeflow"`
- Line 6 (keyword): `"anydemo"` → `"seeflow"`
- Line 15: `https://github.com/tuongaz/anydemo#readme` → `https://github.com/tuongaz/seeflow#readme`
- Line 18: `git+https://github.com/tuongaz/anydemo.git` → `git+https://github.com/tuongaz/seeflow.git`
- Line 22: `https://github.com/tuongaz/anydemo/issues` → `https://github.com/tuongaz/seeflow/issues`
- Lines 28-30 (bin section): replace all three entries with:
  ```json
  "seeflow": "bin/seeflow",
  "seeflow-mcp": "bin/seeflow-mcp"
  ```

**Step 2: Verify**

```bash
cat apps/studio/package.json | grep -E '"name"|"bin"|seeflow|anydemo|anyflow'
```
Expected: no `anydemo` or `anyflow` remaining.

**Step 3: Commit**

```bash
git add apps/studio/package.json
git commit -m "rename: studio package name and bins to seeflow"
```

---

### Task 3: apps/web and packages/sdk package.json

**Files:**
- Modify: `apps/web/package.json`
- Modify: `packages/sdk/package.json`

**Step 1: Apply changes**

`apps/web/package.json` line 2:
- `"name": "@anydemo/web"` → `"name": "@seeflow/web"`

`packages/sdk/package.json` line 2:
- `"name": "@anydemo/sdk"` → `"name": "@seeflow/sdk"`

**Step 2: Commit**

```bash
git add apps/web/package.json packages/sdk/package.json
git commit -m "rename: web and sdk package names to @seeflow scope"
```

---

### Task 4: Rename and update bin files

**Files:**
- Rename: `apps/studio/bin/anydemo` → `apps/studio/bin/seeflow`
- Rename: `apps/studio/bin/anydemo-mcp` → `apps/studio/bin/seeflow-mcp`

**Step 1: Rename files**

```bash
mv apps/studio/bin/anydemo apps/studio/bin/seeflow
mv apps/studio/bin/anydemo-mcp apps/studio/bin/seeflow-mcp
```

**Step 2: Update content of `apps/studio/bin/seeflow`**

Replace all `anydemo` occurrences in the file:
- `// SeeFlow CLI launcher.` → `// SeeFlow CLI launcher.`
- `// This thin Node shim makes \`npx anydemo …\` work` → `// This thin Node shim makes \`npx seeflow …\` work`
- `console.error('anydemo: Bun not found...` → `console.error('seeflow: Bun not found...`
- `console.error(\`anydemo: failed to launch CLI...` → `console.error(\`seeflow: failed to launch CLI...`

**Step 3: Update content of `apps/studio/bin/seeflow-mcp`**

Replace all `anydemo-mcp` occurrences:
- `console.error('anydemo-mcp: Bun not found...` → `console.error('seeflow-mcp: Bun not found...`
- `console.error(\`anydemo-mcp: failed to launch MCP shim...` → `console.error(\`seeflow-mcp: failed to launch MCP shim...`

**Step 4: Commit**

```bash
git add apps/studio/bin/
git commit -m "rename: bin files from anydemo to seeflow"
```

---

### Task 5: apps/studio/src/cli.ts

**Files:**
- Modify: `apps/studio/src/cli.ts`

**Step 1: Apply changes** (all occurrences of `anydemo`/`anyflow`/`SeeFlow`)

- `const DEFAULT_DEMO_PATH = '.seeflow/demo.json'` → `const DEFAULT_DEMO_PATH = '.seeflow/demo.json'`
- `console.log(\`anydemo ${sub}: not implemented\`` → `console.log(\`seeflow ${sub}: not implemented\``
- `anyflow / anydemo — local studio` → `seeflow — local studio`
- `npx @tuongaz/anyflow <command>` → `npx @tuongaz/seeflow <command>`
- All four `npx @tuongaz/anyflow` examples → `npx @tuongaz/seeflow`
- `(default: .seeflow/demo.json)` → `(default: .seeflow/demo.json)`
- `'Start it first: seeflow start'` (×2) → `'Start it first: seeflow start'`

**Step 2: Verify**

```bash
grep -n "anydemo\|anyflow\|SeeFlow" apps/studio/src/cli.ts
```
Expected: no matches.

**Step 3: Commit**

```bash
git add apps/studio/src/cli.ts
git commit -m "rename: cli.ts references anydemo→seeflow"
```

---

### Task 6: apps/studio/src/runtime.ts

**Files:**
- Modify: `apps/studio/src/runtime.ts`

**Step 1: Apply changes**

- `join(homedir(), '.anydemo', 'config.json')` → `join(homedir(), '.seeflow', 'config.json')`
- `join(homedir(), '.anydemo', 'anydemo.pid')` → `join(homedir(), '.seeflow', 'seeflow.pid')`

**Step 2: Verify**

```bash
grep -n "anydemo" apps/studio/src/runtime.ts
```
Expected: no matches.

**Step 3: Commit**

```bash
git add apps/studio/src/runtime.ts
git commit -m "rename: runtime.ts ~/.anydemo paths to ~/.seeflow"
```

---

### Task 7: apps/studio/src/watcher.ts

**Files:**
- Modify: `apps/studio/src/watcher.ts`

**Step 1: Apply changes**

- Comment line 43: `under \`<project>/.seeflow/\`` → `under \`<project>/.seeflow/\``
- Comment line 52: `rooted at \`<project>/.seeflow/\`` → `rooted at \`<project>/.seeflow/\``
- Line 269: `join(entry.repoPath, '.anydemo')` → `join(entry.repoPath, '.seeflow')`

**Step 2: Verify**

```bash
grep -n "anydemo" apps/studio/src/watcher.ts
```
Expected: no matches.

**Step 3: Commit**

```bash
git add apps/studio/src/watcher.ts
git commit -m "rename: watcher.ts .anydemo path references to .seeflow"
```

---

### Task 8: apps/studio/src/sdk-writer.ts

**Files:**
- Modify: `apps/studio/src/sdk-writer.ts`

**Step 1: Apply changes**

- Comment: `Writes \`.seeflow/sdk/emit.ts\`` → `Writes \`.seeflow/sdk/emit.ts\``
- `join(repoPath, '.anydemo', 'sdk')` → `join(repoPath, '.seeflow', 'sdk')`

**Step 2: Verify**

```bash
grep -n "anydemo" apps/studio/src/sdk-writer.ts
```
Expected: no matches.

**Step 3: Commit**

```bash
git add apps/studio/src/sdk-writer.ts
git commit -m "rename: sdk-writer.ts .anydemo paths to .seeflow"
```

---

### Task 9: apps/studio/src/schema.ts, api.ts, mcp.ts

**Files:**
- Modify: `apps/studio/src/schema.ts`
- Modify: `apps/studio/src/api.ts`
- Modify: `apps/studio/src/mcp.ts`

**Step 1: schema.ts** — replace all 9 occurrences of `.seeflow/` with `.seeflow/` (in comments and validation error message strings).

**Step 2: api.ts** — replace `.seeflow/` references in comments with `.seeflow/`.

**Step 3: mcp.ts** — replace `~/.anydemo` reference in comment with `~/.seeflow`.

**Step 4: Verify**

```bash
grep -n "anydemo" apps/studio/src/schema.ts apps/studio/src/api.ts apps/studio/src/mcp.ts
```
Expected: no matches.

**Step 5: Commit**

```bash
git add apps/studio/src/schema.ts apps/studio/src/api.ts apps/studio/src/mcp.ts
git commit -m "rename: schema/api/mcp .anydemo references to .seeflow"
```

---

### Task 10: Rename .seeflow/ directories in examples

**Files:**
- Rename: `examples/checkout-demo/.seeflow/` → `examples/checkout-demo/.seeflow/`
- Rename: `examples/order-pipeline/.seeflow/` → `examples/order-pipeline/.seeflow/`
- Rename: `examples/todo-demo-target/.seeflow/` → `examples/todo-demo-target/.seeflow/`

**Step 1: Rename**

```bash
mv examples/checkout-demo/.anydemo examples/checkout-demo/.seeflow
mv examples/order-pipeline/.anydemo examples/order-pipeline/.seeflow
mv examples/todo-demo-target/.anydemo examples/todo-demo-target/.seeflow
```

**Step 2: Update references inside the renamed directories**

Search for `anydemo` in all files inside the renamed dirs and replace:

```bash
grep -rn "anydemo\|SeeFlow" examples/checkout-demo/.seeflow examples/order-pipeline/.seeflow examples/todo-demo-target/.seeflow
```

Update any occurrences found (check `demo.json` files, scripts).

**Step 3: Update references in example source files that pointed to `.seeflow/`**

```bash
grep -rn "\.anydemo" examples/ --include="*.ts" --include="*.json" --include="*.md"
```

Replace all `.anydemo` path references with `.seeflow` in the example source files.

**Step 4: Verify**

```bash
grep -rn "anydemo" examples/ | grep -v ".git"
```
Expected: no matches (or only in git history).

**Step 5: Commit**

```bash
git add examples/
git commit -m "rename: example .seeflow/ directories to .seeflow/"
```

---

### Task 11: apps/web/src/index.css

**Files:**
- Modify: `apps/web/src/index.css`

**Step 1: Apply changes** — replace all `anydemo` occurrences globally:

- `--anydemo-handle-fill` → `--seeflow-handle-fill`
- `--anydemo-handle-border-color` → `--seeflow-handle-border-color`
- `--anydemo-handle-border-width` → `--seeflow-handle-border-width`
- `--anydemo-handle-size` → `--seeflow-handle-size`
- `.anydemo-no-scrollbar` → `.seeflow-no-scrollbar`
- `@keyframes anydemo-ping-fast` → `@keyframes seeflow-ping-fast`
- `animation: anydemo-ping-fast` → `animation: seeflow-ping-fast`
- `@keyframes anydemo-node-pulse` → `@keyframes seeflow-node-pulse`
- `.anydemo-node-pulse` → `.seeflow-node-pulse`
- `animation: anydemo-node-pulse` → `animation: seeflow-node-pulse`
- `.anydemo-connector-endpoint-dot` → `.seeflow-connector-endpoint-dot`
- `.react-flow.anydemo-connecting` (×3) → `.react-flow.seeflow-connecting`
- `--anydemo-node-border` (comment) → `--seeflow-node-border`
- `--anydemo-node-bg` (comment) → `--seeflow-node-bg`

**Step 2: Verify**

```bash
grep -n "anydemo" apps/web/src/index.css
```
Expected: no matches.

**Step 3: Commit**

```bash
git add apps/web/src/index.css
git commit -m "rename: CSS tokens and class names anydemo→seeflow"
```

---

### Task 12: Web component files — class names and CSS vars

**Files:**
- Modify: `apps/web/src/components/demo-canvas.tsx`
- Modify: `apps/web/src/components/nodes/state-node.tsx`
- Modify: `apps/web/src/components/nodes/play-node.tsx`
- Modify: `apps/web/src/components/nodes/shape-node.tsx`
- Modify: `apps/web/src/components/nodes/shapes/types.ts`
- Modify: `apps/web/src/components/edges/editable-edge.tsx`
- Modify: `apps/web/src/components/command-palette.tsx`

**Step 1: Apply changes in each file** — replace all `anydemo` occurrences:

`demo-canvas.tsx`:
- `.seeflow/<htmlPath>` in comment → `.seeflow/<htmlPath>`
- `.anydemo-connector-endpoint-dot` → `.seeflow-connector-endpoint-dot`
- `'anydemo-connecting'` → `'seeflow-connecting'`
- `--anydemo-handle-size` in comment → `--seeflow-handle-size`

`state-node.tsx`:
- `'anydemo-node-pulse'` → `'seeflow-node-pulse'`

`play-node.tsx`:
- `'anydemo-node-pulse'` → `'seeflow-node-pulse'`

`shape-node.tsx`:
- `.react-flow.anydemo-connecting` in comment → `.react-flow.seeflow-connecting`

`nodes/shapes/types.ts`:
- `var(--anydemo-node-border)` and `var(--anydemo-node-bg)` in comments → `--seeflow-*`
- `export const BORDER_FALLBACK = 'var(--anydemo-node-border)'` → `'var(--seeflow-node-border)'`
- `export const BG_FALLBACK = 'var(--anydemo-node-bg)'` → `'var(--seeflow-node-bg)'`

`editable-edge.tsx`:
- `className="anydemo-connector-endpoint-dot"` (×2) → `className="seeflow-connector-endpoint-dot"`

`command-palette.tsx`:
- `'anydemo-no-scrollbar'` → `'seeflow-no-scrollbar'`

**Step 2: Verify**

```bash
grep -rn "anydemo" apps/web/src/components/ | grep -v ".test."
```
Expected: no matches outside test files.

**Step 3: Commit**

```bash
git add apps/web/src/components/
git commit -m "rename: web component class names and CSS var refs anydemo→seeflow"
```

---

### Task 13: Web UI text and other web source

**Files:**
- Modify: `apps/web/src/components/empty-state.tsx`
- Modify: `apps/web/src/components/header.tsx`
- Modify: `apps/web/src/components/create-project-dialog.tsx`
- Modify: `apps/web/src/components/canvas-toolbar.tsx`

**Step 1: Apply changes**

`empty-state.tsx`:
- `const REGISTER_COMMAND = 'npx anydemo register --path .'` → `'npx seeflow register --path .'`
- `data-testid="anydemo-empty-state"` → `data-testid="seeflow-empty-state"`
- `Point SeeFlow at any folder` → `Point SeeFlow at any folder`
- `.seeflow/demo.json` (displayed code) → `.seeflow/demo.json`

`header.tsx`:
- `SeeFlow Studio` → `SeeFlow Studio`

`create-project-dialog.tsx`:
- `~/.seeflow/&lt;slug&gt;` → `~/.seeflow/&lt;slug&gt;`

`canvas-toolbar.tsx`:
- `'application/x-anydemo-create-html-block'` → `'application/x-seeflow-create-html-block'`

**Step 2: Verify**

```bash
grep -rn "anydemo\|SeeFlow" apps/web/src/components/empty-state.tsx apps/web/src/components/header.tsx apps/web/src/components/create-project-dialog.tsx apps/web/src/components/canvas-toolbar.tsx
```
Expected: no matches.

**Step 3: Commit**

```bash
git add apps/web/src/components/empty-state.tsx apps/web/src/components/header.tsx apps/web/src/components/create-project-dialog.tsx apps/web/src/components/canvas-toolbar.tsx
git commit -m "rename: web UI text SeeFlow→SeeFlow"
```

---

### Task 14: Remaining web source files

**Files:**
- Modify: `apps/web/src/lib/command-palette.tsx` (if any remaining)
- Check all remaining web source files

**Step 1: Find any remaining**

```bash
grep -rn "anydemo\|SeeFlow" apps/web/src/ | grep -v ".test." | grep -v "index.css"
```

**Step 2: Apply remaining fixes** as needed per file.

**Step 3: Commit any changes**

```bash
git add apps/web/src/
git commit -m "rename: remaining web src anydemo references"
```

---

### Task 15: Rename agent files and update content

**Files:**
- Rename: `agents/seeflow-discoverer.md` → `agents/seeflow-discoverer.md`
- Rename: `agents/seeflow-discoverer.smoke.md` → `agents/seeflow-discoverer.smoke.md`
- Rename: `agents/seeflow-node-planner.md` → `agents/seeflow-node-planner.md`
- Rename: `agents/seeflow-play-designer.md` → `agents/seeflow-play-designer.md`
- Rename: `agents/seeflow-status-designer.md` → `agents/seeflow-status-designer.md`

**Step 1: Rename files**

```bash
mv agents/seeflow-discoverer.md agents/seeflow-discoverer.md
mv agents/seeflow-discoverer.smoke.md agents/seeflow-discoverer.smoke.md
mv agents/seeflow-node-planner.md agents/seeflow-node-planner.md
mv agents/seeflow-play-designer.md agents/seeflow-play-designer.md
mv agents/seeflow-status-designer.md agents/seeflow-status-designer.md
```

**Step 2: Update content in each file**

In every renamed agent file, do a global search-and-replace:
- `seeflow-discoverer` → `seeflow-discoverer`
- `seeflow-node-planner` → `seeflow-node-planner`
- `seeflow-play-designer` → `seeflow-play-designer`
- `seeflow-status-designer` → `seeflow-status-designer`
- `create-seeflow` → `create-seeflow`
- `SeeFlow` → `SeeFlow`
- `.seeflow/` → `.seeflow/`

**Step 3: Verify**

```bash
grep -rn "anydemo\|SeeFlow" agents/
```
Expected: no matches.

**Step 4: Commit**

```bash
git add agents/
git commit -m "rename: agent files and content anydemo→seeflow"
```

---

### Task 16: Rename skills/create-seeflow → skills/create-seeflow

**Files:**
- Rename directory: `skills/create-seeflow/` → `skills/create-seeflow/`
- Update all file content within

**Step 1: Rename directory**

```bash
mv skills/create-seeflow skills/create-seeflow
```

**Step 2: Update content in all files**

Run a global replace within the directory:
- `anydemo` → `seeflow`
- `SeeFlow` → `SeeFlow`
- `anyflow` → `seeflow`

Key files to check:
- `skills/create-seeflow/SKILL.md` — skill name, description, all references
- `skills/create-seeflow/scripts/*.ts` — all script files
- `skills/create-seeflow/vendored/schema.ts` — `.seeflow/` path strings
- `skills/create-seeflow/references/plan-format.md`
- `skills/create-seeflow/references/examples/checkout-flow-plan.md`

**Step 3: Verify**

```bash
grep -rn "anydemo\|SeeFlow\|anyflow" skills/create-seeflow/
```
Expected: no matches.

**Step 4: Commit**

```bash
git add skills/
git commit -m "rename: skills/create-seeflow → skills/create-seeflow with content updates"
```

---

### Task 17: .claude-plugin/plugin.json and .claude/settings.local.json

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude/settings.local.json`

**Step 1: Update plugin.json**

```json
{
  "name": "create-seeflow",
  "version": "0.1.0",
  "description": "Turn natural-language prompts into registered, validated SeeFlow flows. Ships one description-triggered skill (create-seeflow) that orchestrates four sub-agents and a small set of bun scripts.",
  "author": {
    "name": "SeeFlow"
  }
}
```

**Step 2: Update settings.local.json**

```bash
grep -n "anydemo\|anyflow\|SeeFlow" .claude/settings.local.json
```

Replace any occurrences found.

**Step 3: Commit**

```bash
git add .claude-plugin/plugin.json .claude/settings.local.json
git commit -m "rename: plugin.json and settings anydemo→seeflow"
```

---

### Task 18: CLAUDE.md and README files

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `apps/studio/README.md`

**Step 1: CLAUDE.md**

Replace:
- `# SeeFlow` → `# SeeFlow`
- `apps/studio/` — Bun + Hono backend + CLI (`anydemo`)` → `... CLI (\`seeflow\`)`
- All other `anydemo`/`SeeFlow` occurrences

**Step 2: README.md and apps/studio/README.md**

Do a global search-and-replace in both files:
- `SeeFlow` → `SeeFlow`
- `anydemo` → `seeflow`
- `anyflow` → `seeflow`
- `@tuongaz/anyflow` → `@tuongaz/seeflow`
- `tuongaz/anydemo` → `tuongaz/seeflow`
- `.seeflow/` → `.seeflow/`
- `create-seeflow` → `create-seeflow`

**Step 3: Verify**

```bash
grep -n "anydemo\|SeeFlow\|anyflow" CLAUDE.md README.md apps/studio/README.md
```
Expected: no matches.

**Step 4: Commit**

```bash
git add CLAUDE.md README.md apps/studio/README.md
git commit -m "rename: CLAUDE.md and READMEs anydemo→seeflow"
```

---

### Task 19: ralph/, docs/, and remaining files

**Files:**
- Modify: `ralph/prd.json`
- Modify: `ralph/CLAUDE.md`
- Modify: any docs/plans files with anydemo references
- Check remaining files

**Step 1: Find all remaining**

```bash
grep -rn "anydemo\|SeeFlow\|anyflow" . --include="*.json" --include="*.md" --include="*.ts" --include="*.tsx" --include="*.css" | grep -v node_modules | grep -v .git | grep -v dist
```

**Step 2: Fix each file** with search-and-replace as appropriate.

**Step 3: Verify — zero remaining matches**

```bash
grep -rn "anydemo\|SeeFlow\|anyflow" . --include="*.json" --include="*.md" --include="*.ts" --include="*.tsx" --include="*.css" | grep -v node_modules | grep -v .git | grep -v dist | grep -v "docs/plans/2026-05-15-rename-anydemo"
```
Expected: zero lines (aside from this plan file and the design doc which document the old name).

**Step 4: Commit**

```bash
git add .
git commit -m "rename: remaining anydemo references in ralph, docs, and misc files"
```

---

### Task 20: Update test files

**Files:**
- All `*.test.ts` and `*.test.tsx` files referencing `.seeflow/`

**Step 1: Find all test references**

```bash
grep -rn "anydemo\|\.anydemo" . --include="*.test.ts" --include="*.test.tsx" | grep -v node_modules | grep -v .git
```

**Step 2: Apply changes**

Replace `.seeflow/` with `.seeflow/` in all test path strings. Replace `anydemo` in string literals (e.g., `'anydemo-empty-state'` test id → `'seeflow-empty-state'`). Keep `anydemo` references only where they test that the OLD name is rejected (none expected).

**Step 3: Verify**

```bash
grep -rn "anydemo" . --include="*.test.ts" --include="*.test.tsx" | grep -v node_modules | grep -v .git
```
Expected: no matches.

**Step 4: Commit**

```bash
git add .
git commit -m "rename: test files .anydemo→.seeflow path strings"
```

---

### Task 21: Typecheck, lint, and final verification

**Step 1: Typecheck**

```bash
bun run typecheck
```
Expected: zero errors.

**Step 2: Format then lint**

```bash
bun run format && bun run lint
```
Expected: zero errors.

**Step 3: Run tests**

```bash
bun test
```
Expected: all pass.

**Step 4: Final grep check**

```bash
grep -rn "anydemo\|SeeFlow\|anyflow" . --include="*.json" --include="*.md" --include="*.ts" --include="*.tsx" --include="*.css" | grep -v node_modules | grep -v .git | grep -v dist | grep -v "docs/plans/2026-05-15-rename-anydemo"
```
Expected: zero lines.

**Step 5: Commit**

```bash
git add .
git commit -m "chore: post-rename typecheck and lint clean"
```
