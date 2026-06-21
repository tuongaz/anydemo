# Last-used style memory — design

**Status:** approved
**Date:** 2026-05-13

## Goal

When the user changes a style property on any node or connector, remember that
value and apply it to the next shape of the same family they create. Switching
from a blue rectangle to a fresh ellipse should produce a blue ellipse, not a
default-colored one. Drawing a dashed connector should make the next connector
dashed too.

## Scope

**In scope:** every visual property exposed by the style strip.

- Node bucket (shared across rect / ellipse / sticky / text / image / group /
  icon): `borderColor`, `backgroundColor`, `borderSize`, `borderWidth`,
  `borderStyle`, `fontSize`, `cornerRadius`, `color` (icon stroke),
  `strokeWidth` (icon).
- Connector bucket: `color`, `style`, `direction`, `borderSize`, `path`,
  `fontSize`.

**Out of scope:**

- `alt` (icon alt text) — content, not style.
- Connector `kind` — never mutated by the style strip.
- Cross-project isolation — memory is per-user, global across demos.
- Reset-to-factory UI.
- Server-side persistence or SSE sync.

## Decisions

1. **Storage:** `localStorage`, single key `anydemo:last-used-style:v1`. Per
   user, global across projects. Versioned key so a future schema change can
   ignore stale entries cleanly.
2. **Granularity:** two buckets — one shared across all node kinds, one for
   connectors. Switching between shape kinds (rect → ellipse) keeps the memory.
   Connectors stay isolated so a "dashed" connector style cannot leak into a
   rectangle's border style.
3. **Property set:** every style-strip field carries over (except `alt`).
   Properties irrelevant to a given kind are silently dropped at apply time —
   the kind-specific builder owns the filter.
4. **`borderSize` ↔ `borderWidth`:** treated as synonyms at the *write*
   boundary. When `rememberNodeStyle` sees either field, it mirrors the value
   to the other. The apply-side splat-and-filter stays dumb.
5. **Optimistic remember:** the bucket updates synchronously before the PATCH
   fires. A network failure does not roll back memory — "last used" tracks user
   intent, not server-confirmed state.
6. **Undo does not reverse memory.** Cmd+Z on a style change restores the
   canvas but leaves the bucket alone. Memory reflects "what you last picked,"
   not "what is currently on screen."
7. **Preview handlers do not remember.** Slider drags fire many preview
   patches; only the commit on pointer-release reaches the real style handler,
   which is the natural debounce point.

## Architecture

### New module — `apps/web/src/lib/last-used-style.ts`

```ts
type LastUsedStyle = {
  node: Partial<NodeStylePatch>;
  connector: Partial<ConnectorStylePatch>;
};

getLastUsedStyle(): LastUsedStyle;
rememberNodeStyle(patch: NodeStylePatch): void;
rememberConnectorStyle(patch: ConnectorStylePatch): void;
```

- Read on every create — no React state, no in-memory cache.
- Shallow merge on write — incremental builds up of a "current style."
- `alt` stripped inside `rememberNodeStyle` so the rule lives in one place.
- `borderSize` / `borderWidth` mirrored inside `rememberNodeStyle`.
- Corrupt JSON, missing `localStorage`, or write failures fall back silently
  to `{ node: {}, connector: {} }`.

### Remember side — three handlers

In `apps/web/src/pages/demo-view.tsx`, add one synchronous call before the
PATCH dispatches:

| Handler | Added line |
|---|---|
| `onStyleNode` (≈line 733) | `rememberNodeStyle(patch)` |
| `onStyleNodes` (≈line 776) | `rememberNodeStyle(patch)` |
| `onStyleConnector` (≈line 889) | `rememberConnectorStyle(patch)` |

Preview variants (`onStyleNodePreview`, `onStyleNodesPreview`,
`onStyleConnectorPreview`) are untouched.

### Apply side — builder signatures + call sites

`apps/web/src/lib/node-defaults.ts` builders gain an optional `lastUsed`
parameter:

```ts
buildNewShapeData(shape, dims, lastUsed?: Partial<NodeStylePatch>)
buildNewImageData(path, dims, lastUsed?: Partial<NodeStylePatch>)
buildNewGroupData(dims, lastUsed?: Partial<NodeStylePatch>)
```

Each builder filters `lastUsed` to the fields its kind accepts and merges
*after* the hardcoded factory defaults, so an empty bucket reproduces today's
behavior exactly.

| Kind | Consumed fields |
|---|---|
| rectangle / sticky | `borderColor`, `backgroundColor`, `borderSize`, `borderStyle`, `fontSize`, `cornerRadius` |
| ellipse | same minus `cornerRadius` |
| text | `fontSize` only — chromeless rule (US-003) preserved |
| image | `borderColor`, `borderWidth`, `borderStyle` |
| group | `borderColor`, `backgroundColor`, `borderWidth`, `borderStyle` |
| icon | `color`, `strokeWidth`, `fontSize` |

Call sites:

1. `onCreateShapeNode` (demo-view.tsx ≈1507) — pass `getLastUsedStyle().node`.
2. `onCreateAndConnectFromPane` (≈2130) — pass `lastUsed.node` to the builder;
   splat `lastUsed.connector` into the connector payload.
3. `onCreateConnector` (≈2068) — splat `lastUsed.connector` into the
   optimistic node and the payload, before `kind: 'default'`.
4. `image-upload-flow.ts:117` — pass `lastUsed.node`.
5. Group creation call site — pass `lastUsed.node`.

Spread order at every apply site: `{ ...factoryDefaults, ...lastUsedFiltered }`.

## Edge cases

- **First-time user / empty bucket:** builders splat nothing; today's behavior
  exactly. Existing `node-defaults.test.ts` cases keep passing unchanged.
- **Corrupt or unavailable `localStorage`:** silent fallback to empty buckets;
  writes also swallow errors. Best-effort.
- **Multi-property patch:** shallow merge handles `{ borderColor: 'blue',
  backgroundColor: 'red' }` field-by-field.
- **Pasted clones:** unaffected. `node-defaults.ts:5` already documents that
  paste preserves source data verbatim; last-used does not touch the paste
  path.
- **Connector `kind`:** never in `ConnectorStylePatch`, so fresh connectors
  stay `default` regardless of what the user has been drawing.

## Test plan

- **`last-used-style.test.ts` (new):**
  - read/write round-trip
  - `borderSize` ↔ `borderWidth` mirroring on write
  - `alt` stripped on write
  - corrupt/missing storage falls back to empty buckets
  - write failures do not throw
- **`node-defaults.test.ts` (extended):**
  - each kind's builder consumes only its accepted fields
  - factory defaults still win when `lastUsed` is empty
  - text builder still chromeless even when `lastUsed.borderSize` is set
  - ellipse drops `cornerRadius` even when `lastUsed.cornerRadius` is set
- **Integration (`demo-canvas.test.tsx` or a new test):**
  - change rectangle color → create ellipse → ellipse mounts with that color
  - change connector style to dashed → create connector → new connector dashed
  - change rectangle `borderSize` → create image → image's `borderWidth`
    matches (synonym mirroring works end-to-end)
