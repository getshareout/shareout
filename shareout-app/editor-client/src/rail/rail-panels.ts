// Utility panels (Outline · Details · Validation · History) hosted inside the rail,
// replacing the old slide-over drawer. One consistent glass surface.
import type { EditorContext } from '../editor/context';
import { createLogger } from '../editor/logger';
import { setRailMode } from './rail';
import { renderOutlineSection, setupOutlineHandlers } from '../outline/outline-panel';
import { renderValidationSection, setupValidationHandlers } from '../validation/validation-panel';
import { renderDetailsPanel, renderLoadingSkeleton, renderErrorState } from '../workspace/details-panel';
import { getCachedDetails, getArtifactDetails } from '../workspace/details-cache';
import { setupDetailsPanelInteractions, setupDetailsManagement } from '../workspace/details-interactions';
import { renderConnectPanel } from './connect-panel';
import { renderMetricsPanel } from './metrics-panel';
import { renderInboxPanel } from './inbox-panel';
import { showToast } from '../toast';
import { showConfirmDialog } from '../ui/confirm-dialog';

const log = createLogger('rail-panels');

export type RailPanelKey = 'outline' | 'details' | 'validation' | 'history' | 'share' | 'connect' | 'metrics' | 'inbox';

const TITLES: Record<RailPanelKey, string> = {
  outline: 'Outline',
  details: 'Details',
  validation: 'Validation',
  history: 'Version history',
  share: 'Share',
  connect: 'Connections',
  metrics: 'Metrics & alerts',
  inbox: 'Inbox',
};

export function openRailPanel(ctx: EditorContext, key: RailPanelKey): void {
  const rail = ctx.dom.studioRail;
  const host = document.getElementById('rail-panel-content');
  const titleEl = document.getElementById('rail-panel-title');
  if (!rail || !host) {
    log.warn('openRailPanel: rail/panel host missing');
    return;
  }

  rail.dataset.collapsed = 'false';
  const peek = document.getElementById('rail-peek');
  if (peek) peek.hidden = true;
  if (titleEl) titleEl.textContent = TITLES[key];

  setRailMode(ctx, 'panel');

  switch (key) {
    case 'outline':
      host.innerHTML = renderOutlineSection(ctx);
      setupOutlineHandlers(ctx);
      break;
    case 'validation':
      host.innerHTML = renderValidationSection(ctx);
      setupValidationHandlers(ctx);
      break;
    case 'details':
      renderDetails(ctx, host);
      break;
    case 'history':
      void renderHistory(ctx, host);
      break;
    case 'share':
      renderShare(ctx, host);
      break;
    case 'connect':
      void renderConnectPanel(ctx, host);
      break;
    case 'metrics':
      void renderMetricsPanel(ctx, host);
      break;
    case 'inbox':
      void renderInboxPanel(ctx, host);
      break;
  }
}

