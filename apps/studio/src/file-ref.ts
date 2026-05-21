import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

const FILE_PREFIX = 'file://';

const isCleanRelativePath = (p: string): boolean => {
  if (p.length === 0) return false;
  if (p.startsWith('/') || p.startsWith('\\')) return false;
  if (/^[A-Za-z]:[\\/]/.test(p)) return false;
  const segments = p.split(/[\\/]/);
  return !segments.some((seg) => seg === '..');
};

const invalidMarker = (rawPath: string) => `[seeflow: invalid file:// path '${rawPath}']`;
const missingMarker = (rawPath: string) => `[seeflow: missing file '${rawPath}']`;

const looksLikeFlowNode = (obj: Record<string, unknown>): obj is { id: string; data: object } =>
  typeof obj.id === 'string' && obj.data !== null && typeof obj.data === 'object';

/**
 * Resolve every `file://<relative-path>` string in `raw` by reading the file
 * under `<seeflowRoot>/nodes/<nodeId>/` (node-relative) and substituting its
 * UTF-8 content. Strings outside any enclosing flow node are treated as
 * invalid — every supported file:// ref currently lives inside `node.data`.
 *
 * Returns the mutated tree plus the sorted, de-duplicated list of seeflow-root-relative
 * paths that resolved cleanly (the watcher tracks these for live reload, so the
 * external contract uses `nodes/<id>/<file>` even though the source string is short).
 */
export function resolveFileRefs(
  raw: unknown,
  seeflowRoot: string,
): { resolved: unknown; refs: string[] } {
  const refs = new Set<string>();
  let seeflowRealRoot: string;
  try {
    seeflowRealRoot = existsSync(seeflowRoot) ? realpathSync(seeflowRoot) : seeflowRoot;
  } catch {
    seeflowRealRoot = seeflowRoot;
  }

  const resolveString = (s: string, nodeId: string | null): string => {
    if (!s.startsWith(FILE_PREFIX)) return s;
    const relPath = s.slice(FILE_PREFIX.length);
    if (!isCleanRelativePath(relPath)) return invalidMarker(relPath);
    if (nodeId === null) return invalidMarker(relPath);

    const seeflowRelPath = `nodes/${nodeId}/${relPath}`;
    const abs = join(seeflowRoot, seeflowRelPath);
    if (!existsSync(abs)) return missingMarker(seeflowRelPath);

    // Symlink-escape defense: resolve realpath and confirm it stays inside root.
    let realAbs: string;
    try {
      realAbs = realpathSync(abs);
    } catch {
      return missingMarker(seeflowRelPath);
    }
    const rel = relative(seeflowRealRoot, realAbs);
    if (rel.startsWith('..') || isAbsolute(rel)) return invalidMarker(relPath);

    try {
      const content = readFileSync(realAbs, 'utf8');
      refs.add(seeflowRelPath);
      return content;
    } catch {
      return missingMarker(seeflowRelPath);
    }
  };

  const walk = (node: unknown, nodeId: string | null): unknown => {
    if (typeof node === 'string') return resolveString(node, nodeId);
    if (Array.isArray(node)) return node.map((v) => walk(v, nodeId));
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      // Entering a flow node carves out a new resolution context for its subtree:
      // any file:// inside `data` now resolves relative to nodes/<id>/.
      const childNodeId = looksLikeFlowNode(obj) ? obj.id : nodeId;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = walk(v, childNodeId);
      }
      return out;
    }
    return node;
  };

  const resolved = walk(raw, null);
  return { resolved, refs: [...refs].sort() };
}
