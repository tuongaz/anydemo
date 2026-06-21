# Flat node types: visual is the type, capabilities are fields

## Problem

Today the schema mixes two unrelated axes under one `type` field:

```ts
type: 'playNode' | 'stateNode' | 'shapeNode' | 'imageNode' | 'htmlNode' | 'iconNode'
```

- `playNode` / `stateNode` describe **behavior** (the node runs a script, observes status).
- `shapeNode` / `imageNode` / `htmlNode` / `iconNode` describe **visual representation**.

These axes are independent in the author's mental model — a database cylinder should be able to be Stateful; a sticky note should be able to be Playable — but the current schema makes them mutually exclusive. Worse, geometric variants live two levels deep (`type:'shapeNode', data.shape:'database'`) while `image` lives one level deep (`type:'imageNode'`), an asymmetry with no underlying reason.

## Decision

Flatten to a single discriminator. **Visual kind is the type. Capabilities are independent optional fields.**

```ts
type:
  | 'rectangle' | 'ellipse' | 'sticky' | 'text'        // plain geometric
  | 'database' | 'server' | 'user' | 'queue' | 'cloud' // illustrative
  | 'image' | 'html' | 'icon'                          // media / glyph
```

A node is *Playable* iff `data.playAction` is set. *Stateful* iff `data.statusAction` is set. *Both* iff both. *Normal* iff neither. All four configurations are valid on every visual.

## Schema

### Shared base — every node has these

```ts
const NodeCommonShape = {
  name: z.string().optional(),
  description: z.string().optional(),
  detail: z.string().optional(),
  // visual base
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  borderColor: ColorTokenSchema.optional(),
  backgroundColor: ColorTokenSchema.optional(),
  borderSize: z.number().positive().optional(),
  borderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
  fontSize: z.number().positive().optional(),
  textColor: ColorTokenSchema.optional(),
  cornerRadius: z.number().min(0).optional(),
  // Decorative header glyph (Lucide icon name). Optional everywhere.
  // For `type:'icon'`, the IconNodeData schema overrides this to required
  // — that node uses the field as its main visual rather than decoration.
  icon: z.string().optional(),
};
```

### Capabilities — any combo, all optional

```ts
const NodeCapabilitiesShape = {
  playAction: PlayActionSchema.optional(),
  statusAction: StatusActionSchema.optional(),
  stateSource: StateSourceSchema.optional(),
};
```

`stateSource` was required on the old `playNode`/`stateNode`. In the flat model it becomes purely informational metadata — optional, meaningful only when `statusAction` is set.

### Per-type data

```ts
// All nine geometric/illustrative shapes share the same data schema.
// The only thing that varies between rectangle/ellipse/.../cloud is
// the renderer the canvas picks — schema-side they're identical.
const GeometricNodeData = z.object({
  ...NodeCommonShape,
  ...NodeCapabilitiesShape,
});

const ImageNodeData = z.object({
  ...NodeCommonShape,
  ...NodeCapabilitiesShape,
  path: z.string().min(1).refine(isCleanRelativePath, { ... }),
  alt: z.string().optional(),
  borderWidth: z.number().min(1).max(8).optional(),
});

const HtmlNodeData = z.object({
  ...NodeCommonShape,
  ...NodeCapabilitiesShape,
  html: z.string().optional(),
  autoSize: z.boolean().optional(),
});

const IconNodeData = z.object({
  ...NodeCommonShape.omit({ icon: true }),
  ...NodeCapabilitiesShape,
  icon: z.string().min(1),                           // required override
  color: ColorTokenSchema.optional(),
  strokeWidth: z.number().min(0.5).max(4).optional(),
});
```

### Discriminated union

```ts
const makeGeometricSchema = (type: string) => z.object({
  ...NodeBaseShape,
  type: z.literal(type),
  data: GeometricNodeData,
});

const NodeSchema = z.discriminatedUnion('type', [
  makeGeometricSchema('rectangle'),
  makeGeometricSchema('ellipse'),
  makeGeometricSchema('sticky'),
  makeGeometricSchema('text'),
  makeGeometricSchema('database'),
  makeGeometricSchema('server'),
  makeGeometricSchema('user'),
  makeGeometricSchema('queue'),
  makeGeometricSchema('cloud'),
  z.object({ ...NodeBaseShape, type: z.literal('image'), data: ImageNodeData }),
  z.object({ ...NodeBaseShape, type: z.literal('html'),  data: HtmlNodeData }),
  z.object({ ...NodeBaseShape, type: z.literal('icon'),  data: IconNodeData }),
]);
```

The existing `imageNode` cross-field refinement (path must start with `nodes/<id>/`) carries over verbatim against `type:'image'`.

## Renderer phasing

