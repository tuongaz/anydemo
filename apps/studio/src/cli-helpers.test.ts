import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBody } from './cli-helpers.ts';

describe('loadBody', () => {
  it('reads inline JSON from --json', async () => {
    const body = await loadBody({ json: '{"a":1}', file: undefined, stdin: false }, async () => '');
    expect(body).toEqual({ a: 1 });
  });

  it('reads a file from --file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seeflow-cli-helpers-'));
    const file = join(dir, 'body.json');
    writeFileSync(file, '{"hello":"world"}');
    const body = await loadBody({ json: undefined, file, stdin: false }, async () => '');
    expect(body).toEqual({ hello: 'world' });
  });

  it('reads stdin when --stdin set', async () => {
    const body = await loadBody(
      { json: undefined, file: undefined, stdin: true },
      async () => '{"from":"stdin"}',
    );
    expect(body).toEqual({ from: 'stdin' });
  });

  it('throws when more than one input source provided', async () => {
    await expect(
      loadBody({ json: '{}', file: '/tmp/x', stdin: false }, async () => ''),
    ).rejects.toThrow(/exactly one of --json, --file, --stdin/);
  });

  it('throws when none provided', async () => {
    await expect(
      loadBody({ json: undefined, file: undefined, stdin: false }, async () => ''),
    ).rejects.toThrow(/exactly one of --json, --file, --stdin/);
  });

  it('throws on malformed JSON with the file path in the message', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seeflow-cli-helpers-'));
    const file = join(dir, 'bad.json');
    writeFileSync(file, '{not json');
    await expect(loadBody({ json: undefined, file, stdin: false }, async () => '')).rejects.toThrow(
      new RegExp(file.replace(/\//g, '\\/')),
    );
  });
});
