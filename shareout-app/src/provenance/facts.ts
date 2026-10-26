/**
 * Server-side facts about a page's data: the connections its names resolve to, the jobs,
 * crews and sheet syncs that write its stores, its datasets, metrics, proxied APIs,
 * files and MCP connections, and when its stores last changed. Bounded reads only; a
 * failed read degrades to "unknown", never to a failed panel.
 */
import type { Env } from '../types';
import { createMiniDb } from '../data/minidb-client';
import { createLogger } from '../logging';
import { parseAccessPolicy } from '../data/access-policy';
import { mcpCapabilityFromManifest, type McpCapability } from '../mcp-broker/capabilities';
import type { MetricSource } from '../metric-alerts/types';
import type { MaterializeConfig, QuerySnapshotConfig } from '../scheduling/jobs/types';

export interface ConnectionFact {
  id: string;
  scope: 'artifact' | 'workspace';
  name: string;
  kind: 'generic' | 'platform';
  provider: string;
  credential_scope: 'shared' | 'per_user';
  /** MCP server host, from config.url. */
  host?: string;
}

export interface StoreTarget {
  ref: string;
  query?: string;
}

export interface JobFact {
  id: string;
  name: string;
  schedule?: string;
  enabled: boolean;
  last_status?: string;
  last_run_at?: string;
  last_ok_at?: string;
  connection?: string;
  targets: StoreTarget[];
}

export interface CrewFact {
  id: string;
  name: string;
  active: boolean;
  schedule?: string;
  /** Stores the crew's recent finished runs wrote → newest write (ISO), any trigger. */
  writes: Map<string, string | undefined>;
  /** Same, counting only scheduled (cron) runs. */
  scheduledWrites: Map<string, string | undefined>;
  /** Connections the crew reads from. */
  reads: Set<string>;
}

export interface SyncFact {
  id: string;
  name: string;
  spreadsheet_id: string;
  sheet_name?: string;
  table: string;
  schedule?: string;
  last_synced_at?: string;
}

export interface MetricFact {
  id: string;
  label: string;
  source: MetricSource;
}

export interface SourceFacts {
  connections: ConnectionFact[];
  jobs: JobFact[];
  crews: CrewFact[];
  syncs: SyncFact[];
  datasets: Map<string, { format: string; updated_at?: string }>;
  metrics: MetricFact[];
  secrets: Map<string, { description?: string; hosts: string[] }>;
  files: Map<string, { name: string; updated_at?: string }>;
  mcp: McpCapability | null;
  /** access_policy.queries — the Data Platform queries scoped viewers may run. */
  policyQueries: Array<{ name: string; connection: string; provider: string; sql?: string }>;
  /** Last write per json key / table name, from the artifact's own store. */
  stamps: { json: Map<string, string>; tables: Map<string, string> };
}

export interface FactsInput {
  artifactId: string;
  workspaceId: string | null;
  manifestJson: string | null;
  accessPolicy: string | null;
  fileIds: string[];
  /** Skip per-store timestamps (policy-scoped callers; see build.ts). */
  withStamps: boolean;
}

const WRITE_TOOLS = ['json_set', 'table_insert', 'table_update', 'materialize_query', 'connection_query'];
const RECENT_CREW_RUNS = 25;

