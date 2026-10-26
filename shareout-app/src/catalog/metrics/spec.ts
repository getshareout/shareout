// The metric spec: a `kind: metric` catalog entry's frontmatter, validated on write.
// Every key is known — an unknown one is refused with the key it most likely meant —
// because a typo in a governed metric ("numerador") would otherwise be silently ignored.
//
// Columns are only ever named here (never by the caller of a query), so the compiler
// can splice them into SQL: on a warehouse they are plain identifiers; on a shared table
// they are JSON keys, which may carry accents and spaces ("Inversión", "Fecha de venta").
import { cleanBaseSql, filterProblem } from './sql-safety';
import { extractFrontmatter } from '../parse';

export const METRIC_TYPES = ['simple', 'ratio'] as const;
export const METRIC_AGGS = ['sum', 'count', 'count_distinct', 'avg', 'min', 'max'] as const;
export const METRIC_GRAINS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export const FORMAT_KINDS = ['number', 'ratio', 'percent', 'currency'] as const;

export type MetricType = (typeof METRIC_TYPES)[number];
export type MetricAgg = (typeof METRIC_AGGS)[number];
export type MetricGrain = (typeof METRIC_GRAINS)[number];
export type FormatKind = (typeof FORMAT_KINDS)[number];

export interface MetricMeasure {
  agg: MetricAgg;
  /** A column of the source, or `*` for `agg: count`. */
  expr: string;
}

export type MetricSource =
  | { kind: 'fqn'; connection: string; fqn: string }
  | { kind: 'sql'; connection: string; sql: string }
  | { kind: 'shared_table'; shared_table: string };

export interface MetricDimension {
  name: string;
  column: string;
}

export interface MetricFormat {
  kind: FormatKind;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  currency?: string;
}

export interface MetricQueryInput {
  grain?: MetricGrain;
  by?: string[];
  from?: string;
  to?: string;
  where?: Record<string, Array<string | number>>;
}

export interface MetricExample {
  es?: string;
  en?: string;
  query: MetricQueryInput;
}

export interface MetricSpec {
  id: string;
  title: string;
  title_es?: string;
  owner?: string;
  synonyms?: Record<string, string[]>;
  description?: string | Record<string, string>;
  source: MetricSource;
  type: MetricType;
  measure?: MetricMeasure;
  numerator?: MetricMeasure;
  denominator?: MetricMeasure;
  time?: { dimension: string; grains: MetricGrain[] };
  dimensions: MetricDimension[];
  filters: string[];
  format: MetricFormat;
  scope_field?: string;
  freshness_sla?: string;
  examples: MetricExample[];
}

export interface SpecIssue {
  message: string;
  param?: string;
  hint?: string;
}

export type SpecResult = { ok: true; spec: MetricSpec } | { ok: false; issue: SpecIssue };

/** Keys that say "this metric is meant to run" — a metric without them is descriptive only. */
const EXECUTABLE_KEYS = ['source', 'type', 'measure', 'numerator', 'denominator', 'time', 'dimensions', 'filters', 'scope_field'];

// Catalog keys every entry may carry. Location keys are refused on a metric: its data
// lives under `source:`, and a top-level `connection` would otherwise be ignored.
const CATALOG_KEYS = ['kind', 'id', 'title', 'domain', 'status', 'owner', 'tags', 'terms', 'upstream', 'downstream', 'aspects', 'aliases', 'last_updated'];
const METRIC_KEYS = [
  'title_es', 'synonyms', 'description', 'source', 'type', 'measure', 'numerator', 'denominator',
  'time', 'dimensions', 'filters', 'format', 'scope_field', 'freshness_sla', 'examples',
];
const TOP_KEYS = [...CATALOG_KEYS, ...METRIC_KEYS];
const LOCATION_KEYS = ['connection', 'connection_id', 'fqn', 'artifact', 'store'];

