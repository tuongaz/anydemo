import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedFlow } from './schema.ts';

export interface SpecInlineError {
  /** Logical path into the merged flow shape, like 'nodes/<id>/data/spec'. */
  path: string;
  message: string;
}

export interface InlineComponentSpecsResult {
  flow: ResolvedFlow;
  errors: SpecInlineError[];
  /** Project-root-relative paths the watcher should track for live reload. */
  refs: string[];
}

/**
 * For every `'component'` node in `flow`, read `nodes/<id>/spec.json`,
 * JSON.parse, and attach the result as `data.spec`. Missing files surface
 * as a SpecInlineError; malformed JSON surfaces likewise. Non-component
 * nodes pass through untouched.
 *
 * Returns a NEW flow object (no mutation of the input) so the watcher's
 * snapshot caching stays safe.
 */
export function inlineComponentSpecs(
  flow: ResolvedFlow,
  projectRoot: string,
): InlineComponentSpecsResult {
  const errors: SpecInlineError[] = [];
  const refs: string[] = [];

  const nodes = flow.nodes.map((node) => {
    if (node.type !== 'component') return node;
    const relPath = `nodes/${node.id}/spec.json`;
    const absPath = join(projectRoot, relPath);
    if (!existsSync(absPath)) {
      errors.push({
        path: `nodes/${node.id}/data/spec`,
        message: `Missing spec file: ${relPath}`,
      });
      return node;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(absPath, 'utf8'));
    } catch (err) {
      errors.push({
        path: `nodes/${node.id}/data/spec`,
        message: `Invalid JSON in ${relPath}: ${err instanceof Error ? err.message : String(err)}`,
      });
      return node;
    }
    refs.push(relPath);
    return { ...node, data: { ...node.data, spec: parsed } } as typeof node;
  });

  return { flow: { ...flow, nodes } as ResolvedFlow, errors, refs };
}
