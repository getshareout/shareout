import type { Env } from '../../types';

export async function updateSyncLog(
  env: Env,
  logId: string,
  status: string,
  rowsAffected: number,
  errorMessage?: string
): Promise<void> {
  await env.DB.prepare(`
    UPDATE sheets_sync_log
    SET status = ?, rows_affected = ?, error_message = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
  `).bind(status, rowsAffected, errorMessage || null, logId).run();
}
