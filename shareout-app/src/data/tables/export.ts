import { DATA_ERRORS } from '../../types';
import { corsHeaders, errorResponse, type DataContext } from '../middleware';
import { MAX_QUERY_LIMIT } from './constants';
import { runScopedQuery } from './query';

function csvEscape(val: unknown): string {
  if (val == null) return '';
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Stream all scoped rows as CSV (pages through runScopedQuery). */
export async function exportTableCsv(
  ctx: DataContext,
  tableName: string,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const sortParam = url.searchParams.get('sort') || 'createdAt:asc';
  const [sortField, sortDirRaw] = sortParam.split(':');
  const sortDir = sortDirRaw === 'desc' ? 'desc' : 'asc';
  const filename = (url.searchParams.get('filename') || `${tableName}.csv`)
    .replace(/[^\w.\-]/g, '_')
    .slice(0, 120);

  const rows: Record<string, unknown>[] = [];
  for (let skip = 0; ; skip += MAX_QUERY_LIMIT) {
    const page = await runScopedQuery(ctx, tableName, {
      sort: { [sortField]: sortDir },
      limit: MAX_QUERY_LIMIT,
      skip,
      count: false,
    });
    rows.push(...page.rows);
    if (!page.hasMore || page.rows.length === 0) break;
  }

  if (rows.length === 0) {
    return errorResponse({
      code: 'NO_DATA',
      message: 'No rows to export',
      status: 404,
      hint: 'The table is empty. Save projections before exporting.',
    }, ctx.origin);
  }

  const skipCols = new Set(['createdAt', 'updatedAt']);
  const columns = Object.keys(rows[0]).filter((k) => !skipCols.has(k));

  const lines = [
    columns.join(','),
    ...rows.map((row) => columns.map((h) => csvEscape(row[h])).join(',')),
  ];

  return new Response('\ufeff' + lines.join('\n'), {
    status: 200,
    headers: {
      ...corsHeaders(ctx.origin),
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
