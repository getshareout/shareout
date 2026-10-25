/** Multi-page artifacts: which sibling page a pane shows (rec.page, '' = entrypoint),
 *  its #a/<slug>/<page> deep link, cross-artifact links from inside a page, and the
 *  Details page list. The viewer wrapper relays page reports from the content frame
 *  (src/serve/page-agent.ts). Must be composed before routing.ts (boot applyHash). */
export const workspace_client_artifact_pages_JS = `  // ===== multi-page artifacts =====
  var stagePending = {};   // slug -> page for that artifact's first stage paint
  function encPage(p) { return String(p).split('/').map(encodeURIComponent).join('/'); }
  function takeStagePage(rec) {
    var s = rec.art.slug;
    if (stagePending && Object.prototype.hasOwnProperty.call(stagePending, s)) { rec.page = stagePending[s]; delete stagePending[s]; }
    return rec.page || '';
  }
  // The frame already pushed a history entry for in-page navigation, so the hash is
  // replaced (not pushed) to keep back/forward one step per page.
  function replaceRouteHash() {
    if (routeApplying) return;
    var h = '#' + routeFromState();
    if (location.hash === h) return;
    routeLastHash = h;
    try { history.replaceState(history.state, '', h); } catch (e) {}
  }
  function markArtPage(rec) {
    if (!rbodyEl || panes[activeKey] !== rec) return;
    rbodyEl.querySelectorAll('[data-art-page]').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-art-page') === (rec.page || '')); });
  }
  function showArtPage(rec, page) {
    page = page || '';
    if ((rec.page || '') === page) return;
    rec.page = page;
    if (rec.staged && rec.iframe.getAttribute('src')) rec.iframe.src = stageUrl(rec.art.slug, page);
    replaceRouteHash(); markArtPage(rec);
  }
  function openArtifactPage(slug, page) {
    page = page || '';
    var key = null;
    for (var i = 0; i < tabs.length; i++) { if (!tabs[i].home && panes[tabs[i].key] && panes[tabs[i].key].art.slug === slug) key = tabs[i].key; }
    if (key && panes[key].staged) { activateTab(key); showArtPage(panes[key], page); return; }
    stagePending[slug] = page;
    if (key) activateTab(key); else openArtifact(slug, null, '');
  }
  function pagesHtml(meta, art) {
    var pages = meta && meta.pages;
    if (!pages || pages.length < 2) return '';
    var rec = panes[art.key], cur = (rec && rec.page) || '', entry = meta.entrypoint || pages[0];
    var items = pages.map(function (p) {
      var v = p === entry ? '' : p;
      return '<button type="button" class="wsx-det__page' + (v === cur ? ' is-on' : '') + '" data-art-page="' + esc(v) + '" title="' + esc(p) + '">' + esc(p.replace(/\\.html?$/i, '')) + '</button>';
    }).join('');
    return sec('pages', t('pages.title').replace('{n}', pages.length), t('pages.help'), '<div class="wsx-det__pages">' + items + '</div>');
  }
  if (rbodyEl) rbodyEl.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-art-page]');
    var rec = b && panes[activeKey];
    if (rec) showArtPage(rec, b.getAttribute('data-art-page'));
  });
  // Reports from our own viewer wrappers (same origin) in the stage iframes.
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin) return;
    var d = e.data;
    if (!d || (d.type !== 'shareout:page' && d.type !== 'shareout:open-artifact')) return;
    var rec = null;
    Object.keys(panes).forEach(function (k) { if (panes[k].iframe && panes[k].iframe.contentWindow === e.source) rec = panes[k]; });
    if (!rec) return;
    if (d.type === 'shareout:page') {
      if (typeof d.page !== 'string') return;
      rec.page = d.page;
      if (panes[activeKey] === rec) replaceRouteHash();
      markArtPage(rec);
    } else if (typeof d.slug === 'string' && d.slug) {
      openArtifactPage(d.slug, typeof d.page === 'string' ? d.page : '');
    }
  });

`;
