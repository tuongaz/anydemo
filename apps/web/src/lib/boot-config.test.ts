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
  it('parses a boot config without a flowId (flowId optional)', () => {
    const w = {
      __SEEFLOW_BOOT__: { base: '/p/abc', projectSlug: 'meally', mode: 'edit' },
    };
    expect(readBootConfig(w as unknown as Window & typeof globalThis)).toEqual({
      base: '/p/abc',
      projectSlug: 'meally',
      flowId: undefined,
      mode: 'edit',
    });
  });
  it('parses a projectId when the host injects one', () => {
    const w = {
      __SEEFLOW_BOOT__: {
        base: '/p/abc',
        projectSlug: 'meally',
        projectId: 'uuid-123',
        flowId: 'main',
        mode: 'edit',
      },
    };
    expect(readBootConfig(w as unknown as Window & typeof globalThis)).toEqual({
      base: '/p/abc',
      projectSlug: 'meally',
      projectId: 'uuid-123',
      flowId: 'main',
      mode: 'edit',
    });
  });
  it('returns null when projectId is present but not a string', () => {
    const w = {
      __SEEFLOW_BOOT__: { base: '/p/abc', projectSlug: 'm', projectId: 7, mode: 'edit' },
    };
    expect(readBootConfig(w as unknown as Window & typeof globalThis)).toBeNull();
  });
  it('returns null when flowId is present but not a string', () => {
    const w = {
      __SEEFLOW_BOOT__: { base: '/p/abc', projectSlug: 'm', flowId: 42, mode: 'edit' },
    };
    expect(readBootConfig(w as unknown as Window & typeof globalThis)).toBeNull();
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
  it('returns null when called with no arguments (SSR / no window)', () => {
    expect(readBootConfig(undefined)).toBeNull();
  });
  it('returns null when __SEEFLOW_BOOT__ is not an object', () => {
    const w = { __SEEFLOW_BOOT__: 'nope' };
    expect(readBootConfig(w as unknown as Window & typeof globalThis)).toBeNull();
  });
});
