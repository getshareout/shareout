// Running a catalog metric: who may, against what, and what comes back. Every answer
// carries its provenance — the effective status, who certified it and when, the spec
// hash it was computed from, where the rows came from and how fresh they are.
import type { Env, WorkspaceRole } from '../../types';
import type { ViewerScope } from '../../data/access-policy';
import { createMiniDb } from '../../data/minidb-client';
import { queryWorkspaceConnection } from '../../data/connections/warehouse-query';
import { checkWebAgentQueryLimit } from '../../rate-limit';
import { extractFrontmatter } from '../parse';
import { findEntry } from '../lineage';
import { loadGovernedCatalog, type GovernedCatalog } from '../governed';
import type { CatalogEntry, CertificationActor, EntryStatus } from '../types';
import { compileMetric, compileProblem, resolveQuery, MAX_METRIC_ROWS, type CompiledMetric, type ResolvedQuery } from './compile';
import {
  freshnessMs,
  isExecutableMetricData,
  metricFormula,
  validateMetricSpec,
  type MetricSpec,
  type SpecIssue,
} from './spec';
import { loadWorkspaceSources, resolveTarget, type MetricTarget, type WorkspaceSources } from './target';

export const METRIC_QUERY_TIMEOUT_MS = 30_000;

export interface MetricFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
  hint?: string;
  param?: string;
  retryAfter?: number;
}

const failure = (status: number, code: string, issue: SpecIssue | string): MetricFailure =>
  typeof issue === 'string' ? { ok: false, status, code, message: issue } : { ok: false, status, code, ...issue };

const isManager = (role: WorkspaceRole) => role === 'owner' || role === 'admin';

/** One metric as the catalog sees it: the entry, its validated spec (if any) and target. */
export interface LoadedMetric {
  entry: CatalogEntry;
  spec: MetricSpec | null;
  /** Why it cannot run: no spec yet, an invalid spec, or a source that is gone. */
  problem: SpecIssue | null;
  target: MetricTarget | null;
  authorId: string | null;
}

export function loadMetric(catalog: GovernedCatalog, sources: WorkspaceSources, entry: CatalogEntry): LoadedMetric {
  const file = catalog.files.get(entry.path);
  const data = extractFrontmatter(file?.content ?? '')?.data ?? {};
  const base = { entry, authorId: file?.updatedBy ?? null };
  if (!isExecutableMetricData(data)) {
    return { ...base, spec: null, target: null, problem: { message: 'This metric has no executable spec yet', hint: 'Add source and type (and a measure, or a numerator and denominator).' } };
  }
  const parsed = validateMetricSpec(data);
  if (!parsed.ok) return { ...base, spec: null, target: null, problem: parsed.issue };
  const resolved = resolveTarget(parsed.spec, sources);
  if (!resolved.ok) return { ...base, spec: parsed.spec, target: null, problem: resolved.issue };
  return { ...base, spec: parsed.spec, target: resolved.target, problem: compileProblem(parsed.spec, resolved.target) };
}

/**
 * Who may run a metric (founder defaults): any internal member runs a certified one —
 * an owner/admin certification is consent for its connection. A draft runs for owners,
 * admins and its author, and for anyone when its data is already open to members for
 * querying (a connection with agent queries on, or a workspace shared table). Writing a
 * draft is not a way into a connection its creator reserved (`is_private`): there the
 * author must be that creator.
 */
export function runPermission(
  m: Pick<LoadedMetric, 'authorId' | 'target'> & { status: EntryStatus },
  role: WorkspaceRole,
  userId: string
): { ok: true; basis: 'manager' | 'certified' | 'author' | 'shared_table' | 'agent_query_enabled' } | { ok: false; issue: SpecIssue } {
  if (isManager(role)) return { ok: true, basis: 'manager' };
  if (m.status === 'certified') return { ok: true, basis: 'certified' };
  const conn = m.target?.connection;
  const reserved = !!conn && conn.is_private === 1 && conn.created_by !== userId;
  if (m.authorId && m.authorId === userId && !reserved) return { ok: true, basis: 'author' };
  if (m.target?.sharedTable) return { ok: true, basis: 'shared_table' };
  if (m.target?.connection?.agent_query_enabled === 1) return { ok: true, basis: 'agent_query_enabled' };
  return {
    ok: false,
    issue: {
      message: 'This metric is not certified: until an owner or admin certifies it, only they and its author can run it',
      hint: 'Ask an owner or admin to certify it, or to let the assistant query its connection.',
    },
  };
}

function certifiedBy(entry: CatalogEntry): { by: CertificationActor | null; at: string | null } {
  const c = entry.certification;
  return c?.status === 'certified' && c.decision ? { by: c.decision.decided_by, at: c.decision.decided_at } : { by: null, at: null };
}

