# Flat node types — WIP handoff

Companion to `2026-05-23-flat-node-types-design.md`. The design lands in a
single big-bang commit per the plan; this doc tracks how much of that commit
already exists in the worktree and what remains.

## What's in the worktree

Modified / added — the schema + canvas-type foundation and the renderer
consolidation:

- `apps/studio/src/schema.ts` (rewritten)
- `packages/canvas/src/types.ts` (rewritten)
- `packages/canvas/src/nodes/rectangle-node.tsx` (new — carries today's
  PlayNode chrome; tolerant of optional `name` / absent `playAction`)
- `packages/canvas/src/nodes/geometric-node.tsx` (new — reads shape from
  `props.type`, handles all 9 geometric variants; nodeTypes map will route
  `rectangle` → `RectangleNode` so the rectangle branch here stays inert in
  practice but compiles)
- `packages/canvas/src/nodes/{image,html,icon}-node.tsx` (type literal
  updates: `imageNode` → `image`, `htmlNode` → `html`, `iconNode` → `icon`,
  plus the matching `data-node-type` attributes)
- `packages/canvas/src/nodes/index.ts` (barrel rewritten)

Deleted:

- `packages/canvas/src/nodes/play-node.tsx` + test
- `packages/canvas/src/nodes/state-node.tsx` + test
- `packages/canvas/src/nodes/shape-node.tsx` + test

## What's NOT in the worktree (and why typecheck currently fails)

The schema/types change cascades into every file that names the old type
tags or imports the removed exports (`HttpAction`, `NodeData`, `ShapeKind`,
`ShapeNodeData`). Roughly ~65 files still need updates. Grouped by layer:

### Canvas package (`packages/canvas/src/`)

- `index.ts` — drop the four removed exports
- `lib/keyboard-shortcuts.ts` — replace `ShapeKind` with `GeometricNodeType`
- `lib/node-defaults.ts` — same
- `adapter/types.ts` — replace `ShapeKind` references
- `adapter/rest.test.ts` — old type tags in fixtures
- `components/seeflow-canvas.tsx` (~2600 lines) — nodeTypes map composition;
  every `type === 'playNode'` / `'stateNode'` / `'shapeNode'` / `'imageNode'`
  / `'iconNode'` / `'htmlNode'` branch; references to deleted renderers
- `components/seeflow-canvas.test.tsx` — fixture rewrites
- `components/detail-panel.tsx` — per-type rendering switch
- `components/detail-panel.test.tsx`
- `components/canvas-toolbar.tsx` — drawable shape buttons
- `components/canvas-toolbar.test.tsx`
- `components/style-strip.tsx` + test — per-type field controls
- Other component / lib files surfaced by `bun run typecheck`

### Studio (`apps/studio/src/`)

- `operations.ts` (~1700 lines): `NodeTypeSchema` enum, `NodePatchBodySchema`
  (drop `shape` field), `SEMANTIC_KEYS_BY_TYPE` (rewrite for 12 types — every
  geometric type takes the same set), `mergeNodeUpdates` invariants (rename
  the `htmlNode`-only invariant to `type === 'html'`), `ALLOWED_PATCH_FIELDS_BY_TYPE`
- `merge.ts`: drop `shape` from `NODE_DATA_FLOW_KEYS` (type IS shape now);
  `stateSource` / `playAction` / `statusAction` already in the set
- `mcp.ts`: tool descriptions referencing `shapeNode` / `imageNode` /
  `iconNode` / `htmlNode` / `stateNode` / `playNode`
- `schema-catalog.ts`: import + expose the new flat per-type schemas
- `watcher.ts`: comments + branch on `imageNode` / `htmlNode` → `image` / `html`
- `api.ts`: any node-type discrimination
- `demo.ts`: seed fixtures rewritten to flat shape
- `cli-manifest.ts`: example payloads in docstrings
- Every `*.test.ts` for the files above

### Integration + e2e tests (`apps/studio/integration/`, `apps/studio/e2e/`)

- `integration/cli.it.ts`, `integration/mcp.it.ts`, `integration/fixtures.it.ts`,
  `integration/edges.it.ts`, `integration/cli-in-process.it.ts`,
  `integration/rest.it.ts`
- `integration/fixtures/` — any seed flow.json files
- `e2e/canvas.e2e.ts` + `e2e/support/studio-fixture.ts`
- `e2e/canvas.e2e.ts-snapshots/` — regenerate via
  `bun run test:it:update-snapshots` on Linux (or Docker on Darwin per
  `CLAUDE.md`). Commit ONLY `*-chromium-linux.png` files.

### Apps/web (`apps/web/src/`)

- `App.tsx` — `nodeTypes` map with the 12 new entries (rectangle →
  RectangleNode, the 8 other geometric tags → GeometricNode, image/html/icon
  → existing renderers)
- `lib/api.ts`, `lib/image-upload-flow.ts` + test
- `hooks/use-export-to-cloud.ts` + test
- `pages/demo-view.tsx`

### Plugin (`skills/`, `commands/`)

- Search for `playNode`, `stateNode`, `shapeNode`, `imageNode`, `iconNode`,
  `htmlNode` in prompt fragments and update to the new flat type tags. The
  agent payload examples in particular need rewrites.

## Verification checklist for the follow-up PR

After the source edits land:

1. `bun run typecheck` (clean across workspaces)
2. `bun run format && bun run lint`
3. `bun test` (unit) — expect heavy fixture rewrites
4. `bun run test:it` (integration + e2e, routes through Docker on Darwin)
5. `bun run test:it:update-snapshots` to regenerate chromium-linux baselines

## Design decisions worth noting

- **Flow vs ResolvedFlow.** The plan only sketched the resolved-flow union.
  The Flow (on-disk strict) union is flattened symmetrically — same 12 arms,
  visuals stripped (those route to `style.json` via `merge.ts`).
- **Style schema unchanged.** Every field in `NodeStyleSchema` was already
  optional and visual-only; the per-type comments now read "type:'image'-
  specific" etc.
- **`stateSource` is informational.** Moved into `NodeCapabilitiesShape`
  alongside `playAction` / `statusAction`. Optional everywhere. Meaningful
  only when `statusAction` is set.
- **`handlerModule`** kept on capabilities (schema-only at v1).
- **Drawable types.** `CanvasMode.draw.shape` is `GeometricNodeType` (the
  9 geometric tags). `image` / `html` / `icon` are not click-drawable —
  they need upload / dedicated authoring flows.
- **Rectangle keeps PlayNode visuals.** Per the phasing table. State-node
  visuals collapsed into rectangle since both shared the header+body+status
  card shape.
- **GeometricNode keeps rectangle in its dispatch table.** Dead in practice
  (the `nodeTypes` map sends rectangle to `RectangleNode`) but kept so the
  shared `shapeChromeStyle` / `shapeChromeClass` helpers cover all 9 types
  for consumers like the drag-create ghost.
