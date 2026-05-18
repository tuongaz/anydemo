import { homedir } from 'node:os';
import { join } from 'node:path';

// Base dir for studio state (registry.json, config.json, seeflow.pid, and
// newly-created project folders). When SEEFLOW_WORKSPACE is set — notably
// inside the Docker image, where it defaults to /workspace — state lands in
// the bind-mounted workspace so it survives `docker run --rm`. Otherwise it
// falls back to ~/.seeflow for local installs.
export function seeflowHome(): string {
  const workspace = process.env.SEEFLOW_WORKSPACE;
  if (workspace && workspace.length > 0) return join(workspace, '.seeflow');
  return join(homedir(), '.seeflow');
}
