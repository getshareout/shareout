/**
 * Overview and cost dashboard views.
 */

import { escapeHtml } from '../../../html/utils';
import type { PlatformMetrics } from '../../metrics';
import type { CostMetrics, FunnelMetrics, WorkspaceCosts, WorkspaceCostRow } from '../../insights';
import { barChart, bytes, card, costRow, deltaText, fmt, money, stat, stat2 } from '../components';
import { recentTable, topArtifactsTable } from '../tables';

export function overviewBody(m: PlatformMetrics, b: CostMetrics, f: FunnelMetrics): string {
  const t = m.totals;
  const dl = m.deltas;
  return `
    <div class="sa-stats">
      ${stat(t.artifacts, 'Artifacts', deltaText(dl.artifacts, 'new'))}
      ${stat(t.users, 'Users', deltaText(dl.users, 'new'))}
      ${stat(t.workspaces, 'Workspaces')}
      ${stat(t.views, 'Total views', deltaText(dl.views))}
      ${stat(t.tokens, 'LLM tokens', deltaText(dl.tokens))}
    </div>
    <div class="sa-grid-3" style="margin-top:var(--space-4)">
      ${card('Instance cost', `<div class="sa-stat-value">$${b.totalCostUsd.toFixed(2)}</div><div class="sa-stat-sub">$${b.llmCostUsd.toFixed(2)} AI · $${b.infraTotalUsd.toFixed(2)} infra · last ${b.periodDays}d</div>`)}
      ${card('Conversion', `<div class="sa-stat-value">${f.conversionPct.toFixed(1)}%</div><div class="sa-stat-sub">landing → submit</div>`)}
      ${card('Active users', `<div class="sa-stat-value">${fmt(t.activeUsers30d)}</div><div class="sa-stat-sub">logged in this period</div>`)}
    </div>
    <div class="sa-grid" style="margin-top:var(--space-4)">
      ${card('Top by views', topArtifactsTable(m.artifacts.topByViews))}
      ${card('Recently created', recentTable(m.artifacts.recent))}
    </div>`;
}

export function costsBody(b: CostMetrics): string {
  const infraLines = b.infra.available
    ? b.infra.lines.map((l) => costRow(l.label, l.detail, l.costUsd)).join('') +
      costRow('R2 storage', `${bytes(b.storageBytes)} stored`, b.storageCostUsd)
    : costRow('R2 storage', `${bytes(b.storageBytes)} stored`, b.storageCostUsd);
  const infraNote = b.infra.available
    ? ''
    : `<p class="sa-note">Cloudflare request/D1/KV costs not shown — ${escapeHtml(b.infra.reason || 'not configured')}</p>`;
  return `
    <div class="sa-stats">
      ${stat2('$' + b.llmCostUsd.toFixed(2), 'AI cost (providers)')}
      ${stat2('$' + b.infraTotalUsd.toFixed(2), 'Infra cost (Cloudflare)')}
      ${stat2('$' + b.totalCostUsd.toFixed(2), 'Total', `last ${b.periodDays}d`)}
    </div>
    <div class="sa-grid-3" style="margin-top:var(--space-4)">
      ${card('Infrastructure breakdown', `<table class="sa-table"><tbody>${infraLines}</tbody></table>${infraNote}`)}
      ${card('Over monthly budget', b.overBudget.length
        ? `<table class="sa-table"><tbody>${b.overBudget.map((w) => `<tr><td>${escapeHtml(w.name)}</td><td class="sa-num">$${w.spentUsd.toFixed(2)} / $${w.budgetUsd.toFixed(2)}</td></tr>`).join('')}</tbody></table>`
        : `<div class="sa-empty">None over budget.</div>`)}
    </div>`;
}

/** Cost-trend cell: ▲/▼ with the signed $ change in operating cost. Flat near zero. */
function trendCell(delta: number): string {
  if (Math.abs(delta) < 0.005) return `<td class="sa-num"><span class="sa-muted">·</span></td>`;
  const cls = delta > 0 ? 'sa-neg' : 'sa-pos'; // rising cost is the bad direction
  const arrow = delta > 0 ? '▲' : '▼';
  return `<td class="sa-num"><span class="${cls}">${arrow} ${money(delta)}</span></td>`;
}

function workspaceCostRow(r: WorkspaceCostRow, isTotal = false): string {
  const cell = (usd: number, detail: string) =>
    `<td class="sa-num">$${usd.toFixed(2)}<div class="sa-muted" style="font-size:11px">${escapeHtml(detail)}</div></td>`;
  const name = isTotal ? `<strong>${escapeHtml(r.name)}</strong>` : escapeHtml(r.name);
  return `<tr${isTotal ? ' class="sa-cost-total"' : ''}>
    <td>${name}</td>
    ${cell(r.storageUsd, bytes(r.storageBytes))}
    ${cell(r.servingUsd, `${fmt(r.servedRequests)} req`)}
    ${cell(r.automationUsd, `${fmt(r.jobRuns)} runs`)}
    ${cell(r.aiUsd, `${fmt(r.tokens)} tok`)}
    <td class="sa-num"><strong>$${r.totalUsd.toFixed(2)}</strong></td>
    ${trendCell(r.costDeltaUsd)}
  </tr>`;
}

export function workspaceCostsBody(c: WorkspaceCosts): string {
  const t = c.totals;
  const rows = c.rows.length ? c.rows.map((r) => workspaceCostRow(r)).join('') + workspaceCostRow(t, true) : '';
  const table = rows
    ? `<div class="sa-card" style="padding:0;overflow:auto"><table class="sa-table sa-cost-table">
        <thead><tr>
          <th>Workspace</th>
          <th class="sa-num">Storage</th>
          <th class="sa-num">Serving</th>
          <th class="sa-num">Automations</th>
          <th class="sa-num">AI cost</th>
          <th class="sa-num">Total cost</th>
          <th class="sa-num" title="Change in operating cost (serving + automation + AI) over the last ${c.days}d vs the prior ${c.days}d. Storage is point-in-time and excluded.">Trend</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`
    : `<div class="sa-empty">No workspaces yet.</div>`;

  return `
    <div class="sa-stats">
      ${stat2('$' + t.totalUsd.toFixed(2), 'Total cost (est.)', `${c.rows.length} workspaces`)}
      ${stat2('$' + t.aiUsd.toFixed(2), 'AI cost', `${fmt(t.tokens)} tokens`)}
      ${stat2('$' + t.storageUsd.toFixed(2), 'Storage', bytes(t.storageBytes))}
      ${stat2('$' + (t.servingUsd + t.automationUsd).toFixed(2), 'Serving + automations', `${fmt(t.servedRequests)} req · ${fmt(t.jobRuns)} runs`)}
    </div>
    <p class="sa-note" style="margin:var(--space-3) 0">
      <strong>Cost</strong> = measured usage priced at Cloudflare list rates + real AI provider cost; Cloudflare bills the account as a whole, so per-workspace cost is an estimate.
      Egress (bandwidth) isn't a line item — Cloudflare doesn't bill it (R2 has zero egress fees); the per-request serving cost is already in <strong>Serving</strong>.
      <strong>Trend</strong> compares the last ${c.days}d of operating cost vs the prior ${c.days}d. Rows are sorted most expensive first.
    </p>
    ${table}`;
}
