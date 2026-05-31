import * as nodePath from 'node:path';

export type ResolveError = 'bad-node-id' | 'traversal' | 'outside-flow-dir';

export type ResolveNodeFileResult = { absPath: string } | { error: ResolveError };

export interface ResolveNodeFileOptions {
  repoPath: string;
  flowPath: string;
  nodeId: string;
  relPath: string;
}

const NODE_ID_RE = /^node-[A-Za-z0-9]{10}$/;

// Map a peer-supplied `{ nodeId, relPath }` request into a guaranteed-safe
// absolute path under `<repoPath>/<dirname(flowPath)>/nodes/<nodeId>/`. Mirrors
// the per-node upload sink at api.ts /projects/.../nodes/:nodeId/files/upload:
// for manifest-driven projects the base dir is `<flowDir>/nodes/<id>/`; for
// legacy single-flow registrations (flow.json at the project root, flowDir==='.')
// it collapses to `<repoPath>/nodes/<id>/`. Refuses any input that escapes that
// per-node scope.
export const resolveNodeFile = (
  opts: ResolveNodeFileOptions,
  pathMod: typeof nodePath = nodePath,
): ResolveNodeFileResult => {
  const { repoPath, flowPath, nodeId, relPath } = opts;

  if (!NODE_ID_RE.test(nodeId)) {
    return { error: 'bad-node-id' };
  }

  if (typeof relPath !== 'string' || relPath.length === 0) {
    return { error: 'traversal' };
  }
  // Refuse absolute paths in either separator style so a host running on POSIX
  // still rejects a `C:\…` or `\\server\share` payload from a win32 peer (and
  // vice-versa). Win32 absoluteness covers drive letters and UNC paths.
  if (relPath.startsWith('/') || relPath.startsWith('\\')) {
    return { error: 'traversal' };
  }
  if (pathMod.isAbsolute(relPath) || nodePath.win32.isAbsolute(relPath)) {
    return { error: 'traversal' };
  }

  // After normalize, any remaining `..` segment means the relPath tries to
  // escape its node folder. Split on BOTH separators so a posix host catches
  // `..\\evil` and a win32 host catches `../evil`.
  const normalized = pathMod.normalize(relPath);
  const segments = normalized.split(/[/\\]/);
  if (segments.some((segment) => segment === '..')) {
    return { error: 'traversal' };
  }

  const flowDir = pathMod.dirname(flowPath);
  const baseDir =
    flowDir === '.'
      ? pathMod.join(repoPath, 'nodes', nodeId)
      : pathMod.join(repoPath, flowDir, 'nodes', nodeId);

  const absPath = pathMod.resolve(baseDir, relPath);

  if (absPath !== baseDir && !absPath.startsWith(baseDir + pathMod.sep)) {
    return { error: 'outside-flow-dir' };
  }

  return { absPath };
};
