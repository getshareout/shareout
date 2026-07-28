/**
 * Table row renderers for live-search admin lists (users, artifacts).
 *
 * Exported for reuse by the REST API (`/v1/admin/users`, `/v1/admin/artifacts`)
 * which returns pre-rendered HTML rows for client-side search.
 */

import { escapeHtml } from '../../html/utils';
import type { AdminArtifactRow } from '../artifacts-admin';
import type { UserRow } from '../users';
import { fmt, fmtDate } from './components';

export function userRow(u: UserRow): string {
  const tiers = ['free', 'team'];
  const tierOptions = tiers
    .map((t) => `<option value="${t}"${t === u.tier ? ' selected' : ''}>${t}</option>`)
    .join('');
  const name = u.name ? escapeHtml(u.name) : '<span class="sa-muted">—</span>';
  const email = u.email ? escapeHtml(u.email) : '<span class="sa-muted">(no email)</span>';
  const disabledBadge = u.disabled ? ' <span class="so-c-badge so-c-badge--error">disabled</span>' : '';
  const personalTeam = u.tier === 'team' || u.tier === 'enterprise';
  const teamViaWorkspace =
    !personalTeam && u.inTeamWorkspace === 1
      ? ' <span class="so-c-badge so-c-badge--primary" title="Covered by a team workspace they belong to">Team · via workspace</span>'
      : '';
  return `<tr data-id="${escapeHtml(u.id)}">
    <td><div>${email}${disabledBadge}</div><div class="sa-muted" style="font-size:12px">${name}</div></td>
    <td><select class="so-c-select" onchange="saTier('${escapeHtml(u.id)}', this.value)">${tierOptions}</select>${teamViaWorkspace}</td>
    <td class="sa-num">${fmt(u.artifactCount)}</td>
    <td class="sa-num">${fmt(u.workspaceCount)}</td>
    <td class="sa-muted">${escapeHtml(fmtDate(u.lastLoginAt))}</td>
    <td><div class="sa-actions">
      <button class="so-c-btn so-c-btn--secondary so-c-btn--sm" onclick="saView('${escapeHtml(u.id)}')">View</button>
      <button class="so-c-btn so-c-btn--secondary so-c-btn--sm" onclick="saRevoke('${escapeHtml(u.id)}', ${u.disabled ? 0 : 1})">${u.disabled ? 'Enable' : 'Disable'}</button>
      <button class="so-c-btn so-c-btn--danger-outline so-c-btn--sm" onclick="saDelete('${escapeHtml(u.id)}', '${escapeHtml(u.email || u.id)}')">Delete</button>
    </div></td>
  </tr>`;
}

export function artifactRow(a: AdminArtifactRow): string {
  const vis = ['public', 'workspace', 'private'];
  const visOptions = vis
    .map((v) => `<option value="${v}"${v === a.visibility ? ' selected' : ''}>${v}</option>`)
    .join('');
  const status = a.paused
    ? '<span class="so-c-badge so-c-badge--error">paused</span>'
    : '<span class="so-c-badge so-c-badge--primary">live</span>';
  return `<tr data-id="${escapeHtml(a.id)}">
    <td><a href="/a/${escapeHtml(a.slug)}/" style="color:var(--color-primary)">${escapeHtml(a.name || a.slug)}</a><div class="sa-muted" style="font-size:12px">${escapeHtml(a.type)}</div></td>
    <td class="sa-muted">${escapeHtml(a.owner)}</td>
    <td><select class="so-c-select" onchange="saVisibility('${escapeHtml(a.id)}', this.value)">${visOptions}</select></td>
    <td class="sa-num">${fmt(a.views)}</td>
    <td>${status}</td>
    <td><div class="sa-actions">
      <button class="so-c-btn so-c-btn--secondary so-c-btn--sm" onclick="saPause('${escapeHtml(a.id)}', ${a.paused ? 0 : 1})">${a.paused ? 'Unpause' : 'Pause'}</button>
      <button class="so-c-btn so-c-btn--danger-outline so-c-btn--sm" onclick="saDeleteArtifact('${escapeHtml(a.id)}', '${escapeHtml(a.name || a.slug)}')">Delete</button>
    </div></td>
  </tr>`;
}
