import type { Env } from '../types';
import { parseCatalog } from './parse';
import type { CatalogFile } from './parse';
import type { ParseResult } from './types';

export type CatalogFileSource = 'manual' | 'seed:connector' | 'seed:provenance';

// Limits for files written through the API (`PUT …/catalog/files`). One asset per file.
export const MAX_CATALOG_FILE_BYTES = 128 * 1024;
const MAX_CATALOG_PATH_LENGTH = 200;
const MAX_CATALOG_PATH_DEPTH = 4;
const CATALOG_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const CATALOG_PATH_RULE =
  `Use a relative path to a .md file, e.g. "sources/orders.md": letters, digits, ".", "_" and "-", each name starting with a letter or digit, no "..", at most ${MAX_CATALOG_PATH_DEPTH} levels and ${MAX_CATALOG_PATH_LENGTH} characters.`;

export function isValidCatalogPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length > MAX_CATALOG_PATH_LENGTH || path.includes('..') || !/\.md$/i.test(path)) return false;
  const segments = path.split('/');
  return segments.length <= MAX_CATALOG_PATH_DEPTH && segments.every((s) => CATALOG_PATH_SEGMENT.test(s));
}

export function catalogContentBytes(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

export interface StoredCatalogFile extends CatalogFile {
  source: CatalogFileSource;
  updatedAt: string;
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

export async function upsertCatalogFile(
  env: Env,
  workspaceId: string,
  file: { path: string; content: string; source?: CatalogFileSource }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO workspace_files (workspace_id, namespace, path, content, source, updated_at)
     VALUES (?, 'catalog', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(workspace_id, namespace, scope_id, path)
       DO UPDATE SET content = excluded.content, source = excluded.source, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  )
    .bind(workspaceId, file.path, file.content, file.source ?? 'manual')
    .run();
}

export async function deleteCatalogFile(
  env: Env,
  workspaceId: string,
  path: string
): Promise<void> {
  await env.DB.prepare("DELETE FROM workspace_files WHERE workspace_id = ? AND namespace = 'catalog' AND path = ?")
    .bind(workspaceId, path)
    .run();
}

export async function listCatalogFiles(
  env: Env,
  workspaceId: string
): Promise<StoredCatalogFile[]> {
  const rows = await env.DB.prepare(
    "SELECT path, content, source, updated_at FROM workspace_files WHERE workspace_id = ? AND namespace = 'catalog' ORDER BY path"
  )
    .bind(workspaceId)
    .all<{ path: string; content: string; source: CatalogFileSource; updated_at: string }>();
  return rows.results.map(r => ({
    path: r.path,
    content: r.content,
    source: r.source,
    updatedAt: r.updated_at,
  }));
}

export async function loadCatalog(env: Env, workspaceId: string): Promise<ParseResult> {
  const files = await listCatalogFiles(env, workspaceId);
  return parseCatalog(files);
}
