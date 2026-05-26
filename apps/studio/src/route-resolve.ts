import type { FlowEntry, Registry } from './registry.ts';

/**
 * Discriminated result of {@link resolveProjectFlow}.
 *
 * The error arm uses a stable `code` field so HTTP handlers can echo the same
 * string back to clients (`{ ok:false, error: result.code }`) without an
 * intermediate mapping table — see the route migration in US-007 onward.
 */
export type ResolveProjectFlowResult =
  | { kind: 'ok'; entry: FlowEntry }
  | { kind: 'error'; code: 'project-not-found' | 'flow-not-found' };

/**
 * Resolve a `(projectSlug, flowSlug)` pair to its registered {@link FlowEntry}.
 *
 * Splits the lookup into two stages so HTTP handlers can return a precise 404:
 *   1. If no entry shares the given `projectSlug`, the project itself doesn't
 *      exist → `project-not-found`.
 *   2. If some entry shares the project but none matches `flowSlug`, the
 *      project is registered but the flow isn't → `flow-not-found`.
 *
 * The single canonical caller is the route layer (US-007 / US-008); CLI code
 * keeps using `registry.resolve(idOrSlug)` because it accepts an ambiguous
 * `<flowId-or-slug>` argument.
 */
export function resolveProjectFlow(
  registry: Registry,
  projectSlug: string,
  flowSlug: string,
): ResolveProjectFlowResult {
  const projectEntries = registry.list().filter((e) => e.projectSlug === projectSlug);
  if (projectEntries.length === 0) {
    return { kind: 'error', code: 'project-not-found' };
  }
  const entry = projectEntries.find((e) => e.flowSlug === flowSlug);
  if (!entry) {
    return { kind: 'error', code: 'flow-not-found' };
  }
  return { kind: 'ok', entry };
}
