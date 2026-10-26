// Spec + query → one read-only SELECT:
//
//   SELECT <period> AS so_period, <dims> AS so_d0…, <aggregate> AS so_value
//   FROM (<base>) so_base
//   WHERE <time range> AND (<fixed filters>) AND <dim> IN (<literals>) AND <scope_field> IN (<scope>)
//   GROUP BY … ORDER BY … LIMIT 1000
//
// Identifiers come only from the validated spec; everything a query caller sends is a
// dimension name looked up in the spec or a literal. The viewer's scope is a WHERE
// condition, so it applies to rows before they are aggregated. A ratio is
// SUM(n) / NULLIF(SUM(d), 0) with the numerator cast to floating point.
import type { ViewerScope } from '../../data/access-policy';
import {
  IDENTIFIER,
  JSON_KEY,
  isIsoDate,
  queryIssue,
  type MetricAgg,
  type MetricGrain,
  type MetricMeasure,
  type MetricQueryInput,
  type MetricSpec,
  type SpecIssue,
} from './spec';
import { cleanBaseSql, compiledSqlProblem, filterColumns, filterProblem, sqlLiteral, type Dialect } from './sql-safety';
import type { CompileBase } from './target';

export const MAX_METRIC_ROWS = 1000;
const MAX_RANGE_DAYS = 3660;
const DAY_MS = 86_400_000;

export interface ResolvedQuery {
  grain: MetricGrain | null;
  by: string[];
  from: string | null;
  to: string | null;
  where: Record<string, Array<string | number>>;
}

export interface CompiledMetric {
  sql: string;
  period: boolean;
  /** Dimension names, in the order of so_d0, so_d1, … */
  dims: string[];
  ratio: boolean;
}

export type CompileResult = { ok: true; compiled: CompiledMetric } | { ok: false; issue: SpecIssue };

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** The first day of the window a grain shows by default, ending at `to` (whole periods). */
function defaultFrom(grain: MetricGrain, to: string): string {
  const d = new Date(dayMs(to));
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (grain) {
    case 'day':
      return isoDay(dayMs(to) - 29 * DAY_MS);
    case 'week':
      return isoDay(dayMs(to) - (((d.getUTCDay() + 6) % 7) + 11 * 7) * DAY_MS);
    case 'month':
      return isoDay(Date.UTC(y, m - 11, 1));
    case 'quarter':
      return isoDay(Date.UTC(y, m - (m % 3) - 21, 1));
    case 'year':
      return isoDay(Date.UTC(y - 4, 0, 1));
  }
}

/** A caller's query with defaults filled in: first grain, a sensible window ending today. */
export function resolveQuery(
  spec: MetricSpec,
  input: unknown,
  now = new Date()
): { ok: true; query: ResolvedQuery } | { ok: false; issue: SpecIssue } {
  const issue = queryIssue(spec, input);
  if (issue) return { ok: false, issue };
  const q = (input ?? {}) as MetricQueryInput;
  const base = { by: q.by ?? [], where: q.where ?? {} };
  if (!spec.time) return { ok: true, query: { grain: null, from: null, to: null, ...base } };
  const grain = q.grain ?? spec.time.grains[0];
  const to = q.to ?? isoDay(now.getTime());
  const from = q.from ?? defaultFrom(grain, to);
  if (from > to) return { ok: false, issue: { param: 'from', message: `from (${from}) is after to (${to})` } };
  if ((dayMs(to) - dayMs(from)) / DAY_MS > MAX_RANGE_DAYS) {
    return { ok: false, issue: { param: 'from', message: `The range is longer than ${MAX_RANGE_DAYS} days`, hint: 'Narrow from/to, or use a coarser grain.' } };
  }
  return { ok: true, query: { grain, from, to, ...base } };
}

function columnRef(d: Dialect, column: string): string {
  if (d === 'sqlite') {
    if (!JSON_KEY.test(column)) throw new CompileError('the spec names a column that is not a plain name', column);
    return `so_base."${column}"`;
  }
  if (!IDENTIFIER.test(column)) throw new CompileError('the spec names a column that is not a plain identifier', column);
  return `so_base.${column}`;
}

class CompileError extends Error {
  constructor(message: string, readonly param?: string, readonly hint?: string) {
    super(message);
  }
}

const AGG_SQL: Record<MetricAgg, (x: string) => string> = {
  sum: x => `SUM(${x})`,
  count: x => `COUNT(${x})`,
  count_distinct: x => `COUNT(DISTINCT ${x})`,
  avg: x => `AVG(${x})`,
  min: x => `MIN(${x})`,
  max: x => `MAX(${x})`,
};

const FLOAT: Record<Dialect, string> = { bigquery: 'FLOAT64', snowflake: 'FLOAT', postgres: 'DOUBLE PRECISION', sqlite: 'REAL' };

