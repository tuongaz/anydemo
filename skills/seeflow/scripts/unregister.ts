#!/usr/bin/env bun
import { resolveStudioUrl } from './studio-config';

export interface UnregisterArgs {
  id: string;
  url?: string;
}

export interface UnregisterResult {
  ok: boolean;
  status: number;
  body: unknown;
  url: string;
}

export async function unregisterDemo(args: UnregisterArgs): Promise<UnregisterResult> {
  const url = args.url ?? resolveStudioUrl();
  const res = await globalThis.fetch(`${url}/api/flows/${args.id}`, { method: 'DELETE' });

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    try {
      body = await res.text();
    } catch {
      body = null;
    }
  }
  return { ok: res.ok, status: res.status, body, url };
}

function flagValue(argv: string[], name: string): string | undefined {
  const flag = `--${name}`;
  const eqArg = argv.find((a) => a.startsWith(`${flag}=`));
  if (eqArg) return eqArg.slice(`${flag}=`.length);
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
  return undefined;
}

export async function main(argv: string[]): Promise<number> {
  const id = flagValue(argv, 'id');
  if (!id) {
    process.stderr.write('Usage: unregister.ts --id <flowId>\n');
    return 1;
  }
  const result = await unregisterDemo({ id });
  if (!result.ok) {
    const text =
      typeof result.body === 'string' ? result.body : JSON.stringify(result.body ?? null);
    process.stderr.write(`${text}\n`);
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
