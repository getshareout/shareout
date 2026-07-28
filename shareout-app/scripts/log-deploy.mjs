#!/usr/bin/env node
/**
 * Append a deploy record to the team "Deploy & PR Tracker" dashboard's `deploys`
 * table, so deploy frequency + rollback rate are tracked exactly (GitHub can't see
 * local ship.sh deploys). Called by tooling/scripts/{ship,rollback}.sh after a
 * successful prod deploy. Best-effort: any failure prints a warning and exits 0 so
 * it never breaks a deploy.
 *
 * Usage:
 *   node scripts/log-deploy.mjs --sha <sha> --title <text> [--status success|failed] [--rollback]
 *
 * Auth: ShareOut personal token at ~/.shareout/credentials (owner of the artifact).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';

const BASE = process.env.SHAREOUT_BASE_URL || 'https://shareout.site';
const ARTIFACT_ID = process.env.DEPLOY_TRACKER_ARTIFACT_ID || 'art_6a5ad3a9c8049839a6f24894';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

async function main() {
  const cred = JSON.parse(await readFile(join(os.homedir(), '.shareout/credentials'), 'utf8'));
  const token = cred.token;
  if (!token) throw new Error('no ShareOut token in ~/.shareout/credentials');

  const row = {
    sha: arg('sha').slice(0, 12),
    title: arg('title', '(deploy)').slice(0, 200),
    when: new Date().toISOString(),
    status: arg('status', 'success'),
    rollback: hasFlag('rollback'),
  };

  const res = await fetch(`${BASE}/v1/data/${ARTIFACT_ID}/tables/deploys`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: [row] }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 160)}`);
  console.log(`  ✓ logged deploy ${row.sha} (${row.rollback ? 'rollback' : row.status})`);
}

main().catch((e) => {
  console.warn(`  ! deploy log skipped: ${e.message}`);
  process.exit(0);
});
