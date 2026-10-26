/**
 * Words for a data source: its label, where it comes from, how fresh it is and what it
 * feeds. Used by the editor's Data tab; the viewer panel and the Studio tab run the same
 * rules from an inline script (src/serve/sandbox-viewer/data-sources/format-js.ts), and a
 * parity test keeps the two in step.
 */
import type { DataSourcesCopy } from './copy';
import type { DataSource, SourceDetails } from './types';

export interface SourceDetailView {
  query?: string;
  rows: Array<[string, string]>;
  links: Array<[string, string]>;
}

export interface SourceFormatter {
  label(s: DataSource): string;
  origin(s: DataSource, byKey: Record<string, DataSource>): string;
  freshness(s: DataSource): string;
  feeds(s: DataSource): string;
  meta(s: DataSource, byKey: Record<string, DataSource>): string;
  details(d: SourceDetails | undefined): SourceDetailView | null;
}

const DOT = ' · ';

export function fill(s: string, map: Record<string, string | number>): string {
  let out = s;
  for (const k of Object.keys(map)) out = out.split(`{${k}}`).join(String(map[k]));
  return out;
}

export function createSourceFormatter(c: DataSourcesCopy, lang: string, now: () => number = Date.now): SourceFormatter {
  const date = (v: string): string => {
    const t = Date.parse(v);
    if (Number.isNaN(t)) return v;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v);
    try {
      return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}) }).format(new Date(t));
    } catch {
      return v;
    }
  };
  const ago = (iso: string): string => {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    const s = Math.max(0, Math.floor((now() - t) / 1000));
    if (s < 60) return c.justNow;
    if (s < 3600) return fill(c.minAgo, { n: Math.floor(s / 60) });
    if (s < 86400) return fill(c.hAgo, { n: Math.floor(s / 3600) });
    const d = Math.floor(s / 86400);
    if (d === 1) return c.yesterday;
    if (d < 30) return fill(c.daysAgo, { n: d });
    return fill(c.onDate, { date: date(iso) });
  };
  const label = (s: DataSource): string => {
    if (s.key === 'knowledge:workspace') return c.kindKnowledge;
    if (s.key === 'file:uploads') return c.kindUploads;
    if (s.key.indexOf(':~') > 0) {
      if (s.provider_label) return s.provider_label;
      const generic: Partial<Record<DataSource['kind'], string>> = {
        json: c.kindSaved, table: c.kindTable, dataset: c.kindDataset, file: c.kindFile, external: c.kindExternal, connection: c.kindConnection,
      };
      return generic[s.kind] ?? s.label;
    }
    return s.label;
  };
  // A 5-field cron (UTC) in words, or '' when it reads better unsaid. Schedules run on
  // an hourly tick, so anything finer than an hour is "every hour".
  const schedule = (cron: string | undefined): string => {
    const p = String(cron || '').trim().split(/\s+/);
    if (p.length !== 5 || p[3] !== '*') return '';
    const [mi, h, dom, , dow] = p;
    const num = /^\d+$/;
    if (h === '*' && dom === '*' && dow === '*') return (mi === '*' || /^\*\/\d+$/.test(mi) || num.test(mi)) ? c.cronHourly : '';
    if (!num.test(mi)) return '';
    const hs = /^\*\/(\d+)$/.exec(h);
    if (hs && dom === '*' && dow === '*') return fill(c.cronEveryHours, { n: hs[1] });
    if (!num.test(h)) return '';
    const time = `${('0' + h).slice(-2)}:${('0' + mi).slice(-2)}`;
    if (dom === '*' && dow === '*') return fill(c.cronDaily, { time });
    if (dom === '*' && dow === '1-5') return fill(c.cronWeekdays, { time });
    if (dom === '*' && /^[0-6]$/.test(dow)) return fill(c.cronWeekly, { day: c.cronDays.split(',')[Number(dow)], time });
    if (num.test(dom) && dow === '*') return fill(c.cronMonthly, { d: dom, time });
    return '';
  };
  const freshness = (s: DataSource): string => {
    const f = s.freshness ?? {};
    const r = f.refresher;
    if (r?.type === 'live') return s.kind === 'mcp' ? c.liveAsYou : c.live;
    const auto = !!r && (r.type === 'job' || r.type === 'crew') && !r.name;
    const sched = auto ? schedule(r?.schedule) : '';
    if (f.last_refresh_at) {
      const by = r
        ? (r.name ? fill(r.type === 'crew' ? c.byCrew : c.byJob, { name: r.name }) : auto ? (sched ? fill(c.autoSchedule, { schedule: sched }) : c.bySchedule) : '')
        : '';
      return fill(c.updated, { when: ago(f.last_refresh_at) }) + (by ? DOT + by : '');
    }
    if (r && (r.type === 'job' || r.type === 'crew')) {
      if (r.name) return fill(r.type === 'crew' ? c.keptByCrew : c.keptByJob, { name: r.name });
      return sched ? fill(c.keptByScheduleAt, { schedule: sched }) : c.keptBySchedule;
    }
    if (f.as_of) return fill(c.asOf, { date: date(f.as_of) });
    if (f.refresh) return fill(c.refreshes, { text: f.refresh });
    if (r?.type === 'manual') return c.manual;
    return c.notDeclared;
  };
  const origin = (s: DataSource, byKey: Record<string, DataSource>): string => {
    if (s.kind === 'connection' || s.kind === 'external') return s.provider_label && s.provider_label !== label(s) ? s.provider_label : '';
    if (s.kind === 'mcp') return '';
    const names = (s.upstream ?? []).map((k) => byKey[k]).filter((u): u is DataSource => !!u).map((u) => u.provider_label || label(u));
    return names.length ? fill(c.from, { name: names.join(', ') }) : '';
  };
  const feeds = (s: DataSource): string => {
    const n = s.feed_count || 0;
    return n === 0 ? c.feedsNone : n === 1 ? c.feedsOne : fill(c.feedsMany, { n });
  };
  const details = (d: SourceDetails | undefined): SourceDetailView | null => {
    if (!d) return null;
    const rows: Array<[string, string]> = [];
    const row = (term: string, value: string | undefined) => { if (value) rows.push([term, value]); };
    if (d.connection) {
      row(c.connection, [d.connection.name, d.connection.scope === 'workspace' ? c.scopeWorkspace : c.scopeArtifact,
        d.connection.credential_scope === 'per_user' ? c.credsPerUser : c.credsShared].join(DOT));
    } else if (d.missing_connection) {
      row(c.connection, fill(c.missingConnection, { name: d.missing_connection }));
    }
    if (d.tables?.length) row(c.tables, d.tables.join(', '));
    for (const r of d.refreshers ?? []) {
      const parts = [fill(r.type === 'crew' ? c.refCrew : r.type === 'sync' ? c.refSync : c.refJob, { name: r.name })];
      if (r.schedule) parts.push(r.schedule);
      if (!r.enabled) parts.push(c.paused);
      else if (r.last_status === 'failed') parts.push(c.lastFailed);
      row(c.updatedBy, parts.join(DOT));
    }
    if (d.tools?.length) row(c.tools, d.tools.join(', '));
    if (d.hosts?.length) row(c.hosts, d.hosts.join(', '));
    const rep = d.replication ?? {};
    row(c.credentials, rep.credentials);
    row(c.rebuild, rep.build);
    row(c.publishCmd, rep.publish);
    row(c.notes, rep.notes);
    const m = d.manage ?? {};
    const links = ([[m.connections, c.manageConnections], [m.jobs, c.manageJobs], [m.data, c.manageData]] as Array<[string | undefined, string]>)
      .filter((p): p is [string, string] => !!p[0]);
    if (!d.query && !rows.length && !links.length) return null;
    return { ...(d.query ? { query: d.query } : {}), rows, links };
  };
  return {
    label, origin, freshness, feeds, details,
    meta: (s, byKey) => [origin(s, byKey), freshness(s)].filter(Boolean).join(DOT),
  };
}
