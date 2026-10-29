/**
 * Health telemetry and scheduled-job operations views.
 */

import { escapeHtml } from '../../../html/utils';
import type { NameCount } from '../../metrics';
import type { OpsMetrics } from '../../insights';
import type { ErrorRow, HourRow, WindowSummary } from '../../../observability';
import type { BuildTraceRow } from '../../../build-agent/trace-store';
import type { TraceStep } from '../../../build-agent/trace';
import { barChart, card, distribution, fmt, fmtEpoch, fmtIso, money, stat, stat2 } from '../components';

const OUTCOME_CLASS: Record<string, string> = { published: 'sa-pos', previewed: 'sa-muted', gave_up: 'sa-neg', failed: 'sa-neg', truncated: 'sa-neg' };

function stepLine(s: TraceStep): string {
  switch (s.k) {
    case 'turn': return `model call ${s.n}: ${fmt(s.in)} in / ${fmt(s.out)} out, stopped: ${s.stop}`;
    case 'tool': return `tool ${s.name}: ${s.ok === null ? 'no result' : s.ok ? 'ok' : 'error'}`;
    case 'check': return `static check: ${s.errors} error${s.errors === 1 ? '' : 's'}`;
    case 'verify': return `page test: ${s.status}, ${s.errors} error${s.errors === 1 ? '' : 's'}`;
    case 'publish': return `publish${s.draft ? ' (private draft)' : ''}: ${s.ok ? 'ok' : 'refused'}`;
    case 'note': return s.text;
    case 'dropped': return `… ${s.count} more steps not stored`;
  }
}

function buildDetail(b: BuildTraceRow): string {
  const facts = [
    `path ${b.path === 'agent' ? 'agent' : 'one-shot'}`,
    `source ${b.source ?? '—'}`,
    `model ${b.model ?? '—'}${b.effort ? ` (effort ${b.effort})` : ''}`,
    `${b.turns} model calls`,
    `${b.tool_calls} tool calls (${b.tool_errors} errors)`,
    `${b.check_rounds} failed check rounds`,
    b.verify_status ? `page test ${b.verify_status}` : '',
    b.artifact_id ? `artifact ${b.artifact_id}${b.version_no ? ` v${b.version_no}` : ''}` : '',
    `build ${b.id}`,
  ].filter(Boolean);
  const err = b.error_code || b.error_message
    ? `<p class="sa-neg" style="font-size:12px">${escapeHtml([b.error_code, b.error_message].filter(Boolean).join(': '))}</p>`
    : '';
  return `<details><summary class="sa-muted" style="cursor:pointer">steps</summary>
    <p class="sa-muted" style="font-size:12px">${escapeHtml(facts.join(' · '))}</p>${err}
    <ol style="font-size:12px;margin:4px 0 0 18px">${b.steps.map((s) => `<li>${escapeHtml(stepLine(s))}</li>`).join('')}</ol></details>`;
}

/** Recent AI page builds, each expandable to its steps. Platform admins only (the Health view's callers gate it). */
export function buildsTable(builds: BuildTraceRow[]): string {
  if (!builds.length) return `<div class="sa-empty">No page builds recorded yet.</div>`;
  return `<table class="sa-table"><thead><tr><th>When</th><th>Outcome</th><th>Workspace</th><th>Path</th><th>Duration</th><th>Tokens in / out</th><th>Cost</th><th>Detail</th></tr></thead><tbody>${builds
    .map(
      (b) => `<tr>
        <td class="sa-muted" title="${escapeHtml(b.started_at)}">${escapeHtml(fmtIso(b.started_at))}</td>
        <td><span class="${OUTCOME_CLASS[b.outcome] ?? 'sa-muted'}">${escapeHtml(b.outcome)}</span></td>
        <td title="${escapeHtml(b.workspace_id ?? '')}">${escapeHtml((b.workspace_name ?? (b.workspace_id ? b.workspace_id : 'personal')).slice(0, 32))}</td>
        <td class="sa-muted">${b.path === 'agent' ? 'agent' : 'one-shot'}</td>
        <td class="sa-muted">${(b.duration_ms / 1000).toFixed(1)}s</td>
        <td class="sa-muted">${fmt(b.input_tokens)} / ${fmt(b.output_tokens)}</td>
        <td class="sa-muted">${b.cost_micro_usd ? money(b.cost_micro_usd / 1e6) : '—'}</td>
        <td>${buildDetail(b)}</td>
      </tr>`
    )
    .join('')}</tbody></table>`;
}

