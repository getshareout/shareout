import type { Env } from '../types';
import { generateArtifactSummary } from './auto-summary';

/**
 * Hourly drip backfill of auto-summaries for artifacts published before the
 * auto-summary feature shipped. Self-terminating: generateArtifactSummary
 * always stamps auto_summary_hash (even on unparseable LLM output or a
 * user-set description), so a row leaves this query's result set for good
 * once processed. Only a thrown LLM call leaves the hash NULL for retry.
 */
const BACKFILL_LIMIT = 25;

export async function runSummaryBackfill(env: Env): Promise<{ processed: number }> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT a.id AS artifact_id
       FROM artifacts a
       JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
       JOIN versions v ON v.id = d.version_id
       JOIN assets ast ON ast.version_id = v.id AND ast.path = v.entrypoint
       LEFT JOIN artifact_presentation pres_a ON pres_a.artifact_id = a.id
       WHERE ast.mime = 'text/html'
         AND a.deleted_at IS NULL
         AND (a.description IS NULL OR a.description = '')
         AND pres_a.auto_summary_hash IS NULL
       ORDER BY d.updated_at DESC
       LIMIT ?`,
    ).bind(BACKFILL_LIMIT).all<{ artifact_id: string }>();

    let processed = 0;
    for (const r of results || []) {
      try {
        await generateArtifactSummary(env, r.artifact_id);
      } catch {
        // one artifact's failure must not block the rest of the drip
      }
      processed++;
    }
    return { processed };
  } catch {
    // backfill must never throw out of the scheduled handler
    return { processed: 0 };
  }
}
