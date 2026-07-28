/**
 * Admin list views: users, artifact moderation, and audit log.
 */

import { escapeHtml } from '../../../html/utils';
import type { AdminAuditRow } from '../../../audit';
import type { ModerationQueueRow } from '../../artifacts-admin';
import type { UserRow } from '../../users';
import { card, fmt, fmtDate } from '../components';
import { userRow } from '../rows';

export function usersBody(d: { users: UserRow[]; total: number }): string {
  return `
    <div class="sa-toolbar">
      <input id="sa-user-search" class="so-c-input" type="search" placeholder="Search users by email or name…" autocomplete="off">
      <span class="sa-muted" id="sa-user-count">${fmt(d.total)} users</span>
    </div>
    <div class="sa-card" style="padding:0;overflow:auto">
      <table class="sa-table">
        <thead><tr><th>User</th><th>Tier</th><th>Artifacts</th><th>Workspaces</th><th>Last login</th><th>Actions</th></tr></thead>
        <tbody id="sa-users">${d.users.map(userRow).join('')}</tbody>
      </table>
    </div>`;
}

export function moderationBody(rows: ModerationQueueRow[]): string {
  if (!rows.length) {
    return `<div class="sa-card"><div class="sa-empty">Moderation queue is empty — nothing pending or blocked.</div></div>`;
  }
  const body = rows
    .map((r) => {
      const badge = r.moderation_status === 'blocked'
        ? '<span class="so-c-badge so-c-badge--error">blocked</span>'
        : '<span class="so-c-badge so-c-badge--warning">pending</span>';
      return `<tr data-id="${escapeHtml(r.id)}">
        <td><a href="/a/${escapeHtml(r.slug)}/" style="color:var(--color-primary)">${escapeHtml(r.name || r.slug)}</a><div class="sa-muted" style="font-size:12px">${escapeHtml(r.id)}</div></td>
        <td class="sa-muted">${escapeHtml(r.workspace || '—')}</td>
        <td>${badge}</td>
        <td class="sa-muted">${escapeHtml(r.moderation_reason || '—')}</td>
        <td class="sa-muted">${escapeHtml(fmtDate(r.moderation_checked_at))}</td>
        <td><div class="sa-actions">
          <button class="so-c-btn so-c-btn--secondary so-c-btn--sm" onclick="saModerate('${escapeHtml(r.id)}', 'approve')">Approve</button>
          <button class="so-c-btn so-c-btn--danger-outline so-c-btn--sm" onclick="saModerate('${escapeHtml(r.id)}', 'block')">Block</button>
        </div></td>
      </tr>`;
    })
    .join('');
  return `
    <div class="sa-card" style="padding:0;overflow:auto">
      <table class="sa-table">
        <thead><tr><th>Artifact</th><th>Workspace</th><th>Status</th><th>Reason</th><th>Checked</th><th>Actions</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

export function auditBody(rows: AdminAuditRow[]): string {
  if (!rows.length) {
    return `<div class="sa-card"><div class="sa-empty">No audit entries yet.</div></div>`;
  }
  const body = rows
    .map((r) => {
      const ws = r.workspace_slug
        ? `<a href="/@${escapeHtml(r.workspace_slug)}" style="color:var(--color-primary)">${escapeHtml(r.workspace_name || r.workspace_slug)}</a>`
        : '<span class="sa-muted">—</span>';
      const target = [r.target_type, r.target_id].filter(Boolean).join(':');
      const detail = r.detail ? escapeHtml(r.detail) : '';
      return `<tr>
        <td class="sa-muted">${escapeHtml(fmtDate(r.created_at))}</td>
        <td>${ws}</td>
        <td class="sa-muted">${escapeHtml(r.actor_email || r.actor_id || '—')}</td>
        <td><code>${escapeHtml(r.action)}</code></td>
        <td class="sa-muted">${escapeHtml(target || '—')}${detail ? `<div class="sa-muted" style="font-size:11px">${detail}</div>` : ''}</td>
      </tr>`;
    })
    .join('');
  return `
    <div class="sa-card" style="padding:0;overflow:auto">
      <table class="sa-table">
        <thead><tr><th>When</th><th>Workspace</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}