export const MAX_DIMENSIONS = 12;
export const MAX_FILTERS = 20;
const MAX_FILTER_CHARS = 500;
const MAX_SQL_CHARS = 20_000;
const MAX_EXAMPLES = 10;
export const MAX_WHERE_VALUES = 100;

/** A warehouse column or alias: a plain identifier, spliced into SQL unquoted. */
export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** A shared-table column is a JSON key: letters (accents too), digits, `_`, `-` and spaces. */
export const JSON_KEY = /^[\p{L}\p{N}_][\p{L}\p{N}_ -]{0,63}$/u;
/** A dimension's public name (query `by` / `where`, row keys): may be Spanish. */
const DIMENSION_NAME = /^[\p{L}_][\p{L}\p{N}_ -]{0,63}$/u;
const RESERVED_ROW_KEYS = new Set(['period', 'value', 'numerator', 'denominator']);
const FQN_PART = /^[A-Za-z0-9_][A-Za-z0-9_$-]*$/;
const SHARED_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const CONNECTION_ID = /^conn_[A-Za-z0-9_-]+$/;
const FRESHNESS = /^(\d{1,4})\s*(m|h|d|w)$/;
const CURRENCY = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export function isExecutableMetricData(data: Record<string, unknown>): boolean {
  return data.kind === 'metric' && EXECUTABLE_KEYS.some(k => data[k] !== undefined && data[k] !== null);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

// Spanish names an agency is likely to type for the English keys.
const SPANISH_KEYS: Record<string, string> = {
  fuente: 'source', tipo: 'type', medida: 'measure', numerador: 'numerator', denominador: 'denominator',
  tiempo: 'time', dimensiones: 'dimensions', filtros: 'filters', formato: 'format', ejemplos: 'examples',
  sinonimos: 'synonyms', sinónimos: 'synonyms', descripcion: 'description', descripción: 'description', dueño: 'owner',
};

function suggest(key: string, allowed: readonly string[]): string | undefined {
  const spanish = SPANISH_KEYS[key.toLowerCase()];
  if (spanish && allowed.includes(spanish)) return spanish;
  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of allowed) {
    const d = editDistance(key.toLowerCase(), candidate);
    if (d < bestScore) {
      best = candidate;
      bestScore = d;
    }
  }
  return best && bestScore <= Math.max(2, Math.floor(key.length / 3)) ? best : undefined;
}

class SpecError extends Error {
  constructor(readonly issue: SpecIssue) {
    super(issue.message);
  }
}

function fail(param: string, message: string, hint?: string): never {
  throw new SpecError({ param, message, ...(hint ? { hint } : {}) });
}

function onlyKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(obj)) {
    if (allowed.includes(key)) continue;
    const guess = suggest(key, allowed);
    const at = where ? `${where}.${key}` : key;
    fail(
      at,
      `Unknown key "${key}"${where ? ` in ${where}` : ''} of a metric spec.${guess ? ` Did you mean "${guess}"?` : ''}`,
      `Allowed${where ? ` in ${where}` : ''}: ${allowed.join(', ')}.`
    );
  }
}

function text(v: unknown, param: string, max = 200): string {
  if (!isText(v)) fail(param, `${param} must be a non-empty string`);
  const s = String(v).trim();
  if (s.length > max) fail(param, `${param} is too long (max ${max} characters)`);
  return s;
}

function oneOf<T extends string>(v: unknown, values: readonly T[], param: string): T {
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) {
    fail(param, `${param} must be one of: ${values.join(', ')}`);
  }
  return v as T;
}

function column(v: unknown, param: string, sharedTable: boolean): string {
  const c = text(v, param, 64);
  if (sharedTable ? !JSON_KEY.test(c) : !IDENTIFIER.test(c)) {
    fail(
      param,
      sharedTable
        ? `${param} "${c}" is not a column name: use letters, digits, spaces, "_" or "-"`
        : `${param} "${c}" must be a plain column name (letters, digits, "_")`,
      sharedTable ? undefined : 'Compute anything else in source.sql and name the result there.'
    );
  }
  return c;
}

