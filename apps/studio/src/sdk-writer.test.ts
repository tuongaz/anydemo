import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Flow } from './schema.ts';
import { writeSdkEmitIfNeeded } from './sdk-writer.ts';

const REQUEST_DEMO: Flow = {
  version: 2,
  name: 'Request only',
  nodes: [
    {
      id: 'api-checkout',
      type: 'playNode',
      data: {
        name: 'POST /checkout',
        kind: 'service',
        stateSource: { kind: 'request' },
        playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/checkout.ts' },
      },
    },
  ],
  connectors: [],
};

const EVENT_DEMO: Flow = {
  ...REQUEST_DEMO,
  name: 'With worker',
  nodes: [
    ...REQUEST_DEMO.nodes,
    {
      id: 'worker',
      type: 'stateNode',
      data: {
        name: 'Worker',
        kind: 'worker',
        stateSource: { kind: 'event' },
      },
    },
  ],
};

const tmpRepo = (): string => mkdtempSync(join(tmpdir(), 'seeflow-sdk-writer-'));

describe('writeSdkEmitIfNeeded', () => {
  it('skips repos whose demo has no event-bound state node', () => {
    const repoPath = tmpRepo();
    const result = writeSdkEmitIfNeeded(repoPath, REQUEST_DEMO);
    expect(result.outcome).toBe('skipped');
    expect(result.filePath).toBeNull();
  });

  it('writes .seeflow/sdk/emit.ts when an event-bound state node is present', () => {
    const repoPath = tmpRepo();
    const result = writeSdkEmitIfNeeded(repoPath, EVENT_DEMO);
    expect(result.outcome).toBe('written');
    expect(result.filePath).toBe(join(repoPath, '.seeflow', 'sdk', 'emit.ts'));

    const written = readFileSync(result.filePath as string, 'utf-8');
    expect(written).toContain('export async function emit');
    expect(written).toContain('/api/emit');
    // Self-contained: no @seeflow/sdk import.
    expect(written).not.toContain('@seeflow/sdk');
  });

  it('does not overwrite an existing emit.ts (idempotent)', () => {
    const repoPath = tmpRepo();
    const filePath = join(repoPath, '.seeflow', 'sdk', 'emit.ts');
    mkdirSync(join(repoPath, '.seeflow', 'sdk'), { recursive: true });
    writeFileSync(filePath, '// USER EDITED\n');

    const result = writeSdkEmitIfNeeded(repoPath, EVENT_DEMO);
    expect(result.outcome).toBe('present');
    expect(result.filePath).toBe(filePath);
    expect(readFileSync(filePath, 'utf-8')).toBe('// USER EDITED\n');
  });
});
