// Keeps `catalog_metrics` in line with the catalog files. Called by the store on every
// write and delete (in the same D1 batch as the file, so the two never disagree) and
// by the catalog seed to backfill files written before the index existed.
import type { Env } from '../../types';
import { generateId } from '../../crypto-utils';
import { extractFrontmatter } from '../parse';
import { certificationHash } from '../certification';
import { isExecutableMetricData, validateMetricSpec } from './spec';
import { loadWorkspaceSources, resolveTarget, type WorkspaceSources } from './target';
import { compileProblem } from './compile';
import { JSON_IN, jsonList } from '../../sql-in';

export interface IndexedFile {
  path: string;
  content: string;
  updatedBy: string | null;
}

interface IndexRow {
  entryId: string;
  connectionId: string | null;
  specJson: string;
  specHash: string;
  compileError: string | null;
}

async function indexRow(env: Env, workspaceId: string, file: IndexedFile, sources?: WorkspaceSources): Promise<IndexRow | null> {
  if (!file.path.toLowerCase().endsWith('.md')) return null;
  const data = extractFrontmatter(file.content)?.data;
  const entryId = data?.id == null ? '' : String(data.id).trim();
  if (!data || data.kind !== 'metric' || !entryId) return null;
  const specHash = await certificationHash('metric', file.content);
  if (!isExecutableMetricData(data)) {
    return { entryId, connectionId: null, specJson: '{}', specHash, compileError: 'No executable spec yet: add source and type' };
  }
  const parsed = validateMetricSpec(data);
  if (!parsed.ok) return { entryId, connectionId: null, specJson: '{}', specHash, compileError: parsed.issue.message };
  const target = resolveTarget(parsed.spec, sources ?? (await loadWorkspaceSources(env, workspaceId)));
  const problem = target.ok ? compileProblem(parsed.spec, target.target) : target.issue;
  return {
    entryId,
    connectionId: target.ok ? target.target.connection?.id ?? null : null,
    specJson: JSON.stringify(parsed.spec),
    specHash,
    compileError: problem?.message ?? null,
  };
}

const UPSERT = `INSERT INTO catalog_metrics (id, workspace_id, entry_id, path, connection_id, spec_json, spec_hash, compile_error, updated_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(workspace_id, entry_id) DO UPDATE SET path = excluded.path, connection_id = excluded.connection_id,
    spec_json = excluded.spec_json, spec_hash = excluded.spec_hash, compile_error = excluded.compile_error,
    updated_by = excluded.updated_by, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

/** Statements that bring the index in line with one file write (run them with the write). */
export async function metricIndexStatements(
  env: Env,
  workspaceId: string,
  file: IndexedFile,
  sources?: WorkspaceSources
): Promise<D1PreparedStatement[]> {
  if (!file.path.toLowerCase().endsWith('.md')) return [];
  const row = await indexRow(env, workspaceId, file, sources);
  if (!row) return [metricIndexDelete(env, workspaceId, file.path)];
  return [
    // The file may have held another metric id before this write.
    env.DB.prepare('DELETE FROM catalog_metrics WHERE workspace_id = ? AND path = ? AND entry_id != ?').bind(workspaceId, file.path, row.entryId),
    env.DB.prepare(UPSERT).bind(
      generateId('cmet'),
      workspaceId,
      row.entryId,
      file.path,
      row.connectionId,
      row.specJson,
      row.specHash,
      row.compileError,
      file.updatedBy
    ),
  ];
}

export function metricIndexDelete(env: Env, workspaceId: string, path: string): D1PreparedStatement {
  return env.DB.prepare('DELETE FROM catalog_metrics WHERE workspace_id = ? AND path = ?').bind(workspaceId, path);
}

/** Bring the workspace's whole index in line with its catalog files. Returns the metric count. */
export async function syncMetricIndex(env: Env, workspaceId: string, files: IndexedFile[]): Promise<number> {
  const sources = await loadWorkspaceSources(env, workspaceId);
  const statements: D1PreparedStatement[] = [];
  const ids: string[] = [];
  for (const file of files) {
    const row = await indexRow(env, workspaceId, file, sources);
    if (!row || ids.includes(row.entryId)) continue;
    ids.push(row.entryId);
    statements.push(
      env.DB.prepare(UPSERT).bind(
        generateId('cmet'),
        workspaceId,
        row.entryId,
        file.path,
        row.connectionId,
        row.specJson,
        row.specHash,
        row.compileError,
        file.updatedBy
      )
    );
  }
  statements.push(
    env.DB.prepare(`DELETE FROM catalog_metrics WHERE workspace_id = ? AND entry_id NOT IN ${JSON_IN}`).bind(workspaceId, jsonList(ids))
  );
  await env.DB.batch(statements);
  return ids.length;
}
