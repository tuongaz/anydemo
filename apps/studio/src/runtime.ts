import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { seeflowHome } from './paths.ts';

export interface StudioConfig {
  port: number;
  host: string;
}

export const DEFAULT_CONFIG: StudioConfig = { port: 4321, host: '0.0.0.0' };

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
