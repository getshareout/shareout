import type { Env } from '../types';
import { dispatchLifecycleEmail } from './gateway';
import { claimEmailSend } from './email-log';
import { chatComplete, getAIProvider } from '../data/agent/anthropic';
import { recordAiUsage } from '../data/ai-usage';
import type { WorkspaceDigestData } from './catalog';
import { getPlatformOrigin } from '../config/origins';

// The weekly workspace digest — one email per active workspace to its internal
// members, "what happened here last week". Gathered cheaply from D1, an optional
// LLM sentence on top, sent through the gateway (so prefs/suppression apply) and
// keyed in email_log per workspace+week so a cron re-run never double-sends.

const MAX_WORKSPACES = 500;
const MAX_ITEMS = 6;

function artifactUrl(base: string, slug: string | null): string {
  return slug ? `${base}/a/${slug}/` : base;
}

/** Gather last-7-days activity for one workspace. Returns null when nothing happened
 *  (a dead workspace is never emailed). */
export async function gatherWorkspaceDigest(
  env: Env,
  workspaceId: string,
  workspaceName: string,
): Promise<WorkspaceDigestData | null> {
  const base = getPlatformOrigin(env);

  // (a) new/updated published artifacts — description is auto-filled by the TL;DR job.
  const updated = (
    await env.DB.prepare(`
      SELECT a.name AS name, a.description AS description, COALESCE(d.slug, a.slug) AS slug
      FROM artifacts a
      JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
      WHERE a.workspace_id = ? AND a.deleted_at IS NULL
        AND d.updated_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-7 days')
      ORDER BY d.updated_at DESC
      LIMIT ${MAX_ITEMS}
    `).bind(workspaceId).all<{ name: string | null; description: string | null; slug: string | null }>()
  ).results.map((r) => ({ name: r.name || 'Untitled', description: r.description, url: artifactUrl(base, r.slug) }));

  // (b) top-viewed this week (analytics_daily; skips silently when sparse).
  const topViewed = (
    await env.DB.prepare(`
      SELECT a.name AS name, COALESCE(d.slug, a.slug) AS slug, SUM(ad.views) AS views
      FROM analytics_daily ad
      JOIN artifacts a ON a.id = ad.artifact_id
      LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
      WHERE a.workspace_id = ? AND a.deleted_at IS NULL AND ad.date >= date('now', '-7 days')
      GROUP BY a.id
      HAVING views > 0
      ORDER BY views DESC
      LIMIT 3
    `).bind(workspaceId).all<{ name: string | null; slug: string | null; views: number }>()
  ).results.map((r) => ({ name: r.name || 'Untitled', url: artifactUrl(base, r.slug), views: r.views }));

  // (c) unresolved comments raised this week.
  const openComments =
    (
      await env.DB.prepare(`
        SELECT COUNT(*) AS n FROM artifact_comments c
        JOIN artifacts a ON a.id = c.artifact_id
        WHERE a.workspace_id = ? AND a.deleted_at IS NULL
          AND c.resolved = 0 AND c.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-7 days')
      `).bind(workspaceId).first<{ n: number }>()
    )?.n ?? 0;

  // (d) stale-data events this week.
  const staleData = (
    await env.DB.prepare(`
      SELECT a.name AS name, COALESCE(d.slug, a.slug) AS slug
      FROM notifications s
      JOIN artifacts a ON a.id = s.recipient_id
      LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
      WHERE s.recipient_type = 'artifact' AND s.kind = 'stale_data'
        AND a.workspace_id = ? AND a.deleted_at IS NULL
        AND s.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-7 days')
      GROUP BY a.id
      LIMIT ${MAX_ITEMS}
    `).bind(workspaceId).all<{ name: string | null; slug: string | null }>()
  ).results.map((r) => ({ name: r.name || 'Untitled', url: artifactUrl(base, r.slug) }));

  if (updated.length === 0 && topViewed.length === 0 && openComments === 0 && staleData.length === 0) return null;

  return { workspaceName, homeUrl: `${base}/home`, updated, topViewed, openComments, staleData };
}

