/**
 * Reusable data tables for platform metrics views.
 */

import { escapeHtml } from '../../html/utils';
import type { PlatformMetrics } from '../metrics';
import { bytes, fmt, fmtDate } from './components';

export function topArtifactsTable(items: PlatformMetrics['artifacts']['topByViews']): string {
  if (!items.length) return `<div class="sa-empty">No views yet.</div>`;
  const rows = items
    .map(
      (a) => `<tr>
        <td><a href="/a/${escapeHtml(a.slug)}/" style="color:var(--color-primary)">${escapeHtml(a.name || a.slug)}</a></td>
        <td class="sa-muted">${escapeHtml(a.type)}</td>
        <td class="sa-num">${fmt(a.views)}</td>
      </tr>`
    )
    .join('');
  return `<table class="sa-table"><thead><tr><th>Name</th><th>Type</th><th class="sa-num">Views</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function recentTable(items: PlatformMetrics['artifacts']['recent']): string {
  if (!items.length) return `<div class="sa-empty">No artifacts yet.</div>`;
  const rows = items
    .map(
      (a) => `<tr>
        <td><a href="/a/${escapeHtml(a.slug)}/" style="color:var(--color-primary)">${escapeHtml(a.name || a.slug)}</a></td>
        <td class="sa-muted">${escapeHtml(a.owner)}</td>
        <td class="sa-muted">${escapeHtml(fmtDate(a.createdAt))}</td>
      </tr>`
    )
    .join('');
  return `<table class="sa-table"><thead><tr><th>Name</th><th>Owner</th><th>Created</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function tokenWorkspacesTable(items: PlatformMetrics['tokens']['topWorkspaces']): string {
  if (!items.length) return `<div class="sa-empty">No usage yet.</div>`;
  const rows = items
    .map(
      (w) => `<tr><td>${escapeHtml(w.name)}</td><td class="sa-num">${fmt(w.tokens)}</td><td class="sa-num">$${w.costUsd.toFixed(2)}</td></tr>`
    )
    .join('');
  return `<table class="sa-table"><thead><tr><th>Workspace</th><th class="sa-num">Tokens</th><th class="sa-num">Cost</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function modelTable(items: PlatformMetrics['tokens']['byModel']): string {
  if (!items.length) return `<div class="sa-empty">No usage yet.</div>`;
  const rows = items
    .map(
      (m) => `<tr><td>${escapeHtml(m.model)}</td><td class="sa-num">${fmt(m.inputTokens)}</td><td class="sa-num">${fmt(m.outputTokens)}</td><td class="sa-num">$${m.costUsd.toFixed(2)}</td></tr>`
    )
    .join('');
  return `<table class="sa-table"><thead><tr><th>Model</th><th class="sa-num">Input</th><th class="sa-num">Output</th><th class="sa-num">Cost</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** Largest artifacts by stored bytes (storage view). */
export function largestArtifactsTable(
  items: { slug: string; name: string | null; bytes: number }[]
): string {
  if (!items.length) return `<div class="sa-empty">No stored files yet.</div>`;
  return `<table class="sa-table"><tbody>${items
    .map(
      (a) =>
        `<tr><td><a href="/a/${escapeHtml(a.slug)}/" style="color:var(--color-primary)">${escapeHtml(a.name || a.slug)}</a></td><td class="sa-num">${bytes(a.bytes)}</td></tr>`
    )
    .join('')}</tbody></table>`;
}
