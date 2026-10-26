import type { Env } from '../types';
import { parseKnowledge, type KnowledgeFile } from './parse';
import type { ParseResult } from './types';

export type KnowledgeFileSource = 'learned' | 'manual' | 'consolidated';

export interface StoredKnowledgeFile extends KnowledgeFile {
  source: KnowledgeFileSource;
  updatedAt: string;
}

export async function isKnowledgeEnabled(env: Env, workspaceId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT enabled FROM knowledge_settings WHERE workspace_id = ?'
  )
    .bind(workspaceId)
    .first<{ enabled: number }>();
  return !!row && row.enabled === 1;
}

export async function setKnowledgeEnabled(
  env: Env,
  workspaceId: string,
  enabled: boolean
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO knowledge_settings (workspace_id, enabled, updated_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(workspace_id) DO UPDATE SET enabled = excluded.enabled, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  )
    .bind(workspaceId, enabled ? 1 : 0)
    .run();
}

export async function upsertKnowledgeFile(
  env: Env,
  workspaceId: string,
  file: { path: string; content: string; source?: KnowledgeFileSource }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO workspace_files (workspace_id, namespace, path, content, source, updated_at)
     VALUES (?, 'knowledge', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(workspace_id, namespace, scope_id, path)
       DO UPDATE SET content = excluded.content, source = excluded.source, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  )
    .bind(workspaceId, file.path, file.content, file.source ?? 'learned')
    .run();
}

/**
 * Write a learner/consolidator file, but never clobber a human-edited (source='manual')
 * row — same seed-protection rule catalog follows. Returns false when skipped.
 */
export async function upsertLearnedFile(
  env: Env,
  workspaceId: string,
  file: { path: string; content: string; source?: KnowledgeFileSource }
): Promise<boolean> {
  // ponytail: read-then-write TOCTOU accepted — D1 has no cheap txn; a manual edit racing a learner write can lose, rare and self-heals next sweep.
  const existing = await env.DB.prepare(
    "SELECT source FROM workspace_files WHERE workspace_id = ? AND namespace = 'knowledge' AND path = ?"
  )
    .bind(workspaceId, file.path)
    .first<{ source: KnowledgeFileSource }>();
  if (existing?.source === 'manual') return false;
  await upsertKnowledgeFile(env, workspaceId, { ...file, source: file.source ?? 'learned' });
  return true;
}

