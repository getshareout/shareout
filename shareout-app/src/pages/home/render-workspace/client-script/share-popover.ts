/** Share popover on the artifact bar: the Details "Shared with" visibility + invite controls, one click away. */
export const workspace_client_share_popover_JS = `  // ===== Share popover (artifact bar) =====
  var sharePopEl = null, sharePopArt = null, sharePopVis = '';
  var shareWrapEl = document.getElementById('wsxShareWrap');
  var shareBtnEl = document.getElementById('wsxShareBtn');
  function closeSharePop() {
    if (!sharePopEl) return;
    var art = sharePopArt, v0 = sharePopVis;
    sharePopEl.remove(); sharePopEl = null; sharePopArt = null;
    if (shareBtnEl) shareBtnEl.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onShareOutside, true);
    document.removeEventListener('keydown', onShareKey, true);
    var m = art && art.id && metaCache[art.id];
    if (rActive === 'details' && activeArt === art && (!m || m.visibility !== v0)) paintRail();
  }
  function onShareOutside(e) { if (sharePopEl && !sharePopEl.contains(e.target) && !shareBtnEl.contains(e.target)) closeSharePop(); }
  function onShareKey(e) { if (e.key === 'Escape') { closeSharePop(); shareBtnEl.focus(); } }
  function openSharePop() {
    var rec = panes[activeKey]; if (!rec || !rec.art.canEdit) return;
    var art = rec.art;
    fetchMeta(art, function (meta) {
      if (!meta || !meta.can_edit || panes[activeKey] !== rec || sharePopEl) return;
      var vis = meta.visibility === 'unlisted' ? 'public' : (meta.visibility || 'private');
      var opts = ['private'].concat(meta.workspace_id ? ['workspace'] : [], ['public']);
      sharePopEl = document.createElement('div');
      sharePopEl.className = 'wsx-sharepop'; sharePopEl.setAttribute('role', 'dialog'); sharePopEl.setAttribute('aria-label', t('share.button'));
      sharePopEl.innerHTML = '<div class="wsx-sharepop__title">' + esc(t('share.title')) + '</div>' + visBlockHtml(true, opts, vis)
        + '<div class="wsx-det__chips wsx-det__sharecard wsx-sharepop__people"></div>'
        + '<button class="wsx-abtn wsx-sharepop__copy" type="button" data-share-copy>' + isvg(SVG_LINK) + esc(t('share.copyLink')) + '</button>';
      shareWrapEl.appendChild(sharePopEl);
      sharePopArt = art; sharePopVis = vis;
      shareBtnEl.setAttribute('aria-expanded', 'true');
      wireVis(sharePopEl, art, vis);
      renderShare(art, meta, true, sharePopEl.querySelector('.wsx-sharepop__people'));
      sharePopEl.querySelector('[data-share-copy]').addEventListener('click', function () {
        copyText(meta.url || (location.origin + '/a/' + encodeURIComponent(meta.slug || art.slug) + '/'), null);
      });
      document.addEventListener('mousedown', onShareOutside, true);
      document.addEventListener('keydown', onShareKey, true);
    });
  }
  if (shareBtnEl) shareBtnEl.addEventListener('click', function () { if (sharePopEl) closeSharePop(); else openSharePop(); });

`;
