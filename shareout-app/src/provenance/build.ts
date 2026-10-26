/**
 * Merge what a page declares (manifest, capabilities), what it shows (bindings, feeds)
 * and what it calls (SDK calls) with what the server knows (connections, jobs, crews,
 * syncs, datasets, metrics) into one list, then cut it down to what the caller may see.
 * Pure: no I/O, so every rule here is unit-tested directly.
 */
import type { ManifestProvenance } from '../../shared/editor-readiness/manifest';
import type { PageScan } from './scan';
import type { ConnectionFact, SourceFacts } from './facts';
import { normalizeRef, refKind, refName } from './refs';
import { staleAfterMs } from './staleness';
import {
  MAX_FEEDS_PER_SOURCE,
  type DataSource,
  type SourceDetails,
  type SourceFeed,
  type SourceFreshness,
  type SourceKind,
} from './types';

export interface BuildAccess {
  /** Editor/manager: queries, connection identifiers and credential hints. */
  full: boolean;
  /** Data filtered by the artifact's access policy: page-source names only. */
  scoped: boolean;
  /** May see job / crew / sync names (see SourcesCaller.named). Implied by `full`. */
  named: boolean;
}

export interface BuildContext {
  artifactId: string;
  workspaceId: string | null;
  now?: number;
}

interface Refresher {
  type: 'job' | 'crew' | 'sync';
  id: string;
  name: string;
  schedule?: string;
  enabled: boolean;
  /** Newest successful write / run / sync (ISO). */
  at?: string;
  /** Same, from scheduled runs only (what a policy-scoped viewer may learn). */
  scheduledAt?: string;
  last_status?: string;
  last_run_at?: string;
}

interface Draft {
  key: string;
  kind: SourceKind;
  name: string;
  declared: boolean;
  /** Named by the page itself (manifest, markup, scripts, publish capabilities). */
  inPage: boolean;
  /** A connection the access policy lets scoped viewers query (shown to them, unnamed). */
  policy?: boolean;
  direct: boolean;
  label?: string;
  description?: string;
  provenance?: ManifestProvenance;
  feeds: Map<string, SourceFeed>;
  feedCount: number;
  upstream: Set<string>;
  refreshers: Refresher[];
  live: boolean;
  observedAt?: string;
  provider?: string;
  connection?: ConnectionFact;
  missingConnection?: string;
  query?: string;
  tools?: string[];
  hosts?: string[];
}

const BUILT_IN: ReadonlySet<SourceKind> = new Set(['json', 'table', 'dataset', 'file', 'knowledge', 'metric']);

const PROVIDER_LABELS: Record<string, string> = {
  bigquery: 'BigQuery',
  snowflake: 'Snowflake',
  redshift: 'Amazon Redshift',
  aurora: 'Amazon Aurora',
  postgres: 'PostgreSQL',
  supabase: 'Supabase',
  s3: 'Amazon S3',
  aws: 'AWS',
  rest_api: 'API',
  'google-ads': 'Google Ads',
  'facebook-ads': 'Meta Ads',
  'google-analytics': 'Google Analytics',
  'google-sheets': 'Google Sheets',
  google_sheets: 'Google Sheets',
  shopify: 'Shopify',
  tiendanube: 'Tienda Nube',
  slack: 'Slack',
  github: 'GitHub',
  mcp: 'MCP',
  http: 'API',
};

