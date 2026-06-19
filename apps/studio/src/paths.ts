import { homedir } from 'node:os';
import { join } from 'node:path';

// Base dir for studio state (registry.json, config.json, seeflow.pid, and
// newly-created project folders). When SEEFLOW_WORKSPACE is set — notably
// inside the Docker image, where it defaults to /workspace — state lands in
// the bind-mounted workspace so it survives `docker run --rm`. Otherwise it
// falls back to ~/.seeflow for local installs.
export function seeflowHome(tenantId?: string): string {
  const workspace = process.env.SEEFLOW_WORKSPACE;
  const base = workspace && workspace.length > 0 ? join(workspace, '.seeflow') : join(homedir(), '.seeflow');
  if (tenantId && tenantId.length > 0) {
    // Per-tenant nesting per the cloud tenancy design (§6.1):
    //   workspace set -> <workspace>/users/<tenantId>/.seeflow
    //   home fallback -> ~/.seeflow/users/<tenantId>/.seeflow
    // The root differs so single- and multi-tenant layouts share one tree.
    const root = workspace && workspace.length > 0 ? workspace : join(homedir(), '.seeflow');
    return join(root, 'users', tenantId, '.seeflow');
  }
  return base;
}

// Per-project layout: everything lives at the project root. The studio never
// assumes a `.seeflow/` subdirectory — whatever path the CLI / API was handed
// is treated as the seeflow project root. The `/seeflow` skill creates a
// `<host>/.seeflow/<flow-name>/` container per flow and passes that as the
// project path, but that's a skill convention, not a studio rule.
export const PROJECT_FLOW_FILENAME = 'flow.json';

export const projectFlowPath = (repoPath: string): string => join(repoPath, PROJECT_FLOW_FILENAME);

export const projectNodesRoot = (repoPath: string): string => join(repoPath, 'nodes');

export const projectNodeDir = (repoPath: string, nodeId: string): string =>
  join(repoPath, 'nodes', nodeId);

export const projectSdkDir = (repoPath: string): string => join(repoPath, 'sdk');
