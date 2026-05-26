import { fetchFlowDetail, fetchProjectFlows } from '@/lib/api';
import { buildProjectBundle } from '@/lib/build-project-bundle';
import { IS_PROJECT_EXPORT_ENABLED } from '@/lib/feature-flags';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { useCallback } from 'react';

export type Visibility = 'public' | 'link';

const CLOUD_API_BASE = import.meta.env.VITE_SEEFLOW_CLOUD_API_BASE ?? 'https://seeflow.dev/api';

/**
 * US-010: take both `project` (slug, drives `/api/projects/:project/...` and
 * file fetches) and `flow` (slug, drives the per-flow detail fetch) explicitly
 * — pre-US-010 callers passed a single `projectId` that was the registry
 * entry id, which couldn't address the project-scoped file route after US-008
 * moved files under `:project` (project slug).
 */
export async function exportToCloud(
  project: string,
  flow: string,
  email: string,
  name: string,
  visibility: Visibility,
  previewDataUrl?: string,
): Promise<{ shareUrl: string }> {
  const detail = await fetchFlowDetail(project, flow);
  if (!detail.flow) {
    throw new Error('Flow has no data');
  }
  const demo = detail.flow;

  // Bundle type:'image' binaries. Text-content fields (detail, type:'html' html)
  // ride on the file:// resolver and are already inlined in the flow JSON,
  // so no separate bundling is needed for them.
  const seen = new Set<string>();
  const filePaths: string[] = [];
  for (const node of demo.nodes) {
    if (node.type === 'image' && node.data.path && !seen.has(node.data.path)) {
      seen.add(node.data.path);
      filePaths.push(node.data.path);
    }
  }

  const demoKey = visibility === 'link' ? 'flow.private.json' : 'flow.json';

  const zipEntries: Record<string, Uint8Array> = {
    [demoKey]: strToU8(JSON.stringify(demo)),
  };

  if (previewDataUrl) {
    const base64 = previewDataUrl.split(',')[1];
    if (base64) {
      zipEntries['preview.png'] = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    }
  }

  for (const path of filePaths) {
    const res = await fetch(`/api/projects/${encodeURIComponent(project)}/files/${path}`);
    if (res.ok) {
      zipEntries[`files/${path}`] = new Uint8Array(await res.arrayBuffer());
    }
  }

  const zipped = zipSync(zipEntries);

  const cloudRes = await fetch(
    `${CLOUD_API_BASE}/flows?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: zipped.buffer as ArrayBuffer,
    },
  );

  if (!cloudRes.ok) {
    throw new Error(`Export failed with status ${cloudRes.status}`);
  }

  const body = (await cloudRes.json()) as { url?: string };
  if (typeof body.url !== 'string') {
    throw new Error('Invalid response from cloud API: missing url');
  }

  return { shareUrl: body.url };
}

/**
 * US-030: whole-project export. Gated behind `VITE_SEEFLOW_PROJECT_EXPORT`.
 * Fetches the per-project flow list, builds the multi-flow bundle (US-029),
 * and POSTs it to `${CLOUD_API_BASE}/projects`. The cloud returns the project
 * viewer URL (typically `seeflow.dev/project/<uuid>`).
 *
 * `previewDataUrl` and `visibility` are accepted for API parity with the
 * single-flow export but are passed through as zip-level extras (preview.png
 * at root) / query string (visibility). The cloud-side viewer handles them.
 */
export async function exportProjectToCloud(
  project: string,
  email: string,
  name: string,
  visibility: Visibility,
  previewDataUrl?: string,
): Promise<{ shareUrl: string }> {
  const flows = await fetchProjectFlows(project);
  const bundle = await buildProjectBundle({
    project,
    flows: flows.map((f) => ({ flowSlug: f.flowSlug })),
  });

  // Splice preview.png into the bundle when the canvas captured a screenshot.
  // US-029 froze buildProjectBundle's shape, so we unzip+rezip rather than
  // extend that API for an optional extra entry.
  let zipped = bundle;
  const previewBase64 = previewDataUrl?.split(',')[1];
  if (previewBase64) {
    const entries = unzipSync(zipped);
    entries['preview.png'] = Uint8Array.from(atob(previewBase64), (c) => c.charCodeAt(0));
    zipped = zipSync(entries);
  }

  const url = `${CLOUD_API_BASE}/projects?email=${encodeURIComponent(
    email,
  )}&name=${encodeURIComponent(name)}&visibility=${encodeURIComponent(visibility)}`;

  const cloudRes = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: zipped.buffer as ArrayBuffer,
  });

  if (!cloudRes.ok) {
    throw new Error(`Export failed with status ${cloudRes.status}`);
  }

  const responseBody = (await cloudRes.json()) as { url?: string };
  if (typeof responseBody.url !== 'string') {
    throw new Error('Invalid response from cloud API: missing url');
  }

  return { shareUrl: responseBody.url };
}

export function useExportToCloud(
  project: string,
  flow: string,
): (
  email: string,
  name: string,
  visibility: Visibility,
  previewDataUrl?: string,
) => Promise<{ shareUrl: string }> {
  return useCallback(
    (email: string, name: string, visibility: Visibility, previewDataUrl?: string) =>
      IS_PROJECT_EXPORT_ENABLED
        ? exportProjectToCloud(project, email, name, visibility, previewDataUrl)
        : exportToCloud(project, flow, email, name, visibility, previewDataUrl),
    [project, flow],
  );
}
