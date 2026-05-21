import { describe, expect, it } from 'bun:test';
import {
  COMMAND_MANIFEST,
  renderCommandHelp,
  renderCommandList,
  renderManifestJson,
} from './cli-manifest.ts';

describe('COMMAND_MANIFEST', () => {
  it('has an entry for every command the CLI dispatches on', () => {
    const names = COMMAND_MANIFEST.map((e) => e.name).sort();
    expect(names).toEqual(
      [
        'start',
        'stop',
        'version',
        'help',
        'register',
        'flows:register',
        'flows:list',
        'flows:summary',
        'flows:get',
        'flows:graph',
        'flows:delete',
        'flows:layout',
        'flows:play',
        'projects:create',
        'nodes:add',
        'nodes:add-bulk',
        'nodes:get',
        'nodes:patch',
        'nodes:move',
        'nodes:reorder',
        'nodes:delete',
        'connectors:add',
        'connectors:add-bulk',
        'connectors:patch',
        'connectors:delete',
        'validate',
        'e2e',
      ].sort(),
    );
  });

  it('marks live-only commands as requiresStudio: true', () => {
    const live = COMMAND_MANIFEST.filter((e) => e.requiresStudio).map((e) => e.name);
    expect(live.sort()).toEqual(['e2e', 'flows:play'].sort());
  });

  it('flag/arg names are unique within each command', () => {
    for (const entry of COMMAND_MANIFEST) {
      const flagNames = entry.flags.map((f) => f.name);
      expect(new Set(flagNames).size).toBe(flagNames.length);
      const argNames = entry.args.map((a) => a.name);
      expect(new Set(argNames).size).toBe(argNames.length);
    }
  });

  it('labels lifecycle commands with outputKind: "text"', () => {
    const start = COMMAND_MANIFEST.find((e) => e.name === 'start');
    const stop = COMMAND_MANIFEST.find((e) => e.name === 'stop');
    expect(start?.outputKind).toBe('text');
    expect(stop?.outputKind).toBe('text');
  });

  it('labels live SSE commands with outputKind: "stream"', () => {
    const play = COMMAND_MANIFEST.find((e) => e.name === 'flows:play');
    const e2e = COMMAND_MANIFEST.find((e) => e.name === 'e2e');
    expect(play?.outputKind).toBe('stream');
    expect(e2e?.outputKind).toBe('stream');
  });

  it('every other command defaults outputKind to "json" (or leaves it undefined)', () => {
    const textOrStream = new Set(['start', 'stop', 'flows:play', 'e2e']);
    for (const entry of COMMAND_MANIFEST) {
      if (textOrStream.has(entry.name)) continue;
      expect(entry.outputKind ?? 'json').toBe('json');
    }
  });
});

describe('renderManifestJson', () => {
  it('returns the manifest as parseable JSON with a version + commands key', () => {
    const out = renderManifestJson();
    const parsed = JSON.parse(out) as {
      version: string;
      commands: unknown[];
    };
    expect(typeof parsed.version).toBe('string');
    expect(Array.isArray(parsed.commands)).toBe(true);
    expect(parsed.commands.length).toBe(COMMAND_MANIFEST.length);
  });
});

