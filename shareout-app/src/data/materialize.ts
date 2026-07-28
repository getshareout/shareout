import type { Env } from '../types';
import { writeDatasetRows } from './datasets/handler';
import { writeTableRows } from './tables';
import { createMiniDb } from './minidb-client';
import { generateId } from '../crypto-utils';
import { recordDatasetLineage } from '../catalog';

export type ConnectionQueryFn = (
  connection: string,
  query: string | Record<string, unknown>,
  params?: Record<string, unknown>
) => Promise<unknown>;

export interface MaterializeParams {
  /** Run a query server-side via a connection (requires a queryFn). */
  source?: {
    connection: string;
    query: string | Record<string, unknown>;
    options?: { params?: Record<string, unknown> };
  };
  /** Or push pre-fetched rows directly (artifact fetched them by any means). */
  rows?: unknown[];
  /** dataset (R2) / table (D1) / json (key in the artifact's JSON store, optionally
   *  merged at `path` into the key's object — feeds dashboards that read json). */
  target: { type: 'dataset' | 'table' | 'json'; name: string; path?: string };
  mode?: 'replace' | 'append';
  format?: 'json' | 'csv';
}

export interface MaterializeResult {
  target: 'dataset' | 'table' | 'json';
  name: string;
  rowCount: number;
  version?: number;
  sizeBytes?: number;
  mode?: 'replace' | 'append';
  path?: string;
}

async function getArtifactWorkspaceId(env: Env, artifactId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?')
    .bind(artifactId).first<{ workspace_id: string | null }>();
  return row?.workspace_id ?? null;
}

/** Pull a row array out of common API response shapes. */
function extractRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of ['rows', 'data', 'results', 'records', 'items']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
    return [obj];
  }
  return data === undefined || data === null ? [] : [data];
}

/**
 * Extract once → store durably. Obtains rows (from inline `rows` or by running a
 * connection query via the injected queryFn) and writes them to a dataset (R2) or
 * table (D1). The expensive query runs here, off the serving path; subsequent reads
 * of the materialized data go direct-from-R2 (datasets) or via the table API.
 */
export async function runMaterialize(
  env: Env,
  artifactId: string,
  params: MaterializeParams,
  queryFn?: ConnectionQueryFn
): Promise<MaterializeResult> {
  if (!params.target?.type || !params.target?.name) {
    throw new Error('target { type, name } is required');
  }

  let rows: unknown[];
  if (params.rows) {
    rows = params.rows;
  } else if (params.source) {
    if (!queryFn) throw new Error('No query function available for source materialize');
    const data = await queryFn(
      params.source.connection,
      params.source.query,
      params.source.options?.params
    );
    rows = extractRows(data);
  } else {
    throw new Error('materialize requires either "source" or "rows"');
  }

  if (params.target.type === 'dataset') {
    const format = params.format === 'csv' ? 'csv' : 'json';
    const res = await writeDatasetRows(env, artifactId, params.target.name, format, rows);
    // Materializing FROM a connection: auto-link connection → dataset → artifact in
    // the workspace catalog (work/031, B14). Best-effort side effect — never a
    // reason to fail the materialize itself.
    if (params.source?.connection) {
      try {
        const workspaceId = await getArtifactWorkspaceId(env, artifactId);
        if (workspaceId) {
          await recordDatasetLineage(env, workspaceId, params.source.connection, res.name, artifactId);
        }
      } catch {
        // Lineage is a catalog side-effect, never a reason to fail a materialize.
      }
    }
    return { target: 'dataset', name: res.name, rowCount: res.rowCount, version: res.version, sizeBytes: res.sizeBytes };
  }

  if (params.target.type === 'table') {
    const objRows = rows.filter(
      (r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r)
    );
    const res = await writeTableRows(env, artifactId, params.target.name, objRows, params.mode || 'replace');
    return { target: 'table', name: res.name, rowCount: res.rowCount, mode: res.mode };
  }

  if (params.target.type === 'json') {
    const sizeBytes = await writeMaterializedJson(env, artifactId, params.target.name, params.target.path, rows);
    return { target: 'json', name: params.target.name, rowCount: rows.length, sizeBytes, path: params.target.path };
  }

  throw new Error('target.type must be "dataset", "table", or "json"');
}

/** Write `rows` to artifact_json[key], or merge them at key.<path> when path is set. */
async function writeMaterializedJson(
  env: Env,
  artifactId: string,
  key: string,
  path: string | undefined,
  rows: unknown[]
): Promise<number> {
  const workspaceId = await getArtifactWorkspaceId(env, artifactId);
  const db = createMiniDb(env, artifactId, workspaceId || '');

  let toStore: unknown = rows;
  if (path) {
    const existing = await db.prepare('SELECT value FROM artifact_json WHERE artifact_id = ? AND key = ?')
      .bind(artifactId, key).first<{ value: string }>();
    let obj: Record<string, unknown> = {};
    if (existing) {
      try {
        const parsed = JSON.parse(existing.value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed as Record<string, unknown>;
      } catch { /* overwrite a non-object value */ }
    }
    obj[path] = rows;
    toStore = obj;
  }

  const json = JSON.stringify(toStore);
  const size = new TextEncoder().encode(json).length;
  const now = new Date().toISOString();
  const ex = await db.prepare('SELECT id FROM artifact_json WHERE artifact_id = ? AND key = ?')
    .bind(artifactId, key).first<{ id: string }>();
  if (ex) {
    await db.prepare('UPDATE artifact_json SET value = ?, size_bytes = ?, updated_at = ? WHERE id = ?')
      .bind(json, size, now, ex.id).run();
  } else {
    await db.prepare('INSERT INTO artifact_json (id, artifact_id, key, value, size_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(generateId('jsn'), artifactId, key, json, size, now, now).run();
  }
  return size;
}
