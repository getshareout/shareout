import type { Env } from '../../types';
import type { QuerySnapshotConfig } from '../../scheduling/jobs';

/** Crew tool names / SDK reads — not valid warehouse provenance for recipients. */
const INTERNAL_SOURCE_RE = /^(json_get|table_query|table_schema|materialize_query|connection_query)\s*\(/i;

export type ProvenanceSource = {
  connection?: string;
  label?: string;
  query?: string;
  asOf?: string;
  tables?: string[];
  columns?: string[];
  filters?: string[];
};

export function isInternalProvenanceSource(source: unknown): boolean {
  if (!source || typeof source !== 'object') return false;
  const s = source as Record<string, unknown>;
  const query = typeof s.query === 'string' ? s.query.trim() : '';
  const origin =
    (typeof s.label === 'string' ? s.label.trim() : '') ||
    (typeof s.connection === 'string' ? s.connection.trim() : '');
  if (INTERNAL_SOURCE_RE.test(query)) return true;
  if (/json_get|table_query|table_schema|materialize_query|connection_query/i.test(origin)) return true;
  return false;
}

function hasWarehouseProvenance(source: ProvenanceSource): boolean {
  return !!(
    source.connection?.trim() ||
    source.label?.trim() ||
    source.query?.trim() ||
    source.tables?.length ||
    source.columns?.length ||
    source.filters?.length
  );
}

/** Extract dataset.table names from backtick-quoted BigQuery refs. */
export function extractTablesFromSql(sql: string): string[] {
  const tables: string[] = [];
  const re = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const full = m[1];
    if (!full.includes('.')) continue;
    const short = full.split('.').slice(-2).join('.');
    if (!tables.includes(short)) tables.push(short);
  }
  return tables;
}

/** Collect SELECT … AS alias names (digest KPI fields, etc.). */
export function extractSelectColumns(sql: string): string[] {
  const aliases: string[] = [];
  const re = /\bAS\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    if (!aliases.includes(m[1])) aliases.push(m[1]);
  }
  return aliases;
}

/** Pull human-readable WHERE predicates from SQL (deduped, capped). */
export function extractWhereFilters(sql: string, max = 6): string[] {
  const filters: string[] = [];
  const re = /\bWHERE\s+([\s\S]+?)(?=\bGROUP\b|\bORDER\b|\bQUALIFY\b|\bLIMIT\b|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    for (const part of m[1].split(/\s+AND\s+/i)) {
      const cleaned = part.trim().replace(/\s+/g, ' ');
      if (!cleaned || cleaned.length > 100) continue;
      if (!filters.includes(cleaned)) filters.push(cleaned);
    }
  }
  return filters.slice(0, max);
}

/** Pick a representative SQL line from a query_snapshot job for delivery footers. */
export function pickSnapshotQuery(config: QuerySnapshotConfig): string | undefined {
  const queries = config.queries ?? [];
  const digestTrends = queries.find(
    (q) => q.target?.type === 'json' && q.target.name === 'digest' && q.target.path === 'trends'
  );
  const digestAny = queries.find((q) => q.target?.type === 'json' && q.target.name === 'digest');
  const picked = digestTrends ?? digestAny ?? queries[0];
  const sql = picked?.query?.trim();
  return sql || undefined;
}

/** Build rich warehouse provenance from a query_snapshot job config. */
export function buildProvenanceFromSnapshotConfig(
  config: QuerySnapshotConfig
): Omit<ProvenanceSource, 'asOf'> | null {
  const queries = config.queries ?? [];
  const query = pickSnapshotQuery(config);
  if (!query) return null;

  const connection = typeof config.connection === 'string' ? config.connection.trim() : '';
  if (!connection) return null;

  const sqls = queries.map((q) => q.query?.trim()).filter(Boolean) as string[];
  const tables = [...new Set(sqls.flatMap(extractTablesFromSql))].sort();
  const columns = extractSelectColumns(query);
  const filters = extractWhereFilters(query);

  const tableMatch = query.match(/`([^`]+)`/);
  const label = tableMatch
    ? `${connection} · ${tableMatch[1].split('.').slice(-2).join('.')}`
    : connection;

  return {
    label,
    connection,
    query,
    tables: tables.length ? tables : undefined,
    columns: columns.length ? columns : undefined,
    filters: filters.length ? filters : undefined,
  };
}

/** Resolve warehouse provenance from the artifact's enabled query_snapshot job. */
export async function resolveProvenanceFromQuerySnapshot(
  env: Env,
  artifactId: string
): Promise<ProvenanceSource | null> {
  if (!env.DB) return null;

  const row = await env.DB.prepare(
    `SELECT config FROM scheduled_jobs
     WHERE artifact_id = ? AND action = 'query_snapshot' AND enabled = 1
     ORDER BY updated_at DESC LIMIT 1`
  )
    .bind(artifactId)
    .first<{ config: string }>();

  if (!row?.config) return null;

  let config: QuerySnapshotConfig;
  try {
    config = JSON.parse(row.config) as QuerySnapshotConfig;
  } catch {
    return null;
  }

  return buildProvenanceFromSnapshotConfig(config);
}

/** Use query_snapshot provenance when the model omits source or passes SDK tool names. */
export async function resolveDeliverySource(
  env: Env,
  artifactId: string,
  source: unknown
): Promise<unknown> {
  const incoming = source && typeof source === 'object' ? (source as ProvenanceSource) : null;
  const asOf = incoming?.asOf?.trim() || undefined;

  if (incoming && !isInternalProvenanceSource(incoming) && hasWarehouseProvenance(incoming)) {
    return { ...incoming, asOf: asOf ?? incoming.asOf };
  }

  const resolved = await resolveProvenanceFromQuerySnapshot(env, artifactId);
  if (!resolved) {
    return incoming && !isInternalProvenanceSource(incoming) ? incoming : source;
  }

  if (incoming && !isInternalProvenanceSource(incoming)) {
    return { ...resolved, ...incoming, asOf: asOf ?? resolved.asOf };
  }

  return { ...resolved, asOf: asOf ?? resolved.asOf };
}
