import type { EditorContext } from '../editor/context';
import { showToast } from '../toast';
import { updateHtmlFromCanvas } from '../history/html-sync';
import { stripEditorAttributes } from '../dom/editor-ids';
import { saveStatusView, type SaveState } from './save-status';
import { refreshValidityChip } from '../validation/validity-chip';
import { showConfirmDialog } from '../ui/confirm-dialog';

const SAVE_DEBOUNCE_MS = 2000;
const MAX_SAVE_RETRIES = 3;
const RETRY_BASE_MS = 1500;

let saveRetryTimer: ReturnType<typeof setTimeout> | null = null;
// EDIT-09 F2: autosave debounce on module scope, not window — a second editor instance
// would clobber a shared window slot.
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

function setSaveStatus(ctx: EditorContext, state: SaveState) {
  const el = ctx.dom.saveStatus;
  if (!el) return;
  const { text, className } = saveStatusView(state);
  el.textContent = text;
  el.className = className;
}

// Null-safe cssText setter for the version-history panel's known children.
function styleEl(root: ParentNode, sel: string, css: string): void {
  const el = root.querySelector<HTMLElement>(sel);
  if (el) el.style.cssText = css;
}

interface VersionRow {
  versionId: string;
  versionNo: number;
  createdAt: string;
}

export function markDirty(ctx: EditorContext) {
  ctx.state.isDirty = true;
  setSaveStatus(ctx, 'unsaved');

  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => void saveDraftWithRetry(ctx), SAVE_DEBOUNCE_MS);
}

