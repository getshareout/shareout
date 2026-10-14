import type { Env } from '../types';
import { PlatformEngine } from '../data/platform';
import { parseSnowflakeRows } from '../data/connections/warehouse-exec';
import { SQL_QUERY_ENDPOINT } from '../data/platform/providers/sql-endpoint';
import { upsertCatalogFile, listCatalogFiles } from './store';
import { buildConnectorEntry, slugifyName } from './seed';

// Bounded per connect-time seed run: number of tables/sheets enumerated and written
// as catalog dataset entries. Keeps a first connect to a workspace with thousands of
// tables from writing thousands of D1 rows in one shot.
const MAX_RESOURCES = 200;
// BigQuery: cap datasets walked (each costs one tables.list call) before the 200
// resource cap kicks in, so a project with hundreds of datasets doesn't fan out.
const MAX_BQ_DATASETS = 20;

interface ConnectionRow {
  id: string;
  name: string;
  kind: string;
  provider: string;
  config: string | null;
}

export interface DatasetSeedResult {
  seeded: number;
  skipped: number;
  provider: string | null;
}

function parseConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function pickCaseInsensitive(row: Record<string, unknown>, key: string): string | undefined {
  for (const [k, v] of Object.entries(row)) {
    if (k.toLowerCase() === key && typeof v === 'string' && v) return v;
  }
  return undefined;
}

// Snowflake: SHOW TABLES is a metadata-only statement (no data reads) already
// executable through the same statements.execute endpoint used for real queries.
async function listSnowflakeTables(env: Env, workspaceId: string, conn: ConnectionRow): Promise<string[]> {
  const engine = new PlatformEngine({ artifactId: '', env, workspaceId });
  const resp = await engine.execute({
    provider: 'snowflake',
    endpoint: 'statements.execute',
    connectionId: conn.id,
    params: { body: { statement: 'SHOW TABLES', timeout: 30 } },
    options: { cache: false },
  });
  if (!resp.success) return [];
  return parseSnowflakeRows(resp.data)
    .map((row) => pickCaseInsensitive(row, 'name'))
    .filter((n): n is string => !!n);
}

// Supabase / Redshift / Aurora (PostgreSQL or MySQL): information_schema exists on all
// of them, so one metadata query lists user tables. System and Supabase-internal
// schemas are skipped; non-public schemas are kept as schema.table.
const SYSTEM_SCHEMAS = [
  'pg_catalog', 'information_schema', 'pg_internal', 'pg_toast', 'mysql', 'performance_schema', 'sys',
  'auth', 'storage', 'realtime', 'extensions', 'graphql', 'graphql_public', 'pgsodium', 'pgsodium_masks',
  'vault', 'supabase_functions', 'supabase_migrations', 'net', 'cron', 'pgbouncer',
];

async function listSqlTables(env: Env, workspaceId: string, conn: ConnectionRow): Promise<string[]> {
  const engine = new PlatformEngine({ artifactId: '', env, workspaceId });
  const excluded = SYSTEM_SCHEMAS.map((s) => `'${s}'`).join(', ');
  const resp = await engine.execute<{ rows?: Record<string, unknown>[] }>({
    provider: conn.provider,
    endpoint: SQL_QUERY_ENDPOINT,
    connectionId: conn.id,
    params: {
      body: {
        sql: `select table_schema, table_name from information_schema.tables where table_schema not in (${excluded}) order by 1, 2 limit ${MAX_RESOURCES}`,
        maxRows: MAX_RESOURCES,
        timeoutMs: 30_000,
      },
    },
    options: { cache: false },
  });
  if (!resp.success) return [];
  return (resp.data?.rows || [])
    .map((row) => {
      const schema = pickCaseInsensitive(row, 'table_schema');
      const table = pickCaseInsensitive(row, 'table_name');
      if (!table) return undefined;
      return schema && schema !== 'public' ? `${schema}.${table}` : table;
    })
    .filter((n): n is string => !!n);
}

