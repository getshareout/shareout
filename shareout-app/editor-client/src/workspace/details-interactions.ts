import type { EditorContext } from '../editor/context';
import { escapeHtml } from '../utils';
import { showToast } from '../toast';
import { invalidateCache } from './details-cache';
import { stripEditorAttributes } from '../dom/editor-ids';
import { openEditorApproverPicker } from './approval-picker';

export function setupDetailsPanelInteractions(ctx: EditorContext): void {
  const drawer = ctx.dom.workspaceDrawer;
  if (!drawer) return;

  drawer.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;

    if (target.closest('[data-toggle-section]')) {
      handleSectionToggle(target);
      return;
    }

    if (target.closest('[data-toggle-folder]')) {
      handleFolderToggle(target);
      return;
    }

    if (target.closest('[data-toggle-json]')) {
      await handleJsonKeyToggle(ctx, target);
      return;
    }

    if (target.closest('[data-toggle-table]')) {
      await handleTableToggle(ctx, target);
      return;
    }

    if (target.closest('[data-action="preview"]')) {
      handleBlobPreview(ctx, target);
      return;
    }

    if (target.closest('[data-action="download"]')) {
      handleBlobDownload(ctx, target);
      return;
    }

    if (target.closest('[data-action="copy-url"]')) {
      handleCopyBlobUrl(ctx, target);
      return;
    }

    if (target.closest('.blob-previewable') && !target.closest('.blob-actions')) {
      handleBlobPreview(ctx, target);
      return;
    }

    if (target.closest('.preview-modal-backdrop') || target.closest('.preview-modal-close')) {
      closePreviewModal();
      return;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePreviewModal();
    }
  });
}

function handleSectionToggle(target: HTMLElement): void {
  const section = target.closest('.details-section-expandable');
  if (!section) return;
  section.classList.toggle('details-section-expanded');
}

function handleFolderToggle(target: HTMLElement): void {
  const folder = target.closest('.tree-folder');
  if (!folder) return;
  folder.classList.toggle('tree-folder-expanded');
}

async function handleJsonKeyToggle(ctx: EditorContext, target: HTMLElement): Promise<void> {
  const keyItem = target.closest('.json-key-item') as HTMLElement;
  if (!keyItem) return;

  const key = keyItem.dataset.key;
  const artifactId = keyItem.dataset.artifactId;
  const valueContainer = keyItem.querySelector('.json-key-value') as HTMLElement;
  const statusEl = keyItem.querySelector('.json-key-status') as HTMLElement;
  const codeEl = keyItem.querySelector('.json-value-content code') as HTMLElement;

  if (!valueContainer || !key || !artifactId) return;

  const isExpanded = !valueContainer.hidden;
  if (isExpanded) {
    valueContainer.hidden = true;
    keyItem.classList.remove('json-key-expanded');
    return;
  }

  keyItem.classList.add('json-key-expanded');
  valueContainer.hidden = false;

  if (codeEl.textContent !== 'Loading...') return;

  statusEl.textContent = 'Loading...';

  try {
    const res = await fetch(`${ctx.config.baseUrl}/v1/data/${artifactId}/json/${key}`, {
      credentials: 'include',
    });

    if (!res.ok) {
      throw new Error(`Failed to load: ${res.status}`);
    }

    const result = await res.json();
    const value = result.data?.value ?? result.value;
    const updatedAt = result.data?.updatedAt ?? result.updatedAt;

    codeEl.textContent = JSON.stringify(value, null, 2);
    statusEl.textContent = updatedAt ? `Updated ${formatDate(updatedAt)}` : '';
  } catch (err) {
    codeEl.textContent = `Error loading value: ${err instanceof Error ? err.message : 'Unknown error'}`;
    statusEl.textContent = 'Error';
  }
}