export async function saveDraft(ctx: EditorContext, opts: { force?: boolean } = {}): Promise<boolean> {
  setSaveStatus(ctx, 'saving');

  updateHtmlFromCanvas(ctx.state, ctx.dom.canvasFrame);

  try {
    const response = await fetch(`/v1/artifacts/${ctx.config.artifactId}/editor/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: stripEditorAttributes(ctx.state.html),
        // EDIT-09 F1: send the timestamp we loaded so the server returns 409 instead of silently
        // clobbering a save made in another tab/device. `force` re-saves after the user chooses.
        baseUpdatedAt: opts.force ? undefined : ctx.state.draftUpdatedAt,
      }),
      credentials: 'same-origin',
    });

    if (response.status === 409) {
      return handleDraftConflict(ctx, await response.json().catch(() => ({})));
    }
    if (!response.ok) {
      throw new Error(`Save failed (${response.status})`);
    }

    const data = await response.json().catch(() => ({}));
    if (data.draftUpdatedAt) ctx.state.draftUpdatedAt = data.draftUpdatedAt;
    setSaveStatus(ctx, 'saved');
    ctx.state.isDirty = false;
    refreshValidityChip(ctx);
    return true;
  } catch (error) {
    setSaveStatus(ctx, 'failed');
    return false;
  }
}

// EDIT-09 F1: a 409 means the draft changed elsewhere. Same product choices as before
// (reload theirs vs overwrite with yours) — studio dialog instead of window.confirm.
async function handleDraftConflict(
  ctx: EditorContext,
  data: { currentUpdatedAt?: string },
): Promise<boolean> {
  setSaveStatus(ctx, 'failed');
  const reload = await showConfirmDialog({
    title: 'This page changed elsewhere',
    body:
      'Another tab, device, or collaborator session saved a newer draft.\n\n' +
      'Reload their version (your unsaved changes here will be lost), or keep yours and overwrite on the next save.',
    confirmLabel: 'Reload newer version',
    cancelLabel: 'Keep mine & overwrite',
  });
  if (reload) {
    location.reload();
    return false;
  }
  // Adopt the server timestamp so the forced re-save (and any retry) matches and overwrites.
  ctx.state.draftUpdatedAt = data.currentUpdatedAt;
  return saveDraft(ctx, { force: true });
}

export async function saveDraftWithRetry(
  ctx: EditorContext,
  attempt = 0
): Promise<void> {
  const ok = await saveDraft(ctx);
  if (ok) {
    if (saveRetryTimer) {
      clearTimeout(saveRetryTimer);
      saveRetryTimer = null;
    }
    return;
  }

  if (attempt >= MAX_SAVE_RETRIES) {
    showToast('Draft save failed after retries', 'error');
    return;
  }

  const delay = RETRY_BASE_MS * (attempt + 1);
  showToast(`Save failed — retrying in ${Math.round(delay / 1000)}s…`, 'warning');
  saveRetryTimer = setTimeout(() => {
    void saveDraftWithRetry(ctx, attempt + 1);
  }, delay);
}

/** Flush draft on tab close when possible (same-origin session cookies). */
export function setupDraftLifecycle(ctx: EditorContext): () => void {
  // EDIT-09 F3: beforeunload alone is lossy on mobile (tab discard / app switch). Also flush on
  // pagehide and the visibility→hidden transition, and cancel the pending debounce since we send
  // the current state right now.
  const flush = () => {
    if (!ctx.state.isDirty || !ctx.state.html) return;
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    updateHtmlFromCanvas(ctx.state, ctx.dom.canvasFrame);
    const url = `/v1/artifacts/${ctx.config.artifactId}/editor/draft`;
    // EDIT-09 F3: carry the loaded timestamp so a stale backgrounded tab gets 409'd
    // server-side (beacon ignores the response) instead of clobbering a newer draft.
    const payload = JSON.stringify({
      html: stripEditorAttributes(ctx.state.html),
      baseUpdatedAt: ctx.state.draftUpdatedAt,
    });

    if (typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush();
  };

  window.addEventListener('beforeunload', flush);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('beforeunload', flush);
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

async function captureThumbnail(ctx: EditorContext): Promise<void> {
  try {
    const iframe = ctx.dom.canvasFrame;
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc?.body) return;

    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(iframeDoc.body, {
      scale: 0.5,
      width: 800,
      height: 600,
      windowWidth: 1200,
      windowHeight: 800,
      useCORS: true,
      logging: false,
    });

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/webp', 0.8)
    );

    if (blob && blob.size < 500 * 1024) {
      await fetch(`/v1/artifacts/${ctx.config.artifactId}/thumbnail`, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/webp' },
        body: blob,
        credentials: 'same-origin',
      });
    }
  } catch {
    // Thumbnail capture is best-effort, don't block publish
  }
}

export async function publish(ctx: EditorContext, opts: { force?: boolean } = {}) {
  if (!opts.force) {
    const ok = await showConfirmDialog({
      title: 'Publish changes?',
      body: 'This makes your current draft live for viewers. Only your personal draft is cleared — other editors keep their own drafts until they publish or discard them.',
      confirmLabel: 'Publish',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
  }

  updateHtmlFromCanvas(ctx.state, ctx.dom.canvasFrame);

  try {
    const response = await fetch(`/v1/artifacts/${ctx.config.artifactId}/editor/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: stripEditorAttributes(ctx.state.html),
        // EDIT-09 F1: publishing deletes the draft and ships live — refuse if a newer
        // draft was saved elsewhere. `force` re-publishes after the user chooses.
        baseUpdatedAt: opts.force ? undefined : ctx.state.draftUpdatedAt,
      }),
      credentials: 'same-origin',
    });

    if (response.status === 409) {
      const data = await response.json().catch(() => ({}));
      const overwrite = await showConfirmDialog({
        title: 'Newer draft exists',
        body:
          'This page was changed in another tab or on another device since you opened it.\n\n' +
          'Publish your version anyway (overwrites that draft), or stop and reload the newer version.',
        confirmLabel: 'Publish mine anyway',
        cancelLabel: 'Reload newer version',
      });
      if (!overwrite) {
        location.reload();
        return;
      }
      ctx.state.draftUpdatedAt = data.currentUpdatedAt;
      return publish(ctx, { force: true });
    }

    const data = await response.json();
    if (data.success) {
      showToast('Published successfully', 'success');
      ctx.state.isDirty = false;
      if (data.versionNo) {
        ctx.state.version = data.versionNo;
        const versionIndicator = document.getElementById('version-indicator');
        if (versionIndicator) {
          versionIndicator.textContent = `v${data.versionNo}`;
        }
      }
      // Capture thumbnail after successful publish (best-effort)
      captureThumbnail(ctx);
    } else {
      showToast('Publish failed: ' + (data.error || 'unknown error'), 'error');
    }
  } catch (error) {
    showToast('Publish failed', 'error');
  }
}

export function openPreview(ctx: EditorContext) {
  window.open(`/a/${ctx.config.slug}`, '_blank');
}

