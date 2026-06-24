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