function measure(v: unknown, param: string, sharedTable: boolean): MetricMeasure {
  if (!isObject(v)) fail(param, `${param} must be an object like { agg: sum, expr: revenue }`);
  onlyKeys(v, ['agg', 'expr'], param);
  const agg = oneOf(v.agg, METRIC_AGGS, `${param}.agg`);
  if (v.expr === '*') {
    if (agg !== 'count') fail(`${param}.expr`, `${param}.expr "*" only works with agg: count`);
    return { agg, expr: '*' };
  }
  return { agg, expr: column(v.expr, `${param}.expr`, sharedTable) };
}

function source(v: unknown): MetricSource {
  if (!isObject(v)) {
    fail('source', 'source must be an object', 'Use { connection: conn_…, fqn: dataset.table }, { connection: conn_…, sql: "SELECT …" } or { shared_table: name }.');
  }
  onlyKeys(v, ['connection', 'fqn', 'sql', 'shared_table'], 'source');
  if (v.shared_table !== undefined) {
    if (v.connection !== undefined || v.fqn !== undefined || v.sql !== undefined) {
      fail('source', 'A shared_table source takes no connection, fqn or sql');
    }
    const name = text(v.shared_table, 'source.shared_table', 64);
    if (!SHARED_NAME.test(name)) fail('source.shared_table', `source.shared_table "${name}" is not a shared table name`);
    return { kind: 'shared_table', shared_table: name };
  }
  const connection = text(v.connection, 'source.connection', 64);
  if (!CONNECTION_ID.test(connection)) {
    fail(
      'source.connection',
      `source.connection must be a connection id (conn_…), not "${connection}"`,
      'Ids survive renames. GET /v1/workspaces/{id}/connections lists them.'
    );
  }
  if ((v.fqn === undefined) === (v.sql === undefined)) fail('source', 'source needs exactly one of fqn or sql');
  if (v.fqn !== undefined) {
    const fqn = text(v.fqn, 'source.fqn', 256);
    const parts = fqn.split('.');
    if (parts.length > 3 || parts.some(p => !FQN_PART.test(p))) {
      fail('source.fqn', `source.fqn "${fqn}" must be a table name like dataset.table or schema.table`);
    }
    return { kind: 'fqn', connection, fqn };
  }
  const sql = text(v.sql, 'source.sql', MAX_SQL_CHARS);
  const clean = cleanBaseSql(sql);
  if (!clean.ok) fail('source.sql', clean.reason, 'source.sql is one read-only SELECT; the metric adds grouping, filters and the time range.');
  return { kind: 'sql', connection, sql };
}

function format(v: unknown): MetricFormat {
  if (v === undefined || v === null) return { kind: 'number' };
  if (!isObject(v)) fail('format', 'format must be an object like { kind: currency, currency: ARS }');
  onlyKeys(v, ['kind', 'decimals', 'prefix', 'suffix', 'currency'], 'format');
  const out: MetricFormat = { kind: oneOf(v.kind ?? 'number', FORMAT_KINDS, 'format.kind') };
  if (v.decimals !== undefined) {
    if (!Number.isInteger(v.decimals) || (v.decimals as number) < 0 || (v.decimals as number) > 6) {
      fail('format.decimals', 'format.decimals must be a whole number from 0 to 6');
    }
    out.decimals = v.decimals as number;
  }
  for (const key of ['prefix', 'suffix'] as const) {
    if (v[key] === undefined) continue;
    if (typeof v[key] !== 'string' || (v[key] as string).length > 8) fail(`format.${key}`, `format.${key} must be a short string`);
    out[key] = v[key] as string;
  }
  if (out.kind === 'currency') {
    if (typeof v.currency !== 'string' || !CURRENCY.test(v.currency)) {
      fail('format.currency', 'format.currency must be an ISO currency code like ARS or USD');
    }
    out.currency = v.currency;
  } else if (v.currency !== undefined) {
    fail('format.currency', 'format.currency only applies to format.kind: currency');
  }
  return out;
}

