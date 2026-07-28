import type { Env } from '../types';

/** Claim a one-time send. Returns true if this (type, key) was not seen before —
 *  i.e. the caller now owns sending it. Idempotent across hourly cron re-runs. */
export async function claimEmailSend(env: Env, type: string, key: string): Promise<boolean> {
  const res = await env.DB.prepare('INSERT OR IGNORE INTO email_log (type, key) VALUES (?, ?)')
    .bind(type, key)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}
