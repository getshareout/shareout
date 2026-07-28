import type { Env } from '../types';

export type SuppressionReason = 'bounce' | 'complaint' | 'unsubscribe';

function norm(email: string): string {
  return (email || '').toLowerCase().trim();
}

/** True if this address is on the suppression list (hard bounce, spam complaint,
 *  or unsubscribe). Checked before every send. */
export async function isSuppressed(env: Env, email: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 FROM email_suppressions WHERE email = ?')
    .bind(norm(email))
    .first();
  return !!row;
}

/** Suppressed addresses among `emails` (normalized), in one query. */
export async function suppressedSet(env: Env, emails: string[]): Promise<Set<string>> {
  const normed = emails.map(norm).filter(Boolean);
  if (!normed.length) return new Set();
  const rows = await env.DB.prepare(
    `SELECT email FROM email_suppressions WHERE email IN (${normed.map(() => '?').join(',')})`,
  ).bind(...normed).all<{ email: string }>();
  return new Set((rows.results || []).map((r) => r.email));
}

export async function addSuppression(
  env: Env,
  params: { email: string; userId?: string | null; reason: SuppressionReason; kind?: string | null },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO email_suppressions (email, user_id, reason, kind, created_at)
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(email) DO UPDATE SET reason = excluded.reason, kind = excluded.kind, created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  )
    .bind(norm(params.email), params.userId ?? null, params.reason, params.kind ?? null)
    .run();
}

/** Lift a suppression (e.g. user re-subscribes from the preference center). */
export async function removeSuppression(env: Env, email: string): Promise<void> {
  await env.DB.prepare('DELETE FROM email_suppressions WHERE email = ?').bind(norm(email)).run();
}
