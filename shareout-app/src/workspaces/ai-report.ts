import type { Env } from '../types';
import { resell } from '../data/ai-markup';
import { priceCall } from '../data/agent/model-costs';

// Admin → Billing → AI report: where one month of AI went, at the workspace's price — by what it was
// for (questions, pages, automations, knowledge…), by kind, by model with input/output tokens, by
// automation, by page, by person and by day. It reads ai_usage_events, the one AI meter
// (data/ai-pending.ts), so its total is the AI budget's, the Summary's and the invoice's. Cost and
// margin are added only for the instance operator (`withCost`).

export type AiCategory = 'questions' | 'pages' | 'automations' | 'knowledge' | 'summaries' | 'other';

const CATEGORY: Record<string, AiCategory> = {
  assistant_chat: 'questions', ask_workspace: 'questions', artifact_visitor_chat: 'questions', artifact_admin_chat: 'questions',
  page_build: 'pages', page_pilot: 'pages', artifact_ai_edit: 'pages', present_this: 'pages',
  crew_run: 'automations',
  file_enrichment: 'knowledge',
  artifact_summary: 'summaries', version_summary: 'summaries', home_brief: 'summaries', publish_moderation: 'summaries',
};

/** What a metered call was for, in the words a customer reads on the bill. */
export const categoryOf = (kind: string): AiCategory => CATEGORY[kind] ?? (kind.startsWith('knowledge_') ? 'knowledge' : 'other');

export interface AiReportRow {
  key: string;
  /** A readable name when the key is an id (person, page, automation). */
  label?: string | null;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  /** Every token the calls used, including steps that only record a total (knowledge extraction). */
  tokens: number;
  /** What the workspace pays. */
  price_micro_usd: number;
  /** Operator only. */
  cost_micro_usd?: number;
  /** Automations: how many runs. */
  runs?: number;
}

export interface AiReport {
  month: string;
  totals: AiReportRow;
  /** Operator only: 15000 = 1.5×. */
  markup_bps?: number;
  by_category: AiReportRow[];
  by_kind: AiReportRow[];
  by_model: AiReportRow[];
  by_automation: AiReportRow[];
  by_page: AiReportRow[];
  /** key '' = no person (automations, background work) or someone no longer here. */
  by_member: AiReportRow[];
  by_day: AiReportRow[];
}

interface Acc { key: string; calls: number; input_tokens: number; output_tokens: number; tokens: number; cost: number; runs: Set<string> }

const MAX_IN = 90; // D1 caps bound parameters at 100

async function namesFor(env: Env, sql: (ph: string) => string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += MAX_IN) {
    const chunk = ids.slice(i, i + MAX_IN);
    const rows = (await env.DB.prepare(sql(chunk.map(() => '?').join(','))).bind(...chunk).all<{ id: string; name: string | null }>()).results ?? [];
    for (const r of rows) if (r.name) out.set(r.id, r.name);
  }
  return out;
}

