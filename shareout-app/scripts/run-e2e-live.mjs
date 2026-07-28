#!/usr/bin/env node
/**
 * Run live E2E tests against ShareOut production or local dev.
 *
 * Smoke (read-only, safe for prod):
 *   node scripts/run-e2e-live.mjs
 *
 * Full agent endpoint flows (15 workflows, uses ~/.shareout/credentials):
 *   node scripts/run-e2e-live.mjs --flows
 *   npm run test:e2e:live:flows
 *
 * Ephemeral account (only if no credentials file — rate limited on prod):
 *   node scripts/run-e2e-live.mjs --flows --create-account
 *
 * Local dev:
 *   node scripts/run-e2e-live.mjs --base-url=http://127.0.0.1:55162 --flows
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const args = process.argv.slice(2);
const flows = args.includes('--flows');
const createAccount = args.includes('--create-account');
const baseUrlArg = args.find((a) => a.startsWith('--base-url='))?.split('=').slice(1).join('=');

function findCredentialsPath() {
  const candidates = [
    process.env.SHAREOUT_CREDENTIALS,
    process.env.SHAREOUT_E2E_CREDENTIALS,
    join(homedir(), '.shareout', 'credentials'),
    join(root, '.credentials', 'credentials.json'),
    join(homedir(), '.shareout', 'credentials-studio-enterprise.json'),
    join(root, '.credentials', 'studio-enterprise.json'),
  ].filter(Boolean);

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'));
      if (data.token) return path;
    } catch {
      // skip invalid files
    }
  }
  return null;
}

const credPath = findCredentialsPath();
const hasEnvToken = Boolean(process.env.SHAREOUT_E2E_TOKEN || process.env.SHAREOUT_TOKEN);

const env = {
  ...process.env,
  SHAREOUT_E2E_BASE_URL: baseUrlArg || process.env.SHAREOUT_E2E_BASE_URL || 'https://shareout.site',
};

if (credPath && !env.SHAREOUT_CREDENTIALS) {
  env.SHAREOUT_CREDENTIALS = credPath;
}

if (flows) {
  env.SHAREOUT_E2E_WRITE = '1';
  if (createAccount && !hasEnvToken && !credPath) {
    env.SHAREOUT_E2E_ALLOW_CREATE = '1';
  }
}

const vitestArgs = ['vitest', 'run', '--config', 'vitest.e2e-live.config.ts'];

if (flows) {
  vitestArgs.push('tests/e2e-live/flows');
} else {
  vitestArgs.push('tests/e2e-live/smoke.test.ts');
}

function authModeLabel() {
  if (env.SHAREOUT_E2E_TOKEN || env.SHAREOUT_TOKEN) return 'env token';
  if (credPath) {
    const home = homedir();
    if (credPath.startsWith(home)) return credPath.slice(home.length + 1);
    if (credPath.startsWith(root + '/')) return credPath.slice(root.length + 1);
    return credPath;
  }
  if (env.SHAREOUT_E2E_ALLOW_CREATE === '1') return 'ephemeral accounts';
  return 'none';
}

console.log('ShareOut live E2E');
console.log(`  base URL : ${env.SHAREOUT_E2E_BASE_URL}`);
console.log(`  mode     : ${flows ? 'flows (read/write)' : 'smoke (read-only)'}`);
console.log(`  auth     : ${authModeLabel()}`);
if (flows) {
  console.log('  flows    : 15 agent workflows (01-skill … 15-visitor-proxy)');
}
console.log('');

const result = spawnSync('npx', vitestArgs, {
  cwd: root,
  env,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
