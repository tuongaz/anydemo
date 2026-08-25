import { describe, expect, it } from 'bun:test';
import { flowPath, matchProjectAlone, matchProjectFlow, splitFlowSlug } from '@/lib/router';

describe('flowPath', () => {
  it('builds the /projects/:p/flows/:f grammar', () => {
    expect(flowPath('p', 'f')).toBe('/projects/p/flows/f');
  });

  it('percent-encodes reserved characters in both segments', () => {
    expect(flowPath('foo bar', 'baz/qux')).toBe('/projects/foo%20bar/flows/baz%2Fqux');
  });
});

describe('matchProjectFlow', () => {
  it('parses a canvas-page path', () => {
    expect(matchProjectFlow('/projects/p/flows/f')).toEqual({ project: 'p', flow: 'f' });
  });

  it('decodes percent-encoded segments', () => {
    expect(matchProjectFlow('/projects/foo%20bar/flows/baz')).toEqual({
      project: 'foo bar',
      flow: 'baz',
    });
  });

  it('returns null for the home path', () => {
    expect(matchProjectFlow('/')).toBeNull();
  });

  it('returns null for a project-only path', () => {
    expect(matchProjectFlow('/projects/p')).toBeNull();
  });

  it('returns null when the segment names do not match the grammar', () => {
    expect(matchProjectFlow('/flows/f')).toBeNull();
    expect(matchProjectFlow('/projects/p/demos/f')).toBeNull();
  });
});

describe('matchProjectAlone', () => {
  it('parses /projects/:project', () => {
    expect(matchProjectAlone('/projects/p')).toEqual({ project: 'p' });
  });

  it('decodes a percent-encoded project slug', () => {
    expect(matchProjectAlone('/projects/foo%20bar')).toEqual({ project: 'foo bar' });
  });

  it('returns null for the home path and for a full canvas path', () => {
    expect(matchProjectAlone('/')).toBeNull();
    expect(matchProjectAlone('/projects/p/flows/f')).toBeNull();
  });
});

describe('splitFlowSlug', () => {
  it('splits a registry slug into project + flow', () => {
    expect(splitFlowSlug('proj/main')).toEqual({ project: 'proj', flow: 'main' });
  });

  it('returns null when there is no separator or a side is empty', () => {
    expect(splitFlowSlug('proj')).toBeNull();
    expect(splitFlowSlug('/main')).toBeNull();
    expect(splitFlowSlug('proj/')).toBeNull();
  });
});
