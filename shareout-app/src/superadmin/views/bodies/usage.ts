/**
 * Usage ledger view: per-workspace usage and cost from workspace_usage_daily, for this
 * month so far and last month, with CSV downloads to invoice from.
 */

import { escapeHtml } from '../../../html/utils';
import { MICRO_USD } from '../../cf-pricing';
import { gbMonths, type MonthlyUsageRow, type UsageMetric } from '../../../workspaces/usage-ledger';
import { card, fmt, stat2 } from '../components';

const GROUPS: Array<{ title: string; metrics: UsageMetric[]; detail: (q: Partial<Record<UsageMetric, number>>, month: string) => string }> = [
  { title: 'Storage', metrics: ['storage_bytes'], detail: (q, m) => `${gbMonths(q.storage_bytes ?? 0, m).toFixed(2)} GB-mo` },
  { title: 'Serving', metrics: ['serving_requests'], detail: (q) => `${fmt(q.serving_requests ?? 0)} req` },
  { title: 'Automations', metrics: ['job_runs', 'job_duration_ms'], detail: (q) => `${fmt(q.job_runs ?? 0)} runs` },
  { title: 'AI', metrics: ['ai_llm_tokens', 'ai_other_events'], detail: (q) => `${fmt(q.ai_llm_tokens ?? 0)} tok` },
  { title: 'Email', metrics: ['email_sent'], detail: (q) => `${fmt(q.email_sent ?? 0)} sent` },
  { title: 'Browser', metrics: ['browser_seconds'], detail: (q) => `${fmt(Math.round((q.browser_seconds ?? 0) / 60))} min` },
];

interface WsRow {
  name: string;
  qty: Partial<Record<UsageMetric, number>>;
  cost: Partial<Record<UsageMetric, number>>;
  total: number;
}

function group(rows: MonthlyUsageRow[]): WsRow[] {
  const by = new Map<string, WsRow>();
  for (const r of rows) {
    const w = by.get(r.workspaceId) ?? { name: r.name, qty: {}, cost: {}, total: 0 };
    w.qty[r.metric] = r.quantity;
    w.cost[r.metric] = r.costMicroUsd;
    w.total += r.costMicroUsd;
    by.set(r.workspaceId, w);
  }
  return [...by.values()].sort((a, b) => b.total - a.total);
}

const usd = (micro: number) => `$${(micro / MICRO_USD).toFixed(2)}`;

function monthTable(title: string, month: string, rows: MonthlyUsageRow[]): string {
  const ws = group(rows);
  const sum = (w: WsRow, metrics: UsageMetric[]) => metrics.reduce((n, m) => n + (w.cost[m] ?? 0), 0);
  const body = ws.length
    ? ws.map((w) => `<tr>
        <td>${escapeHtml(w.name)}</td>
        ${GROUPS.map((g) => `<td class="sa-num">${usd(sum(w, g.metrics))}<div class="sa-muted" style="font-size:11px">${escapeHtml(g.detail(w.qty, month))}</div></td>`).join('')}
        <td class="sa-num"><strong>${usd(w.total)}</strong></td>
      </tr>`).join('')
    : `<tr><td colspan="${GROUPS.length + 2}" class="sa-muted">No usage recorded for ${escapeHtml(month)}.</td></tr>`;
  const csv = `<a href="/v1/admin/usage.csv?month=${month}" style="color:var(--color-primary)">CSV</a> · <a href="/v1/admin/usage.csv?month=${month}&by=day" style="color:var(--color-primary)">by day</a>`;
  return card(`${escapeHtml(title)} · ${escapeHtml(month)} · ${csv}`, `<div style="overflow:auto"><table class="sa-table sa-cost-table">
      <thead><tr><th>Workspace</th>${GROUPS.map((g) => `<th class="sa-num">${g.title}</th>`).join('')}<th class="sa-num">Total</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>`);
}

export function usageBody(thisMonth: string, current: MonthlyUsageRow[], lastMonth: string, previous: MonthlyUsageRow[]): string {
  const total = (rows: MonthlyUsageRow[]) => rows.reduce((n, r) => n + r.costMicroUsd, 0);
  return `
    <div class="sa-stats">
      ${stat2(usd(total(current)), 'This month so far', `${group(current).length} workspaces`)}
      ${stat2(usd(total(previous)), 'Last month', `${group(previous).length} workspaces`)}
    </div>
    <p class="sa-note" style="margin:var(--space-3) 0">
      Daily per-workspace usage, rolled up at 00:00 UTC for the day before; email and browser time count as they happen.
      Storage is measured from R2 (every file, incl. drafts, thumbnails and inbox mail) and priced as GB-months.
      Cost is Cloudflare list price, or the real provider cost for AI (BYO-key calls excluded), before account-wide free allowances.
      Personal artifacts outside a workspace are not metered.
    </p>
    ${monthTable('This month', thisMonth, current)}
    <div style="margin-top:var(--space-4)">${monthTable('Last month', lastMonth, previous)}</div>`;
}
