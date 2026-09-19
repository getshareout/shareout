#!/usr/bin/env node
/**
 * Local-first, idempotent seed for the `investor-demo` workspace used by
 * demo-readiness/DEMO-SCRIPT.md (slice 10, Monday 2026-09-21 investor demo).
 *
 * Creates: one workspace, 5 synthetic HTML artifacts, one scheduled job
 * (Slack destination, placeholder webhook), one crew, and a seeded comment
 * thread. Synthetic/public data only — no customer names.
 *
 * Safe to re-run: publish upserts by slug (new version, same artifact),
 * defineCrew upserts by artifact, job/comment creation checks for an
 * existing row first.
 *
 * REFUSES to run against anything but localhost/127.0.0.1 — never point
 * this at prod (see DEMO-SCRIPT.md "After the demo" / preamble hard limits).
 *
 *   npm run db:migrate && npm run dev   # in one terminal
 *   npm run seed:investor-demo          # in another
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  revenueOverviewHtml,
  pipelineHealthHtml,
  supportQueueHtml,
  usageTrendsHtml,
  teamDirectoryHtml,
} from './lib/investor-demo-artifacts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const BASE_URL = (process.env.SHAREOUT_BASE_URL || 'http://localhost:55162').replace(/\/$/, '');
const SEED_EMAIL = process.env.SEED_EMAIL || 'investor-demo-seed@shareout.local';
const WORKSPACE_SLUG = 'investor-demo';
const WORKSPACE_NAME = 'Investor Demo';
const JOB_TITLE = 'Weekly team digest (demo)';
const CREW_NAME = 'weekly-summary';
const CRED_PATH = join(root, '.credentials', 'investor-demo-seed.json');

const ARTIFACTS = [
  { slug: 'revenue-overview', name: 'Revenue overview', html: revenueOverviewHtml },
  { slug: 'pipeline-health', name: 'Pipeline health', html: pipelineHealthHtml },
  { slug: 'support-queue', name: 'Support queue', html: supportQueueHtml },
  { slug: 'usage-trends', name: 'Usage trends', html: usageTrendsHtml },
  { slug: 'team-directory', name: 'Team directory', html: teamDirectoryHtml },
];

const SEED_COMMENTS = [
  { authorName: 'Ada Torres', content: 'Ticket #1042 — repro\'d on Safari 17, filing upstream.' },
  { authorName: 'Ben Ochieng', content: 'Digest went out twice last Monday — looking into the retry config.' },
  { authorName: 'Casey Lindqvist', content: 'Can we get the dark-mode request onto next sprint?' },
];

function assertLocalTarget() {
  let hostname = '';
  try {
    hostname = new URL(BASE_URL).hostname;
  } catch {
    /* falls through to the rejection below */
  }
  const allowed = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  if (!allowed) {
    console.error(
      `Refusing to seed "${BASE_URL}" — this script only targets local dev ` +
        '(localhost/127.0.0.1). Never run the investor-demo seed against prod; ' +
        'see demo-readiness/DEMO-SCRIPT.md.'
    );
    process.exit(1);
  }
}

async function api(token, path, init = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }
  }
  return { res, body };
}

async function ensureToken() {
  if (existsSync(CRED_PATH)) {
    const saved = JSON.parse(readFileSync(CRED_PATH, 'utf8'));
    if (saved.token) {
      const { res } = await api(saved.token, '/v1/auth/profile');
      if (res.ok) return saved.token;
    }
  }
  const { res, body } = await api(null, '/v1/auth/create-account', { method: 'POST' });
  if (!res.ok || !body?.token) {
    throw new Error(`create-account failed: ${res.status} ${JSON.stringify(body)}`);
  }
  mkdirSync(dirname(CRED_PATH), { recursive: true });
  writeFileSync(CRED_PATH, JSON.stringify({ token: body.token, user_id: body.user_id, email: SEED_EMAIL }, null, 2));
  console.log(`✓ created seed account, saved token to ${CRED_PATH}`);
  return body.token;
}

async function ensureWorkspace(token) {
  const created = await api(token, '/v1/workspaces', {
    method: 'POST',
    body: JSON.stringify({
      name: WORKSPACE_NAME,
      slug: WORKSPACE_SLUG,
      description: 'Synthetic workspace for the Monday investor demo. Public/synthetic data only.',
    }),
  });
  if (created.res.status === 201) {
    console.log(`✓ created workspace "${WORKSPACE_SLUG}"`);
    return created.body.id;
  }
  if (created.res.status === 409) {
    const { res, body } = await api(token, `/v1/workspaces/by-slug/${WORKSPACE_SLUG}`);
    if (!res.ok) throw new Error(`workspace exists but lookup failed: ${res.status} ${JSON.stringify(body)}`);
    console.log(`= workspace "${WORKSPACE_SLUG}" already exists`);
    return body.id;
  }
  throw new Error(`create workspace failed: ${created.res.status} ${JSON.stringify(created.body)}`);
}