function stringList(v: unknown, param: string, max: number, maxChars: number): string[] {
  if (!Array.isArray(v)) fail(param, `${param} must be a list`);
  if (v.length > max) fail(param, `${param} has too many items (max ${max})`);
  return v.map((item, i) => text(item, `${param}[${i}]`, maxChars));
}

function localized(v: unknown, param: string): string | Record<string, string> {
  if (typeof v === 'string') return text(v, param, 2000);
  if (!isObject(v)) fail(param, `${param} must be text or { es: …, en: … }`);
  const out: Record<string, string> = {};
  for (const [lang, value] of Object.entries(v)) {
    if (!/^[a-z]{2}$/.test(lang)) fail(`${param}.${lang}`, `${param} keys are language codes like es or en`);
    out[lang] = text(value, `${param}.${lang}`, 2000);
  }
  return out;
}

function synonyms(v: unknown): Record<string, string[]> {
  if (!isObject(v)) fail('synonyms', 'synonyms must be { es: [...], en: [...] }');
  const out: Record<string, string[]> = {};
  for (const [lang, list] of Object.entries(v)) {
    if (!/^[a-z]{2}$/.test(lang)) fail(`synonyms.${lang}`, 'synonyms keys are language codes like es or en');
    out[lang] = stringList(list, `synonyms.${lang}`, 30, 100);
  }
  return out;
}

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Structural check of a query against a spec (examples on write; callers at run time). */
export function queryIssue(spec: Pick<MetricSpec, 'time' | 'dimensions'>, q: unknown, param = 'query'): SpecIssue | null {
  try {
    checkQuery(spec, q, param);
    return null;
  } catch (e) {
    if (e instanceof SpecError) return e.issue;
    throw e;
  }
}

function checkQuery(spec: Pick<MetricSpec, 'time' | 'dimensions'>, q: unknown, param: string): MetricQueryInput {
  if (q === undefined || q === null) return {};
  if (!isObject(q)) fail(param, `${param} must be an object like { grain: month, by: [canal] }`);
  onlyKeys(q, ['grain', 'by', 'from', 'to', 'where'], param);
  const names = spec.dimensions.map(d => d.name);
  const out: MetricQueryInput = {};
  if (q.grain !== undefined) {
    if (!spec.time) fail(`${param}.grain`, 'This metric has no time dimension, so it takes no grain');
    out.grain = oneOf(q.grain, spec.time.grains, `${param}.grain`);
  }
  for (const key of ['from', 'to'] as const) {
    if (q[key] === undefined) continue;
    if (!spec.time) fail(`${param}.${key}`, `This metric has no time dimension, so it takes no ${key}`);
    if (!isIsoDate(q[key])) fail(`${param}.${key}`, `${param}.${key} must be a date like 2026-03-31`);
    out[key] = q[key] as string;
  }
  if (out.from && out.to && out.from > out.to) fail(`${param}.from`, `${param}.from is after ${param}.to`);
  if (q.by !== undefined) {
    if (!Array.isArray(q.by)) fail(`${param}.by`, `${param}.by must be a list of dimension names`);
    out.by = [];
    for (const name of q.by) {
      if (typeof name !== 'string' || !names.includes(name)) {
        fail(`${param}.by`, `Unknown dimension "${String(name)}"`, names.length ? `Dimensions: ${names.join(', ')}.` : 'This metric has no dimensions.');
      }
      if (!out.by.includes(name)) out.by.push(name);
    }
  }
  if (q.where !== undefined) {
    if (!isObject(q.where)) fail(`${param}.where`, `${param}.where must be { dimension: [values] }`);
    out.where = {};
    for (const [name, values] of Object.entries(q.where)) {
      if (!names.includes(name)) {
        fail(`${param}.where.${name}`, `Unknown dimension "${name}"`, names.length ? `Dimensions: ${names.join(', ')}.` : 'This metric has no dimensions.');
      }
      const list = Array.isArray(values) ? values : [values];
      if (!list.length || list.length > MAX_WHERE_VALUES) {
        fail(`${param}.where.${name}`, `${param}.where.${name} takes 1 to ${MAX_WHERE_VALUES} values`);
      }
      for (const v of list) {
        const ok = (typeof v === 'string' && v.length <= 200) || (typeof v === 'number' && Number.isFinite(v));
        if (!ok) fail(`${param}.where.${name}`, `${param}.where.${name} values must be text or numbers`);
      }
      out.where[name] = list as Array<string | number>;
    }
  }
  return out;
}

