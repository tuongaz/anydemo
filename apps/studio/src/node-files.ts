import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from './atomic-write.ts';

// Spec for fields that the studio externalizes to disk under
// `<project>/.seeflow/nodes/<id>/<fileName>`. `nodeTypes` (when present)
// scopes the spec entry to specific node types; absent means "applies to
// every node type". Adding a future text field is one line.
export interface ExternalizedFieldSpec {
  field: string;
  fileName: string;
  nodeTypes?: readonly string[];
}

export const EXTERNALIZED_NODE_FIELDS: readonly ExternalizedFieldSpec[] = [
  { field: 'detail', fileName: 'detail.md' },
  { field: 'html', fileName: 'view.html', nodeTypes: ['htmlNode'] },
];

export const externalizedFieldsForNodeType = (
  nodeType: unknown,
): readonly ExternalizedFieldSpec[] => {
  if (typeof nodeType !== 'string') return EXTERNALIZED_NODE_FIELDS.filter((e) => !e.nodeTypes);
  return EXTERNALIZED_NODE_FIELDS.filter((e) => !e.nodeTypes || e.nodeTypes.includes(nodeType));
};

export type ExternalizedFieldName = (typeof EXTERNALIZED_NODE_FIELDS)[number]['field'];

export const nodeFileRelPath = (nodeId: string, fileName: string): string =>
  `nodes/${nodeId}/${fileName}`;

export const nodeFileRef = (nodeId: string, fileName: string): string =>
  `file://${nodeFileRelPath(nodeId, fileName)}`;

export const nodeFileAbsPath = (repoPath: string, nodeId: string, fileName: string): string =>
  join(repoPath, '.seeflow', nodeFileRelPath(nodeId, fileName));

export function writeNodeFile(absPath: string, content: string): void {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileAtomic(absPath, content);
}

export function removeNodeDir(repoPath: string, nodeId: string): void {
  rmSync(join(repoPath, '.seeflow', 'nodes', nodeId), { recursive: true, force: true });
}