async function publishArtifact(token, workspaceId, def) {
  const { res, body } = await api(token, '/v1/publish', {
    method: 'POST',
    body: JSON.stringify({
      name: def.name,
      slug: def.slug,
      workspace_id: workspaceId,
      visibility: 'public',
      files: [{ path: 'index.html', content: def.html(), mime: 'text/html' }],
    }),
  });
  if (!res.ok) throw new Error(`publish "${def.slug}" failed: ${res.status} ${JSON.stringify(body)}`);
  const url = body?.deployment?.subdomain_url || body?.deployment?.namespaced_url || body?.deployment?.url;
  console.log(`✓ published ${def.slug} (v${body?.version?.version_no}) → ${url}`);
  if (body?.visibility_downgraded) {
    console.warn(
      `  ⚠ "${def.slug}" was held for moderation — pre-publish + verify per DEMO-SCRIPT.md checklist #2`
    );
  }
  return { artifactId: body.artifact.id, url };
}

async function ensureJob(token, artifactId) {
  const { res, body } = await api(token, `/v1/jobs?artifact_id=${artifactId}`);
  if (!res.ok) throw new Error(`list jobs failed: ${res.status} ${JSON.stringify(body)}`);
  const existing = (body?.jobs || []).find((j) => j.title === JOB_TITLE);
  if (existing) {
    console.log(`= job "${JOB_TITLE}" already exists`);
    return existing;
  }

  const created = await api(token, '/v1/jobs', {
    method: 'POST',
    body: JSON.stringify({
      artifact_id: artifactId,
      action: 'slack',
      title: JOB_TITLE,
      trigger_type: 'cron',
      schedule: '0 9 * * 1', // Monday 09:00 UTC — see scout-05: cron only actually fires hourly.
      config: {
        // Placeholder — swap for a real Slack incoming webhook before a live "Run now" demo.
        webhookUrl: 'https://hooks.slack.com/services/PLACEHOLDER/PLACEHOLDER/placeholder',
      },
    }),
  });
  if (!created.res.ok) {
    throw new Error(`create job failed: ${created.res.status} ${JSON.stringify(created.body)}`);
  }
  console.log(`✓ created job "${JOB_TITLE}"`);
  return created.body.job;
}

async function ensureCrew(token, artifactId) {
  // defineCrew (src/crew/store.ts) is itself an upsert — safe to always call.
  const { res, body } = await api(token, `/v1/data/${artifactId}/crew/define`, {
    method: 'POST',
    body: JSON.stringify({
      name: CREW_NAME,
      instructions:
        'Summarize the team directory and any open support tickets into a short weekly update for the workspace.',
      model: 'claude-3-5-haiku-20241022',
      tools: { read: ['table_query', 'json_get'] },
    }),
  });
  if (!res.ok) throw new Error(`define crew failed: ${res.status} ${JSON.stringify(body)}`);
  console.log(`✓ crew "${CREW_NAME}" defined on ${artifactId}`);
}

async function ensureComments(token, artifactId) {
  const { res, body } = await api(token, `/v1/data/${artifactId}/comments`);
  if (!res.ok) throw new Error(`list comments failed: ${res.status} ${JSON.stringify(body)}`);
  // The data-plane comments endpoint wraps its payload as { success, data: { comments } }.
  const count = body?.data?.comments?.length ?? 0;
  if (count > 0) {
    console.log(`= support-queue already has ${count} comment(s), skipping seed`);
    return;
  }
  for (const c of SEED_COMMENTS) {
    const created = await api(token, `/v1/data/${artifactId}/comments`, {
      method: 'POST',
      body: JSON.stringify(c),
    });
    if (!created.res.ok) {
      throw new Error(`post comment failed: ${created.res.status} ${JSON.stringify(created.body)}`);
    }
  }
  console.log(`✓ seeded ${SEED_COMMENTS.length} comments on support-queue`);
}

async function main() {
  assertLocalTarget();
  console.log(`Seeding investor-demo workspace on ${BASE_URL}\n`);

  const token = await ensureToken();
  const workspaceId = await ensureWorkspace(token);

  const bySlug = {};
  for (const def of ARTIFACTS) {
    bySlug[def.slug] = await publishArtifact(token, workspaceId, def);
  }

  await ensureJob(token, bySlug['team-directory'].artifactId);
  await ensureCrew(token, bySlug['team-directory'].artifactId);
  await ensureComments(token, bySlug['support-queue'].artifactId);

  console.log('\nDone. Artifact URLs:');
  for (const def of ARTIFACTS) {
    console.log(`  ${def.slug.padEnd(18)} ${bySlug[def.slug].url}`);
  }
  console.log(
    '\nThis only ran against local dev. Do not run against prod until the lead gets ' +
      "Leo's OK (see DEMO-SCRIPT.md)."
  );
}

main().catch((err) => {
  console.error('\nSeed failed:', err.message || err);
  process.exit(1);
});
