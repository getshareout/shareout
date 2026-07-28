import { createMiniDb, type MiniDb } from '../../data/minidb-client';
import { generateId } from '../../crypto-utils';
import { dispatchAction } from './dispatch';
import { errorResponse, jsonResponse } from './response';
import type { SDKEditorContext, SDKEditorHandler } from './types';

// Tables live in the per-artifact MiniDB (ADR 28): artifact_tables(name, row_count)
// + artifact_rows(table_id, data JSON). The store is schemaless — column structure
// is declared in the artifact manifest, not persisted here. Mirrors src/data/tables.ts.

function getTableName(ctx: SDKEditorContext): string {
  return ctx.component.name || 'default';
}

function safeParse(s: string): Record<string, unknown> {
  try { return JSON.parse(s || '{}') as Record<string, unknown>; } catch { return {}; }
}

async function resolveTableId(db: MiniDb, artifactId: string, name: string): Promise<string | null> {
  const row = await db.prepare(
    'SELECT id FROM artifact_tables WHERE artifact_id = ? AND name = ?'
  ).bind(artifactId, name).first<{ id: string }>();
  return row?.id ?? null;
}

/** Derive a display "schema" from sample-row keys (the store itself is schemaless). */
function deriveSchema(rows: Array<{ data: Record<string, unknown> }>): Array<{ name: string; type: string }> {
  const cols = new Map<string, string>();
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.data || {})) {
      if (!cols.has(k)) cols.set(k, Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
    }
  }
  return [...cols].map(([name, type]) => ({ name, type }));
}

export const handleTableEditor: SDKEditorHandler = async (request, ctx, action) => {
  const { artifactId, env } = ctx;
  const tableName = getTableName(ctx);
  const db = createMiniDb(env, artifactId, '');

  return dispatchAction(action, {
    get: async () => {
      const table = await db.prepare(
        'SELECT id, row_count FROM artifact_tables WHERE artifact_id = ? AND name = ?'
      ).bind(artifactId, tableName).first<{ id: string; row_count: number }>();

      if (!table?.id) {
        return jsonResponse({ success: true, tableName, schema: [], sampleRows: [], totalRows: 0 });
      }

      const rows = await db.prepare(
        'SELECT id, data, created_at FROM artifact_rows WHERE table_id = ? ORDER BY created_at DESC LIMIT 10'
      ).bind(table.id).all<{ id: string; data: string; created_at: string }>();

      const sampleRows = rows.results.map((r) => ({ id: r.id, data: safeParse(r.data), createdAt: r.created_at }));

      return jsonResponse({
        success: true,
        tableName,
        schema: deriveSchema(sampleRows),
        sampleRows,
        totalRows: table.row_count ?? 0,
      });
    },

    rows: async () => {
      const url = new URL(request.url);
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      const tableId = await resolveTableId(db, artifactId, tableName);
      if (!tableId) return jsonResponse({ success: true, rows: [] });

      const rows = await db.prepare(
        'SELECT id, data, created_at, updated_at FROM artifact_rows WHERE table_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).bind(tableId, limit, offset).all<{ id: string; data: string; created_at: string; updated_at: string }>();

      return jsonResponse({
        success: true,
        rows: rows.results.map((r) => ({
          id: r.id, data: safeParse(r.data), createdAt: r.created_at, updatedAt: r.updated_at,
        })),
      });
    },

    insert: async () => {
      let body: { data?: Record<string, unknown> };
      try { body = await request.json() as { data?: Record<string, unknown> }; }
      catch { return errorResponse('INVALID_REQUEST', 'Invalid JSON body', 400); }
      if (!body.data || typeof body.data !== 'object') {
        return errorResponse('INVALID_REQUEST', 'data object required', 400);
      }

      // Auto-create the table on first insert (mirrors src/data/tables.ts).
      let tableId = await resolveTableId(db, artifactId, tableName);
      if (!tableId) {
        tableId = generateId('tbl');
        await db.prepare(
          'INSERT INTO artifact_tables (id, artifact_id, name) VALUES (?, ?, ?)'
        ).bind(tableId, artifactId, tableName).run();
      }

      const rowId = generateId('row');
      await db.batch([
        { sql: 'INSERT INTO artifact_rows (id, table_id, data) VALUES (?, ?, ?)', bindings: [rowId, tableId, JSON.stringify(body.data)], mode: 'run' },
        { sql: "UPDATE artifact_tables SET row_count = row_count + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", bindings: [tableId], mode: 'run' },
      ]);

      return jsonResponse({ success: true, id: rowId });
    },

    update: async () => {
      let body: { id?: string; data?: Record<string, unknown> };
      try { body = await request.json() as { id?: string; data?: Record<string, unknown> }; }
      catch { return errorResponse('INVALID_REQUEST', 'Invalid JSON body', 400); }
      if (!body.id || !body.data) return errorResponse('INVALID_REQUEST', 'id and data required', 400);

      const tableId = await resolveTableId(db, artifactId, tableName);
      if (!tableId) return errorResponse('NOT_FOUND', 'Table not found', 404);

      await db.prepare(
        "UPDATE artifact_rows SET data = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND table_id = ?"
      ).bind(JSON.stringify(body.data), body.id, tableId).run();

      return jsonResponse({ success: true });
    },

    delete: async () => {
      let body: { id?: string };
      try { body = await request.json() as { id?: string }; }
      catch { return errorResponse('INVALID_REQUEST', 'Invalid JSON body', 400); }
      if (!body.id) return errorResponse('INVALID_REQUEST', 'id required', 400);

      const tableId = await resolveTableId(db, artifactId, tableName);
      if (!tableId) return errorResponse('NOT_FOUND', 'Table not found', 404);

      const deleted = await db.prepare(
        'DELETE FROM artifact_rows WHERE id = ? AND table_id = ? RETURNING id'
      ).bind(body.id, tableId).first<{ id: string }>();

      if (deleted) {
        await db.prepare(
          "UPDATE artifact_tables SET row_count = row_count - 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
        ).bind(tableId).run();
      }

      return jsonResponse({ success: true });
    },

    // The mini-store is schemaless; column structure is declared in the manifest.
    schema: async () => errorResponse(
      'NOT_SUPPORTED',
      'Table schema is declared in the artifact manifest, not stored server-side',
      400,
    ),
  });
};