function aggregate(d: Dialect, m: MetricMeasure): string {
  if (m.expr === '*') return 'COUNT(*)';
  const ref = columnRef(d, m.expr);
  // A shared table stores JSON: numbers may arrive as text, so sum them as numbers.
  const numeric = d === 'sqlite' && m.agg !== 'count' && m.agg !== 'count_distinct' ? `CAST(${ref} AS REAL)` : ref;
  return AGG_SQL[m.agg](numeric);
}

const BQ_TRUNC: Record<MetricGrain, string> = { day: 'DAY', week: 'WEEK(MONDAY)', month: 'MONTH', quarter: 'QUARTER', year: 'YEAR' };

/** The period a row falls in, as 'YYYY-MM-DD' text in every dialect (weeks start Monday). */
function periodSql(d: Dialect, grain: MetricGrain, t: string): string {
  switch (d) {
    case 'bigquery':
      return `FORMAT_DATE('%Y-%m-%d', ${grain === 'day' ? `DATE(${t})` : `DATE_TRUNC(DATE(${t}), ${BQ_TRUNC[grain]})`})`;
    case 'snowflake':
      return `TO_CHAR(DATE_TRUNC('${grain.toUpperCase()}', CAST(${t} AS DATE)), 'YYYY-MM-DD')`;
    case 'postgres':
      return `TO_CHAR(DATE_TRUNC('${grain}', CAST(${t} AS DATE)), 'YYYY-MM-DD')`;
    case 'sqlite':
      return {
        day: `date(${t})`,
        week: `date(${t}, '-' || ((CAST(strftime('%w', ${t}) AS INTEGER) + 6) % 7) || ' days')`,
        month: `strftime('%Y-%m-01', ${t})`,
        quarter: `printf('%s-%02d-01', strftime('%Y', ${t}), ((CAST(strftime('%m', ${t}) AS INTEGER) - 1) / 3) * 3 + 1)`,
        year: `strftime('%Y-01-01', ${t})`,
      }[grain];
  }
}

function rangeSql(d: Dialect, t: string, from: string, to: string): string {
  if (!isIsoDate(from) || !isIsoDate(to)) throw new CompileError('from/to must be dates like 2026-03-31', 'from');
  switch (d) {
    case 'bigquery':
      return `DATE(${t}) BETWEEN DATE '${from}' AND DATE '${to}'`;
    case 'snowflake':
      return `CAST(${t} AS DATE) BETWEEN TO_DATE('${from}') AND TO_DATE('${to}')`;
    case 'postgres':
      return `CAST(${t} AS DATE) BETWEEN DATE '${from}' AND DATE '${to}'`;
    case 'sqlite':
      return `date(${t}) BETWEEN '${from}' AND '${to}'`;
  }
}

function literalList(d: Dialect, values: Array<string | number>, param: string): string {
  return values
    .map(v => {
      const lit = sqlLiteral(d, v);
      if (lit === null) throw new CompileError(`The value ${JSON.stringify(v)} cannot be used in a filter`, param, 'Values are text or numbers, without control characters.');
      return lit;
    })
    .join(', ');
}

