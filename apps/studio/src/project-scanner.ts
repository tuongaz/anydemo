// Project scanner: turns a project directory on disk into a set of
// `ScannedFlow` entries the registry can consume. The disk layout is
// manifest-driven:
//
//   <repoPath>/seeflow.json            — top-level project manifest
//   <repoPath>/flows/<id>/flow.json    — one folder per flow declared in manifest
//
// `scanProject(repoPath)` returns a discriminated union: either `{ kind: 'ok' }`
// with the parsed manifest + per-flow entries, or one of the typed error
// variants below. The CLI wires this into `registerProject(opts)` in US-004 and
// turns each error variant into a structured exit.

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type SeeflowManifest, SeeflowManifestSchema } from './schema.ts';
import { slugify } from './slugify.ts';

export interface ScannedFlow {
  /** Manifest flow id (matches /^[a-z0-9][a-z0-9-]*$/). Becomes flowSlug. */
  id: string;
  /** Human-readable name from manifest. */
  name: string;
  /** Optional decorative icon name. */
  icon?: string;
  /** True for the flow whose id matches manifest.defaultFlow. */
  isDefault: boolean;
  /** Relative path of flow.json under the project root. Always
   *  `flows/<id>/flow.json` — the scanner does not honour overrides. */
  flowPath: string;
}

export type ScanError =
  | { kind: 'manifest-missing' }
  | { kind: 'manifest-invalid'; message: string }
  | { kind: 'legacy-root-flow' }
  | { kind: 'flow-json-missing'; flowId: string; flowPath: string };

export type ScanResult =
  | {
      kind: 'ok';
      projectSlug: string;
      manifest: SeeflowManifest;
      flows: ScannedFlow[];
    }
  | ScanError;

const MANIFEST_FILENAME = 'seeflow.json';
const LEGACY_FLOW_FILENAME = 'flow.json';

/**
 * Best-effort manifest read for listing routes / CLI listing verbs.
 * Returns `null` when the manifest is missing or malformed — callers fall
 * back to derived defaults (projectSlug, isDefault entry) so one broken
 * project does not collapse the whole listing.
 */
export function readProjectManifest(repoPath: string): SeeflowManifest | null {
  const manifestPath = join(repoPath, MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const parsed = SeeflowManifestSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function scanProject(repoPath: string): ScanResult {
  const manifestPath = join(repoPath, MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) {
    // Pre-multi-flow projects had `flow.json` at the project root. We refuse
    // to silently treat those as single-flow projects — the migration story
    // (US-005) moves them to `flows/main/flow.json` first.
    if (existsSync(join(repoPath, LEGACY_FLOW_FILENAME))) {
      return { kind: 'legacy-root-flow' };
    }
    return { kind: 'manifest-missing' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return {
      kind: 'manifest-invalid',
      message: `failed to parse ${MANIFEST_FILENAME}: ${(err as Error).message}`,
    };
  }

  const parsed = SeeflowManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: 'manifest-invalid',
      message: parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; '),
    };
  }

  const manifest = parsed.data;
  const flows: ScannedFlow[] = [];
  for (const entry of manifest.flows) {
    const flowPath = `flows/${entry.id}/${LEGACY_FLOW_FILENAME}`;
    if (!existsSync(join(repoPath, flowPath))) {
      return { kind: 'flow-json-missing', flowId: entry.id, flowPath };
    }
    flows.push({
      id: entry.id,
      name: entry.name,
      icon: entry.icon,
      isDefault: entry.id === manifest.defaultFlow,
      flowPath,
    });
  }

  // Prefer the manifest name. When it carries no alphanumeric content there is
  // nothing to slugify, so fall back to the directory basename — which itself
  // slugifies through to a stable identifier. Test the input directly rather
  // than comparing against slugify's fallback string: that sentinel is a real
  // slug a real project can produce, so a name-equals-sentinel check would
  // silently divert a legitimately named project down the basename path.
  const nameSlug = slugify(manifest.name);
  const projectSlug = /[a-z0-9]/i.test(manifest.name) ? nameSlug : slugify(basename(repoPath));

  return { kind: 'ok', projectSlug, manifest, flows };
}
