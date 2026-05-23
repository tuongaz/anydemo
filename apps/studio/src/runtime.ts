import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { seeflowHome } from './paths.ts';

export interface StudioConfig {
  port: number;
  host: string;
}

export const DEFAULT_CONFIG: StudioConfig = { port: 4321, host: '0.0.0.0' };

// Vite dev server port. `seeflow start` doesn't bind this — Vite (in apps/web)
// does — but the studio dev-mode proxy targets it, so a port collision here
// breaks the dev workflow just as surely as one on the studio port. The
// pre-flight check in the CLI surfaces both upfront with a clean error.
export const VITE_DEV_PORT = 5173;

export function defaultConfigPath(): string {
  return join(seeflowHome(), 'config.json');
}

export function defaultPidPath(): string {
  return join(seeflowHome(), 'seeflow.pid');
}

export function readConfig(path = defaultConfigPath()): StudioConfig {
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<StudioConfig>;
    return {
      port: typeof parsed.port === 'number' && parsed.port > 0 ? parsed.port : DEFAULT_CONFIG.port,
      host:
        typeof parsed.host === 'string' && parsed.host.length > 0
          ? parsed.host
          : DEFAULT_CONFIG.host,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(config: StudioConfig, path = defaultConfigPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2));
}

export function studioUrl(config: StudioConfig = readConfig()): string {
  return `http://${config.host}:${config.port}`;
}

export function writePid(pid: number, path = defaultPidPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, String(pid));
}

export function readPid(path = defaultPidPath()): number | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const raw = readFileSync(path, 'utf8').trim();
    const pid = Number(raw);
    if (!Number.isFinite(pid) || pid <= 0) return undefined;
    return pid;
  } catch {
    return undefined;
  }
}

export function clearPid(path = defaultPidPath()): void {
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch {
    // ignore — best-effort cleanup
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// `0.0.0.0` / `::` are wildcard bind addresses, not connectable destinations —
// probe loopback when the caller passes one. IPv6 unspecified `::` maps to
// `::1`; everything else is treated as IPv4 wildcard → `127.0.0.1`.
function probeHost(host: string): string {
  if (host === '::' || host === '[::]') return '::1';
  if (host === '0.0.0.0' || host === '') return '127.0.0.1';
  return host;
}

/**
 * Detects whether a TCP listener is responding on host:port. Uses a short
 * connect probe (300 ms default) so we catch actively-listening servers
 * without padding fast paths. Returns false on any connect error or timeout.
 */
export async function portInUse(host: string, port: number, timeoutMs = 300): Promise<boolean> {
  const hostname = probeHost(host);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const socket = await Promise.race([
      Bun.connect({
        hostname,
        port,
        socket: { data() {}, open() {}, close() {}, error() {} },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
    socket.end();
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
