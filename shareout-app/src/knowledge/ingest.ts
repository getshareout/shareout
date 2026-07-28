import type { Env } from '../types';

/**
 * Queue an artifact for distillation. Hash-debounced: if the same content_hash
 * was already processed for this (workspace, artifact, reason), it's a no-op —
 * re-deploying identical content won't re-learn. Any other case (new hash, or an
 * unprocessed row) resets the row to unprocessed. Cheap, no LLM.
 */
export async function enqueueIngest(
  env: Env,
  workspaceId: string,
  artifactId: string,
  reason: string,
  contentHash: string | null
): Promise<void> {
  const existing = await env.DB.prepare(
    'SELECT content_hash, processed_at FROM knowledge_ingest WHERE workspace_id = ? AND artifact_id = ? AND reason = ?'
  )
    .bind(workspaceId, artifactId, reason)
    .first<{ content_hash: string | null; processed_at: string | null }>();

  if (existing && existing.processed_at && existing.content_hash === contentHash) return;

  await env.DB.prepare(
    `INSERT OR REPLACE INTO knowledge_ingest (workspace_id, artifact_id, content_hash, reason, queued_at, processed_at)
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL)`
  )
    .bind(workspaceId, artifactId, contentHash, reason)
    .run();
}
