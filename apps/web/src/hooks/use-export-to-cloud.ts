import { fetchFlowDetail } from '@/lib/api';
import { strToU8, zipSync } from 'fflate';
import { useCallback } from 'react';

export type Visibility = 'public' | 'link';

const CLOUD_API_BASE = 'https://seeflow.dev/api';

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
      exportToCloud(project, flow, email, name, visibility, previewDataUrl),
    [project, flow],
  );
}
