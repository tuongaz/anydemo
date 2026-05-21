import { describe, expect, it } from 'bun:test';
import { runCli } from './support/cli-runner.ts';

describe('integration: cli-runner', () => {
  it('runs `--help` and exits 0 with seeflow banner', async () => {
    const result = await runCli(['--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('seeflow');
    expect(result.durationMs).toBeGreaterThan(0);
  });
});
