import { strToU8, zipSync } from 'fflate';

/**
 * US-029: build a whole-project zip bundle for the seeflow.dev viewer.
 *
 * Layout produced by the zip:
 *
 * ```text
 * seeflow.json                       — manifest (SeeflowManifest shape; version 1)
 * flows/<flowSlug>/flow.json         — per-flow envelope (Flow shape; version 2)
 * flows/<flowSlug>/files/<path>      — per-flow image assets (type:'image' data.path)
 * ```
 *
 * Wired into the export dialog by US-030 behind the
 * `VITE_SEEFLOW_PROJECT_EXPORT` feature flag. Image bytes are fetched lazily
 * from `/api/projects/:project/files/<path>` (project-scoped — assets are
 * shared across flows) and deduped per-flow. Non-200 file responses are
 * skipped silently — same fallback shape as `exportToCloud` so a missing
 * asset doesn't fail the whole bundle.
 */

interface ProjectMetaResponse {
  projectSlug: string;
  name: string;
  description?: string;
  defaultFlow: string;
  flows: Array<{ flowSlug: string; name: string; icon?: string; isDefault: boolean }>;
}

interface FlowDetailResponse {
  id: string;
  slug: string;
  name: string;
  filePath: string;
  // The fully merged flow: flow.json + style.json (positions + visual style)
  // + inlined file:// detail refs. This is exactly what the studio canvas
  // renders, so bundling it gives the cloud viewer node positions — without
  // them React Flow throws on `node.position.x` and the page renders blank.
  flow: {
    version: 2;
    name: string;
    description?: string;
    nodes: Array<Record<string, unknown>>;
    connectors: Array<Record<string, unknown>>;
  };
}

interface ManifestOnDisk {
  version: 1;
  name: string;
  description?: string;
  defaultFlow: string;
  flows: Array<{ id: string; name: string; icon?: string }>;
}

interface FlowEnvelopeOnDisk {
  version: 2;
  name: string;
  description?: string;
  nodes: Array<Record<string, unknown>>;
  connectors: Array<Record<string, unknown>>;
}

const FLOW_ENVELOPE_VERSION = 2 as const;

export interface BuildProjectBundleFlow {
  /** Stable flow id from the manifest — matches `FlowEntry.flowSlug`. */
  flowSlug: string;
}

export interface BuildProjectBundleInput {
  /** Project slug used to compose `/api/projects/:project/...` URLs. */
  project: string;
  /**
   * Flows to bundle. Typically the `ProjectFlowSummary[]` returned by
   * `fetchProjectFlows(project)` — only `flowSlug` is read by the builder.
   */
  flows: BuildProjectBundleFlow[];
}

function imageAssetPath(node: Record<string, unknown>): string | undefined {
  if (node.type !== 'image') return undefined;
  const data = node.data as { path?: unknown } | undefined;
  return typeof data?.path === 'string' && data.path.length > 0 ? data.path : undefined;
}

export async function buildProjectBundle({
  project,
  flows,
}: BuildProjectBundleInput): Promise<Uint8Array> {
  const projectUrl = `/api/projects/${encodeURIComponent(project)}`;
  const projectRes = await fetch(projectUrl);
  if (!projectRes.ok) {
    throw new Error(`GET ${projectUrl} → ${projectRes.status}`);
  }
  const meta = (await projectRes.json()) as ProjectMetaResponse;

  const selected = new Set(flows.map((f) => f.flowSlug));
  const selectedMetaFlows = meta.flows.filter((f) => selected.has(f.flowSlug));
  const defaultFlow = selected.has(meta.defaultFlow)
    ? meta.defaultFlow
    : (selectedMetaFlows[0]?.flowSlug ?? meta.defaultFlow);

  const manifest: ManifestOnDisk = {
    version: 1,
    name: meta.name,
    defaultFlow,
    flows: selectedMetaFlows.map((f) => {
      const entry: ManifestOnDisk['flows'][number] = { id: f.flowSlug, name: f.name };
      if (f.icon !== undefined) entry.icon = f.icon;
      return entry;
    }),
  };
  if (meta.description !== undefined) {
    manifest.description = meta.description;
  }

  const zipEntries: Record<string, Uint8Array> = {
    'seeflow.json': strToU8(JSON.stringify(manifest, null, 2)),
  };

  for (const { flowSlug } of flows) {
    const detailUrl = `/api/projects/${encodeURIComponent(project)}/flows/${encodeURIComponent(
      flowSlug,
    )}`;
    const detailRes = await fetch(detailUrl);
    if (!detailRes.ok) {
      throw new Error(`GET ${detailUrl} → ${detailRes.status}`);
    }
    const { flow } = (await detailRes.json()) as FlowDetailResponse;

    const envelope: FlowEnvelopeOnDisk = {
      version: FLOW_ENVELOPE_VERSION,
      name: flow.name,
      nodes: flow.nodes,
      connectors: flow.connectors,
    };
    if (flow.description !== undefined) {
      envelope.description = flow.description;
    }

    zipEntries[`flows/${flowSlug}/flow.json`] = strToU8(JSON.stringify(envelope));

    const seen = new Set<string>();
    for (const node of flow.nodes) {
      const assetPath = imageAssetPath(node);
      if (!assetPath || seen.has(assetPath)) continue;
      seen.add(assetPath);
      const fileUrl = `/api/projects/${encodeURIComponent(project)}/files/${assetPath}`;
      const fileRes = await fetch(fileUrl);
      if (!fileRes.ok) continue;
      zipEntries[`flows/${flowSlug}/files/${assetPath}`] = new Uint8Array(
        await fileRes.arrayBuffer(),
      );
    }
  }

  return zipSync(zipEntries);
}