export async function loadSourceFacts(env: Env, input: FactsInput): Promise<SourceFacts> {
  const { artifactId, workspaceId } = input;
  const log = createLogger(env, { scope: 'provenance' });
  const safe = async <T>(label: string, fallback: T, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      log.warn('provenance read failed', { artifact_id: artifactId, read: label, err });
      return fallback;
    }
  };
  const all = <T>(sql: string, ...binds: unknown[]) =>
    env.DB.prepare(sql).bind(...binds).all<T>().then((r) => r.results ?? []);

  const [connections, jobs, crews, syncs, datasets, metrics, secrets, files, stamps] = await Promise.all([
    safe('connections', [] as ConnectionFact[], () => loadConnections(env, artifactId, workspaceId)),
    safe('jobs', [] as JobFact[], () => loadJobs(env, artifactId)),
    safe('crews', [] as CrewFact[], () => loadCrews(env, artifactId)),
    safe('syncs', [] as SyncFact[], async () => (await all<{
      id: string; name: string; spreadsheet_id: string; sheet_name: string | null; target_table: string;
      sync_schedule: string | null; last_synced_at: string | null;
    }>(
      `SELECT id, name, spreadsheet_id, sheet_name, target_table, sync_schedule, last_synced_at
         FROM sheet_syncs WHERE artifact_id = ? AND sync_direction != 'export' LIMIT 50`, artifactId,
    )).map((s) => ({
      id: s.id, name: s.name, spreadsheet_id: s.spreadsheet_id, sheet_name: s.sheet_name ?? undefined,
      table: s.target_table, schedule: s.sync_schedule ?? undefined, last_synced_at: toIso(s.last_synced_at),
    }))),
    safe('datasets', new Map(), async () => new Map((await all<{ name: string; format: string; updated_at: string }>(
      'SELECT name, format, updated_at FROM datasets WHERE artifact_id = ? ORDER BY name LIMIT 100', artifactId,
    )).map((d) => [d.name, { format: d.format, updated_at: toIso(d.updated_at) }]))),
    safe('metrics', [] as MetricFact[], async () => (await all<{ metric_id: string; label: string; source_json: string }>(
      'SELECT metric_id, label, source_json FROM artifact_metric_definitions WHERE artifact_id = ? ORDER BY metric_id LIMIT 20',
      artifactId,
    )).flatMap((m) => {
      const source = parseJson<MetricSource>(m.source_json);
      return source ? [{ id: m.metric_id, label: m.label, source }] : [];
    })),
    safe('secrets', new Map(), async () => new Map((await all<{ name: string; description: string | null; allowed_hosts: string }>(
      'SELECT name, description, allowed_hosts FROM artifact_secrets WHERE artifact_id = ? ORDER BY name LIMIT 50', artifactId,
    )).map((s) => [s.name, {
      description: s.description ?? undefined,
      hosts: (parseJson<unknown[]>(s.allowed_hosts) ?? []).filter((h): h is string => typeof h === 'string'),
    }]))),
    safe('files', new Map(), async () => {
      const ids = input.fileIds.slice(0, 50);
      if (!ids.length || !workspaceId) return new Map();
      const rows = await all<{ id: string; name: string; updated_at: string }>(
        `SELECT id, name, updated_at FROM asset_deliverables
          WHERE workspace_id = ? AND deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
        workspaceId, ...ids,
      );
      return new Map(rows.map((f) => [f.id, { name: f.name, updated_at: toIso(f.updated_at) }]));
    }),
    input.withStamps
      ? safe('stamps', emptyStamps(), () => loadStamps(env, artifactId, workspaceId))
      : Promise.resolve(emptyStamps()),
  ]);

  const policy = parseAccessPolicy(input.accessPolicy);
  const policyQueries = Object.entries(policy?.queries ?? {}).map(([name, q]) => ({
    name,
    connection: q.connection,
    provider: q.provider,
    sql: sqlOf(q.params),
  }));

  return {
    connections, jobs, crews, syncs, datasets, metrics, secrets, files, stamps,
    mcp: mcpCapabilityFromManifest(input.manifestJson),
    policyQueries,
  };
}

async function loadConnections(env: Env, artifactId: string, workspaceId: string | null): Promise<ConnectionFact[]> {
  const rows = await env.DB.prepare(
    `SELECT id, scope_type, name, kind, provider, credential_scope, CASE WHEN provider = 'mcp' THEN config END AS config
       FROM connections
      WHERE (scope_type = 'artifact' AND scope_id = ?) OR (scope_type = 'workspace' AND scope_id = ?)
      LIMIT 500`,
  ).bind(artifactId, workspaceId ?? '').all<{
    id: string; scope_type: 'artifact' | 'workspace'; name: string; kind: 'generic' | 'platform';
    provider: string; credential_scope: 'shared' | 'per_user' | null; config: string | null;
  }>();
  return (rows.results ?? []).map((c) => ({
    id: c.id,
    scope: c.scope_type,
    name: c.name,
    kind: c.kind,
    provider: c.provider,
    credential_scope: c.credential_scope === 'per_user' ? 'per_user' : 'shared',
    ...(c.config ? hostOf(parseJson<{ url?: unknown }>(c.config)?.url) : {}),
  }));
}

async function loadJobs(env: Env, artifactId: string): Promise<JobFact[]> {
  const [jobs, ok] = await Promise.all([
    env.DB.prepare(
      `SELECT id, title, action, schedule, config, enabled, trigger_type, last_run_at, last_status
         FROM scheduled_jobs WHERE artifact_id = ? AND action IN ('materialize', 'query_snapshot') LIMIT 50`,
    ).bind(artifactId).all<{
      id: string; title: string | null; action: string; schedule: string; config: string; enabled: number;
      trigger_type: string | null; last_run_at: string | null; last_status: string | null;
    }>(),
    env.DB.prepare(
      `SELECT r.job_id, MAX(r.created_at) AS last_ok
         FROM job_runs r JOIN scheduled_jobs j ON j.id = r.job_id
        WHERE j.artifact_id = ? AND j.action IN ('materialize', 'query_snapshot') AND r.status = 'success'
        GROUP BY r.job_id`,
    ).bind(artifactId).all<{ job_id: string; last_ok: string | null }>(),
  ]);
  const lastOk = new Map((ok.results ?? []).map((r) => [r.job_id, toIso(r.last_ok)]));
  return (jobs.results ?? []).map((j) => {
    const { connection, targets } = jobTargets(j.action, parseJson<Record<string, unknown>>(j.config) ?? {});
    return {
      id: j.id,
      name: j.title?.trim() || defaultJobName(targets),
      schedule: j.trigger_type === 'event' ? undefined : j.schedule || undefined,
      enabled: j.enabled === 1,
      last_status: j.last_status ?? undefined,
      last_run_at: toIso(j.last_run_at),
      last_ok_at: lastOk.get(j.id),
      connection,
      targets,
    };
  });
}

/** Which stores a refresh job writes, from its action config. */
export function jobTargets(action: string, config: Record<string, unknown>): { connection?: string; targets: StoreTarget[] } {
  const connection = typeof config.connection === 'string' ? config.connection : undefined;
  const target = (t: unknown, query: unknown): StoreTarget[] => {
    const o = t as { type?: unknown; name?: unknown } | null;
    if (!o || typeof o.name !== 'string' || !o.name) return [];
    const kind = o.type === 'table' ? 'table' : o.type === 'json' ? 'json' : o.type === 'dataset' ? 'dataset' : null;
    if (!kind) return [];
    return [{ ref: `${kind}:${o.name}`, ...(queryText(query) ? { query: queryText(query) } : {}) }];
  };
  if (action === 'materialize') {
    const c = config as Partial<MaterializeConfig>;
    return { connection, targets: target(c.target, c.query) };
  }
  if (action === 'query_snapshot') {
    const c = config as Partial<QuerySnapshotConfig>;
    return { connection, targets: (Array.isArray(c.queries) ? c.queries : []).flatMap((q) => target(q?.target, q?.query)) };
  }
  return { connection, targets: [] };
}

function defaultJobName(targets: StoreTarget[]): string {
  return targets.length ? `${targets[0].ref.split(':')[1]}` : 'Job';
}

async function loadCrews(env: Env, artifactId: string): Promise<CrewFact[]> {
  const [crews, triggers, runs] = await Promise.all([
    env.DB.prepare('SELECT id, name, status FROM crews WHERE artifact_id = ? LIMIT 20').bind(artifactId)
      .all<{ id: string; name: string | null; status: string }>(),
    env.DB.prepare("SELECT crew_id, cron FROM crew_triggers WHERE artifact_id = ? AND kind = 'cron' AND enabled = 1")
      .bind(artifactId).all<{ crew_id: string; cron: string | null }>(),
    env.DB.prepare(
      `SELECT id, crew_id, status, trigger_kind, ended_at FROM crew_runs
        WHERE artifact_id = ? ORDER BY started_at DESC LIMIT ${RECENT_CREW_RUNS}`,
    ).bind(artifactId).all<{ id: string; crew_id: string; status: string; trigger_kind: string | null; ended_at: string | null }>(),
  ]);
  const crewRows = crews.results ?? [];
  if (!crewRows.length) return [];
  const runRows = runs.results ?? [];
  const events = runRows.length
    ? (await env.DB.prepare(
      `SELECT run_id, tool_name, input_json FROM crew_run_events
        WHERE run_id IN (${runRows.map(() => '?').join(',')}) AND event_type = 'tool_call'
          AND tool_name IN (${WRITE_TOOLS.map(() => '?').join(',')})
        LIMIT 500`,
    ).bind(...runRows.map((r) => r.id), ...WRITE_TOOLS).all<{ run_id: string; tool_name: string; input_json: string | null }>()).results ?? []
    : [];

  const byId = new Map(crewRows.map((c) => [c.id, {
    id: c.id,
    name: c.name?.trim() || 'Crew',
    active: c.status === 'active',
    schedule: (triggers.results ?? []).find((t) => t.crew_id === c.id && t.cron)?.cron ?? undefined,
    writes: new Map<string, string | undefined>(),
    scheduledWrites: new Map<string, string | undefined>(),
    reads: new Set<string>(),
  } satisfies CrewFact]));
  const runById = new Map(runRows.map((r) => [r.id, r]));
  for (const ev of events) {
    const run = runById.get(ev.run_id);
    const crew = run ? byId.get(run.crew_id) : undefined;
    if (!run || !crew) continue;
    const { writes, reads } = crewToolEffects(ev.tool_name, ev.input_json);
    reads.forEach((c) => crew.reads.add(c));
    if (run.status !== 'done') continue;
    const at = toIso(run.ended_at);
    for (const ref of writes) {
      bumpNewest(crew.writes, ref, at);
      if (run.trigger_kind === 'cron') bumpNewest(crew.scheduledWrites, ref, at);
    }
  }
  return [...byId.values()];
}

/** The store a crew tool call writes and the connection it reads, from its logged input. */
export function crewToolEffects(tool: string, inputJson: string | null): { writes: string[]; reads: string[] } {
  const input = parseJson<Record<string, unknown>>(inputJson ?? '') ?? recoverTruncated(inputJson ?? '');
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  if (tool === 'json_set') return { writes: str(input.key) ? [`json:${input.key}`] : [], reads: [] };
  if (tool === 'table_insert' || tool === 'table_update') return { writes: str(input.table) ? [`table:${input.table}`] : [], reads: [] };
  const connection = str(input.connection);
  if (tool === 'connection_query') return { writes: [], reads: connection ? [connection] : [] };
  if (tool === 'materialize_query') {
    const t = input.target as { type?: unknown; name?: unknown } | undefined;
    const kind = t?.type === 'table' || t?.type === 'json' || t?.type === 'dataset' ? t.type : null;
    return { writes: kind && str(t?.name) ? [`${kind}:${t!.name}`] : [], reads: connection ? [connection] : [] };
  }
  return { writes: [], reads: [] };
}

// Event inputs are stored redacted and capped, so a large call (many rows) is cut mid-JSON.
// The identifying fields come first in practice; pull them out of the prefix.
function recoverTruncated(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ['key', 'table', 'connection']) {
    const m = text.match(new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]{1,128})"`));
    if (m) out[key] = m[1];
  }
  const target = text.match(/"target"\s*:\s*\{([^}]*)\}/);
  if (target) {
    const type = target[1].match(/"type"\s*:\s*"(\w+)"/)?.[1];
    const name = target[1].match(/"name"\s*:\s*"([^"\\]{1,128})"/)?.[1];
    if (type && name) out.target = { type, name };
  }
  return out;
}