// BigQuery: datasets.list + tables.list are already-registered REST endpoints — walk
// datasets (capped), then tables per dataset (capped total).
async function listBigQueryTables(env: Env, workspaceId: string, conn: ConnectionRow): Promise<string[]> {
  const cfg = parseConfig(conn.config);
  const projectId = (cfg.projectId || cfg.project || cfg.defaultProject) as string | undefined;
  if (!projectId) return [];

  const engine = new PlatformEngine({ artifactId: '', env, workspaceId });
  const dsResp = await engine.execute({
    provider: 'bigquery',
    endpoint: 'datasets.list',
    connectionId: conn.id,
    params: { pathParams: { projectId } },
    options: { cache: false },
  });
  if (!dsResp.success) return [];

  const datasetIds = (
    (dsResp.data as { datasets?: { datasetReference?: { datasetId?: string } }[] } | undefined)?.datasets || []
  )
    .map((d) => d.datasetReference?.datasetId)
    .filter((d): d is string => !!d)
    .slice(0, MAX_BQ_DATASETS);

  const tables: string[] = [];
  for (const datasetId of datasetIds) {
    if (tables.length >= MAX_RESOURCES) break;
    const tResp = await engine.execute({
      provider: 'bigquery',
      endpoint: 'tables.list',
      connectionId: conn.id,
      params: { pathParams: { projectId, datasetId } },
      options: { cache: false },
    });
    if (!tResp.success) continue;
    const tableIds = (
      (tResp.data as { tables?: { tableReference?: { tableId?: string } }[] } | undefined)?.tables || []
    )
      .map((t) => t.tableReference?.tableId)
      .filter((t): t is string => !!t);
    for (const tableId of tableIds) tables.push(`${datasetId}.${tableId}`);
  }
  return tables;
}

// Google Sheets: spreadsheets.get returns tab metadata for the whole spreadsheet in
// one call — each tab becomes a dataset entry. Needs config.spreadsheetId.
async function listGoogleSheetTabs(env: Env, workspaceId: string, conn: ConnectionRow): Promise<string[]> {
  const cfg = parseConfig(conn.config);
  const spreadsheetId = cfg.spreadsheetId as string | undefined;
  if (!spreadsheetId) return [];

  const engine = new PlatformEngine({ artifactId: '', env, workspaceId });
  const resp = await engine.execute({
    provider: 'google-sheets',
    endpoint: 'spreadsheets.get',
    connectionId: conn.id,
    params: { pathParams: { spreadsheetId } },
    options: { cache: false },
  });
  if (!resp.success) return [];
  return (
    (resp.data as { sheets?: { properties?: { title?: string } }[] } | undefined)?.sheets || []
  )
    .map((s) => s.properties?.title)
    .filter((t): t is string => !!t);
}

// Shopify/TiendaNube/ads providers expose a fixed set of REST resources (products,
// orders, customers...), not a browsable schema — there's no cheap "list tables"
// call to reuse for them. Follow-up, not auto-seeded here.
async function listResources(env: Env, workspaceId: string, conn: ConnectionRow): Promise<string[]> {
  switch (conn.provider) {
    case 'snowflake':
      return listSnowflakeTables(env, workspaceId, conn);
    case 'bigquery':
      return listBigQueryTables(env, workspaceId, conn);
    case 'google-sheets':
      return listGoogleSheetTabs(env, workspaceId, conn);
    case 'supabase':
    case 'redshift':
    case 'aurora':
      return listSqlTables(env, workspaceId, conn);
    default:
      return [];
  }
}

function buildDatasetEntry(conn: ConnectionRow, connSlug: string, resource: string) {
  const resourceSlug = slugifyName(resource);
  const id = `ds.${connSlug}.${resourceSlug}`;
  const content = `---
kind: dataset
id: ${id}
title: ${resource}
status: draft
connection: ${conn.name}
upstream: [conn.${connSlug}]
tags: [provider.${slugifyName(conn.provider)}]
---

Auto-seeded from **${conn.name}** (${conn.provider}). Agents can enrich this entry with
\`fqn\`, \`domain\`, \`owner\`, and prose.
`;
  return { path: `datasets/${connSlug}/${resourceSlug}.md`, content };
}

