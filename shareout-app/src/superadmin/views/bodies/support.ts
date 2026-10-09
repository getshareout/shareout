/**
 * Support view: the instance-wide queue, including channel/email/personal tickets that
 * have no workspace (and so never show in a per-workspace admin tab). Filters run in the
 * browser; a row opens the thread (client-script saTicket) to reply and set status.
 */

import { escapeHtml } from '../../../html/utils';
import { TICKET_CATEGORIES, type Ticket } from '../../../support/store';
import { stat, fmtEpoch } from '../components';

function select(id: string, all: string, values: [string, string][]): string {
  const opts = values.map(([v, label]) => `<option value="${escapeHtml(v)}">${escapeHtml(label)}</option>`).join('');
  return `<select id="${id}" class="so-c-select"><option value="">${escapeHtml(all)}</option>${opts}</select>`;
}

export function supportBody(tickets: Ticket[]): string {
  const count = (s: string) => tickets.filter((t) => t.status === s).length;
  const stats = `<div class="sa-grid sa-grid-3">
    ${stat(tickets.length, 'Tickets (latest 200)')}
    ${stat(count('open'), 'Open')}
    ${stat(count('pending'), 'Pending')}
  </div>`;

  if (!tickets.length) {
    return stats + `<div class="sa-card"><div class="sa-muted">No support tickets yet.</div></div>`;
  }

  const workspaces = [...new Set(tickets.map((t) => t.workspace_id).filter((w): w is string => !!w))];
  const filters = `<div class="sa-card" style="display:flex;gap:8px;flex-wrap:wrap">
    ${select('sa-sup-status', 'All statuses', ['open', 'pending', 'resolved', 'closed'].map((s) => [s, s]))}
    ${select('sa-sup-category', 'All categories', TICKET_CATEGORIES.map((c) => [c, c]))}
    ${select('sa-sup-ws', 'All workspaces', [['none', 'No workspace'], ...workspaces.map((w): [string, string] => [w, w])])}
  </div>`;

  const rows = tickets.map((t) => {
    const scope = t.workspace_id ? escapeHtml(t.workspace_id) : '<span class="sa-muted">personal / email</span>';
    const via = t.client && t.client !== t.channel ? `${t.channel} · ${t.client}` : t.channel;
    const kind = [t.category, t.severity].filter(Boolean).join(' · ') || '—';
    return `<tr data-sup-row data-status="${escapeHtml(t.status)}" data-category="${escapeHtml(t.category || '')}" data-ws="${escapeHtml(t.workspace_id || 'none')}" onclick="saTicket('${escapeHtml(t.id)}')" style="cursor:pointer">
      <td>${escapeHtml(t.subject)}</td>
      <td class="sa-muted">${escapeHtml(t.requester_email || '—')}</td>
      <td>${escapeHtml(via)}</td>
      <td>${escapeHtml(kind)}</td>
      <td>${scope}</td>
      <td>${escapeHtml(t.priority || '—')}</td>
      <td><span class="sa-pill">${escapeHtml(t.status)}</span></td>
      <td class="sa-muted">${fmtEpoch(Math.floor(Date.parse(t.last_msg_at) / 1000))}</td>
    </tr>`;
  }).join('');

  return stats + filters + `
    <div class="sa-card" style="padding:0;overflow:auto">
      <table class="sa-table">
        <thead><tr><th>Subject</th><th>Requester</th><th>Channel</th><th>Category</th><th>Workspace</th><th>Priority</th><th>Status</th><th>Last msg</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="sa-muted" style="margin-top:10px">Open a ticket to read its thread and context, reply and change its status. A reply goes out on the ticket's channel and lands in the requester's bell; in-app and API requesters also get it by email. Agents holding an instance-admin personal token work the same queue through <code>GET /v1/support/tickets?scope=all</code>.</p>`;
}
