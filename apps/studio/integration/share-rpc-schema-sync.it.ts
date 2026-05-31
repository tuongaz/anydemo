/**
 * Byte-for-byte mirror check between the studio's share-rpc-schema.ts and
 * the seeflow-viewer copy at src/lib/share-rpc-schema.ts. Fails LOUD when
 * they drift so a schema edit can never land on one side only.
 *
 * The viewer repo lives outside the studio workspace. Resolution order:
 *   1. SEEFLOW_VIEWER_PATH env var (absolute path to the viewer repo root).
 *   2. Sibling `seeflow-viewer/` next to the studio repo root (the
 *      conventional layout — viewer's package.json points at
 *      `file:../seeflow/packages/canvas`).
 *   3. The hardcoded dev path `/Users/tuongaz/dev/seeflow-viewer` as a last
 *      resort for the maintainer's worktree setup.
 * If none resolve, the test SKIPS with a clear log line — local CI without
 * the viewer checkout shouldn't fail the studio's full integration run, but
 * any developer with the viewer checked out gets the drift signal immediately.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const STUDIO_REL = join(import.meta.dir, '..', 'src', 'share-rpc-schema.ts');
const VIEWER_TAIL = join('src', 'lib', 'share-rpc-schema.ts');

function resolveViewerPath(): string | null {
  if (process.env.SEEFLOW_VIEWER_PATH) {
    const p = join(process.env.SEEFLOW_VIEWER_PATH, VIEWER_TAIL);
    if (existsSync(p)) return p;
  }
  // Sibling to the studio repo root. From integration/, ../../../.. lands at
  // the parent of the studio repo regardless of worktree depth, as long as
  // the integration dir is at <repo>/apps/studio/integration.
  const sibling = resolve(import.meta.dir, '..', '..', '..', '..', 'seeflow-viewer', VIEWER_TAIL);
  if (existsSync(sibling)) return sibling;
  const dev = join('/Users/tuongaz/dev/seeflow-viewer', VIEWER_TAIL);
  if (existsSync(dev)) return dev;
  return null;
}

describe('integration: share-rpc-schema sync', () => {
  const viewerPath = resolveViewerPath();

  it('studio + viewer copies match byte-for-byte', () => {
    if (!viewerPath) {
      // Soft-skip: print a marker so the run logs explain the no-op.
      console.warn(
        '[share-rpc-schema-sync] viewer repo not found — skipping. ' +
          'Set SEEFLOW_VIEWER_PATH or check out seeflow-viewer as a sibling.',
      );
      return;
    }
    const studio = readFileSync(STUDIO_REL);
    const viewer = readFileSync(viewerPath);
    expect(studio.equals(viewer)).toBe(true);
  });
});
