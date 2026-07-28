import { colors, fonts, radius } from '@shareout/design-tokens';
import type { EditorContext } from '../editor/context';
import { escapeHtml } from '../utils';
import { showToast } from '../toast';
import { stampEditorIdsOnBlocks } from '../dom/editor-ids';
import { syncHtmlFromCanvas } from '../history/html-sync';
import { pushUndoImmediate } from '../history/undo-redo';
import { markDirty } from '../persistence/draft';

interface AssetItem { url: string; filename: string; mimeType: string; name: string }

function kindOf(mime: string): 'image' | 'video' | 'doc' {
  if (mime.indexOf('image/') === 0) return 'image';
  if (mime.indexOf('video/') === 0) return 'video';
  return 'doc';
}

const STYLE = `
  #editor-assets-overlay { position: fixed; inset: 0; background: rgba(28,25,23,0.4); display: flex; align-items: center; justify-content: center; z-index: 10000; }
  .editor-assets-dialog { width: min(640px, 92vw); max-height: 82vh; display: flex; flex-direction: column; background: ${colors.bgElevated}; border-radius: ${radius.md}; box-shadow: 0 24px 70px -20px rgba(28,25,23,0.4); overflow: hidden; }
  .editor-assets-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid ${colors.border}; }
  .editor-assets-head h3 { margin: 0; font: 700 16px ${fonts.body}; }
  .editor-assets-body { padding: 14px 18px 18px; overflow: auto; }
  .editor-assets-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
  .editor-assets-grid .editor-asset { border: 1px solid ${colors.border}; border-radius: ${radius.sm}; overflow: hidden; cursor: pointer; background: ${colors.bg}; text-align: left; padding: 0; }
  .editor-assets-grid .editor-asset:hover { border-color: ${colors.primary}; box-shadow: 0 2px 8px rgba(28,25,23,0.08); }
  .editor-asset__thumb { aspect-ratio: 4/3; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.04); overflow: hidden; color: ${colors.textTertiary}; }
  .editor-asset__thumb img, .editor-asset__thumb video { width: 100%; height: 100%; object-fit: cover; }
  .editor-asset__nm { display: block; padding: 7px 9px; font: 500 12px ${fonts.body}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .editor-assets-empty { padding: 36px 8px; text-align: center; color: ${colors.textSecondary}; font: 14px ${fonts.body}; }
`;

/** Picker for inserting a workspace/personal asset into the canvas. Lists the
 *  library, and on pick inserts an <img> (images) or a download link (other
 *  files) at the selection, then persists like an AI patch. */
export function openAssetsPicker(ctx: EditorContext): void {
  document.getElementById('editor-assets-overlay')?.remove();

  const ov = document.createElement('div');
  ov.id = 'editor-assets-overlay';
  ov.innerHTML = `<style>${STYLE}</style>
    <div class="editor-assets-dialog" role="dialog" aria-label="Insert asset">
      <div class="editor-assets-head"><h3>Insert an asset</h3><button class="so-c-btn so-c-btn--secondary" id="editor-assets-close" type="button">Close</button></div>
      <div class="editor-assets-body" id="editor-assets-body"><div class="editor-assets-empty">Loading…</div></div>
    </div>`;
  document.body.appendChild(ov);
  const close = (): void => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('#editor-assets-close')!.addEventListener('click', close);

  const body = ov.querySelector<HTMLDivElement>('#editor-assets-body')!;

  void (async () => {
    let base = '/v1/assets';
    try {
      const ar = await fetch(`/v1/artifacts/${encodeURIComponent(ctx.config.artifactId)}`, { credentials: 'same-origin' });
      const aj = ar.ok ? await ar.json() : null;
      const ws = aj?.workspace_id ?? aj?.data?.workspace_id;
      if (ws) base = `/v1/workspaces/${encodeURIComponent(ws)}/assets`;
    } catch { /* fall back to personal */ }

    let items: AssetItem[] = [];
    try {
      const r = await fetch(base, { credentials: 'same-origin' });
      const d = r.ok ? await r.json() : null;
      const dels = (d?.deliverables || []).map((x: { url: string; filename: string; mimeType: string; name: string }) => ({ url: x.url, filename: x.filename, mimeType: x.mimeType, name: x.name }));
      const loose = (d?.loose || []).map((x: { url: string; filename: string; mimeType: string }) => ({ url: x.url, filename: x.filename, mimeType: x.mimeType, name: x.filename }));
      items = dels.concat(loose);
    } catch { /* empty */ }

    if (!items.length) {
      body.innerHTML = '<div class="editor-assets-empty">No assets yet. Upload files in your Home → Assets, then insert them here.</div>';
      return;
    }

    body.innerHTML = `<div class="editor-assets-grid">${items.map((a, i) => {
      const kind = kindOf(a.mimeType);
      const thumb = kind === 'image'
        ? `<div class="editor-asset__thumb"><img src="${escapeHtml(a.url)}" alt="" loading="lazy"></div>`
        : kind === 'video'
          ? `<div class="editor-asset__thumb"><video src="${escapeHtml(a.url)}#t=0.1" preload="metadata" muted></video></div>`
          : `<div class="editor-asset__thumb"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></div>`;
      return `<button class="editor-asset" type="button" data-idx="${i}">${thumb}<span class="editor-asset__nm" title="${escapeHtml(a.filename)}">${escapeHtml(a.name)}</span></button>`;
    }).join('')}</div>`;

    body.querySelectorAll<HTMLButtonElement>('[data-idx]').forEach((b) => {
      b.addEventListener('click', () => { insertAsset(ctx, items[Number(b.dataset.idx)]); close(); });
    });
  })();
}

function insertAsset(ctx: EditorContext, a: AssetItem): void {
  const doc = ctx.dom.canvasFrame?.contentDocument;
  if (!doc) { showToast('Canvas not ready.', 'error'); return; }

  const kind = kindOf(a.mimeType);
  const html = kind === 'image'
    ? `<img src="${a.url}" alt="${escapeHtml(a.name)}" style="max-width:100%;height:auto">`
    : kind === 'video'
      ? `<video src="${a.url}" controls style="max-width:100%"></video>`
      : `<a href="${a.url}" download>${escapeHtml(a.name)}</a>`;

  pushUndoImmediate(ctx.state);
  const target = (ctx.state.selectedElement && doc.contains(ctx.state.selectedElement) ? ctx.state.selectedElement : doc.body) as Element;
  target.insertAdjacentHTML('beforeend', html);

  stampEditorIdsOnBlocks(doc);
  syncHtmlFromCanvas(ctx);
  markDirty(ctx);
  showToast('Asset inserted', 'success');
}
