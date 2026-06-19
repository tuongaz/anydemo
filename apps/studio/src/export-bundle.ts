import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { PROJECT_FLOW_FILENAME } from './paths.ts';

/**
 * Transport-neutral snapshot of a project: a name plus the project files keyed
 * by their forward-slash, project-root-relative path. Pure — no network. The
 * cloud export endpoint receives exactly this shape; the local studio is the
 * only thing that knows how to read a project off disk.
 */
export interface BundleFile {
  /** Forward-slash, project-root-relative path (e.g. `nodes/n1/detail.md`). */
  path: string;
  content: string;
}

export interface ProjectBundle {
  name: string;
  files: BundleFile[];
}

/** Top-level files we include verbatim when present. */
const TOP_LEVEL_FILES = ['flow.json', 'style.json', 'seeflow.json'] as const;
/** Subtrees we recurse into when present. */
const SUBTREES = ['nodes', 'flows'] as const;

function relPath(root: string, abs: string): string {
  // Normalize to forward slashes so the wire format is platform-stable.
  return relative(root, abs).split(sep).join('/');
}

function collectTree(root: string, dir: string, out: BundleFile[]): void {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      collectTree(root, abs, out);
    } else if (st.isFile()) {
      out.push({ path: relPath(root, abs), content: readFileSync(abs, 'utf8') });
    }
  }
}

export function bundleProject(root: string): ProjectBundle {
  const flowPath = join(root, PROJECT_FLOW_FILENAME);
  if (!existsSync(flowPath)) {
    throw new Error(`no ${PROJECT_FLOW_FILENAME} found at ${root}`);
  }

  const files: BundleFile[] = [];
  for (const name of TOP_LEVEL_FILES) {
    const abs = join(root, name);
    if (existsSync(abs) && statSync(abs).isFile()) {
      files.push({ path: name, content: readFileSync(abs, 'utf8') });
    }
  }
  for (const sub of SUBTREES) {
    const abs = join(root, sub);
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      collectTree(root, abs, files);
    }
  }

  return { name: deriveName(root, files), files };
}

function deriveName(root: string, files: BundleFile[]): string {
  const flow = files.find((f) => f.path === PROJECT_FLOW_FILENAME);
  if (flow) {
    try {
      const parsed = JSON.parse(flow.content) as { name?: unknown };
      if (typeof parsed.name === 'string' && parsed.name.length > 0) return parsed.name;
    } catch {
      // fall through to the directory name
    }
  }
  return root.split(sep).filter(Boolean).pop() ?? 'project';
}