export async function deleteKnowledgeFile(
  env: Env,
  workspaceId: string,
  path: string,
  opts: { forget?: boolean } = {}
): Promise<void> {
  await env.DB.prepare("DELETE FROM workspace_files WHERE workspace_id = ? AND namespace = 'knowledge' AND path = ?")
    .bind(workspaceId, path)
    .run();
  if (opts.forget) {
    await env.DB.prepare(
      `INSERT INTO knowledge_tombstones (workspace_id, path, forgotten_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(workspace_id, path) DO UPDATE SET forgotten_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    )
      .bind(workspaceId, path)
      .run();
  }
}

export async function isTombstoned(env: Env, workspaceId: string, path: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 AS x FROM knowledge_tombstones WHERE workspace_id = ? AND path = ?'
  )
    .bind(workspaceId, path)
    .first<{ x: number }>();
  return !!row;
}

export async function listKnowledgeFiles(
  env: Env,
  workspaceId: string
): Promise<StoredKnowledgeFile[]> {
  const rows = await env.DB.prepare(
    "SELECT path, content, source, updated_at FROM workspace_files WHERE workspace_id = ? AND namespace = 'knowledge' ORDER BY path"
  )
    .bind(workspaceId)
    .all<{ path: string; content: string; source: KnowledgeFileSource; updated_at: string }>();
  return rows.results.map(r => ({
    path: r.path,
    content: r.content,
    source: r.source,
    updatedAt: r.updated_at,
  }));
}

export async function loadKnowledge(env: Env, workspaceId: string): Promise<ParseResult> {
  const files = await listKnowledgeFiles(env, workspaceId);
  return parseKnowledge(files);
}

export async function getKnowledgeFile(
  env: Env,
  workspaceId: string,
  path: string
): Promise<StoredKnowledgeFile | null> {
  const row = await env.DB.prepare(
    "SELECT path, content, source, updated_at FROM workspace_files WHERE workspace_id = ? AND namespace = 'knowledge' AND path = ?"
  )
    .bind(workspaceId, path)
    .first<{ path: string; content: string; source: KnowledgeFileSource; updated_at: string }>();
  return row
    ? { path: row.path, content: row.content, source: row.source, updatedAt: row.updated_at }
    : null;
}

export async function listKnowledgeFilesByPrefix(
  env: Env,
  workspaceId: string,
  prefix: string
): Promise<StoredKnowledgeFile[]> {
  const rows = await env.DB.prepare(
    "SELECT path, content, source, updated_at FROM workspace_files WHERE workspace_id = ? AND namespace = 'knowledge' AND path LIKE ? || '%' ORDER BY path"
  )
    .bind(workspaceId, prefix)
    .all<{ path: string; content: string; source: KnowledgeFileSource; updated_at: string }>();
  return rows.results.map(r => ({
    path: r.path,
    content: r.content,
    source: r.source,
    updatedAt: r.updated_at,
  }));
}

export async function setLastConsolidatedAt(
  env: Env,
  workspaceId: string,
  isoWhen: string
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO knowledge_settings (workspace_id, enabled, last_consolidated_at, updated_at)
     VALUES (?, 1, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(workspace_id) DO UPDATE SET
       last_consolidated_at = excluded.last_consolidated_at,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  )
    .bind(workspaceId, isoWhen)
    .run();
}

// Enabled workspaces that are dirty (a digest edited past the watermark), owe a rebuild
// (a page their notes cite went private or into the trash), or have been idle for >7 days
// (weekly maintenance sweep). Oldest-watermark-first = starvation-free.
export async function listConsolidationCandidates(
  env: Env,
  limit: number
): Promise<Array<{ workspaceId: string; lastConsolidatedAt: string | null; rebuildRequestedAt: string | null }>> {
  const rows = await env.DB.prepare(
    `SELECT ks.workspace_id, ks.last_consolidated_at, ks.rebuild_requested_at FROM knowledge_settings ks
     WHERE ks.enabled = 1 AND (
       EXISTS (SELECT 1 FROM workspace_files kf
               WHERE kf.workspace_id = ks.workspace_id AND kf.namespace = 'knowledge'
                 AND kf.path LIKE 'artifacts/%'
                 AND kf.updated_at > COALESCE(ks.last_consolidated_at, '1970-01-01'))
       OR ks.rebuild_requested_at IS NOT NULL
       OR COALESCE(ks.last_consolidated_at, '1970-01-01') < strftime('%Y-%m-%dT%H:%M:%fZ','now', '-7 days')
     )
     ORDER BY COALESCE(ks.last_consolidated_at, '1970-01-01') ASC
     LIMIT ?`
  )
    .bind(limit)
    .all<{ workspace_id: string; last_consolidated_at: string | null; rebuild_requested_at: string | null }>();
  return rows.results.map(r => ({
    workspaceId: r.workspace_id,
    lastConsolidatedAt: r.last_consolidated_at,
    rebuildRequestedAt: r.rebuild_requested_at,
  }));
}

/**
 * A page went private or into the trash: ask the next consolidation to rebuild the notes
 * learned from it, instead of waiting for the weekly sweep. Best-effort — readers already
 * stop seeing those notes, and the sweep would get to them anyway.
 */
export async function requestKnowledgeRebuild(env: Env, workspaceId: string | null): Promise<void> {
  if (!workspaceId) return;
  try {
    await env.DB.prepare(
      "UPDATE knowledge_settings SET rebuild_requested_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE workspace_id = ?"
    )
      .bind(workspaceId)
      .run();
  } catch {
    // best-effort
  }
}

/** Clear a request the consolidator has served — unless a newer one arrived meanwhile. */
export async function clearKnowledgeRebuild(env: Env, workspaceId: string, requestedAt: string): Promise<void> {
  await env.DB.prepare(
    'UPDATE knowledge_settings SET rebuild_requested_at = NULL WHERE workspace_id = ? AND rebuild_requested_at = ?'
  )
    .bind(workspaceId, requestedAt)
    .run();
}
