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
  it('returns a multi-section help page for a known command', () => {
    const out = renderCommandHelp('nodes:add');
    expect(out).toContain('nodes:add');
    expect(out).toContain('Synopsis');
    expect(out).toContain('Flags');
    expect(out).toContain('Example');
  });

  it('throws for an unknown command', () => {
    expect(() => renderCommandHelp('nope:nope')).toThrow();
  });
});

describe('renderCommandList', () => {
  it('groups commands by category and lists every one', () => {
    const out = renderCommandList();
    for (const entry of COMMAND_MANIFEST) {
      expect(out).toContain(entry.name);
    }
  });
});
