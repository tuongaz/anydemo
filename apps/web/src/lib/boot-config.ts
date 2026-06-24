export interface BootConfig {
  base: string;
  projectSlug: string;
  /**
   * Opaque host project id. The studio itself never interprets it — it forwards
   * it to host-owned features (e.g. cloud's "share with people" dialog, whose
   * grants API keys on this id). Absent in pure local/standalone studio.
   */
  projectId?: string;
  flowId?: string;
  mode: 'edit' | 'view';
}

/**
 * Read the host-injected studio boot config (window.__SEEFLOW_BOOT__). When the
 * studio SPA is served under a host-controlled URL (e.g. cloud's /p/<id>), the
 * server injects this so the studio opens a specific project/flow without
 * parsing the path. Returns null in pure local/standalone studio (no global),
 * where the path-based router is used instead. Generic: no cloud concepts here.
 */
export function readBootConfig(
  w: (Window & typeof globalThis) | undefined = typeof window !== 'undefined' ? window : undefined,
): BootConfig | null {
  const boot = (w as unknown as Record<string, unknown> | undefined)?.__SEEFLOW_BOOT__;
  if (!boot || typeof boot !== 'object') return null;
  const { base, projectSlug, projectId, flowId, mode } = boot as Record<string, unknown>;
  if (typeof base !== 'string' || typeof projectSlug !== 'string') return null;
  // flowId + projectId are optional: absent flowId means "no concrete default
  // flow" (the studio resolves the project's default/last flow); absent
  // projectId means no host project-id feature surface. When present they must
  // be strings.
  if (flowId !== undefined && typeof flowId !== 'string') return null;
  if (projectId !== undefined && typeof projectId !== 'string') return null;
  if (mode !== 'edit' && mode !== 'view') return null;
  return { base, projectSlug, projectId, flowId, mode };
}