async function handleTableToggle(ctx: EditorContext, target: HTMLElement): Promise<void> {
  const tableItem = target.closest('.table-item') as HTMLElement;
  if (!tableItem) return;

  const tableName = tableItem.dataset.tableName;
  const artifactId = tableItem.dataset.artifactId;
  const previewContainer = tableItem.querySelector('.table-preview') as HTMLElement;

  if (!previewContainer || !tableName || !artifactId) return;

  const isExpanded = !previewContainer.hidden;
  if (isExpanded) {
    previewContainer.hidden = true;
    tableItem.classList.remove('table-expanded');
    return;
  }

  tableItem.classList.add('table-expanded');
  previewContainer.hidden = false;

  const loadingEl = previewContainer.querySelector('.table-preview-loading');
  if (!loadingEl) return;

  try {
    const res = await fetch(`${ctx.config.baseUrl}/v1/data/${artifactId}/tables/${tableName}/query`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 5 }),
    });

    if (!res.ok) {
      throw new Error(`Failed to load: ${res.status}`);
    }

    const result = await res.json();
    const rows = result.data?.rows ?? result.rows ?? [];
    const columns = rows.length > 0 ? Object.keys(rows[0]).filter(c => c !== 'id' && c !== 'createdAt' && c !== 'updatedAt') : [];

    if (rows.length === 0) {
      previewContainer.innerHTML = '<p class="empty-hint">No rows in this table</p>';
      return;
    }

    previewContainer.innerHTML = `
      <div class="table-preview-wrapper">
        <table class="preview-table">
          <thead>
            <tr>
              ${columns.map(col => `<th>${escapeHtml(col)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${rows.slice(0, 5).map((row: Record<string, unknown>) => `
              <tr>
                ${columns.map(col => `<td>${escapeHtml(formatCellValue(row[col]))}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${rows.length > 5 ? `<p class="table-preview-more">Showing 5 of ${result.total ?? rows.length} rows</p>` : ''}
      </div>
    `;
  } catch (err) {
    previewContainer.innerHTML = `<p class="error-hint">Error loading table: ${err instanceof Error ? err.message : 'Unknown error'}</p>`;
  }
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function handleBlobPreview(ctx: EditorContext, target: HTMLElement): void {
  const blobItem = target.closest('.blob-item') as HTMLElement;
  if (!blobItem) return;

  const blobId = blobItem.dataset.blobId;
  const mimeType = blobItem.dataset.mime;
  const artifactId = blobItem.dataset.artifactId;
  const filename = blobItem.querySelector('.blob-filename')?.textContent || 'Preview';

  if (!blobId || !artifactId) return;

  const contentUrl = `${ctx.config.baseUrl}/v1/data/${artifactId}/blobs/${blobId}/content`;
  const modal = document.getElementById('blob-preview-modal');
  const modalTitle = modal?.querySelector('.preview-modal-title');
  const modalBody = modal?.querySelector('.preview-modal-body');

  if (!modal || !modalBody) return;

  if (modalTitle) {
    modalTitle.textContent = filename;
  }

  if (mimeType?.startsWith('image/')) {
    modalBody.innerHTML = `
      <div class="preview-image-container">
        <img src="${contentUrl}" alt="${escapeHtml(filename)}" class="preview-image">
      </div>
    `;
  } else if (mimeType === 'application/pdf') {
    modalBody.innerHTML = `
      <iframe src="${contentUrl}" class="preview-pdf" title="${escapeHtml(filename)}"></iframe>
    `;
  } else if (mimeType?.startsWith('video/')) {
    modalBody.innerHTML = `
      <video controls class="preview-video">
        <source src="${contentUrl}" type="${mimeType}">
        Your browser does not support video playback.
      </video>
    `;
  } else if (mimeType?.startsWith('audio/')) {
    modalBody.innerHTML = `
      <div class="preview-audio-container">
        <audio controls class="preview-audio">
          <source src="${contentUrl}" type="${mimeType}">
          Your browser does not support audio playback.
        </audio>
      </div>
    `;
  } else {
    modalBody.innerHTML = `
      <div class="preview-unsupported">
        <p>Preview not available for this file type.</p>
        <a href="${contentUrl}" download="${escapeHtml(filename)}" class="so-c-btn so-c-btn--primary">Download File</a>
      </div>
    `;
  }

  modal.hidden = false;
  document.body.classList.add('modal-open');
}

function handleBlobDownload(ctx: EditorContext, target: HTMLElement): void {
  const blobItem = target.closest('.blob-item') as HTMLElement;
  if (!blobItem) return;

  const blobId = blobItem.dataset.blobId;
  const artifactId = blobItem.dataset.artifactId;
  const filename = blobItem.querySelector('.blob-filename')?.textContent || 'download';

  if (!blobId || !artifactId) return;

  const contentUrl = `${ctx.config.baseUrl}/v1/data/${artifactId}/blobs/${blobId}/content`;

  const link = document.createElement('a');
  link.href = contentUrl;
  link.download = filename;
  link.click();
}

function handleCopyBlobUrl(ctx: EditorContext, target: HTMLElement): void {
  const blobItem = target.closest('.blob-item') as HTMLElement;
  if (!blobItem) return;

  const blobId = blobItem.dataset.blobId;
  const artifactId = blobItem.dataset.artifactId;

  if (!blobId || !artifactId) return;

  const contentUrl = `${ctx.config.baseUrl}/v1/data/${artifactId}/blobs/${blobId}/content`;

  navigator.clipboard.writeText(contentUrl).then(() => {
    const btn = target.closest('.btn-copy') as HTMLElement;
    if (btn) {
      btn.classList.add('btn-copied');
      setTimeout(() => btn.classList.remove('btn-copied'), 2000);
    }
  });
}

function closePreviewModal(): void {
  const modal = document.getElementById('blob-preview-modal');
  if (modal && !modal.hidden) {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    const modalBody = modal.querySelector('.preview-modal-body');
    if (modalBody) {
      modalBody.innerHTML = '';
    }
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Wire the artifact-management controls in the Details panel (EDIT-08 Stage A):
 * change visibility (PATCH /v1/artifacts/{id}) and download the current HTML. Bound directly to
 * the rendered controls (host-agnostic), not the orphaned workspace drawer.
 */
export function setupDetailsManagement(ctx: EditorContext): void {
  const visSelect = document.querySelector<HTMLSelectElement>('[data-visibility-select]');
  if (visSelect) {
    visSelect.addEventListener('change', async () => {
      const visibility = visSelect.value;
      visSelect.disabled = true;
      try {
        const res = await fetch(`/v1/artifacts/${ctx.config.artifactId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ visibility }),
        });
        // 202 = the change was held (governance/moderation), not a hard failure.
        const data = res.status === 202 ? await res.json().catch(() => null) : null;
        if (res.status === 202 && data) {
          invalidateCache();
          if (data.approval_required && data.approval_required.workspace_id) {
            openEditorApproverPicker({
              artifactId: ctx.config.artifactId,
              workspaceId: data.approval_required.workspace_id,
              visibility,
              required: data.approval_required.required,
              selfUserId: ctx.config.userId,
            });
          } else {
            showToast(data.message || 'Change held by workspace policy', 'info');
          }
          // Reflect the held visibility (workspace/private), not the requested one.
          if (data.visibility) visSelect.value = data.visibility;
        } else if (!res.ok) {
          throw new Error(String(res.status));
        } else {
          invalidateCache(); // so re-opening Details reflects the new value
          showToast('Visibility updated', 'success');
        }
      } catch {
        showToast('Could not update visibility', 'error');
      } finally {
        visSelect.disabled = false;
      }
    });
  }

  const downloadBtn = document.querySelector<HTMLButtonElement>('[data-download-html]');
  downloadBtn?.addEventListener('click', () => {
    const html = stripEditorAttributes(ctx.state.html || '');
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ctx.config.slug || 'artifact'}.html`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const deleteBtn = document.querySelector<HTMLButtonElement>('[data-delete-artifact]');
  deleteBtn?.addEventListener('click', async () => {
    const { showConfirmDialog } = await import('../ui/confirm-dialog');
    const ok = await showConfirmDialog({
      title: 'Delete this artifact?',
      body: 'This permanently deletes the page and its drafts. This cannot be undone.',
      confirmLabel: 'Delete permanently',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    deleteBtn.disabled = true;
    try {
      const res = await fetch(`/v1/artifacts/${ctx.config.artifactId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(String(res.status));
      showToast('Artifact deleted', 'success');
      setTimeout(() => {
        window.location.href = '/home';
      }, 500);
    } catch {
      showToast('Could not delete the artifact', 'error');
      deleteBtn.disabled = false;
    }
  });
}

