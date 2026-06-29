import { describe, expect, it } from 'bun:test';
import { COMMAND_MANIFEST, renderCommandHelp, renderCommandList } from './cli-manifest.ts';

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
        'flows:create',
        'flows:rename',
        'flows:delete',
        'flows:layout',
        'flow:add-bulk',
        'projects:create',
        'projects:list',
        'export',
        'nodes:add',
        'nodes:get',
        'nodes:patch',
        'nodes:move',
        'nodes:reorder',
        'nodes:delete',
        'connectors:add',
        'connectors:patch',
        'connectors:delete',
        'validate',
        'schema',
        'ids',
        'icons:list',
        'icons:add',
        'icons:update',
        'icons:remove',
      ].sort(),
    );
  });

  it('has no commands that require a running studio', () => {
    const live = COMMAND_MANIFEST.filter((e) => e.requiresStudio).map((e) => e.name);
    expect(live).toEqual([]);
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

  it('labels the ids command with outputKind: "text"', () => {
    const ids = COMMAND_MANIFEST.find((e) => e.name === 'ids');
    expect(ids?.outputKind).toBe('text');
  });

  it('locks the ids command shape: `<type> <count>`, no flags, both examples present', () => {
    const ids = COMMAND_MANIFEST.find((e) => e.name === 'ids');
    expect(ids).toBeDefined();
    expect(ids?.synopsis).toBe('seeflow ids <type> <count>');
    expect(ids?.args.map((a) => a.name)).toEqual(['type', 'count']);
    expect(ids?.args.every((a) => a.required)).toBe(true);
    expect(ids?.flags).toEqual([]);
    expect(ids?.requiresStudio).toBe(false);
    expect(ids?.examples).toEqual(['seeflow ids node 10', 'seeflow ids connector 5']);
  });

  it('every other command defaults outputKind to "json" (or leaves it undefined)', () => {
    const nonJson = new Set(['start', 'stop', 'ids']);
    for (const entry of COMMAND_MANIFEST) {
      if (nonJson.has(entry.name)) continue;
      expect(entry.outputKind ?? 'json').toBe('json');
    }
  });
});

describe('renderCommandHelp', () => {
  it('throws for an unknown command', () => {
    expect(() => renderCommandHelp('nope:nope')).toThrow();
  });

  it('renders a body-bearing JSON command with all sections (nodes:patch)', () => {
    const out = renderCommandHelp('nodes:patch');
    expect(out).toMatch(/^# nodes:patch/m);
    expect(out).toContain('## Synopsis');
    expect(out).toContain('## Arguments');
    expect(out).toContain('## Flags');
    expect(out).toContain('## Input (body)');
    // schemaRef NodePatchBody resolves via zod-to-json-schema
    expect(out).toContain('"type": "object"');
    // output envelope
    expect(out).toContain('## Output');
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

  it('omits the Arguments section for commands with no positionals (flows:get)', () => {
    const out = renderCommandHelp('flows:get');
    expect(out).not.toContain('## Input (body)');
    expect(out).not.toContain('## Arguments');
    expect(out).toContain('## Flags');
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
