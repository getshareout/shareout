import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

export const baseUrl = (
  process.env.SHAREOUT_E2E_BASE_URL ||
  process.env.SHAREOUT_BASE_URL ||
  'https://shareout.site'
).replace(/\/$/, '');

export const isProduction = baseUrl.includes('shareout.site');

export const canWrite = process.env.SHAREOUT_E2E_WRITE === '1';

export const allowCreateAccount =
  process.env.SHAREOUT_E2E_ALLOW_CREATE === '1' ||
  (canWrite && !hasAnyTokenSource());

export interface CredentialsFile {
  token?: string;
  user_id?: string;
  workspace_id?: string;
}

function readCredentialsFile(path: string): CredentialsFile | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as CredentialsFile;
  } catch {
    return null;
  }
}

/** Credential files checked in priority order (first match wins). */
export function credentialSearchPaths(): string[] {
  const paths = [
    process.env.SHAREOUT_CREDENTIALS,
    process.env.SHAREOUT_E2E_CREDENTIALS,
    join(homedir(), '.shareout', 'credentials'),
    join(packageRoot, '.credentials', 'credentials.json'),
    join(homedir(), '.shareout', 'credentials-enterprise-enterprise.json'),
    join(packageRoot, '.credentials', 'enterprise-enterprise.json'),
  ].filter(Boolean) as string[];

  return [...new Set(paths)];
}

export function resolveCredentialsPath(): string | null {
  for (const path of credentialSearchPaths()) {
    const creds = readCredentialsFile(path);
    if (creds?.token) return path;
  }
  return null;
}

function hasAnyTokenSource(): boolean {
  return Boolean(
    process.env.SHAREOUT_E2E_TOKEN ||
    process.env.SHAREOUT_TOKEN ||
    resolveCredentialsPath()
  );
}

export function loadCredentials(): CredentialsFile | null {
  const path = resolveCredentialsPath();
  if (!path) return null;
  return readCredentialsFile(path);
}

export function loadToken(which: 'primary' | 'secondary' = 'primary'): string | null {
  if (which === 'primary') {
    const fromEnv =
      process.env.SHAREOUT_E2E_TOKEN ||
      process.env.SHAREOUT_TOKEN;
    if (fromEnv) return fromEnv;

    const creds = loadCredentials();
    if (creds?.token) return creds.token;
  }

  if (which === 'secondary' && process.env.SHAREOUT_E2E_TOKEN_B) {
    return process.env.SHAREOUT_E2E_TOKEN_B;
  }

  return null;
}

export function uniqueSlug(prefix = 'e2e'): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${rand}`;
}
