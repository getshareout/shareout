import { generateId } from '../../crypto-utils';
import type { Env } from '../../types';
import { createMiniDb, type MiniBatchStatement } from '../minidb-client';
import {
  MAX_ROW_SIZE,
  MAX_ROWS_PER_TABLE,
  MAX_TABLES_PER_ARTIFACT,
} from './constants';
import { validateTableName } from './validation';

/**
 * Durably materialize rows into a table (env-based, no request context).
 * `replace` clears existing rows first; `append` adds to them.
 * Used by the materialize endpoint and scheduled refresh.
 */
export async function writeTableRows(
  env: Env,
  artifactId: string,
  name: string,
  rows: Record<string, unknown>[],
  mode: 'replace' | 'append' = 'replace',
): Promise<{ name: string; rowCount: number; mode: 'replace' | 'append' }> {
  const nameError = validateTableName(name);
  if (nameError) throw new Error(nameError);

  const ws = await env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?')
    .bind(artifactId).first<{ workspace_id: string | null }>();
  const db = createMiniDb(env, artifactId, ws?.workspace_id || '');

  let table = await db.prepare(
    'SELECT id, row_count FROM artifact_tables WHERE artifact_id = ? AND name = ?',
  ).bind(artifactId, name).first<{ id: string; row_count: number }>();

  if (!table) {
    const tableCount = await db.prepare(
      'SELECT COUNT(*) as count FROM artifact_tables WHERE artifact_id = ?',
    ).bind(artifactId).first<{ count: number }>();
    if (tableCount && tableCount.count >= MAX_TABLES_PER_ARTIFACT) {
      throw new Error(`Table limit reached (${MAX_TABLES_PER_ARTIFACT} per artifact)`);
    }
    const id = generateId('tbl');
    await db.prepare(
      'INSERT INTO artifact_tables (id, artifact_id, name) VALUES (?, ?, ?)',
    ).bind(id, artifactId, name).run();
    table = { id, row_count: 0 };
  }
  const tableId = table.id;

  if (mode === 'replace') {
    await db.prepare('DELETE FROM artifact_rows WHERE table_id = ?').bind(tableId).run();
    table.row_count = 0;
  }

  if (table.row_count + rows.length > MAX_ROWS_PER_TABLE) {
    throw new Error(`Row limit exceeded (${MAX_ROWS_PER_TABLE} per table)`);
  }

  const now = new Date().toISOString();
  const inserts: MiniBatchStatement[] = rows.map((row) => {
    const id = generateId('row');
    const data = JSON.stringify({ id, ...row, createdAt: now, updatedAt: now });
    if (new TextEncoder().encode(data).length > MAX_ROW_SIZE) {
      throw new Error(`Row exceeds ${MAX_ROW_SIZE / 1000}KB limit`);
    }
    return {
      sql: 'INSERT INTO artifact_rows (id, table_id, data) VALUES (?, ?, ?)',
      bindings: [id, tableId, data],
      mode: 'run',
    };
  });

  for (let i = 0; i < inserts.length; i += 100) {
    await db.batch(inserts.slice(i, i + 100));
  }

  const newCount = (mode === 'replace' ? 0 : table.row_count) + rows.length;
  await db.prepare(
    `UPDATE artifact_tables SET row_count = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
  ).bind(newCount, tableId).run();

  return { name, rowCount: rows.length, mode };
}