function renderShare(ctx: EditorContext, host: HTMLElement): void {
  const link = `${ctx.config.baseUrl}/a/${ctx.config.slug}/`;
  host.innerHTML = `
    <div class="rail-form">
      <div class="rail-field">
        <label class="rail-label">Link</label>
        <div class="rail-link-row">
          <input class="rail-input" id="share-link" type="text" readonly value="${link}">
          <button class="so-c-btn so-c-btn--ghost so-c-btn--sm" id="share-copy">Copy</button>
        </div>
      </div>
      <div class="rail-field">
        <label class="rail-label" for="share-emails">Send to (emails, comma-separated)</label>
        <input class="rail-input" id="share-emails" type="text" placeholder="alex@example.com, sam@example.com" autocomplete="off">
      </div>
      <div class="rail-field">
        <label class="rail-label" for="share-message">Message (optional)</label>
        <textarea class="rail-input" id="share-message" rows="3" placeholder="Add a short note…"></textarea>
      </div>
      <div class="rail-field">
        <label class="rail-label">Recipient access</label>
        <label class="rail-radio"><input type="radio" name="share-role" value="none" checked> Just send a link</label>
        <label class="rail-radio"><input type="radio" name="share-role" value="viewer"> Can view (Viewer)</label>
        <label class="rail-radio"><input type="radio" name="share-role" value="editor"> Can edit (Editor)</label>
        <p class="rail-empty-hint">Viewers/Editors are saved as collaborators and can open private artifacts.</p>
      </div>
      <p class="rail-empty-hint" id="share-status"></p>
      <button class="so-c-btn so-c-btn--primary so-c-btn--sm" id="share-send">Send</button>
    </div>`;

  const linkInput = host.querySelector<HTMLInputElement>('#share-link');
  host.querySelector<HTMLButtonElement>('#share-copy')?.addEventListener('click', () => {
    if (linkInput) navigator.clipboard?.writeText(linkInput.value);
    showToast('Link copied!', 'success');
  });

  const sendBtn = host.querySelector<HTMLButtonElement>('#share-send');
  const statusEl = host.querySelector<HTMLElement>('#share-status');
  sendBtn?.addEventListener('click', async () => {
    const emailsRaw = host.querySelector<HTMLInputElement>('#share-emails')?.value || '';
    const emails = emailsRaw.split(/[,\s]+/).map((e) => e.trim()).filter(Boolean);
    if (!emails.length) {
      if (statusEl) statusEl.textContent = 'Enter at least one email, or use Copy.';
      return;
    }
    const role = host.querySelector<HTMLInputElement>('input[name="share-role"]:checked')?.value || 'none';
    const message = host.querySelector<HTMLTextAreaElement>('#share-message')?.value || undefined;
    sendBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Sending…';
    try {
      const r = await fetch(`/v1/artifacts/${ctx.config.artifactId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ recipients: emails, message, role }),
      });
      const payload = await r.json().catch(() => ({}));
      if (r.ok) {
        const n = (payload.sent || []).length;
        showToast(`${n} invite${n === 1 ? '' : 's'} sent`, 'success');
        if (statusEl) statusEl.textContent = '';
        const emailsInput = host.querySelector<HTMLInputElement>('#share-emails');
        if (emailsInput) emailsInput.value = '';
      } else if (statusEl) {
        statusEl.textContent = payload.error || 'Failed to share.';
      }
    } catch {
      if (statusEl) statusEl.textContent = 'Network error.';
    } finally {
      sendBtn.disabled = false;
    }
  });
}

function renderDetails(ctx: EditorContext, host: HTMLElement): void {
  const cached = getCachedDetails();
  if (cached) {
    host.innerHTML = renderDetailsPanel(cached);
    setupDetailsPanelInteractions(ctx);
    setupDetailsManagement(ctx);
    return;
  }
  host.innerHTML = renderLoadingSkeleton();
  getArtifactDetails(ctx)
    .then((details) => {
      host.innerHTML = renderDetailsPanel(details);
      setupDetailsPanelInteractions(ctx);
      setupDetailsManagement(ctx);
    })
    .catch(() => {
      host.innerHTML = renderErrorState('Failed to load artifact details');
    });
}

async function renderHistory(ctx: EditorContext, host: HTMLElement): Promise<void> {
  host.innerHTML = '<div class="rail-empty"><p class="rail-empty-hint">Loading versions…</p></div>';
  try {
    const res = await fetch(`/v1/artifacts/${ctx.config.artifactId}/editor/history`, {
      credentials: 'same-origin',
    });
    const data = await res.json();

    if (!data.success || !data.versions?.length) {
      host.innerHTML = '<div class="rail-empty"><p class="rail-empty-hint">No published versions yet</p></div>';
      return;
    }

    host.innerHTML = `<div class="version-list">${data.versions
      .map(
        (v: { versionId: string; versionNo: number; createdAt: string }) => `
        <div class="version-item">
          <div class="version-item-info">
            <span class="version-item-no">v${v.versionNo}</span>
            <span class="version-item-date">${new Date(v.createdAt).toLocaleString()}</span>
          </div>
          <div class="version-item-actions">
            <button class="so-c-btn so-c-btn--ghost so-c-btn--sm" data-version-preview="${v.versionNo}">Preview</button>
            <button class="so-c-btn so-c-btn--primary so-c-btn--sm" data-version-restore="${v.versionId}">Restore</button>
          </div>
        </div>`
      )
      .join('')}</div>`;

    host.querySelectorAll<HTMLButtonElement>('[data-version-preview]').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.open(`/a/${ctx.config.slug}?v=${btn.dataset.versionPreview}`, '_blank');
      });
    });

    host.querySelectorAll<HTMLButtonElement>('[data-version-restore]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ok = await showConfirmDialog({
          title: 'Restore this version?',
          body: 'Your current personal draft will be replaced with this published version. You can undo only if you still have undo history open — otherwise publish history stays intact.',
          confirmLabel: 'Restore',
          cancelLabel: 'Cancel',
        });
        if (!ok) return;
        const versionId = btn.dataset.versionRestore;
        const r = await fetch(`/v1/artifacts/${ctx.config.artifactId}/editor/rollback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ versionId }),
        });
        const payload = await r.json().catch(() => ({}));
        if (r.ok && payload.success) {
          showToast('Version restored', 'success');
          location.reload();
        } else {
          showToast(payload.error || 'Failed to restore version', 'error');
        }
      });
    });
  } catch (err) {
    log.error('history load failed', err);
    host.innerHTML = '<div class="rail-empty"><p class="rail-empty-hint">Failed to load versions</p></div>';
  }
}
