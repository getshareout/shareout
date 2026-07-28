/**
 * Public platform status page (work/039 B15).
 * No auth — fed from self-hosted health_metrics_hourly (exact request telemetry).
 * Metrics are platform-wide (one histogram for serve+API+data); we don't fake
 * per-surface splits without a surface column in the store.
 */
import type { Env } from '../types';
import { renderHtmlPage } from '../design-system/shell';
import { brandLockupHtml } from '../brand';
import { getWindowSummary, getDailyHealth, type DayHealth, type WindowSummary } from '../observability/store';
import { escapeHtml } from '../html/utils';

const STYLES = `
.st-wrap { max-width: 52rem; margin: 0 auto; padding: var(--space-10) var(--space-6) var(--space-12); display: flex; flex-direction: column; gap: var(--space-8); }
.st-brand { margin-bottom: var(--space-2); }
.st-kicker { font-family: var(--font-body); font-weight: 600; font-size: 0.82rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-primary); }
.st-h1 { font-family: var(--font-display); font-weight: 800; font-size: clamp(1.8rem, 4vw, 2.4rem); line-height: 1.15; letter-spacing: -0.03em; color: var(--color-text); margin: 0; }
.st-lead { font-size: 1.05rem; line-height: 1.6; color: var(--color-text-secondary); margin: 0; }
.st-banner { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-4) var(--space-5); border-radius: var(--radius-lg); border: 1px solid var(--color-border); background: var(--color-surface); }
.st-banner.is-ok { border-color: color-mix(in srgb, var(--color-success, #16a34a) 40%, var(--color-border)); }
.st-banner.is-degraded { border-color: color-mix(in srgb, #ca8a04 45%, var(--color-border)); }
.st-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; background: #16a34a; }
.st-banner.is-degraded .st-dot { background: #ca8a04; }
.st-banner-title { font-weight: 700; font-size: 1.05rem; color: var(--color-text); margin: 0; }
.st-banner-sub { font-size: 0.92rem; color: var(--color-text-secondary); margin: 2px 0 0; }
.st-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: var(--space-3); }
.st-card { padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg-elevated, var(--color-surface)); }
.st-card-label { font-size: 0.78rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--color-text-secondary); margin: 0 0 var(--space-2); }
.st-card-val { font-family: var(--font-display); font-weight: 800; font-size: 1.55rem; font-variant-numeric: tabular-nums; color: var(--color-text); margin: 0; letter-spacing: -0.02em; }
.st-card-note { font-size: 0.85rem; color: var(--color-text-secondary); margin: 4px 0 0; }
.st-h2 { font-family: var(--font-display); font-weight: 700; font-size: 1.2rem; color: var(--color-text); margin: 0 0 var(--space-3); }
.st-table-wrap { overflow-x: auto; border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
.st-table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
.st-table th, .st-table td { padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--color-border); font-variant-numeric: tabular-nums; }
.st-table th { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-secondary); background: var(--color-surface); }
.st-table tr:last-child td { border-bottom: none; }
.st-ok { color: #15803d; font-weight: 600; }
.st-warn { color: #a16207; font-weight: 600; }
.st-foot { font-size: 0.9rem; color: var(--color-text-secondary); margin: 0; line-height: 1.55; }
.st-foot a { color: var(--color-primary); }
`;

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(n >= 99.95 ? 3 : 2)}%`;
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function overallFromDays(days: DayHealth[]): { uptimePct: number; requests: number; degradedDays: number } {
  let requests = 0;
  let bad = 0;
  let degradedDays = 0;
  for (const d of days) {
    requests += d.requests;
    bad += d.status5xx + d.exceptions;
    if (d.uptimePct < 99.5 && d.requests > 0) degradedDays++;
  }
  const uptimePct = requests > 0 ? Math.max(0, Math.min(100, ((requests - bad) / requests) * 100)) : 100;
  return { uptimePct, requests, degradedDays };
}

function windowCard(label: string, w: WindowSummary): string {
  const uptime = w.requests > 0
    ? Math.max(0, Math.min(100, ((w.requests - w.status5xx - w.exceptions) / w.requests) * 100))
    : 100;
  return `<div class="st-card">
    <p class="st-card-label">${escapeHtml(label)}</p>
    <p class="st-card-val">${fmtPct(uptime)}</p>
    <p class="st-card-note">${fmtInt(w.requests)} req · ${fmtInt(w.status5xx + w.exceptions)} errors</p>
  </div>`;
}

function dayRows(days: DayHealth[]): string {
  const recent = days.slice(-30).reverse(); // newest first, last 30 shown
  if (!recent.length) {
    return `<tr><td colspan="4">No traffic recorded in this window yet.</td></tr>`;
  }
  return recent
    .map((d) => {
      const cls = d.uptimePct >= 99.5 ? 'st-ok' : 'st-warn';
      return `<tr>
        <td>${escapeHtml(d.day)}</td>
        <td class="${cls}">${fmtPct(d.uptimePct)}</td>
        <td>${fmtInt(d.requests)}</td>
        <td>${fmtInt(d.status5xx + d.exceptions)}</td>
      </tr>`;
    })
    .join('');
}

export async function renderStatusPage(env: Env): Promise<Response> {
  const [w24, w7, w30, w90, daily] = await Promise.all([
    getWindowSummary(env, 24),
    getWindowSummary(env, 24 * 7),
    getWindowSummary(env, 24 * 30),
    getWindowSummary(env, 24 * 90),
    getDailyHealth(env, 90),
  ]);

  const overall = overallFromDays(daily);
  const degraded = w24.errorRatePct > 1 || overall.degradedDays > 0;
  const bannerClass = degraded ? 'is-degraded' : 'is-ok';
  const bannerTitle = degraded ? 'Some elevated errors recently' : 'All systems operational';
  const bannerSub = degraded
    ? "We're investigating or recovering. Check the daily history below."
    : 'ShareOut platform (API, data, and page serving) looks healthy.';

  const body = `<main class="st-wrap">
  <div class="st-brand">${brandLockupHtml({ markSize: 28, href: '/' })}</div>
  <div>
    <div class="st-kicker">Status</div>
    <h1 class="st-h1">ShareOut platform status</h1>
    <p class="st-lead">Live uptime from our own request telemetry — not a third-party probe. Numbers update every hour.</p>
  </div>

  <div class="st-banner ${bannerClass}">
    <span class="st-dot" aria-hidden="true"></span>
    <div>
      <p class="st-banner-title">${escapeHtml(bannerTitle)}</p>
      <p class="st-banner-sub">${escapeHtml(bannerSub)}</p>
    </div>
  </div>

  <section>
    <h2 class="st-h2">Uptime</h2>
    <div class="st-cards">
      ${windowCard('Last 24 hours', w24)}
      ${windowCard('Last 7 days', w7)}
      ${windowCard('Last 30 days', w30)}
      ${windowCard('Last 90 days', w90)}
    </div>
  </section>

  <section>
    <h2 class="st-h2">Last 30 days (UTC)</h2>
    <div class="st-table-wrap">
      <table class="st-table">
        <thead><tr><th>Day</th><th>Uptime</th><th>Requests</th><th>Server errors</th></tr></thead>
        <tbody>${dayRows(daily)}</tbody>
      </table>
    </div>
  </section>

  <p class="st-foot">
    Uptime counts successful and client-error responses as up; 5xx responses and unhandled exceptions count against it.
    Metrics cover the whole platform (serving, API, and data paths) in one histogram.
    Need help? Open Help &amp; support from <a href="/home">Home</a>, or email us.
  </p>
</main>`;

  return renderHtmlPage({
    title: 'Status · ShareOut',
    description: 'ShareOut platform uptime and health — last 90 days of request telemetry.',
    pageStyles: STYLES,
    body,
    cacheControl: 'public, max-age=120',
  });
}
