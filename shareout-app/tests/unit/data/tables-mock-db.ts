// @vitest-environment node
/**
 * In-memory D1 mock for tables handler unit tests.
 * Mirrors artifact_tables / artifact_rows SQL used by src/data/tables/.
 * @module tests/unit/data/tables-mock-db
 */
import { vi } from 'vitest';

interface StoredRow {
  id: string;
  table_id: string;
  data: Record<string, unknown>;
}

interface StoredTable {
  id: string;
  artifact_id: string;
  name: string;
  row_count: number;
}

export function createTablesDb(initial?: {
  tables?: StoredTable[];
  rows?: StoredRow[];
  tableCountOverride?: number;
}) {
  const tables: StoredTable[] = [...(initial?.tables ?? [])];
  const rows: StoredRow[] = [...(initial?.rows ?? [])];

  function tableById(id: string) {
    return tables.find((t) => t.id === id);
  }

  function tableByName(artifactId: string, name: string) {
    return tables.find((t) => t.artifact_id === artifactId && t.name === name);
  }

  function rowsForTable(tableId: string) {
    return rows.filter((r) => r.table_id === tableId);
  }

  function parseRowData(raw: string | Record<string, unknown>): Record<string, unknown> {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }

  function matchFilter(data: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    for (const [field, value] of Object.entries(filter)) {
      const fieldVal = data[field];
      if (value === null) {
        if (fieldVal !== null && fieldVal !== undefined) return false;
        continue;
      }
      if (typeof value === 'object' && !Array.isArray(value)) {
        for (const [op, opVal] of Object.entries(value as Record<string, unknown>)) {
          switch (op) {
            case '$eq':
              if (fieldVal !== opVal) return false;
              break;
            case '$ne':
              if (fieldVal === opVal) return false;
              break;
            case '$gt':
              if (!(fieldVal as number > (opVal as number))) return false;
              break;
            case '$gte':
              if (!(fieldVal as number >= (opVal as number))) return false;
              break;
            case '$lt':
              if (!(fieldVal as number < (opVal as number))) return false;
              break;
            case '$lte':
              if (!(fieldVal as number <= (opVal as number))) return false;
              break;
            case '$in':
              if (!(opVal as unknown[]).includes(fieldVal)) return false;
              break;
            case '$nin':
              if ((opVal as unknown[]).includes(fieldVal)) return false;
              break;
            case '$contains':
              if (!String(fieldVal).includes(String(opVal))) return false;
              break;
            case '$startsWith':
              if (!String(fieldVal).startsWith(String(opVal))) return false;
              break;
            case '$endsWith':
              if (!String(fieldVal).endsWith(String(opVal))) return false;
              break;
          }
        }
      } else if (fieldVal !== value) {
        return false;
      }
    }
    return true;
  }

  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => {
          // Guard: the scalar subquery `(SELECT id FROM artifact_tables …)` is embedded
          // in DELETE statements too, so match only a standalone name→id lookup.
          if (sql.startsWith('SELECT id FROM artifact_tables WHERE artifact_id = ? AND name = ?')) {
            const [artifactId, name] = args as [string, string];
            const table = tableByName(artifactId, name);
            return table ? { id: table.id } : null;
          }

          // Upsert insert (getOrCreateTable): INSERT ... ON CONFLICT ... RETURNING id.
          if (sql.startsWith('INSERT INTO artifact_tables') && sql.includes('RETURNING id')) {
            const [id, artifactId, name] = args as [string, string, string];
            const existing = tableByName(artifactId, name);
            if (existing) return { id: existing.id };
            tables.push({ id, artifact_id: artifactId, name, row_count: 0 });
            return { id };
          }

          if (sql.includes('SELECT COUNT(*) as count FROM artifact_tables WHERE artifact_id = ?')) {
            const count = initial?.tableCountOverride ?? tables.filter((t) => t.artifact_id === args[0]).length;
            return { count };
          }

          if (sql.includes('SELECT row_count FROM artifact_tables WHERE id = ?')) {
            return tableById(args[0] as string) ?? null;
          }

          // opt-012: reads JOIN artifact_tables on (artifact_id, name); a missing table
          // is an empty result, never a create.
          if (sql.includes('SELECT COUNT(*) as total FROM artifact_rows r JOIN artifact_tables t')) {
            const table = tableByName(args[0] as string, args[1] as string);
            if (!table) return { total: 0 };
            const filter = parseSqlFilter(sql, args.slice(2));
            const matched = rowsForTable(table.id).filter((r) => matchFilter(r.data, filter));
            return { total: matched.length };
          }

          if (sql.includes('SELECT COUNT(*) as count FROM artifact_rows r JOIN artifact_tables t')) {
            const table = tableByName(args[0] as string, args[1] as string);
            if (!table) return { count: 0 };
            const filter = parseSqlFilter(sql, args.slice(2));
            const matched = rowsForTable(table.id).filter((r) => matchFilter(r.data, filter));
            return { count: matched.length };
          }

          // getRowById / updateRowById: SELECT r.data ... WHERE t.artifact_id=? AND t.name=? AND r.id=?
          if (sql.includes('SELECT r.data FROM artifact_rows r JOIN artifact_tables t') && sql.includes('r.id = ?')) {
            const [artifactId, name, rowId] = args as [string, string, string];
            const table = tableByName(artifactId, name);
            if (!table) return null;
            const row = rows.find((r) => r.table_id === table.id && r.id === rowId);
            return row ? { data: JSON.stringify(row.data) } : null;
          }

          // deleteRowById: DELETE ... table_id = (SELECT id ... name=?) AND id=? RETURNING id
          if (sql.includes('DELETE FROM artifact_rows WHERE table_id = (SELECT id') && sql.includes('RETURNING id')) {
            const [artifactId, name, rowId] = args as [string, string, string];
            const table = tableByName(artifactId, name);
            if (!table) return null;
            const idx = rows.findIndex((r) => r.table_id === table.id && r.id === rowId);
            if (idx === -1) return null;
            rows.splice(idx, 1);
            return { id: rowId };
          }

          // dropTable row count (by table id, no JOIN)
          if (sql.includes('SELECT COUNT(*) as count FROM artifact_rows WHERE table_id = ?') && !sql.includes('json_extract')) {
            const tableId = args[0] as string;
            return { count: rowsForTable(tableId).length };
          }

          return null;
        }),
        all: vi.fn(async () => {
          if (sql.includes('SELECT name, row_count as rowCount FROM artifact_tables')) {
            const artifactId = args[0] as string;
            return {
              results: tables
                .filter((t) => t.artifact_id === artifactId)
                .map((t) => ({ name: t.name, rowCount: t.row_count }))
                .sort((a, b) => a.name.localeCompare(b.name)),
            };
          }

          if (sql.includes('SELECT r.data FROM artifact_rows r JOIN artifact_tables t')) {
            const table = tableByName(args[0] as string, args[1] as string);
            if (!table) return { results: [] };
            const filter = parseSqlFilter(sql, args.slice(2, -2));
            let matched = rowsForTable(table.id).filter((r) => matchFilter(r.data, filter));

            const orderMatch = sql.match(/ORDER BY (.+?) LIMIT/);
            if (orderMatch) {
              const [field, dir] = orderMatch[1].split(/\s+/);
              const fieldName = field.match(/\$\.(.+?)'/)?.[1] ?? field;
              matched = [...matched].sort((a, b) => {
                const av = a.data[fieldName] as number | string;
                const bv = b.data[fieldName] as number | string;
                const cmp = av < bv ? -1 : av > bv ? 1 : 0;
                return dir === 'DESC' ? -cmp : cmp;
              });
            }

            const limit = args[args.length - 2] as number;
            const skip = args[args.length - 1] as number;
            matched = matched.slice(skip, skip + limit);

            return { results: matched.map((r) => ({ data: JSON.stringify(r.data) })) };
          }

          if (sql.includes('SELECT r.id, r.data FROM artifact_rows r JOIN artifact_tables t')) {
            const table = tableByName(args[0] as string, args[1] as string);
            if (!table) return { results: [] };
            const filter = parseSqlFilter(sql, args.slice(2));
            return {
              results: rowsForTable(table.id)
                .filter((r) => matchFilter(r.data, filter))
                .map((r) => ({ id: r.id, data: JSON.stringify(r.data) })),
            };
          }

          if (sql.includes('SELECT DISTINCT json_extract')) {
            const table = tableByName(args[0] as string, args[1] as string);
            if (!table) return { results: [] };
            const fieldMatch = sql.match(/\$\.(.+?)'/);
            const field = fieldMatch?.[1] ?? '';
            const filter = parseSqlFilter(sql, args.slice(2));
            const values = [...new Set(
              rowsForTable(table.id)
                .filter((r) => matchFilter(r.data, filter))
                .map((r) => r.data[field])
            )].sort();
            return { results: values.map((value) => ({ value })) };
          }

          return { results: [] };
        }),
        run: vi.fn(async () => {
          if (sql.includes('INSERT INTO artifact_tables')) {
            const [id, artifactId, name] = args as [string, string, string];
            tables.push({ id, artifact_id: artifactId, name, row_count: 0 });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes('INSERT INTO artifact_rows')) {
            const [id, tableId, jsonData] = args as [string, string, string];
            rows.push({ id, table_id: tableId, data: parseRowData(jsonData) });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes('UPDATE artifact_tables SET row_count = row_count + ?')) {
            const [delta, tableId] = args as [number, string];
            const table = tableById(tableId);
            if (table) table.row_count += delta;
            return { success: true, meta: { changes: 1 } };
          }

          // opt-012: row_count maintenance now keys off (artifact_id, name)
          if (sql.includes('UPDATE artifact_tables SET row_count = row_count - ?')) {
            const [delta, artifactId, name] = args as [number, string, string];
            const table = tableByName(artifactId, name);
            if (table) table.row_count -= delta;
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes('UPDATE artifact_tables SET row_count = row_count - 1')) {
            const [artifactId, name] = args as [string, string];
            const table = tableByName(artifactId, name);
            if (table) table.row_count -= 1;
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes('UPDATE artifact_rows SET data = ?')) {
            const [jsonData, rowId] = args as [string, string];
            const row = rows.find((r) => r.id === rowId);
            if (row) row.data = parseRowData(jsonData);
            return { success: true, meta: { changes: 1 } };
          }

          // deleteRows: DELETE ... table_id = (SELECT id ... name=?) AND <filter>
          if (sql.includes('DELETE FROM artifact_rows WHERE table_id = (SELECT id') && !sql.includes('RETURNING')) {
            const table = tableByName(args[0] as string, args[1] as string);
            if (!table) return { success: true, meta: { changes: 0 } };
            const filter = parseSqlFilter(sql, args.slice(2));
            const before = rows.length;
            for (let i = rows.length - 1; i >= 0; i--) {
              if (rows[i].table_id === table.id && matchFilter(rows[i].data, filter)) {
                rows.splice(i, 1);
              }
            }
            return { success: true, meta: { changes: before - rows.length } };
          }

          // dropTable: DELETE all rows for a table id
          if (sql === 'DELETE FROM artifact_rows WHERE table_id = ?') {
            const tableId = args[0] as string;
            const deleted = rows.filter((r) => r.table_id === tableId).length;
            for (let i = rows.length - 1; i >= 0; i--) {
              if (rows[i].table_id === tableId) rows.splice(i, 1);
            }
            return { success: true, meta: { changes: deleted } };
          }

          if (sql === 'DELETE FROM artifact_tables WHERE id = ?') {
            const tableId = args[0] as string;
            const idx = tables.findIndex((t) => t.id === tableId);
            if (idx !== -1) tables.splice(idx, 1);
            return { success: true, meta: { changes: 1 } };
          }

          return { success: true, meta: { changes: 0 } };
        }),
      })),
    })),
    batch: async (statements: Array<{ sql: string; bindings?: unknown[]; mode?: 'first' | 'all' | 'run' }>) => {
      const out: Array<{ result?: unknown; results?: unknown[]; meta?: { changes: number } }> = [];
      for (const s of statements) {
        const stmt = db.prepare(s.sql).bind(...(s.bindings ?? []));
        if (s.mode === 'first') out.push({ result: await stmt.first() });
        else if (s.mode === 'run') out.push({ meta: (await stmt.run()).meta });
        else out.push({ results: (await stmt.all()).results });
      }
      return out;
    },
    _state: { tables, rows },
  };

  return db;
}

