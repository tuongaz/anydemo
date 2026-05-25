import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SKILL_ROOT = resolve(__dirname, '..');
const SKILL_MD = resolve(SKILL_ROOT, 'SKILL.md');
const AGENTS_DIR = resolve(SKILL_ROOT, 'agents');
const REFERENCES_DIR = resolve(SKILL_ROOT, 'references');

function readAllMarkdown(dir: string): { path: string; body: string }[] {
  const out: { path: string; body: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...readAllMarkdown(full));
    } else if (entry.endsWith('.md')) {
      out.push({ path: full, body: readFileSync(full, 'utf8') });
    }
  }
  return out;
}

describe('seeflow skill <-> CLI contract', () => {
  it('SKILL.md names every CLI subcommand the orchestrator depends on', () => {
    const skill = readFileSync(SKILL_MD, 'utf8');
    for (const cmd of ['projects:create', 'flow:add-bulk', 'nodes:patch', 'flows:layout', 'e2e', 'ids', 'schema']) {
      expect(skill).toContain(cmd);
    }
  });

  it('SKILL.md tells the agent to discover CLI shape via `$SEEFLOW help`', () => {
    const skill = readFileSync(SKILL_MD, 'utf8');
    expect(skill).toContain('$SEEFLOW help');
  });

  it('no skill or agent prompt uses the legacy `<slug>/scripts/` prefix', () => {
    // The node-folder anchor (`scripts/play.ts`) replaced the legacy slug-prefixed
    // form; any reappearance regresses the play-designer / status-designer contract.
    // Allow `nodes/<id>/scripts/...` and explicit counter-examples inside fenced blocks.
    const docs = [
      { path: SKILL_MD, body: readFileSync(SKILL_MD, 'utf8') },
      ...readAllMarkdown(AGENTS_DIR),
      ...readAllMarkdown(REFERENCES_DIR),
    ];
    for (const { path, body } of docs) {
      const lines = body.split('\n');
      let fenceDepth = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trimStart().startsWith('```')) fenceDepth = fenceDepth === 0 ? 1 : 0;
        if (fenceDepth === 1) continue;
        const match = /([A-Za-z0-9_-]+)\/scripts\/(?:play|status)/.exec(line);
        if (!match) continue;
        const prefix = match[1];
        if (prefix === 'nodes' || prefix === '<nodeId>' || prefix === 'scripts') continue;
        throw new Error(`${path}:${i + 1} uses legacy "${match[0]}" prefix`);
      }
    }
  });

  it('`seeflow help` runs successfully and produces output', () => {
    const localBin = resolve(__dirname, '../../../apps/studio/bin/seeflow');
    const result = Bun.spawnSync({ cmd: [localBin, 'help'] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().length).toBeGreaterThan(0);
  });
});
