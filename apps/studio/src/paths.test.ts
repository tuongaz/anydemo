import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  PROJECT_FLOW_FILENAME,
  projectFlowPath,
  projectNodeDir,
  projectNodesRoot,
  projectSdkDir,
  seeflowHome,
} from './paths.ts';

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

  it('nests under users/<tenantId> when a tenant id is passed (workspace set)', () => {
    process.env.SEEFLOW_WORKSPACE = '/workspace';
    expect(seeflowHome('user_abc')).toBe('/workspace/users/user_abc/.seeflow');
  });

  it('nests under users/<tenantId> when a tenant id is passed (home fallback)', () => {
    expect(seeflowHome('user_abc')).toBe(
      join(homedir(), '.seeflow', 'users', 'user_abc', '.seeflow'),
    );
  });

  it('treats an empty tenant id like no tenant (single-tenant path)', () => {
    process.env.SEEFLOW_WORKSPACE = '/workspace';
    expect(seeflowHome('')).toBe('/workspace/.seeflow');
  });
});

describe('project path helpers', () => {
  it('PROJECT_FLOW_FILENAME is flow.json', () => {
    expect(PROJECT_FLOW_FILENAME).toBe('flow.json');
  });

  it('projectFlowPath joins repoPath with flow.json', () => {
    expect(projectFlowPath('/repo')).toBe('/repo/flow.json');
  });

  it('projectNodesRoot joins repoPath with nodes', () => {
    expect(projectNodesRoot('/repo')).toBe('/repo/nodes');
  });

  it('projectNodeDir joins repoPath with nodes/<id>', () => {
    expect(projectNodeDir('/repo', 'node-abc')).toBe('/repo/nodes/node-abc');
  });

  it('projectSdkDir joins repoPath with sdk', () => {
    expect(projectSdkDir('/repo')).toBe('/repo/sdk');
  });
});