// `whereParams` is the bound-param slice covering only the WHERE filter clause
// (callers strip the leading artifact_id/name and any trailing LIMIT/OFFSET).
function parseSqlFilter(sql: string, whereParams: unknown[]): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const params = whereParams;

  const fieldRegex = /json_extract\(data, '\$\.((?:[^'\\]|\\.)*)'\)\s*(=|!=|>=|<=|>|<|IS NULL|IN \(([^)]+)\)|NOT IN \(([^)]+)\)|LIKE)\s*/g;
  let match: RegExpExecArray | null;
  let paramIdx = 0;

  while ((match = fieldRegex.exec(sql)) !== null) {
    const field = match[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    const op = match[2];

    if (op === 'IS NULL') {
      filter[field] = null;
      continue;
    }

    if (op.startsWith('IN (')) {
      const placeholders = (match[3].match(/\?/g) ?? []).length;
      filter[field] = { $in: params.slice(paramIdx, paramIdx + placeholders) };
      paramIdx += placeholders;
      continue;
    }

    if (op.startsWith('NOT IN (')) {
      const placeholders = (match[4].match(/\?/g) ?? []).length;
      filter[field] = { $nin: params.slice(paramIdx, paramIdx + placeholders) };
      paramIdx += placeholders;
      continue;
    }

    const val = params[paramIdx++];
    switch (op) {
      case '=':
        filter[field] = val;
        break;
      case '!=':
        filter[field] = { $ne: val };
        break;
      case '>':
        filter[field] = { $gt: val };
        break;
      case '>=':
        filter[field] = { $gte: val };
        break;
      case '<':
        filter[field] = { $lt: val };
        break;
      case '<=':
        filter[field] = { $lte: val };
        break;
      case 'LIKE': {
        const likeVal = String(val);
        if (likeVal.startsWith('%') && likeVal.endsWith('%')) {
          filter[field] = { $contains: likeVal.slice(1, -1) };
        } else if (likeVal.endsWith('%')) {
          filter[field] = { $startsWith: likeVal.slice(0, -1) };
        } else {
          filter[field] = { $endsWith: likeVal.slice(1) };
        }
        break;
      }
    }
  }

  return filter;
}
