import { useSyncExternalStore } from 'react';
import { type BootConfig, readBootConfig } from './boot-config';

const NAV_EVENT = 'seeflow:navigate';

/**
 * Build-time base path baked in by Vite, with the trailing slash trimmed:
 * `''` for the standalone studio (Vite base `/`) and `/app` for the cloud
 * build (`VITE_BASE=/app/`). Vite always defines `import.meta.env.BASE_URL`
 * (defaulting to `/`); the `?? '/'` guards non-Vite contexts (e.g. bun:test).
 */
export const BUILD_BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

/**
 * Effective base path the SPA is served under, with the trailing slash trimmed.
 * When the host injects a boot config (e.g. cloud serves the studio under
 * `/p/<id>`), the boot base wins over the build-time base; otherwise it falls
 * back to `BUILD_BASE`. Computed once at module load — the boot global is set
 * before the bundle runs.
 *
 * All matchers (`matchProjectFlow`, `matchProjectAlone`, `flowPath`) operate in
 * base-RELATIVE space. `stripBase` peels the base off `window.location.pathname`
 * before matching; `withBase` re-attaches it before `pushState`/`replaceState`.
 */
export const BASE = readBootConfig()?.base?.replace(/\/$/, '') ?? BUILD_BASE;

/**
 * Strip the leading base segment from an absolute pathname, returning a
 * base-relative path (always starts with `/`). Pure + base-injectable so it's
 * unit-testable without mutating `import.meta.env.BASE_URL`.
 *
 * - `stripBase('/app/projects/p', '/app')` → `/projects/p`
 * - `stripBase('/app', '/app')` → `/` (the base root)
 * - `stripBase('/projects/p', '')` → `/projects/p` (no-op when base is empty)
 * - A path that doesn't start with the base is returned unchanged (defensive).
 */
export const stripBase = (pathname: string, base: string = BASE): string => {
  if (!base) return pathname;
  if (pathname === base) return '/';
  if (pathname.startsWith(`${base}/`)) return pathname.slice(base.length);
  return pathname;
};

/**
 * Prepend the base to a base-relative path. Inverse of `stripBase`. Pure +
 * base-injectable for testing.
 *
 * - `withBase('/projects/p', '/app')` → `/app/projects/p`
 * - `withBase('/', '/app')` → `/app`
 * - `withBase('/projects/p', '')` → `/projects/p` (no-op when base is empty)
 */
export const withBase = (path: string, base: string = BASE): string => {
  if (!base) return path;
  if (path === '/') return base;
  return `${base}${path}`;
};

const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  window.addEventListener(NAV_EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(NAV_EVENT, listener);
  };
};

const getSnapshot = () => stripBase(window.location.pathname);

export const usePathname = (): string => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

export const navigate = (to: string) => {
  if (to === stripBase(window.location.pathname)) return;
  window.history.pushState({}, '', withBase(to));
  window.dispatchEvent(new Event(NAV_EVENT));
};

/**
 * US-010: build the canvas-page URL from a (project, flow) pair. Slugs go
 * through `encodeURIComponent` so reserved characters survive the path
 * segments cleanly.
 *
 * Boot mode: the project is FIXED to `boot.projectSlug`, so the URL carries no
 * `/projects/<slug>` segment — only `/flows/<flow>` (the `project` arg is
 * ignored). Without boot, the legacy `/projects/:project/flows/:flow` grammar.
 */
export const flowPath = (
  project: string,
  flow: string,
  boot: BootConfig | null = readBootConfig(),
): string => {
  if (boot) return `/flows/${encodeURIComponent(flow)}`;
  return `/projects/${encodeURIComponent(project)}/flows/${encodeURIComponent(flow)}`;
};

/**
 * US-010: parse the canvas-page path into its (project, flow) slugs. Returns
 * null for any other path or when either segment is empty.
 *
 * Boot mode: the project is FIXED to `boot.projectSlug`. The base root (`/`)
 * resolves to the project's default flow (`boot.flowId`); `/flows/<flow>`
 * resolves to that flow; anything else is null (the legacy `/projects/...`
 * grammar is invalid under boot). Without boot, the legacy
 * `/projects/:project/flows/:flow` grammar.
 */
export const matchProjectFlow = (
  pathname: string,
  boot: BootConfig | null = readBootConfig(),
): { project: string; flow: string } | null => {
  const parts = pathname.split('/').filter(Boolean);
  if (boot) {
    if (parts.length === 0) return { project: boot.projectSlug, flow: boot.flowId };
    if (parts.length === 2 && parts[0] === 'flows') {
      const flow = decodeURIComponent(parts[1] ?? '');
      if (!flow) return null;
      return { project: boot.projectSlug, flow };
    }
    return null;
  }
  if (parts.length !== 4) return null;
  if (parts[0] !== 'projects' || parts[2] !== 'flows') return null;
  const project = decodeURIComponent(parts[1] ?? '');
  const flow = decodeURIComponent(parts[3] ?? '');
  if (!project || !flow) return null;
  return { project, flow };
};

/**
 * US-010: split a legacy registry slug `${projectSlug}/${flowSlug}` and build
 * the canvas URL from it. Convenience for components that still hold a
 * FlowSummary.slug rather than separate fields.
 */
export const flowPathFromSlug = (slug: string): string => {
  const idx = slug.indexOf('/');
  if (idx < 0) return flowPath(slug, '');
  return flowPath(slug.slice(0, idx), slug.slice(idx + 1));
};

/**
 * US-005: split a `${projectSlug}/${flowSlug}` registry slug into its two
 * parts so callers can pass them to the navigation hook's reset/pushLink
 * (which take separate fields). Returns null when the slug has no `/`.
 */
export const splitFlowSlug = (slug: string): { project: string; flow: string } | null => {
  const idx = slug.indexOf('/');
  if (idx <= 0 || idx === slug.length - 1) return null;
  return { project: slug.slice(0, idx), flow: slug.slice(idx + 1) };
};

/**
 * US-026: parse `/projects/:project` (no `/flows/:flow` segment) for the
 * project-only landing page. App.tsx redirects this case to the user's
 * last-opened flow (or the project default) via pickInitialFlow.
 *
 * Boot mode: the project is FIXED and the base root already resolves to a flow,
 * so there is no project-only landing — always null.
 */
export const matchProjectAlone = (
  pathname: string,
  boot: BootConfig | null = readBootConfig(),
): { project: string } | null => {
  if (boot) return null;
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  if (parts[0] !== 'projects') return null;
  const project = decodeURIComponent(parts[1] ?? '');
  if (!project) return null;
  return { project };
};
