import { describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readCloudProjectId, writeCloudProjectId } from './cloud-meta.ts';

describe('cloud-meta', () => {
  test('round-trips the cloud project id under <root>/.seeflow/cloud.json', () => {
    const root = join(tmpdir(), `sf-meta-${crypto.randomUUID()}`);
    mkdirSync(root, { recursive: true });
    expect(readCloudProjectId(root, 'https://cloud.seeflow.dev')).toBeNull();
    writeCloudProjectId(root, 'https://cloud.seeflow.dev', 'proj_abc');
    expect(readCloudProjectId(root, 'https://cloud.seeflow.dev')).toBe('proj_abc');
  });

  test('keyed by base URL so two clouds do not collide', () => {
    const root = join(tmpdir(), `sf-meta-${crypto.randomUUID()}`);
    mkdirSync(root, { recursive: true });
    writeCloudProjectId(root, 'https://a.dev', 'pa');
    writeCloudProjectId(root, 'https://b.dev', 'pb');
    expect(readCloudProjectId(root, 'https://a.dev')).toBe('pa');
    expect(readCloudProjectId(root, 'https://b.dev')).toBe('pb');
  });
});