function sourceView(spec: MetricSpec | null, target: MetricTarget | null) {
  if (!spec) return null;
  const src = spec.source;
  if (src.kind === 'shared_table') return { type: 'shared_table' as const, shared_table: src.shared_table, dialect: 'sqlite' as const };
  return {
    type: src.kind,
    connection_id: src.connection,
    connection_name: target?.connection?.name ?? null,
    provider: target?.connection?.provider ?? null,
    ...(src.kind === 'fqn' ? { fqn: src.fqn } : {}),
    dialect: target?.dialect ?? null,
  };
}

/** The metric as listed: identity, trust, formula and where it reads from. */
export function metricView(m: LoadedMetric, role: WorkspaceRole, userId: string) {
  const { entry, spec } = m;
  const status = entry.status ?? 'draft';
  const cert = certifiedBy(entry);
  const permission = runPermission({ ...m, status }, role, userId);
  return {
    id: entry.id,
    title: entry.title,
    title_es: spec?.title_es ?? (typeof entry.extra.title_es === 'string' ? entry.extra.title_es : null),
    owner: entry.owner ?? null,
    domain: entry.domain ?? null,
    status,
    stale: !!entry.certification?.stale,
    certified_by: cert.by,
    certified_at: cert.at,
    spec_hash: entry.certification?.content_hash ?? null,
    type: spec?.type ?? null,
    formula: spec ? metricFormula(spec) : null,
    source: sourceView(spec, m.target),
    grains: spec?.time?.grains ?? [],
    dimensions: spec?.dimensions.map(d => d.name) ?? [],
    format: spec?.format ?? null,
    freshness_sla: spec?.freshness_sla ?? null,
    problem: m.problem,
    can_run: !m.problem && permission.ok,
  };
}

/** The metric in full: the list view plus description, synonyms, measures and examples. */
export function metricDetail(m: LoadedMetric, role: WorkspaceRole, userId: string) {
  const { spec } = m;
  return {
    ...metricView(m, role, userId),
    description: spec?.description ?? null,
    synonyms: spec?.synonyms ?? null,
    measure: spec?.measure ?? null,
    numerator: spec?.numerator ?? null,
    denominator: spec?.denominator ?? null,
    time_dimension: spec?.time?.dimension ?? null,
    scoped: !!spec?.scope_field,
    examples: spec?.examples ?? [],
  };
}

/** Workspace metrics: every `kind: metric` entry, executable or not. */
export async function listCatalogMetrics(env: Env, workspaceId: string, role: WorkspaceRole, userId: string) {
  const [catalog, sources] = await Promise.all([loadGovernedCatalog(env, workspaceId), loadWorkspaceSources(env, workspaceId)]);
  return catalog.entries
    .filter(e => e.kind === 'metric')
    .map(e => metricView(loadMetric(catalog, sources, e), role, userId))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function getCatalogMetric(
  env: Env,
  workspaceId: string,
  metricId: string
): Promise<{ ok: true; metric: LoadedMetric } | MetricFailure> {
  const [catalog, sources] = await Promise.all([loadGovernedCatalog(env, workspaceId), loadWorkspaceSources(env, workspaceId)]);
  const entry = findEntry(catalog.entries, metricId);
  if (!entry || entry.kind !== 'metric') return failure(404, 'NOT_FOUND', `No metric ${metricId} in this catalog`);
  return { ok: true, metric: loadMetric(catalog, sources, entry) };
}

/** Freshness: when a shared table was last written, against the metric's SLA. */
export async function metricFreshness(env: Env, workspaceId: string, m: LoadedMetric, now = Date.now()) {
  const sla = m.spec?.freshness_sla ?? null;
  let lastUpdatedAt: string | null = null;
  const table = m.target?.sharedTable;
  if (table) {
    const row = await createMiniDb(env, table.ownerArtifactId, workspaceId)
      .prepare('SELECT updated_at FROM artifact_tables WHERE artifact_id = ? AND name = ?')
      .bind(table.ownerArtifactId, table.table)
      .first<{ updated_at: string }>()
      .catch(() => null);
    lastUpdatedAt = row?.updated_at ?? null;
  }
  const stale = sla && lastUpdatedAt ? now - Date.parse(lastUpdatedAt) > freshnessMs(sla) : null;
  return { sla, last_updated_at: lastUpdatedAt, stale };
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`The query took longer than ${ms / 1000}s`), { timeout: true })), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function execute(env: Env, workspaceId: string, userId: string, target: MetricTarget, sql: string): Promise<Record<string, unknown>[]> {
  if (target.sharedTable) {
    const db = createMiniDb(env, target.sharedTable.ownerArtifactId, workspaceId);
    return withTimeout(db.prepare(sql).all<Record<string, unknown>>().then(r => r.results), METRIC_QUERY_TIMEOUT_MS);
  }
  const conn = target.connection!;
  return withTimeout(
    queryWorkspaceConnection(env, workspaceId, conn, sql, { maxResults: MAX_METRIC_ROWS, timeoutMs: METRIC_QUERY_TIMEOUT_MS }, userId),
    METRIC_QUERY_TIMEOUT_MS + 2_000
  );
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function toPeriod(v: unknown): string | null {
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v == null ? null : String(v);
}

/** Map so_* columns (case-insensitively: Snowflake answers in capitals) to named fields. */
export function shapeRows(raw: Record<string, unknown>[], compiled: CompiledMetric): Record<string, unknown>[] {
  return raw.map(r => {
    const col: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) col[k.toLowerCase()] = v;
    const row: Record<string, unknown> = {};
    if (compiled.period) row.period = toPeriod(col.so_period);
    compiled.dims.forEach((name, i) => (row[name] = col[`so_d${i}`] ?? null));
    row.value = toNumber(col.so_value);
    if (compiled.ratio) {
      row.numerator = toNumber(col.so_num);
      row.denominator = toNumber(col.so_den);
    }
    return row;
  });
}