describe('renderCommandHelp', () => {
  it('throws for an unknown command', () => {
    expect(() => renderCommandHelp('nope:nope')).toThrow();
  });

  it('renders a body-bearing JSON command with all sections (nodes:add)', () => {
    const out = renderCommandHelp('nodes:add');
    expect(out).toMatch(/^# nodes:add/m);
    expect(out).toContain('## Synopsis');
    expect(out).toContain('## Arguments');
    expect(out).toContain('## Flags');
    expect(out).toContain('## Input (body)');
    // example body
    expect(out).toContain('Example body');
    expect(out).toContain('"stateNode"');
    // output envelope
    expect(out).toContain('## Output');
    expect(out).toContain('"ok": true');
    expect(out).toContain('"error"');
    expect(out).toContain('"code"');
    // per-command exit-code table
    expect(out).toMatch(/flowNotFound.*exit 3/);
    expect(out).toMatch(/badSchema.*exit 2/);
    expect(out).toMatch(/writeFailed.*exit 5/);
    // examples + requires-studio
    expect(out).toContain('## Examples');
    expect(out).toContain('Requires studio running: no');
  });

  it('omits the Input section for commands with no body (flows:get)', () => {
    const out = renderCommandHelp('flows:get');
    expect(out).not.toContain('## Input (body)');
    expect(out).toContain('## Arguments');
    expect(out).toContain('## Output');
  });

  it('inlines the JSON Schema for body commands whose schemaRef resolves', () => {
    const out = renderCommandHelp('nodes:patch');
    expect(out).toContain('## Input (body)');
    // schemaRef NodePatchBody resolves via zod-to-json-schema
    expect(out).toContain('"type": "object"');
  });
});

describe('renderCommandHelp — text output', () => {
  it('does NOT advertise a JSON envelope for start', () => {
    const out = renderCommandHelp('start');
    expect(out).toContain('## Output');
    expect(out).toContain('human-readable');
    expect(out).not.toContain('"ok": true'); // no JSON envelope claim
    // Real example lines from cli.ts
    expect(out).toMatch(/SeeFlow Studio (listening|started)/);
  });

  it('does NOT advertise a JSON envelope for stop', () => {
    const out = renderCommandHelp('stop');
    expect(out).not.toContain('"ok": true');
    expect(out).toMatch(/Stopped studio|No studio running/);
  });
});

describe('renderCommandHelp — stream output', () => {
  it('documents SSE-style streaming for flows:play', () => {
    const out = renderCommandHelp('flows:play');
    expect(out).toContain('## Output');
    expect(out).toContain('Streams progress events to stdout until the run completes.');
    expect(out).toContain('Exit 0 on success, non-zero on failure.');
    // per-command flavor text — Triggers the node…
    expect(out).toContain('Triggers the node');
    expect(out).toContain('Requires studio running: yes');
  });

  it('documents streaming for e2e', () => {
    const out = renderCommandHelp('e2e');
    expect(out).toContain('## Output');
    expect(out).toContain('Streams progress events to stdout until the run completes.');
    expect(out).toContain('Exit 0 on success, non-zero on failure.');
    // per-command flavor text — topological order
    expect(out).toContain('topological order');
    expect(out).toContain('Requires studio running: yes');
  });
});

describe('renderCommandList', () => {
  it('opens with the drill-in instruction before anything else', () => {
    const out = renderCommandList();
    const lines = out.split('\n').filter((l) => l.trim().length > 0);
    // Drill-in line must appear before the first category header.
    const firstCategoryIdx = lines.findIndex((l) => l.startsWith('## '));
    const drillInIdx = lines.findIndex((l) => l.includes('seeflow help <command>'));
    expect(drillInIdx).toBeGreaterThanOrEqual(0);
    expect(drillInIdx).toBeLessThan(firstCategoryIdx);
  });

  it('includes a calling-convention preamble', () => {
    const out = renderCommandList();
    expect(out).toContain('Calling convention');
    // body delivery modes
    expect(out).toContain('--json');
    expect(out).toContain('--file');
    expect(out).toContain('--stdin');
    // success envelope
    expect(out).toContain('"ok": true');
    // error envelope
    expect(out).toContain('"error"');
    expect(out).toContain('"code"');
    // exit-code map (sample entries)
    expect(out).toMatch(/badSchema.*exit 2/);
    expect(out).toMatch(/flowNotFound.*exit 3/);
  });

  it('still lists every command after the preamble', () => {
    const out = renderCommandList();
    for (const entry of COMMAND_MANIFEST) {
      expect(out).toContain(entry.name);
    }
  });
});
