import { useSyncExternalStore } from 'react';

const NAV_EVENT = 'seeflow:navigate';

const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  window.addEventListener(NAV_EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(NAV_EVENT, listener);
  };
};

const getSnapshot = () => window.location.pathname;

export const usePathname = (): string => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

export const navigate = (to: string) => {
  if (to === window.location.pathname) return;
  window.history.pushState({}, '', to);
  window.dispatchEvent(new Event(NAV_EVENT));
};

/**
 * US-010: build the canvas-page URL from a (project, flow) pair. Slugs go
 * through `encodeURIComponent` so reserved characters survive the path
 * segments cleanly.
 */
export const flowPath = (project: string, flow: string): string =>
  `/projects/${encodeURIComponent(project)}/flows/${encodeURIComponent(flow)}`;

/**
 * US-010: parse the canvas-page path into its (project, flow) slugs. Returns
 * null for any other path or when either segment is empty.
 */
export const matchProjectFlow = (pathname: string): { project: string; flow: string } | null => {
  const parts = pathname.split('/').filter(Boolean);
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
 */
export const matchProjectAlone = (pathname: string): { project: string } | null => {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  if (parts[0] !== 'projects') return null;
  const project = decodeURIComponent(parts[1] ?? '');
  if (!project) return null;
  return { project };
};