export async function openVersionHistory(ctx: EditorContext) {
  const panel = document.createElement('div');
  panel.className = 'version-history-panel';
  panel.innerHTML = `
    <div class="version-history-content">
      <div class="version-history-header">
        <h3>Version History</h3>
        <button class="version-history-close">&times;</button>
      </div>
      <div class="version-history-list">
        <div class="version-loading">Loading versions...</div>
      </div>
    </div>
  `;

  panel.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:320px;background:white;box-shadow:-4px 0 24px rgba(0,0,0,0.15);z-index:10000;display:flex;flex-direction:column;';
  styleEl(panel, '.version-history-content', 'display:flex;flex-direction:column;height:100%;');
  styleEl(panel, '.version-history-header', 'display:flex;justify-content:space-between;align-items:center;padding:16px;border-bottom:1px solid var(--border-color);');
  styleEl(panel, '.version-history-close', 'border:none;background:none;font-size:24px;cursor:pointer;color:var(--text-muted);');
  styleEl(panel, '.version-history-list', 'flex:1;overflow-y:auto;padding:8px;');
  styleEl(panel, '.version-loading', 'text-align:center;padding:24px;color:var(--text-muted);');

  panel.querySelector('.version-history-close')?.addEventListener('click', () => panel.remove());

  document.body.appendChild(panel);

  try {
    const res = await fetch(`/v1/artifacts/${ctx.config.artifactId}/editor/history`, {
      credentials: 'same-origin',
    });
    const data = await res.json() as { success?: boolean; versions?: VersionRow[]; error?: string };

    const list = panel.querySelector<HTMLElement>('.version-history-list');
    if (data.success && data.versions?.length && list) {
      list.innerHTML = data.versions.map((v) => `
        <div class="version-item" data-version-id="${v.versionId}" data-version-no="${v.versionNo}">
          <div class="version-info">
            <span class="version-number">v${v.versionNo}</span>
            <span class="version-date">${new Date(v.createdAt).toLocaleString()}</span>
          </div>
          <div class="version-actions">
            <button class="so-c-btn so-c-btn--secondary so-c-btn--sm version-preview" data-version-no="${v.versionNo}">Preview</button>
            <button class="so-c-btn so-c-btn--primary so-c-btn--sm version-restore" data-version-id="${v.versionId}">Restore</button>
          </div>
        </div>
      `).join('');

      list.querySelectorAll<HTMLElement>('.version-item').forEach(item => {
        item.style.cssText = 'padding:12px;border-bottom:1px solid var(--border-color);';
        styleEl(item, '.version-info', 'display:flex;flex-direction:column;gap:4px;margin-bottom:8px;');
        styleEl(item, '.version-number', 'font-weight:600;');
        styleEl(item, '.version-date', 'font-size:12px;color:var(--text-muted);');
        styleEl(item, '.version-actions', 'display:flex;gap:8px;');
      });

      list.querySelectorAll<HTMLElement>('.version-preview').forEach(btn => {
        btn.addEventListener('click', () => {
          window.open(`/a/${ctx.config.slug}?v=${btn.dataset.versionNo}`, '_blank');
        });
      });

      list.querySelectorAll<HTMLElement>('.version-restore').forEach(btn => {
        btn.addEventListener('click', async () => {
          const ok = await showConfirmDialog({
            title: 'Restore this version?',
            body: 'Your current personal draft will be replaced with this published version.',
            confirmLabel: 'Restore',
            cancelLabel: 'Cancel',
          });
          if (!ok) return;

          const versionId = btn.dataset.versionId;
          if (!versionId) {
            showToast('Invalid version', 'error');
            return;
          }

          const res = await fetch(`/v1/artifacts/${ctx.config.artifactId}/editor/rollback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ versionId }),
          });

          const payload = await res.json().catch(() => ({}));
          if (res.ok && payload.success) {
            showToast('Version restored', 'success');
            panel.remove();
            location.reload();
          } else {
            showToast(payload.error || 'Failed to restore version', 'error');
          }
        });
      });
    } else if (list) {
      list.innerHTML = '<div class="version-empty">No published versions yet</div>';
      styleEl(panel, '.version-empty', 'text-align:center;padding:24px;color:var(--text-muted);');
    }
  } catch (error) {
    const list = panel.querySelector<HTMLElement>('.version-history-list');
    if (list) list.innerHTML = '<div class="version-error">Failed to load versions</div>';
    styleEl(panel, '.version-error', 'text-align:center;padding:24px;color:var(--error);');
  }
}
