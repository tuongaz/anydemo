import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Default hosted cloud endpoint. Overridable per call / via SEEFLOW_CLOUD_URL. */
export const DEFAULT_CLOUD_ENDPOINT = 'https://cloud.seeflow.dev';

export interface StoredCredential {
  token: string;
  userId?: string;
  email?: string;
  /** ISO-8601 timestamp set on save. */
  savedAt: string;
}

/** endpoint host -> credential. */
export type CredentialsFile = Record<string, StoredCredential>;

/**
 * Location of the shared credential file. Honors $XDG_CONFIG_HOME (Linux/XDG
 * convention) and falls back to ~/.seeflow. Both the CLI and the local studio
 * read/write this single file.
 */
export function credentialsPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) return join(xdg, 'seeflow', 'credentials.json');
  return join(homedir(), '.seeflow', 'credentials.json');
}

/** Normalize an endpoint URL to its host key (so trailing slashes/paths don't fork keys). */
export function endpointKey(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

export function readCredentials(): CredentialsFile {
  const path = credentialsPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as CredentialsFile) : {};
  } catch {
    return {};
  }
}

function writeCredentials(file: CredentialsFile): void {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2));
  // Tokens are secrets — owner-only.
  chmodSync(path, 0o600);
}

export interface SaveCredentialInput {
  endpoint: string;
  token: string;
  userId?: string;
  email?: string;
}

export function saveCredential(input: SaveCredentialInput): void {
  const file = readCredentials();
  file[endpointKey(input.endpoint)] = {
    token: input.token,
    userId: input.userId,
    email: input.email,
    savedAt: new Date().toISOString(),
  };
  writeCredentials(file);
}

export function loadCredential(endpoint: string): StoredCredential | undefined {
  return readCredentials()[endpointKey(endpoint)];
}

export function clearCredential(endpoint: string): void {
  const file = readCredentials();
  delete file[endpointKey(endpoint)];
  writeCredentials(file);
}
