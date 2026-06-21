# Handoff: lock down canvas ↔ schema drift

**Date:** 2026-05-25
**Status:** Ready to execute in a fresh session
**Background:** `seeflow schema` already auto-derives from `apps/studio/src/schema.ts` via `zod-to-json-schema`. The real drift is upstream — between `packages/canvas/src/types.ts` (what the renderer accepts) and the Zod schema (what disk allows). `stateSource` was the smoking gun: present in canvas, present in Zod, but with zero description metadata, so the AI never set it.

This handoff has two phases. Do **Phase 1** soon (cheap safety net). Schedule **Phase 2** when you have a quiet half-day (real fix).

---

## Phase 1 — Drift detection tests (~1 hour)

**Goal:** Make CI fail loudly when canvas gains a field that the disk Zod schema doesn't mirror, *or* when a Zod property lacks a description.

### Files to touch

1. **`packages/canvas/src/types.ts`** — export a `CANVAS_NODE_DATA_FIELDS` const enumerating every field on the canvas-side node data shape (e.g. `GeometricNodeData`). Use `as const` so TypeScript catches drift between the type and the const at compile time:

   ```ts
   export const CANVAS_NODE_DATA_FIELDS = {
     // semantic
     name: true, description: true, detail: true, icon: true,
     // visual
     width: true, height: true, borderColor: true, backgroundColor: true,
     borderSize: true, borderStyle: true, fontSize: true, textColor: true,
     cornerRadius: true, shadow: true,
     // capabilities
     playAction: true, statusAction: true, stateSource: true, handlerModule: true,
   } as const satisfies Record<keyof GeometricNodeData, true>;
   ```

   The `satisfies` clause is load-bearing — adding a field to `GeometricNodeData` without updating the const fails `bun run typecheck`.

2. **`apps/studio/src/schema.test.ts`** — add a "canvas parity" test:

   ```ts
   import { CANVAS_NODE_DATA_FIELDS } from '@seeflow/canvas/types';
   import { FlowRectangleNodeSchema } from './schema.ts';

   const STRIPPED_VISUAL_FIELDS = new Set([
     'width', 'height', 'borderColor', 'backgroundColor',
     'borderSize', 'borderStyle', 'fontSize', 'textColor',
     'cornerRadius', 'shadow',
   ]);

   it('every canvas field is either persisted to disk or explicitly stripped', () => {
     const diskFields = new Set(
       Object.keys(FlowRectangleNodeSchema.shape.data.shape),
     );
     for (const field of Object.keys(CANVAS_NODE_DATA_FIELDS)) {
       const persisted = diskFields.has(field);
       const stripped = STRIPPED_VISUAL_FIELDS.has(field);
       expect(
         persisted || stripped,
         `Canvas field '${field}' is neither in disk schema nor in STRIPPED_VISUAL_FIELDS. Add it to schema.ts or to the whitelist.`,
       ).toBe(true);
     }
   });
   ```

3. **`apps/studio/src/schema-catalog.test.ts`** — add a description-discipline test that walks every emitted node variant and asserts every top-level `data.*` property carries a non-empty `description`. Allow a small opt-out set for fields where description is genuinely redundant (e.g. `id`, `type`).

### Verification

- `bun run typecheck` — green
- `bun test apps/studio/src/schema.test.ts` — green
- `bun test apps/studio/src/schema-catalog.test.ts` — green
- Deliberately delete `stateSource` from `NodeCapabilitiesShape` to confirm the parity test fails with a clear message; restore it.

### Don't

- Don't enforce description on `id`, `type`, `position` — those are mechanical, not AI-facing semantics.
- Don't run codegen here. Phase 1 is detection only.

---

## Phase 2 — Extract `@seeflow/schemas` package (~4–6 hours)

**Goal:** Collapse to a single source of truth. The schema package owns the domain model; canvas imports types only; studio imports the full Zod.

### Plan

1. **Create the package** at `packages/schemas/` with `package.json`, `tsconfig.json`, `tsup.config.ts` matching `packages/canvas/`. Name it `@seeflow/schemas`. Add it to the workspace.

2. **Move `apps/studio/src/schema.ts` → `packages/schemas/src/index.ts`.** Keep the Zod schemas and inferred types as the master. Add `.describe()` blocks for every field the AI needs to understand.

