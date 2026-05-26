import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from './atomic-write.ts';

// Spec for fields that the studio externalizes to disk under
// `<repoPath>/<flowDir>/nodes/<id>/<fileName>`, where `flowDir` is
// `dirname(entry.flowPath)`. For manifest-driven projects this resolves to
// `flows/<flow-id>/nodes/<id>/`; for legacy single-flow fixtures with
// `flowPath: 'flow.json'` it collapses to the project root. `nodeTypes` (when
// present) scopes the spec entry to specific node types; absent means
// "applies to every node type". Adding a future text field is one line.
export interface ExternalizedFieldSpec {
  field: string;
  fileName: string;
  nodeTypes?: readonly string[];
}

export const EXTERNALIZED_NODE_FIELDS: readonly ExternalizedFieldSpec[] = [
  { field: 'detail', fileName: 'detail.md' },
  { field: 'html', fileName: 'view.html', nodeTypes: ['html'] },
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
