import type { Env } from '../types';
import { parseCatalog } from './parse';
import type { CatalogFile } from './parse';
import type { ParseResult } from './types';
import { metricIndexDelete, metricIndexStatements } from './metrics/index-sync';

export type CatalogFileSource = 'manual' | 'seed:connector' | 'seed:provenance';
export type CatalogEditorKind = 'user' | 'agent';

export interface StoredCatalogFile extends CatalogFile {
  source: CatalogFileSource;
  updatedAt: string;
  updatedBy: string | null;
  updatedByKind: CatalogEditorKind;
}

export async function isCatalogEnabled(env: Env, workspaceId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT enabled FROM catalog_settings WHERE workspace_id = ?'
  )
    .bind(workspaceId)
    .first<{ enabled: number }>();
  return !!row && row.enabled === 1;
}

export async function setCatalogEnabled(
  env: Env,
  workspaceId: string,
  enabled: boolean
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO catalog_settings (workspace_id, enabled, updated_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(workspace_id) DO UPDATE SET enabled = excluded.enabled, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  )
    .bind(workspaceId, enabled ? 1 : 0)
    .run();
}

// Every write records who made it: `updated_by` is the member (null for seeds), and
// `updated_by_kind` says whether a person or an agent/automation wrote it.
export async function upsertCatalogFile(
  env: Env,
  workspaceId: string,
  file: {
    path: string;
    content: string;
    source?: CatalogFileSource;
    updatedBy?: string | null;
    updatedByKind?: CatalogEditorKind;
  }
): Promise<void> {
  const updatedBy = file.updatedBy ?? null;
  const kind = file.updatedByKind ?? (updatedBy ? 'user' : 'agent');
  const write = env.DB.prepare(
    `INSERT INTO workspace_files (workspace_id, namespace, path, content, source, updated_by, updated_by_kind, updated_at)
     VALUES (?, 'catalog', ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(workspace_id, namespace, scope_id, path)
       DO UPDATE SET content = excluded.content, source = excluded.source, updated_by = excluded.updated_by,
         updated_by_kind = excluded.updated_by_kind, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).bind(workspaceId, file.path, file.content, file.source ?? 'manual', updatedBy, kind);
  // The metric index moves with the file, in one batch, so the two never disagree.
  const index = await metricIndexStatements(env, workspaceId, { path: file.path, content: file.content, updatedBy });
  await env.DB.batch([write, ...index]);
}

export async function deleteCatalogFile(
  env: Env,
  workspaceId: string,
  path: string
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM workspace_files WHERE workspace_id = ? AND namespace = 'catalog' AND path = ?").bind(workspaceId, path),
    metricIndexDelete(env, workspaceId, path),
  ]);
}

export async function listCatalogFiles(
  env: Env,
  workspaceId: string
): Promise<StoredCatalogFile[]> {
  const rows = await env.DB.prepare(
    "SELECT path, content, source, updated_at, updated_by, updated_by_kind FROM workspace_files WHERE workspace_id = ? AND namespace = 'catalog' ORDER BY path"
  )
    .bind(workspaceId)
    .all<{
      path: string;
      content: string;
      source: CatalogFileSource;
      updated_at: string;
      updated_by: string | null;
      updated_by_kind: CatalogEditorKind;
    }>();
  return rows.results.map(r => ({
    path: r.path,
    content: r.content,
    source: r.source,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
    updatedByKind: r.updated_by_kind,
  }));
}

export async function loadCatalog(env: Env, workspaceId: string): Promise<ParseResult> {
  const files = await listCatalogFiles(env, workspaceId);
  return parseCatalog(files);
}
