import { apiFetch } from './api-client.ts';

// Client for the cloud "share with people" grants API (mounted only when the
// studio runs inside a host that provides it, e.g. cloud.seeflow.dev). All calls
// route through apiFetch so the auth seam attaches the bearer token. The studio
// stays host-agnostic: these endpoints simply 404 in pure local mode, and the
// dialog that calls them is only mounted when the host injects a projectId.

export type Role = 'viewer' | 'editor';

export interface Grant {
  email: string;
  role: Role;
}

export async function fetchGrants(projectId: string): Promise<Grant[]> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/grants`);
  if (!res.ok) throw new Error(`Failed to load people (${res.status})`);
  const body = (await res.json()) as { grants: Grant[] };
  return body.grants;
}

export async function addGrant(projectId: string, email: string, role: Role): Promise<void> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/grants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) throw new Error(`Failed to add grant (${res.status})`);
}

export async function removeGrant(projectId: string, email: string): Promise<void> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/grants`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`Failed to remove access (${res.status})`);
}

export type Access = 'owner' | Role;

export interface AccessibleProject {
  /** Internal cloud project id the grants API keys on. */
  projectId: string;
  /** Unified public id (`/p/<publicId>`). */
  publicId: string;
  /** Studio project slug — matches the studio registry slug for owned projects. */
  slug: string;
  title: string;
  /** 'owner' when the viewer owns it, else the granted role. */
  access: Access;
}

/**
 * The projects the signed-in user can access in cloud — owned AND shared-with-me —
 * read from the cloud DB (GET /api/dashboard/projects). The studio uses this to
 * resolve the currently-open project's internal projectId + owner-ness when the
 * host injects NO boot config (the multi-project /app studio), so "Share with
 * people" works there too — not only on the single-project /p/<id> shell. 404s in
 * pure local mode; callers gate on isCloud.
 */
export async function fetchAccessibleProjects(): Promise<AccessibleProject[]> {
  const res = await apiFetch('/api/dashboard/projects');
  if (!res.ok) throw new Error(`Failed to load projects (${res.status})`);
  const body = (await res.json()) as { projects: AccessibleProject[] };
  return body.projects ?? [];
}