/** Validate a metric's frontmatter into a spec. Never throws. */
export function validateMetricSpec(data: Record<string, unknown>): SpecResult {
  try {
    return { ok: true, spec: build(data) };
  } catch (e) {
    if (e instanceof SpecError) return { ok: false, issue: e.issue };
    throw e;
  }
}

function build(data: Record<string, unknown>): MetricSpec {
  for (const key of LOCATION_KEYS) {
    if (data[key] !== undefined) {
      fail(key, `A metric keeps its data location under source:, not in a top-level "${key}"`, 'Use source: { connection: conn_…, fqn: dataset.table } or source: { shared_table: name }.');
    }
  }
  onlyKeys(data, TOP_KEYS, '');
  const src = source(data.source);
  const shared = src.kind === 'shared_table';
  const type = oneOf(data.type, METRIC_TYPES, 'type');
  const spec: MetricSpec = {
    id: text(data.id, 'id', 200),
    title: text(data.title, 'title', 200),
    source: src,
    type,
    dimensions: [],
    filters: [],
    format: format(data.format),
    examples: [],
  };
  if (data.title_es !== undefined) spec.title_es = text(data.title_es, 'title_es', 200);
  if (data.owner !== undefined) spec.owner = text(data.owner, 'owner', 200);
  if (data.synonyms !== undefined) spec.synonyms = synonyms(data.synonyms);
  if (data.description !== undefined) spec.description = localized(data.description, 'description');

  if (type === 'simple') {
    if (data.numerator !== undefined || data.denominator !== undefined) {
      fail('type', 'A simple metric has a measure, not a numerator/denominator', 'Use type: ratio for numerator ÷ denominator.');
    }
    spec.measure = measure(data.measure, 'measure', shared);
  } else {
    if (data.measure !== undefined) fail('type', 'A ratio metric has a numerator and a denominator, not a measure');
    spec.numerator = measure(data.numerator, 'numerator', shared);
    spec.denominator = measure(data.denominator, 'denominator', shared);
  }

  if (data.time !== undefined) {
    if (!isObject(data.time)) fail('time', 'time must be { dimension: date_column, grains: [day, month] }');
    onlyKeys(data.time, ['dimension', 'grains'], 'time');
    const raw = Array.isArray(data.time.grains) ? data.time.grains : [];
    if (!raw.length) fail('time.grains', `time.grains must list at least one of: ${METRIC_GRAINS.join(', ')}`);
    const grains: MetricGrain[] = [];
    for (const g of raw) {
      const grain = oneOf(g, METRIC_GRAINS, 'time.grains');
      if (!grains.includes(grain)) grains.push(grain);
    }
    spec.time = { dimension: column(data.time.dimension, 'time.dimension', shared), grains };
  }

  if (data.dimensions !== undefined) {
    if (!Array.isArray(data.dimensions)) fail('dimensions', 'dimensions must be a list of { name, column }');
    if (data.dimensions.length > MAX_DIMENSIONS) fail('dimensions', `A metric takes at most ${MAX_DIMENSIONS} dimensions`);
    data.dimensions.forEach((d, i) => {
      const param = `dimensions[${i}]`;
      if (!isObject(d)) fail(param, `${param} must be { name, column }`);
      onlyKeys(d, ['name', 'column'], param);
      const name = text(d.name, `${param}.name`, 64);
      if (!DIMENSION_NAME.test(name) || RESERVED_ROW_KEYS.has(name)) {
        fail(`${param}.name`, `${param}.name "${name}" is not a usable dimension name`, 'Use letters, digits, spaces, "_" or "-"; period, value, numerator and denominator are taken.');
      }
      if (spec.dimensions.some(x => x.name === name)) fail(`${param}.name`, `Dimension "${name}" is listed twice`);
      spec.dimensions.push({ name, column: column(d.column, `${param}.column`, shared) });
    });
  }

  if (data.filters !== undefined) {
    spec.filters = stringList(data.filters, 'filters', MAX_FILTERS, MAX_FILTER_CHARS);
    spec.filters.forEach((f, i) => {
      const problem = filterProblem(f, shared ? 'sqlite' : null);
      if (problem) fail(`filters[${i}]`, `filters[${i}] cannot be used: ${problem}`, `A filter is one condition, like "status = 'active'".`);
    });
  }

  if (data.scope_field !== undefined) spec.scope_field = column(data.scope_field, 'scope_field', shared);

  if (data.freshness_sla !== undefined) {
    if (typeof data.freshness_sla !== 'string' || !FRESHNESS.test(data.freshness_sla.trim())) {
      fail('freshness_sla', 'freshness_sla must be a duration like 90m, 26h, 2d or 1w');
    }
    spec.freshness_sla = data.freshness_sla.trim();
  }

  if (data.examples !== undefined) {
    if (!Array.isArray(data.examples) || data.examples.length > MAX_EXAMPLES) {
      fail('examples', `examples must be a list of at most ${MAX_EXAMPLES} items`);
    }
    data.examples.forEach((ex, i) => {
      const param = `examples[${i}]`;
      if (!isObject(ex)) fail(param, `${param} must be { es: "…", query: { … } }`);
      onlyKeys(ex, ['es', 'en', 'query'], param);
      const example: MetricExample = { query: checkQuery(spec, ex.query, `${param}.query`) };
      if (ex.es !== undefined) example.es = text(ex.es, `${param}.es`, 300);
      if (ex.en !== undefined) example.en = text(ex.en, `${param}.en`, 300);
      spec.examples.push(example);
    });
  }
  return spec;
}

