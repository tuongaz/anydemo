import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const REQUIRED_SUBCOMMANDS = ['flows:summary', 'flows:graph', 'nodes:get'] as const;

function getHelpOutput(): string {
  const localBin = resolve(__dirname, '../../../apps/studio/bin/seeflow');
  const result = spawnSync(localBin, ['help'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`seeflow help failed: ${result.stderr}`);
  }
  return result.stdout;
}

function getSkillReferencedSubcommands(): string[] {
  const skill = readFileSync(resolve(__dirname, '../SKILL.md'), 'utf8');
  return REQUIRED_SUBCOMMANDS.filter((cmd) => skill.includes(cmd));
}

describe('seeflow-wiki <-> CLI help parity', () => {
  it('references at least the three required subcommands in SKILL.md', () => {
    expect(getSkillReferencedSubcommands().sort()).toEqual(
      [...REQUIRED_SUBCOMMANDS].sort(),
    );
  });

  it('every subcommand referenced in SKILL.md appears in `seeflow help`', () => {
    const help = getHelpOutput();
    for (const cmd of getSkillReferencedSubcommands()) {
      expect(help, `expected '${cmd}' in seeflow help`).toContain(cmd);
    }
  });
});
