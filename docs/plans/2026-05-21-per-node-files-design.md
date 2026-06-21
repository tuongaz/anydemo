# Per-node files — externalize `detail`, `html`, and imageNode assets to `nodes/<id>/`

## Problem

Three node fields currently live in three different shapes on disk, none of them consistent with each other:

- `detail` (every node) — inline string on `flow.json`. No way to author it in a real editor; long descriptions bloat the JSON.
- `html` (`htmlNode.data.htmlPath`) — caller-supplied relative path under `.seeflow/`. Studio auto-creates `blocks/<id>.html` when no path is supplied (US-015) and cleans it up on delete only when the path matches the auto-managed shape (US-016). Two code paths, escape hatch for caller-supplied paths.
- `image` (`imageNode.data.path`) — caller-supplied relative path under `.seeflow/`. Uploads land in a flat `assets/` pool with `-2`/`-3` dedupe (`api.ts:612-670`). Deleting an imageNode leaves the asset orphaned.

The MCP `seeflow_add_node` tool accepts `detail` as an inline string only; there is no on-disk file for an author to edit. The htmlNode and imageNode pipelines each carry node-type-specific code in `operations.ts` (starter-file write, cascade-delete) that doesn't generalize.

## Goal

Adopt a single per-node folder convention — `<project>/.seeflow/nodes/<nodeId>/` — and three rules:

1. **Text content fields** (`detail`, `html`) are externalized automatically by the studio. The caller passes a string; the studio writes it to a file in the node folder and stores a `file://` reference in `flow.json`. The existing file-ref resolver inlines content on read.
2. **Binary assets** (imageNode uploads) land in the same per-node folder. The renderer keeps fetching via the file-serving endpoint.
3. **`delete_node` cascades** by removing the whole `nodes/<nodeId>/` folder — one call, one rule, no per-field special-casing.

Old flows are being removed in the same release, so no migration shim is required.

## Design

### Storage convention

| Field | On disk | In `flow.json` |
|---|---|---|
| `detail` | `<project>/.seeflow/nodes/<id>/detail.md` | `data.detail = "file://nodes/<id>/detail.md"` |
| `html` (htmlNode) | `<project>/.seeflow/nodes/<id>/view.html` | `data.html = "file://nodes/<id>/view.html"` |
| imageNode upload | `<project>/.seeflow/nodes/<id>/<filename>` | `data.path = "nodes/<id>/<filename>"` |

Node id is always `node-<10-char-base62>` (auto-generated). The `node-` prefix and the bounded charset of `shortId()` make path construction safe; no traversal guard needed beyond the existing schema validation.

### Generic mechanism: spec-driven externalized fields

New module `apps/studio/src/node-files.ts`:

```ts
export const EXTERNALIZED_NODE_FIELDS = [
  { field: 'detail', fileName: 'detail.md' },
  { field: 'html',   fileName: 'view.html' },
] as const;

export const nodeFileRelPath  = (nodeId: string, fileName: string) =>
  `nodes/${nodeId}/${fileName}`;
export const nodeFileRef      = (nodeId: string, fileName: string) =>
  `file://${nodeFileRelPath(nodeId, fileName)}`;
export const nodeFileAbsPath  = (repoPath: string, nodeId: string, fileName: string) =>
  join(repoPath, '.seeflow', nodeFileRelPath(nodeId, fileName));

export function writeNodeFile(absPath: string, content: string): void { /* mkdir + atomic write */ }
export function removeNodeDir(repoPath: string, nodeId: string): void  { /* rm -rf, swallows ENOENT */ }
```

Adding a future text-content field is one line: append a spec entry. Lifecycle code never changes.

### Lifecycle

**`addNodeImpl`** (`operations.ts:884`)

Loop over `EXTERNALIZED_NODE_FIELDS`. For each entry:
1. Capture inbound value at `newNode.data[field]` (may be undefined / empty / non-empty).
2. Overwrite `newNode.data[field] = nodeFileRef(newId, fileName)` so `flow.json` always carries the file:// ref (invariant: every node has every spec file).
3. Queue a starter-file write of the captured content (empty string when undefined).

Inside the existing mutator, after `flow.nodes.push(newNode)`, flush all queued writes — same place htmlNode's starter write happens today (`operations.ts:940-947`). `writeFailed` propagates the same way.

The bespoke htmlNode starter-file block (`operations.ts:907-928`) is deleted; the generic loop covers it.

**`patchNodeImpl`** (`operations.ts:~1056`)

Pre-process the patch body. For each entry in the spec where `updates[field] !== undefined`:
- Pull the value out of the normal merge path.
- Write its content to `nodeFileAbsPath(...)` (empty string = empty file; do not delete the file).
- Ensure the raw node's `data[field]` stays `nodeFileRef(...)`.

Non-spec keys pass through `mergeNodeUpdates` untouched.

**Behavior change for `patchNodeImpl`**: today, `detail: ''` deletes the key from `data` (`operations.ts:161`). Under the new mechanism, the file is the invariant — an empty string means "empty file content, keep the file://ref". The clear-on-empty-string rule remains for non-externalized text fields (`description`).

**`deleteNodeImpl`** (`operations.ts:976`)

After the flow.json write succeeds, call `removeNodeDir(repoPath, nodeId)`. One call cascades detail.md, view.html, the imageNode asset, and any future spec entry. The htmlNode-specific `blocks/<id>.html` cleanup (US-016) is deleted.

### Schema changes (`apps/studio/src/schema.ts`)

- `HtmlNodeDataSchema.htmlPath` → `HtmlNodeDataSchema.html` (`z.string().optional()`). Drop the `isCleanRelativePath` refine — the field now carries content (or a file:// ref) rather than a path.
- `ImageNodeDataSchema.path` keeps its `isCleanRelativePath` refine but gains a cross-field constraint: at the `ResolvedFlowSchema` level (`.superRefine`), every imageNode's `data.path` must start with `nodes/${node.id}/`. This is the invariant that lets `removeNodeDir` promise full cleanup.
- `detail` stays `z.string().optional()` — no change required; the file:// ref passes the schema unchanged.

### Merge routing (`apps/studio/src/merge.ts`)

`NODE_DATA_FLOW_KEYS` (line 42) gains `'html'` and loses `'htmlPath'`. Everything else is unchanged.

### Watcher

No code change. The existing `resolveFileRefs` (`watcher.ts:197`) already inlines `file://` refs and tracks them for live reload — editing `detail.md` or `view.html` on disk broadcasts a `flow:reload` automatically.