3. **Define resolved vs disk as projections**, side by side, not as parallel schemas:

   ```ts
   const ResolvedGeometricNodeDataSchema = z.object({ ...visual, ...semantic, ...capabilities });
   const FlowGeometricNodeDataSchema = ResolvedGeometricNodeDataSchema.omit({
     width: true, height: true, borderColor: true, /* ...visual fields */
   });
   ```

   `Omit`/`Pick` make the relationship visible and reviewable.

4. **Rewrite `packages/canvas/src/types.ts`** to derive from the schema package:

   ```ts
   import type { ResolvedGeometricNodeData } from '@seeflow/schemas';
   export type GeometricNodeData = ResolvedGeometricNodeData;
   ```

   Use `import type` — at compile time the import erases and Zod never enters the canvas bundle.

5. **Rewrite `apps/studio/src/schema.ts`** to re-export from `@seeflow/schemas` (preserve the existing import path so consumers don't all change at once).

6. **Update `apps/studio/src/schema-catalog.ts`** imports to point at `@seeflow/schemas` directly.

7. **Delete `CANVAS_NODE_DATA_FIELDS` and `STRIPPED_VISUAL_FIELDS`** from Phase 1 — no longer needed; the projection is now the single source. Keep the description-discipline test.

### Verification

- `bun run typecheck` across all workspaces — green
- `bun run lint` — green
- `bun test` — green
- `bun run build` produces a canvas bundle of comparable size to today (the type-only import should add zero bytes — check with `bundle-analyzer` if you want to be sure)
- `bun run --cwd apps/studio seeflow schema node` still emits the same shape as before the refactor (run before+after, diff the JSON)

### Don't

- Don't move `schemaCatalog` into the schemas package — it's the *projection for AI consumers*, which is studio's concern. Leave it in `apps/studio/src/`.
- Don't try to put `zod-to-json-schema` in the canvas bundle path. Canvas only imports `type`-level.
- Don't merge canvas's `types.ts` into the schemas package wholesale — there are canvas-runtime-only types (`SeeflowCanvasProps`, `CanvasFeatureOverrides`, `StatusBadgeColor`) that have no business in the persistence schema. Only move the *data model* (node data, edge data, action shapes).

### Migration order (suggested)

1. Create empty `@seeflow/schemas` package, get it building and importable.
2. Move *one* schema (`StateSourceSchema` + its variants) as the proof of concept. Update one canvas type to derive. Run all tests.
3. Move the rest in batches: actions → node data → connectors → flow envelope.
4. Delete the old definitions from `apps/studio/src/schema.ts` last, replacing with re-exports.

### Backout

Each batch should be a separate commit so you can `git revert` if something breaks downstream. Don't squash until the whole migration is green.

---

## What this buys you

- Adding a new field to the canvas's data model **is** adding it to the persistence schema, the AI-facing JSON Schema, and the CLI output — all in one edit, with the description forced inline.
- No more `stateSource`-style stealth fields where the canvas understands something the AI can't see.
- Future MCP/API consumers (anyone who needs the schema) import from one place.

## What this doesn't fix

- Cross-field invariants (e.g. "stateSource SHOULD be set when statusAction is") still live in the `notes` array in `schema-catalog.ts`. That's the right place for them — Zod's type system can't express SHOULD.
- Component spec sidecar (`spec.json`) still lives outside `flow.json`. That's a deliberate decoupling, not drift.

---

## TL;DR for the fresh session

> Do Phase 1 first: export `CANVAS_NODE_DATA_FIELDS` from `packages/canvas/src/types.ts`, add a parity test in `apps/studio/src/schema.test.ts` that asserts every canvas field is either in the disk Zod schema or in an explicit visual-strip whitelist, and add a description-discipline test in `apps/studio/src/schema-catalog.test.ts`. Land that as one commit.
>
> Then schedule Phase 2: create a `packages/schemas/` package, move the Zod schemas into it, model resolved/disk as `omit`/`pick` projections, and rewrite canvas `types.ts` to derive via `import type { ... } from '@seeflow/schemas'`. Migrate in small batches, one commit per batch.
