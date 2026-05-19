export type EmitStatus = 'running' | 'done' | 'error';

export interface EmitOptions {
  /** Correlate downstream emits with the entry-node Play that triggered them. */
  runId?: string;
  /** Arbitrary JSON-serializable payload merged into the SSE event. */
  payload?: unknown;
  /** Override the studio URL (defaults to SEEFLOW_STUDIO_URL or localhost:4321). */
  studioUrl?: string;
}

const readEnv = (key: string): string | undefined => {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[key];
};

export async function emit(
  flowId: string,
  nodeId: string,
  status: EmitStatus,
  opts: EmitOptions = {},
): Promise<void> {
  const base = (opts.studioUrl ?? readEnv('SEEFLOW_STUDIO_URL') ?? 'http://localhost:4321').replace(
    /\/+$/,
    '',
  );
  await fetch(`${base}/api/emit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ flowId, nodeId, status, runId: opts.runId, payload: opts.payload }),
  });
}