/**
 * Seed the workspace catalog from one just-created connection: that connector's own
 * `source` entry (only this one — not every workspace connector) plus one `dataset` entry per
 * table/sheet the provider cheaply exposes (name only, capped, no data reads).
 * Idempotent — re-running upserts the same paths, never duplicates. Never clobbers
 * a human-edited entry (source === 'manual' at the file level — the same rule
 * seedConnectorsAsSources uses for source entries).
 *
 * Never throws: catalog seeding is best-effort and must never fail a connection
 * create, so every failure mode (bad creds, unsupported provider, D1 error) resolves
 * to an empty result instead of rejecting.
 */
export async function seedCatalogForConnection(
  env: Env,
  workspaceId: string,
  connectionId: string
): Promise<DatasetSeedResult> {
  try {
    const conn = await env.DB.prepare(
      "SELECT id, name, kind, provider, config FROM connections WHERE scope_type = 'workspace' AND scope_id = ? AND id = ?"
    )
      .bind(workspaceId, connectionId)
      .first<ConnectionRow>();
    if (!conn) return { seeded: 0, skipped: 0, provider: null };

    const existing = new Map((await listCatalogFiles(env, workspaceId)).map((f) => [f.path, f.source]));
    const source = buildConnectorEntry(conn);
    if (existing.get(source.path) !== 'manual') {
      await upsertCatalogFile(env, workspaceId, { ...source, source: 'seed:connector' });
    }

    const resources = await listResources(env, workspaceId, conn);
    if (!resources.length) return { seeded: 0, skipped: 0, provider: conn.provider };

    const connSlug = slugifyName(conn.name);
    let seeded = 0;
    let skipped = 0;
    for (const resource of resources.slice(0, MAX_RESOURCES)) {
      const entry = buildDatasetEntry(conn, connSlug, resource);
      if (existing.get(entry.path) === 'manual') {
        skipped += 1;
        continue;
      }
      await upsertCatalogFile(env, workspaceId, { ...entry, source: 'seed:connector' });
      seeded += 1;
    }
    return { seeded, skipped, provider: conn.provider };
  } catch {
    return { seeded: 0, skipped: 0, provider: null };
  }
}

/**
 * Auto-link a materialized dataset back to the connection that produced it, and to
 * the artifact that stores it: connection --upstream--> dataset (lineage graph edge),
 * dataset --artifact--> the producing artifact. Idempotent (same connection+dataset
 * name always resolves to the same file path — a re-run upserts, never duplicates).
 * Never clobbers a human-edited entry, and never throws: lineage is best-effort and
 * must never fail the materialize that triggered it.
 */
export async function recordDatasetLineage(
  env: Env,
  workspaceId: string,
  connectionName: string,
  datasetName: string,
  artifactId: string
): Promise<void> {
  try {
    const connSlug = slugifyName(connectionName);
    const dsSlug = slugifyName(datasetName);
    const path = `datasets/${connSlug}/${dsSlug}.md`;

    const row = await env.DB.prepare("SELECT source FROM workspace_files WHERE workspace_id = ? AND namespace = 'catalog' AND path = ?")
      .bind(workspaceId, path)
      .first<{ source: string }>();
    if (row?.source === 'manual') return;

    const id = `ds.${connSlug}.${dsSlug}`;
    const content = `---
kind: dataset
id: ${id}
title: ${datasetName}
status: draft
connection: ${connectionName}
artifact: ${artifactId}
upstream: [conn.${connSlug}]
---

Auto-linked from **${connectionName}**, materialized into artifact \`${artifactId}\`.
`;
    await upsertCatalogFile(env, workspaceId, { path, content, source: 'seed:provenance' });
  } catch {
    // Lineage is best-effort — never fail the materialize that triggered it.
  }
}

/**
 * Drop the auto-seeded catalog entries of a deleted connection: its `source` entry and
 * the `dataset` entries seeded from its tables. Human-edited entries and dataset
 * provenance records are kept. Never throws — must not fail the connection delete.
 */
export async function removeCatalogForConnection(env: Env, workspaceId: string, connectionName: string): Promise<void> {
  try {
    const slug = slugifyName(connectionName);
    await env.DB.prepare(
      `DELETE FROM workspace_files WHERE workspace_id = ? AND namespace = 'catalog' AND source = 'seed:connector'
         AND (path = ? OR path LIKE ?)`
    ).bind(workspaceId, `sources/${slug}.md`, `datasets/${slug}/%`).run();
  } catch {
    // Best-effort cleanup.
  }
}
