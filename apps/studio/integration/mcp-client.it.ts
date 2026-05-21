import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { type McpClient, spawnMcpClient } from './support/mcp-client.ts';
import { type StudioHandle, spawnStudio } from './support/studio-harness.ts';

describe('integration: mcp client', () => {
  let studio: StudioHandle;
  let client: McpClient;

  beforeAll(async () => {
    studio = await spawnStudio();
    client = await spawnMcpClient({
      SEEFLOW_STUDIO_URL: `${studio.baseURL}/mcp`,
    });
  });

  afterAll(async () => {
    if (client) await client.close();
    if (studio) await studio.stop();
  });

  it('listTools returns a non-empty array containing seeflow_list_flows', async () => {
    const result = await client.listTools();
    expect(Array.isArray(result.tools)).toBe(true);
    expect(result.tools.length).toBeGreaterThan(0);
    const names = result.tools.map((t) => t.name);
    // seeflow_list_flows is the wire-level rename of the legacy "listDemos"
    // tool the PRD referenced. Verified against apps/studio/src/mcp.ts.
    expect(names).toContain('seeflow_list_flows');
  });
});