export interface MetricRunInput {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  metricId: string;
  query: unknown;
  /** A viewer limited to some values of the metric's scope_field; null = unscoped. */
  scope?: ViewerScope | null;
  now?: Date;
}

/** Compile without running: what a query would send, for `explain` and the run itself. */
export async function prepareMetricQuery(
  env: Env,
  input: Omit<MetricRunInput, 'role' | 'userId'>
): Promise<{ ok: true; metric: LoadedMetric; spec: MetricSpec; target: MetricTarget; query: ResolvedQuery; compiled: CompiledMetric } | MetricFailure> {
  const got = await getCatalogMetric(env, input.workspaceId, input.metricId);
  if (!got.ok) return got;
  const m = got.metric;
  if (!m.spec || !m.target) return failure(422, m.spec ? 'METRIC_UNAVAILABLE' : 'METRIC_INVALID', m.problem ?? 'This metric cannot run');
  const resolved = resolveQuery(m.spec, input.query, input.now);
  if (!resolved.ok) return failure(400, 'BAD_REQUEST', resolved.issue);
  const compiled = compileMetric(m.spec, resolved.query, m.target, input.scope ?? null);
  if (!compiled.ok) {
    // A scoped caller on a metric that cannot be scoped is refused, not answered with every row.
    const scoped = !!input.scope && compiled.issue.param === 'scope_field';
    return failure(scoped ? 403 : 422, scoped ? 'SCOPE_REQUIRED' : 'METRIC_INVALID', compiled.issue);
  }
  return { ok: true, metric: m, spec: m.spec, target: m.target, query: resolved.query, compiled: compiled.compiled };
}

/** POST …/catalog/metrics/{id}/query */
export async function runCatalogMetric(env: Env, input: MetricRunInput): Promise<{ ok: true; body: Record<string, unknown> } | MetricFailure> {
  const prepared = await prepareMetricQuery(env, input);
  if (!prepared.ok) return prepared;
  const { metric: m, spec, target, query, compiled } = prepared;
  const status = m.entry.status ?? 'draft';
  const permission = runPermission({ ...m, status }, input.role, input.userId);
  if (!permission.ok) return failure(403, 'METRIC_NOT_CERTIFIED', permission.issue);

  const limit = await checkWebAgentQueryLimit(env, input.workspaceId);
  if (!limit.allowed) {
    return { ...failure(429, 'RATE_LIMITED', { message: 'This workspace has hit its data-query limit for now', hint: 'Try again in a little while.' }), retryAfter: limit.retryAfter };
  }

  let raw: Record<string, unknown>[];
  let freshness: Awaited<ReturnType<typeof metricFreshness>>;
  try {
    [raw, freshness] = await Promise.all([
      execute(env, input.workspaceId, input.userId, target, compiled.sql),
      metricFreshness(env, input.workspaceId, m, (input.now ?? new Date()).getTime()),
    ]);
  } catch (err) {
    const timedOut = !!(err as { timeout?: boolean })?.timeout;
    const reason = err instanceof Error ? err.message.slice(0, 300) : 'The query failed';
    return failure(timedOut ? 504 : 502, timedOut ? 'METRIC_TIMEOUT' : 'METRIC_QUERY_FAILED', { message: reason, hint: timedOut ? 'Narrow the date range or group by fewer dimensions.' : undefined });
  }

  const cert = certifiedBy(m.entry);
  const rows = shapeRows(raw, compiled);
  return {
    ok: true,
    body: {
      metric: { id: m.entry.id, title: m.entry.title, title_es: spec.title_es ?? null, owner: m.entry.owner ?? null, type: spec.type, formula: metricFormula(spec) },
      status,
      certified_by: cert.by,
      certified_at: cert.at,
      spec_hash: m.entry.certification?.content_hash ?? null,
      query,
      rows,
      truncated: rows.length >= MAX_METRIC_ROWS,
      format: spec.format,
      computed_at: new Date().toISOString(),
      source: sourceView(spec, target),
      freshness,
      scope: input.scope ? { field: input.scope.field, values: input.scope.values } : null,
      ...(isManager(input.role) ? { sql: compiled.sql } : {}),
    },
  };
}
