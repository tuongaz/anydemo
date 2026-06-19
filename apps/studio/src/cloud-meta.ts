import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from './atomic-write.ts';

/**
 * Local cloud-export metadata, stored at `<root>/.seeflow/cloud.json` (the
 * project root's own `.seeflow`, distinct from the global seeflowHome()). Keyed
 * by the cloud base URL so a single project can be exported to more than one
 * cloud without the ids colliding. The stamped `projectId` is what makes
 * re-export update the same cloud project in place.
 */
interface CloudMetaEntry {
  projectId: string;
  lastExportedAt: string;
}
type CloudMetaFile = Record<string, CloudMetaEntry>;

function metaPath(root: string): string {
  return join(root, '.seeflow', 'cloud.json');
}

function readFile(root: string): CloudMetaFile {
  const path = metaPath(root);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as CloudMetaFile) : {};
  } catch {
    return {};
  }
}

export function readCloudProjectId(root: string, baseUrl: string): string | null {
  return readFile(root)[baseUrl]?.projectId ?? null;
}

export function writeCloudProjectId(root: string, baseUrl: string, projectId: string): void {
  const file = readFile(root);
  file[baseUrl] = { projectId, lastExportedAt: new Date().toISOString() };
  mkdirSync(join(root, '.seeflow'), { recursive: true });
  writeFileAtomic(metaPath(root), JSON.stringify(file, null, 2));
}
