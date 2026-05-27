import { buildProjectBundle } from '@/lib/build-project-bundle';
import { unzipSync, zipSync } from 'fflate';
import { useCallback } from 'react';

export type Visibility = 'public' | 'link';

const CLOUD_API_BASE = import.meta.env.VITE_SEEFLOW_CLOUD_API_BASE ?? 'https://seeflow.dev/api';

/**
 * Whole-project export. Builds a multi-flow bundle from the slugs the caller
 * picked and POSTs it to `${CLOUD_API_BASE}/projects`. The cloud returns the
 * project viewer URL (typically `seeflow.dev/project/<uuid>`).
 *
 * The caller (the export dialog) already has the project's flow list, so the
 * slugs to bundle are passed in directly — no extra fetch here.
 *
 * `previewDataUrl` rides on the bundle as a zip-level `preview.png` extra;
 * `visibility` rides on the URL query string. The cloud-side viewer handles
 * both.
 */
export async function exportProjectToCloud(
  project: string,
  email: string,
  name: string,
  visibility: Visibility,
  previewDataUrl: string | undefined,
  selectedFlowSlugs: string[],
): Promise<{ shareUrl: string }> {
  const bundle = await buildProjectBundle({
    project,
    flows: selectedFlowSlugs.map((flowSlug) => ({ flowSlug })),
  });

  // Splice preview.png into the bundle when the canvas captured a screenshot.
  // buildProjectBundle's shape is shared with the cloud uploader, so we
  // unzip+rezip rather than extend that API for an optional extra entry.
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
): (
  email: string,
  name: string,
  visibility: Visibility,
  previewDataUrl?: string,
  selectedFlowSlugs?: string[],
) => Promise<{ shareUrl: string }> {
  return useCallback(
    (
      email: string,
      name: string,
      visibility: Visibility,
      previewDataUrl?: string,
      selectedFlowSlugs?: string[],
    ) =>
      exportProjectToCloud(
        project,
        email,
        name,
        visibility,
        previewDataUrl,
        selectedFlowSlugs ?? [],
      ),
    [project],
  );
}
