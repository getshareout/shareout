/** URL deep-linking: reflect the active lens / artifact tab in location.hash so views
 *  are linkable and back/forward works. Hash scheme: #l/<lens> · #a/<slug>. */
export const workspace_client_routing_JS = `  // ===== deep-link routing (hash) =====
  var routeApplying = false;     // true while applyHash drives state (suppresses writes)
  var routeLastHash = null;      // hash we wrote via fallback assignment (skip echo)
  function routeFromState() {
    if (activeKey !== 'home' && panes[activeKey]) return 'a/' + encodeURIComponent(panes[activeKey].art.slug);
    var on = ws.querySelector('[data-lens].is-active');
    var lens = on ? on.getAttribute('data-lens') : 'brief';
    if (lens === 'catalog' && typeof catCurrentId === 'string' && catCurrentId) return 'l/catalog/' + encodeURIComponent(catCurrentId);
    if (lens === 'knowledge' && typeof knCurrentPath === 'string' && knCurrentPath) return 'l/knowledge/' + encodeURIComponent(knCurrentPath);
    return 'l/' + lens;
  }
  function syncHash() {
    if (routeApplying) return;
    var h = '#' + routeFromState();
    if (location.hash === h) return;
    routeLastHash = h;
    try { history.pushState(null, '', h); } catch (e) { location.hash = h; }
  }
  function applyHash() {
    var raw = (location.hash || '').replace(/^#\\/?/, '');
    routeApplying = true;
    try {
      if (raw.indexOf('a/') === 0) {
        var slug = decodeURIComponent(raw.slice(2));
        if (!slug) return;
        var key = null;
        for (var i = 0; i < tabs.length; i++) { if (!tabs[i].home && panes[tabs[i].key] && panes[tabs[i].key].art.slug === slug) key = tabs[i].key; }
        if (key) activateTab(key); else openArtifact(slug, null, '');
        return;
      }
      // lens route (or empty hash → Home/Brief). A lens may carry a sub-path,
      // e.g. #l/catalog/<entry-id> deep-links a catalog entry.
      var lensFull = raw.indexOf('l/') === 0 ? (raw.slice(2) || 'brief') : 'brief';
      var sl = lensFull.indexOf('/');
      var lens = sl >= 0 ? lensFull.slice(0, sl) : lensFull;
      var sub = sl >= 0 ? lensFull.slice(sl + 1) : '';
      var lb = ws.querySelector('[data-lens="' + lens + '"]');
      if (!lb) { lens = 'brief'; sub = ''; }
      lenses.forEach(function (x) { x.classList.toggle('is-active', x.getAttribute('data-lens') === lens); });
      if (typeof exitCreate === 'function') exitCreate();
      openView(lens);
      if (lens === 'catalog' && typeof catRoute === 'function') catRoute(decodeURIComponent(sub));
      if (lens === 'knowledge' && typeof knRoute === 'function') knRoute(decodeURIComponent(sub));
    } finally { routeApplying = false; }
  }
  window.addEventListener('popstate', function () { applyHash(); });
  window.addEventListener('hashchange', function () { if (location.hash === routeLastHash) return; applyHash(); });
  if (location.hash) applyHash();

`;
