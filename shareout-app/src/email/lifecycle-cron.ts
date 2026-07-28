import type { Env } from '../types';
import { dispatchLifecycleEmail } from './gateway';
import { claimEmailSend } from './email-log';
import { getPlatformOrigin } from '../config/origins';

// Scheduled lifecycle emails, gated inside the hourly worker cron. Each pass
// self-paces (hourly / daily / weekly) and claims an email-log key before sending,
// so re-runs never double-send. All sends route through the gateway, so audience +
// preference + suppression rules still apply.

const MAX = 1000;

// Hourly: users who signed up ~48h ago and still haven't published.
async function activationNudge(env: Env): Promise<void> {
  const rows = await env.DB.prepare(`
    SELECT u.id AS id, u.email AS email
    FROM users u
    WHERE u.email IS NOT NULL AND COALESCE(u.disabled, 0) = 0
      AND u.created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', '-48 hours')
      AND u.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-49 hours')
      AND NOT EXISTS (
        SELECT 1 FROM deployments d JOIN artifacts a ON a.id = d.artifact_id
        WHERE a.owner_id = u.id AND d.channel = 'production'
      )
    LIMIT ${MAX}
  `).all<{ id: string; email: string }>();

  for (const u of rows.results) {
    if (!(await claimEmailSend(env, 'activation_nudge', u.id))) continue;
    await dispatchLifecycleEmail(env, { type: 'activation_nudge', toUserId: u.id, toEmail: u.email }).catch(() => {});
  }
}

// Daily: users last active ~14d and ~30d ago. last_login_at updates on login only,
// so fall back to created_at for users who never logged in after signup.
async function winBack(env: Env): Promise<void> {
  for (const days of [14, 30]) {
    const rows = await env.DB.prepare(`
      SELECT u.id AS id, u.email AS email
      FROM users u
      WHERE u.email IS NOT NULL AND COALESCE(u.disabled, 0) = 0
        AND COALESCE(u.last_login_at, u.created_at) < strftime('%Y-%m-%dT%H:%M:%fZ','now', '-${days} days')
        AND COALESCE(u.last_login_at, u.created_at) >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-${days + 1} days')
      LIMIT ${MAX}
    `).all<{ id: string; email: string }>();

    for (const u of rows.results) {
      if (!(await claimEmailSend(env, 'win_back', `${u.id}:${days}`))) continue;
      await dispatchLifecycleEmail(env, { type: 'win_back', toUserId: u.id, toEmail: u.email }).catch(() => {});
    }
  }
}

// Daily: recently-created pages that just crossed their first view. Capped on age +
// view count so we only ever catch the genuine first-view moment (never a backfill
// of older popular pages).
async function firstViewSweep(env: Env): Promise<void> {
  const base = getPlatformOrigin(env);
  const rows = await env.DB.prepare(`
    SELECT a.id AS id, a.name AS name, a.owner_id AS owner_id,
           COALESCE(d.slug, a.slug) AS slug, u.email AS email
    FROM artifacts a
    JOIN artifact_view_totals avt ON avt.artifact_id = a.id
    JOIN users u ON u.id = a.owner_id
    LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
    WHERE a.deleted_at IS NULL AND u.email IS NOT NULL
      AND a.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-14 days')
      AND avt.views BETWEEN 1 AND 25
    LIMIT ${MAX}
  `).all<{ id: string; name: string | null; owner_id: string; slug: string | null; email: string }>();

  for (const a of rows.results) {
    if (!(await claimEmailSend(env, 'first_view', a.id))) continue;
    const url = a.slug ? `${base}/a/${a.slug}/` : base;
    await dispatchLifecycleEmail(env, {
      type: 'first_view',
      toUserId: a.owner_id,
      toEmail: a.email,
      data: { pageName: a.name || 'your page', url },
    }).catch(() => {});
  }
}

// Weekly (Monday): a minimal digest to users opted into marketing, only when they
// had activity this week.
async function weeklyDigest(env: Env, weekKey: string): Promise<void> {
  const optedIn = await env.DB.prepare(`
    SELECT ep.user_id AS id, u.email AS email
    FROM email_preferences ep JOIN users u ON u.id = ep.user_id
    WHERE ep.category = 'marketing' AND ep.opted_in = 1
      AND u.email IS NOT NULL AND COALESCE(u.disabled, 0) = 0
    LIMIT ${MAX}
  `).all<{ id: string; email: string }>();

  for (const u of optedIn.results) {
    const stats = await env.DB.prepare(`
      SELECT
        (SELECT COALESCE(SUM(ad.views), 0) FROM analytics_daily ad
           JOIN artifacts a ON a.id = ad.artifact_id
           WHERE a.owner_id = ? AND ad.date >= date('now', '-7 days')) AS views,
        (SELECT COUNT(*) FROM artifact_comments c
           JOIN artifacts a ON a.id = c.artifact_id
           WHERE a.owner_id = ? AND c.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-7 days')) AS comments,
        (SELECT COUNT(*) FROM deployments d
           JOIN artifacts a ON a.id = d.artifact_id
           WHERE a.owner_id = ? AND d.channel = 'production' AND d.updated_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-7 days')) AS published
    `).bind(u.id, u.id, u.id).first<{ views: number; comments: number; published: number }>();

    const views = stats?.views ?? 0, comments = stats?.comments ?? 0, published = stats?.published ?? 0;
    if (views + comments + published === 0) continue; // never an empty digest
    if (!(await claimEmailSend(env, 'weekly_digest', `${u.id}:${weekKey}`))) continue;
    await dispatchLifecycleEmail(env, {
      type: 'weekly_digest',
      toUserId: u.id,
      toEmail: u.email,
      data: { views, comments, published },
    }).catch(() => {});
  }
}

/** Entry point, called every hour from handleScheduledEvent. Self-gates the
 *  daily/weekly passes by UTC hour/day. */
export async function runLifecycleEmails(env: Env): Promise<void> {
  // Gateway also skips these types when the flag is on; bail early to skip the scans.
  const v = (env.LIFECYCLE_EMAILS_DISABLED || '').toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return;

  const now = new Date();
  const hour = now.getUTCHours();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon

  await activationNudge(env).catch(() => {});
  if (hour === 15) await winBack(env).catch(() => {});
  if (hour === 16) await firstViewSweep(env).catch(() => {});
  if (day === 1 && hour === 17) await weeklyDigest(env, now.toISOString().slice(0, 10)).catch(() => {});
}
