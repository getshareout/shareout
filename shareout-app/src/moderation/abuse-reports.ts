// Anonymous abuse reports (Workstream D). A public GET form + POST handler mounted
// on the apex (the badge's Report link). Anonymous + per-IP rate limited (strict
// cf-connecting-ip). Reactive containment that doesn't depend on the classifier:
//   - a CSAM-tagged report auto-pauses + blocks immediately and alerts the admin,
//   - N distinct-IP reports auto-block the artifact for review.

import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import { checkSlidingWindowRateLimit, getTrustedClientIp } from '../rate-limit';
import { setArtifactModeration, setArtifactPaused } from '../superadmin/artifacts-admin';
import { notifyAdmin } from '../observability/alerts';
import { escapeHtml } from '../serve/utils';

const CATEGORIES = ['phishing', 'malware', 'csam', 'spam', 'copyright', 'other'] as const;
type Category = (typeof CATEGORIES)[number];
const AUTO_BLOCK_DISTINCT_IPS = 3;

export interface AbuseReportRow {
  id: string;
  artifact_id: string;
  category: string;
  detail: string | null;
  status: string;
  created_at: string;
}

export async function listAbuseReports(env: Env, limit = 100): Promise<Array<AbuseReportRow & { artifact_name: string }>> {
  const rows = await env.DB.prepare(
    `SELECT r.id, r.artifact_id, r.category, r.detail, r.status, r.created_at,
            COALESCE(a.name, '(deleted)') AS artifact_name
       FROM abuse_reports r
       LEFT JOIN artifacts a ON a.id = r.artifact_id
      WHERE r.status = 'open'
      ORDER BY r.created_at DESC
      LIMIT ?`
  ).bind(limit).all<AbuseReportRow & { artifact_name: string }>();
  return rows.results || [];
}

/** Public route handler for /report/:artifactId (GET form, POST submit). */
export async function handleAbuseReport(request: Request, env: Env, artifactId: string): Promise<Response> {
  if (request.method === 'GET') return reportForm(artifactId);
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  // Anonymous + per-IP rate limit (strict cf-connecting-ip, fail closed).
  const ip = getTrustedClientIp(request);
  if (!ip) return new Response('Could not verify your network.', { status: 403 });
  const rl = await checkSlidingWindowRateLimit(env.RATE_LIMIT_KV, `report:${ip}`, 'anonymous');
  if (!rl.allowed) return new Response('Too many reports. Try again later.', { status: 429 });

  const form = await request.formData().catch(() => null);
  const category = String(form?.get('category') || 'other') as Category;
  const detail = String(form?.get('detail') || '').slice(0, 2000);
  if (!CATEGORIES.includes(category)) return new Response('Invalid category', { status: 400 });

  const artifact = await env.DB.prepare('SELECT id FROM artifacts WHERE id = ?').bind(artifactId).first();
  if (!artifact) return new Response('Not found', { status: 404 });

  await env.DB.prepare(
    'INSERT INTO abuse_reports (id, artifact_id, reporter_ip, category, detail, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(generateId('rep'), artifactId, ip, category, detail || null, 'open', new Date().toISOString()).run();

  // CSAM: do not wait for review — pause + block immediately and alert.
  if (category === 'csam') {
    await setArtifactPaused(env, artifactId, true);
    await setArtifactModeration(env, artifactId, 'block', 'CSAM report — auto-blocked pending review');
    await notifyAdmin(env, `🚨 CSAM report on artifact ${artifactId} — auto-paused + blocked. Review now.`).catch(() => {});
  } else {
    // Auto-block once enough DISTINCT IPs have reported it.
    const distinct = await env.DB.prepare(
      'SELECT COUNT(DISTINCT reporter_ip) AS n FROM abuse_reports WHERE artifact_id = ?'
    ).bind(artifactId).first<{ n: number }>();
    if ((distinct?.n ?? 0) >= AUTO_BLOCK_DISTINCT_IPS) {
      await setArtifactModeration(env, artifactId, 'block', `auto-blocked after ${distinct?.n} reports`);
      await notifyAdmin(env, `⚠️ Artifact ${artifactId} auto-blocked after ${distinct?.n} abuse reports.`).catch(() => {});
    }
  }

  return new Response(reportThanksHtml(), { status: 200, headers: { 'Content-Type': 'text/html' } });
}

function reportForm(artifactId: string): Response {
  const options = CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('');
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Report content</title>
<style>body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:480px;margin:8vh auto;padding:0 20px;color:#1a1a2e}
h1{font-size:1.3rem}label{display:block;margin:14px 0 4px;font-weight:600}select,textarea{width:100%;padding:8px;border:1px solid #ccc;border-radius:8px;font:inherit}
button{margin-top:16px;padding:10px 18px;border:0;border-radius:9999px;background:#1a1a2e;color:#fff;font:inherit;cursor:pointer}</style>
</head><body>
<h1>Report this page</h1>
<p>Tell us what's wrong. Reports are reviewed by ShareOut.</p>
<form method="POST" action="/report/${escapeHtml(artifactId)}">
<label for="category">Reason</label><select id="category" name="category">${options}</select>
<label for="detail">Details (optional)</label><textarea id="detail" name="detail" rows="4" maxlength="2000"></textarea>
<button type="submit">Submit report</button>
</form></body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html', 'X-Robots-Tag': 'noindex' } });
}

function reportThanksHtml(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Thanks</title>
<style>body{font:16px/1.5 -apple-system,sans-serif;max-width:480px;margin:12vh auto;padding:0 20px;text-align:center;color:#1a1a2e}</style>
</head><body><h1>Thank you</h1><p>Your report was submitted and will be reviewed.</p></body></html>`;
}