export function healthBody(
  w24: WindowSummary,
  w1: WindowSummary,
  series: HourRow[],
  errors: ErrorRow[],
  builds: BuildTraceRow[] = [],
): string {
  const errClass = w24.status5xx + w24.exceptions > 0 ? 'sa-neg' : 'sa-pos';
  const reqChart = barChart(series.map((r) => ({ date: `${r.hour.slice(11)}:00`, value: r.requests })));
  const errChart = barChart(series.map((r) => ({ date: `${r.hour.slice(11)}:00`, value: r.status_5xx + r.exceptions })));

  // Status mix + latency histogram summed over the loaded window (48h).
  const sum = (f: (r: HourRow) => number) => series.reduce((a, r) => a + f(r), 0);
  const statusMix: NameCount[] = [
    { name: '2xx OK', count: sum((r) => r.status_2xx) },
    { name: '3xx redirect', count: sum((r) => r.status_3xx) },
    { name: '4xx client', count: sum((r) => r.status_4xx) },
    { name: '5xx server', count: sum((r) => r.status_5xx) },
  ];
  const latencyMix: NameCount[] = [
    { name: '≤100ms', count: sum((r) => r.b_le_100) },
    { name: '100–300ms', count: sum((r) => r.b_le_300) },
    { name: '300ms–1s', count: sum((r) => r.b_le_1000) },
    { name: '1–3s', count: sum((r) => r.b_le_3000) },
    { name: '>3s', count: sum((r) => r.b_gt_3000) },
  ];

  const errorsTable = errors.length
    ? `<table class="sa-table"><thead><tr><th>When</th><th>Status</th><th>Method</th><th>Path</th><th>Detail</th></tr></thead><tbody>${errors
        .map(
          (e) => `<tr>
            <td class="sa-muted" title="${escapeHtml(e.created_at)}">${escapeHtml(fmtIso(e.created_at))}</td>
            <td><span class="${e.status >= 500 ? 'sa-neg' : 'sa-muted'}">${e.status}</span> ${e.outcome === 'exception' ? '💥' : ''}</td>
            <td class="sa-muted">${escapeHtml(e.method || '—')}</td>
            <td title="${escapeHtml(e.path || e.route || '')}">${escapeHtml((e.path || e.route || '—').slice(0, 48))}</td>
            <td class="sa-muted" title="${escapeHtml((e.message || '') + (e.request_id ? ` · ray ${e.request_id}` : ''))}">${escapeHtml((e.message || (e.request_id ? `ray ${e.request_id}` : '—')).slice(0, 60))}</td>
          </tr>`
        )
        .join('')}</tbody></table>`
    : `<div class="sa-empty">No server errors logged. 🎉</div>`;

  return `
    <div class="sa-stats">
      ${stat(w24.requests, 'Requests (24h)', `${fmt(w1.requests)} in last hour`)}
      ${stat2(`<span class="${errClass}">${w24.errorRatePct.toFixed(2)}%</span>`, 'Error rate (24h)', `${w24.status5xx} 5xx · ${w24.exceptions} exc`)}
      ${stat(w24.status4xx, '4xx (24h)', 'client errors')}
      ${stat2(`${Math.round(w24.avgMs)}<span class="sa-muted" style="font-size:14px">ms</span>`, 'Avg latency (24h)', `${w24.maxMs}ms max`)}
      ${stat2(`${w24.pctUnder300.toFixed(0)}%`, 'Fast (<300ms)', `${w24.pctOver1s.toFixed(0)}% over 1s`)}
    </div>
    <div class="sa-grid" style="margin-top:var(--space-4)">
      ${card('Requests per hour (48h)', reqChart)}
      ${card('Errors per hour — 5xx + exceptions (48h)', errChart)}
    </div>
    <div class="sa-grid" style="margin-top:var(--space-4)">
      ${card('Status mix (48h)', distribution(statusMix))}
      ${card('Latency distribution (48h)', distribution(latencyMix))}
    </div>
    <div class="sa-grid-3" style="margin-top:var(--space-4)">
      ${card('Errors', `<p class="sa-muted" style="font-size:12px">5xx responses and unhandled exceptions are recorded here and in the Worker logs. No out-of-band alerting — this page is the surface.</p>`)}
      ${card('Live logs', `<p class="sa-muted" style="font-size:12px;line-height:1.6">Stream live: <code>wrangler tail shareout --format json</code><br>Or Cloudflare Dashboard → Workers → shareout → Logs.</p>`)}
    </div>
    <div style="margin-top:var(--space-4)">
      ${card('Page builds (latest 25, kept 90 days)', buildsTable(builds))}
    </div>
    <div style="margin-top:var(--space-4)">
      ${card('Recent server errors (7-day log)', errorsTable)}
    </div>`;
}

export function opsBody(o: OpsMetrics): string {
  const failures = o.recentFailures.length
    ? `<table class="sa-table"><thead><tr><th>Artifact</th><th>Action</th><th>Error</th><th>When</th></tr></thead><tbody>${o.recentFailures
        .map(
          (f) =>
            `<tr><td>${escapeHtml(f.artifact)}</td><td class="sa-muted">${escapeHtml(f.action)}</td><td class="sa-muted" title="${escapeHtml(f.error)}">${escapeHtml(f.error.slice(0, 80))}</td><td class="sa-muted">${f.when ? fmtEpoch(f.when) : '—'}</td></tr>`
        )
        .join('')}</tbody></table>`
    : `<div class="sa-empty">No failing jobs.</div>`;
  return `
    <div class="sa-stats" style="margin-bottom:var(--space-4)">
      ${stat(o.totalJobs, 'Scheduled jobs')}
      ${stat(o.enabledJobs, 'Enabled')}
      ${stat(o.failingJobs, 'Failing')}
    </div>
    ${card('Recent job failures', failures)}`;
}
