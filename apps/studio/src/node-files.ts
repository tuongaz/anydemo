import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from './atomic-write.ts';

export const EXTERNALIZED_NODE_FIELDS = [{ field: 'detail', fileName: 'detail.md' }] as const;

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
