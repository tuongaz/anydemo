import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SKILL_ROOT = resolve(__dirname, '..');
const SKILL_MD = resolve(SKILL_ROOT, 'SKILL.md');
const AGENTS_DIR = resolve(SKILL_ROOT, 'agents');
const REFERENCES_DIR = resolve(SKILL_ROOT, 'references');
const REPO_ROOT = resolve(SKILL_ROOT, '../..');

/** Source trees + docs the removed-feature guard sweeps alongside the skill.
 *  Deliberately excludes CHANGELOG.md and docs/adr/ — those are historical
 *  records whose whole job is to name what was removed. */
const GUARDED_FILES = ['README.md', 'docs/FEATURES.md', 'design/design.html', 'CONTEXT.md'];
const GUARDED_TREES = [
  'apps/studio/src',
  'apps/web/src',
  'apps/mcp-app/src',
  'packages/canvas/src',
];
const GUARDED_EXTS = ['.ts', '.tsx', '.css', '.html', '.md'];

function readAllSource(dir: string): { path: string; body: string }[] {
  const out: { path: string; body: string }[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...readAllSource(full));
    } else if (GUARDED_EXTS.some((ext) => entry.endsWith(ext))) {
      out.push({ path: full, body: readFileSync(full, 'utf8') });
    }
  }
  return out;
}

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

  it('no skill or agent prompt references a removed execution or cloud feature', () => {
    // The Play-script + Status-probe + component-script-action feature was
    // removed, and so were the flow-envelope reset action, the node-level
    // `handlerModule`, and the `--with-scripts` lookup flag. No prose, schema
    // example, or agent contract may resurrect their node capabilities,
    // designers, or runtime tokens.
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
      /\bscriptPath\b/,
      /\bresetAction\b/,
      /\bhandlerModule\b/,
      /--with-scripts/,
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
          throw new Error(`${path}:${line} references removed feature token "${match[0]}"`);
        }
      }
    }
  });

  it('no source file or user-facing doc references a removed execution or cloud feature', () => {
    // The scrub list that used to track this lived in docs/FEATURES.md
    // Appendix B, which went with the cloud sections (docs/adr/0002). This is
    // its replacement: the skill-only guard above missed the execution copy in
    // design.html and the "keeps scripts" comments in operations.ts precisely
    // because it never looked outside skills/.
    const banned = [
      /\bplayAction\b/,
      /\bstatusAction\b/,
      /\bStatusReport\b/,
      /scripts\/(?:play|status)/,
      /\bscriptPath\b/,
      /\bresetAction\b/,
      /\bhandlerModule\b/,
      /--with-scripts/,
      /cloud\.seeflow\.dev/,
      /\bSEEFLOW_CLOUD_URL\b/,
      /\bonExportToCloud\b/,
      /\bonShareWithMembers\b/,
      /\bopenEmbedDialog\b/,
      /\bcapturePreview\b/,
      /\bgetTenantId\b/,
      /\bresolveFileSrc\b/,
      /\bbuildEmbedSnippet\b/,
    ];
    const files = [
      ...GUARDED_FILES.map((rel) => ({
        path: join(REPO_ROOT, rel),
        body: readFileSync(join(REPO_ROOT, rel), 'utf8'),
      })),
      ...GUARDED_TREES.flatMap((rel) => readAllSource(join(REPO_ROOT, rel))),
    ];
    for (const { path, body } of files) {
      for (const pattern of banned) {
        const match = pattern.exec(body);
        if (match) {
          const line = body.slice(0, match.index).split('\n').length;
          throw new Error(`${path}:${line} references removed feature token "${match[0]}"`);
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
