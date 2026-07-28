import { escapeHtml } from '../../../html/utils';
import type { StorageSnapshotRow } from '../../../storage-snapshots';
import { card, bytes, fmt, stat2 } from '../components';

function row(s: StorageSnapshotRow): string {
  const over = s.overage_bytes > 0;
  return `<tr>
    <td><a href="/@${escapeHtml(s.workspace_slug)}" style="color:var(--color-primary)">${escapeHtml(s.workspace_name)}</a>
      <div class="sa-muted" style="font-size:11px">${escapeHtml(s.snapshot_date)}</div></td>
    <td class="sa-num">${bytes(s.bytes)}</td>
    <td class="sa-num">${s.max_bytes > 0 ? bytes(s.max_bytes) : '—'}</td>
    <td class="sa-num">${over ? bytes(s.overage_bytes) : '—'}</td>
  </tr>`;
}

export function storageBody(top: StorageSnapshotRow[], overCap: StorageSnapshotRow[]): string {
  const totalBytes = top.reduce((n, s) => n + s.bytes, 0);
  const topRows = top.length
    ? top.map(row).join('')
    : '<tr><td colspan="4" class="sa-muted">No snapshots yet — the daily job runs at 12:00 UTC.</td></tr>';
  const overRows = overCap.length
    ? overCap.map(row).join('')
    : '<tr><td colspan="4" class="sa-muted">Nobody over the instance storage cap today.</td></tr>';

  return `
    <div class="sa-stats">
      ${stat2(fmt(top.length), 'Workspaces snapshotted')}
      ${stat2(bytes(totalBytes), 'Stored (top workspaces)')}
      ${stat2(fmt(overCap.length), 'Over the cap')}
    </div>
    <p class="sa-muted" style="margin:var(--space-3) 0 var(--space-4)">
      Writes are hard-capped at <code>STORAGE_QUOTA_BYTES</code> (unset = unlimited). Snapshots are daily UTC.
    </p>
    ${card('Over the cap (today)', `<table class="sa-table">
      <thead><tr><th>Workspace</th><th class="sa-num">Used</th><th class="sa-num">Cap</th><th class="sa-num">Over</th></tr></thead>
      <tbody>${overRows}</tbody>
    </table>`)}
    <div style="margin-top:var(--space-4)">
      ${card('Top workspaces by stored bytes', `<table class="sa-table">
        <thead><tr><th>Workspace</th><th class="sa-num">Used</th><th class="sa-num">Cap</th><th class="sa-num">Over</th></tr></thead>
        <tbody>${topRows}</tbody>
      </table>`)}
    </div>`;
}