### imageNode upload endpoint (`apps/studio/src/api.ts`)

New: `POST /api/projects/:id/nodes/:nodeId/files/upload`
- Same multipart shape as today's `/files/upload`.
- Writes to `<repoPath>/.seeflow/nodes/<nodeId>/<sanitized>` with the existing `-2`/`-3` dedupe inside the node folder.
- Returns `{ path: "nodes/<nodeId>/<filename>" }`.
- Same allowlist + 5 MB cap as today.

The old `POST /api/projects/:id/files/upload` is removed — the frontend drag-and-drop flow already creates the node first (knows the id), then uploads.

### Frontend changes (`apps/web/src/`)

- `pages/demo-view.tsx:1522-1574` — the "carry `htmlPath` out-of-band, supply-your-own-path wins" optimistic-update dance for htmlNode creation collapses. Just POST the node; studio owns the file. The optimistic updater no longer needs to fabricate `htmlPath`.
- `hooks/use-export-to-cloud.ts:29-31` — switch from inspecting `data.htmlPath` to walking file:// refs (already tracked by the watcher) plus imageNode `data.path` values, deduped.
- The htmlNode renderer (dynamically loaded; not under `apps/web/src/components/`) now consumes `data.html` as resolved HTML content directly. Same sanitization step before injection. No file-serving fetch.
- The imageNode renderer keeps fetching via `/api/projects/:id/files/<data.path>` — only the path shape changes.

### Render path tradeoff (decided: inline)

Inlining `view.html` via the file:// resolver means every flow snapshot and SSE `flow:reload` carries every htmlNode's full HTML. Typical authored blocks are well under 10 KB; payload bloat is bounded in practice. If a future demo authors a 1 MB block and the SSE traffic becomes a problem, add a soft size cap to `writeNodeFile` for spec entries and surface a 4xx on add/patch. Not in scope now.

Image binaries are NOT inlined — `data.path` stays a path, renderer fetches lazily.

## Failure modes

| Condition | Outcome |
|---|---|
| add_node with detail content + write fails | `kind: 'writeFailed'`; flow.json not written (mutator returned non-`ok`) |
| patch_node setting detail + file write fails | same — pre-process throws into the mutator's outcome path |
| delete_node + removeNodeDir fails (e.g., file in use) | Logged, swallowed. flow.json is already written; orphan folder is acceptable (next add_node with the same id is impossible — ids are random) |
| imageNode `data.path` doesn't start with `nodes/<id>/` | `ResolvedFlowSchema` rejects with a `badSchema` issue at the final parse |
| Caller passes a `file://` value directly as `detail` to add_node | Treated as content (the literal string `"file://..."` gets written to detail.md). Pre-existing risk; not worth special-casing |

## Tests

- `node-files.test.ts` (new) — unit tests for path helpers, `writeNodeFile` (mkdir + atomic), `removeNodeDir` (idempotent, swallows ENOENT).
- `operations.test.ts` — extend `add_node` / `patch_node` / `delete_node` cases:
  - add_node with detail → flow.json has file:// ref; detail.md exists with content
  - add_node without detail → file exists, empty
  - add_node creates an htmlNode with `html` content → view.html exists with content
  - patch_node setting detail → detail.md updated, file:// ref unchanged
  - patch_node with `detail: ''` → file emptied, file:// ref unchanged (NEW behavior — was delete-key)
  - patch_node on an unrelated field → file:// ref survives the round-trip
  - delete_node → entire `nodes/<id>/` folder removed
- `mcp.test.ts`, `mcp-parity.test.ts` — same scenarios via the MCP envelope.
- `schema.test.ts` — `superRefine` rejects imageNode whose path doesn't start with `nodes/<id>/`.
- `api.test.ts` — new `/nodes/:nodeId/files/upload` endpoint: success, allowlist rejection, size cap, dedupe within the node folder.
- Frontend tests — update `use-export-to-cloud.test.ts` fixtures (`apps/web/src/hooks/use-export-to-cloud.test.ts:165`) and any htmlNode rendering test that mocks `htmlPath`.

## What this deletes

- `operations.ts:907-928` — htmlNode starter-file branch in `addNodeImpl`.
- `operations.ts` — htmlNode-specific `blocks/<id>.html` cleanup branch in `deleteNodeImpl` (US-016 logic).
- `demo-view.tsx:1522-1574` — out-of-band `htmlPath` plumbing in the optimistic update.
- `POST /api/projects/:id/files/upload` — replaced by the per-node variant.
- `assets/` convention for imageNode (still useful for unrelated future shared assets if needed; not in scope).

## Out of scope

- Migration of existing inline-`detail` strings on already-stored flows (all old flows are being removed).
- A shared-assets convention for an image reused across multiple imageNodes.
- A dedicated `seeflow_get_detail` / detail-only MCP tool.
- Soft size cap on externalized content.
- Allowing callers to override the per-node file path.
