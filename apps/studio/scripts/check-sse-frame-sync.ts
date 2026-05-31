#!/usr/bin/env bun
/**
 * Verifies that the SSE payload schema in `apps/studio/src/share/sse-frame.ts`
 * (studio source of truth) is byte-identical (modulo comments + whitespace)
 * to the peer SPA's mirror at `seeflow-viewer/src/lib/share-sse-frame.ts`.
 *
 * Compares only the region between `// SYNC-WITH-PEER:BEGIN` and
 * `// SYNC-WITH-PEER:END` markers, so studio-only additions (e.g. the
 * `wrapAsSseFrame` helper that depends on the host's `StudioEvent` type)
 * don't trip the check.
 *
 * Exit codes:
 *   0  in sync (or peer file missing — soft pass with warning for CI in
 *      contexts where seeflow-viewer is not checked out adjacent)
 *   1  shared region diverged — prints unified-ish diff and fails
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STUDIO_PATH = resolve(import.meta.dir, '..', 'src', 'share', 'sse-frame.ts');
const PEER_REL = ['seeflow-viewer', 'src', 'lib', 'share-sse-frame.ts'];

function buildPeerCandidates(): string[] {
  const candidates: string[] = [];
  let dir = import.meta.dir;
  for (let i = 0; i < 8; i += 1) {
    candidates.push(resolve(dir, ...PEER_REL));
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return candidates;
}

const PEER_PATH_CANDIDATES = buildPeerCandidates();

const BEGIN_MARKER = '// SYNC-WITH-PEER:BEGIN';
const END_MARKER = '// SYNC-WITH-PEER:END';

function extractSharedRegion(src: string, label: string): string {
  const beginIdx = src.indexOf(BEGIN_MARKER);
  const endIdx = src.indexOf(END_MARKER);
  if (beginIdx < 0 || endIdx < 0 || endIdx < beginIdx) {
    throw new Error(`[check-sse-frame-sync] ${label} missing SYNC-WITH-PEER markers`);
  }
  return src.slice(beginIdx + BEGIN_MARKER.length, endIdx);
}

function normalize(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\s+/g, '')
    .trim();
}

function findPeerPath(): string | null {
  for (const candidate of PEER_PATH_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function main(): number {
  if (!existsSync(STUDIO_PATH)) {
    console.error(`[check-sse-frame-sync] studio file not found: ${STUDIO_PATH}`);
    return 1;
  }
  const peerPath = findPeerPath();
  if (!peerPath) {
    console.warn(
      `[check-sse-frame-sync] peer mirror not found; tried:\n  ${PEER_PATH_CANDIDATES.join('\n  ')}\nSkipping sync check (seeflow-viewer is a sibling repo; check from CI that mounts it).`,
    );
    return 0;
  }

  const studioSrc = readFileSync(STUDIO_PATH, 'utf8');
  const peerSrc = readFileSync(peerPath, 'utf8');

  const studioRegion = extractSharedRegion(studioSrc, 'studio');
  const peerRegion = extractSharedRegion(peerSrc, 'peer');

  const studioNorm = normalize(studioRegion);
  const peerNorm = normalize(peerRegion);

  if (studioNorm === peerNorm) {
    console.log('[check-sse-frame-sync] OK — studio and peer SSE frame schemas in sync.');
    return 0;
  }

  console.error('[check-sse-frame-sync] DRIFT — studio and peer SSE frame schemas diverge.');
  console.error(`  studio: ${STUDIO_PATH}`);
  console.error(`  peer:   ${peerPath}`);
  console.error('--- studio (normalized) ---');
  console.error(studioNorm);
  console.error('--- peer (normalized) ---');
  console.error(peerNorm);
  return 1;
}

if (import.meta.main) {
  process.exit(main());
}

export { extractSharedRegion, normalize, findPeerPath };
