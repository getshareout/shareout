import { shareModalScript } from '../../../../components/share-modal';

/** Lazy chunk (lazy-chunks.ts `share`): the one share dialog (components/share-modal), fetched on first use. */
export const workspace_client_share_dialog_JS = `${shareModalScript({ baseUrl: '' })}
  function wsxOpenShare(id, slug, name, canEdit) { window.openShare(id, slug, name, canEdit); }
`;

/** Share on the artifact bar and the Details rail: both open the one share dialog. */
export const workspace_client_share_popover_JS = `  // ===== Share (artifact bar + Details rail) =====
  var shareBtnEl = document.getElementById('wsxShareBtn');
  function openShareFor(art) { if (art && art.id) wsxOpenShare(art.id, art.slug, art.name || '', !!art.canEdit); }
  if (shareBtnEl) {
    shareBtnEl.addEventListener('click', function () { var rec = panes[activeKey]; if (rec) openShareFor(rec.art); });
    // Warm the dialog's chunk on intent so the click opens it at once.
    var warmShare = function () { wsxChunk('share'); };
    shareBtnEl.addEventListener('pointerenter', warmShare, { once: true });
    shareBtnEl.addEventListener('focus', warmShare, { once: true });
  }
  // The dialog changed who can see it: drop the cached meta so the rail repaints the truth.
  window.addEventListener('so:share-changed', function (e) {
    var id = e.detail && e.detail.id; if (!id) return;
    metaCache[id] = undefined;
    if (rActive === 'details' && activeArt && activeArt.id === id) paintRail();
  });

`;
