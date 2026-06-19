import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_CLOUD_ENDPOINT,
  clearCredential,
  credentialsPath,
  loadCredential,
  readCredentials,
  saveCredential,
} from './credentials.ts';

describe('credentials store', () => {
  let dir: string;
  const origXdg = process.env.XDG_CONFIG_HOME;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'seeflow-creds-'));
    process.env.XDG_CONFIG_HOME = dir;
  });
  afterEach(() => {
    if (origXdg === undefined) Reflect.deleteProperty(process.env, 'XDG_CONFIG_HOME');
    else process.env.XDG_CONFIG_HOME = origXdg;
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults the cloud endpoint to https://cloud.seeflow.dev', () => {
    expect(DEFAULT_CLOUD_ENDPOINT).toBe('https://cloud.seeflow.dev');
  });

  it('places credentials.json under $XDG_CONFIG_HOME/seeflow when set', () => {
    expect(credentialsPath()).toBe(join(dir, 'seeflow', 'credentials.json'));
  });

  it('round-trips a saved credential keyed by endpoint host', () => {
    saveCredential({
      endpoint: DEFAULT_CLOUD_ENDPOINT,
      token: 't0k',
      userId: 'u1',
      email: 'u1@x.dev',
    });
    const cred = loadCredential(DEFAULT_CLOUD_ENDPOINT);
    expect(cred).toMatchObject({ token: 't0k', userId: 'u1', email: 'u1@x.dev' });
    expect(typeof cred?.savedAt).toBe('string');
  });

  it('keys by host so different endpoints do not collide', () => {
    saveCredential({ endpoint: 'https://cloud.seeflow.dev', token: 'prod' });
    saveCredential({ endpoint: 'http://localhost:4321', token: 'dev' });
    expect(loadCredential('https://cloud.seeflow.dev')?.token).toBe('prod');
    expect(loadCredential('http://localhost:4321')?.token).toBe('dev');
  });

  it('writes the file with 0600 permissions', () => {
    saveCredential({ endpoint: DEFAULT_CLOUD_ENDPOINT, token: 't' });
    const mode = statSync(credentialsPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('clearCredential removes only the targeted endpoint', () => {
    saveCredential({ endpoint: 'https://cloud.seeflow.dev', token: 'prod' });
    saveCredential({ endpoint: 'http://localhost:4321', token: 'dev' });
    clearCredential('https://cloud.seeflow.dev');
    expect(loadCredential('https://cloud.seeflow.dev')).toBeUndefined();
    expect(loadCredential('http://localhost:4321')?.token).toBe('dev');
  });

  it('returns an empty object when no file exists', () => {
    expect(readCredentials()).toEqual({});
  });
});
