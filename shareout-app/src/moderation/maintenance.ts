// Daily public-artifacts maintenance (Workstream G/H). Runs from the scheduled
// handler. All best-effort; never throws into the cron.
//
//  - checkContentDomainReputation (H1): watch the shared content domain's
//    reputation so we learn early if shareoutcdn.site gets flagged (which would
//    poison every artifact, not just one).
//  - runBandwidthAutoPause (G): estimate each owner's served bandwidth from the
//    batched analytics_daily (views x entrypoint size — NO hot-path byte counting)
//    and pause their public artifacts when over the configured cap. Estimate, not
//    exact; a guardrail against runaway egress on instances that want one.
//    Off unless DAILY_BANDWIDTH_BYTES_PER_OWNER is set — this build has no plans,
//    and the egress is billed to whoever runs the instance, so it is their call.

import type { Env } from './../types';
import { checkHostsReputation } from './url-scanner';
import { notifyAdmin } from '../observability/alerts';

const CONTENT_DOMAIN = 'shareoutcdn.site';

export async function checkContentDomainReputation(env: Env): Promise<void> {
  try {
    const verdict = await checkHostsReputation(env, [CONTENT_DOMAIN]);
    if (verdict === 'malicious') {
      await notifyAdmin(
        env,
        `🚨 CONTENT DOMAIN ${CONTENT_DOMAIN} is flagged malicious by URL reputation. This can blocklist ALL artifacts. Investigate + request review immediately.`
      ).catch(() => {});
    }
  } catch {
    // best-effort
  }
}

interface OwnerUsageRow {
  owner_id: string;
  est_bytes: number;
}

/** Daily per-owner egress cap in bytes. 0 / unset ⇒ no cap, the default. */
function dailyBandwidthCapBytes(env: Env): number {
  const n = Number(env.DAILY_BANDWIDTH_BYTES_PER_OWNER ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Estimate yesterday's served bandwidth per owner and pause anyone over the cap. */
export async function runBandwidthAutoPause(env: Env): Promise<{ checked: number; paused: number }> {
  const cap = dailyBandwidthCapBytes(env);
  if (cap <= 0) return { checked: 0, paused: 0 };

  // Yesterday in UTC (analytics_daily.date is a YYYY-MM-DD string).
  const since = await env.DB.prepare("SELECT date('now','-1 day') AS d").first<{ d: string }>().catch(() => null);
  const day = since?.d;
  if (!day) return { checked: 0, paused: 0 };

  const rows = await env.DB.prepare(`
    SELECT a.owner_id AS owner_id,
           SUM(ad.views * COALESCE(ast.size_bytes, 0)) AS est_bytes
    FROM analytics_daily ad
    JOIN artifacts a   ON a.id = ad.artifact_id AND a.deleted_at IS NULL
                       AND a.visibility = 'public' AND a.owner_id IS NOT NULL
    JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
    JOIN versions v    ON v.id = d.version_id
    JOIN assets ast    ON ast.version_id = v.id AND ast.path = v.entrypoint
    WHERE ad.date = ?
    GROUP BY a.owner_id
  `).bind(day).all<OwnerUsageRow>().catch(() => ({ results: [] as OwnerUsageRow[] }));

  let checked = 0;
  let paused = 0;
  for (const row of rows.results || []) {
    checked++;
    if (row.est_bytes <= cap) continue;

    await env.DB.prepare(
      `UPDATE artifacts SET paused = 1
        WHERE owner_id = ? AND visibility = 'public' AND paused = 0`
    ).bind(row.owner_id).run().catch(() => {});
    paused++;
    await notifyAdmin(
      env,
      `⚠️ Auto-paused public artifacts for owner ${row.owner_id}: est. ${(row.est_bytes / 1e9).toFixed(1)} GB served yesterday (cap ${(cap / 1e9).toFixed(1)} GB).`
    ).catch(() => {});
  }
  return { checked, paused };
}