function fqnSql(d: Dialect, fqn: string): string {
  const parts = fqn.split('.');
  if (d === 'bigquery') {
    if (parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw new CompileError(`source.fqn "${fqn}" is not a BigQuery table name`, 'source.fqn');
    return `\`${fqn}\``;
  }
  if (parts.some(p => !IDENTIFIER.test(p))) throw new CompileError(`source.fqn "${fqn}" is not a plain table name`, 'source.fqn', 'Name the table without quotes, or use source.sql.');
  return fqn;
}

function baseSql(d: Dialect, base: CompileBase, columns: string[]): string {
  if (base.kind === 'rows') {
    if (d !== 'sqlite') throw new CompileError('a shared table compiles only for the shared-table store', 'source');
    const projection = columns.length
      ? columns.map(c => `json_extract(data, '$."${c}"') AS "${c}"`).join(', ')
      : 'data';
    return `SELECT ${projection} FROM artifact_rows WHERE table_id = (SELECT id FROM artifact_tables WHERE artifact_id = ${sqlLiteral('sqlite', base.artifactId)} AND name = ${sqlLiteral('sqlite', base.table)})`;
  }
  if (base.kind === 'fqn') return `SELECT * FROM ${fqnSql(d, base.fqn)}`;
  const clean = cleanBaseSql(base.sql, d);
  if (!clean.ok) throw new CompileError(clean.reason, 'source.sql');
  return clean.sql;
}

/**
 * Compile a resolved query. `scope` null = an unscoped caller; a scope is applied to
 * the metric's `scope_field` before aggregation, and a metric without one refuses a
 * scoped caller instead of answering with every row.
 */
export function compileMetric(
  spec: MetricSpec,
  query: ResolvedQuery,
  target: { dialect: Dialect; base: CompileBase },
  scope: ViewerScope | null
): CompileResult {
  try {
    return { ok: true, compiled: compile(spec, query, target.dialect, target.base, scope) };
  } catch (e) {
    if (e instanceof CompileError) return { ok: false, issue: { message: e.message, ...(e.param ? { param: e.param } : {}), ...(e.hint ? { hint: e.hint } : {}) } };
    throw e;
  }
}

/** Whether the spec compiles for its target at all (a dialect may refuse what another accepts). */
export function compileProblem(spec: MetricSpec, target: { dialect: Dialect; base: CompileBase }): SpecIssue | null {
  const query = resolveQuery(spec, {});
  if (!query.ok) return query.issue;
  const compiled = compileMetric(spec, query.query, target, null);
  return compiled.ok ? null : compiled.issue;
}

function compile(spec: MetricSpec, query: ResolvedQuery, d: Dialect, base: CompileBase, scope: ViewerScope | null): CompiledMetric {
  if (scope && !spec.scope_field) {
    throw new CompileError('This metric has no scope_field, so it cannot answer a viewer who may only see part of the data', 'scope_field', 'Add scope_field: the column that holds the value a viewer is scoped to.');
  }
  if (scope && scope.field !== spec.scope_field) {
    throw new CompileError(`The viewer is scoped by ${scope.field}, but this metric scopes by ${spec.scope_field}`, 'scope_field');
  }

  const dimension = (name: string) => {
    const dim = spec.dimensions.find(x => x.name === name);
    if (!dim) throw new CompileError(`Unknown dimension "${name}"`, 'by');
    return dim;
  };
  const byDims = query.by.map(dimension);
  const whereDims = Object.entries(query.where).map(([name, values]) => ({ dim: dimension(name), values }));
  const ratio = spec.type === 'ratio';
  const measures = (ratio ? [spec.numerator, spec.denominator] : [spec.measure]).filter((m): m is MetricMeasure => !!m);
  if (measures.length !== (ratio ? 2 : 1)) throw new CompileError('The metric has no measure to compute', ratio ? 'numerator' : 'measure');
  if (query.grain && !spec.time) throw new CompileError('This metric has no time dimension', 'grain');

  const filterIssue = spec.filters.map(f => filterProblem(f, d)).find(Boolean);
  if (filterIssue) throw new CompileError(`A filter cannot be used: ${filterIssue}`, 'filters');

  // A shared table's rows are JSON: project exactly the columns this query reads.
  const columns = new Set<string>();
  if (d === 'sqlite') {
    if (spec.time && query.grain) columns.add(spec.time.dimension);
    for (const m of measures) if (m.expr !== '*') columns.add(m.expr);
    for (const x of [...byDims, ...whereDims.map(w => w.dim)]) columns.add(x.column);
    if (scope && spec.scope_field) columns.add(spec.scope_field);
    for (const f of spec.filters) for (const c of filterColumns(f)) if (JSON_KEY.test(c)) columns.add(c);
  }

  const select: string[] = [];
  const where: string[] = [];
  const period = !!(spec.time && query.grain);
  if (period && spec.time && query.grain) {
    const t = columnRef(d, spec.time.dimension);
    select.push(`${periodSql(d, query.grain, t)} AS so_period`);
    if (query.from && query.to) where.push(rangeSql(d, t, query.from, query.to));
  }
  byDims.forEach((dim, i) => select.push(`${columnRef(d, dim.column)} AS so_d${i}`));
  if (ratio) {
    const [n, den] = measures.map(m => aggregate(d, m));
    select.push(`CAST(${n} AS ${FLOAT[d]}) / NULLIF(${den}, 0) AS so_value`, `${n} AS so_num`, `${den} AS so_den`);
  } else {
    select.push(`${aggregate(d, measures[0])} AS so_value`);
  }

  for (const f of spec.filters) where.push(`(${f})`);
  for (const { dim, values } of whereDims) {
    where.push(`${columnRef(d, dim.column)} IN (${literalList(d, values, `where.${dim.name}`)})`);
  }
  if (scope && spec.scope_field) {
    where.push(scope.values.length ? `${columnRef(d, spec.scope_field)} IN (${literalList(d, scope.values, 'scope')})` : '1 = 0');
  }

  const keys = (period ? 1 : 0) + byDims.length;
  const ordinals = Array.from({ length: keys }, (_, i) => String(i + 1)).join(', ');
  const sql = [
    `SELECT\n  ${select.join(',\n  ')}`,
    `FROM (\n  ${baseSql(d, base, [...columns])}\n) so_base`,
    where.length ? `WHERE ${where.join('\n  AND ')}` : '',
    keys ? `GROUP BY ${ordinals}` : '',
    keys ? `ORDER BY ${ordinals}` : '',
    `LIMIT ${MAX_METRIC_ROWS}`,
  ]
    .filter(Boolean)
    .join('\n');

  // Defense in depth: what we send must itself pass the read-only gate as one statement.
  const problem = compiledSqlProblem(sql);
  if (problem) throw new CompileError(`The compiled query did not pass the read-only check: ${problem}`, 'source');
  return { sql, period, dims: byDims.map(x => x.name), ratio };
}