async function loadStamps(env: Env, artifactId: string, workspaceId: string | null): Promise<SourceFacts['stamps']> {
  const db = createMiniDb(env, artifactId, workspaceId ?? '');
  const [json, tables] = await db.batch([
    { sql: 'SELECT key, updated_at FROM artifact_json WHERE artifact_id = ? ORDER BY updated_at DESC LIMIT 200', bindings: [artifactId], mode: 'all' },
    { sql: 'SELECT name, updated_at FROM artifact_tables WHERE artifact_id = ? LIMIT 200', bindings: [artifactId], mode: 'all' },
  ]);
  const map = (rows: unknown, col: 'key' | 'name') => new Map(
    ((rows as Array<Record<string, string>>) ?? [])
      .map((r) => [r[col], toIso(r.updated_at)] as const)
      .filter((e): e is readonly [string, string] => !!e[0] && !!e[1]),
  );
  return { json: map(json?.results, 'key'), tables: map(tables?.results, 'name') };
}

function emptyStamps(): SourceFacts['stamps'] {
  return { json: new Map(), tables: new Map() };
}

function bumpNewest(map: Map<string, string | undefined>, key: string, at: string | undefined): void {
  const prev = map.get(key);
  if (!map.has(key) || (at && (!prev || at > prev))) map.set(key, at ?? prev);
}

/** scheduled_jobs / job_runs keep unix seconds as TEXT; everything else is ISO 8601. */
export function toIso(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const s = String(v);
  if (/^\d{9,11}(\.\d+)?$/.test(s)) return new Date(Number(s) * 1000).toISOString();
  const t = Date.parse(s.includes('T') || s.endsWith('Z') ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

function queryText(q: unknown): string | undefined {
  if (typeof q === 'string') return q.trim() || undefined;
  if (q && typeof q === 'object') return sqlOf(q as Record<string, unknown>) ?? JSON.stringify(q);
  return undefined;
}

function sqlOf(params: Record<string, unknown> | undefined): string | undefined {
  if (!params) return undefined;
  const body = (params.body ?? params) as Record<string, unknown>;
  for (const k of ['sql', 'query', 'statement']) if (typeof body[k] === 'string') return body[k] as string;
  return undefined;
}

function hostOf(url: unknown): { host?: string } {
  if (typeof url !== 'string') return {};
  try {
    return { host: new URL(url).host };
  } catch {
    return {};
  }
}

function parseJson<T>(text: string | null | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
