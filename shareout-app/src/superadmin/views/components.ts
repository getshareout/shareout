/**
 * Shared HTML building blocks for superadmin dashboard views.
 *
 * Pure string renderers — no I/O. Used by every view body module.
 */

import { escapeHtml } from '../../html/utils';
import type { DayPoint, Delta, NameCount } from '../metrics';

/** Card wrapper with an escaped title. */
export function card(title: string, inner: string): string {
  return `<div class="sa-card"><h3>${escapeHtml(title)}</h3>${inner}</div>`;
}

/** Stat tile with a numeric value (locale-formatted). */
export function stat(value: number, label: string, sub?: string): string {
  return `<div class="sa-stat">
    <div class="sa-stat-value">${fmt(value)}</div>
    <div class="sa-stat-label">${escapeHtml(label)}</div>
    ${sub ? `<div class="sa-stat-sub">${sub}</div>` : ''}
  </div>`;
}

/** Stat tile whose value is pre-rendered HTML (e.g. a colored delta). */
export function stat2(valueHtml: string, label: string, sub?: string): string {
  return `<div class="sa-stat">
    <div class="sa-stat-value">${valueHtml}</div>
    <div class="sa-stat-label">${escapeHtml(label)}</div>
    ${sub ? `<div class="sa-stat-sub">${escapeHtml(sub)}</div>` : ''}
  </div>`;
}

/** Period-over-period delta with ▲/▼ styling. */
export function deltaText(d: Delta, noun = ''): string {
  const prefix = noun ? `${fmt(d.value)} ${noun} · ` : '';
  if (d.pct === null) return `${prefix}new`;
  const arrow = d.pct > 0 ? '▲' : d.pct < 0 ? '▼' : '·';
  const cls = d.pct > 0 ? 'sa-pos' : d.pct < 0 ? 'sa-neg' : 'sa-muted';
  return `${prefix}<span class="${cls}">${arrow} ${Math.abs(d.pct).toFixed(0)}%</span>`;
}

/** Locale-formatted integer (en-US grouping). */
export function fmt(n: number): string {
  return (n || 0).toLocaleString('en-US');
}

/** Human-readable byte size (1024-based). */
export function bytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Signed USD: negative renders as -$X.XX (not $-X.XX). */
export function money(n: number): string {
  return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
}

/** Margin percentage with positive/negative coloring. */
export function marginText(pct: number | null): string {
  if (pct === null) return 'no revenue';
  const cls = pct >= 0 ? 'sa-pos' : 'sa-neg';
  return `<span class="${cls}">${pct.toFixed(0)}% margin</span>`;
}

/** Vertical bar chart for daily time series. */
export function barChart(points: DayPoint[]): string {
  if (!points.length) return `<div class="sa-chart-empty">No data yet.</div>`;
  const max = Math.max(...points.map((p) => p.value), 1);
  const bars = points
    .map((p) => {
      const h = Math.max((p.value / max) * 100, 2);
      return `<div class="sa-chart-bar" style="height:${h}%" title="${escapeHtml(p.date)}: ${fmt(p.value)}"></div>`;
    })
    .join('');
  return `<div class="sa-chart">${bars}</div>`;
}

/** Horizontal bar distribution (counts). */
export function distribution(items: NameCount[]): string {
  if (!items.length) return `<div class="sa-empty">No data yet.</div>`;
  const max = Math.max(...items.map((i) => i.count), 1);
  const rows = items
    .map(
      (i) => `<li>
        <span class="sa-bar-label" title="${escapeHtml(i.name)}">${escapeHtml(i.name)}</span>
        <span class="sa-bar-track"><span class="sa-bar-fill" style="width:${(i.count / max) * 100}%"></span></span>
        <span class="sa-bar-count">${fmt(i.count)}</span>
      </li>`
    )
    .join('');
  return `<ul class="sa-bars">${rows}</ul>`;
}

/** Horizontal bar distribution (byte sizes). */
export function bytesDistribution(items: NameCount[]): string {
  if (!items.length) return `<div class="sa-empty">No data yet.</div>`;
  const max = Math.max(...items.map((i) => i.count), 1);
  const rows = items
    .map(
      (i) => `<li>
        <span class="sa-bar-label" title="${escapeHtml(i.name)}">${escapeHtml(i.name)}</span>
        <span class="sa-bar-track"><span class="sa-bar-fill" style="width:${(i.count / max) * 100}%"></span></span>
        <span class="sa-bar-count">${bytes(i.count)}</span>
      </li>`
    )
    .join('');
  return `<ul class="sa-bars">${rows}</ul>`;
}

/** Infra cost table row. */
export function costRow(label: string, detail: string, cost: number): string {
  return `<tr><td>${escapeHtml(label)}<div class="sa-muted" style="font-size:12px">${escapeHtml(detail)}</div></td><td class="sa-num">$${cost.toFixed(2)}</td></tr>`;
}

/** ISO timestamp → MM-DD HH:mm (UTC). */
export function fmtIso(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** DB date string → short locale date. */
export function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s.includes('T') || s.includes(' ') ? s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z') : s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Unix epoch seconds → short locale datetime. */
export function fmtEpoch(secs: number): string {
  return new Date(secs * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
