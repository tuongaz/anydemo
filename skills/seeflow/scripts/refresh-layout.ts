#!/usr/bin/env bun
import { resolveStudioUrl } from './studio-config';

export interface RefreshLayoutArgs {
  flowId: string;
  url?: string;
}

export interface RefreshLayoutResult {
  ok: boolean;
  status: number;
  body: unknown;
  url: string;
}

export async function refreshLayout(args: RefreshLayoutArgs): Promise<RefreshLayoutResult> {
  const url = args.url ?? resolveStudioUrl();
  const res = await globalThis.fetch(`${url}/api/flows/${args.flowId}/layout`, {
    method: 'POST',
  });

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
  const ok =
    res.ok && typeof body === 'object' && body !== null && (body as { ok?: unknown }).ok === true;
  return { ok, status: res.status, body, url };
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
  const flowId = flagValue(argv, 'id') ?? argv[0];
  if (!flowId || flowId.startsWith('--')) {
    process.stderr.write('Usage: refresh-layout.ts <flowId> | --id <flowId>\n');
    return 1;
  }

  const result = await refreshLayout({ flowId });
  if (!result.ok) {
    const text =
      typeof result.body === 'string' ? result.body : JSON.stringify(result.body ?? null);
    process.stderr.write(`layout failed for ${flowId}: ${text}\n`);
    return 1;
  }
  process.stdout.write(`${JSON.stringify(result.body)}\n`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
