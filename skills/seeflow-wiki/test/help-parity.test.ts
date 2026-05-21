import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('seeflow-wiki <-> CLI help', () => {
  it('tells the agent to consult `seeflow help` as the source of truth', () => {
    const skill = readFileSync(resolve(__dirname, '../SKILL.md'), 'utf8');
    expect(skill).toContain('seeflow help');
    expect(skill).toContain('npx -y @tuongaz/seeflow@latest help');
  });

  it('`seeflow help` runs successfully and produces output', () => {
    const localBin = resolve(__dirname, '../../../apps/studio/bin/seeflow');
    const result = spawnSync(localBin, ['help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });
});
