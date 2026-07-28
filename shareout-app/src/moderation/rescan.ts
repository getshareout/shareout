// Daily moderation re-scan (Workstream D / D3). Content the classifier approved at
// publish can turn malicious later (the page starts loading a now-flagged host, a
// CDN gets compromised). This pass walks the oldest-checked approved public
// artifacts and re-runs URL reputation via the Cloudflare URL Scanner; a malicious
// verdict auto-blocks + pauses + alerts. Bounded per run so cost/time stay flat.

import type { Env } from '../types';
import { extractSignals, outboundHosts } from './extract';
import { checkHostsReputation } from './url-scanner';
import { classifyAndPersist } from './check';
import { setArtifactModeration, setArtifactPaused } from '../superadmin/artifacts-admin';
import { notifyAdmin } from '../observability/alerts';
import { setModeration } from '../artifacts/satellites';

interface RescanRow {
  id: string;
  r2_key: string;
  mime: string;
}

export async function runModerationRescan(env: Env, limit = 20): Promise<{ scanned: number; blocked: number }> {
  // Oldest-checked approved open artifacts first, so coverage rotates over time.
  const rows = await env.DB.prepare(`
    SELECT a.id, ast.r2_key, ast.mime
    FROM artifacts a
    JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
    JOIN versions v ON v.id = d.version_id
    JOIN assets ast ON ast.version_id = v.id AND ast.path = v.entrypoint
    LEFT JOIN artifact_moderation m ON m.artifact_id = a.id
    WHERE COALESCE(m.status, 'approved') = 'approved'
      AND a.visibility = 'public'
      AND ast.mime = 'text/html'
    ORDER BY COALESCE(m.checked_at, '') ASC
    LIMIT ?
  `).bind(limit).all<RescanRow>();

  let scanned = 0;
  let blocked = 0;
  const now = new Date().toISOString();

  for (const row of rows.results || []) {
    scanned++;
    try {
      const obj = await env.ARTIFACTS.get(row.r2_key);
      if (!obj) continue;
      const hosts = outboundHosts(extractSignals(await obj.text()));
      const verdict = await checkHostsReputation(env, hosts);
      if (verdict === 'malicious') {
        await setArtifactModeration(env, row.id, 'block', 'URL reputation flagged on re-scan');
        await setArtifactPaused(env, row.id, true);
        await notifyAdmin(env, `⚠️ Re-scan blocked artifact ${row.id}: outbound host flagged malicious.`).catch(() => {});
        blocked++;
      } else {
        // Touch checked_at so the rotation advances even when clean/unknown.
        await setModeration(env, row.id, { checked_at: now });
      }
    } catch {
      // best-effort per artifact
    }
  }
  return { scanned, blocked };
}

// Hourly self-heal for held artifacts (work/045 A). Re-classifies the oldest pending
// rows: a page held only by a transient classifier error (or a since-fixed
// false-positive) flips to approved, and classifyAndPersist restores the visibility
// the publish asked for. Rows that are genuinely suspicious stay pending. Bounded per
// run so cost/time stay flat.
export async function recheckPendingModeration(env: Env, limit = 20): Promise<{ checked: number; approved: number }> {
  const rows = await env.DB.prepare(
    `SELECT artifact_id AS id FROM artifact_moderation
      WHERE status = 'pending'
      ORDER BY COALESCE(checked_at, '') ASC
      LIMIT ?`
  ).bind(limit).all<{ id: string }>();

  let checked = 0;
  let approved = 0;
  for (const row of rows.results || []) {
    checked++;
    try {
      if ((await classifyAndPersist(env, row.id)) === 'approved') approved++;
    } catch {
      // best-effort per artifact
    }
  }
  return { checked, approved };
}
