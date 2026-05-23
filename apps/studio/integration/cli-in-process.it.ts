import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { slugify } from '../src/registry.ts';
import { runCli } from './support/cli-runner.ts';
import { uniqueFlowId } from './support/ids.ts';
import { connectSse } from './support/sse-client.ts';
import { type StudioHandle, spawnStudio } from './support/studio-harness.ts';

// In-process CLI mutations land on disk via the registry path the studio
// shares. The studio's flow watcher detects the disk write and broadcasts
// flow:reload; the registry watcher detects registry.json writes and
// broadcasts registry:reload on the __registry__ channel. These tests
// confirm that round-trip works end-to-end with the CLI as the writer.
describe('integration: CLI in-process mutations → studio watcher broadcasts', () => {
  let studio: StudioHandle;
  let cliEnv: Record<string, string>;

  beforeAll(async () => {
    studio = await spawnStudio();
    cliEnv = {
      SEEFLOW_STUDIO_URL: studio.baseURL,
      SEEFLOW_WORKSPACE: studio.home,
    };
  });

  afterAll(async () => {
    if (studio) await studio.stop();
  });

  async function createProject(name: string): Promise<{ id: string; slug: string }> {
    const res = await fetch(`${studio.baseURL}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: join(studio.workspace, slugify(name)), name }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as { id: string; slug: string };
  }

  it('CLI nodes:add triggers flow:reload via the studio watcher', async () => {
    const name = uniqueFlowId('inproc-flow-reload');
    const project = await createProject(name);

    const sse = await connectSse(studio.baseURL, `/api/events?flowId=${project.id}`);
    try {
      await sse.waitFor((e) => e.event === 'hello', 2_000);

      const r = await runCli(
        [
          'nodes:add',
          project.id,
          '--no-start',
          '--json',
          JSON.stringify({
            id: 'observed',
            type: 'rectangle',
            data: { name: 'observed' },
          }),
        ],
        { env: cliEnv },
      );
      expect(r.code).toBe(0);

      const reload = await sse.waitFor((e) => e.event === 'flow:reload', 2_000);
      const parsed = JSON.parse(reload.data) as {
        valid?: boolean;
        flow?: { nodes?: Array<{ id: string }> };
      };
      expect(parsed.valid).toBe(true);
      expect(parsed.flow?.nodes?.map((n) => n.id)).toContain('observed');
    } finally {
      sse.close();
    }
  });

  it('external write to registry.json triggers registry:reload', async () => {
    const sse = await connectSse(studio.baseURL, '/api/registry/events');
    try {
      await sse.waitFor((e) => e.event === 'hello', 2_000);

      // Direct disk write simulates an external mutator (e.g. a CLI process
      // that hasn't yet been migrated in-process, or a manual edit). The
      // studio's hash ring won't recognize this content, so the watcher
      // broadcasts on the __registry__ channel.
      const registryPath = join(studio.workspace, 'registry.json');
      writeFileSync(
        registryPath,
        JSON.stringify(
          [
            {
              id: 'externally-injected',
              slug: 'externally-injected',
              name: 'externally injected',
              repoPath: '/tmp/nope',
              flowPath: 'flow.json',
              lastModified: 0,
              valid: true,
            },
          ],
          null,
          2,
        ),
      );

      await sse.waitFor((e) => e.event === 'registry:reload', 2_000);
    } finally {
      sse.close();
    }
  });
});