/** One month of a workspace's AI, broken down every way the bill is read. `month` is YYYY-MM (UTC). */
export async function aiReport(env: Env, workspaceId: string, month: string, markupBps: number, withCost = false): Promise<AiReport> {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`, to = new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 10);
  const rows = (await env.DB.prepare(
    `SELECT substr(created_at, 1, 10) AS day, kind, model, user_id, source, cost_source,
            COUNT(*) AS calls, COALESCE(SUM(input_tokens), 0) AS tin, COALESCE(SUM(output_tokens), 0) AS tout,
            COALESCE(SUM(CASE WHEN unit_kind = 'tokens' THEN units ELSE 0 END), 0) AS tokens, COALESCE(SUM(base_cost_micro_usd), 0) AS cost
       FROM ai_usage_events
      WHERE workspace_id = ? AND created_at >= ? AND created_at < ?
      GROUP BY day, kind, model, user_id, source, cost_source`,
  ).bind(workspaceId, from, to).all<{
    day: string; kind: string; model: string; user_id: string | null; source: string | null; cost_source: string | null;
    calls: number; tin: number; tout: number; tokens: number; cost: number;
  }>()).results ?? [];

  const dims = { category: new Map<string, Acc>(), kind: new Map<string, Acc>(), model: new Map<string, Acc>(), automation: new Map<string, Acc>(),
    page: new Map<string, Acc>(), member: new Map<string, Acc>(), day: new Map<string, Acc>() };
  const total: Acc = { key: 'total', calls: 0, input_tokens: 0, output_tokens: 0, tokens: 0, cost: 0, runs: new Set() };
  const runIds = new Set<string>(), pageIds = new Set<string>(), userIds = new Set<string>();

  for (const r of rows) {
    let cost = r.cost;
    // A call the hourly reconcile has not priced yet counts at list price, as in the AI budget and invoices.
    if (r.cost_source === 'pending' && cost === 0) cost = (await priceCall(env, r.model, r.tin, r.tout).catch(() => ({ microUsd: 0 }))).microUsd;
    const add = (map: Map<string, Acc> | null, key: string, run?: string) => {
      const a = map ? map.get(key) ?? { key, calls: 0, input_tokens: 0, output_tokens: 0, tokens: 0, cost: 0, runs: new Set<string>() } : total;
      a.calls += r.calls; a.input_tokens += r.tin; a.output_tokens += r.tout; a.tokens += r.tokens || r.tin + r.tout; a.cost += cost;
      if (run) a.runs.add(run);
      if (map) map.set(key, a);
    };
    add(null, 'total');
    add(dims.category, categoryOf(r.kind));
    add(dims.kind, r.kind);
    add(dims.model, r.model);
    add(dims.day, r.day);
    add(dims.member, r.user_id ?? '');
    if (r.user_id) userIds.add(r.user_id);
    if (r.kind === 'crew_run' && r.source) { add(dims.automation, r.source, r.source); runIds.add(r.source); }
    if (r.source?.startsWith('art_')) { add(dims.page, r.source); pageIds.add(r.source); }
  }

  // Runs roll up to the automation (crew) they belong to.
  const runCrew = new Map<string, { id: string; name: string | null }>();
  const ids = [...runIds];
  for (let i = 0; i < ids.length; i += MAX_IN) {
    const chunk = ids.slice(i, i + MAX_IN);
    const res = (await env.DB.prepare(
      `SELECT r.id AS run_id, c.id AS crew_id, c.name AS name FROM crew_runs r JOIN crews c ON c.id = r.crew_id WHERE r.id IN (${chunk.map(() => '?').join(',')})`,
    ).bind(...chunk).all<{ run_id: string; crew_id: string; name: string | null }>()).results ?? [];
    for (const x of res) runCrew.set(x.run_id, { id: x.crew_id, name: x.name });
  }
  const byCrew = new Map<string, Acc & { label: string | null }>();
  for (const a of dims.automation.values()) {
    const crew = runCrew.get(a.key);
    const key = crew?.id ?? '';
    const c = byCrew.get(key) ?? { key, label: crew?.name ?? null, calls: 0, input_tokens: 0, output_tokens: 0, tokens: 0, cost: 0, runs: new Set<string>() };
    c.calls += a.calls; c.input_tokens += a.input_tokens; c.output_tokens += a.output_tokens; c.tokens += a.tokens; c.cost += a.cost;
    for (const run of a.runs) c.runs.add(run);
    byCrew.set(key, c);
  }

  const [pageNames, people] = await Promise.all([
    namesFor(env, (ph) => `SELECT id, name FROM artifacts WHERE id IN (${ph})`, [...pageIds]),
    namesFor(env, (ph) => `SELECT id, COALESCE(email, name) AS name FROM users WHERE id IN (${ph})`, [...userIds]),
  ]);

  const view = (a: Acc, label?: string | null, runs = false): AiReportRow => ({
    key: a.key,
    ...(label !== undefined ? { label } : {}),
    calls: a.calls, input_tokens: a.input_tokens, output_tokens: a.output_tokens, tokens: Math.round(a.tokens),
    price_micro_usd: resell(a.cost, markupBps),
    ...(withCost ? { cost_micro_usd: a.cost } : {}),
    ...(runs ? { runs: a.runs.size } : {}),
  });
  const sorted = (list: AiReportRow[]) => list.sort((p, q) => q.price_micro_usd - p.price_micro_usd || q.calls - p.calls || p.key.localeCompare(q.key));

  return {
    month,
    totals: view(total),
    ...(withCost ? { markup_bps: markupBps } : {}),
    by_category: sorted([...dims.category.values()].map((a) => view(a))),
    by_kind: sorted([...dims.kind.values()].map((a) => view(a))),
    by_model: sorted([...dims.model.values()].map((a) => view(a))),
    by_automation: sorted([...byCrew.values()].map((a) => view(a, a.label, true))),
    by_page: sorted([...dims.page.values()].map((a) => view(a, pageNames.get(a.key) ?? null))),
    by_member: sorted([...dims.member.values()].map((a) => view(a, a.key ? people.get(a.key) ?? null : null))),
    by_day: [...dims.day.values()].map((a) => view(a)).sort((p, q) => p.key.localeCompare(q.key)),
  };
}

const csvCell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** The report as one CSV: a row per breakdown line, prices in USD (cost columns only when present). */
export function aiReportCsv(r: AiReport): string {
  const withCost = r.totals.cost_micro_usd != null;
  const head = ['month', 'breakdown', 'key', 'name', 'calls', 'runs', 'input_tokens', 'output_tokens', 'tokens', 'price_usd', ...(withCost ? ['cost_usd'] : [])];
  const lines = [head.join(',')];
  const usd = (micro: number) => (micro / 1_000_000).toFixed(6);
  const dump = (name: string, list: AiReportRow[]) => {
    for (const x of list) {
      lines.push([r.month, name, x.key, x.label ?? '', x.calls, x.runs ?? '', x.input_tokens, x.output_tokens, x.tokens, usd(x.price_micro_usd),
        ...(withCost ? [usd(x.cost_micro_usd ?? 0)] : [])].map(csvCell).join(','));
    }
  };
  dump('total', [r.totals]);
  dump('category', r.by_category); dump('kind', r.by_kind); dump('model', r.by_model); dump('automation', r.by_automation);
  dump('page', r.by_page); dump('member', r.by_member); dump('day', r.by_day);
  return lines.join('\n') + '\n';
}
