import { describe, expect, it } from 'bun:test';
import { readBootConfig } from './boot-config';

describe('readBootConfig', () => {
  it('returns null when no global is present', () => {
    expect(readBootConfig({} as Window & typeof globalThis)).toBeNull();
  });
  it('parses a well-formed boot config', () => {
    const w = {
      __SEEFLOW_BOOT__: { base: '/p/abc', projectSlug: 'meally', flowId: 'main', mode: 'edit' },
    };
    expect(readBootConfig(w as unknown as Window & typeof globalThis)).toEqual({
      base: '/p/abc',
      projectSlug: 'meally',
      flowId: 'main',
      mode: 'edit',
    });
  });
  it('returns null when required fields are missing', () => {
    const w = { __SEEFLOW_BOOT__: { base: '/p/abc' } };
    expect(readBootConfig(w as unknown as Window & typeof globalThis)).toBeNull();
  });
  it('returns null when mode is invalid', () => {
    const w = {
      __SEEFLOW_BOOT__: { base: '/p/abc', projectSlug: 'm', flowId: 'main', mode: 'nope' },
    };
    expect(readBootConfig(w as unknown as Window & typeof globalThis)).toBeNull();
  });
});
