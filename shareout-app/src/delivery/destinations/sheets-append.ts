import type { Destination } from '../types';
import type { SheetsAppendConfig } from '../../scheduling/jobs';
import { queryConnectionAny } from '../../data/connections/warehouse-query';
import { appendSheetValues } from '../../data/sheets/sheet-api';
import { getArtifactAccessToken } from '../../data/sheets/artifact-tokens';
import { resolveSpreadsheetId } from '../../data/sheets/utils';

// Generic "warehouse/REST → Google Sheet" appender. Run one configured query on
// the artifact owner's credentials and append the result rows to a connected
// sheet, so any artifact can keep a growing daily history in a spreadsheet the
// customer already shares. The append primitive (read-write OAuth scope +
// values:append) already exists; this destination is the scheduled entry point.

/** Coerce a query result into an array of row objects. Warehouse connections
 *  already return Record<string,unknown>[]; tolerate a {rows:[...]} envelope. */
function normalizeRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === 'object') {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  }
  return [];
}

/** Render one field as a Sheets cell value. Objects/arrays are JSON-encoded;
 *  null/undefined become empty cells. Primitives pass through for USER_ENTERED. */
function cell(v: unknown): string | number | boolean {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  return JSON.stringify(v);
}

export const sheetsAppendDestination: Destination<SheetsAppendConfig> = {
  kind: 'sheets_append',

  async validate(_env, _ctx, config) {
    if (!config?.connection) return 'sheets_append requires a connection name';
    if (!config?.query) return 'sheets_append requires a query';
    if (!config?.spreadsheetId && !config?.spreadsheetUrl) {
      return 'sheets_append requires spreadsheetId or spreadsheetUrl';
    }
    if (!resolveSpreadsheetId(config)) return 'could not parse a spreadsheet id from spreadsheetUrl/spreadsheetId';
    if (config.columns && !Array.isArray(config.columns)) return 'columns must be an array of field names';
    return null;
  },

  async deliver(env, ctx, config) {
    try {
      const spreadsheetId = resolveSpreadsheetId(config);
      if (!spreadsheetId) return { success: false, error: 'could not resolve spreadsheetId' };

      const art = await env.DB.prepare('SELECT owner_id FROM artifacts WHERE id = ?')
        .bind(ctx.artifactId).first<{ owner_id: string | null }>();
      const userId = art?.owner_id || ctx.createdBy;

      const result = await queryConnectionAny(
        env, ctx.artifactId, config.connection, config.query, config.params, userId
      );
      const rows = normalizeRows(result);

      if (rows.length === 0) {
        if (config.skipIfEmpty === false) return { success: false, error: 'query returned no rows' };
        return { success: true };
      }

      const columns = (config.columns && config.columns.length) ? config.columns : Object.keys(rows[0]);
      const values = rows.map((r) => columns.map((c) => cell(r[c])));

      const token = await getArtifactAccessToken(env, ctx.artifactId);
      if (!token) return { success: false, error: 'Google Sheets not connected for this artifact' };

      await appendSheetValues(token, spreadsheetId, config.range || 'Sheet1', values);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'sheets_append failed' };
    }
  },
};