Capabilities are first-class in the schema and MCP from v1. Authors can set `playAction` on a `database`, the studio persists it, `seeflow_get_node` returns it. What the canvas *draws* is phased.

| `type` | v1 visual | v1 capability chrome |
|---|---|---|
| `rectangle` | Today's playNode card: header (name + optional icon) + description + body | **Full parity with today's playNode** — play button, running indicator, status pill from `statusAction`. `playAction` and `statusAction` both wired. |
| `ellipse`, `sticky`, `text`, `database`, `server`, `user`, `queue`, `cloud` | Today's shapeNode visuals, unchanged | Parsed + persisted, **no chrome drawn** |
| `image`, `html`, `icon` | Today's visuals, unchanged | Parsed + persisted, **no chrome drawn** |

Out of scope here: where the play button / status pill sit on a cylinder, an image, or an unboxed icon glyph. That's a downstream design exercise once v1 ships.

## No backwards compatibility

This is a brand-new project — no users with persisted flow.json files in the wild. The refactor rewrites the schema, the renderer set, the MCP tool definitions, and every test fixture / demo flow in a single commit. No migration command, no version bridge, no parallel parsers.

`version` in the schema: reset to `1` (or keep `2` — value doesn't matter; nothing else reads it).

## Files to change

### Schema and types
- `apps/studio/src/schema.ts` — replace all six per-type schemas with the flat 12-arm union and the two shared shapes above
- `packages/canvas/src/types.ts` — TS interfaces follow schema; `NodeData` becomes a discriminated union keyed on `type`; remove the `playNode` / `stateNode` / `shapeNode` interface trio

### Renderers
- `packages/canvas/src/nodes/play-node.tsx`, `state-node.tsx`, `shape-node.tsx` — collapse into a per-type renderer set under `packages/canvas/src/nodes/`. Suggested layout:
  - `rectangle-node.tsx` (carries today's playNode + statusAction behavior)
  - `geometric-node.tsx` (one component, shared by ellipse / sticky / text / database / server / user / queue / cloud — picks the SVG variant by `type`)
  - `image-node.tsx`, `html-node.tsx`, `icon-node.tsx` (renamed / kept; ignore capabilities for now)
- React Flow `nodeTypes` map gets 12 entries (some pointing at the shared `geometric-node.tsx`)

### Studio adapter
- `apps/studio/src/merge.ts` (and tests) — `mergeNodeUpdates` dispatches on the new type set. Most arms share a geometric merger.
- `packages/canvas/src/adapter/rest.ts`, `rest.test.ts` — type imports follow new schema

### MCP
- MCP tool definitions (`seeflow_add_node`, `seeflow_patch_node`, `seeflow_schema`) — enum updates flow automatically from Zod if generated; verify and update any hand-rolled type tags

### Watcher
- `apps/studio/src/watcher.ts` — references to old type names

### Tests + fixtures
- `apps/studio/integration/*.it.ts` — fixtures rewritten to flat shape
- `apps/studio/e2e/canvas.e2e.ts` + `apps/studio/e2e/support/studio-fixture.ts` — same
- `packages/canvas/src/nodes/*.test.tsx`, `packages/canvas/src/components/*.test.tsx` — renderer tests updated to the new component layout
- E2E visual baselines under `apps/studio/e2e/__screenshots__/` — regenerate **chromium-linux only** via `bun run test:it:update-snapshots`, per `CLAUDE.md`

### Plugin / skills
- `skills/`, `commands/` — any prompt fragments mentioning the old type tags get updated (search for `playNode`, `stateNode`, `shapeNode` in those files)

## Testing strategy

1. Schema unit tests (`apps/studio/src/schema.test.ts` if present, else new): every type tag parses; cross-type unions reject invalid combos (`type:'image'` without `path`, `type:'icon'` without `icon`).
2. Renderer unit tests: rectangle with `playAction` draws play button; rectangle with `statusAction` shows status pill; non-rectangle shapes with capabilities draw **no** capability chrome (snapshot guards against accidental rendering).
3. Merge tests: `mergeNodeUpdates` dispatches correctly; updating `playAction` on a database persists but doesn't surface chrome.
4. Integration tests: round-trip create → patch → delete for one node of each of the 12 types.
5. E2E: canvas screenshots match new baselines on chromium-linux.

## Out of scope

- Capability chrome design for non-rectangle shapes (where the button / pill sit on a cylinder, image, sticky, glyph).
- Toolbar UX for the expanded shape set — assumed to follow today's draw-mode pattern.
- New shape kinds beyond today's nine (anything cloud-shaped, cards, multi-tier servers, etc.).
- Capability composition beyond `play` + `status` (e.g., a future "Observable" or "Configurable" capability).
