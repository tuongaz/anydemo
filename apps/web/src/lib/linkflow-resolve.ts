import type { FlowSummary } from '@/lib/api';
import type { LinkflowTarget } from '@seeflow/canvas';

/**
 * Resolve a linkflow `target` against the `demos` cache.
 *
 * The renderer at `packages/canvas/src/nodes/linkflow-node.tsx` derives its
 * three visual states from `data.target` (semantic, on-disk) + `data._resolvedTarget`
 * (runtime injection, host-supplied):
 *
 *  - target unset                                    → 'unlinked'
 *  - target set + _resolvedTarget = {projectName,…} → 'linked-healthy'
 *  - target set + _resolvedTarget = null|undefined   → 'broken'
 *
 * Returns `null` when the target cannot be resolved — the renderer treats
 * `null` and `undefined` the same way (both → broken), but `null` is the
 * explicit "host resolved and missed" signal so callers can distinguish a
 * fresh node from one whose target was renamed/deleted.
 *
 * `FlowSummary.slug` is `${project}/${flow}` per the studio API. The "project
 * name" surfaced to the renderer is the slug itself — `FlowSummary` doesn't
 * carry a separate project label, and the picker dialog (US-003) uses the
 * same slug-as-label convention.
 */
export function resolveLinkflowTarget(
  target: LinkflowTarget | undefined,
  demos: readonly FlowSummary[],
): { projectName: string; flowName: string } | null {
  if (!target) return null;
  const slug = `${target.project}/${target.flow}`;
  const match = demos.find((d) => d.slug === slug);
  if (!match) return null;
  return { projectName: target.project, flowName: match.name };
}
