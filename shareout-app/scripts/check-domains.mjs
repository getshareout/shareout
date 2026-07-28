#!/usr/bin/env node
/**
 * Guard: parameterized files must not reintroduce founder-domain literals.
 * Broader src/ sweep continues in work/047 Phase 1.1.
 *
 * Usage: node scripts/check-domains.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const worker = join(fileURLToPath(import.meta.url), '..', '..');
const srcRoot = join(worker, 'src');

const MUST_BE_CLEAN = [
  // origins.ts owns intentional defaults when SHAREOUT_BASE_URL is unset
  'subdomain.ts',
  'marketing-us-gate.ts',
  'pages/home/host.ts',
  'screenshots.ts',
  'support/intake.ts',
  'artifacts/unused-sweep.ts',
  'artifacts/access-requests.ts',
  'tests/notify.ts',
  'crew/tools/pilot-verify.ts',
  'observability/alerts.ts',
  'publish/moderation.ts',
  'serve/embed.ts',
  'data/comment-notify.ts',
  'assets/deliverables.ts',
  'email/weekly-digest.ts',
  'email/unsubscribe-token.ts',
  'email/lifecycle-cron.ts',
  'email/gateway.ts',
  'moderation/notify.ts',
  'router/telegram-router.ts',
  'router/slack-router.ts',
  'router/api/workspace-connections/slack.ts',
  'enterprise.ts',
  'chat-platforms/telegram/format.ts',
  'chat-platforms/slack/format.ts',
  'chat-platforms/slack/adapter.ts',
  'auth/cookies.ts',
  'pages/company.ts',
  'serve/embed.ts',
  // Agent-facing surfaces: these tell an agent where to publish, so a founder
  // literal here sends a self-hoster's content to the wrong server.
  // skill-origin.ts owns the founder literals it rewrites, the same way
  // origins.ts owns the fallback origin.
  'skill.ts',
  'pages/integrations-discovery.ts',
];

// docs.shareout.site is deliberately fixed everywhere: the project documentation
// is a shared resource, not something each instance re-hosts.
const NEEDLE = /(?<!docs\.)shareout\.site|shareoutcdn\.site/;

const hits = [];
for (const rel of MUST_BE_CLEAN) {
  const text = readFileSync(join(srcRoot, rel), 'utf8');
  for (const [i, line] of text.split('\n').entries()) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (NEEDLE.test(trimmed)) hits.push(`${rel}:${i + 1}: ${trimmed.slice(0, 120)}`);
  }
}

if (hits.length) {
  console.error('check:domains — founder domain literals in parameterized files:\n');
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}

console.log(`✓ check:domains — ${MUST_BE_CLEAN.length} parameterized file(s) clean`);
