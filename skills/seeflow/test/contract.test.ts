import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
    for (const cmd of [
      'projects:create',
      'flow:add-bulk',
      'nodes:patch',
      'flows:layout',
      'ids',
      'schema',
    ]) {
      expect(skill).toContain(cmd);
    }
  });

  it('SKILL.md tells the agent to discover CLI shape via `$SEEFLOW help`', () => {
    const skill = readFileSync(SKILL_MD, 'utf8');
    expect(skill).toContain('$SEEFLOW help');
  });

  it('no skill or agent prompt references the removed Play/Status feature', () => {
    // The Play-script + Status-probe + component-script-action feature was removed.
    // No prose, schema example, or agent contract may resurrect its node
    // capabilities, designers, or runtime tokens.
    const banned = [
      /\bplayAction\b/,
      /\bstatusAction\b/,
      /\bstateSource\b/,
      /\bStatusReport\b/,
      /\bplay-designer\b/,
      /\bstatus-designer\b/,
      /seeflow-play-designer/,
      /seeflow-status-designer/,
      /scripts\/(?:play|status)/,
    ];
    const docs = [
      { path: SKILL_MD, body: readFileSync(SKILL_MD, 'utf8') },
      ...readAllMarkdown(AGENTS_DIR),
      ...readAllMarkdown(REFERENCES_DIR),
    ];
    for (const { path, body } of docs) {
      for (const pattern of banned) {
        const match = pattern.exec(body);
        if (match) {
          const line = body.slice(0, match.index).split('\n').length;
          throw new Error(`${path}:${line} references removed Play/Status token "${match[0]}"`);
        }
      }
    }
  });

  it('the Play/Status designer agent prompts are deleted', () => {
    for (const stale of ['seeflow-play-designer.md', 'seeflow-status-designer.md']) {
      expect(existsSync(join(AGENTS_DIR, stale))).toBe(false);
    }
  });

  it('the play/status overlay + validation phase docs are deleted', () => {
    const phasesDir = join(REFERENCES_DIR, 'phases');
    for (const stale of ['p4-design-overlays.md', 'p5-patch-overlays.md', 'p6-validation.md']) {
      expect(existsSync(join(phasesDir, stale))).toBe(false);
    }
  });

  it('`seeflow help` runs successfully and produces output', () => {
    const localBin = resolve(__dirname, '../../../apps/studio/bin/seeflow');
    const result = Bun.spawnSync({ cmd: [localBin, 'help'] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().length).toBeGreaterThan(0);
  });
});