/**
 * Why a catalog file cannot be written, or null: an executable metric must be a valid
 * spec. Anything else — including a metric that only describes itself — is untouched.
 */
export function metricWriteIssue(path: string, content: string): SpecIssue | null {
  if (!path.toLowerCase().endsWith('.md')) return null;
  const data = extractFrontmatter(content)?.data;
  if (!data || !isExecutableMetricData(data)) return null;
  const result = validateMetricSpec(data);
  return result.ok ? null : result.issue;
}

/** freshness_sla in milliseconds. */
export function freshnessMs(sla: string): number {
  const m = sla.trim().match(FRESHNESS);
  if (!m) return NaN;
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[m[2] as 'm' | 'h' | 'd' | 'w'];
  return Number(m[1]) * unit;
}

const AGG_TEXT: Record<MetricAgg, (expr: string) => string> = {
  sum: e => `Σ ${e}`,
  count: e => (e === '*' ? 'count(*)' : `count(${e})`),
  count_distinct: e => `count distinct(${e})`,
  avg: e => `avg(${e})`,
  min: e => `min(${e})`,
  max: e => `max(${e})`,
};

/** "Σ revenue ÷ Σ spend" — how the number is computed, for people and agents. */
export function metricFormula(spec: Pick<MetricSpec, 'type' | 'measure' | 'numerator' | 'denominator'>): string {
  const part = (m?: MetricMeasure) => (m ? AGG_TEXT[m.agg](m.expr) : '?');
  return spec.type === 'ratio' ? `${part(spec.numerator)} ÷ ${part(spec.denominator)}` : part(spec.measure);
}