/** One short synthesized sentence. Returns null on any failure — the template
 *  sections stand alone without it. */
async function narrate(env: Env, workspaceId: string, d: WorkspaceDigestData): Promise<string | null> {
  const provider = getAIProvider(env);
  if (!provider) return null;
  const facts = [
    d.updated.length ? `${d.updated.length} pages published/updated: ${d.updated.slice(0, 5).map((a) => a.name).join(', ')}` : '',
    d.topViewed.length ? `most viewed: ${d.topViewed.map((a) => `${a.name} (${a.views} views)`).join(', ')}` : '',
    d.openComments ? `${d.openComments} open comments` : '',
    d.staleData.length ? `${d.staleData.length} pages with stale data` : '',
  ]
    .filter(Boolean)
    .join('. ')
    .slice(0, 2000);
  try {
    const text = await chatComplete(
      env,
      [{ role: 'user', content: `Workspace "${d.workspaceName}" this week: ${facts}.` }],
      'Write a warm, plain 2-3 sentence summary of a team\'s week in their workspace. No greeting, no sign-off, no exclamation marks, no hype words. Just what happened, concretely.',
      200,
    );
    await recordAiUsage(env, {
      workspaceId,
      userId: null,
      kind: 'weekly_digest',
      model: provider.model,
      units: 1,
      unitKind: 'completion',
      baseCostMicroUsd: 0,
      source: 'weekly_digest',
    }).catch(() => {});
    return text.trim() || null;
  } catch {
    return null;
  }
}

/** Weekly (Monday) entry point. Iterates active workspaces, builds + sends one
 *  digest per workspace to its internal members. Per-workspace failures isolated. */
export async function runWeeklyWorkspaceDigest(env: Env, weekKey: string): Promise<void> {
  const v = (env.LIFECYCLE_EMAILS_DISABLED || '').toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return;

  const workspaces = await env.DB.prepare(`
    SELECT w.id AS id, w.name AS name
    FROM workspaces w
    WHERE EXISTS (
        SELECT 1 FROM artifacts a JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
        WHERE a.workspace_id = w.id AND a.deleted_at IS NULL AND d.updated_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-7 days'))
      OR EXISTS (
        SELECT 1 FROM artifact_comments c JOIN artifacts a ON a.id = c.artifact_id
        WHERE a.workspace_id = w.id AND a.deleted_at IS NULL AND c.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-7 days'))
      OR EXISTS (
        SELECT 1 FROM notifications s JOIN artifacts a ON a.id = s.recipient_id
        WHERE s.recipient_type = 'artifact' AND s.kind = 'stale_data'
          AND a.workspace_id = w.id AND a.deleted_at IS NULL
          AND s.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-7 days'))
    LIMIT ${MAX_WORKSPACES}
  `).all<{ id: string; name: string }>();

  for (const ws of workspaces.results) {
    try {
      const digest = await gatherWorkspaceDigest(env, ws.id, ws.name);
      if (!digest) continue;
      // Claim the whole workspace-week up front: a re-run within the hour fails the
      // claim and skips, so members never get a second copy.
      if (!(await claimEmailSend(env, 'workspace_weekly_digest', `${ws.id}:${weekKey}`))) continue;
      digest.narrative = (await narrate(env, ws.id, digest)) ?? undefined;

      const members = await env.DB.prepare(`
        SELECT wm.user_id AS id, u.email AS email
        FROM workspace_members wm JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = ? AND wm.member_class = 'internal'
          AND u.email IS NOT NULL AND COALESCE(u.disabled, 0) = 0
      `).bind(ws.id).all<{ id: string; email: string }>();

      for (const m of members.results) {
        await dispatchLifecycleEmail(env, {
          type: 'workspace_weekly_digest',
          toUserId: m.id,
          toEmail: m.email,
          data: digest as unknown as Record<string, unknown>,
        }).catch(() => {});
      }
    } catch {
      // per-workspace isolation — one bad workspace can't stop the rest
    }
  }
}
