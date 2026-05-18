import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { seeflowHome } from './paths.ts';

describe('seeflowHome', () => {
  const original = process.env.SEEFLOW_WORKSPACE;

  beforeEach(() => {
    Reflect.deleteProperty(process.env, 'SEEFLOW_WORKSPACE');
  });

  afterEach(() => {
    if (original === undefined) Reflect.deleteProperty(process.env, 'SEEFLOW_WORKSPACE');
    else process.env.SEEFLOW_WORKSPACE = original;
  });

  it('falls back to ~/.seeflow when SEEFLOW_WORKSPACE is unset', () => {
    expect(seeflowHome()).toBe(join(homedir(), '.seeflow'));
  });

  it('falls back to ~/.seeflow when SEEFLOW_WORKSPACE is the empty string', () => {
    process.env.SEEFLOW_WORKSPACE = '';
    expect(seeflowHome()).toBe(join(homedir(), '.seeflow'));
  });

  it('uses ${SEEFLOW_WORKSPACE}/.seeflow when the env var is set', () => {
    process.env.SEEFLOW_WORKSPACE = '/workspace';
    expect(seeflowHome()).toBe('/workspace/.seeflow');
  });
});
