import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Flow } from './schema.ts';
import { EMIT_TEMPLATE } from './sdk-template.ts';

export type SdkWriteOutcome = 'skipped' | 'written' | 'present';

export interface SdkWriteResult {
  outcome: SdkWriteOutcome;
  /** Absolute path of the SDK file (written or pre-existing). Null on `skipped`. */
  filePath: string | null;
}

/**
 * Writes `sdk/emit.ts` into a target repo iff the demo declares any node with
 * `stateSource.kind === 'event'`. Idempotent: existing files are never
 * overwritten. The only place M1's CLI mutates a user repo.
 */
export function writeSdkEmitIfNeeded(repoPath: string, demo: Flow): SdkWriteResult {
  const hasEventState = demo.nodes.some(
    (n) =>
      n.type !== 'shapeNode' &&
      n.type !== 'imageNode' &&
      n.type !== 'iconNode' &&
      n.type !== 'htmlNode' &&
      n.data.stateSource.kind === 'event',
  );
  if (!hasEventState) return { outcome: 'skipped', filePath: null };

  const sdkDir = join(repoPath, 'sdk');
  const filePath = join(sdkDir, 'emit.ts');
  if (existsSync(filePath)) return { outcome: 'present', filePath };

  mkdirSync(sdkDir, { recursive: true });
  writeFileSync(filePath, EMIT_TEMPLATE);
  return { outcome: 'written', filePath };
}
