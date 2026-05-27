import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from './atomic-write.ts';

// Spec for fields that the studio externalizes to disk under
// `<repoPath>/<flowDir>/nodes/<id>/<fileName>`, where `flowDir` is
// `dirname(entry.flowPath)`. For manifest-driven projects this resolves to
// `flows/<flow-id>/nodes/<id>/`; for legacy single-flow fixtures with
// `flowPath: 'flow.json'` it collapses to the project root. `nodeTypes` (when
// present) scopes the spec entry to specific node types; absent means
// "applies to every node type".
//
// Two flavors of externalization:
// - `kind: 'ref'` (default) — write the file, replace `data[field]` with
//   `file://<fileName>`. The ref survives splitFlow (the field is in
//   NODE_DATA_FLOW_KEYS in merge.ts). Used by string fields like `detail`
//   and `html`.
// - `kind: 'sidecar'` — write the file, leave `data[field]` untouched on
//   the in-memory node so the post-mutation parse still sees the original
//   value. splitFlow drops the field from flow.json on write; the resolver
//   inlines it from disk on read. Used by JSON fields like component `spec`.
//
// `serialize` turns the in-memory value into file contents. Returning `null`
// skips the write entirely — used by `spec` to no-op when the caller didn't
// supply one, instead of writing an empty file that would fail JSON parse
// on the next read.
export interface ExternalizedFieldSpec {
  field: string;
  fileName: string;
  nodeTypes?: readonly string[];
  kind?: 'ref' | 'sidecar';
  serialize?: (value: unknown) => string | null;
}

// Default serializer: strings pass through; non-strings coerce to empty.
// Keeps the historical detail/html behavior — an absent detail still writes
// an empty detail.md so the file:// ref points somewhere.
export const defaultExternalizedSerializer = (value: unknown): string =>
  typeof value === 'string' ? value : '';

// JSON serializer for sidecar fields: pretty-print plain objects with a
// trailing newline. Returns null for anything else so the loop can skip the
// write rather than emit an invalid sidecar.
const jsonExternalizedSerializer = (value: unknown): string | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? `${JSON.stringify(value, null, 2)}\n`
    : null;

export const EXTERNALIZED_NODE_FIELDS: readonly ExternalizedFieldSpec[] = [
  { field: 'detail', fileName: 'detail.md' },
  { field: 'html', fileName: 'view.html', nodeTypes: ['html'] },
  {
    field: 'spec',
    fileName: 'spec.json',
    nodeTypes: ['component'],
    kind: 'sidecar',
    serialize: jsonExternalizedSerializer,
  },
];

export const externalizedFieldsForNodeType = (
  nodeType: unknown,
): readonly ExternalizedFieldSpec[] => {
  if (typeof nodeType !== 'string') return EXTERNALIZED_NODE_FIELDS.filter((e) => !e.nodeTypes);
  return EXTERNALIZED_NODE_FIELDS.filter((e) => !e.nodeTypes || e.nodeTypes.includes(nodeType));
};

export type ExternalizedFieldName = (typeof EXTERNALIZED_NODE_FIELDS)[number]['field'];

// Flow-relative on-disk path under the flow folder. Returned with forward
// slashes so it round-trips through HTTP responses (the upload route ships
// this back as the `path` field, and the watcher's image-ref resolver treats
// it as relative to the flow folder).
export const nodeFileRelPath = (nodeId: string, fileName: string): string =>
  `nodes/${nodeId}/${fileName}`;

// Node-relative ref: the resolver knows the enclosing node id from the flow.json
// shape (nodes[i].id), so the on-disk string only needs the filename. Kept as a
// 2-arg helper so call sites don't change shape and the spec stays explicit
// that the file lives under the given node.
export const nodeFileRef = (_nodeId: string, fileName: string): string => `file://${fileName}`;

export const nodeFileAbsPath = (
  repoPath: string,
  flowDir: string,
  nodeId: string,
  fileName: string,
): string => join(repoPath, flowDir, nodeFileRelPath(nodeId, fileName));

export function writeNodeFile(absPath: string, content: string): void {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileAtomic(absPath, content);
}

export function removeNodeDir(repoPath: string, flowDir: string, nodeId: string): void {
  rmSync(join(repoPath, flowDir, 'nodes', nodeId), { recursive: true, force: true });
}
