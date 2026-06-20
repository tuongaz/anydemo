export interface BootConfig {
  base: string;
  projectSlug: string;
  flowId: string;
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
  const raw = (w as unknown as { __SEEFLOW_BOOT__?: Partial<BootConfig> } | undefined)
    ?.__SEEFLOW_BOOT__;
  if (!raw) return null;
  const { base, projectSlug, flowId, mode } = raw;
  if (!base || !projectSlug || !flowId || (mode !== 'edit' && mode !== 'view')) return null;
  return { base, projectSlug, flowId, mode };
}
