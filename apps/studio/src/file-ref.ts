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

/**
 * Resolve every `file://<relative-path>` string in `raw` by reading the file
 * under `<seeflowRoot>` and substituting its UTF-8 content. Missing or invalid
 * paths are replaced with placeholder markers so schema parse still succeeds.
 *
 * Returns the mutated tree plus the sorted, de-duplicated list of relative
 * paths that resolved cleanly (the watcher tracks these for live reload).
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

  const resolveString = (s: string): string => {
    if (!s.startsWith(FILE_PREFIX)) return s;
    const relPath = s.slice(FILE_PREFIX.length);
    if (!isCleanRelativePath(relPath)) return invalidMarker(relPath);

    const abs = join(seeflowRoot, relPath);
    if (!existsSync(abs)) return missingMarker(relPath);

    // Symlink-escape defense: resolve realpath and confirm it stays inside root.
    let realAbs: string;
    try {
      realAbs = realpathSync(abs);
    } catch {
      return missingMarker(relPath);
    }
    const rel = relative(seeflowRealRoot, realAbs);
    if (rel.startsWith('..') || isAbsolute(rel)) return invalidMarker(relPath);

    try {
      const content = readFileSync(realAbs, 'utf8');
      refs.add(relPath);
      return content;
    } catch {
      return missingMarker(relPath);
    }
  };

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return resolveString(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  };

  const resolved = walk(raw);
  return { resolved, refs: [...refs].sort() };
}
