// Provider-direct warehouse execution for *generic* connections (the catalog
// `connections` / workspace `kind = 'generic'` rows). Unlike platform connections
// — which carry a connectionId the PlatformEngine resolves credentials for — a
// generic warehouse connection stores its credentials inline. So we hand the
// already-decrypted credentials + config straight to the provider's executeRequest,
// reusing the same Snowflake/BigQuery client as the platform path (no second client).

import type { Env } from '../../types';
import type { ConnectionConfig, DecryptedCredentials } from '../platform/types';
import { getProvider } from '../platform/registry';

export interface WarehouseQueryOptions {
  /** GCP project id for BigQuery jobs (falls back to the connection config). */
  projectId?: string;
  maxResults?: number;
  timeoutMs?: number;
}

const BQ_NUMERIC = new Set(['INTEGER', 'INT64', 'FLOAT', 'FLOAT64', 'NUMERIC', 'BIGNUMERIC']);

// Snowflake SQL API v2 scalar types that map to JS numbers. DATE/TIMESTAMP are
// returned as epoch offsets (days/seconds), so callers should TO_CHAR them in SQL
// and we leave any non-numeric/non-bool cell as a string.
const SF_NUMERIC = new Set(['fixed', 'real', 'float']);

/** Parse a Snowflake SQL API v2 response into row objects. The API returns
 *  `resultSetMetaData.rowType` (column names + types) and `data` as an array of
 *  rows, each an array of string|null cells. Coerce numerics → number, boolean →
 *  boolean, everything else → string, keyed by column name. Only the first
 *  partition is returned inline, so keep result sets small (aggregate in SQL). */
export function parseSnowflakeRows(data: unknown): Record<string, unknown>[] {
  const r = (data || {}) as {
    resultSetMetaData?: { rowType?: { name: string; type?: string }[] };
    data?: (string | null)[][];
  };
  const cols = r.resultSetMetaData?.rowType || [];
  return (r.data || []).map((row) => {
    const o: Record<string, unknown> = {};
    cols.forEach((col, i) => {
      const name = col?.name ?? String(i);
      const v = row?.[i] ?? null;
      const type = (col?.type || '').toLowerCase();
      if (v === null) {
        o[name] = null;
      } else if (SF_NUMERIC.has(type)) {
        const n = Number(v);
        o[name] = Number.isFinite(n) ? n : v;
      } else if (type === 'boolean') {
        o[name] = v === 'true' || v === '1';
      } else {
        o[name] = v;
      }
    });
    return o;
  });
}

/** Parse a BigQuery jobs.query response into row objects, coercing scalar cells to
 *  JS types per the response schema (numerics → number, BOOL → boolean) so consumers
 *  (dashboards, charts, materialized json) get typed values rather than strings. */
export function parseBqRows(data: unknown): Record<string, unknown>[] {
  const r = (data || {}) as { schema?: { fields?: { name: string; type?: string }[] }; rows?: { f?: { v?: unknown }[] }[] };
  const fields = r.schema?.fields || [];
  return (r.rows || []).map((row) => {
    const o: Record<string, unknown> = {};
    (row.f || []).forEach((cell, i) => {
      const field = fields[i];
      const name = field?.name ?? String(i);
      const v = cell?.v ?? null;
      const type = (field?.type || '').toUpperCase();
      if (v === null || typeof v !== 'string') {
        o[name] = v; // nested/array values pass through untouched
      } else if (BQ_NUMERIC.has(type)) {
        const n = Number(v);
        o[name] = Number.isFinite(n) ? n : v;
      } else if (type === 'BOOLEAN' || type === 'BOOL') {
        o[name] = v === 'true';
      } else {
        o[name] = v;
      }
    });
    return o;
  });
}

/** Shape inline credentials (whatever the user pasted for a generic connection) into
 *  the provider's DecryptedCredentials. The warehouse providers read their key
 *  material from `extra` (Snowflake: `extra.private_key`; BigQuery:
 *  `extra.service_account` / `extra.authorized_user`), with `access_token` as a
 *  fallback, so pass the whole blob through `extra` and surface any token directly. */
function toDecryptedCredentials(creds: Record<string, unknown> | null): DecryptedCredentials {
  const c = creds || {};
  const token = typeof c.access_token === 'string' ? c.access_token
    : typeof c.accessToken === 'string' ? (c.accessToken as string)
    : '';
  return { access_token: token, extra: c };
}

/**
 * Run a SQL query against a generic warehouse connection by handing the inline
 * credentials + config to the provider directly. Returns parsed row objects, the
 * same shape `queryPlatformConnection` returns for platform connections.
 */
export async function executeWarehouseQuery(
  env: Env,
  provider: 'snowflake' | 'bigquery',
  config: Record<string, unknown>,
  credentials: Record<string, unknown> | null,
  sql: string,
  opts: WarehouseQueryOptions
): Promise<Record<string, unknown>[]> {
  const impl = getProvider(provider);
  if (!impl) throw new Error(`Provider "${provider}" is not registered`);

  const ctx = {
    artifactId: '',
    connectionId: '',
    connectionConfig: { id: '', name: '', provider, config, createdAt: '', updatedAt: '' } as ConnectionConfig,
    credentials: toDecryptedCredentials(credentials),
    env,
  };

  if (provider === 'bigquery') {
    const projectId = opts.projectId || config.projectId || config.project || config.defaultProject;
    if (!projectId) throw new Error('projectId is required to query this BigQuery connection (pass params.projectId)');
    const endpoint = impl.getEndpoint('jobs.query');
    if (!endpoint) throw new Error('BigQuery provider is missing the jobs.query endpoint');
    const resp = await impl.executeRequest(ctx, endpoint, {
      pathParams: { projectId: String(projectId) },
      body: { query: sql, useLegacySql: false, maxResults: opts.maxResults ?? 10000, timeoutMs: opts.timeoutMs ?? 120000 },
    });
    if (!resp.success) throw new Error(resp.error?.message || 'BigQuery query failed');
    return parseBqRows(resp.data);
  }

  const endpoint = impl.getEndpoint('statements.execute');
  if (!endpoint) throw new Error('Snowflake provider is missing the statements.execute endpoint');
  const resp = await impl.executeRequest(ctx, endpoint, {
    body: { statement: sql, timeout: Math.ceil((opts.timeoutMs ?? 60000) / 1000) },
  });
  if (!resp.success) throw new Error(resp.error?.message || 'Snowflake query failed');
  return parseSnowflakeRows(resp.data);
}