export function providerLabel(provider: string | undefined | null): string | null {
  if (!provider) return null;
  return PROVIDER_LABELS[provider] ?? provider.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function buildSources(scan: PageScan | null, facts: SourceFacts, access: BuildAccess, ctx: BuildContext): DataSource[] {
  const drafts = new Map<string, Draft>();
  const ensure = (key: string, init: Partial<Pick<Draft, 'declared' | 'inPage' | 'direct'>> = {}): Draft => {
    let d = drafts.get(key);
    if (!d) {
      d = {
        key, kind: refKind(key), name: refName(key),
        declared: false, inPage: false, direct: false,
        feeds: new Map(), feedCount: 0, upstream: new Set(), refreshers: [], live: false,
      };
      drafts.set(key, d);
    }
    if (init.declared) d.declared = true;
    if (init.inPage) d.inPage = true;
    if (init.direct) d.direct = true;
    return d;
  };
  const page = { declared: true, inPage: true, direct: true };
  const seen = { inPage: true, direct: true };

  // 1. Declared in the manifest.
  const sources = scan?.manifest?.manifest.sources ?? {};
  const declare = (kind: 'json' | 'table' | 'connection', bucket: Record<string, ManifestProvenance> | undefined) => {
    for (const [name, raw] of Object.entries(bucket ?? {})) {
      const key = normalizeRef(`${kind}:${name}`);
      if (!key) continue;
      const d = ensure(key, page);
      const p = (raw && typeof raw === 'object' ? raw : {}) as ManifestProvenance;
      d.provenance = p;
      if (typeof p.label === 'string' && p.label.trim()) d.label = p.label.trim();
      if (typeof p.description === 'string' && p.description.trim()) d.description = p.description.trim();
    }
  };
  declare('json', sources.json);
  declare('table', sources.tables);
  declare('connection', sources.connections);

  // 2. Elements the page binds, and manifest feeds.
  for (const el of scan?.elements ?? []) {
    for (const ref of el.refs) addFeed(ensure(ref, seen), { selector: el.selector, element_id: el.element_id, label: el.label });
  }
  for (const feed of scan?.manifest?.feeds ?? []) {
    const ref = normalizeRef(typeof feed?.source === 'string' ? feed.source : '');
    if (!ref || typeof feed.element !== 'string' || !feed.element.trim()) continue;
    addFeed(ensure(ref, seen), { selector: feed.element.trim(), ...(feed.note ? { label: String(feed.note).slice(0, 80) } : {}) });
  }

  // 3. What its scripts call.
  const code = scan?.code;
  if (code) {
    code.json.forEach((k) => { const r = normalizeRef(`json:${k}`); if (r) ensure(r, seen); });
    code.tables.forEach((t) => { const r = normalizeRef(`table:${t}`); if (r) ensure(r, seen); });
    code.datasets.forEach((n) => { const r = normalizeRef(`dataset:${n}`); if (r) ensure(r, seen); });
    code.connections.forEach((c) => { const r = normalizeRef(`connection:${c}`); if (r) ensure(r, seen).live = true; });
    code.platforms.forEach((p) => {
      const d = ensure(`platform:${p}`, seen);
      d.kind = 'connection';
      d.provider = p;
      d.live = true;
    });
    code.secrets.forEach((s) => { const r = normalizeRef(`external:${s}`); if (r) ensure(r, seen).live = true; });
    code.files.forEach((f) => { const r = normalizeRef(`file:${f}`); if (r) ensure(r, seen); });
    if (code.knowledge) ensure('knowledge:workspace', seen).live = true;
    if (code.blobs) ensure('file:uploads', seen).live = true;
  }

  // 4. Declared at publish: MCP connections run live, as the viewer.
  for (const c of facts.mcp?.connections ?? []) {
    const d = ensure(`mcp:${c.name}`, page);
    d.live = true;
    d.provider = 'mcp';
    d.tools = c.tools;
  }
  // Queries the author declared for policy-scoped viewers (server-side, not page source).
  for (const q of facts.policyQueries) {
    const r = normalizeRef(`connection:${q.connection}`);
    if (!r) continue;
    const d = ensure(r, { declared: true, direct: true });
    d.live = true;
    d.policy = true;
    d.provider ??= q.provider;
    d.query ??= q.sql;
  }

  // 5. Who writes the stores: jobs, crews, sheet syncs.
  for (const job of facts.jobs) {
    for (const t of job.targets) {
      const d = ensure(t.ref, { direct: true });
      d.refreshers.push({
        type: 'job', id: job.id, name: job.name, schedule: job.schedule, enabled: job.enabled,
        at: job.last_ok_at, scheduledAt: job.schedule ? job.last_ok_at : undefined,
        last_status: job.last_status, last_run_at: job.last_run_at,
      });
      if (t.query) d.query ??= t.query;
      if (job.connection) {
        const up = normalizeRef(`connection:${job.connection}`);
        if (up) { ensure(up); d.upstream.add(up); }
      }
    }
  }
  for (const crew of facts.crews) {
    for (const [ref, at] of crew.writes) {
      const key = normalizeRef(ref);
      if (!key) continue;
      const d = ensure(key, { direct: true });
      d.refreshers.push({
        type: 'crew', id: crew.id, name: crew.name, schedule: crew.schedule, enabled: crew.active,
        at, scheduledAt: crew.scheduledWrites.get(ref),
      });
      for (const c of crew.reads) {
        const up = normalizeRef(`connection:${c}`);
        if (up) { ensure(up); d.upstream.add(up); }
      }
    }
  }
  for (const sync of facts.syncs) {
    const key = normalizeRef(`table:${sync.table}`);
    if (!key) continue;
    const d = ensure(key, { direct: true });
    d.refreshers.push({
      type: 'sync', id: sync.id, name: sync.name, schedule: sync.schedule, enabled: true,
      at: sync.last_synced_at, scheduledAt: sync.schedule ? sync.last_synced_at : undefined,
    });
    const up = ensure(`sheet:${sync.id}`);
    up.kind = 'connection';
    up.provider = 'google-sheets';
    up.label = sync.sheet_name ? `${sync.name} · ${sync.sheet_name}` : sync.name;
    d.upstream.add(up.key);
  }

  // 6. Stored with the page: datasets, files, store timestamps.
  for (const [name, ds] of facts.datasets) {
    const key = normalizeRef(`dataset:${name}`);
    if (!key) continue;
    const d = ensure(key, { direct: true });
    d.observedAt = ds.updated_at;
  }
  for (const d of drafts.values()) {
    if (d.kind === 'json') d.observedAt ??= facts.stamps.json.get(d.name);
    else if (d.kind === 'table') d.observedAt ??= facts.stamps.tables.get(d.name);
    else if (d.kind === 'file' && d.name !== 'uploads') {
      const f = facts.files.get(d.name);
      if (f) { d.label ??= f.name; d.observedAt = f.updated_at; }
    } else if (d.kind === 'external') {
      const s = facts.secrets.get(d.name);
      if (s) { d.hosts = s.hosts; if (s.description) d.description ??= s.description; }
    }
  }
  for (const [name, s] of facts.secrets) {
    const key = normalizeRef(`external:${name}`);
    if (!key || drafts.has(key)) continue;
    const d = ensure(key, { direct: true });
    d.live = true;
    d.hosts = s.hosts;
    if (s.description) d.description = s.description;
  }

  // 7. Followable metrics: derived from one store, shown by the elements bound to it.
  for (const m of facts.metrics) {
    const d = ensure(`metric:${m.id}`, { direct: true, declared: !!scan?.metricIds.has(m.id), inPage: !!scan?.metricIds.has(m.id) });
    d.label = m.label;
    const store = m.source.type === 'json_path' ? normalizeRef(`json:${m.source.key}`) : normalizeRef(`table:${m.source.table}`);
    if (store) { ensure(store); d.upstream.add(store); }
    for (const el of scan?.elements ?? []) {
      if (el.bindings?.some((b) => metricBinding(m.source, b))) addFeed(d, { selector: el.selector, element_id: el.element_id, label: el.label });
    }
  }

  // 8. Resolve connection names to this instance's connections.
  for (const d of drafts.values()) {
    if (d.kind !== 'connection' || d.key.startsWith('platform:') || d.key.startsWith('sheet:')) continue;
    const row = facts.connections.find((c) => c.scope === 'artifact' && c.name === d.name)
      ?? facts.connections.find((c) => c.scope === 'workspace' && c.name === d.name && c.provider !== 'mcp');
    if (row) { d.connection = row; d.provider = row.provider; } else d.missingConnection = d.name;
  }
  for (const d of drafts.values()) {
    if (d.kind !== 'mcp') continue;
    const row = facts.connections.find((c) => c.scope === 'workspace' && c.name === d.name && c.provider === 'mcp');
    if (row) d.connection = row; else d.missingConnection = d.name;
  }

  return finish([...drafts.values()], access, ctx);
}

function addFeed(d: Draft, feed: SourceFeed): void {
  d.feedCount++;
  if (!d.feeds.has(feed.selector)) d.feeds.set(feed.selector, feed);
}

function metricBinding(source: SourceFacts['metrics'][number]['source'], binding: string): boolean {
  if (source.type === 'json_path') return binding === `json:${source.key}.${source.path}`;
  if (source.type === 'table_count') return binding.startsWith(`table:${source.table}:count:`);
  return binding.startsWith(`table:${source.table}:${source.fn}:${source.field}`);
}

function finish(all: Draft[], access: BuildAccess, ctx: BuildContext): DataSource[] {
  const now = ctx.now ?? Date.now();
  const visible = access.scoped ? all.filter((d) => d.inPage || d.policy) : all;
  const keep = new Set(visible.map((d) => d.key));
  // Names only the server knows (job targets, job connections, sheet syncs) are not page
  // source; non-editors get an opaque key and a generic label for them.
  const opaque = new Map<string, string>();
  for (const d of visible) {
    if (!access.full && !d.inPage) opaque.set(d.key, `${d.kind}:~${opaque.size + 1}`);
  }
  const keyOf = (k: string) => opaque.get(k) ?? k;

  const freshness = new Map<string, SourceFreshness>();
  for (const d of visible) freshness.set(d.key, freshnessOf(d, access, now));
  // A metric is as fresh as the store it reads.
  for (const d of visible) {
    if (d.kind !== 'metric') continue;
    const up = [...d.upstream].map((k) => freshness.get(k)).find((f) => f && Object.keys(f).length);
    if (up) freshness.set(d.key, up);
  }

  const out = visible.map((d): DataSource => {
    const isOpaque = opaque.has(d.key);
    const provider = d.provider ?? (BUILT_IN.has(d.kind) ? 'shareout' : d.kind === 'external' ? 'http' : null);
    const label = isOpaque
      ? (providerLabel(provider === 'shareout' ? null : provider) ?? d.kind)
      : d.label ?? (d.kind === 'connection' || d.kind === 'mcp' ? (d.key.startsWith('platform:') ? providerLabel(d.provider) : null) : null) ?? d.name;
    const source: DataSource = {
      key: keyOf(d.key),
      kind: d.kind,
      label,
      provider,
      provider_label: provider === 'shareout' ? null : providerLabel(provider),
      ...(d.description && !isOpaque ? { description: d.description } : {}),
      declared: d.declared,
      direct: d.direct,
      freshness: freshness.get(d.key) ?? {},
      feeds: [...d.feeds.values()].slice(0, MAX_FEEDS_PER_SOURCE),
      feed_count: d.feedCount,
      upstream: [...d.upstream].filter((k) => keep.has(k)).map(keyOf),
      access: access.full ? 'full' : 'summary',
    };
    if (access.full) source.details = detailsOf(d, ctx);
    return source;
  });

  return out.sort((a, b) =>
    Number(b.direct) - Number(a.direct)
    || b.feed_count - a.feed_count
    || Number(b.declared) - Number(a.declared)
    || a.label.localeCompare(b.label));
}

function freshnessOf(d: Draft, access: BuildAccess, now: number): SourceFreshness {
  const f: SourceFreshness = {};
  const p = d.provenance;
  if (typeof p?.as_of === 'string' && p.as_of.trim()) f.as_of = p.as_of.trim();
  if (typeof p?.refresh === 'string' && p.refresh.trim()) f.refresh = p.refresh.trim();

  const timed = d.refreshers
    .map((r) => ({ r, at: access.scoped ? r.scheduledAt : r.at }))
    .filter((x) => x.at)
    .sort((a, b) => (a.at! < b.at! ? 1 : -1));
  const best = timed[0]?.r ?? (access.scoped ? d.refreshers.find((r) => r.schedule) : d.refreshers[0]);
  const named = (access.full || access.named) && !access.scoped;
  if (best) {
    if (timed[0]) f.last_refresh_at = timed[0].at;
    f.refresher = {
      type: best.type === 'crew' ? 'crew' : 'job',
      ...(named ? { name: best.name } : {}),
      ...(best.schedule ? { schedule: best.schedule } : {}),
    };
  } else if (d.live) {
    f.refresher = { type: 'live' };
  } else {
    if (d.observedAt) f.last_refresh_at = d.observedAt;
    if (f.refresh && /^manual(ly)?$/i.test(f.refresh)) f.refresher = { type: 'manual' };
  }

  if (!d.live || f.last_refresh_at) {
    const newest = Math.max(dateOf(f.last_refresh_at), dateOf(f.as_of));
    const limit = staleAfterMs({
      sla: p?.freshness_sla,
      // The schedule that produced the time shown, else every schedule that writes it.
      schedules: best?.schedule ? [best.schedule] : d.refreshers.map((r) => r.schedule),
      refresh: f.refresh,
    }, now);
    if (newest > 0 && now - newest > limit) f.stale = true;
  }
  return f;
}

function dateOf(s: string | undefined): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

function detailsOf(d: Draft, ctx: BuildContext): SourceDetails {
  const p = d.provenance;
  const details: SourceDetails = {};
  const query = (typeof p?.query === 'string' && p.query.trim()) || d.query;
  if (query) details.query = query;
  if (Array.isArray(p?.tables) && p.tables.length) details.tables = p.tables.filter((t) => typeof t === 'string');
  if (p?.replication && typeof p.replication === 'object') details.replication = p.replication;
  if (d.connection) {
    details.connection = {
      id: d.connection.id,
      name: d.connection.name,
      scope: d.connection.scope,
      kind: d.connection.kind,
      credential_scope: d.connection.credential_scope,
    };
  } else if (d.missingConnection) {
    details.missing_connection = d.missingConnection;
  }
  if (d.refreshers.length) {
    details.refreshers = d.refreshers.map((r) => ({
      type: r.type, id: r.id, name: r.name, enabled: r.enabled,
      ...(r.schedule ? { schedule: r.schedule } : {}),
      ...(r.last_status ? { last_status: r.last_status } : {}),
      ...(r.last_run_at ? { last_run_at: r.last_run_at } : {}),
    }));
  }
  if (d.tools?.length) details.tools = d.tools;
  if (d.hosts?.length) details.hosts = d.hosts;
  const ws = ctx.workspaceId ? `workspace=${encodeURIComponent(ctx.workspaceId)}&` : '';
  const manage: NonNullable<SourceDetails['manage']> = {};
  if (ctx.workspaceId && (d.kind === 'connection' || d.kind === 'mcp')) manage.connections = `/home?${ws}view=connectors`;
  if (d.refreshers.some((r) => r.type === 'job' || r.type === 'sync')) manage.jobs = `/home?${ws}view=schedules`;
  if (ctx.workspaceId && (d.kind === 'table' || d.kind === 'dataset')) manage.data = `/home?${ws}view=datasets`;
  if (Object.keys(manage).length) details.manage = manage;
  return details;
}
