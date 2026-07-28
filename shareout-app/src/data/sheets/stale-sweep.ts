import type { Env } from '../../types';

/**
 * Stale-data sentinel: flags artifacts whose Google Sheets source hasn't synced
 * in STALE_THRESHOLD_DAYS. Scoped to Sheets connections because that's the only
 * connector with a real per-artifact last-sync timestamp today — Data Platform
 * connectors (Snowflake, GA, Shopify, etc.) are live-query proxies with no sync
 * concept to go stale. Re-notifies at most once per RENOTIFY_COOLDOWN_DAYS while
 * still stale, via the same column used for the staleness check itself.
 */
const STALE_THRESHOLD_DAYS = 7;
const RENOTIFY_COOLDOWN_DAYS = 7;
const SWEEP_LIMIT = 200;

interface StaleRow {
  connection_id: string;
  connection_name: string;
  last_synced_at: string;
  artifact_id: string;
}

export async function runStaleDataSweep(env: Env): Promise<{ notified: number }> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT c.id AS connection_id, c.name AS connection_name, c.last_synced_at, a.id AS artifact_id
       FROM sheet_syncs c
       JOIN artifacts a ON a.id = c.artifact_id
       WHERE a.deleted_at IS NULL
         AND c.last_synced_at IS NOT NULL
         AND c.last_synced_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)
         AND (c.last_notified_stale_at IS NULL OR c.last_notified_stale_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?))
       LIMIT ?`,
    ).bind(`-${STALE_THRESHOLD_DAYS} days`, `-${RENOTIFY_COOLDOWN_DAYS} days`, SWEEP_LIMIT).all<StaleRow>();

    const rows = results || [];
    let notified = 0;
    for (const r of rows) {
      try {
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO notifications (id, recipient_type, recipient_id, kind, subject_type, subject_id, message, created_at)
             VALUES (?, 'artifact', ?, 'stale_data', 'connection', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
          ).bind(
            crypto.randomUUID(),
            r.artifact_id,
            r.connection_id,
            `"${r.connection_name}" hasn't synced since ${r.last_synced_at} — this dashboard may be showing stale data.`,
          ),
          env.DB.prepare(
            `UPDATE sheet_syncs SET last_notified_stale_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
          ).bind(r.connection_id),
        ]);
        notified++;
      } catch {
        // one connection's failure must not block the rest of the sweep
      }
    }
    return { notified };
  } catch {
    // sweep must never throw out of the scheduled handler
    return { notified: 0 };
  }
}
