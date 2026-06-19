import { bundleProject } from './export-bundle.ts';
import { readCloudProjectId, writeCloudProjectId } from './cloud-meta.ts';
import { DEFAULT_CLOUD_ENDPOINT, loadCredential } from './credentials.ts';

/**
 * Generic, provider-agnostic publish/export provider. Bundles a project, POSTs
 * it to a configurable cloud endpoint with a bearer token from the shared
 * credential store, and stamps the returned project_id back into the project's
 * local cloud-meta so a re-export updates the same cloud project in place.
 *
 * No cloud/Clerk/AWS specifics live here — the only knob is `baseUrl`. The
 * `fetch` implementation is injected so tests never touch the network.
 */
export interface PublishOptions {
  root: string;
  baseUrl?: string;
  /** Explicit token. `undefined` → read from the shared credential store; an
   *  explicit `null` means "no credential" and is rejected. */
  token?: string | null;
  fetchImpl?: typeof fetch;
}

export interface PublishResult {
  projectId: string;
}

export async function publishProject(opts: PublishOptions): Promise<PublishResult> {
  const baseUrl = opts.baseUrl ?? DEFAULT_CLOUD_ENDPOINT;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const token =
    opts.token === undefined ? (loadCredential(baseUrl)?.token ?? null) : opts.token;
  if (!token) {
    throw new Error('not logged in — run `seeflow login` first');
  }

  const bundle = bundleProject(opts.root);
  const existingId = readCloudProjectId(opts.root, baseUrl);

  const res = await fetchImpl(`${baseUrl}/api/export`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ...(existingId ? { projectId: existingId } : {}), bundle }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`export failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }

  const { projectId } = (await res.json()) as { projectId: string };
  writeCloudProjectId(opts.root, baseUrl, projectId);
  return { projectId };
}
