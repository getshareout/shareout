#!/usr/bin/env node
/**
 * Setup / run the CEO daily digest crew on platform-ops.
 *
 *   node scripts/setup-admin-daily-crew.mjs           # publish + define + cron
 *   node scripts/setup-admin-daily-crew.mjs --run-only  # trigger crew only (no republish)
 *   node scripts/setup-admin-daily-crew.mjs --force     # run + bypass dedup (with --run-only)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const exampleDir = join(dir, '..', 'examples', 'admin-platform-ops');
const base = (process.env.SHAREOUT_BASE_URL || 'https://shareout.site').replace(/\/$/, '');
const slug = process.env.ADMIN_OPS_SLUG || 'platform-ops';
const runOnly = process.argv.includes('--run-only');
const force = process.argv.includes('--force');
const runNow = process.argv.includes('--run-now') || runOnly;

const credPath =
  process.env.SHAREOUT_CREDENTIALS || join(process.env.HOME || '', '.shareout', 'credentials');
const { token } = JSON.parse(readFileSync(credPath, 'utf8'));
const instructions = readFileSync(join(exampleDir, 'crew-instructions.txt'), 'utf8').trim();
const html = readFileSync(join(exampleDir, 'index.html'), 'utf8');

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

async function api(path, opts = {}) {
  const res = await fetch(`${base}${path}`, { ...opts, headers: { ...headers, ...opts.headers } });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    console.error(`FAIL ${opts.method || 'GET'} ${path}`, res.status, body);
    process.exit(1);
  }
  return body;
}

async function resolveArtifactId() {
  const list = await api('/v1/artifacts');
  const found = (list.artifacts || []).find((a) => a.slug === slug);
  return found?.id || null;
}

let artifactId = runOnly ? await resolveArtifactId() : null;

if (!artifactId) {
  console.log(`[setup] publishing ${slug}…`);
  const published = await api('/v1/publish', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Platform Ops',
      slug,
      visibility: 'private',
      files: [{ path: 'index.html', content: html, mime: 'text/html' }],
    }),
  });
  artifactId = published.artifact?.id;
  if (!artifactId) {
    console.error('[setup] publish response missing artifact.id', published);
    process.exit(1);
  }
  console.log(`[setup] artifact ${artifactId} → ${published.deployment?.url || `${base}/a/${slug}/`}`);
} else {
  console.log(`[setup] using existing artifact ${artifactId}`);
}

if (!runOnly) {
  console.log('[setup] defining CEO digest crew…');
  await api(`/v1/data/${artifactId}/crew/define`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'CEO daily digest',
      instructions,
      maxIterations: 10,
      tools: {
        read: ['platform_metrics_digest', 'platform_metrics_investigate'],
        write: ['admin_telegram_brief'],
        approval: { admin_telegram_brief: 'never' },
      },
    }),
  });

  console.log('[setup] ensuring cron trigger 0 11 * * * (8am ART)…');
  const { triggers } = await api(`/v1/data/${artifactId}/crew/triggers`);
  const existing = (triggers || []).find((t) => t.kind === 'cron' && t.cron === '0 11 * * *');
  if (existing) {
    console.log(`[setup] cron trigger already exists: ${existing.id}`);
  } else {
    const { trigger } = await api(`/v1/data/${artifactId}/crew/triggers`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'cron', cron: '0 11 * * *' }),
    });
    console.log(`[setup] created trigger ${trigger?.id}`);
  }
}

const runInput = force
  ? 'Run CEO briefing. Use admin_telegram_brief with force:true.'
  : 'Run CEO briefing for yesterday.';

if (runNow) {
  console.log('[setup] running crew…');
  const run = await api(`/v1/data/${artifactId}/crew/run`, {
    method: 'POST',
    body: JSON.stringify({ input: runInput }),
  });
  console.log('[setup] run started:', run.run?.id || '(see SSE stream)');
} else {
  console.log('[setup] done. Pass --run-only to trigger now.');
}

console.log(`[setup] admin: ${base}/admin · artifact: ${base}/a/${slug}/`);
