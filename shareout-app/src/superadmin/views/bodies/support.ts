/**
 * Support view: every ticket across the platform, including channel/email tickets
 * that have no workspace (and so never show in a per-workspace admin tab).
 */

import { escapeHtml } from '../../../html/utils';
import type { Ticket } from '../../../support/store';
import { stat, fmtEpoch } from '../components';

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

  const rows = tickets.map((t) => {
    const scope = t.workspace_id ? escapeHtml(t.workspace_id) : '<span class="sa-muted">personal / email</span>';
    return `<tr>
      <td>${escapeHtml(t.subject)}</td>
      <td class="sa-muted">${escapeHtml(t.requester_email || '—')}</td>
      <td>${escapeHtml(t.channel)}</td>
      <td>${scope}</td>
      <td>${escapeHtml(t.priority || '—')}</td>
      <td><span class="sa-pill">${escapeHtml(t.status)}</span></td>
      <td class="sa-muted">${fmtEpoch(Math.floor(Date.parse(t.last_msg_at) / 1000))}</td>
    </tr>`;
  }).join('');

  return stats + `
    <div class="sa-card" style="padding:0;overflow:auto">
      <table class="sa-table">
        <thead><tr><th>Subject</th><th>Requester</th><th>Channel</th><th>Workspace</th><th>Priority</th><th>Status</th><th>Last msg</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="sa-muted" style="margin-top:10px">Workspace tickets are answered from that workspace's <strong>Admin → Support</strong> tab; personal/email tickets are answered from the Telegram cockpit. Every new ticket also pings the super-admin Telegram.</p>`;
}
