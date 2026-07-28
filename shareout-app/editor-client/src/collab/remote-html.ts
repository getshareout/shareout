import type { EditorContext } from '../editor/context';
import { applyHtmlToCanvasFull, applyHtmlToCanvasIncremental } from '../canvas/apply-html';
import { resolveElementBySelector } from '../dom/editor-ids';
import { pushUndoImmediate } from '../history/undo-redo';
import { showToast } from '../toast';
import { markDirty } from '../persistence/draft';

export interface PendingRemoteUpdate {
  html: string;
  version: number;
}

export function showRemoteConflictDialog(
  ctx: EditorContext,
  pending: PendingRemoteUpdate,
  onResolved: () => void
): void {
  const existing = document.getElementById('remote-conflict-dialog');
  existing?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'remote-conflict-dialog';
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:20000;display:flex;align-items:center;justify-content:center;padding:24px;';

  const card = document.createElement('div');
  card.style.cssText =
    'background:var(--bg-primary,#fff);color:var(--text-primary,#111);max-width:420px;width:100%;border-radius:12px;padding:24px;box-shadow:0 16px 48px rgba(0,0,0,0.2);';

  card.innerHTML = `
    <h3 style="margin:0 0 8px;font-size:18px;">Collaborator updated this page</h3>
    <p style="margin:0 0 20px;font-size:14px;color:var(--text-muted,#666);line-height:1.5;">
      You have unsaved changes. Load their version or keep editing yours.
    </p>
    <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
      <button type="button" data-action="keep" class="so-c-btn so-c-btn--secondary">Keep my edits</button>
      <button type="button" data-action="load" class="so-c-btn so-c-btn--primary">Load their version</button>
    </div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  card.querySelector('[data-action="keep"]')?.addEventListener('click', () => {
    overlay.remove();
    showToast('Kept your version — reload to see theirs', 'info');
    onResolved();
  });

  card.querySelector('[data-action="load"]')?.addEventListener('click', () => {
    overlay.remove();
    applyRemoteHtmlUpdate(ctx, pending.html, pending.version, { force: true });
    onResolved();
  });
}

export function applyRemoteHtmlUpdate(
  ctx: EditorContext,
  html: string,
  version: number,
  options?: { force?: boolean }
): void {
  if (version <= (ctx.state.version ?? 0) && !options?.force) return;

  const selectedId = ctx.state.selectedEditorId;
  pushUndoImmediate(ctx.state);

  // Suppress the mutation observer while applying a change RECEIVED from a
  // collaborator — otherwise it is re-observed as a local edit and broadcast back
  // (echo storm). The update already carries the authoritative version.
  const withPaused = ctx.withCanvasMutationsPaused ?? (<T>(fn: () => T) => fn());
  withPaused(() => {
    const incremental = applyHtmlToCanvasIncremental(ctx.dom, html);
    if (!incremental) {
      applyHtmlToCanvasFull(ctx.dom, html);
      ctx.bindCanvasEvents();
    }
  });

  ctx.state.html = html;
  ctx.state.version = version;
  ctx.state.isDirty = true;
  markDirty(ctx);

  if (selectedId) {
    const doc = ctx.dom.canvasFrame.contentDocument;
    const el = doc ? resolveElementBySelector(doc, `[data-editor-id="${selectedId}"]`) : null;
    if (el) ctx.selectElement(el);
    else ctx.selectElement(null);
  } else {
    ctx.selectElement(null);
  }

  showToast('Loaded collaborator changes', 'info');
}
